---
"@objectstack/cli": patch
---

Carry the four structural advisories in `os validate --json` (#10953)

`--json` exists so CI can gate on the advisories `os validate` computes, and
four of them could never reach it. In `commands/validate.ts` the JSON payload
was emitted and the command `return`ed **above** the block that computes them,
so these four were printed for a human and structurally unreachable for the
machine:

- `No objects defined — this stack has no data model`
- `No apps or plugins defined — this stack may not do much`
- `Missing manifest.id — required for deployment`
- `Missing manifest.namespace — required for multi-app hosting`

Measured before the fix on a config with no manifest, no objects and no apps —
the text face printed all four; `os validate --json` reported `"warnings": []`
for the byte-identical config. The documented purpose of the flag was defeated.

The four conditions now compute once, above the `if (flags.json)` branch, and
both faces consume that one list — the same move this file already made for
`unknownKeyWarnings`, for the same reason: a single list cannot drift from
itself. The text face's warning order is unchanged.

**Declared shape is unchanged; content is not.** `warnings` was already a
heterogeneous array — registry and package-doc findings ride as objects,
unknown-key advisories as strings — so the four arriving as strings introduces
no new element type and no new key. What changes is reachability: a pipeline
gating on `warnings.length === 0` will now see these four where it previously
saw an empty array. That is the defect being corrected rather than a new
signal, which is why this is a patch and matches the bump this repo used for
the previous fix of the same class (readonly flow-write warnings missing from
the same array).

Pinned by `test/validate-json-warning-parity.e2e.test.ts`, which asserts the
two faces carry the same warning **set** for the same config — both sides
derived from their own real output — so the class stays closed rather than
just these four instances.
