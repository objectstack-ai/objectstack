/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * View-name resolution for `/view/<name>` routes (#2217).
 *
 * Nav items emit `viewName` verbatim (usually the short form) while
 * canonical view ids are fully qualified — pre-fix a short-name route
 * silently fell back to the default view.
 */

import { describe, it, expect } from 'vitest';
import { resolveViewId } from '../resolveViewId';

const QUALIFIED = ['showcase_task.grid', 'showcase_task.tabular', 'showcase_task.kanban'];
const LEGACY = ['all', 'mine'];

describe('resolveViewId (#2217)', () => {
    it('returns an exact match as-is', () => {
        expect(resolveViewId('showcase_task.tabular', QUALIFIED, 'showcase_task'))
            .toBe('showcase_task.tabular');
        expect(resolveViewId('all', LEGACY, 'showcase_task')).toBe('all');
    });

    it('qualifies a short name against fully-qualified ids (nav-generated links)', () => {
        expect(resolveViewId('tabular', QUALIFIED, 'showcase_task'))
            .toBe('showcase_task.tabular');
    });

    it('strips the object prefix against legacy bare ids', () => {
        expect(resolveViewId('showcase_task.all', LEGACY, 'showcase_task')).toBe('all');
    });

    it('returns undefined when nothing matches (caller warns, then falls back)', () => {
        expect(resolveViewId('nope', QUALIFIED, 'showcase_task')).toBeUndefined();
        expect(resolveViewId('other_object.tabular', QUALIFIED, 'showcase_task')).toBeUndefined();
    });

    it('returns undefined for empty input', () => {
        expect(resolveViewId(undefined, QUALIFIED, 'showcase_task')).toBeUndefined();
        expect(resolveViewId(null, QUALIFIED, 'showcase_task')).toBeUndefined();
        expect(resolveViewId('', QUALIFIED, 'showcase_task')).toBeUndefined();
    });

    it('does not double-qualify a name that already contains a dot', () => {
        // `a.b` must not become `obj.a.b`
        expect(resolveViewId('a.b', ['obj.a.b'], 'obj')).toBeUndefined();
    });
});
