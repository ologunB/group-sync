# agent.md — GroupSync Backend Agent

> Load this file at the start of every development session. It is the complete context for building the GroupSync backend. It defines the project, the coding rules, the tech stack, and how every piece of code must be written.

---

## 0. What This Project Is

**GroupSync** is a location-based social platform for discovering, joining, and managing real-world communities (clubs, sports teams, book clubs, faith groups, etc.). The atomic unit is the **Group**, not the individual. Think "Yellow Pages for social clubs" with a built-in private communication layer that replaces WhatsApp.

**Current build target**: v1.0 MVP  
**Launch markets**: Nigeria (Ibadan, Lagos, Abuja first)  
**Backend repo**: Node.js + Express + TypeScript

---

## 1. Tech Stack (Non-Negotiable)

| Layer | Technology |
|---|---|
| Runtime | Node.js (LTS) |
| Language | TypeScript — strict mode |
| Framework | Express 4.x |
| ORM | Prisma 7.x with `@prisma/adapter-pg` |
| Database | PostgreSQL + PostGIS extension |
| Cache | Redis (ioredis) |
| Job Queue | BullMQ — single queue named `system-jobs` |
| Real-time | Socket.io |
| File Storage | Cloudinary (active) — swappable to S3/R2 via `STORAGE_PROVIDER` env var |
| Auth | JWT access token (15m) + opaque refresh token (30d, stored in DB) |
| Email | Nodemailer + HTML templates |
| Push | Firebase Cloud Messaging (FCM) |
| KYC | Smile Identity / Dojah / Prembly (Nigerian market) |
| Validation | `express-validator` |
| Password | `bcrypt` (10 salt rounds) |
| Logging | `asLogger` (custom Winston wrapper) |
| Process manager | PM2 |
| CI/CD | GitHub Actions → SSH → DigitalOcean droplet |

---

## 2. Folder Structure (Mandatory)

```
src/
├── agenda.ts                   # AgendaManager static class (BullMQ)
├── app.ts                      # App class
├── server.ts                   # Entry point
├── socket.ts                   # Socket.io setup
├── database/
│   ├── connection.ts           # Database singleton (Prisma + pg Pool)
│   └── seeders/
│       └── initial.seeder.ts
├── features/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.routes.ts
│   │   ├── auth.service.ts
│   │   ├── auth.types.ts
│   │   └── auth.validator.ts
│   ├── users/
│   │   ├── user.controller.ts
│   │   ├── user.routes.ts
│   │   ├── user.service.ts
│   │   ├── user.types.ts
│   │   └── user.validator.ts
│   ├── groups/
│   │   ├── group.controller.ts
│   │   ├── group.routes.ts
│   │   ├── group.service.ts
│   │   ├── group.types.ts
│   │   └── group.validator.ts
│   ├── memberships/
│   │   ├── membership.controller.ts
│   │   ├── membership.routes.ts
│   │   ├── membership.service.ts
│   │   ├── membership.types.ts
│   │   └── membership.validator.ts
│   ├── messages/
│   │   ├── message.controller.ts
│   │   ├── message.routes.ts
│   │   ├── message.service.ts
│   │   ├── message.types.ts
│   │   └── message.validator.ts
│   ├── events/
│   │   └── ...same pattern
│   ├── dm/
│   │   └── ...same pattern
│   └── notifications/
│       └── ...same pattern
└── shared/
    ├── config/app.config.ts
    ├── constants/
    │   ├── permissions.constants.ts
    │   └── response.constants.ts
    ├── middleware/
    │   ├── auth.middleware.ts
    │   ├── error.middleware.ts
    │   ├── file.middleware.ts
    │   └── security.middleware.ts
    ├── queues/
    │   ├── mail.service.ts
    │   └── push.service.ts
    ├── storage/
    │   ├── storage.types.ts       # StorageProvider interface + UploadOptions / UploadResult
    │   ├── cloudinary.provider.ts # Cloudinary implementation
    │   └── storage.service.ts     # factory singleton — reads STORAGE_PROVIDER env var
    ├── socket/
    │   ├── socket.service.ts
    │   └── socket.events.ts
    ├── types/
    │   ├── common.types.ts
    │   └── response.types.ts
    └── utils/
        ├── asLogger.ts
        ├── encryption.ts
        ├── response.helper.ts
        ├── slug.ts
        └── validators.ts

prisma/
└── schemas/
    ├── schema.prisma           # datasource + generator
    ├── auth.prisma             # RefreshToken, Session, AuditLog
    ├── user.prisma             # User, UserProvider, UserBlock, Report
    ├── group.prisma            # Group, Membership, Application, GroupForm, InviteLink
    ├── message.prisma          # Message, MessageReaction, DirectMessage
    ├── event.prisma            # Event, EventRsvp
    └── notification.prisma     # Notification, NotificationPreference

templates/
└── emails/                     # HTML templates with {{data.field}} interpolation
```

---

## 3. App Bootstrap Rules

### `server.ts`
- Register `process.on('uncaughtException')` and `process.on('unhandledRejection')` first.
- Both handlers call `await AgendaManager.stop()` before `process.exit(1)`.
- Call `app.start()` — that's it.

### `app.ts` — `App` class
- Constructor calls: `configureMiddleware()` → `configureRoutes()` → `configureErrorHandling()` (always in this order).
- `start()` is the only `async` method. Order inside it:
  1. `Database.getInstance().connect()`
  2. `InitialSeeder.seed()`
  3. `EmailService.initialize()`
  4. `AgendaManager.start()`
  5. `SocketService.attach(httpServer)`
  6. `app.listen(PORT)`
- `configureMiddleware()`: `trust proxy 1` → `json({limit:'10mb'})` → `urlencoded` → `cookieParser` → `compression` → `securityMiddleware(app)`.
- `configureRoutes()`: mount a `/api/v1/health` check first. Then mount feature routers under `/api/v1` AND `/api/v1/admin`.
- `configureErrorHandling()`: `errorMiddleware` first, then the 404 catch-all last.

---

## 4. Prisma & SQL Conventions

### Schema file layout
- Split schemas into domain files inside `prisma/schemas/`.
- Each domain file is self-contained.

