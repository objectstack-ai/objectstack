// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23577] A write over a sealed, package-held name reads ONE sentence, whatever
 * the write meant to do. It replaces [#22591]'s two remedies (a create was told
 * to choose another name, an edit to edit the source artifact and redeploy) and
 * [#23406]'s draft/publish split of them: the door cannot tell a create from an
 * edit, because the one fact it read as a create, the first-write pin
 * (`If-None-Match: *`), is also what the console sends for a first draft, and
 * each remedy was wrong for the other caller.
 *
 * The sentence states what the door knows and where the names are listed:
 * "'TYPE/NAME' is provided by a managed package and is sealed: it cannot be
 * written here. GET /api/v1/meta/TYPE lists the names in use." The wording is
 * the ruled text, so it is pinned whole for a type with no regime row. A type
 * with a regime row keeps its regime sentence (ADR-0126 §2: a Regime C refusal
 * names its sanctioned path; the origin-gated row names the source a
 * code-defined datasource is declared in).
 *
 * THE ENUMERATION iterates every type the refusal can reach — read from the
 * registry, plus a type no static entry declares (a plugin-registered type) — so
 * a type added later is held to the one sentence the day it lands.
 *
 * THE DOOR PINS send the requests that reach it: the console's generic create
 * over a held name (`mode: 'draft'` + `If-None-Match: *`), a publish-mode `*`,
 * and the unpinned and pinned saves. All read one sentence, with one code and
 * status. The control: an overlay type's first overlay write (`view`) is not
 * refused at all.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
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

/** The type's listing route — where the names in use are read. */
const listingOf = (type: string) => `GET /api/v1/meta/${type}`;

/** The ruled sentence, for a type with no regime row. */
const oneSentence = (type: string, name: string) =>
    `'${type}/${name}' is provided by a managed package and is sealed: it cannot be written here. `
    + `${listingOf(type)} lists the names in use.`;

/** Advice the door cannot give truthfully: a create's, and the source artifact's. */
const CREATE_ADVICE = /choose a name|name no package|author your own/i;
const SOURCE_ADVICE = /source artifact|redeploy/i;

describe('[#23577] every write over a sealed, package-held name reads one sentence — every reachable type', () => {
    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';

        it(`the iteration reaches every type with no overlay channel, and a plugin-registered type (${kernel} kernel)`, () => {
            const p = protocolOn(environmentId);
            const reached = TYPES.filter((type) => p.packagedBaseRefusal({ type, name: HELD, operation: 'save' }) !== null);
            // Measured against the registry's own flag, never a transcribed list:
            // a type is sealed exactly when its entry opens no overlay channel.
            const expected = [
                ...DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => !e.allowEnvironmentOverlay).map((e) => e.type),
                PLUGIN_TYPE,
            ];
            expect(reached.sort()).toEqual(expected.sort());
            for (const type of Object.keys(PACKAGED_BASE_REGIME)) expect(reached, type).toContain(type);
            // A floor, so an iteration that silently shrank cannot read green.
            expect(reached.length).toBeGreaterThanOrEqual(20);
        });

        it(`a row-less type reads the one sentence; no package-held item is told to create or to edit its source (${kernel} kernel)`, () => {
            const p = protocolOn(environmentId);
            let rowless = 0;
            for (const type of TYPES) {
                const refusal: any = p.packagedBaseRefusal({ type, name: HELD, operation: 'save' });
                if (refusal === null) continue;
                expect(shape(refusal), type).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
                const message = String(refusal.message);
                expect(message, type).not.toMatch(CREATE_ADVICE);
                const row = PACKAGED_BASE_REGIME[type];
                if (row === undefined) {
                    expect(message, type).toBe(oneSentence(type, HELD));
                    rowless += 1;
                } else if (row.regime === 'C') {
                    // ADR-0126 §2: the sanctioned path, read from the row.
                    for (const route of Object.values(row.routes)) if (route) expect(message, type).toContain(route);
                    expect(message, type).not.toMatch(SOURCE_ADVICE);
                } else {
                    // The origin-gated row: a code-defined datasource, whose one
                    // remedy is the source it is declared in.
                    expect(message, type).toContain(row.source);
                }
                // A name nothing holds is no question for this verdict.
                expect(p.packagedBaseRefusal({ type, name: FREE, operation: 'save' }), type).toBeNull();
            }
            expect(rowless).toBeGreaterThanOrEqual(15);
        });
    }

    it('the one sentence arrives whole through the REST door, and names neither the hatch nor a clone or switch', () => {
        // `truncateClientMessage` (packages/rest/src/error-response.ts) keeps a
        // message only while it is SHORTER than 500 characters. An 88-character
        // name on every type, the bound the regime sentences are held to.
        const longName = `pkg_${'x'.repeat(84)}`;
        expect(longName).toHaveLength(88);
        const registry = { getArtifactItem: (_t: string, name: string) => (name === longName ? shipped(name) : undefined) };
        const p = new ObjectStackProtocolImplementation({ registry } as never, () => new Map(), 'env_1');
        for (const type of TYPES) {
            if (PACKAGED_BASE_REGIME[type] !== undefined) continue;
            const refusal: any = p.packagedBaseRefusal({ type, name: longName, operation: 'save' });
            if (refusal === null) continue;
            const message = String(refusal.message);
            expect(message.length, type).toBeLessThan(500);
            expect(message, type).toBe(oneSentence(type, longName));
            expect(message, type).not.toContain('OS_METADATA_WRITABLE');
            expect(message.toLowerCase(), type).not.toMatch(/clone it|switch it off/);
        }
    });

    it('a removal is no write: it keeps its own sentence, which names no listing route', () => {
        const p = protocolOn('env_1');
        for (const type of TYPES) {
            const removal: any = p.packagedBaseRefusal({ type, name: HELD, operation: 'delete' });
            if (removal === null) continue;
            expect(String(removal.message), type).not.toContain(listingOf(type));
        }
    });
});

