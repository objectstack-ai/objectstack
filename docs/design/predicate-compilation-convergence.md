# Design / Cost Account — Predicate Compilation Convergence

**Card**: [#5930](https://github.com/objectstack-ai/objectstack/issues/5930) — the investigation the maintainer approved in principle on 2026-08-14 (comment `5293341484`), dispatched 2026-09-29.
**Governed by**: [ADR-0053](../adr/0053-date-and-datetime-semantics.md) (D-A1, D-D1, D-E3) · [ADR-0058](../adr/0058-expression-and-predicate-surface.md) (D1, D6) · [ADR-0112](../adr/0112-error-code-vocabulary-and-ledger.md) (refusal envelopes)
**Status**: proposal. This document measures and recommends. ⛔ It decides nothing: the build decision is the maintainer's.
**Anchor**: every count, `file:line` and probe reading below was taken on objectstack commit `3711e0b763` (`origin/main` at dispatch, 2026-09-29) unless the line names another commit.

The scope, verbatim from the maintainer's approval and the triage wake that started it:

> **the predicate-compilation convergence INVESTIGATION is approved in principle** — scope: evaluate shape A (shared semantic tree, dialect-only compilers) using the #5977-validated pattern as the candidate form, deliverable = design + cost account, not a build.

> **交付物**:一份**设计 + 成本账**,⛔ 不是实现
>
> **评估对象**:形态 A —— 共享语义树,各编译器只管方言。用 #5977 已验证过的那个模式(把守卫下沉进树结构后,3 个消费者零改动同时对齐)作候选形态

---

## 0. The answer in brief

- **Census (§1).** Eleven faces turn a `FilterCondition` into SQL, a query document or a boolean, through 15 source files. One of them (F10) builds its own tree and compiles it three times. The card counted 5 faces plus one half in August.
- **The refusal half has already converged; the lowering half has not (§1.3).** About ten shared doors in `@objectstack/spec`, `@objectstack/core` and `@objectstack/objectql` decide what a filter may say, and they run at six seams. What a filter *means* is still hand-copied. The NULL-polarity helpers exist in 4 copies, and the whole-day upper-bound rule is called from 10 face files (41 call sites).
- **The measured tax (§2).**
  - The `$empty` ruling took 4 cards, 4 PRs and 13 dev rounds, and edited 13 distinct face files.
  - The last-supported-day ruling took 2 cards, 2 PRs and 3 rounds, and edited 10 distinct face files.
  - The temporal-comparand ruling was enforced at a shared seam. It took 1 PR and 1 round, and edited 0 face files.
  - In the 46 days since the approval, 22 commits on `main` edited 3 or more face files. By subject, 18 of them are filter semantics.
- **#6050 re-check (§2.4).** Measured at each face's own entry point, the `undefined`-comparand split is still there. Four faces answer an `undefined` comparand, each in its own way, and `driver-mongodb` passes it to the wire. Every production path I traced now refuses it at a shared door, except the `driver-memory` cube face. That face is a published export, and it runs no door.
- **Shape A holds (§3).** #5977 put the NULL guard into service-analytics' shared tree, and its three compilers aligned with no edits. The same package keeps its whole-day rule in the emitters, and PR #20643 had to edit three of its files for that rule.
- **Recommendation (§5): a smaller first slice.** Build one shared semantic lowering (`FilterCondition` → `FilterCondition`) beside the existing doors, and run it at the seams that already run them. It would hold `$between`, the whole-day bound including the last supported day, and the NULL-polarity guards. The per-face copies would then be deleted lane by lane. This is not the full typed-IR build, and it adds no new gate. It does require an amendment to ADR-0053 D-D1.

---

## 1. Census — every face that turns a `FilterCondition` into a predicate (H1)

### 1.1 The faces

Vocabulary is counted against the 19 field operators an author can write. That is the 17 of `FILTER_OPERATORS` plus `$like` / `$ilike`, which `StringOperatorSchema` declares while they are staged out of that array.

| # | Face | Entry (`file:line`) | Read path it serves | Field operators | Shared comparand doors it runs itself |
|---|---|---|---|---|---|
| F1 | `driver-sql` | `SqlDriver.applyFilters` → `compileFilters` → `applyFilterCondition` (`sql-driver.ts:16350` / `16462` / `16789`) | `find`/`findOne`, `count`, `aggregate`, `distinct`, `updateMany`, `deleteMany`, `findWithWindowFunctions`, `analyzeQuery` on PostgreSQL, MySQL and SQLite. `driver-sqlite-wasm` and `driver-turso` local/replica mode inherit it (`extends SqlDriver`). | 19/19, plus `$and`/`$or`/`$not` and `$field` | none (relies on the engine seam); calls `reduceFilterVerdict`, `isAcceptedFilterComparand`, `expandEmptyOperator` |
| F2 | `driver-turso` remote | `TursoDriver.toRemoteFilter` (`turso-driver.ts:2566`, a lowering pass) → `RemoteTransport.buildWhereSQL` / `compileWhereSQL` (`remote-transport.ts:2852` / `2896`) | remote-mode `find`, `count`, `aggregate`, `distinct`, `updateMany`, `deleteMany` | 18/19 (`$between` is lowered before the transport) | none; calls `isAcceptedFilterComparand`, `expandEmptyOperator` |
| F3 | `driver-memory` query path | `InMemoryDriver.convertToMongoQuery` (`memory-driver.ts:1334`) → mingo `Query`, behind `assertFilterConditionShape` (`filter-refusal.ts`) | `find`/`findOne`, `count`, `distinct`, `aggregate`, `updateMany`, `deleteMany` | 19/19 | none (relies on the engine seam) |
| F4 | `driver-memory` reference matcher | `match()` (`memory-matcher.ts:43`) | **no production caller.** It was not exported from the package index, and 20 test files imported it. **Retired** under D6 by commit `8fec76a2b`: `memory-matcher.ts` is deleted, and the tests that imported it assert on F3, the shared gate or the spec predicate. | 19/19 | none |
| F5 | `driver-memory` cube face | `MemoryAnalyticsService.query` / `generateSql` → `normalizeFilters` (`memory-analytics.ts:910` / `1389` / `1501`) → mingo `$match` and echo SQL | the published `@objectstack/driver-memory` export. No in-repo door constructs it (recorded on #20661). | 12/19 (no `$between`, `$startsWith`, `$endsWith`, `$null`, `$empty`, `$like`, `$ilike`); `$and` is its only combinator | **none** — see §2.5 |
| F6 | `driver-mongodb` | `translateFilter` (`mongodb-filter.ts:805`); the aggregation `$match` reuses it (`mongodb-aggregation.ts:556`) | all CRUD verbs and `aggregate` | 17/19 (no `$like`/`$ilike`) | none (relies on the engine seam) |
| F7 | `formula` | `matchesFilterCondition` (`matches-filter.ts:322`) | the RLS `check` on a write's post-image (`security-plugin.ts:3215`), the tenant check (`:3519`), the explain engine (`explain-engine.ts:964`), and F8's scalar comparisons (`having-filter.ts:1155`) | 19/19 | none (the RLS compile seam runs the doors first) |
| F8 | `objectql` `having` / per-aggregation filter | `applyHaving` / `matchesHaving` / `matchesAggregationFilter` (`having-filter.ts:1167` / `1190` / `1244`) | `ObjectQL.aggregate`: `having` (`engine.ts:16608`, `16652`) and in-memory `aggregations[i].filter` | 17/19 (no `$like`/`$ilike`) | the engine runs both doors on `having` and on each `aggregations[i].filter` first (`engine.ts:16387`, `16470`) |
| F9 | `service-analytics` read scope | `compileScopedFilterToSql` (`read-scope-sql.ts:747`) | the RLS/tenant scope merged into the NativeSQL statement (`native-sql-strategy.ts:668`) and into the `/analytics/sql` echo (`objectql-strategy.ts:578`); also a published export | 17/19 (no `$like`/`$ilike`) | `assertListComparandShapes`, `normalizeFilterComparandTypes` (`read-scope-sql.ts:982`) |
| F10 | `service-analytics` `where` → tree | `normalizeAnalyticsFilterTree` (`filter-normalizer.ts:2356`) builds a `NormalizedFilterNode`, which three compilers read (F10a–c) | widget and dataset `where` | 17/19 (`$like`/`$ilike` refused) | both, through `normalizeWhereComparands` (`filter-normalizer.ts:2218`) |
| F10a | ↳ NativeSQL | `compileFilterNode` / `buildFilterClause` (`native-sql-strategy.ts:1061` / `1114`) | the SQL that executes | (the tree's) | — |
| F10b | ↳ echo | `renderFilterNodeSql` / `buildFilterClauseSql` (`objectql-strategy.ts:1651` / `1260`) | the `/analytics/sql` echo | (the tree's) | — |
| F10c | ↳ engine hand-off | `filterNodeToCondition` (`objectql-strategy.ts:1602`) | a `FilterCondition` handed back to the engine, which F1, F3 or F6 then compile a second time | (the tree's) | — |
| F11 | `service-analytics` draft preview | `evaluateAnalyticsQueryOverRows` → `matchesWhere` (`preview-evaluator.ts:640` / `325`) | the draft-preview branch of `queryDataset` (`analytics-service.ts:1819`), reached through REST `?preview=` (`rest-server.ts:5872`) | 10/19 (`$eq $ne $gt $gte $lt $lte $between $in $nin $contains`); the rest are refused | both, through `normalizeWhereComparands` (`preview-evaluator.ts:665`) |

The 15 source files are `sql-driver.ts`, `turso-driver.ts`, `remote-transport.ts`, `memory-driver.ts`, `filter-refusal.ts`, `memory-matcher.ts` (deleted since, by commit `8fec76a2b`), `memory-analytics.ts`, `mongodb-filter.ts`, `matches-filter.ts`, `having-filter.ts`, `read-scope-sql.ts`, `filter-normalizer.ts`, `native-sql-strategy.ts`, `objectql-strategy.ts` and `preview-evaluator.ts`. §2 uses this list as its "face files".

### 1.2 Against the card's table

- **Named by the card:**
  - F1;
  - F2's transport half;
  - F9;
  - F10, which the drivers seat's correction (`5205970996`) split into F10a / F10b, plus F10c;
  - F7;
  - F8, named as 「第六个半」.
- **Never named:**
  - **F2's lowering half.** `TursoDriver.toRemoteFilter` puts comparands into storage form, applies the whole-day rule and lowers `$between` before the transport sees the filter. Its own comment says "`RemoteTransport` stays the dumb SQL builder it is documented to be". It is a small shape A that already exists.
  - **F3, F4 and F5.** `driver-memory` has three faces, not one.
  - **F6.** The card named it only to exclude it.
  - **F11.** The preview evaluator appears neither in the card nor in the correction.
  - **F8's second half.** This is the per-aggregation `filter` walker (#20122).
- **Out of the census, because they are not faces:**
  - front ends that *produce* a `FilterCondition`: `compileCelToFilter`, `parseFilterAST`, the REST view-filter-rule lowering and `rls-compiler.ts`;
  - static analysers that model the faces: `lint`'s `validate-rls-predicate-enforceability.ts`;
  - filters that are not a `FilterCondition`: knowledge-memory's metadata equality, realtime subscription options and metadata watch filters.
- **NOT MEASURED:** the sibling repositories (`objectui`, `cloud`). No checkout was available in this container.

### 1.3 The shared layer that exists today — refusal is shared, meaning is not

Since August, most of the *refusal* half has moved into shared modules:

| Rule | One definition | Where it runs |
|---|---|---|
| boolean identities (`$and: []`, `$or: []`, `$not: {}`) | `reduceFilterVerdict` (spec `filter-verdict.ts`, #5659) | inside F1, F4 and F6 (and the flow linter) |
| comparand shape (list operators, the equality slot, the `$ne` slot) | `assertListComparandShapes` (spec `filter-comparand-shape.ts`) | the engine seam, the RLS compile seam, the read-scope door, the analytics `where` door, the preview door, `parseFilterAST` and the save door |
| comparand type, including `undefined` (ruling #7872) | `normalizeFilterComparandTypes` (spec `filter-comparand-type.ts`) | the same seams |
| a temporal comparand the column can read | core `isUninterpretableTemporalComparand` + objectql `temporal-comparand-door.ts` | the engine seam (plus the analytics raw-SQL decline) |
| number and text declared-type doors | spec + objectql door modules | the engine seam |
| `$empty`'s per-type row | `expandEmptyOperator` / `isEmptyFilterValue` (spec `filter-empty-operator.ts`) | called inside 9 faces |
| the `$like` pattern language, the ASCII fold | helpers in spec `filter.zod.ts` | called inside the faces |
| retired operators | `RETIRED_FILTER_OPERATORS` | the refusal text of 5 faces |
| the calendar day and the last supported day | `nextUtcCalendarDay` / `isUnboundedAbove` (spec `calendar-day.ts`, re-exported by core) | called inside 10 faces, 41 call sites |

The engine seam is already a *lowering* seam, not only a gate. `lowerWhereFilterArray` (`engine.ts:947`) runs six of these doors in sequence and returns a rewritten `where`: `narrowNumberComparands` and `normalizeFilterComparandTypes` rewrite comparands, copy-on-write.

The *meaning* half is still hand-copied, and these counts are measured:

- **The NULL-polarity quartet** (`nullValueSatisfiesOperator`, `operatorIsNullTotal`, `nullGuardForFieldSpec`, `nullSafeNegationOperand`) exists in 4 copies:
  - `sql-driver.ts:5052`, 67 non-comment code lines;
  - `remote-transport.ts:425`, 69 lines;
  - `read-scope-sql.ts:2158`, 67 lines;
  - `filter-normalizer.ts:1477`, 90 lines.

  That is 293 lines. The JS faces reach the same answer through two-valued evaluation, and F4 has its own `noValueSatisfiesNegation`.
- **The `undefined` refusal beside the door.** `assertDefinedComparands` exists in `sql-driver.ts:4682`, `remote-transport.ts:4365`, `read-scope-sql.ts:1607` and `filter-normalizer.ts:970`.
- **The whole-day upper bound.** It is called from 10 face files: `memory-driver` 8 call sites, `sql-driver` 5, `memory-analytics` 5, `native-sql-strategy` 4, `preview-evaluator` 4, `having-filter` 4, `mongodb-filter` 4, `turso-driver` 3, `objectql-strategy` 2 and `matches-filter` 2. F9 never calls it (§2.5).
- **The operator→SQL tables.** F10a's `opMap` / `likeShape` and F10b's `SCALAR_SQL_OPS` / `LIKE_SQL_OPS` are a declared pair: "they move together".
- **The `$between` lowering.** It is written separately in F2's lowering pass, in F10's normalizer, and in F1's own arm plus `calendarDayBetweenRewrite`.

### 1.4 The #5499 freeze does not put anything out of scope

The wake's census line excludes `driver-memory` / `driver-mongodb` 「按 #5499」. That freeze was dissolved on 2026-08-11:

- for `driver-mongodb` in comment `5249019855` on #5499;
- for `driver-memory` in comment `5252526378`: "this card's freeze is fully dissolved".

The spec records the same fact in `aggregation-conformance.ts`, and #5499's own thread logs six sightings of the dissolved freeze being cited as live. The census therefore includes F3–F6. F5 is a live face: PR #20714 edited it on the day of this dispatch.

Whether a build includes them is the maintainer's scope call (§6). For the recommended slice, the question mostly dissolves: F3 and F6 sit behind the engine seam, so they would receive the lowered filter without being edited.

---

## 2. The measured tax (H2)

### 2.1 Three recent rulings, counted face by face

Definitions used in this section:

- A **round** is one `os-dev-report` comment on the card, that is, one dev run that delivered a report.
- **Face files** are the 15 census files of §1.1, edited in source. Test files are not counted.

Everything below is read from the merged commits and the cards' threads.

| Ruling | Cards | PRs (commits) | Rounds | Face-file edits (distinct) | Shared files edited | What the rounds were spent on |
|---|---|---|---|---|---|---|
| `$empty` — ruling A on #20399 (#20311 declares it → #20445 analytics → #20444 engine faces → #20446 flip) | 4 | #20442 (7), #20498 (4), #20523 (7), #20570 (18) | 2 + 2 + 1 + 8 = **13** | 4 + 9 + 8 = 21 (**13 distinct**) | `filter-empty-operator.ts` and 5 other spec files | The operator stayed staged out of `FILTER_OPERATORS` until "one compile-surface lane card per face" had landed. #20446's rulings in rounds 2 and 3 were about *which faces hold a field declaration*: federated objects, an analytics host with no `sourceFieldMeta`, and harness tables no driver had declared. |
| Last supported day — #20600, then #20661 | 2 | #20643 (19), #20714 (3) | 2 + 1 = **3** | 10 + 1 = 11 (**10 distinct**) | spec `calendar-day.ts`, `temporal-conformance.ts`; core `datetime.ts` | Round 1 failed at tier because the new sentinel was typed twice across two declaration files. The fix then had to be narrowed at "17 direct call sites in 9 files, plus Turso's indirect one" (the seat's ACCEPT record `5894771815`, summarizing review `5894730557`). The same work found a tenth face whose own order of operations was wrong: F5 converted to storage form before widening. That became #20661. |
| Temporal comparand door — #20549 + #20480 | 2 | #20668 (2) | **1** | **0** | core `temporal-comparand.ts`, objectql `temporal-comparand-door.ts`, `record-validator.ts` | None. The rule lives at the engine seam, so the faces changed only in tests. |

And the pattern this investigation evaluates: #5977 (PR #6004, 7 files, 1 commit) moved the #5298 NULL guard into service-analytics' shared tree. It aligned three compilers with no edits to them.

### 2.2 The natural experiment

Over the same two days (2026-09-28 and 09-29):

- A rule enforced once at a shared seam cost 1 round and 0 face files.
- Two rules implemented at the emitters cost 3 and 13 rounds and 10 and 13 distinct face files.

Inside one package the contrast is sharper still. service-analytics keeps the #5298 NULL guard in its tree (`filter-normalizer.ts`), and #5977 cost its three compilers nothing. It keeps the whole-day rule in its emitters, and #20643 had to edit three of its files for that rule: `native-sql-strategy.ts`, `objectql-strategy.ts` and `preview-evaluator.ts`.

### 2.3 How often the tax is paid

`node scripts/pm/git-history.mjs log --since=2026-08-14 --ref=3711e0b763` gave 5,364 first-parent commits. The receipt reads "complete clone (no fetch)". Of those commits:

| edited face files | commits |
|---|---|
| ≥ 1 | 221 |
| ≥ 3 | 22 |
| ≥ 5 | 5 |
| face-file edits in all | 331 |

Of the 22 commits that edited three or more face files, 18 change filter-predicate semantics. The other 4 are driver-door, docs or aggregation work that happens to live in the same large files. That split is a reading of the commit subjects, not a measurement. The list is in Appendix B, and §4.3 classifies the 18 by what shape A would have done with them.

### 2.4 The #6050 re-check: an `undefined` comparand, face by face

Triage asked whether the split recorded on 2026-08-07 (`5214990870`) still holds. On that day `formula` read `undefined` as key-absent, `read-scope-sql` compiled `= NULL` and so answered zero rows, and `driver-memory` read `undefined` as `null`.

I ran #6125's fixture through every face at its **own** entry point, with no door in front. In the fixture, `d` holds a value on rows 1–2, is `null` on row 3, and is absent from row 4. The probe is described in Appendix A.

| Face (entry called directly) | `{d: undefined}` | `{d: {$eq: undefined}}` | `{d: {$ne: undefined}}` | `{$not: {d: {$ne: undefined}}}` | `{d: {$in: ['v1', undefined]}}` |
|---|---|---|---|---|---|
| spec door `normalizeFilterComparandTypes` | refused 400 | refused 400 | refused 400 | refused 400 | refused 400 |
| F1 `SqlDriver.find` (SQLite) | refused 400 | refused 400 | refused 400 | refused 400 | refused 400 |
| F2 `RemoteTransport.buildWhereSQL` | refused 400 | refused 400 | refused 400 | refused 400 | refused 400 |
| F3 `InMemoryDriver.find` | `[3,4]` | `[3,4]` | `[1,2]` | `[3,4]` | `[1]` |
| F5 `MemoryAnalyticsService.query` | `[3,4]` | `[3,4]` | `[1,2]` | refused 400 (no `$not`) | `[1]` |
| F6 `translateFilter` | passed through: `{"d":undefined}` | passed through | passed through | `{"$nor":[{"d":{"$ne":undefined}}]}` | passed through |
| F7 `matchesFilterCondition` | `[4]` | `[4]` | `[1,2,3]` | `[4]` | `[1,4]` |
| F8 `matchesHaving` (row walker alone) | `[3,4]` | `[3]` | `[1,2]` | `[3,4]` | `[1]` |
| F9 `compileScopedFilterToSql` | refused 500 `READ_SCOPE_COMPILE_FAILED` | refused 500 | refused 500 | refused 500 | refused 500 |
| F10 `normalizeAnalyticsFilterTree` | refused 400 | refused 400 | refused 400 | refused 400 | refused 400 |
| F11 `evaluateAnalyticsQueryOverRows` | refused 400 | refused 400 | refused 400 | refused 400 | refused 400 |

Every "refused 400" is `INVALID_FILTER` / 400.

**Reading:**

1. **Inside the faces, the split is still there, and it is wider than the August record.**
   - F7 still reads `undefined` as key-absent, as it did in August.
   - F3 still reads it as `null`, as it did in August.
   - F8 and F5 are two more readings, and F8 disagrees with F3 on `$eq`.
   - F6 hands `undefined` to the BSON encoder. How the server answers was NOT MEASURED, because there was no `mongod` here.
   - F9 moved from `= NULL` to a refusal (PR #6390).
2. **On the production paths, the split is masked by doors.** The comparand-type door (ruling #7872) now runs at each of these seams:
   - the engine seam: `where`, `aggregations[i].filter` and `having`;
   - the RLS compile seam, `judgeCompiledComparands` (`rls-compiler.ts:284`, #20212), which serves both `using` and `check`, so F7 never receives a policy comparand the door has not judged;
   - the analytics `where` and preview doors;
   - the read-scope door.

   I traced those paths. I did **not** exhaustively trace direct driver callers, the security tenant check (`security-plugin.ts:3519`) or the explain engine. For direct driver callers, the spec's comparand-type door says those drivers "inherit it by receiving already-validated input".
3. **One published face has no door in front of it: F5.** Its reading, `{d: undefined}` ≡ `{d: null}`, is confirmed by controls: no `where` answers `[1,2,3,4]`, `{d: 'v1'}` answers `[1]`, and `{d: null}` answers `[3,4]`. It is §2.5 item 2.

So the question's answer is: **yes, the faces still answer each in its own way, and the platform now hides it by refusing at the seams.** That is the state this document names "refusal converged, meaning not converged". A new entry point that skips a door, as F5 does, re-exposes the difference at once.

### 2.5 Divergences the census found

These were measured at the faces' published or internal entry points. None was measured at an HTTP door. They are reported to the seat for filing and are **not** filed from here.

1. **F9 has no whole-day upper bound, and it binds temporal comparands exactly as written.** `compileScopedFilterToSql({t: {$lte: '2026-07-28'}}, 't')` compiles to `"t"."t" <= ?` and binds `'2026-07-28'`. I ran it on SQLite over ISO-text rows at `2026-07-27T10:00Z`, `2026-07-28T10:00Z`, `2026-07-29T10:00Z` and `null`:

   | face | rows kept |
   |---|---|
   | F9 read scope | only the 07-27 row, `[1]` |
   | F1 `find` (column declared `datetime`) | `[1,2]` |
   | F7 | `[1,2]` |
   | F11 | `[1,2]` |

   One RLS `using` policy would therefore hide the named day's rows in NativeSQL analytics while CRUD reads and the policy's own `check` admit them.

   ADR-0053 D-A1 says: "any surface that binds a filter comparand into raw SQL (analytics `NativeSQLStrategy` today, and any future raw-SQL strategy) **must** coerce through the driver's dialect-aware temporal coercion". D-D1's list of emitters does not include F9. I found no in-repo policy that writes a bare-day bound, and PostgreSQL and MySQL were NOT MEASURED.
2. **F5 runs neither shared comparand door.** Its `where` goes straight into `normalizeFilters` (`memory-analytics.ts:1501`). Neither `assertListComparandShapes` nor `normalizeFilterComparandTypes` is called anywhere in the file. The measured consequence is the F5 row of §2.4.
3. **F11's `$contains` folds case.** The spec's `$contains` description says: "CASE-SENSITIVELY … answered case-exactly on every JS evaluation face the platform ships". F11's row is `String(value).toLowerCase().includes(String(expected).toLowerCase())` (`preview-evaluator.ts:179`). I measured it through `evaluateAnalyticsQueryOverRows` over the rows `ACME Corp` / `acme ltd` / `Beta`:
   - `{name: {$contains: 'acme'}}`: preview `[1,2]`, F7 `[2]`;
   - `{name: {$contains: 'ACME'}}`: preview `[1,2]`, F7 `[1]`.

   So a drafted chart would count rows the published chart excludes. `FILTER_TEXT_CASES` is not wired into F11's suites. The REST `?preview=` door was NOT MEASURED.
4. **F4 has no production caller** (§1.1), yet rulings keep paying for it. #20444 edited it, #13356 is the no-value fix, and #13166 aligned it. It is a test oracle carried as a face.

### 2.6 T2's measurement: the rulings implemented under B

Ruling `5902355785` gates T2 on this reading: "the typed tree (T2) only after the first cut lands and the next filter-semantics ruling is measured against the design's §2.1 baseline". The first cut is step 2's seam, which landed as `cfa931535` (PR #20794) on 2026-09-30T08:00Z.

**Ref.** Every count in this section was taken at objectstack `origin/main` `a7ab047cf6` (2026-10-03T12:16Z). The dispatch read `cc645f2385`, and the one commit between the two edits no face file. Card threads were read over REST between 2026-10-03T12:40Z and 13:00Z.

**Definitions.** They are §2.1's, unchanged. A **round** is one `os-dev-report` comment on a card. **Face files** are the census files of §1.1 edited in source; test files are not counted.

- **The census used** is §1.1's 15-file list as it stood at each implementing commit. `memory-matcher.ts` left it with `8fec76a2b` (2026-09-30T16:45Z), so later commits are read against 14 files.
- **No file joined the census.** Every source file added in the window (`git diff --name-status --diff-filter=A cfa931535 a7ab047cf6`) is a door, a lowering or a helper, not a face.
- F7 and F9–F11 lost their copies, not their files, so they stay in the census.

**What counts as a ruling.** A ruling is a recorded decision about what a `FilterCondition` means or refuses. Two kinds of record were found:

- **A maintainer ruling,** recorded as a `Ruling:` comment and a `Ruled:` body line. It is counted as a ruling.
- **A triage direction or an in-seat answer** that settles a finding card's semantics. §2.1's last-day and temporal-door rows were of this kind. Every direction found here applies a rule that already existed, or extends it to another operator or face, and names it. The one direction that chose between options (#20280's) was made before `cfa931535`. So each card of this kind is counted as a fix, in its own row of the second table below, and marked as such.

#### The search

| Scan | Population | Hits | Filter semantics |
|---|---|---|---|
| comments whose first line starts `Ruling:` | 4,312 issue comments updated since 2026-09-30T00:00Z (REST `issues/comments?since=`) | 38 records | 3: `5902355785` (this program), `5907789183` (#20802), `5933322270` (#21109) |
| issue bodies carrying a line that starts `Ruled:` | 482 issues updated since 2026-09-30T00:00Z (REST `issues?state=all&since=`) | 38 cards | #5930, #20802, #21109, and #20399 (`$empty`, ruled and implemented before `cfa931535`: §2.1's first row) |
| first-parent commits above `cfa931535` | `node scripts/pm/git-history.mjs log --since=2026-09-30T00:00:00Z --ref=a7ab047cf6`: 474 commits, receipt "floor already predates the window (no fetch)"; `cfa931535` is the 441st | 440 commits | each commit's file list read against the census; each commit that edits a face file or a filter door mapped to its card through its PR body, and the card's thread read |

**Positive controls.** Both ruling scans see #20802's ruling. The body scan also sees #20399, a filter-semantics ruling from before the window.

⚠️ `--since` must be a complete instant. git reads a bare `--since=2026-09-30` at the current time of day. On the same ref it answered 410 commits, not 474, under the same receipt.

#### Rulings implemented after `cfa931535`

| Ruling | Cards | PRs (commits) | Rounds | Face-file edits (distinct) | Shared files edited | What the rounds were spent on |
|---|---|---|---|---|---|---|
| **The nested-relation filter is served** — ruling `5907789183` on #20802 (maintainer 「20802 同意」, 2026-09-30T08:58Z, after the seam landed) | 2: #20802 (the engine), #20887 (analytics). Plus 2 text cards: #20876 (a docs page) and #20888 (the published skill) | #20872 (8) → `ca5408c62`, #20916 (10) → `8d329f02e`; text: #20906 (2), #20902 (2) | 1 + 5 = **6**; the text cards add 1 + 1 | 0 + 4 = 4 (**4 distinct**), all in service-analytics: `read-scope-sql.ts`, `filter-normalizer.ts`, `native-sql-strategy.ts`, `objectql-strategy.ts`. No engine-fed face was edited. | objectql `relation-filter-lowering.ts` (new), `engine.ts`, `no-operator-object-door.ts`, `filter-comparand-shape.ts`, `number-comparand-declared-type-door.ts`; spec `filter.zod.ts` (the docblock); metadata-protocol `protocol.ts`; analytics `analytics-service.ts` | **The engine half took 1 round.** It lowers the form at the step-2 seam, between token resolution and `lowerFilterCondition`. Its one question was answered in-seat: an unreadable related field gets the security layer's 403, not the 400 in the ruling's parenthetical. **The analytics half took 5 rounds.** Round 0 built it. The native-SQL strategy declines the form, because SQL cannot run the inner read as the caller. The ObjectQL strategy hands the form to the engine. F10's normalizer stops flattening it into a dotted cube member, which was its own older meaning of the form. Rounds 1–3 were test plumbing: a census ledger row, then a cross-package input declaration, with two stops for a claim amendment. Round 4 merged `main` after the PR waited behind a p0 card in the same files. |
| **The RLS write check judges the stored form** — ruling `5933322270` on #21109 (maintainer 「其他四张同意」, 2026-10-01T14:16Z). **Marked:** it arose inside this program, from step 4's measured stop on F7, and it decides the input a face judges, not what an operator means | 4: #21109, #21238, #21255, #21242 | #21235 (5) → `ef96c9ed`, #21253 (6) → `d2bc644f2`, #21297 (8) → `c2cd65154`, #21336 (4) → `7aab75920` | 1 + 2 + 1 + 2 = **6** | 0 + 0 + 1 + 1 = 2 (**2 distinct**): `having-filter.ts` (F8) and `matches-filter.ts` (F7) | plugin-security `rls-check-stored-form.ts` (new), `security-plugin.ts`, `rls-compiler.ts`; core `multi-value-storage-form.ts` (new); objectql `record-validator.ts`, `engine.ts` | **#21109, 1 round:** the stored-form step before the check. It also puts the check's comparands into storage form, which goes beyond the ruling's words; the seat adopted it. **#21238, 2 rounds:** the multi-valued wrap that #21109's claim had set aside, with a `Clause-②` line revision between the two reports. **#21242, round 1:** it stopped at its measure-first step, because two production callers would answer differently once `lteBound` was gone. **#21255, 1 round:** one of those two callers. The aggregate positions did not enforce the spec's cross-field comparison-class rule, so F8 was edited. **#21242, round 2:** it deleted `lteBound` and added the number verdict at the RLS compile seam. |

**Against §2.1's baseline:**

| Ruling | Rounds | Face files (distinct) |
|---|---|---|
| `$empty` (§2.1, before B) | 13 | 13 |
| last supported day (§2.1, before B) | 3 | 10 |
| temporal comparand door (§2.1, at a seam) | 1 | 0 |
| nested-relation filter (under B) | 6, plus 2 on text cards | 4 |
| RLS write check, stored form (under B; marked) | 6 | 2 |

**Reading.**

1. **Face files fell, to 4 and 2 against 13 and 10.** The engine-fed faces (F1, F2, F3, F6, F7, F8) took no edit for the nested-relation ruling. That is what B predicts for a rule lowered at the seam.
2. **Rounds did not fall.** They were 6 and 6, against 13, 3 and 1. They went to test plumbing, a serial wait, a measure-first stop and its prerequisite, and a fold a claim had set aside. They did not go to per-face copies of the meaning: only 2 of #20802's 6 rounds built semantics.
3. **None of the six face-file edits is of a class T2 removes.**
   - The native-SQL face cannot run an inner read as the caller. So it declines the form, and the ObjectQL face hands it to the engine (`native-sql-strategy.ts`, `objectql-strategy.ts`). The read scope is a synchronous SQL builder, so it keeps its refusal with new words (`read-scope-sql.ts`). That is an engine capability, §4.3's "front end, engine capability" class.
   - F10 held its own older meaning of the form, and that meaning had to go. It is a deletion, like S5.
   - F8 lacked a refusal door that `where` already has. That is §4.3's door class.
   - F7's edit is its own S5 deletion.
4. **The shared lowering did not change.** `node scripts/pm/git-history.mjs touch --path=packages/spec/src/data/filter-lowering.ts --ref=a7ab047cf6` answers `cfa931535`, and so does the same question about its test file. No ruling or fix in the window needed a new rule in it, or a wider closed output vocabulary.

#### Candidates counted as fixes, not rulings, each in its own row

**Population.** These are the cards whose commit after `cfa931535` changes what a `FilterCondition` answers or refuses on at least one face. The following are left out:

- this program's own step cards (#20810, #20822, #21417);
- the cards of the two rulings above;
- refusal-wording and log-wording cards: the tracker-number stages, #20869, #21067, #21236 and #21397;
- one refactor that changes no answer. #20771's PR measured 8,640 strings "accepted by both" and "0 by one side only";
- field-permission gates (#20932, #20935);
- work that is not a filter predicate: `groupBy`, upserts, aggregates, joins, query windows and order keys.

Every row below applies a rule that already existed, or extends it to another operator or face, and its triage grade names that rule. **#20280 is also marked partly before.** Its triage call is `5905050200` (A: "A `datetime` below year 1000 is refused at the door"), made at 2026-09-30T05:55Z, before `cfa931535`. Its `datetime` half landed after, and its `date` half had landed on 2026-09-27.

| Family | Card | PR → commit | Rounds | Face files edited |
|---|---|---|---|---|
| JSON-stored or multi-valued column | #20874 | #20984 → `f8178ffec` | 2 | `memory-analytics.ts`, `memory-driver.ts` |
| JSON-stored or multi-valued column | #20873 | #21004 → `d67b94280` | 1 | `having-filter.ts` |
| JSON-stored or multi-valued column | #20987 | #21117 → `58a77dbde` | 3 | `sql-driver.ts`, `read-scope-sql.ts`, `native-sql-strategy.ts` |
| JSON-stored or multi-valued column | #21007 | #21097 → `a11faeecb` | 3 | `sql-driver.ts`, `having-filter.ts` |
| JSON-stored or multi-valued column | #21009 | #21165 → `2c1cef334` | 2 | — |
| JSON-stored or multi-valued column | #21066 | #21159 → `45ce12a48` | 1 | `filter-refusal.ts`, `memory-analytics.ts`, `memory-driver.ts` |
| JSON-stored or multi-valued column | #21178 | #21208 → `862f12c0b` | 2 | `remote-transport.ts`, `turso-driver.ts` |
| JSON-stored or multi-valued column | #21254 | #21317 → `97239c3c8` | 1 | — |
| JSON-stored or multi-valued column | #21319 | #21371 → `ee75aae1a` | 2 | — |
| declared-type verdicts reach more faces | #21333 | #21372 → `9f13c949b` | 2 | — |
| declared-type verdicts reach more faces | #21382 | #21404 → `45efcfa3d` | 1 | — |
| declared-type verdicts reach more faces | #21376 | #21424 → `8b123c0ae` | 2 | `native-sql-strategy.ts` |
| declared-type verdicts reach more faces | #21426 | #21446 → `086ad0aa6` | 2 | `native-sql-strategy.ts` |
| a non-boolean `$exists` / `$null` is refused | #20897 | #20979 → `a3dc8171c` | 3 | `filter-refusal.ts`, `mongodb-filter.ts` |
| a non-boolean `$exists` / `$null` is refused | #20981 | #21157 → `c35436c75` | 1 | `having-filter.ts` |
| temporal comparand: range and storage form | #20280 (partly before) | #20843 → `05a7547c9` | 1 (2 with the `date` half's) | — |
| temporal comparand: range and storage form | #20844 | #21065 → `dcd3309f2` | 1 | — |
| temporal comparand: range and storage form | #21068 | #21123 → `1bd14c984` | 1 | — |
| temporal comparand: range and storage form | #21505 | #21562 → `1ca1eb097` | 3 | `preview-evaluator.ts`, `read-scope-sql.ts`, `native-sql-strategy.ts`, `objectql-strategy.ts` |
| cross-field comparison class at the aggregate positions | #21299 | #21406 → `ceb4a939b` | 2 | `having-filter.ts` |
| one face's shape or spelling | #21448 | #21484 → `100c394f6` | 1 | `filter-normalizer.ts` |
| one face's shape or spelling | #20918 | #21036 → `5dbeb7d7b` | 1 | `objectql-strategy.ts` |
| one face's shape or spelling | #20859 | #20944 → `95fed33a2` | 2 | `memory-analytics.ts` |

| Family | Cards | Rounds | Face-file edits | Distinct face files |
|---|---|---|---|---|
| JSON-stored or multi-valued column | 9 | 17 | 13 | 9 |
| declared-type verdicts reach more faces | 4 | 7 | 2 | 1 |
| a non-boolean `$exists` / `$null` is refused | 2 | 4 | 3 | 3 |
| temporal comparand: range and storage form | 4 | 6 | 4 | 4 |
| cross-field comparison class | 1 | 2 | 1 | 1 |
| one face's shape or spelling | 3 | 4 | 3 | 3 |
| **all** | **23** | **40** | **26** | **13** |

**Reading.**

- **The JSON-stored family is the window's largest per-face cost:** 9 cards, 17 rounds and 9 distinct face files. #20822 group 3b also carried this family's engine faces (`mongodb-filter.ts`, `matches-filter.ts`), and those are counted under the program.
  - This is the class §3.3 keeps per dialect (the membership construct) and leaves at the faces (gates that read the physical column map). §3.7 says shape A does not remove it, and T2 would not remove it either.
  - It converged another way, into one verdict in core that each face calls: `json-column-operator-refusal.ts` (added by `a11faeecb`) and `json-membership-sql.ts` (added by `58a77dbde`).
- **One fix is the T1 limit that §3.5 names,** "a face can still misread a shape the lowering emits". It is #20918.
  - F10c (`convertFilter`, under `filterNodeToCondition`) handed the lowered `{ $null: false }` guard to the engine as `$ne: null`, and `driver-sql` refuses that on a JSON column.
  - It cost 1 round and 1 face file.
  - Its mechanism is a translation from analytics' own typed tree back into a `FilterCondition`.
- **No row is of §4.3's T2-only class,** a lowered key clobbering a sibling inside a face's own lowering.

#### Face-file churn in the window (§2.3's measure)

These are the 440 first-parent commits above `cfa931535` on `a7ab047cf6`, in about 3 days:

| Class | Commits editing ≥ 1 face file | Of them, ≥ 3 | Face-file edits |
|---|---|---|---|
| this program's steps 3 and 4 (#20810, #20822, #21417) | 8 | 6 | 28 |
| the two rulings above | 3 | 1 | 6 |
| the 23 fixes above | 15 | 3 | 26 |
| refusal and log wording | 11 | 4 | 21 |
| other work in the same files | 25 | 4 | 37 |
| **all** | **62** | **18** | **118** |

#### Recommendation on T2 — not yet, with a machine-checkable restart condition

This recommends; the decision is the seat's to take to the director. The options are:

- **A —** start T2 now;
- **B —** not yet, with T2 held behind the restart condition below;
- **C —** retire T2 and declare T1 plus the doors the end state. That re-rules the ruling's letter (A's end state), so it is the maintainer's.

**Recommendation: B.** On the four axes:

- **Need:** no measured demand. Under B the two rulings cost 4 and 2 face files, and none of those edits is of a class T2 removes. The window's real per-face cost, the JSON-stored family, is a dialect construct that T2 does not absorb.
- **Long term:** A's end state stands. T2 is T1's output parsed into kinds (§3.5), so starting it later loses nothing.
- **AI mistakes:** T2's structural gain is typed kinds, so that no face misreads a lowered shape. The window has one such misread (#20918), and it happened in a translation between two representations. Until every face compiles kinds, a partial T2 would add more translations like it.
- **Startup scope:** A is a rewrite of every compile entry with no measured pull. B costs nothing now and adds no gate: the restart condition is a reading, not a CI check.

**Restart T2 when either reading holds on `origin/main`:**

1. **The lowering's closed output vocabulary widens,** meaning that some ruling needs a kind T1 cannot spell (§3.5). Read `git grep -n "const INTRODUCED" origin/main -- packages/spec/src/data/filter-lowering.test.ts`. Today it is `['$and', '$or', '$lt', '$gte', '$lte', '$null']`.
2. **One filter-semantics ruling edits 3 or more distinct engine-fed face files,** counted as this section counts.
   - The engine-fed face files are `sql-driver.ts`, `turso-driver.ts`, `remote-transport.ts`, `memory-driver.ts`, `filter-refusal.ts`, `mongodb-filter.ts`, `matches-filter.ts` and `having-filter.ts`.
   - Count the commits whose PR names a card carrying the ruling's `Ruled:` line or record id, by `git show --name-only` against that list, with tests excluded.
   - Today it reads 0 for #20802 and 2 for #21109.
   - These faces receive the seam-lowered filter, so B predicts that a ruling built from leaves they already compile edits none of them. A count of 3 says the seam did not absorb it.

---

## 3. Candidate shape A — the shared semantic tree (H3)

### 3.1 The #5977 pattern, stated precisely

#5977 did four things, and each is a design rule:

1. **The rule became structure in a tree every compiler already reads.** `fieldLeaves` emits a negative-polarity leaf as `or(notSet, comparison)`. The `$not` operand gets one more `{col: {$null: false}}` conjunct. The compilers compile what they are handed.
2. **Which leaves get the rule was decided once.** The deciding table is the polarity pair `nullValueSatisfiesOperator` / `operatorIsNullTotal`, and it is asked about the *comparand*, never about a list of operator names. This is why `$ne: null` stays `IS NOT NULL` and is not widened.
3. **No compiler needed to know the rule.** F10a, F10b and F10c aligned with no edit.
4. **Applying it twice is harmless.** The engine path guards twice (`c IS NULL OR (c IS NULL OR c <> v)`), and that is the same predicate. Idempotence is what lets the rest of a migration go face by face.

Two more in-repo instances already work at the `FilterCondition` level. `nullSafeNegationOperand` rewrites a `$not` operand before emission, in each of its four copies. F2's `TursoDriver.toRemoteFilter` rewrites `$between`, the whole-day bound and storage form before the transport sees the filter.

### 3.2 What the shared tree would hold

| Rule | Today | In the tree |
|---|---|---|
| comparand shape and type, `undefined` included (#6050, #7872); whether a temporal comparand is interpretable (#20549) | shape and type: 1 shared door, plus 4 local `assertDefinedComparands` copies. Temporal: the engine seam only. | the existing doors run first, so the lowered output never holds a refused comparand. A temporal comparand leaves the tree as a calendar-day or ISO string, and storage form stays with the driver (§3.3). |
| boolean identities (#5322, #5134) | shared `reduceFilterVerdict`, called by each face with its own hooks | TRUE / FALSE are resolved once; an empty combinator is gone or is a constant |
| NULL polarity (#5146 `$not`; #5298 `$ne` / `$nin` / `$notContains`) | 4 hand copies, 293 code lines | a negative-polarity leaf becomes `{$or: [{f: {$null: true}}, {f: {op: v}}]}`; a `$not` operand is made total leaf by leaf, exactly as the copies do |
| `$between` | lowered separately in F1, F2 and F10 | two conjuncts, `$gte` and the upper bound below |
| whole-day upper bound (ADR-0053 D-D1), last supported day (#20600) | 10 face files, 41 call sites; F9 has none | a `$lte` on a bare day, or a `$between` maximum on one, becomes `$lt` `nextUtcCalendarDay(day)` in the **calendar-string** domain; on `9999-12-31` it becomes `{$null: false}` |
| order of widening and storage form (ADR-0053 D-E3) | kept by convention in each face; F5 broke it (#20661) | structural: the tree runs before any face converts to storage form, so the #20661 class cannot recur |
| `$exists` (#13529, "has a value") | read per face | one spelling of presence (`$null`) |
| `$empty` (#20311, declared row) | `expandEmptyOperator` called inside 9 faces | the `null` and `''` rows as structure; the empty-list test stays a dialect leaf (§3.3) |
| one operator per conjunct | operator maps, where a lowered key can collide with a sibling (df18120502; Turso remote, noted on #20643) | the lowering emits `$and` conjuncts, so it cannot create a collision |

### 3.3 What stays per dialect — the last inch

- **Storage form of comparands and columns.** ADR-0053 D-A1 keeps the driver as "the single source of dialect truth" (`temporalFilterValue` / `temporalFilterColumnSql`). The tree hands a calendar string, and the driver converts it.
- **Text-match constructs.**
  - `LIKE` or `GLOB`, and `ESCAPE`;
  - the ASCII-fold construct per dialect (#6518, #15684, #16020);
  - the `$like` → `GLOB` translation, which is already one shared helper.
- **JSON-column constructs.** Membership for `$contains` on a JSON column (#17590), and the empty-list test for `$empty` on a multi-value column.
- **Surface mechanics.** Identifier quoting, aliasing, bind placeholders and parameter renumbering; Mongo `$nor` / `$regex`; mingo documents.
- **Refusal envelopes, which depend on context.**
  - `INVALID_FILTER` / 400 against `READ_SCOPE_COMPILE_FAILED` / 500;
  - the SQL drivers' withheld-diagnostic redaction (#7929, #8220).
- **Gates that read the physical column map.** Examples are the JSON-column operator refusal and the non-text-column constant (#14079). They could move up once declarations reach the seam. The slice leaves them where they are.

### 3.4 The output vocabulary — the constraint the census exposes

Every face that consumes the lowering must accept its output. Today's intersection is too small:

- F5 accepts 12 operators and only `$and`.
- F11 accepts 10 operators, with no `$null` and no `$exists`.
- Together that leaves `$eq $ne $gt $gte $lt $lte $in $nin $contains` and `$and`.

That set has no null test and no `$or`. So neither the NULL guard nor the last-day `{$null: false}` could be handed to F5 or F11 as they stand.

The design therefore fixes a **closed output vocabulary**: `$eq $ne $gt $gte $lt $lte $in $nin`, the text family, `$null` (boolean) and `$and $or $not`. It widens F5 (`$or`, `$not`, `$null`) and F11 (`$null`) as part of the migration. Both faces evaluate in two-valued mingo/JS, which express all three natively.

The alternative is to skip the guard at the JS seams, because it is redundant under two-valued evaluation. That would re-create a per-face exception, which is the thing being removed.

### 3.5 Two representations

- **T1 — `FilterCondition` → `FilterCondition`,** with each operator split into its own `$and` conjunct.
  - Strengths:
    - Every face already reads it.
    - The engine seam already returns a rewritten `where`.
    - Both in-repo precedents (§3.1) are T1.
    - Faces keep their own copies at first, harmlessly, and delete them later.
  - Limits:
    - TRUE / FALSE are spelled `{}` / `{$not: {}}` rather than typed.
    - There is no new leaf kind: "empty list" has no spelling.
    - A face can still misread a shape the lowering emits.
- **T2 — a typed tree** with kinds `const` / `and` / `or` / `not` / `leaf{field, op, value}`, compiled by every face.
  - Service-analytics' `NormalizedFilterNode` is the in-repo prototype, with Cube operator names.
  - Constants and leaf lists are explicit, and "compilers own only dialect" is literally true.
  - The cost is a rewrite of every compile entry in §1.1.

T1 is a step toward T2, not a detour, provided it lives where T2 would live: T2 is T1's output parsed into kinds.

### 3.6 Where it runs, and where it lives

**It runs at the seams that already run the doors**, so no new entry point is created. The seam positions, seven in five files:

| Seam | Position |
|---|---|
| engine `where` | `lowerWhereFilterArray`, after `normalizeFilterComparandTypes` (`engine.ts:1034`) |
| engine `aggregations[i].filter` | `engine.ts:16387` |
| engine `having` | `engine.ts:16470` |
| RLS compile seam, serving `using` and `check` | `judgeCompiledComparands` (`rls-compiler.ts:284`) |
| analytics `where` and preview door, serving F10 and F11 | `normalizeWhereComparands` (`filter-normalizer.ts:2218`) |
| read scope | the entry of `compileScopedFilterToSql` (`read-scope-sql.ts:747`) |
| F5 — a new door | `normalizeFilters` (`memory-analytics.ts:1501`) |

**Where it lives is a decision (§6 D3).**

- **Beside the doors in `@objectstack/spec/data`.** That follows the precedent of `filter-verdict.ts`, `filter-comparand-*.ts`, `filter-empty-operator.ts` and `calendar-day.ts`, and adds no dependency edge. `@objectstack/formula` depends on `@objectstack/spec` alone.
- **In `@objectstack/core`.** That honours Prime Directive #2 ("No business logic in `packages/spec`") literally, but adds a `formula → core` edge.

### 3.7 What shape A does not remove

A ruling that adds a new predicate *kind* or a dialect construct still costs one arm per compiler. Examples are JSON membership (#17590), the per-dialect case folds (#15684, #16020) and the empty-list test. The tree removes the tax for rulings that are *compositions* of leaves every face already compiles. §4.3 counts both kinds.

### 3.8 Governance

- **ADR-0053 D-D1 would be reversed in placement.** It says "Operator-sensitive translation lives at the comparison EMITTERS". Moving the whole-day rewrite into a shared lowering reverses where that translation lives, so it needs a new ADR or an amended status line (Prime Directive #13). `docs/adr/**` is a Tier H surface.
- **D-A1 and D-E3 stand.** The driver still owns storage form, and widening still happens before conversion. The lowering makes D-E3 structural.
- **ADR-0058 D1 / D6 are compatible.** `FilterCondition` stays the canonical pushdown shape. The lowering sits after it and before the backends.
- **No ADR records where the NULL polarity or the doors live.** Those are rulings recorded in code (#5146, #5298, #7872), so moving them needs no ADR.

---

## 4. Cost account (H4)

### 4.1 One-time cost of the slice, step by step

- **S1 — the lowering module, T1.** It is a pure function. Its pins are its own unit table:
  - each rule of §3.2, input to output;
  - idempotence, `lower(lower(x)) === lower(x)`;
  - closure of the output vocabulary (§3.4).

  `FILTER_LOGIC_CASES` and `TEMPORAL_CASES` can be driven through `lower` and then F7. This is an ordinary suite, not a gate.
- **S2 — the seam calls.** Seven positions in five files (§3.6). The F5 call also installs the two comparand doors F5 lacks (§2.5 item 2).
- **S3 — widen F5 and F11 to the output vocabulary** (§3.4).
- **S4 — the ADR-0053 D-D1 amendment,** by the maintainer's hand (Tier H).
- **S5 — deletions.** One lane card per group. Each is proven by that face's existing suites staying green before and after, with an ablation.

| Face | Receives the lowered filter via | Edited by the slice (S2 / S3) | Deleted (S5), with the record | Suites that hold it today | Risk |
|---|---|---|---|---|---|
| F1 `driver-sql` | the engine seam | no | **deleted** (#20822 group 2, commit `ceee88f46`): the polarity quartet (67 lines) and the `calendarDay*Rewrite` calls (5 sites). `assertDefinedComparands` is **kept** as a door, on a measured stop (seat answer `5922273550`) | `FILTER_LOGIC`, `FILTER_TEXT`, `TEMPORAL`, `FILTER_COMPARAND_TYPE` on SQLite, plus the PostgreSQL/MySQL live matrix | direct callers (D4); a 21,103-line file |
| F2 `driver-turso` remote | the engine seam, then `toRemoteFilter` | no | **deleted** (#20822 group 2, commit `ceee88f46`): `toRemoteFilter`'s whole-day arms and the transport's polarity copy (69 lines). `toRemoteFilter`'s structural `$between` split and the transport's `assertDefinedComparands` are **kept**, on measured stops (ACCEPT `5923842206`) | turso filter-logic (local and remote), local/remote NULL parity | a live remote server was NOT MEASURED here |
| F3 `driver-memory` query | the engine seam | no | **deleted** (#20822 group 1b, commit `8460592f0`): the whole-day calls (8 sites) | memory filter-logic, temporal, text | — |
| F4 reference matcher | — (no production caller) | no | **retired** (D6, commit `8fec76a2b`): `memory-matcher.ts` is deleted, and the tests that imported it keep their assertions on F3, the shared gate or the spec predicate | 20 test files | — |
| F5 cube face | the new `normalizeFilters` door | **yes**: doors + lowering, and widen `$or` / `$not` / `$null` | **deleted** (#20822 group 1, commit `8fec76a2b`): the `where` path's copy of the whole-day bound (`lteUpperBound`, 2 call sites). The `dateRange` window's end keeps its own widening (3 calls, `memory-analytics.ts:1236`), because a window is not a `FilterCondition` (ADR-0053 D-D1 as amended, item 8) | its own suites; not in `check:driver-conformance` | an accept-set widening, so a changeset with its Clause-② line |
| F6 `driver-mongodb` | the engine seam | no | **deleted** (#20822 group 3a, commit `53ed3d109`): the whole-day calls (4 sites) | mongodb filter-logic, text, temporal, comparand-type | the server answer was NOT MEASURED here |
| F7 `formula` | the RLS compile seam (policies); the engine (via F8) | no | **retired** (#21242): `lteBound` and its 2 sites are deleted; a bound that reaches F7 unlowered is compared as written (D-D1 item 5) | matches-filter not-null-safe, or-semantics, temporal | — |
| F8 `having` | the engine seam | no | **deleted** (#20822 group 3b, commit `e18fea6dc`): the whole-day calls (4 sites) | having filter-logic, text, temporal | — |
| F9 read scope | the new call at its entry | **yes**: the lowering call | **deleted** (#21417, commit `81e69cab3`): the polarity quartet (67 lines); the scope takes the shared lowering's bound and NULL guards. `assertDefinedComparands` is **kept** as a door (#21417's report `5963857087`) | read-scope-sql conformance, read-scope not-null-safe | fixes §2.5 item 1, which changes the rows a scope returns, so it needs a changeset |
| F10 `where` → tree | the analytics `where` door | no | **deleted** (#21417, commit `81e69cab3`): the polarity quartet (90 lines) and the strategies' whole-day arms. `assertDefinedComparands` is **kept** as a door, and `fieldLeaves`' `$between` arm stays as a structural split on the columns the lowering does not rewrite | native-sql filter-logic, text, temporal | echo fidelity (R6) |
| F11 preview | the analytics door it shares with F10 | **yes**: widen `$null` | **deleted** (#21417, commit `81e69cab3`): `lteBound` (4 sites) and the preview window's own bare-day, last-day and `~`-suffix readings; the window reaches the lowering as a `{ $gte, $lte }` pair | preview-temporal conformance | — |

The S5 column was re-read at `origin/main` `a7ab047cf6` (2026-10-03). No face file holds a polarity copy, and the only whole-day call left in a face file is F5's `dateRange` window. Each copy that stayed did so on a measured stop, which its row names. The four `assertDefinedComparands` copies (F1, F2, F9, F10) are refusal doors beside the comparand-type door, not the lowering's meaning.

**Measured sizes:**

- 7 seam positions in 5 files;
- 3 faces edited by the slice;
- 293 code lines in 4 polarity copies;
- 4 local `assertDefinedComparands` copies;
- 41 whole-day call sites in 10 face files.

**Effort — an estimate, NOT a measurement.** Using §2.1's measured rounds as the yardstick (a card that touches one shared module and at most three faces took 1–2 rounds):

- S1–S3 are about one engine-lane card and one analytics/memory card;
- S5 is about four lane cards;
- in all, about 6 cards and 8–12 rounds, plus the maintainer's ADR amendment.

### 4.2 The conformance net that would hold it

| Case-set | Non-spec test files wiring it today |
|---|---|
| `FILTER_LOGIC_CASES` (36 cases) | 33 (the card counted 11 hand-copied wirings in August) |
| `FILTER_TEXT_CASES` | 19 |
| `TEMPORAL_CASES` | 10 |
| `TEMPORAL_TIME_CASES` | 9 |
| `FILTER_COMPARAND_TYPE_CASES` | 8 |

`node scripts/check-driver-conformance.mjs` answers OK: "50 covered cell(s), 0 in the DEBT ledger, 0 exempt". It scores the five driver packages only. Its header leaves `formula` and service-analytics "to their own suites".

That scope is how two of §2.5's findings stayed invisible:

- F9 wires no `TEMPORAL_CASES`, which is how item 1 survived;
- F11 wires no `FILTER_TEXT_CASES`, which is how item 3 survived.

The slice needs **no new gate**. It needs the lowering's own unit table. It would also benefit from two ordinary suites: `TEMPORAL_CASES` through F9, and `FILTER_TEXT_CASES` through F11.

### 4.3 The recurring tax the slice removes

The 18 filter-semantics commits of §2.3, classified by what shape A would have done with them. The classification is my reading of each commit's subject and diff, not a measurement.

| Class | Commits | Shape A's effect |
|---|---|---|
| structure over leaves every face compiles | `1a75e39d4a` (#20600 last day), `a646120dc7` (text operator over a stored non-string value, which needs declarations at the seam), `9dac1ae017` (`$exists` = has a value), `178325bcbe` (F4 no-value) | **4** — one edit instead of N |
| partly structure | `fb386074f5`, `f1e921ab8e`, `2b53993aca` (`$empty`: the `null` and `''` rows are structure; the empty-list test is a dialect leaf) | **3** — fewer face edits |
| refusal at a door (the pattern that has already converged) | `8a44ce7182` (`$like` NUL), `5c7cbe37e6` (vacating read scopes), `51efbf1168` (text operator over a temporal type) | 3 — unaffected |
| dialect construct | `54bb2f125f`, `fd014b1713`, `dcad825d46` (case-exact and ASCII-fold constructs per dialect) | 3 — stays per dialect by design |
| front end, engine capability or analytics vocabulary | `6936d0755b` (per-aggregation filter), `0da638cd9f`, `86c5052869` (`dateRange`), `7c1039b388` (read-scope placeholders) | 4 — outside the lowering |
| clobber inside a face's own lowering | `df18120502` | 1 — T2 only |

So, over those 46 days, T1 would have turned 4 of the 18 multi-face commits into single edits and shortened 3 more, and T2 would have added one. Seven of the 18 are dialect or front-end work, and convergence does not touch them.

The larger saving is not in that count. It is in the divergences that per-face copies keep producing between rulings. §2.5 found three, and #20661 was a fourth, found by the #20600 work.

### 4.4 Order of work

1. **The ADR-0053 D-D1 amendment first, in its own PR.** `docs/adr/**` is Tier H, and a mixed diff is governed whole, so keeping it separate keeps the code slice off Tier H. The code slice waits on the amendment (Prime Directive #13).
2. **S1 + S2 on the engine and RLS seams.** This is one card in the engine lane. F1, F2, F3, F6, F7 and F8 then receive the lowered filter with no edits of their own.
3. **S2 on the analytics seams, S3, and F5's door.** This covers the analytics lane and `driver-memory`. §2.5 items 1 and 2 close here.
4. **S5 deletions,** one lane card each, each proven by the face's existing suites and an ablation.
5. **T2 — only on measured need.** Measure the next filter-semantics ruling against §2.1's baseline first. Measured in §2.6 at `a7ab047cf6` (2026-10-03).

### 4.5 Risks

- **R1 — double application.** Idempotence is measured for the NULL guard (#5977). The whole-day rewrite emits `$lt`, which no face rewrites again, and `$between` is gone before any face sees it. Both need an idempotence pin (S1).
- **R2 — provenance marks (#8220).** Rewritten nodes are new objects. A refusal raised inside one resolves as ambiguous, and so stays withheld from the author. That is fail-closed, and F1 already behaves this way under its own `$not` rewrite. The lowering must copy the marks forward to keep today's author-visible refusals.
- **R3 — declarations at the seam.** Scoping the whole-day rule to `datetime` and reading `$empty`'s row both need field types.
  - The engine seam has them.
  - F9 has `declaredValueShape`.
  - F7 and F11 hold none, so they get the type-blind reading, which D-D1 already sanctions: `< next-day` ≡ `<= day` for `date` text.
- **R4 — direct driver callers bypass the seams.** Decision D4.
- **R5 — accept sets move.** F9's whole-day fix changes the rows a scope returns. F5's and F11's widening admits shapes they refuse today. Each needs a changeset and its Clause-② line.
- **R6 — echo fidelity.** F10b must reproduce F10a. Both read the lowered tree, so they agree by construction.
- **R7 — hot files.** `sql-driver.ts` (21,103 lines) and `remote-transport.ts` (4,771 lines) collide with parallel lane work. The slice leaves both untouched until S5.

---

## 5. Recommendation — build, a smaller first slice, or not now

The three options:

- **A — build shape A in full.** T2, compiled by all 14 compile entries of §1.1.
- **B — a smaller first slice.** T1 at the existing seams, as costed in §4.1, followed by the S5 deletions.
- **C — not now.** Keep the accepted process half and the doors, and pay the tax per ruling. The process half is the per-ruling compiler-face checklist of 2026-08-07, now `.claude/skills/pm-dispatch/references/compile-surfaces.md`.

The analysis follows the four fixed axes of the dispatch frame.

**实际业务需求 — real, measured need.**

The authors whose filters pass through these faces are real:

- every stored view filter rule, lowered by REST and read through F1, F3 or F6;
- every RLS policy (F1 on CRUD reads, F7 on writes, F9 in analytics);
- every widget and dataset `where` (F10, and F11 in draft preview);
- every `having` (F8).

The measured cost is 18 filter-semantics commits that each edited 3 or more face files in 46 days, 13 rounds for the `$empty` ruling alone, and three live divergences found by one census (§2.5). Those divergences reach authors as *different rows for one predicate*.

- B targets exactly the absorbable classes (7 of the 18) and closes all three divergences.
- A adds, over B, one commit class (the clobber) and typed constants. No measured demand exists for more.
- C leaves the tax and the divergences in place. The checklist existed throughout the time F5's ordering defect (#20661) and §2.5's three divergences sat undetected. It has also drifted from the code it lists, measured against §1.1:
  - it names F4, which has no production caller, as the `driver-memory` face;
  - it omits F3, F5, F11, F10c and F2's lowering half;
  - it still calls `having` 「唯一没有 conformance 表覆盖的面」, though `having-filter.test.ts` now runs `FILTER_LOGIC_CASES`;
  - its line numbers point to the August tree (`applyFilterCondition` at `:7083`; it is at `:16789` today).

**项目长远合理性 — long-term soundness.**

- A is the end state.
- B is on the path to it, because T2 is T1's output parsed into kinds (§3.5).
- C keeps N dialects of *meaning*. That is the "one concept, one implementation" line `filter-verdict.ts` already crossed for the boolean identities.

B keeps ADR-0053 D-A1 intact and makes D-E3 structural. It costs one honest ADR amendment (D-D1). Its interim state — faces holding idempotent copies until S5 — is declared, and each copy has a deletion card, so it is not a workaround.

**防 AI 写错 — making the AI mistake structurally harder.**

An author, human or AI, cannot see which face a filter will land on. One RLS policy is read by F1, F7 and F9, and §2.5 item 1 shows those faces answering it differently. Per-face meaning cannot be learned.

- Under B, a new face inherits the absorbed rules at its seam. It is correct by construction, not by someone remembering a checklist. F5 shows what happens to a face nobody remembered: it has no door at all.
- B adds no consumer tolerance. It lowers once and refuses at the seams. Its widening of F5 and F11 implements operators the spec already declares (「声明而未兑现是实现缺口,补实现」); it is not leniency toward off-spec input.
- C relies on a checklist, which is guidance an agent reads, not enforcement.

**创业阶段不扩散需求 — no scope creep at the startup stage.**

- **A** is a multi-week rewrite across three lanes. It is the expansion this axis defaults against.
- **B** is bounded: about 6 cards, as estimated in §4.1. It deletes more code than it adds — 293 polarity lines, 41 whole-day call sites and 4 `undefined` copies. It creates no new authorable surface and **recommends no new gate**, per 「新增门禁默认否」.

  Its staging (S2 before S5) is an internal work order. It exposes no dual spelling to authors. To honour 「过渡也从紧」, the S5 cards should queue as soon as S2 lands, not be left open-ended.
- **C** costs nothing now, and then costs every future ruling.

**The axes conflict only on A.** Long-term soundness favours it; the startup axis refuses it now.

**Recommendation: B**, starting with the ADR-0053 D-D1 amendment. **A: not now.** Revisit it only after the next filter-semantics ruling is measured against §2.1's baseline under B. **C: not recommended**, because the tax and the divergences are measured, not predicted.

This is a proposal. The build decision is the maintainer's.

---

## 6. Decisions for the maintainer

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Build? | A full build · B first slice · C not now | **B** (§5) |
| D2 | The slice's representation | T1 (`FilterCondition` → `FilterCondition`, `$and` conjuncts) · T2 (typed tree) | **T1** now; T2 only on measured need |
| D3 | Where the lowering lives | `@objectstack/spec/data`, beside the doors · `@objectstack/core` | **spec**: the precedent is the doors themselves, and it adds no dependency edge. `formula` depends on spec alone, so core would add a `formula → core` edge. The tension with Prime Directive #2 is named, not hidden. |
| D4 | Direct driver callers, which bypass the seams | (a) faces keep their local guards permanently, so the copies survive and S5 shrinks to analytics, F5 and F11 · (b) drivers receive seam-lowered input only, as #7872 chose for comparand types ("inherit it by receiving already-validated input") | **(b)**, following #7872. The in-repo direct driver callers named on #20446 (`5886202626`) are `metadata`'s loaders and history cleanup and the CLI's `secret-reference-union`. Whether any of them builds a filter the lowering would change was NOT MEASURED. |
| D5 | ADR-0053 D-D1 | amend its placement · write a new ADR that supersedes it | amend the placement; keep D-A1 and D-E3 as they are |
| D6 | F4, the reference matcher with no production caller | keep it as a test oracle, declared not-a-face and owed no ruling arms · retire it and point its 20 test files at F7 or F3 | **retire** it |
| D7 | Scope of F3–F6, given the #5499 freeze dissolved on 2026-08-11 | in · out | **in**. Under B, F3 and F6 are seam-fed at no cost, and F5 needs its door either way. |

---

## Appendix A — method, reproduction, and what was NOT MEASURED

**Probes.** They are scratch scripts, not committed.

- Worktree sources ran under `tsx`. Package imports resolved to a `dist` built with `OS_SKIP_DTS=1` for `spec`, `types`, `core`, `observability`, `formula`, `driver-sql` and `driver-turso`, under the shared verify lock.
- F1 and F2 ran as plain Node against their built `dist`. F1 used `better-sqlite3` `:memory:`. F2 called `buildWhereSQL` with a stub client.
- §2.4: the fixture `{id:'1',d:'v1'}`, `{id:'2',d:'v2'}`, `{id:'3',d:null}`, `{id:'4'}`, with the five shapes shown. Each face was called at its own entry point, with no door in front. F5's controls are no `where`, `{d:'v1'}` and `{d:null}`.
- §2.5 item 1: rows `t` = `2026-07-27T10:00:00.000Z`, `2026-07-28T10:00:00.000Z`, `2026-07-29T10:00:00.000Z` and `null`. The filter is `{t: {$lte: '2026-07-28'}}`. F1's column was declared `datetime`, and F9's compiled SQL was executed on SQLite.
- §2.5 item 3: rows `ACME Corp`, `acme ltd` and `Beta`, with `$contains` `'acme'` and `'ACME'`.

**Counts.**

- **Face files per commit:** `git show --name-only` against the 15-file list of §1.1.
- **The window:** `node scripts/pm/git-history.mjs log --since=2026-08-14 --ref=3711e0b763`. Its receipt reads "complete clone (no fetch)".
- **Polarity copies:** non-comment lines from `nullValueSatisfiesOperator` to the next top-level declaration after `nullSafeNegationOperand`.
- **Whole-day call sites:** `git grep -c -E "nextUtcCalendarDay\(|isUnboundedAbove\("` over non-test `src`.
- **Case-set wiring:** `git grep -l` over non-spec test files.
- **Rounds:** the number of `os-dev-report` comments on each card, read over REST.
- **The driver conformance matrix:** `node scripts/check-driver-conformance.mjs`.

**NOT MEASURED:**

- PostgreSQL and MySQL for §2.4 and §2.5. Only SQLite was measured.
- A live `mongod`: §2.4 reports F6's translation only.
- A live Turso remote server: F2 was measured at compile time only.
- Every HTTP door: the REST `?preview=` route, the analytics routes and the data routes.
- The sibling repositories `objectui` and `cloud`.
- The `undefined` path through direct driver callers, the security tenant check and the explain engine.
- The effort figures in §4.1, which are estimates.

## Appendix B — the 22 commits that edited three or more face files (2026-08-14 → `3711e0b763`)

| Face files | Commit | Subject (abridged) | §4.3 class |
|---|---|---|---|
| 10 | `1a75e39d4a` | a datetime `$lte` / `$between` maximum on 9999-12-31 includes the whole last day (#20600) | structure |
| 9 | `fb386074f5` | the engine's filter faces answer the staged `$empty` (#20444) | partly structure |
| 8 | `f1e921ab8e` | `$empty` joins `FILTER_OPERATORS`; `is_empty` lowers to it (#20446) | partly structure |
| 8 | `a646120dc7` | `FILTER_TEXT_CASES` declares a text operator over a stored non-string value | structure |
| 5 | `6936d0755b` | per-aggregation filter on `engine.aggregate` | engine capability |
| 4 | `8a44ce7182` | a `$like` / `$ilike` pattern holding U+0000 is refused | door |
| 4 | `54bb2f125f` | the case-sensitive text family compiled per SQL dialect | dialect |
| 4 | `2b53993aca` | both analytics filter faces answer `$empty` by declared type (#20445) | partly structure |
| 4 | `0da638cd9f` | the closed `dateRange` preset vocabulary lowered once | front end |
| 3 | `fd014b1713` | the `unknown` dialect arm folds `$icontains` portably | dialect |
| 3 | `f6fa22ce1a` | a boolean aggregand column in the aggregation fixture | not filter semantics |
| 3 | `df18120502` | a lowered operator key stops clobbering a sibling | clobber (T2 only) |
| 3 | `dcad825d46` | the `$icontains` ASCII fold per dialect | dialect |
| 3 | `be5c60291c` | eight more `IDataDriver` doors publish their declared type | not filter semantics |
| 3 | `9dac1ae017` | `$exists` means HAS A VALUE on three faces | structure |
| 3 | `96d8b20ee4` | docs: retire the dissolved #5499 freeze claims | not filter semantics |
| 3 | `86c5052869` | a `dateRange` array that is not a two-bound window is refused once | front end |
| 3 | `7c1039b388` | NativeSQL and the echo resolve a read-scope placeholder with the caller's context | front end |
| 3 | `5c7cbe37e6` | refuse vacating read scopes on the echo and NativeSQL merge sites | door |
| 3 | `5ba2ec3ca4` | a transport can declare it has no transactions | not filter semantics |
| 3 | `51efbf1168` | type-gate a text operator over a declared temporal column | door |
| 3 | `178325bcbe` | a no-value row satisfies `$nin` / `$notContains` in the reference matcher | structure |
