// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  hashApiKey,
  generateApiKey,
  extractApiKey,
  parseScopes,
  isExpired,
  resolveApiKeyPrincipal,
  resolveApiKeyAdmission,
  effectiveTenancyPosture,
} from './api-key.js';

/** In-memory sys_api_key store exposing the `find` shape the verifier uses. */
function makeQl(rows: any[]) {
  return {
    find: async (object: string, opts: any) => {
      if (object !== 'sys_api_key') return [];
      const where = opts?.where ?? {};
      return rows.filter((r) => Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
    },
  };
}

const FUTURE = '2999-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';

describe('core api-key primitives', () => {
  it('hashApiKey is deterministic sha256 hex, never the raw', () => {
    expect(hashApiKey('osk_a')).toBe(hashApiKey('osk_a'));
    expect(hashApiKey('osk_a')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey('osk_secret')).not.toContain('secret');
  });

  it('generateApiKey: prefix + base64url secret, hash matches', () => {
    const k = generateApiKey();
    expect(k.raw.startsWith('osk_')).toBe(true);
    expect(k.hash).toBe(hashApiKey(k.raw));
    expect(k.raw.startsWith(k.prefix)).toBe(true);
  });

  it('extractApiKey: x-api-key / ApiKey, and Bearer only for osk_-prefixed keys', () => {
    expect(extractApiKey({ 'x-api-key': 'k' })).toBe('k');
    expect(extractApiKey({ authorization: 'ApiKey k' })).toBe('k');
    // A bare Bearer (e.g. a better-auth session token) is NOT an api-key.
    expect(extractApiKey({ authorization: 'Bearer k' })).toBeUndefined();
    // A Bearer carrying the api-key prefix IS accepted — remote MCP clients
    // (Claude Desktop / Cursor / Claude Code) send the key this way.
    expect(extractApiKey({ authorization: 'Bearer osk_abc123' })).toBe('osk_abc123');
    expect(extractApiKey({ authorization: 'bearer osk_abc123' })).toBe('osk_abc123'); // scheme is case-insensitive
  });

  it('resolveApiKeyPrincipal resolves a Bearer osk_ key (remote MCP client path)', async () => {
    const raw = 'osk_' + 'b'.repeat(24);
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const p = await resolveApiKeyPrincipal(ql, { authorization: `Bearer ${raw}` });
    expect(p?.userId).toBe('u1');
  });

  it('parseScopes + isExpired basics', () => {
    expect(parseScopes('["a","b"]')).toEqual(['a', 'b']);
    expect(isExpired(PAST, Date.now())).toBe(true);
    expect(isExpired(FUTURE, Date.now())).toBe(false);
    expect(isExpired(null, Date.now())).toBe(false);
  });
});

describe('resolveApiKeyPrincipal (shared verifier)', () => {
  it('resolves a valid key to its principal (x-api-key)', async () => {
    const raw = 'osk_valid';
    const ql = makeQl([
      // [#8287] Re-spelled from `organization_id`: this fixture merely USED the
      // alias the verifier no longer reads, and its assertion — a valid key
      // resolves to owner + tenant + scopes — is unchanged and still reads a
      // value the mint path really produces.
      { key: hashApiKey(raw), revoked: false, user_id: 'u1', active_organization_id: 'org1', scopes: '["read"]', expires_at: FUTURE },
    ]);
    const p = await resolveApiKeyPrincipal(ql, { 'x-api-key': raw });
    expect(p).toEqual({ userId: 'u1', tenantId: 'org1', scopes: ['read'] });
  });

  it('resolves via Authorization: ApiKey', async () => {
    const raw = 'osk_valid';
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const p = await resolveApiKeyPrincipal(ql, { authorization: `ApiKey ${raw}` });
    expect(p?.userId).toBe('u1');
  });

  it('returns undefined for no key / revoked / expired / unknown / owner-less', async () => {
    const raw = 'osk_x';
    const base = (extra: any) => makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1', ...extra }]);
    expect(await resolveApiKeyPrincipal(base({}), {})).toBeUndefined(); // no key header
    expect(await resolveApiKeyPrincipal(makeQl([{ key: hashApiKey(raw), revoked: true, user_id: 'u1' }]), { 'x-api-key': raw })).toBeUndefined();
    expect(await resolveApiKeyPrincipal(base({ expires_at: PAST }), { 'x-api-key': raw })).toBeUndefined();
    expect(await resolveApiKeyPrincipal(base({}), { 'x-api-key': 'osk_wrong' })).toBeUndefined();
    expect(await resolveApiKeyPrincipal(makeQl([{ key: hashApiKey(raw), revoked: false }]), { 'x-api-key': raw })).toBeUndefined(); // no user_id
  });

  it('never matches a plaintext-stored key (hash lookup only)', async () => {
    const raw = 'osk_plain';
    const ql = makeQl([{ key: raw, revoked: false, user_id: 'u1' }]);
    expect(await resolveApiKeyPrincipal(ql, { 'x-api-key': raw })).toBeUndefined();
  });

  it('fail-closed when ql is missing/unusable', async () => {
    expect(await resolveApiKeyPrincipal(undefined, { 'x-api-key': 'osk_x' })).toBeUndefined();
    expect(await resolveApiKeyPrincipal({}, { 'x-api-key': 'osk_x' })).toBeUndefined();
  });
});

// ── [#8287] Organization on the key ────────────────────────────────────────

/**
 * The card: under `OS_TENANCY_POSTURE=isolated` a minted key read NOTHING —
 * `200 + total 0` on every org-scoped object — because `sys_api_key` carried no
 * organization at all, and the `isolated` Layer 0 wall is
 * `organization_id = activeOrganizationId`. With no active organization, no row
 * can match. These tests pin both halves of the fix: the principal now carries
 * the organization the key was minted against, and a key that carries none is
 * REFUSED under the one posture where it is provably dead, instead of
 * authenticating into a silent-empty.
 */
describe('resolveApiKeyAdmission — organization (#8287)', () => {
  const raw = 'osk_org_probe';
  // The posture is an INPUT now, resolved by the transport from the kernel's
  // `tenancy` service — never read from the environment here. `effectiveTenancyPosture`
  // is what performs that reconciliation; these tests exercise both it and the
  // admission behaviour it feeds.

  it('reads the organization off the row and carries it as tenantId', async () => {
    const ql = makeQl([
      { key: hashApiKey(raw), revoked: false, user_id: 'u1', active_organization_id: 'org_a' },
    ]);
    const admission = await resolveApiKeyAdmission(ql, { 'x-api-key': raw });
    expect(admission.outcome).toBe('admitted');
    expect(admission.outcome === 'admitted' && admission.principal.tenantId).toBe('org_a');
  });

  /**
   * The canonical-spelling pin (PD #12). The verifier used to read
   * `row.organization_id ?? row.organizationId` — a consumer-side alias chain
   * for a producer that did not exist. The mint path now writes exactly one
   * spelling, so the verifier reads exactly one: a row carrying only the OLD
   * names resolves to NO organization, which is the honest answer for a row no
   * mint path ever wrote.
   */
  it('reads ONE spelling — the retired organization_id aliases do not resolve', async () => {
    const ql = makeQl([
      { key: hashApiKey(raw), revoked: false, user_id: 'u1', organization_id: 'org_a', organizationId: 'org_a' },
    ]);
    const admission = await resolveApiKeyAdmission(ql, { 'x-api-key': raw });
    // `single` (the default posture here) admits an org-less key, so this
    // asserts the SPELLING, not the refusal.
    expect(admission.outcome === 'admitted' && admission.principal.tenantId).toBeUndefined();
  });

  it('admits an org-less key under `single` — there is no wall to fail', async () => {
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const admission = await resolveApiKeyAdmission(ql, { 'x-api-key': raw }, Date.now(), 'single');
    expect(admission.outcome).toBe('admitted');
  });

  /**
   * `group`'s wall is `organization_id IN accessible_org_ids`, and that set is
   * derived from the owner's `sys_member` rows INDEPENDENTLY of the active
   * organization — so an org-less key already reads the union of its owner's
   * organizations there. Refusing it would break working deployments for no
   * security gain, which is why the refusal is posture-conditional rather than
   * "no org ⇒ no key".
   */
  it('admits an org-less key under `group` — it already works there', async () => {
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const admission = await resolveApiKeyAdmission(ql, { 'x-api-key': raw }, Date.now(), 'group');
    expect(admission.outcome).toBe('admitted');
  });

  it('REFUSES an org-less key under `isolated` — the posture where it is provably dead', async () => {
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const admission = await resolveApiKeyAdmission(ql, { 'x-api-key': raw }, Date.now(), 'isolated');
    expect(admission.outcome).toBe('refused');
    expect(admission.outcome === 'refused' && admission.reason).toBe('organization_required');
    // The message is the operator-facing half of "loud at call time": it must
    // name the posture and the remedy, not merely deny.
    expect(admission.outcome === 'refused' && admission.message).toMatch(/isolated/);
  });

  /**
   * The posture must be the ENFORCED one, not the requested one. ADR-0093 D4/D5:
   * a deployment that asks for `isolated` without the enterprise organizations
   * runtime runs with NO wall, and `tenancy.isolationActive` is how the service
   * says so. Reading `OS_TENANCY_POSTURE` instead would refuse org-less keys on
   * a deployment that has no wall at all.
   */
  it('effectiveTenancyPosture reads the ENFORCED posture from the tenancy service', () => {
    expect(effectiveTenancyPosture({ posture: 'isolated' })).toBe('isolated');
    expect(effectiveTenancyPosture({ posture: 'multi' })).toBe('isolated'); // legacy alias
    expect(effectiveTenancyPosture({ posture: 'group' })).toBe('group');
    // No posture field: fall back to the boolean the service exposes.
    expect(effectiveTenancyPosture({ isolationActive: true })).toBe('isolated');
    expect(effectiveTenancyPosture({ isolationActive: false })).toBe('single');
    // No service at all ⇒ undefined ⇒ callers apply no posture-conditional refusal.
    expect(effectiveTenancyPosture(undefined)).toBeUndefined();
  });

  /**
   * An unknown posture must NOT refuse. This is a question about the DEPLOYMENT,
   * not about the credential: refusing here would break every org-less key on a
   * `single` deployment whose transport has not been wired.
   */
  it('admits an org-less key when the posture is unknown (no tenancy service)', async () => {
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const admission = await resolveApiKeyAdmission(ql, { 'x-api-key': raw }, Date.now(), undefined);
    expect(admission.outcome).toBe('admitted');
  });

  it('an ORG-STAMPED key is admitted under `isolated` — the fix, not just the refusal', async () => {
    const ql = makeQl([
      { key: hashApiKey(raw), revoked: false, user_id: 'u1', active_organization_id: 'org_a' },
    ]);
    const admission = await resolveApiKeyAdmission(ql, { 'x-api-key': raw }, Date.now(), 'isolated');
    expect(admission.outcome).toBe('admitted');
    expect(admission.outcome === 'admitted' && admission.principal.tenantId).toBe('org_a');
  });

  /**
   * A refusal must stay distinguishable from "no key" — that distinction is
   * the whole point of the admission type. `resolveApiKeyPrincipal` collapses
   * both to `undefined` so every pre-existing caller keeps failing closed.
   */
  it('resolveApiKeyPrincipal collapses a refusal to undefined (fail-closed for old callers)', async () => {
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const principal = await resolveApiKeyPrincipal(ql, { 'x-api-key': raw }, Date.now(), 'isolated');
    expect(principal).toBeUndefined();
  });

  it('an absent key is `none`, never a refusal', async () => {
    const ql = makeQl([{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }]);
    const admission = await resolveApiKeyAdmission(ql, {}, Date.now(), 'isolated');
    expect(admission.outcome).toBe('none');
  });
});
