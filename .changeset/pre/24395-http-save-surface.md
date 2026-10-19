---
"@objectstack/rest": minor
"@objectstack/runtime": minor
---

feat(rest,runtime): `PUT /meta/:type/:name?surface=studio|api` declares the save's authoring surface on both HTTP save doors; `?surface=copilot` is refused

Clause-②: yes (widening)

- **The spelling.** `?surface=` joins the save door's closed query set on `RestServer` and on the runtime dispatcher (`META_ITEM_SAVE_PARAMS`), read once through `metaSaveRequestOptions` beside `?mode=`. A draft save stamps it on each key path it changes (`draftChanges[].by` on the strict draft read); without it the save is recorded as `api`. `?surface=studio` is the spelling for a person's save in Studio.
- **The refusals.** `?surface=copilot` is `400 VALIDATION_ERROR`: it marks a write as the AI copilot's, which only an in-process tool calling `saveMetaItem` may state. Any other value, a case variant included, is the same `400`, never read as `api`; a repeated `?surface=` is refused by the arity rule. Each refusal writes nothing.
- **Why a query parameter.** It is what the save is asked to do, as `?mode=` and `?force=` are, beside the HTTP preconditions the headers carry; and it needs no CORS allow-list entry, which a custom request header would.
