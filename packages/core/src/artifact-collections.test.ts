// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resolveArtifactCollections` — ADR-0130 D4 / option B (#15005).
 *
 * The acceptance pin for the reader program
 * (`packages/cli/test/option-b-reader-acceptance.pin.test.ts`) measures whether
 * the SUBSYSTEMS see their collections. These tests pin the resolution itself,
 * on the four properties that pin cannot separate because a real boot exercises
 * them together:
 *
 *   1. the additive shape the platform emits TODAY comes back UNCHANGED —
 *      identity, not merely equality — so the reader program cannot have moved
 *      it;
 *   2. an option-B artifact yields the package bodies' collections, in
 *      `resolveArtifactPackageOrder`'s order;
 *   3. a PARTIALLY flattened artifact resolves per item, which is the state a
 *      "top level, else `packages[]`" fallback answers wrongly;
 *   4. a key NO source declares stays ABSENT rather than becoming `[]` —
 *      `createStandaloneStack` omits `objects` on that basis and consumers gate
 *      on the key's presence.
 */

import { describe, it, expect } from 'vitest';

import { resolveArtifactCollections, packageOwnedCollectionKeys } from './artifact-collections';

/** A schema-valid object definition — `ArtifactPackageSchema` parses each body WHOLE. */
const obj = (name: string, fields: Record<string, unknown> = {}): Record<string, unknown> => ({
    name,
    label: name,
    fields: { name: { name: 'name', type: 'text', label: 'Name' }, ...fields },
});

/** Two packages, `orders` depending on `core`, so the order is not the array's. */
const packagesOf = (
    coreCollections: Record<string, unknown> = {},
    ordersCollections: Record<string, unknown> = {},
): unknown[] => [
    {
        manifest: {
            id: 'com.example.orders',
            name: 'Orders',
            version: '1.0.0',
            type: 'module',
            dependencies: { 'com.example.core': '^1.0.0' },
            ...ordersCollections,
        },
    },
    {
        manifest: { id: 'com.example.core', name: 'Core', version: '1.0.0', type: 'app', ...coreCollections },
    },
];

describe('packageOwnedCollectionKeys', () => {
    it('is derived from the schemas — the collections a package owns, never the envelope', () => {
        const keys = packageOwnedCollectionKeys();
        // A positive first, so the exclusions below are a measurement rather
        // than an empty set agreeing with everything.
        expect(keys.length).toBeGreaterThan(30);
        for (const collection of ['objects', 'actions', 'hooks', 'jobs', 'data', 'translations',
            'datasources', 'datasourceMapping', 'permissions', 'positions', 'functions', 'requires']) {
            expect(keys, `${collection} is a package-owned collection`).toContain(collection);
        }
        // The seven envelope keys an option-B artifact still carries at its top
        // level. `packages` most of all: an artifact carries packages, a package
        // inside it does not (ADR-0130 D1).
        for (const envelope of ['manifest', 'packages', 'api', 'server', 'i18n', 'runtimeModule', 'onEnable']) {
            expect(keys, `${envelope} is an envelope key`).not.toContain(envelope);
        }
    });
});

