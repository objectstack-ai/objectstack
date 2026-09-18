---
'@objectstack/spec': patch
---

`latencyMs` and `frequencyHours` name their unit in the published describe, and `check:duration-unit-keys` refuses the agreement shape

`AIUsageRecord.latencyMs` carried no `.describe()` at all, and
`DatabaseLevelIsolationStrategy.backup.frequencyHours` described `'Backup
frequency'`. Both keys already carried their unit in the key NAME and in a JSDoc
block above it — and neither of those is a channel the published JSON Schema or
`content/docs/references/**` prints. So the reference page published
`frequencyHours | integer | Backup frequency` and left the reader to infer the
unit from the key name, which on a duration is a guess with a 3600x error on the
other side of it. Both describes now name the unit, and the `description` in the
shipped JSON Schema moves with them.

**Ruled 2026-09-18 (decision batch #158 item 5, letter A).** The AGREEMENT shape
— a unit in the key name, the SAME unit in the JSDoc, none in the describe — IS
an offence. `check:duration-unit-keys` carried a carve-out
(`!jsdocUnits.some((u) => keyUnits.includes(u))`) that spared it for one release
while the question sat open, together with two self-test cases pinned as
DEFERRED and a header note recording shape (b) as repealed. The carve-out is
gone, those two cases are POSITIVE controls, and shape (b) is a base refusal
again. Agreement between a key name and a source comment is agreement between
two channels the published page does not print; it says nothing about the one
it does.

⚠️ **This also makes an already-published sentence true.** The changeset for
#15939 states that the gate refuses a key whose JSDoc names a unit its describe
does not, *"or there is no describe at all"* — which over-claimed by exactly the
two rows above while the carve-out stood. The two rows are remediated and the
carve-out is removed, so the claim now holds of the gate; nothing is edited in
place to make it hold.

The `EpochMs` instant exemption reads the JSDoc channel too, riding the same
ruling. It refused a describe that contradicted the schema but never a JSDoc
that did, while the duration-type exemption beside it refused all three
channels — the same lie with two answers depending on which exemption class the
key fell into. No row in the tree carried the shape; a fixture pair pins it.

⛔ No published key, accept set, default or runtime behaviour moves. The two
changes to shipped artefacts are `description` strings.

Clause-②: no
