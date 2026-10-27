// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.activation-write-operator-gate`, acceptance[0] to
// acceptance[3] and negative[0] to negative[2], over HTTP on the stock showcase.
//
// Two activation doors switch a packaged artifact off: the flow door
// (`POST /automation/:name/toggle`) and the action door
// (`POST /actions/_activation/:object/:action`). On the stock `single` posture
// two gates sit in front of them, and only one of them can answer:
//
//   - the AUTHORING TIER: the caller must hold the `manage_metadata`
//     capability. The flow door speaks its own sentence
//     (`FLOW_ENABLEMENT_DENY_MESSAGE`, domains/automation.ts); the action door
//     speaks the shared `refuseUngrantedActivationAuthoring` sentence
//     (domains/activation-gate.ts), with its "functionally equivalent to
//     deleting it" rationale and the subject "a packaged action";
//   - the §5 OPERATOR gate (`refuseUngrantedActivationWrite`), which is INERT
//     on `single`: `postureEnforcesWall('single')` is false, so it returns
//     before it reads a position.
//
// The unit pins in packages/runtime/src/domains drive both gates over fakes;
// this file is the HTTP layer the item's `api` clauses name:
//
//   - a plain member is refused at both doors with each door's own sentence,
//     an invalid body included (the gate runs before body validation), and no
//     ledger row is written;
//   - a member holding `manage_metadata` through a runtime-authored set, and
//     NOT holding the `platform_admin` position, is admitted at both doors:
//     the operator gate is inert, not satisfied. Each write lands one
//     deployment-level ledger row whose key set has no `organization_id`;
//   - the admin is admitted at both doors (the refusals are the capability's,
//     not a broken route).
//
// Isolated boot: the switches move global activation state, and the scratch
// set is authored through `/meta`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const LEDGER = 'sys_metadata_activation';
const FLOW = 'showcase_urgent_task_alert';
const ACTION = 'showcase_mark_done';
const FLOW_DOOR = `/automation/${FLOW}/toggle`;
const ACTION_DOOR = `/actions/_activation/showcase_task/${ACTION}`;
const SCRATCH_SET = 'activation_gate_meta_author';
const PLAIN = 'activation-gate-plain@verify.test';
const AUTHOR = 'activation-gate-author@verify.test';

const FLOW_SENTENCE = 'Enabling or disabling an automation flow requires the `manage_metadata` capability.';
const ACTION_SENTENCE =
  'Enabling or disabling a packaged action requires the `manage_metadata` capability — ' +
  'switching a shipped artifact off is functionally equivalent to deleting it for as long as it stays off, ' +
  "and the switch is not scoped to the caller's organization.";
/** The §5 operator gate's sentence names the posture; on `single` it must never be heard. */
const POSTURE_SENTENCE = /tenancy posture/;

const DOORS = [
  { door: 'the flow door', path: FLOW_DOOR, type: 'flow', name: FLOW, sentence: FLOW_SENTENCE },
  { door: 'the action door', path: ACTION_DOOR, type: 'action', name: ACTION, sentence: ACTION_SENTENCE },
] as const;

const errorOf = (body: any) => {
  const e = body?.error;
  return {
    code: (e && typeof e === 'object' ? e.code : undefined) ?? body?.code,
    message: (e && typeof e === 'object' ? e.message : typeof e === 'string' ? e : undefined) ?? body?.message,
  };
};

