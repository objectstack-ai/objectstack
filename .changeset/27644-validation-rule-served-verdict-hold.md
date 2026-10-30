---
'@object-ui/app-shell': patch
---

fix(app-shell): a validation rule guard the publish refuses holds the Studio Data pillar's autosave (#27644)

Clause-②: no
Metadata-protocol: none

The Data pillar read the object draft and dropped its served `_diagnostics`, so a validation rule guard the publish refuses (an ordering compare on a nullable field, `record.amount > 100`) read clean and autosaved until Publish refused it. The pillar now keeps the draft read's verdict and the body it judged, re-reads both after each save, and hands them to the Validations tab. Each rule's guard carries its own verdict path (`validations.N.condition`, a conditional rule's `.when`), so the error the server located there is shown under the guard and holds the autosave while the guard still shows the judged text, in the raw CEL editor and in the row builder alike. Editing the guard releases the hold: that save goes out and its re-read brings the next verdict. No rule is restated in the console.
