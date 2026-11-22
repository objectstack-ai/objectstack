// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Commit 74fb2f7a8 — the `set_user_manager` row action on `sys_user`, pinned against the
 * three things about it that are decisions rather than code.
 *
 * `sys_user.manager_id` drives the approvals `manager` rung and the ADR-0057
 * `own_and_reports` read scope, and `POST /api/v1/auth/admin/set-user-manager`
 * (#16678 Phase 3) is its only product write surface. This action is the
 * Console affordance that reaches it, and each assertion below exists because
 * the OBVIOUS edit at that spot is the wrong one:
 *
 *  1. **The write goes to the admin endpoint, never the generic data API.**
 *     `sys_user` is `managedBy: 'better-auth'` and the ADR-0092 D2
 *     managed-update whitelist is `{name, image, locale}`, so a picker that
 *     PATCHed `/api/v1/data/sys_user/:id` would be refused by the identity
 *     write guard — correctly — and would read as a Console bug.
 *  2. **The `visible` predicate reads NO record column — neither the
 *     self-service ownership term nor the `source` term.** The three
 *     self-service identity actions on this object spell
 *     `record.source != "idp_provisioned"` beside `record.id == ctx.user.id`.
 *     Copying either half — the natural thing to do — hides an ADMIN action
 *     from rows the endpoint accepts: the ownership half from every admin,
 *     the `source` half from every person who only signs in through SSO
 *     (ADR-0135 D4 stamps them `idp_provisioned` with no directory behind
 *     them; maintainer ruling record 6895645364, option A, has the endpoint
 *     refuse only an identity a SCIM directory holds). The failure is silent
 *     and fail-closed (#8990): the button simply is not offered.
 *  3. **No second copy of the server's refusals.** Self-assignment, cycle,
 *     depth, cross-organization and SCIM-held identity are all enforced
 *     at the write, in one derivation (`applyUserManagerLink`), which the bulk
 *     importer already routes onto rather than re-deriving. A client-side
 *     duplicate is the drift, not the safety net — so this file pins that the
 *     declaration reads no record column and declares no predicate for any
 *     of the five refusals.
 *
 * The sweep in `action-predicate-sparse-face.test.ts` already covers this
 * action's predicate for the sparse-face guard; that is deliberately not
 * restated here.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { SysUser } from './sys-user.object.js';

type AnyParam = Record<string, unknown>;
type AnyAction = Record<string, unknown> & { name?: string; params?: AnyParam[] };

const actionsOf = (): AnyAction[] => ((SysUser.actions ?? []) as unknown as AnyAction[]);

const ACTION = (() => {
  const found = actionsOf().find((a) => a.name === 'set_user_manager');
  if (!found) throw new Error('sys_user declares no set_user_manager action');
  return found;
})();

/**
 * `defineObject` normalizes a CEL shorthand into a `{dialect, source}`
 * envelope at parse time, so the stored value is never the string the file
 * spells. Read through this or the assertions run against `undefined`.
 */
function sourceOf(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { source?: unknown }).source === 'string') {
    return (raw as { source: string }).source;
  }
  return undefined;
}

/**
 * The admin these verdicts are about: a PLATFORM admin, because the door's
 * gate admits that standing alone and the predicate leads with it. Bound the
 * way the console binds it — the whole scope handed to the engine as `extra`,
 * one subject under every alias — and ⛔ not through `user:`, under which
 * `@objectstack/formula` re-derives `isPlatformAdmin` from `positions`.
 */
const PLATFORM_ADMIN = { id: 'admin_1', isPlatformAdmin: true, positions: [] as string[] };

/** Evaluate through the canonical engine; a fault is reported, never thrown. */
function evaluate(source: string, record: Record<string, unknown>): boolean | string {
  const s = PLATFORM_ADMIN;
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record, extra: { current_user: s, user: s, ctx: { user: s }, os: { user: s }, features: {} } },
  );
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

