// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform-admin door that saves and deletes identity-provider group
 * mappings: `POST /api/v1/auth/admin/scim/set-group-mapping` and
 * `POST /api/v1/auth/admin/scim/delete-group-mapping` (ADR-0134 D4's group
 * seam, filled for ordinary permission sets).
 *
 * ## Two sources, one door
 *
 * A mapping's group arrives either through a SCIM connection (`connectionId`)
 * or as an SSO provider's sign-in claim (`providerId`; maintainer ruling A,
 * record 6718355623, item 3: the same mapping object, no second model). A save
 * names exactly one. Everything below holds for both; where they differ it
 * says so.
 *
 * ## Who may use it
 *
 * The platform administrator only, the same population that mints the SCIM
 * connection's bearer: both mounts run the shared `judgePlatformAdmin` gate
 * (ADR-0068 D2) in `auth-plugin.ts` before this module reads anything. The
 * `sys_idp_group_mapping` data API is list-only, so this is the only writer.
 *
 * ## What a save refuses, and why at save
 *
 * Every SCIM write runs as the system, so the delegated-administration gate
 * that bounds an organization administrator's assignments never runs on a
 * projected grant. The boundary therefore moves HERE: a mapping whose
 * permission set fails the organization boundary (plugin-security's
 * `organizationBoundaryFailure`, read through the `security` service, never a
 * copy of its list) is refused with `400 VALIDATION_FAILED` on
 * `permissionSet`. That covers the administrator sets, the agent ceilings, a
 * superuser wildcard, an `adminScope` and a capability not scoped to the
 * organization: an identity provider's group never confers administrator
 * standing. With no security service to ask, nothing can be shown inside the
 * boundary, and the save is refused `503`.
 *
 * The grant's organization is the one that owns the connection (its credential
 * rows' `organization_id`), never a value the caller names. A connection with a
 * credential that names no organization, or with credentials in two, is refused
 * (`rule_violation` on `connectionId`): a mapping always names exactly one
 * organization, so the projection never writes an organization-less grant. For
 * an SSO provider it is the provider row's `organization_id`, and a provider
 * that names none is refused the same way (`rule_violation` on `providerId`).
 *
 * ## After a save or delete
 *
 * The connection's provisioning domains are re-projected at once (the vendor's
 * `reconcileSCIMProjection`), so the group's CURRENT members gain or lose the
 * set now rather than at their next SCIM change. A failed re-projection does
 * not undo the saved row; the answer says so, and the next SCIM change of each
 * member applies it.
 *
 * An SSO provider pushes nothing between sign-ins, so who is in a group is only
 * known at a member's sign-in: a save applies at each member's next sign-in
 * (the answer says `reprojected: false`). A delete removes at once the grants
 * that provider projected for the mapping's set in its organization, unless
 * another of the provider's mappings still names that set there (then each
 * member's next sign-in decides); `reconciledUsers` counts the users whose
 * grant went.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { withSystemContext } from './objectql-adapter.js';
import type { PlatformAdminActor } from './platform-admin-gate.js';
import { readJsonRequestBody } from './request-json-body.js';
import { SCIM_CREDENTIAL_OBJECT, scimCredentialIsLive } from './scim-connection-service.js';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';
import {
  IDP_GROUP_MAPPING_OBJECT,
  SCIM_MAPPING_SOURCE_KIND,
  SSO_MAPPING_SOURCE_KIND,
  ssoGroupProjectionReason,
  type IdpGroupMappingSourceKind,
  type OrganizationBoundaryJudge,
} from './scim-group-projection.js';

export const IDP_GROUP_MAPPING_SET_PATH = '/admin/scim/set-group-mapping';
export const IDP_GROUP_MAPPING_DELETE_PATH = '/admin/scim/delete-group-mapping';

const SYSTEM_CTX = { isSystem: true } as const;
const MAX_TEXT = 255;
const MAX_SET_NAME = 100;
const SET_BODY_KEYS = new Set(['connectionId', 'providerId', 'groupExternalId', 'groupDisplayName', 'permissionSet']);
const GRANT_OBJECT = 'sys_user_permission_set';

