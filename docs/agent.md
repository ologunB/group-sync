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
    | 'notify-group-members'
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

### Cron jobs registered in `defaultJobs()`
- `expire-invite-links`: every hour `'0 * * * *'`.
- (Add future crons here in the same format.)

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

1. **ID verification gate**: Users with `id_verification_status != 'verified'` cannot join groups, apply, create groups, send messages, or send DMs. Use `authenticateVerified` middleware on these routes. ⚠️ **Temporarily disabled** — the check inside `authenticateVerified` is commented out while the KYC flow is being built; all `authenticateVerified` routes currently behave like `authenticate`. Re-enable before going to production.

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
- `Event` → `events` table. Key fields: `groupId`, `createdBy`, `startsAt`, `endsAt`, `rsvpLimit`, `rsvpCount` (denormalized), `status` (`scheduled|cancelled|completed`), optional PostGIS `locationPoint`.
- `EventRsvp` → `event_rsvps` table. Unique on `(eventId, userId)`. Status: `going|maybe|not_going`.

### Business rules
- `starts_at` must be in the future at creation time (enforced in validator).
- `ends_at` must be after `starts_at` when provided.
- RSVP limit: if `rsvpLimit` is set and `rsvpCount >= rsvpLimit`, reject new 'going' RSVPs with 422.
- `rsvpCount` is maintained in application code (not a DB trigger) via `prisma.$transaction([upsert, update])`.
- Cancelling event: set `status = 'cancelled'` — never hard-delete.
- On event create: queue `notify-group-members` BullMQ job to fan-out `event_created` notifications.
- `authorizeGroupRole('super_admin', 'admin')` on create/update/delete/listRsvps.

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
- `NotificationPreference` → `notification_preferences` table. Unique on `(userId, groupId, prefType)`. `groupId = null` = global preference.

### Notification types
`message | application_submitted | application_approved | application_rejected | member_joined | event_created | group_announcement | dm_received | invite_received | membership_updated | system`

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
| PATCH | `/notifications/read-all` | Bearer |
| PATCH | `/notifications/:id/read` | Bearer |
| DELETE | `/notifications/:id` | Bearer |
| GET | `/notifications/preferences` | Bearer |
| PATCH | `/notifications/preferences` | Bearer |

**Important**: preferences routes are defined BEFORE `/:id` routes in the router to prevent Express treating `preferences` as an ID param.

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

## 23. Reference Files

| File | Purpose |
|---|---|
| `backend-srs.md` | Full SQL schema, all endpoint specs, business rules, job definitions |
| This file (`agent.md`) | Coding conventions, patterns, and quick-reference for every session |

When implementing a new feature:
1. Check `agent.md §14` (GroupSync-specific rules) for anything that overrides the general pattern.
2. Check `backend-srs.md` for the exact endpoint spec and SQL schema for that feature.
3. Follow the conventions in this file (`agent.md`) for code structure, patterns, and style.
