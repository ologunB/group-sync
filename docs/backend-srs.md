# GroupSync — Backend SRS
## Software Requirements Specification (Backend & API)

> **Version**: 1.0 — MVP  
> **Stack**: Node.js + Express + TypeScript + PostgreSQL (PostGIS) + Redis + BullMQ + Socket.io  
> **Target**: This document defines every data model, endpoint, business rule, and implementation constraint for the GroupSync backend. It is the single source of truth for API development.

---

## 1. Architecture Overview

```
Client (Web/PWA/Mobile)
    │
    ├── REST API (Express)         ← all CRUD, auth, membership flows
    └── WebSocket (Socket.io)      ← real-time chat, presence, notifications
            │
     ┌──────┴──────────────────────────────────┐
     │           Application Layer              │
     │  features/auth  features/users           │
     │  features/groups features/messages       │
     │  features/events features/notifications  │
     └──────────────────────────────────────────┘
            │                   │
      PostgreSQL (PostGIS)     Redis
      (primary data store)    (sessions, presence, rate-limit counters,
                               BullMQ queue, verification codes)
            │
          BullMQ Workers
          (emails, push notifications, KYC webhooks, file cleanup)
            │
     External Services
     S3/R2 (files) · FCM (push) · KYC provider · SMTP
```

---

## 2. SQL Database Schema

> All tables use PostgreSQL. PostGIS extension is required for location queries. All primary keys are UUID (`gen_random_uuid()`). All timestamps are `TIMESTAMPTZ` (UTC). Soft deletes use `deleted_at TIMESTAMPTZ NULL`.

---

### 2.1 Users

```sql
CREATE TABLE users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   VARCHAR(255) NOT NULL UNIQUE,
    phone                   TEXT,                          -- stored encrypted (AES-256), never returned in API
    phone_iv                TEXT,                          -- IV for phone decryption
    password_hash           TEXT,                          -- NULL for pure OAuth users
    display_name            VARCHAR(100) NOT NULL,
    username                VARCHAR(50) UNIQUE,            -- optional handle, lowercase, no spaces
    profile_photo_url       TEXT,
    bio                     TEXT,
    city                    VARCHAR(100),
    state                   VARCHAR(100),
    country                 VARCHAR(100) DEFAULT 'NG',
    location                GEOMETRY(Point, 4326),         -- PostGIS: (lng, lat)
    interests               TEXT[] DEFAULT '{}',           -- interest tags
    id_verification_status  VARCHAR(20) NOT NULL DEFAULT 'unsubmitted'
                                CHECK (id_verification_status IN ('unsubmitted','pending','verified','rejected')),
    id_document_url         TEXT,                          -- encrypted S3 key, deleted after verification
    id_document_iv          TEXT,
    id_verified_at          TIMESTAMPTZ,
    status                  VARCHAR(20) NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','suspended','banned')),
    last_login_at           TIMESTAMPTZ,
    preferred_language      VARCHAR(10) DEFAULT 'en',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at              TIMESTAMPTZ                    -- soft delete
);

CREATE INDEX idx_users_location ON users USING GIST (location);
CREATE INDEX idx_users_status ON users (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_verification ON users (id_verification_status);
CREATE INDEX idx_users_email ON users (email) WHERE deleted_at IS NULL;

-- Full-text search on display_name and bio
ALTER TABLE users ADD COLUMN fts_vector TSVECTOR
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(display_name, '') || ' ' || coalesce(bio, ''))
    ) STORED;
CREATE INDEX idx_users_fts ON users USING GIN (fts_vector);
```

---

### 2.2 OAuth Providers

```sql
CREATE TABLE user_providers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    VARCHAR(30) NOT NULL CHECK (provider IN ('google', 'apple')),
    provider_id TEXT NOT NULL,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (provider, provider_id)
);

CREATE INDEX idx_providers_user ON user_providers (user_id);
```

---

### 2.3 Refresh Tokens & Sessions

```sql
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,               -- opaque hex token
    expires_at      TIMESTAMPTZ NOT NULL,
    created_by_ip   INET,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_token ON refresh_tokens (token);

CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_info TEXT,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ
);
```

---

### 2.4 Groups

