import { StatusCodes } from 'http-status-codes';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/connection';
import { redis } from '../../database/connection';
import { SocketService } from '../../shared/socket/socket.service';
import { EncryptionUtil } from '../../shared/utils/encryption';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { AgendaManager } from '../../agenda';
import { config } from '../../shared/config/app.config';
import { TokenPayload } from '../../shared/types/common.types';
import {
    ApplyToGroupDTO,
    ReviewApplicationDTO,
    UpdateMemberDTO,
    CreateInviteLinkDTO,
    UpsertGroupFormDTO,
    ApplicationItem,
    InviteLinkItem,
    PaginatedResult,
} from './membership.types';

// ─── Role hierarchy for permission checks ─────────────────────────────────────

const ROLE_RANK: Record<string, number> = {
    super_admin: 4,
    admin:       3,
    moderator:   2,
    member:      1,
};

function callerOutranks(callerRole: string, targetRole: string): boolean {
    return (ROLE_RANK[callerRole] ?? 0) > (ROLE_RANK[targetRole] ?? 0);
}

// ─── Redis key for invite cache ───────────────────────────────────────────────

const INVITE_CACHE_TTL = 5 * 60; // 5 minutes
const inviteKey = (token: string) => `invite:${token}`;

export class MembershipService {
    // ── joinGroup ───────────────────────────────────────────────────────────────
    // Open groups only. Caller must be verified (enforced via authenticateVerified).
    // Idempotent check — cannot join if already active member.
    // Banned users cannot re-join.

