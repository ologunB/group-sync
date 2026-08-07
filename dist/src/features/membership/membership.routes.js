"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const membership_controller_1 = require("./membership.controller");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const verification_middleware_1 = require("../../shared/middleware/verification.middleware");
const validators_1 = require("../../shared/utils/validators");
const membership_validator_1 = require("./membership.validator");
const router = (0, express_1.Router)();
const controller = new membership_controller_1.MembershipController();
// ─── Group membership actions ─────────────────────────────────────────────────
// Join open group — tier 1 (email + phone verified)
router.post('/:id/join', verification_middleware_1.authenticateContactVerified, (0, validators_1.validateRequest)(membership_validator_1.groupIdParamValidator), controller.joinGroup);
// Apply to application-based group — tier 1 (email + phone verified)
router.post('/:id/apply', verification_middleware_1.authenticateContactVerified, (0, validators_1.validateRequest)(membership_validator_1.groupIdParamValidator), (0, validators_1.validateRequest)(membership_validator_1.applyToGroupValidator), controller.applyToGroup);
// Leave a group — any authenticated member
router.delete('/:id/leave', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(membership_validator_1.groupIdParamValidator), controller.leaveGroup);
// ─── Application management ───────────────────────────────────────────────────
//
// NOTE: this router is mounted at `/api/v1/groups`, so the paths below resolve to
// `/api/v1/groups/applications/:id` — not the `/api/v1/applications/:id` that
// backend-srs.md § 4.4 and agent.md both document. The same applies to the invite
// routes at the bottom of this file. Clients are built against the mounted paths, so
// the URLs are the source of truth and the docs are wrong; changing them would be a
// breaking API change, not a fix.
// List applications — admin only
router.get('/:id/applications', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(membership_validator_1.listApplicationsValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), controller.getApplications);
// Approve or reject application — admin only
// Note: authorization is verified inside the service (checks admin of the application's group)
router.patch('/applications/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(membership_validator_1.applicationIdParamValidator), (0, validators_1.validateRequest)(membership_validator_1.reviewApplicationValidator), controller.reviewApplication);
// Withdraw own application — applicant only
router.delete('/applications/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(membership_validator_1.applicationIdParamValidator), controller.withdrawApplication);
// ─── Application form ─────────────────────────────────────────────────────────
// Get form schema — public (needed to render form before applying)
router.get('/:id/form', (0, validators_1.validateRequest)(membership_validator_1.groupIdParamValidator), controller.getGroupForm);
// Create or replace form — admin only
router.put('/:id/form', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(membership_validator_1.groupIdParamValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), (0, validators_1.validateRequest)(membership_validator_1.upsertGroupFormValidator), controller.upsertGroupForm);
// ─── Member management ────────────────────────────────────────────────────────
// Update member role / status — admin or super_admin
router.patch('/:id/members/:userId', auth_middleware_1.authenticate, (0, validators_1.validateRequest)([...membership_validator_1.groupIdParamValidator, ...membership_validator_1.userIdParamValidator]), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), (0, validators_1.validateRequest)(membership_validator_1.updateMemberValidator), controller.updateMember);
// Remove a member — admin or super_admin
router.delete('/:id/members/:userId', auth_middleware_1.authenticate, (0, validators_1.validateRequest)([...membership_validator_1.groupIdParamValidator, ...membership_validator_1.userIdParamValidator]), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), controller.removeMember);
// ─── Invite links ─────────────────────────────────────────────────────────────
// Generate an invite link — admin only
router.post('/:id/invite', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(membership_validator_1.groupIdParamValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), (0, validators_1.validateRequest)(membership_validator_1.createInviteLinkValidator), controller.generateInviteLink);
// List active invite links — admin only
router.get('/:id/invites', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(membership_validator_1.groupIdParamValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), controller.getInviteLinks);
// Revoke invite link — admin only (auth checked inside service for group ownership)
router.delete('/invites/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(membership_validator_1.inviteIdParamValidator), controller.revokeInviteLink);
// Accept invite — tier 1 (email + phone verified)
router.post('/invites/:token/accept', verification_middleware_1.authenticateContactVerified, (0, validators_1.validateRequest)(membership_validator_1.inviteTokenParamValidator), controller.acceptInvite);
exports.default = router;
//# sourceMappingURL=membership.routes.js.map