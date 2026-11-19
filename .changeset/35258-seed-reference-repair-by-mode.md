---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the `seed_reference_unresolved` build probe names a repair a republish actually reaches, and judges each object once

Clause-②: no
Metadata-protocol: none

The probe told the author to correct the seed and republish under every seed mode. Under the default `mode: 'ignore'` a republish leaves a row it finds again as it is, so that repair changed nothing, and the next receipt came back clean because a matched row is not judged under `ignore`. The finding's `fix` and its `userMessage` (every platform locale) now name the repair for the mode: correct the seed when every seed of the object writes the column back on a replay (`upsert` or `update`, the column carried by every record, not `applyOn: 'create'`); otherwise correct, clear or delete the stored rows, or declare `mode: 'upsert'` where that alone makes the replay write the column. The sentence takes a new `cause` (`seed`, `mode`, `stored`).

`seedApplied.landed` is one entry per object for every seed of it, so the probe now judges per object: one finding per object and reference column, however many seeds the object has. Rows the publish created are always judged; a row a seed key matched is judged only when every published seed of the object declares `upsert` or `update`, and only in a column every one of those seeds writes back onto a matched row. Before, two seeds of one object reported the same value twice, and a row only an `ignore` seed matched was judged under the other seed's mode.

`rollup_never_computed` says "of one organization" only when the pass was split by organization, and its sentence no longer claims "every" parent: the verdict is over the sampled parents.
