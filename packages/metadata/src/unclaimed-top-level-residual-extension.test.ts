// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0130 D4] The residual rule (`unclaimedTopLevel`) lists a multi-package
 * stack's residual `objectExtensions` entries, so the engine registers them
 * under the stack's `manifest.id` as it registers the residual's objects.
 *
 * An extension has no slot (it is keyed by `extend`; its `name` is a retired
 * alias), so the rule used to list none, and no door registered one: measured
 * through `os serve` on main `c30ce97cd7`, a `composeStacks(…, { manifest:
 * 'preserve' })` artifact with an input that has no manifest served the target
 * without the extension's field (`INVALID_FIELD` on write) and logged nothing.
 *
 * It is told from a body's flattened copy by VALUE, never by target: the
 * flattened top level repeats every body's entry, a built artifact has lost the
 * references, and an entry extending a target some body also extends with other
 * fields is the residual's own.
 */

import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from '@objectstack/spec';
import { unclaimedTopLevel } from './plugin.js';

const owner = { id: 'com.probe.owner', namespace: 'probe', name: 'probe', version: '1.0.0', type: 'module' as const };
const other = { id: 'com.probe.other', namespace: 'probe', name: 'probe_other', version: '1.0.0', type: 'module' as const };
const account = { name: 'probe_account', label: 'Account', sharingModel: 'private' as const, fields: { title: { type: 'text' as const, label: 'Title' } } };
const extension = (field: string) => ({ extend: 'probe_account', fields: { [field]: { type: 'text' as const, label: field } } });

const residualExtensions = (stack: unknown) =>
  (unclaimedTopLevel(stack)?.items ?? [])
    .filter((entry) => entry.type === 'object_extension')
    .map((entry) => ({ field: entry.field, index: entry.index, target: (entry.item as { extend: string }).extend, fields: Object.keys((entry.item as { fields: object }).fields) }));

describe('unclaimedTopLevel lists a residual objectExtensions entry', () => {
  const composed = () => composeStacks(
    [
      defineStack({ manifest: owner, objects: [account] }),
      defineStack({ manifest: other, objectExtensions: [extension('other_note')] }),
      defineStack({ objectExtensions: [extension('residual_note')] }),
    ],
    { manifest: 'preserve' },
  );

  it('the manifest-less input\'s entry, as composed and as built JSON; never the body\'s flattened copy', () => {
    for (const [leg, stack] of [['composed', composed()], ['built', JSON.parse(JSON.stringify(composed()))]] as const) {
      expect(residualExtensions(stack), leg).toEqual([
        { field: 'objectExtensions', index: 1, target: 'probe_account', fields: ['residual_note'] },
      ]);
      expect(unclaimedTopLevel(stack)?.ownerId, leg).toBe(other.id);
    }
  });

  it('CONTROL: a stack whose every extension a body carries lists none', () => {
    const stack = composeStacks(
      [
        defineStack({ manifest: owner, objects: [account] }),
        defineStack({ manifest: other, objectExtensions: [extension('other_note')] }),
        defineStack({ pages: [{ name: 'probe_home', label: 'Home', type: 'app', regions: [] }] }),
      ],
      { manifest: 'preserve' },
    );
    expect((stack as unknown as { objectExtensions: unknown[] }).objectExtensions, 'anti-vacuity: the flattened copy is there').toHaveLength(1);
    expect(residualExtensions(stack)).toEqual([]);
    expect(residualExtensions(JSON.parse(JSON.stringify(stack)))).toEqual([]);
  });

  it('CONTROL: a stack without packages[] has no residual', () => {
    expect(unclaimedTopLevel(defineStack({ manifest: owner, objects: [account], objectExtensions: [extension('x_note')] }))).toBeUndefined();
  });
});
