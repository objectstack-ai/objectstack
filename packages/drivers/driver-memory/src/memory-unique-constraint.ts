// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Uniqueness for the in-memory driver — the constraint this driver enforced
 * NOWHERE until #13197, on both declaration surfaces since #13239.
 *
 * `driver-sql` materializes uniqueness from TWO surfaces and this module
 * reproduces both: **field-level `unique`** (#13197, `uniqueIndexesFromFields`)
 * and **object-level declared `indexes[]` entries carrying `unique`** (#13239,
 * `normalizeDeclaredIndex`). They share one key model, one NULL rule and one
 * refusal envelope, and they DISAGREE about what bare `true` means — see
 * "⚠️ bare `true` inverts between the two surfaces" below.
 *
 * ## The defect this closes
 *
 * `InMemoryDriver.create` was a `table.push()` and `syncSchema` allocated an
 * array, so a `unique: true` field was **declared and not enforced** — the
 * ADR-0078 / Prime-Directive-#10 shape the platform refuses everywhere else. A
 * colliding write did not fail; it LANDED, and a read returned both rows.
 *
 * The motivating instance is the autonumber one, and it is the worst-shaped:
 * `packages/objectql/src/engine.ts`'s `createWithAutonumberResync` re-seeds and
 * re-issues a record number when the store REJECTS it as a duplicate, so on a
 * driver that rejects nothing the whole branch is unreachable and a duplicate
 * business identifier lands with no error anywhere. That comment already ruled
 * where the remedy belongs — «uniqueness enforcement in the driver, NOT a
 * pre-issue existence probe here» — and this module is that remedy. The
 * autonumber case is a consequence, not a special case: nothing here knows what
 * an autonumber is.
 *
 * ## The semantics are driver-sql's, MEASURED — not a simpler invention
 *
 * A second, easier answer to "what does `unique` mean" is the
 * one-contract-two-numbers defect this repo keeps closing, so the scoping rule
 * below is read off `driver-sql`'s `uniqueIndexesFromFields`
 * (`packages/drivers/driver-sql/src/schema-drift.ts`, ADR-0120 D1/D3) and
 * reproduced, arm for arm:
 *
 * | declaration | tenant column | driver-sql index | here |
 * |:---|:---|:---|:---|
 * | `unique: 'global'` | any | `(field)` | scope `null` |
 * | `unique: true` / `'organization'` | present, ≠ field | `(COALESCE(tenant,'__global__'), field)` | scope = tenant column |
 * | `unique: true` / `'organization'` | absent | `(field)` | scope `null` |
 * | `unique: true` / `'organization'` | IS the field | `(field)` | scope `null` |
 * | absent / `false` | any | no index | not a constraint |
 *
 * ⚠️ **`unique: true` is the POSITIONAL spelling of `'organization'`, not of
 * `'global'`** — at FIELD level. Getting that backwards makes two
 * organizations' identical record numbers collide on a constraint neither can
 * see, which is the exact cross-tenant existence oracle ADR-0120 D1 exists to
 * remove.
 *
 * ## The DECLARED-INDEX surface (#13239) — `normalizeDeclaredIndex`'s arms
 *
 * Read off `driver-sql`'s `normalizeDeclaredIndex` (same file, same ADR) and
 * reproduced arm for arm by {@link uniqueConstraintsFromDeclaredIndexes}. The
 * arms are the SQL function's, not a simplification of them:
 *
 * | declared entry | tenant column | driver-sql index | here |
 * |:---|:---|:---|:---|
 * | `fields` empty / absent / no non-empty strings | any | `null` — unusable | no constraint |
 * | `unique` absent / `false` | any | a PLAIN index | not a constraint |
 * | `unique: true` / `'global'` | any | the listed columns VERBATIM | `columns` = listed, no NULL-safe part |
 * | `unique: 'organization'`, tenant column NOT listed | present | `(COALESCE(tenant,'__global__'), …listed)` | `columns` = `[tenant, …listed]`, `nullSafeColumns` = `[tenant]` |
 * | `unique: 'organization'`, tenant column ALREADY listed | present | listed verbatim, the tenant's own key part goes NULL-safe | `columns` = listed (order kept), `nullSafeColumns` = `[tenant]` |
 * | `unique: 'organization'` | absent | degrades to the listed columns alone | `columns` = listed, no NULL-safe part |
 *
 * ⚠️ **bare `true` inverts between the two surfaces.** On a declared index it
 * is the positional spelling of **`'global'`** — the listed columns verbatim,
 * no organization key part — while at field level it means `'organization'`.
 * That is the #4986 trap. It is DELIBERATE (maintainer ruling 2026-08-13 on
 * #8323: routing the declared-index branch through the field-level predicate
 * was rejected, because it would silently reinterpret every deployed declared
 * `unique: true` as organization-scoped), it is staged for retirement at
 * protocol 18 by #5082, and `driver-sql` pins both halves in
 * `sql-driver-declared-index-organization-respelling.test.ts`. So this surface
 * reads the STRICT `unique === 'organization'` test, exactly as
 * `normalizeDeclaredIndex` does — never the field surface's
 * `isUniqueDeclared && !isGlobalUnique`.
 *
 * Note the arm the FIELD surface has and this one does NOT: a field-level
 * `unique` ON the tenant column stays single-column, because `(org_id, org_id)`
 * is not a constraint. `normalizeDeclaredIndex` has no such guard — a declared
 * `{ fields: ['organization_id'], unique: 'organization' }` becomes the
 * single NULL-safe key part, i.e. "one row per organization". Reproduced as
 * written, not as the field surface reads.
 *
 * ### Two arms of the SQL function that are deliberately NOT reproduced
 *
 *  - **The index NAME.** `normalizeDeclaredIndex` resolves `idx.name` or
 *    generates one, hash-truncated to a dialect's 63/64-char identifier budget.
 *    A JS `Map` has no identifier budget, and #6544's ruling (maintainer,
 *    2026-08-08) is that an index name must never be presented where a column
 *    is expected — so the refusal here names the COLUMNS and this module keeps
 *    no name at all. Reproducing half of `buildIndexName` would be a second
 *    answer to a question this package never asks.
 *  - **Pre-resolved `nullSafeColumns` on the input.** That is a driver-side
 *    extra for the drift-op apply path, which re-feeds already-normalized
 *    shapes. `IndexSchema` is a `strictObject` over `name` / `fields` /
 *    `unique` (plus tombstones), so the key cannot reach a driver from a
 *    declaration and there is no declaration surface here to honour it on.
 *  - **The unmaterialized-column skip.** `syncDeclaredIndexes` skips an index
 *    whose columns are not physical. Here that degradation is automatic and
 *    needs no filter: an undeclared column is `undefined` on every row, and a
 *    NULL key part exempts the row (below), so such an index constrains
 *    nothing. The field surface has the same exposure and the same answer.
 *
 * ### Why the NULL-organization fold needs no `'__global__'` token here
 *
 * ADR-0120 D3 materializes the organization key part as
 * `COALESCE(organization_id, '__global__')` because SQL `UNIQUE` is
 * NULL-DISTINCT: a raw `(organization_id, field)` composite enforces NOTHING on
 * rows whose organization is NULL, which on a single-organization stack is
 * every row (#5030). The sentinel is a SQL-EXPRESSION artefact — an index
 * expression needs a non-NULL literal to fold onto — and its value is reserved
 * precisely so no real organization can land in the bucket.
 *
 * A JavaScript key can hold `null` directly, so {@link uniqueKeyOf} folds every
 * NULL-organization row onto the key part `null` and needs no token at all.
 * That is the same bucket, reached without copying a constant across a package
 * boundary this driver must not depend on (`driver-memory` is the last rung of
 * the dev step-down; it does not pull in `driver-sql`). It is also marginally
 * STRICTER in one unreachable case: a row whose organization id literally
 * equals `'__global__'` would share SQL's platform bucket and gets its own
 * here — a case the reserved-token guard at the organization-creation seam
 * makes unconstructible.
 *
 * ### NULL values stay NULL-DISTINCT, deliberately — on keys of any width
 *
 * A row whose unique FIELD is `null`/absent is exempt, exactly as under SQL
 * `UNIQUE`. Folding those together instead would refuse the second row of every
 * table with an optional unique column — a refusal `driver-sql` does not issue,
 * i.e. a fresh divergence introduced by the fix for a divergence.
 *
 * A COMPOSITE key is the same rule with a wider key, and it was MEASURED
 * against SQLite over the two DDL shapes `syncDeclaredIndexes` actually emits
 * rather than assumed (#13239):
 *
 * ```
 * UNIQUE (account_id, code)                                   -- bare true / 'global'
 *   ('acme', NULL, 'X')  twice   -> BOTH ACCEPTED  (NULL-DISTINCT)
 *   ('acme', 'A2', NULL) twice   -> BOTH ACCEPTED  (NULL-DISTINCT)
 *
 * UNIQUE (COALESCE(organization_id,'__global__'), account_id, code)  -- 'organization'
 *   (NULL, 'A1', 'X')    twice   -> second REFUSED (the organization part FOLDS)
 *   (NULL, 'A2', NULL)   twice   -> BOTH ACCEPTED  (NULL-DISTINCT still wins)
 * ```
 *
 * So there is exactly ONE rule, and {@link uniqueKeyOf} is the one place it
 * lives: **a NULL in any key part EXEMPTS the row, except in a NULL-SAFE part,
 * where it folds onto the shared `null` bucket.** The organization key part is
 * the only NULL-safe one, on either surface, because on the SQL side it is the
 * only one materialized as an expression that can never be NULL.
 *
 * ## Which column conflicted: this driver answers `undefined`, always
 *
 * `@objectstack/types`' `uniqueViolationColumn` reads a dialect's own grammar,
 * and the refusals here are stated in this module's words, so nothing is
 * extractable from them — the answer is `undefined` for a field-level refusal
 * (since #13197) and for a declared-index one alike. That is the SAFE answer
 * under #6544's ruling (maintainer, 2026-08-08): an identifier mistaken for a
 * column is worse than no answer. For a COMPOSITE it is also the answer
 * `driver-sql` gives — measured: SQLite prints
 * `UNIQUE constraint failed: t.account_id, t.code` (two targets, so
 * `soleColumn` refuses) for the plain form and
 * `UNIQUE constraint failed: index '…'` (an index name, refused at the gate)
 * for the NULL-safe form. ⛔ Do not shape these sentences into a dialect's
 * grammar to make the extractor bite: naming the first column of a composite is
 * the wrong-answer class that export exists to avoid, and the engine's
 * autonumber resync already treats an unnamed column as attributable by design.
 *
 * ## Deliberately out of scope (stated so it is not read as done)
 *
 *  - **Primary keys.** A duplicate `id` still lands unless `id` itself declares
 *    `unique`, or a declared index lists it. The driver docstring says so.
 *  - **Row-level tenant isolation.** This scopes a uniqueness KEY the way
 *    ADR-0120 does; it does not make reads tenant-filtered. This driver still
 *    refuses to boot multi-tenant (`memory-tenancy-guard.ts`, #6915) and that
 *    guard is untouched — which is also why the scope arms above are, in
 *    practice, reached only through an object carrying an `organization_id`
 *    column WITHOUT an explicit `tenancy` block.
 *  - **Non-unique declared indexes.** An `indexes[]` entry without `unique` is
 *    an ACCESS PATH, and this store is a linear scan: there is nothing to
 *    build and nothing to enforce.
 *
 * ⚠️ This list no longer contains declared `indexes[]` — #13239 moved that
 * surface from "out of scope" to enforced, and the sentence that said otherwise
 * was removed rather than left standing.
 */

import {
  isGlobalUnique,
  isUniqueDeclared,
  isOrganizationUnique,
  isTenancyDisabled,
} from '@objectstack/spec/data';

/**
 * The wire identity of the refusal (ADR-0112). `UNIQUE_VIOLATION` is the
 * registered code `@objectstack/rest` already answers a SQL conflict with
 * (`error-code-ledger.zod.ts`), and 409 is the status it answers it at, so a
 * suite that swaps this driver for SQLite sees ONE envelope — the parity
 * `memory-filter-refusal-envelope.test.ts` states for the filter family, held
 * here for the constraint family.
 *
 * ⛔ Never assert merely "it threw" against this (#6144): a bare `Error` from
 * an unrelated fault passes that assertion and says nothing about the contract.
 * Assert `code` AND `status`.
 */
export const UNIQUE_VIOLATION_CODE = 'UNIQUE_VIOLATION';

/** @see UNIQUE_VIOLATION_CODE */
export const UNIQUE_VIOLATION_STATUS = 409;

/** One field-level unique constraint, resolved against the object's tenancy. */
export interface MemoryUniqueConstraint {
  /** The field the constraint is on. */
  readonly field: string;
  /**
   * The organization key part, or `null` for a platform-wide constraint.
   * ADR-0120 D1: `'global'` and "no tenant column" both answer `null`.
   */
  readonly scopeField: string | null;
}

/**
 * [#13239] One OBJECT-LEVEL unique constraint, normalized from a declared
 * `indexes[]` entry — a key of any width, resolved against the object's
 * tenancy.
 *
 * The counterpart of {@link MemoryUniqueConstraint} for the other declaration
 * surface, and deliberately a SECOND shape rather than a widening of the first:
 * the field-level descriptor's `field`/`scopeField` pair is what
 * `uniqueConstraintsFromFields` is pinned to answer, and a composite has no
 * single `field`. Both shapes reduce to the same key parts in
 * {@link uniqueKeyOf}, so there is still exactly one NULL rule and one bucket
 * model — the second shape is a wider KEY, not a second seam.
 */
export interface MemoryDeclaredIndexConstraint {
  /**
   * The key columns, in `normalizeDeclaredIndex`'s order — the organization
   * column first when it was prepended, otherwise the author's own order.
   */
  readonly columns: readonly string[];
  /**
   * The subset of {@link columns} whose NULL FOLDS onto one shared bucket
   * instead of exempting the row (ADR-0120 D3). In practice the organization
   * key part, and only on the `'organization'` spelling.
   */
  readonly nullSafeColumns: readonly string[];
}

/**
 * Either kind of unique constraint this module enforces. Every seam that
 * carries constraints — the driver's per-object map, {@link uniqueKeyOf},
 * {@link assertNoUniqueViolation} — takes this, so create/update/update-many
 * cannot disagree about what either surface means.
 */
export type MemoryUniqueEnforcement = MemoryUniqueConstraint | MemoryDeclaredIndexConstraint;

/** Is this the object-level (declared-index) shape? */
export function isDeclaredIndexConstraint(
  constraint: MemoryUniqueEnforcement,
): constraint is MemoryDeclaredIndexConstraint {
  return Array.isArray((constraint as MemoryDeclaredIndexConstraint).columns);
}

/** One declared `indexes[]` entry, as this module reads it. */
export interface DeclaredIndexInput {
  fields?: unknown;
  unique?: unknown;
}

/** The minimal schema shape this module reads. */
export interface UniqueAwareSchema {
  fields?: Record<string, unknown> | null;
  tenancy?: { enabled?: boolean; tenantField?: string } | null;
  /** [#13239] The object's declared `indexes[]`, if any. */
  indexes?: readonly DeclaredIndexInput[] | null;
}

/**
 * The object's tenant column, or `null`.
 *
 * Mirrors `SqlDriver.computeTenantField` arm for arm — explicit opt-out wins,
 * then a declared `tenancy.tenantField` that actually exists on the object,
 * then the implicit `organization_id` column the kernel injects. Reproduced
 * rather than imported because this package must not depend on `driver-sql`;
 * the two are held together by `memory-unique-constraint.test.ts`, which pins
 * each arm against the rule quoted above.
 */
export function tenantFieldOf(schema: UniqueAwareSchema | null | undefined): string | null {
  if (isTenancyDisabled(schema)) return null;
  const fields = schema?.fields;
  const declared = schema?.tenancy?.tenantField;
  if (typeof declared === 'string' && declared.length > 0) {
    if (fields && Object.prototype.hasOwnProperty.call(fields, declared)) return declared;
  }
  if (fields && Object.prototype.hasOwnProperty.call(fields, 'organization_id')) return 'organization_id';
  return null;
}

/**
 * The constraints an object's field-level `unique` declarations ask for.
 *
 * The single place a `unique` declaration becomes a constraint in this package,
 * so the create, update and update-many paths cannot disagree about what one
 * means — the same reason `uniqueIndexesFromFields` is the single place on the
 * SQL side.
 */
export function uniqueConstraintsFromFields(
  schema: UniqueAwareSchema | null | undefined,
): MemoryUniqueConstraint[] {
  const fields = schema?.fields;
  if (!fields) return [];
  const tenantField = tenantFieldOf(schema);
  const out: MemoryUniqueConstraint[] = [];
  for (const [name, field] of Object.entries(fields)) {
    const unique = (field as { unique?: unknown } | null | undefined)?.unique;
    if (!isUniqueDeclared(unique)) continue;
    // `'global'` opts out of organization scoping; a unique declaration ON the
    // tenant column itself cannot be scoped by it (`(org_id, org_id)` is not a
    // constraint) and stays single-column, exactly as on the SQL side.
    const scoped = !isGlobalUnique(unique) && tenantField != null && tenantField !== name;
    out.push({ field: name, scopeField: scoped ? tenantField : null });
  }
  return out;
}

/**
 * [#13239] The constraints an object's OBJECT-LEVEL declared `indexes[]` ask
 * for — `normalizeDeclaredIndex`'s arms, reproduced.
 *
 * ⚠️ The scope test here is the STRICT `unique === 'organization'`
 * ({@link isOrganizationUnique}), NOT the field surface's
 * "declared and not global". On this surface bare `true` is the positional
 * spelling of `'global'` and takes the listed columns VERBATIM — the #4986
 * trap, deliberate, and pinned on the SQL side by
 * `sql-driver-declared-index-organization-respelling.test.ts`. Reading it the
 * field surface's way would silently reinterpret every declared `unique: true`
 * as organization-scoped, which is precisely what the #8323 maintainer ruling
 * (2026-08-13) rejected.
 *
 * `driver-memory` must not depend on `driver-sql`, so the arms are reproduced
 * and pinned here (`memory-declared-index-unique.test.ts`), the way
 * {@link tenantFieldOf} reproduces `SqlDriver.computeTenantField`.
 */
export function uniqueConstraintsFromDeclaredIndexes(
  schema: UniqueAwareSchema | null | undefined,
): MemoryDeclaredIndexConstraint[] {
  const declared = schema?.indexes;
  if (!Array.isArray(declared)) return [];
  const tenantField = tenantFieldOf(schema);
  const out: MemoryDeclaredIndexConstraint[] = [];
  for (const idx of declared) {
    // The same filter the SQL side applies, and nothing more: a non-string or
    // empty entry is dropped, and an entry left with no columns is UNUSABLE
    // (`normalizeDeclaredIndex` answers null there).
    const listed = Array.isArray(idx?.fields)
      ? idx.fields.filter((f: unknown): f is string => typeof f === 'string' && f.length > 0)
      : [];
    if (listed.length === 0) continue;
    // Absent / `false` declares a PLAIN index — an access path, not a
    // constraint. This store is a linear scan, so there is nothing to build.
    if (!isUniqueDeclared(idx?.unique)) continue;

    if (isOrganizationUnique(idx?.unique) && tenantField) {
      // A listed column that IS the tenant column is not prepended again — its
      // own key part becomes the NULL-safe one instead (the hand-written S6
      // spelling, opted in), and the author's column order is kept.
      const columns = listed.includes(tenantField) ? listed : [tenantField, ...listed];
      out.push({ columns, nullSafeColumns: [tenantField] });
      continue;
    }
    // `'global'`, bare `true`, or `'organization'` on an object with no tenant
    // column: the listed columns, verbatim.
    out.push({ columns: listed, nullSafeColumns: [] });
  }
  return out;
}

/**
 * The bucket key a record occupies under one constraint, or `null` when the
 * record is EXEMPT because its unique field carries no value (SQL `UNIQUE` is
 * NULL-distinct — see the module note).
 *
 * The key is a canonical JSON encoding, so `5` and `'5'` are different values,
 * matching both SQL's one-type-per-column reality and this driver's own
 * `upsert` conflict-key comparison (`r[key] === data[key]`). It is computed on
 * the STORED form of the record, after temporal coercion, so a filter and a
 * constraint cannot disagree about what a datetime is (#4047).
 */
export function uniqueKeyOf(
  record: Record<string, unknown>,
  constraint: MemoryUniqueEnforcement,
): string | null {
  const parts: unknown[] = [];
  for (const part of keyPartsOf(constraint)) {
    // A NULL-SAFE part folds: `null` IS its bucket, and the row stays
    // constrained. That is the ADR-0120 D3 organization key part, and the only
    // kind of part that behaves this way on either surface.
    if (part.nullSafe) {
      parts.push(part.column === null ? null : (record[part.column] ?? null));
      continue;
    }
    const value = record[part.column as string];
    // Any other NULL key part EXEMPTS the whole row, exactly as SQL `UNIQUE` is
    // NULL-distinct — measured on both composite shapes (see the module note).
    if (value === null || value === undefined) return null;
    parts.push(value);
  }
  return JSON.stringify(parts);
}

/** One key part: a column to read, or `null` for the constant platform scope. */
interface UniqueKeyPart {
  readonly column: string | null;
  readonly nullSafe: boolean;
}

/**
 * The key parts of either constraint shape — the ONE place the two declaration
 * surfaces converge, so they cannot grow two NULL rules or two bucket models.
 *
 * The field-level mapping is exact rather than merely equivalent: a field-level
 * constraint is `[scope, value]` in that order, which is the encoding
 * {@link uniqueKeyOf} produced before #13239 widened it, and the same order the
 * SQL side puts the tenant column in (`(tenant, field)`, so the index also
 * serves the `WHERE tenant = ?` prefix scans).
 */
function keyPartsOf(constraint: MemoryUniqueEnforcement): readonly UniqueKeyPart[] {
  if (isDeclaredIndexConstraint(constraint)) {
    return constraint.columns.map((column) => ({
      column,
      nullSafe: constraint.nullSafeColumns.includes(column),
    }));
  }
  return [
    { column: constraint.scopeField, nullSafe: true },
    { column: constraint.field, nullSafe: false },
  ];
}

/**
 * The refusal, in the ADR-0112 envelope.
 *
 * No `[driver-memory]` prefix: the wire identity has to be the SQL family's,
 * and a driver name in the sentence is the leak `memory-filter-refusal-envelope`
 * pins the absence of for the filter family.
 */
export function uniqueViolationError(
  object: string,
  constraint: MemoryUniqueConstraint,
  value: unknown,
): Error & { code: string; status: number } {
  const scoped = constraint.scopeField ? ` within the same \`${constraint.scopeField}\`` : '';
  return conflictRefusal(
    `Unique constraint violated on \`${object}.${constraint.field}\`: a record with the value ` +
      `${JSON.stringify(value ?? null)} already exists${scoped}. No record was written.`,
  );
}

/**
 * [#13239] The declared-index refusal — the SAME envelope, a different
 * sentence, because the facts are different.
 *
 * A composite has no single offending column, so the message names the KEY
 * COLUMNS and their values rather than one field, and the NULL-safe
 * organization part (if any) is stated as the scope, mirroring the field-level
 * sentence. It carries no index NAME, deliberately (see the module note on
 * `uniqueViolationColumn`), and it is not shaped like any dialect's grammar, so
 * `uniqueViolationColumn` answers `undefined` — the same answer `driver-sql`
 * gives for a composite.
 *
 * Both factories stamp the envelope through {@link conflictRefusal}, so the two
 * surfaces cannot drift into two `code`/`status` pairs.
 */
export function declaredIndexViolationError(
  object: string,
  constraint: MemoryDeclaredIndexConstraint,
  record: Record<string, unknown>,
): Error & { code: string; status: number } {
  const scope = constraint.nullSafeColumns;
  const keyed = constraint.columns.filter((c) => !scope.includes(c));
  // A key whose ONLY part is the NULL-safe organization ("one row per
  // organization") has nothing left to list, so it reports its own column.
  const reported = keyed.length > 0 ? keyed : constraint.columns;
  const scoped =
    keyed.length > 0 && scope.length > 0
      ? ` within the same \`${scope.join('\`, \`')}\``
      : '';
  const values = JSON.stringify(
    Object.fromEntries(reported.map((c) => [c, record[c] ?? null])),
  );
  return conflictRefusal(
    `Unique constraint violated on \`${object}\` over (\`${reported.join('\`, \`')}\`): ` +
      `a record with the values ${values} already exists${scoped}. No record was written.`,
  );
}

/** The ADR-0112 envelope, stamped in ONE place for both declaration surfaces. */
function conflictRefusal(message: string): Error & { code: string; status: number } {
  const err = new Error(message) as Error & { code: string; status: number };
  err.code = UNIQUE_VIOLATION_CODE;
  err.status = UNIQUE_VIOLATION_STATUS;
  return err;
}

/**
 * Refuse `candidate` if it collides with any row in `rows` under any of
 * `constraints` — of EITHER declaration surface (#13239). `exceptId` excludes
 * the row being updated from its own check.
 *
 * A linear scan per constraint, deliberately: this driver's whole shape is
 * "plain arrays, no indexes", and an incremental index would be a second copy
 * of the table to keep in step with `create`/`update`/`updateMany`/`delete`/
 * transaction rollback — five seams for a store whose documented role is dev,
 * demo and in-process fixtures.
 */
export function assertNoUniqueViolation(
  object: string,
  rows: readonly Record<string, unknown>[],
  candidate: Record<string, unknown>,
  constraints: readonly MemoryUniqueEnforcement[],
  exceptId?: unknown,
): void {
  if (constraints.length === 0) return;
  for (const constraint of constraints) {
    const key = uniqueKeyOf(candidate, constraint);
    if (key === null) continue;
    for (const row of rows) {
      if (exceptId !== undefined && row.id === exceptId) continue;
      if (uniqueKeyOf(row, constraint) === key) {
        throw isDeclaredIndexConstraint(constraint)
          ? declaredIndexViolationError(object, constraint, candidate)
          : uniqueViolationError(object, constraint, candidate[constraint.field]);
      }
    }
  }
}
