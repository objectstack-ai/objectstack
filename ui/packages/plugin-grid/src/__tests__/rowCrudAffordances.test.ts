// Copyright (c) 2026 ObjectStack Inc. MIT.
import { describe, it, expect } from 'vitest';
import { resolveAffordance, type SchemaLike } from '@object-ui/core';
import {
  resolveRowCrudAffordances as resolveFromVerdicts,
  resolveRowRecordCrudAffordance,
} from '../rowCrudAffordances';

/**
 * [objectui#12082] The object layers (a)–(d) now reach the row resolver as the
 * affordance-to-grant map's `rowEdit` / `rowDelete` verdicts, which `ObjectGrid`
 * resolves with `resolveAffordance` from the object schema, the effective
 * operation set and the caller's grant. This adapter keeps every row below in
 * the shape it was written in — bucket, `userActions`, operation set, grant —
 * and resolves those through the map exactly as the grid does, so the matrix
 * now pins the map AND the row wiring together.
 */
type RowInputs = Omit<Parameters<typeof resolveFromVerdicts>[0], 'edit' | 'delete'> & {
  managedBy?: string | null;
  userActions?: SchemaLike['userActions'];
  effectiveApiOperations?: readonly string[] | null;
  permissionUpdate?: boolean;
  permissionDelete?: boolean;
};

function resolveRowCrudAffordances(opts: RowInputs) {
  const { managedBy, userActions, effectiveApiOperations, permissionUpdate, permissionDelete, ...wiring } = opts;
  const perms = {
    can: (_object: string, verb: 'create' | 'update' | 'delete') =>
      (verb === 'update' ? permissionUpdate : verb === 'delete' ? permissionDelete : undefined) !== false,
    getObjectApiOperations: () => effectiveApiOperations ?? undefined,
  };
  const source = { objectSchema: { managedBy, userActions }, objectName: 'row_object', perms };
  return resolveFromVerdicts({
    ...wiring,
    edit: resolveAffordance('rowEdit', source),
    delete: resolveAffordance('rowDelete', source),
  });
}

/** The row-level verdict only — drops the object-level bulk-delete bit. */
const rowGate = (opts: Parameters<typeof resolveRowCrudAffordances>[0]) => {
  const { canEdit, canDelete } = resolveRowCrudAffordances(opts);
  return { canEdit, canDelete };
};

