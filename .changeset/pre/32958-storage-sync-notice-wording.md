---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the `object-storage-sync-refused` advisory reads true on every door that raises it

Clause-②: no
Metadata-protocol: none

The warning a refused storage sync puts on the answer is raised by the save, publish, rollback and revert doors, but its text spoke of "this save" and told every caller to "publish the object again". It now names no door ("the columns this change added"), and its hint names the remedies that work from each of them: restarting the server, or the next live write of the object, both of which run the storage sync again. The rule id, severity and the quoted driver reason are unchanged.
