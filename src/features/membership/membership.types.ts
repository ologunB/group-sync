import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { TokenPayload, PaginationMeta } from '../../shared/types/common.types';

// ─── Request extension ────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface ApplyToGroupDTO {
    form_responses?: Record<string, unknown>;
}

export interface ReviewApplicationDTO {
    action: 'approve' | 'reject';
    rejection_reason?: string;
}

export interface UpdateMemberDTO {
    role?:   'admin' | 'moderator' | 'member';
    status?: 'active' | 'suspended' | 'banned';
}

export interface CreateInviteLinkDTO {
    max_uses?:        number;
    expires_in_hours?: number;
}

export interface UpsertGroupFormDTO {
    fields: GroupFormField[];
}

export interface GroupFormField {
    id:       string;
    type:     'text' | 'textarea' | 'select' | 'checkbox' | 'radio';
    label:    string;
    required: boolean;
    options?: string[];
}

// ─── Application item ─────────────────────────────────────────────────────────

export interface ApplicationItem {
    id:              string;
    userId:          string;
    groupId:         string;
    status:          string;
    formResponses:   Prisma.JsonValue;
    rejectionReason: string | null;
    reviewedBy:      string | null;
    submittedAt:     Date;
    reviewedAt:      Date | null;
    user: {
        displayName:    string;
        username:       string | null;
        profilePhotoUrl: string | null;
    };
}

// ─── Invite link item ─────────────────────────────────────────────────────────

export interface InviteLinkItem {
    id:        string;
    token:     string;
    inviteUrl: string;
    maxUses:   number | null;
    useCount:  number;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    createdBy: {
        displayName: string;
        username:    string | null;
    } | null;
}

// ─── Paginated result ─────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
    data:       T[];
    pagination: PaginationMeta;
}