```sql
CREATE TABLE groups (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        VARCHAR(150) NOT NULL,
    slug                        VARCHAR(170) NOT NULL UNIQUE,   -- URL-friendly, auto-generated
    category                    VARCHAR(80) NOT NULL,
    subcategory                 VARCHAR(80),
    description                 TEXT,
    cover_image_url             TEXT,
    logo_url                    TEXT,
    city                        VARCHAR(100),
    state                       VARCHAR(100),
    country                     VARCHAR(100) DEFAULT 'NG',
    location                    GEOMETRY(Point, 4326),
    membership_type             VARCHAR(20) NOT NULL DEFAULT 'open'
                                    CHECK (membership_type IN ('open','application','invite_only')),
    membership_fee              NUMERIC(12,2),                  -- NULL = free
    membership_fee_currency     VARCHAR(10) DEFAULT 'NGN',
    membership_fee_frequency    VARCHAR(20)
                                    CHECK (membership_fee_frequency IN ('one_time','monthly','yearly')),
    how_to_join_content         TEXT,                           -- rich text / markdown
    rules                       TEXT,
    founding_date               DATE,
    is_verified                 BOOLEAN NOT NULL DEFAULT FALSE,
    is_discoverable             BOOLEAN NOT NULL DEFAULT TRUE,  -- invite_only groups set this FALSE
    member_count                INTEGER NOT NULL DEFAULT 0,     -- denormalized, updated via trigger
    created_by                  UUID NOT NULL REFERENCES users(id),
    status                      VARCHAR(20) NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active','suspended','deleted')),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMPTZ
);

CREATE INDEX idx_groups_location ON groups USING GIST (location);
CREATE INDEX idx_groups_category ON groups (category) WHERE deleted_at IS NULL;
CREATE INDEX idx_groups_slug ON groups (slug);
CREATE INDEX idx_groups_status ON groups (status, is_discoverable);
CREATE INDEX idx_groups_created_by ON groups (created_by);

-- Full-text search
ALTER TABLE groups ADD COLUMN fts_vector TSVECTOR
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(name, '') || ' ' ||
            coalesce(description, '') || ' ' ||
            coalesce(category, '') || ' ' ||
            coalesce(subcategory, ''))
    ) STORED;
CREATE INDEX idx_groups_fts ON groups USING GIN (fts_vector);
```

**member_count trigger:**

```sql
CREATE OR REPLACE FUNCTION update_group_member_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
        UPDATE groups SET member_count = member_count + 1 WHERE id = NEW.group_id;
    ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
        UPDATE groups SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.group_id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status != 'active' AND NEW.status = 'active' THEN
            UPDATE groups SET member_count = member_count + 1 WHERE id = NEW.group_id;
        ELSIF OLD.status = 'active' AND NEW.status != 'active' THEN
            UPDATE groups SET member_count = GREATEST(0, member_count - 1) WHERE id = OLD.group_id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_membership_count
AFTER INSERT OR UPDATE OR DELETE ON memberships
FOR EACH ROW EXECUTE FUNCTION update_group_member_count();
```

---

### 2.5 Memberships

```sql
CREATE TABLE memberships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL DEFAULT 'member'
                    CHECK (role IN ('super_admin','admin','moderator','member')),
    status      VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','banned')),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, group_id)             -- one membership per user per group
);

CREATE INDEX idx_memberships_group ON memberships (group_id, status);
CREATE INDEX idx_memberships_user ON memberships (user_id, status);
CREATE INDEX idx_memberships_role ON memberships (group_id, role);
```

---

### 2.6 Application Forms & Applications

```sql
-- The form definition configured by group admins
CREATE TABLE group_forms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
    fields      JSONB NOT NULL DEFAULT '[]',   -- see JSONB schema below
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- fields JSONB schema (array of field objects):
-- [
--   { "id": "uuid", "type": "text|textarea|select|checkbox|radio", "label": "Why do you want to join?",
--     "required": true, "options": ["Option A", "Option B"] }
-- ]

CREATE TABLE applications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id            UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected','withdrawn')),
    form_responses      JSONB DEFAULT '{}',    -- { "field_id": "user answer" }
    rejection_reason    TEXT,
    reviewed_by         UUID REFERENCES users(id),
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at         TIMESTAMPTZ,

    -- Prevent duplicate pending applications
    UNIQUE (user_id, group_id)
);

CREATE INDEX idx_applications_group_status ON applications (group_id, status);
CREATE INDEX idx_applications_user ON applications (user_id);
```

---

### 2.7 Invite Links

```sql
CREATE TABLE invite_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    token       VARCHAR(64) NOT NULL UNIQUE,    -- random hex, short enough to share
    created_by  UUID NOT NULL REFERENCES users(id),
    max_uses    INTEGER,                         -- NULL = unlimited
    use_count   INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,                     -- NULL = no expiry
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invite_token ON invite_links (token);
CREATE INDEX idx_invite_group ON invite_links (group_id);
```

---

### 2.8 Messages

```sql
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id),
    content         TEXT,
    message_type    VARCHAR(20) NOT NULL DEFAULT 'text'
                        CHECK (message_type IN ('text','image','file','poll','voice_note','system')),
    media_url       TEXT,
    media_mime_type VARCHAR(100),
    reply_to_id     UUID REFERENCES messages(id),
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,  -- soft delete for messages
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_group_created ON messages (group_id, created_at DESC) WHERE is_deleted = FALSE;
CREATE INDEX idx_messages_sender ON messages (sender_id);
CREATE INDEX idx_messages_pinned ON messages (group_id, is_pinned) WHERE is_pinned = TRUE;
```

---

### 2.9 Message Reactions

```sql
CREATE TABLE message_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(10) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON message_reactions (message_id);
```

