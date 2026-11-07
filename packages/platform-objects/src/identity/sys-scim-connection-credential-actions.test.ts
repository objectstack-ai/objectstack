// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console's two SCIM credential actions — mint and revoke — wired to
 * plugin-auth's platform-admin mounts, and the AI exposure each one declares.
 *
 * What the console cannot be allowed to drift from is the mount's contract:
 * the route and method, the body keys the mint reads (`connectionId`, `label`,
 * `organizationId`, `provisioningDomainId`, `expiresAt`) and the one the revoke
 * reads (`credentialId`). A param renamed to the row's column spelling would
 * reach the mount as an unknown key and be answered 400 ("connectionId is
 * required"), so the names are pinned against the mount's own spelling.
 *
 * The neighbouring pins this file does not repeat: the one-shot reveal of the
 * minted token is held by `two-factor-one-shot-reveal.test.ts` (its route
 * table names the mint), and the platform-admin standing plus the declared
 * gate by `platform-admin-affordance-standing.test.ts` (its family floor names
 * both actions).
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import type { Action } from '@objectstack/spec/ui';
import { SysScimConnectionCredential } from './sys-scim-connection-credential.object.js';

const MINT_ROUTE = '/api/v1/auth/admin/scim/mint-credential';
const REVOKE_ROUTE = '/api/v1/auth/admin/scim/revoke-credential';

function action(name: string): Action {
  const found = ((SysScimConnectionCredential.actions ?? []) as Action[]).find((a) => a.name === name);
  expect(found, `sys_scim_connection_credential declares no action '${name}'`).toBeDefined();
  return found!;
}

/** Every action on this object whose target is one of the two mounts. */
function actionsOnTheMounts(): Action[] {
  return ((SysScimConnectionCredential.actions ?? []) as Action[]).filter(
    (a) => a.target === MINT_ROUTE || a.target === REVOKE_ROUTE,
  );
}

function offered(source: string, record: Record<string, unknown>): string {
  const admin = { id: 'u_pa', isPlatformAdmin: true, positions: [] };
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record, extra: { current_user: admin, user: admin, ctx: { user: admin }, os: { user: admin }, features: {} } },
  );
  return r.ok ? String(r.value) : `FAULT ${r.error.message.split('\n')[0]}`;
}

describe('sys_scim_connection_credential: mint and revoke reach the platform-admin mounts', () => {
  it('mint POSTs the mint mount from the list toolbar, with the body keys the mount reads', () => {
    const mint = action('mint_scim_credential');
    expect(mint).toMatchObject({ type: 'api', method: 'POST', target: MINT_ROUTE, locations: ['list_toolbar'] });
    const params = (mint.params ?? []) as Array<{ name?: string; required?: boolean; type?: string; reference?: string }>;
    expect(params.map((p) => p.name)).toEqual(['connectionId', 'label', 'organizationId', 'provisioningDomainId', 'expiresAt']);
    // The mount refuses a mint with no connection id; nothing else is required.
    expect(params.filter((p) => p.required).map((p) => p.name)).toEqual(['connectionId']);
    // The organization is picked, not typed: the mount refuses an id that names no organization.
    expect(params.find((p) => p.name === 'organizationId')).toMatchObject({ type: 'lookup', reference: 'sys_organization' });
    // The mint answers `{ success, data: { token, ... } }`; the reveal reads the inner payload.
    expect(mint.resultDialog?.fields.find((f) => f.format === 'secret')?.path).toBe('token');
  });

  it('revoke POSTs the revoke mount from a credential row, sending the row id as credentialId', () => {
    const revoke = action('revoke_scim_credential');
    expect(revoke).toMatchObject({
      type: 'api',
      method: 'POST',
      target: REVOKE_ROUTE,
      recordIdParam: 'credentialId',
      locations: ['list_item', 'record_header'],
    });
    // No param dialog: the row is the whole input, so the confirmation is the one dialog.
    expect(revoke.params ?? []).toEqual([]);
    expect(revoke.confirmText).toBeTruthy();
  });

  it('revoke is offered on an active credential, not on a revoked one, and never faults on a row without `active`', () => {
    const visible = action('revoke_scim_credential').visible as unknown;
    // The served predicate: the authored string, or the parsed `{ source }` form.
    const source = typeof visible === 'string' ? visible : String((visible as { source?: unknown })?.source);
    expect(offered(source, { active: true })).toBe('true');
    expect(offered(source, { active: false })).toBe('false');
    expect(offered(source, {})).toBe('false');
    expect(offered(source, { active: null })).toBe('false');
  });

  it('the instrument is live: both mounts have exactly one action each on this object', () => {
    // Positive control for the exposure pins below: a renamed target would
    // leave them judging nothing.
    expect(actionsOnTheMounts().map((a) => a.target).sort()).toEqual([MINT_ROUTE, REVOKE_ROUTE]);
  });
});

describe('sys_scim_connection_credential: AI exposure (ADR-0011 identity-actions note)', () => {
  it('mint is NOT exposed to AI tools: an agent that ran it would hold a live SCIM bearer', () => {
    // Bucket H. Exposing it is a security boundary and needs a maintainer
    // ruling that names this action, so any `ai.exposed` here is refused.
    const mint = action('mint_scim_credential');
    expect(mint.ai?.exposed ?? false, 'mint_scim_credential declares ai.exposed').toBe(false);
  });

  it('revoke is exposed with its confirmation: bucket C, and the confirmation is never relaxed', () => {
    const revoke = action('revoke_scim_credential');
    expect(revoke.ai).toMatchObject({ exposed: true, requiresConfirmation: true });
    expect(revoke.ai?.description?.length ?? 0).toBeGreaterThan(0);
  });
});
