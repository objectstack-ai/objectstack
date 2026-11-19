---
'@objectstack/metadata-protocol': patch
---

fix(seed): a seed row that landed while a reference in its key was still empty stays deleted once a person deletes it

Clause-②: no
Metadata-protocol: none

A seed dataset whose `externalId` includes a reference can land a row before that reference resolves, for example a task assigned to a person who has not signed up yet. With the record of landed seed rows kept (`landedKeys: 'honour'`), such a row was recorded under no key, because its key had an empty part when it landed. A person who deleted the row got it back on the next seed load.

The row is now recorded under the id it lands with, which is derived from the key as the seed authored it. The next load finds that record whether the reference is still empty or has resolved since, so the deleted row is not inserted again. A row the seed never landed in the organization still lands, and a deliberate re-seed still brings deleted rows back.