---

### 2.10 Events

```sql
CREATE TABLE events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    location_name   VARCHAR(255),
    location_point  GEOMETRY(Point, 4326),
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ,
    rsvp_limit      INTEGER,                    -- NULL = unlimited
    rsvp_count      INTEGER NOT NULL DEFAULT 0, -- denormalized
    created_by      UUID NOT NULL REFERENCES users(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','cancelled','completed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_group_starts ON events (group_id, starts_at);
CREATE INDEX idx_events_location ON events USING GIST (location_point);

CREATE TABLE event_rsvps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'going'
                    CHECK (status IN ('going','maybe','not_going')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (event_id, user_id)
);
```

---

### 2.11 Direct Messages

```sql
CREATE TABLE direct_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT,
    media_url       TEXT,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted_by_sender    BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted_by_receiver  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fetching conversation thread between two users
CREATE INDEX idx_dm_conversation ON direct_messages (
    LEAST(sender_id, receiver_id),
    GREATEST(sender_id, receiver_id),
    created_at DESC
);

CREATE INDEX idx_dm_receiver_unread ON direct_messages (receiver_id, is_read) WHERE is_read = FALSE;
```

---

### 2.12 Notifications

```sql
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL
                        CHECK (type IN (
                            'message','application_submitted','application_approved','application_rejected',
                            'member_joined','event_created','group_announcement','dm_received',
                            'invite_received','membership_updated','system'
                        )),
    title           VARCHAR(200) NOT NULL,
    body            TEXT,
    reference_type  VARCHAR(30),               -- 'group' | 'application' | 'event' | 'message' | 'dm'
    reference_id    UUID,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread ON notifications (user_id, is_read, created_at DESC);

CREATE TABLE notification_preferences (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id                UUID REFERENCES groups(id) ON DELETE CASCADE,   -- NULL = global preference
    pref_type               VARCHAR(50) NOT NULL,  -- matches notification type
    push_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    in_app_enabled          BOOLEAN NOT NULL DEFAULT TRUE,

    UNIQUE (user_id, group_id, pref_type)
);
```

---

### 2.13 Blocks & Reports

```sql
CREATE TABLE user_blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)
);

CREATE INDEX idx_blocks_blocker ON user_blocks (blocker_id);
CREATE INDEX idx_blocks_blocked ON user_blocks (blocked_id);

CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID NOT NULL REFERENCES users(id),
    target_type     VARCHAR(20) NOT NULL CHECK (target_type IN ('user','group','message')),
    target_id       UUID NOT NULL,
    reason          VARCHAR(80) NOT NULL,
    description     TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','reviewing','resolved','dismissed')),
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_status ON reports (status, created_at);
CREATE INDEX idx_reports_target ON reports (target_type, target_id);
```

---

### 2.14 Audit Log

```sql
CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    action      VARCHAR(80) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   UUID,
    status      SMALLINT NOT NULL DEFAULT 1,   -- 1 = success, 0 = failure
    description TEXT,
    ip_address  INET,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_action ON audit_logs (action);
```

---

## 3. Redis Key Conventions

| Purpose | Key Pattern | TTL |
|---|---|---|
| Verification OTP (email verify) | `verify:email:{email}` | 10 min |
| Verification OTP (forgot password) | `verify:forgot:{email}` | 10 min |
| Failed login counter | `login:failed:{userId}` | 15 min |
| Online presence | `presence:{userId}` | 90 sec (heartbeat) |
| Socket room members | `room:group:{groupId}` | — (managed by Socket.io adapter) |
| Rate limit counters | `rl:{ip}:{route}` | varies |
| KYC webhook idempotency | `kyc:event:{eventId}` | 24 hr |
| Invite link cache | `invite:{token}` | 5 min |

---

## 4. API Endpoints

> **Base path**: `/api/v1`  
> **Auth**: Bearer token (JWT) in `Authorization` header.  
> All mutating endpoints require `id_verification_status = 'verified'` unless marked `[unverified-ok]`.  
> Admin routes require `role IN ('super_admin', 'admin')` in the target group's membership.

---

### 4.1 Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create account with email + password |
| POST | `/auth/login` | — | Login, returns access + refresh tokens |
| POST | `/auth/social` | — | OAuth login/register (Google, Apple) |
| POST | `/auth/logout` | ✓ | Revoke refresh token + session |
| POST | `/auth/refresh` | — | Exchange refresh token for new token pair |
| POST | `/auth/forgot-password` | — | Send OTP to email |
| POST | `/auth/reset-password` | — | Confirm OTP + set new password |
| POST | `/auth/change-password` | ✓ | Change password (requires old password) |
| POST | `/auth/verify-email` | — | Verify email with OTP code |
| POST | `/auth/resend-verification` | — | Resend email verification OTP |
| POST | `/auth/verify-id` | ✓ `[unverified-ok]` | Submit ID document for KYC review |
| POST | `/auth/kyc-webhook` | internal | Webhook from KYC provider (signed) |

