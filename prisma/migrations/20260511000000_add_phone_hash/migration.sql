-- Add deterministic phone hash column for uniqueness enforcement
ALTER TABLE "users" ADD COLUMN "phone_hash" TEXT;

CREATE UNIQUE INDEX "users_phone_hash_key" ON "users"("phone_hash");
