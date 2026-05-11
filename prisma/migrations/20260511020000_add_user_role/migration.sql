-- Add platform role to users (default 'user', manually set to 'platform_admin' via DB)
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

CREATE INDEX "idx_users_role" ON "users"("role");