### Model rules (PostgreSQL-native)
- Primary keys: `String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`
- Timestamps: `createdAt DateTime @default(now()) @db.Timestamptz` and `updatedAt DateTime @updatedAt @db.Timestamptz` on every model.
- Soft delete: `deletedAt DateTime? @db.Timestamptz` on User and Group.
- Status fields: `String` with string literals — never Prisma `enum`. Use `@db.VarChar(20)` and enforce at DB level via `CHECK` constraint in raw migration SQL.
- Location fields: `Unsupported("geometry(Point, 4326)")` in Prisma — raw SQL for PostGIS queries.
- `JSONB` columns: `Json` type in Prisma (e.g. `formResponses Json @default("[]")`).
- Array columns: `String[]` with `@db.Text` (e.g. `interests String[] @default("{}")`).
- Foreign keys: always `onDelete: Cascade` on user-owned data. Explicit for each.
- `@@unique([fieldA, fieldB])` for business uniqueness constraints (membership: user + group; reaction: message + user + emoji).
- `@@index([...])` for every filtered/sorted column combination.
- Composite indexes: name them explicitly using `@@index([...], map: "idx_name")`.
- `member_count` on Group: denormalized integer, maintained via PostgreSQL trigger (see backend-srs.md).

### PostGIS queries
- Use `prisma.$queryRawUnsafe()` or `prisma.$queryRaw` with `Prisma.sql` tagged template for any ST_ function calls.
- Example distance filter:
  ```typescript
  const groups = await prisma.$queryRaw<Group[]>`
      SELECT * FROM groups
      WHERE ST_DWithin(location::geography, ST_MakePoint(${lng}, ${lat})::geography, ${radiusMeters})
      AND status = 'active' AND deleted_at IS NULL
      ORDER BY ST_Distance(location::geography, ST_MakePoint(${lng}, ${lat})::geography)
      LIMIT ${limit}
  `;
  ```
- Never interpolate user-provided values directly — always use tagged templates or `$queryRaw`.

### Full-text search
- Use `fts_vector TSVECTOR GENERATED ALWAYS AS (...) STORED` columns on `users` and `groups`.
- Query with `to_tsquery` or `plainto_tsquery` via raw Prisma query.
- Index with `USING GIN`.

---

## 5. Feature Module Rules (Per Feature)

Every feature = 5 files: **controller, routes, service, types, validator**.

### `*.types.ts`
- DTO interfaces for request bodies (plain interfaces, not classes).
- Extend `Request` as `AuthenticatedRequest` with `user?: TokenPayload`.
- Export named Prisma select objects typed with `satisfies Prisma.XxxSelect`.
- Export result types with `Prisma.XxxGetPayload<{ select: typeof xxxSelect }>`.

### `*.service.ts`
- Class with `public async` methods only.
- Every method: wrapped in `try/catch`.
- Catch block order (always):
  1. `AuditLogger.log(req.user, action, entity, id, 0, { error })` — log failure first.
  2. `if (error instanceof ApiError) throw error;` — re-throw typed errors.
  3. `asLogger.error('Context:', error);` — log unexpected.
  4. `throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);`
- Success path: `AuditLogger.log(...)` before returning.
- Always `email.toLowerCase()` before DB lookups.
- Multi-step writes: use `prisma.$transaction(async (tx) => { ... })`.
- Parallel reads: `Promise.all([...])` — never sequential awaits for independent queries.
- Emails/notifications: always via `AgendaManager.sendEmail(...)` or `eventBus.emit(...)` — never inline.
- Delete sensitive fields from objects before returning: `delete obj.password; delete obj.phone; delete obj.idDocumentUrl;`

### `*.controller.ts`
- Thin only — call service method, call `ResponseHelper.success()` or `next(error)`.
- Zero business logic.
- Methods are arrow functions assigned to properties (preserves `this`).
- Signature: `async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void>`.
- Success: `ResponseHelper.success(res, data, message, statusCode)`.
- Error: `next(error)` — never `ResponseHelper.error()` directly.

### `*.routes.ts`
- One `Router()` per feature file.
- Route path: lowercase, hyphen-separated (`/forgot-password` not `/forgotPassword`).
- Middleware order per route: `authenticate` → `authorize('permission')` → `validateRequest(validators)` → `controller.method`.
- Export as `default`.

### `*.validator.ts`
- Export named `ValidationChain[]` arrays or factory functions returning `ValidationChain[]`.
- Chain: `.exists().withMessage('X is required')` before any type check.
- Dates: always `.isISO8601()`.
- Optional fields: `.optional()` or `.optional({ nullable: true, checkFalsy: true })`.
- Enum fields: `.isIn(ARRAY).withMessage(...)`.
- Nested body: `body('details.field')` dot notation.
- Factory functions for polymorphic validation: `const createPostValidator = (type: string): ValidationChain[] => { ... }`.

---

## 6. Shared Utilities (Do Not Deviate)

### `ResponseHelper`
```typescript
// All API responses MUST use these methods:
ResponseHelper.success(res, data, message, statusCode)
ResponseHelper.error(res, message, statusCode, error)

// Response shape is always:
{ success: boolean, message: string, data?: T, error?: any }
```

### `ApiError`
```typescript
// Throw this for all domain errors:
throw new ApiError('User not found', StatusCodes.NOT_FOUND);
throw new ApiError('Validation failed', StatusCodes.BAD_REQUEST, detailsArray);

// Catch by instance in catch blocks:
if (error instanceof ApiError) throw error;

// Use StatusCodes from 'http-status-codes' for all status codes — never raw numbers.
```

### `EncryptionUtil`
```typescript
// Use these — never import bcrypt/jwt/crypto directly in service files:
EncryptionUtil.hashPassword(password)
EncryptionUtil.comparePassword(password, hash)
EncryptionUtil.generatePassword(length?)
EncryptionUtil.generateRandomToken(length?)   // crypto.randomBytes hex
EncryptionUtil.generateJWT(payload, expiresInSeconds)
EncryptionUtil.verifyJWT(token)
EncryptionUtil.generateTokens(payload, ipAddress)  // returns { accessToken, refreshToken, expiresIn }
EncryptionUtil.encryptField(text)     // AES-256, returns { ciphertext, iv }
EncryptionUtil.decryptField(ciphertext, iv)
```

### `Messages` (response.constants.ts)
```typescript
// Never hardcode error strings in services:
Messages.SERVER_ERROR
Messages.RESOURCE_NOT_FOUND('User')
Messages.TOKEN_EXPIRED
Messages.TOKEN_MALFORMED
Messages.INCORRECT_OLD_PASSWORD
Messages.INVALID_VERIFICATION_CODE
Messages.UNAUTHORIZED
Messages.FORBIDDEN
```

