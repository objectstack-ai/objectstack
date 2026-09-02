// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// COMPILE-TIME pins for the closed `Plugin.type` set on the PUBLISHED surface
// of `@objectstack/core` (#13925): `type?: PluginType`, a union DERIVED from
// the spec's `CORE_PLUGIN_TYPES` (`'standard' | (typeof CORE_PLUGIN_TYPES)[number]`),
// replacing the `type?: string` that let any spelling through while the Zod
// gate (`PluginSchema.type`) refused it at parse.
//
// Why the pins live in THIS package: `@objectstack/core` has no `typecheck`
// script (it is a type-check DEBT ledger entry), so a `@ts-expect-error` there
// is a phantom pin — no tsc program a `typecheck` script runs ever evaluates
// it, and `check:type-check-coverage` refuses it. This package's
// `tsconfig.test.json` program IS run by its `typecheck` script
// (`check:test-typecheck`, EXACT per-file ratchet: an unlisted file must stay
// at zero errors), and it resolves `@objectstack/core` to the BUILT
// `dist/index.d.ts` — so these directives pin the contract consumers actually
// see. Same placement as `plugin-metadata-retired-fields.pin.test.ts`.
//
// Failure channel, proven able to fail by ablation on the narrowing PR:
// reverting `type?: PluginType` to `type?: string` (and rebuilding core's
// dist) turns each directive below into TS2578 "Unused '@ts-expect-error'
// directive", giving this file errors where the ratchet requires 0.
//
// Positive control: every member of the closed set still compiles with no
// directive, and the published union is type-level EQUAL to the spec-derived
// shape — proving the interface still accepts its real members, so the
// directives above are readings, not a broken instrument. The RUNTIME half
// (the Zod enum enumerates the same members) is
// `packages/core/src/plugin-type-closed-set.test.ts`.

import { describe, it, expect } from 'vitest';
import type { Plugin, PluginMetadata, PluginType } from '@objectstack/core';
import type { CORE_PLUGIN_TYPES } from '@objectstack/spec/kernel';

/** Strict type equality (no `any` leak, no one-sided assignability). */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

describe('Plugin.type closed set — published-surface pins (#13925)', () => {
    it('compile-time: a literal outside the set no longer type-checks', () => {
        const declared: Plugin = {
            name: 'closed-set-pin-literal',
            // @ts-expect-error — `'bogus'` is not a `PluginType` (#13925): the
            // set is closed at `'standard' | CORE_PLUGIN_TYPES[number]`.
            type: 'bogus',
            async init() {},
        };
        // The value exists at runtime (TS types are erased); the pin is the
        // directive above, enforced by this package's test-typecheck program.
        expect(declared.name).toBe('closed-set-pin-literal');
    });

    it('compile-time: a `string`-typed value no longer type-checks', () => {
        // Widened on purpose: `string`, not the literal — the case the old
        // `type?: string` admitted and the Zod gate could only catch at parse.
        const computed: string = ['u', 'i'].join('');
        const declared: Plugin = {
            name: 'closed-set-pin-computed',
            // @ts-expect-error — `string` is wider than `PluginType` (#13925);
            // narrow at the producer (declare the literal, or type it PluginType).
            type: computed,
            async init() {},
        };
        expect(declared.name).toBe('closed-set-pin-computed');
    });

    it('compile-time: the narrowing reaches PluginMetadata (extends Plugin)', () => {
        const declared: PluginMetadata = {
            name: 'closed-set-pin-metadata',
            version: '1.0.0',
            // @ts-expect-error — `'ui-plugin'` (a stale describe() spelling) is
            // not a `PluginType` (#13925).
            type: 'ui-plugin',
            async init() {},
        };
        expect(declared.name).toBe('closed-set-pin-metadata');
    });

    it('positive control: every member still type-checks with no directive, and the union equals the spec-derived shape', () => {
        const members = ['standard', 'ui', 'driver', 'server', 'app', 'theme', 'agent', 'objectql'] as const satisfies readonly PluginType[];
        const plugins: Plugin[] = members.map((type) => ({ name: `member-${type}`, type, async init() {} }));
        expect(plugins.map((p) => p.type)).toEqual([...members]);

        const parity: Equal<PluginType, 'standard' | (typeof CORE_PLUGIN_TYPES)[number]> = true;
        expect(parity).toBe(true);
        // Completeness in the other direction: a union member the literal list
        // above does not spell would make the Exclude non-never, and `true`
        // unassignable to it.
        const complete: Equal<Exclude<PluginType, (typeof members)[number]>, never> = true;
        expect(complete).toBe(true);
    });
});