**POST `/auth/register`**
```
Body: { email, password, display_name, phone? }
Returns: { user: { id, email, display_name }, tokens: { accessToken, refreshToken, expiresIn } }
Side effects: Send email verification OTP via BullMQ
```

**POST `/auth/login`**
```
Body: { email, password }
Returns: { user, tokens }
Rules:
  - email.toLowerCase() before lookup
  - Increment failed login counter on wrong password (Redis)
  - Lock account for 15 min after 5 consecutive failures
  - Update user.last_login_at
  - Save session to sessions table
```

**POST `/auth/social`**
```
Body: { provider: 'google'|'apple', token, mode: 'login'|'register' }
Returns: { user, tokens, isNewUser: boolean }
Rules:
  - Verify token with provider SDK
  - If user exists via provider_id → login
  - If email exists but no provider link → link the provider to existing account
  - If new → create user + provider record
```

**POST `/auth/verify-id`**
```
Body: { document_type: 'nin'|'voters_card'|'passport'|'drivers_license', document_url }
Returns: { verification_status: 'pending' }
Rules:
  - Encrypt document_url before storing
  - Set id_verification_status = 'pending'
  - Queue review job in BullMQ (manual: email admin; automated: call KYC provider API)
```

---

### 4.2 Users

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | ✓ | Get own full profile |
| PATCH | `/users/me` | ✓ | Update profile fields |
| DELETE | `/users/me` | ✓ | Soft-delete own account (GDPR) |
| GET | `/users/me/groups` | ✓ | List groups the user belongs to |
| GET | `/users/me/applications` | ✓ | List own applications |
| GET | `/users/me/notifications` | ✓ | See alias — redirects to `/notifications` |
| POST | `/users/me/interests` | ✓ | Update interest tags array |
| GET | `/users/:id` | ✓ | Get public profile (strips phone, id_document, email) |
| POST | `/users/:id/block` | ✓ | Block a user |
| DELETE | `/users/:id/block` | ✓ | Unblock a user |

**GET `/users/me`**
```
Returns: { id, email, display_name, username, profile_photo_url, bio, city, state, country,
           interests, id_verification_status, status, created_at }
Note: phone, id_document_url never returned to anyone including self
```

**PATCH `/users/me`**
```
Body (all optional): { display_name, username, bio, city, state, country,
                       lat, lng, profile_photo_url, preferred_language }
Rules:
  - username: unique, lowercase, alphanumeric + underscore only, 3–50 chars
  - lat/lng: converted to PostGIS Point and stored in location column
```

**GET `/users/:id`**
```
Returns: { id, display_name, username, profile_photo_url, bio, city, interests, created_at }
Rules:
  - Never return email, phone, id_verification status to other users
  - Check user_blocks: if caller blocked target or target blocked caller → 404
```

---

### 4.3 Groups

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/groups` | ✓ verified | Create a new group |
| GET | `/groups` | optional | List/search groups (public, filterable) |
| GET | `/groups/:slug` | optional | Get group public profile |
| PATCH | `/groups/:id` | ✓ admin | Update group settings |
| DELETE | `/groups/:id` | ✓ super_admin | Soft-delete group |
| GET | `/groups/:id/members` | ✓ member | List group members |
| GET | `/groups/:id/stats` | ✓ admin | Group statistics (member count, applications, activity) |

**POST `/groups`**
```
Body: { name, category, subcategory?, description, city, state, country,
        lat?, lng?, membership_type, membership_fee?, membership_fee_currency?,
        membership_fee_frequency?, how_to_join_content?, rules?, cover_image_url?, logo_url? }
Returns: { group }
Rules:
  - Auto-generate slug from name: slugify(name) + collision suffix if needed
  - Creator is automatically added as super_admin in memberships table (inside transaction)
  - membership_type defaults to 'open'
  - is_discoverable = FALSE when membership_type = 'invite_only'
```

**GET `/groups`**
```
Query params:
  - q: string               (full-text search via fts_vector)
  - category: string
  - subcategory: string
  - city, state, country: string
  - lat, lng, radius_km: number  (PostGIS ST_DWithin filter)
  - membership_type: open|application|invite_only
  - min_members, max_members: integer
  - is_verified: boolean
  - sort: relevance|distance|newest|most_members  (default: relevance)
  - page, limit (default limit: 20, max: 50)
Returns: { data: Group[], pagination: { page, limit, total } }
Rules:
  - Exclude groups with status != 'active' or deleted_at IS NOT NULL
  - Exclude invite_only groups (is_discoverable = FALSE) unless caller is a member
  - Distance sort requires lat+lng
  - Relevance sort: full-text rank + recency weighted score
```

**GET `/groups/:slug`**
```
Returns: public group profile including:
  { id, name, slug, category, subcategory, description, cover_image_url, logo_url,
    city, state, country, membership_type, membership_fee, how_to_join_content, rules,
    is_verified, member_count, founding_date, created_at,
    caller_membership_status? (if authenticated) }
