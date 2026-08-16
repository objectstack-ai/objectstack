# Unknown-key strictness ledger — the authorable / wire / open triage (#4001)

**Date**: 2026-07-30 · **Issue**: [#4001](https://github.com/objectstack-ai/objectstack/issues/4001) · **Builds on**: #3405 / #3746 (the `ActionParamSchema` template), #1535 (`ObjectSchema.create` unknown-key error), ADR-0089 D3a (view/page strict), ADR-0078 (no-silently-inert-metadata), ADR-0049 (enforce-or-remove), ADR-0054 (ratchet idiom)

Zod's default is `.strip`: a key the schema does not declare is **silently
discarded** and the instance goes on parsing. On an authorable surface that is
the worst failure mode — the author (human or AI) gets a success envelope and
ships metadata that quietly ignores their config. This ledger is #4001 step 1:
the persisted classification of *which* `z.object` sites that default is wrong
for, so the `.strict()` ratchet advances on evidence instead of a one-shot
sweep. **1885 sites was never the target number** — a large share of the spec
is wire/response shape where strictness would be a forward-compat bug.

## Format contract — numbers are generated, verdicts are hand-written (#5107)

| | Where it lives | Who writes it |
|---|---|---|
| Site counts, strip counts, section headers, per-class subtotals, posture totals | [**`…strictness-ledger.counts.md`**](./2026-07-unknown-key-strictness-ledger.counts.md) — generated | `pnpm --filter @objectstack/spec gen:strictness-ledger` |
| `Class` verdicts, evidence, findings log, exemption rationales, batch history | **this file** — hand-written | you |

**Why the split.** Every merge conflict this file produced during the campaign
landed in its numbers, and they merged in the one way that does not announce
itself: two batches each delete their own rows and decrement a header by their
own *correct* delta, git merges the rows cleanly because they do not overlap,
and the subtotal — which conflicts with nothing — merges **clean and wrong**.
Seven cases in a single day; the `ui/` subtotal was written as 119, 110 and 100
by three batches whose merge is 91, a number no branch ever wrote down. The
prose conflicted once, and that conflict was meaningful. So the numbers left.

**Rules.**

- **Never hand-edit the counts file, and never hand-patch a number in it.** It
  carries `merge=os-regen` (#4675): a merge does not text-merge it, it records
  it as pending and `pre-commit` refuses the commit until it is regenerated from
  the merged tree — the only state in which the numbers are right.
- **Do not write counts into a row.** Add the row with its `Class` verdict and
  its evidence, then regenerate.
- **`check:strictness-ledger` gates both halves**: the artifact must be fresh
  against the AST, *and* every row here must name a file that still exists and
  still has the sites the row is a verdict about. Both directions fail loudly.
- The `Class` cell in the **remaining-strip map** is machine-read (the subtotals
  are arithmetic over it), so it has a grammar:
  `<verdict> [(p)] [· <n> <verdict>, …]` where `<verdict>` is one of
  `authorable` · `verify` · `mixed` · `split` · `wire` · `open` · `no door` ·
  `no gate` · `covered`. `verify` counts as authorable (a readiness flag, not a
  class). A `mixed`/`split` row still carrying `(p)` counts as *unresolved*; one
  that has been resolved **must** state its own split (`mixed · 6 authorable`) —
  the gate refuses to guess, because a guess would be published as a confident
  subtotal. The `Class` column in the **triage** table is free prose and is not
  parsed.
- **Vocabulary changes, and where they came from.** The list above is a machine-read
  contract, so it grows only by ruling, and only when an existing word would
  prescribe the WRONG ACTION rather than merely an imprecise label: `no door` at
  批 13, `no gate` at 批 15, and **`covered` at [#5249](https://github.com/objectstack-ai/objectstack/issues/5249)**
  (maintainer ruling 2026-08-06, option A) for a shape that is mechanically
  `no door` but whose vocabulary is fully gated at every consumer — where
  `no door`'s prescribed ADR-0049 retirement would delete a live shared key.
  Adding a word is cheaper than the sweep a wrong word invites; rounding to the
  nearest verdict is the failure mode this list exists to prevent.

## Classification rule

One question decides the class: **who writes this schema's input?**

| Class | Input written by | Unknown-key policy |
|---|---|---|
| **authorable** | A human or AI author, into `*.object.ts` / `defineStack` config / Studio / MCP | `.strict()` + fixable error (the ratchet target) |
| **wire** | Another machine: server responses, connector payloads, runtime envelopes, persisted runtime state | stay tolerant (`.strip` / `.passthrough`); strictness here turns an upstream *addition* into our parse crash |
| **open** | Deliberately schemaless user data (record bodies, per-node-type `config`, React props) | stay open; a *sibling* contract validates it (e.g. a node executor's `configSchema`, #4027/#4040) |
| **no door** | **Nobody — nothing parses it.** The shape is exported and typed, but no schema declares a carrier key for it, so it is unreachable from every metadata-type root and from `defineStack`, and nothing calls `.parse()` on it outside its own test. Added at 批 13, when the first run of files resolved its `(p)` this way | **out of this ratchet's scope.** `.strict()` is a property of a PARSE; with no parse it enforces nothing and only makes a dead slot look load-bearing — *"a precisely-validated dead slot is the more convincing lie"* (#4583). The live question is ADR-0049 enforce-or-remove — retire the vocabulary or give it a carrier — so a row here points at an issue, never at a batch (#4988, #5015) |
| **no gate** | **An author — through a carrier this protocol does not PARSE.** The carrier key exists and is live (authors write it, a renderer reads it), but no `.parse()` sits between them; whatever checking exists re-derives the schema's rules by hand. Added at 批 15 on `ChartAggregateSchema` (`<ObjectChart aggregate={…}>`); 批 17 then found the same shape at scale — all 29 sites of `ui/component.zod.ts`, behind `PageComponentSchema.properties`, which made it the largest class in `ui/` **at the time**. ⚠️ **Both exemplars have since had their parse wired and LEFT the class** (#5020 / #5068 — their strip rows carry the flips), so this bucket's current population is **ZERO**: `…counts.md` reads `no gate — carrier live, no parse | 0` globally and in all five directory subtotals. Read the exemplars as the shape's definition, not as a live inventory — there is no un-wired `no gate` site anywhere in the tree today. The verdict stays in the vocabulary regardless: an empty class is not a defect, it is a word waiting for the next site that measures this way (#5249 established exactly that when it ADDED `covered` rather than rounding an unlike shape onto a wrong-action verdict) | **out of this ratchet's scope, for the opposite reason.** Same absent parse, so closing it still enforces nothing — but the vocabulary is ALIVE, so the fix is to wire the parse at the carrier's own gate, not to retire anything. A row here points at that wiring issue |
| **covered** | **An author — but never through THIS site.** A module-private shape FRAGMENT with no carrier key and no `.parse()` of its own, whose keys reach authors only after being copied into consumers that each gate them. The copy must be a `...X.shape` SPREAD, because a spread lands the keys in a fresh `z.object` whose posture is its own — `.extend()` / `.merge()` / `.omit()` INHERIT the base's posture, which makes the base a real door and puts it back in `authorable` (finding 16, and `view.zod.ts`'s `FormFieldBaseSchema` one directory over). Added at #5249 on `ui/app.zod.ts`'s `BaseNavItemSchema` | **out of this ratchet's scope, and the follow-up is NOTHING.** Same absent parse, so closing it enforces nothing — and unlike `no door` the vocabulary is fully ALIVE and fully GATED, at every consumer, so retirement would delete keys those consumers still accept and check. This is the one verdict that prescribes no next step, which is exactly why it needed its own word: a row here is DONE, not queued |

A fourth answer to "who writes this input" is **nobody**, and it is only
reachable by measurement rather than by reading the file: `no door` was added at
批 13 after a BFS from every authoring root (with positive controls) came back
empty on five `ui/` files at once. Reading a schema's exports and JSDoc cannot
distinguish it from `authorable` — which is exactly why the `(p)` exists.

The measurement needs a positive control **in the same run**, or an `UNREACHABLE`
verdict is indistinguishable from a broken walker. 批 14's run: 6860 nodes from
the 24 metadata-type roots + `defineStack`, four controls (`Page` / `Action` /
`DashboardWidget` / `Webhook`) all `root-graph`, and injecting a synthetic carrier
flipped both of its no-door shapes to `root-graph`.

批 14 then found the thing 批 13's five whole-file verdicts could not show: the
class is per SCHEMA like every other, and a file can **split across it**.
`ui/sharing.zod.ts` held one live door (`SharingConfig` — carried by
`FormViewSchema.sharing`, and `rest-server.ts` mounts the anonymous form routes on
`sharing.allowAnonymous` + `sharing.publicLink`) beside one shape nothing in the
repo so much as named (`EmbedConfig`). A file-level verdict would have been wrong
in one direction or the other, whichever way it fell — tightening a dead slot, or
leaving the live anonymous-access door open.

The two halves have since been disposed of separately, which is the split's real
vindication: `SharingConfig` was closed by 批 14 and is still live, and
`EmbedConfig` was REMOVED at #5015 under ADR-0049. Read the example as history
now — the file no longer splits, because the half that made it split is gone.

批 15 then found that the answer splits again, and that the split decides the
follow-up. Both `no door` and `no gate` fail the same measurement — no parse, so
no strictness — but they fail it from opposite directions. #5249 then found a
THIRD direction off the same two axes, and it is the one the two-axis table read
backwards: a shape that is carrier-absent AND parse-absent, i.e. mechanically
`no door`, whose keys are nonetheless fully alive and fully gated because a
consumer spread them:

| | carrier key | parse | vocabulary at the consumers | right next step |
|---|---|---|---|---|
| **`no door`** | absent | absent | absent too — nothing spreads or reads it | ADR-0049 enforce-or-remove — there is no author to protect |
| **`no gate`** | **live** | absent | live, **ungated** — a renderer reads what nothing checked | wire the parse at the carrier's own gate — retiring it would break a working feature |
| **`covered`** | absent | absent | **live and fully gated** — every consumer spread the shape and applied its own `.strict()` | **nothing.** The keys are already enforced everywhere they are reachable; closing this fragment is a guaranteed no-op and retiring it deletes a live shared key |

Read the wrong one and the prescribed action is not merely wasteful but
destructive: retiring a `no gate` vocabulary deletes something authors use and
renderers run, and retiring a `covered` one deletes a key its consumers still
accept. So the measurement has to report the CARRIER, the PARSE **and the
consumers' own posture** separately; "unreachable from the metadata roots" alone
cannot tell any of the three apart, because a react-tier prop is a real authoring
door that no metadata BFS can see, and a spread fragment has no door of its own
while its keys have nine.

All three are verdicts, not TODOs. What they share is the discipline that produced
them: a verification step's correct output includes "this was never the ratchet's
job", and a batch unable to return that answer will close things to look
finished.

Mixed files carry both — classify per schema, not per file. A **response-side
extension of an authoring schema** (e.g. `EffectiveObjectPermissionSchema`)
must explicitly `.strip()` back, because `.extend()` inherits `.strict()`.

## Standard wiring

`strictObject` in `shared/strict-object.ts` is the one call a strict authoring
schema needs:

```ts
lazySchema(() => strictObject({ surface, history, aliases?, guidance? }, { ...shape }))
```

- `aliases` — semantic near-misses edit distance cannot reach (`visibleWhen` →
  `visible`, `from` → `source`, `read` → `allowRead`).
- `guidance` — exact-key prescriptions: **tombstones for retired keys** (the
  rejection carries the upgrade — AGENTS.md Post-Task Checklist #3) and
  wrong-layer pointers (`apiOperations` is response-side; `objectName` belongs
  on the start node).
- **Both are optional.** A schema with neither still names the surface, echoes
  the offending key, and suggests the closest declared one. Curation is an
  upgrade, not a precondition — and treating it as a precondition is part of
  why this ratchet moved as slowly as it did.

**No key list, and no drift probe.** Earlier steps hand-transcribed a
`const X_KEYS = [...] as const` beside each schema and pinned it with an
"accepts every declared key" test, because the schema body is lazy. That was 34
key arrays and 16 probe files with most of the surface still ahead — and it was
never necessary: `knownKeys` feeds only the edit-distance fallback, and the
shape object is right there at the call site. `strictObject` reads the keys from
`shape`, so the two copies become one and the probe has nothing left to catch.
`extraKeys` covers the one case the shape cannot see: a base `.extend()`ed
elsewhere.

`strictUnknownKeyError` stays exported for the schemas that cannot use the
helper — notably `z.lazy()` discriminated unions, whose variants each need
their own key set.

Every ratchet step ships only with the empirical zero-breakage pass: full
`@objectstack/spec` suite + `tsc`, downstream consumer suites, and
`objectstack validate` on all three example apps. Inference is not evidence —
the first application of this gate (below) caught a real spec gap.

## Ratchet state

### Already strict before #4001 (for reference)

| Surface | Since |
|---|---|
| `data/object.zod.ts` — `ObjectSchema.create()` unknown-key error + `UNKNOWN_KEY_GUIDANCE` tombstones; strict capabilities / tenancy / CRUD-override blocks | #1535, #2377, #2763 |
| `ui/view.zod.ts` / `ui/page.zod.ts` — form/page component schemas | ADR-0089 D3a |
| `ui/dashboard.zod.ts`, `data/field.zod.ts` (blocks), `ai/agent.zod.ts`, `ai/tool.zod.ts` (blocks) | various |
| `ui/action.zod.ts` — `ActionParamSchema` (the template) | #3405 / #3746 |

### This step (#4001 Tier-A slice)

| Schema | File | Evidence class |
|---|---|---|
| `PermissionSetSchema`, `ObjectPermissionSchema`, `FieldPermissionSchema`, `AdminScopeSchema` | `security/permission.zod.ts` | A silently dropped key on the capability container is the ADR-0049 asymmetry itself; retired `contextVariables` (ADR-0105 D11) / `isProfile` (ADR-0090 D2) get tombstones |
| `FlowSchema`, `FlowNodeSchema`, `FlowEdgeSchema`, `FlowVariableSchema` | `automation/flow.zod.ts` | Most AI-authored surface; cloud#688 / #2419 class. Node `config` stays **open** (executor `configSchema` owns it, #4027/#4040) |
| `ActionParamSchema` re-homed onto the shared factory | `ui/action.zod.ts` | #3746 template, byte-identical messages |

**Findings log** — three real defects the gate caught in its first two runs.
All three had been invisible: each key was written by real code, silently
dropped at parse, and nothing failed.

1. **`PermissionSetSchema` could not represent `description`** — yet the
   built-in default sets author it and `plugin-security`'s Setup projection
   reads it (`permission-set-projection.ts`). Fixed contract-first: it is now
   a declared key.
2. **`PermissionSetSchema` could not represent the ADR-0010 protection
   envelope** — `MetadataPlugin`'s artifact loader calls `applyProtection` on
   **every** metadata type, and `getMetaItemLayered` → `saveMetaItem`
   round-trips a body carrying the stamped `_packageId` / `_provenance`. Every
   sibling registered type (object / view / app / dashboard / report /
   dataset / flow / agent / tool / skill / email_template) spreads
   `MetadataProtectionFields`; permission was the outlier, so the envelope was
   stripped on every parse. Now declared, with the author-facing `protection`
   block alongside it (translated generically by `applyProtection`).
   Caught by the dogfood gate as a hard 422 on the ADR-0094 overlay path.
3. **A dogfood fixture flow carried `sharingModel`** — an object-level OWD key
   copy-pasted onto `flowTouch` in `flow-touch-fixture.ts`, complete with an
   ADR-0090 "grandfather stamp" comment describing a gate that does not exist
   for flows. Exactly the #4001 failure mode in the wild: authored in good
   faith, silently discarded, believed to be in effect. Removed (the identical
   stamp on the fixture's *object* is real and stays).

5. **`position.test.ts` asserted a fictional hierarchy** (step 2) — see the
   entry below.
6. **The platform's own Account app declared `defaultOpen` on three navigation
   groups** (app step, PR B). `expanded` is the schema key; `defaultOpen`
   never was — so all three groups shipped COLLAPSED while their author
   believed they opened by default. Fixed at the producer, and the spelling
   now aliases to `expanded`. Note where this one was found: not in a tenant
   project, but in first-party platform metadata that had been shipping for
   releases.
7. **This campaign's own fix signposted the way into the failure mode it
   exists to kill.** The strict rejection on a misplaced `host` prescribed:
   "Move it to `config: { host: … }`; the driver's own configSchema validates
   it there." False twice over — `DriverDefinitionSchema.configSchema` is a
   `z.record` that both bundled driver specs set to `{}`, and nothing in the
   repo reads it. So an author who made a *recoverable* mistake at a place that
   now catches it was directed, with the platform's authority, at a slot where
   the same mistake is silent again: `config: { hostname: … }` is stripped and
   the datasource connects on localhost — #4001's original bug verbatim, one
   level down. First corrected to name the per-driver shape instead of promising
   a gate; **#4410 then built the gate**, so the prescription makes a validation
   claim again and the claim is true. **A wrong instruction is worse than
   none**, and worst for an AI author, whose only signal is whether the parse
   complained.

   Two things #4410 had to fix before the sentence was safe to write, both
   instructive beyond this schema. The prescription has to name the key the
   contract *lands on*, not the one the author typed — pointing a misplaced
   `user` at `config: { user: … }` when postgres spells it `username` would
   swap a one-step correction for a two-step one. And a gate over `config`
   means every key inside it now claims to be honoured, which forced a per-key
   audit against the code that reads them: `indexes` / `maxRecordsPerObject`
   (memory) were removed as inert, while `datasource.pool`, `schemaMode`,
   postgres `schema` / `applicationName` / `statementTimeout` and mongo
   `password` / `authSource` / `options` were **wired**, having been declared
   and dropped on the floor. Enforcing a contract and honouring it are the same
   task from two directions.
8. **Three more registered types could not represent their own ADR-0010
   protection envelope** — `seed`, `doc` and `validation`, found by applying the
   registered-type lens above. Exactly the gap that made `permission` return a
   hard 422 on the ADR-0094 overlay path (entry 2) and that `position` carried
   until step 2: `MetadataPlugin`'s artifact loader stamps `_packageId` /
   `_provenance` on **every** registered type, and `getMetaItemLayered` →
   `saveMetaItem` round-trips a body carrying them, so an undeclared envelope was
   stripped on every parse. Declared on `seed` and `doc` as part of closing them;
   `validation` still carries it (its union shape defers the conversion).

   Worth noting how it kept recurring: this was the **fourth** occurrence of one
   defect, found four times by four different routes, because nothing checked
   the invariant directly. So it is checked now —
   `kernel/metadata-type-schemas.test.ts` asserts it over the whole registry.

   **It found two more on its first run.** `hook` and `datasource` had both gone
   `.strict()` in the #4001 data step *without* declaring the envelope, so both
   were in the worst class — rejecting their own loader's output, a live hard 422
   on the ADR-0094 overlay path, sitting on `main`. Three prior hand-searches for
   exactly this defect had walked past them. That is the argument for writing the
   check in one line: **finding the same defect repeatedly by hand is evidence
   the check is missing, not evidence the search worked.**

   The check separates the two severities, because they are not the same bug:
   *rejecting* the envelope is live breakage and is asserted unconditionally with
   no exemption list; *not declaring* it silently loses protection metadata on
   round-trip and is tracked with a debt list — and each entry there becomes a
   rejection the day its schema is closed.
9. **And then that check turned out to be hollow — one change after this file
   recorded the same lesson about the gate above.** Its declaration half probed
   each schema with one generic body and asked whether `_packageId` survived. A
   type whose required fields that body did not satisfy failed for unrelated
   reasons and the assertion returned early, so **24 of 25 registered types took
   that early return**. Only `field` was ever really checked, and the suite
   reported green.

   Rewritten to walk the schema *structurally* — unwrapping `lazy` / `pipe` /
   `optional` / `default`, expanding unions — which needs no valid instance and
   therefore cannot skip. Two guards keep it honest: a type the walker cannot
   resolve is a hard failure (the walker going quiet is precisely when the test
   would otherwise stop covering something), and the debt list carries a reverse
   pin that fails when an entry is fixed, so the list cannot outlive its debt.

   It then found **8** undeclared envelopes rather than 1 — `action`, `book`,
   `field`, `job`, `mapping`, `page`, `translation`, `validation`. `job` and
   `book` were closed immediately; 6 remain.

   Three occurrences now of one pattern, in three different instruments: the
   ledger gate's non-recursive directory walk, the strip probe's early return,
   and (from the other direction) `strictObject(` not matching the site count.
   Each was a measuring tool reporting completeness it did not have. **The rule
   this file keeps re-deriving: before trusting a green check, make it go red on
   something you know is there.**

10. **A bespoke guard against silent stripping could only catch the ten
    mistakes someone had already thought of — and only at one of the two
    doors.** `translation` (step 5). #3778 retired the object-first (`o.<object>`)
    dialect and hit this campaign's problem head-on: an item authored in the old
    shape saved cleanly and then resolved to nothing. The fix available then was
    a `z.preprocess` that scanned for ten named keys and raised a 422 with the
    right destination for each.

    It worked, and it had the shape every workaround for `.strip` has. Ten keys
    were enumerated; `object` for `objects`, `message` for `messages`, a group
    invented wholesale — all still stripped in silence. And it ran on the *item*
    door only, so those same ten keys written into a file-authored bundle (the
    path the examples and the platform apps actually use) were dropped with no
    complaint at all. **The same asymmetry #4522 found in #1535's object guard**:
    covered at one door, open at the other, by two different authors solving the
    problem in front of them.

    With the shape closed the guard is redundant — `.strict()` catches all ten
    and everything else, at both doors — so it was retired and its ten
    prescriptions became `guidance` on the rejection. Which is the general
    lesson: **what was worth keeping from a bespoke guard is never the
    detection, it is the prose.** Detection generalizes for free the moment the
    default flips; the sentence telling an author where their content goes does
    not, and is the part these workarounds were really carrying.

11. **The canonical "create seed ≠ spec" gate could only fail in one
    direction.** `metadata-create-seeds.test.ts` exists so a designer's minimal
    create shape cannot drift from the schema — it asserts every seed parses.
    The `translation` seed ships `{ name, label, locale, objects }`, and the type
    declared neither `name` nor `label`, so **two thirds of the authoritative
    create shape was being stripped while the gate that exists to catch exactly
    that reported green.** A gate built on a `.strip` schema can catch a MISSING
    required key and can never catch an EXTRA undeclared one; it was doing half
    its job and reading as if it did all of it.

    Fixed by declaring them — `translation` was the only registered type of 25
    without a `name`, and that irregularity is what an AI author trips on — and
    classified honestly in the liveness ledger as dead *body* keys, the row
    column being the live one. Fifth instance of finding 9's pattern, and the
    first where the blinded instrument was a gate rather than a measurement.

12. **The campaign's own helper started signposting removed keys.** `skill`
    (batch 4) closed with `strictObject` while still carrying `retiredKey`
    tombstones — and `strictObject` built its candidate list from
    `Object.keys(shape)`, which includes them. So:

        Unrecognized key(s) on this skill: `triggerPhrase`. …
        Did you mean `triggerPhrase` → `triggerPhrases`?

    `triggerPhrases` was REMOVED. An author who complied landed on the tombstone
    and got a second rejection telling them to delete what they had just been
    told to write.

    **Third occurrence of finding 7's shape** — this campaign's fix pointing the
    way into the failure it exists to kill — and the first one the campaign put
    in its own *shared* helper, where it would have reached every conversion
    after it. Both helpers were correct alone; only the combination was wrong,
    which is the kind of defect no per-schema test looks for.

    Fixed structurally rather than by special-casing tombstones: **never suggest
    a key the schema cannot accept.** `strictObject` drops candidates that
    accept `never` (however wrapped), so the rule holds without knowing why a
    key is unwritable. Note the two helpers stay complementary — `retiredKey` is
    *stronger* than a `guidance` entry, not redundant with it, because it types
    the key as `never` and so fails `tsc` even when the config arrives through a
    variable, where excess-property checking would not fire.

13. **`route` on a page — a fiction the platform's own test suite carried.**
    `stack.test.ts` authored `route: '/landing'` on a page for years.
    `PageSchema` has never declared `route`; a page is routed by its `name`,
    which in the map format under test IS the map key. The test asserted exactly
    that, six lines below the key contradicting it.

    Fifth instance of a test codifying a strip-era fiction as intent
    (`position.parent`, `object.namespace`, `compactLayout`,
    `skill.permissions`, now `page.route`) — and the most likely of them to be
    reinvented, because `route` is the first key anyone reaches for on a page.
    Now tombstoned along with `path` and `url`.

    Two more from the same file's own comments, and they are the
    `skill.permissions` class again: `agent.visibility` and `agent.tenantId`
    were **removed as unenforced security properties** and left without a
    tombstone, because at the time the shape was `.strip` and there was no
    rejection to attach a prescription to. An author who wrote
    `visibility: 'private'` believed the agent was hidden; it was listed to
    everyone, and always had been. Closing the shape created the channel, so
    both got their sentence.

14. **Closing `field` put `strictObject` inside an import cycle, and the whole
    test suite passed through it.** `shared/suggestions.zod` imports `FieldType`
    from `data/field.zod`, so the moment `field.zod` adopted the helper the graph
    closed a loop: field → strict-object → suggestions → field. Under
    `OS_EAGER_SCHEMAS=1` — how `build-schemas.ts` runs — every `lazySchema` body
    executes at module init, so whichever module the loader entered first saw a
    half-initialized partner and threw `Cannot read properties of undefined
    (reading 'strictUnknownKeyError')` before a single schema was built.

    **284 test files and 7,239 cases went green over it.** Tests import lazily,
    so the cycle never resolved in the order that breaks; only the eager build
    hit it. This is finding 9's rule from the other side — there the instrument
    reported coverage it did not have, here the instrument was simply the wrong
    one, and a green suite meant nothing about the failure mode in question.

    Fixed by deferring the error map to first use, which costs nothing (it is
    needed only when a key is rejected) and makes the helper cycle-proof for
    every schema after this one, instead of making each new conversion prove it
    is not in a loop. The property is now pinned in
    `shared/strict-object.test.ts` via an observable — an alias-table getter that
    fires exactly when the map is built — and verified to go red when the map is
    hoisted back to construction time.

15. **`field` carried the campaign's richest curated table, in the wrong layer.**
    `FIELD_KEY_GUIDANCE` (in `data/authoring-key-lint.ts`) holds twenty-odd
    entries for this one surface — every one found in the wild, held honest by a
    test that every `to` names a key `FieldSchema` really declares and that no
    entry exists for a key still live.

    The first pass at closing `field` hand-wrote a guidance table beside it. That
    is a second copy of the truth, and it immediately proved the point: the
    lint's table suppresses a suggestion for `pii` **because `pii` is three edits
    from `min`**, so a bare edit-distance suggester answers a
    personally-identifiable-information key with "did you mean `min`?" —
    confident, wrong, about an unrelated concept. The hand-written table did not
    know that, and the rejection said exactly that. `FieldSchema` now derives its
    aliases and guidance from the table (`to` → alias, `why` → guidance), so the
    curation has one home and keeps its existing test.

    Worth noting what moved: the table did not change and is not deprecated — its
    *consumer* changed. The lint no longer reaches `field` now that the parse
    rejects first, so the same curation that used to power a warning now powers a
    rejection. That is the intended end state for every entry in it.

16. **The `.extend()` trap this file warned about, arriving on schedule.**
    `view` (the final batch). `ViewMetadataSchema`'s third and fourth union
    members are `ListViewSchema.extend(...)` / `FormViewSchema.extend(...)` — the
    flattened Studio overlay that carries auxiliary round-trip keys (`isPinned`,
    `sortOrder`, …) which `saveMetaItem` persists verbatim. `.extend()` INHERITS
    strictness, so closing the two authoring schemas silently closed the overlay
    too, turning **a shape the platform itself writes** into a 422.

    Worth noting how it was caught: not by reading, but by a test whose name is
    the whole contract — *"preserves auxiliary Studio round-trip keys without a
    strict-mode 422"*. Someone wrote that test before this campaign existed,
    naming the exact failure a future ratchet would cause. Both members now
    `.strip()` back, with a comment saying the `.strip()` is load-bearing.

17. **Five bespoke guards, all built around silent stripping, all covering one
    door.** With `defineView`'s the campaign has now found the whole family:
    #1535's `create()`-only object guard (found by #4522), #3778's ten-key
    translation preprocess (batch 5), `retiredKey` (kept — it is *stronger* than
    guidance, not a workaround), the `defineView` empty-container check, and the
    `metadata-create-seeds` gate that could only fail in one direction.

    The pattern is stable enough to state as a rule: **when a schema strips, the
    fix someone reaches for is a guard at the door they happen to be standing
    at.** It works, it is tested, and it leaves every other door open — because
    the author of the guard was solving their bug, not auditing the surface.
    Closing the shape is the only fix that covers doors nobody has thought of
    yet. And what was worth keeping from each guard was never the detection —
    that generalizes for free once the default flips — but the prose.

18. **A `guidance` entry is a claim about the schema, and this campaign shipped
    four false ones — all in its last two batches.** `action.permissions` said
    an action has no permission key when `requiredPermissions` is declared and
    enforced with a 403 (following it invited deleting a working gate);
    `action.location` aliased the CORRECT key to a nonexistent one;
    `view.name` / `view.label` / `view.object` tombstoned the container's own
    identity and object binding, rejecting shapes the platform itself writes.

    None was caught by writing the schema. One came from checking the docs-drift
    report — the advisory "107 files, FYI" list — against the schema. The rest
    came from CI running packages `packages/spec` alone does not:
    `metadata-protocol`, `objectql`, `cli`.

    **What finally worked was not more care, it was a different method.** Scan
    every real payload of that shape in the repo, and keep only the guidance
    entries no real payload contradicts. On `view` that was one command, it took
    six of nine entries through and killed three, and it would have caught all
    of them before the first CI failure. The generalisation:

    > A tombstone asserts *"nothing legitimately writes this key."* That is an
    > empirical claim about the codebase, and the codebase can be asked.

    Two rules fall out. **Prose in a rejection is behaviour, not documentation**
    — it tells an author what to do next, and a confidently wrong one is worse
    than none because there is no reason to doubt it. And **the blast radius of
    closing a registered type is every package that parses that type**, not the
    package that declares it.

19. **The site counter itself was wrong in both directions, and the two errors
    cancelled.** Found by the 2026-08-03 re-measurement, by building a second,
    independent counter and making the two disagree — seven files, in the gate
    this campaign wrote specifically so its map could not go stale.

    It **counted prose**: a `z.object({ … })` inside a JSDoc example is not a
    site, and `ui/action.zod.ts` declared 9 where 8 exist
    (`kernel/metadata-protection.zod.ts` and `shared/suggestions.zod.ts` were
    entirely comment). It **missed the wrapped call**: prettier writes a long
    chain as `z\n  .object({`, which `z\.object\(` cannot match — one site in
    `ui/chart.zod.ts`, two in `kernel/manifest.zod.ts`. And it **did not know
    `z.looseObject(`**, so `data/field-value.zod.ts` declared 1 of its 2.

    On `ui/` the miscounts were −1 and +1, so the section total balanced
    perfectly over two wrong rows — the gate's arithmetic check passing *because
    of* a second error.

    The consequential one was `automation/time-relative-trigger.zod.ts`. Its only
    site is written wrapped, so it counted **zero**, and a zero-site file is
    deliberately SKIPPED by the coverage walk ("nothing to classify"). An
    authorable schema — a declarative trigger authors write by hand into a flow
    start node — sat outside the map while the gate printed *"no undeclared
    schema files"*. Note this is not the `data/driver/` failure repeated: that
    walk was blind, whereas this walk was fine and the **counter feeding it**
    returned a zero the walk then correctly honoured. A blind spot one layer
    further in, reached through a correct code path.

    Fifth instance of the pattern, and the reason the fix is structural rather
    than another spelling bolted onto a regex: the counter now reads the AST, so
    it cannot be fooled by formatting or by comments, and it stops needing to
    learn each new idiom separately — the same move the envelope probe made in
    finding 9 when it stopped needing a valid instance and started walking the
    schema.

    The same walk yields **posture** per site, which closes the gap that made
    this re-measurement necessary at all: the ledger could say a file contained
    `.strict()` *somewhere*, never how many of its sites were still open. The
    2026-08-03 ruling was consequently scheduled against counts of `strictObject(`
    occurrences — an idiom that misses every schema closed with the older
    `z.object(…).strict()` spelling, reading `automation/` as **0 strict** when it
    has 8, and `ui/` as 49 when it has 72. Both the map and the gate now carry the
    open-site count directly (see the remaining-strip map below).

20. **The DOOR measurement was wrong in the one direction that costs a breaking
    change** (批 16; filed as #5056). The counter in finding 19 answers "how many
    sites"; this is its opposite number — the instrument that answers "is there
    anybody on the other side of them", which is the question the whole
    authorable / `no door` split turns on.

    批 13 built the BFS and 批 15 added a **derived-clone bridge** to it, for a
    real reason: `.extend()` / `.strip()` produce a clone that shares no identity
    with its base but DOES share the base's per-property schema instances, and
    `ChartConfigSchema` is reached exactly that way through `ReportChartSchema`.
    The bridge fired when **any one** property matched under the same name.

    Two facts turn that into a false door. Zod's `.describe()` returns a clone
    that shares the original `_zod.def` **object** — so every described
    `SnakeCaseIdentifierSchema` and `I18nLabelSchema` is def-identical across the
    entire spec. And `name` / `label` are two keys almost every authorable shape
    here declares. So `WidgetManifestSchema` — in a file **nothing imports** —
    measured as REACHABLE on 2 shared keys out of 20, and 批 16 came within one
    control of closing nine sites in a dead file: a breaking change spent to
    produce *"a precisely validated dead slot — the more convincing lie"*
    (#4583), which is the exact artifact the `no door` class was invented to stop
    the campaign from manufacturing.

    **The error is one-directional.** A too-eager bridge can only invent a door,
    never hide one — so its entire failure budget is spent on making batches
    tighten things nothing parses. That is what makes it worth a numbered finding
    rather than a fix in passing.

    Two method notes, both of which the campaign has now paid for twice:

    - **The control that catches it is the one nobody writes.** 批 15's near-miss
      (`typeof v !== 'object'` skipping every lazy Proxy, which halved the graph)
      was caught by a POSITIVE control. This one is invisible to positive
      controls — every root still resolved — and needed a NEGATIVE one plus the
      synthetic-carrier flip. A door measurement owes all three, in the same run:
      a known-live schema, a known-dead one, and an injected carrier that must
      flip the verdict.
    - **The fix is to ask how much of the shape is shared, not whether anything
      is.** A real derived clone carries nearly all of its base's properties; a
      coincidence carries one or two of twenty. `ui/door-reachability.testkit.ts`
      is now the one implementation, with the threshold justified against both
      ends of the measured range (批 15's real derivation far above it, 批 16's
      false positive far below). The duplicate copy still living in
      `chart.test.ts` is part of #5056 — the campaign's own recurring lesson
      about a second copy of the truth, arriving this time in its instruments.

## Where this ended up

**24 of 25 registered types closed** (from 9 when the line started), and the
25th — `view` — is a **documented permanent exception**, not the last item of
debt. Its registered schema is a union of three runtime shapes and a union is
only as closed as its most open member; that member is the Studio overlay above,
a wire shape wearing the same type name. Everything an author writes is closed.
The distinction is exactly the one the classification rule at the top of this
file exists to draw, arriving at the end as the answer rather than as an
exception to it.

**The ADR-0010 undeclared-envelope debt list is empty**, from the eight the
structural walk opened it with — after replacing a probe that had been hiding
seven. The empty set is kept rather than deleted, so the declaration check now
runs over every type with no exemptions.

**The warning layer has one covered root left.** A layer built to warn about
strip-mode metadata, with almost nothing left to warn about, is the ratchet
finishing. Its tests say so in place: change the floor to 0 and assert the empty
set *deliberately* — never delete the test, because an empty result nobody chose
is indistinguishable from a derivation that broke.

This is the empirical argument for the ratchet: the inference "no metadata in
the repo carries unknown keys" was **false three times over**, and only the
strict gate could prove it. Note the asymmetry in the two schema gaps — both
were *inverse* drift (runtime writes a key the spec cannot express), which the
liveness ledger's per-property direction cannot see.

**Known sibling gap — CLOSED in step 2:** `identity/position.zod.ts` — the
other registered security type — also omitted `MetadataProtectionFields` while
`applyProtection` stamps it. Declared (with the author-facing `protection`
block) when `position` joined the ratchet.

4. **`position.test.ts` asserted a fictional hierarchy** (found in step 2 when
   `PositionSchema` went strict): the pre-ADR-0090 test "should accept position
   with parent" — plus four "real-world hierarchy" examples — authored a
   `parent` key on positions. It only ever "passed" because `.strip` ate the
   key; no position tree exists (ADR-0090 D3 finalized flatness; hierarchy is
   the business-unit tree). The tests were codifying the strip-era fiction as
   expected behavior. Rewritten: `parent` is now asserted to be *rejected* with
   the flatness guidance.

## File-level triage — the five authorable directories

**The per-file site counts live in
[the counts file](./2026-07-unknown-key-strictness-ledger.counts.md#file-level-triage--site-counts),
not here** (#5107). A site is every `z.object(` / `strictObject(` /
`z.strictObject(` / `z.looseObject(` CALL, read from the AST rather than matched
textually (see `scripts/lib/strictness-ledger.ts` for why the textual method was
wrong in both directions at once). What this table carries is the part no AST can
produce: the verdict and the evidence for it. Classification is per the rule
above; **(p)** marks a provisional call made from the file's exports/JSDoc rather
than a full read — verify before tightening (the #4001 "sharing-rule lesson":
candidates, not verdicts).

Every file below still has to *be* here: `check:strictness-ledger` fails on a
sited file with no row, and — since the counts left — on a row whose file has no
sites left to be a verdict about.

### `ui/` — file-level triage

| File | Class | Note / next action |
|---|---|---|
| `action.zod.ts` | authorable | **strict as of #4001 批 14 — 0 strip sites remain.** `ActionParamSchema` was strict from #3746, but strictness does not recurse and its `options[]` entry was still strip: an option carrying `color` / `visibleWhen` / `icon` / `disabled` parsed clean through `getMetadataTypeSchema('action')` and came back `{ label, value }`. Closed with `strictObject`, NOT `.passthrough()` — the opposite call from `bulk-action.zod.ts`'s option entry two rows up, and made on measurement rather than symmetry: that def reaches the grid verbatim with no spec door in between and objectui's `BulkActionParam` declares an explicit `[key: string]: unknown`, whereas this path has a door that ALREADY strips and lands in the CLOSED `SelectOptionMetadata`. Whether this surface should carry the field-level per-option vocabulary at all is #5016. Earlier note: **9 → 8 at the #4001 re-measurement** — no schema changed; the ninth "site" was a `z.object(…)` inside a JSDoc paragraph, which the old textual counter could not tell from code **9 → 8 at the #4001 re-measurement** — no schema changed: the ninth "site" was a `z.object(…)` inside a JSDoc paragraph, which the old textual counter could not tell from code |
| `action-params.zod.ts` | wire | **never strict, deliberately** — one site: `ActionSessionSchema`, the action-body `ctx.session` declared at **#5697** (phase 1 of #5613's contract-first ruling). It is the RUNTIME shape `packages/runtime`'s `buildActionSession()` hands a body, not an authoring surface — nobody writes it — so closing it would turn a future engine-side enrichment into a parse failure for whoever parses a context they were GIVEN: the same call, and the same reason, as `data/hook.zod.ts`'s `HookContextSchema` row. The file had no row until now because everything else it exports is a function or an interface (`validateActionParams`, `ActionHandlerContext`), i.e. zero sites to classify. ⚠️ **Read the arrival direction, because it is the opposite of every other row in this table**: this site did not survive a strictness sweep, it is NEW surface — a shape that was being produced with no declaration anywhere (`actionContext` is a bare `any` at both dispatch sites), which is why neither this ledger nor any gate could see that its `roles` key carries `ExecutionContext.positions` under the spelling ADR-0090 D3 forbids. The key is declared as-built and marked deprecated in its `.describe()`; the rename is #5613 phase 2. A declaration is not an endorsement — do not read this row as "the shape is settled" |
| `view.zod.ts` | authorable | partially strict (ADR-0089); long tail of sub-blocks. `bulkActionDefs` left this file in #4457 — see the row below |
| `bulk-action.zod.ts` | authorable | **strict as of #4457** — `BulkActionDefSchema` (the def itself). It was `z.array(z.record(z.string(), z.any()))` inline in `view.zod.ts`: a selection-bar button with **no shape at all**, so `opeartion` / `excution: 'aggregate'` parsed and shipped as a button that ran the default behaviour. Its two other sites are `BulkActionParamSchema` and that param's `options` entry, both deliberately **open** and both now `.passthrough()` — the param because objectui's `BulkActionParam` declares a `[key: string]: unknown` catch-all for widget config (min/max/step/format), so passthrough is the honest mirror and strictness would reject valid config (same call as `dashboard.zod.ts`'s widget `config`); the OPTION ENTRY on separate measured evidence, since its objectui type is closed and only the runtime path is open — `bulkParamToField` spreads each entry (`plugin-grid/src/components/bulkParamToField.ts:131`) into `SelectOptionMetadata` (`types/src/field-types.ts:288`), which declares and reads `color` / `icon` / `disabled` / `visibleWhen`. **This row said "both deliberately open" while only the parent was `passthrough`** — one intent, two postures, caught by the 2026-08-03 re-measure and closed by the ruling's verdict A (make the code match the prose). The lesson is the campaign's own: prose in this ledger is not a posture reading, which is why the remaining-strip map is gated and this column is not. The def also refuses the combinations the executor never reads (`patch` outside an update, `execution` outside a custom, `batchSize` on an aggregate) and a hand-written `actionDef`, which is renderer-attached |
| `component.zod.ts` | ~~authorable (p)~~ ~~no gate~~ **authorable (gate wired at #5068)** | **strict as of #4001 batch A — 0 strip sites remain (all 31).** The `(gate wired at #5068)` qualifier is spent in its turn: the parse it wired is now a parse of CLOSED shapes, so an undeclared prop is reported by `safeParse` as `unrecognized_keys` rather than reconstructed by the walker — same rule id, same warning tier, one fewer moving part. What batch A did NOT do is the half this row keeps insisting on: the carrier is still `z.record(z.string(), z.unknown())` (direction B stays declined), and the storage path still parses no props at all (#4463), so this closes the AUTHORING door and nothing else. Three renderer-honoured keys were DECLARED in the same pass rather than rejected — `page:header` `maxVisible`/`mobileMaxVisible`, `page:tabs.alwaysShowStrip`, `record:details` `inlineEdit`/`showHeader` — each read by objectui through `schema?.X ?? schema?.properties?.X` with its own comment inviting authors, which is the #5611/#5775/#6276 rule applied a fourth time (enumerate by the RENDERER'S read pattern, not by the key list a previous ruling quoted). The evidence below is unchanged and still the reason the file took this long. **no parse anywhere (measured, #4001 批 17; the parse landed at #5068 — see the end of this cell)** — the `(p)` resolved NEGATIVE, and this is the campaign's largest single reclassification. The standing warning said to verify objectui's React-prop open slots first; doing so found the question was moot one level up. **The carrier is live but it is an open bag**: `PageComponentSchema.properties` is `z.record(z.string(), z.unknown())`, and although `PageComponentSchema` has been `.strict()` since ADR-0089 D3a, **strictness does not recurse** — it closes the component node's own keys and leaves everything under `properties` unchecked. Nothing dispatches `ComponentPropsMap` by `type`. Three measurements on 2026-08-04, controls green in the same run: (1) a BFS from all 24 metadata-type roots plus `ObjectStackSchema`, over a 6899-node closure built with `build-schemas.ts`'s own `zodChildSchemas`/`zodShapeOf` (the #4650 walk), returns **UNREACHABLE for all 52 targets** (21 exported schemas + every one of `ComponentPropsMap`'s 31 entries), while `PageSchema`/`PageComponentSchema`/`PageRegionSchema`/`ThemeSchema`/`ChartConfigSchema`/`ResponsiveConfigSchema` all resolve `root-graph` and 批 13's no-door shapes stay unreachable — the walk stops dead at `properties`. ⚠️ The #5056 bridge defect does not touch this row: it makes the derived-clone bridge report dead shapes as REACHABLE, the opposite direction, and nothing here rests on that bridge — all six positive controls resolve `root-graph` and all 52 targets miss BOTH `root-graph` and `derived-clone`; (2) across `objectstack`, `objectui` and `cloud`, every `.parse()`/`.safeParse()` on anything in this file is inside the file's own unit tests — objectui mirrors the props as hand-written React interfaces and imports only the inferred TYPES, `cloud` references none, and `react-blocks.ts` uses `Object.keys(ComponentPropsMap)` for type NAMES only (its `REACT_BLOCKS[].schema` entries all point at view/chart schemas); (3) empirically through the live door — `definePage()` IS `PageSchema.parse()` — an undeclared key written inside `components[].properties` parses clean and is RETAINED on 10/10 example-corpus pages, while the same key one level out is rejected on 10/10 (the negative control that makes the first number mean anything). ⚠️ **`no gate`, not `no door`** — the vocabulary is ALIVE and must not be retired: objectui's `SchemaRenderer` hoists `properties` onto the node and spreads every key not on its fixed deny-list straight into the React component, so a misspelled key is neither rejected nor dropped — it reaches the renderer and is ignored there, the ADR-0078 failure mode one layer below where this ratchet reaches. That IS the #4909 open-slot shape, but `.passthrough()` would be exactly as vacuous as `.strict()` on a schema nothing parses, so no posture change was made. The fix is to wire the parse at the carrier's own gate — a `packages/lint`/carrier change, filed as **#5068**, which also records the two constraints that stop it being a drive-by: `type` is an open union (`z.union([PageComponentType, z.string()])`, so `record:line_items`-style unregistered types are authored in the wild) and real pages already author shapes these schemas do not declare (`record:details` `sections[].fields[]`/`hideFields[]`, the record picker's `labelField` — `packages/lint/src/validate-page-field-bindings.ts` has documented the untyped bag all along). **Do not reschedule this as strictness work** — that is what the `(p)` was for, and it has been answered. ✅ **#5068 answered it in turn: the parse is wired (lint side, warning level) and the class is `authorable` again** — the strip-table row below carries the full flip, including the three things it did not do. One correction belongs here rather than there, because this row is where the wrong expectation was written down: the pin in `component.test.ts` said its carrier assertion *"goes red the day `properties` gets a typed dispatch"*, which assumed direction B. The dispatch that landed is direction A — on `packages/lint`'s authoring gate — so the assertion is GREEN after the fix, and it was measured that way rather than predicted. The pin now says which dispatch landed and what a future red there would mean (the carrier reshaped: a protocol change, not a lint one). Recorded in three places (file header, `component.test.ts` pin, this row) |
| `theme.zod.ts` | authorable | **strict as of #4001 批 15** — all 14 sites. The `(p)` resolved to authorable on two doors, both measured: `stack.zod.ts` declares `themes: z.array(ThemeSchema)` (so `defineStack()` parses every theme on boot and on `objectstack build`), and `defineTheme()` parses one directly. A BFS from all 24 metadata-type roots plus `ObjectStackSchema` reaches every schema in the file, with `PageSchema`/`DashboardSchema`/`ReportSchema`/`WebhookSchema`/`StateMachineSchema` passing as positive controls and 批 13's no-door shapes failing as negative controls **in the same run**. Note what is NOT claimed: `theme` is deliberately absent from `BUILTIN_METADATA_TYPE_SCHEMAS`, so a stored theme row is not validated by the metadata REST door — the gate is the authoring one, and the file says so rather than implying reach it lacks. **The `passthrough` question was asked per BLOCK, not per file**, and the answer split: objectui's `ThemeEngine` reads `colors`/`borderRadius`/`shadows`/`typography.fontFamily` through FIXED maps (an extra key is read by nothing, ever), but spreads `fontSize`/`fontWeight`/`lineHeight`/`letterSpacing`/`duration`/`timing`/`zIndex` with `Object.entries` into `--font-size-<key>` … — the #4909 open shape at the runtime. Closed anyway, on two measurements: `.strip` already discarded those extras before the engine saw them (so no author depends on the openness and nothing the renderer receives changes), and `customVars` is a DECLARED escape hatch that emits an arbitrary CSS custom property by name, so closing the token scales removes no capability and only removes a second, undocumented way to spell one — the way whose typos are indistinguishable from intent. Curation is measured throughout: the shadcn vocabulary (`card`→`surface`, `foreground`→`text`, `destructive`→`error`) comes from objectui's own `COLOR_TO_CSS_MAP`, which RENAMES every palette key on the way out; `md`→`base` on `fontSize` and `base`→`normal` on `fontWeight` are a same-file scale disagreement (`borderRadius`/`shadows` declare `md`, `fontSize` does not); `radius`→`base` because `base` is emitted as the bare `--radius`, the one radius variable objectui's CSS actually reads; and `easeIn`→`ease_in` because `animation.timing` is the file's single snake_case vocabulary, so the camelCase spelling is an author obeying AGENTS.md #3 rather than making a typo. The eight #3494 removals get one distinct tombstone each. ⚠️ **Two of those tombstones deliberately prescribe NO replacement slot**: `touchTarget`/`keyboardNavigation` read like they should point at `ui/touch.zod.ts`/`ui/keyboard.zod.ts`, which 批 13 measured as having no carrier at all — prescribing them would walk an author out of a loud rejection into a silent one, the ledger's finding 7. **#4988 then retired both modules outright**, so the two tombstones' refusal to name a replacement is now the only correct wording available: had they pointed at `ui/touch.zod.ts` / `ui/keyboard.zod.ts`, that prescription would today name a deleted file — finding 7 with an extra major on top. ⚠️ **Separately filed — and ANSWERED at #5021, which is why this row's site count fell 14 → 6.** 批 15 recorded that `--font-size-*`, `--font-weight-*`, `--line-height-*`, `--letter-spacing-*`, `--z-*`, `--duration-*`, `--timing-*`, `--font-heading` and `--font-mono` have ZERO first-party consumers (only the colour vars, `--radius*`, `--shadow*` and `--font-sans` are read), and refused to act on it inside a strictness batch: that is ADR-0049 liveness, not unknown keys, and the two must not be run together — strictness makes a dropped key loud, it cannot make a slot live. The refusal was correct and the separation is what made the follow-up answerable. #5021 re-measured against objectui `main` (2026-08-04) with `--font-sans`/`--radius`/`--shadow`/`--primary` as positive controls **in the same run**, the maintainer ruled RETIRE over both alternatives (wire consumers / bless as a public token surface — the latter rejected as a stability promise attached to a slot the platform's own UI ignores, the #4583 shape), and `typography.fontSize`/`.fontWeight`/`.lineHeight`/`.letterSpacing`, `typography.fontFamily.heading`/`.mono`, `animation` and `zIndex` are now `retiredKey()` tombstones prescribing `customVars`. **Note what this row's arithmetic does NOT say**: the eight sites left `ui/` from the `strict` column (120 → 112), and `strip` is unchanged at 75 — a retirement removes closed doors, so it cannot move this ratchet's open-site debt in either direction. The two campaigns stayed disjoint to the end. ⚠️ The prescription is `customVars` **because it was measured live**, not because it is the nearest-looking slot: the engine emits each entry as `--<key>: <value>` verbatim, so every retired variable is reproducible byte for byte and the retirement removes no capability — the distinction from `touchTarget`/`keyboardNavigation` two sentences up, which got NO replacement precisely because theirs would have been a guess. The five aliases pointing at the retired keys (`animations`/`motion`/`transitions` → `animation`, `layers`/`stacking` → `zIndex`) and the seven pointing into the retired typography scales were **deleted with their targets**, not re-pointed — leaving them would answer an author with "did you mean `zIndex`?" and then reject `zIndex`, finding 7's exact shape, and this file has now signposted that failure mode three times |
| `app.zod.ts` | authorable | **strict as of #4001 PR B** — `AppSchema` + branding / area / context-selector / contribution, and the nav-item union converted to `z.discriminatedUnion('type', …)` (the union-error question, settled empirically: matched-branch-only errors, exact recursive paths, `toJSONSchema` clean). Per-target `params` stay open. PR A (#4142) tombstoned the seven audit-dead keys first |
| `dashboard.zod.ts` | authorable | **strict as of #4001 批 14 — 0 strip sites remain.** `DashboardWidgetSchema` has been strict since the ADR-0021 cutover; 批 14 closed the two NESTED holes inside it (`compareTo`'s object arm, `layout`), the same strict-shell-over-strip-children silhouette 批 13 found on `page.components[]`. `DashboardWidgetOptionsSchema` stays `passthrough` **deliberately** (renderer escape hatch) and the `responsive` tombstone (#4876) is untouched. ⚠️ **The `compareTo` union caveat this row carried is RESOLVED, and it is the one entry in this table whose limit was dissolved rather than worked around.** 批 14 recorded that `compareTo` was a UNION, so its curated prescription was produced but never delivered — `zodIssuesToFields` maps only top-level issues and a failed union collapses to a bare `Invalid input` (#5014) — with the rejection itself unaffected. **#5011 removed the union**: the slot converged onto the analytics executor's own contract, `{ kind, dimension? }`, a plain strict object whose message IS top-level. The reason was not the message, it was worse — all three declared arms were broken on the ADR-0021 dataset path (the two strings silently dropped by the renderer, `{ offset }` throwing `compareTo requires a timeDimension "undefined"`), while all three worked on the legacy inline path: same key, two fates, the failing one blessed. The union-free shape is the design benefit, pinned in `dashboard-compareto.test.ts` so it cannot silently return. **#5014 still binds every OTHER curated message this campaign has put inside a union arm** — this row is one slot's correction, not the finding's retraction. ⚠️ **#5010 retired four more widget keys and moved this row's posture by nothing, which is the point.** The `#4956` drill gave `DashboardWidgetSchema`'s 22 widget-level keys their first per-key verdicts and found six dead; `actionUrl`/`actionType`/`actionIcon` (a per-widget action BUTTON no renderer in either repo has ever drawn — all 14 `actionUrl` reads in `DashboardRenderer` are scoped to `header.actions[]`) and `aria` (ARIA attributes that never reached the DOM — the dashboard-level `aria` the #3896 sweep removed, one level down) are now `retiredKey` tombstones beside `responsive`. **Strip sites remain 0 and the strictness verdict is untouched**, because a retirement is ADR-0049 work and this ratchet is not: closing a door makes a *dropped* key loud, it cannot make a *declared* one live — the same boundary `theme.zod.ts` records two rows up, met here from the other side. The removal also settled a second-order cost the strictness campaign could never have reached: `packages/lint`'s dashboard action-ref rule enforced ERROR-severity reference integrity on `widgets[].actionUrl`, its docblock calling the key "the per-widget button" and claiming to mirror a runtime dispatch that does not exist, so an author could FAIL A BUILD because a control that cannot render pointed at an action that also did not — an enforcement gate sustaining the very false affordance ADR-0049 wrote it to delete. That widget branch is gone, pinned. ⚠️ **`colorVariant`, the fifth dead key, is deliberately NOT retired here and this row must not be read as closing it**: the rewrite target the #4956 triage assumed (`options.colorVariant`) measured dead too — `options` only reaches a renderer through `componentSchema` on the INLINE path, and `dataset` is required on this schema, so every spec-authorable widget is dataset-bound and renders through `DatasetWidget`, which has no colour affordance at all. Moving the key there would relocate 16 authored sites from one dead slot to another and mint a second inert key. Returned for adjudication; `chartConfig`'s dashboard-face inertness (11 of 12 keys, #5175) is the same shape on the neighbouring slot |
| `widget.zod.ts` | ~~authorable (p)~~ **no door** | **no authoring door (measured, #4001 批 16)** — the `(p)` resolved NEGATIVE for the whole file, the second such run after 批 13's five. Three independent measurements on 2026-08-04: (1) nothing under `packages/spec/src` imports this module except the `ui/index.ts` barrel, so no schema anywhere declares a carrier key for a widget shape — `field.widget` is a `z.string()` naming a registered *component* and has never referenced `WidgetManifest`; (2) a BFS over the in-memory Zod graph from all 24 metadata-type roots plus `defineStack` (4 766 nodes) reaches none of the six shapes, while `PageSchema` / `ObjectListViewSchema` resolve in the same run, a fresh `z.object` and a deliberate look-alike both resolve unreachable, and a synthetic carrier flips all six to reachable; (3) zero `.parse()` / `.safeParse()` in `objectstack`, `objectui` or `cloud` outside this file's own tests — objectui re-exports the inferred TYPES only and under different names (`RuntimeWidgetManifest` / `FieldWidgetComponentProps`, #4115 / #3161), and a `cloud` code search returns 0 for every symbol against a working index (`"@objectstack/spec"` → 345). ADR-0049 enforce-or-remove is **#5055**. ⚠️ **The campaign's own BFS said REACHABLE on the first run** — a false positive in the derived-clone bridge, filed as **#5056**: zod's `.describe()` returns a clone that SHARES the original `_zod.def`, so `WidgetManifestSchema.name` / `.label` (a described `SnakeCaseIdentifierSchema` / `I18nLabelSchema`) are def-identical to the same leaves on live schemas, and a bridge firing on ANY one shared property links two unrelated shapes. 2 shared keys of 20. The error is one-directional — it can only manufacture a door, i.e. it can only make a batch tighten something dead. Corrected to whole-shape overlap in `ui/door-reachability.testkit.ts` and pinned in `widget.test.ts` ✅ **#5055 ANSWERED the ADR-0049 call, and the answer SPLIT 8/1** (maintainer ruling 2026-08-06; window moved v18 → v17 on 2026-08-07). Eight of the nine sites were REMOVED — `WidgetManifestSchema`, `WidgetLifecycleSchema`, `WidgetEventSchema`, `WidgetPropertySchema` and `WidgetSourceSchema` (3 union branches) — after all three measurements above were re-run on `origin/main` with their controls passing in the same run. Route 3 ("nothing parses it → neither"): no carrier key means no shape for a `retiredKey()` tombstone and no source for a D2 conversion, so the declared record is the D3 `SemanticMigration` `ui-widget-i18n-family-retired` plus `RETIRED_DEFS_BY_MAJOR`. `WidgetManifest.performance`'s own tombstone (#3896) was subsumed by the removal of the shape that carried it. ⚠️ **The NINTH site, `FieldWidgetPropsSchema`, was KEPT — do not finish this file.** Its evidence shape differs and the difference arrived one day before 批 16 measured: it is a REACT PROPS CONTRACT, never authorable (absent from `authorable-surface/` and `json-schema.manifest/` — `onChange` is a `z.function()`), so "zero parse" is its design rather than its defect; and objectui PR #3289 (merged 2026-08-03) renamed `@object-ui/fields`' validation slot onto this contract's `error` with no alias, made the form renderer produce it, and pinned it in `packages/fields/src/__tests__/spec-symbol-batch7.test.ts` as a deliberate tripwire — "the day the spec stops exporting `FieldWidgetProps`, this file stops compiling". Re-verified on objectui `origin/main` 2026-08-07. That is a live cross-repo compile-time consumer, and `tsc` is where a props contract is enforced. So this row's remaining site stays `no door` **and stays**: unreachability is not the retirement trigger for a shape that was never authorable. Pinned bidirectionally in `ui/widget-i18n-retirement.test.ts`. ⚠️ The #5056 fixture moved with the schema: `door-reachability.testkit.test.ts` rebuilds the same 2-of-19 shared-leaf shape locally, so the instrument's regression bound is still measured rather than remembered |
| `page.zod.ts` | authorable | partially strict (ADR-0089) |
| `chart.zod.ts` | **authorable — all 8** (~~2 no gate~~ ~~gate wired at #5020~~ **closed at #5583**) | **5 strict as of #4001 批 15**, a sixth added at **#5022**, and the last two at **#5583** — the file is now 0 strip and its row left the remaining-strip map. The cell below is kept as WRITTEN AT THE TIME, in present tense, because the two-step order it argues for is the reusable part; the two ✅ notes at the end record what each step actually moved. `ChartConfigSchema` / `ChartAxis` / `ChartSeries` / `ChartAnnotation` / `ChartInteraction` are `root-graph`-reachable from the `dashboard` and `report` metadata roots (`DashboardWidget.chartConfig`, `ReportChartSchema`), so they are judged on the stored-metadata path and are now closed. **`ChartAggregateSchema` and `ChartGroupBySchema`'s object arm are NOT**, and this is the batch's real finding. They are not 批 13's no-door case — their carrier is LIVE: `aggregate` is a real authorable prop on the react tier's `<ObjectChart objectName aggregate={…}>` (ADR-0081), published in the generated react-blocks contract, and objectui's `ObjectChart` reads `schema.aggregate` to run the query. What is missing is the PARSE: neither schema is reachable from any metadata-type root or from `ObjectStackSchema` (both `UNREACHABLE` in the run where the five above come back `root-graph`), nothing in the three repos calls `.parse()` on them outside this file's unit tests, and the gate that DOES judge an authored `aggregate` — the react-page publish lint — re-derives the rules by hand (`CHART_FUNCTIONS`, the count/field requirement, the result-column naming) and never checks unknown keys. `react-blocks.ts` publishes the prop as a hand-written TYPE STRING; the Zod schema beside it is not what the contract is generated from. So `groupby` / `dateGranularty` are silently dropped today and would go on being silently dropped after a `strictObject` here — `.strict()` is a property of a parse. A fourth class, **`no gate`**: carrier live, parse absent. Distinct from `no door` (批 13), where the carrier itself does not exist. The contract-first fix is to make the publish gate PARSE the schema instead of re-deriving it — a `packages/lint` change, filed rather than smuggled into a spec strictness batch. Recorded in three places (schema-adjacent comment, test pin incl. a standing BFS assertion that goes red the day a carrier key appears, this row). ✅ **That fix landed at #5020, and this row's `no gate` verdict is spent — the two sites are now `authorable`** (the second half of the `Class` cell above; the strip row further down carries the same flip). The publish gate calls `ChartAggregateSchema.safeParse()` on a static `aggregate={{…}}` literal, and `CHART_FUNCTIONS` plus the hand-written count/field twin are DELETED, so the vocabulary and the refinement are single-source again. Read the flip precisely, because it is the class's first worked example and the distinction is the whole value of having added `no gate`: what changed is the PARSE, not the posture. Both schemas are still STRIP, so `groupby` / `dateGranularty` are still dropped silently — wiring the parse is the *precondition* for closing them, not the closing, and the closing is **#5583** (a sub-issue of the campaign, where the two `chart.test.ts` STRIP pins invert). #5020 also pinned today's tolerance out loud in `validate-react-page-props.test.ts` so a wired gate cannot be mistaken for a closed door — the #4583 shape, guarded from the other side. One severity note that belongs in this ledger because it is a *declared ≠ enforced* judgement, not a lint detail: an absent `groupBy` reports at **`warning`**, alone among the graded violations, because the schema and the published react-blocks type declare it required while objectui's renderer honours its absence (`schema.aggregate?.groupBy || schema.xAxisKey`) and this protocol's own `chartAggregateCategoryKey` documents the ungrouped single-row result. Gating it would enforce a declaration the platform does not itself keep; which of the two moves is #5583's product question. ⚠️ One correction shipped with the tightening: the `clickAction` migration text #3752 wrote into this file prescribed **`drillDown`, which at the time was not a key this protocol declared anywhere** — it was an untyped `(schema as any).drillDown` read inside objectui's `ObjectChart`. Promoting that sentence into a strict rejection would have handed an author the platform's authority for a key the same gate then rejects: finding 7, third occurrence, this time caught before shipping. The prose and the tombstone now name `onSegmentClick` / `ReportSchema.drilldown` / the widget's `options` bag, all of which exist. Filed separately — and **closed at #5022**, which is the entry worth reading twice, because the fix is not the one the file's own prose implied. The gap was real (a live renderer capability with no declaration), but the two carriers that prose pointed at both measured DEAD on the dashboard metadata path: `widget.chartConfig.drillDown` is read by nothing (`DashboardRenderer` never looks at `chartConfig`; `DatasetWidget` forwards exactly one key out of it, `showLegend`), and `widget.options.drillDown` is read only inside `DashboardRenderer`'s legacy `isObjectProvider` branch, which a spec-legal v17 widget cannot reach — `dataset` is required, so `datasetBound` is always true and that component schema is discarded unrendered. An ADR-0021 dataset-bound widget drills through the semantic layer and reads no drill config at all, which the platform's own docs had already said (`content/docs/ui/dashboards.mdx`: *there is no per-widget drill configuration in the dataset form*) while this ledger row pointed authors at the `options` bag. So `drillDown` was declared as `ChartDrillDownSchema` at the ONE surface measured to read it — the react tier's `<ObjectChart drillDown={…}>` prop, published through `react-blocks.ts`'s interaction overlay rather than through `ChartConfigSchema`, precisely so the dashboard surface does not inherit an inert key. The shape is the honest six (`enabled`/`filter`/`title`/`target`/`columns`/`maxRows`); objectui's wider renderer-side `DrillDownConfig` (`mode`/`report`/`view`/`sort`, and a `navigate` target) was NOT copied — a chart reads none of them and two are read by no widget at all (objectui#3354) — and each absent key is a `guidance` entry saying so rather than a rename. Two second-order findings came out of the same measurement and are filed, not fixed here: **#5175** (`chartConfig` delivers 1 of its 12 keys on the dashboard path, and `liveness/dashboard.json` records evidence that overstates it) and **objectui#3354**. **`chart` 6 → 7 at the re-measurement** — no schema changed: `ChartAggregateSchema` is written `z\n  .object({`, and the old counter's `z\.object\(` could not match across the line break ✅ **#5583 moved the POSTURE, which is the second and last step — the file is closed.** Both object arms are `strictObject` now: `groupby` → `groupBy`, `fn` → `function` and `dateGranularty` → `dateGranularity` are named rejections carrying the surface, the offending key and a rename, and `dateGranularity` written BESIDE `groupBy` gets a curated wrong-layer prescription instead of a rename it cannot use. The two `chart.test.ts` STRIP pins and the two companion tolerance pins in `packages/lint`'s `validate-react-page-props.test.ts` INVERTED in the same change rather than being deleted. ⚠️ **The union collapse is now load-bearing and belongs in this ledger, not only in the lint package:** `groupBy` is a union, so the `unrecognized_keys` its strict arm raises never reaches `error.issues` — zod 4 reports one `invalid_union` whose own message is the bare string *"Invalid input"* (#5014's flattening, met from the strictness side). The named rejection reaches an author only through `packages/lint/src/zod-issue-format.ts`'s arm unpacking, so **a strict object arm inside a union is exactly as loud as its consumer's unpacking** — a general constraint on every remaining union site in this campaign, pinned end-to-end on both sides. ✅ **The product question is ANSWERED and it did not move the schema: `groupBy` stays REQUIRED.** Measured 2026-08-08 rather than argued — the example corpus authors exactly one `<ObjectChart aggregate={…}>` (`renewals-pipeline.page.ts`) and it carries `groupBy`, while the ungrouped single-value need is served by a DIFFERENT registered block, objectui's `object-metric` (`ObjectMetricWidget`), which the showcase authors seven times with `aggregate: { field, function }` and no `groupBy`. The `schema.aggregate?.groupBy || schema.xAxisKey` reads this row cited as evidence that the renderer honours the absence are optional-chained **on `aggregate` itself**, so what they actually serve is a chart with no aggregate at all (a `data=` / `dataset=` binding) — they keep option-colour resolution, the comparison merge and the drill-down filter working there, and none of them makes an ungrouped aggregate draw; the one client-side aggregation path declares `groupBy` required and buckets every record under `String(undefined)` when it is missing. So the evidence was mis-attributed, and declaring the key optional would have advertised a shape the renderer does not deliver (PD#10). #5020's `warning` therefore stays a TOLERANCE rather than becoming a blessing; promoting it to `error` is a separate acceptance surface (every consumer's pages, not just the corpus, which carries zero instances) and is filed, not smuggled in. |
| `i18n.zod.ts` | **split** | **`i18n` SPLITS across two classes (measured, #4001 批 16)** and is the file this table's standing warning was about. The warning said "label shapes are wide-open records by design"; measurement says something more useful. `AriaPropsSchema` is a **real door and is closed** — carried as `aria:` on ~30 live shapes under six metadata-type roots (`ListViewSchema`, `PageSchema`, `PageComponentSchema`, `DashboardWidgetSchema`, `ChartConfigSchema`, `ActionSchema`, 20 SDUI component defs) and directly BFS-reachable. It was stripping in the wild: through the `view` root, `aria: { label: 'Accounts', describedBy: 'x' }` parsed CLEAN and returned `aria: {}`, so the accessible name existed in the source file and nowhere else. The other five (`I18nObject`, `PluralRule`, `NumberFormat`, `DateFormat`, `LocaleConfig`) are **no door** — no carrier, unreachable, zero parse in all three repos; ADR-0049 is #5055. Note `NumberFormat` / `DateFormat` DO have a carrier (`LocaleConfig.numberFormat` / `.dateFormat`) but the carrier is itself doorless, so the subtree is `no door`, not `no gate`. And the warning's own subject — the wide-open **record** level — was never one of the six sites: `I18nObject.params` is a `z.record` interpolation bag whose key space is whatever the message template names, so openness there is the contract and there was nothing to close. Pinned in `i18n.zod.ts`'s header, in `i18n.test.ts`, and here ✅ **#5055 ANSWERED the ADR-0049 call: all five are REMOVED** (maintainer ruling 2026-08-06; window moved v18 → v17 on 2026-08-07), after the three measurements were re-run on `origin/main` with controls passing in the same run. `NumberFormat` / `DateFormat` went with their doorless carrier as one subtree rather than surviving as exported schemas nothing references (#3950), and `I18nObject` turned out to be superseded by its own file-neighbour: `I18nLabelSchema`'s documentation already says translation keys are generated at registration time and translations live in translation files, and the live surface is `system/translation.zod.ts`, which uses none of these shapes. Route 3 — no tombstone, no D2 conversion; the declared record is the D3 `SemanticMigration` `ui-widget-i18n-family-retired` plus `RETIRED_DEFS_BY_MAJOR`. **`AriaPropsSchema` and `I18nLabelSchema` are untouched**, and their survival is pinned as the other half of `ui/widget-i18n-retirement.test.ts` — a sweep that emptied this file would satisfy every absence assertion and take the directory's most widely carried live shape with it. The standing warning's own subject, the wide-open `I18nObject.params` record, left with its schema: openness there was the contract, and there is now no shape for it to be the contract of |
| `responsive.zod.ts` | authorable | **strict as of #4001 批 13** — all four sites (`ResponsiveConfig`, `ResponsiveStyles`, and the two per-breakpoint maps). This is the one file of batch 13's six whose `(p)` resolved POSITIVE, and it resolved on the graph rather than on the file's face: `page.components[].responsive` / `.responsiveStyles` put both shapes inside the `page` metadata-type root (`dashboard.widgets[].responsive` was the second carrier until #4876 retired it, same day). What the closure bought is the batch's whole argument in one parse — **`PageComponentSchema` has been `.strict()` since ADR-0089 D3a and that never reached these blocks**, so `{ type:'element:text', responsiveStyles: { lg: {…} }, responsive: { colums: {…}, hideOn: [] } }` parsed CLEAN and returned `responsiveStyles: {}, responsive: {}` — every styling and layout instruction the author wrote, gone, reported valid. A strict shell over strip-mode children is a closed surface's silhouette, not a closed surface. The curation is the file's real hazard rather than typos: it carries TWO breakpoint vocabularies sixteen lines apart on the same component (`responsiveStyles`' `large`/`medium`/`small`/`xsmall`, ADR-0065, against `responsive`'s Tailwind `xs`…`2xl`), so the aliases run BOTH ways between them and are anchored to the named sibling, not to edit distance — batch 12's method, and the only thing that can answer `lg` → `large`. Two entries had to be measured rather than reasoned: `{ columns: { large: 4, lg: 3 } }` used to keep HALF the map (the node laid out, at the wrong width, on breakpoints the author never named — worse than a total loss, which is at least visible); and `hideOn` → `hiddenOn` needed a hand-written alias because the distance fallback provably cannot reach it — it lowercases the input but not the candidates, so a capital in a declared key costs an extra edit against a budget of 2, and the all-lowercase `hiddenon` resolves while the correctly-cased `hideOn` does not. That asymmetry is general to camelCase keys, i.e. to most of the spec, and is filed as **#4990**. `StyleMapSchema` stays deliberately OPEN (its key space is every CSS property; objectui's `declarations()` emits whatever it is handed) — recorded in the schema JSDoc, in a test pin, and in this row |
| `dataset.zod.ts` | authorable | **strict as of #4001 批 14 — 0 strip sites remain.** `DatasetSchema` was strict from the ADR-0021 cutover while the two shapes carrying the actual semantic contract — `DatasetDimension`, `DatasetMeasure` (+ `.derived`) — were not. Curated against the sibling this module's own header names, `data/analytics.zod.ts`'s Cube layer: a Cube metric's `type` IS its aggregation, so `{ name: 'revenue', type: 'sum', field: 'amount' }` parsed clean and computed a `count`; `sql` gets guidance rather than an alias, because aiming `SUM(amount)` at `field` is finding 7's trap |
| `report.zod.ts` | authorable | **strict as of #4001 批 14 — 0 strip sites remain.** `ReportSchema` was already strict; `ReportSortSchema` and `JoinedReportBlockSchema` were not. The order key is the THIRD spelling of "sort" an author meets (`SortNodeSchema`'s `{field, order}`, the widget's flat `sortBy`/`sortOrder`, this `{by, direction}`), and the mappings run in opposite directions, so none is inferrable. ⚠️ `ReportSchema`'s OWN alias table carries a live false prescription (`filter` → `filters`, a key it also rejects; the real key is `runtimeFilter`) — out of 批 14's scope, filed as #5013 and pinned as a known defect in `strictness-batch14.test.ts` so the list cannot outlive it |
| `sharing.zod.ts` | authorable | **Was this ledger's first `split` row — one file, two verdicts — and #5015 resolved the dead half, so the split is now history rather than a live classification.** `SharingConfigSchema` is a **live door** and is all that remains: `FormViewSchema.sharing` carries it, `rest-server.ts` mounts the anonymous form routes on `sharing.allowAnonymous` + `sharing.publicLink`, and both example apps author it (`app-showcase` `inquiry.view.ts`, `app-crm` `lead.view.ts`) — **strict as of #4001 批 14**. `EmbedConfigSchema` was the other verdict, **`no door`**: nothing in the repo so much as named the symbol, BFS-unreachable, zero parse. It was not tightened — *"a precisely-validated dead slot is the more convincing lie"* (#4583) — and the ADR-0049 call filed as #5015 came back **REMOVE** (2026-08-04); the shape is gone. Keep the split on the record even though the file no longer needs it: it is why the classification question is asked per SCHEMA rather than per file, and a file-level verdict here would have been wrong in one direction or the other whichever way it fell — either tightening a dead slot or leaving the live anonymous-access door open |

`notification.zod.ts` had a row here (`authorable (p)`, resolved to **`no door`** at #4001 批 14) until #5015 retired `NotificationActionSchema` under ADR-0049 enforce-or-remove. The file survives and still exports its three presentation enums (`NotificationType` / `NotificationSeverity` / `NotificationPosition`, which objectui's toaster reads as a vocabulary) — but those are `z.enum`s, so the file now has **zero object sites** and nothing left for this ledger to classify. #4610 had already dropped two sites from it by deleting the `Notification` / `NotificationConfig` wrappers for having zero consumers; removing the action shape they would have carried is the end of that same thread. Worth keeping the trail: the row's value was never its site count but its demonstration that *having a consumer is not having an authoring door* — objectui read `NotificationActionSchema.shape.variant` as a vocabulary the whole time the shape was unreachable and unparsed.

**批 13 的五行 triage 行已在 #4988 删除,去向记在这里** — `animation.zod.ts` /
`dnd.zod.ts` / `keyboard.zod.ts` / `touch.zod.ts` / `offline.zod.ts` were the
first `no door` verdicts this ledger ever recorded, and they are the first to be
acted on: ADR-0049 enforce-or-remove resolved **RETIRE** (maintainer ruling
2026-08-04), so all five files were deleted whole — 22 `z.object` sites, 32
emitted defs, 64 exported names, 109 `authorable-surface.json` keys and the five
generated `content/docs/references/ui/*` pages. The rows are gone because the
files are gone, not because anything was tightened; the measurement that
produced the verdict is preserved in the retirement's own record
(`ui/interaction-config-retirement.test.ts`, the
`ui-interaction-config-family-retired` ADR-0087 D3 entry and the changeset).

⚠️ **The class held.** The 批 13 note said `.strict()` here would spend a v17
breaking change to leave *"a precisely validated dead slot — the more convincing
lie"*, and it named the live question as ADR-0049 rather than strictness. That
refusal is what made the question answerable a batch later, and the answer went
the destructive way — which is exactly why the `no door` → ADR-0049 →
maintainer-ruling path exists instead of a sweep. **This retirement moves no
strictness debt**: the sites were `strip`, never `strict`, so the `strict`
column does not move and the `strip` column falls by the count of what left.

### `data/` — file-level triage

| File | Class | Note |
|---|---|---|
| `object.zod.ts` | authorable | top-level already guarded (#1535); **all 14 inner blocks strict** — 13 at 批 20, and the held 14th (`IndexSchema`) closed 2026-08-16 once its hold's evidence was spent: the hold was the #5114 class caught pre-ship (objectui's `FALLBACK_SCHEMAS.index` had drifted, offering `where`/`brin`, and the editor PUT the whole object through `saveMetaItem`), gated on the objectui rename (#5247) and an ADR-0049 answer for `type`/`partial` (#5248). #5248 answered remove (PR #5842, `retiredKey` tombstones + protocol-17 migration); **objectui#4772 then converged the editor to the declared `name`/`fields`/`unique` surface**, so the close shipped with a curated `where` guidance entry (database-layer prescription — deliberately NOT a rename onto the retired `partial` tombstone, which would be finding 7) and per-key pins that the tombstones' own prescriptions survive the strict path. Semantic entry `object-index-unknown-keys-refused` (protocol 18). The file's row left the remaining-strip map by reaching zero; the hold's full history is preserved in that map's section prose and in `object-strictness-batch20.test.ts` §4, which flipped from pinning the strip to pinning the close |
| `data-engine.zod.ts` | wire (p) | engine contract shapes (was 14 — `DataEngineBatchRequestSchema` retired with `IDataEngine.batch?`, #4618) |
| `seed-loader.zod.ts` | wire | **re-verdicted 2026-08-14 (#4001 batch D)** — the `(p)` split's "authored" half dissolved under measurement. The seed FILE shape this file's old note meant is `SeedSchema` (`seed.zod.ts`, a registered type, strict since the registered-types batch) — it enters this file only as the `seeds[]` VALUE inside `SeedLoaderRequestSchema`, so the authored half was never one of these 12 sites. Every producer of the request/config halves is framework code, enumerated: `runtime/app-plugin.ts` ×3 (org replay / inline seed / hot-reload), `runtime/domains/packages.ts`, `metadata-protocol/protocol.ts` `applySeedBodies`, `metadata-protocol/seed-loader.ts` `validate()`, `cloud-connection` marketplace install — all `.parse()`/`.safeParse()` over config LITERALS written in code; no `defineStack` key, no metadata type, no Studio form, no CLI flag writes a loader config. `SeedIdentity` is server-constructed by design (`execution-context.zod.ts`: "never client-supplied"); graph/resolution/result/error shapes are built by the loader itself (`buildDependencyGraph`, `buildResult`). BFS from all 26 metadata-type roots + `ObjectStackSchema` (6689 nodes; `ObjectSchema` positive control REACHABLE, fresh uncarried shape negative control UNREACHABLE, synthetic-carrier flip green, same run): all 12 UNREACHABLE. Same class as `data-engine.zod.ts` — an internal service contract (`ISeedLoaderService`), machine-fed at every door |
| `field.zod.ts` | authorable | partially strict |
| `filter.zod.ts` | open | query dialect — user data flows through the predicate values; validated semantically elsewhere |
| `query.zod.ts` | open, **except `SortNodeSchema` → authorable** | Blanket `open` was the imprecise verdict here, not the strictness. Four sites are the dialect proper (`BaseQuerySchema`, `AggregationNodeSchema`, `FullTextSearchSchema`, `GroupByNodeSchema`'s object arm) and keep the class. `SortNodeSchema` is not dialect: a closed two-key tuple `{field, order}` with **no user-data face at all** — so #4721 carved it out and it is **strict as of #4721** (`strictObject` + `aliases: { direction: 'order' }`). What that bought, measured on `main` first: `SortNodeSchema.parse({field, direction:'desc'})` → `{field, order:'asc'}` — the sort ran the OTHER WAY, and with `limit` that is a different set of rows under an ordinary 200. Per the 11:41Z ruling on #4721 this is a NEW door, not the completion of #4371's: that check is a hand-written top-level allowlist in `objectql/src/engine.ts` (`rejectUnknownEngineOptions`) that never recurses into `orderBy[]`, and `QuerySchema` itself is **not** strict (probe: `QuerySchema.safeParse({object:'sales', nonsenseKey:1}).success === true`) — top-level strictness is #4001's, tracked separately. Site history: one site dropped in #4196 (`FieldNodeSchema`'s nested-select object form narrowed to `z.string()`); four more in #4286 with the `joins`/`windowFunctions` removals (`JoinNodeBaseSchema`, `WindowFunctionNodeSchema`, `WindowSpecSchema`'s outer + `frame`) |
| `driver-nosql.zod.ts` / `driver.zod.ts` / `driver-sql.zod.ts` | wire | driver capability contracts |
| `datasource.zod.ts` | authorable | **strict as of #4001 data step** — all 6: `DatasourceSchema` (+ `pool` / `ssl`), `ExternalDatasourceSettingsSchema` (+ `validation`), `DriverDefinitionSchema`. **#4583 B/C dropped two more sites**: the `healthCheck` and `retryPolicy` blocks are gone — nothing scheduled a probe and nothing retried, so their strictness was validating a shape no code consumed. `config` stays `z.record` **at this level** by construction (per-driver shapes), but is no longer unchecked: **#4410** made `DatasourceSchema`'s refinement parse it against the contract for the declared driver (`driver/config-registry.zod.ts`), so the openness here is a shape this level cannot express rather than the absence of one. This row used to add "the driver's own `configSchema` validates them", which was false until #4410 landed the parse site it names. #4410 extended the same parse to each `readReplicas` entry; **#4468 retired that key** — no driver ever opened a replica connection and no query path splits reads from writes, so the entries were being checked against a contract nothing would apply. Strictness makes a dropped key loud; it cannot make a slot live, and a *precisely validated* dead slot is the more convincing lie | **#4583 dropped the ninth site**: `DatasourceCapabilities` is gone — eleven flags no code read, on a block whose strictness was the clearest case of this row's own closing sentence. `readOnly` in particular was *precisely validated* and completely inert, and had been relocated twice (#4410, #4465) toward somewhere it might be enforced; the shipped CRM example called a datasource a read replica on the strength of it while writes went through. Class unchanged
| `driver/memory.zod.ts` / `driver/mongo.zod.ts` / `driver/postgres.zod.ts` | authorable | The per-driver shapes for the `config` slot — what an author actually writes under `datasource.config` (`host`, `port`, `filename`). **Undeclared here until the coverage walk went recursive** (see below): a subdirectory was invisible to the gate, so these sites sat outside the map while the map reported full coverage. **Strict as of #4410**, which is also what unblocked them: this row previously read "strictness here would enforce nothing" because nothing parsed `datasource.config` against these schemas and both `*DriverSpec.configSchema` literals were `{}`. Now `DatasourceSchema` parses `config` against them, and the same schemas project onto `configSchema` and onto the Studio connection form. (#4410 also ran the parse over each `readReplicas` entry; #4468 retired that key outright — see the row above.) `postgres.zod.ts` drops a site: its `ssl` was a `boolean | {ca, cert, key, …}` union, and the object arm is gone — certificates now live in the datasource-level `ssl` block (declared, strict, and until #4410 read by nobody), leaving `config.ssl` as the on/off shorthand. That narrowing is forced by the same projection: the Studio form renders anything that is not boolean/enum/number as a TEXT INPUT, so a union here would have produced a wizard whose every `ssl` value the new gate rejects. `memory.zod.ts` keeps 6 but loses two KEYS — `indexes` / `maxRecordsPerObject`, which `InMemoryDriverConfig` has no field for, removed under ADR-0049 rather than blessed by the new gate |
| `driver/turso.zod.ts` | authorable | The libSQL/Turso `config` contract, added by **#6345** — and the last driver on the platform whose `config` had no gate at all. It was not an oversight of #4410 but a consequence of turso not being a BUILTIN: its driver ships in the optional `@objectstack/driver-turso` package, so `resolveDriverId('turso')` returned `undefined` and `validateDriverConfig` answered `{ known: false }` — "nothing to check against" — while both boot hosts dispatched `turso` for real. A datasource carrying `{ token: … }` (the plausible spelling; the driver reads `authToken`) was therefore accepted in silence and then connected UNAUTHENTICATED, which is #4410's own failure mode surviving in the one driver #4410 could not see. Every site strict, same error factory as the rest of the campaign, including the nested `sync` block — a bare `z.object` there would have dropped `sync: { interval: 60 }` and synced on the default while the author believed otherwise, i.e. added a strip site to this map instead of closing one. The declared keys are drawn from what `TursoDriverConfig` actually READS, not from what libSQL supports, so closing this gap does not open an ADR-0049 one: `client` (a live `@libsql/client` instance — not authorable metadata), `pool` and `schemaMode`/`readOnly` (datasource-level, like every other driver) are deliberately absent |
| `driver/mysql.zod.ts` / `driver/sqlite.zod.ts` | authorable | The rest of the `config` contract, added by #4410. `mysql.zod.ts` and `sqlite.zod.ts` (sqlite + sqlite-wasm) are shapes that **never existed** — both driver ids were offered by the connection form and buildable by the shared factory, with no config contract anywhere, so `driver: 'sqlite'` + a misspelled `filename` was an ephemeral `:memory:` database reported as configured. All three sites strict, same error factory as the rest of the campaign. (Their sibling `driver/common.zod.ts` holds shared enums and prescription strings and has no `z.object(` site, so the coverage gate skips it) |
| `analytics.zod.ts` | authorable | **strict as of #4001 batch D — all 8 sites; the `mixed (p)` resolved to authorable on both halves.** The cube family (Metric + its `filters[]` item, Dimension, CubeJoin, Cube + `refreshKey`) has two live authoring doors, measured: `defineCube()` `.parse()`s an author literal (the showcase example authors through it) and `defineStack({ analyticsCubes })` carries every cube through `StackSchema.parse` — the whole family resolves REACHABLE in the batch-D BFS (positive/negative controls green in the same run). Pre-close probes: a cube's `publik`, a metric's `title`, a join's `relationshipp` (falling back to the `many_to_one` default — a different join shape under a successful parse), a `refreshKey.sqll` all parsed clean and vanished. The query half was subtler and is the batch's live behaviour change: `AnalyticsQuerySchema`'s TOP level was already gated at its one production door (`api/analytics.zod.ts`'s `AnalyticsQueryRequestSchema` is `.extend(…).strict()` since #3878), but **top-level strictness does not recurse** — measured on `main`, `timeDimensions: [{ dimension, granuarity: 'day' }]` rode through the strict wrapper with the typo silently stripped, bucketing the whole range as one group under an ordinary 200. Closing the base makes the posture hold at every door instead of only at the wrapper that re-applied it. ADR-0010 envelope deliberately NOT declared: no protected item re-parses here (`CubeRegistry.register` takes typed objects without a parse; `analytics_cube` resolves no `getMetadataTypeSchema` entry so `saveMetaItem` never parses it; artifact ingest parses the compiled definition BEFORE `applyProtection` stamps). Producer sweep over objectui/cloud: zero cube/analytics-vocabulary producers (objectui's `data-objectstack` sends only declared keys — `cube`/`measures`/`dimensions`/`where`) |
| `document.zod.ts` | wire (p) | |
| `hook.zod.ts` / `hook-body.zod.ts` | mixed | **strict as of #4001 data step** for the AUTHORING shapes: `HookSchema` (+ `retryPolicy`) and both body branches (`ExpressionBodySchema` / `ScriptBodySchema`). `HookContextSchema` and its `session` / `provenance` / `user` blocks are the RUNTIME shape the engine hands a handler — they stay tolerant, and must: strictness there would make an engine-internal enrichment (as `provenance` was in #3712) a breaking change for anyone parsing a context they were given. The file's old blanket `authorable (p)` was too wide — verification split it |
| `mapping.zod.ts` | authorable (p) | |
| `external-catalog.zod.ts` | wire (p) | |
| `validation.zod.ts` | authorable | **strict as of #4001 batch 3b** — a `z.lazy()` discriminated union, so the one-call conversion does not apply: each of the six variants builds its own `strictObject` from a shared `BASE_VALIDATION_SHAPE`. Closing the base alone would have rejected correctly but suggested from the SHARED keys only, so a typo of a variant's own key (`transtions` → `transitions`) would get no rename. Site count 1 → 6 because the six variants are now object sites in their own right. The ADR-0010 envelope lives in the shared shape, so all six inherit it |
| `field-value.zod.ts` / `seed.zod.ts` | open | `seed` is strict (registered-types batch). **`field-value` re-verdicted `open` 2026-08-14 (#4001 batch D)** — the row's own "record data, very likely open" prediction, now measured: `LocationValueSchema` and `AddressSchema` are ADR-0104 VALUE contracts whose input is record data (end users, importers, device geolocation APIs, geocoders), consumed validation-only (`record-validator`'s `shapeSchemaFor(def).safeParse(value)` — the value is stored verbatim, so `.strip` never actually strips anything), with enforcement posture owned by ADR-0104's own evidence-gated warn-first rollout, not this ratchet. Closing them would reject legitimate stored data — a phone's geolocation payload carries `heading`/`speed`, a geocoder's address carries `district` — exactly the openness their sibling `FileValueSchema` declares with `z.looseObject` ("renderers add their own"). One caveat recorded rather than glossed: a `location`/`address` field's authored `defaultValue` literal validates through the same contract (#7127), so an author's extra key there is admitted silently — that is the value contract serving two doors with one posture, and splitting it strict-for-defaults/open-for-records would fork the ADR-0104 contract |

### `automation/` — file-level triage

| File | Class | Note |
|---|---|---|
| `flow.zod.ts` | authorable | **strict as of #4001** — the four outer authoring shapes at step 1, and **the six nested blocks at batch 11** (`FlowNode.connectorConfig` / `.position` / `.inputSchema` / `.waitEventConfig` / `.boundaryConfig`, `Flow.errorHandling`). The gap between those two dates is this campaign's own finding 17 inside its own file: closing the shells left the gate rejecting `nodee:` at node level while `connectorConfig: { connectorId, actionId, params: {…} }` parsed clean and the executor dispatched `input ?? {}` — a successful connector call carrying nothing. Worth recording precisely, because the obvious example is the wrong one: a slip on a REQUIRED key was always loud (it then reads as missing). What `.strip` swallowed here is the OPTIONAL half — the input map, the retry budget, `interrupting: false`, `required: true` — i.e. exactly the keys an author adds to CONSTRAIN behaviour, replaced by a permissive default without a word. `Flow.errorHandling` gained a second chapter at **#4964**: closing it in 批 11 revealed (rather than caused) that its retry keys were a THIRD encoding of the policy #4661 had converged — it spelled the base delay `retryDelayMs` where the shared declaration spells it `backoffMs` and tombstones the old word, so the strictness this row records was, for one release, rejecting an author for having read the newer file. The block now builds from `retryPolicyShape()`. Site count unchanged; only the vocabulary. Two things stay open and are now pinned in code with the reason, so a later sweep stops rather than "finishes" the file: the node `config` slot (ADR-0018 plugin namespace) and `FlowVersionHistorySchema` (the file's only WIRE shape — emitted on publish, never authored; its `definition` is `FlowSchema`, so the authored half inside a history record is gated anyway) |
| `execution.zod.ts` | wire | run-state envelopes — never strict. +5 at #4354 (the run-summary family: step metrics / skip reason / per-node / per-gate / the summary itself) — engine-emitted telemetry read by the Console and by operator queries, nobody authors them, so the `wire` verdict covers them unchanged |
| `state-machine.zod.ts` | authorable | **strict as of #4001 批 10** — all six sites (`ActionRef` / `GuardRef` / `Transition` / `StateNode` + `.meta` / `StateMachine`). **The `(p)` was NOT a formality here.** ADR-0020 retired this XState shape as a *record-lifecycle* declaration — the top-level `workflow` metadata type and `object.stateMachines` are both gone, and a record's transitions live on the `state_machine` VALIDATION RULE instead — so had those been the only doors this file would be DEAD surface, and the correct action would have been to fix its class, not close it. One authoring door survives: `ai/agent.zod.ts`'s `lifecycle` is `StateMachineSchema`, and `agent` is a registered type, so `defineStack({ agents })` / meta REST / the Studio agent form all reach here through `AgentSchema.parse()`. Verified by parse: an agent whose lifecycle carried `stats`, a state with `onn` (one keystroke from `on`) and a `meta` with two unknown keys **parsed clean**, returning a machine with NO transitions at all — the declaration whose whole job is to deny undeclared transitions, silently emptied and reported valid. `.meta` was checked for the #4909 open-slot case and is CLOSED: the hand-written `StateNodeConfig` type declares exactly its four keys (passthrough would open the Zod while `tsc` stayed shut), nothing in the repo reads any `meta` key, and the prior behaviour was strip — an author's `meta` arrived as `{}` — so there was no openness to preserve. ⚠️ `ActionRef` / `GuardRef` are UNIONS: a strict branch's message does not reach the top (zod raises one `invalid_union` whose message is the literal `"Invalid input"`, with the real prescription nested in `issue.errors[]`), which `formatZodError` then flattens away — filed, not fixed here. **−1 at #4658**: the orphan `EventSchema` (`{ type, schema }`, an XState-style signal declaration nothing referenced — `StateMachineSchema` names event types as `on:` record keys) was deleted rather than converged with `kernel/events/core.zod.ts`'s envelope `EventSchema`, whose key set it did not intersect (#4535 C6). The remaining 6 sites and their verdict are unchanged |
| `control-flow.zod.ts` | authorable | **strict as of #4001 批 10** — all five sites (`FlowRegion` / `Loop` / `ParallelBranch` / `Parallel` / `TryCatch`). The `(p)` resolves to authorable on the executors' own parse seam (`parseNodeConfig`, #4277) plus `validateControlFlow`'s region parse. **`validateControlFlow` is a sibling guard, not a key gate, and the two do not fight**: it answers single-entry / single-exit / acyclic, which no key check can decide, and the schema answers key membership, which no structural check can decide. They meet at exactly one seam — the guard `safeParse`s each region slot before analyzing it, so an undeclared region key now surfaces there as `<where>: invalid region — <the strictObject message>`, the guard's framing wrapping the schema's prescription. Nothing was duplicated and nothing removed; the guard simply stopped silently repairing its own input before judging it. Two curation entries had to be MEASURED rather than reasoned: the bare edit-distance fallback answers `itemVariable` with **`indexVariable`** — binding the loop INDEX where the author wanted the ITEM — so the alias exists to overrule a confidently wrong suggestion from this campaign's own helper (the `pii` → `min` shape, third instance); and `join`/`joinGateway` needed two DISTINCT prescriptions because `guidance` emits one bullet per key verbatim, so a shared string printed the same paragraph twice. Its test instrument also had to be rebuilt: `region-slots.test.ts` probed every construct with every candidate key at once and depended on `.strip` to discard the mismatches, so it returned "no schema accepts any region" the moment the shapes closed — it failed loudly, which is the only reason this is a footnote and not a fourth finding-3. Structural validation by `validateControlFlow` remains. **−1 at #4661**: `RetryPolicySchema` moved out to `shared/retry-policy.zod.ts` — `./automation` and `./system` published the same name for two different declarations (#4411), so the retry policy converged onto one. The site still exists and is still non-strict and authorable; it is simply no longer in a directory this ledger sections. ⚠️ That is a coverage gap worth knowing about: this audit sections `ui/` / `data/` / `automation/` / `security/` / `studio/` only, so a `shared/` shape is unaudited by construction. The tolerance is deliberate here — the `retryDelayMs` → `backoffMs` rename is tombstoned via `retiredKey()` precisely because a non-strict parent would otherwise swallow the old spelling. **#4964 widened that rename to `flow.errorHandling`**, which spelled the base delay the pre-17 way while the shared policy tombstoned it — so the two automation retry surfaces now teach the same word, and the tombstone's prescription names all four surfaces instead of the two #4661 could see |
| `bpmn-interop.zod.ts` | wire (p) | interop import shapes |
| `approval.zod.ts` | authorable | **strict as of #4001 step 3** — all four authoring schemas (node config / approver / escalation / decision-output). The published JSON schema carries `additionalProperties: false` into the Studio form AND `registerFlow()` config validation (#4027/#4040), so an unknown key in an approval node's `config` is rejected at registration too — verified: `z.toJSONSchema` on the strict lazySchema does not throw (#3746 hazard checked) |
| `node-executor.zod.ts` | wire | executor contract |
| `io-node-config.zod.ts` | authorable | `NotifyConfigSchema` / `HttpConfigSchema` (#4045) — the sibling contracts that validate the **open** `config` slot on flow `notify` / `http` nodes. Authored per-node, so the open-slot exemption above does not extend to them. **Strict as of #4001 批 9**; the node `config` SLOT itself stays open (ADR-0018 keeps `node.type` open, so the slot cannot be closed without closing the plugin extension point). Five `guidance` entries carry the ADR-0087 notify aliases (`to`/`subject`/`body`/`url`/`source`) |
| `builtin-node-config.zod.ts` | authorable | Same family (#4045): the CRUD quartet, `screen`, `map`. Written from what the executors read rather than from the descriptors' `configSchema` literals, and reconciled bidirectionally by `builtin-node-form-zod-ledger.test.ts` — so unlike most rows here, this one already has a drift check of its own. **Strict as of #4001 批 9.** The curated tables are the `FLOW_NODE_UNKNOWN_KEY_GUIDANCE` prose from `service-automation`'s registration door, plus two entries that door never had: `recordId` (measured on CRUD nodes across the repo's own flow fixtures, read by no executor — on `delete_record` that is #3810 wearing a key that looks like a constraint) and `outputVariable` on `update_record` / `delete_record` (a documented ABSENCE, and the likeliest wrong key precisely because five sibling contracts declare it) |
| `schemaless-node-config.zod.ts` | authorable | Same family, third panel (#4278): `script` / `subflow` / `decision` (+ the decision branch item) — the descriptor-schemaless nodes whose form lives in objectui's hand-written table. Written from the executors; the drift check is objectui's `flow-node-config.spec-reconciliation` test (cross-repo, via the published exports — it compares `.shape` key sets, so strictness does not move it). Since #4343 `script` and `subflow` ARE parsed at execute time (`parse-config.ts`). **Strict as of #4001 批 9 — and this is the one row in the table where strictness is the FIRST unknown-key gate, not a second one**: `registerFlow()`'s #4277 rejection derives its declared set from a descriptor `configSchema`, so it structurally skips the schemaless class. `decision` stays export-only, closed anyway; its `condition` guidance suppresses a one-edit rename to `conditions` that #4414 proves is the worse outcome |
| `webhook.zod.ts` | authorable | **strict as of #4001 batch 11**, and the `(p)` resolved to the opposite of what the old note ("spec-only") implied. Three parse doors, not zero: `defineWebhook()`, `defineStack({ webhooks })` via `StackSchema`, and — the one that mattered — `plugin-webhooks`' `bootstrapDeclaredWebhooks`, which re-`parse()`s every declared webhook at BOOT before materializing it into `sys_webhook`, warning and SKIPPING on failure. Which is why the ADR-0010 envelope landed in the same change rather than as a follow-up: both metadata load paths call `applyProtection` on EVERY type, so a package-loaded webhook reaches that boot parse already carrying `_packageId` / `_provenance`. `.strip` discarded them; `.strict()` alone would have converted every package-shipped webhook into a **skipped subscription after redeploy**, with one `warn` to say so. This is the envelope debt the registered-type batches paid down eight times — `webhook` is not a registered type (no `BUILTIN_METADATA_TYPE_SCHEMAS` entry), which is exactly why the invariant test that guards those never looked here. ⚠️ Strictness also rides `.extend()` onto `integration/connector.zod.ts`'s `WebhookConfigSchema` (verified against real zod, and pinned in `connector.test.ts`); its two extra keys are named in `extraKeys` — except `events`, deliberately, because it is also an alias TARGET here and listing it would walk a base-surface author through two rejections into a key the base does not accept (finding 7, arriving via hand-written `extraKeys` rather than the shape) |
| `time-relative-trigger.zod.ts` | authorable | **Undeclared until the #4001 re-measurement, and invisible for the worst possible reason**: `TimeRelativeTriggerSchema` is written `z\n  .object({`, the old textual counter matched zero sites, and a zero-site file is SKIPPED by the coverage walk as "nothing to classify". So the gate whose whole promise is "no undeclared surface" reported green over an authorable schema — the same shape as `data/driver/`, one layer subtler, because this time the file was not hidden by the walk but by the counter feeding it. Classification is not a guess: the file's own `@example` blocks author it by hand into a flow start node (`config: { timeRelative: { object, dateField, offsetDays, filter } }`), which is the authoring door. A stripped key here means the sweep silently never matches — `offsetDay` for `offsetDays` returns a trigger that never fires, reported as configured. **Strict as of #4001 batch 11**, and closing it turned up one thing the triage did not predict: this schema is `safeParse`d at BIND time by `TimeRelativeTriggerPlugin` (`time-relative-trigger.ts`), not only at authoring — so the descriptor sitting under the deliberately-OPEN node `config` slot (ADR-0018) now has exactly one gate, and it is a runtime one. The behaviour change is the campaign's whole thesis in miniature: `{ …valid, offsetDay: 7 }` used to bind a sweep that ran daily with the author's narrowing discarded; it now refuses to bind and the plugin's warning carries the key and the rename |
| `flow-function.zod.ts` | authorable | `FlowFunctionDeclarationSchema` (#4396) — the `{ handler, effect }` form of a `defineStack({ functions })` entry. Authored, but note what an undeclared key here would be: a sibling of a **live function**, not data. `defineStack`'s union already rejects a record whose `handler` is not callable, and the boot-path reader is the hand-written `normalizeFlowFunctionEntry` rather than a `.parse()` (re-validating a live handler every boot buys nothing), so strictness would bind at authoring only. **Strict as of #4001 batch 11**, and the verify-first pass confirmed that reading exactly — stated in the code rather than left implied, because a tightening must not claim reach it does not have. It is still worth having for the reason the reading first made it look pointless: `normalizeFlowFunctionEntry` takes TWO keys and ignores the rest **by construction**, so a misspelled `effect` was dropped at the schema and then not looked for by the reader — and the failure runs the quiet way. The function registers, runs, and its writes are counted as none, which is precisely what keeps #4354's broken-sweep query (`selected > 0 AND acted = 0 AND unmeasured = 0`) silent on the one run that needed it |

`trigger-registry.zod.ts` had a row here (11 sites, "mixed — descriptors are code-registered (wire-ish); bindings authored") until #4499 deleted the file: all 11 sites were the third connector-vocabulary declaration (`ConnectorSchema` / `Authentication*` / `Operation*` / `ConnectorInstance`), and the old row's classification was optimistic twice over — nothing was ever code-registered against these descriptors and no binding was ever authored. The engine registers against `integration/connector.zod.ts` (ADR-0097), which keeps its own row.

### `security/` — file-level triage

| File | Class | Note |
|---|---|---|
| `explain.zod.ts` | wire | permission-explain responses — never strict |
| `permission.zod.ts` | authorable | **strict as of #4001**; `EffectiveObjectPermissionSchema` explicitly `.strip()`s (wire) |
| `rls.zod.ts` | authorable | **`RowLevelSecurityPolicySchema` strict as of #4001 step 2** (a stripped RLS key is a silent policy hole); `RLSUserContextSchema` / `RLSEvaluationResultSchema` are runtime shapes — stay tolerant |
| `sharing.zod.ts` | authorable | **strict as of #4001 step 2** — rule + recipient shapes; strictness and the error map ride the base into the criteria extension |

### `studio/` — file-level triage

| File | Class | Note |
|---|---|---|
| `object-designer.zod.ts` | authorable | strict as of #4001 — `defineObjectDesignerConfig` is the authoring door |
| `plugin.zod.ts` | authorable | strict as of #4001 — **was `mixed (p)`; verification found no wire half** |
| `flow-builder.zod.ts` | authorable | strict as of #4001 — `defineFlowBuilderConfig`; independent of `FlowSchema` |

**All three provisional verdicts are now verified, and one was wrong.** The
deciding evidence is the same lens the registered-type batches used: each file
exports a `define*` factory (`defineStudioPlugin`,
`defineFlowBuilderConfig`, `defineObjectDesignerConfig`) that `.parse()`s an
author-written literal. That is the authoring door, so `authorable` holds without
needing to know what `objectui` does with the result.

`plugin.zod.ts` was carried as `mixed (p)` with an empty note — a verdict with no
stated reason, which is how a provisional label survives. Reading it settles the
question: all eight shapes are contribution points on a VS Code-style plugin
manifest, every one hand-written by a plugin author. There is no wire half.

What could NOT be verified from this checkout, stated rather than glossed:
whether `objectui` also *constructs* these configs programmatically and parses
them with extra internal keys. If it does, strictness turns that into a loud 422
at its build — detectable and fixable, with the rename suggested — rather than
the silent narrowing it replaces. That is the trade this whole campaign makes,
and the residual risk is named here so a reader with `objectui` access can close
it rather than rediscover it.

## Remaining strip sites — the batch-planning map (re-measured 2026-08-03)

The tables above answer "how much surface is here". They never answered **"how
much of it is still open"** — the `Class` column is a verdict about who writes
the input, and the `Note` column said things like *"partially strict"*, which is
prose. So the number every batch plan actually needs was, until this
re-measurement, unmeasured: the 2026-08-03 maintainer ruling was scheduled
against counts of `strictObject(` occurrences, which undercount strict sites by
every schema closed with the OLDER `z.object(…).strict()` idiom — reading
`automation/` as **0 strict** when it has 8, and `ui/` as 49 when it has 72.

This section is the WORKLIST for that number. The number itself — per file, per
directory, and split by class — is
[in the counts file](./2026-07-unknown-key-strictness-ledger.counts.md#remaining-strip-sites--the-batch-planning-map),
generated (#5107). What stays here is the row: which file is still open, and the
per-schema verdict and evidence that say whether its remainder is work or a
deliberate floor.

Both halves are gated (`check:strictness-ledger`):

- every file with at least one strip site must have a row here;
- a row whose file reaches **zero** strip sites **fails the gate** — a closed file
  drops out of this table. That reverse pin is what makes the table a ratchet
  rather than a snapshot, and it is the lesson from the ADR-0010 debt list applied
  one level up: *a worklist that can outlive its work will.*
- the counts file must be fresh against the AST, so a schema that moves cannot
  leave this map describing a tree that no longer exists.

`Class` here is per SCHEMA, not per file, so a row's strip sites can span two
classes; where they do, **the row states the split** (`mixed · 6 authorable`) and
the subtotal is summed from those declarations rather than from a reading of the
prose. **Only the authorable half is in the 2026-08-03 ruling's forced scope** —
wire/open rows are listed so the arithmetic is complete and so nobody re-triages
them from scratch next batch.

#### `automation/` — remaining strip sites

| File | Class | Batch |
|---|---|---|
| `execution.zod.ts` | wire | **out of scope** — engine-emitted run state; the ledger row already says "never strict" |
| `flow.zod.ts` | wire | **batch 11 closed the 6 authorable** (`FlowNode.connectorConfig` / `.position` / `.inputSchema` / `.waitEventConfig` / `.boundaryConfig`, `Flow.errorHandling`). (`Flow.errorHandling`'s retry keys were re-pointed at the shared `RetryPolicySchema` at #4964 — a vocabulary change inside an already-closed site, so this row's numbers do not move.) The 1 left is `FlowVersionHistorySchema`, which this table has exempted since it was written — **do not close it**: it is emitted on publish, not authored, so closing it makes a future emitter-side field a parse failure for whoever reads history. The exemption now also lives beside the schema and in `flow.test.ts`, because a row in a table is not where the next person to open that file will look |
| `bpmn-interop.zod.ts` | wire (p) | **out of scope** — third-party BPMN import/export shapes; strictness turns an upstream addition into our parse crash |
| `node-executor.zod.ts` | wire | **out of scope** — executor registration contract, code-to-code |

Nine rows have left this table — eight across three waves of the ruling's
`automation/` main body, each one on reverse-pin evidence (the row was deleted
because the gate went red on it still being there, not because someone
remembered), and one because its file was retired outright:

| wave | rows removed | other change |
|---|---|---|
| **批 9** (#4925) | `builtin-node-config` (8) · `schemaless-node-config` (4) · `io-node-config` (2) | — |
| **批 10** (#4973) | `control-flow` (5) · `state-machine` (6) | — |
| **批 11** (#4974) | `flow-function` (1) · `time-relative-trigger` (1) · `webhook` (1) | `flow.zod.ts` 7 → 1 |
| **批 12** (#4979) | — | `etl.zod.ts` 10 → 3 |
| **#6414** (ADR-0049) | `etl.zod.ts` (3) | the file was DELETED, not hardened |

**The ninth row left for a reason none of the four waves above shares, and it is
worth separating.** 批 9–12 removed rows because the sites were CLOSED — the
schema went `strictObject` and the reverse pin went red on a row with nothing
left to classify. `etl.zod.ts` left because the whole L2 ETL layer was retired
under ADR-0049 enforce-or-remove (#6414): no engine ever parsed, scheduled or
executed an `ETLPipeline`, so there was no author for strictness to protect. That
is the `sync.zod.ts` disposition (#4738), which this ledger recorded from the
inside — the old `etl.zod.ts` triage row carried the `−12 at #4738` clause
describing L1's deletion, and its own classification caveat said the quiet part
out loud: *"`etl.zod.ts` has NO parse site in objectstack / objectui / cloud, so
neither half could be settled by pointing at a live call"*, and the 7 authorable
sites were authorable *"because the exported schema and type ARE the door"*.
A door nobody walked through. The row that recorded L1's retirement has now been
removed by the same reading applied one layer up, which is the ledger working:
the caveat it insisted on writing down is what made the second verdict cheap.

⚠️ **Do not read this as "hardening was wasted work".** 批 12's measurement is
exactly what made #6414 decidable — it is the reason the file's authoring door
was known to be a type annotation rather than a parse, and #4963 (the nine
`*Parsed` aliases) is the reason anyone had checked that the door compiled at
all. Retirement and hardening answer different questions in that order.

**How those waves met is worth recording, because it is the failure mode this
table is most exposed to.** Each PR deleted its own rows and decremented this
header by its own count. Git therefore merged the ROWS cleanly — they do not
overlap — and left only the header conflicted, while the subtotal line below it,
which conflicts with nothing, **merged clean and wrong**. No number was a mistake
in isolation: each was correct against the branch that computed it.

It has now happened four times in one day. 批 10 recorded it against 批 9's
header; 批 11 then merged and its subtotal (`etl` 7 + `state-machine` 6 +
`control-flow` 5) and 批 10's (`etl` 7 + `flow` 6 + three singles) were each
right against their own branch and both wrong against the merge; 批 12 made it
four, and did so twice — once against 批 10 and again against 批 11 — which is
the useful detail, because it means the count is not "once per wave" but once
per *pair* of waves that overlap in flight. So the rule was stated as a
discipline — **the header and the subtotal are recomputed from the surviving
rows, never resolved in favour of a side** — and #5107 made it a mechanism
instead: neither number is written by hand any more, so there is nothing here for
a merge to get plausibly wrong. A clean-looking merge here was evidence of
nothing, eleven times, which is what finally bought the split.

**Authorable strip in `automation/`: 0** ([counts file](./2026-07-unknown-key-strictness-ledger.counts.md#automation--open);
was 41 of 67 when the ruling was written). **The ruling's `automation/` main body
is complete** — every remaining strip site in this directory is wire, and none is
in the forced scope: `execution`, `bpmn-interop`, `node-executor`, `etl`'s
run-state shapes, and `flow.zod.ts`'s last site `FlowVersionHistorySchema`.

That leaves the section in a state this table has not been in before, and it is
the state most likely to be misread: **two rows now sit at a deliberate wire
floor** — `flow` at 1 (批 11) and `etl` at 3 (批 12) — rather than having
disappeared. The reverse pin cannot see the difference. It fires when a file
reaches zero, so it proves a row's work is *done*; it is completely silent about
a row whose work is *deliberately partial*, and to the gate "finished, the rest
is wire by decision" and "nobody got to it" are the same row. Only the `Class`
column separates them, which makes that column load-bearing from here on rather
than descriptive. Both waves drew the same conclusion independently and acted on
it the same way: the decision is also written beside the schema and pinned in a
test (`flow.test.ts`, `etl.test.ts`), because a row in a table is not where the
next person to open that file will look.

#### `ui/` — remaining strip sites

| File | Class | Batch |
|---|---|---|
| `view.zod.ts` | mixed · 1 authorable, 2 wire | **15 of 20 closed at #4001 批 18**, a sixteenth (`UserFiltersSchema`) at **#5073** once its protocol blocker was adjudicated, a seventeenth — `ViewFilterRuleSchema`, closed by an EARLIER wave — reopened at **#5114**, and then the file's last authoring debt cleared at **#5074**, which closed `ViewItemSchema` (×2 arms), `ListView.sort` AND `ViewFilterRuleSchema` in one structural change. **The strip count went 5 → 3, and the arithmetic is the finding, not the number: FOUR sites closed and TWO were ADDED** — the two arms of the new `ViewItemWireSchema`, which are strip BY DESIGN. That is why this row's Class cell is now a split (`1 authorable, 2 wire`) rather than a smaller `authorable` count: the wire contract that used to live on "the member nobody closed" now has a name, and this map measures posture, not intent. Closed: `ViewDataSchema`'s four provider arms, `UserFilterField.options`, `GanttQuickFilter.options`, `GanttConfig.tooltipFields`, `ListView.conditionalFormatting` / `.emptyState`, `FormFieldBase.keyField`, `FormView.subforms`, and `submitBehavior`'s four arms. Reachability was measured, not assumed: a BFS from all 24 metadata-type roots plus `ObjectStackSchema` resolves every one `root-graph`, with `ViewSchema`/`FormViewSchema`/`ViewItemSchema`/`PageSchema` as positive controls and 批 13's no-door shapes UNREACHABLE **in the same run** — and the instrument had to be fixed first: `lazySchema` returns a Proxy, but a carrier writes `X.optional()`, which RESOLVES it, so the closure holds the real instance and comparing the Proxy alone false-negatived `ViewDataSchema` (caught by cross-checking its two literal carrier keys, not by trusting the reading). ⚠️ **Re-checked against #5056**: every 批 18 target is `root-graph` by **identity**, so **none** of the fifteen rests on the `derived-clone` bridge that 批 16 found can mark a dead shape reachable. The one `derived-clone` verdict in the run is `ListViewSchema` — a positive CONTROL, not a target, and independently identity-reachable via `ObjectListViewSchema`. Every closed shape also has a literal carrier key in this file and a named parse door (`defineView` / `defineViewItem` / the `view` metadata-type schema / objectui's `GanttConfigSchema.safeParse` at `plugin-gantt/src/ObjectGantt.tsx:408`) — the strong-evidence class #5056 leaves standing. ⚠️ **`ListView.sort` was closed, REVERTED, and closed again at #5074 — the round trip is the file's most useful finding.** It carried `direction → order`, the #4721 alias for the identical tuple (`{field, direction:'desc'}` parsed to `{field, order:'asc'}` — a silently REVERSED sort). The full suite then failed one case: `view-metadata-schema.test.ts` pins `sort: [{ id, field, order }]` as the exact body a console column-sort PUT persists, and objectui stamps that `id` per row (`components/src/custom/sort-builder.tsx:68`/`:94`, `crypto.randomUUID()`). **The mechanism governs every nested block in this file and is the opposite of what the union's own comment implies: `.strip()` does NOT recurse.** `ViewMetadataSchema` rescues Studio's round-trip keys by making its flattened members `.strip()`, but that re-opens the TOP level only — a nested block closed inside `ListViewSchema` is still reached through that member, so a console-stamped key inside it becomes a 422 regardless. `id` was deliberately NOT declared to silence it: it is a React list key, and declaring it would put a UI artifact on the authorable surface and tell an AI author to emit one. **#5074 supplied the missing half and the shape is now CLOSED**: the write door removes the declared decoration vocabulary (`VIEW_CONSOLE_ROW_DECORATIONS` / `stripViewConsoleDecorations`, the mirror of `stripReadDecorations`) BEFORE the union runs, so the opening is recursive-effective where a member-level `.strip()` can never be, and the authoring surface never grew the key. The `direction → order` alias came back with it. Curation on what DID close is anchored to named siblings: an option `count` gets a wrong-layer pointer to `showCount` because objectui COMPUTES it per render; and a bare `name` on the `object` data source is deliberately NOT aliased — it is a real key on the view ITEM, so a rename would be finding 7 again. `submitBehavior` became a `discriminatedUnion` on the `kind` literal it already required: as a plain union of four strict members the rejection is an `invalid_union` whose prescription #5014 measured the renderers flattening away. ⚠️ **`GanttConfigSchema` / `TreeConfigSchema` are `strictObject(…).passthrough()`** — open at the parent by design, and this ledger's own counter used to read them as `strict`, because `postureOf` returned early on the `strictObject` idiom instead of walking the chain. **Fixed at #5072**: the idiom now seeds the initial posture and the chain always runs, so the two read `passthrough` and the directory's strict count drops by 2. The strip count was never affected — neither posture is strip — so this row's numbers do not move. **`UserFiltersSchema` is CLOSED as of #5073, and it is the one site in this file whose blocker was never a strictness question.** Closing it would have 422'd `allowAddTab` — a key objectui's renderer reads (`plugin-list/src/UserFilters.tsx:182`/`:742`) and the spec never declared; because `saveMetaItem` validates but persists the ORIGINAL body, the stripped key still reached the renderer, so the capability WORKED and closing would have removed it rather than making a silent failure loud. 批 18 stopped and filed rather than guessing, and the maintainer adjudicated **promote, then close, in one PR** (2026-08-04): `allowAddTab` is now DECLARED here, so the capability is discoverable from the contract (JSON Schema / Studio SchemaForm / an AI author) instead of living in one React file, and the shape closes behind it with no intermediate state. The rejected option was `SANCTIONED_LOCAL` in objectui, which would have made spec and objectui two sources of truth for one contract — the fork #2231's derive-by-reference exists to prevent (PD#12) — and would have taught authors to delete a working key with a rejection that was itself "correct" (finding 7). Two details the close is worth remembering for. **(a)** The promotion is scoped to what the renderer really does: the add-tab button objectui renders carries no click handler, so `allowAddTab` declares that the affordance RENDERS and deliberately says nothing about creating presets — a `.describe()` promising more would be PD#10's advertise-what-you-don't-deliver, and the renderer gap is filed as **#5236**. **(b)** The 批 6e reliance question resolved exactly as predicted — `ObjectUserFiltersSchema` is `.omit()`ed off this base and `.omit()` inherits posture, so the pin flipped from "drops" to "rejects", which is wanted (the CLI lint `validate-list-view-mode.ts` was already reporting these) — but inheriting the posture also inherits the base's ERROR MAP, whose `knownKeys` were read from the base shape and therefore still listed the omitted keys. Measured on the flip: `tab` was answered *"Did you mean `tab` → `tabs`?"*, steering the author at the one key that surface refuses — finding 7 produced by the fix for finding 7. So the object variant now carries its own map built over the OMITTED shape (the shape still derived by `.omit()`, so #2231 holds), with `guidance` pointing all three page-only keys at `listViews`. **⚠️ #5074 — the authoring/wire SPLIT, and the row's headline.** `ViewItemSchema` wore two contracts: the authoring gate (`defineViewItem`, objectui's view-create form, which validates `createBuildBody`'s output against the real spec schema) and member 1 of `ViewMetadataSchema`, the union `saveMetaItem` validates every persisted `view` body against. The wire role was measured, not inferred — objectui's pin control PUTs `{...storedItem, isPinned}` (`ObjectView.tsx:882` → `data-objectstack/src/index.ts:2801`); a stored ViewItem record carries `viewKind` AND `config`, so the merged body lands on member 1 (the flattened members are excluded by their `config: z.undefined()` guard) and closing the one schema would have 422'd pinning a saved view. The maintainer ruled **split** (2026-08-04), and the two-axis reasoning is worth keeping: `defineViewItem({name, object, viewKind, confg: {…}})` — one letter — used to strip the typo and hand back a ViewItem with **no view configuration at all**, parsed clean, which is #1535's `workflows: [...]` replayed on the file's densest authoring surface. `ViewItemSchema` is now `strictObject` on both arms; `ViewItemWireSchema` is the `.strip()` wire variant, built from the SAME `viewItemArmShape()` (derive-by-reference, #2231 — a `discriminatedUnion` cannot be `.extend()`ed, so sharing the shape factory is what keeps one contract from becoming two transcriptions), and `isPinned`/`sortOrder` are DECLARED on it — an explicit home, instead of surviving because nobody closed the member. **The scope addendum's hard requirement was recursive-effective openness, and that is the part a posture flip could not deliver.** `.strip()` re-opens a member's TOP level only, so the two console-decorated NESTED blocks (`ListView.sort[].id`, `ViewFilterRule.id`) were still reached at full strictness through it. The route taken is the addendum's second sanctioned one: a declared decoration vocabulary stripped before validation, at the wire door, reaching every carrier at every depth — including ones added later, which a hand-maintained parallel wire tree would not. It is deliberately NOT a second schema tree (PD#12's fork) and deliberately NOT a declared `id` (批 18 Q1's two-axis rejection: a React list key on the authoring surface teaches AI authors to emit UUIDs). Two landmines were named in the ruling and both are pinned in `view-authoring-wire-split.test.ts` §5: `z.toJSONSchema()` must still emit a four-member `anyOf` (the `/api/v1/meta/types/view` endpoint feeds Studio's SchemaForm from it — it does; a pipe converts to its output side, asserted in BOTH io directions), and the `lazySchema` Proxy's ADR-0089 D3a crash (`Cannot set properties of undefined (setting 'ref')`) must not recur under a pipe-rooted lazy schema — it does not, and each new schema is converted directly rather than only through its parent. **One real hazard the change surfaced, fixed in the same PR:** a `z.preprocess` at a registered root put TWO gate walkers into the exact blind spot #4488 had already found and fixed in `check-liveness.mts` — `metadata-authoring-lint.ts` and `metadata-form-zod-reconciliation.test.ts` both unwrapped a pipe via `def.in`, which for a preprocess is the TRANSFORM, so each reported `view` as *not key-bearing* and silently stopped covering it. Caught by their own coverage assertions (`lintables.length >= 1`, `root schema is not key-bearing`), which is precisely what those assertions exist for; both now prefer whichever side is not the transform. **A gate going quiet is worse than a gate failing** — and the pattern will recur on the next preprocess-rooted registration, so it is recorded here rather than only in the diff. **Still open, one site, measured:** `FormFieldBaseSchema` — a module-private BASE whose sole consumer already applies `.strict()` plus the ADR-0089 visibility error map (`strictVisibilityError` when this was measured; folded into the shared template as `VISIBILITY_STRICT_OPTIONS` + `strictObjectError` at #6619, deliberately WITHOUT closing the base — the site keeps its literal `z.object(` spelling so this instrument keeps counting it); the door is closed, the ledger counts the base. The two remaining strip sites beyond it are `ViewItemWireSchema`'s arms, which are `wire` by design and are not debt. `ViewFilterRuleSchema` — **the same wire contamination, one block over, and it was already LIVE on `main`** (#5114): closed by an earlier wave, while objectui's filter builder stamps `id: crypto.randomUUID()` on every row it writes (`components/src/custom/filter-builder.tsx:228`, re-stamped on read-back at `plugin-view/src/config/view-config-utils.ts:146`/`:160`), and `saveMetaItem` persists the AUTHORED body verbatim — so saving a filter from the console 422'd, on all three paths including the flattened overlay that is the body actually PUT. Reopened as a p1 hotfix; `id` deliberately NOT declared, for the reason given for `sort` above. **That reopen was explicitly PROVISIONAL — "pending #5074" — and #5074 retired it rather than leaving it standing: the shape is CLOSED again, by the same decoration strip that closed `sort`, so the authoring gate rejects `id` by name while the console's own three paths still parse.** Its pin file now asserts the split per door, and the direction is the INVERTED one worth flagging to the next reader: probes 1/3 and 2/3 were GREEN before #5074 and are RED after (that IS the close), while 3/3 — the body the console actually PUTs — is green on BOTH sides and must stay so; a file that only asserted "the console body parses" would have passed unchanged through a change that quietly declared `id` as authorable. Two details worth keeping: the overlay path's rejection surfaces as `invalid_union` / *"Invalid input"* — the #5014 flattening, so the key that caused it is not in the message the author sees, which is why this sat on `main` unnoticed; and the reopening was verified in BOTH directions (re-close it and 7 assertions in `view-filter-rule-wire-id.test.ts` go red, while that file's two mechanism CONTROLS — top-level aux key rides, nested `emptyState` still rejects — stay green either way, which is what makes them controls). #5074's scope addendum named this site; the gate it was waiting on — a wire opening that REACHES a nested block — landed with it. Each verdict is recorded in three places (schema JSDoc + `view-strictness-batch18.test.ts` / `view-filter-rule-wire-id.test.ts` + this row) |
| `widget.zod.ts` | **no door** | ⛔ **not strictness work** — the whole file measured unreachable from every authoring root (#4001 批 16), with no carrier key and zero parse in all three repos. ADR-0049 triage was **#5055**, and it is ANSWERED: eight of the nine sites were REMOVED (the whole widget-registration vocabulary). The row does not disappear, because the NINTH — `FieldWidgetPropsSchema` — was deliberately KEPT: it is a React props contract rather than authorable metadata, it never appeared in the authorable surface at all, and objectui PR #3289 gave it a live compile-time consumer. ⛔ **Do not close it and do not finish this file** — this is the fourth row in the ledger parked at a deliberate floor (after `flow` 批 11, `etl` 批 12 and `i18n` above), and the reverse pin fires on ZERO either way, so only this cell separates "parked" from "unfinished". See the triage row above, including why the campaign's own BFS said otherwise first (**#5056**) |
| `app.zod.ts` | covered | **批 19 ran the check and it came back NEGATIVE — no posture change; the `Class` was held at `verify` pending #5249 and is now `covered`, the verdict that ruling created (see below).** `BaseNavItemSchema`. The instruction here was to confirm the members' strictness was not already covering it before touching; it is, and the premise this row carried was wrong twice. (1) **The members do not `.extend()` the base — they spread `...BaseNavItemSchema.shape`.** That is a different mechanism, and the difference is the whole of finding 16: `.extend()` clones INHERIT the base's posture (which is how closing two `view` authoring schemas silently closed the Studio round-trip overlay), while a `...shape` spread copies the per-key schemas into a FRESH `z.object` whose posture is its own. Measured in both directions rather than read off the source, because *"closing the base closes the members"* and *"closing the base is a no-op"* are opposite claims: `strictBase.extend({…})` rejects an unknown key, `z.object({...strictBase.shape})` accepts it, `z.object({...openBase.shape}).strict()` rejects it. (2) **All nine branches already apply their own `.strict()`** with the curated `navItemUnknownKeyError` — asserted per branch through the real door (`AppSchema.navigation`, a `discriminatedUnion` on `type`), with a positive control (every base-contributed key, incl. `requiresService` which no branch declares itself, is ACCEPTED) and a negative control (an undeclared key is REJECTED) in the same run. The base is also module-private and has zero `.parse()` anywhere, so `.strict()` here would be a property of a parse that does not exist. Closing it is therefore a guaranteed no-op, and #4583 is explicit that a no-op closure is not neutral. ⚠️ **The open question was the VOCABULARY, not the measurement** — which is why 批 19 left the cell alone, since it is machine-read and a guess here would be published as a confident subtotal. The two-axis table above resolved carrier-absent + parse-absent to `no door`, whose prescribed follow-up is ADR-0049 retirement — and that prescription is *destructive* here: the vocabulary is fully ALIVE and fully GATED at nine consumers, so retiring the base would delete nine branches' shared keys. `no gate` is wrong for the mirror reason (the gate exists, at the members). `authorable` is the `FormFieldBaseSchema` precedent one row over in `view.zod.ts` — but that base really is `.extend()`ed, so closing it WOULD change behaviour, and calling this one `authorable` invites exactly the later sweep that "finishes the job" on a shape nothing parses. ✅ **RESOLVED at #5249 (maintainer ruling 2026-08-06, option A): the vocabulary grew a ninth verdict, `covered`, and this row is its first and — as of the sweep below — its ONLY instance.** The ruling took the same route 批 15 took for `no gate` rather than rounding to the nearest wrong answer, on the ground that the cell's readers are later agents and a verdict naming the wrong ACTION is amplified by whoever acts on it. The re-review the ruling required was run over all **197** strip sites in the five triaged directories, not just this file, and it is mechanical rather than a reading: `covered` requires the keys to reach consumers by `...X.shape` SPREAD (a spread lands them in a fresh `z.object` with its own posture, so the base is inert), whereas `.extend()`/`.merge()`/`.omit()` inherit posture and keep the base a real door. Exactly **one** of the 197 sites spreads — this one, into eight of the nine branches (`SeparatorNavItemSchema` declares its own two keys and spreads nothing, and is `.strict()` all the same). The three other module-private strip bases all resolve elsewhere and stay put: `view.zod.ts`'s `FormFieldBaseSchema` is `.extend()`ed at `:1475` → posture inherits → a real door → stays `authorable`; `query.zod.ts`'s `BaseQuerySchema` is `.extend()`ed at `:485` into `QuerySchema` → same → stays `open`; `component.zod.ts`'s `EmptyProps` is used as a VALUE under eleven `ComponentPropsMap` carrier keys → carrier present → not carrier-absent at all. The remaining ~50 sites are inline nested literals under a property, so they carry a carrier by construction and cannot be `covered`. Recorded in three places (the `BaseNavItemSchema` JSDoc + `app-strictness-batch19.test.ts` + this row); the pin includes a guard that fails if any branch ever stops rejecting unknown keys, which is the one change that would make this verdict need re-taking |
| `action-params.zod.ts` | wire | **out of scope** — `ActionSessionSchema`, the action-body `ctx.session` the runtime hands a body (#5697). Tolerant on purpose, same disposition as `data/hook.zod.ts`'s `HookContextSchema`. What this surface needed was never a closed door but a gate that RUNS: its consistency with the real producer is pinned in `packages/runtime/src/action-session-shape-contract.test.ts`, which asserts that a non-strict parse of the built object returns it UNCHANGED — so a key the builder starts producing without declaring it here is stripped, and the pin goes red |

`sharing.zod.ts` and `notification.zod.ts` left this table at **#5015** by a route no other row has taken: not by being CLOSED, but by having their remaining sites REMOVED. Both were `no door` — ADR-0049 territory, explicitly out of this ratchet's scope — and the enforce-or-remove call came back REMOVE, so `EmbedConfigSchema` and `NotificationActionSchema` are gone rather than strict. Read the reverse pin carefully here, because it fires on zero either way and cannot tell the two routes apart: the `sharing.zod.ts` row said in as many words that it *"shrinks without disappearing — the first `no door` floor"*, and that was true right up until the floor was retired out from under it. A deliberate floor and a retired one look identical from the count; only the `Class` column and this paragraph separate them. `sharing.zod.ts` keeps its TRIAGE row above, because `SharingConfigSchema` is still there and still strict — the file is closed, not empty. `notification.zod.ts` keeps no row anywhere: it has zero object sites left.

`i18n.zod.ts` left this table at **#5055** by the same route, and it is the cleanest instance of it: its five `no door` sites (`I18nObject`, `PluralRule`, `NumberFormat`, `DateFormat`, `LocaleConfig`) were REMOVED under ADR-0049, leaving only `AriaPropsSchema` — which 批 16 had already closed. The file reaches 0 strip by subtraction on one side and closure on the other, so the row goes; it keeps its TRIAGE row above, because both survivors are live and one of them is the directory's most widely carried shape. `widget.zod.ts` is the counter-example from the SAME PR, and the two must be read together: eight of its nine sites were removed by the same ruling and its row **stays**, because the ninth was deliberately kept. Same batch, same ADR, same three measurements — opposite dispositions, decided per site on the CURRENT evidence rather than on the issue body's, which had been overtaken by objectui PR #3289 the day before it was written.

`responsive.zod.ts` left this table at **批 13** (#4001) on reverse-pin evidence
— it reached 0 strip, the gate went red on the row still being there, and the row
was deleted. `action.zod.ts`, `report.zod.ts`, `dataset.zod.ts` and
`dashboard.zod.ts` left it the same way at **批 14**, and `theme.zod.ts` at
**批 15**.

`chart.zod.ts` left this table at **#5583**, and it is the one departure worth
reading as a METHOD rather than a number. Its last two sites
(`ChartAggregateSchema`, `ChartGroupBySchema`'s object arm) were held open for
five batches on a measured `no gate` verdict — carrier live, no parse — and were
closed in **two separate issues, in order**: #5020 wired the parse
(`packages/lint`'s react-page publish gate stopped re-deriving the vocabulary and
started calling `ChartAggregateSchema.safeParse()`), and only then did #5583 move
the posture. Closing them in one step would have shipped a `.strict()` over a
schema nothing parsed — #4583's "precisely validated dead slot", and this row is
the campaign's worked example of refusing it. The two `chart.test.ts` "still
STRIPS — deliberate" pins were INVERTED rather than deleted, and the companion
tolerance pins in `packages/lint`'s `validate-react-page-props.test.ts` with
them, so both states stay legible to the next reader.

Two things #5583 recorded that a later batch will need. **(a) The zod-4 union
collapse is now load-bearing on this file.** `groupBy` is a union, so the
`unrecognized_keys` its strict arm raises never reaches `error.issues` — zod
reports one `invalid_union` whose own message is the bare string *"Invalid
input"* (#5014, the same flattening that hid `dashboard`'s `compareTo`
prescription). What carries the named surface and the rename to the author is
`packages/lint/src/zod-issue-format.ts`'s arm unpacking, which #5020 had already
built; **a strict object arm inside a union is only as loud as its consumer's
unpacking**, and that is a general fact about this campaign's remaining union
sites, not a chart detail. **(b) The product question this row carried is
ANSWERED and it did NOT move the schema.** `groupBy` stays REQUIRED: measured on
2026-08-08, the example corpus authors exactly one `<ObjectChart aggregate={…}>`
and it carries `groupBy`, while the ungrouped single-value need is served by a
different registered block (objectui's `object-metric`, seven instances in the
showcase). objectui's three `schema.aggregate?.groupBy || schema.xAxisKey` reads
are optional-chained on `aggregate` itself, so what they serve is a chart with
**no aggregate at all** — they were mis-read as evidence that the renderer
honours an ungrouped aggregate. Declaring `groupBy` optional would have
advertised a shape the renderer does not deliver, so #5020's `warning`-level
tolerance stays a tolerance; promoting it to `error` is a separate acceptance
surface and is filed rather than smuggled in.

**Five more rows left at #4988, and their destination is not "closed" — it is
"deleted".** `touch.zod.ts`, `animation.zod.ts`, `dnd.zod.ts`,
`keyboard.zod.ts` and `offline.zod.ts` reached 0 strip sites because the FILES
were retired (ADR-0049 enforce-or-remove; 22 sites, 32 defs, 64 exported names,
reference docs deleted with them). The reverse pin fires on zero either way and
cannot tell the two apart — the same blind spot PR #5300 recorded for
`sharing.zod.ts` — so it is written down here instead: these five rows did not
graduate, they were retired, and their `no door` verdict was the evidence for
the retirement rather than a worklist item anyone finished. `i18n.zod.ts`'s
five `no door` sites and `widget.zod.ts` are the remaining rows parked at a
deliberate floor for the same reason; do not read their survival as unfinished
work.

Header and subtotal are
**recomputed from the surviving rows**, never decremented by any batch's own
count. That is not pedantry: it happened four times in one day in `automation/` —
each branch's arithmetic was right against itself, git merged the rows cleanly
because they do not overlap, and the subtotal line, which conflicts with nothing,
merged clean and wrong on both sides. Since #5107 the recomputation is not a rule
anyone can forget: the numbers are generated from the surviving rows plus the
AST, and the merge driver makes regenerating them a precondition of committing
the merge.

**批 13, 批 14 and 批 15 are the fifth, sixth and seventh instances — and the
first three where the wrong number was this very line.** 批 13 computed 119
against a tree where 批 14's four rows still existed; 批 14 computed 110 against
one where `responsive`, `theme` and five of `chart`'s sites still did; 批 15
computed 100 against one where 批 14's four rows were still there. Each was
correct against its own branch and all three are wrong against the merge, which
is **91** — a number no side ever wrote down. Git reported one conflicted region
here each time and would have reported none at all had the batches touched
different paragraphs. Every row from every side was kept and the arithmetic redone
from them; nothing was resolved in favour of a side.

**批 16 is the eighth instance, and the first to be caught by the header rather
than by the subtotal.** It computed 118 against a tree where 批 14's and 批 15's
rows still existed — `theme` at 14, `chart` at 7, `dashboard`/`report`/`dataset`
still open, `sharing` at 2 — and every one of those numbers was right against its
own branch. The merge is neither side's. Rows from all sides kept, arithmetic
redone from them.

批 16 moved the authorable subtotal by 14 while CLOSING exactly one site, and the
gap is the batch's finding rather than a rounding of it: `widget.zod.ts` (9) and
five of `i18n.zod.ts`'s six (`I18nObject`, `PluralRule`, `NumberFormat`,
`DateFormat`, `LocaleConfig`) left `authorable` because their `(p)` resolved
negative. The one closure is the file this map had flagged as most likely to be
deliberately open — `AriaPropsSchema` — which is worth reading twice: **the
standing warning and the measurement pointed in opposite directions**, and the
warning was not wrong so much as aimed one level off. The wide-open record it
described is real (`I18nObject.params`) and was never a site this ratchet could
close; the config block the map assumed was open alongside it turned out to be the
directory's most widely carried live shape (~30 `aria:` carriers under six
metadata-type roots), and it was returning `aria: {}` for a legacy-spelled block.

That 14-site subtotal is now 1. **#5055 answered 批 16's enforce-or-remove call
and removed 13 of the 14**, which is the largest single subtraction this ledger
has recorded and the reason the `no door` bucket reads 1 rather than 14. The one
that stayed is `FieldWidgetPropsSchema`, and it stayed for a reason the class was
never designed to express: `no door` measures whether a shape is reachable from an
authoring root, and a REACT PROPS CONTRACT is not supposed to be. Its enforcement
lives in `tsc` in the repo that implements it, and objectui acquired exactly that
consumer (PR #3289) the day before 批 16 took its measurement. So the bucket now
holds one site that must not be retired, next to twelve that were — which is why
its cells say so twice.

**批 18 is the ninth instance.** It computed 84 against a tree where 批 16's
rows still existed (`widget` still `authorable` at 9, `i18n` still 6) — right
against its own branch, wrong against the merge, which is **75**: a number
neither side wrote down. Git conflicted three regions here (header, the
`view`/`widget` row pair, and this paragraph) and every row from both sides was
kept before the arithmetic was redone from them. Worth naming because 批 16 and
批 18 moved the same two numbers for OPPOSITE reasons — 批 16 by reclassifying 14
sites it did not touch, 批 18 by closing 15 it did — and the merged subtotal is
not reachable by applying either delta to the other's base.

**批 17 is the tenth instance, and it has now hit this same line three times
inside one branch.** It first computed `47 of 100` against a tree where 批 14's
four rows (`dataset`, `dashboard`, `report`, `action`) still existed and
`sharing`/`notification` were still `authorable`; merging 批 14 made that
`36 of 91`; merging 批 16 — which closed `AriaProps` and moved `widget` (9) plus
five of `i18n` out of `authorable` — made it `21 of 90`; merging 批 18, which
CLOSED 15 of `view`'s 20, makes it **`6 of 75`**. Four right answers against four
trees, none of them the merge. Every time git merged the ROWS and conflicted only
the prose, because 批 17 changes just its own row's Class column — so the table
was right and this paragraph was wrong on every side, every time. That is ten for
ten — and #5114 made it **eleven**, from the other direction: it REOPENED one
`view` site (a live 422, see that row), computed `36 of 76` against a tree where
批 17's reclassification had not landed, and merges to `7 of 76`, a number its
branch never wrote either. A reopening moves this line exactly as a closure does. and it is why the subtotal below is recomputed from the surviving rows
rather than adjusted by anyone's delta.

**Authorable strip in `ui/`:
[see the counts file](./2026-07-unknown-key-strictness-ledger.counts.md#ui--open)**
(it was 123 of 123 when the ruling was written). The subtotal is summed from the
surviving rows' declared `Class` splits, never decremented by a batch's own
delta — eleven instances above are why that is now a generator and not a
discipline. `app.zod.ts`'s single site is held pending the finding-16 `.extend()`
check rather than counted as ready; it is counted as authorable all the same,
which is what `verify` means in the Class grammar.

**批 19 has now RUN that check, and it came back negative — but the row keeps
`verify`, and the reason is worth stating because it is not the usual one.** The
measurement is finished and unambiguous (the branches spread `...shape` rather
than `.extend()`, so nothing inherits from the base; all nine already close their
own surface; the base is module-private and never parsed — closing it is a
guaranteed no-op, and #4583 says a no-op closure is not neutral). What is NOT
settled is which `Class` word is honest for the result, and that cell is
machine-read: `no door` is what the two-axis table mechanically returns and its
prescribed follow-up — ADR-0049 retirement — would delete a vocabulary that nine
live branches carry; `no gate` inverts the same error; `authorable` publishes it
as forced scope and invites the sweep that closes it. The ledger has been here
once before, at 批 15, and the answer that time was to ADD a verdict rather than
round to the nearest wrong one. Adding a ninth changes a machine-read contract, so
it is the maintainer's call — **#5249** — and `verify` — "held pending a check" — is the one
existing value that publishes no claim about the outcome while the question is
open. It keeps the subtotal exactly where it was, which is the honest number
either way: the site is neither closed nor newly reclassified.

**The overwhelming majority of what is left in this directory is the two
no-parse classes** — the exact split is in the counts file, and the direction of
travel is what matters here: 批 18 closed 15 real doors, 批 17 measured 29 sites
as having no parse at all, #5114 reopened one. That is the single largest fact
about this directory now, and it should be read before any further `ui/`
strictness batch is scheduled — the ratchet is very nearly done here, and what
remains open is overwhelmingly work for OTHER issues:

- **`no door`** — ~~`touch`, `animation`, `dnd`, `keyboard` and `offline` from
  批 13~~ **RETIRED at #4988** (all five files deleted whole; see the destination
  note under the `ui/` triage table), and ~~`sharing.zod.ts`'s `EmbedConfig` and
  `notification.zod.ts`'s `NotificationAction` from 批 14~~ **RETIRED at #5015**
  (two shapes, both host files kept — one file, two verdicts). Still open:
  `widget.zod.ts` plus `i18n.zod.ts`'s remainder from 批 16 (#5055).
  **Seven of this class's nine entries were closed by RETIREMENT inside one
  release window, none of them by a strictness batch** — which is what `no door`
  was added to make possible. Read the two retirements' shapes as a pair, since
  they are the class's worked examples in both directions: #5015 removed two
  shapes out of two files that stay (`SharingConfigSchema` and the notification
  presentation enums are live), while #4988 removed five files entire because
  every export in them was in-family and unreachable. The question is always
  asked per SCHEMA; the file is only the answer's unit when every schema in it
  answers the same way.
- **`no gate`** — ~~`chart.zod.ts`'s remaining pair from 批 15~~ **left this
  class at #5020**, which wired the react-page publish gate to parse
  `ChartAggregateSchema` instead of re-deriving it; the pair went back to
  `authorable`, and **its strictness half landed at #5583, so the pair is now
  CLOSED** — the class's only complete round trip so far, and the evidence that
  the two-step move below is finishable rather than a way of deferring. ~~Still here: **all of
  `component.zod.ts` from 批 17**~~ — **#5068 wired that gate too, so as of it
  the class is EMPTY.** `component.zod.ts` was the campaign's largest single
  reclassification and the reason this subtotal fell by 29 without one site
  being closed; it is `authorable` again, with its strictness half still to be
  scheduled. Both departures make the same point about the class as a whole:
  leaving it is a TWO-step move, and only the first step is the carrier's own
  issue: wire the parse (the `no gate` cure), then close the posture (ordinary
  ratchet work, on its own issue). A single PR doing both would land a strict
  rejection nobody had yet seen a gate produce — which is why #5068 shipped its
  gate at WARNING level over a corpus that violates the declarations in 52
  places, and left the error upgrade to the issue that clears them.

Read the difference before acting on either: they imply OPPOSITE follow-ups
(`no door` → ADR-0049 enforce-or-remove; `no gate` → wire the parse at the
carrier). Acting on the wrong one is not merely wasteful but destructive —
retiring a `no gate` vocabulary deletes something authors use and renderers
run.

## What the three `ui/` batches measured, and why the answers differ

批 13's subtotal moved by 26 while only 4 sites were CLOSED, and the 22-site gap
was its actual finding: five files' `(p)` resolved NEGATIVE — no metadata document
is ever parsed against them, so there is no author for strictness to protect.
批 14's moved by 13 while 9 were closed, and its 2-site gap is the same class
found twice more.

That is worth reading as a method note, because 批 13 was the first time the `(p)`
came back negative on a whole run of files rather than on one. The three
`automation/` waves each resolved their `(p)` by *finding* a door the ledger's
prose had missed — 批 10's `agent.lifecycle`, 批 11's boot-time
`bootstrapDeclaredWebhooks`. That created a quiet expectation that verification
means finding the door. Run with positive controls in the same execution, the same
procedure found no door at all, five times. The correct output of a verification
step is whatever it measures, including *"this was never ratchet work"*. A batch
that had skipped the check would have shipped 22 strict schemas, a breaking
changeset, and ~58 curated alias entries no parse would ever consult.

批 14 is the counterweight that keeps that from hardening into a new expectation:
of ITS eleven sites, **nine had real, live doors**, and four of those were the
exact nested-hole shape 批 13 found on `page.components[]` — a container closed
years ago (`ActionParamSchema` since #3746, `DashboardWidgetSchema` since the
ADR-0021 cutover, `ReportSchema`, `DatasetSchema`) with strip-mode children,
because **strictness does not recurse**. An action param option carrying
`color` / `visibleWhen` / `icon` / `disabled` parsed clean through
`getMetadataTypeSchema('action')` and came back `{ label, value }`. So the two
batches together say the useful thing neither says alone: the `(p)` is a genuine
question, and both answers are common.

批 14 also produced the shape this table had not seen — **one file, two verdicts.**
`ui/sharing.zod.ts`'s row shrinks 2 → 1 rather than disappearing, because the
surviving site is deliberately-not-tightened rather than unfinished. The `Class`
column now has to separate THREE kinds of floor: `flow`/`etl`'s wire floors in
`automation/`, and now a `no door` floor. The reverse pin cannot tell any of them
from unfinished work; only this column can.

One more thing 批 14 did NOT find, recorded because the campaign's own history
makes it worth stating: the #4852 remeasure's site counts held **exactly**
(1+1+2+2+3+2 = 11, re-confirmed against the gate's own AST counter before any
edit). 批 13 proved `authorable(p)` can dissolve under measurement; the COUNTS,
since they were rebuilt on the AST at finding 19, have not.

批 15's 2 are `chart.zod.ts`'s remaining pair, and they are NOT the same verdict
wearing a different number. 批 13 established **`no door`** — no carrier key
exists, so no author can reach the shape. 批 15 needed a second one: **`no
gate`** — the carrier key exists and is LIVE (`<ObjectChart aggregate={…}>`,
published in the react-blocks contract and read by objectui's renderer to run
the query), but no `.parse()` stands between the author and the runtime. The
distinction is not pedantry, because the two imply OPPOSITE follow-ups: a
`no door` shape is a candidate for ADR-0049 REMOVAL, while a `no gate` shape is
a candidate for WIRING THE GATE — removing it would break a working feature, and
closing it would validate nothing. Collapsing the two would have pointed the next
batch at exactly the wrong action on both.

The one `open` site this directory carried is **gone, and not by being closed**:
`bulk-action.zod.ts`'s `BulkActionParamSchema.options` was the row that read
*"the triage row calls this and its parent deliberately open, but only the PARENT
is `passthrough`"*. The 2026-08-03 ruling settled the intent as **open** and the
fix was to make the code say so — `.passthrough()` on the option item, so the
posture and the prose agree. It leaves this map the way a resolved row is
supposed to: the file now has **0** strip sites, so its row is deleted (the
reverse pin above). Worth noting for the next batch that "resolve a row" has two
exits, and the reverse pin cannot tell them apart — only the changeset and the
triage row record which one was taken.

#### `data/` — remaining strip sites

| File | Class | Batch |
|---|---|---|
| `data-engine.zod.ts` | wire | **out of scope** — engine request/response contracts |
| `seed-loader.zod.ts` | wire | **out of forced scope — re-verdicted from `mixed (p)` at #4001 batch D.** The old split's "authored" third (`SeedLoaderConfig` / `SeedIdentity` / `ReferenceResolution`) did not survive its own measurement: `ReferenceResolution` is BUILT by the loader from field metadata (`buildDependencyGraph` — nothing else in the tree constructs one), `SeedIdentity` is server-constructed by declaration, and every `SeedLoaderConfig` producer is a framework code literal (seven parse sites enumerated in the triage row; no authoring surface writes any of these keys). The authored half of seeding is `SeedSchema` — already strict, and it is the `seeds[]` VALUE inside the request, so author typos in seed files are rejected TODAY through the nested strict parse. Internal service contract; stays tolerant like `data-engine.zod.ts` |
| `filter.zod.ts` | open | **out of scope** — query dialect; user data flows through, validated semantically elsewhere |
| `driver-nosql.zod.ts` | wire | **out of scope** |
| `driver.zod.ts` | wire | **out of scope** — driver capability contract |
| `document.zod.ts` | wire (p) | `DocumentTemplate` / `ESignatureConfig` read authorable on their face — the `(p)` is unresolved, verify before scheduling either way |
| `query.zod.ts` | open | ~~⚠️ classification conflict — see #4721~~ **RESOLVED (11:41Z ruling, closed by #4721).** The conflict was real and the answer was that per-FILE classification was the imprecise instrument: `SortNodeSchema` was carved out as `authorable` and closed (`strictObject` + `aliases: { direction: 'order' }`), the other 4 sites keep `open`. Those 4 are the dialect proper — `BaseQuerySchema`, `AggregationNodeSchema`, `FullTextSearchSchema`, `GroupByNodeSchema`'s object arm — and `BaseQuerySchema`'s own top-level strictness is #4001's to schedule, deliberately **not** taken by #4721 |
| `external-catalog.zod.ts` | wire (p) | **out of scope** |
| `hook.zod.ts` | wire | **out of scope** — `HookContextSchema` + `.session`/`.provenance`/`.user` are the runtime shape handed to a handler; verified in the data step |
| `field.zod.ts` | no door | ⛔ **not strictness work — re-verdicted 2026-08-13 (#4001 data batch).** This row's own instruction was "check whether they are record data (→ open) before closing", and the measured answer is the THIRD one: neither authorable nor open. Both remaining strip sites (`LocationCoordinatesSchema`, `CurrencyValueSchema`) are `@deprecated` DEAD EXPORTS that contradict the enforced value contract — `currency` stores a BARE NUMBER everywhere (validator, SQL driver `float` column, import coercion, field-zoo oracle), `location` stores `{lat, lng}` not `{latitude, longitude}`. Carrier: absent — no schema in the tree references either, so unreachability from every authoring root holds by construction and no BFS is needed (the only non-test references are two `type-alias-convention.pin.test.ts` rows). Parse: absent outside their own `field.test.ts` cases. Consumers' vocabulary: absent — zero references in objectui; `field-value.test.ts` pins from the other direction that the enforced contract REJECTS the retired `CurrencyValueSchema` object shape. The ADR-0049 answer this class prescribes already exists: ADR-0104's "Reality wins" section decides both removals ("an exported-but-unconsumed value schema is exactly the inert metadata ADR-0078 forbids"), the JSDoc deprecations are on `main` with "Removal rides the next spec major", and the removal is tracked at **#8562** — this row points there, never at a batch. Closing them instead would be #4583's precisely-validated dead slot, and worse than most instances of it: a `strictObject` `surface` name plus did-you-mean suggestions on a shape authors must NOT use is an invitation dressed as enforcement, on the exact spelling (`{value, currency}` / `{latitude, longitude}`) the real contract rejects. The third named shape the old row carried, `Address`, was never this file's site — `AddressSchema` is DECLARED in `field-value.zod.ts` since #7127 and only re-exported here |
| `driver-sql.zod.ts` | wire | **out of scope** |
| `field-value.zod.ts` | open | **out of forced scope — re-verdicted from `mixed (p)` at #4001 batch D**, confirming this row's own prediction by measurement rather than reading: `LocationValueSchema` / `AddressSchema` are record-data VALUE contracts (ADR-0104), validation-only at every consumer, whose extras are legitimate stored data (device `heading`/`speed`, geocoder `district`). Enforcement posture belongs to ADR-0104's evidence-gated rollout, not this ratchet — see the triage row for the full read, including the one authored door (`defaultValue` literals) recorded as a caveat |

**Authorable strip in `data/`:**
[the counts file](./2026-07-unknown-key-strictness-ledger.counts.md#data--open) splits this
directory three ways, and the first two buckets are now **empty**: `object` was the one
**firm** authorable row left, its single site deliberately HELD on #5247 — **that hold
was spent by objectui#4772 and the site closed 2026-08-16 (14 of 14; the row left the
map at zero — see the triage row and the 批 20 prose below)**; `field` LEFT the authorable bucket
on 2026-08-13, re-verdicted `no door` on the per-schema read its row had been asking
for (both sites are ADR-0104-deprecated dead exports, removal tracked at #8562 — see
the row); and **#4001 batch D (2026-08-14) discharged the last three `mixed (p)` rows
with the per-schema read they were carrying the `(p)` for**: `analytics` resolved
authorable on both halves and was CLOSED (8 sites strict — its row leaves this map the
way `driver/memory.zod.ts`'s did, by reaching zero), `seed-loader` re-verdicted `wire`
(12 sites — the "authored" half of the old provisional split did not survive producer
enumeration), and `field-value` re-verdicted `open` (2 sites — ADR-0104 record-data
value contracts). (`external-lookup` carried `mixed (p)` too
until #8075 retired the whole file under ADR-0049 — its per-schema read arrived as a
zero-consumer verdict, and the strictness question died with the shapes.) The rest is wire/open and out of the
ruling's forced scope; that count fell by one when #4721 closed `query.zod.ts`'s
`SortNodeSchema`, the one row in this directory where the per-schema read moved a site OUT
of `open` rather than confirming it, and by one more when **#4001 batch B** closed
`driver/memory.zod.ts`'s remaining 5 sites (the persistence-adapter union under
`datasource.config` — `PersistenceAdapterSchema`, `FilePersistenceConfigSchema`,
`LocalStoragePersistenceConfigSchema`, `CustomPersistenceConfigSchema`,
`AutoPersistenceConfigSchema`), dropping its row from the remaining-strip map entirely: the
file's 6th site, `MemoryConfigSchema`, was already `strictObject` since #4410.

**批 20 closed 13 of `object.zod.ts`'s 14 and parked the row at 1**, which made it
the fourth row in this ledger to shrink without disappearing — after `flow` (批 11),
`etl` (批 12) and `sharing`/`i18n` (批 14/16) — and the first to do so on a
`no gate`-shaped reason inside a directory whose other floors are all wire. The
reverse pin cannot see the difference: it fires when a file reaches ZERO, so it
proves a row's work is *done* and is completely silent about a row whose work is
*deliberately partial*. To the gate, "finished, the last site is held on measured
evidence" and "nobody got to it" are the same row, and only the `Class` column and
this prose separate them. The held site was `IndexSchema`, held because objectui's
`FALLBACK_SCHEMAS.index` had drifted (offering `where` for the partial predicate
and `brin` in the algorithm enum) and the editor PUT the whole object through
`saveMetaItem` — closing the shape would have 422'd a control the console itself
rendered, the #5114 class caught before shipping. The hold was gated on the
objectui rename (#5247) and an ADR-0049 answer for `type`/`partial` (#5248,
answered remove at PR #5842 with `retiredKey` tombstones + the protocol-17
migration). **The hold's evidence was spent by objectui#4772** (the editor now
offers exactly `name`/`fields`/`unique`, converged to the schema), **and the site
closed 2026-08-16 — the row LEFT this map by reaching zero, 14 of 14.** The close
carries a curated `where` guidance entry (the database-layer prescription;
deliberately not a rename onto the retired `partial` tombstone, which would be
finding 7), and §4 of `object-strictness-batch20.test.ts` — which pinned the strip
precisely so the day it changed, it changed deliberately — flipped in the same
change to pin the closed posture, including that both tombstones still answer
their own migration prescriptions rather than a generic `unrecognized_keys`.
Semantic entry `object-index-unknown-keys-refused` (protocol 18).

**The #5107 split got its first merge-QUEUE test here, and passed silently**, which
is the outcome worth recording precisely because there is nothing to see. 批 20 was
evicted from the merge queue with `MERGE_CONFLICT` after #5237 (#5073's
`allowAddTab`) landed — two batches touching this ledger from two different
directories. Under the old single-file layout that is exactly the shape that merged
**clean and wrong** eleven times: 批 20's branch had written `authorable = 16`,
#5237's had written its own decrement, the prose rows do not overlap so git merges
them cleanly, and the subtotal — conflicting with nothing — would have landed as one
side's number. What actually happened: the prose merged with no conflict at all,
`merge=os-regen` recorded `counts.md` as pending instead of text-merging it, and
`pre-commit` refused to commit until it was regenerated from the merged tree. The
recomputed answer is **15** (`ui/` 7 → 6 from #5237, `data/` 22 → 9 from 批 20) — a
number neither branch ever wrote down, arrived at without anyone having to notice
that it should be recomputed. That is the whole design: the twelfth instance is the
first that cost nobody anything.

Worth naming for whoever schedules the next `data/` batch: 批 20 is the first
batch in this campaign to catch a #5114-class defect **before** shipping it rather
than after. #5114 was found on `main`, live, because a wave closed
`ViewFilterRuleSchema` without measuring who else writes that shape. The
difference in method was small and entirely mechanical — grep the sibling repos
for producers of every block in scope, then follow the ones that PUT back through
`saveMetaItem` — and it is cheap enough that it should simply be part of the
per-site discipline rather than a lesson. The producer it found is not even in
this repo, which is the part a spec-only reading cannot reach.

#### `security/` — remaining strip sites

| File | Class | Batch |
|---|---|---|
| `explain.zod.ts` | wire | **out of scope** — permission-explain responses; the triage row already says "never strict" |
| `rls.zod.ts` | wire | **out of scope** — `RLSUserContext` / `RLSEvaluationResult` are runtime shapes; the POLICY shape is closed |

**Authorable strip in `security/`: 0. This directory is DONE.**

`studio/` has **no open sites** and so has no table here — batch 7 landed, and this
is the confirmation the campaign's own progress log was missing. The counts file still
carries a section for it, deliberately: an empty section is a measured zero, while a
missing one is indistinguishable from a directory nobody walked.

## Other directories (coarse; classify per schema before touching)

Site totals are
[in the counts file](./2026-07-unknown-key-strictness-ledger.counts.md#other-directories-untriaged).
These directories were never gated — the numbers here were hand-copied and
ungated, which is the same failure one level coarser, so they moved with the
rest at #5107.

| Dir | Dominant class | Rationale |
|---|---|---|
| `api/` | **mixed · `endpoint.zod.ts` authorable, the rest wire** | ⚠️ **Split at #5384 — and the flat `wire` verdict this row used to carry was correct when written and then silently expired, which is the finding.** The rest of the directory is unchanged: REST/GraphQL request/response contracts, tolerant by design. But `endpoint.zod.ts` stopped being one of them at **#5312**, which registered `api` as a metadata type (`DEFAULT_METADATA_TYPE_REGISTRY` / `BUILTIN_METADATA_TYPE_SCHEMAS`) — from that moment `ApiEndpointSchema` was simultaneously an AUTHORING surface (`defineStack({ apis })`, the Studio metadata-admin form, `PUT /meta/api/:name`'s 422) and a wire shape, while this row still told every reader the whole directory was "tolerant by design". A row is read as licence, which is exactly what this ledger's own gate exists to prevent. `ApiEndpointSchema` is now `strictObject` (#5384): an undeclared key on an endpoint is a named rejection carrying the surface, the offending key and a rename, instead of a silent strip that let a `cacheTTL` / `objectParam` / `outputMappings` typo publish green and serve without the policy or projection its author wrote. Two curated wrong-layer pointers ship with it: **`namespace`** (ADR-0121 D2 — the namespace segment of `path` is derived from `manifest.namespace` and has never been per-endpoint; `publish-endpoint-gate.test.ts` pins that the gate does not believe it) and the six **stored-envelope bookkeeping** keys (`packageId`, `state`, `version`, `published*`). ⚠️ **The order is the part worth keeping.** Closing this shape was measured and REFUSED first (2026-08-05, maintainer): the same schema parsed STORED rows at `buildEndpointIndex` and `gateApiItemsForPublish`, so a naked `strictObject` failed every row with `unrecognized_keys: ['packageId', 'state']` — the load-time backstop excluded the endpoint (404) and the publish gate reported a schema error in place of the ADR-0121 D6 verdict it exists to give, 11 tests red in `packages/metadata`. The debt was real and it was NOT in this vocabulary, so it was paid at the layer that owned it: **#5309 (PR #6576)** peeled the envelope off before the body parse (`peelStoredEnvelope`), after which a strict probe left exactly ONE red — a fixture planting an authored `namespace`, re-spelled by #5384 rather than deleted. Teaching `ApiEndpointSchema` two bookkeeping keys to buy strictness would have made the authoring contract describe the storage layer; that trade was refused and did not have to be made. `api` left `STILL_STRIP` (`kernel/metadata-type-schemas.test.ts`) with this change — closed registered types 24 → 25 of 26 — and the CLI gate row moved from `NOT_YET_CLOSED` into `GATED_AT` (`packages/cli/test/metadata-type-schema-gate.test.ts`), the deliberate ratchet step that file's own note asked for. `view` is now the only entry left on `STILL_STRIP` |
| `system/` | mixed | manifest/datasource blocks are authored; runtime envelopes are wire |
| `kernel/` | wire | plugin/kernel contracts, code-to-code |
| `cloud/` | wire | multi-tenant runtime |
| `ai/` | mixed | agent/tool/skill definitions authored (partially strict already); model/provider payloads wire |
| `integration/` | wire | connector payloads — upstream adds fields freely |
| `identity/` | mixed | position/user shapes authored (`PositionSchema` **strict as of #4001 step 2**, with the ADR-0010 envelope declared); auth payloads wire. **34 → 33 in #4641**: `identity.zod.ts` lost its `SessionSchema` site — a second, importerless declaration of a name `api/auth.zod.ts` already owned (the #4411 dual-source trap), deleted rather than reclassified |
| `shared/` | n/a | utilities and building blocks; strictness decided at the consuming schema |
| `qa/` | n/a | test fixtures |

## Next steps (verify-then-enforce, one shape at a time)

1. ~~Let the warning layer run in the wild for a release, then schedule the v18
   strict close-out on what it actually reports.~~ **ANSWERED — the wait was
   discharged by a decision, not by data.** Recording it here as this step asks.

   The question below was never answered because it could not be: this is a
   pre-1.0 product with no third-party authors to report from, so "wait for
   field data" was waiting for a signal that would never arrive — the third
   outcome in the list, and the one it warns is indistinguishable from success.

   The call was to proceed anyway, on the grounds that a breaking change is
   acceptable when the upgrade is mechanical and documented: every rejection
   carries its own prescription, so an AI reading the error has the migration in
   front of it. That is a stronger position than the wait assumed, and it is
   *why* the tombstone/guidance discipline in the Standard wiring is not
   optional decoration — it is the thing that made shipping without field data
   defensible.

   What the wait was meant to buy — evidence that closing shapes does not break
   real metadata — arrived from a different instrument instead: every batch was
   verified against the dogfood apps (`examples/app-crm`, `app-todo`,
   `app-showcase`, `platform-objects`), which parse their metadata at build. The
   answer that mattered turned out to be reachable without waiting.

   The original decision point is left below, struck through rather than
   deleted: the reasoning is still correct for a product that *does* have field
   reporting, and the third outcome is still the one to check for.

   **This wait has a decision point, deliberately.** "Wait for field data" with
   no way to tell when it has arrived is how a ratchet stops without anyone
   choosing to stop it — and this file would go on describing an in-flight
   campaign either way. So the wait is discharged by an answerable question, not
   by a date: *has `lintUnknownAuthoringKeys` reported an unknown key on any
   surface outside this repo yet?* Three outcomes, each with a next action:
   - **Findings exist** → they are the close-out worklist. Tighten the shapes
     they name first; that is the evidence the whole layer was built to produce.
   - **Zero findings, and the layer is reaching real authors** → the tail is
     cheaper than feared and the remaining directories can be batched by class
     rather than one shape at a time.
   - **Zero findings because nothing is reporting back** → then the layer is not
     instrumented, and *that* is the next task, not more strictness. This is the
     outcome to actually check for: it is indistinguishable from success at a
     glance, which is this campaign's own subject matter.

   Whoever reads this next: answer the question and record the answer here, even
   if the answer is "still nothing". A wait that is never re-examined is
   indistinguishable from an abandoned one.

2. ~~`studio/` is the largest untouched authorable block — 27 sites, **0
   strict**, and all three files still carry a provisional `(p)`.~~ **DONE
   (#4001).** All 27 sites strict; the three provisional verdicts verified, and
   `plugin.zod.ts`'s `mixed (p)` corrected to `authorable` — see the `studio/`
   table above for the evidence and for the one thing this checkout could not
   settle.

   Worth noting how the verdicts were settled, because the original triage had
   no method for it: each file exports a `define*` factory that parses an
   author-written literal. **A `define*` factory is the authoring door** — the
   same lens the registered-type batches used, and a cheaper one than reasoning
   about who consumes the output. When a future triage row needs promoting out
   of `(p)`, look for the factory first.

3. **The 2026-08-03 ruling: close the remaining authorable surface inside the
   v17 window** (wire/open shapes stay out of forced scope, decided by the
   classification rule at the top of this file). The worklist is the
   **remaining-strip map** above, which is measured and gated rather than
   estimated — read it, do not re-derive it, and do not plan off `strictObject(`
   occurrence counts (finding 19 explains what that undercounts).

   Two things in that map needed a decision before any code was written, and
   both were classification questions rather than implementation ones. The first
   is now settled:

   - ~~**`data/query.zod.ts` is classed `open`, and #4721 asks for
     `SortNodeSchema.strict()`.**~~ **SETTLED (2026-08-03 11:41Z ruling; closed
     by #4721.)** Measured, so the decision was made against facts rather than
     recollection: `SortNodeSchema.parse({ field, direction: 'desc' })` returns
     `{ field, order: 'asc' }` — the wrong rows, with no signal — while #4721's
     premise that the top level already rejects unknown option keys turned out
     to be about a **different mechanism** and, on re-measurement, not even true
     of the schema: #4371's check is a hand-written allowlist in
     `objectql/src/engine.ts` (`rejectUnknownEngineOptions`) that iterates
     `Object.entries(bag)` at the top level only, and `QuerySchema` itself is not
     strict (`QuerySchema.safeParse({object:'sales', nonsenseKey:1}).success ===
     true`). That is finding 17 exactly — a bespoke guard at one door — so "same
     invariant, one level down" was **not** available as a justification, and the
     ruling does not use it: closing the sort node is a **new** door.

     **The answer was that the FILE was the wrong unit.** `open` was awarded to
     the query dialect because user data flows through predicate values;
     `SortNodeSchema` is a closed two-key tuple with no user-data face, so it was
     re-classed `authorable` and closed while the other four sites kept `open`.
     The generalisable part: when a blanket per-file class collides with a
     per-schema finding, **suspect the blanket first** — this ledger classifies
     sites, and a file is only a convenient bag of them. Both doors were closed
     in the same change (`SortNodeSchema` + `normalizeSortNodes` in
     `metadata-protocol`), per finding 6's asymmetry.

   - ~~**`ui/app.zod.ts`'s `BaseNavItemSchema`** is the base that the strict
     discriminated-union members `.extend()`. Finding 16 is the warning: closing
     a base closes every extension of it, including any that is deliberately a
     wire shape.~~ **SETTLED at #5249 (maintainer ruling 2026-08-06, option A) —
     and the bullet's own premise was wrong**, which is why it is struck rather
     than deleted. The members do **not** `.extend()` this base, they spread
     `...BaseNavItemSchema.shape`, and that is the whole of finding 16: a spread
     lands the keys in a fresh `z.object` whose posture is its own, so the base
     is inert and closing it is a guaranteed no-op. The row got the ninth
     verdict, `covered`, rather than being rounded onto `no door`, whose
     prescribed ADR-0049 retirement would have deleted nine branches' shared
     keys. Evidence and the mechanical spread-vs-extend test are in the
     `app.zod.ts` row of the `ui/` remaining-strip map above.

Done in the registered-types batch: `strictObject` (`shared/strict-object.ts`)
replaced the four-part wiring recipe, and `seed` + `doc` became the first two
conversions built on it — chosen by the registered-type lens above rather than
by directory, so both are provably parsed as well as provably authored. Both
also had to declare the ADR-0010 envelope, and the invariant test written in the
same pass found `hook` and `datasource` rejecting it outright on `main`
(findings log, entry 8). The ledger's site-counting method grew `strictObject(`
in the same change, because the gate failed on the first conversion when it did
not.

Deferred from that batch: `validation` — a `z.lazy()` discriminated union whose
variants `.extend()` a shared base, so each variant needs its own key set rather
than one `strictObject` call. It still carries the envelope gap.

Done in step 2: `security/rls.zod.ts` + `security/sharing.zod.ts` strict;
`PositionSchema` strict with the protection envelope declared (closing the
known sibling gap below).

Done in step 3: `automation/approval.zod.ts` — the four approval authoring
schemas, with the ADR-0019 re-home map as wrong-layer guidance
(`steps` / `entryCriteria` / `onApprove` / `onReject` / `rejectionBehavior`
each point at where the concept lives on the flow graph now).

Done in the app step, PR B: `AppSchema` + the navigation tree strict, via a
discriminated union — the union-error concern that deferred this step was
resolved by measurement, not design work.

Done in the app step, PR A: the seven audit-dead AppSchema keys tombstoned
(`retiredKey` + `app-dead-authoring-keys-removed` conversion + step-17
migration entry), clearing the enforce-or-remove precondition for the app
strict step (PR B).

Done in the data step: `data/hook.zod.ts` + `data/hook-body.zod.ts` +
`data/datasource.zod.ts` — the last two entries that carried a provisional
`(p)` classification. Verification changed the answer for one of them: the
blanket `authorable (p)` on `hook.zod.ts` was too wide, because
`HookContextSchema` in the same file is a runtime shape and stays tolerant.
Both types were confirmed authorable the same way — they sit in
`BUILTIN_METADATA_TYPE_SCHEMAS`, so one shape backs `defineStack()` parsing,
`/api/v1/meta/types/:type`, and the Studio form.

Measured while doing it, and worth recording because it contradicts the
assumption the earlier steps were written under: **strictness does not change
the published JSON Schema.** `build-schemas.ts` converts with the default
`io: 'output'`, and in output mode zod emits `additionalProperties: false` for
a `.strip()` object too — the post-parse shape genuinely has no extra keys.
Verified by regenerating both ways: `Datasource.json` is byte-identical before
and after. So the JSON Schema had been advertising `additionalProperties: false`
while the zod parse quietly accepted and dropped unknown keys. These flips align
the parse with the contract that was already published, rather than widening it.
(Note this cuts against the `approval.zod.ts` note above, which reads as though
the flip carried strictness INTO the JSON schema. It did not; approval's schema
would have said `false` regardless. The registration-time rejection it describes
is real, but it came from the published schema, not from the flip.)

## The warning layer (was "next step 1" — it already existed)

The `@objectstack/lint` unknown-key WARNING layer this list carried as a pending
next step **had already been built** by the time the data step landed: #3786's
`lintUnknownAuthoringKeys` plus #4167's `lintUnknownStackKeys`, exported from
`@objectstack/spec` and wired into `defineStack()`, `os validate` and
`os compile` as non-blocking warnings. Anyone reading this file for what to do
next was being sent to build something that shipped releases ago.

What was genuinely missing was **depth**, not existence. The walk covered each
metadata item's top level plus one hard-coded descent into `object.fields`,
which left 227 strip-mode objects nested below those roots reporting nothing —
concentrated exactly where authoring volume is: `object` 71, `view` 49,
`page` 24, `dashboard` 18, `agent` 16, `mapping` 14. Those sites were both
silently eating keys AND contributing nothing to the evidence base the v18
close-out is supposed to be scheduled on.

The walk now descends the authored value alongside its schema through nested
objects, arrays and records, applying the same posture rules (`strict` and
`passthrough` stay silent; only `strip` reports). Unions descend only when the
authored value picks a branch unambiguously — guessing would invent findings
against a shape nobody wrote. `object.fields` keeps reporting as `field` with
its curated guidance, now via an explicit override table rather than a special
case, so its own nested sites (`fields.*.options[]`, …) are covered too.

Audited after the change, since "our own assets are clean" has been wrong
before: 43 platform objects + 3 apps + 1 dashboard + 3 pages, and both example
apps (23 + 6 objects, 20 + 1 pages, 4 + 1 datasets, 3 + 1 dashboards) report
**zero** unknown keys. No finding this time — worth recording precisely because
the app step's `ACCOUNT_APP.defaultOpen` came from exactly this class of check.

## Campaign closing record — the terminal re-measure (2026-08-16)

This section is the **terminal state** of the #4001 campaign: the census re-run
on the final tree, the confirmation of the three closing claims, the one entry
left deliberately open, and what holds the posture once no batch is scheduled.

Read it as the answer to *"is there authorable work left in this ledger?"* — no.
Read it as *"is this ledger finished?"* — also no, and deliberately: the
remaining-strip map still carries **22 file rows covering 123 strip sites, 122
of them non-authorable**, and they are kept so the arithmetic is complete and so
nobody re-triages them from scratch. The **forced scope** of the 2026-08-03
ruling is what closed.

### The measurement, and why the start column had to be re-taken

**The campaign's opening numbers and its closing numbers were never comparable,
because the instrument changed underneath them.** #4001's opening post recorded
`.strict()=31 / .passthrough()=20 / 默认 strip=1885` — taken with the **textual**
method, which `scripts/lib/strictness-ledger.ts` later documented as wrong in
both directions at once (it counted `z.object(` inside JSDoc prose, and missed
the prettier-wrapped `z\n.object(` call). Comparing that triple against today's
AST reading would publish an instrument change as a campaign result, which is
this file's own subject matter.

So the terminal re-measure runs **today's AST instrument over the campaign's
start tree as well** — `d6bfb3d0a`, `main`'s tip when #4001 was filed
(2026-07-30) — and both columns below come from that one instrument.

What that alone shows, before any campaign work is counted: on the start tree
the AST reads **15 strict / 20 passthrough / 2 catchall / 1903 strip over 1940
sites**, where the opening post recorded 31 / 20 / 1885. The headline "31
strict" was an over-read of **16**, and the opening post's per-directory table
(a strip-count table) under-read `ui/` 177→183, `data/` 149→157, `system/`
383→389, `ai/` 72→74, `automation/` 80→81. The consequence worth recording:
the campaign's forced scope was scoped in that post as **"≈453 authorable
sites"**, and the AST says the five directories held **484**. The plan was
drawn against a number that was never measured — the estimate was low by 31
sites, which is more than the whole of `studio/`.

### Start → final, the five triaged directories (one instrument)

| | Sites | strict | passthrough | catchall | **strip** |
|---|---|---|---|---|---|
| **start** (`d6bfb3d0a`, 2026-07-30) | 484 | 12 | 4 | 0 | **468** |
| **final** (2026-08-16) | 439 | 310 | 6 | 0 | **123** |

Per directory:

| Dir | Sites start → final | strict start → final | **strip start → final** |
|---|---|---|---|
| `ui/` | 193 → 174 | 7 → 163 | **183 → 6** |
| `data/` | 163 → 153 | 5 → 71 | **157 → 81** |
| `automation/` | 81 → 65 | 0 → 42 | **81 → 23** |
| `security/` | 20 → 20 | 0 → 7 | **20 → 13** |
| `studio/` | 27 → 27 | 0 → 27 | **27 → 0** |

**Read the site totals, not only the strip column.** The five directories LOST
45 sites over the campaign — surface that was retired under ADR-0049 rather than
closed, because a batch's per-schema read kept coming back "nobody writes this"
(`no door`) or "nothing parses it". `strip 468 → 123` is therefore two movements
summed, and the ledger's rows say which is which per file. That is the campaign's
least-expected result: **the single most common outcome of reading a shape
carefully was not tightening it.**

Whole-spec context (fourteen directories, out of the ruling's forced scope, same
instrument): 1940 → 1722 sites, strict 15 → 361, strip 1903 → 1338. The untriaged
directories are coarse-classified in the section above and are not this campaign's
debt; `api/`, `system/`, `kernel/` and `cloud/` are wire surface by construction.

### The three closing claims, confirmed

1. **Global authorable strip = exactly 1.** The generated bucket split reads
   `authorable 1 · unresolved 0 · wire/open 118 · no door 3 · no gate 0 ·
   covered 1` — 123. Only `ui/` contributes to the authorable bucket; `data/`,
   `automation/`, `security/` and `studio/` all read 0. The single site is
   `ui/view.zod.ts`'s `FormFieldBaseSchema`, and the other five `ui/` strip
   sites resolve elsewhere, per their rows:

   | Site (line as of this record) | Schema | Class |
   |---|---|---|
   | `view.zod.ts:1888` | `FormFieldBaseSchema` | **authorable — the one parked entry** |
   | `view.zod.ts:3011` / `:3015` | `ViewItemWireSchema` (both arms) | wire by design (#5074's authoring/wire split) |
   | `app.zod.ts:295` | `BaseNavItemSchema` | covered (#5249) |
   | `widget.zod.ts:89` | `FieldWidgetPropsSchema` | no door (#5055) |
   | `action-params.zod.ts:321` | `ActionSessionSchema` | wire (#5697) |

2. **`data/`'s forced scope is discharged.** The directory's authorable bucket
   is 0. Its 81 remaining strip sites are all wire/open/no-door, each with a row
   and a per-schema verdict; the last three `mixed (p)` rows were discharged at
   batch D and the last firm authorable site (`IndexSchema`) closed at 批 20
   site 14.

3. **`data/object.zod.ts` is closed.** 批 20's unit was the file's **14 inner
   blocks — 13 at 批 20 and the held 14th (`IndexSchema`) on 2026-08-16**; the
   AST unit is the file's **20 object sites, all 20 strict, 0 strip**. Both
   readings are in this record because the two counts are different units of the
   same fact, and a future reader comparing "14/14" against a generated "20"
   should not have to re-derive that.

### The batches

The campaign did not advance as one sweep and its waves are not a tidy numbered
run — they are named for the surface each took, and the **evidence for every one
of them is in the rows above, not here**. This list exists so the roll-call is
readable in one place:

- the **Tier-A slice** (`security/permission.zod.ts`, `automation/flow.zod.ts`,
  `ui/action.zod.ts` re-homed onto the shared factory), the **registered-types
  batch** (`strictObject` itself, `seed` + `doc`), then the **security**,
  **app** (PR A tombstones, PR B strict) and **data** steps;
- the `automation/` waves — 批 9 through 批 12 — each resolving a `(p)` by
  finding a door the prose had missed;
- the `ui/` waves — 批 13 through 批 19 — which produced the campaign's
  vocabulary as much as its closures: `no door` (批 13), `no gate` (批 15),
  the per-schema split (批 14), the largest single reclassification
  (`component.zod.ts`, 批 17), the authoring/wire split (#5074), and `covered`
  (#5249, ruled at 批 19's request rather than guessed);
- the `data/` waves — batch A, batch B, batch D and 批 20 — ending with
  `object.zod.ts` site 14 once its cross-repo hold (#5247 → objectui#4772) was
  spent.

**The method that survived all of them**: verify who writes the input *before*
tightening, per schema and never per file, with a positive control in the same
run. It changed the verdict often enough that it, and not the closure count, is
what this campaign should be remembered for.

### The one parked entry — `ui/view.zod.ts`'s `FormFieldBaseSchema`

**Standing rationale.** It is a module-private base (`const`, not exported) with
zero `.parse()` of its own. Its sole consumer is the door:
`FormFieldSchema = FormFieldBaseSchema.extend({ fields }).strict().transform(…)`
— so an undeclared form-field key is already **rejected**, with the ADR-0089
visibility error map (`VISIBILITY_STRICT_OPTIONS` + `strictObjectError` since
#6619) carrying the prescription. Closing the base changes no parse.

**Why it is `authorable` and not `covered`.** The two verdicts are separated by
one mechanical test, not by a judgement (#5249): `covered` requires the keys to
reach consumers by a `...X.shape` **spread**, which lands them in a fresh
`z.object` with its own posture and makes the base inert. This consumer uses
`.extend()`, which **inherits** posture — so the base is a real door whose
posture simply happens to be overridden downstream. Calling it `covered` would
be recording the wrong mechanism, and the mechanism is what the next reader acts
on.

**Why it still counts as a strip site.** The site deliberately keeps its literal
`z.object(` spelling so this instrument keeps counting it. A conversion would
remove it from the map, and the map is what makes the parked state visible.

**Restart condition — and it is mechanically gated, not remembered.** This entry
becomes real work the moment either holds:

- **the consumer stops applying its own `.strict()`** (relying on inheritance
  from a strip base would open the door silently), or
- **a second consumer of the base appears** that does not close its own clone.

The first is pinned: `view-strictness-batch18.test.ts`'s
*"`FormFieldBaseSchema` stays a bare `z.object`: its ONE consumer already
`.strict()`s it"* asserts through the real door (`FormViewSchema`) that an
undeclared field key is refused, and goes red if the `.strict()` is dropped. The
sibling case pins that the ADR-0089 visibility pair still resolves through its
own error map — the reason the base was not converted in the first place.
`check:strictness-ledger` holds the second half: the site cannot leave the map
quietly, and its row cannot be deleted while it is strip.

### What now enforces the posture, with no batch scheduled

The campaign ends without a standing worklist, so the posture has to be held by
mechanism. Four, and each has been shown to go red:

1. **The strictness-ledger gate** (`check:strictness-ledger`, wired into the
   Spec Liveness Check workflow) — the generated counts must be byte-fresh
   against the AST, every sited file in a triaged directory must have a row, and
   every `Class` cell must parse. A new `*.zod.ts` in `ui/` / `data/` /
   `automation/` / `security/` / `studio/` is **undeclared surface** and fails
   the gate until someone classifies it. This is what makes the closing state
   above a ratchet rather than a snapshot.
2. **The reverse pin at zero** — a remaining-strip row whose file reaches zero
   strip sites **fails**. A worklist that can outlive its work will, and this
   ledger has the scar; it is why `object.zod.ts`, `analytics.zod.ts` and
   `driver/memory.zod.ts` are absent from the map above rather than sitting in
   it at 0.
3. **The strict-template idiom** — `strictObject` (`shared/strict-object.ts`)
   is one call, reads its key list from the shape at the call site, and carries
   `surface` / `history` / `aliases` / `guidance`. The four-part hand-wiring it
   replaced is what made each closure expensive enough to defer; the next
   authorable schema is closed by writing `strictObject` instead of `z.object`,
   which is the campaign's durable output.
4. **The unknown-key warning layer** — `lintUnknownAuthoringKeys` /
   `lintUnknownStackKeys`, wired into `defineStack()`, `os validate` and
   `os compile`, descending nested objects/arrays/records with the same posture
   rules. It reports what the ratchet has not reached, which is how a
   still-strip authorable site would announce itself between campaigns.

**The standing question in "Next steps" §1 is answered, as that step asks.** It
was *"has `lintUnknownAuthoringKeys` reported an unknown key on any surface
outside this repo yet?"*, with the honest third outcome flagged as the one to
check for: *zero findings because nothing is reporting back*. That is still the
answer — this remains a pre-1.0 product with no third-party authors, so no
outside-repo report exists, and none is pending. The wait was discharged by the
maintainer's decision to proceed on mechanical, self-prescribing rejections
rather than by data arriving, and the campaign closed on that basis. **Recording
"still nothing" is the point**: a wait nobody re-examines is indistinguishable
from an abandoned one.

### What this record does NOT close

- **The anchor issue.** Closing #4001 is a maintainer/PM decision taken after
  this record lands, not by it — #8687 carries a `Blocked-by:` on the anchor and
  needs re-pricing at closure time. #8687's gate is strict propagation at the
  **top-level stack surface** (`ObjectStackDefinitionSchema`'s 43 keys), which
  no slice of this campaign delivered.
- **The 122 non-authorable strip sites**, in the map's 22 file rows (the
  `view.zod.ts` row is the one that spans both, `1 authorable, 2 wire`). Wire,
  open, `no door` and `covered` rows stay in the map by design. The `no door`
  ones carry the only follow-up in the set, and it is a different ratchet:
  ADR-0049 removal, tracked at #8562 for `field.zod.ts`'s two.
- **The nine untriaged directories.** They were never in the ruling's forced
  scope and are classified coarsely; a future campaign that wants them starts by
  giving them per-file rows, at which point this gate begins holding them too.

## This file is now machine-checked

`pnpm --filter @objectstack/spec check:strictness-ledger` (wired into the Spec
Liveness Check workflow) holds the claims here that are mechanically checkable,
so this map cannot go stale in silence again. Since #5107 it holds them from two
directions:

- **Freshness of the generated counts.** The gate re-derives the whole counts
  file from the AST and compares bytes. A schema added, removed or re-postured
  under a `Class` verdict nobody re-examined makes the artifact stale, and the
  gate says so in exactly those words. That is what the old hand-written counts
  bought — touching a file forces you back through this ledger — kept, with the
  arithmetic taken away from the human. `strictObject(` had to join the count the
  moment the helper existed: counting only `z.object(` would have made every
  conversion look like surface *disappearing*, so "this directory got solved" and
  "this directory got deleted" would produce the same number. The gate caught
  that itself on the first conversion.
- **Consistency of the hand-written rows.** Every row must name a file that
  exists and still HAS sites — a row over a file with nothing left to classify is
  a verdict about nothing, and the count check used to catch that for free. A
  remaining-strip row whose file has reached zero strip sites fails (the reverse
  pin). And a `Class` cell in the strip map must parse, because the generated
  subtotal is arithmetic over it.
- **Coverage.** Every `*.zod.ts` in a triaged directory that HAS sites must have
  a row. A new one is undeclared surface. The walk is **recursive**; nested files
  are declared by their path relative to the section directory
  (`driver/postgres.zod.ts`). Zero-site files (pure enum/token modules like
  `data/date-macros.zod.ts`) are skipped — there is nothing to classify — and
  become reportable the day they grow their first `z.object(`.
- Any row claiming "strict as of" names a file that really contains `.strict()`.

Deliberately NOT checked: whether the `Class` column is RIGHT. Authorable vs wire
vs open is a judgement about who writes the input, and this campaign's rule is
verify-before-tightening. The gate protects the arithmetic and the coverage so
that judgement is always made against current code. What it does now check is the
cell's FORM — a declared verdict, and a declared split when the row is `mixed` or
`split` and no longer provisional — because a subtotal generated from an
unparseable verdict would be published as a confident number, which is this
file's own subject matter.

**Both directions were proved red before this was believed** (#5107), on the
rule this file keeps re-deriving: hand-patch one number in the counts file and
the freshness half exits 1; delete one hand-written row and the coverage half
exits 1. A green check that has never been shown to go red proves nothing.

**What it found on its first run — 11 drifts, in a file being actively edited
by the campaign that owns it.** Six counts had moved (`ui/app.zod.ts` 11 → 18,
`ui/touch.zod.ts` 4 → 7, `ui/action.zod.ts` 8 → 9, `ui/view.zod.ts` 51 → 50,
`ui/responsive.zod.ts` 6 → 4, `automation/flow.zod.ts` 12 → 11), two section
totals no longer summed, and six files had no row at all. The `app.zod.ts` gap
was **self-inflicted**: the app step (#4165) added seven schemas to that file
and updated the row's prose without touching its count. Five of the six
undeclared files turned out to have zero sites — which is what motivated the
skip rule above — leaving `automation/io-node-config.zod.ts` as the one genuine
omission, now classified.

That is the argument for the gate in one paragraph: the people most familiar
with this ledger, editing it in the same week, still left eleven drifts in it.

**And then it worked for real, before it had even merged.** While the gate sat
in review, `main` landed `automation/builtin-node-config.zod.ts` (#4045/#4228) —
eight new sites, sibling to `io-node-config.zod.ts`. Merging `main` turned the
gate red on a branch whose own diff had not touched a single schema, which is
precisely the intended behaviour: the file arrived, so someone had to classify
it. It is now a row. Every existing count survived that merge unchanged, so the
failure was exactly as narrow as it should have been.

**And then the gate turned out to have the ledger's own disease.** Its coverage
walk listed each triaged directory exactly one level deep, so `data/driver/` —
three per-driver connection-config files, nine sites — was invisible to the check
whose entire promise is "no undeclared surface". The gate printed *"no undeclared
schema files"* while nine authorable sites sat outside the map. Fixed by making
the walk recursive; the three files are now a row.

Read that next to this file's own opening argument — *a map that drifts is worse
than no map, because it is followed*. The same asymmetry applies one level up,
and harder: **a gate that under-reports is worse than no gate, because it
converts "I should classify this" into "it is already classified."** No gate
leaves a reader suspicious; a green gate retires their suspicion. That is the
identical shape to the silent strip this whole campaign is about — a success
signal covering an omission — reproduced in the instrument built to detect it.
So when a check claims coverage, prove it sees something it is supposed to see
before trusting the green: this one was verified by watching it go red on
`data/driver/` and green again only once the rows existed.

Long tail stays gated on a verification pass per shape — never a one-shot
"make all ~500 sites strict" (ADR-0054 ratchet; #4001's own recommendation).