### `asLogger`
```typescript
// Use this everywhere — never console.log() in service/controller/middleware code:
asLogger.info('...')
asLogger.error('Context:', error)
asLogger.warn('...')
// console.error() is acceptable ONLY in process-level handlers in server.ts
```

### `validateRequest` (validators.ts)
```typescript
// Wraps ValidationChain[] into Express middleware:
router.post('/path', validateRequest(myValidators), controller.method);
// Internally: runs all chains in parallel, collects errors, throws ApiError on failure.
```

---

## 7. Authentication System

### Token payload (JWT)
```typescript
interface TokenPayload {
    userId: string;
    role: string;          // membership role in a group context, or 'user' / 'platform_admin'
    sessionId: string;
    permissions: string[];
    orgId?: string;        // not used in GroupSync — reserved for future
}
```

### Auth middleware
```typescript
// authenticate: verifies JWT, sets req.user
// authorize(...permissions): checks req.user.permissions, throws 403 if missing
// authenticateVerified: authenticate + checks id_verification_status = 'verified'
// authorizeGroupRole(...roles): checks caller's role in the specific group (from memberships table)
```

### JWT error handling (always in catch blocks)
```typescript
if (error.name === 'JsonWebTokenError') return next(new ApiError(Messages.TOKEN_MALFORMED, StatusCodes.UNAUTHORIZED));
if (error.name === 'TokenExpiredError') return next(new ApiError(Messages.TOKEN_EXPIRED, StatusCodes.UNAUTHORIZED));
```

### Redis keys for auth
```
verify:email:{email}        → OTP for email verification         (TTL: 10 min)
verify:forgot:{email}       → OTP for password reset             (TTL: 10 min)
login:failed:{userId}       → failed login counter               (TTL: 15 min, lock after 5)
presence:{userId}           → online status heartbeat            (TTL: 90 sec)
invite:{token}              → invite link group_id cache         (TTL: 5 min)
kyc:event:{eventId}         → KYC webhook idempotency key        (TTL: 24 hr)
rl:{ip}:{routeKey}          → rate limit counter                 (varies)
```

---

## 8. BullMQ Job System

### `AgendaManager` — static class
```typescript
type JobName =
    | 'send-email'
    | 'send-push-notification'
    | 'kyc-review-request'
    | 'kyc-document-cleanup'
    | 'storage-cleanup'
    | 'expire-invite-links'
    | 'event-reminders'
    | 'notify-group-members'          // legacy drain only — see §19, nothing enqueues it
    | 'process-group-announcement';

// Public API:
AgendaManager.start()           // idempotent
AgendaManager.stop()
AgendaManager.sendEmail(data)
AgendaManager.runNow(name, data)
AgendaManager.scheduleTask(time, name, data)  // supports 'now', 'in X minutes'
```

### Worker pattern
- Single `'system-jobs'` queue.
- Worker uses `switch (name as JobName)` with `default: asLogger.warn(...)`.
- `concurrency: 5`.
- Default job options: `{ attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true }`.
- Queue defaults: `{ removeOnComplete: true, removeOnFail: 20 }`.

### Cron jobs registered in `registerCronJobs()`
- `expire-invite-links`: every hour `'0 * * * *'`.
- `event-reminders`: every hour on the half hour `'30 * * * *'` — sweeps events starting in 23–25h and notifies RSVP holders. Offset from the invite job so they do not contend.
- (Add future crons here in the same format, each with a stable `jobId` to prevent duplicates.)

---

## 9. File Storage

### Provider pattern
`StorageService` is a singleton that delegates to the configured provider. To switch providers: set `STORAGE_PROVIDER=s3` (or any future key) in `.env` and implement a class that satisfies `StorageProvider`. No controller or service file changes.

```typescript
// Always use StorageService — never import cloudinary/S3 SDKs directly in feature code:
const result = await StorageService.upload(buffer, mimeType, {
    folder:         'groupsync/avatars',
    publicId:       userId,             // stable ID means re-upload overwrites cleanly
    transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto', fetch_format: 'auto' }],
});
// result: { url, publicId, format, bytes, width?, height? }

await StorageService.delete(publicId);  // pass publicId from the original upload result
```

### Upload middleware
```typescript
// src/shared/middleware/upload.middleware.ts
// Accepts JPEG, PNG, WebP — max 5 MB — stores in memory buffer:
uploadImage('fieldName')   // returns multer.single() middleware
```

### Upload endpoints (controller → service — no upload logic in controllers)
| Method | Path | Auth | Multer field | Service method |
|--------|------|------|--------------|----------------|
| POST | `/users/me/photo` | Bearer | `photo` | `UserService.uploadPhoto()` |
| POST | `/groups/:id/cover` | Bearer · admin+ | `cover` | `GroupService.uploadCover()` |
| POST | `/groups/:id/logo` | Bearer · admin+ | `logo` | `GroupService.uploadLogo()` |

Response: `{ success: true, data: { url: "https://..." } }`

### Cloudinary folder layout
```
groupsync/avatars/<userId>          ← profile photos (overwritten on re-upload)
groupsync/groups/<groupId>/cover    ← cover image
groupsync/groups/<groupId>/logo     ← logo
```

### Switching to S3
1. Add `S3Provider` implementing `StorageProvider` in `src/shared/storage/s3.provider.ts`.
2. Add a `case 's3':` branch in `storage.service.ts → buildProvider()`.
3. Set `STORAGE_PROVIDER=s3` in `.env`.

---

## 10. WebSocket (Socket.io)  <!-- was §9 -->

### Setup
- Attach to the same HTTP server as Express.
- Namespace: `/chat`.
- Authentication: JWT in `socket.handshake.auth.token` — verify on every connection.
- Disconnect immediately on invalid/expired JWT.

### Room naming conventions
```
group:{groupId}     → group chat room
user:{userId}       → personal room (DMs, personal notifications)
```

### Key rules
- Join `group:{groupId}` room only after verifying active membership in DB.
- Persist message to DB before emitting `new_message` to room.
- Rate-limit messages: 10 per user per group per 10 seconds (Redis counter).
- On `heartbeat`: update `presence:{userId}` Redis key with `setex(90)`.
- Emit presence updates to shared group rooms when user comes online/offline.

