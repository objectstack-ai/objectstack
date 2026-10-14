---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a first draft of a sealed, package-shipped item is told to edit the source artifact, not to choose another name; a refused first-write pin is told what it asserted

Clause-②: no

**What was wrong.** `PUT /api/v1/meta/:type/:name?mode=draft` with `If-None-Match: *` on an item a code package ships, on a type with no environment overlay (an `object`, for one), answered `403 NOT_OVERRIDABLE` with the remedy for a create: "… so its name is taken. To author your own object, choose a name no package or built-in holds …". The same draft sent without the header was told "… Edit the source artifact and redeploy." The header asserts only that no draft is pending, so the request is a first draft of the item already under the name, an edit. A client or AI author that followed the create remedy authored a second object instead of editing the source.

**What changed.**

- A first draft over a held name names the item's own remedy, the sentence the same draft reads without the header (for a type with a regime row, its sanctioned path). A first write of the live row (`If-None-Match: *` with no `?mode=draft`) still names a free name.
- A save refused `409 METADATA_CONFLICT` because it sent `If-None-Match: *` over an existing row now says so: "TYPE/NAME: this save asserted that no draft row exists (the first-write pin, If-None-Match: * on the REST door), but one does (current is VERSION). …" (`active row` for a save without `?mode=draft`). It used to read "TYPE/NAME has been modified since you loaded it. Expected parent null but current is VERSION.", though the caller had loaded nothing. Every other conflict keeps its sentence.

**Unchanged.** Which requests are accepted or refused, every code and status, and the conflict body's `currentVersion` and the refusal's keyed fields.
