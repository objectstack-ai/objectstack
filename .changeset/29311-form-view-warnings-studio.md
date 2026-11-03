---
'@object-ui/app-shell': patch
---

fix(app-shell): a form view opened in Studio shows its served warnings, such as a section naming a field the object lacks, at that section

Clause-②: no
Metadata-protocol: none

Since `@objectstack/metadata-protocol` began serving the lint's `form-field-unknown` finding in a form view's `_diagnostics.warnings`, Studio's form view canvas never showed it: the Interfaces pillar's load stripped `_diagnostics` with the other read decorations and handed the canvas no verdict, so an author kept designing a form whose field is silently skipped at runtime.

- **The Interfaces pillar keeps the verdict.** The open view's load keeps the pending draft's `_diagnostics` (else the published layer's) beside the body it judged, and hands it to the canvas through the preview contract's `diagnostics`. It is never part of the edit buffer, so no save carries `_diagnostics`. The pillar does not read the view again after an autosave, so a warning is dropped once the author edits the value it judged.
- **The form view canvas shows the warnings.** Each warning is listed in the canvas's warn block under the existing "N warning(s)" heading, named by the section it points into (its label, else its name), with the server's message as served. Nothing is shown when there are none, and nothing holds a save.
