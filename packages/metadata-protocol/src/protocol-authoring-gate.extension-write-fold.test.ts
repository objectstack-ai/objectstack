// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33072 r1] The runtime authoring gate's view of an `object_extension`
 * write's target: without the written package's own stored extension, which
 * the write replaces. These pin the two helpers' contracts; the real-door
 * pins (republish in both directions, and a target with a stored object row)
 * are in `packages/runtime/src/domains/meta-object-extension-item.test.ts`.
 */

import { describe, expect, it } from 'vitest';
// The module under test reaches `@objectstack/lint` through `protocol.ts`; its
// first load is paid at collection, never inside a case's clock
// (`scripts/check-test-source-alias.mjs`).
import '@objectstack/lint';
import { objectExtensionWriteFold, withTargetFoldedWithout } from './protocol-authoring-gate.js';
import { foldObjectExtendersFromRegistry } from './protocol-object-extender-fold.js';

describe('[#33072] objectExtensionWriteFold — which writes narrow the target, and to what', () => {
    it('an object_extension write in a package narrows its `extend` target without that package', () => {
        expect(objectExtensionWriteFold('object_extension', 'crm_account', { extend: 'crm_account' }, 'com.acme.crm.custom'))
            .toEqual({ options: { withoutExtensionsOf: 'com.acme.crm.custom' }, target: 'crm_account' });
    });

    it('a body with no `extend` falls back to the item name', () => {
        expect(objectExtensionWriteFold('object_extension', 'crm_account', { fields: {} }, 'p')?.target).toBe('crm_account');
    });

    it('every other type, and a write naming no package, changes nothing', () => {
        expect(objectExtensionWriteFold('object', 'crm_account', { extend: 'crm_account' }, 'p')).toBeUndefined();
        expect(objectExtensionWriteFold('object_extension', 'crm_account', { extend: 'crm_account' }, undefined)).toBeUndefined();
        expect(objectExtensionWriteFold('object_extension', 'crm_account', { extend: 'crm_account' }, '')).toBeUndefined();
    });
});

describe('[#33072] withTargetFoldedWithout — only the target entry is replaced', () => {
    const served = [
        { name: 'crm_account', fields: { name: {}, bonus__c: {} } },
        { name: 'crm_region', fields: { code: {}, other__c: {} } },
    ];
    const without = [
        { name: 'crm_account', fields: { name: {} } },
        { name: 'crm_region', fields: { code: {} } },
    ];

    it('the target comes from the narrowed list; every other object keeps its served fold', () => {
        const out = withTargetFoldedWithout(served, without, 'crm_account');
        expect(out[0]).toBe(without[0]);
        // The package's extension of ANOTHER object is still served: the
        // narrowing is package-wide in the registry, so it is applied by name.
        expect(out[1]).toBe(served[1]);
    });

    it('a target the narrowed list lacks leaves the served list as it was', () => {
        expect(withTargetFoldedWithout(served, [], 'crm_account')).toEqual(served);
    });
});

describe('[#33072] foldObjectExtendersFromRegistry — what each package argument hands the registry', () => {
    const calls: unknown[][] = [];
    const host = {
        engine: { registry: { foldObjectExtendersOnto: (...a: unknown[]) => { calls.push(a.slice(2)); return a[1]; } } },
    } as never;
    const fold = (only?: string, without?: string) => {
        calls.length = 0;
        foldObjectExtendersFromRegistry.call(host, 'object', 'crm_account', { name: 'crm_account' }, only, without);
        return calls[0];
    };

    it('neither argument is the ordinary call, and `onlyExtensionsOf` alone is the call it always was', () => {
        expect(fold()).toEqual([]);
        expect(fold('p1')).toEqual([{ onlyExtensionsOf: 'p1' }]);
    });

    it('`withoutExtensionsOf` alone, and both together, are each handed over', () => {
        expect(fold(undefined, 'p2')).toEqual([{ withoutExtensionsOf: 'p2' }]);
        expect(fold('p1', 'p2')).toEqual([{ onlyExtensionsOf: 'p1', withoutExtensionsOf: 'p2' }]);
    });
});
