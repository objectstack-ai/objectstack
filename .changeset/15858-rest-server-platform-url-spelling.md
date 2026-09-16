---
'@objectstack/rest': patch
---

docs(rest): the `'platform'` virtual-id docblock names the live `/environments/` URL family (#15858)

`RestServer`'s `environmentId === 'platform'` docblock described the reserved virtual id as being addressed *"through the regular project URL shape (`/projects/platform/...`)"* — the spelling ADR-0006 v4's second addendum (D2, executed 2026-08-28) retired with **no alias and no grace period**. It now reads *"through the regular environment URL shape (`/environments/platform/...`)"*.

**The prefix is corrected rather than the paragraph retired, because the shape is live.** The fork this card opened — *"if the shape is live the sentence needs its prefix corrected, and if it is not, the paragraph may want retiring"* — was decided by a cross-repo reading: the host enables environment scoping precisely so `/api/v1/environments/platform/...` resolves to the control-plane protocol, its kernel resolver returns no per-environment kernel for that id, and a live test drives `routePath: '/environments/platform/meta'`. Framework-side, `resolveProtocol` still short-circuits `environmentId === 'platform'` to the control-plane protocol. Every behavioural claim in the paragraph is true today; only the URL spelling and the phrase "the regular project URL shape" were not.

What reaches a consumer of this package: the docblock ships inside `dist/index.d.ts` and `dist/index.d.cts` (and the bundles), so `projects/platform` no longer appears anywhere in the published artifact. **No behaviour moves** — comment-only, and the file is line-count neutral at 13,877 lines before and after.

⚠️ Two things deliberately left alone, both measured rather than overlooked:

- The sibling site that calls `/projects/:environmentId` **"the retired spelling"** is *correct* — it documents the repair that landed under #16538. Harmonising the two would make the right one wrong.
- The same paragraph's *"It is NOT a row in the projects **table**"* is about a table, not a URL. That is a different question — it turns on what the control-plane row is called today — and it is not guessed into this edit.
