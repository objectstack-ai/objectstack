---
'@objectstack/spec': patch
---

Correct `ListMapConfigSchema`'s account of what the map renderer does with an
undeclared key in `map`.

The docblock said the renderer "validates `schema.map` against a local zod
schema with exactly these keys, so an extra key here would be dropped there",
and that sentence was the stated rationale for the block being strict.
Re-measured at the `.objectui-sha` pin `53ded82b` by executing the pinned
declarations: that local schema (`ObjectMapConfigSchema`) is a plain `z.object`,
not strict, so an undeclared key parses clean there with no issue and no
warning; `getMapConfig` consults its `safeParse` only to decide whether to
`console.warn` and returns a spread of the authored block. What does drop an
undeclared key on the path this block actually takes is a different instrument
— the hand-listed `FLAT_MAP_CONFIG_KEYS` whitelist in `ListView` / `ObjectView`
— and it drops it in silence.

The schema is unchanged: same keys, same `strictObject`, same accepted
documents. Only the rationale is corrected, and it is restated so it stands on
its own — nothing downstream reports an undeclared key, so this parse is the
only diagnostic an author ever gets, which is an argument for the strictness
rather than against it. The record's seven objectui anchors now quote the line
they were read at, so `check:objectui-pin-citations` verifies their content
against the pin instead of only checking the sha label.

Clause-②: no
