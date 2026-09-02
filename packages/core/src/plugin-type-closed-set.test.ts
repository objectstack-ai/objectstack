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
// here: `@objectstack/core` has no `typecheck` script (type-check DEBT ledger
// entry), so a `@ts-expect-error` in this package is a phantom pin no tsc
// program a `typecheck` script runs would ever evaluate —
// `check:type-check-coverage` refuses exactly that. The rest package's
// `tsconfig.test.json` program is compiled by its `typecheck` script and reads
// core's BUILT `.d.ts`, so the pin over there guards the published contract.

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

    it('every union member parses through PluginSchema', () => {
        for (const type of UNION_MEMBERS) {
            const result = PluginSchema.safeParse({ type });
            expect(result.success, `PluginSchema refused union member '${type}'`).toBe(true);
        }
    });

    it('a non-member is refused by PluginSchema with invalid_value at ["type"]', () => {
        // `'plugin'` / `'module'` are PACKAGE manifest types (ManifestSchema.type),
        // never plugin types; `'ui-plugin'` is the spelling a stale describe()
        // string still uses; the casing variant guards against a lax comparator.
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
