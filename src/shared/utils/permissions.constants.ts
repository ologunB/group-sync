// Platform-level permissions
export const Permission = {
    PLATFORM_ADMIN: 'platform.admin',
    PLATFORM_VIEW_USERS: 'platform.view_users',
    PLATFORM_MANAGE_USERS: 'platform.manage_users',
    PLATFORM_VIEW_REPORTS: 'platform.view_reports',
    PLATFORM_MANAGE_REPORTS: 'platform.manage_reports',
    PLATFORM_MANAGE_GROUPS: 'platform.manage_groups',
    PLATFORM_VIEW_AUDIT_LOGS: 'platform.view_audit_logs',

    // Group-scoped permissions (resolved per request via authorizeGroupRole)
    GROUP_MANAGE: 'group.manage',
    GROUP_INVITE: 'group.invite',
    GROUP_MANAGE_MEMBERS: 'group.manage_members',
    GROUP_MANAGE_CONTENT: 'group.manage_content',
    GROUP_VIEW_STATS: 'group.view_stats',
    GROUP_POST_ANNOUNCEMENT: 'group.post_announcement',
    GROUP_MANAGE_EVENTS: 'group.manage_events',
    GROUP_PIN_MESSAGE: 'group.pin_message',
    GROUP_DELETE_MESSAGE: 'group.delete_message',
    GROUP_REVIEW_APPLICATIONS: 'group.review_applications',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

// Permissions granted to each group role
export const RolePermissions: Record<string, PermissionKey[]> = {
    super_admin: [
        Permission.GROUP_MANAGE,
        Permission.GROUP_INVITE,
        Permission.GROUP_MANAGE_MEMBERS,
        Permission.GROUP_MANAGE_CONTENT,
        Permission.GROUP_VIEW_STATS,
        Permission.GROUP_POST_ANNOUNCEMENT,
        Permission.GROUP_MANAGE_EVENTS,
        Permission.GROUP_PIN_MESSAGE,
        Permission.GROUP_DELETE_MESSAGE,
        Permission.GROUP_REVIEW_APPLICATIONS,
    ],
    admin: [
        Permission.GROUP_INVITE,
        Permission.GROUP_MANAGE_MEMBERS,
        Permission.GROUP_MANAGE_CONTENT,
        Permission.GROUP_VIEW_STATS,
        Permission.GROUP_POST_ANNOUNCEMENT,
        Permission.GROUP_MANAGE_EVENTS,
        Permission.GROUP_PIN_MESSAGE,
        Permission.GROUP_DELETE_MESSAGE,
        Permission.GROUP_REVIEW_APPLICATIONS,
    ],
    moderator: [Permission.GROUP_MANAGE_CONTENT, Permission.GROUP_DELETE_MESSAGE],
    member: [],
    platform_admin: [
        Permission.PLATFORM_ADMIN,
        Permission.PLATFORM_VIEW_USERS,
        Permission.PLATFORM_MANAGE_USERS,
        Permission.PLATFORM_VIEW_REPORTS,
        Permission.PLATFORM_MANAGE_REPORTS,
        Permission.PLATFORM_MANAGE_GROUPS,
        Permission.PLATFORM_VIEW_AUDIT_LOGS,
    ],
};

export const GROUP_ROLES = ['super_admin', 'admin', 'moderator', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const ADMIN_ROLES: GroupRole[] = ['super_admin', 'admin'];
export const PLATFORM_ROLES = ['user', 'platform_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
