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

Site counts are object sites — `z.object(` or `strictObject(` — per file (2026-07-30, this branch).
Classification is per the rule above; **(p)** marks a provisional call made
from the file's exports/JSDoc rather than a full read — verify before
tightening (the #4001 "sharing-rule lesson": candidates, not verdicts).

### `ui/` — 198 sites

| File | Sites | Class | Note / next action |
|---|---|---|---|
| `action.zod.ts` | 9 | authorable | param schema strict (#3746); remaining blocks ride later steps |
| `view.zod.ts` | 50 | authorable | partially strict (ADR-0089); long tail of sub-blocks. `bulkActionDefs` left this file in #4457 — see the row below |
| `bulk-action.zod.ts` | 3 | authorable | **strict as of #4457** — `BulkActionDefSchema` (the def itself). It was `z.array(z.record(z.string(), z.any()))` inline in `view.zod.ts`: a selection-bar button with **no shape at all**, so `opeartion` / `excution: 'aggregate'` parsed and shipped as a button that ran the default behaviour. Its two other sites are `BulkActionParamSchema` and that param's `options` entry, both deliberately **open**: objectui's `BulkActionParam` declares a `[key: string]: unknown` catch-all for widget config (min/max/step/format), so `.passthrough()` is the honest mirror and strictness there would reject valid config — same call as `dashboard.zod.ts`'s widget `config`. The def also refuses the combinations the executor never reads (`patch` outside an update, `execution` outside a custom, `batchSize` on an aggregate) and a hand-written `actionDef`, which is renderer-attached |
| `component.zod.ts` | 29 | authorable | **next candidate** — SDUI component defs; check React-prop open slots first (p) |
| `theme.zod.ts` | 14 | authorable (p) | authored themes |
| `app.zod.ts` | 18 | authorable | **strict as of #4001 PR B** — `AppSchema` + branding / area / context-selector / contribution, and the nav-item union converted to `z.discriminatedUnion('type', …)` (the union-error question, settled empirically: matched-branch-only errors, exact recursive paths, `toJSONSchema` clean). Per-target `params` stay open. PR A (#4142) tombstoned the seven audit-dead keys first |
| `dashboard.zod.ts` | 11 | authorable | partially strict |
| `widget.zod.ts` | 9 | authorable (p) | |
| `page.zod.ts` | 7 | authorable | partially strict (ADR-0089) |
| `chart.zod.ts` / `i18n.zod.ts` / `responsive.zod.ts` | 6+6+4 | authorable (p) | i18n label shapes are wide-open records by design — verify |
| `dataset.zod.ts` / `animation.zod.ts` / `dnd.zod.ts` / `keyboard.zod.ts` / `touch.zod.ts` | 4+4+4+4+7 | authorable (p) | interaction configs |
| `offline.zod.ts` / `report.zod.ts` | 3 ea | authorable (p) | |
| `notification.zod.ts` | 1 | authorable (p) | **#4610 dropped two sites** — the `./ui` `Notification` (toast/banner instance) and `NotificationConfig` (toaster global config) shapes were removed: zero importers in all three repos, and both shadowed live names owned elsewhere (`./api` owns the inbox row). What remains is `NotificationActionSchema`, part of the presentation vocabulary the ui entry keeps |
| `sharing.zod.ts` | 2 | authorable (p) | public-sharing config |

### `data/` — 162 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `object.zod.ts` | 20 | authorable | top-level already guarded (#1535); inner blocks partially strict |
| `data-engine.zod.ts` | 14 | wire (p) | engine contract shapes |
| `external-lookup.zod.ts` | 12 | mixed (p) | authored config + wire results |
| `seed-loader.zod.ts` | 12 | mixed (p) | seed file shapes are authored; loader state is runtime |
| `field.zod.ts` | 11 | authorable | partially strict |
| `filter.zod.ts` / `query.zod.ts` | 11+5 | open | query dialect — user data flows through; validated semantically elsewhere. `query.zod.ts` dropped one site in #4196: `FieldNodeSchema`'s nested-select object form was declared-but-inert and narrowed to `z.string()`, so the union's second member is gone. Four more left in #4286 with the `joins`/`windowFunctions` removals: `JoinNodeBaseSchema`, `WindowFunctionNodeSchema`, and `WindowSpecSchema`'s two blocks (outer + `frame`) were deleted with their clusters. Class unchanged |
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
| `field-value.zod.ts` / `seed.zod.ts` | 1+1 | mixed (p) | `seed` is strict (registered-types batch) |

### `automation/` — 88 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `flow.zod.ts` | 11 | authorable | **strict as of #4001** (4 schemas; `FlowVersionHistorySchema` is runtime — stays tolerant) |
| `sync.zod.ts` / `etl.zod.ts` | 12+10 | authorable (p) | authored pipelines — **candidates** |
| `execution.zod.ts` | 13 | wire | run-state envelopes — never strict. +5 at #4354 (the run-summary family: step metrics / skip reason / per-node / per-gate / the summary itself) — engine-emitted telemetry read by the Console and by operator queries, nobody authors them, so the `wire` verdict covers them unchanged |
| `state-machine.zod.ts` | 7 | authorable (p) | |
| `control-flow.zod.ts` | 6 | authorable (p) | validated structurally by `validateControlFlow` |
| `bpmn-interop.zod.ts` | 5 | wire (p) | interop import shapes |
| `approval.zod.ts` | 4 | authorable | **strict as of #4001 step 3** — all four authoring schemas (node config / approver / escalation / decision-output). The published JSON schema carries `additionalProperties: false` into the Studio form AND `registerFlow()` config validation (#4027/#4040), so an unknown key in an approval node's `config` is rejected at registration too — verified: `z.toJSONSchema` on the strict lazySchema does not throw (#3746 hazard checked) |
| `node-executor.zod.ts` | 4 | wire | executor contract |
| `io-node-config.zod.ts` | 2 | authorable | `NotifyConfigSchema` / `HttpConfigSchema` (#4045) — the sibling contracts that validate the **open** `config` slot on flow `notify` / `http` nodes. Authored per-node, so the open-slot exemption above does not extend to them; candidate once the executors' own drift is verified |
| `builtin-node-config.zod.ts` | 8 | authorable | Same family (#4045): the CRUD quartet, `screen`, `map`. Written from what the executors read rather than from the descriptors' `configSchema` literals, and reconciled bidirectionally by `builtin-node-form-zod-ledger.test.ts` — so unlike most rows here, this one already has a drift check of its own. Same candidacy note as `io-node-config` |
| `schemaless-node-config.zod.ts` | 4 | authorable | Same family, third panel (#4278): `script` / `subflow` / `decision` (+ the decision branch item) — the descriptor-schemaless nodes whose form lives in objectui's hand-written table. Written from the executors; the drift check is objectui's `flow-node-config.spec-reconciliation` test (cross-repo, via the published exports). Since #4343 `script` and `subflow` ARE parsed at execute time (`parse-config.ts`) — `script` once retiring its `actionType` branches left it flat — so strictness candidacy now follows `io-node-config` on the same terms rather than being moot; `decision` stays export-only |
| `webhook.zod.ts` | 1 | authorable (p) | spec-only (#3461) |
| `flow-function.zod.ts` | 1 | authorable | `FlowFunctionDeclarationSchema` (#4396) — the `{ handler, effect }` form of a `defineStack({ functions })` entry. Authored, but note what an undeclared key here would be: a sibling of a **live function**, not data. `defineStack`'s union already rejects a record whose `handler` is not callable, and the boot-path reader is the hand-written `normalizeFlowFunctionEntry` rather than a `.parse()` (re-validating a live handler every boot buys nothing), so strictness would bind at authoring only. Candidate on the same verify-first rule as its `*-node-config` neighbours |

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

## Other directories (coarse; classify per schema before touching)

| Dir | Sites | Dominant class | Rationale |
|---|---|---|---|
| `api/` | 426 | wire | REST/GraphQL request/response contracts — tolerant by design |
| `system/` | 383 | mixed | manifest/datasource blocks are authored; runtime envelopes are wire |
| `kernel/` | 351 | wire | plugin/kernel contracts, code-to-code |
| `cloud/` | 83 | wire | multi-tenant runtime |
| `ai/` | 75 | mixed | agent/tool/skill definitions authored (partially strict already); model/provider payloads wire |
| `integration/` | 64 | wire | connector payloads — upstream adds fields freely |
| `identity/` | 34 | mixed | position/user shapes authored (`PositionSchema` **strict as of #4001 step 2**, with the ADR-0010 envelope declared); auth payloads wire |
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