Rules:
  - If invite_only and caller is not a member → 404
```

**GET `/groups/:id/members`**
```
Query: page, limit, role?, search?
Returns: { data: [{ user_id, display_name, username, profile_photo_url, role, status, joined_at }] }
Rules:
  - Caller must be an active member
  - phone and email are never included
```

---

### 4.4 Membership & Onboarding

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/groups/:id/join` | ✓ verified | Join an open group instantly |
| POST | `/groups/:id/apply` | ✓ verified | Submit application (application-based) |
| DELETE | `/groups/:id/leave` | ✓ member | Leave a group |
| GET | `/groups/:id/applications` | ✓ admin | List applications (filterable by status) |
| PATCH | `/applications/:id` | ✓ admin | Approve or reject application |
| DELETE | `/applications/:id` | ✓ owner | Withdraw own pending application |
| GET | `/groups/:id/form` | optional | Get application form schema |
| PUT | `/groups/:id/form` | ✓ admin | Create or replace application form |
| PATCH | `/groups/:id/members/:userId` | ✓ admin | Update member role/status (promote, suspend, ban) |
| DELETE | `/groups/:id/members/:userId` | ✓ admin | Remove member |
| POST | `/groups/:id/invite` | ✓ admin | Generate invite link |
| GET | `/groups/:id/invites` | ✓ admin | List active invite links |
| DELETE | `/invites/:id` | ✓ admin | Revoke invite link |
| POST | `/invites/:token/accept` | ✓ verified | Join group via invite link |

**POST `/groups/:id/join`**
```
Rules:
  - Group membership_type must be 'open'
  - Caller must not already be a member or banned
  - Caller must be verified (id_verification_status = 'verified')
  - Insert into memberships (role: 'member', status: 'active')
  - Trigger increments member_count
  - Notify group admins: 'member_joined'
  - Add caller to Socket.io room `group:{id}`
```

**POST `/groups/:id/apply`**
```
Body: { form_responses: { [field_id]: value } }
Rules:
  - Group membership_type must be 'application'
  - No duplicate pending application (unique constraint on user_id + group_id)
  - Validate form_responses against group_forms.fields if form exists
  - Set status = 'pending'
  - Notify group admins: 'application_submitted'
```

**PATCH `/applications/:id`**
```
Body: { action: 'approve'|'reject', rejection_reason?: string }
Rules:
  - Caller must be admin or super_admin of the group
  - If approve: create membership record (role: 'member', status: 'active'); notify applicant
  - If reject: set status = 'rejected'; include rejection_reason in notification
  - Set reviewed_by = caller.id, reviewed_at = NOW()
  - Cannot action an application that is not 'pending'
```

**PATCH `/groups/:id/members/:userId`**
```
Body: { role?: ..., status?: 'active'|'suspended'|'banned' }
Rules:
  - Cannot demote/suspend the group's super_admin
  - Admin cannot modify another admin (only super_admin can)
  - Banning a user sets status = 'banned' and prevents future applications/joins
  - Notify affected user of membership update
```

**POST `/groups/:id/invite`**
```
Body: { max_uses?: number, expires_in_hours?: number }
Returns: { token, invite_url: 'https://groupsync.app/invite/{token}', expires_at }
Rules:
  - Generate crypto-random 32-char hex token
  - Store in invite_links table
  - Cache token → group_id mapping in Redis (5 min TTL for fast validation)
```

**POST `/invites/:token/accept`**
```
Rules:
  - Lookup token in Redis cache, fallback to DB
  - Check: not revoked, not expired, use_count < max_uses (if set)
  - User must not already be a member or banned
  - Increment use_count, create membership record
```

---

### 4.5 Messages (REST + WebSocket)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/groups/:id/messages` | ✓ member | Paginated chat history (cursor-based) |
| POST | `/groups/:id/messages` | ✓ member | Send message (REST fallback) |
| DELETE | `/messages/:id` | ✓ sender or admin | Soft-delete message |
| PATCH | `/messages/:id/pin` | ✓ admin | Pin or unpin message |
| POST | `/messages/:id/react` | ✓ member | Add emoji reaction |
| DELETE | `/messages/:id/react` | ✓ member | Remove own reaction |
| GET | `/groups/:id/messages/pinned` | ✓ member | Get pinned messages |

**GET `/groups/:id/messages`**
```
Query: cursor? (message UUID), limit (default 50, max 100), direction: before|after
Returns: { data: Message[], next_cursor?, prev_cursor? }
Rules:
  - Cursor-based pagination (not offset) for performance with large chat history
  - Query: WHERE group_id = ? AND created_at < (cursor.created_at) ORDER BY created_at DESC LIMIT ?
  - Caller must be active member (not suspended/banned)
  - Exclude is_deleted = TRUE messages (return as { id, is_deleted: true, content: null })
```

#### WebSocket Events (Socket.io)

**Namespace**: `/chat`  
**Authentication**: JWT passed in `socket.handshake.auth.token`