describe('resolveArtifactCollections', () => {
    it('returns the ARGUMENT ITSELF for anything without `packages[]`', () => {
        // The D7 branch: every single-package artifact and every `defineStack()`
        // config the platform has ever booted takes it, and identity is the only
        // way to say "this cannot have moved" rather than to hope so.
        const single = { manifest: { id: 'a', name: 'A' }, objects: [obj('o')] };
        expect(resolveArtifactCollections(single)).toBe(single);
        expect(resolveArtifactCollections(null)).toBe(null);
        expect(resolveArtifactCollections(undefined)).toBe(undefined);
        expect(resolveArtifactCollections('not an object')).toBe('not an object');
        // `packages` present but not an array is not a shape this walks; the
        // artifact's own loader refuses it.
        const odd = { packages: 'nope', objects: [obj('o')] };
        expect(resolveArtifactCollections(odd)).toBe(odd);
    });

    it('leaves TODAY\'s additive artifact untouched — same arrays, same order, same references', () => {
        const coreObject = obj('account');
        const ordersObject = obj('order');
        const objects = [coreObject, ordersObject];
        const rules = [{ datasource: 'primary', default: true }];
        const additive = {
            manifest: { id: 'com.example.core', name: 'Core' },
            objects,
            datasourceMapping: rules,
            packages: packagesOf({ objects: [coreObject], datasourceMapping: rules }, { objects: [ordersObject] }),
        };
        const resolved = resolveArtifactCollections(additive) as typeof additive;
        expect(resolved.objects).toBe(objects);
        expect(resolved.datasourceMapping).toBe(rules);
        expect(resolved).toBe(additive);
    });

    it('claims a top-level copy STRUCTURALLY, so a JSON round-trip does not double it', () => {
        // The compiled path: `packages[]` and the top level carry equal values
        // that are no longer the same objects. Reference de-duplication alone
        // would register every collection twice on every multi-package artifact
        // the platform ships today.
        const additive = {
            translations: [{ en: { objects: { account: { label: 'Account' } } } }],
            requires: ['platform'],
            packages: packagesOf({
                translations: [{ en: { objects: { account: { label: 'Account' } } } }],
                requires: ['platform'],
            }),
        };
        const roundTripped = JSON.parse(JSON.stringify(additive));
        const resolved = resolveArtifactCollections(roundTripped) as typeof additive;
        expect(resolved.translations).toHaveLength(1);
        expect(resolved.requires).toEqual(['platform']);
    });

    it('claims by NAME too, so a merged top-level object is not joined by its unmerged halves', () => {
        // `objects` is the one collection `composeStacks` MERGES rather than
        // concatenates, so the top-level entry and the two package bodies that
        // produced it do not serialize alike. Deduplicating structurally alone
        // would hand the reader three `account` objects.
        const merged = obj('account', { a: { name: 'a', type: 'text', label: 'A' }, b: { name: 'b', type: 'text', label: 'B' } });
        const additive = {
            objects: [merged],
            packages: packagesOf(
                { objects: [obj('account', { a: { name: 'a', type: 'text', label: 'A' } })] },
                { objects: [obj('account', { b: { name: 'b', type: 'text', label: 'B' } })] },
            ),
        };
        const resolved = resolveArtifactCollections(additive) as typeof additive;
        expect(resolved.objects).toEqual([merged]);
    });

    it('reads an option-B artifact out of `packages[]`, in package order', () => {
        const optionB = {
            manifest: { id: 'com.example.core', name: 'Core' },
            packages: packagesOf(
                { objects: [obj('account')], permissions: [{ name: 'default_profile', label: 'Default', isDefault: true, objects: {} }] },
                { objects: [obj('order')], actions: [{ name: 'ship', label: 'Ship', type: 'script', body: { language: 'js', source: 'return 1;' } }] },
            ),
        };
        const resolved = resolveArtifactCollections(optionB) as Record<string, any>;
        // `core` first — `resolveArtifactPackageOrder` sorts topologically, and
        // `orders` DEPENDS on it, so this is not the array's own order. ⛔ The
        // order is that function's; nothing here re-derives it.
        expect(resolved.objects.map((o: any) => o.name)).toEqual(['account', 'order']);
        expect(resolved.actions.map((a: any) => a.name)).toEqual(['ship']);
        expect(resolved.permissions).toEqual([{ name: 'default_profile', label: 'Default', isDefault: true, objects: {} }]);
        // Envelope keys are the caller's own references, untouched.
        expect(resolved.manifest).toBe(optionB.manifest);
        expect(resolved.packages).toBe(optionB.packages);
    });

    it('keeps BOTH same-named package bodies when nothing merged them', () => {
        // The other half of the name rule: on an option-B artifact a base and
        // its extension are two entries of one name and no top level claimed
        // either. Deduplicating by name here would drop the extension.
        const optionB = {
            packages: packagesOf(
                { objects: [obj('account', { a: { name: 'a', type: 'text', label: 'A' } })] },
                { objects: [obj('account', { b: { name: 'b', type: 'text', label: 'B' } })] },
            ),
        };
        const resolved = resolveArtifactCollections(optionB) as Record<string, any>;
        expect(resolved.objects).toEqual([
            obj('account', { a: { name: 'a', type: 'text', label: 'A' } }),
            obj('account', { b: { name: 'b', type: 'text', label: 'B' } }),
        ]);
    });

    it('resolves a PARTIALLY flattened artifact per item, not per artifact', () => {
        // The transition state: one package's collections are flattened, the
        // other's are not. "Use the top level when present, else `packages[]`"
        // answers this one wrongly and silently.
        const partial = {
            objects: [obj('account')],
            packages: packagesOf({ objects: [obj('account')] }, { objects: [obj('order')] }),
        };
        const resolved = resolveArtifactCollections(partial) as Record<string, any>;
        expect(resolved.objects.map((o: any) => o.name)).toEqual(['account', 'order']);
    });

    it('merges the RECORD spelling of a collection, top level winning', () => {
        // `functions` is a map, and `datasources` is legitimately either shape.
        const artifact = {
            functions: { fromTop: () => 'top' },
            packages: packagesOf({ functions: { fromCore: 'coreRef' } }, { functions: { fromTop: 'shadowed' } }),
        };
        const resolved = resolveArtifactCollections(artifact) as Record<string, any>;
        expect(Object.keys(resolved.functions).sort()).toEqual(['fromCore', 'fromTop']);
        expect(typeof resolved.functions.fromTop).toBe('function');
    });

    it('leaves a key NO source declares ABSENT, never `[]`', () => {
        const optionB = { packages: packagesOf({ objects: [obj('account')] }) };
        const resolved = resolveArtifactCollections(optionB) as Record<string, unknown>;
        expect('objects' in resolved).toBe(true);
        expect('permissions' in resolved).toBe(false);
        expect('jobs' in resolved).toBe(false);
    });

    it('raises the load path\'s OWN refusal for a malformed `packages[]`', () => {
        // ADR-0112 envelope, from `resolveArtifactPackageOrder` — the same
        // refusal `ObjectQLPlugin`'s `manifest` service raises on these bytes.
        // Resolving collections out of an artifact the loader would refuse is
        // not a quieter outcome, it is a different answer to what it contains.
        let raised: any;
        try {
            resolveArtifactCollections({ packages: [{ id: 'inlined-not-wrapped' }] });
        } catch (err) {
            raised = err;
        }
        expect(raised?.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
        expect(raised?.status).toBe(422);
    });
});
