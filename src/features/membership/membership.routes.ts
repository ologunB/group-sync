import { Router } from 'express';
import { MembershipController } from './membership.controller';
import {
    authenticate,
    authenticateVerified,
    authorizeGroupRole,
} from '../../shared/middleware/auth.middleware';
import { validateRequest } from '../../shared/utils/validators';
import {
    groupIdParamValidator,
    applicationIdParamValidator,
    userIdParamValidator,
    inviteIdParamValidator,
    inviteTokenParamValidator,
    applyToGroupValidator,
    reviewApplicationValidator,
    updateMemberValidator,
    createInviteLinkValidator,
    upsertGroupFormValidator,
    listApplicationsValidator,
} from './membership.validator';

const router = Router();
const controller = new MembershipController();

// ─── Group membership actions ─────────────────────────────────────────────────

// Join open group — verified users only
router.post(
    '/groups/:id/join',
    authenticateVerified,
    validateRequest(groupIdParamValidator),
    controller.joinGroup,
);

// Apply to application-based group — verified users only
router.post(
    '/groups/:id/apply',
    authenticateVerified,
    validateRequest(groupIdParamValidator),
    validateRequest(applyToGroupValidator),
    controller.applyToGroup,
);

// Leave a group — any authenticated member
router.delete(
    '/groups/:id/leave',
    authenticate,
    validateRequest(groupIdParamValidator),
    controller.leaveGroup,
);

// ─── Application management ───────────────────────────────────────────────────

// List applications — admin only
router.get(
    '/groups/:id/applications',
    authenticate,
    validateRequest(listApplicationsValidator),
    authorizeGroupRole('super_admin', 'admin'),
    controller.getApplications,
);

// Approve or reject application — admin only
// Note: authorization is verified inside the service (checks admin of the application's group)
router.patch(
    '/applications/:id',
    authenticate,
    validateRequest(applicationIdParamValidator),
    validateRequest(reviewApplicationValidator),
    controller.reviewApplication,
);

// Withdraw own application — applicant only
router.delete(
    '/applications/:id',
    authenticate,
    validateRequest(applicationIdParamValidator),
    controller.withdrawApplication,
);

// ─── Application form ─────────────────────────────────────────────────────────

// Get form schema — public (needed to render form before applying)
router.get(
    '/groups/:id/form',
    validateRequest(groupIdParamValidator),
    controller.getGroupForm,
);

// Create or replace form — admin only
router.put(
    '/groups/:id/form',
    authenticate,
    validateRequest(groupIdParamValidator),
    authorizeGroupRole('super_admin', 'admin'),
    validateRequest(upsertGroupFormValidator),
    controller.upsertGroupForm,
);

// ─── Member management ────────────────────────────────────────────────────────

// Update member role / status — admin or super_admin
router.patch(
    '/groups/:id/members/:userId',
    authenticate,
    validateRequest([...groupIdParamValidator, ...userIdParamValidator]),
    authorizeGroupRole('super_admin', 'admin'),
    validateRequest(updateMemberValidator),
    controller.updateMember,
);

// Remove a member — admin or super_admin
router.delete(
    '/groups/:id/members/:userId',
    authenticate,
    validateRequest([...groupIdParamValidator, ...userIdParamValidator]),
    authorizeGroupRole('super_admin', 'admin'),
    controller.removeMember,
);

// ─── Invite links ─────────────────────────────────────────────────────────────

// Generate an invite link — admin only
router.post(
    '/groups/:id/invite',
    authenticate,
    validateRequest(groupIdParamValidator),
    authorizeGroupRole('super_admin', 'admin'),
    validateRequest(createInviteLinkValidator),
    controller.generateInviteLink,
);

// List active invite links — admin only
router.get(
    '/groups/:id/invites',
    authenticate,
    validateRequest(groupIdParamValidator),
    authorizeGroupRole('super_admin', 'admin'),
    controller.getInviteLinks,
);

// Revoke invite link — admin only (auth checked inside service for group ownership)
router.delete(
    '/invites/:id',
    authenticate,
    validateRequest(inviteIdParamValidator),
    controller.revokeInviteLink,
);

// Accept invite — verified users only
router.post(
    '/invites/:token/accept',
    authenticateVerified,
    validateRequest(inviteTokenParamValidator),
    controller.acceptInvite,
);

export default router;