### Event reference
See `backend-srs.md § 4.5` for the complete event list with payloads.

---

## 10. Pagination

### Offset-based (for lists, admin views)
```typescript
const page = parseInt(req.query.page as string) || 1;
const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
const skip = (page - 1) * limit;
const [data, total] = await Promise.all([
    prisma.xxx.findMany({ where, skip, take: limit, orderBy }),
    prisma.xxx.count({ where }),
]);
return { data, pagination: { page, limit, total } };
```

### Cursor-based (for messages, DMs, notifications)
```typescript
// Query: WHERE created_at < cursor_created_at ORDER BY created_at DESC LIMIT limit
// Returns: { data, next_cursor: lastItem.id, has_more: boolean }
```
Use cursor pagination for any table that will have unbounded growth (messages, DMs, notifications).

---

## 11. Filtering & Search

```typescript
// Build where clause incrementally:
const where: Prisma.GroupWhereInput = { status: 'active', deletedAt: null };

// Text search via fts_vector (raw query):
if (q) {
    // Use prisma.$queryRaw with plainto_tsquery
}

// Exact filters:
if (category) where.category = category;

// Date range:
if (dateFrom) {
    const from = new Date(dateFrom); from.setUTCHours(0, 0, 0, 0);
    const to = dateTo ? new Date(dateTo) : new Date(); to.setUTCHours(23, 59, 59, 999);
    where.createdAt = { gte: from, lte: to };
}

// Sort default: newest first
const sort = (req.query.sort as string) === 'asc' ? 'asc' : 'desc';
```

---

## 12. Data Sanitization Rules

- **Always delete before returning**: `password`, `phone`, `phoneIv`, `idDocumentUrl`, `idDocumentIv`, `passwordHash`.
- `email` is returned only to the owning user (`GET /users/me`). Never in public user profiles.
- `id_verification_status` is returned to self only.
- Group `membership_type = 'invite_only'`: hide from discovery; return 404 for non-members on profile endpoint.
- DM content: only return to participants. Check `sender_id = caller OR receiver_id = caller`.
- Messages: only return to active members of the group. Check membership status on every request.

---

## 13. Audit Logging

```typescript
// Call on EVERY mutating operation — BOTH success and failure paths:
AuditLogger.log(
    req.user,           // TokenPayload | null
    LoggerEnums.action, // action string constant
    ResourceType.USER,  // entity type string
    entityId,           // UUID
    1,                  // 1 = success, 0 = failure
    { ...metadata }     // context object (mask sensitive IDs with .mask())
);
```

**Rule**: In catch blocks, log failure FIRST before re-throwing.

---

## 14. GroupSync-Specific Business Rules

> These are rules unique to this project. Always check here before implementing any feature.

1. **Verification ladder** (replaces the old blanket ID gate — see §26 for the full table). Capability is bought in three rungs: tier 1 (email + phone OTP) to join groups and RSVP, tier 2 (tier 1 + bio, then admin review of the group) to create a group, tier 3 (verified ID) to host an event at a physical address. `authenticateVerified` still exists for legacy routes and still has its ID check commented out — prefer `authenticateContactVerified` / `authenticateOrganiser` from `shared/middleware/verification.middleware.ts`.

2. **Role hierarchy**: `super_admin > admin > moderator > member`. An admin cannot modify another admin — only super_admin can. Super admin cannot be removed without ownership transfer.

3. **DM scope enforcement**: Before inserting a DM, run a SQL join to confirm both users share at least one active group. If not, throw `ApiError('You can only message people in your groups', 403)`.

4. **Invite-only visibility**: `is_discoverable = false` when `membership_type = 'invite_only'`. Filter out non-discoverable groups from `GET /groups` for non-members. Return 404 on `GET /groups/:slug` for non-members.

5. **Slug collision handling**: Before saving, check if slug exists. If collision: append `-2`, `-3`, etc. Do this in a loop (max 10 attempts) before throwing.

6. **member_count**: Maintained by PostgreSQL trigger on `memberships` table. Never update this manually in application code.

7. **Leaving as super_admin**: Block `DELETE /groups/:id/leave` if caller is the `super_admin` and there are other members. Must transfer ownership first via `PATCH /groups/:id/members/:userId` (promote target to super_admin, caller becomes admin).

8. **Application uniqueness**: One pending/approved application per user per group (DB unique constraint). If a rejected application exists, allow reapplication (delete old record or allow new insert — decide per product requirement).

9. **KYC webhook**: Always verify HMAC signature from KYC provider. Store idempotency key in Redis. After decision: delete document from S3, null out `id_document_url` and `id_document_iv` in DB.

10. **Phone number**: Encrypted with AES-256 (IV stored separately). Never decrypted and returned via any public or private API endpoint. Used only for internal SMS if needed.

11. **Message soft delete**: Set `is_deleted = true`. Return `{ id, is_deleted: true, content: null }` — never fully remove from DB (audit trail).

12. **Group deletion**: Soft-delete only (`deleted_at`, `status = 'deleted'`). Notify all active members before executing.

13. **Group review queue**: New groups are created with `review_status = 'pending'`. They work immediately for their organiser and members but are **excluded from Explore** until approved. See §27.

14. **Explore publish rule**: a group is listed in `GET /groups` only when `review_status = 'approved'` **and** `cover_image_url IS NOT NULL` **and** `is_discoverable` **and** `status = 'active'`. Written twice — as SQL in `GroupService.listGroups` and as `isPublished()` in the same file for the organiser's checklist. Change both together.

15. **Group creation quota**: max `GROUP_CREATE_MAX_PER_WINDOW` (3) groups per user per `GROUP_CREATE_WINDOW_DAYS` (7). Counted from the `groups` table, not Redis, so a cache flush does not hand out a fresh allowance. Soft-deleted groups still count.

16. **Group description**: required on create, 40–500 characters after trimming, at least one non-whitespace character.

17. **"Active this month"**: `isActiveThisMonth` is true when the group has a non-cancelled event whose `starts_at` falls inside `GROUP_ACTIVITY_WINDOW_DAYS` (30) of now. Computed in SQL for lists, via a count for the profile. This replaced the "NEW" badge.

18. **Event venue split**: `venue_city` + `venue_state` form the public `venueArea` label ("Ibadan, Oyo") shown to everyone. `venue_address` is the exact street address and is **omitted from the payload entirely** — not nulled — for anyone who is not an active member or a going/maybe RSVP holder.

