// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// RUNTIME parity pin for the closed `Plugin.type` set (#13925).
//
// `Plugin.type` in `./types.ts` is a `PluginType` DERIVED from the spec's
// `CORE_PLUGIN_TYPES` constant (`'standard' | (typeof CORE_PLUGIN_TYPES)[number]`),
// and `PluginSchema.type` in `@objectstack/spec` is declared as
// `z.enum(['standard', ...CORE_PLUGIN_TYPES])`. Both sides read the same
// constant, so the one way they can still drift is the Zod enum's literal
// prefix changing shape (a member added to the enum but not to the constant,
// or `'standard'` renamed) — which is exactly what the first case below reads
// off the schema at runtime, member by member and in declared order.
//
// The COMPILE-TIME half — a non-member literal or a `string`-typed value no
// longer type-checks against the PUBLISHED `Plugin.type` — lives in
// `packages/rest/src/plugin-type-closed-set.pin.test.ts`, deliberately NOT
// here. The rest package's `tsconfig.test.json` program is compiled by its
// `typecheck` script and resolves `@objectstack/core` to core's BUILT
// `dist/index.d.ts`, so the pin over there guards the contract consumers
// actually resolve.
//
// ⚠️ This used to read as though the split were forced — that
// `@objectstack/core` "has no `typecheck` script (type-check DEBT ledger
// entry)", making a `@ts-expect-error` here a phantom pin
// `check:type-check-coverage` refuses. False on this tree: #14613 split a
// `tsconfig.test.json` out of the build config, `package.json`'s `typecheck`
// NAMES it (via `check:test-typecheck --project`), and this package holds no
// DEBT entry. A directive here WOULD be evaluated — against `./types.ts`,
// this package's own SOURCE. The published `.d.ts` is what those pins are
// about and only the rest program reads it, which is a reason that outlives
// any package's script list.

import { describe, it, expect } from 'vitest';
import { CORE_PLUGIN_TYPES, PluginSchema } from '@objectstack/spec/kernel';
import type { PluginType } from './types.js';

/**
 * The TypeScript union's members, spelled by the same derivation `PluginType`
 * uses. `satisfies` makes each entry a member of the union; the schema
 * comparison below makes the list COMPLETE against the Zod enum.
 */
const UNION_MEMBERS = ['standard', ...CORE_PLUGIN_TYPES] as const satisfies readonly PluginType[];

/**
 * Walks the wrapper chain `PluginSchema.shape.type` carries
 * (`optional` → `default` → `enum`, measured at 9c7d9d4b3) down to the enum's
 * declared options. Throws rather than returning `[]` when no enum is found,
 * so a re-shaped key cannot read as "zero members, all equal".
 */
function zodEnumOptions(schema: unknown): readonly string[] {
    let node = schema as { options?: readonly string[]; def?: { innerType?: unknown } } | undefined;
    while (node) {
        if (Array.isArray(node.options)) return node.options;
        node = node.def?.innerType as typeof node;
    }
    throw new Error('PluginSchema.shape.type carries no z.enum in its wrapper chain');
}

describe('Plugin.type closed set — runtime parity with the spec enum (#13925)', () => {
    it('the Zod enum enumerates exactly the TypeScript union, in declared order', () => {
        const options = zodEnumOptions(PluginSchema.shape.type);
        expect(options).toEqual([...UNION_MEMBERS]);
        // Positive control on the instrument: the list is populated and the
        // spec constant is the seven-member set the union is derived from.
        expect(options).toHaveLength(8);
        expect(CORE_PLUGIN_TYPES).toHaveLength(7);
    });

    /**
     * The minimal spec-legal object per member. `ui` alone owes more than its
     * `type`: `staticPath` and `slug` are required for it since #16334
     * (`plugin-ui-required-keys.test.ts` in spec pins that), so a bare
     * `{ type: 'ui' }` is refused at `['staticPath']` / `['slug']` — a reading
     * about those two keys, not about the enum this file pins. Every other
     * member is legal with its `type` alone, which the bare `{ type }` states.
     */
    function minimalLegal(type: PluginType): Record<string, unknown> {
        return type === 'ui' ? { type, staticPath: '/srv/ui/dist', slug: 'ui' } : { type };
    }

    it('every union member parses through PluginSchema', () => {
        for (const type of UNION_MEMBERS) {
            const result = PluginSchema.safeParse(minimalLegal(type));
            expect(result.success, `PluginSchema refused union member '${type}'`).toBe(true);
        }
    });

    it('a non-member is refused by PluginSchema with invalid_value at ["type"]', () => {
        // `'plugin'` / `'module'` are PACKAGE manifest types (ManifestSchema.type),
        // never plugin types; `'ui-plugin'` is the LEGACY spelling of today's
        // `'ui'` — once live, so callers outside this repo may still send it, and
        // the closed set must keep REFUSING it rather than grow a tolerant alias
        // (Prime Directive #12); the casing variant guards against a lax comparator.
        for (const type of ['bogus', 'ui-plugin', 'plugin', 'module', 'Standard']) {
            const result = PluginSchema.safeParse({ type });
            expect(result.success, `PluginSchema accepted non-member '${type}'`).toBe(false);
            if (!result.success) {
                expect(result.error.issues.map((i) => [i.code, i.path.join('.')])).toEqual([
                    ['invalid_value', 'type'],
                ]);
            }
        }
    });
});
