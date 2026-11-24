// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36887 — the published wire schema of `GET /meta/types`
 * (`GetMetaTypesResponseSchema`) declares every member `getMetaTypes()`
 * serves on an entry.
 *
 * A real answer, sent through JSON as the wire sends it, is parsed with the
 * schema. `z.object` strips a key it does not declare, so "every served key
 * survives the parse" is the strict reading: a member the server sends and the
 * schema omits shows up as a missing key. Both arms of the listing are read —
 * registry types and a plugin type with no registry entry — and a type with a
 * plugin-registered action, so `actions` is on the wire.
 *
 * Controls: the same check reports a served key the schema does not declare,
 * and a malformed `form` is refused, so neither pin passes vacuously.
 */
import { describe, expect, it } from 'vitest';
// `./protocol.js` reaches `import('@objectstack/lint')`; pay its first load at
// collection, never inside a clocked case.
import '@objectstack/lint';
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
    type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY, registerMetadataTypeActions } from '@objectstack/spec/kernel';
import { GetMetaTypesResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** Every registry type, plus `webhook`: a plugin kind with no registry entry, served by the synthesised arm. */
const SERVED_TYPES = [...new Set(DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type)), 'webhook'];

function makeProtocol() {
    const engine: any = {
        async findOne(object: string, query?: EngineFindOneQueryInput) {
            assertEngineFindOnePredicate(object, query); return null;
        },
        async find() { return []; },
        async insert() { return { id: 'unused' }; },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        registry: {
            getRegisteredTypes: () => [...SERVED_TYPES],
            registerItem: () => {},
            registerObject: () => {},
            unregisterItem: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    return new ObjectStackProtocolImplementation(engine, () => new Map(), undefined) as any;
}

registerMetadataTypeActions('datasource', [
    {
        name: 'test_connection',
        label: 'Test connection',
        type: 'api',
        target: '/api/v1/datasources/${ctx.recordId}/test',
    } as any,
]);

/** The answer as a client receives it: through JSON, so an `undefined` member is absent. */
async function wireAnswer(): Promise<any> {
    return JSON.parse(JSON.stringify(await makeProtocol().getMetaTypes()));
}

/** `type.key` for every member a served entry carries and the parsed entry lost. */
function undeclaredMembers(wire: any, parsed: any): string[] {
    const lost: string[] = [];
    wire.entries.forEach((entry: any, i: number) => {
        for (const key of Object.keys(entry)) {
            if (!Object.prototype.hasOwnProperty.call(parsed.entries[i], key)) lost.push(`${entry.type}.${key}`);
        }
    });
    return lost;
}

describe('GetMetaTypesResponseSchema declares what GET /meta/types serves (objectstack#36887)', () => {
    it('a real answer parses, and no served member is stripped', async () => {
        const wire = await wireAnswer();
        const result = GetMetaTypesResponseSchema.safeParse(wire);
        expect(result.success, JSON.stringify(result.error?.issues?.slice(0, 3))).toBe(true);
        expect(undeclaredMembers(wire, result.data)).toEqual([]);
    });

    it('the members the card names are on the wire, so the parse above read them', async () => {
        const { entries } = await wireAnswer();
        const byType = new Map<string, any>(entries.map((e: any) => [e.type, e]));
        expect(byType.get('webhook'), 'the synthesised arm is served').toBeDefined();
        expect(entries.every((e: any) => e.schemaId === e.type)).toBe(true);
        expect(entries.filter((e: any) => e.schema !== undefined).length).toBeGreaterThan(0);
        expect(byType.get('hook').form.sections.length).toBeGreaterThan(0);
        expect(byType.get('hook').list.columns.length).toBeGreaterThan(0);
        expect(byType.get('datasource').actions.map((a: any) => a.name)).toContain('test_connection');
    });

    it('control — a served member the schema does not declare is reported', async () => {
        const wire = await wireAnswer();
        wire.entries[0].notDeclared = true;
        const parsed = GetMetaTypesResponseSchema.parse(wire);
        expect(undeclaredMembers(wire, parsed)).toEqual([`${wire.entries[0].type}.notDeclared`]);
    });

    it('control — a malformed form is refused, so `form` is typed, not `unknown`', async () => {
        const wire = await wireAnswer();
        const hook = wire.entries.find((e: any) => e.type === 'hook');
        hook.form = { ...hook.form, sections: 'not a list' };
        expect(GetMetaTypesResponseSchema.safeParse(wire).success).toBe(false);
    });
});
