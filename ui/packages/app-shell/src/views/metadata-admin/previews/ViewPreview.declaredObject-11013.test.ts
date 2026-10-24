// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11013 — the Studio view preview reads the bound object of a stored
 * `view` draft under the spellings the spec declares: the row's `object` and
 * its config's `data.object` (ruling 甲 on objectstack#20051, stage ii).
 *
 * `resolveObjectName` also read `objectName`, off the body and off the draft.
 * The spec declares it on no `view` member, so the metadata door refuses a row
 * bound by it alone (pinned in `@object-ui/data-objectstack`'s
 * `viewItemObjectName.declaredSpelling-11013.test.ts`). A draft whose only
 * binding is the undeclared spelling now previews as unbound.
 */

import { describe, it, expect } from 'vitest';
import { resolveObjectName } from './ViewPreview';

describe('objectui#11013 — ViewPreview binds a view draft by its declared spelling', () => {
  it('reads the body\'s `object`, then its `data.object`, then the draft\'s', () => {
    expect(resolveObjectName({}, { object: 'task' })).toBe('task');
    expect(resolveObjectName({}, { data: { provider: 'object', object: 'task' } })).toBe('task');
    expect(resolveObjectName({ object: 'task' }, { type: 'grid' })).toBe('task');
    expect(resolveObjectName({ data: { provider: 'object', object: 'task' } })).toBe('task');
  });

  it('a draft carrying both spellings binds by `object`', () => {
    expect(resolveObjectName({ object: 'task', objectName: 'other' }, { type: 'grid' })).toBe('task');
  });

  it('`objectName` alone binds nothing — on the body or on the draft', () => {
    expect(resolveObjectName({}, { objectName: 'task' })).toBeUndefined();
    expect(resolveObjectName({ objectName: 'task' }, { type: 'grid' })).toBeUndefined();
    expect(resolveObjectName({ objectName: 'task' })).toBeUndefined();
  });
});
