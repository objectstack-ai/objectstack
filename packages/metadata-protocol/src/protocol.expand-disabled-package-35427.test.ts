// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An enabled object's lookup into a DISABLED package's object gets the answer
 * the data route gives that object: nothing of it is served.
 *
 * A disable takes a package's records off the data plane: `GET /data/:object`
 * answers `404 OBJECT_PACKAGE_DISABLED`. The two hops that read a related
 * object through an enabled object's lookup asked only the target's declared
 * API exposure, so `$expand` handed the engine the disabled object's full row
 * and a nested-relation condition answered yes/no on its fields.
 *
 * What these pins hold:
 *
 *   - `$expand` (comma list and POST map, any level) withholds an entry
 *     whose target belongs to a disabled package, as it withholds an
 *     unexposed target: the field keeps its stored id. The by-id read's
 *     `expand` asks the same `servedExpand`; it is measured on a real stack,
 *     not re-pinned here (a by-id double would need its own engine-double
 *     ledger row);
 *   - a nested-relation condition on such a target is refused with the data
 *     route's own envelope, `404 OBJECT_PACKAGE_DISABLED`, naming the target
 *     and the position, before the engine reads anything;
 *   - CONTROLS: the same package re-enabled serves both again, an
 *     `apiEnabled: false` target keeps today's answer, and a registry that
 *     cannot answer the question hides nothing.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
// `protocol.ts` reaches `@objectstack/lint` through a dynamic import; loaded
// here at module scope so the first load lands during collection, not inside a
// clocked window (`pnpm check:test-source-alias`).
import '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';

const lookup = (name: string, reference: string) => ({ name, label: name, type: 'lookup', reference });

const object = (name: string, enable?: Record<string, unknown>, extra: Record<string, unknown> = {}): ServiceObject => ({
    name,
    label: name,
    ...(enable ? { enable } : {}),
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        ...extra,
    },
} as unknown as ServiceObject);

const SCHEMAS: Record<string, unknown> = {
    // The enabled package's object, with a lookup into the disabled package's.
    dp_source: object('dp_source', undefined, {
        beta: lookup('beta', 'dp_beta'),
        open: lookup('open', 'dp_open'),
        hidden: lookup('hidden', 'dp_hidden'),
    }),
    // The object the disable takes offline.
    dp_beta: object('dp_beta', undefined, { secret_note: { name: 'secret_note', label: 'Note', type: 'text' } }),
    // Enabled and exposed, with a lookup into the disabled one a hop further on.
    dp_open: object('dp_open', undefined, { inner: lookup('inner', 'dp_beta') }),
    // CONTROL: switched off by its own exposure, not by a package disable.
    dp_hidden: object('dp_hidden', { apiEnabled: false }),
};

function makeProtocol(opts: { disabled: Set<string>; registryAnswers?: boolean }) {
    const find = vi.fn(async (_object: string, _o: any) => [{ id: 's1', name: 'source' }]);
    const count = vi.fn(async () => 1);
    const registry: Record<string, unknown> = { getObject: (n: string) => SCHEMAS[n] };
    if (opts.registryAnswers !== false) {
        registry.isObjectPackageDisabled = (n: string) => opts.disabled.has(n);
    }
    const engine: any = { registry, find, count };
    return { p: new ObjectStackProtocolImplementation(engine), find };
}

const DISABLED = new Set(['dp_beta']);
const ENABLED = new Set<string>();
const MEMBER = { userId: 'dp_member' };
const SYSTEM = { isSystem: true };

async function expandHandedToFind(disabled: Set<string>, query: Record<string, unknown>, context: unknown = SYSTEM): Promise<unknown> {
    const { p, find } = makeProtocol({ disabled });
    await p.findData({ object: 'dp_source', query, context } as any);
    expect(find).toHaveBeenCalledTimes(1);
    return (find.mock.calls[0]![1] as { expand?: unknown }).expand;
}