19. **Notification delivery** goes through `NotificationDispatcher` only. Never write to the `notifications` table directly from a feature service, and never email a notification-shaped thing outside it.

---

## 15. Response Envelope (Always)

```json
{
  "success": true | false,
  "message": "Human readable string",
  "data": { ... } | [ ... ] | null,
  "error": "string" | ["array", "of", "strings"] | null
}
```

Paginated list response:
```json
{
  "success": true,
  "message": "Success",
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 153
  }
}
```

Cursor-paginated response:
```json
{
  "success": true,
  "message": "Success",
  "data": [ ... ],
  "next_cursor": "uuid-of-last-item",
  "has_more": true
}
```

---

## 16. CI/CD

```yaml
# On push to main:
git pull → npm install → npm run build (tsc) → pm2 restart {id}
```

```json
// package.json scripts:
{
  "start": "node dist/src/server.js",
  "dev": "tsx watch src/server.ts",
  "build": "tsc",
  "db:migrate": "npx prisma migrate deploy",
  "db:generate": "npx prisma generate",
  "db:seed": "ts-node src/database/seeders/initial.seeder.ts",
  "start-fresh": "npm install && npm run db:migrate && npm run db:generate && npm run build"
}
```

---

## 17. What NOT to Do

- ❌ Do not use `console.log()` anywhere except `server.ts` process handlers.
- ❌ Do not use Prisma `enum` type — use `String` with CHECK constraints in migration SQL.
- ❌ Do not read `process.env.*` directly in service files — read from `app.config.ts` constants.
- ❌ Do not send emails synchronously inside request handlers — always queue via BullMQ.
- ❌ Do not use offset pagination for messages, DMs, or notifications — use cursor-based.
- ❌ Do not return `phone`, `password`, `idDocumentUrl`, or `email` (except to self) in any API response.
- ❌ Do not do business logic in controllers — controllers only call service and return response.
- ❌ Do not call `res.json()` directly — always use `ResponseHelper.success()` or `ResponseHelper.error()`.
- ❌ Do not update `member_count` manually in code — it is managed by a DB trigger.
- ❌ Do not interpolate user input into raw SQL strings — always use parameterized queries.
- ❌ Do not allow DMs between users who share no active group.
- ❌ Do not expose invite-only groups to non-members in search or profile endpoints.
- ❌ Do not allow unverified users to join/apply/create groups or send messages.

---

## 18. Events

### Prisma models
- `Event` → `events` table. Key fields: `groupId`, `createdBy`, `startsAt`, `endsAt`, `rsvpLimit`, `rsvpCount` (denormalized), `status` (`scheduled|cancelled|completed`), `visibility` (`public|private`, defaults to `private`), venue columns (`venueCity`, `venueState`, `venueAddress`), optional PostGIS `locationPoint`. Reads must gate on `visibility` — non-members see `public` only; see `backend-srs.md § 4.6`.
- `EventRsvp` → `event_rsvps` table. Unique on `(eventId, userId)`. Status: `going|maybe|not_going` — `not_going` is the "Unavailable / Can't make it" option in the UI.

### Venue
Two audiences, one event:

| Field | Audience | Notes |
|---|---|---|
| `venueCity` + `venueState` | everyone | Serialised as `venueArea` — `"Ibadan, Oyo"`. Present on the event card, list responses and `/events/near`. |
| `venueAddress` | active members **or** going/maybe RSVP holders | The exact street address. Setting one requires tier 3 (verified ID). |

`serializeEvent()` in `event.service.ts` is the single place this is applied. It **deletes** `venueAddress` for callers who may not see it rather than nulling it, so a stranger cannot tell "no address set" from "address withheld". `canSeeExactAddress` is returned so the client knows which it got.

RSVP holders qualify because a public event can be RSVP'd by a non-member, and telling someone they are attending while hiding where it is makes the RSVP useless.

### Calendar export
Every event payload carries a `calendar` block:
```json
{ "ics": "/api/v1/events/{id}/calendar.ics", "google": "https://calendar.google.com/calendar/render?..." }
```
`GET /events/:id/calendar.ics` is the **only** endpoint that does not use `ResponseHelper` — it returns `text/calendar` with a `Content-Disposition: attachment` header because calendar clients follow the URL directly. It applies the same visibility rules as `GET /events/:id`; a private event 404s for non-members so the file is not a side door. Generation lives in `shared/utils/calendar.ts` (RFC 5545 escaping + 75-octet line folding).

### Business rules
- `starts_at` must be in the future at creation time (enforced in validator).
- `ends_at` must be after `starts_at` when provided.
- RSVP limit: if `rsvpLimit` is set and `rsvpCount >= rsvpLimit`, reject new 'going' RSVPs with 422.
- `rsvpCount` is maintained in application code (not a DB trigger) via `prisma.$transaction([upsert, update])`.
- **`POST /events/:id/rsvp` is idempotent.** It upserts. Re-sending the same status is a no-op that returns the existing RSVP; sending a different status transitions it and adjusts `rsvpCount` by the delta. This exists because the client updates optimistically and disables the button on tap — a 409 on retry would force the UI to roll back a button that was already correct.
- Cancelling event: set `status = 'cancelled'` — never hard-delete. RSVP holders (going/maybe) are notified.
- Setting `venue_address` requires `id_verification_status = 'verified'` on create **and** update.
- On event create: `NotificationDispatcher.dispatchToGroup(...'event_created')`, excluding the actor.
- 24-hour reminders: the hourly `event-reminders` cron calls `EventService.sendUpcomingReminders()`, which sweeps events starting in 23–25h. A sweep rather than a per-event delayed job — a delayed job would still fire for a cancelled or rescheduled event and would need cancelling on every edit. A Redis `event:reminded:{id}` SET NX marker (48h TTL) makes it exactly-once despite the overlapping window.
- `authorizeGroupRole('super_admin', 'admin')` on create/update/delete/listRsvps.
- RSVP routes use `authenticateContactVerified` — attending is tier 1.

### Endpoint table
| Method | Path | Auth |
|--------|------|------|
| POST | `/groups/:id/events` | Bearer · admin+ |
| GET | `/groups/:id/events` | Bearer |
| GET | `/events/:id` | Bearer |
| PATCH | `/events/:id` | Bearer · admin+ |
| DELETE | `/events/:id` | Bearer · admin+ |
| POST | `/events/:id/rsvp` | Bearer · member |
| PATCH | `/events/:id/rsvp` | Bearer · member |
| DELETE | `/events/:id/rsvp` | Bearer · member |
| GET | `/events/:id/rsvps` | Bearer · admin+ |

