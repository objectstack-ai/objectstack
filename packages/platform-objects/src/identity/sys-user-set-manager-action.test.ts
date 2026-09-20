// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19249 — the `set_user_manager` row action on `sys_user`, pinned against the
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
 *  2. **The `visible` predicate carries the directory-sync term and NOT the
 *     self-service ownership term.** The three self-service identity actions
 *     on this object spell `record.source != "idp_provisioned"` as one half of
 *     `record.id == ctx.user.id && …`. Copying that predicate whole — the
 *     natural thing to do, and what a reader of the card would do — would hide
 *     an ADMIN action on someone else's row from every admin. The failure is
 *     silent and fail-closed (#8990): the button simply is not offered.
 *  3. **No second copy of the server's refusals.** Self-assignment, cycle,
 *     depth, cross-organization and directory-owned identity are all enforced
 *     at the write, in one derivation (`applyUserManagerLink`), which the bulk
 *     importer already routes onto rather than re-deriving. A client-side
 *     duplicate is the drift, not the safety net — so this file pins that the
 *     declaration reads exactly one record column and declares no predicate
 *     for any of the other four refusals.
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

/** Evaluate through the canonical engine; a fault is reported, never thrown. */
function evaluate(source: string, record: Record<string, unknown>): boolean | string {
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record, user: { id: 'admin_1' }, extra: { features: {} } },
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

  it('collects the manager as an inline sys_user lookup under the body key the endpoint reads', () => {
    const params = (ACTION.params ?? []) as AnyParam[];
    expect(params).toHaveLength(1);
    const [p] = params;
    expect(p.name).toBe('managerId');
    expect(p.type).toBe('lookup');
    expect(p.reference).toBe('sys_user');
    // INLINE, not field-backed: `{ field: 'manager_id' }` would inherit the
    // referenced field's metadata, and that field is `readonly: true`
    // (ADR-0092 D4 keeps it non-editable in the standard edit form).
    expect(p.field).toBeUndefined();
    // Required, because the endpoint refuses an ABSENT or empty key by design
    // ("managerId is required — send null to clear the link, never omit the
    // key"). A dialog that could submit nothing would turn an ordinary click
    // into a 400 about a key the user never saw.
    expect(p.required).toBe(true);
  });

  it('⛔ declares no second copy of the server-side refusals', () => {
    // Every refusal is enforced at the write and surfaces from there. What
    // would go wrong quietly is a client-side re-derivation drifting from the
    // endpoint's; so the predicate is pinned to the ONE column it reads, and
    // the declaration to having no other gate at all.
    const visible = sourceOf(ACTION.visible);
    expect(visible).toBeDefined();
    const columns = new Set(
      [...visible!.matchAll(/record\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]),
    );
    expect([...columns]).toEqual(['source']);
    expect(ACTION.disabled).toBeUndefined();
    // The manager chain, the organization screen and the self-assignment check
    // are the endpoint's; none of them is expressible — or declared — here.
    const declaration = JSON.stringify(ACTION);
    expect(declaration).not.toContain('ctx.user.id');
    expect(declaration).not.toContain('manager_user_id');
    expect(declaration).not.toContain('sys_business_unit');
  });
});

describe('#19249 — the visible predicate: directory-sync term, NOT the self-service one', () => {
  const visible = (): string => {
    const source = sourceOf(ACTION.visible);
    if (!source) throw new Error('set_user_manager has no CEL source');
    return source;
  };

  it('is hidden for a directory-owned identity (the server answers 403 idp_provisioned)', () => {
    expect(evaluate(visible(), { source: 'idp_provisioned' })).toBe(false);
  });

  it('⭐ is OFFERED to an admin on someone else\'s env-native row', () => {
    // The counter-direction, and the one that a verbatim copy of the
    // self-service predicate would break: this row is not the signed-in user.
    expect(evaluate(visible(), { id: 'someone_else', source: 'env_native' })).toBe(true);
  });

  it('carries the same directory-sync term the self-service actions spell', () => {
    // Byte-identical term, so the two never drift into two spellings of one
    // rule — while the ownership half they also carry stays out (asserted
    // above by the offered-to-an-admin verdict).
    expect(visible()).toContain('record.source != "idp_provisioned"');
    const selfService = actionsOf().find((a) => a.name === 'change_my_password');
    expect(sourceOf(selfService?.visible)).toContain('record.source != "idp_provisioned"');
  });

  it('⛔ is NOT gated on features.admin, and that is deliberate', () => {
    // The `admin` flag hides buttons whose endpoint is "only wired when
    // `auth.plugins.admin` is enabled" — the 404-avoidance the block header on
    // the admin actions states. This route is not one of those: it is an
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
