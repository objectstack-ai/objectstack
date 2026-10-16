---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a refused first-write pin is told what it asserted

Clause-②: no

**What was wrong.** A save that sent `If-None-Match: *` (the first-write pin) to `PUT /api/v1/meta/:type/:name` over a row that already exists was refused `409 METADATA_CONFLICT` with "TYPE/NAME has been modified since you loaded it. Expected parent null but current is VERSION.", though the caller had loaded nothing.

**What changed.**

- Such a save is now told what it asserted: "TYPE/NAME: this save asserted that no draft row exists (the first-write pin, If-None-Match: * on the REST door), but one does (current is VERSION). …" (`active row` for a save without `?mode=draft`). Every other conflict keeps its sentence.

**Unchanged.** Which requests are accepted or refused, every code and status, and the conflict body's `currentVersion` and the refusal's keyed fields.