describe('#19249 — sys_user.set_user_manager posts the admin endpoint', () => {
  it('targets the ruled route with the ruled record-id key', () => {
    expect(ACTION.type).toBe('api');
    expect(ACTION.target).toBe('/api/v1/auth/admin/set-user-manager');
    // The endpoint reads `userId` (and `user_id`) off the body; the row id is
    // injected under that key rather than collected from the user.
    expect(ACTION.recordIdParam).toBe('userId');
    // POST is the default and the only method this endpoint is mounted for;
    // declaring PATCH/PUT here would 404 at the click.
    expect(ACTION.method === undefined || ACTION.method === 'POST').toBe(true);
  });

  it('⛔ does NOT write manager_id through the generic data API', () => {
    // The whole prohibition on this card, expressed as a predicate over the
    // declaration: no data-plane target, and no declarative row write (which
    // runs on the data plane AS THE CALLER and would hit the same guard).
    expect(String(ACTION.target)).not.toContain('/data/');
    expect(ACTION.operation).toBeUndefined();
    expect(ACTION.patch).toBeUndefined();
  });

  it('surfaces on the row menu AND the record-detail header', () => {
    expect(ACTION.locations).toContain('list_item');
    expect(ACTION.locations).toContain('record_header');
  });

  it('collects the manager on `manager_id`, seeded from the row, under the body key the endpoint reads', () => {
    const params = (ACTION.params ?? []) as AnyParam[];
    expect(params).toHaveLength(1);
    const [p] = params;
    expect(p.name).toBe('managerId');
    // FIELD-BACKED and seeded from the row, so the dialog opens on the
    // CURRENT manager: before, it opened empty and an admin re-pointing a
    // manager could not see what the click would replace. The console's param
    // resolver inherits the field's type and target, never its `readonly`
    // (ADR-0092 D4 keeps the column locked in the edit form, not here).
    expect(p.field).toBe('manager_id');
    expect(p.defaultFromRow).toBe(true);
    expect(SysUser.fields.manager_id.type).toBe('lookup');
    expect((SysUser.fields.manager_id as { reference?: string }).reference).toBe('sys_user');
    // Seeded, not carried: the admin picks the new manager, so the control
    // stays editable.
    expect(p.carryOver).toBeUndefined();
    // Required, because the endpoint refuses an ABSENT or empty key by design
    // ("managerId is required — send null to clear the link, never omit the
    // key"). A dialog that could submit nothing would turn an ordinary click
    // into a 400 about a key the user never saw; the clear is its own action.
    expect(p.required).toBe(true);
  });

  it('⛔ declares no second copy of the server-side refusals', () => {
    // Every refusal is enforced at the write and surfaces from there. What
    // would go wrong quietly is a client-side re-derivation drifting from the
    // endpoint's; so the predicate is pinned to reading no record column at
    // all, and the declaration to having no other gate.
    const visible = sourceOf(ACTION.visible);
    expect(visible).toBeDefined();
    // Positive control: the standing term really is there, so the empty column
    // set below is a reading of the predicate, not of an absent one.
    expect(visible).toContain('current_user.isPlatformAdmin == true');
    const columns = new Set(
      [...visible!.matchAll(/record\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]),
    );
    expect([...columns]).toEqual([]);
    expect(ACTION.disabled).toBeUndefined();
    // The manager chain, the organization screen and the self-assignment check
    // are the endpoint's; none of them is expressible — or declared — here.
    const declaration = JSON.stringify(ACTION);
    expect(declaration).not.toContain('ctx.user.id');
    expect(declaration).not.toContain('manager_user_id');
    expect(declaration).not.toContain('sys_business_unit');
  });
});

describe('the visible predicate: offered on every row, the SCIM-held refusal is the server\'s', () => {
  const visible = (): string => {
    const source = sourceOf(ACTION.visible);
    if (!source) throw new Error('set_user_manager has no CEL source');
    return source;
  };

  it('⭐ is OFFERED on an idp_provisioned row — an SSO-only person\'s manager is set here', () => {
    // The endpoint answers 200 for this row unless a SCIM directory holds it,
    // and no column on the row says which; hiding the button here hid it from
    // every person who ever signed in through SSO.
    expect(evaluate(visible(), { id: 'someone_else', source: 'idp_provisioned' })).toBe(true);
  });

  it('is OFFERED on the sparse face too (no source column projected)', () => {
    expect(evaluate(visible(), { id: 'someone_else' })).toBe(true);
  });

  it('⭐ is OFFERED to an admin on someone else\'s env-native row', () => {
    // The counter-direction, and the one that a verbatim copy of the
    // self-service predicate would break: this row is not the signed-in user.
    expect(evaluate(visible(), { id: 'someone_else', source: 'env_native' })).toBe(true);
  });

  it('⛔ does NOT carry the self-service actions\' source term', () => {
    // Positive control: the term is still spelled on the self-service side
    // (password and identity edits stay hidden for a managed identity, ADR-0135
    // D4), so its absence here is a reading, not a rename.
    const selfService = actionsOf().find((a) => a.name === 'change_my_password');
    expect(sourceOf(selfService?.visible)).toContain('record.source != "idp_provisioned"');
    expect(visible()).not.toContain('record.source');
  });

  it('is still hidden from a caller without platform-admin standing', () => {
    const member = { id: 'm_1', isPlatformAdmin: false, positions: [] as string[] };
    const r = celEngine.evaluate(
      { dialect: 'cel', source: visible() },
      { record: { id: 'someone_else', source: 'idp_provisioned' }, extra: { current_user: member, user: member, ctx: { user: member }, os: { user: member }, features: {} } },
    );
    expect(r.ok && r.value).toBe(false);
  });

  it('⛔ is NOT gated on features.admin, and that is deliberate', () => {
    // The `admin` flag hides buttons whose endpoint needs the better-auth
    // admin plugin, so that the UI does not render buttons that 404 (the block
    // header on the admin actions). This route is not one of those: it is an
    // ObjectStack mount registered unconditionally beside `unlock-user` and
    // authorized by the ADR-0068 platform-admin gate, so gating it would hide
    // a WORKING affordance on every host that never opted into that plugin —
    // exactly the population #16678 measured as having no write surface for
    // this column at all. If this assertion is ever flipped, the registry
    // entry `PUBLIC_AUTH_FEATURES.admin.gatedInputs` must gain
    // `sys_user.actions.set_user_manager` in the same change, or
    // `feature-gate-guard.test.ts` goes red in its reverse direction.
    expect(ACTION.requiresFeature).toBeUndefined();
    expect(visible()).not.toContain('features.');
  });
});

