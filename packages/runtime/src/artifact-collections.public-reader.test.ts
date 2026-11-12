// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resolveArtifactCollections` as PUBLIC surface (#32827) — pinned from the
 * consumer's side.
 *
 * The consumer: an app suite of one `app` package and several `module`
 * packages wants ONE view of every collection of the suite (a test helper, a
 * lint pass). It used to get that from a flat `composeStacks(packageStacks)`;
 * a flat composition puts every package's app under one package id, which
 * `composeStacks` refuses for a suite (`STACK_SINGLE_APP_VIOLATION`, ADR-0019
 * D3 as amended). The shape-correct composition is `manifest: 'preserve'`,
 * which keeps each collection in its package's body and no flattened copy
 * (ADR-0130 D4), and reading every collection out of that is this reader.
 *
 * So the pin is: `resolveArtifactCollections(composeStacks(stacks, { manifest:
 * 'preserve' }))`, with the reader imported from the PACKAGE ENTRY
 * (`./index`, which `dist/index.*` is built from) rather than its module,
 * yields every input's objects, apps, flows, translations and hooks with the
 * contents the flat composition gave.
 *
 * The flat baseline is taken WITHOUT the apps: a flat composition of the
 * app-less inputs is one package with no app, which the single-app rule
 * leaves alone, so this pin keeps reading the same baseline once that rule
 * ships. For `apps` the flat composition's answer is the inputs' apps
 * concatenated in input order — that is all it ever did with them — and that
 * is the expectation written here.
 */

import { describe, it, expect } from 'vitest';

import { composeStacks, defineStack } from '@objectstack/spec';

import * as runtimeEntry from './index';
import { resolveArtifactCollections as moduleReader } from './artifact-collections';

const { resolveArtifactCollections } = runtimeEntry;

type Raw = Record<string, unknown>;

/** One package of the suite, every collection the consumer reads declared. */
function pkg(id: string, type: 'app' | 'module', slug: string, withApps = true): Raw {
    return {
        manifest: { id, name: slug, version: '1.0.0', type },
        objects: [{ name: `${slug}_record`, label: `${slug} record`, fields: { title: { type: 'text', label: 'Title' } } }],
        ...(withApps ? { apps: [{ name: `${slug}_app`, label: `${slug} app` }] } : {}),
        flows: [{ name: `${slug}_flow`, label: `${slug} flow`, type: 'autolaunched', nodes: [], edges: [] }],
        translations: [{ en: { objects: { [`${slug}_record`]: { label: `${slug} record` } } } }],
        hooks: [{ name: `${slug}_hook`, object: `${slug}_record`, events: ['beforeInsert'], handler: `${slug}_stamp` }],
    };
}

/** The suite: two module packages and the app package that surfaces them. */
function suite(withApps = true): Raw[] {
    return [
        pkg('com.example.sales', 'module', 'sales', withApps),
        pkg('com.example.service', 'module', 'service', withApps),
        pkg('com.example.suite', 'app', 'suite', withApps),
    ];
}

const define = (raw: Raw) => defineStack(raw as never, { strict: false });

const COLLECTIONS = ['objects', 'apps', 'flows', 'translations', 'hooks'] as const;

describe('resolveArtifactCollections — the public reader of a composed suite (#32827)', () => {
    it('is exported from the package entry, and it is the module\'s own reader, not a second copy of the merge', () => {
        expect(typeof resolveArtifactCollections).toBe('function');
        expect(resolveArtifactCollections).toBe(moduleReader);
    });

    it('reads every input\'s collections out of a `manifest: \'preserve\'` composition, with the contents a flat composition gave', () => {
        const preserved = composeStacks(suite().map(define), { manifest: 'preserve' } as never) as Raw;

        // Anti-vacuity: the preserve artifact carries the collections in its
        // package bodies only, so a reader that skipped `packages[]` would
        // answer nothing at all for them.
        expect(Array.isArray(preserved.packages)).toBe(true);
        expect((preserved.packages as unknown[]).length).toBe(3);
        for (const key of COLLECTIONS) expect(preserved[key], key).toBeUndefined();

        const read = resolveArtifactCollections(preserved) as Record<string, any[]>;

        // The flat baseline, taken where the single-app rule leaves it alone
        // (see the header): the same inputs without their apps.
        const flat = composeStacks(suite(false).map(define)) as Record<string, any[]>;
        const byName = (entries: any[] | undefined) => [...(entries ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));

        for (const key of ['objects', 'flows', 'hooks'] as const) {
            expect(byName(read[key]), key).toEqual(byName(flat[key]));
        }
        expect(read.translations).toEqual(flat.translations);

        // Every input is answered, by name — so an equal-but-empty pair above
        // cannot pass.
        expect(read.objects.map((o) => o.name).sort()).toEqual(['sales_record', 'service_record', 'suite_record']);
        expect(read.flows.map((f) => f.name).sort()).toEqual(['sales_flow', 'service_flow', 'suite_flow']);
        expect(read.hooks.map((h) => h.name).sort()).toEqual(['sales_hook', 'service_hook', 'suite_hook']);
        expect(read.translations).toHaveLength(3);

        // `apps`: every input's app, each the entry its own stack declared —
        // what a flat composition did with them (concatenation), read here
        // while each app stays under its own package id.
        const declaredApps = suite().map(define).flatMap((stack) => (stack as Raw).apps as any[]);
        expect(byName(read.apps)).toEqual(byName(declaredApps));
        expect(read.apps.map((a) => a.name).sort()).toEqual(['sales_app', 'service_app', 'suite_app']);
    });
});
