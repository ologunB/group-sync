-- Admin-managed taxonomy: group categories and user interests.
--
-- Both lists were module constants in reference.types.ts. They now need editing by a
-- platform admin without a deploy, so they become rows and the reference endpoints read
-- from here instead.
--
-- `value` is the migration-critical column: it holds the exact strings already stored in
-- `groups.category` and in the `users.interests` text array. The seeds below reproduce
-- the constants verbatim, so every existing group and every saved interest still resolves
-- after this runs. There is deliberately no foreign key from groups.category — it is free
-- text today, and adding the constraint would reject the rows of anyone who typed a
-- category the catalogue never had.

-- ─── Categories ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "categories" (
    "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "value"      VARCHAR(80)  NOT NULL UNIQUE,
    "label"      VARCHAR(80)  NOT NULL,
    "is_active"  BOOLEAN      NOT NULL DEFAULT TRUE,
    "sort_order" INTEGER      NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_categories_active_order"
    ON "categories" ("is_active", "sort_order");

-- ─── Interests ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "interests" (
    "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "value"      VARCHAR(80)  NOT NULL UNIQUE,
    "label"      VARCHAR(80)  NOT NULL,
    "group_name" VARCHAR(80)  NOT NULL,
    "is_active"  BOOLEAN      NOT NULL DEFAULT TRUE,
    "sort_order" INTEGER      NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_interests_active_order"
    ON "interests" ("is_active", "sort_order");
CREATE INDEX IF NOT EXISTS "idx_interests_group"
    ON "interests" ("group_name");

-- ─── Seed: the previous constants, verbatim ───────────────────────────────────
-- ON CONFLICT DO NOTHING so a re-run is a no-op and an admin's later edits to label,
-- sort_order or is_active are never reverted by re-applying the migration.

INSERT INTO "categories" ("value", "label", "sort_order") VALUES
    ('Sports & Fitness',   'Sports & Fitness',   1),
    ('Arts & Culture',     'Arts & Culture',     2),
    ('Career & Learning',  'Career & Learning',  3),
    ('Community',          'Community',          4),
    ('Lifestyle',          'Lifestyle',          5),
    ('Faith',              'Faith',              6),
    ('Education',          'Education',          7),
    ('Social',             'Social',             8)
ON CONFLICT ("value") DO NOTHING;

INSERT INTO "interests" ("value", "label", "group_name", "sort_order") VALUES
    ('football',        'Football',              'Sports & Fitness',  1),
    ('basketball',      'Basketball',            'Sports & Fitness',  2),
    ('running',         'Running',               'Sports & Fitness',  3),
    ('cycling',         'Cycling',               'Sports & Fitness',  4),
    ('gym',             'Gym & Weightlifting',   'Sports & Fitness',  5),
    ('martial_arts',    'Martial Arts',          'Sports & Fitness',  6),
    ('hiking',          'Hiking & Outdoors',     'Sports & Fitness',  7),

    ('books',           'Books & Reading',       'Arts & Culture',    8),
    ('writing',         'Writing',               'Arts & Culture',    9),
    ('music',           'Music',                 'Arts & Culture',   10),
    ('film',            'Film & TV',             'Arts & Culture',   11),
    ('photography',     'Photography',           'Arts & Culture',   12),
    ('art',             'Art & Design',          'Arts & Culture',   13),
    ('theatre',         'Theatre & Comedy',      'Arts & Culture',   14),
    ('fashion',         'Fashion',               'Arts & Culture',   15),

    ('tech',            'Tech',                  'Career & Learning', 16),
    ('startups',        'Startups',              'Career & Learning', 17),
    ('design',          'Product & UX',          'Career & Learning', 18),
    ('finance',         'Finance & Investing',   'Career & Learning', 19),
    ('entrepreneurship','Entrepreneurship',      'Career & Learning', 20),
    ('languages',       'Languages',             'Career & Learning', 21),
    ('public_speaking', 'Public Speaking',       'Career & Learning', 22),

    ('faith',           'Faith & Spirituality',  'Community',         23),
    ('volunteering',    'Volunteering',          'Community',         24),
    ('parenting',       'Parenting',             'Community',         25),
    ('alumni',          'Alumni Networks',       'Community',         26),
    ('women',           'Women''s Groups',       'Community',         27),
    ('youth',           'Youth',                 'Community',         28),

    ('food',            'Food & Cooking',        'Lifestyle',         29),
    ('travel',          'Travel',                'Lifestyle',         30),
    ('gaming',          'Gaming',                'Lifestyle',         31),
    ('board_games',     'Board Games',           'Lifestyle',         32),
    ('wellness',        'Health & Wellness',     'Lifestyle',         33),
    ('pets',            'Pets',                  'Lifestyle',         34),
    ('gardening',       'Gardening',             'Lifestyle',         35)
ON CONFLICT ("value") DO NOTHING;
