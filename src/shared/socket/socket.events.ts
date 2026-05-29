export const SocketEvents = {
    // ── Group chat — client → server ───────────────────────────────────────────
    JOIN_GROUP:     'join_group',
    LEAVE_GROUP:    'leave_group',
    SEND_MESSAGE:   'send_message',
    USER_TYPING:    'user_typing',
    HEARTBEAT:      'heartbeat',

    // ── Group chat — server → client ───────────────────────────────────────────
    GROUP_JOINED:    'group_joined',
    NEW_MESSAGE:     'new_message',
    MESSAGE_DELETED: 'message_deleted',
    MESSAGE_PINNED:  'message_pinned',
    REACTION_ADDED:  'reaction_added',
    REACTION_REMOVED:'reaction_removed',
    TYPING:          'typing',
    PRESENCE_UPDATE: 'presence_update',
    CHAT_LOCK_CHANGED: 'chat_lock_changed',
    KICKED_FROM_GROUP: 'kicked_from_group',

    // ── DM — client → server ──────────────────────────────────────────────────
    DM_SEND:    'dm_send',
    DM_TYPING:  'dm_typing',

    // ── DM — server → client ──────────────────────────────────────────────────
    DM_TYPING_UPDATE:    'dm_typing_update',
    DM_RECEIVED:         'dm_received',
    DM_READ:             'dm_read',
    DM_REACTION_ADDED:   'dm_reaction_added',
    DM_REACTION_REMOVED: 'dm_reaction_removed',

    // ── Polls — server → client ───────────────────────────────────────────────
    POLL_VOTE_UPDATED: 'poll_vote_updated',

    // ── Errors ────────────────────────────────────────────────────────────────
    ERROR: 'chat_error',
} as const;

export type SocketEvent = typeof SocketEvents[keyof typeof SocketEvents];