/**
 * `remove_user_manager` — the clear the required picker above cannot send.
 * The endpoint clears the link on `managerId: null` ("send null to clear the
 * link, never omit the key"); the action sends that null as its static body
 * and asks a confirm question instead of collecting anything. The forward
 * itself — the null arriving at the target — is pinned at the door, in
 * `@objectstack/runtime`'s `platform-admin-action-gate.test.ts`.
 */
describe('sys_user.remove_user_manager clears the link through the same endpoint', () => {
  const REMOVE = (() => {
    const found = actionsOf().find((a) => a.name === 'remove_user_manager');
    if (!found) throw new Error('sys_user declares no remove_user_manager action');
    return found;
  })();

  it('posts the set-user-manager endpoint with `managerId: null` and collects nothing', () => {
    expect(REMOVE.type).toBe('api');
    expect(REMOVE.target).toBe(ACTION.target);
    expect(REMOVE.recordIdParam).toBe(ACTION.recordIdParam);
    expect(REMOVE.method === undefined || REMOVE.method === 'POST').toBe(true);
    // The key PRESENT and null: an absent key is the endpoint's 400.
    expect(REMOVE.bodyExtra).toEqual({ managerId: null });
    expect(Object.prototype.hasOwnProperty.call(REMOVE.bodyExtra, 'managerId')).toBe(true);
    expect(REMOVE.params ?? []).toEqual([]);
    // Nothing collected, so the question rides `confirmText`, not
    // `description` (the param-collecting set action's carrier).
    expect(REMOVE.confirmText).toBeTruthy();
    expect(REMOVE.description).toBeUndefined();
  });

  it('⛔ does NOT write manager_id through the generic data API', () => {
    expect(String(REMOVE.target)).not.toContain('/data/');
    expect(REMOVE.operation).toBeUndefined();
    expect(REMOVE.patch).toBeUndefined();
  });

  it('is gated exactly like set_user_manager: the same capability gate, the same standing term first', () => {
    expect(REMOVE.requiredPermissions).toEqual(ACTION.requiredPermissions);
    expect(REMOVE.requiresFeature).toBeUndefined();
    expect(REMOVE.locations).toEqual(ACTION.locations);
    const standing = sourceOf(ACTION.visible)!;
    expect(sourceOf(REMOVE.visible)!.startsWith(`${standing} && `)).toBe(true);
  });

  it('reads only the row\'s `manager_id`, never a copy of a server refusal', () => {
    const visible = sourceOf(REMOVE.visible)!;
    const columns = new Set([...visible.matchAll(/record\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]));
    expect([...columns]).toEqual(['manager_id']);
    expect(visible).not.toContain('record.source');
    expect(visible).not.toContain('ctx.user.id');
  });

  it('is offered only while the row has a manager, and only to the standing the door admits', () => {
    const visible = sourceOf(REMOVE.visible)!;
    expect(evaluate(visible, { id: 'someone_else', manager_id: 'u_mgr' })).toBe(true);
    // An SSO-only person's manager is cleared here too; a SCIM-held row is the
    // endpoint's refusal, as for the set.
    expect(evaluate(visible, { id: 'someone_else', manager_id: 'u_mgr', source: 'idp_provisioned' })).toBe(true);
    expect(evaluate(visible, { id: 'someone_else', manager_id: null })).toBe(false);
    // The sparse face (no column projected) is not a fault, just not offered.
    expect(evaluate(visible, { id: 'someone_else' })).toBe(false);
    const member = { id: 'm_1', isPlatformAdmin: false, positions: [] as string[] };
    const r = celEngine.evaluate(
      { dialect: 'cel', source: visible },
      { record: { id: 'someone_else', manager_id: 'u_mgr' }, extra: { current_user: member, user: member, ctx: { user: member }, os: { user: member }, features: {} } },
    );
    expect(r.ok && r.value).toBe(false);
  });

  it('stays human-only: no `ai` block, like every action after the ADR-0011 assessment', () => {
    expect(REMOVE.ai).toBeUndefined();
  });
});