interface FieldRefusal {
  field: string;
  code: 'required' | 'unknown_field' | 'invalid_type' | 'max_length' | 'reference_not_found' | 'rule_violation';
  message: string;
}

export interface IdpGroupMappingAdminResult {
  status: 200 | 400 | 404 | 409 | 503;
  body:
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: { code: string; message: string; fields?: FieldRefusal[] } };
}

export interface IdpGroupMappingAdminDeps {
  getDataEngine: () => IDataEngine | null | undefined;
  isScimEnabled: () => boolean;
  /** Is the SSO plugin wired? Absent reads as no: an SSO mapping is then refused 503. */
  isSsoEnabled?: () => boolean;
  /** The `security` service's boundary predicate, resolved per call. */
  boundary: () => Promise<OrganizationBoundaryJudge | undefined>;
  /** Re-project one provisioning domain (`AuthManager.reconcileScimProjectionDomain`). */
  reconcile: (provisioningDomainId: string) => Promise<{ reconciledUsers: number }>;
  /** Run the writes credited to the administrator (attribution only). */
  attributed: <T>(fn: () => Promise<T>) => Promise<T>;
  logger?: { warn: (message: string) => void; error: (message: string) => void };
}

function fail(status: IdpGroupMappingAdminResult['status'], code: string, message: string, fields?: FieldRefusal[]): IdpGroupMappingAdminResult {
  return { status, body: { success: false, error: { code, message, ...(fields ? { fields } : {}) } } };
}

function refuseFields(fields: FieldRefusal[]): IdpGroupMappingAdminResult {
  return fail(400, 'VALIDATION_FAILED', fields.map((f) => f.message).join(' '), fields);
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function registered(engine: IDataEngine, object: string): boolean {
  const getSchema = (engine as unknown as { getSchema?: (name: string) => unknown }).getSchema;
  return typeof getSchema !== 'function' || Boolean(getSchema.call(engine, object));
}

async function readObjectBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; result: IdpGroupMappingAdminResult }> {
  const reading = await readJsonRequestBody(request);
  if (!reading.ok) return { ok: false, result: fail(400, 'INVALID_REQUEST', reading.message) };
  const body = reading.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, result: fail(400, 'INVALID_REQUEST', 'The request body must be a JSON object') };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

/** An optional text member, trimmed: absent/blank → undefined. */
function readText(body: Record<string, unknown>, key: string, max: number, refusals: FieldRefusal[]): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    refusals.push({ field: key, code: 'invalid_type', message: `${key} must be a string.` });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > max) refusals.push({ field: key, code: 'max_length', message: `${key} is longer than ${max} characters.` });
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The connection's credential rows: its owning organization, read from its LIVE
 * credentials only (what the bearer verifier accepts: `scimCredentialIsLive`),
 * and its provisioning domains, read from every row. A revoked credential stays
 * stored (revoke switches `active` off), so counting it would let a credential
 * revoked in one organization make the connection ambiguous forever once a new
 * one is minted in another; the domains still include it, so a delete re-projects
 * every domain the connection ever provisioned.
 */
async function readConnection(
  engine: IDataEngine,
  connectionId: string,
): Promise<{ found: false } | { found: true; organizations: string[]; domains: string[] }> {
  const rows = await engine.find(
    SCIM_CREDENTIAL_OBJECT,
    { where: { connection_id: connectionId }, fields: ['organization_id', 'provisioning_domain_id', 'active', 'expires_at'] },
    { context: SYSTEM_CTX } as never,
  );
  const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  if (list.length === 0) return { found: false };
  return {
    found: true,
    organizations: [...new Set(list.filter((r) => scimCredentialIsLive(r)).map((r) => text(r.organization_id)))],
    domains: [...new Set(list.map((r) => text(r.provisioning_domain_id) || connectionId))],
  };
}