### Route mounting
Event routes are mounted at `/api/v1` (not `/api/v1/events`) because the router handles both `/groups/:id/events` and `/events/:id` paths.

---

## 19. Notifications

### Prisma models
- `Notification` → `notifications` table. Key fields: `userId`, `type`, `title`, `body`, `referenceType`, `referenceId`, `isRead`, `createdAt`.
- `NotificationPreference` → `notification_preferences` table. Unique on `(userId, groupId, prefType)`. `groupId = null` = global preference. Three independent channel flags: `pushEnabled`, `inAppEnabled`, `emailEnabled`.

### ⚠️ Delivery goes through `NotificationDispatcher` — always

`features/notifications/notification.dispatcher.ts` is the only place a notification is delivered. Feature services build the payload and hand it over; the dispatcher resolves preferences and fans out across three channels.

**Why this exists**: every service used to queue a `notify-group-members` BullMQ job whose worker only logged the payload. No row was ever written to `notifications`, which is why the unread counter and the notifications page were permanently empty. That job is now a drain-only no-op kept for in-flight jobs; nothing enqueues it.

```typescript
import { NotificationDispatcher } from '../notifications/notification.dispatcher';

// To specific users
await NotificationDispatcher.dispatch({
    userIds: [targetUserId],
    groupId,                    // scopes preference lookup; a per-group mute beats the global default
    type: 'application_approved',
    title: "You're in — Ibadan Runners",
    body: 'Your application was approved.',
    referenceType: 'group',
    referenceId: groupId,
    email: {                    // optional; only sent for types in NOTIFICATION_EMAIL_TYPES
        subject: 'Your application was approved',
        template: 'application_approved',
        data: { groupName },    // displayName + clientUrl are always added
    },
});

// To a whole group
await NotificationDispatcher.dispatchToGroup(groupId, { ...same }, {
    excludeUserIds: [actor.userId],   // never notify someone about their own action
    roles: ['super_admin', 'admin'],  // optional: admins only
});
```

Rules:
- **Never throws.** A failed notification must not roll back the action that caused it. Failures are logged.
- Preference resolution is most-specific-wins: group-scoped row → global row (`group_id IS NULL`) → defaults (all channels on). Resolved for the whole recipient set in one query.
- In-app delivery also emits `notification` to the recipient's `user:{id}` socket room, so the badge updates live.

### Notification types
`message | message_reply | application_submitted | application_approved | application_rejected | member_joined | event_created | event_reminder | event_cancelled | event_updated | group_announcement | group_approved | group_rejected | group_deleted | dm_received | invite_received | membership_updated | system`

Adding a type means updating **three** places: `NOTIFICATION_TYPES`, the `notifications_type_check` DB constraint (via a migration), and — if it should be emailable — `NOTIFICATION_EMAIL_TYPES`.

### Which types are emailed

`NOTIFICATION_EMAIL_TYPES` in `notification.types.ts` gates it. `message` and `dm_received` are deliberately **excluded**: one email per chat message is what makes a product's email unreadable, and in-app + push already cover it. Emailable:

| Type | Trigger | Template |
|---|---|---|
| `event_created` | New event in a group you're in | `event_created.html` |
| `event_reminder` | 24h before an event you RSVP'd to, with the venue address | `event_reminder.html` |
| `event_cancelled` | An event you RSVP'd to is cancelled | `event_cancelled.html` |
| `message_reply` | Someone replied to *your* message in a group chat | `message_reply.html` |
| `application_approved` / `_rejected` | Your group application was reviewed | `application_approved.html` / `application_rejected.html` |
| `group_approved` / `group_rejected` | Your group cleared (or failed) review | `group_approved.html` / `group_rejected.html` |
| `group_announcement`, `invite_received` | — | — |

`message_reply` is scoped to **direct replies to your own message**, not every message in the room — the signal that matters is "someone answered you". Implemented in `notifyOnReply()` in `message.service.ts`, and called from both the REST fallback **and** the socket `send_message` handler (sockets are the primary path; wiring only the REST side would mean almost none fire).

### Pagination
Cursor-based — ordered by `createdAt DESC`. Cursor is the `id` of the last item returned. Response shape includes `unread_count` alongside cursor fields.

### Creating notifications from other services
```typescript
import { NotificationService } from '../notifications/notification.service';
await NotificationService.create({
    userId: targetUserId,
    type: 'member_joined',
    title: 'New member joined',
    body: 'Someone joined your group.',
    referenceType: 'group',
    referenceId: groupId,
});
```

### Endpoint table
| Method | Path | Auth |
|--------|------|------|
| GET | `/notifications` | Bearer |
| GET | `/notifications/unread-count` | Bearer |
| PATCH | `/notifications/read-all` | Bearer |
| PATCH | `/notifications/:id/read` | Bearer |
| DELETE | `/notifications/:id` | Bearer |
| GET | `/notifications/preferences` | Bearer |
| PATCH | `/notifications/preferences` | Bearer |

**Important**: literal paths (`unread-count`, `preferences`, `read-all`) are defined BEFORE `/:id` routes in the router to prevent Express treating them as an ID param.

`GET /notifications/unread-count` returns `{ unread_count }` and nothing else — the badge is polled on every app resume and does not need the page of rows that `GET /notifications` returns alongside its own `unread_count`.

`PATCH /notifications/preferences` patches per channel: each of `push_enabled`, `in_app_enabled`, `email_enabled` is optional, and omitting one leaves it as-is. Muting email must not silently re-enable in-app just because the client did not restate it.

---

## 20. Reports

### Business rules
- Rate limit: **5 reports per user per 24 hours** enforced via Redis counter key `report:rate:{userId}` with 24hr TTL.
- Redis `INCR` first, then check; if counter === 1 set `EXPIRE`. Return 429 if count > 5.
- After insert, queue `notify-platform-admin` BullMQ job.
- Reasons: `spam | harassment | hate_speech | fake_profile | inappropriate_content | other`
- Target types: `user | group | message`

### Endpoint table
| Method | Path | Auth |
|--------|------|------|
| POST | `/reports` | Bearer |

---

## 21. Platform Admin

