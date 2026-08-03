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

## Classification rule

One question decides the class: **who writes this schema's input?**

| Class | Input written by | Unknown-key policy |
|---|---|---|
| **authorable** | A human or AI author, into `*.object.ts` / `defineStack` config / Studio / MCP | `.strict()` + fixable error (the ratchet target) |
| **wire** | Another machine: server responses, connector payloads, runtime envelopes, persisted runtime state | stay tolerant (`.strip` / `.passthrough`); strictness here turns an upstream *addition* into our parse crash |
| **open** | Deliberately schemaless user data (record bodies, per-node-type `config`, React props) | stay open; a *sibling* contract validates it (e.g. a node executor's `configSchema`, #4027/#4040) |

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

Site counts are object sites — every `z.object(` / `strictObject(` /
`z.strictObject(` / `z.looseObject(` CALL, read from the AST rather than matched
textually (see `scripts/lib/strictness-ledger.ts` for why the textual method was
wrong in both directions at once). Classification is per the rule above; **(p)**
marks a provisional call made from the file's exports/JSDoc rather than a full
read — verify before tightening (the #4001 "sharing-rule lesson": candidates,
not verdicts).

### `ui/` — 198 sites

| File | Sites | Class | Note / next action |
|---|---|---|---|
| `action.zod.ts` | 8 | authorable | param schema strict (#3746); remaining blocks ride later steps. **9 → 8 at the #4001 re-measurement** — no schema changed: the ninth "site" was a `z.object(…)` inside a JSDoc paragraph, which the old textual counter could not tell from code |
| `view.zod.ts` | 50 | authorable | partially strict (ADR-0089); long tail of sub-blocks. `bulkActionDefs` left this file in #4457 — see the row below |
| `bulk-action.zod.ts` | 3 | authorable | **strict as of #4457** — `BulkActionDefSchema` (the def itself). It was `z.array(z.record(z.string(), z.any()))` inline in `view.zod.ts`: a selection-bar button with **no shape at all**, so `opeartion` / `excution: 'aggregate'` parsed and shipped as a button that ran the default behaviour. Its two other sites are `BulkActionParamSchema` and that param's `options` entry, both deliberately **open** and both now `.passthrough()` — the param because objectui's `BulkActionParam` declares a `[key: string]: unknown` catch-all for widget config (min/max/step/format), so passthrough is the honest mirror and strictness would reject valid config (same call as `dashboard.zod.ts`'s widget `config`); the OPTION ENTRY on separate measured evidence, since its objectui type is closed and only the runtime path is open — `bulkParamToField` spreads each entry (`plugin-grid/src/components/bulkParamToField.ts:131`) into `SelectOptionMetadata` (`types/src/field-types.ts:288`), which declares and reads `color` / `icon` / `disabled` / `visibleWhen`. **This row said "both deliberately open" while only the parent was `passthrough`** — one intent, two postures, caught by the 2026-08-03 re-measure and closed by the ruling's verdict A (make the code match the prose). The lesson is the campaign's own: prose in this ledger is not a posture reading, which is why the remaining-strip map is gated and this column is not. The def also refuses the combinations the executor never reads (`patch` outside an update, `execution` outside a custom, `batchSize` on an aggregate) and a hand-written `actionDef`, which is renderer-attached |
| `component.zod.ts` | 29 | authorable | **next candidate** — SDUI component defs; check React-prop open slots first (p) |
| `theme.zod.ts` | 14 | authorable (p) | authored themes |
| `app.zod.ts` | 18 | authorable | **strict as of #4001 PR B** — `AppSchema` + branding / area / context-selector / contribution, and the nav-item union converted to `z.discriminatedUnion('type', …)` (the union-error question, settled empirically: matched-branch-only errors, exact recursive paths, `toJSONSchema` clean). Per-target `params` stay open. PR A (#4142) tombstoned the seven audit-dead keys first |
| `dashboard.zod.ts` | 11 | authorable | partially strict |
| `widget.zod.ts` | 9 | authorable (p) | |
| `page.zod.ts` | 7 | authorable | partially strict (ADR-0089) |
| `chart.zod.ts` / `i18n.zod.ts` / `responsive.zod.ts` | 7+6+4 | authorable (p) | i18n label shapes are wide-open records by design — verify. **`chart` 6 → 7 at the re-measurement** — again no schema changed: `ChartAggregateSchema` is written `z\n  .object({`, and the old counter's `z\.object\(` could not match across the line break |
| `dataset.zod.ts` / `animation.zod.ts` / `dnd.zod.ts` / `keyboard.zod.ts` / `touch.zod.ts` | 4+4+4+4+7 | authorable (p) | interaction configs |
| `offline.zod.ts` / `report.zod.ts` | 3 ea | authorable (p) | |
| `notification.zod.ts` | 1 | authorable (p) | **#4610 dropped two sites** — the `./ui` `Notification` (toast/banner instance) and `NotificationConfig` (toaster global config) shapes were removed: zero importers in all three repos, and both shadowed live names owned elsewhere (`./api` owns the inbox row). What remains is `NotificationActionSchema`, part of the presentation vocabulary the ui entry keeps |
| `sharing.zod.ts` | 2 | authorable (p) | public-sharing config |

### `data/` — 162 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `object.zod.ts` | 20 | authorable | top-level already guarded (#1535); inner blocks partially strict |
| `data-engine.zod.ts` | 13 | wire (p) | engine contract shapes (was 14 — `DataEngineBatchRequestSchema` retired with `IDataEngine.batch?`, #4618) |
| `external-lookup.zod.ts` | 12 | mixed (p) | authored config + wire results |
| `seed-loader.zod.ts` | 12 | mixed (p) | seed file shapes are authored; loader state is runtime |
| `field.zod.ts` | 11 | authorable | partially strict |
| `filter.zod.ts` | 11 | open | query dialect — user data flows through the predicate values; validated semantically elsewhere |
| `query.zod.ts` | 5 | open, **except `SortNodeSchema` → authorable** | Blanket `open` was the imprecise verdict here, not the strictness. Four sites are the dialect proper (`BaseQuerySchema`, `AggregationNodeSchema`, `FullTextSearchSchema`, `GroupByNodeSchema`'s object arm) and keep the class. `SortNodeSchema` is not dialect: a closed two-key tuple `{field, order}` with **no user-data face at all** — so #4721 carved it out and it is **strict as of #4721** (`strictObject` + `aliases: { direction: 'order' }`). What that bought, measured on `main` first: `SortNodeSchema.parse({field, direction:'desc'})` → `{field, order:'asc'}` — the sort ran the OTHER WAY, and with `limit` that is a different set of rows under an ordinary 200. Per the 11:41Z ruling on #4721 this is a NEW door, not the completion of #4371's: that check is a hand-written top-level allowlist in `objectql/src/engine.ts` (`rejectUnknownEngineOptions`) that never recurses into `orderBy[]`, and `QuerySchema` itself is **not** strict (probe: `QuerySchema.safeParse({object:'sales', nonsenseKey:1}).success === true`) — top-level strictness is #4001's, tracked separately. Site history: one site dropped in #4196 (`FieldNodeSchema`'s nested-select object form narrowed to `z.string()`); four more in #4286 with the `joins`/`windowFunctions` removals (`JoinNodeBaseSchema`, `WindowFunctionNodeSchema`, `WindowSpecSchema`'s outer + `frame`) |
| `driver-nosql.zod.ts` / `driver.zod.ts` / `driver-sql.zod.ts` | 10+9+2 | wire | driver capability contracts |
| `datasource.zod.ts` | 6 | authorable | **strict as of #4001 data step** — all 6: `DatasourceSchema` (+ `pool` / `ssl`), `ExternalDatasourceSettingsSchema` (+ `validation`), `DriverDefinitionSchema`. **#4583 B/C dropped two more sites**: the `healthCheck` and `retryPolicy` blocks are gone — nothing scheduled a probe and nothing retried, so their strictness was validating a shape no code consumed. `config` stays `z.record` **at this level** by construction (per-driver shapes), but is no longer unchecked: **#4410** made `DatasourceSchema`'s refinement parse it against the contract for the declared driver (`driver/config-registry.zod.ts`), so the openness here is a shape this level cannot express rather than the absence of one. This row used to add "the driver's own `configSchema` validates them", which was false until #4410 landed the parse site it names. #4410 extended the same parse to each `readReplicas` entry; **#4468 retired that key** — no driver ever opened a replica connection and no query path splits reads from writes, so the entries were being checked against a contract nothing would apply. Strictness makes a dropped key loud; it cannot make a slot live, and a *precisely validated* dead slot is the more convincing lie | **#4583 dropped the ninth site**: `DatasourceCapabilities` is gone — eleven flags no code read, on a block whose strictness was the clearest case of this row's own closing sentence. `readOnly` in particular was *precisely validated* and completely inert, and had been relocated twice (#4410, #4465) toward somewhere it might be enforced; the shipped CRM example called a datasource a read replica on the strength of it while writes went through. Class unchanged
| `driver/memory.zod.ts` / `driver/mongo.zod.ts` / `driver/postgres.zod.ts` | 6+1+1 | authorable | The per-driver shapes for the `config` slot — what an author actually writes under `datasource.config` (`host`, `port`, `filename`). **Undeclared here until the coverage walk went recursive** (see below): a subdirectory was invisible to the gate, so these sites sat outside the map while the map reported full coverage. **Strict as of #4410**, which is also what unblocked them: this row previously read "strictness here would enforce nothing" because nothing parsed `datasource.config` against these schemas and both `*DriverSpec.configSchema` literals were `{}`. Now `DatasourceSchema` parses `config` against them, and the same schemas project onto `configSchema` and onto the Studio connection form. (#4410 also ran the parse over each `readReplicas` entry; #4468 retired that key outright — see the row above.) `postgres.zod.ts` drops a site: its `ssl` was a `boolean | {ca, cert, key, …}` union, and the object arm is gone — certificates now live in the datasource-level `ssl` block (declared, strict, and until #4410 read by nobody), leaving `config.ssl` as the on/off shorthand. That narrowing is forced by the same projection: the Studio form renders anything that is not boolean/enum/number as a TEXT INPUT, so a union here would have produced a wizard whose every `ssl` value the new gate rejects. `memory.zod.ts` keeps 6 but loses two KEYS — `indexes` / `maxRecordsPerObject`, which `InMemoryDriverConfig` has no field for, removed under ADR-0049 rather than blessed by the new gate |
| `driver/mysql.zod.ts` / `driver/sqlite.zod.ts` | 1+2 | authorable | The rest of the `config` contract, added by #4410. `mysql.zod.ts` and `sqlite.zod.ts` (sqlite + sqlite-wasm) are shapes that **never existed** — both driver ids were offered by the connection form and buildable by the shared factory, with no config contract anywhere, so `driver: 'sqlite'` + a misspelled `filename` was an ephemeral `:memory:` database reported as configured. All three sites strict, same error factory as the rest of the campaign. (Their sibling `driver/common.zod.ts` holds shared enums and prescription strings and has no `z.object(` site, so the coverage gate skips it) |
| `analytics.zod.ts` | 8 | mixed (p) | |
| `document.zod.ts` | 8 | wire (p) | |
| `hook.zod.ts` / `hook-body.zod.ts` | 6+2 | mixed | **strict as of #4001 data step** for the AUTHORING shapes: `HookSchema` (+ `retryPolicy`) and both body branches (`ExpressionBodySchema` / `ScriptBodySchema`). `HookContextSchema` and its `session` / `provenance` / `user` blocks are the RUNTIME shape the engine hands a handler — they stay tolerant, and must: strictness there would make an engine-internal enrichment (as `provenance` was in #3712) a breaking change for anyone parsing a context they were given. The file's old blanket `authorable (p)` was too wide — verification split it |
| `mapping.zod.ts` | 3 | authorable (p) | |
| `external-catalog.zod.ts` | 4 | wire (p) | |
| `validation.zod.ts` | 6 | authorable | **strict as of #4001 batch 3b** — a `z.lazy()` discriminated union, so the one-call conversion does not apply: each of the six variants builds its own `strictObject` from a shared `BASE_VALIDATION_SHAPE`. Closing the base alone would have rejected correctly but suggested from the SHARED keys only, so a typo of a variant's own key (`transtions` → `transitions`) would get no rename. Site count 1 → 6 because the six variants are now object sites in their own right. The ADR-0010 envelope lives in the shared shape, so all six inherit it |
| `field-value.zod.ts` / `seed.zod.ts` | 2+1 | mixed (p) | `seed` is strict (registered-types batch). **`field-value` 1 → 2 at the re-measurement**: `FileValueSchema` is `z.looseObject(` — a THIRD object idiom the old counter did not know, so the site was invisible rather than classified. It is deliberately open (an uploaded file's metadata bag); `LocationValueSchema` beside it is the strip site |

### `automation/` — 75 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `flow.zod.ts` | 11 | authorable | **strict as of #4001** — the four outer authoring shapes at step 1, and **the six nested blocks at batch 11** (`FlowNode.connectorConfig` / `.position` / `.inputSchema` / `.waitEventConfig` / `.boundaryConfig`, `Flow.errorHandling`). The gap between those two dates is this campaign's own finding 17 inside its own file: closing the shells left the gate rejecting `nodee:` at node level while `connectorConfig: { connectorId, actionId, params: {…} }` parsed clean and the executor dispatched `input ?? {}` — a successful connector call carrying nothing. Worth recording precisely, because the obvious example is the wrong one: a slip on a REQUIRED key was always loud (it then reads as missing). What `.strip` swallowed here is the OPTIONAL half — the input map, the retry budget, `interrupting: false`, `required: true` — i.e. exactly the keys an author adds to CONSTRAIN behaviour, replaced by a permissive default without a word. Two things stay open and are now pinned in code with the reason, so a later sweep stops rather than "finishes" the file: the node `config` slot (ADR-0018 plugin namespace) and `FlowVersionHistorySchema` (the file's only WIRE shape — emitted on publish, never authored; its `definition` is `FlowSchema`, so the authored half inside a history record is gated anyway) |
| `etl.zod.ts` | 10 | mixed | **7 strict as of #4001 批 12** — the authoring half (`ETLSource` + `.incremental`, `ETLDestination`, `ETLTransformation`, `ETLPipeline` + `.retry` + `.notifications`). The other 3 — `ETLPipelineRun` + `.stats` + `.error` — are **deliberately left open**: engine-emitted run state (an id it minted, a status it reached, counters it accumulated), same disposition and same reason as `FlowVersionHistorySchema` above and all of `execution.zod.ts`. The exemption is recorded on the schema itself, not only here, because a note only this file carries is a note the next sweep does not read. The old blanket `authorable (p)` was too wide; verification split it. ⚠️ **Read the classification caveat before reusing this verdict**: `etl.zod.ts` has NO parse site in objectstack / objectui / cloud, so neither half could be settled by pointing at a live call. The 7 are authorable because the exported schema and type ARE the door (`SYNC_ARCHITECTURE.md` and the module's `@example` both hand-write `const p: ETLPipeline = { … }`) — the `webhook.zod.ts` posture. The 3 are wire on the shape's semantics plus settled precedent, NOT on an emit site anyone can point at today; if an ETL engine ever lands and a run result turns out to be operator-authored, that verdict is the one to revisit. Two out-of-scope findings were filed rather than fixed here: the `retry` block is a third retry-policy vocabulary #4661's convergence never reached (#4962), and all nine type aliases export the parsed shape under the bare name, which is why the SYNC_ARCHITECTURE.md pipeline examples do not compile (#4963). **−12 at #4738**: `sync.zod.ts` (the L1 "Simple Sync" file — `DataSyncConfig`, its `ConflictResolution` enum and satellites, formerly this row's co-candidate) was deleted whole rather than hardened: three-repo zero importers, no parse site, defs unreachable from the metadata-type roots (#4650 gate), so there was no author for strictness to protect (#4535 C13+C15). The integration-side `ConflictResolution` → `ConnectorConflictResolution` rename in the same change is name-only and moves no sites |
| `execution.zod.ts` | 13 | wire | run-state envelopes — never strict. +5 at #4354 (the run-summary family: step metrics / skip reason / per-node / per-gate / the summary itself) — engine-emitted telemetry read by the Console and by operator queries, nobody authors them, so the `wire` verdict covers them unchanged |
| `state-machine.zod.ts` | 6 | authorable | **strict as of #4001 批 10** — all six sites (`ActionRef` / `GuardRef` / `Transition` / `StateNode` + `.meta` / `StateMachine`). **The `(p)` was NOT a formality here.** ADR-0020 retired this XState shape as a *record-lifecycle* declaration — the top-level `workflow` metadata type and `object.stateMachines` are both gone, and a record's transitions live on the `state_machine` VALIDATION RULE instead — so had those been the only doors this file would be DEAD surface, and the correct action would have been to fix its class, not close it. One authoring door survives: `ai/agent.zod.ts`'s `lifecycle` is `StateMachineSchema`, and `agent` is a registered type, so `defineStack({ agents })` / meta REST / the Studio agent form all reach here through `AgentSchema.parse()`. Verified by parse: an agent whose lifecycle carried `stats`, a state with `onn` (one keystroke from `on`) and a `meta` with two unknown keys **parsed clean**, returning a machine with NO transitions at all — the declaration whose whole job is to deny undeclared transitions, silently emptied and reported valid. `.meta` was checked for the #4909 open-slot case and is CLOSED: the hand-written `StateNodeConfig` type declares exactly its four keys (passthrough would open the Zod while `tsc` stayed shut), nothing in the repo reads any `meta` key, and the prior behaviour was strip — an author's `meta` arrived as `{}` — so there was no openness to preserve. ⚠️ `ActionRef` / `GuardRef` are UNIONS: a strict branch's message does not reach the top (zod raises one `invalid_union` whose message is the literal `"Invalid input"`, with the real prescription nested in `issue.errors[]`), which `formatZodError` then flattens away — filed, not fixed here. **−1 at #4658**: the orphan `EventSchema` (`{ type, schema }`, an XState-style signal declaration nothing referenced — `StateMachineSchema` names event types as `on:` record keys) was deleted rather than converged with `kernel/events/core.zod.ts`'s envelope `EventSchema`, whose key set it did not intersect (#4535 C6). The remaining 6 sites and their verdict are unchanged |
| `control-flow.zod.ts` | 5 | authorable | **strict as of #4001 批 10** — all five sites (`FlowRegion` / `Loop` / `ParallelBranch` / `Parallel` / `TryCatch`). The `(p)` resolves to authorable on the executors' own parse seam (`parseNodeConfig`, #4277) plus `validateControlFlow`'s region parse. **`validateControlFlow` is a sibling guard, not a key gate, and the two do not fight**: it answers single-entry / single-exit / acyclic, which no key check can decide, and the schema answers key membership, which no structural check can decide. They meet at exactly one seam — the guard `safeParse`s each region slot before analyzing it, so an undeclared region key now surfaces there as `<where>: invalid region — <the strictObject message>`, the guard's framing wrapping the schema's prescription. Nothing was duplicated and nothing removed; the guard simply stopped silently repairing its own input before judging it. Two curation entries had to be MEASURED rather than reasoned: the bare edit-distance fallback answers `itemVariable` with **`indexVariable`** — binding the loop INDEX where the author wanted the ITEM — so the alias exists to overrule a confidently wrong suggestion from this campaign's own helper (the `pii` → `min` shape, third instance); and `join`/`joinGateway` needed two DISTINCT prescriptions because `guidance` emits one bullet per key verbatim, so a shared string printed the same paragraph twice. Its test instrument also had to be rebuilt: `region-slots.test.ts` probed every construct with every candidate key at once and depended on `.strip` to discard the mismatches, so it returned "no schema accepts any region" the moment the shapes closed — it failed loudly, which is the only reason this is a footnote and not a fourth finding-3. Structural validation by `validateControlFlow` remains. **−1 at #4661**: `RetryPolicySchema` moved out to `shared/retry-policy.zod.ts` — `./automation` and `./system` published the same name for two different declarations (#4411), so the retry policy converged onto one. The site still exists and is still non-strict and authorable; it is simply no longer in a directory this ledger sections. ⚠️ That is a coverage gap worth knowing about: this audit sections `ui/` / `data/` / `automation/` / `security/` / `studio/` only, so a `shared/` shape is unaudited by construction. The tolerance is deliberate here — the `retryDelayMs` → `backoffMs` rename is tombstoned via `retiredKey()` precisely because a non-strict parent would otherwise swallow the old spelling |
| `bpmn-interop.zod.ts` | 5 | wire (p) | interop import shapes |
| `approval.zod.ts` | 4 | authorable | **strict as of #4001 step 3** — all four authoring schemas (node config / approver / escalation / decision-output). The published JSON schema carries `additionalProperties: false` into the Studio form AND `registerFlow()` config validation (#4027/#4040), so an unknown key in an approval node's `config` is rejected at registration too — verified: `z.toJSONSchema` on the strict lazySchema does not throw (#3746 hazard checked) |
| `node-executor.zod.ts` | 4 | wire | executor contract |
| `io-node-config.zod.ts` | 2 | authorable | `NotifyConfigSchema` / `HttpConfigSchema` (#4045) — the sibling contracts that validate the **open** `config` slot on flow `notify` / `http` nodes. Authored per-node, so the open-slot exemption above does not extend to them. **Strict as of #4001 批 9**; the node `config` SLOT itself stays open (ADR-0018 keeps `node.type` open, so the slot cannot be closed without closing the plugin extension point). Five `guidance` entries carry the ADR-0087 notify aliases (`to`/`subject`/`body`/`url`/`source`) |
| `builtin-node-config.zod.ts` | 8 | authorable | Same family (#4045): the CRUD quartet, `screen`, `map`. Written from what the executors read rather than from the descriptors' `configSchema` literals, and reconciled bidirectionally by `builtin-node-form-zod-ledger.test.ts` — so unlike most rows here, this one already has a drift check of its own. **Strict as of #4001 批 9.** The curated tables are the `FLOW_NODE_UNKNOWN_KEY_GUIDANCE` prose from `service-automation`'s registration door, plus two entries that door never had: `recordId` (measured on CRUD nodes across the repo's own flow fixtures, read by no executor — on `delete_record` that is #3810 wearing a key that looks like a constraint) and `outputVariable` on `update_record` / `delete_record` (a documented ABSENCE, and the likeliest wrong key precisely because five sibling contracts declare it) |
| `schemaless-node-config.zod.ts` | 4 | authorable | Same family, third panel (#4278): `script` / `subflow` / `decision` (+ the decision branch item) — the descriptor-schemaless nodes whose form lives in objectui's hand-written table. Written from the executors; the drift check is objectui's `flow-node-config.spec-reconciliation` test (cross-repo, via the published exports — it compares `.shape` key sets, so strictness does not move it). Since #4343 `script` and `subflow` ARE parsed at execute time (`parse-config.ts`). **Strict as of #4001 批 9 — and this is the one row in the table where strictness is the FIRST unknown-key gate, not a second one**: `registerFlow()`'s #4277 rejection derives its declared set from a descriptor `configSchema`, so it structurally skips the schemaless class. `decision` stays export-only, closed anyway; its `condition` guidance suppresses a one-edit rename to `conditions` that #4414 proves is the worse outcome |
| `webhook.zod.ts` | 1 | authorable | **strict as of #4001 batch 11**, and the `(p)` resolved to the opposite of what the old note ("spec-only") implied. Three parse doors, not zero: `defineWebhook()`, `defineStack({ webhooks })` via `StackSchema`, and — the one that mattered — `plugin-webhooks`' `bootstrapDeclaredWebhooks`, which re-`parse()`s every declared webhook at BOOT before materializing it into `sys_webhook`, warning and SKIPPING on failure. Which is why the ADR-0010 envelope landed in the same change rather than as a follow-up: both metadata load paths call `applyProtection` on EVERY type, so a package-loaded webhook reaches that boot parse already carrying `_packageId` / `_provenance`. `.strip` discarded them; `.strict()` alone would have converted every package-shipped webhook into a **skipped subscription after redeploy**, with one `warn` to say so. This is the envelope debt the registered-type batches paid down eight times — `webhook` is not a registered type (no `BUILTIN_METADATA_TYPE_SCHEMAS` entry), which is exactly why the invariant test that guards those never looked here. ⚠️ Strictness also rides `.extend()` onto `integration/connector.zod.ts`'s `WebhookConfigSchema` (verified against real zod, and pinned in `connector.test.ts`); its two extra keys are named in `extraKeys` — except `events`, deliberately, because it is also an alias TARGET here and listing it would walk a base-surface author through two rejections into a key the base does not accept (finding 7, arriving via hand-written `extraKeys` rather than the shape) |
| `time-relative-trigger.zod.ts` | 1 | authorable | **Undeclared until the #4001 re-measurement, and invisible for the worst possible reason**: `TimeRelativeTriggerSchema` is written `z\n  .object({`, the old textual counter matched zero sites, and a zero-site file is SKIPPED by the coverage walk as "nothing to classify". So the gate whose whole promise is "no undeclared surface" reported green over an authorable schema — the same shape as `data/driver/`, one layer subtler, because this time the file was not hidden by the walk but by the counter feeding it. Classification is not a guess: the file's own `@example` blocks author it by hand into a flow start node (`config: { timeRelative: { object, dateField, offsetDays, filter } }`), which is the authoring door. A stripped key here means the sweep silently never matches — `offsetDay` for `offsetDays` returns a trigger that never fires, reported as configured. **Strict as of #4001 batch 11**, and closing it turned up one thing the triage did not predict: this schema is `safeParse`d at BIND time by `TimeRelativeTriggerPlugin` (`time-relative-trigger.ts`), not only at authoring — so the descriptor sitting under the deliberately-OPEN node `config` slot (ADR-0018) now has exactly one gate, and it is a runtime one. The behaviour change is the campaign's whole thesis in miniature: `{ …valid, offsetDay: 7 }` used to bind a sweep that ran daily with the author's narrowing discarded; it now refuses to bind and the plugin's warning carries the key and the rename |
| `flow-function.zod.ts` | 1 | authorable | `FlowFunctionDeclarationSchema` (#4396) — the `{ handler, effect }` form of a `defineStack({ functions })` entry. Authored, but note what an undeclared key here would be: a sibling of a **live function**, not data. `defineStack`'s union already rejects a record whose `handler` is not callable, and the boot-path reader is the hand-written `normalizeFlowFunctionEntry` rather than a `.parse()` (re-validating a live handler every boot buys nothing), so strictness would bind at authoring only. **Strict as of #4001 batch 11**, and the verify-first pass confirmed that reading exactly — stated in the code rather than left implied, because a tightening must not claim reach it does not have. It is still worth having for the reason the reading first made it look pointless: `normalizeFlowFunctionEntry` takes TWO keys and ignores the rest **by construction**, so a misspelled `effect` was dropped at the schema and then not looked for by the reader — and the failure runs the quiet way. The function registers, runs, and its writes are counted as none, which is precisely what keeps #4354's broken-sweep query (`selected > 0 AND acted = 0 AND unmeasured = 0`) silent on the one run that needed it |

`trigger-registry.zod.ts` had a row here (11 sites, "mixed — descriptors are code-registered (wire-ish); bindings authored") until #4499 deleted the file: all 11 sites were the third connector-vocabulary declaration (`ConnectorSchema` / `Authentication*` / `Operation*` / `ConnectorInstance`), and the old row's classification was optimistic twice over — nothing was ever code-registered against these descriptors and no binding was ever authored. The engine registers against `integration/connector.zod.ts` (ADR-0097), which keeps its own row.

### `security/` — 20 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `explain.zod.ts` | 11 | wire | permission-explain responses — never strict |
| `permission.zod.ts` | 4 | authorable | **strict as of #4001**; `EffectiveObjectPermissionSchema` explicitly `.strip()`s (wire) |
| `rls.zod.ts` | 3 | authorable | **`RowLevelSecurityPolicySchema` strict as of #4001 step 2** (a stripped RLS key is a silent policy hole); `RLSUserContextSchema` / `RLSEvaluationResultSchema` are runtime shapes — stay tolerant |
| `sharing.zod.ts` | 2 | authorable | **strict as of #4001 step 2** — rule + recipient shapes; strictness and the error map ride the base into the criteria extension |

### `studio/` — 27 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `object-designer.zod.ts` | 12 | authorable | strict as of #4001 — `defineObjectDesignerConfig` is the authoring door |
| `plugin.zod.ts` | 8 | authorable | strict as of #4001 — **was `mixed (p)`; verification found no wire half** |
| `flow-builder.zod.ts` | 7 | authorable | strict as of #4001 — `defineFlowBuilderConfig`; independent of `FlowSchema` |

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

This section is that number, per file, and **it is gated** (`check:strictness-ledger`):

- every file with at least one strip site must have a row here, with matching counts;
- a row whose file reaches **zero** strip sites **fails the gate** — a closed file
  drops out of this table. That reverse pin is what makes the table a ratchet
  rather than a snapshot, and it is the lesson from the ADR-0010 debt list applied
  one level up: *a worklist that can outlive its work will.*

`Class` here is per SCHEMA, not per file, so a row's strip count can span two
classes; where it does, the split is stated. **Only the authorable half is in the
2026-08-03 ruling's forced scope** — wire/open rows are listed so the arithmetic
is complete and so nobody re-triages them from scratch next batch.

#### `automation/` — 26 strip of 75

| File | Strip | Sites | Class | Batch |
|---|---|---|---|---|
| `execution.zod.ts` | 13 | 13 | wire | **out of scope** — engine-emitted run state; the ledger row already says "never strict" |
| `etl.zod.ts` | 3 | 10 | wire | **Authorable half closed at 批 12** (7 sites: `ETLSource` + `.incremental`, `ETLDestination`, `ETLTransformation`, `ETLPipeline` + `.retry` + `.notifications`). What is left is `ETLPipelineRun` + `.stats` + `.error` — engine-emitted run state, exempt for the `FlowVersionHistorySchema` reason and pinned as such in `etl.test.ts`, so closing it means deleting a test that says not to. **This row shrinks without disappearing** — the second in `automation/` to do so, after `flow.zod.ts` reached its own wire floor of 1 at 批 11 (the two batches were in flight together and arrived at the same shape independently, which is the better evidence that it is the right one). Worth naming because the reverse pin cannot see it: the pin fires on zero, so a row that stops at its wire floor looks exactly like a row nobody finished. The Class column is the only thing separating them — read it before treating this as unfinished work |
| `flow.zod.ts` | 1 | 11 | wire | **batch 11 closed the 6 authorable** (`FlowNode.connectorConfig` / `.position` / `.inputSchema` / `.waitEventConfig` / `.boundaryConfig`, `Flow.errorHandling`). The 1 left is `FlowVersionHistorySchema`, which this table has exempted since it was written — **do not close it**: it is emitted on publish, not authored, so closing it makes a future emitter-side field a parse failure for whoever reads history. The exemption now also lives beside the schema and in `flow.test.ts`, because a row in a table is not where the next person to open that file will look |
| `bpmn-interop.zod.ts` | 5 | 5 | wire (p) | **out of scope** — third-party BPMN import/export shapes; strictness turns an upstream addition into our parse crash |
| `node-executor.zod.ts` | 4 | 4 | wire | **out of scope** — executor registration contract, code-to-code |

Eight rows have left this table across three waves of the ruling's `automation/`
main body, each one on reverse-pin evidence — the row was deleted because the
gate went red on it still being there, not because someone remembered:

| wave | rows removed | other change |
|---|---|---|
| **批 9** (#4925) | `builtin-node-config` (8) · `schemaless-node-config` (4) · `io-node-config` (2) | — |
| **批 10** (#4973) | `control-flow` (5) · `state-machine` (6) | — |
| **批 11** (#4974) | `flow-function` (1) · `time-relative-trigger` (1) · `webhook` (1) | `flow.zod.ts` 7 → 1 |
| **批 12** (#4979) | — | `etl.zod.ts` 10 → 3 |

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
per *pair* of waves that overlap in flight. So the rule is mechanical rather
than remembered: **the header and the subtotal are recomputed from the surviving
rows, never resolved in favour of a side**, and `check:strictness-ledger`'s
arithmetic is what settles it. A clean-looking merge here is evidence of nothing.

**Authorable strip in `automation/`: 0 of 26** (was 41 of 67 when the ruling was
written). **The ruling's `automation/` main body is complete** — every remaining
strip site in this directory is wire, and none is in the forced scope:
`execution` 13, `bpmn-interop` 5, `node-executor` 4, `etl`'s 3 run-state shapes,
and `flow.zod.ts`'s last site `FlowVersionHistorySchema`.

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

#### `ui/` — 123 strip of 198

| File | Strip | Sites | Class | Batch |
|---|---|---|---|---|
| `component.zod.ts` | 29 | 29 | authorable (p) | Largest single block left. SDUI component props — **verify the React-prop open slots first**; `check:react-declaration-parity` compares two DECLARATIONS and cannot tell you which props a renderer reads |
| `view.zod.ts` | 20 | 50 | mixed | Top level and the form/page shapes are closed (ADR-0089 + the final batch). Remaining are sub-blocks; `UserFiltersSchema` is the one the last batch **named as deliberately left open** — it strips page-only keys with a test pinning that, so closing it needs its own verification |
| `theme.zod.ts` | 14 | 14 | authorable (p) | Authored themes; `Typography` / `Animation` sub-blocks dominate |
| `widget.zod.ts` | 9 | 9 | authorable (p) | Widget manifest + lifecycle/event/property/source |
| `chart.zod.ts` | 7 | 7 | authorable (p) | Axis / series / annotation / interaction / config / groupBy / aggregate |
| `touch.zod.ts` | 7 | 7 | authorable (p) | Gesture configs |
| `i18n.zod.ts` | 6 | 6 | authorable (p) | ⚠️ the triage row warns label shapes are wide-open records **by design** — verify before closing |
| `animation.zod.ts` | 4 | 4 | authorable (p) | |
| `dnd.zod.ts` | 4 | 4 | authorable (p) | |
| `keyboard.zod.ts` | 4 | 4 | authorable (p) | |
| `responsive.zod.ts` | 4 | 4 | authorable (p) | |
| `dataset.zod.ts` | 3 | 4 | authorable (p) | `DatasetDimension` / `DatasetMeasure` + `.derived` |
| `offline.zod.ts` | 3 | 3 | authorable (p) | |
| `dashboard.zod.ts` | 2 | 11 | authorable | Only `DashboardWidget.compareTo` and `.layout` left; `DashboardWidgetOptionsSchema` stays `passthrough` **deliberately** (renderer escape hatch — see the triage row) |
| `report.zod.ts` | 2 | 3 | authorable (p) | `ReportSort` / `JoinedReportBlock` |
| `sharing.zod.ts` | 2 | 2 | authorable (p) | `SharingConfig` / `EmbedConfig` |
| `action.zod.ts` | 1 | 8 | authorable | `ActionParamSchema.options` — a plain `{ label, value }` pair; the cheapest win in the directory |
| `app.zod.ts` | 1 | 18 | verify | `BaseNavItemSchema` — the base the strict discriminated-union members extend. Closing a base that is `.extend()`ed is the #4001 trap that bit `view` (finding 16); confirm the members' strictness is not already covering it before touching |
| `notification.zod.ts` | 1 | 1 | authorable (p) | `NotificationActionSchema` |

**Authorable strip in `ui/`: 123 of 123** — every remaining strip site in this
directory is authorable. Of those 123, `app.zod.ts`'s single site is held pending
the finding-16 `.extend()` check rather than counted as ready.

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

#### `data/` — 120 strip of 162

| File | Strip | Sites | Class | Batch |
|---|---|---|---|---|
| `object.zod.ts` | 14 | 20 | authorable | The registered type's top level is closed (#1535/#4519/#4522); these are inner blocks — `Index`, `ObjectAccessConfig`, `Lifecycle` (+4 sub-blocks), `ObjectFieldGroup`, `ObjectExternalBinding`, `userActions`, `systemFields`, `activityMilestones`, `publicSharing`, `ObjectExtension`. Highest author volume in the repo |
| `data-engine.zod.ts` | 13 | 13 | wire | **out of scope** — engine request/response contracts |
| `external-lookup.zod.ts` | 12 | 12 | mixed (p) | `ExternalDataSource` + `.authentication` and the `ExternalLookup` tree are authored config; needs the per-schema read the ledger never did |
| `seed-loader.zod.ts` | 12 | 12 | mixed (p) | Split is real: `SeedLoaderConfig` / `SeedIdentity` (+`.user`/`.org`) / `ReferenceResolution` are authored; `SeedLoadResult` / `SeedLoaderResult` (+`.summary`) / `ReferenceResolutionError` / `ObjectDependencyNode` / `ObjectDependencyGraph` / `SeedLoaderRequest` are loader runtime |
| `filter.zod.ts` | 11 | 11 | open | **out of scope** — query dialect; user data flows through, validated semantically elsewhere |
| `driver-nosql.zod.ts` | 10 | 10 | wire | **out of scope** |
| `driver.zod.ts` | 9 | 9 | wire | **out of scope** — driver capability contract |
| `analytics.zod.ts` | 8 | 8 | mixed (p) | `Metric` / `Dimension` / `Cube` / `AnalyticsQuery` — cube definitions are authored; needs a per-schema read |
| `document.zod.ts` | 8 | 8 | wire (p) | `DocumentTemplate` / `ESignatureConfig` read authorable on their face — the `(p)` is unresolved, verify before scheduling either way |
| `driver/memory.zod.ts` | 5 | 6 | authorable | The persistence-adapter union under `datasource.config`; `datasource.config` HAS been parsed against these since #4410, so strictness here now binds |
| `query.zod.ts` | 4 | 5 | open | ~~⚠️ classification conflict — see #4721~~ **RESOLVED (11:41Z ruling, closed by #4721).** The conflict was real and the answer was that per-FILE classification was the imprecise instrument: `SortNodeSchema` was carved out as `authorable` and closed (`strictObject` + `aliases: { direction: 'order' }`), the other 4 sites keep `open`. Those 4 are the dialect proper — `BaseQuerySchema`, `AggregationNodeSchema`, `FullTextSearchSchema`, `GroupByNodeSchema`'s object arm — and `BaseQuerySchema`'s own top-level strictness is #4001's to schedule, deliberately **not** taken by #4721 |
| `external-catalog.zod.ts` | 4 | 4 | wire (p) | **out of scope** |
| `hook.zod.ts` | 4 | 6 | wire | **out of scope** — `HookContextSchema` + `.session`/`.provenance`/`.user` are the runtime shape handed to a handler; verified in the data step |
| `field.zod.ts` | 3 | 11 | authorable | `LocationCoordinates` / `CurrencyValue` / `Address` — field VALUE shapes, not field config; check whether they are record data (→ open) before closing |
| `driver-sql.zod.ts` | 2 | 2 | wire | **out of scope** |
| `field-value.zod.ts` | 1 | 2 | mixed (p) | `LocationValueSchema` — record data, very likely **open**; its sibling `FileValueSchema` is already `z.looseObject` |

**Authorable strip in `data/`: ~22 firm** (`object` 14 + `driver/memory` 5 + `field` 3), **plus ~33 needing a per-schema verdict** (`external-lookup` 12, `seed-loader` 12, `analytics` 8, `field-value` 1). 65 are wire/open and out of the ruling's forced scope — 66 until #4721 closed `query.zod.ts`'s `SortNodeSchema`, which is the one row in this directory where the per-schema read moved a site OUT of `open` rather than confirming it.

#### `security/` — 13 strip of 20

| File | Strip | Sites | Class | Batch |
|---|---|---|---|---|
| `explain.zod.ts` | 11 | 11 | wire | **out of scope** — permission-explain responses; the triage row already says "never strict" |
| `rls.zod.ts` | 2 | 3 | wire | **out of scope** — `RLSUserContext` / `RLSEvaluationResult` are runtime shapes; the POLICY shape is closed |

**Authorable strip in `security/`: 0. This directory is DONE.**

`studio/` has **0 strip of 27** and so has no table here — batch 7 landed, and this
is the confirmation the campaign's own progress log was missing.

## Other directories (coarse; classify per schema before touching)

| Dir | Sites | Dominant class | Rationale |
|---|---|---|---|
| `api/` | 426 | wire | REST/GraphQL request/response contracts — tolerant by design |
| `system/` | 383 | mixed | manifest/datasource blocks are authored; runtime envelopes are wire |
| `kernel/` | 351 | wire | plugin/kernel contracts, code-to-code |
| `cloud/` | 83 | wire | multi-tenant runtime |
| `ai/` | 75 | mixed | agent/tool/skill definitions authored (partially strict already); model/provider payloads wire |
| `integration/` | 64 | wire | connector payloads — upstream adds fields freely |
| `identity/` | 33 | mixed | position/user shapes authored (`PositionSchema` **strict as of #4001 step 2**, with the ADR-0010 envelope declared); auth payloads wire. **34 → 33 in #4641**: `identity.zod.ts` lost its `SessionSchema` site — a second, importerless declaration of a name `api/auth.zod.ts` already owned (the #4411 dual-source trap), deleted rather than reclassified |
| `shared/` | 25 | n/a | utilities and building blocks; strictness decided at the consuming schema |
| `qa/` | 6 | n/a | test fixtures |

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

   - **`ui/app.zod.ts`'s `BaseNavItemSchema`** is the base that the strict
     discriminated-union members `.extend()`. Finding 16 is the warning: closing
     a base closes every extension of it, including any that is deliberately a
     wire shape. **Still open.**

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

## This file is now machine-checked

`pnpm --filter @objectstack/spec check:strictness-ledger` (wired into the Spec
Liveness Check workflow) holds the two claims here that are mechanically
checkable, so this map cannot go stale in silence again:

- **Site counts.** The method is stated above — `z.object(` or `strictObject(`
  occurrences per file — so every number in the triage tables is verifiable. A
  count that no longer matches means schemas were added or removed under a
  `Class` verdict nobody re-examined. Touching a file forces you back through
  this ledger. `strictObject(` had to join the count the moment the helper
  existed: counting only `z.object(` would have made every conversion look like
  surface *disappearing*, so "this directory got solved" and "this directory got
  deleted" would produce the same number. The gate caught that itself on the
  first conversion.
- **Coverage.** Every `*.zod.ts` in a triaged directory that HAS sites must have
  a row. A new one is undeclared surface. The walk is **recursive**; nested files
  are declared by their path relative to the section directory
  (`driver/postgres.zod.ts`). Zero-site files (pure enum/token modules like
  `data/date-macros.zod.ts`) are skipped — there is nothing to classify — and
  become reportable the day they grow their first `z.object(`.
- **Section totals**, and that any row claiming "strict as of" names a file that
  really contains `.strict()`.

Deliberately NOT checked: the `Class` column. Authorable vs wire vs open is a
judgement about who writes the input, and this campaign's rule is
verify-before-tightening. The gate protects the arithmetic and the coverage so
that judgement is always made against current code.

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
