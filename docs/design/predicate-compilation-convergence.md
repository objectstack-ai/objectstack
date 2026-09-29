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
| F4 | `driver-memory` reference matcher | `match()` (`memory-matcher.ts:43`) | **no production caller.** It is not exported from the package index, and 20 test files import it. | 19/19 | none |
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

The 15 source files are `sql-driver.ts`, `turso-driver.ts`, `remote-transport.ts`, `memory-driver.ts`, `filter-refusal.ts`, `memory-matcher.ts`, `memory-analytics.ts`, `mongodb-filter.ts`, `matches-filter.ts`, `having-filter.ts`, `read-scope-sql.ts`, `filter-normalizer.ts`, `native-sql-strategy.ts`, `objectql-strategy.ts` and `preview-evaluator.ts`. §2 uses this list as its "face files".

### 1.2 Against the card's table

- **Named by the card:**
  - F1;
  - F2's transport half;
  - F9;
  - F10, which the drivers seat's correction (`5205970996`) split into F10a / F10b, plus F10c;
  - F7;
  - F8, named as "the sixth and a half".
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
| boolean identities (`$and: []`, `$or: []`, `$not: {}`) | `reduceFilterVerdict` (spec `filter-verdict.ts`, #5659) | inside F1, F3/F4 and F6 |
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
| Last supported day — #20600, then #20661 | 2 | #20643 (19), #20714 (3) | 2 + 1 = **3** | 10 + 1 = 11 (**10 distinct**) | spec `calendar-day.ts`, `temporal-conformance.ts`; core `datetime.ts` | Round 1 failed at tier because the new sentinel was typed twice across two declaration files. The fix then had to be narrowed at "17 direct call sites in 9 files, plus Turso's indirect one" (review `5894730557`). The same work found a tenth face whose own order of operations was wrong: F5 converted to storage form before widening. That became #20661. |
| Temporal comparand door — #20549 + #20480 | 2 | #20668 (2) | **1** | **0** | core `temporal-comparand.ts`, objectql `temporal-comparand-door.ts`, `record-validator.ts` | None. The rule lives at the engine seam, so the faces changed only in tests. |

And the pattern this investigation evaluates: #5977 (PR #6004, 7 files, 1 commit) moved the #5298 NULL guard into service-analytics' shared tree. It aligned three compilers with no edits to them.

### 2.2 The natural experiment

In the same week, in the same lanes:

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
2. **On the production paths, the split is masked by doors.** Since #7872 the comparand-type door runs at each of these seams:
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
