/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { resolveBulkActions, resolvePromotedBulkParams, PROMOTED_BULK_BATCH_SIZE } from '../resolveBulkActions';
import type { BulkActionDef } from '@object-ui/types';

const PUSH_DOWN = {
  name: 'push_down',
  label: '下推',
  type: 'api',
  target: '/api/v1/plans/push',
};

const AUTHORED: BulkActionDef = {
  name: 'archive',
  label: 'Archive',
  operation: 'update',
  patch: { archived: true },
};

describe('resolveBulkActions', () => {
  it('promotes a named action to its declared def', () => {
    // Naming the action in the view's `bulkActions` is the ONLY declaration —
    // spec 17 retired `action.bulkEnabled` (framework#4054) and its tombstone
    // prescribes exactly this.
    const { defs, unresolved } = resolveBulkActions({
      bulkActions: ['push_down'],
      objectActions: [PUSH_DOWN],
    });

    expect(unresolved).toEqual([]);
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      name: 'push_down',
      label: '下推',
      operation: 'custom',
      actionDef: PUSH_DOWN,
      batchSize: PROMOTED_BULK_BATCH_SIZE,
    });
  });

  it('surfaces nothing for an object action the view never names', () => {
    const rowOnly = { name: 'convert_lead', label: 'Convert', locations: ['list_item'] };
    const { defs, unresolved } = resolveBulkActions({ objectActions: [rowOnly, PUSH_DOWN] });

    expect(defs).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it('ignores a stale bulkEnabled flag on an object action', () => {
    // The key is a retiredKey() tombstone: `defineStack` hard-rejects a config
    // that sets it, so it must never be a path into the bar on its own.
    const stale = { name: 'push_down', label: '下推', bulkEnabled: true };
    const { defs, unresolved } = resolveBulkActions({ objectActions: [stale] });

    expect(defs).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it('keeps a name that matches no declared action for by-name dispatch', () => {
    const { defs, unresolved } = resolveBulkActions({
      bulkActions: ['push_down', 'crm_only_handler'],
      objectActions: [PUSH_DOWN],
    });

    expect(defs.map(d => d.name)).toEqual(['push_down']);
    expect(unresolved).toEqual(['crm_only_handler']);
  });

  it('lets an inline-authored def win over the object action of the same name', () => {
    const authoredPush: BulkActionDef = { name: 'push_down', operation: 'update', patch: { s: 1 } };
    const { defs } = resolveBulkActions({
      bulkActions: ['push_down'],
      bulkActionDefs: [authoredPush],
      objectActions: [PUSH_DOWN],
    });

    expect(defs).toEqual([authoredPush]);
  });

  it('drops a repeated name', () => {
    const { defs, unresolved } = resolveBulkActions({
      bulkActions: ['dispatch_job', 'dispatch_job', 'ghost', 'ghost'],
      objectActions: [{ name: 'dispatch_job' }],
    });

    expect(defs).toHaveLength(1);
    expect(unresolved).toEqual(['ghost']);
  });

  it('returns the authored array by reference when nothing folds in', () => {
    const authored = [AUTHORED];
    const { defs } = resolveBulkActions({ bulkActionDefs: authored, objectActions: [] });

    expect(defs).toBe(authored);
  });

  it('maps spec param keys onto the dialog vocabulary', () => {
    // [objectui#12105] The fold attaches no `params` of its own; they are the
    // action's, resolved when the dialog opens (`resolvePromotedBulkParams`)
    // through the shared resolver. `owner` is field-backed, so the context
    // carries the field it binds — the inline keys still override it.
    const withParams = {
      name: 'reassign',
      params: [
        {
          field: 'owner',
          label: 'New owner',
          type: 'lookup',
          reference: 'sys_user',
          helpText: 'Who takes over',
          defaultValue: 'u1',
          required: true,
        },
        // Not authorable as a body key — no `name` and no `field` to fall back to.
        { label: 'orphan' },
      ],
    };
    const { defs } = resolveBulkActions({
      bulkActions: ['reassign'],
      objectActions: [withParams],
    });
    expect(defs[0].params).toBeUndefined();

    const resolved = resolvePromotedBulkParams(defs[0], {
      objectName: 'job',
      objects: [{ name: 'job', fields: { owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' } } }],
      fieldLabel: (_o, _f, fallback) => fallback,
    });
    expect(resolved.params).toEqual([
      expect.objectContaining({
        name: 'owner',
        label: 'New owner',
        type: 'lookup',
        object: 'sys_user',
        help: 'Who takes over',
        default: 'u1',
        required: true,
      }),
    ]);
  });

  it('drops a non-string I18nLabel rather than handing an object to the renderer', () => {
    const mapLabel = { name: 'push_down', label: { en: 'Push', 'zh-CN': '下推' } };
    const { defs } = resolveBulkActions({
      bulkActions: ['push_down'],
      objectActions: [mapLabel],
    });

    expect(defs[0].label).toBeUndefined();
  });

  it('carries confirm text, icon and visible from the action', () => {
    const rich = {
      name: 'push_down',
      icon: 'send',
      variant: 'danger',
      confirmText: '确认下推?',
      visible: { dialect: 'cel', source: 'current_user.is_admin' },
    };
    const { defs } = resolveBulkActions({
      bulkActions: ['push_down'],
      objectActions: [rich],
    });

    expect(defs[0]).toMatchObject({
      icon: 'send',
      variant: 'danger',
      confirmText: '确认下推?',
      visible: { dialect: 'cel', source: 'current_user.is_admin' },
    });
  });

  // [objectui#4314] The structured `confirm` object is retired. Spec's action
  // surface carries only `confirmText`, so `objectDef.actions` can never
  // deliver this key — and the fallback read that used to sit in
  // `toBulkActionDef` was the last thing keeping the second dialect alive.
  it('ignores the retired structured confirm object (objectui#4314)', () => {
    const stale = { name: 'push_down', confirm: { message: '确认下推?' } };
    const { defs } = resolveBulkActions({
      bulkActions: ['push_down'],
      objectActions: [stale],
    });

    expect(defs[0].confirmText).toBeUndefined();
  });

  // [objectui#3492] The capability gate must travel with the promoted action:
  // the bar renders defs, not `ActionDef`s, so a dropped declaration is the
  // whole gate — the same action that the row kebab hides from an unentitled
  // user reappeared here the moment a row was selected.
  it('forwards requiredPermissions from the action', () => {
    const gated = { name: 'push_down', requiredPermissions: ['plan.push'] };
    const { defs } = resolveBulkActions({
      bulkActions: ['push_down'],
      objectActions: [gated],
    });

    expect(defs[0].requiredPermissions).toEqual(['plan.push']);
  });

  it('omits requiredPermissions when the action declares none', () => {
    const { defs } = resolveBulkActions({
      bulkActions: ['push_down'],
      objectActions: [PUSH_DOWN],
    });

    // Absent, not `[]` — an empty array is a legitimate authored value and the
    // fold must not invent one (`useCapabilityGate` treats both as "passes").
    expect('requiredPermissions' in defs[0]).toBe(false);
  });

  it('drops a non-array requiredPermissions rather than forwarding it', () => {
    const bogus = { name: 'push_down', requiredPermissions: 'plan.push' };
    const { defs } = resolveBulkActions({
      bulkActions: ['push_down'],
      objectActions: [bogus],
    });

    expect('requiredPermissions' in defs[0]).toBe(false);
  });

  it('drops an action variant the bulk bar cannot render', () => {
    const linkVariant = { name: 'push_down', variant: 'link' };
    const { defs } = resolveBulkActions({
      bulkActions: ['push_down'],
      objectActions: [linkVariant],
    });

    expect(defs[0].variant).toBeUndefined();
  });

  it('localizes promoted labels through the supplied resolver', () => {
    const { defs } = resolveBulkActions({
      bulkActions: ['push_down'],
      objectActions: [PUSH_DOWN],
      localizeLabel: (name, fallback) => (name === 'push_down' ? 'Push Down' : fallback),
    });

    expect(defs[0].label).toBe('Push Down');
  });

  // [#3139] `execution: 'aggregate'` authored defs — the ONE case where an
  // authored def gets the object action resolved onto it.
  describe('aggregate authored defs', () => {
    it('attaches the named object action as actionDef, without the promoted batchSize', () => {
      const authored: BulkActionDef = {
        name: 'push_down',
        operation: 'custom',
        execution: 'aggregate',
      };
      const { defs, unresolved } = resolveBulkActions({
        bulkActionDefs: [authored],
        objectActions: [PUSH_DOWN],
      });

      expect(unresolved).toEqual([]);
      expect(defs).toHaveLength(1);
      expect(defs[0]).toMatchObject({
        name: 'push_down',
        operation: 'custom',
        execution: 'aggregate',
        label: '下推',
        actionDef: PUSH_DOWN,
      });
      // One call by contract — never chunked, so the per-record fan-out
      // concurrency cap must not ride along.
      expect(defs[0].batchSize).toBeUndefined();
    });

    it('authored keys win over the resolved action', () => {
      const authored: BulkActionDef = {
        name: 'push_down',
        label: 'Batch push',
        variant: 'danger',
        operation: 'custom',
        execution: 'aggregate',
        maxRecords: 100,
      };
      const { defs } = resolveBulkActions({
        bulkActionDefs: [authored],
        objectActions: [PUSH_DOWN],
      });

      expect(defs[0]).toMatchObject({
        label: 'Batch push',
        variant: 'danger',
        maxRecords: 100,
        actionDef: PUSH_DOWN,
      });
    });

    it('leaves an aggregate def naming no declared action untouched', () => {
      const authored: BulkActionDef = {
        name: 'ghost_action',
        operation: 'custom',
        execution: 'aggregate',
      };
      const { defs } = resolveBulkActions({
        bulkActionDefs: [authored],
        objectActions: [PUSH_DOWN],
      });

      // No actionDef → the executor has nothing to dispatch (no-op), same as
      // any other plain custom def.
      expect(defs).toEqual([authored]);
      expect(defs[0].actionDef).toBeUndefined();
    });

    it('does NOT touch a plain custom def that shares a declared action name', () => {
      // Regression guard for the merge's scoping: without an explicit
      // `execution: 'aggregate'`, an authored custom def keeps its historical
      // no-op/callout meaning even when an object action shares its name.
      const authored: BulkActionDef = { name: 'push_down', operation: 'custom' };
      const { defs } = resolveBulkActions({
        bulkActionDefs: [authored],
        objectActions: [PUSH_DOWN],
      });

      expect(defs).toEqual([authored]);
      expect(defs[0].actionDef).toBeUndefined();
    });

    it('an aggregate def with an inline actionDef is left as authored', () => {
      const inline = { name: 'push_down', type: 'api', target: '/custom' };
      const authored: BulkActionDef = {
        name: 'push_down',
        operation: 'custom',
        execution: 'aggregate',
        actionDef: inline,
      };
      const { defs } = resolveBulkActions({
        bulkActionDefs: [authored],
        objectActions: [PUSH_DOWN],
      });

      expect(defs).toEqual([authored]);
      expect(defs[0].actionDef).toBe(inline);
    });

    it('still claims its name against bulkActions duplicates', () => {
      const authored: BulkActionDef = {
        name: 'push_down',
        operation: 'custom',
        execution: 'aggregate',
      };
      const { defs } = resolveBulkActions({
        bulkActions: ['push_down'],
        bulkActionDefs: [authored],
        objectActions: [PUSH_DOWN],
      });

      // One button, the authored aggregate one — not a promoted twin.
      expect(defs).toHaveLength(1);
      expect(defs[0].execution).toBe('aggregate');
    });
  });
});
