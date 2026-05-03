import { prisma } from '../../database/connection';

/**
 * Convert any string into a URL-safe slug.
 * Strips non-alphanumeric characters, collapses spaces to hyphens.
 */
export function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')   // strip special chars
        .trim()
        .replace(/\s+/g, '-')            // spaces → hyphens
        .replace(/-+/g, '-')             // collapse multiple hyphens
        .slice(0, 150);                  // leave room for collision suffix
}

/**
 * Generate a slug from a group name that is guaranteed unique in the DB.
 * Tries base slug first, then appends -2 through -10.
 * Throws if no unique slug is found within 10 attempts.
 */
export async function generateUniqueGroupSlug(name: string): Promise<string> {
    const base = slugify(name);

    if (!base) {
        throw new Error('Group name produced an empty slug. Use at least one alphanumeric character.');
    }

    const existing = await prisma.group.findUnique({
        where: { slug: base },
        select: { id: true },
    });

    if (!existing) return base;

    for (let i = 2; i <= 10; i++) {
        const candidate = `${base}-${i}`;
        const taken = await prisma.group.findUnique({
            where: { slug: candidate },
            select: { id: true },
        });
        if (!taken) return candidate;
    }

    throw new Error(
        `Could not generate a unique slug for "${name}" after 10 attempts. ` +
        'Please choose a slightly different group name.',
    );
}
