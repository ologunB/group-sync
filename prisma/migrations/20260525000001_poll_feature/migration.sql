-- CreateTable: polls
CREATE TABLE "polls" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "message_id"  UUID         NOT NULL,
    "question"    VARCHAR(500) NOT NULL,
    "is_multiple" BOOLEAN      NOT NULL DEFAULT false,
    "ends_at"     TIMESTAMPTZ,
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable: poll_options
CREATE TABLE "poll_options" (
    "id"       UUID         NOT NULL DEFAULT gen_random_uuid(),
    "poll_id"  UUID         NOT NULL,
    "text"     VARCHAR(200) NOT NULL,
    "position" INTEGER      NOT NULL DEFAULT 0,
    CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable: poll_votes
CREATE TABLE "poll_votes" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "option_id"  UUID        NOT NULL,
    "poll_id"    UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);

-- Unique: one poll per message
CREATE UNIQUE INDEX "polls_message_id_key" ON "polls"("message_id");

-- Index: poll options by poll
CREATE INDEX "idx_poll_options_poll" ON "poll_options"("poll_id");

-- Unique: one vote per user per option
CREATE UNIQUE INDEX "poll_votes_option_id_user_id_key" ON "poll_votes"("option_id", "user_id");

-- Index: votes by poll + user (for single-choice check)
CREATE INDEX "idx_poll_votes_poll_user" ON "poll_votes"("poll_id", "user_id");

-- AddForeignKey: polls.message_id → messages.id
ALTER TABLE "polls"
    ADD CONSTRAINT "polls_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: poll_options.poll_id → polls.id
ALTER TABLE "poll_options"
    ADD CONSTRAINT "poll_options_poll_id_fkey"
    FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: poll_votes.option_id → poll_options.id
ALTER TABLE "poll_votes"
    ADD CONSTRAINT "poll_votes_option_id_fkey"
    FOREIGN KEY ("option_id") REFERENCES "poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: poll_votes.poll_id → polls.id
ALTER TABLE "poll_votes"
    ADD CONSTRAINT "poll_votes_poll_id_fkey"
    FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: poll_votes.user_id → users.id
ALTER TABLE "poll_votes"
    ADD CONSTRAINT "poll_votes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
