// #11992 — the exemplar half of the #11753 ruling (recommendation A,
// maintainer 2026-08-25): the five `clone_permission_set` facet params DECLARE
// the spec's `carryOver` key, so the clone dialog's JSON facets are copied
// verbatim, shown read-only, and never offered as prefilled textareas an admin
// could hand-mangle into a clone that grants MORE than its base.
//
// ⭐ IDENTITIES, NOT COUNTS (same discipline as the #11703 pins one file over):
// "five params declare it" holds constant while two of them swap. Every facet
// is asserted by NAME, and the deliberate non-member (`description` — prose,
// not a permission facet) is asserted NOT to carry the key, so the boundary of
// the declaration is pinned from both sides.
//
// The SEND side is deliberately not restated here — that is
// `packaged-permission-set-lock.test.ts`'s clone-payload suite (#11703 pin 6),
// which reads the params list and must stay green under this declaration
// precisely because `carryOver` changes what the dialog RENDERS, never what it
// SENDS.
import { describe, it, expect } from 'vitest';
import { ActionParamSchema } from '@objectstack/spec/ui';
import { SysPermissionSet } from './sys-permission-set.object.js';

/** The five JSON-serialized definition facets the clone carries (#11703). */
const CARRIED_FACETS = [
  'object_permissions',
  'field_permissions',
  'system_permissions',
  'row_level_security',
  'tab_permissions',
] as const;

const cloneParams = (): any[] => {
  const action = (SysPermissionSet.actions ?? []).find(
    (a: any) => a.name === 'clone_permission_set',
  );
  if (!action) throw new Error('clone_permission_set is missing from SysPermissionSet.actions');
  return (action as any).params ?? [];
};

describe('clone_permission_set carry-over declaration (#11992)', () => {
  it.each(CARRIED_FACETS)('%s declares carryOver: true alongside its row seed', (facet) => {
    const p = cloneParams().find((x) => x.field === facet);
    expect(p, `param { field: '${facet}' } is missing from clone_permission_set`).toBeDefined();
    expect(p.carryOver).toBe(true);
    // The co-requirement the spec enforces at parse time — asserted here too
    // so a future edit that drops the seed fails THIS suite by name instead of
    // only tripping a schema refusal somewhere in a stack build.
    expect(p.defaultFromRow).toBe(true);
  });

  it('description stays an ordinary editable param (no carryOver)', () => {
    const p = cloneParams().find((x) => x.field === 'description');
    expect(p, 'param { field: "description" } is missing').toBeDefined();
    expect(p.carryOver).toBeUndefined();
  });

  it('every clone param parses under ActionParamSchema (the declaration is spec-legal, not local dialect)', () => {
    for (const p of cloneParams()) {
      const r = ActionParamSchema.safeParse(p);
      expect(
        r.success,
        `param ${JSON.stringify(p)} refused: ${JSON.stringify((r as { error?: unknown }).error)}`,
      ).toBe(true);
    }
  });
});
