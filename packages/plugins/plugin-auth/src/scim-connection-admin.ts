// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform-admin door that mints and revokes SCIM connection credentials:
 * `POST /api/v1/auth/admin/scim/mint-credential` and
 * `POST /api/v1/auth/admin/scim/revoke-credential` (#30958, ADR-0134).
 *
 * ## Why it exists
 *
 * ObjectStack owns the whole SCIM credential lifecycle (`scim-connection-service.ts`):
 * the stable `@better-auth/scim` plugin stores no bearer of its own and resolves
 * every connection from a `sys_scim_connection_credential` row at request time.
 * The verifier was wired and the mint was written, but nothing called the mint:
 * the object refuses create on the data API (`enable.apiMethods: ['list']`,
 * `managedBy: 'engine-owned'`), so no identity provider could ever be handed a
 * bearer. These two mounts are that door, and the only one.
 *
 * ## Who may use it
 *
 * The platform administrator only. Both mounts run the shared
 * `judgePlatformAdmin` gate (ADR-0068 D2, with ADR-0069 D3's held-session
 * refusal) in `auth-plugin.ts` BEFORE this module reads anything, so an
 * anonymous caller is answered 401 and a signed-in non-admin 403 whatever the
 * body says. ⛔ Who may mint is a security boundary: widening it to anyone
 * else (an organization administrator, say) is a maintainer decision, never a
 * change made here.
 *
 * ## The secret is shown once
 *
 * The mint answers the plaintext bearer in its own response, with
 * `Cache-Control: no-store`, and nowhere else: the store keeps only the keyed
 * one-way digest (`token_digest`, declared `internal: true`, so the generic
 * data path never serves it), the audit row names the connection and never the
 * credential, and nothing here logs the bearer or its digest. A storage
 * failure on the mint is reported WITHOUT its cause text, because a driver
 * error can echo the inserted row, and that row carries the digest.
 *
 * ## Revoke, and what rotate is
 *
 * Revoking switches the row's `active` off, which is what
 * `verifyScimBearerToken` refuses on, so the revoked bearer answers 401 at the
 * next SCIM request. The row stays: its digest is one-way, and the audit trail
 * and the rotation history point at it. Rotation is not a third operation:
 * several rows may authenticate one `connection_id` (staged rotation, the
 * object header says), so rotating is a second mint for the same connection,
 * moving the identity provider to the new bearer, then revoking the old one.
 *
 * ## Audit
 *
 * Each mint and each revoke writes one `sys_audit_log` row: the administrator
 * as `user_id` / `actor`, the credential as `object_name` + `record_id`, and
 * `metadata` naming the event and the `connectionId` ({@link ScimCredentialAuditDecisions},
 * a closed type with no room for the bearer); a mint made on an impersonation
 * session also names the administrator at the keyboard as `impersonated_by`. It is written directly, as
 * `/admin/create-user` writes its own, so the trail does not depend on what the
 * generic audit mirror decides to record for this object. A refused audit
 * write does not undo the operation (the bearer is already shown); it is
 * reported once, at `warn`, naming the remedy, exactly as the admin user
 * endpoints report theirs. plugin-audit UNINSTALLED means no `sys_audit_log`
 * object at all: a declared skip, silent.
 */

import { findDefaultOrganization } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { withSystemContext } from './objectql-adapter.js';
import type { PlatformAdminActor } from './platform-admin-gate.js';
import { readJsonRequestBody } from './request-json-body.js';
import {
  SCIM_CREDENTIAL_OBJECT,
  SCIM_SERVICE_PRINCIPAL_PREFIX,
  revokeScimConnectionCredential,
  type MintScimConnectionCredentialInput,
  type MintedScimConnectionCredential,
} from './scim-connection-service.js';

/** The two mounts, relative to the auth base path. */
export const SCIM_MINT_CREDENTIAL_PATH = '/admin/scim/mint-credential';
export const SCIM_REVOKE_CREDENTIAL_PATH = '/admin/scim/revoke-credential';

/** The longest value the credential row's text columns store. */
const MAX_TEXT = 255;

/**
 * The longest connection id the door accepts: 246, not {@link MAX_TEXT}.
 * A write made by a SCIM connection is audited with the service actor
 * `svc:scim:<connectionId>` (#30960), and `sys_audit_log.actor` holds 255
 * characters, so a longer id would make that audit insert fail for every
 * request the connection makes. 255 minus the 9-character prefix, read from
 * {@link SCIM_SERVICE_PRINCIPAL_PREFIX} (the one spelling the actor label is
 * built from) so the cap moves with the label it protects.
 */
const MAX_SCIM_CONNECTION_ID = MAX_TEXT - SCIM_SERVICE_PRINCIPAL_PREFIX.length;

/** Execution context for the store reads and the audit write. */
const SYSTEM_CTX = { isSystem: true } as const;

/** The response a mount hands back: status, body and any headers. */
export interface ScimCredentialAdminResult {
  status: 200 | 400 | 404 | 409 | 500 | 503;
  body:
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: { code: string; message: string } };
  headers?: Record<string, string>;
}

