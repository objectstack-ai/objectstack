# hotcrm's 69,419 hand-written test lines, split three ways

Audit for objectstack-ai/objectstack#15418. Measured read-only against
`objectstack-ai/hotcrm` at `71a3452` (the 17.3.0 upgrade merge). No hotcrm file
was modified and no test was deleted, rewritten or reclassified in place — this
document is the whole deliverable.

Every file was read. Nothing was classified by filename; where the card's
starting hypothesis and the file's contents disagree, the contents win and the
disagreement is recorded in [Corrections](#corrections-to-the-cards-starting-hypothesis).

## 0. The measurement basis

`test/` reproduces the card's census exactly: **69,419 lines across 169 files**
(160 `*.test.ts` plus 9 helpers). Stated three ways, because the three are not
interchangeable:

| reading | lines | note |
|:--|--:|:--|
| raw lines (`wc -l`) | 69,419 | the card's figure |
| blank | 5,947 | |
| comment | 22,953 | 33.1% of the file — these suites document heavily |
| **code** | **40,519** | what actually executes |

For anything compared against the repository's positioning claim, this audit
uses **hotcrm's own ratchet rule** rather than a rule of its own:
`scripts/check-source-token-ratchet.mjs` `stripComments()`, blank-stripped,
`~tokens = chars / 4`. Running that script unmodified reproduces its published
`authored total ~135,830` for `src`, which is the check that the same rule is
being applied here. By that rule:

| scope | ~tokens |
|:--|--:|
| `src` authored total (the ratchet's own scope) | 135,830 |
| `src/translations` + `src/data` (outside the ratchet by maintainer ruling) | 93,192 |
| **`test/`** — not in any ratchet | **466,587** |

`test/` is **3.4x** the authored `src` surface the positioning claim is measured on.

## 1. Bucket totals

| bucket | lines | share | ~tokens |
|:--|--:|--:|--:|
| **(1)** platform should derive it, hand-written today | **20,505** | 29.5% | 129,752 |
| **(2)** genuinely the app's own business judgement | **28,242** | 40.7% | 208,252 |
| **(3)** grey zone — platform behaviour, app carries the cost | **15,265** | 22.0% | 97,972 |
| **(4)** undecided | **5,407** | 7.8% | 30,610 |
| total | 69,419 | 100% | 466,587 |

Bucket (1) breaks into six derivation families. This split is the roadmap, so it
is reported rather than folded away:

| family | lines | ~tokens | the question it asks |
|:--|--:|--:|:--|
| **(1f)** docs to metadata consistency | 9,851 | 59,892 | does the prose name what the app ships? |
| **(1a)** metadata referential integrity | 4,344 | 29,297 | does every name in the metadata resolve? |
| **(1b)** predicate totality and dialect | 3,415 | 21,857 | can every authored CEL predicate return a verdict? |
| **(1d)** i18n completeness | 1,078 | 6,314 | is every authored surface translated, and does every key resolve? |
| **(1c)** authorization / sharing coverage | 968 | 6,968 | is every object reachable by somebody, and is every declared rule seeded? |
| **(1e)** liveness (declared-but-inert) | 849 | 5,424 | does every declared key have a writer and a reader? |

Bucket (4) is two different things and they are kept apart:

| | lines | why it is not (1), (2) or (3) |
|:--|--:|:--|
| **(4t)** repo and tooling hygiene | 5,172 | tests of hotcrm's *own* scripts, gates and CI config (`check-source-hygiene`, `check-source-token-ratchet`, `check-lint-i18n-gate`, `scan-field-consumers`, `.github/labeler.yml`, the docs workflow path filter, the docs anchor linter and its helpers). Not business judgement, not metadata self-consistency, and not platform behaviour — a fifth family the three-way taxonomy has no slot for. The platform will never derive these; they are the cost of a repo shipping its own gates. |
| **(4)** genuinely ambiguous | 235 | one describe: `forecast-current-quarter-view` / *"no view label promises a time scope its filter does not express"*. A platform could mechanically check that a view whose label carries a period token has a filter expressing it — but deciding that the label **"This Quarter"** promises a quarter requires reading the label as language. Derivable in principle, not derivable without natural-language understanding of an app-authored string. Left undecided rather than forced. |

## 2. Bucket (1) minus what `os verify` derives today

`packages/verify/src/derive.ts` and `rls.ts` are the whole derivation surface,
and they derive exactly two app-agnostic proof families:

1. **CRUD round-trip / type fidelity** (`deriveCrudCases` + `runCrudVerification`) —
   per object, synthesize a record from the declared field types, POST it, GET it
   back, assert type fidelity; required relations are threaded in topological
   order; unsatisfiable shapes are reported `blocked` with a reason.
2. **RLS cross-owner invariant** (`runRlsProofs`) — *"a user who cannot read a
   record must not be able to write it"*, fanned out one persona per declared
   position.

(The package also exports `checkLedger`, `checkReadCoercion` and
`checkDateBucketParity`. None of the three derives anything from an app's
metadata — they are the platform's own conformance helpers over its property
ledger and its drivers — so none of them subtracts from bucket (1).)

**The subtraction is zero. The remainder is the whole of bucket (1): 20,505
lines, ~129,752 tokens.**

Two independent reasons, and they agree:

- **As deployed.** hotcrm does not depend on `@objectstack/verify` at all. It is
  absent from `package.json`, and `runCrudVerification`, `runRlsProofs` and
  `deriveCrudCases` return zero hits across the repository. hotcrm's own
  `pnpm verify` is a locally-composed script — `validate && typecheck && lint &&
  lint:i18n-gate && hygiene && hygiene:tokens && build && test` — that never
  invokes the platform's derived proofs.
- **As capability.** Even if hotcrm wired it in tomorrow, no bucket-(1) line
  would become redundant. There is no per-object CRUD round-trip test anywhere
  in hotcrm's 160 files, and the RLS invariant asks a different question from
  hotcrm's (1c) coverage guards: `os verify` probes for runtime record-scope
  holes, while (1c) asserts statically that every registered object appears in
  some permission set and that every declared sharing rule is actually seeded.
  The two do not overlap in either direction.

So `os verify` today derives two families hotcrm never asked for, and none of
the six families hotcrm hand-writes 20,505 lines for.

### On the #15210 hypothesis

The card asks whether bucket-(1) tests predate or postdate the multi-package
path that derived zero cases and reported success (#15210, fixed by #15229 /
PR #15281). The history does not support that explanation for hotcrm:

- Every bucket-(1) file was added between **2026-07-27** and **2026-08-17**
  (`metadata-references` 07-27, `authorization-coverage` 07-30,
  `object-validation-predicates` 07-31, `sharing-coverage` 08-02,
  `flow-condition-totality` and `flow-variable-conditions` 08-03,
  `i18n-references` 08-06, `docs-view-rosters` 08-17).
- #15210 was filed **2026-09-04**, three to six weeks later, and describes a
  *multi-package* composed config. hotcrm is a single-package app, so that path
  is not even reachable from it.

The honest reading is simpler than "the derived half could not be trusted":
**the derived half was never offered to this app.** hotcrm hand-wrote these
guards because nothing else was going to make the assertion, not because the
platform's version of it was broken.

## 3. The derivation roadmap bucket (1) implies, heaviest first

Ranked by measured demand. Line rank and token rank agree except for (1c)/(1d),
which swap; both are given.

| # | capability | lines | ~tokens | what `os verify` would have to grow |
|--:|:--|--:|--:|:--|
| 1 | **docs-to-metadata roster consistency** | 9,851 | 59,892 | Accept the app's docs corpus as a second input and check that every roster, count, name and navigation path in prose resolves against the registered stack — per locale. Nearly half of bucket (1). It is also the family furthest outside `os verify`'s current remit: it needs a docs surface the platform does not read today. Nineteen whole files plus most of `sharing-coverage`. |
| 2 | **metadata referential integrity** | 4,344 | 29,297 | Resolve every name a page, view, action, nav entry, dashboard, dataset, import mapping, skill or AI binding mentions against the objects, fields, options, profiles, agents and tools the app really declares. `os validate` checks shape; nothing checks that the names inside the shape exist. Closest to what the platform already does, and the cheapest first win. |
| 3 | **predicate totality and dialect** | 3,415 | 21,857 | For every authored CEL predicate — object `validations[]`, record-change flow conditions, flow-variable conditions, view predicates — prove it returns a verdict for every record shape its trigger can hand it (`has()` guards, `!= null` on orderings, `record.`-bound reads). Four files, all of them written as explicit "HOUSE RULE" suites because the failure is silent: an unguarded predicate does not error, it simply never fires. |
| 4 | **i18n completeness** | 1,078 | 6,314 | Every authored surface translated in every declared locale; every translation key resolving to something that still exists. Cheap to derive, and the failure is user-visible (a raw stored value rendered mid-screen). |
| 5 | **authorization / sharing coverage** | 968 | 6,968 | Every registered object appears in some permission set (they are explicit-allow only, so an ungranted object is denied for everyone including admins); every reachable UI surface is granted to somebody; every declared sharing rule is actually seeded and executes rather than merely compiling. Partly adjacent to today's RLS prover, but a different question. |
| 6 | **liveness / declared-but-inert** | 849 | 5,424 | A declared field, option set or rule with no writer and no reader; a removal that left a reader behind; a placeholder picklist shipped as production metadata. The platform already owns this concept for its own spec (ADR-0049 enforce-or-remove, the liveness ledger); bucket (1e) is that same discipline applied to an app's metadata, hand-rolled. |

## 4. The honest reading of the size claim

The repository description says *"a complete CRM in under 150k tokens, one
context window. Agents read it whole, reason it whole, refactor it whole."*

What that number measures today, and what it leaves out:

| reading | ~tokens | vs. the 150k claim |
|:--|--:|:--|
| `src` as the ratchet scopes it (minus `src/translations`, `src/data`) | 135,830 | fits |
| all of `src`, including translations and seed data | 229,022 | 1.5x |
| `src` (ratchet scope) + the tests the app cannot avoid — **floor** | **344,082** | **2.3x** |
| `src` (ratchet scope) + everything still hand-written after (1) is derived — **ceiling** | **472,664** | **3.2x** |
| everything in `src` and `test` today | 695,609 | 4.6x |

The floor assumes the platform derives all of bucket (1) **and** absorbs every
last line of bucket (3) — the most generous assumption available. The ceiling
assumes it derives bucket (1) only, leaving (3) and (4) with the app.

**The number to quote is the floor: ~344,000 tokens.** `src` at 135,830 plus
bucket (2) at 208,252 — the business judgement no platform can make on this
company's behalf: what a discount ceiling is, who a case goes to, how won and
lost are booked, what the SLA matrix says, what the demo data must show.

That is 2.3x the claim, and it does not fit one context window. An agent that
"holds the app whole" at 135,830 tokens is holding the metadata and none of the
208,252 tokens that say what the metadata must do.

### Why bucket (3) is given as a range rather than a split

The card asks for "any of (3) the platform will never absorb". That line cannot
be measured from the test text — it depends on platform roadmap decisions that
have not been made. What can be stated:

- **4,069 lines are unambiguously absorbable**: the harness family
  (`helpers/flow-harness`, `helpers/hook-harness`, `helpers/action-sandbox`,
  `helpers/tenancy-probe`, and the four suites that exist only to prove those
  stand-ins match the engine — `flow-harness-declared-columns`,
  `harness-lookup-shape`, `hook-input-shape`, `hook-write-shape`,
  `hook-query-predicate`). Every line exists because the platform ships no
  first-party test harness, so each app hand-builds a stand-in and then
  hand-writes the proof that its stand-in has not drifted from the engine. A
  first-party harness deletes all of it.
- **The platform-semantics pins should be the platform's own regression tests**:
  spec-default `deleteBehavior` and `cascadeDeleteRelations` (three cascade
  files plus two cleanup files), tenant index materialization (two files), what
  `readonly: true` actually strips, driver datetime coercion, the cost of an
  undeclared key per driver, `{TODAY()}` token resolution, sharing write depth,
  console `record:details` rendering. Each is a fact about ObjectStack that
  hotcrm measured because nothing upstream had.
- **Some residue is permanent.** An app will always want *some* confidence that
  its own logic survives the real runtime, and the sandbox-duplication cost
  (`action-sandbox`, 976 lines — every action body asserted a second time
  because the runtime evaluates a lowered `body.source` under QuickJS rather
  than the closure the other suites run) is only partly recoverable.

Rather than invent a split point, the range is reported: the app's unavoidable
test surface is between **208,252 tokens** (bucket 2 alone) and **306,224**
(bucket 2 + bucket 3).

## 5. Corrections to the card's starting hypothesis

The card's candidates were formed from names and sizes and explicitly not
verified. Read against the files:

| file | lines | guessed | measured | note |
|:--|--:|:--|:--|:--|
| `hooks-runtime-service.test.ts` | 1,503 | (3) | **(2)** | **The one real miss.** The card's reason — *"assert what a hook does inside the platform's own sandbox"* — describes `action-sandbox.test.ts`, not this file. This one imports `helpers/hook-harness`, calls `hook.handler(ctx)` with the closure intact, and boots no sandbox and no engine. What it asserts is the app's own policy: the 8-hour SLA clock, which fields a guest submission may state, contract and campaign validation. That is business judgement, and it is the single largest file in the guess set. |
| `action-sandbox.test.ts` | 976 | (3) | (3) | Confirmed. It exists only because the runtime evaluates a lowered body string under QuickJS with a JSON-only boundary, so every body has to be asserted a second time. Textbook grey zone. |
| `metadata-references.test.ts` | 1,288 | (1) | (1a) 1,188 / (1b) 60 / (2) 40 | Confirmed. The 40-line tail is a retired-persona prose sweep, which is an app decision. |
| `sharing-coverage.test.ts` | 1,309 | (1) | (1f) 1,178 / (1c) 131 | Bucket right, family surprising: **90% of it is a docs test**, not a sharing test. Five of its eight describes check that the admin docs' OWD table, sharing-rules table and related-list table match the app in every locale. The name reads as authorization; the lines are documentation drift. |
| `docs-view-rosters.test.ts` | 1,095 | (1) | (1f) | Confirmed. Note 432 of the 1,095 lines are the file-level comment — reverse-verification evidence, not assertions. |
| `i18n-references.test.ts` | 866 | (1) | (1d) | Confirmed. |
| `quote-discount-ceiling.test.ts` | 898 | (2) | (2) | Confirmed — a ceiling is company policy, imported from `_thresholds`. |
| `case-assignment.test.ts` | 897 | (2) | (2) 683 / (3) 214 | Mostly confirmed. Two describes (214 lines) measure a platform premise — what the transfer gate can and cannot see of a `beforeInsert` `owner_id` stamp — rather than the app's routing. |
| `win-loss-capture.test.ts` | 857 | (2) | (2) 795 / (3) 62 | Mostly confirmed. 62 lines are the same assertion re-run on real SQLite purely because driver storage shapes differ. |

The card's at-a-glance (1) came to 4,558 lines. **Measured (1) is 20,505 — 4.5x
the guess**, and the two heaviest families in it (docs-to-metadata at 9,851 and
predicate totality at 3,415) appear nowhere in the starting set.

## 6. Method, and where it is soft

- Every one of the 169 files was read: file-level doc comment, imports, and
  `describe`/`it` titles for all of them, plus assertion bodies wherever the
  doc comment was not decisive (`metadata-references`, `docs-view-rosters`,
  `hooks-runtime-service`, `action-sandbox`, `sharing-coverage`).
- The classifying question is the card's: *could this assertion be written by
  something holding only the metadata, with no knowledge of this company?* Yes
  goes to (1); no goes to (2); *is the subject the platform's behaviour rather
  than the app's?* goes to (3).
- The operational rule for (3), since it is the one that needs one: **a test is
  (3) if it would still be needed had the app's business rules been entirely
  different** — its subject is a platform mechanism, or it is a second copy of
  an assertion forced to exist only because the platform runs the same code
  through a second execution path.
- **Splits.** 22 files straddle buckets and are split at top-level `describe`
  granularity, by line span. A file's preamble (imports and the file-level
  comment, which in these suites is often the largest single block) is allocated
  to that file's dominant describe bucket rather than prorated. Whole-file
  assignments carry the remaining 147 files.
- **Token attribution.** Per-bucket token figures prorate a split file's stripped
  token count by each bucket's line share of that file. Whole-file numbers are
  exact; per-bucket numbers inherit that approximation.
- **Softest calls, named so they can be checked rather than trusted:** the (1f)
  family as a whole (a docs-vs-metadata check needs no business knowledge, which
  makes it (1) by the card's test — but it needs an input surface `os verify`
  does not read, so an argument for filing it as (4) is available and was
  considered); `line-item-conventions` (authoring conventions, filed (1a));
  `dataset-granularity` (a metadata rule blocked on the platform, filed (1a));
  `territory-single-source` and `deal-threshold-parity` (single-source-of-truth
  guards over business constants, filed (2) because the constant is the
  business's, though the DRY shape is generic).

## Appendix A — per-file table

Buckets: (1a) referential integrity · (1b) predicate totality · (1c) authz
coverage · (1d) i18n · (1e) liveness · (1f) docs-to-metadata · (2) business ·
(3) platform · (4) undecided · (4t) tooling.

| file | lines | bucket | why |
|:--|--:|:--|:--|
| `test/account-name-normalized-match.test.ts` | 594 | **split** | (3) platform 337, (2) business 257 |
| `test/account-name-tenant-scope.test.ts` | 202 | (3) platform | field-level unique materializes as a tenant composite; declared index does not |
| `test/account-renewal-model.test.ts` | 128 | **split** | (1e) liveness 101, (2) business 27 |
| `test/action-references.test.ts` | 382 | (1a) referential integrity | every nav/action/dashboard reference resolves against real metadata |
| `test/action-sandbox.test.ts` | 976 | (3) platform | every action body re-asserted under the real QuickJS lowering |
| `test/actions-flows-integrity.test.ts` | 468 | **split** | (1a) referential integrity 288, (2) business 147, (3) platform 33 |
| `test/activity-recency.test.ts` | 377 | **split** | (2) business 297, (3) platform 80 |
| `test/activity-seed-coverage.test.ts` | 622 | (2) business | demo seed data makes every activity widget non-zero |
| `test/analytics-integrity.test.ts` | 259 | (1a) referential integrity | report/dashboard bindings resolve to real dataset measures; no frozen dates |
| `test/app-navigation-shape.test.ts` | 155 | **split** | (2) business 106, (1a) referential integrity 49 |
| `test/attendee-type-resolution.test.ts` | 495 | (2) business | app-invented attendee_type <-> attendee_resolves correspondence |
| `test/authorization-coverage.test.ts` | 750 | **split** | (1c) authz coverage 542, (2) business 208 |
| `test/automation-docs-coverage.test.ts` | 520 | (1f) docs to metadata | docs flow table lists every flow the app ships, per locale |
| `test/bulk-action-dispatch.test.ts` | 234 | (3) platform | the platform bulkActionDefs / aggregate dispatch contract |
| `test/campaign-member-cascade.test.ts` | 276 | (3) platform | spec-default deleteBehavior set_null + cascadeDeleteRelations |
| `test/campaign-member-lifecycle.test.ts` | 492 | (2) business | which member fields survive and who writes them |
| `test/cascade-guard-messages.test.ts` | 314 | **split** | (2) business 283, (3) platform 31 |
| `test/case-assignment.test.ts` | 897 | **split** | (2) business 683, (3) platform 214 |
| `test/case-create-form-narrowing.test.ts` | 331 | (2) business | which fields a case creator may legitimately author |
| `test/case-first-response.test.ts` | 241 | (2) business | what counts as a first response, and who stamps it |
| `test/case-guest-branch-leftovers.test.ts` | 309 | (2) business | what a guest submission may state on a case |
| `test/case-number-tenant-scope.test.ts` | 280 | (3) platform | declared-index scope + SQL NULL-distinct semantics |
| `test/case-sla-matrix.test.ts` | 290 | (2) business | SLA hours per priority x tier — company policy |
| `test/churn-health-score-block.test.ts` | 332 | (2) business | which signals the churn report reads |
| `test/collaboration-capabilities.test.ts` | 175 | (2) business | which objects get attachments / feeds |
| `test/contact-email-tenant-scope.test.ts` | 163 | (2) business | contact dedupe scope is the organization |
| `test/contract-write-depth.test.ts` | 428 | (3) platform | plugin-sharing write depth / getEffectiveScope per edition |
| `test/converted-lead-guard.test.ts` | 204 | **split** | (2) business 172, (1e) liveness 32 |
| `test/dashboard-date-range-window.test.ts` | 503 | (3) platform | driver-sql datetime coercion across storage shapes |
| `test/dataset-granularity.test.ts` | 224 | (1a) referential integrity | date-axis dimensions declare dateGranularity; table wired to real metadata |
| `test/deal-threshold-parity.test.ts` | 398 | (2) business | one definition of a "large deal" — a business constant |
| `test/decorative-field-sweep.test.ts` | 254 | **split** | (1e) liveness 157, (2) business 97 |
| `test/demo-staffing.test.ts` | 532 | (2) business | the demo org staffing table |
| `test/detail-section-dedup.test.ts` | 150 | (3) platform | console record:details / highlights de-duplication rules |
| `test/do-not-call-enforcement.test.ts` | 322 | (2) business | a compliance promise is enforced on the write |
| `test/docs-analytics-vocabulary.test.ts` | 428 | **split** | (1f) docs to metadata 342, (2) business 86 |
| `test/docs-anchor-links.test.ts` | 288 | (4t) tooling | docs anchors resolve — a docs-toolchain linter, not metadata |
| `test/docs-app-workflow-paths.test.ts` | 213 | (4t) tooling | CI workflow path filters cover what the job compiles |
| `test/docs-contact-email-uniqueness.test.ts` | 122 | (1f) docs to metadata | docs prose matches the declared+enforced uniqueness rule |
| `test/docs-conversion-rate-spelling.test.ts` | 122 | (2) business | editorial: the Chinese spelling of a metric name |
| `test/docs-dashboard-tiles.test.ts` | 546 | (1f) docs to metadata | docs tile roster matches shipped dashboard widgets |
| `test/docs-declared-versions.test.ts` | 653 | (1f) docs to metadata | docs/manifest/package version + protocol declarations agree |
| `test/docs-drift.test.ts` | 437 | (1f) docs to metadata | doc prose values extracted from flow source, asserted present |
| `test/docs-locale-callouts.test.ts` | 136 | (1f) docs to metadata | translated pages keep every callout the English page has |
| `test/docs-metadata-counts.test.ts` | 293 | (1f) docs to metadata | docs counts read from the registered stack, never hard-coded |
| `test/docs-object-coverage.test.ts` | 279 | (1f) docs to metadata | every business object has a user-facing docs page |
| `test/docs-object-term-consistency.test.ts` | 556 | (1f) docs to metadata | Chinese docs term == the language-pack label, per surface |
| `test/docs-pipeline-kanban-section.test.ts` | 243 | (1f) docs to metadata | kanban section pinned to the board metadata it describes |
| `test/docs-quick-tour-navigation.test.ts` | 637 | (1f) docs to metadata | quick-tour nav table pinned to crm.app.ts |
| `test/docs-readme-token-figures.test.ts` | 399 | (4t) tooling | README figures match the app own ratchet script |
| `test/docs-retired-personas.test.ts` | 189 | (2) business | the app decided to retire two personas; prose must follow |
| `test/docs-revenue-approvals-navigation.test.ts` | 622 | (1f) docs to metadata | approvals nav prose pinned to the app nav metadata |
| `test/docs-role-hierarchy.test.ts` | 310 | (1f) docs to metadata | docs do not teach a visibility hierarchy the positions model lacks |
| `test/docs-runnable-samples.test.ts` | 207 | (1f) docs to metadata | documented agent names resolve to a real platform agent |
| `test/docs-sales-index-navigation.test.ts` | 236 | (1f) docs to metadata | sales index section pinned to the Sales nav group |
| `test/docs-search-navigation-views.test.ts` | 264 | (1f) docs to metadata | docs built-in-view examples name views that exist |
| `test/docs-service-index-analytics.test.ts` | 261 | (1f) docs to metadata | service index bullets pinned to dashboards/reports metadata |
| `test/docs-setup-navigation-names.test.ts` | 743 | (1f) docs to metadata | docs cite console nav names the installed platform really ships |
| `test/docs-src-tree-paths.test.ts` | 388 | (4t) tooling | docs do not advertise directories the repo no longer has |
| `test/docs-view-rosters.test.ts` | 1,095 | (1f) docs to metadata | docs list-view rosters match shipped views, in all three locale faces |
| `test/docs-zh-hant-justification.test.ts` | 381 | (2) business | editorial convention needs a sanctioned reason beside it |
| `test/escalation-task-subject.test.ts` | 192 | (2) business | an escalation task is titled by case number |
| `test/event-attendee-cascade.test.ts` | 490 | (3) platform | same spec-default cascade defect on a second object |
| `test/field-consumer-scan.test.ts` | 318 | (4t) tooling | tests the app own scan-field-consumers script |
| `test/field-groups-coverage.test.ts` | 180 | (1a) referential integrity | every detail object groups its fields; group keys resolve |
| `test/flow-billing-handoff.test.ts` | 372 | (2) business | one billing delivery per transition, never per edit |
| `test/flow-campaign-enrollment.test.ts` | 189 | (2) business | enrollment eligibility + dedupe semantics |
| `test/flow-case-actions.test.ts` | 201 | (2) business | the two case screen-flow actions behave |
| `test/flow-cold-boot-rebind.test.ts` | 134 | (3) platform | the platform kernel:ready flow re-bind path |
| `test/flow-condition-totality.test.ts` | 650 | (1b) predicate totality | every record.x read in a flow condition carries has() / != null |
| `test/flow-conversion.test.ts` | 129 | (2) business | lead conversion dedupe branches route and converge |
| `test/flow-decision-authority.test.ts` | 336 | **split** | (1b) predicate totality 214, (3) platform 122 |
| `test/flow-escalation-ownerless-case.test.ts` | 205 | (2) business | escalation survives an ownerless case |
| `test/flow-filter-today-token.test.ts` | 521 | (3) platform | who resolves {TODAY()} — measured by executing it |
| `test/flow-followup.test.ts` | 76 | (2) business | follow-up task carries both halves of the polymorphic parent |
| `test/flow-harness-declared-columns.test.ts` | 542 | (3) platform | the app stand-in must match a real driver row shape |
| `test/flow-quote.test.ts` | 73 | (2) business | quote generation pricing + carry-over |
| `test/flow-record-change.test.ts` | 578 | (2) business | record-change flow start conditions |
| `test/flow-run-summary.test.ts` | 186 | (3) platform | adoption pin for the platform per-run summary |
| `test/flow-scheduled-org-partition.test.ts` | 963 | (3) platform | organization stamping on a genuinely user-less run |
| `test/flow-scheduled.test.ts` | 1,502 | (2) business | the scheduled business sweeps pick up the right rows |
| `test/flow-sla-ownerless-assignment.test.ts` | 309 | (2) business | who an ownerless breached case is assigned to |
| `test/flow-sla-ownerless-case.test.ts` | 226 | (2) business | the sweep survives an ownerless breach |
| `test/flow-variable-conditions.test.ts` | 1,272 | (1b) predicate totality | every flow-variable read is bound and guarded on every path |
| `test/forecast-current-quarter-view.test.ts` | 798 | **split** | (2) business 563, (4) undecided 235 |
| `test/forecast-manual-override.test.ts` | 337 | (2) business | a manual forecast suppresses the nightly sweep |
| `test/forecast-period-boundary.test.ts` | 420 | (2) business | a forecast starts on a calendar boundary |
| `test/forecast-period-end-boundary.test.ts` | 697 | (2) business | a forecast window ends on the calendar boundary too |
| `test/forecast-period-scope.test.ts` | 364 | (2) business | forecast aggregation must pin a period or double-counts |
| `test/forecast-seeds.test.ts` | 471 | (2) business | forecast seeds are calendar-true |
| `test/freeze-guard-reference-cleanup.test.ts` | 810 | (3) platform | a cascade reaches beforeUpdate looking exactly like a user edit |
| `test/global-actions.test.ts` | 661 | (2) business | the activity actions write real events with readable labels |
| `test/guest-submission-sanitisation.test.ts` | 314 | (2) business | what a guest web-to-case/lead submission actually stores |
| `test/harness-lookup-shape.test.ts` | 325 | (3) platform | the app harness must not be more permissive than the engine |
| `test/heading-label.test.ts` | 275 | (4t) tooling | tests the app own headingLabel() docs helper |
| `test/helpers/action-sandbox.ts` | 407 | (3) platform | wires the real QuickJS body runner |
| `test/helpers/docs-anchors.ts` | 286 | (4t) tooling | docs-toolchain helper |
| `test/helpers/flow-harness.ts` | 720 | (3) platform | a stand-in for the platform automation/data engine |
| `test/helpers/heading-label.ts` | 117 | (4t) tooling | docs-toolchain helper |
| `test/helpers/hook-harness.ts` | 618 | (3) platform | a stand-in for the engine hook context |
| `test/helpers/metadata-fixtures.ts` | 171 | (1a) referential integrity | the shared metadata derivations every bucket-1 guard uses |
| `test/helpers/persona-vocabulary.ts` | 62 | (4t) tooling | docs-toolchain helper |
| `test/helpers/repo-root.ts` | 15 | (4t) tooling | repo-path helper |
| `test/helpers/tenancy-probe.ts` | 86 | (3) platform | probes platform tenancy posture |
| `test/hook-input-shape.test.ts` | 472 | (3) platform | the engine hands a hook a flat-input Proxy, not a plain object |
| `test/hook-org-inheritance.test.ts` | 297 | (3) platform | the engine stamps organization_id from the execution context |
| `test/hook-query-predicate.test.ts` | 364 | (3) platform | the ctx.api predicate key is where, proven against the real kernel |
| `test/hook-write-shape.test.ts` | 535 | (3) platform | ctx.api update takes a document, not an id |
| `test/hooks-runtime-sales.test.ts` | 824 | (2) business | the sales hook bodies behave (lifecycle, freeze, drafting, guards) |
| `test/hooks-runtime-service.test.ts` | 1,503 | (2) business | the service/ops hook bodies behave — app logic on a hand-written harness |
| `test/hooks-runtime.test.ts` | 244 | (2) business | core hook arithmetic and skip guards |
| `test/hot-lead-threshold-parity.test.ts` | 319 | (2) business | one definition of a "hot" lead |
| `test/i18n-references.test.ts` | 866 | (1d) i18n completeness | every authored surface translated in every locale; every key resolves |
| `test/i18n-shared-widget-parity.test.ts` | 212 | (1d) i18n completeness | locale bundles do not re-fork one shared widget definition |
| `test/import-mappings.test.ts` | 256 | **split** | (1a) referential integrity 198, (2) business 34, (1f) docs to metadata 24 |
| `test/knowledge-article-share-links.test.ts` | 387 | (3) platform | ShareLinkService eligibility on the record-level CEL evaluator |
| `test/knowledge-deflection.test.ts` | 386 | (2) business | case<->article resolution link and the deflection metric |
| `test/knowledge-feedback.test.ts` | 317 | (2) business | article engagement counters have real writers |
| `test/labeler-config.test.ts` | 152 | (4t) tooling | .github/labeler.yml globs match real paths |
| `test/lead-disqualification.test.ts` | 136 | (2) business | a disqualification reason is required, not just documented |
| `test/lead-duplicate-link-cleanup.test.ts` | 630 | (3) platform | set_null default implemented as an UPDATE through the guard |
| `test/lead-duplicate-management.test.ts` | 569 | (2) business | soft dedupe — a returning prospect is recorded, not rejected |
| `test/lead-duplicate-visibility.test.ts` | 573 | (2) business | the duplicate flag reaches the two surfaces that can act on it |
| `test/line-item-cascade.test.ts` | 303 | (3) platform | set_null default escalated to restrict on a required lookup |
| `test/line-item-conventions.test.ts` | 256 | (1a) referential integrity | authoring-convention guards: expression tags, formula-of-formula, null-guards |
| `test/lint-i18n-gate.test.ts` | 194 | (4t) tooling | tests the app own check-lint-i18n-gate script |
| `test/live-work-predicate-parity.test.ts` | 406 | (2) business | one predicate for "no longer live work" across consumers |
| `test/metadata-references.test.ts` | 1,288 | **split** | (1a) referential integrity 1,188, (1b) predicate totality 60, (2) business 40 |
| `test/object-validation-predicates.test.ts` | 791 | (1b) predicate totality | every CEL validation predicate guards every field it reads |
| `test/opportunity-creation-date.test.ts` | 111 | (1e) liveness | duplicate creation stamp removed; platform owns created_at |
| `test/ownership-model.test.ts` | 487 | **split** | (1e) liveness 168, (2) business 113, (3) platform 105, (1a) referential integrity 101 |
| `test/parent-derived-reach.test.ts` | 353 | (3) platform | what controlled_by_parent actually reaches on the real stack |
| `test/persona-copy.test.ts` | 173 | (2) business | retired personas must not reach a screen from src/ |
| `test/placeholder-picklist-options.test.ts` | 136 | (1e) liveness | placeholder option sets never ship; retired field stays retired |
| `test/priority-rank-parity.test.ts` | 126 | (3) platform | two rank maps forced apart because QuickJS bodies cannot import |
| `test/quote-accepted-draft-defaults.test.ts` | 216 | (2) business | the drafted contract carries the ruled placeholder defaults |
| `test/quote-accepted-lookups.test.ts` | 337 | (2) business | an absent link is an absent key, never false |
| `test/quote-accepted-payment-terms.test.ts` | 264 | (2) business | negotiated terms carry over to the drafted contract |
| `test/quote-contact-required-when.test.ts` | 462 | (2) business | a quote may not be presented without a recipient |
| `test/quote-discount-ceiling.test.ts` | 898 | (2) business | the discount ceiling is company policy |
| `test/readonly-write-semantics.test.ts` | 773 | (3) platform | what readonly:true actually strips, per writer path |
| `test/record-id-not-in-prose.test.ts` | 387 | (2) business | no record id reaches a human in prose |
| `test/refusal-envelope.test.ts` | 350 | (3) platform | the platform refusal envelope, inlined per guard because bodies are lowered |
| `test/runtime-coverage.test.ts` | 169 | (4t) tooling | meta-guard: every hook/flow has a runtime test |
| `test/saas-composition.test.ts` | 397 | (2) business | the SaaS composition keeps/loses exactly what it should |
| `test/script-main-guard.test.ts` | 343 | (4t) tooling | tests the entry-point guards of the app own scripts |
| `test/seed-consistency.test.ts` | 589 | (2) business | seeded values already equal what the hooks would compute |
| `test/seed-validation-warnings.test.ts` | 264 | (2) business | which seed rows legitimately trip a warning validation |
| `test/sharing-coverage.test.ts` | 1,309 | **split** | (1f) docs to metadata 1,178, (1c) authz coverage 131 |
| `test/sharing-posture-declaration.test.ts` | 264 | (3) platform | ADR-0105 fail-closed tenancy posture in reduced harnesses |
| `test/sharing-seeding.test.ts` | 641 | **split** | (1c) authz coverage 295, (3) platform 231, (2) business 115 |
| `test/skills-integrity.test.ts` | 233 | (1a) referential integrity | skill tool names + cross-references resolve |
| `test/sla-at-risk-live-work.test.ts` | 229 | (2) business | a resolved case is not at risk |
| `test/sla-compliance-gauge.test.ts` | 367 | (2) business | the SLA gauge plots compliance, not its complement |
| `test/smoke.test.ts` | 83 | (1a) referential integrity | structural invariants over the compiled bundle |
| `test/source-hygiene-header-position.test.ts` | 274 | (4t) tooling | tests the app own source-hygiene script |
| `test/source-hygiene-scan-surface.test.ts` | 463 | (4t) tooling | tests the app own source-hygiene scan surface |
| `test/source-hygiene-size-advisory.test.ts` | 270 | (4t) tooling | tests the app own size-advisory band |
| `test/source-token-ratchet.test.ts` | 631 | (4t) tooling | tests the app own token-ratchet gate |
| `test/status-state-machines.test.ts` | 271 | **split** | (2) business 176, (1f) docs to metadata 95 |
| `test/territory-seed-coverage.test.ts` | 291 | (2) business | the demo data can actually exercise the territory rules |
| `test/territory-single-source.test.ts` | 383 | **split** | (2) business 289, (1f) docs to metadata 52, (1a) referential integrity 42 |
| `test/unassigned-case-triage-reach.test.ts` | 863 | (2) business | who really sees the unassigned-triage queue |
| `test/undeclared-key-probe.test.ts` | 345 | (3) platform | what a misspelled key costs, per driver |
| `test/verify-log-decoy-pin.test.ts` | 315 | (4t) tooling | no test may echo a gate failure marker into the verify log |
| `test/view-predicate-dialect.test.ts` | 428 | (1b) predicate totality | view predicates are record.-bound and total |
| `test/view-references.test.ts` | 720 | **split** | (1a) referential integrity 690, (2) business 30 |
| `test/view-tab-label-inert.test.ts` | 144 | (1e) liveness | an inert declared key (list.tabs[]) is never reintroduced |
| `test/win-loss-capture.test.ts` | 857 | **split** | (2) business 795, (3) platform 62 |
## Appendix B — describe-level detail for the 22 split files

| file | describe | lines | bucket | why |
|:--|:--|--:|:--|:--|
| `account-name-normalized-match` | premise: a flow template cannot fold a string | 146 | (3) platform | platform premise: templates cannot fold |
| `account-name-normalized-match` | premise: a formula field cannot be the match key | 29 | (3) platform | platform premise: formula not queryable |
| `account-name-normalized-match` | premise: no filter operator expresses normalize-then-exact on SQL | 51 | (3) platform | platform premise: no normalize-then-exact operator |
| `account-name-normalized-match` | crm_account.name_normalized is a machine-owned match key | 50 | (2) business | the app match-key design |
| `account-name-normalized-match` | crm_lead.company_normalized is the other half of the pair | 28 | (2) business | the app match-key design |
| `account-name-normalized-match` | account_protection folds name into name_normalized | 47 | (2) business | app hook behaviour |
| `account-name-normalized-match` | lead_duplicate_check folds company into company_normalized | 40 | (2) business | app hook behaviour |
| `account-name-normalized-match` | both folds run inside the QuickJS sandbox | 51 | (3) platform | re-asserted under the platform sandbox |
| `account-name-normalized-match` | acceptance: a case/whitespace variant reuses the same account | 92 | (2) business | the business acceptance criterion |
| `account-renewal-model` | the account-level renewal model is retired (#1181) | 61 | (1e) liveness | declared-but-inert fields removed, no reader left behind |
| `account-renewal-model` | renewal stays a contract-level process (#1181) | 27 | (2) business | where the renewal process lives is a business decision |
| `actions-flows-integrity` | action body ↔ schema field-name contracts | 41 | (1a) referential integrity | action body field names resolve against the schema |
| `actions-flows-integrity` | lead_conversion flow contracts | 51 | (1a) referential integrity | flow node field maps resolve |
| `actions-flows-integrity` | notify recipients resolve to real audiences | 21 | (1a) referential integrity | recipient names resolve to real audiences |
| `actions-flows-integrity` | line-item rollups keep parent totals in sync | 23 | (2) business | business arithmetic |
| `actions-flows-integrity` | lead conversion dedupes the contact too | 12 | (2) business | business dedupe |
| `actions-flows-integrity` | lead auto-assignment | 7 | (2) business | business assignment |
| `actions-flows-integrity` | search works via explicit searchableFields | 17 | (1a) referential integrity | searchable fields resolve |
| `actions-flows-integrity` | lead conversion is discoverable | 10 | (1a) referential integrity | the action is reachable from a surface |
| `actions-flows-integrity` | demo data is demo-ready | 60 | (2) business | demo data quality |
| `actions-flows-integrity` | flow notification templates stay within what the engine interpolates | 36 | (1a) referential integrity | template tokens resolvable by the engine |
| `actions-flows-integrity` | no action relies on the broken modal machinery | 33 | (3) platform | a platform machinery limitation |
| `actions-flows-integrity` | case escalation trigger does not fight the close action | 45 | (2) business | business interaction between two automations |
| `actions-flows-integrity` | record-change flows declare their execution identity (#684) | 64 | (1a) referential integrity | every record-change flow declares runAs |
| `activity-recency` | event_schedule_derive keeps start / end / duration coherent | 64 | (2) business | business: start/end/duration coherence |
| `activity-recency` | event_activity_bubble only fires for an interaction that happened | 115 | (2) business | business: what counts as an interaction |
| `activity-recency` | the task and event bubbles are the same bubble | 72 | (2) business | business: one bubble definition |
| `activity-recency` | the recency columns are writable by a non-system caller (#2948) | 80 | (3) platform | platform readonly-strip semantics (#2948) |
| `app-navigation-shape` | the app navigation keeps one exemplar of every nav-item kind (#1259) | 38 | (2) business | HotCRM-as-exemplar editorial policy |
| `app-navigation-shape` | the app navigation opens each destination once (#1259) | 49 | (1a) referential integrity | duplicate-destination detection is structural |
| `authorization-coverage` | object-level CRUD coverage | 36 | (1c) authz coverage | every registered object appears in some permission set |
| `authorization-coverage` | reachable UI is reachable for someone | 39 | (1c) authz coverage | every reachable surface is granted to somebody |
| `authorization-coverage` | record-level scope is authored, not implied | 81 | (1c) authz coverage | record scope is declared explicitly |
| `authorization-coverage` | field-level security resolves | 66 | (1c) authz coverage | FLS names resolve to real fields |
| `authorization-coverage` | row-level security policies are enforceable | 68 | (1c) authz coverage | RLS predicates are enforceable |
| `authorization-coverage` | sharing rules and positions line up | 151 | (1c) authz coverage | sharing rules name declared positions/objects |
| `authorization-coverage` | #488 regressions stay fixed | 76 | (2) business | named business regressions |
| `authorization-coverage` | allowExport tracks the app’s real export surfaces | 132 | (2) business | which surfaces may export is a business decision |
| `cascade-guard-messages` | a guard cannot tell a cascade from a direct write | 31 | (3) platform | the platform gives the guard no discriminator |
| `cascade-guard-messages` | deleting an account whose contact is still referenced | 100 | (2) business | the app refusal message names the right record |
| `cascade-guard-messages` | deleting a customer account with open opportunities | 47 | (2) business | the app refusal message names the right record |
| `case-assignment` | the transfer gate cannot see a beforeInsert owner_id stamp on crm_case | 97 | (3) platform | platform transfer-gate visibility premise |
| `case-assignment` | case_auto_assign | 139 | (2) business | round-robin intake assignment policy |
| `case-assignment` | the guest strip and the assignment are ordered, not merely coexisting | 65 | (2) business | app ordering of two app rules |
| `case-assignment` | unassigned_triage makes the empty-pool path visible | 80 | (2) business | the empty-pool norm is an app decision |
| `case-assignment` | the transfer gate on the UPDATE door: which escalation seam it can see | 117 | (3) platform | platform transfer-gate visibility premise |
| `case-assignment` | case_escalation_reassign | 338 | (2) business | escalation reassignment policy |
| `converted-lead-guard` | crm_lead declares no second converted-lead rule | 32 | (1e) liveness | a declared rule that can never fire is removed |
| `converted-lead-guard` | the hook is the guard that actually speaks | 124 | (2) business | the app lock behaviour |
| `decorative-field-sweep` | the decorative fields are gone from their objects (#1182) | 9 | (1e) liveness | declared-but-inert fields removed |
| `decorative-field-sweep` | every reader of a removed field went with it (#1182) | 80 | (1e) liveness | no dangling reader survives a removal |
| `decorative-field-sweep` | the account hierarchy was kept because it now has a consumer (#1182) | 38 | (2) business | the keep/remove verdict is a business call |
| `decorative-field-sweep` | the roll-up actually computes, and keeps computing (#1182) | 59 | (2) business | business arithmetic |
| `docs-analytics-vocabulary` | analytics/index states the counts and names the app really ships (#976 | 122 | (1f) docs to metadata | docs counts pinned to metadata |
| `docs-analytics-vocabulary` | the cube vocabulary retired with src/cubes/ is gone from the docs (#97 | 86 | (2) business | an app retirement decision swept through prose |
| `docs-analytics-vocabulary` | the source facts these pages now rest on (#976, #977) | 50 | (1f) docs to metadata | the metadata facts the prose rests on |
| `flow-decision-authority` | decision nodes state no predicate of their own | 91 | (1b) predicate totality | a structural house rule over flow metadata |
| `flow-decision-authority` | the mechanism, on the real engine | 122 | (3) platform | which of three sites the engine actually reads |
| `forecast-current-quarter-view` | no view label promises a time scope its filter does not express (#730) | 235 | (4) undecided | label-vs-filter semantics: derivable in principle, needs NL reading of the label |
| `forecast-current-quarter-view` | this_quarter_forecasts returns the current quarter, on the real engine | 124 | (2) business | business correctness of a shipped view |
| `forecast-current-quarter-view` | closing_this_quarter returns this quarter only, on the real engine (#7 | 168 | (2) business | business correctness of a shipped view |
| `sharing-coverage` | what a shared account carries into its related lists | 85 | (1c) authz coverage | sharing reach is computable from the declared rules |
| `sharing-coverage` | who can read a case they do not own | 46 | (1c) authz coverage | sharing reach is computable from the declared rules |
| `sharing-coverage` | the admin docs describe the sharing the app actually ships | 334 | (1f) docs to metadata | docs sharing prose pinned to metadata |
| `sharing-coverage` | the OWD table lists every registered object, in every locale | 240 | (1f) docs to metadata | docs roster vs registered objects, per locale |
| `sharing-coverage` | the built-in sharing-rules table lists what the app ships, in every lo | 132 | (1f) docs to metadata | docs roster vs shipped rules, per locale |
| `sharing-coverage` | the related-list table names the same account children on the Chinese  | 77 | (1f) docs to metadata | docs roster parity across locales |
| `sharing-coverage` | every locale states the parent-derived reach this release computes | 181 | (1f) docs to metadata | docs statement pinned to computed reach |
| `sharing-coverage` | every locale states the parent-derived reach on the profiles page | 58 | (1f) docs to metadata | docs statement pinned to computed reach |
| `sharing-seeding` | every declared sharing rule is actually seeded | 62 | (1c) authz coverage | declared != seeded is derivable from the rules |
| `sharing-seeding` | the territory rules match a declared value, not a country string | 115 | (2) business | which country maps to which territory is business |
| `sharing-seeding` | what a sharing condition may contain (platform compiler, measured) | 160 | (3) platform | the platform CEL->filter compiler surface, measured |
| `sharing-seeding` | every seeded rule EXECUTES on the configured driver, not merely compil | 79 | (1c) authz coverage | seeded rules execute, not merely compile |
| `sharing-seeding` | what the configured driver does with a compiled condition (measured) | 71 | (3) platform | driver behaviour on a compiled condition |
| `status-state-machines` | the new tables agree with the automation that drives them | 64 | (2) business | which status transitions are legal is business |
| `status-state-machines` | the admin docs roster matches the ledger | 95 | (1f) docs to metadata | docs roster vs the app state-machine ledger |
| `import-mappings` | import mappings — registration | 20 | (1a) referential integrity | mappings are registered |
| `import-mappings` | import mappings — every target is a real field | 31 | (1a) referential integrity | mapping targets resolve to real fields |
| `import-mappings` | import mappings — transforms the import path can execute | 59 | (1a) referential integrity | transforms the import path can execute |
| `import-mappings` | import mappings — a template CSV imports without hand-mapping | 34 | (2) business | the shipped template is business content |
| `import-mappings` | import mappings — the docs describe what ships | 24 | (1f) docs to metadata | docs vs mapping metadata |
| `metadata-references` | page component references resolve | 705 | (1a) referential integrity | page component refs resolve |
| `metadata-references` | formula fields are never used as query predicates | 59 | (1a) referential integrity | structural rule over field types |
| `metadata-references` | flow conditions reach the CEL engine | 60 | (1b) predicate totality | conditions are evaluable |
| `metadata-references` | object references outside views resolve | 50 | (1a) referential integrity | object refs resolve |
| `metadata-references` | forms can actually author the data the views depend on | 114 | (1a) referential integrity | form/view field agreement |
| `metadata-references` | page templates and record components stay inside their record context | 63 | (1a) referential integrity | record-context structural rule |
| `metadata-references` | form views do not declare a dead data provider | 46 | (1a) referential integrity | dead provider detection |
| `metadata-references` | app AI bindings resolve to a platform agent | 84 | (1a) referential integrity | agent names resolve |
| `metadata-references` | live UI copy does not name a retired copilot persona (#1002) | 40 | (2) business | an app retirement decision |
| `view-references` | view field references resolve | 50 | (1a) referential integrity | view field refs resolve |
| `view-references` | priority queues sort by urgency, not alphabetically | 30 | (2) business | what "urgency order" means is business |
| `view-references` | filter template tokens are resolvable | 132 | (1a) referential integrity | filter tokens resolvable |
| `view-references` | row colors and kanban groups key off real option values | 69 | (1a) referential integrity | option values resolve |
| `view-references` | every canonical opportunity stage reaches the UI that enumerates stage | 126 | (1a) referential integrity | stage enumeration completeness |
| `view-references` | every named list view is reachable | 82 | (1a) referential integrity | view reachability |
| `view-references` | objects reached only through a parent curate that related list | 100 | (1a) referential integrity | related-list curation is structural |
| `view-references` | a list offering the calendar switch says which field dates it | 87 | (1a) referential integrity | calendar view declares its date field |
| `ownership-model` | one ownership column, and it is  | 95 | (1e) liveness | a duplicate app-authored column beside the platform one |
| `ownership-model` | the transfer gate sees a hook’s ctx.api write, and not a beforeInsert  | 105 | (3) platform | platform transfer-gate semantics |
| `ownership-model` | allowTransfer is granted deliberately | 66 | (2) business | who may transfer is business |
| `ownership-model` | every owner-facing surface points at the one column | 101 | (1a) referential integrity | owner references resolve to one column |
| `ownership-model` | lead_auto_assign assigns the platform column | 47 | (2) business | app hook behaviour |
| `territory-single-source` | the authored tables produce a usable domain | 85 | (2) business | the territory mapping is business content |
| `territory-single-source` | the hook body carries the module mapping and no other | 103 | (2) business | app hook carries one mapping |
| `territory-single-source` | the metadata surfaces name declared territory values | 42 | (1a) referential integrity | territory values resolve |
| `territory-single-source` | the documentation tables are rendered from the mapping | 52 | (1f) docs to metadata | docs tables derived from source |
| `win-loss-capture` | the reason fields declare a conditional write contract | 46 | (2) business | when a reason is required is business |
| `win-loss-capture` | the write is REJECTED, not warned about (in-memory driver) | 108 | (2) business | the business rule actually blocks |
| `win-loss-capture` | the write is REJECTED on a real SQLite database too | 62 | (3) platform | re-run only because driver storage shapes differ |
| `win-loss-capture` | crm_case.resolution_required_for_closed is still live | 41 | (2) business | a sibling business rule stays live |
| `win-loss-capture` | every settled seed carries its reason | 92 | (2) business | seed data satisfies the business rule |
| `win-loss-capture` | win rate is measured, and both halves are load-bearing | 286 | (2) business | win-rate definition is business |
| `win-loss-capture` | the shipped seeds produce a real win rate and a real loss breakdown | 143 | (2) business | demo data quality |