| Event | Direction | Payload | Description |
|---|---|---|---|
| `join_group` | client→server | `{ group_id }` | Join Socket.io room for group |
| `leave_group` | client→server | `{ group_id }` | Leave Socket.io room |
| `send_message` | client→server | `{ group_id, content, message_type, reply_to_id? }` | Send chat message |
| `new_message` | server→client | `{ message }` | Broadcast new message to room |
| `message_deleted` | server→client | `{ message_id, group_id }` | Broadcast soft-delete |
| `message_pinned` | server→client | `{ message_id, group_id, is_pinned }` | Broadcast pin change |
| `reaction_added` | server→client | `{ message_id, emoji, user_id }` | Broadcast reaction |
| `reaction_removed` | server→client | `{ message_id, emoji, user_id }` | Broadcast reaction removal |
| `user_typing` | client→server | `{ group_id }` | Typing indicator |
| `typing` | server→client | `{ group_id, user_id, display_name }` | Broadcast typing indicator |
| `heartbeat` | client→server | — | Keep presence alive (every 60s) |
| `presence_update` | server→client | `{ user_id, status: 'online'|'offline' }` | Presence broadcast |

**Server-side WebSocket rules:**
- Verify JWT on connection; disconnect if invalid.
- On `join_group`: verify caller is active member of group before adding to room.
- Persist message to DB first, then emit `new_message` to room.
- Update `presence:{userId}` Redis key on `heartbeat`; expire after 90s.
- Rate-limit messages per user per group: max 10 messages per 10 seconds.

---

### 4.6 Events

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/groups/:id/events` | ✓ admin | Create event |
| GET | `/groups/:id/events` | ✓ member (public preview: non-member) | List events. `?visibility=public\|private` |
| GET | `/events/near` | ✓ | Discover public events near a point (cross-group) |
| GET | `/events/:id` | ✓ member | Get event details |
| PATCH | `/events/:id` | ✓ admin | Update event |
| DELETE | `/events/:id` | ✓ admin | Cancel/delete event |
| POST | `/events/:id/rsvp` | ✓ member | RSVP to event |
| PATCH | `/events/:id/rsvp` | ✓ member | Update RSVP status |
| DELETE | `/events/:id/rsvp` | ✓ member | Cancel RSVP |
| GET | `/events/:id/rsvps` | ✓ admin | List RSVPs |

**POST `/groups/:id/events`**
```
Body: { title, description?, location_name?, lat?, lng?, starts_at, ends_at?, rsvp_limit?,
        visibility? }
Rules:
  - starts_at must be in the future
  - visibility: 'public' | 'private', defaults to 'private'
  - Notify all group members: 'event_created' (queued via BullMQ)