export interface ScimCredentialAdminDeps {
  /** The data engine every read and write goes through. */
  getDataEngine: () => IDataEngine | null | undefined;
  /**
   * Is the SCIM plugin mounted on this deployment? The mint refuses while it
   * is not: a bearer nothing can verify is a credential with no use.
   */
  isScimEnabled: () => boolean;
  /**
   * Mint through `mintScimConnectionCredential` with the deployment's auth
   * secret, the key the mounted SCIM plugin's verifier digests with. The
   * secret stays inside the auth manager; `engine` is the one to write through
   * (this module hands it the system-context wrapper, `withSystemContext`).
   */
  mint: (engine: IDataEngine, input: MintScimConnectionCredentialInput) => Promise<MintedScimConnectionCredential>;
  /**
   * Run the store writes credited to the administrator (attribution only; the
   * write authorizes as the system, the gate already authorized the caller).
   */
  attributed: <T>(fn: () => Promise<T>) => Promise<T>;
  logger?: { warn: (message: string) => void; error: (message: string) => void };
}

/**
 * What a credential audit row's `metadata` may carry: the event and the
 * connection, and nothing else. Closed on purpose — there is no key a bearer,
 * a digest or a field value of the credential could ride in.
 */
export interface ScimCredentialAuditDecisions {
  event: 'scim_credential_minted' | 'scim_credential_revoked';
  connectionId: string;
  /**
   * The administrator at the keyboard when the mint ran on an impersonation
   * session, under the key the audit writers record it with
   * (`sys_audit_log.metadata.impersonated_by`). Absent otherwise.
   */
  impersonated_by?: string;
}

function fail(status: ScimCredentialAdminResult['status'], code: string, message: string): ScimCredentialAdminResult {
  return { status, body: { success: false, error: { code, message } } };
}

/** An optional text member: absent, or a string of at most {@link MAX_TEXT} characters. */
function optionalText(body: Record<string, unknown>, key: string): { ok: true; value?: string } | { ok: false; message: string } {
  const value = body[key];
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'string') return { ok: false, message: `${key} must be a string when it is given` };
  const trimmed = value.trim();
  if (trimmed === '') return { ok: true };
  if (trimmed.length > MAX_TEXT) return { ok: false, message: `${key} is longer than ${MAX_TEXT} characters` };
  return { ok: true, value: trimmed };
}

/**
 * Is `name` registered on the engine? An engine that cannot say (no
 * `getSchema`) is taken at its word that it serves the object, so the read or
 * write that follows answers for itself.
 */
function objectRegistered(engine: IDataEngine, name: string): boolean {
  const getSchema = (engine as unknown as { getSchema?: (object: string) => unknown }).getSchema;
  return typeof getSchema !== 'function' || Boolean(getSchema.call(engine, name));
}

async function readBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; result: ScimCredentialAdminResult }> {
  const reading = await readJsonRequestBody(request);
  if (!reading.ok) return { ok: false, result: fail(400, 'INVALID_REQUEST', reading.message) };
  const body = reading.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, result: fail(400, 'INVALID_REQUEST', 'The request body must be a JSON object') };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

/**
 * The organization the credential row is owned by: the one the request names,
 * which must exist, else the Default Organization (ADR-0131 D3/D5, the owner
 * of platform-level rows). A composition without organizations owns nothing.
 */