async function writeMappingAudit(
  deps: IdpGroupMappingAdminDeps,
  engine: IDataEngine,
  entry: { action: 'create' | 'delete'; actor: PlatformAdminActor; mappingId: string; event: string; source: MappingSource; permissionSet: string },
): Promise<void> {
  if (!registered(engine, 'sys_audit_log')) return; // plugin-audit uninstalled: a declared skip
  try {
    await engine.insert(
      'sys_audit_log',
      {
        action: entry.action,
        user_id: entry.actor.id,
        actor: entry.actor.id,
        object_name: IDP_GROUP_MAPPING_OBJECT,
        record_id: entry.mappingId,
        metadata: JSON.stringify({
          event: entry.event,
          ...(entry.source.kind === SSO_MAPPING_SOURCE_KIND ? { providerId: entry.source.id } : { connectionId: entry.source.id }),
          permissionSet: entry.permissionSet,
          ...(entry.actor.impersonatedBy ? { impersonated_by: entry.actor.impersonatedBy } : {}),
        }),
      },
      { context: SYSTEM_CTX },
    );
  } catch (error) {
    deps.logger?.warn(
      `[AuthPlugin] the sys_audit_log row for IdP group mapping ${entry.mappingId} (${entry.event}, ${sourceWord(entry.source)} `
        + `'${entry.source.id}') was NOT written — the change itself SUCCEEDED and nothing retries the row. `
        + 'Remedy: restore write access to sys_audit_log, then treat this line as the audit record. '
        + `Cause: ${(error as Error)?.message ?? String(error)}`,
    );
  }
}

/** Re-project each domain; a failure is reported, never thrown (the row change stands). */
async function reproject(deps: IdpGroupMappingAdminDeps, connectionId: string, domains: string[]): Promise<Record<string, unknown>> {
  let reconciledUsers = 0;
  try {
    for (const domain of domains) reconciledUsers += (await deps.reconcile(domain)).reconciledUsers;
    return { reprojected: true, reconciledUsers };
  } catch (error) {
    deps.logger?.error(
      `[AuthPlugin] IdP group mapping change for SCIM connection '${connectionId}' was SAVED, but applying it to the `
        + 'group\'s current members FAILED, so their grants still reflect the old mapping until each member\'s next SCIM '
        + `change. Remedy: save the mapping again once the cause is fixed. Cause: ${(error as Error)?.message ?? String(error)}`,
    );
    return { reprojected: false, reconciledUsers };
  }
}

/** Where a mapping's group arrives from. */
interface MappingSource {
  kind: IdpGroupMappingSourceKind;
  id: string;
}

/** How a message names a source. */
function sourceWord(source: MappingSource): string {
  return source.kind === SSO_MAPPING_SOURCE_KIND ? 'SSO provider' : 'SCIM connection';
}

/** The answer's member naming the source: `providerId` for an SSO provider, `connectionId` for a SCIM connection. */
function sourceMember(source: MappingSource): Record<string, string> {
  return source.kind === SSO_MAPPING_SOURCE_KIND ? { providerId: source.id } : { connectionId: source.id };
}

/** The organization that owns an SSO provider: its row's `organization_id`. */
async function readSsoProviderOrganization(
  engine: IDataEngine,
  providerId: string,
): Promise<{ found: false } | { found: true; organizationId: string }> {
  const row = (await engine.findOne(
    SSO_PROVIDER_OBJECT,
    { where: { provider_id: providerId }, fields: ['organization_id'] },
    { context: SYSTEM_CTX } as never,
  )) as Record<string, unknown> | null;
  return row ? { found: true, organizationId: text(row.organization_id) } : { found: false };
}

/**
 * Remove the grants an SSO provider projected for (`permissionSet`, `organizationId`),
 * unless another of its mappings still names that set there. Each removal goes
 * through the engine, so its write guards judge it; a failure is reported,
 * never thrown (the row change stands).
 */
