# Spec ↔ frontend conformance — react blocks (2026-06)

**Question** (raised in review): we can't guarantee the frontend (objectui)
components actually implement the props the backend spec protocol declares —
should we confirm it?

**Answer**: confirmed — they diverge. Below is the first run of the conformance
check (`packages/spec/scripts/check-react-blocks-conformance.ts`), comparing the
spec schemas referenced by `REACT_BLOCKS` against the live objectui
registry-inputs manifest (`sdui.manifest.json`).

## How to read this

The registry `inputs` are the **designer palette** — a curated subset the visual
editor exposes — NOT the component's full prop surface. The component reads its
full config from the spec schema at render. So:

- **frontend-only** props (component declares an input the spec does not) are the
  reliable, actionable divergence: the spec is missing them or they are an
  undocumented extension. → fix the spec (or document the extension).
- **spec-only** props are a *softer* signal: mostly the palette being a subset of
  the protocol (expected), not proof the component ignores the prop. A block with
  **zero inputs** (the `record:*` family) declares no designer inputs at all.
- **matched** props appear in both.

## Findings (first run)

| block | matched | spec-only | frontend-only | notes |
|---|--:|--:|--:|---|
| `<ObjectForm>` (object-form) | 1 | 6 | **14** | frontend-only: formType, drawer*, modal*, split*, tab*, layout, columns, … — real component extensions absent from `FormViewSchema`. |
| `<ListView>` (list-view) | 1 | 44 | 2 | the palette exposes objectName/viewType/fields/filters/sort/options; the 44 `ListViewSchema` config props are read at render, not surfaced as inputs. |
| `<ObjectChart>` (object-chart) | 0 | 12 | 1 | the chart component's inputs (objectName/data/filter/aggregate) differ from `ChartConfigSchema` (title/series/axes/…). |
| `<RecordDetails>` (record:details) | 0 | 4 | 0 | **component declares zero inputs** — props live only in the spec. |
| `<RecordHighlights>` (record:highlights) | 0 | 2 | 0 | zero inputs. |
| `<RecordRelatedList>` (record:related_list) | 0 | 9 | 0 | zero inputs. |
| `<RecordPath>` (record:path) | 0 | 2 | 0 | zero inputs. |

**Summary**: 79 spec-only, 17 frontend-only, 0 blocks missing from the frontend.

## What this tells us (for an ADR)

1. There is **no single machine-readable "authoritative component prop surface"**
   today: the spec is the protocol, the registry inputs are a designer palette
   (subset), and the React prop types are the implementation. They are not kept in
   lockstep by any test — which is exactly the gap this audit confirms.
2. **Recommendation**: treat the spec as the protocol source of truth; make the
   registry inputs a faithful (documented) projection of it; add the genuine
   **frontend-only** props (e.g. `object-form` formType/drawer*/modal*) to the
   spec so the protocol covers what the component accepts; and run this check in
   CI (with a console manifest dump) as a ratchet so new divergence is caught.
3. The `record:*` blocks declaring **zero inputs** means the visual designer can't
   configure them — likely a real gap to close.

## Running it

```
# produce a manifest from the live registry (objectui), then:
MANIFEST=/path/to/sdui.manifest.json pnpm --filter @objectstack/spec check:react-conformance
# add --strict to fail on divergence (once triaged).
```

## Ratchet (implemented)

Running this on every framework PR isn't worth it — the manifest only exists at
console-build time. So the conformance check is wired in as a **baseline ratchet**
at the one place the manifest is produced for free: `scripts/build-console.sh`,
right after it dumps `sdui.manifest.json` from the freshly-built console registry.

- The accepted state lives in `packages/spec/react-conformance.baseline.json`
  (per block: the frontend-only prop set + whether the block is missing).
- `--baseline <path>` compares the current dump against it and reports **only
  regressions**: a component exposing a NEW undocumented prop, or a
  previously-present block vanishing. The soft `spec-only` signal is not gated.
- In `build-console.sh` it runs **warn-only** (never fails the console build).
  Use `--strict` to gate intentionally (exit 1 on regression).

```
# accept the current frontend state as the new baseline (after an intentional change):
MANIFEST=/path/to/sdui.manifest.json \
  pnpm --filter @objectstack/spec check:react-conformance \
  --baseline react-conformance.baseline.json --update
```

When the ratchet flags a new frontend-only prop, the fix is one of: declare it in
the spec schema (`packages/spec/src/ui/*.zod.ts`), add it to the block overlay in
`packages/spec/src/ui/react-blocks.ts`, or accept it via `--update`.