```

**GET `/events/near`**
```
Query params:
  - lat, lng: number        (required)
  - radius_km: number       (default 50, max 500)
  - category: string        (matches the group's category)
  - sort: distance|soonest  (default: distance)
  - page, limit (default limit: 20, max: 50)
Returns: { data: NearbyEvent[], pagination: { page, limit, total } }
  NearbyEvent = event fields + distanceKm + groupName, groupSlug, groupLogoUrl,
                groupCategory  (inlined so a card renders without a second call)
Rules:
  - Not scoped to the caller's memberships — this is the discovery surface for
    accounts with no groups yet. Every other event read is group-scoped.
  - visibility = 'public' only
  - starts_at >= NOW() and status != 'cancelled'
  - location_point IS NOT NULL (events with no location cannot be "near" anything)
  - Group must be active, not deleted, and is_discoverable = TRUE — otherwise an
    invite-only group's existence would leak through its events. Members still see
    their own groups' public events here.
```

**Event visibility**
```
private (default) — active group members only
public            — also visible to non-members in the group's event preview

GET /groups/:id/events?visibility=public|private
  - Members may filter freely across both.
  - Non-members are always constrained to public. Asking for private returns an
    empty list rather than public results.
GET /events/:id
  - Private event + non-member -> 404 (not 403, so existence isn't probeable).
Only group admins can set visibility, via POST/PATCH.
```

**POST `/events/:id/rsvp`**
```
Body: { status: 'going'|'maybe'|'not_going' }
Rules:
  - Upsert on (event_id, user_id) unique constraint
  - If rsvp_limit set and status = 'going': check rsvp_count < rsvp_limit
  - Update event.rsvp_count accordingly (trigger or application-level)
```

---

### 4.7 Direct Messages

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/dm` | ✓ | List DM conversations (last message per user) |
| GET | `/dm/:userId` | ✓ | Get message thread with user (paginated, cursor-based) |
| POST | `/dm/:userId` | ✓ verified | Send a DM |
| PATCH | `/dm/:userId/read` | ✓ | Mark thread as read |

**POST `/dm/:userId`**
```
Body: { content, media_url? }
Rules:
  - Caller and receiver must share at least one active group (SELECT 1 FROM memberships m1
    JOIN memberships m2 ON m1.group_id = m2.group_id
    WHERE m1.user_id = :caller AND m2.user_id = :receiver AND m1.status='active' AND m2.status='active')
  - Check user_blocks: neither direction blocked
  - Persist to direct_messages
  - Emit via WebSocket: 'dm_received' event to receiver's personal room
  - Queue notification (BullMQ): 'dm_received'
```

**WebSocket DM events:**

| Event | Direction | Payload |
|---|---|---|
| `dm_send` | client→server | `{ receiver_id, content }` |
| `dm_received` | server→client | `{ message }` |
| `dm_read` | server→client | `{ sender_id }` |

---

### 4.8 Notifications

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | ✓ | List notifications (paginated, cursor-based) |
| PATCH | `/notifications/:id/read` | ✓ | Mark single notification as read |
| PATCH | `/notifications/read-all` | ✓ | Mark all as read |
| DELETE | `/notifications/:id` | ✓ | Delete notification |
| GET | `/notifications/preferences` | ✓ | Get notification preferences |
| PATCH | `/notifications/preferences` | ✓ | Update preferences |

**GET `/notifications`**
```
Query: cursor?, limit (default 20), unread_only?: boolean
Returns: { data: Notification[], unread_count: number, next_cursor? }
```

**PATCH `/notifications/preferences`**
```
Body: { preferences: [{ group_id?: UUID, pref_type: string, push_enabled: boolean, in_app_enabled: boolean }] }
Rules:
  - Upsert on (user_id, group_id, pref_type)
  - group_id = NULL sets the global default for that pref_type
```

---

### 4.9 Announcements

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/groups/:id/announce` | ✓ admin | Post an announcement to all members |
| GET | `/groups/:id/announcements` | ✓ member | List group announcements |

**POST `/groups/:id/announce`**
```
Body: { title, content }
Rules:
  - Create a 'system' type message in the group's chat
  - Queue BullMQ job: notify all active members with type 'group_announcement'
  - Also push via FCM to members with push_enabled = TRUE
```

---

### 4.10 Reports

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/reports` | ✓ | Submit a report |

**POST `/reports`**
```
Body: { target_type: 'user'|'group'|'message', target_id: UUID, reason: string, description? }
Reason values: 'spam'|'harassment'|'hate_speech'|'fake_profile'|'inappropriate_content'|'other'
Rules:
  - Rate-limit: max 5 reports per user per 24 hours
  - Notify platform admin queue (BullMQ job)
```

---

### 4.11 Platform Admin (Internal)

> Prefix: `/admin` — Requires platform-level admin role (separate from group admin role). Enforced via `authorize('platform.admin')` permission.

| Method | Path | Description |
|---|---|---|
| GET | `/admin/users` | List all users with filters |
| PATCH | `/admin/users/:id` | Update user status (suspend/ban/unban) |
| GET | `/admin/users/:id/verification` | View submitted ID document |
| PATCH | `/admin/users/:id/verification` | Approve or reject ID verification |
| GET | `/admin/groups` | List all groups |
| PATCH | `/admin/groups/:id` | Verify group, suspend, restore |
| GET | `/admin/reports` | List open reports |
| PATCH | `/admin/reports/:id` | Resolve or dismiss report |
| GET | `/admin/audit-logs` | Query audit log |

---

## 5. Business Logic Rules

### 5.1 ID Verification

- Users with `id_verification_status != 'verified'` can: register, browse groups, view public profiles. They CANNOT: join/apply to groups, send messages, create groups, or send DMs.
- ID document URL is encrypted with AES-256 (key from env). After manual/automated verification decision, `id_document_url` and `id_document_iv` are set to NULL (document deleted from S3 as well — queued via BullMQ `storage.cleanup` job).
- KYC webhook endpoint (`POST /auth/kyc-webhook`) must verify provider signature (HMAC). Store event idempotency key in Redis (`kyc:event:{eventId}`, 24hr TTL) to prevent duplicate processing.

### 5.2 Membership Role Hierarchy

```
super_admin > admin > moderator > member
```
- `super_admin`: cannot be removed from their own group. Can do everything.
- `admin`: can approve/reject applications, manage members up to moderator level, post announcements, manage events, pin messages.
- `moderator`: can remove/suspend members, delete messages.
- `member`: can send messages, RSVP to events.
- Only one `super_admin` per group. Transferring ownership creates a new `super_admin` and demotes the old one.

### 5.3 Group Deletion

- Soft-delete only (`deleted_at = NOW()`, `status = 'deleted'`).
- All messages, events, applications are retained in DB but inaccessible via API.
- Notify all active members before deletion.

### 5.4 Leaving a Group

- `DELETE /groups/:id/leave` sets membership status to... actually removes the row.
- If the leaving user is the `super_admin`: block the request unless they transfer ownership first.
- Caller loses access to all group content immediately.
- Socket.io: remove from group room.

### 5.5 Invite-Only Groups

- `is_discoverable = FALSE` means the group does not appear in `GET /groups` for non-members.
- The group profile at `GET /groups/:slug` returns 404 for non-members.
- Members and admins can generate invite links via `POST /groups/:id/invite`.

### 5.6 DM Scoping

- DMs are only possible between users who share at least one active group membership.
- Check via SQL join on memberships at the time of sending. If the shared group is later left by either party, existing DMs remain readable but new DMs are blocked.

### 5.7 Slug Generation

```typescript
function generateSlug(name: string): string {
    return name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}
// On collision: append -2, -3, etc. (check DB before inserting)
```

### 5.8 Privacy Rules

- `phone` column: encrypted at rest, never returned by any API endpoint.
- `email`: only returned to the owning user (`GET /users/me`).
- `id_document_url`: never returned by any API endpoint. Internal admin use only.
- Messages: only accessible to current active members. Membership status check on every request.

---

## 6. Background Jobs (BullMQ)

### Queue: `system-jobs`

```typescript
type JobName =
    | 'send-email'
    | 'send-push-notification'
    | 'kyc-review-request'
    | 'kyc-document-cleanup'
    | 'storage-cleanup'
    | 'expire-invite-links'
    | 'notify-group-members'        // fan-out notifications to large groups
    | 'process-group-announcement'
```

| Job | Trigger | Repeat |
|---|---|---|
| `send-email` | Auth events, application updates | On-demand |
| `send-push-notification` | All notification types | On-demand |
| `kyc-review-request` | ID document submitted | On-demand |
| `kyc-document-cleanup` | Verification decision made | On-demand |
| `storage-cleanup` | File replaced/deleted | On-demand |
| `expire-invite-links` | Cron | Every hour |
| `notify-group-members` | Announcement, event created | On-demand (fan-out) |

---

## 7. Security Requirements

1. **Rate limiting** (via `express-rate-limit` on Redis store):
   - `/auth/*` endpoints: 10 requests / 15 minutes per IP
   - `/api/v1/*` general: 100 requests / minute per authenticated user
   - `/groups/:id/messages` POST: 10 messages / 10 seconds per user per group
   - `/reports` POST: 5 per user per 24 hours (Redis counter)

2. **JWT configuration**:
   - Access token: 15 minutes (`JWT_EXPIRES_IN=15m`)
   - Refresh token: 30 days (opaque, stored in DB)
   - Special-purpose tokens (invite JWTs, password reset): 24 hours, `claim` field in payload

3. **AES-256 encryption** for: `phone`, `id_document_url`. Use separate IV per record.

4. **Helmet** for HTTP security headers.

5. **CORS**: configured per environment; restrict to known client origins.

6. **SQL injection**: Prisma parameterized queries only. Never interpolate user input into raw SQL.

7. **File uploads**: Validate MIME type and file size (max 10MB images, 50MB files). Upload to S3 via BullMQ job, not synchronously in request handler.

8. **WebSocket authentication**: JWT verified on connection handshake. Disconnect on token expiry.

---

## 8. Email Templates Required

| Template | Trigger |
|---|---|
| `verify_email.html` | Registration — OTP code |
| `forgot_password.html` | Password reset — OTP code |
| `welcome.html` | First login after verification |
| `kyc_submitted.html` | ID submitted for review |
| `kyc_approved.html` | ID verification approved |
| `kyc_rejected.html` | ID verification rejected |
| `application_approved.html` | Group application approved |
| `application_rejected.html` | Group application rejected |
| `invite.html` | Invited to join a group |
| `announcement.html` | Group announcement |

All templates use `{{data.fieldName}}` interpolation and reside in `templates/emails/`.

---

## 9. Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development
API_PREFIX=/api/v1

# Database
DATABASE_URL=postgresql://user:pass@host:5432/groupsync

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# Encryption (AES-256)
ENCRYPTION_KEY=          # 32-byte hex key
ENCRYPTION_ALGORITHM=aes-256-cbc

# S3 / R2
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
S3_BUCKET_NAME=

# Email (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=

# KYC Provider
KYC_PROVIDER_API_KEY=
KYC_WEBHOOK_SECRET=      # for HMAC verification

# Firebase (Push Notifications)
FCM_SERVER_KEY=

# Frontend
CORS_ORIGIN=http://localhost:3000,https://groupsync.app
CLIENT_URL=https://groupsync.app

# Feature flags
ENABLE_AUTO_KYC=false    # false = manual review, true = KYC provider API
```

---

## 10. Startup Sequence

1. `process.on('uncaughtException')` and `unhandledRejection` handlers registered.
2. `Database.getInstance().connect()` — PostgreSQL via `pg` Pool.
3. `InitialSeeder.seed()` — idempotent creation of platform roles, default permissions.
4. `EmailService.initialize()` — SMTP transporter.
5. `AgendaManager.start()` — BullMQ queue + worker + cron jobs.
6. `SocketService.attach(httpServer)` — Socket.io server initialization.
7. `app.listen(PORT)`.
