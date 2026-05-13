-- Keep groups.member_count in sync with active memberships.
-- Existing rows are backfilled at the end of this migration.

CREATE OR REPLACE FUNCTION sync_group_member_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'active' THEN
            UPDATE groups
            SET member_count = member_count + 1
            WHERE id = NEW.group_id;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'active' THEN
            UPDATE groups
            SET member_count = GREATEST(member_count - 1, 0)
            WHERE id = OLD.group_id;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.group_id IS DISTINCT FROM NEW.group_id THEN
            IF OLD.status = 'active' THEN
                UPDATE groups
                SET member_count = GREATEST(member_count - 1, 0)
                WHERE id = OLD.group_id;
            END IF;

            IF NEW.status = 'active' THEN
                UPDATE groups
                SET member_count = member_count + 1
                WHERE id = NEW.group_id;
            END IF;
        ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
            IF OLD.status = 'active' AND NEW.status <> 'active' THEN
                UPDATE groups
                SET member_count = GREATEST(member_count - 1, 0)
                WHERE id = NEW.group_id;
            ELSIF OLD.status <> 'active' AND NEW.status = 'active' THEN
                UPDATE groups
                SET member_count = member_count + 1
                WHERE id = NEW.group_id;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS memberships_member_count_sync ON memberships;

CREATE TRIGGER memberships_member_count_sync
AFTER INSERT OR UPDATE OF status, group_id OR DELETE ON memberships
FOR EACH ROW
EXECUTE FUNCTION sync_group_member_count();

UPDATE groups g
SET member_count = (
    SELECT COUNT(*)::int
    FROM memberships m
    WHERE m.group_id = g.id
      AND m.status = 'active'
);