### Permission
All admin routes use `authorize('platform.admin')` — this checks `req.user.permissions` from the JWT payload. Platform admin users must have `platform.admin` in their permissions array (set at token generation in `InitialSeeder` or user creation).

### Endpoint table (prefix `/admin`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/users` | List users (filterable: status, search) |
| PATCH | `/admin/users/:id` | Update user status (active/suspended/banned) |
| GET | `/admin/users/:id/verification` | View submitted ID document |
| PATCH | `/admin/users/:id/verification` | Approve or reject ID verification |
| GET | `/admin/groups` | List groups (filterable: status, search) |
| PATCH | `/admin/groups/:id` | Verify/suspend/restore group |
| GET | `/admin/reports` | List reports (filterable: status) |
| PATCH | `/admin/reports/:id` | Resolve or dismiss report |
| GET | `/admin/audit-logs` | Query audit log |

### Notes
- ID verification: on approval, `idDocumentUrl` and `idDocumentIv` are cleared (document deleted from storage).
- Group verify: `PATCH /admin/groups/:id` with `{ is_verified: true }`.
- Report resolution: body `{ action: "resolved" | "dismissed" }`.
- Audit log query supports: `user_id`, `action`, `entity_type`, `date_from`, `date_to`.

---

## 22. Group Chat (Messages)

### Architecture
- REST API for CRUD operations; Socket.io `/chat` namespace for real-time delivery.
- `Message` model lives in `prisma/schemas/message.prisma`.
- Read receipts: `ChatReadReceipt` table with composite PK `(user_id, group_id)`, updated on every `GET /groups/:id/messages` call (upsert `lastReadAt = now()`).

### Chat lock
`group.isChatLocked` — when `true`, only members whose `membership.role` is `super_admin` or `admin` may send messages. Enforced in `MessageService.sendMessage()` **and** in the socket `send_message` handler.

### Endpoint table (no sub-prefix — mounted at `apiPrefix`)
| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| GET | `/groups/:id/messages` | `authenticate` | Cursor-paginated message list; marks read |
| POST | `/groups/:id/messages` | `authenticateVerified` | Send message to group |
| GET | `/groups/:id/messages/pinned` | `authenticate` | All pinned messages |
| PATCH | `/groups/:id/chat` | `authenticate` | Toggle chat lock (admin only) |
| DELETE | `/messages/:id` | `authenticate` | Soft-delete (sender or group admin) |
| PATCH | `/messages/:id/pin` | `authenticate` | Pin/unpin (group admin) |
| POST | `/messages/:id/react` | `authenticate` | Add emoji reaction |
| DELETE | `/messages/:id/react` | `authenticate` | Remove emoji reaction |

### Socket events (namespace `/chat`)
| Event (client→server) | Payload | Description |
|---|---|---|
| `join_group` | `{ group_id }` | Join group room (membership checked) |
| `leave_group` | `{ group_id }` | Leave group room |
| `send_message` | `{ group_id, content, reply_to_id? }` | Rate-limited (10/10 s), chat-lock checked |
| `user_typing` | `{ group_id }` | Broadcasts `typing` to group room |
| `heartbeat` | `{ status }` | Updates presence; broadcasts `presence_update` |

| Event (server→client) | Payload | Description |
|---|---|---|
| `new_message` | `{ message }` | Broadcast to group room |
| `message_deleted` | `{ message_id }` | Broadcast to group room |
| `message_pinned` | `{ message }` | Broadcast to group room |
| `reaction_added` | `{ message_id, emoji, user_id }` | Broadcast to group room |
| `reaction_removed` | `{ message_id, emoji, user_id }` | Broadcast to group room |
| `typing` | `{ user_id, group_id }` | Broadcast to group room |
| `presence_update` | `{ user_id, status }` | Broadcast to group room |
| `chat_lock_changed` | `{ group_id, is_locked }` | Broadcast to group room |
| `kicked_from_group` | `{ group_id }` | Emitted to personal room `user:{id}` |

### Rate limiting (socket)
Redis key `msg:rate:{userId}:{groupId}` with `INCR` + 10-second TTL. Reject with `error` event if count > 10.

### Kick on remove/ban
`MembershipService.updateMember()` and `removeMember()` call `SocketService.kickFromRoom(userId, groupId)`, which calls `chatNsp.in('user:{userId}').socketsLeave('group:{groupId}')` and emits `kicked_from_group` to the personal room.

---

## 23. Direct Messages (DMs)

### Rules
- Both users must be **active members** of at least one common group (checked via raw SQL JOIN on `memberships`).
- Either direction block (`userBlock`) prevents sending.
- Per-side soft-delete: `isDeletedBySender` / `isDeletedByReceiver`.

### Endpoint table
| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| GET | `/conversations` | `authenticate` | Unified inbox (groups + DMs merged) |
| GET | `/dm/:userId` | `authenticate` | Cursor-paginated DM thread |
| POST | `/dm/:userId` | `authenticateVerified` | Send DM |
| PATCH | `/dm/:userId/read` | `authenticate` | Mark all unread DMs from user as read |
| DELETE | `/dm/:dmId` | `authenticate` | Soft-delete a single DM (per side) |

### Unified inbox (`GET /conversations`)
Returns `ConversationItem[]` sorted by `last_message.created_at DESC`. Each item has `type: 'group' | 'dm'`.

Group conversations use Prisma with nested `messages` (take: 1) and a batch raw-SQL unread count query.

DM conversations use a single raw SQL `DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(...))` query to get the latest message per unique conversation partner, plus inline unread count subquery.

### Socket events (DMs)
| Event (client→server) | Payload | Description |
|---|---|---|
| `dm_send` | `{ receiver_id, content, media_url? }` | Shared-group + block check; creates DB record |

| Event (server→client) | Payload | Description |
|---|---|---|
| `dm_received` | `{ message }` | Emitted to `user:{receiverId}` personal room |
| `dm_read` | `{ sender_id }` | Emitted to `user:{senderId}` personal room on mark-read |

---

## 24. SERVICE_MODE

Controls what each process serves. Set via env var `SERVICE_MODE`.

| Value | Behaviour |
|---|---|
| `both` (default) | REST routes **and** Socket.io attached |
| `api` | REST routes only — no socket |
| `socket` | Socket.io only — no REST routes mounted |