describe('resolveRowCrudAffordances', () => {
  const wired = { operationsUpdate: true, operationsDelete: true, hasOnEdit: true, hasOnDelete: true };

  it('surfaces generic edit/delete by default (userActions undefined)', () => {
    expect(rowGate({ ...wired })).toEqual({ canEdit: true, canDelete: true });
  });

  it('keeps both when userActions explicitly true', () => {
    expect(rowGate({ ...wired, userActions: { edit: true, delete: true } }))
      .toEqual({ canEdit: true, canDelete: true });
  });

  it('suppresses generic edit/delete when the object opts out (userActions false)', () => {
    // sys_environment case: edit:false + delete:false → no generic kebab entries,
    // leaving only the object's dedicated Rename / Delete actions (no duplicate).
    expect(rowGate({ ...wired, userActions: { edit: false, delete: false } }))
      .toEqual({ canEdit: false, canDelete: false });
  });

  it('gates edit and delete independently', () => {
    expect(rowGate({ ...wired, userActions: { edit: false } }))
      .toEqual({ canEdit: false, canDelete: true });
    expect(rowGate({ ...wired, userActions: { delete: false } }))
      .toEqual({ canEdit: true, canDelete: false });
  });

  it('still requires the callback + operation to be wired (opt-out is not opt-in)', () => {
    expect(rowGate({ hasOnEdit: false, hasOnDelete: false, operationsUpdate: true, operationsDelete: true }))
      .toEqual({ canEdit: false, canDelete: false });
  });

  // [objectui#9819] `operations` is the CEILING over `rowActions`, by the
  // maintainer ruling of 2026-09-18 (batch #162 item 1, letter A). These two
  // cases replace one that asserted the opposite — that the canonical
  // `rowActions` names opened both entries on their own, with `operations`
  // contributing nothing. The gate is now an intersection like every layer
  // around it, and an `operations` member the authored block does not name is
  // not an allowance.
  it('an explicit rowActions selection alone can no longer OPEN either entry', () => {
    expect(rowGate({ wantEditAction: true, wantDeleteAction: true, hasOnEdit: true, hasOnDelete: true }))
      .toEqual({ canEdit: false, canDelete: false });
  });

  it('…and an explicit `operations.update: false` beats the selection outright, per member', () => {
    expect(rowGate({ ...wired, operationsUpdate: false, wantEditAction: true }))
      .toEqual({ canEdit: false, canDelete: true });
    expect(rowGate({ ...wired, operationsDelete: false, wantDeleteAction: true }))
      .toEqual({ canEdit: true, canDelete: false });
  });

  // [objectui#10083] The ruling's second half: inside the ceiling a DECLARED
  // `rowActions` list narrows to the canonical names it carries, and an absent
  // one takes the default arm. `rowActionsDeclared` is what tells the two apart.
  describe('#10083 `rowActions` narrows inside the ceiling', () => {
    it('a declared list naming only `edit` withholds delete', () => {
      expect(rowGate({ ...wired, rowActionsDeclared: true, wantEditAction: true, wantDeleteAction: false }))
        .toEqual({ canEdit: true, canDelete: false });
    });

    it('a declared list naming neither (empty, or custom names only) withholds both', () => {
      expect(rowGate({ ...wired, rowActionsDeclared: true, wantEditAction: false, wantDeleteAction: false }))
        .toEqual({ canEdit: false, canDelete: false });
    });

    it('an ABSENT list keeps the default — the same `false` selections do not narrow', () => {
      expect(rowGate({ ...wired, rowActionsDeclared: false, wantEditAction: false, wantDeleteAction: false }))
        .toEqual({ canEdit: true, canDelete: true });
      expect(rowGate({ ...wired })).toEqual({ canEdit: true, canDelete: true });
    });

    it('a declared selection still cannot pass the ceiling', () => {
      expect(rowGate({ ...wired, operationsUpdate: false, rowActionsDeclared: true, wantEditAction: true, wantDeleteAction: true }))
        .toEqual({ canEdit: false, canDelete: true });
    });

    it('narrowing leaves the bulk-delete verdict alone (it rides `onBulkDelete`, not the row selection)', () => {
      const r = resolveRowCrudAffordances({ ...wired, rowActionsDeclared: true, wantDeleteAction: false });
      expect(r.canDelete).toBe(false);
      expect(r.objectCanDelete).toBe(true);
    });
  });

  describe('#2614 object form (per-record CEL predicates)', () => {
    it('passes visibleWhen/disabledWhen through untouched and keeps canEdit/canDelete on', () => {
      const res = resolveRowCrudAffordances({
        ...wired,
        userActions: {
          edit: { disabledWhen: 'record.frozen == true' },
          delete: { visibleWhen: { dialect: 'cel', source: 'record.frozen != true' } },
        },
      });
      expect(res.canEdit).toBe(true);
      expect(res.canDelete).toBe(true);
      expect(res.editPredicates).toEqual({ disabledWhen: 'record.frozen == true' });
      expect(res.deletePredicates).toEqual({ visibleWhen: { dialect: 'cel', source: 'record.frozen != true' } });
    });

    it('object form with enabled:false opts out like the bare boolean (and drops predicates)', () => {
      const res = resolveRowCrudAffordances({
        ...wired,
        userActions: { edit: { enabled: false, disabledWhen: 'record.frozen == true' } },
      });
      expect(res.canEdit).toBe(false);
      expect(res.editPredicates).toBeUndefined();
      expect(res.canDelete).toBe(true);
    });

    it('object form without predicates adds nothing (boolean-equivalent)', () => {
      const res = resolveRowCrudAffordances({ ...wired, userActions: { edit: { enabled: true }, delete: {} } });
      expect(rowGate({ ...wired, userActions: { edit: { enabled: true }, delete: {} } }))
        .toEqual({ canEdit: true, canDelete: true });
      expect(res.editPredicates).toBeUndefined();
      expect(res.deletePredicates).toBeUndefined();
    });

    it('predicates are not surfaced when the affordance is not wired at all', () => {
      const res = resolveRowCrudAffordances({
        hasOnEdit: false,
        operationsUpdate: true,
        userActions: { edit: { disabledWhen: 'record.frozen == true' } },
      });
      expect(res.canEdit).toBe(false);
      expect(res.editPredicates).toBeUndefined();
    });

    it('a server denial drops the predicates along with the affordance', () => {
      const res = resolveRowCrudAffordances({
        ...wired,
        userActions: { edit: { disabledWhen: 'record.frozen == true' } },
        effectiveApiOperations: ['get', 'list'],
      });
      expect(res.canEdit).toBe(false);
      expect(res.editPredicates).toBeUndefined();
    });
  });

  // [#3720] The fourth face of #3391: the row kebab intersects with the
  // server-resolved effective operation set (`/me/permissions` apiOperations),
  // matching the toolbar (objectui#2823), detail/form (#3546) and related-list
  // gates. Intersection, never union.
  describe('#3720 effective API operation set', () => {
    const FULL = ['get', 'list', 'create', 'update', 'delete'];

    it('keeps both entries when the effective set carries update + delete', () => {
      expect(rowGate({ ...wired, effectiveApiOperations: FULL }))
        .toEqual({ canEdit: true, canDelete: true });
    });

    it('hides both when the effective set is read-only', () => {
      expect(rowGate({ ...wired, effectiveApiOperations: ['get', 'list'] }))
        .toEqual({ canEdit: false, canDelete: false });
    });

    it('gates the two operations independently', () => {
      expect(rowGate({ ...wired, effectiveApiOperations: ['get', 'list', 'update'] }))
        .toEqual({ canEdit: true, canDelete: false });
      expect(rowGate({ ...wired, effectiveApiOperations: ['get', 'list', 'delete'] }))
        .toEqual({ canEdit: false, canDelete: true });
    });

    it('an empty effective set exposes nothing', () => {
      expect(rowGate({ ...wired, effectiveApiOperations: [] }))
        .toEqual({ canEdit: false, canDelete: false });
    });

    it('a missing effective set preserves the pre-#3720 behavior', () => {
      expect(rowGate({ ...wired, effectiveApiOperations: undefined }))
        .toEqual({ canEdit: true, canDelete: true });
      expect(rowGate({ ...wired, effectiveApiOperations: null }))
        .toEqual({ canEdit: true, canDelete: true });
    });

    it('intersects, never unions — a server grant cannot re-open a userActions opt-out', () => {
      expect(rowGate({ ...wired, userActions: { edit: false, delete: false }, effectiveApiOperations: FULL }))
        .toEqual({ canEdit: false, canDelete: false });
    });

    it('intersects, never unions — a userActions opt-in cannot survive a server denial', () => {
      expect(rowGate({ ...wired, userActions: { edit: true, delete: true }, effectiveApiOperations: ['get', 'list'] }))
        .toEqual({ canEdit: false, canDelete: false });
    });
  });

  // [#3720] The same chain never applied the ADR-0103 bucket lock either: the
  // module used to assume it arrived upstream via the view's `operations.*`,
  // but `operations` defaults to "whatever the consumer wired" and every main
  // list wires onEdit/onDelete unconditionally. Now it runs the shared policy.
  describe('#3720 ADR-0103 lifecycle bucket', () => {
    it('an absent managedBy resolves to the platform bucket (both entries on)', () => {
      expect(rowGate({ ...wired, managedBy: undefined }))
        .toEqual({ canEdit: true, canDelete: true });
    });

    it('config objects keep generic edit/delete', () => {
      expect(rowGate({ ...wired, managedBy: 'config' }))
        .toEqual({ canEdit: true, canDelete: true });
    });

    // `'system'` is gone from this list: protocol 17 split that bucket
    // (objectstack#3355) into `engine-owned` (locked) and `system-data`
    // (writable), so the old value now resolves to the default-writable
    // fallback and asserting it is locked pins nothing.
    it.each(['engine-owned', 'append-only', 'better-auth'])(
      'engine-owned bucket %s hides generic edit/delete',
      (managedBy) => {
        expect(rowGate({ ...wired, managedBy })).toEqual({ canEdit: false, canDelete: false });
      },
    );

    it('a userActions opt-in re-opens a bucket-locked object (sys_user edit)', () => {
      expect(rowGate({ ...wired, managedBy: 'better-auth', userActions: { edit: true } }))
        .toEqual({ canEdit: true, canDelete: false });
    });

    it('the server effective set still clamps a bucket opt-in', () => {
      expect(rowGate({
        ...wired,
        managedBy: 'better-auth',
        userActions: { edit: true },
        effectiveApiOperations: ['get', 'list'],
      })).toEqual({ canEdit: false, canDelete: false });
    });
  });

  // [#3720] Bulk delete gates on the OBJECT verdict, not the row one: it rides
  // `onBulkDelete`, a different callback from the row `onDelete`.
  describe('#3720 objectCanDelete (the bulk-delete gate)', () => {
    it('stays true when the row callback is absent but the object allows delete', () => {
      const res = resolveRowCrudAffordances({ operationsUpdate: true, operationsDelete: true, hasOnDelete: false });
      expect(res.canDelete).toBe(false);
      expect(res.objectCanDelete).toBe(true);
    });

    it('follows the object verdict through every layer', () => {
      expect(resolveRowCrudAffordances({ ...wired, userActions: { delete: false } }).objectCanDelete).toBe(false);
      expect(resolveRowCrudAffordances({ ...wired, managedBy: 'append-only' }).objectCanDelete).toBe(false);
      expect(resolveRowCrudAffordances({ ...wired, effectiveApiOperations: ['get', 'list'] }).objectCanDelete).toBe(false);
      expect(resolveRowCrudAffordances({ ...wired, effectiveApiOperations: ['get', 'list', 'delete'] }).objectCanDelete).toBe(true);
      // [#4096] …including the principal layer, so the bulk bar cannot outlive
      // the row kebab for a caller with no delete grant.
      expect(resolveRowCrudAffordances({ ...wired, permissionDelete: false }).objectCanDelete).toBe(false);
    });
  });

  // [#4096] The principal layer. `effectiveApiOperations` describes the OBJECT
  // (which verbs it publishes) and is byte-identical across accounts with
  // opposite write grants — measured 30/30 in the report — so it can never act
  // as the user permission gate on its own. `permissionUpdate` /
  // `permissionDelete` carry `/me/permissions` `allowEdit` / `allowDelete`.
  describe('#4096 principal-scoped permission gate', () => {
    const FULL = ['get', 'list', 'create', 'update', 'delete'];

    it('a principal WITH write permission still sees both entries', () => {
      expect(rowGate({ ...wired, effectiveApiOperations: FULL, permissionUpdate: true, permissionDelete: true }))
        .toEqual({ canEdit: true, canDelete: true });
    });

    it('a principal WITHOUT write permission sees neither — even on a fully exposed object', () => {
      // The exact #4096 shape: account A's `apiOperations` is the full verb set
      // (identical to the writer's) while `allowEdit` / `allowDelete` are false.
      // Before this layer the row kebab rendered both entries regardless.
      expect(rowGate({ ...wired, effectiveApiOperations: FULL, permissionUpdate: false, permissionDelete: false }))
        .toEqual({ canEdit: false, canDelete: false });
    });

    it('gates update and delete independently', () => {
      expect(rowGate({ ...wired, effectiveApiOperations: FULL, permissionUpdate: true, permissionDelete: false }))
        .toEqual({ canEdit: true, canDelete: false });
      expect(rowGate({ ...wired, effectiveApiOperations: FULL, permissionUpdate: false, permissionDelete: true }))
        .toEqual({ canEdit: false, canDelete: true });
    });

    it('an absent verdict changes nothing (no object name / no provider)', () => {
      // `usePermissions()` with no `PermissionProvider` answers `can: () => true`,
      // so a provider-less host arrives here as `true`, not `undefined` — both
      // shapes must leave the pre-#4096 outcome intact.
      expect(rowGate({ ...wired, permissionUpdate: undefined, permissionDelete: undefined }))
        .toEqual({ canEdit: true, canDelete: true });
      expect(rowGate({ ...wired, permissionUpdate: true, permissionDelete: true }))
        .toEqual({ canEdit: true, canDelete: true });
    });

    it('intersects, never unions — a permission grant cannot re-open a bucket lock', () => {
      expect(rowGate({ ...wired, managedBy: 'append-only', permissionUpdate: true, permissionDelete: true }))
        .toEqual({ canEdit: false, canDelete: false });
    });

    it('intersects, never unions — a permission grant cannot re-open a userActions opt-out', () => {
      expect(rowGate({
        ...wired,
        userActions: { edit: false, delete: false },
        permissionUpdate: true,
        permissionDelete: true,
      })).toEqual({ canEdit: false, canDelete: false });
    });

    it('intersects, never unions — a permission grant cannot re-open a server denial', () => {
      expect(rowGate({
        ...wired,
        effectiveApiOperations: ['get', 'list'],
        permissionUpdate: true,
        permissionDelete: true,
      })).toEqual({ canEdit: false, canDelete: false });
    });

    it('intersects, never unions — a userActions opt-in cannot survive a permission denial', () => {
      expect(rowGate({
        ...wired,
        managedBy: 'better-auth',
        userActions: { edit: true, delete: true },
        permissionUpdate: false,
        permissionDelete: false,
      })).toEqual({ canEdit: false, canDelete: false });
    });

    it('the apiOperations layer is KEPT, not replaced', () => {
      // A write grant must not resurrect an entry the object's exposure surface
      // closed: an `apiOperations` set without `delete` still hides Delete.
      expect(rowGate({
        ...wired,
        effectiveApiOperations: ['get', 'list', 'update'],
        permissionUpdate: true,
        permissionDelete: true,
      })).toEqual({ canEdit: true, canDelete: false });
    });
  });
});

