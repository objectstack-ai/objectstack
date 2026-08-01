---
'@objectstack/spec': patch
---

`check:react-conformance` → `check:react-declaration-parity` — the gate compares two declarations, and said it compared a declaration to an implementation.

Its header opened by claiming it "confirms the objectui components **ACTUALLY implement**
the props the spec protocol declares". It never could. Both sides of its diff are
declarations: the spec zod schema's props on the left, and on the right the `inputs` the
objectui *registry config* declares — copied verbatim into `sdui.manifest.json` by
`manifestFromConfigs`. No renderer appears anywhere in the chain. So a prop **both sides
declare and nothing reads** is, to this gate, perfect agreement.

That is not hypothetical. #4413's four blocks (`record:details` / `record:highlights` /
`record:related_list` / `record:path`) published `objectName`/`recordId` that no renderer
read, rendered a "bind a record to preview" placeholder on a `kind:'react'` page, and sat
behind `{ "frontendOnly": [], "missing": false }` in the committed baseline for the whole
life of the defect. A human reading the objectui renderers found it. A gate reporting
green on a promise it cannot keep is worse than no gate — without one, someone checks by
hand.

Prime Directive #10 (declared ≠ enforced), landing on the thing whose job is to catch it.
Same shape as #1475's "spec declares 9 validation rules, the executor honors 3".

- **Renamed to what it does**, name and header together, because the name was load-bearing
  in the misreading: `check-react-blocks-declaration-parity.ts`,
  `react-declaration-parity.baseline.json`, and `frontendOnly` → `registryOnly` in the
  baseline ("the registry *declared* it", not "the frontend *implements* it").
- **The scope caveat is emitted on every run, clean ones included.** Whoever forms a
  belief about this gate is reading a CI log, not a source header.
- **It actually gates now.** `gen-sdui-manifest.sh` ran it without `--strict` and swallowed
  the exit code behind a `⚠`, so even the divergence it *could* see was recorded and never
  stopped (#4472 secondary finding 1). The ratchet fires only on divergence new since the
  accepted baseline, so a failure is always a deliberate registry change.
- **The claim is pinned by a test.** `check-react-blocks-declaration-parity.test.ts`
  asserts both directions of what the gate can see, that the caveat rides along, and that
  the implementation claim does not come back.

What it sees is unchanged and still worth having — `spec-only` (palette gap, soft),
`registry-only` (undocumented extension, ratcheted), `missing` (not registered / not
public). Exactly one class is invisible: both sides declare it, nothing reads it.

Evidence about the render path has to come from the render path, which is objectui's side.
`public-block-binding-reach.test.tsx` there mounts every public block declaring an
`objectName` under a recording `dataSource` and asserts the binding reaches it; its first
run separated five bound blocks from three unbound and surfaced two real defects of the
same shape (objectui#3144) — the confirmation this evidence was never obtainable here.
ADR-0082 carries the addendum; the 2026-06 audit carries a correction banner over the
assumption that carried the mistake ("the component reads its full config from the spec
schema at render" — an expectation, never measured).
