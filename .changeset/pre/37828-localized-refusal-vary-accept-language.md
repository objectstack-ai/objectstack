---
'@objectstack/types': patch
'@objectstack/rest': patch
'@objectstack/hono': patch
'@objectstack/runtime': patch
---

fix: an error answer whose body carries a `userMessage` sends `Vary: Accept-Language`

Clause-②: yes (widening) — `@objectstack/types` gains the exports `LOCALIZED_ANSWER_VARY` and `answerVariesByLanguage`
Metadata-protocol: none

A refusal's `userMessage` is written in the caller's language: the request's `Accept-Language` first, then the workspace default. The by-id read `GET /api/v1/data/:object/:id` answers a missing or unreadable record with `404 RECORD_NOT_FOUND` and such a sentence, and a `404` is cacheable by default. The answer did not say it depends on the request's language, so a cache could hand one caller's language to another.

Every exit that renders a refusal body now adds `Accept-Language` to `Vary` when that body carries a `userMessage`, whatever the status:

- **`@objectstack/rest`.** The `/data` read routes (`GET /data/:object` and `GET /data/:object/:id`).
- **`@objectstack/hono`.** `createHonoApp`'s two catch arms, for a declared throw.
- **`@objectstack/runtime`.** The dispatcher plugin's exit for a throw that leaves `dispatch()`.

The token is appended, so a `Vary` another layer writes (`Origin`, `Accept-Encoding`) keeps its tokens. A refusal without a `userMessage` is unchanged. `@objectstack/types` exports the one predicate the three exits ask, `answerVariesByLanguage(body)`, which reads the flat body and the nested ADR-0112 body alike, and the header token `LOCALIZED_ANSWER_VARY`. Nothing to migrate.
