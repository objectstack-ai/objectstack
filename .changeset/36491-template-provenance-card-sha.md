---
'@objectstack/scenarios': patch
---

`run --template F` warns when `F.provenance.json` beside the template names another `cardSha256` than the sha256 of the card file the run grades, so a verified build whose provenance went stale after a card edit is named before the card runs. The run still grades the card it loaded.

Clause-②: no
Metadata-protocol: none