async function revokeSsoProjectedGrants(
  deps: IdpGroupMappingAdminDeps,
  engine: IDataEngine,
  providerId: string,
  permissionSet: string,
  organizationId: string,
): Promise<Record<string, unknown>> {
  try {
    const remaining = await engine.find(
      IDP_GROUP_MAPPING_OBJECT,
      { where: { source_kind: SSO_MAPPING_SOURCE_KIND, source_id: providerId, permission_set: permissionSet } },
      { context: SYSTEM_CTX } as never,
    );
    const stillNamed = (Array.isArray(remaining) ? (remaining as Record<string, unknown>[]) : []).some(
      (r) => text(r.organization_id) === organizationId,
    );
    if (stillNamed || !registered(engine, GRANT_OBJECT)) return { reprojected: false, reconciledUsers: 0 };
    const grants = await engine.find(
      GRANT_OBJECT,
      {
        where: { reason: ssoGroupProjectionReason(providerId), permission_set: permissionSet, organization_id: organizationId },
        fields: ['id', 'user_id'],
      },
      { context: SYSTEM_CTX } as never,
    );
    const writer: IDataEngine = withSystemContext(engine);
    const users = new Set<string>();
    for (const grant of Array.isArray(grants) ? (grants as Record<string, unknown>[]) : []) {
      await writer.delete(GRANT_OBJECT, { where: { id: text(grant.id) } });
      users.add(text(grant.user_id));
    }
    return { reprojected: true, reconciledUsers: users.size };
  } catch (error) {
    deps.logger?.error(
      `[AuthPlugin] IdP group mapping for SSO provider '${providerId}' was DELETED, but removing the grants of `
        + `'${permissionSet}' it projected FAILED, so those users keep the set until their next sign-in through that `
        + `provider. Remedy: remove the grants by hand, or have each user sign in again. Cause: ${(error as Error)?.message ?? String(error)}`,
    );
    return { reprojected: false, reconciledUsers: 0 };
  }
}

