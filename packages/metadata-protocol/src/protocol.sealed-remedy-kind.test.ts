// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22591] The sealed-item refusal's REMEDY follows what the caller did — the
 * family close-out after #20819 (flow) and #20910 (action, permission), which
 * each fixed one type's sentence for an edit.
 *
 * One refusal answers two different acts on a name a managed package or a
 * built-in holds, and each act has its own remedy KIND:
 *
 *  - an EDIT of the item under the name (`save`) is told where that item can
 *    change — its regime row's sanctioned path or source, or, with no row, its
 *    source artifact;
 *  - a CREATE of an item of the caller's own under the name, or a rename into
 *    it (`create`), is told to choose a name no package or built-in holds.
 *
 * THE ENUMERATION PIN iterates every type the refusal can reach — read from the
 * registry, plus a type no static entry declares (a plugin-registered type) —
 * for both acts, and asserts the remedy KIND, never the wording. A type added to
 * the registry later is iterated the day it lands, so its create cannot keep the
 * edit remedy unnoticed. The kind is read off what the sentence POINTS AT: the
 * row's own routes and source (read from the table, never transcribed), the
 * source/redeploy remedy, or the type's listing route.
 *
 * The control half: the verdict does not move — the same code and status on
 * every row, and a create is refused exactly where a save is, on every type.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { PACKAGED_BASE_REGIME } from './packaged-base-regime.js';

const PACKAGE_ID = 'com.example.pkg';
const HELD = 'pkg_held';
const FREE = 'my_own';

/** A type no static registry entry declares: a plugin-registered type, sealed like any other. */
const PLUGIN_TYPE = 'p22591_widget';

const shipped = (name: string) => ({ name, label: name, _packageId: PACKAGE_ID, _provenance: 'package' });

/**
 * A registry double that serves one packaged item, `HELD`, under EVERY type —
 * what the real `SchemaRegistry.getArtifactItem` returns for an artifact a code
 * package registered. `@objectstack/objectql` cannot be imported here: it
 * depends on this package.
 */
function protocolOn(environmentId: string | undefined): ObjectStackProtocolImplementation {
    const registry = {
        getArtifactItem: (_type: string, name: string) => (name === HELD ? shipped(name) : undefined),
        getRegisteredTypes: () => [...DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type), PLUGIN_TYPE],
    };
    return new ObjectStackProtocolImplementation({ registry } as never, () => new Map(), environmentId);
}

const shape = (e: any) => (e ? { code: e.code, status: e.status } : null);

/** Every type the iteration covers: the whole registry, and a plugin-registered type. */
const TYPES = [...DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type), PLUGIN_TYPE];

/** The type's listing route — where the names in use are read. A create's remedy points here. */
const listingOf = (type: string) => `GET /api/v1/meta/${type}`;

/**
 * What an EDIT remedy points at for `type`: the routes or the source its regime
 * row names (read from the row), and the source/redeploy remedy every row-less
 * type reads. None of these acts on an item of the caller's own.
 */
function editSigns(type: string): Array<string | RegExp> {
    const row = PACKAGED_BASE_REGIME[type];
    const fromRow: string[] = row === undefined
        ? []
        : row.regime === 'C'
            ? Object.values(row.routes).filter((route): route is string => typeof route === 'string')
            : [row.source, ...Object.values(row.hostOwned ?? {})];
    return [...fromRow, /\bredeploy\b/, /\bsource\b/];
}

type RemedyKind = 'new-name' | 'edit' | 'both' | 'none';

/** The remedy KIND a sentence names for `type` — read off what it points at, not off its wording. */
function remedyKind(message: string, type: string): RemedyKind {
    const newName = message.includes(listingOf(type));
    const edit = editSigns(type).some((sign) => (typeof sign === 'string' ? message.includes(sign) : sign.test(message)));
    if (newName && edit) return 'both';
    if (newName) return 'new-name';
    return edit ? 'edit' : 'none';
}

