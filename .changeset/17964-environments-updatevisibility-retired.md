---
'@objectstack/client': minor
---

**BREAKING** — `client.environments.updateVisibility(id, visibility)` is REMOVED from the published SDK surface.

Clause-②: no

A `major`-class change, recorded as `minor` under the launch-window convention. Director-seat decision batch #132 item 1, maintainer 「同意」, 2026-09-13; ADR-0049 enforce-or-remove.

**Why.** The method's only behaviour was a write the control plane refuses. It PATCHed the generic `/api/v1/cloud/environments/:id` route with `{ visibility }`, and `visibility` is one of the server-owned columns that route rejects — the same accept-set (`display_name`, `is_default`, `metadata`) the `update` docblock already records. Its own docblock described a whole capability ("`public` lists the environment and freely exposes all revisions") that does not exist. The 2026-09-12 maintainer ruling keeps `visibility` server-owned and forced to `private` until the public-listing feature ships, at which point that capability arrives on its **own** endpoint rather than on this generic update — so this method was never going to be its carrier, even once it lands. A published method that is known never to be implemented is removed rather than left throwing forever.

## No FROM → TO mapping, and why this section is not one

There is no replacement to rewrite a call into, and stating one would be false. **Delete the call.** No behaviour is lost: the write it issued was already refused. The channel that reaches every affected consumer is the compiler, at their own call site — strictly more precise than any prose here. When the public-listing endpoint ships, a NEW method is written against it; ⛔ restoring this signature would re-declare the refused generic-update write.

`objectstack migrate meta` has nothing to reach: an SDK call site is source code, not stored metadata, so no ADR-0087 conversion entry and no migration-chain step can act on it.

Also in the same change: `packages/runtime/src/http-dispatcher.ts` loses an orphaned control-plane route-table docblock that documented routes that file does not serve — `/cloud/*` is skipped there, and the table repeated the corrected accept-set. Comment-only; no runtime byte moves.

<!-- adr-0087: not-required (runtime-interface-only packages/client/src/index.ts#ObjectStackClient) the removed member is a published runtime SDK method with no metadata surface — no Zod schema, no `packages/spec` declaration, no stored representation — so `objectstack migrate meta` has nothing to rewrite and the compiler is the notification channel; the retirement's structured TODO (surface, reason, acceptance) is left at the removal site in `packages/client/src/index.ts` -->