    async joinGroup(groupId: string, actor: TokenPayload): Promise<void> {
        try {
            const group = await prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, name: true, membershipType: true, status: true, deletedAt: true },
            });

            if (!group || group.deletedAt || group.status !== 'active') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            if (group.membershipType !== 'open') {
                const msg =
                    group.membershipType === 'application'
                        ? 'This group requires an application. Use POST /groups/:id/apply instead.'
                        : 'This group is invite-only. You need an invite link to join.';
                throw new ApiError(msg, StatusCodes.FORBIDDEN);
            }

            // Check existing membership
            const existing = await prisma.membership.findUnique({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                select: { status: true },
            });

            if (existing?.status === 'active') {
                throw new ApiError('You are already a member of this group.', StatusCodes.CONFLICT);
            }

            if (existing?.status === 'banned') {
                throw new ApiError('You have been banned from this group.', StatusCodes.FORBIDDEN);
            }

            // Create membership — DB trigger handles member_count increment
            await prisma.membership.create({
                data: { userId: actor.userId, groupId, role: 'member', status: 'active' },
            });

            // Notify group admins
            const admins = await prisma.membership.findMany({
                where: { groupId, role: { in: ['super_admin', 'admin'] }, status: 'active' },
                select: { userId: true },
            });

            await AgendaManager.runNow('notify-group-members', {
                groupId,
                groupName: group.name,
                type: 'member_joined',
                memberIds: admins.map((a) => a.userId),
                data: { newMemberId: actor.userId },
            });

            await AuditLogger.log(
                actor, LogActions.GROUP_JOIN, ResourceTypes.MEMBERSHIP, groupId, 1,
                { groupName: group.name },
            );
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_JOIN, ResourceTypes.MEMBERSHIP, groupId, 0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.joinGroup:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── applyToGroup ────────────────────────────────────────────────────────────
    // Application-based groups only.
    // Validates form_responses against group_forms.fields if a form exists.
    // Allows re-application if previous was rejected.

    async applyToGroup(
        groupId: string,
        dto: ApplyToGroupDTO,
        actor: TokenPayload,
    ): Promise<{ applicationId: string; status: string }> {
        try {
            const group = await prisma.group.findUnique({
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
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            if (group.membershipType !== 'application') {
                const msg =
                    group.membershipType === 'open'
                        ? 'This group is open. Use POST /groups/:id/join instead.'
                        : 'This group is invite-only. You need an invite link to join.';
                throw new ApiError(msg, StatusCodes.FORBIDDEN);
            }

            // Check membership — banned users cannot apply
            const membership = await prisma.membership.findUnique({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                select: { status: true },
            });

            if (membership?.status === 'active') {
                throw new ApiError('You are already a member of this group.', StatusCodes.CONFLICT);
            }

            if (membership?.status === 'banned') {
                throw new ApiError('You have been banned from this group.', StatusCodes.FORBIDDEN);
            }

            // Check for existing pending or approved application
            const existingApp = await prisma.application.findUnique({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                select: { id: true, status: true },
            });

            if (existingApp?.status === 'pending') {
                throw new ApiError(
                    'You already have a pending application for this group.',
                    StatusCodes.CONFLICT,
                );
            }

            if (existingApp?.status === 'approved') {
                throw new ApiError(
                    'Your previous application was approved. You are already a member.',
                    StatusCodes.CONFLICT,
                );
            }

            // Validate required form fields if a form exists
            if (group.groupForm) {
                const fields = group.groupForm.fields as Array<{
                    id: string;
                    required: boolean;
                    label: string;
                }>;
                const responses = dto.form_responses ?? {};
                const missingRequired = fields
                    .filter((f) => f.required && !responses[f.id])
                    .map((f) => f.label);

                if (missingRequired.length > 0) {
                    throw new ApiError(
                        `Missing required form fields: ${missingRequired.join(', ')}`,
                        StatusCodes.UNPROCESSABLE_ENTITY,
                    );
                }
            }

            // Delete rejected or withdrawn application if exists (allow re-application)
            if (existingApp?.status === 'rejected' || existingApp?.status === 'withdrawn') {
                await prisma.application.delete({ where: { id: existingApp.id } });
            }

            const application = await prisma.application.create({
                data: {
                    userId:        actor.userId,
                    groupId,
                    status:        'pending',
                    formResponses: (dto.form_responses ?? {}) as Prisma.InputJsonValue,
                },
                select: { id: true, status: true },
            });

            // Notify group admins
            const admins = await prisma.membership.findMany({
                where: { groupId, role: { in: ['super_admin', 'admin'] }, status: 'active' },
                select: { userId: true },
            });

            await AgendaManager.runNow('notify-group-members', {
                groupId,
                groupName: group.name,
                type: 'application_submitted',
                memberIds: admins.map((a) => a.userId),
                data: { applicantId: actor.userId, applicationId: application.id },
            });

            await AuditLogger.log(
                actor, LogActions.GROUP_APPLY, ResourceTypes.APPLICATION, application.id, 1,
                { groupId, groupName: group.name },
            );

            return { applicationId: application.id, status: application.status };
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_APPLY, ResourceTypes.APPLICATION, null, 0,
                { groupId, error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.applyToGroup:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── leaveGroup ──────────────────────────────────────────────────────────────
    // Deletes the membership row (not a soft delete).
    // Blocked if caller is super_admin and other active members remain.
    // DB trigger handles member_count decrement.

    async leaveGroup(groupId: string, actor: TokenPayload): Promise<void> {
        try {
            const membership = await prisma.membership.findUnique({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                select: { id: true, role: true, status: true },
            });

            if (!membership || membership.status !== 'active') {
                throw new ApiError('You are not an active member of this group.', StatusCodes.FORBIDDEN);
            }

            // super_admin cannot leave if other members exist
            if (membership.role === 'super_admin') {
                const otherMembersCount = await prisma.membership.count({
                    where: { groupId, status: 'active', userId: { not: actor.userId } },
                });

                if (otherMembersCount > 0) {
                    throw new ApiError(
                        'You are the group owner and cannot leave while other members exist. ' +
                        'Transfer ownership first via PATCH /groups/:id/members/:userId.',
                        StatusCodes.FORBIDDEN,
                    );
                }
            }

            // Delete membership row — trigger decrements member_count
            await prisma.membership.delete({
                where: { userId_groupId: { userId: actor.userId, groupId } },
            });

            await AuditLogger.log(
                actor, LogActions.GROUP_LEAVE, ResourceTypes.MEMBERSHIP, groupId, 1, {},
            );
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_LEAVE, ResourceTypes.MEMBERSHIP, groupId, 0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.leaveGroup:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── getApplications ─────────────────────────────────────────────────────────

    async getApplications(
        groupId: string,
        page: number,
        limit: number,
        status?: string,
    ): Promise<PaginatedResult<ApplicationItem>> {
        try {
            const skip = (page - 1) * limit;

            const where: Prisma.ApplicationWhereInput = { groupId };
            if (status) where.status = status;

            const [applications, total] = await Promise.all([
                prisma.application.findMany({
                    where,
                    select: {
                        id:              true,
                        userId:          true,
                        groupId:         true,
                        status:          true,
                        formResponses:   true,
                        rejectionReason: true,
                        reviewedBy:      true,
                        submittedAt:     true,
                        reviewedAt:      true,
                        user: {
                            select: {
                                displayName:    true,
                                username:       true,
                                profilePhotoUrl: true,
                            },
                        },
                    },
                    orderBy: { submittedAt: 'desc' },
                    skip,
                    take: limit,
                }),

                prisma.application.count({ where }),
            ]);

            return {
                data:       applications as ApplicationItem[],
                pagination: { page, limit, total },
            };
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.getApplications:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── reviewApplication ───────────────────────────────────────────────────────
    // Approve or reject a pending application.
    // On approval: creates a membership record.
    // On rejection: stores rejection_reason.
    // Both: notify the applicant.

    async reviewApplication(
        applicationId: string,
        dto: ReviewApplicationDTO,
        actor: TokenPayload,
    ): Promise<void> {
        try {
            const application = await prisma.application.findUnique({
                where: { id: applicationId },
                select: {
                    id:      true,
                    userId:  true,
                    groupId: true,
                    status:  true,
                    group:   { select: { name: true } },
                    user:    { select: { email: true, displayName: true } },
                },
            });

            if (!application) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Application'), StatusCodes.NOT_FOUND);
            }

            // Verify caller is admin of this specific group
            const callerMembership = await prisma.membership.findUnique({
                where: {
                    userId_groupId: { userId: actor.userId, groupId: application.groupId },
                },
                select: { role: true, status: true },
            });

            if (
                !callerMembership ||
                callerMembership.status !== 'active' ||
                !['super_admin', 'admin'].includes(callerMembership.role)
            ) {
                throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
            }

            if (application.status !== 'pending') {
                throw new ApiError(
                    `This application has already been ${application.status}. Only pending applications can be reviewed.`,
                    StatusCodes.CONFLICT,
                );
            }

            if (dto.action === 'approve') {
                await prisma.$transaction(async (tx) => {
                    await tx.application.update({
                        where: { id: applicationId },
                        data: {
                            status:     'approved',
                            reviewedBy: actor.userId,
                            reviewedAt: new Date(),
                        },
                    });

                    // Create membership — trigger increments member_count
                    await tx.membership.create({
                        data: {
                            userId:  application.userId,
                            groupId: application.groupId,
                            role:    'member',
                            status:  'active',
                        },
                    });
                });

                // Notify applicant
                await AgendaManager.sendEmail({
                    to:       application.user.email,
                    subject:  `Your application to ${application.group.name} was approved`,
                    template: 'application_approved',
                    data: {
                        displayName: application.user.displayName,
                        groupName:   application.group.name,
                        clientUrl:   config.server.clientUrl,
                    },
                });
            } else {
                // Reject
                await prisma.application.update({
                    where: { id: applicationId },
                    data: {
                        status:          'rejected',
                        rejectionReason: dto.rejection_reason?.trim() ?? null,
                        reviewedBy:      actor.userId,
                        reviewedAt:      new Date(),
                    },
                });

                await AgendaManager.sendEmail({
                    to:       application.user.email,
                    subject:  `Your application to ${application.group.name} was not approved`,
                    template: 'application_rejected',
                    data: {
                        displayName:     application.user.displayName,
                        groupName:       application.group.name,
                        rejectionReason: dto.rejection_reason ?? 'No reason provided.',
                        clientUrl:       config.server.clientUrl,
                    },
                });
            }

            await AuditLogger.log(
                actor, LogActions.GROUP_APPLICATION_REVIEW, ResourceTypes.APPLICATION, applicationId, 1,
                { action: dto.action, groupId: application.groupId },
            );
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_APPLICATION_REVIEW, ResourceTypes.APPLICATION, applicationId, 0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.reviewApplication:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── withdrawApplication ─────────────────────────────────────────────────────
    // Only the applicant can withdraw their own pending application.

    async withdrawApplication(applicationId: string, actor: TokenPayload): Promise<void> {
        try {
            const application = await prisma.application.findUnique({
                where: { id: applicationId },
                select: { id: true, userId: true, status: true },
            });

            if (!application) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Application'), StatusCodes.NOT_FOUND);
            }

            if (application.userId !== actor.userId) {
                throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
            }

            if (application.status !== 'pending') {
                throw new ApiError(
                    `Only pending applications can be withdrawn. This application is ${application.status}.`,
                    StatusCodes.CONFLICT,
                );
            }

            await prisma.application.update({
                where: { id: applicationId },
                data: { status: 'withdrawn' },
            });

            await AuditLogger.log(
                actor, LogActions.GROUP_APPLICATION_WITHDRAW, ResourceTypes.APPLICATION, applicationId, 1, {},
            );
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_APPLICATION_WITHDRAW, ResourceTypes.APPLICATION, applicationId, 0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.withdrawApplication:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── getGroupForm ────────────────────────────────────────────────────────────

    async getGroupForm(groupId: string): Promise<{ fields: unknown[] } | null> {
        try {
            const group = await prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, deletedAt: true, status: true },
            });

            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            const form = await prisma.groupForm.findUnique({
                where: { groupId },
                select: { id: true, fields: true, updatedAt: true },
            });

            if (!form) return null;

            return { fields: form.fields as unknown[] };
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.getGroupForm:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── upsertGroupForm ─────────────────────────────────────────────────────────
    // Creates or replaces the application form for a group.

    async upsertGroupForm(
        groupId: string,
        dto: UpsertGroupFormDTO,
        actor: TokenPayload,
    ): Promise<{ fields: unknown[] }> {
        try {
            const group = await prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, deletedAt: true, status: true },
            });

            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            const form = await prisma.groupForm.upsert({
                where:  { groupId },
                create: { groupId, fields: dto.fields as unknown as Prisma.InputJsonValue },
                update: { fields: dto.fields as unknown as Prisma.InputJsonValue },
                select: { fields: true },
            });

            await AuditLogger.log(
                actor, LogActions.GROUP_FORM_UPSERT, ResourceTypes.GROUP_FORM, groupId, 1,
                { fieldCount: dto.fields.length },
            );

            return { fields: form.fields as unknown[] };
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_FORM_UPSERT, ResourceTypes.GROUP_FORM, groupId, 0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.upsertGroupForm:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── updateMember ────────────────────────────────────────────────────────────
    // Promote/demote/suspend/ban a group member.
    // Role hierarchy rules:
    //   - Cannot modify super_admin
    //   - Admin cannot modify another admin (only super_admin can)
    //   - Can only assign roles BELOW your own rank

    async updateMember(
        groupId: string,
        targetUserId: string,
        dto: UpdateMemberDTO,
        actor: TokenPayload,
    ): Promise<void> {
        try {
            if (!dto.role && !dto.status) {
                throw new ApiError('Provide at least one of: role, status.', StatusCodes.BAD_REQUEST);
            }

            const [callerMembership, targetMembership] = await Promise.all([
                prisma.membership.findUnique({
                    where: { userId_groupId: { userId: actor.userId, groupId } },
                    select: { role: true, status: true },
                }),
                prisma.membership.findUnique({
                    where: { userId_groupId: { userId: targetUserId, groupId } },
                    select: { id: true, role: true, status: true },
                }),
            ]);

            if (!callerMembership || callerMembership.status !== 'active') {
                throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
            }

            if (!targetMembership) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Member'), StatusCodes.NOT_FOUND);
            }

            // Cannot touch the super_admin
            if (targetMembership.role === 'super_admin') {
                throw new ApiError(
                    'The group owner cannot be modified. Transfer ownership first.',
                    StatusCodes.FORBIDDEN,
                );
            }

            // Admin cannot modify another admin
            if (
                callerMembership.role === 'admin' &&
                targetMembership.role === 'admin'
            ) {
                throw new ApiError(
                    'Admins cannot modify other admins. Only the group owner can.',
                    StatusCodes.FORBIDDEN,
                );
            }

            // Caller must outrank the target to modify them
            if (!callerOutranks(callerMembership.role, targetMembership.role)) {
                throw new ApiError(
                    'You can only modify members with a lower role than your own.',
                    StatusCodes.FORBIDDEN,
                );
            }

            // If promoting, caller must outrank the new role too
            if (dto.role && !callerOutranks(callerMembership.role, dto.role)) {
                throw new ApiError(
                    'You cannot assign a role equal to or higher than your own.',
                    StatusCodes.FORBIDDEN,
                );
            }

            const updateData: Prisma.MembershipUpdateInput = {};
            if (dto.role)   updateData.role   = dto.role;
            if (dto.status) updateData.status = dto.status;

            await prisma.membership.update({
                where: { userId_groupId: { userId: targetUserId, groupId } },
                data:  updateData,
            });

            // Kick from socket room if suspended or banned
            if (dto.status === 'suspended' || dto.status === 'banned') {
                SocketService.kickFromRoom(targetUserId, groupId);
            }

            // Notify the affected member
            await AgendaManager.runNow('notify-group-members', {
                groupId,
                type:      'membership_updated',
                memberIds: [targetUserId],
                data:      { role: dto.role, status: dto.status, updatedBy: actor.userId },
            });

            await AuditLogger.log(
                actor, LogActions.GROUP_MEMBER_UPDATE, ResourceTypes.MEMBERSHIP, groupId, 1,
                { targetUserId, role: dto.role, status: dto.status },
            );
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_MEMBER_UPDATE, ResourceTypes.MEMBERSHIP, groupId, 0,
                { targetUserId, error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.updateMember:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── removeMember ────────────────────────────────────────────────────────────
    // Removes a member from the group (deletes membership row).
    // Same role hierarchy rules as updateMember.
    // Super_admin cannot be removed.

    async removeMember(
        groupId: string,
        targetUserId: string,
        actor: TokenPayload,
    ): Promise<void> {
        try {
            const [callerMembership, targetMembership] = await Promise.all([
                prisma.membership.findUnique({
                    where: { userId_groupId: { userId: actor.userId, groupId } },
                    select: { role: true, status: true },
                }),
                prisma.membership.findUnique({
                    where: { userId_groupId: { userId: targetUserId, groupId } },
                    select: { id: true, role: true },
                }),
            ]);

            if (!callerMembership || callerMembership.status !== 'active') {
                throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
            }

            if (!targetMembership) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Member'), StatusCodes.NOT_FOUND);
            }

            if (targetMembership.role === 'super_admin') {
                throw new ApiError('The group owner cannot be removed.', StatusCodes.FORBIDDEN);
            }

            if (
                callerMembership.role === 'admin' &&
                targetMembership.role === 'admin'
            ) {
                throw new ApiError(
                    'Admins cannot remove other admins. Only the group owner can.',
                    StatusCodes.FORBIDDEN,
                );
            }

            if (!callerOutranks(callerMembership.role, targetMembership.role)) {
                throw new ApiError(
                    'You can only remove members with a lower role than your own.',
                    StatusCodes.FORBIDDEN,
                );
            }

            // Delete membership row — trigger decrements member_count
            await prisma.membership.delete({
                where: { userId_groupId: { userId: targetUserId, groupId } },
            });

            // Force-remove from socket room
            SocketService.kickFromRoom(targetUserId, groupId);

            // Notify removed member
            await AgendaManager.runNow('notify-group-members', {
                groupId,
                type:      'membership_updated',
                memberIds: [targetUserId],
                data:      { action: 'removed', removedBy: actor.userId },
            });

            await AuditLogger.log(
                actor, LogActions.GROUP_MEMBER_REMOVE, ResourceTypes.MEMBERSHIP, groupId, 1,
                { targetUserId },
            );
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_MEMBER_REMOVE, ResourceTypes.MEMBERSHIP, groupId, 0,
                { targetUserId, error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.removeMember:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── generateInviteLink ──────────────────────────────────────────────────────
    // Generates a cryptographically random 32-char hex invite token.
    // Caches token → groupId in Redis for fast validation.

    async generateInviteLink(
        groupId: string,
        dto: CreateInviteLinkDTO,
        actor: TokenPayload,
    ): Promise<InviteLinkItem> {
        try {
            const group = await prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, deletedAt: true, status: true },
            });

            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            const token     = EncryptionUtil.generateRandomToken(32); // 64-char hex
            const expiresAt = dto.expires_in_hours
                ? new Date(Date.now() + dto.expires_in_hours * 60 * 60 * 1000)
                : null;

            const inviteLink = await prisma.inviteLink.create({
                data: {
                    groupId,
                    token,
                    createdBy: actor.userId,
                    maxUses:   dto.max_uses ?? null,
                    expiresAt,
                },
                select: {
                    id:        true,
                    token:     true,
                    maxUses:   true,
                    useCount:  true,
                    expiresAt: true,
                    revokedAt: true,
                    createdAt: true,
                    creator: {
                        select: { displayName: true, username: true },
                    },
                },
            });

            // Cache for fast lookups
            await redis.setex(inviteKey(token), INVITE_CACHE_TTL, groupId);

            await AuditLogger.log(
                actor, LogActions.GROUP_INVITE_GENERATE, ResourceTypes.INVITE_LINK, inviteLink.id, 1,
                { groupId, maxUses: dto.max_uses, expiresAt },
            );

            return {
                id:        inviteLink.id,
                token:     inviteLink.token,
                inviteUrl: `${config.server.clientUrl}/invite/${inviteLink.token}`,
                maxUses:   inviteLink.maxUses,
                useCount:  inviteLink.useCount,
                expiresAt: inviteLink.expiresAt,
                revokedAt: inviteLink.revokedAt,
                createdAt: inviteLink.createdAt,
                createdBy: inviteLink.creator ? {
                    displayName: inviteLink.creator.displayName,
                    username:    inviteLink.creator.username,
                } : null,
            };
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_INVITE_GENERATE, ResourceTypes.INVITE_LINK, null, 0,
                { groupId, error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.generateInviteLink:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── getInviteLinks ──────────────────────────────────────────────────────────

    async getInviteLinks(groupId: string): Promise<InviteLinkItem[]> {
        try {
            const links = await prisma.inviteLink.findMany({
                where: { groupId, revokedAt: null },
                select: {
                    id:        true,
                    token:     true,
                    maxUses:   true,
                    useCount:  true,
                    expiresAt: true,
                    revokedAt: true,
                    createdAt: true,
                    creator: { select: { displayName: true, username: true } },
                },
                orderBy: { createdAt: 'desc' },
            });

            return links.map((l) => ({
                id:        l.id,
                token:     l.token,
                inviteUrl: `${config.server.clientUrl}/invite/${l.token}`,
                maxUses:   l.maxUses,
                useCount:  l.useCount,
                expiresAt: l.expiresAt,
                revokedAt: l.revokedAt,
                createdAt: l.createdAt,
                createdBy: l.creator ? {
                    displayName: l.creator.displayName,
                    username:    l.creator.username,
                } : null,
            }));
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.getInviteLinks:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── revokeInviteLink ────────────────────────────────────────────────────────

    async revokeInviteLink(inviteLinkId: string, actor: TokenPayload): Promise<void> {
        try {
            const link = await prisma.inviteLink.findUnique({
                where: { id: inviteLinkId },
                select: { id: true, token: true, groupId: true, revokedAt: true },
            });

            if (!link) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Invite link'), StatusCodes.NOT_FOUND);
            }

            if (link.revokedAt) {
                throw new ApiError('This invite link has already been revoked.', StatusCodes.CONFLICT);
            }

            await prisma.inviteLink.update({
                where: { id: inviteLinkId },
                data:  { revokedAt: new Date() },
            });

            // Remove from Redis cache
            await redis.del(inviteKey(link.token));

            await AuditLogger.log(
                actor, LogActions.GROUP_INVITE_REVOKE, ResourceTypes.INVITE_LINK, inviteLinkId, 1,
                { groupId: link.groupId },
            );
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_INVITE_REVOKE, ResourceTypes.INVITE_LINK, inviteLinkId, 0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.revokeInviteLink:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── acceptInvite ────────────────────────────────────────────────────────────
    // Resolves the token: Redis cache first, then DB fallback.
    // Validates: not revoked, not expired, use_count < max_uses.
    // Atomically increments use_count and creates membership.

    async acceptInvite(token: string, actor: TokenPayload): Promise<void> {
        try {
            // 1. Redis cache lookup (fast path)
            let groupId = await redis.get(inviteKey(token));

            // 2. DB fallback if not cached
            const inviteLink = await prisma.inviteLink.findUnique({
                where:  { token },
                select: {
                    id:        true,
                    groupId:   true,
                    maxUses:   true,
                    useCount:  true,
                    expiresAt: true,
                    revokedAt: true,
                    group: { select: { name: true, status: true, deletedAt: true } },
                },
            });

            if (!inviteLink) {
                throw new ApiError('This invite link is invalid or does not exist.', StatusCodes.NOT_FOUND);
            }

            if (!groupId) {
                groupId = inviteLink.groupId;
            }

            // Validation checks
            if (inviteLink.revokedAt) {
                throw new ApiError('This invite link has been revoked.', StatusCodes.GONE);
            }

            if (inviteLink.expiresAt && inviteLink.expiresAt < new Date()) {
                throw new ApiError('This invite link has expired.', StatusCodes.GONE);
            }

            if (inviteLink.maxUses !== null && inviteLink.useCount >= inviteLink.maxUses) {
                throw new ApiError('This invite link has reached its maximum number of uses.', StatusCodes.GONE);
            }

            if (!inviteLink.group || inviteLink.group.deletedAt || inviteLink.group.status !== 'active') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            // Check existing membership
            const existing = await prisma.membership.findUnique({
                where:  { userId_groupId: { userId: actor.userId, groupId } },
                select: { status: true },
            });

            if (existing?.status === 'active') {
                throw new ApiError('You are already a member of this group.', StatusCodes.CONFLICT);
            }

            if (existing?.status === 'banned') {
                throw new ApiError('You have been banned from this group.', StatusCodes.FORBIDDEN);
            }

            // Atomically increment use_count and create membership
            await prisma.$transaction(async (tx) => {
                await tx.inviteLink.update({
                    where: { id: inviteLink.id },
                    data:  { useCount: { increment: 1 } },
                });

                await tx.membership.create({
                    data: { userId: actor.userId, groupId, role: 'member', status: 'active' },
                });
            });

            // Refresh Redis cache TTL
            await redis.setex(inviteKey(token), INVITE_CACHE_TTL, groupId);

            await AuditLogger.log(
                actor, LogActions.GROUP_INVITE_ACCEPT, ResourceTypes.MEMBERSHIP, groupId, 1,
                { token: token.slice(0, 8) + '...', groupName: inviteLink.group.name },
            );
        } catch (error: any) {
            await AuditLogger.log(
                actor, LogActions.GROUP_INVITE_ACCEPT, ResourceTypes.MEMBERSHIP, null, 0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('MembershipService.acceptInvite:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