describe('activation doors on the stock `single` posture: the authoring tier answers, the operator gate is inert', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;
  const tok: Record<string, string> = {};

  /** The ledger rows for the two artifacts, read through the REST data door as the admin. */
  const ledgerRows = async () => {
    const where = encodeURIComponent(JSON.stringify({ name: { $in: [FLOW, ACTION] } }));
    const r = await stack.apiAs(admin, 'GET', `/data/${LEDGER}?$filter=${where}`);
    expect(r.status, 'the ledger is readable').toBe(200);
    const body = (await r.json()) as any;
    return (body?.records ?? body?.data ?? []) as Array<Record<string, unknown>>;
  };

  const refused = async (token: string, path: string, body: unknown) => {
    const r = await stack.apiAs(token, 'POST', path, body);
    return { status: r.status, ...errorOf(await r.json()) };
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    // The scratch set: `manage_metadata` and nothing else, authored at runtime
    // the way an administrator authors one (no stock showcase set grants it).
    const saved = await stack.apiAs(admin, 'PUT', `/meta/permission/${SCRATCH_SET}`, {
      name: SCRATCH_SET, label: 'Activation gate meta author', objects: {}, systemPermissions: ['manage_metadata'],
    });
    expect(saved.status, await saved.clone().text()).toBe(200);

    tok[PLAIN] = await stack.signUp(PLAIN);
    tok[AUTHOR] = await stack.signUp(AUTHOR);
    const authorId = (await ql.findOne('sys_user', { where: { email: AUTHOR }, context: SYS }))?.id;
    expect(authorId, 'the author persona is provisioned').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: authorId, permission_set: SCRATCH_SET }, { context: SYS });
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // ── the plain member: the authoring tier refuses (acceptance[0], [1], [2]) ──

  for (const d of DOORS) {
    it(`${d.door}: a plain member is refused 403 PERMISSION_DENIED with that door's own sentence`, async () => {
      const r = await refused(tok[PLAIN], d.path, { enabled: false });
      expect(r.status, r.message).toBe(403);
      expect(r.code).toBe('PERMISSION_DENIED');
      expect(r.message, 'the exact tier sentence of this door').toBe(d.sentence);
      // negative[0]: on `single` the §5 operator gate never answers.
      expect(r.message, 'no posture sentence on the stock posture').not.toMatch(POSTURE_SENTENCE);
    });

    it(`${d.door}: an INVALID body from the plain member is still the 403, never a 400`, async () => {
      const r = await refused(tok[PLAIN], d.path, { enabled: 'false' });
      expect(r.status, 'the gate runs before body validation').toBe(403);
      expect(r.code).toBe('PERMISSION_DENIED');
      expect(r.message).toBe(d.sentence);
    });
  }

  it('negative[2]: the two doors speak distinct sentences', () => {
    expect(FLOW_SENTENCE).not.toBe(ACTION_SENTENCE);
    expect(ACTION_SENTENCE).toContain('a packaged action');
    expect(FLOW_SENTENCE).not.toContain('functionally equivalent');
  });

  it('acceptance[2]: the refusals wrote no ledger row for either artifact', async () => {
    expect(await ledgerRows()).toEqual([]);
  });

  // ── the scratch-set member: the operator gate is inert (acceptance[3]) ──

  it('the scratch-set member holds `manage_metadata` and NOT the platform_admin position (server-side)', async () => {
    const session = (await (await stack.apiAs(tok[AUTHOR], 'GET', '/auth/get-session')).json()) as any;
    expect(session.user?.positions ?? [], 'the session carries no platform_admin position').not.toContain('platform_admin');
    expect(session.user?.isPlatformAdmin, 'and the session is not the platform admin').not.toBe(true);
    const r = await stack.apiAs(tok[AUTHOR], 'GET', '/auth/me/permissions');
    expect(r.status).toBe(200);
    const perms = (await r.json()) as any;
    const resolved = perms?.data ?? perms;
    expect(resolved.systemPermissions, 'the scratch set resolves').toContain('manage_metadata');
    expect(resolved.positions ?? [], 'the resolved positions carry no platform_admin').not.toContain('platform_admin');
  });

  for (const d of DOORS) {
    it(`${d.door}: the scratch-set member is admitted, and one deployment-level row lands with no organization_id key`, async () => {
      const off = await stack.apiAs(tok[AUTHOR], 'POST', d.path, { enabled: false });
      expect(off.status, await off.clone().text()).toBe(200);

      const rows = (await ledgerRows()).filter((row) => row.metadata_type === d.type && row.name === d.name);
      expect(rows, `one ${d.type} row`).toHaveLength(1);
      const [row] = rows;
      expect(row.active === false || row.active === 0, 'switched off').toBe(true);
      // Read the KEY SET: a value read of an absent column is null and measures nothing.
      expect(Object.keys(row), 'the ledger carries no tenant column').not.toContain('organization_id');
      const stored = await ql.find(LEDGER, { where: { metadata_type: d.type, name: d.name }, context: SYS });
      expect(stored, 'and the store holds that one row').toHaveLength(1);
      expect(Object.keys(stored[0])).not.toContain('organization_id');

      const on = await stack.apiAs(tok[AUTHOR], 'POST', d.path, { enabled: true });
      expect(on.status, await on.clone().text()).toBe(200);
      const [restored] = (await ledgerRows()).filter((x) => x.metadata_type === d.type && x.name === d.name);
      expect(restored.active === true || restored.active === 1, 're-enabled').toBe(true);
    }, 30_000);
  }

  // ── the admin: the refused calls are the capability's, not a broken route (negative[1]) ──

  for (const d of DOORS) {
    it(`${d.door}: the admin's same call answers 200`, async () => {
      const off = await stack.apiAs(admin, 'POST', d.path, { enabled: false });
      expect(off.status, await off.clone().text()).toBe(200);
      const on = await stack.apiAs(admin, 'POST', d.path, { enabled: true });
      expect(on.status, await on.clone().text()).toBe(200);
    }, 30_000);
  }
});