/**
 * [#4296] Layer (e) — the RECORD-level verdict, the one narrowing that is
 * decided per row rather than per object.
 *
 * The layer below it (#4096) answers "may this principal write this OBJECT";
 * `writeScope`, the sharing model and RLS narrow that per record, so the row
 * kebab offered Edit/Delete on every row the user could READ until this layer
 * existed — including rows the server answers 403 for.
 */
describe('resolveRowRecordCrudAffordance (#4296)', () => {
  it('hides the entry when the record-level verdict denies THIS row', () => {
    // The card's cell: the object grant is true, the row is not the caller's.
    expect(resolveRowRecordCrudAffordance(true, false)).toBe(false);
  });

  it('keeps the entry when the record-level verdict allows THIS row', () => {
    expect(resolveRowRecordCrudAffordance(true, true)).toBe(true);
  });

  it('degrades to the object verdict when the record answer is UNKNOWN', () => {
    // No answer yet / endpoint down / row missing from the map / no row id.
    // Unknown must never read as denial: the server already fail-closes, so an
    // over-hidden row costs a permitted user a capability they actually have.
    expect(resolveRowRecordCrudAffordance(true, undefined)).toBe(true);
    expect(resolveRowRecordCrudAffordance(false, undefined)).toBe(false);
  });

  it('intersects, never unions — a record grant cannot re-open the object verdict', () => {
    // The whole chain above (bucket, userActions, apiOperations, allowEdit)
    // stays authoritative; this layer only ever removes.
    expect(resolveRowRecordCrudAffordance(false, true)).toBe(false);
  });

  it('an absent object verdict stays absent', () => {
    expect(resolveRowRecordCrudAffordance(undefined, true)).toBe(false);
  });
});
