---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's action editor keeps a new field-value row, and stores a script action's type

Clause-②: no
Metadata-protocol: none

Two gaps in Studio's action editor (Data › an object › Actions) left a published action that does nothing:

- **Add field value** on an "Update fields on this record" action added no row, so `patch` stayed `{}` and the action could not be given a field to set. The row now appears at once and is held in the editor until it names a field; from then on it is written to `patch`. A row whose field is cleared stays on screen, held, and leaves `patch`. A row that names no field is never written.
- **Run a script** left the action without `type`, while the Type control read Script. The console runs nothing for an action without `type`, so the button sent no request. Every edit that authors a script (the "What it does" switch, the body, its language, a field value) now stores `type: 'script'` on an action that has none, and the Type control shows only a type the action holds: "—" until then. An action that already has a `type` is written exactly as before.