async function resolveOwningOrganization(
  engine: IDataEngine,
  requested: string | undefined,
): Promise<{ ok: true; organizationId?: string } | { ok: false; result: ScimCredentialAdminResult }> {
  const registered = objectRegistered(engine, 'sys_organization');
  if (requested !== undefined) {
    const row = registered
      ? await engine.findOne('sys_organization', { where: { id: requested }, fields: ['id'] }, { context: SYSTEM_CTX } as never)
      : null;
    if (!row) {
      return { ok: false, result: fail(400, 'INVALID_REQUEST', `organizationId '${requested}' names no organization on this deployment`) };
    }
    return { ok: true, organizationId: requested };
  }
  if (!registered) return { ok: true };
  const found = await findDefaultOrganization(async (where, limit) => {
    const rows = await engine.find('sys_organization', { where: { ...where }, fields: ['id'], limit }, { context: SYSTEM_CTX } as never);
    return Array.isArray(rows) ? rows : [];
  });
  if (found.id !== undefined) return { ok: true, organizationId: found.id };
  if (found.several) {
    return {
      ok: false,
      result: fail(
        400,
        'INVALID_REQUEST',
        'This deployment holds several organizations and none is the Default Organization: name the organization that owns the connection with organizationId',
      ),
    };
  }
  return { ok: true };
}

async function writeCredentialAudit(
  deps: ScimCredentialAdminDeps,
  engine: IDataEngine,
  entry: { action: 'create' | 'update'; actor: PlatformAdminActor; credentialId: string; metadata: ScimCredentialAuditDecisions },
): Promise<void> {
  // plugin-audit UNINSTALLED: no `sys_audit_log` object, so nothing ever
  // claimed this action would be audited. A declared skip, not a swallow.
  if (!objectRegistered(engine, 'sys_audit_log')) return;
  try {
    await engine.insert(
      'sys_audit_log',
      {
        action: entry.action,
        user_id: entry.actor.id,
        actor: entry.actor.id,
        object_name: SCIM_CREDENTIAL_OBJECT,
        record_id: entry.credentialId,
        metadata: JSON.stringify(entry.metadata),
      },
      { context: SYSTEM_CTX },
    );
  } catch (error) {
    // The operation already happened (a minted bearer is already in the
    // response; a revoked one is already refused), so it is not undone. But
    // the trail is gone and nothing retries it, so say so once, with the
    // remedy, and never with the credential.
    deps.logger?.warn(
      `[AuthPlugin] the sys_audit_log row for this SCIM credential event (${entry.metadata.event}, connection `
        + `'${entry.metadata.connectionId}', credential ${entry.credentialId}) was NOT written — the operation itself `
        + 'SUCCEEDED and the endpoint answers 200, so nothing looks wrong. plugin-audit is installed '
        + '(sys_audit_log is registered), so this is a REFUSED write, not an absent plugin, and nothing retries it. '
        + 'Remedy: restore write access to sys_audit_log (permissions, driver connectivity), then treat this line as '
        + `the audit record. Cause: ${(error as Error)?.message ?? String(error)}`,
    );
  }
}

/**
 * `POST /admin/scim/mint-credential` — mint a bearer for a SCIM connection and
 * answer it once. The caller is the platform administrator the mount's gate
 * admitted.
 */