Configured in `src/shared/config/app.config.ts` as `config.server.serviceMode`. Applied in `src/app.ts` `start()`:
```typescript
if (serviceMode === 'api' || serviceMode === 'both') { /* mount REST routes */ }
if (serviceMode === 'socket' || serviceMode === 'both') { SocketService.attach(httpServer); }
```
Health check (`GET /health`) is always available regardless of mode, and includes `mode: serviceMode` in the response body.

---

## 26. Verification Ladder

Capability is bought in rungs, so friction only lands on the users asking for the riskier thing.

| Tier | Requirement | Unlocks | Guard |
|---|---|---|---|
| 0 | none | Browse groups and public events, view profiles | `authenticate` |
| 1 | email verified + **phone OTP** | Join public groups, apply, accept invites, RSVP to events | `authenticateContactVerified` |
| 2 | tier 1 + a non-empty `bio`, then **platform admin review** of the group | Create a group | `authenticateOrganiser` + the review queue (§27) |
| 3 | tier 2 + `id_verification_status = 'verified'` (NIN / BVN / passport) | Host an event at a **physical street address** | `hasVerifiedId()` inside `EventService` |

All three live in `shared/middleware/verification.middleware.ts`. Every tier also re-checks account health (not deleted, not suspended, not banned) before its own rule.

Tier 3 is enforced **in the service, not as route middleware**, because it only applies when the request actually carries `venue_address` — an event with only a city and state needs no ID.

`authenticateVerified` (the old blanket ID gate, still commented out internally) remains for routes not yet migrated. Prefer the tier guards.

### Phone verification endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/phone/send-otp` | Bearer | Body `{ phone? }`. Supplying a number sets/replaces it and clears any prior verification. 60-second resend cooldown (`429`). |
| POST | `/auth/phone/verify` | Bearer | Body `{ otp }`. Sets `users.phone_verified_at`. |

Plain `authenticate` on both — an unverified account is exactly who needs to reach them.

Redis keys: `verify:phone:{userId}` (OTP, 10 min) and `verify:phone:cooldown:{userId}` (resend lock, 60 s, `SET NX`). Keyed by **user id, not phone number** — the number is stored encrypted, and a plaintext number in a Redis key would defeat that.

Delivery goes through `SmsService` (`shared/queues/sms.service.ts`). `SMS_PROVIDER=log` (the default) writes the code to the application log instead of sending it, so the flow is exercisable before an SMS contract exists. Set `SMS_PROVIDER=termii` + `SMS_API_KEY` to send for real. Sent inline rather than queued — the user is staring at the code entry screen and a queue hop only adds latency.

---

## 27. Group Review Queue

New groups go live for their organiser immediately but stay **out of Explore** until a platform admin approves them.

- `groups.review_status`: `pending` (default) | `approved` | `rejected`, plus `reviewed_by`, `reviewed_at`, `review_notes`.
- Rejection does **not** delete or suspend anything. The group keeps working for its members; it is simply unlisted. That is the point of letting groups go live immediately — review gates discovery, not existence.
- On create, the organiser gets a `system` notification reading "Under review — usually within 24 hours" and every platform admin is notified.
- `GET /groups/:slug` returns a `publishingChecklist` **to the group's own admins only**, listing every blocker (`reviewStatus`, `hasCoverImage`, `isDiscoverable`, `blockers[]`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/groups/pending` | The queue. Oldest first (FIFO — the 24-hour promise is only keepable if the longest-waiting group is reviewed first). Each row carries the creator's `phoneVerified`, `emailVerified`, `idVerificationStatus`, `bio` and `groupsCreated` count. |
| PATCH | `/admin/groups/:id/review` | Body `{ decision: 'approve' \| 'reject', notes? }`. Rejecting **requires** notes — the organiser is shown them verbatim. Approving a group with no cover image fails with 422 rather than leaving it approved-but-invisible. |

`GET /admin/groups` also accepts `?review_status=`.

---

## 28. Reference Catalogues

`GET /reference/*` — **unauthenticated**, because these populate the signup form, which runs before the user has a token. Static product configuration, not user data.

| Method | Path | Returns |
|---|---|---|
| GET | `/reference/onboarding` | Everything the signup form needs in one round-trip |
| GET | `/reference/interests` | `{ interests: [{ value, label, group }], groups: string[] }` |
| GET | `/reference/states` | 36 Nigerian states + FCT, each with its main cities |
| GET | `/reference/categories` | Group category options |

The catalogues live in `features/reference/reference.types.ts` as module constants, not in the database: they change at the pace of product decisions, not user actions, and shipping them as data would mean a seeder, a migration and an admin CRUD surface for a list edited twice a year.

Interest `value`s are already normalised (lowercase, no whitespace) to match what `UserService.updateInterests` and `AuthService.register` write — if they diverged, a stored tag would never equal the option the user picked. `city` and `state` remain free text, so anything missing from the catalogue can still be typed in.

---

## 29. Testing

| Command | What it runs | Needs a server? |
|---|---|---|
| `npm run test:unit` | `src/__tests__/unit.ts` — pure logic: iCalendar escaping/folding, venue labels, description bounds, the publish rule, the notification-type registry, catalogue integrity | no |
| `npm test` | `src/__tests__/index.ts` — the full integration suite, 24 sections | yes, with `TEST_ROUTES_ENABLED=true` |

Test-only helper routes (`/api/v1/test/*`, non-production only) that the suite depends on:

| Route | Purpose |
|---|---|
| `GET /test/otp` | Read an email OTP out of Redis |
| `GET /test/phone-otp/:userId` | Read a phone OTP out of Redis |
| `PATCH /test/verify-phone/:userId` | Skip the SMS round-trip (tier 1) |
| `PATCH /test/verify-user/:userId` | Set `id_verification_status = verified` (tier 3) |
| `PATCH /test/approve-group/:groupId` | Move a group through the review queue |
| `POST /test/reset-group-quota/:userId` | Back-date a user's groups so the 3-per-7-days allowance resets — the suite creates far more groups than a real account may |

---

## 30. Reference Files

| File | Purpose |
|---|---|
| `backend-srs.md` | Full SQL schema, all endpoint specs, business rules, job definitions |
| This file (`agent.md`) | Coding conventions, patterns, and quick-reference for every session |

When implementing a new feature:
1. Check `agent.md §14` (GroupSync-specific rules) for anything that overrides the general pattern.
2. Check `backend-srs.md` for the exact endpoint spec and SQL schema for that feature.
3. Follow the conventions in this file (`agent.md`) for code structure, patterns, and style.
