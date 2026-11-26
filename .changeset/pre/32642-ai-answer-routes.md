---
'@objectstack/spec': minor
---

feat(spec): declare the AI answer follow-up routes (saved questions, answer artifact, answer feedback) and carry `turnId` on a conversation's messages

Clause-②: yes (widening)
Metadata-protocol: added

`@objectstack/spec/api` now declares the request, response and error shapes of the AI answer follow-up routes the cloud AI service serves, so the console and the client SDK can type them instead of guessing:

- **Saved questions.** `GET /api/v1/ai/saved-questions` (`ListAiSavedQuestionsResponseSchema`), `POST /api/v1/ai/saved-questions` (`CreateAiSavedQuestionRequestSchema` / `CreateAiSavedQuestionResponseSchema`: a typed `question`, or `conversationId` with `turnId`), `DELETE /api/v1/ai/saved-questions/:id` (204) and `POST /api/v1/ai/saved-questions/:id/run` (`RunAiSavedQuestionResponseSchema`). One saved question is `AiSavedQuestionSchema`; its `source` is the Ask data tools' `ObjectQuerySourceSchema` block.
- **Answer → artifact.** `POST /api/v1/ai/conversations/:id/turns/:turnId/artifact` (`CreateAiAnswerArtifactRequestSchema` with `kind: 'view' | 'report' | 'widget'`; `CreateAiAnswerArtifactResponseSchema`, discriminated by `kind`: the caller's own list view, or a dataset plus a report or dashboard draft with `published: false`).
- **Answer feedback.** `GET|POST|DELETE /api/v1/ai/conversations/:id/turns/:turnId/feedback` (`GetAiAnswerFeedbackResponseSchema`, `SetAiAnswerFeedbackRequestSchema` with `rating: 'up' | 'down'` and an optional `note`, `SetAiAnswerFeedbackResponseSchema`; DELETE answers 204).
- **Errors.** Each family's `error` is `ApiErrorSchema` with its closed `code` vocabulary (`AiSavedQuestionErrorSchema`, `AiAnswerArtifactErrorSchema`, `AiAnswerFeedbackErrorSchema`) and, where the route names one, the refusal in `details.reason` (`AiSavedQuestionRefusalReasonSchema`, `AiAnswerArtifactRefusalReasonSchema`). Each `code` list holds the route handler's codes and the framework door's, which answers ahead of the handler: `UNAUTHENTICATED` (401, no session), `NOT_IMPLEMENTED` (501, no AI served) and `SERVICE_UNAVAILABLE` (503, AI routes not yet published).

A persisted conversation's messages may now carry the turn they were written under: `AiConversationSchema.messages` is `AiConversationMessageSchema` (`AiMessageSchema` plus a `turnId` that may be absent or null), and the `AIConversation` contract's `messages` are `AIConversationMessage` (`ModelMessage` plus `turnId?: string | null`). A stored conversation whose messages carry no turn, absent or null, still parses, and a service that writes none still satisfies the contract.