export async function runMintScimCredential(
  deps: ScimCredentialAdminDeps,
  actor: PlatformAdminActor,
  request: Request,
): Promise<ScimCredentialAdminResult> {
  const reading = await readBody(request);
  if (!reading.ok) return reading.result;
  const body = reading.body;

  const connectionId = body.connectionId;
  if (typeof connectionId !== 'string' || connectionId.length === 0 || connectionId.trim() !== connectionId || connectionId.length > MAX_SCIM_CONNECTION_ID) {
    return fail(
      400,
      'INVALID_REQUEST',
      `connectionId is required: the connection's identifier (e.g. "okta-prod"), a non-empty string of at most ${MAX_SCIM_CONNECTION_ID} characters with no surrounding whitespace`,
    );
  }
  const optional: Record<'label' | 'provisioningDomainId' | 'organizationId', string | undefined> = {
    label: undefined,
    provisioningDomainId: undefined,
    organizationId: undefined,
  };
  for (const key of Object.keys(optional) as Array<keyof typeof optional>) {
    const read = optionalText(body, key);
    if (!read.ok) return fail(400, 'INVALID_REQUEST', read.message);
    optional[key] = read.value;
  }
  let expiresAt: Date | undefined;
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    const parsed = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : undefined;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return fail(400, 'INVALID_REQUEST', 'expiresAt must be an ISO 8601 date-time when it is given');
    }
    if (parsed.getTime() <= Date.now()) {
      return fail(400, 'INVALID_REQUEST', 'expiresAt is not in the future: a credential that is already expired would authenticate nothing');
    }
    expiresAt = parsed;
  }

  if (!deps.isScimEnabled()) {
    return fail(
      503,
      'SERVICE_UNAVAILABLE',
      'SCIM provisioning is not enabled on this deployment, so a credential minted now would authenticate nothing. '
        + 'Enable it (OS_SCIM_ENABLED=true, or plugins.scim) and mint again.',
    );
  }
  const engine = deps.getDataEngine();
  if (!engine) return fail(503, 'SERVICE_UNAVAILABLE', 'Data engine unavailable');

  const owner = await resolveOwningOrganization(engine, optional.organizationId);
  if (!owner.ok) return owner.result;

  let minted: MintedScimConnectionCredential;
  try {
    minted = await deps.attributed(() =>
      deps.mint(withSystemContext(engine), {
        connectionId,
        ...(optional.provisioningDomainId ? { provisioningDomainId: optional.provisioningDomainId } : {}),
        ...(owner.organizationId ? { organizationId: owner.organizationId } : {}),
        ...(optional.label ? { label: optional.label } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        mintedByUserId: actor.id,
      }),
    );
  } catch (error) {
    // ⛔ The cause text is withheld on purpose: a driver error can echo the
    // inserted row, and that row carries the bearer's digest.
    const named = (error as { code?: unknown })?.code;
    deps.logger?.error(
      `[AuthPlugin] admin/scim/mint-credential: the credential for connection '${connectionId}' was NOT stored, so no `
        + `bearer was issued (${(error as Error)?.name ?? 'Error'}${typeof named === 'string' ? ` ${named}` : ''}; the `
        + 'driver message is withheld because it can echo the inserted row). Check the data engine and the '
        + 'sys_scim_connection_credential table, then mint again.',
    );
    return fail(500, 'INTERNAL_ERROR', 'The credential was not stored, so no bearer was issued. Nothing needs revoking; mint again.');
  }

  await writeCredentialAudit(deps, engine, {
    action: 'create',
    actor,
    credentialId: minted.credentialId,
    metadata: {
      event: 'scim_credential_minted',
      connectionId,
      ...(actor.impersonatedBy ? { impersonated_by: actor.impersonatedBy } : {}),
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      data: {
        credentialId: minted.credentialId,
        connectionId,
        token: minted.token,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
    },
    headers: { 'Cache-Control': 'no-store' },
  };
}

/**
 * `POST /admin/scim/revoke-credential` — switch one credential off, so its
 * bearer is refused from the next SCIM request on.
 */
export async function runRevokeScimCredential(
  deps: ScimCredentialAdminDeps,
  actor: PlatformAdminActor,
  request: Request,
): Promise<ScimCredentialAdminResult> {
  const reading = await readBody(request);
  if (!reading.ok) return reading.result;
  const credentialId = reading.body.credentialId;
  if (typeof credentialId !== 'string' || credentialId.trim() === '') {
    return fail(400, 'INVALID_REQUEST', 'credentialId is required: the credentialId the mint answered');
  }

  const engine = deps.getDataEngine();
  if (!engine) return fail(503, 'SERVICE_UNAVAILABLE', 'Data engine unavailable');

  const outcome = await deps.attributed(() => revokeScimConnectionCredential(withSystemContext(engine), credentialId));
  if (outcome.outcome === 'not_found') {
    return fail(404, 'RESOURCE_NOT_FOUND', `No SCIM connection credential '${credentialId}' exists`);
  }
  if (outcome.outcome === 'already_revoked') {
    return fail(409, 'RESOURCE_CONFLICT', `SCIM connection credential '${credentialId}' is already revoked; nothing changed`);
  }

  await writeCredentialAudit(deps, engine, {
    action: 'update',
    actor,
    credentialId: outcome.credentialId,
    metadata: { event: 'scim_credential_revoked', connectionId: outcome.connectionId },
  });

  return {
    status: 200,
    body: { success: true, data: { credentialId: outcome.credentialId, connectionId: outcome.connectionId, active: false } },
  };
}
