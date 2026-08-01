-- Event visibility
-- Per-event privacy so a group can host both members-only and publicly-previewable events.
--
-- Existing rows default to 'private'. Before this migration the event read endpoints applied no
-- membership check at all, so every event was effectively readable by any authenticated user;
-- defaulting to 'private' closes that rather than preserving it.

ALTER TABLE "events"
    ADD COLUMN "visibility" VARCHAR(20) NOT NULL DEFAULT 'private';

CREATE INDEX "idx_events_group_visibility_starts"
    ON "events" ("group_id", "visibility", "starts_at");
