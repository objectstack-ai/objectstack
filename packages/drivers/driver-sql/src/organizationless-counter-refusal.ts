// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The autonumber counter's refusal of an organization-less row on a tenant
 * table (ADR-0131 D9, stage 8d).
 *
 * The counter is keyed by `(table, tenant, field, scope)`. On an object with a
 * tenant column the tenant is the row's organization; a row that carries none
 * used to be filed under `GLOBAL_TENANT` — a second counter beside the
 * organization's own, which cannot see it, so a field declared unique minted
 * the same value twice. ADR-0131 D9 makes a missing organization a refused
 * write: the engine derives it under `single` and refuses otherwise
 * (`Engine.resolveSystemInsertOrganization`), so on a composition that
 * registers the organization object no write the engine makes reaches this
 * point without one. This refusal is the driver's own half of the same rule,
 * for a caller that writes through the driver directly: it fires before a
 * counter row is read or created, so nothing is minted and nothing is written.
 *
 * ## Where `GLOBAL_TENANT` stays the counter key
 *
 *  - an object with NO tenant column (`systemFields: { tenant: false }`,
 *    `tenancy: { enabled: false }`) — one counter for the installation, by
 *    declaration;
 *  - a composition that registers no organization object on this driver (a
 *    lean `@objectstack/objectql/core` embedding with no identity objects, a
 *    bare-kernel test): no organization can exist there, so there is nothing
 *    to refuse in the name of, and the engine's `no-organization-object`
 *    branch answers the same. `os serve` refuses a server boot whose auth was
 *    not composed, so a served stack is never this composition.
 *
 * Counter rows a 17.x install filed under `GLOBAL_TENANT` for a tenant table
 * stay in `_objectstack_sequences`; after this refusal the counter never
 * reads them again, and `os migrate duplicates` is what reports them.
 */

/**
 * The code, shared with the engine's refusal of the same write
 * (`SystemWriteOrganizationRequiredError`, `@objectstack/objectql`): one
 * condition, one name, whichever layer catches it.
 */
export const ORGANIZATIONLESS_COUNTER_REFUSAL_CODE = 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED';

/**
 * 500, as the engine's twin: the caller that reaches this is server-side code
 * that wrote through the driver without threading an organization, never an
 * HTTP client.
 */
export const ORGANIZATIONLESS_COUNTER_REFUSAL_STATUS = 500;

/** Thrown by `SqlDriver.resolveSequenceTenantId` — both faces, one throw site. */
export class OrganizationlessCounterRefusal extends Error {
  readonly code = ORGANIZATIONLESS_COUNTER_REFUSAL_CODE;
  readonly status = ORGANIZATIONLESS_COUNTER_REFUSAL_STATUS;
  /** ADR-0112 D5's spelling of the same number. */
  readonly httpStatus = ORGANIZATIONLESS_COUNTER_REFUSAL_STATUS;

  constructor(
    /** The table the autonumber belongs to. */
    readonly table: string,
    /** The autonumber field. */
    readonly field: string,
    /** The object's tenant column. */
    readonly tenantField: string,
  ) {
    super(renderOrganizationlessCounterRefusal(table, field, tenantField));
    this.name = 'OrganizationlessCounterRefusal';
  }
}

/** The refusal's prose: what was refused, why, and how to carry the organization. */
export function renderOrganizationlessCounterRefusal(table: string, field: string, tenantField: string): string {
  return (
    `Autonumber '${table}.${field}' was REFUSED: the row carries no ${tenantField}, and '${table}' is ` +
    `owned per organization. Every row on it belongs to an organization (ADR-0131 D9), so there is no ` +
    `organization-less counter to draw the number from. Nothing was written. Fix it by carrying the ` +
    `organization: set ${tenantField} on the record, or pass it as the driver option tenantId — or ` +
    `write through the engine, which derives it under the 'single' posture.`
  );
}
