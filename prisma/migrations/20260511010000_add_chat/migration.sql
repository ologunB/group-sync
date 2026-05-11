-- Add chat lock flag to groups
ALTER TABLE "groups" ADD COLUMN "is_chat_locked" BOOLEAN NOT NULL DEFAULT FALSE;

-- ── messages ──────────────────────────────────────────────────────────────────
CREATE TABLE "messages" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "group_id"        UUID        NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
    "sender_id"       UUID        NOT NULL REFERENCES "users"("id"),
    "content"         TEXT,
    "message_type"    VARCHAR(20) NOT NULL DEFAULT 'text'
                          CHECK (message_type IN ('text','image','file','poll','voice_note','system')),
    "media_url"       TEXT,
    "media_mime_type" VARCHAR(100),
    "reply_to_id"     UUID        REFERENCES "messages"("id"),
    "is_pinned"       BOOLEAN     NOT NULL DEFAULT FALSE,
    "is_deleted"      BOOLEAN     NOT NULL DEFAULT FALSE,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY ("id")
);

CREATE INDEX "idx_messages_group_created" ON "messages" ("group_id", "created_at" DESC) WHERE is_deleted = FALSE;
CREATE INDEX "idx_messages_sender"        ON "messages" ("sender_id");
CREATE INDEX "idx_messages_pinned"        ON "messages" ("group_id", "is_pinned") WHERE is_pinned = TRUE;

-- ── message_reactions ─────────────────────────────────────────────────────────
CREATE TABLE "message_reactions" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID        NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
    "user_id"    UUID        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "emoji"      VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id"),
    UNIQUE ("message_id", "user_id", "emoji")
);

CREATE INDEX "idx_reactions_message" ON "message_reactions" ("message_id");

-- ── direct_messages ───────────────────────────────────────────────────────────
CREATE TABLE "direct_messages" (
    "id"                    UUID        NOT NULL DEFAULT gen_random_uuid(),
    "sender_id"             UUID        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "receiver_id"           UUID        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "content"               TEXT,
    "media_url"             TEXT,
    "is_read"               BOOLEAN     NOT NULL DEFAULT FALSE,
    "is_deleted_by_sender"  BOOLEAN     NOT NULL DEFAULT FALSE,
    "is_deleted_by_receiver" BOOLEAN    NOT NULL DEFAULT FALSE,
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("id")
);

-- Functional index for efficient conversation thread lookup between two users
CREATE INDEX "idx_dm_conversation" ON "direct_messages" (
    LEAST(sender_id::text, receiver_id::text),
    GREATEST(sender_id::text, receiver_id::text),
    created_at DESC
);
CREATE INDEX "idx_dm_receiver_unread" ON "direct_messages" ("receiver_id", "is_read") WHERE is_read = FALSE;
CREATE INDEX "idx_dm_created"         ON "direct_messages" ("created_at" DESC);

-- ── chat_read_receipts ────────────────────────────────────────────────────────
CREATE TABLE "chat_read_receipts" (
    "user_id"      UUID        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "group_id"     UUID        NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
    "last_read_at" TIMESTAMPTZ NOT NULL,
    PRIMARY KEY ("user_id", "group_id")
);
