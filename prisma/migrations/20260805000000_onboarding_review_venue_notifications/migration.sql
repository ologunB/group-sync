-- Onboarding, group review queue, event venue and notification delivery.
--
-- Five independent changes shipped together because they all land on tables the
-- v1 launch checklist touches:
--   1. users.phone_verified_at  — tier 1 of the verification ladder
--   2. groups.review_status     — new groups are live but out of Explore until approved
--   3. events venue columns     — public area vs members-only exact address
--   4. notification_preferences.email_enabled
--   5. widened notifications.type CHECK for the new notification kinds

-- ─── 1. Phone verification ────────────────────────────────────────────────────

ALTER TABLE "users"
    ADD COLUMN "phone_verified_at" TIMESTAMPTZ;

-- Accounts that already supplied a phone at registration are not retro-verified:
-- they never completed an OTP challenge, so phone_verified_at stays NULL.

-- ─── 2. Group review queue ────────────────────────────────────────────────────

ALTER TABLE "groups"
    ADD COLUMN "review_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    ADD COLUMN "reviewed_by"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
    ADD COLUMN "reviewed_at"   TIMESTAMPTZ,
    ADD COLUMN "review_notes"  TEXT;

ALTER TABLE "groups"
    ADD CONSTRAINT "groups_review_status_check"
    CHECK (review_status IN ('pending', 'approved', 'rejected'));

-- Groups that existed before the queue were already discoverable. Retro-flagging them
-- as 'pending' would silently empty Explore, so they are grandfathered in as approved.
UPDATE "groups"
SET    review_status = 'approved',
       reviewed_at   = NOW()
WHERE  created_at < NOW();

CREATE INDEX "idx_groups_review_status" ON "groups" ("review_status", "created_at");

-- ─── 3. Event venue ───────────────────────────────────────────────────────────

ALTER TABLE "events"
    ADD COLUMN "venue_city"    VARCHAR(100),
    ADD COLUMN "venue_state"   VARCHAR(100),
    ADD COLUMN "venue_address" TEXT;

-- ─── 4. Email notification preference ─────────────────────────────────────────

ALTER TABLE "notification_preferences"
    ADD COLUMN "email_enabled" BOOLEAN NOT NULL DEFAULT TRUE;

-- ─── 5. New notification types ────────────────────────────────────────────────

ALTER TABLE "notifications"
    DROP CONSTRAINT IF EXISTS "notifications_type_check";

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_type_check" CHECK (type IN (
        'message',
        'message_reply',
        'application_submitted',
        'application_approved',
        'application_rejected',
        'member_joined',
        'event_created',
        'event_reminder',
        'event_cancelled',
        'event_updated',
        'group_announcement',
        'group_approved',
        'group_rejected',
        'group_deleted',
        'dm_received',
        'invite_received',
        'membership_updated',
        'system'
    ));