/** `POST /admin/scim/set-group-mapping` — save one group → permission-set mapping for a SCIM connection or an SSO provider. */
export async function runSetIdpGroupMapping(
  deps: IdpGroupMappingAdminDeps,
  actor: PlatformAdminActor,
  request: Request,
): Promise<IdpGroupMappingAdminResult> {
  const reading = await readObjectBody(request);
  if (!reading.ok) return reading.result;
  const body = reading.body;

  const refusals: FieldRefusal[] = [];
  for (const key of Object.keys(body)) {
    if (!SET_BODY_KEYS.has(key)) {
      refusals.push({ field: key, code: 'unknown_field', message: `${key} is not a field of a group mapping (connectionId, providerId, groupExternalId, groupDisplayName, permissionSet).` });
    }
  }
  const connectionId = readText(body, 'connectionId', MAX_TEXT, refusals);
  const providerId = readText(body, 'providerId', MAX_TEXT, refusals);
  const groupExternalId = readText(body, 'groupExternalId', MAX_TEXT, refusals);
  const groupDisplayName = readText(body, 'groupDisplayName', MAX_TEXT, refusals);
  const permissionSet = readText(body, 'permissionSet', MAX_SET_NAME, refusals);
  if (!connectionId && !providerId) {
    refusals.push({ field: 'connectionId', code: 'required', message: 'connectionId is required: the SCIM connection the group arrives through (or providerId: the SSO provider whose sign-in carries it).' });
  } else if (connectionId && providerId) {
    refusals.push({ field: 'providerId', code: 'rule_violation', message: 'Name the source by connectionId (a SCIM connection) or by providerId (an SSO provider), not both.' });
  }
  if (!permissionSet) refusals.push({ field: 'permissionSet', code: 'required', message: 'permissionSet is required: the permission set a member of the group is granted.' });
  if (!groupExternalId && !groupDisplayName) {
    refusals.push({ field: 'groupExternalId', code: 'required', message: 'Name the group by groupExternalId or by groupDisplayName.' });
  } else if (groupExternalId && groupDisplayName) {
    refusals.push({ field: 'groupDisplayName', code: 'rule_violation', message: 'Name the group by groupExternalId or by groupDisplayName, not both.' });
  }
  if (refusals.length > 0 || !permissionSet) return refuseFields(refusals);
  const source: MappingSource = providerId
    ? { kind: SSO_MAPPING_SOURCE_KIND, id: providerId }
    : { kind: SCIM_MAPPING_SOURCE_KIND, id: connectionId! };

  if (source.kind === SCIM_MAPPING_SOURCE_KIND && !deps.isScimEnabled()) {
    return fail(503, 'SERVICE_UNAVAILABLE', 'SCIM provisioning is not enabled on this deployment, so no group can arrive to be mapped. Enable it (OS_SCIM_ENABLED=true, or plugins.scim) and save again.');
  }
  if (source.kind === SSO_MAPPING_SOURCE_KIND && !deps.isSsoEnabled?.()) {
    return fail(503, 'SERVICE_UNAVAILABLE', 'SSO is not enabled on this deployment, so no sign-in can carry a group to be mapped. Enable it (OS_SSO_ENABLED=true, or plugins.sso) and save again.');
  }
  const engine = deps.getDataEngine();
  if (!engine || !registered(engine, IDP_GROUP_MAPPING_OBJECT)) {
    return fail(503, 'SERVICE_UNAVAILABLE', 'The data engine or the sys_idp_group_mapping object is unavailable.');
  }

  let organizationId: string;
  let domains: string[] = [];
  if (source.kind === SSO_MAPPING_SOURCE_KIND) {
    const provider = await readSsoProviderOrganization(engine, source.id);
    if (!provider.found) {
      return refuseFields([{ field: 'providerId', code: 'reference_not_found', message: `No SSO provider '${source.id}' exists: register it first.` }]);
    }
    if (!provider.organizationId) {
      return refuseFields([{ field: 'providerId', code: 'rule_violation', message: `SSO provider '${source.id}' belongs to no organization, so a grant its sign-in makes would belong to no organization. Register the provider in an organization first.` }]);
    }
    organizationId = provider.organizationId;
  } else {
    const connection = await readConnection(engine, source.id);
    if (!connection.found) {
      return refuseFields([{ field: 'connectionId', code: 'reference_not_found', message: `No SCIM connection '${source.id}' exists: mint its credential first.` }]);
    }
    if (connection.organizations.length === 0) {
      return refuseFields([{ field: 'connectionId', code: 'rule_violation', message: `SCIM connection '${source.id}' has no live credential (every one is revoked or expired), so no organization owns it. Mint a credential for it first.` }]);
    }
    if (connection.organizations.includes('')) {
      return refuseFields([{ field: 'connectionId', code: 'rule_violation', message: `SCIM connection '${source.id}' has a credential owned by no organization, so a grant it makes would belong to no organization. Mint the connection's credential in an organization first.` }]);
    }
    if (connection.organizations.length > 1) {
      return refuseFields([{ field: 'connectionId', code: 'rule_violation', message: `SCIM connection '${source.id}' has credentials owned by more than one organization, so the organization a grant belongs to is ambiguous. Revoke the stray credentials first.` }]);
    }
    organizationId = connection.organizations[0];
    domains = connection.domains;
  }

  const judge = await deps.boundary();
  if (!judge) {
    return fail(503, 'SERVICE_UNAVAILABLE', 'The security service is not available, so no permission set can be shown to be inside the organization boundary; nothing was saved.');
  }
  const failure = await judge.organizationBoundaryFailure(permissionSet);
  if (failure !== null) {
    return refuseFields([{
      field: 'permissionSet',
      code: 'rule_violation',
      message: `An identity provider group grants only ordinary permission sets inside the organization boundary, never administrator standing; refused: ${failure}.`,
    }]);
  }

  const row = {
    source_kind: source.kind,
    source_id: source.id,
    ...(groupExternalId ? { group_external_id: groupExternalId } : { group_display_name: groupDisplayName }),
    permission_set: permissionSet,
    organization_id: organizationId,
  };
  const sameRows = await engine.find(
    IDP_GROUP_MAPPING_OBJECT,
    { where: { source_kind: source.kind, source_id: source.id, permission_set: permissionSet } },
    { context: SYSTEM_CTX } as never,
  );
  const sameKey = (Array.isArray(sameRows) ? (sameRows as Record<string, unknown>[]) : []).filter(
    (r) => text(r.group_external_id) === (groupExternalId ?? '') && text(r.group_display_name) === (groupExternalId ? '' : groupDisplayName ?? ''),
  );
  // A same-key row saved while another organization owned the source is not
  // this mapping: its row and its grants stay in that organization. Never
  // answer an organization the row does not carry, and never write a twin.
  const elsewhere = sameKey.find((r) => text(r.organization_id) !== organizationId);
  if (elsewhere) {
    const owner = source.kind === SSO_MAPPING_SOURCE_KIND ? 'provider' : 'connection';
    return fail(
      409,
      'RESOURCE_CONFLICT',
      `IdP group mapping '${text(elsewhere.id)}' already maps this group to '${permissionSet}' for ${sourceWord(source)} '${source.id}' in organization '${text(elsewhere.organization_id)}', but the ${owner} now belongs to organization '${organizationId}'. Delete mapping '${text(elsewhere.id)}' first (POST /admin/scim/delete-group-mapping), then save again.`,
    );
  }
  const existing = sameKey.find((r) => text(r.organization_id) === organizationId);
  let mappingId: string;
  if (existing) {
    mappingId = text(existing.id);
  } else {
    const writer: IDataEngine = withSystemContext(engine);
    const inserted = (await deps.attributed(() => writer.insert(IDP_GROUP_MAPPING_OBJECT, row))) as Record<string, unknown>;
    mappingId = text(inserted?.id);
    await writeMappingAudit(deps, engine, { action: 'create', actor, mappingId, event: 'idp_group_mapping_saved', source, permissionSet });
  }
  // An SSO provider pushes nothing between sign-ins: the mapping applies at each member's next sign-in.
  const applied = source.kind === SSO_MAPPING_SOURCE_KIND
    ? { reprojected: false, reconciledUsers: 0 }
    : await deps.attributed(() => reproject(deps, source.id, domains));
  return {
    status: 200,
    body: {
      success: true,
      data: { mappingId, created: !existing, ...sourceMember(source), permissionSet, organizationId: organizationId || null, ...applied },
    },
  };
}

