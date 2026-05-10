-- CreateTable: events
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "location_name" VARCHAR(255),
    "location_point" geometry(Point,4326),
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ,
    "rsvp_limit" INTEGER,
    "rsvp_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_status_check" CHECK (status IN ('scheduled','cancelled','completed'))
);

-- CreateTable: event_rsvps
CREATE TABLE "event_rsvps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'going',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "event_rsvps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_rsvps_status_check" CHECK (status IN ('going','maybe','not_going')),
    CONSTRAINT "event_rsvps_event_id_user_id_key" UNIQUE ("event_id", "user_id")
);

-- CreateTable: notifications
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT,
    "reference_type" VARCHAR(30),
    "reference_id" UUID,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_type_check" CHECK (type IN (
        'message','application_submitted','application_approved','application_rejected',
        'member_joined','event_created','group_announcement','dm_received',
        'invite_received','membership_updated','system'
    ))
);

-- CreateTable: notification_preferences
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "group_id" UUID,
    "pref_type" VARCHAR(50) NOT NULL,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_preferences_user_id_group_id_pref_type_key" UNIQUE ("user_id", "group_id", "pref_type")
);

-- CreateTable: reports
CREATE TABLE "reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reporter_id" UUID NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reports_target_type_check" CHECK (target_type IN ('user','group','message')),
    CONSTRAINT "reports_status_check" CHECK (status IN ('open','reviewing','resolved','dismissed'))
);

-- AddForeignKey: events → groups
ALTER TABLE "events" ADD CONSTRAINT "events_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: events → users (creator)
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: event_rsvps → events
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: event_rsvps → users
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: notifications → users
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: notification_preferences → users
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: notification_preferences → groups
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: reports → users (reporter)
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey"
    FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: reports → users (reviewer)
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: events
CREATE INDEX "idx_events_group_starts" ON "events"("group_id", "starts_at");
CREATE INDEX "idx_events_location" ON "events" USING GIST ("location_point");

-- CreateIndex: event_rsvps
CREATE INDEX "idx_rsvps_event" ON "event_rsvps"("event_id");
CREATE INDEX "idx_rsvps_user" ON "event_rsvps"("user_id");

-- CreateIndex: notifications
CREATE INDEX "idx_notifications_user_unread" ON "notifications"("user_id", "is_read", "created_at" DESC);

-- CreateIndex: notification_preferences
CREATE INDEX "idx_notif_prefs_user" ON "notification_preferences"("user_id");

-- CreateIndex: reports
CREATE INDEX "idx_reports_status" ON "reports"("status", "created_at");
CREATE INDEX "idx_reports_target" ON "reports"("target_type", "target_id");