/**
 * The `/meta` save door: every request that reaches the seal reads the one
 * sentence, pinned or not, draft or publish. `position` is the console's
 * generic create (Setup positions); `object` is a row-less type with a draft
 * lifecycle; `flow` is a Regime C type, answered by the flow authoring rule
 * before the package door, and reads its one regime sentence for every request.
 */
describe('[#23577] the /meta save door reads every write over a held name the same way', () => {
    const thrownBy = (run: Promise<unknown>) => run.then(() => undefined, (e: any) => e);

    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';
        for (const type of ['position', 'object', 'flow'] as const) {
            it(`\`${type}\`: the console's create (draft + If-None-Match: *), a publish-mode *, and the unpinned and pinned saves read one sentence (${kernel} kernel)`, async () => {
                const p = protocolOn(environmentId);
                const item = { name: HELD, label: 'Mine' };
                const requests = {
                    consoleCreate: await thrownBy(p.saveMetaItem({ type, name: HELD, item, parentVersion: null, mode: 'draft' })),
                    publishPin: await thrownBy(p.saveMetaItem({ type, name: HELD, item, parentVersion: null, mode: 'publish' })),
                    unpinnedDraft: await thrownBy(p.saveMetaItem({ type, name: HELD, item, mode: 'draft' })),
                    unpinned: await thrownBy(p.saveMetaItem({ type, name: HELD, item })),
                    pinned: await thrownBy(p.saveMetaItem({ type, name: HELD, item, parentVersion: 'v1' })),
                };
                const expected = (p.packagedBaseRefusal({ type, name: HELD, operation: 'save' }) as any).message;
                if (type !== 'flow') expect(expected).toBe(oneSentence(type, HELD));
                for (const [request, refusal] of Object.entries(requests) as Array<[string, any]>) {
                    expect(shape(refusal), `${request}: ${String(refusal?.message)}`).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
                    expect(refusal.message, request).toBe(expected);
                }
            });
        }
    }
});

/**
 * The control: an overlay type's first overlay write over a packaged item is
 * an overlay row, never a sealed write — the real write path over a stub
 * engine (the `protocol.flow-org-override-closed.test.ts` harness shape), so a
 * harness that could save nothing cannot pass it.
 */
describe('[#23577] control: an overlay type\'s first overlay write still succeeds', () => {
    function makeProtocol(artifacts: Array<{ type: string; name: string }>) {
        const rows: Array<Record<string, unknown>> = [];
        const artifactKeys = new Set(artifacts.map((a) => `${a.type}|${a.name}`));
        const engine: any = {
            async findOne(_t: string, opts: { where: Record<string, unknown> }) {
                assertEngineFindOnePredicate(_t, opts);
                return null;
            },
            async find() { return []; },
            async insert(_t: string, data: Record<string, unknown>) {
                if (_t !== 'sys_metadata') return { id: 'side_effect_skip' };
                rows.push(data);
                return { id: `r_${rows.length}` };
            },
            async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
                assertEngineUpdateDispatch(data, opts);
                return { id: null };
            },
            async delete(_t: string, opts?: Record<string, unknown>) {
                assertEngineDeleteDispatch(opts);
                return { deleted: 0 };
            },
            registry: {
                registerItem: () => {},
                registerObject: () => {},
                listItems: () => [],
                getItem: () => undefined,
                getArtifactItem: (type: string, name: string) =>
                    artifactKeys.has(`${type}|${name}`) ? { name, _packageId: PACKAGE_ID } : undefined,
            },
        };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod') as any;
        return { protocol, rows };
    }

    it('`view`: a first write pinned If-None-Match: * over a packaged view lands an overlay row', async () => {
        const { protocol, rows } = makeProtocol([{ type: 'view', name: 'overdue_grid' }]);
        const result = await protocol.saveMetaItem({
            type: 'view',
            name: 'overdue_grid',
            item: { name: 'overdue_grid', label: 'Overdue', object: 'task', viewKind: 'list', columns: [{ field: 'name', label: 'Name' }] },
            parentVersion: null,
        });
        expect(result.success).toBe(true);
        expect(rows.filter((r) => r.type === 'view' && r.name === 'overdue_grid')).toHaveLength(1);
    });
});