/** `POST /admin/scim/delete-group-mapping` — delete one mapping; the grants it projected go with it. */
export async function runDeleteIdpGroupMapping(
  deps: IdpGroupMappingAdminDeps,
  actor: PlatformAdminActor,
  request: Request,
): Promise<IdpGroupMappingAdminResult> {
  const reading = await readObjectBody(request);
  if (!reading.ok) return reading.result;
  const mappingId = reading.body.mappingId;
  if (typeof mappingId !== 'string' || mappingId.trim() === '') {
    return refuseFields([{ field: 'mappingId', code: 'required', message: 'mappingId is required: the id the save answered.' }]);
  }
  const engine = deps.getDataEngine();
  if (!engine || !registered(engine, IDP_GROUP_MAPPING_OBJECT)) {
    return fail(503, 'SERVICE_UNAVAILABLE', 'The data engine or the sys_idp_group_mapping object is unavailable.');
  }
  const row = (await engine.findOne(
    IDP_GROUP_MAPPING_OBJECT,
    { where: { id: mappingId } },
    { context: SYSTEM_CTX } as never,
  )) as Record<string, unknown> | null;
  if (!row) return fail(404, 'RESOURCE_NOT_FOUND', `No IdP group mapping '${mappingId}' exists`);
  const source: MappingSource = {
    kind: text(row.source_kind) === SSO_MAPPING_SOURCE_KIND ? SSO_MAPPING_SOURCE_KIND : SCIM_MAPPING_SOURCE_KIND,
    id: text(row.source_id),
  };
  const permissionSet = text(row.permission_set);
  const writer: IDataEngine = withSystemContext(engine);
  await deps.attributed(() => writer.delete(IDP_GROUP_MAPPING_OBJECT, { where: { id: mappingId } }));
  await writeMappingAudit(deps, engine, { action: 'delete', actor, mappingId, event: 'idp_group_mapping_deleted', source, permissionSet });
  let applied: Record<string, unknown>;
  if (source.kind === SSO_MAPPING_SOURCE_KIND) {
    applied = await deps.attributed(() => revokeSsoProjectedGrants(deps, engine, source.id, permissionSet, text(row.organization_id)));
  } else {
    const connection = deps.isScimEnabled() ? await readConnection(engine, source.id) : ({ found: false } as const);
    applied = connection.found ? await deps.attributed(() => reproject(deps, source.id, connection.domains)) : { reprojected: false, reconciledUsers: 0 };
  }
  return { status: 200, body: { success: true, data: { mappingId, ...sourceMember(source), permissionSet, deleted: true, ...applied } } };
}