describe('[#22591] the sealed-item refusal names the remedy the caller\'s ACT has — every reachable type, edit and create', () => {
    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';

        it(`the iteration reaches every type with no overlay channel, and a plugin-registered type (${kernel} kernel)`, () => {
            const p = protocolOn(environmentId);
            const reached = TYPES.filter((type) => p.packagedBaseRefusal({ type, name: HELD, operation: 'save' }) !== null);
            // Measured against the registry's own flag, never a transcribed list:
            // a type is sealed exactly when its entry opens no overlay channel.
            const expected = [
                ...DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => !e.allowOrgOverride).map((e) => e.type),
                PLUGIN_TYPE,
            ];
            expect(reached.sort()).toEqual(expected.sort());
            // Every regime row is on a type the refusal reaches — a row on an
            // unreachable type would be a sentence no door can serve.
            for (const type of Object.keys(PACKAGED_BASE_REGIME)) expect(reached, type).toContain(type);
            // A floor, so an iteration that silently shrank cannot read green.
            expect(reached.length).toBeGreaterThanOrEqual(20);
        });

        it(`an EDIT names the edit remedy, and a CREATE names a name no package or built-in holds — on every reachable type (${kernel} kernel)`, () => {
            const p = protocolOn(environmentId);
            const kinds: Record<string, { edit: RemedyKind; create: RemedyKind }> = {};
            for (const type of TYPES) {
                const edit: any = p.packagedBaseRefusal({ type, name: HELD, operation: 'save' });
                if (edit === null) continue;
                const create: any = p.packagedBaseRefusal({ type, name: HELD, operation: 'create' });
                kinds[type] = { edit: remedyKind(String(edit.message), type), create: remedyKind(String(create?.message), type) };
            }
            const expected = Object.fromEntries(Object.keys(kinds).map((type) => [type, { edit: 'edit', create: 'new-name' }]));
            expect(kinds).toEqual(expected);
        });

        it(`control: the verdict does not move — a create is refused exactly where a save is, with the same code and status (${kernel} kernel)`, () => {
            const p = protocolOn(environmentId);
            for (const type of TYPES) {
                const save = shape(p.packagedBaseRefusal({ type, name: HELD, operation: 'save' }));
                const create = shape(p.packagedBaseRefusal({ type, name: HELD, operation: 'create' }));
                expect(create, type).toEqual(save);
                if (save !== null) expect(save, type).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
                // A name nothing holds is no question for this verdict, either act.
                expect(p.packagedBaseRefusal({ type, name: FREE, operation: 'create' }), type).toBeNull();
            }
        });
    }

    it('a create\'s sentence points at nothing that acts on the held item — no hatch, no clone, no switch — and arrives whole through the REST door', () => {
        // `truncateClientMessage` (packages/rest/src/error-response.ts) keeps a
        // message only while it is SHORTER than 500 characters; past that the
        // tail is cut. An 88-character name on every type, the bound the
        // edit sentences are held to.
        const longName = `pkg_${'x'.repeat(84)}`;
        expect(longName).toHaveLength(88);
        const registry = { getArtifactItem: (_t: string, name: string) => (name === longName ? shipped(name) : undefined) };
        const p = new ObjectStackProtocolImplementation({ registry } as never, () => new Map(), 'env_1');
        for (const type of TYPES) {
            const refusal: any = p.packagedBaseRefusal({ type, name: longName, operation: 'create' });
            if (refusal === null) continue;
            const message = String(refusal.message);
            expect(message.length, type).toBeLessThan(500);
            expect(message, type).toContain(listingOf(type));
            expect(message, type).not.toContain('OS_METADATA_WRITABLE');
            expect(message.toLowerCase(), type).not.toMatch(/clone it|switch it off/);
            expect(message.endsWith('.md.'), type).toBe(true);
        }
    });

    it('a removal is no create: it keeps its own sentence, which names no new name', () => {
        const p = protocolOn('env_1');
        for (const type of TYPES) {
            const removal: any = p.packagedBaseRefusal({ type, name: HELD, operation: 'delete' });
            if (removal === null) continue;
            expect(String(removal.message), type).not.toContain(listingOf(type));
        }
    });
});

/**
 * The `/meta` save door says which act a save is from the one fact its caller
 * sends about the name: a present `null` parent (`If-None-Match: *` on the REST
 * door) is the first-write pin — the caller holds no row under the name and is
 * writing one of its own, a create. Every other save is an edit, as before.
 * Pinned on a row-less type (`position`, the card's own) and on a Regime C type
 * (`flow`, which the flow authoring rule answers before the package door).
 */
describe('[#22591] the /meta save door reads its first-write pin as a create', () => {
    const thrownBy = (run: Promise<unknown>) => run.then(() => undefined, (e: any) => e);

    for (const type of ['position', 'flow'] as const) {
        it(`\`${type}\`: a first-write save names a free name; an unpinned or pinned save keeps the edit remedy — same code and status`, async () => {
            const p = protocolOn('env_1');
            const item = { name: HELD, label: 'Mine' };
            const first: any = await thrownBy(p.saveMetaItem({ type, name: HELD, item, parentVersion: null }));
            const unpinned: any = await thrownBy(p.saveMetaItem({ type, name: HELD, item }));
            const pinned: any = await thrownBy(p.saveMetaItem({ type, name: HELD, item, parentVersion: 'v1' }));
            for (const refusal of [first, unpinned, pinned]) expect(shape(refusal)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expect(remedyKind(String(first.message), type)).toBe('new-name');
            expect(remedyKind(String(unpinned.message), type)).toBe('edit');
            expect(remedyKind(String(pinned.message), type)).toBe('edit');
            // One emitter: the door's first write throws the verdict a create is handed.
            expect(first.message).toBe((p.packagedBaseRefusal({ type, name: HELD, operation: 'create' }) as any).message);
            expect(unpinned.message).toBe((p.packagedBaseRefusal({ type, name: HELD, operation: 'save' }) as any).message);
        });
    }
});