describe('[#35427] $expand withholds a target that belongs to a disabled package', () => {
    it('THE PIN: the list comma spelling hands the engine no expansion of it', async () => {
        expect(await expandHandedToFind(DISABLED, { $expand: 'beta' })).toBeUndefined();
        expect(await expandHandedToFind(DISABLED, { $expand: 'beta' }, MEMBER)).toBeUndefined();
    });

    it('the POST relation map drops it beside a served entry that is kept', async () => {
        const expand = await expandHandedToFind(DISABLED, { expand: { beta: { object: 'beta', fields: ['secret_note'] }, open: { object: 'open' } } });
        expect(expand).toEqual({ open: { object: 'open' } });
    });

    it('a second-level entry into it is withheld, its enabled parent kept', async () => {
        const expand = await expandHandedToFind(DISABLED, { expand: { open: { object: 'open', expand: { inner: { object: 'inner' } } } } });
        expect(expand).toEqual({ open: { object: 'open' } });
    });

    it('CONTROL: the same package re-enabled is expanded again', async () => {
        expect(await expandHandedToFind(ENABLED, { $expand: 'beta' })).toEqual({ beta: { object: 'beta' } });
    });

    it('CONTROL: an apiEnabled:false target keeps today\'s answer (withheld) with no package disabled', async () => {
        expect(await expandHandedToFind(ENABLED, { $expand: 'hidden' })).toBeUndefined();
    });

    it('CONTROL: a registry that cannot answer the question hides nothing', async () => {
        const { p, find } = makeProtocol({ disabled: DISABLED, registryAnswers: false });
        await p.findData({ object: 'dp_source', query: { $expand: 'beta' }, context: SYSTEM } as any);
        expect((find.mock.calls[0]![1] as { expand?: unknown }).expand).toEqual({ beta: { object: 'beta' } });
    });
});

describe('[#35427] a nested-relation condition on a disabled package\'s object is refused', () => {
    for (const context of [MEMBER, SYSTEM]) {
        it(`THE PIN: 404 OBJECT_PACKAGE_DISABLED on the POST where and the list filter, nothing read (${JSON.stringify(context)})`, async () => {
            const { p, find } = makeProtocol({ disabled: DISABLED });
            for (const [query, param] of [
                [{ where: { beta: { secret_note: 'x' } } }, 'filter.beta'],
                [{ $filter: JSON.stringify({ name: 'source', $or: [{ beta: { secret_note: 'x' } }] }) }, 'filter.beta'],
            ] as const) {
                const err: any = await p.findData({ object: 'dp_source', query, context } as any).catch((e) => e);
                expect(err).toBeInstanceOf(Error);
                expect({ code: err.code, status: err.status, object: err.object }).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: 'dp_beta' });
                expect(String(err.param)).toContain(param);
            }
            expect(find).not.toHaveBeenCalled();
        });
    }

    it('a condition one hop further on, in an expand entry\'s own filter, is refused the same way', async () => {
        const { p, find } = makeProtocol({ disabled: DISABLED });
        const err: any = await p
            .findData({ object: 'dp_source', query: { expand: { open: { object: 'open', where: { inner: { secret_note: 'x' } } } } }, context: SYSTEM } as any)
            .catch((e) => e);
        expect({ code: err.code, status: err.status, object: err.object }).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: 'dp_beta' });
        expect(find).not.toHaveBeenCalled();
    });

    it('CONTROL: the same package re-enabled, the condition reaches the engine unchanged', async () => {
        const { p, find } = makeProtocol({ disabled: ENABLED });
        await p.findData({ object: 'dp_source', query: { where: { beta: { secret_note: 'x' } } }, context: SYSTEM } as any);
        expect(find).toHaveBeenCalledTimes(1);
        expect((find.mock.calls[0] as any[])[1].where).toEqual({ beta: { secret_note: 'x' } });
    });

    it('CONTROL: an apiEnabled:false target keeps OBJECT_API_DISABLED', async () => {
        const { p } = makeProtocol({ disabled: ENABLED });
        const err: any = await p.findData({ object: 'dp_source', query: { where: { hidden: { name: 'x' } } }, context: SYSTEM } as any).catch((e) => e);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
    });

    it('CONTROL: a plain id comparand on the same lookup is the source\'s own column and is served', async () => {
        const { p, find } = makeProtocol({ disabled: DISABLED });
        await p.findData({ object: 'dp_source', query: { where: { beta: 'b1' } }, context: SYSTEM } as any);
        expect(find).toHaveBeenCalledTimes(1);
    });
});
