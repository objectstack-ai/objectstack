# ADR-0145: A `?: never` tombstone on the ui authoring face retires on the spec's own window — one major after the retirement it names, never longer

**Status**: Proposed (2026-10-28). `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted** by
the maintainer's merge. **This record declares; it implements nothing** — no tombstone is removed, no code, no schema,
no changeset. The first application batch is its own card, cut after the merge (see [Applying the rule](#applying-the-rule)).
**Decided by**: the maintainer's letter **A** of 2026-10-25T01:46Z on
[#25912](https://github.com/objectstack-ai/objectstack/issues/25912) (filed as objectui#13467), transcribed as ruling
[`6407810703`](https://github.com/objectstack-ai/objectstack/issues/25912#issuecomment-6407810703) over the seat's
options [`6407810621`](https://github.com/objectstack-ai/objectstack/issues/25912#issuecomment-6407810621). Executed
here as written and ⛔ not re-opened. Not taken: **B** (a tombstone leaves the day the spec retires its key — the remedy
would die before the authors on the previous major stop needing it) and **C** (no rule — the face only grows).
**Builds on**: [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (D2's one-major conversion window and its
2026-10-26 addendum, "retirement kits age out after one major" — the window this record reads, ⛔ never restates or
changes), [ADR-0049](./0049-no-unenforced-security-properties.md) (the retirement-tombstone convention the ui mirrors
spell through `retirementTombstone`), AGENTS.md Prime Directive #12 (a deletion that turns a refusal into a silent
accept is the defect it names) and Post-Task Checklist step 3 (the changeset).
**Governs**: every `?: never` member on the ui TypeScript authoring face — `ui/packages/types` and any `.d.ts` another
`ui/packages/*` package publishes — and the zod twin that mirrors it. ⛔ Not a live `@deprecated` member (an alias the
runtime still accepts): it is not a tombstone, and its retirement is its own card's.
**Registry**: the root `docs/adr/`. The ruling's words were "objectui `docs/adr/**`", written before the card moved into
this repository. Here `ui/docs/adr/` is the imported ObjectUI sequence, files untouched and indexed under the `ui-`
prefix (#26080, ruling A), and `scripts/check-adr-anchors.mjs` resolves a bare `ADR-NNNN` against the root registry
only, spelling a ui record `ObjectUI ADR-NNNN`; so a new decision governing `ui/` code lands here (Prime Directive #13:
an ADR lives in the repository whose code it governs).

---

## Context

The ui authoring face refuses a retired key **by name**. `BaseSchema` declares no index signature (ui/AGENTS.md #0.1),
so a fresh node literal refuses any key no declaration names; a retired key is kept declared as `key?: never` with a
`/** @deprecated RETIRED (…) … */` JSDoc whose text is the remedy, and the zod mirror declares the same key through
`retirementTombstone` (or a sibling helper in `zod/tombstone.zod.ts`), so a document that arrives as data is refused at
the key's own path with the same remedy. That is #0.1 working as designed.

What was missing is the exit. Nothing said when a tombstone leaves, so every retirement became a permanent member of
the published `.d.ts`: an AI author reading the face sees the refused keys beside the live ones, and the longer that
list, the more the face teaches what not to write instead of what to write.

The spec already answers the same question for its own face. ADR-0087 D2 applies each conversion for one major, and
its 2026-10-26 addendum carries the retirement kit — the `retiredKey()` tombstone with its conversion — through the
protocol major after the one it retired in, removing it when the next major is cut; after that the spec's strict
container refuses the key as an unknown one and the prescription lives in the protocol upgrade guide, the CHANGELOG
and git. The same addendum keeps a tombstone whose container **strips** unknown keys, because deleting it would turn a
refusal into a silent strip. The ui tombstone mirrors the spec's; this record reads that window on the ui face.

## Decision

### D1 — The rule

A `?: never` tombstone leaves the ui authoring face in the first release that follows the spec major in which the
retirement it names has its ADR-0087 conversion expire: **one major after the retirement**, the window the spec itself
runs, ⛔ never a longer one. Its remedy JSDoc ships for exactly that window.

Spelled on ADR-0087's clock, with **R** the protocol major the retirement belongs to (D2 says how R is read):

- the tombstone is carried through major **R + 1**, and is **due** from the cut of major **R + 2** — the same cut at
  which the spec's kit for a key retired in R leaves (ADR-0087, 2026-10-26 addendum);
- "major" is the major of the one `fixed` release group: `@objectstack/*` and `@object-ui/*` release together, lockstep
  with `PROTOCOL_VERSION` at every cut, and the spec's deletion gate reads its `CURRENT_MAJOR` off
  `@objectstack/spec`'s package version — so one clock serves both faces. A changeset's *level* is a different axis
  (ADR-0087's 2026-09-13 amendment, `scripts/check-changeset-no-major.mjs`) and moves nothing here;
- the window binds in both directions: a tombstone that names a spec retirement ⛔ never leaves while the spec still
  carries that key's kit (the ui author would lose the remedy the spec still prints), and ⛔ never outlives it — except
  as D3 holds it: a named refusal D3 keeps outlives the kit by design (the `agedOutSpecKeyRefusal` twins are that case).

### D2 — Reading R, including a retirement that predates ADR-0087

- **The tombstone names a spec retirement** (its JSDoc or zod guidance names the `@objectstack/spec` key or release it
  mirrors): R is the spec major that retired the key — the `RETIRED_KEYS_BY_MAJOR` row where one exists, otherwise the
  release-tag clock ADR-0087's deletion gate uses (a key already `[RETIRED]` on the authorable surface at
  `@objectstack/spec@<M>.0.0` retired in a major below M). ⚠️ A ui guidance that says a key "was retired in
  @objectstack/spec 17.0.0" (`agedOutSpecKeyRefusal`'s `retiredIn`) names the first release that **refused** it; by the
  gate's clock that key was already `[RETIRED]` at `17.0.0`, so R is 16, not 17. Reading the guidance's number as R
  runs a window one major longer than the spec's, which D1 forbids.
- **The spec retirement predates ADR-0087**, so no conversion was ever registered for it — the pre-launch one-step
  breaks of majors 12–15 that ADR-0087's "Ratified: the pre-launch launch-window exemption" section records, or a
  retirement older than D2 itself: it is counted **as if its conversion had run the one-major window from the major it
  retired in**. R is read on the same tag clock: the major of the first spec release that refused the key, where a key
  first refused by a major's `.0.0` cut counts in the major before it. No such tombstone is granted a fresh
  window by this record: with the protocol at major 18, any whose R is 16 or below is already due, and the first
  application batch takes it.
- **The tombstone names a ui-only retirement** (an objectui or ui card, no spec key behind it): the same window runs
  from the ui's own retirement. R is the major of the first `@object-ui/types` release tag (or the first release of the
  package that publishes the `.d.ts`) whose tree carries the tombstone, on the same convention: first carried by a
  major's `.0.0` cut counts in the major before it.
- **Where R cannot be read** (no tag, no row, a history the reader cannot reach): the tombstone is not due. The batch
  reports it as undated, ⛔ never guesses a date — a wrong date removes a remedy early, which is option B by accident.

### D3 — A deletion must leave a refusal: the container carve-out

The rule removes a **prescription**, never a **refusal**. ADR-0087's addendum keeps a spec tombstone whose container
strips unknown keys; the same test applies on both ui faces, judged per key:

- **TS face.** The `?: never` member leaves only where its container still refuses the key once it is gone — a type
  that declares no index signature, directly or through what it extends or intersects. Where the container is open, the
  member stays until the container is closed; closing it is its own card.
- **Zod face.** The zod twin leaves in the same release only where every zod face that judges authored metadata still
  refuses the key once it is gone. `BaseSchemaCore` ends `.passthrough()`, so a member deleted from a container derived
  from it is **kept in silence** by the tolerant face (the case `agedOutSpecKeyRefusal` in `zod/tombstone.zod.ts`
  exists for: the ui keeps its own named refusal once the spec's tombstone ages out). Such a twin stays, as the ui's
  refusal, until its container refuses unknown keys — the posture the spec's strip-container tombstones keep.
- **A mirror pair moves together — the key is held, not one face.** Where the TS type and its zod schema are a
  registered mirror pair (`ui/packages/types/src/__tests__/zod-mirror-parity.test.ts`), or the TS member is derived from
  the zod twin (`z.input` / `z.infer`), the two faces leave together or neither does: a zod container that would keep
  the key in silence holds the TS member too, and an open TS container holds the zod twin. That test's fourth
  direction, `MirroredUndeclaredKeys` (a key the zod side mirrors and the TS side does not declare), is the pin that
  turns a one-sided deletion red — ⛔ never grow its ledger to land one.

A tombstone held by D3 is listed by the batch with the container that holds it; it is not due, and it is not a
defect of this rule.

### D4 — The changeset that drops a tombstone

- Level **`minor`**, ⛔ never `major` (`scripts/check-changeset-no-major.mjs` is the authority), on every package whose
  published face loses the member.
- A **Breaking** note naming each removed key as `Type.key` and its remedy — the text of the JSDoc being deleted,
  carried over as the FROM → TO line — because from that release on the CHANGELOG is where an author who still writes
  the key finds what to write instead.
- The declaration lines and the ADR-0087 disposition marker the changeset gates require (AGENTS.md Post-Task Checklist
  step 3); ⛔ their vocabulary is not restated here — the gates print it when they fail.

### D5 — Not in this record

- **No sweep.** This record removes nothing; the first application batch is its own card.
- **The AGENTS.md pointer.** The ruling puts a one-line pointer to this record in ui/AGENTS.md #0.1 on the AGENTS.md
  pull request of [#25919](https://github.com/objectstack-ai/objectstack/issues/25919), not here.
- **No new gate.** The spec's deletion gate dates its own `[RETIRED]` lines; whether the ui face gets a twin of that
  clock is a later card's question, decided by measurement, ⛔ not by this record.

## Applying the rule

The first application batch — one card per major thereafter — finds due tombstones mechanically and reports
what it could not date. ⛔ No count is written here: the population moves, and the instrument is the reading
(ui/AGENTS.md #9).

1. **Enumerate.** Every `?: never` member under `ui/packages/*/src`, tests excluded
   (`git grep -nE '\?: never' -- 'ui/packages/*/src/**' ':!**/__tests__/**' ':!**/*.test.ts' ':!**/*.test.tsx'`), and,
   per member, its zod twin on the mirrored schema, whatever helper of `zod/tombstone.zod.ts` spells it.
2. **Date.** Per member, find the commit that introduced the tombstone with `git log -S'<the member line>' --reverse`
   on a **full** clone, then the first release tag that contains it (`git tag --contains`). The ui tree's history before
   the ui merge was not imported into this repository: a tombstone older than the merge is dated on a full clone of
   `objectstack-ai/objectui`, whose `@object-ui/types@*` tags carry that era. On a shallow clone the reading is refused,
   ⛔ never read as "no history" (`git rev-parse --is-shallow-repository`, with a control leg of known age). For a
   tombstone that names a spec retirement, read R from the spec (D2), not from the ui commit.
3. **Judge.** Due ⇔ the current major (D1) ≥ R + 2 and D3 does not hold the key. Report three lists — due, held by
   D3 (with the container), undated — and remove only the first.
4. **Remove and re-pin.** Delete the member, its JSDoc and its zod twin together (D3); move any test that pins
   the tombstone's named refusal to assert what the key meets now — the TS excess-property refusal and the strict zod
   face's unknown-key refusal — ⛔ never delete such a pin without its replacement. Ship the D4 changeset.

## Consequences

- The ui authoring face stops only growing: each major sheds the tombstones whose window closed, in step with the
  spec's own face, and the two faces never disagree about how long a remedy is printed.
- An author who writes a key after its window meets a bare unknown-key refusal on the TS face, without a remedy; the
  remedy lives in the CHANGELOG entry the D4 Breaking note writes. That is the trade ADR-0087 already made for the spec.
- D3 keeps some tombstones past their window, by design: a named refusal outranks a shorter face. Each one held is a
  pointer at a container that is still open.

## Alternatives considered

- **B — leave immediately when the spec retires the key.** Rejected by the ruling: the remedy disappears while authors
  on the previous major still need it.
- **C — no rule.** Rejected by the ruling: every retirement is a permanent obligation on the published face.
- **A longer ui window than the spec's.** Excluded by the ruling's "never a longer one": the faces would print a remedy
  for a key the spec no longer prescribes.
