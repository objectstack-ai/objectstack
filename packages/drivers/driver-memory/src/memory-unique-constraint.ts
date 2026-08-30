// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field-level uniqueness for the in-memory driver — the constraint this driver
 * enforced NOWHERE until now (#13197).
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
 * `'global'`** — at FIELD level. (On a declared `indexes[]` entry bare `true`
 * means `'global'`; that surface is not this module's, see "Deliberately out of
 * scope".) Getting that backwards makes two organizations' identical record
 * numbers collide on a constraint neither can see, which is the exact
 * cross-tenant existence oracle ADR-0120 D1 exists to remove.
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
 * ### NULL values stay NULL-DISTINCT, deliberately
 *
 * A row whose unique FIELD is `null`/absent is exempt, exactly as under SQL
 * `UNIQUE`. Folding those together instead would refuse the second row of every
 * table with an optional unique column — a refusal `driver-sql` does not issue,
 * i.e. a fresh divergence introduced by the fix for a divergence.
 *
 * ## Deliberately out of scope (#13197's dispatch, and stated so it is not read as done)
 *
 *  - **Declared `indexes[]`** — object-level composite uniques
 *    (`normalizeDeclaredIndex`) are NOT enforced here. Same defect class, wider
 *    surface, its own card.
 *  - **Primary keys.** A duplicate `id` still lands unless `id` itself declares
 *    `unique`. The driver docstring says so.
 *  - **Row-level tenant isolation.** This scopes a uniqueness KEY the way
 *    ADR-0120 does; it does not make reads tenant-filtered. This driver still
 *    refuses to boot multi-tenant (`memory-tenancy-guard.ts`, #6915) and that
 *    guard is untouched — which is also why the scope arm above is, in
 *    practice, reached only through an object carrying an `organization_id`
 *    column WITHOUT an explicit `tenancy` block.
 */

import { isGlobalUnique, isUniqueDeclared, isTenancyDisabled } from '@objectstack/spec/data';

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

/** The minimal schema shape this module reads. */
export interface UniqueAwareSchema {
  fields?: Record<string, unknown> | null;
  tenancy?: { enabled?: boolean; tenantField?: string } | null;
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
  constraint: MemoryUniqueConstraint,
): string | null {
  const value = record[constraint.field];
  if (value === null || value === undefined) return null;
  const scope = constraint.scopeField === null ? null : (record[constraint.scopeField] ?? null);
  return JSON.stringify([scope, value]);
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
  const err = new Error(
    `Unique constraint violated on \`${object}.${constraint.field}\`: a record with the value ` +
      `${JSON.stringify(value ?? null)} already exists${scoped}. No record was written.`,
  ) as Error & { code: string; status: number };
  err.code = UNIQUE_VIOLATION_CODE;
  err.status = UNIQUE_VIOLATION_STATUS;
  return err;
}

/**
 * Refuse `candidate` if it collides with any row in `rows` under any of
 * `constraints`. `exceptId` excludes the row being updated from its own check.
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
  constraints: readonly MemoryUniqueConstraint[],
  exceptId?: unknown,
): void {
  if (constraints.length === 0) return;
  for (const constraint of constraints) {
    const key = uniqueKeyOf(candidate, constraint);
    if (key === null) continue;
    for (const row of rows) {
      if (exceptId !== undefined && row.id === exceptId) continue;
      if (uniqueKeyOf(row, constraint) === key) {
        throw uniqueViolationError(object, constraint, candidate[constraint.field]);
      }
    }
  }
}
