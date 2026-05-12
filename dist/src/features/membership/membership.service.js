"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembershipService = void 0;
const http_status_codes_1 = require("http-status-codes");
const connection_1 = require("../../database/connection");
const connection_2 = require("../../database/connection");
const socket_service_1 = require("../../shared/socket/socket.service");
const encryption_1 = require("../../shared/utils/encryption");
const error_middleware_1 = require("../../shared/middleware/error.middleware");
const response_constants_1 = require("../../shared/utils/response.constants");
const asLogger_1 = require("../../shared/utils/asLogger");
const audit_logger_1 = require("../../shared/utils/audit.logger");
const agenda_1 = require("../../agenda");
const app_config_1 = require("../../shared/config/app.config");
// ─── Role hierarchy for permission checks ─────────────────────────────────────
const ROLE_RANK = {
    super_admin: 4,
    admin: 3,
    moderator: 2,
    member: 1,
};
function callerOutranks(callerRole, targetRole) {
    return (ROLE_RANK[callerRole] ?? 0) > (ROLE_RANK[targetRole] ?? 0);
}
// ─── Redis key for invite cache ───────────────────────────────────────────────
const INVITE_CACHE_TTL = 5 * 60; // 5 minutes
const inviteKey = (token) => `invite:${token}`;
class MembershipService {
    // ── joinGroup ───────────────────────────────────────────────────────────────
    // Open groups only. Caller must be verified (enforced via authenticateVerified).
    // Idempotent check — cannot join if already active member.
    // Banned users cannot re-join.
    async joinGroup(groupId, actor) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, name: true, membershipType: true, status: true, deletedAt: true },
            });
            if (!group || group.deletedAt || group.status !== 'active') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (group.membershipType !== 'open') {
                const msg = group.membershipType === 'application'
                    ? 'This group requires an application. Use POST /groups/:id/apply instead.'
                    : 'This group is invite-only. You need an invite link to join.';
                throw new error_middleware_1.ApiError(msg, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Check existing membership
            const existing = await connection_1.prisma.membership.findUnique({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                select: { status: true },
            });
            if (existing?.status === 'active') {
                throw new error_middleware_1.ApiError('You are already a member of this group.', http_status_codes_1.StatusCodes.CONFLICT);
            }
            if (existing?.status === 'banned') {
                throw new error_middleware_1.ApiError('You have been banned from this group.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Create membership — DB trigger handles member_count increment
            await connection_1.prisma.membership.create({
                data: { userId: actor.userId, groupId, role: 'member', status: 'active' },
            });
            // Notify group admins
            const admins = await connection_1.prisma.membership.findMany({
                where: { groupId, role: { in: ['super_admin', 'admin'] }, status: 'active' },
                select: { userId: true },
            });
            await agenda_1.AgendaManager.runNow('notify-group-members', {
                groupId,
                groupName: group.name,
                type: 'member_joined',
                memberIds: admins.map((a) => a.userId),
                data: { newMemberId: actor.userId },
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_JOIN, audit_logger_1.ResourceTypes.MEMBERSHIP, groupId, 1, { groupName: group.name });
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_JOIN, audit_logger_1.ResourceTypes.MEMBERSHIP, groupId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.joinGroup:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── applyToGroup ────────────────────────────────────────────────────────────
    // Application-based groups only.
    // Validates form_responses against group_forms.fields if a form exists.
    // Allows re-application if previous was rejected.
    async applyToGroup(groupId, dto, actor) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId },
                select: {
                    id: true,
                    name: true,
                    membershipType: true,
                    status: true,
                    deletedAt: true,
                    groupForm: { select: { fields: true } },
                },
            });
            if (!group || group.deletedAt || group.status !== 'active') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (group.membershipType !== 'application') {
                const msg = group.membershipType === 'open'
                    ? 'This group is open. Use POST /groups/:id/join instead.'
                    : 'This group is invite-only. You need an invite link to join.';
                throw new error_middleware_1.ApiError(msg, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Check membership — banned users cannot apply
            const membership = await connection_1.prisma.membership.findUnique({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                select: { status: true },
            });
            if (membership?.status === 'active') {
                throw new error_middleware_1.ApiError('You are already a member of this group.', http_status_codes_1.StatusCodes.CONFLICT);
            }
            if (membership?.status === 'banned') {
                throw new error_middleware_1.ApiError('You have been banned from this group.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Check for existing pending or approved application
            const existingApp = await connection_1.prisma.application.findUnique({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                select: { id: true, status: true },
            });
            if (existingApp?.status === 'pending') {
                throw new error_middleware_1.ApiError('You already have a pending application for this group.', http_status_codes_1.StatusCodes.CONFLICT);
            }
            if (existingApp?.status === 'approved') {
                throw new error_middleware_1.ApiError('Your previous application was approved. You are already a member.', http_status_codes_1.StatusCodes.CONFLICT);
            }
            // Validate required form fields if a form exists
            if (group.groupForm) {
                const fields = group.groupForm.fields;
                const responses = dto.form_responses ?? {};
                const missingRequired = fields
                    .filter((f) => f.required && !responses[f.id])
                    .map((f) => f.label);
                if (missingRequired.length > 0) {
                    throw new error_middleware_1.ApiError(`Missing required form fields: ${missingRequired.join(', ')}`, http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
                }
            }
            // Delete rejected or withdrawn application if exists (allow re-application)
            if (existingApp?.status === 'rejected' || existingApp?.status === 'withdrawn') {
                await connection_1.prisma.application.delete({ where: { id: existingApp.id } });
            }
            const application = await connection_1.prisma.application.create({
                data: {
                    userId: actor.userId,
                    groupId,
                    status: 'pending',
                    formResponses: (dto.form_responses ?? {}),
                },
                select: { id: true, status: true },
            });
            // Notify group admins
            const admins = await connection_1.prisma.membership.findMany({
                where: { groupId, role: { in: ['super_admin', 'admin'] }, status: 'active' },
                select: { userId: true },
            });
            await agenda_1.AgendaManager.runNow('notify-group-members', {
                groupId,
                groupName: group.name,
                type: 'application_submitted',
                memberIds: admins.map((a) => a.userId),
                data: { applicantId: actor.userId, applicationId: application.id },
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_APPLY, audit_logger_1.ResourceTypes.APPLICATION, application.id, 1, { groupId, groupName: group.name });
            return { applicationId: application.id, status: application.status };
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_APPLY, audit_logger_1.ResourceTypes.APPLICATION, null, 0, { groupId, error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.applyToGroup:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── leaveGroup ──────────────────────────────────────────────────────────────
    // Deletes the membership row (not a soft delete).
    // Blocked if caller is super_admin and other active members remain.
    // DB trigger handles member_count decrement.
    async leaveGroup(groupId, actor) {
        try {
            const membership = await connection_1.prisma.membership.findUnique({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                select: { id: true, role: true, status: true },
            });
            if (!membership || membership.status !== 'active') {
                throw new error_middleware_1.ApiError('You are not an active member of this group.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // super_admin cannot leave if other members exist
            if (membership.role === 'super_admin') {
                const otherMembersCount = await connection_1.prisma.membership.count({
                    where: { groupId, status: 'active', userId: { not: actor.userId } },
                });
                if (otherMembersCount > 0) {
                    throw new error_middleware_1.ApiError('You are the group owner and cannot leave while other members exist. ' +
                        'Transfer ownership first via PATCH /groups/:id/members/:userId.', http_status_codes_1.StatusCodes.FORBIDDEN);
                }
            }
            // Delete membership row — trigger decrements member_count
            await connection_1.prisma.membership.delete({
                where: { userId_groupId: { userId: actor.userId, groupId } },
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_LEAVE, audit_logger_1.ResourceTypes.MEMBERSHIP, groupId, 1, {});
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_LEAVE, audit_logger_1.ResourceTypes.MEMBERSHIP, groupId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.leaveGroup:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getApplications ─────────────────────────────────────────────────────────
    async getApplications(groupId, page, limit, status) {
        try {
            const skip = (page - 1) * limit;
            const where = { groupId };
            if (status)
                where.status = status;
            const [applications, total] = await Promise.all([
                connection_1.prisma.application.findMany({
                    where,
                    select: {
                        id: true,
                        userId: true,
                        groupId: true,
                        status: true,
                        formResponses: true,
                        rejectionReason: true,
                        reviewedBy: true,
                        submittedAt: true,
                        reviewedAt: true,
                        user: {
                            select: {
                                displayName: true,
                                username: true,
                                profilePhotoUrl: true,
                            },
                        },
                    },
                    orderBy: { submittedAt: 'desc' },
                    skip,
                    take: limit,
                }),
                connection_1.prisma.application.count({ where }),
            ]);
            return {
                data: applications,
                pagination: { page, limit, total },
            };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.getApplications:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── reviewApplication ───────────────────────────────────────────────────────
    // Approve or reject a pending application.
    // On approval: creates a membership record.
    // On rejection: stores rejection_reason.
    // Both: notify the applicant.
    async reviewApplication(applicationId, dto, actor) {
        try {
            const application = await connection_1.prisma.application.findUnique({
                where: { id: applicationId },
                select: {
                    id: true,
                    userId: true,
                    groupId: true,
                    status: true,
                    group: { select: { name: true } },
                    user: { select: { email: true, displayName: true } },
                },
            });
            if (!application) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Application'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Verify caller is admin of this specific group
            const callerMembership = await connection_1.prisma.membership.findUnique({
                where: {
                    userId_groupId: { userId: actor.userId, groupId: application.groupId },
                },
                select: { role: true, status: true },
            });
            if (!callerMembership ||
                callerMembership.status !== 'active' ||
                !['super_admin', 'admin'].includes(callerMembership.role)) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            if (application.status !== 'pending') {
                throw new error_middleware_1.ApiError(`This application has already been ${application.status}. Only pending applications can be reviewed.`, http_status_codes_1.StatusCodes.CONFLICT);
            }
            if (dto.action === 'approve') {
                await connection_1.prisma.$transaction(async (tx) => {
                    await tx.application.update({
                        where: { id: applicationId },
                        data: {
                            status: 'approved',
                            reviewedBy: actor.userId,
                            reviewedAt: new Date(),
                        },
                    });
                    // Create membership — trigger increments member_count
                    await tx.membership.create({
                        data: {
                            userId: application.userId,
                            groupId: application.groupId,
                            role: 'member',
                            status: 'active',
                        },
                    });
                });
                // Notify applicant
                await agenda_1.AgendaManager.sendEmail({
                    to: application.user.email,
                    subject: `Your application to ${application.group.name} was approved`,
                    template: 'application_approved',
                    data: {
                        displayName: application.user.displayName,
                        groupName: application.group.name,
                        clientUrl: app_config_1.config.server.clientUrl,
                    },
                });
            }
            else {
                // Reject
                await connection_1.prisma.application.update({
                    where: { id: applicationId },
                    data: {
                        status: 'rejected',
                        rejectionReason: dto.rejection_reason?.trim() ?? null,
                        reviewedBy: actor.userId,
                        reviewedAt: new Date(),
                    },
                });
                await agenda_1.AgendaManager.sendEmail({
                    to: application.user.email,
                    subject: `Your application to ${application.group.name} was not approved`,
                    template: 'application_rejected',
                    data: {
                        displayName: application.user.displayName,
                        groupName: application.group.name,
                        rejectionReason: dto.rejection_reason ?? 'No reason provided.',
                        clientUrl: app_config_1.config.server.clientUrl,
                    },
                });
            }
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_APPLICATION_REVIEW, audit_logger_1.ResourceTypes.APPLICATION, applicationId, 1, { action: dto.action, groupId: application.groupId });
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_APPLICATION_REVIEW, audit_logger_1.ResourceTypes.APPLICATION, applicationId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.reviewApplication:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── withdrawApplication ─────────────────────────────────────────────────────
    // Only the applicant can withdraw their own pending application.
    async withdrawApplication(applicationId, actor) {
        try {
            const application = await connection_1.prisma.application.findUnique({
                where: { id: applicationId },
                select: { id: true, userId: true, status: true },
            });
            if (!application) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Application'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (application.userId !== actor.userId) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            if (application.status !== 'pending') {
                throw new error_middleware_1.ApiError(`Only pending applications can be withdrawn. This application is ${application.status}.`, http_status_codes_1.StatusCodes.CONFLICT);
            }
            await connection_1.prisma.application.update({
                where: { id: applicationId },
                data: { status: 'withdrawn' },
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_APPLICATION_WITHDRAW, audit_logger_1.ResourceTypes.APPLICATION, applicationId, 1, {});
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_APPLICATION_WITHDRAW, audit_logger_1.ResourceTypes.APPLICATION, applicationId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.withdrawApplication:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getGroupForm ────────────────────────────────────────────────────────────
    async getGroupForm(groupId) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, deletedAt: true, status: true },
            });
            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const form = await connection_1.prisma.groupForm.findUnique({
                where: { groupId },
                select: { id: true, fields: true, updatedAt: true },
            });
            if (!form)
                return null;
            return { fields: form.fields };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.getGroupForm:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── upsertGroupForm ─────────────────────────────────────────────────────────
    // Creates or replaces the application form for a group.
    async upsertGroupForm(groupId, dto, actor) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, deletedAt: true, status: true },
            });
            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const form = await connection_1.prisma.groupForm.upsert({
                where: { groupId },
                create: { groupId, fields: dto.fields },
                update: { fields: dto.fields },
                select: { fields: true },
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_FORM_UPSERT, audit_logger_1.ResourceTypes.GROUP_FORM, groupId, 1, { fieldCount: dto.fields.length });
            return { fields: form.fields };
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_FORM_UPSERT, audit_logger_1.ResourceTypes.GROUP_FORM, groupId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.upsertGroupForm:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── updateMember ────────────────────────────────────────────────────────────
    // Promote/demote/suspend/ban a group member.
    // Role hierarchy rules:
    //   - Cannot modify super_admin
    //   - Admin cannot modify another admin (only super_admin can)
    //   - Can only assign roles BELOW your own rank
    async updateMember(groupId, targetUserId, dto, actor) {
        try {
            if (!dto.role && !dto.status) {
                throw new error_middleware_1.ApiError('Provide at least one of: role, status.', http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            const [callerMembership, targetMembership] = await Promise.all([
                connection_1.prisma.membership.findUnique({
                    where: { userId_groupId: { userId: actor.userId, groupId } },
                    select: { role: true, status: true },
                }),
                connection_1.prisma.membership.findUnique({
                    where: { userId_groupId: { userId: targetUserId, groupId } },
                    select: { id: true, role: true, status: true },
                }),
            ]);
            if (!callerMembership || callerMembership.status !== 'active') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            if (!targetMembership) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Member'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Cannot touch the super_admin
            if (targetMembership.role === 'super_admin') {
                throw new error_middleware_1.ApiError('The group owner cannot be modified. Transfer ownership first.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Admin cannot modify another admin
            if (callerMembership.role === 'admin' &&
                targetMembership.role === 'admin') {
                throw new error_middleware_1.ApiError('Admins cannot modify other admins. Only the group owner can.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Caller must outrank the target to modify them
            if (!callerOutranks(callerMembership.role, targetMembership.role)) {
                throw new error_middleware_1.ApiError('You can only modify members with a lower role than your own.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // If promoting, caller must outrank the new role too
            if (dto.role && !callerOutranks(callerMembership.role, dto.role)) {
                throw new error_middleware_1.ApiError('You cannot assign a role equal to or higher than your own.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            const updateData = {};
            if (dto.role)
                updateData.role = dto.role;
            if (dto.status)
                updateData.status = dto.status;
            await connection_1.prisma.membership.update({
                where: { userId_groupId: { userId: targetUserId, groupId } },
                data: updateData,
            });
            // Kick from socket room if suspended or banned
            if (dto.status === 'suspended' || dto.status === 'banned') {
                socket_service_1.SocketService.kickFromRoom(targetUserId, groupId);
            }
            // Notify the affected member
            await agenda_1.AgendaManager.runNow('notify-group-members', {
                groupId,
                type: 'membership_updated',
                memberIds: [targetUserId],
                data: { role: dto.role, status: dto.status, updatedBy: actor.userId },
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_MEMBER_UPDATE, audit_logger_1.ResourceTypes.MEMBERSHIP, groupId, 1, { targetUserId, role: dto.role, status: dto.status });
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_MEMBER_UPDATE, audit_logger_1.ResourceTypes.MEMBERSHIP, groupId, 0, { targetUserId, error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.updateMember:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── removeMember ────────────────────────────────────────────────────────────
    // Removes a member from the group (deletes membership row).
    // Same role hierarchy rules as updateMember.
    // Super_admin cannot be removed.
    async removeMember(groupId, targetUserId, actor) {
        try {
            const [callerMembership, targetMembership] = await Promise.all([
                connection_1.prisma.membership.findUnique({
                    where: { userId_groupId: { userId: actor.userId, groupId } },
                    select: { role: true, status: true },
                }),
                connection_1.prisma.membership.findUnique({
                    where: { userId_groupId: { userId: targetUserId, groupId } },
                    select: { id: true, role: true },
                }),
            ]);
            if (!callerMembership || callerMembership.status !== 'active') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            if (!targetMembership) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Member'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (targetMembership.role === 'super_admin') {
                throw new error_middleware_1.ApiError('The group owner cannot be removed.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            if (callerMembership.role === 'admin' &&
                targetMembership.role === 'admin') {
                throw new error_middleware_1.ApiError('Admins cannot remove other admins. Only the group owner can.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            if (!callerOutranks(callerMembership.role, targetMembership.role)) {
                throw new error_middleware_1.ApiError('You can only remove members with a lower role than your own.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Delete membership row — trigger decrements member_count
            await connection_1.prisma.membership.delete({
                where: { userId_groupId: { userId: targetUserId, groupId } },
            });
            // Force-remove from socket room
            socket_service_1.SocketService.kickFromRoom(targetUserId, groupId);
            // Notify removed member
            await agenda_1.AgendaManager.runNow('notify-group-members', {
                groupId,
                type: 'membership_updated',
                memberIds: [targetUserId],
                data: { action: 'removed', removedBy: actor.userId },
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_MEMBER_REMOVE, audit_logger_1.ResourceTypes.MEMBERSHIP, groupId, 1, { targetUserId });
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_MEMBER_REMOVE, audit_logger_1.ResourceTypes.MEMBERSHIP, groupId, 0, { targetUserId, error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.removeMember:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── generateInviteLink ──────────────────────────────────────────────────────
    // Generates a cryptographically random 32-char hex invite token.
    // Caches token → groupId in Redis for fast validation.
    async generateInviteLink(groupId, dto, actor) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, deletedAt: true, status: true },
            });
            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const token = encryption_1.EncryptionUtil.generateRandomToken(32); // 64-char hex
            const expiresAt = dto.expires_in_hours
                ? new Date(Date.now() + dto.expires_in_hours * 60 * 60 * 1000)
                : null;
            const inviteLink = await connection_1.prisma.inviteLink.create({
                data: {
                    groupId,
                    token,
                    createdBy: actor.userId,
                    maxUses: dto.max_uses ?? null,
                    expiresAt,
                },
                select: {
                    id: true,
                    token: true,
                    maxUses: true,
                    useCount: true,
                    expiresAt: true,
                    revokedAt: true,
                    createdAt: true,
                    creator: {
                        select: { displayName: true, username: true },
                    },
                },
            });
            // Cache for fast lookups
            await connection_2.redis.setex(inviteKey(token), INVITE_CACHE_TTL, groupId);
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_INVITE_GENERATE, audit_logger_1.ResourceTypes.INVITE_LINK, inviteLink.id, 1, { groupId, maxUses: dto.max_uses, expiresAt });
            return {
                id: inviteLink.id,
                token: inviteLink.token,
                inviteUrl: `${app_config_1.config.server.clientUrl}/invite/${inviteLink.token}`,
                maxUses: inviteLink.maxUses,
                useCount: inviteLink.useCount,
                expiresAt: inviteLink.expiresAt,
                revokedAt: inviteLink.revokedAt,
                createdAt: inviteLink.createdAt,
                createdBy: inviteLink.creator ? {
                    displayName: inviteLink.creator.displayName,
                    username: inviteLink.creator.username,
                } : null,
            };
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_INVITE_GENERATE, audit_logger_1.ResourceTypes.INVITE_LINK, null, 0, { groupId, error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.generateInviteLink:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getInviteLinks ──────────────────────────────────────────────────────────
    async getInviteLinks(groupId) {
        try {
            const links = await connection_1.prisma.inviteLink.findMany({
                where: { groupId, revokedAt: null },
                select: {
                    id: true,
                    token: true,
                    maxUses: true,
                    useCount: true,
                    expiresAt: true,
                    revokedAt: true,
                    createdAt: true,
                    creator: { select: { displayName: true, username: true } },
                },
                orderBy: { createdAt: 'desc' },
            });
            return links.map((l) => ({
                id: l.id,
                token: l.token,
                inviteUrl: `${app_config_1.config.server.clientUrl}/invite/${l.token}`,
                maxUses: l.maxUses,
                useCount: l.useCount,
                expiresAt: l.expiresAt,
                revokedAt: l.revokedAt,
                createdAt: l.createdAt,
                createdBy: l.creator ? {
                    displayName: l.creator.displayName,
                    username: l.creator.username,
                } : null,
            }));
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.getInviteLinks:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── revokeInviteLink ────────────────────────────────────────────────────────
    async revokeInviteLink(inviteLinkId, actor) {
        try {
            const link = await connection_1.prisma.inviteLink.findUnique({
                where: { id: inviteLinkId },
                select: { id: true, token: true, groupId: true, revokedAt: true },
            });
            if (!link) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Invite link'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (link.revokedAt) {
                throw new error_middleware_1.ApiError('This invite link has already been revoked.', http_status_codes_1.StatusCodes.CONFLICT);
            }
            await connection_1.prisma.inviteLink.update({
                where: { id: inviteLinkId },
                data: { revokedAt: new Date() },
            });
            // Remove from Redis cache
            await connection_2.redis.del(inviteKey(link.token));
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_INVITE_REVOKE, audit_logger_1.ResourceTypes.INVITE_LINK, inviteLinkId, 1, { groupId: link.groupId });
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_INVITE_REVOKE, audit_logger_1.ResourceTypes.INVITE_LINK, inviteLinkId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.revokeInviteLink:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── acceptInvite ────────────────────────────────────────────────────────────
    // Resolves the token: Redis cache first, then DB fallback.
    // Validates: not revoked, not expired, use_count < max_uses.
    // Atomically increments use_count and creates membership.
    async acceptInvite(token, actor) {
        try {
            // 1. Redis cache lookup (fast path)
            let groupId = await connection_2.redis.get(inviteKey(token));
            // 2. DB fallback if not cached
            const inviteLink = await connection_1.prisma.inviteLink.findUnique({
                where: { token },
                select: {
                    id: true,
                    groupId: true,
                    maxUses: true,
                    useCount: true,
                    expiresAt: true,
                    revokedAt: true,
                    group: { select: { name: true, status: true, deletedAt: true } },
                },
            });
            if (!inviteLink) {
                throw new error_middleware_1.ApiError('This invite link is invalid or does not exist.', http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (!groupId) {
                groupId = inviteLink.groupId;
            }
            // Validation checks
            if (inviteLink.revokedAt) {
                throw new error_middleware_1.ApiError('This invite link has been revoked.', http_status_codes_1.StatusCodes.GONE);
            }
            if (inviteLink.expiresAt && inviteLink.expiresAt < new Date()) {
                throw new error_middleware_1.ApiError('This invite link has expired.', http_status_codes_1.StatusCodes.GONE);
            }
            if (inviteLink.maxUses !== null && inviteLink.useCount >= inviteLink.maxUses) {
                throw new error_middleware_1.ApiError('This invite link has reached its maximum number of uses.', http_status_codes_1.StatusCodes.GONE);
            }
            if (!inviteLink.group || inviteLink.group.deletedAt || inviteLink.group.status !== 'active') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Check existing membership
            const existing = await connection_1.prisma.membership.findUnique({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                select: { status: true },
            });
            if (existing?.status === 'active') {
                throw new error_middleware_1.ApiError('You are already a member of this group.', http_status_codes_1.StatusCodes.CONFLICT);
            }
            if (existing?.status === 'banned') {
                throw new error_middleware_1.ApiError('You have been banned from this group.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Atomically increment use_count and create membership
            await connection_1.prisma.$transaction(async (tx) => {
                await tx.inviteLink.update({
                    where: { id: inviteLink.id },
                    data: { useCount: { increment: 1 } },
                });
                await tx.membership.create({
                    data: { userId: actor.userId, groupId, role: 'member', status: 'active' },
                });
            });
            // Refresh Redis cache TTL
            await connection_2.redis.setex(inviteKey(token), INVITE_CACHE_TTL, groupId);
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_INVITE_ACCEPT, audit_logger_1.ResourceTypes.MEMBERSHIP, groupId, 1, { token: token.slice(0, 8) + '...', groupName: inviteLink.group.name });
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_INVITE_ACCEPT, audit_logger_1.ResourceTypes.MEMBERSHIP, null, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MembershipService.acceptInvite:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.MembershipService = MembershipService;
//# sourceMappingURL=membership.service.js.map