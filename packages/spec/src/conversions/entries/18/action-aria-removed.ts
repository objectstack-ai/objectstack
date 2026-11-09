// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `action-aria-removed` conversion (`toMajor: 18`), moved
// out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `actionAriaRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, stripKeys } from '../shared.js';

/**
 * `action.aria` removed (ADR-0049 enforce-or-remove; triage record 5860351140
 * on #20323, following the `ChartConfig.aria` retirement `2bf6ef18d`).
 *
 * A pure lossless delete. Measured at the `.objectui-sha` pin `f8a9d0fb05`, no
 * surface that renders an action reads the action's `aria` — every one of them
 * derives the accessible name from the action's required `label` (visible
 * text, or `aria-label` on the icon-only renderer and the overflow trigger), so
 * the rendered DOM is byte-for-byte the same with or without the block. What
 * the author meant by it is the paired D3 entry `action-aria-retired`'s
 * business; this entry only removes the key.
 *
 * ⚠️ Coverage boundary — TWO authored sites, because `ActionSchema` is authored
 * both as a stack collection and nested under its object (the walk
 * `action-execute-to-target` established):
 *
 *   - `actions[]`
 *   - `objects[].actions[]`
 *
 * Both are registered metadata kinds stored as `sys_metadata` rows, so the
 * stored-row seams replay this entry too. A plugin's type-level
 * `MetadataTypeRegistryEntry.actions` is code, not a stack source, and no
 * walker reaches it; the tombstone refuses it at parse instead.
 *
 * A SEPARATE family rather than more coordinates on `chart-config-aria-removed`:
 * that entry's identity is the chart config's measurement, and folding a
 * differently-evidenced removal into it would misattribute this one in
 * `spec-changes.json` and the upgrade guide — the reason that entry itself gave
 * for not joining `dashboard-widget-action-aria-removed`.
 */
const actionAriaRemoved: MetadataConversion = {
  id: 'action-aria-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'action.aria / object.actions[].aria',
  summary:
    "action key 'aria' removed (ADR-0049 enforce-or-remove — no action surface ever applied it; "
    + "every renderer takes the accessible name from the action's required 'label', and the "
    + "placing node's own 'aria' block names the region)",
  apply(stack, emit) {
    const strip = (action: Dict, path: string): Dict => stripKeys(action, ['aria'], emit, path);
    const withTopLevel = mapCollection(stack, 'actions', strip);
    return mapCollection(withTopLevel, 'objects', (obj, path) =>
      mapCollection(obj, 'actions', (action, actionPath) => strip(action, `${path}.${actionPath}`)),
    );
  },
  fixture: {
    before: {
      actions: [
        {
          name: 'escalate_case',
          label: 'Escalate',
          type: 'script',
          icon: 'arrow-up',
          aria: { ariaLabel: 'Escalate this case', role: 'button' },
        },
        // An action without the key passes through untouched.
        { name: 'close_case', label: 'Close', type: 'script' },
      ],
      objects: [{
        name: 'support_case',
        label: 'Case',
        actions: [{
          name: 'reopen_case',
          label: 'Reopen',
          type: 'script',
          aria: { ariaDescribedBy: 'reopen_help' },
        }],
      }],
    },
    after: {
      actions: [
        { name: 'escalate_case', label: 'Escalate', type: 'script', icon: 'arrow-up' },
        { name: 'close_case', label: 'Close', type: 'script' },
      ],
      objects: [{
        name: 'support_case',
        label: 'Case',
        actions: [{ name: 'reopen_case', label: 'Reopen', type: 'script' }],
      }],
    },
    // One notice per stripped action — top-level and object-nested — and none
    // for `close_case`.
    expectedNotices: 2,
  },
};

export { actionAriaRemoved };
