---
"@objectstack/client": patch
---

`environments.update`'s JSDoc no longer advertises writes the control plane refuses, and `environments.updateVisibility` carries a current-state note.

The `update` comment listed `display_name, plan, status, is_default, metadata` as the updatable set, and the namespace route table listed `plan` and `status` too. `plan` and `status` are read-only columns on the control plane; the generic `PATCH /api/v1/cloud/environments/:id` route answers an unknown or read-only key with a **400** rather than dropping it, so the comment was actively teaching a call that fails. The same prose implied `visibility` was writable while it is server-owned.

Three prose sites move, all in `packages/client/src/index.ts`:

- **The namespace route-table docblock.** The PATCH accept-set now reads `display_name, is_default, metadata`, with the redirects stated: plan changes go through the billing routes, status changes through the lifecycle actions (archive / restore / suspend / resume), and `visibility` is server-owned.
- **`update`'s JSDoc.** The same accept-set with per-field detail, and — the sentence that matters most to a caller — that an unknown or read-only key is answered with a 400 and is **not** dropped silently. Silent-drop is the assumption a caller reasonably makes today, and it is the wrong one.
- **`updateVisibility`'s JSDoc.** A note that the call is refused today, so the paragraph describing what `public` does describes a capability that does not exist yet. The 2026-09-12 maintainer ruling keeps `visibility` server-owned and forced to `private` until the public-listing feature ships, at which point it gets its own endpoint rather than this generic update.

⛔ **No signature, type or runtime byte moves.** `patch` stays `Record<string, unknown>` and `updateVisibility`'s signature and body are byte-for-byte unchanged (verified by hash, before and after). Narrowing a published accept-set is as much a breaking change as widening one, and retiring, re-signing or throwing from a published SDK method is a maintainer ruling — neither is a doc fix's to make. What reaches consumers is the hover text in `dist/index.d.ts`.

⚠️ The 400 is an **inherited reading**, not one measured from this repo: `/api/v1/cloud/*` is served by `objectstack-ai/cloud`, which is not readable from here, so no gate here can check it. The comments say so at the point of the claim rather than leaving a later reader to try.
