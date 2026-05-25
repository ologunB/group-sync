-- AlterTable: add reply_to_id, message_type, media_mime_type to direct_messages
ALTER TABLE "direct_messages"
    ADD COLUMN "message_type"   VARCHAR(20)  NOT NULL DEFAULT 'text',
    ADD COLUMN "media_mime_type" VARCHAR(100),
    ADD COLUMN "reply_to_id"    UUID;

ALTER TABLE "direct_messages"
    ADD CONSTRAINT "direct_messages_reply_to_id_fkey"
        FOREIGN KEY ("reply_to_id") REFERENCES "direct_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: dm_reactions
CREATE TABLE "dm_reactions" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "dm_id"      UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "emoji"      VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "dm_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dm_reactions_dm_id_user_id_emoji_key" ON "dm_reactions"("dm_id", "user_id", "emoji");
CREATE INDEX "idx_dm_reactions_dm" ON "dm_reactions"("dm_id");

-- AddForeignKey
ALTER TABLE "dm_reactions"
    ADD CONSTRAINT "dm_reactions_dm_id_fkey"
        FOREIGN KEY ("dm_id") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dm_reactions"
    ADD CONSTRAINT "dm_reactions_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
