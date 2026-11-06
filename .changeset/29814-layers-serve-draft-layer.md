---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol,rest,runtime): `GET /meta/:type/:name/layers` serves the pending draft as stored, so an editor re-opens an author's draft without translations or injected columns (#29814)

Clause-②: no
Metadata-protocol: none

The layered view now serves the `draft` layer that `GetMetaItemLayeredResponseSchema` declares, on `RestServer` and on the runtime dispatcher, and on the deprecated `?layers=` spelling too. Before, the only read of a pending draft was `?state=draft`, which serves it translated for the caller's locale and governed (the platform's injected columns added), so an editor that built its buffer from it and saved it back wrote translations and platform columns into the author's draft.

- **What `draft` is.** The row the `?state=draft` read serves, at the same address (`?package=` picks that package's draft), exactly as stored: converted like the `overlay` layer and credential-redacted like every layer, never translated, governed or stamped. `null` when no draft is pending. An edit buffer reads `draft ?? overlay ?? code`.
- **Who is served it.** Only a caller the draft-read admission already admits (the predicate every draft read asks: a system caller, `studio.access`, `setup.access` or `manage_metadata`). The per-caller gate judges it like the other layers: whole for whoever may write the item, pruned as `?state=draft` prunes it otherwise. Any other caller is answered the layers with no `draft` key, which says nothing about whether a draft exists, and a name with only a draft stays a `404` for them.
- **Unchanged.** `?state=draft` and every other read answer as before. A never-published name an admitted author holds a draft of is now answered `200` with only its `draft` layer, where it was a `404`.
- **Protocol.** `getMetaItemLayered(request, { withDraft: true })` reads the layer; without the option the answer carries no `draft` key, so its in-process readers read no draft.
