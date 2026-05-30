-- Group Feed / Timeline
-- Posts, threaded comments, and reactions for the group's async content wall.

CREATE TABLE "group_posts" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "group_id"   UUID        NOT NULL,
    "author_id"  UUID        NOT NULL,
    "content"    TEXT,
    "media_urls" TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    "link_url"   TEXT,
    "is_public"  BOOLEAN     NOT NULL DEFAULT false,
    "is_pinned"  BOOLEAN     NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN     NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "group_post_comments" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "post_id"    UUID        NOT NULL,
    "author_id"  UUID        NOT NULL,
    "parent_id"  UUID,
    "content"    TEXT        NOT NULL,
    "is_deleted" BOOLEAN     NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_post_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "group_post_reactions" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "post_id"    UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "emoji"      VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_post_reactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "group_post_comment_reactions" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "comment_id" UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "emoji"      VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_post_comment_reactions_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "group_posts"
    ADD CONSTRAINT "group_posts_group_id_fkey"  FOREIGN KEY ("group_id")  REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "group_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id")  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_post_comments"
    ADD CONSTRAINT "group_post_comments_post_id_fkey"    FOREIGN KEY ("post_id")   REFERENCES "group_posts"("id")         ON DELETE CASCADE  ON UPDATE CASCADE,
    ADD CONSTRAINT "group_post_comments_author_id_fkey"  FOREIGN KEY ("author_id") REFERENCES "users"("id")               ON DELETE CASCADE  ON UPDATE CASCADE,
    ADD CONSTRAINT "group_post_comments_parent_id_fkey"  FOREIGN KEY ("parent_id") REFERENCES "group_post_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "group_post_reactions"
    ADD CONSTRAINT "group_post_reactions_post_id_fkey"  FOREIGN KEY ("post_id") REFERENCES "group_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "group_post_reactions_user_id_fkey"  FOREIGN KEY ("user_id") REFERENCES "users"("id")       ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_post_comment_reactions"
    ADD CONSTRAINT "group_post_comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "group_post_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "group_post_comment_reactions_user_id_fkey"    FOREIGN KEY ("user_id")    REFERENCES "users"("id")               ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique constraints
CREATE UNIQUE INDEX "group_post_reactions_post_id_user_id_emoji_key"
    ON "group_post_reactions"("post_id", "user_id", "emoji");

CREATE UNIQUE INDEX "group_post_comment_reactions_comment_id_user_id_emoji_key"
    ON "group_post_comment_reactions"("comment_id", "user_id", "emoji");

-- Query indexes
CREATE INDEX "idx_group_posts_group"   ON "group_posts"("group_id", "is_pinned", "created_at" DESC);
CREATE INDEX "idx_group_posts_public"  ON "group_posts"("group_id", "is_public", "created_at" DESC);
CREATE INDEX "idx_post_comments_post"  ON "group_post_comments"("post_id", "created_at" DESC);
CREATE INDEX "idx_post_comments_parent" ON "group_post_comments"("parent_id");
CREATE INDEX "idx_post_reactions_post" ON "group_post_reactions"("post_id");
CREATE INDEX "idx_comment_reactions_comment" ON "group_post_comment_reactions"("comment_id");
