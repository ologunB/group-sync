export interface TokenPayload {
    userId: string;
    role: string;           // 'user' | 'platform_admin' | group membership role
    sessionId: string;
    permissions: string[];
}

export interface PaginationQuery {
    page?: string;
    limit?: string;
}

export interface CursorQuery {
    cursor?: string;
    limit?: string;
}

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
}
