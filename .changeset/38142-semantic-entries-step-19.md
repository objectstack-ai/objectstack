---
'@objectstack/spec': patch
---

fix(spec): three upgrade-guide entries that first ship in protocol 19 are listed under 19, so `os migrate meta --from 18` shows them

Clause-②: no
Metadata-protocol: none

Three ADR-0087 semantic entries were filed under protocol major 18 after `PROTOCOL_VERSION` moved to 19: `define-form-studio-helper-renamed-define-metadata-form`, `form-type-define-form-and-packageless-list-at-form-name` and `publish-refuses-data-model-fields-that-save-and-do-not-work`. None of them shipped in an 18.x release; each first shipped in a 19.0.0 prerelease. The migration chain from 18 runs only the steps above 18, so an 18.x app upgraded with `os migrate meta --from 18` was never shown these three notes. They now sit in the protocol 19 step, with ids and text unchanged, and the 18 → 19 upgrade lists them. No schema, export or stored row changes. Nothing to migrate.
