# Aurex conversation API

Authenticated routes; ownership is checked server-side.

- GET /api/v1/conversations/page?limit=30&cursor=...&q=...&archived=false returns items, nextCursor and hasMore. q searches titles and message content; archived accepts true, false or all.
- GET /api/v1/conversations/:id/messages/page?limit=30&cursor=... loads older messages in chronological order.
- PATCH /api/v1/conversations/:id with { title } renames a conversation.
- POST /api/v1/conversations/:id/archive and /unarchive change archive state.
- POST /api/v1/conversations/:id/pin and /unpin pin or unpin a conversation; the pinned flag is included in list/page results.
- DELETE /api/v1/conversations deletes all conversations owned by the current user.
- PATCH /api/v1/conversations/:conversationId/messages/:messageId edits a user message.
- POST /api/v1/chat/conversations/:conversationId/messages/:messageId/regenerate regenerates the latest assistant answer while preserving the previous answer as an alternative.
- GET /api/v1/conversations/:conversationId/messages/:messageId/share returns a structured share payload for the mobile native share sheet.
- GET /api/v1/conversations/:conversationId/messages/:messageId/versions returns current, edited and regenerated alternatives.
- POST /api/v1/conversations/:conversationId/messages/:messageId/versions/:versionId/restore restores a saved previous version.
- DELETE /api/v1/conversations/:conversationId/messages/:messageId removes a message.
- POST /api/v1/conversations/:conversationId/messages/:messageId/feedback accepts positive, negative or report; reports require a reason.

Legacy list and message endpoints keep their array responses for mobile compatibility. Edits and feedback use the existing audit event table; no schema migration is required.

## Generation streaming and cancellation
- POST /api/v1/chat/messages/stream accepts the same payload as /messages and emits Server-Sent Events: delta, done or error.
- GET /api/v1/chat/generations/:requestId reports whether a generation is active on this backend instance.
- POST /api/v1/chat/generations/:requestId/cancel aborts an active Groq request for the authenticated user.
- Partial streamed text is persisted as an interrupted assistant message and excluded from later model context; clients can display it and retry using a new request ID.
- The legacy POST /api/v1/chat/messages remains available and returns a complete JSON response.

## Free Web research
When Brave Search is not configured, the backend uses DuckDuckGo HTML for general discovery, Wikimedia for encyclopedic results and Crossref for academic metadata. These free public services are best-effort and may impose rate limits or change response formats. Brave remains optional and preferred only when explicitly enabled and configured. Groq remains the planner/synthesizer; mathematical computation is unavailable until SMP is implemented.
