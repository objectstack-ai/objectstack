# ADR-0079: The record display-name contract — `nameField` is the one canonical primary-title pointer

- **Status**: Accepted — implemented. **This file is a RETROACTIVE RECONSTRUCTION written 2026-08-08**, not a contemporaneous record; see [Provenance](#provenance-read-this-before-citing-this-file) before you cite it.
- **Decided**: 2026-06-28 (the decision), reconstructed 2026-08-08 (this file)
- **Reconstructed by**: #6634
- **Implemented by**: [#2434](https://github.com/objectstack-ai/objectstack/pull/2434) (foundation — `nameField` + resolver), [#2458](https://github.com/objectstack-ai/objectstack/pull/2458) (designate-only provisioning at the registry seam), [#2463](https://github.com/objectstack-ai/objectstack/pull/2463) (the author-time gate)
- **Builds on**: [ADR-0078](./0078-no-silently-inert-metadata.md) (author-time completeness must not be cloud-only), [ADR-0061](./0061-record-search-architecture.md) (`$search` field resolution reads the display field)
- **Precedent for**: [ADR-0085](./0085-object-semantic-roles-over-surface-hint-blocks.md) (`compactLayout` → `highlightFields` follows this ADR's alias mechanics "exactly"), [ADR-0098](./0098-pinyin-search-companion-column.md) (the search companion column is fed by this ADR's resolved display field)
- **Consumers**: `@objectstack/spec` (`data/display-name.ts`, `data/object.zod.ts`, `data/search-fields.ts`, `ai/solution-blueprint.zod.ts`), `@objectstack/objectql` (registry materialization seam, `$search` expansion, search companion), `@objectstack/metadata-protocol` (REST `$searchFields` ingress gate), `@objectstack/lint` (`validate-record-title`, `data-model-rules` R9), `@objectstack/platform-objects` and the first-party plugins/services (41 explicit `nameField:` designations), the `objectstack-data` / `objectstack-formula` skills

---

## Provenance — read this before citing this file

**This file was written on 2026-08-08, roughly six weeks after the decision it
records, by reading the code that cites it.** It is a reconstruction. Treat its
*emphasis and phrasing* as this author's, and its *content* as evidence-backed
but second-hand.

Three facts make that disclosure necessary rather than decorative:

1. **The decision is real and contemporaneous; only this file is late.** It was
   taken on 2026-06-28 and implemented across three PRs in two days
   (#2434 / #2458 / #2463). Nothing here is being decided now.

2. **A contemporaneous record exists — in a different repository.** #2434's
   own description ends: *"ADR: `objectstack-ai/cloud`
   `docs/adr/0079-record-display-name.md`."* The decision record was authored
   in the sibling `cloud` repo while every consumer of the decision was built
   here. That is why `docs/adr/0079-*` has never existed in this repo's
   history — not a loss, a **cross-repo split**. This file deliberately reuses
   the original's slug (`record-display-name`) so the two are recognisably one
   record.

   ⚠️ **The reconstruction could not be checked against that original.** The
   `cloud` repo was not reachable from the session that wrote this file. Where
   this document and the cloud original differ, **the cloud original is the
   decision** and this file is the bug — say so in an issue and this file gets
   corrected.

3. **Why write it here at all, rather than a pointer.** 77 files in *this*
   repo cite `ADR-0079` (measurement in #6634), and every other `ADR-NNNN` they
   cite resolves to `docs/adr/` *here*. A reader who follows the convention
   lands on nothing. A pointer to a repo most readers of this one cannot open
   is not an improvement on nothing; the decision has to be *readable* at the
   end of the citation.

**What is reconstructed vs. what is quoted.** Every clause in
[Decision](#decision) is traceable to a citing site, quoted or cited by
`file:line`. The [Context](#context) section is inference from the
implementation and the three PR descriptions. [What this
reconstruction does NOT settle](#what-this-reconstruction-does-not-settle) is
the honest residue: places where the 77 citing sites are silent, or where they
use one word for two different states. Those are **not** decided here.

---

## Context

A record's human name — what shows on a card, a lookup chip, a breadcrumb, an
approval notification, a search result — was, before this decision, a
render-time guess. Two object-level keys competed (`displayNameField`, a
render-only `titleFormat` template), neither was required, and consumers each
re-derived a title from whatever they found.

That is the ADR-0078 failure shape applied to identity: an object with no
resolvable title parses, "renders", and reports success — and every record it
holds is anonymous. The cost is asymmetric for an AI author, which is the
argument ADR-0078 makes in general and which lands hardest here, because the
symptom (records displaying as raw IDs) appears only in a UI a build never
opens.

The specific defects the implementation names:

- **`titleFormat` is unqueryable by construction.** It is a render-only
  template. `packages/lint/src/validate-record-title.ts:92` states the
  consequence: *"titleFormat is a render-only template the server cannot return
  or query"*. A title the server cannot return cannot be sorted on, searched,
  or sent in a notification body — so a title expressed only as a template is
  not a title, it is a client-side decoration.
- **A guessed title cannot be relied on by the layers underneath the UI.**
  `$search` expansion, the REST `$searchFields` ingress gate, the pinyin search
  companion column, and approval/notification display enrichment all need *one*
  answer to "what is this record called", computed the same way at every seam.
- **Two spellings, no canon.** `displayNameField` existed; nothing said it was
  the authority, and nothing stopped a third spelling appearing.

---

## Decision

### D1 — A record's title is a structural invariant, not a render-time hint

Every object has exactly **one** primary title field, and it is a **real stored
field** — `text`-ish, `autonumber`, or a `formula` whose result type is `text`.
Not a template, not a client-side composition.

> "A record's human title is a STRUCTURAL INVARIANT: every object has exactly
> one primary title field, which is a real STORED field (text / autonumber /
> formula whose result is text)."
> — `packages/spec/src/data/display-name.ts:6-8`

### D2 — `nameField` is canonical; `displayNameField` is a deprecated alias

`nameField` is the object-level pointer to the primary title field.
`displayNameField` is **accepted as a parse-time alias**, never as a second
contract:

- `ObjectSchema.parse` / `.safeParse` / `.create()` copy `displayNameField` onto
  `nameField` when `nameField` is absent
  (`normalizeNameFieldAlias`, `packages/spec/src/data/object.zod.ts:2082-2095`,
  installed on the parse path at `:2149-2158` and reached by `create()` at
  `:2204`).
- **Both keys are preserved on the parsed output** — deliberately, for
  cross-repo consumers and older tests that still read the old spelling
  (`object.zod.ts:2084-2085`).
- The schema's own text marks the direction: `displayNameField` describes
  itself as `[DEPRECATED → nameField]` (`object.zod.ts:1698`).

This is the alias mechanic ADR-0085 later adopted verbatim: *"Mechanics follow
ADR-0079's `displayNameField → nameField` precedent exactly: `compactLayout` is
accepted as a parse-time alias, copied onto `highlightFields`, both preserved on
output, describe marks the old key deprecated."*
(`docs/adr/0085-object-semantic-roles-over-surface-hint-blocks.md:57`)

### D3 — `titleFormat` is retired in favour of `nameField`

`titleFormat` is deprecated and lint-warned, and an explicit `nameField` takes
precedence over it. It **still parses** — existing metadata keeps loading — so
the diagnostic is advisory, not an error:

> "`title-format-retired` — flags an object that declares a `titleFormat`. That
> key is a render-only template the server can neither return nor query;
> ADR-0079 retires it in favour of `nameField`. The schema still parses it
> (existing metadata keeps loading), so this is advisory, not an error."
> — the #2463 changeset (`.changeset/adr-0079-record-title-gate.md`, since
> consumed by the release)

**Migration is stated, not left to the author**: a single-field title becomes
`nameField: '<field>'`; a **composite** title becomes a `formula` field with
`returnType: 'text'`, designated as the `nameField`
(`validate-record-title.ts:91-96`; the worked example is
`content/docs/data-modeling/formulas.mdx:94-102`).

### D4 — One resolution order, shared by every consumer

    nameField  ??  displayNameField  ??  deterministic derivation

An **explicit pointer is honored even when the field it names is not
title-eligible** — the author asserted it, and eligibility gates *derivation*
only (`display-name.ts:resolveDisplayField`).

Derivation, restricted to title-eligible fields, is ranked:

1. name-ish **exact**, in priority order — `name` > `title` > `subject` >
   `label` > `full_name` > `display_name` (so `name` beats `title` regardless of
   declaration order);
2. name-ish **affix** — `*_name` / `*_title` / `name_*`, by declaration order;
3. the **first** title-eligible field by declaration order.

The two runtime seams that consume it compute it identically, and each says so
where it does:

- `packages/objectql/src/engine.ts:5212` — *"[ADR-0079] `nameField` is the
  canonical primary-title pointer; `displayNameField` is the deprecated alias
  (still honored)"*, feeding `expandSearchToFilter`.
- `packages/metadata-protocol/src/protocol.ts:4793` — *"[ADR-0079] Same
  precedence the engine's search expansion applies"*, feeding the REST
  `$searchFields` ingress gate.

That duplication is intentional and is the point: **one precedence, asserted at
both seams, so the request gate and the query engine cannot drift.**

### D5 — Title eligibility is a fail-closed allowlist

Eligible: `text`, `textarea`, `email`, `url`, `markdown`, `html`, `richtext`,
plus `formula` when its result type (`returnType`, or `valueType` for
cross-repo compatibility) is `text`. Everything else is ineligible, and an
**unknown/new field type is ineligible by default** — a positive allowlist, so
a field type added later cannot silently become a title
(`display-name.ts:TITLE_ELIGIBLE_TYPES` / `isTitleEligible`).

Two judgement calls are recorded rather than left implicit:

- **`email` is eligible, `phone` is not.** *"`phone` is deliberately excluded (a
  phone number is not a title); `email` IS eligible (commonly the human handle
  on identity-ish objects)"* (`display-name.ts:71-72`).
- **`autonumber` is a valid primary but is never *derived*.** *"an autonumber is
  a valid primary only when an author points at it explicitly … not something we
  silently pick"* (`display-name.ts:66-68`).

### D6 — A record never renders as "Untitled"; the floor is `Record #<id>`

`resolveRecordDisplayName` returns the value at the resolved field, and falls
back to a stable `Record #<id>` — *"NEVER a bare 'Untitled'"*
(`display-name.ts:13-14`). A view may override the object's choice for one
render via `viewTitleField` (e.g. a list view labelling rows by another column);
that override is per-render and does not change the object's title.

### D7 — Provisioning is designate-only at the materialization seam

`SchemaRegistry.registerObject` runs `provisionPrimary(schema, { synthesize:
false })` — for **owned** objects only, after `applySystemFields`
(`packages/objectql/src/registry.ts:1079-1090`).

- Where a title-eligible field already exists, `nameField` is **designated** —
  so it is reliably populated for normal / user-built / AI-built objects.
- Where nothing is eligible, the object is left **exactly as-is**. No `name`
  column is synthesized here, because that is a schema migration on dozens of
  title-less system tables.
- **Extensions must not redesignate the owner's title** — hence owned-only.

The `synthesize: true` half of `provisionPrimary` exists and guarantees a
primary by adding a `name` text field, but is deliberately **not** wired at this
seam (#2434's "Staged (deliberate)" section, kept as the `TODO(ADR-0079)` that
#2458 then resolved in the designate-only direction).

### D8 — The author-time gate is advisory by design

`@objectstack/lint`'s `validate-record-title` reports two warnings —
`title-format-retired` (D3) and `title-unresolvable` (`objectTitleCompleteness`
returns `status: 'none'`) — and **never errors**:

> "Both are warnings: the auto-provision transform and the id floor mean a green
> build never ships a fully title-less object."
> — `packages/lint/src/validate-record-title.ts:26-27`

It runs on `os build` / `os validate` / `os lint`, the MCP authoring surface and
hand authoring — *not* only on the cloud graph-lint path. That is ADR-0078's
"not cloud-only" principle applied
(`validate-record-title.ts:12-14`, `packages/lint/src/authoring-rules.ts:668-678`).

### D9 — There is exactly one title pointer; a second is not a tolerable alias

`primaryField` was read as a title pointer by two lint rules and was **removed**,
not declared, in #6326. The reasoning is recorded at
`packages/lint/src/data-model-rules.ts:404-409`:

> "The maintainer ruled remove, not declare: `nameField` is ADR-0079's one
> canonical title pointer and a second parallel pointer contradicts 'one Zod
> source per metadata type' (Prime Directive #7). Do not reintroduce it as a
> tolerated alias — a consumer-side `??` for a key the producer rejects is
> exactly the second de-facto contract Prime Directive #12 bans."

Note the asymmetry with D2, because it is the whole distinction: a **producer-
side, parse-time, both-keys-preserved** alias with a stated deprecation
(`displayNameField`) is the sanctioned migration mechanic; a **consumer-side
`??`** for a key the schema rejects (`primaryField`) is a banned second
contract. Same-looking code, opposite verdicts.

### D10 — Downstream: the name field leads the search set by ORDERING only

Search-adjacent consumers read the resolved display field, but it does not
buy the field an exemption from their own exclusion rules. `$search` field
resolution leads with the display field **as ordering, never as membership**
(`packages/spec/src/data/search-fields.ts:75-92`, #4483) — the concrete failure
that forced the distinction being D7's designate-only pass setting `nameField:
'id'` on tables whose only textual column is the primary key, which had turned
`$search` into a substring scan over the primary key. The ADR-0098 pinyin
companion column likewise takes *only* the resolved display field as its source
(`packages/objectql/src/search-companion.ts:19`, `:104`).

---

## Status of the surface today (2026-08-08)

| Key | Spec status | Ledger (`packages/spec/liveness/object.json`) |
|:---|:---|:---|
| `nameField` | canonical, `.optional()` | `live` — "ADR-0079 canonical record-title pointer" |
| `displayNameField` | deprecated alias, still parsed and preserved | `live` — "still read by objectui RecordDetailView + `resolveDisplayField` back-compat" |
| `titleFormat` | deprecated, still parsed, lint-warned | `live` — "objectui (`{{record.field}}` interpolation)" |

41 first-party objects across `platform-objects`, the plugins and the services
carry an explicit `nameField:` with an `[ADR-0079]` comment.

---

## What this reconstruction does NOT settle

These are places where the 77 citing sites are **silent, or use one word for two
states**. They are recorded as open, not resolved by this file. Deciding any of
them needs a maintainer, and — for the first three — probably the cloud original.

1. **When, if ever, does `nameField` become required?** #2434 recorded "No hard
   `.refine()` requiring a title (would reject existing metadata)" and
   `object.zod.ts:1684-1685` still says *"Optional at the schema level for now
   (a hard required-refine is staged)"*. Two months on, "staged" names no
   trigger and no criterion. Nothing in the tree says what would make it fire.

2. **When is the `displayNameField` alias retired?** Its own precedent argues
   for a deadline and does not have one: ADR-0085 copied this alias mechanic for
   `compactLayout`, ran it for *"one deprecation window"*, and retired it in
   framework#2536. `displayNameField` has run since 2026-06-28 with no window
   declared, and the ledger records a live cross-repo reader (objectui
   `RecordDetailView`), so retiring it is a cross-repo change, not a local one.

3. **"Retired" is used for a key that is still live.** D3's citations call
   `titleFormat` *retired*; the liveness ledger records it `"status": "live"`,
   the schema parses it, and objectui still interpolates it. Under ADR-0049's
   enforce-or-remove vocabulary "retired" normally means *gone*. Here it means
   *deprecated, lint-warned, still parsed, still read cross-repo*. The citations
   are consistent with each other about the behaviour and inconsistent about the
   word.

4. **`code` is name-like to lint and not to spec.** `packages/lint/src/data-
   model-rules.ts:36`'s `NAME_LIKE_FIELDS` includes `code`; spec's derivation
   set (`display-name.ts:NAME_ISH_EXACT`) does not. So an object whose only
   name-ish field is `code` passes lint's R9 "has a title face" check while
   `resolveDisplayField` will not derive `code` as its title (it may still be
   picked by tier 3, as the first title-eligible field — but by a different rule
   and a different priority). Whether the two sets are meant to be the same set
   is not stated anywhere; this reconstruction does not assume they are.

---

## Alternatives considered

Reconstructed from what the implementation rejected; not an exhaustive record of
the 2026-06-28 discussion.

- **Keep `titleFormat` as the composite-title mechanism.** Rejected: a template
  the server can neither return nor query cannot be sorted, searched, or put in
  a notification. Composite titles are expressible without it, as a text formula
  field designated `nameField` (D3), which the server *can* return and query.
- **Require `nameField` immediately (hard `.refine()`).** Rejected as staging,
  not on the merits — it would reject metadata that already exists (#2434). See
  open question 1.
- **Synthesize a `name` column wherever no title is derivable.** Rejected at the
  registry seam: it is a DB migration on every title-less system table. The
  capability is kept behind `provisionPrimary`'s `synthesize` option for
  authoring-time use (D7).
- **Let each consumer derive a title for itself.** Rejected implicitly by
  building one shared pure module and having both search seams assert they use
  the same precedence (D4). The alternative is drift that shows up as a request
  gate and a query engine disagreeing about what is searchable.
- **Accept `primaryField` as an additional tolerated alias.** Rejected
  explicitly by the maintainer in #6326 (D9).
