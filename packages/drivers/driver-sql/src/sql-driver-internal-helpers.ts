// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Internal helpers" section of `SqlDriver`: the bodies of
 * `applyTenantScope`, `injectTenantOnInsert`, `auditMissingTenant` moved out of
 * `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link InternalHelpersHost}: exactly the
 * `SqlDriver` members they read. Each method hands its body one literal of the
 * members that body reads, plus a `.call`: methods go as closures that call
 * them on the driver at call time (the builder factory as a bound reference),
 * so a subclass override or an instance spy is still the one reached; fields
 * and accessors go as GETTERS, read when the body reads them, as they were on
 * the class.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import type { Knex } from 'knex';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface InternalHelpersHost {
  isMultiTenantMode: SqlDriver['isMultiTenantMode'];
  readonly logger: SqlDriver['logger'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  readonly tenantAuditWarned: SqlDriver['tenantAuditWarned'];
}

/** The body of `SqlDriver#applyTenantScope`; the method's docblock there is its contract. */
export function applyTenantScope(this: Pick<InternalHelpersHost, 'resolveTenantField'>, builder: Knex.QueryBuilder, object: string, options?: DriverOptions): Knex.QueryBuilder {
    const tenantId = options?.tenantId;
    if (tenantId === undefined || tenantId === null || tenantId === '') return builder;
    const field = this.resolveTenantField(object);
    if (!field) return builder;
    // [ADR-0105 D2 / #3623] Union tenant scope: under the `group` posture the
    // engine threads the caller's whole membership set as `tenantIds`, and the
    // native wall widens to `IN (...)` — the SAME union the Layer 0
    // authorization wall enforces above. Equality here would AND under that
    // union and collapse group reads to active-org reach. A malformed or
    // empty set falls through to the equality path: fail toward isolation,
    // never toward exposure. Insert-side injection (injectTenantOnInsert)
    // deliberately keeps `tenantId` — the active org is the write target (D5).
    const rawIds = options?.tenantIds;
    const tenantIds = Array.isArray(rawIds)
      ? rawIds.filter((v: unknown) => typeof v === 'string' && v !== '')
      : [];
    if (tenantIds.length > 0) {
      return builder.whereIn(field, tenantIds.map(String));
    }
    // `field = :tenantId`, and nothing else. [ADR-0131 D1, D14] NULL is not an
    // owner: an organization-less row is no tenant's, so no tenant scope reaches
    // it. The v17 reading (#2734) added an `OR field IS NULL` arm here, under
    // which such a row stood for platform state; ADR-0131 replaced that reading
    // (D2, D6, D7) and the 18.x upgrade ceremony retired the rows it served: a
    // certified database holds no NULL organization, a fresh install never
    // writes one, and a v17 database is refused at boot until it is certified.
    // A composition that registers no organization object can still write
    // organization-less rows, and it never reaches this line with a tenant: no
    // session, guest or system write there carries an organization.
    return builder.where(field, String(tenantId));
  }

/** The body of `SqlDriver#injectTenantOnInsert`; the method's docblock there is its contract. */
export function injectTenantOnInsert(this: Pick<InternalHelpersHost, 'resolveTenantField'>, object: string, row: Record<string, any>, options?: DriverOptions): void {
    const tenantId = options?.tenantId;
    if (tenantId === undefined || tenantId === null || tenantId === '') return;
    const field = this.resolveTenantField(object);
    if (!field) return;
    if (row[field] === undefined || row[field] === null || row[field] === '') {
      row[field] = String(tenantId);
    }
  }

/** The body of `SqlDriver#auditMissingTenant`; the method's docblock there is its contract. */
export function auditMissingTenant(this: Pick<InternalHelpersHost, 'isMultiTenantMode' | 'logger' | 'resolveTenantField' | 'tenantAuditWarned'>, object: string, op: 'create' | 'update' | 'delete' | 'bulkCreate' | 'bulkDelete' | 'updateMany' | 'deleteMany' | 'upsert', options?: DriverOptions, insertRows?: readonly unknown[]): void {
    if (process.env.OS_TENANT_AUDIT === '0') return;
    if (options?.bypassTenantAudit === true) return;
    // A write that DID carry its tenant is the case this audit has nothing to
    // say about, and it is the overwhelmingly common one — so it exits here,
    // before the posture read below. Ordering only (both guards are pure
    // predicates over independent facts); it is what makes `isMultiTenantMode()`
    // affordable as a live read now that it no longer memoises (#5262).
    const tenantId = options?.tenantId;
    if (tenantId !== undefined && tenantId !== null && tenantId !== '') return;
    // Only meaningful in multi-tenant deployments. Single-tenant stacks have no
    // tenant isolation, yet the kernel now ALWAYS provisions an `organization_id`
    // column (its existence is decoupled from the tenant flag). Column presence
    // alone therefore no longer implies "tenant-scoped" — without this gate every
    // system/sudo write (e.g. the notification/http delivery dispatchers' claim
    // updates) would spam a meaningless warning on single-tenant boots.
    if (!this.isMultiTenantMode()) return;
    const field = this.resolveTenantField(object);
    if (!field) return;
    // Empty is spelled as `injectTenantOnInsert` spells it: a row it would
    // stamp is a row that does not carry its organization.
    const carriesTenant = (row: unknown): boolean => {
      const value = row && typeof row === 'object' ? (row as Record<string, unknown>)[field] : undefined;
      return value !== undefined && value !== null && value !== '';
    };
    if (insertRows !== undefined && insertRows.length > 0 && insertRows.every(carriesTenant)) return;
    const key = `${object}:${op}`;
    if (this.tenantAuditWarned.has(key)) return;
    this.tenantAuditWarned.add(key);
    this.logger.warn(
      `[tenant-audit] ${op} on tenant-scoped object "${object}" without options.tenantId — the statement is not confined to one organization. `
        + 'If the write belongs to one organization, run it in that organization\'s context (an ExecutionContext carrying its organization); '
        + 'the row\'s own organization column does not scope an update or a delete. '
        + 'If it crosses organizations on purpose (a platform admin the organization wall exempts, or a system job over every organization), '
        + 'nothing needs fixing: the caller declares it with bypassTenantAudit:true, which also silences this line.',
      { object, op, tenantField: field },
    );
  }
