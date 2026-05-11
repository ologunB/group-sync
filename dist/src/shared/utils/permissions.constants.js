"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_ROLES = exports.ADMIN_ROLES = exports.GROUP_ROLES = exports.RolePermissions = exports.PlatformRolePermissions = exports.Permission = void 0;
// ─── Platform-level permissions ───────────────────────────────────────────────
exports.Permission = {
    // Shared by both admin + super_admin
    PLATFORM_ADMIN: 'platform.admin',
    PLATFORM_VIEW_USERS: 'platform.view_users',
    PLATFORM_MANAGE_USERS: 'platform.manage_users',
    PLATFORM_VIEW_REPORTS: 'platform.view_reports',
    PLATFORM_MANAGE_REPORTS: 'platform.manage_reports',
    PLATFORM_MANAGE_GROUPS: 'platform.manage_groups',
    PLATFORM_VIEW_AUDIT_LOGS: 'platform.view_audit_logs',
    // super_admin only
    PLATFORM_MANAGE_ROLES: 'platform.manage_roles',
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
};
// ─── Platform role → permission mapping (embedded in JWT at login) ────────────
//
//  user         – regular app user, no platform access
//  admin        – full platform admin (read/write everything) but CANNOT change roles
//  super_admin  – everything admin can do, PLUS assign/revoke platform roles
const ADMIN_PERMISSIONS = [
    exports.Permission.PLATFORM_ADMIN,
    exports.Permission.PLATFORM_VIEW_USERS,
    exports.Permission.PLATFORM_MANAGE_USERS,
    exports.Permission.PLATFORM_VIEW_REPORTS,
    exports.Permission.PLATFORM_MANAGE_REPORTS,
    exports.Permission.PLATFORM_MANAGE_GROUPS,
    exports.Permission.PLATFORM_VIEW_AUDIT_LOGS,
];
exports.PlatformRolePermissions = {
    user: [],
    admin: ADMIN_PERMISSIONS,
    super_admin: [...ADMIN_PERMISSIONS, exports.Permission.PLATFORM_MANAGE_ROLES],
};
// ─── Group role → permission mapping ─────────────────────────────────────────
exports.RolePermissions = {
    super_admin: [
        exports.Permission.GROUP_MANAGE,
        exports.Permission.GROUP_INVITE,
        exports.Permission.GROUP_MANAGE_MEMBERS,
        exports.Permission.GROUP_MANAGE_CONTENT,
        exports.Permission.GROUP_VIEW_STATS,
        exports.Permission.GROUP_POST_ANNOUNCEMENT,
        exports.Permission.GROUP_MANAGE_EVENTS,
        exports.Permission.GROUP_PIN_MESSAGE,
        exports.Permission.GROUP_DELETE_MESSAGE,
        exports.Permission.GROUP_REVIEW_APPLICATIONS,
    ],
    admin: [
        exports.Permission.GROUP_INVITE,
        exports.Permission.GROUP_MANAGE_MEMBERS,
        exports.Permission.GROUP_MANAGE_CONTENT,
        exports.Permission.GROUP_VIEW_STATS,
        exports.Permission.GROUP_POST_ANNOUNCEMENT,
        exports.Permission.GROUP_MANAGE_EVENTS,
        exports.Permission.GROUP_PIN_MESSAGE,
        exports.Permission.GROUP_DELETE_MESSAGE,
        exports.Permission.GROUP_REVIEW_APPLICATIONS,
    ],
    moderator: [exports.Permission.GROUP_MANAGE_CONTENT, exports.Permission.GROUP_DELETE_MESSAGE],
    member: [],
};
exports.GROUP_ROLES = ['super_admin', 'admin', 'moderator', 'member'];
exports.ADMIN_ROLES = ['super_admin', 'admin'];
exports.PLATFORM_ROLES = ['user', 'admin', 'super_admin'];
//# sourceMappingURL=permissions.constants.js.map