// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * GATE — the runtime `/packages` door's field allowlist must not silently drop
 * a key, whether the key comes from the record it projects or from the door's
 * own post-projection stamp.
 *
 * ## The defect this exists to catch
 *
 * `INSTALLED_PACKAGE_RESPONSE_FIELDS` (`packages.ts`) is a hand-written
 * allowlist, and that was a deliberate trade: an undeclared member on the
 * registry item degrades to a field the response never mentions instead of
 * failing the whole list with `500 Converting circular structure to JSON`. The
 * price is that drift arrives as a **missing field** — a 200 with the key
 * simply absent, no red anywhere.
 *
 * Within one day of that allowlist landing, the platform started computing an
 * ADR-0070 D2 `writable` verdict for every package row. This door survived by
 * ORDERING: it projects first and stamps second. Had the two lines been the
 * other way round, the projection would have deleted the verdict — silently.
 * It was caught by a merge conflict. That is not a mechanism.
 *
 * ⚠️ `writable` itself is now pinned by name in
 * `packages-serializable-response.test.ts`, so the *known* field is covered.
 * What was missing — and is what this file supplies — is the GENERAL case:
 * **nothing generalised to the next stamped or declared key.**
 *
 * ## Two invariants, because this door has two ways to lose a key
 *
 *  1. **Coverage.** Every key on the record the door projects must reach the
 *     wire: `served ⊇ record − DELIBERATELY_NOT_SERVED`. A field added to the
 *     installed-package record and not to the allowlist reds here.
 *  2. **Stamps.** The keys the door adds on top of the projection — measured as
 *     `served − record`, never listed — must set-equal
 *     {@link DOOR_COMPUTED_STAMPS}. A reorder that puts the stamp BEFORE the
 *     projection empties that measured set and reds; a new stamp grows it and
 *     reds until someone records the decision.
 *
 * `DOOR_COMPUTED_STAMPS` is a hand-kept register, and that is the point rather
 * than a compromise: it is a **set-equality** register, so drift makes it RED,
 * where the allowlist it guards makes drift SILENT. Swapping a silent list for
 * a loud one is the whole mechanism this card asked for.
 *
 * ## The twin door has a DIFFERENT invariant — do not assume symmetry
 *
 * The REST twin (`packages/rest/src/package-routes.ts`) solved the same
 * near-miss the other way: its producer is `getMetaItems({ type: 'package' })`,
 * which stamps `writable` UPSTREAM, so over there the fix was to add the key to
 * the allowlist and the invariant is "the allowlist contains every stamped
 * key". Asserting that here would red on a correct door — this door's allowlist
 * deliberately does not contain `writable`. Its half of this gate is
 * `packages/rest/src/package-door-producer-key-carry.test.ts`.
 *
 * ## Why two files rather than one detector
 *
 * Measured, not assumed. A single file would have to reach the other package's
 * door, and both directions are worse than the split:
 *
 *  - From here, `@objectstack/rest` resolves to its **`dist/`** (no vitest
 *    alias maps it to source), which would make this gate's verdict a function
 *    of build state — a stale `dist` reds or greens for reasons that have
 *    nothing to do with the checkout. It would also GROW
 *    `KNOWN_UNALIASED_TEST_IMPORTS` in `scripts/check-test-source-alias.mjs`,
 *    a SHRINK-ONLY registry that lists no `@objectstack/rest` entry for this
 *    package today.
 *  - `@objectstack/rest` cannot import `@objectstack/runtime` at all — the
 *    dependency runs the other way.
 *
 * So: two pins, one shape. Each imports its own door as SOURCE, which is also
 * what lets a reviewer ablate one allowlist and watch exactly one gate go red.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

/**
 * Keys on the installed-package record this door deliberately does NOT serve.
 * **Explicit and annotated by construction** — an entry here is a
 * published-surface decision someone wrote down.
 *
 * Empty today: the allowlist carries every field the record declares.
 *
 * ⛔ Adding a key here to make a red test green is the defect one level up. The
 * question an entry must answer is "why must this door withhold it?", and the
 * answer belongs in the comment beside it.
 */
const DELIBERATELY_NOT_SERVED: readonly string[] = [];

/**
 * Keys this door computes ITSELF and adds after the projection — the set the
 * allowlist deliberately does not contain, so ORDER is the only thing keeping
 * them on the wire.
 *
 *  - `writable` — the ADR-0070 D2 writability verdict (`withWritableVerdict`).
 *    Not a record field: it is a property of the running engine, recomputed per
 *    read and never stored. `isWritablePackage` is the same predicate the
 *    authoring and lifecycle gates use.
 *
 * Compared by SET EQUALITY against the measured `served − record`, so both
 * directions are loud: a stamp that stops reaching the wire (the reorder this
 * card is about) and a stamp that arrives without a decision.
 */
const DOOR_COMPUTED_STAMPS: readonly string[] = ['writable'];

/** Authenticated caller holding the ADR-0106 D4 read capability. */
const reader = (): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['studio.access'] },
});

/** The engine's own `actionActivation -> store -> engine` cycle, reproduced. */
function cyclicEngine(): Record<string, unknown> {
    const engine: Record<string, unknown> = { name: '_ObjectQL' };
    const store: Record<string, unknown> = { name: 'ObjectStoreActionActivationStore', engine };
    engine.actionActivation = { name: 'ActionActivationProjection', store };
    return engine;
}

/** A host-constructed connector plugin that takes the engine on init. */
class FakeConnectorPlugin {
    name = 'connector-runtime';
    engine: unknown;
    init(engine: unknown) { this.engine = engine; }
}

/** Booted app package — the ADR-0070 predicate says read-only. */
const CODE_PROJECT = 'com.example.showcase';
/** Platform-delivered plugin package. */
const SYSTEM_SCOPED = 'com.objectstack.setup';
/** Studio-created database base: installed, never booted, scope-less. */
const DB_BASE = 'com.acme.mybase';

/**
 * A registry in the showcase's shape, built through the REAL
 * `SchemaRegistry.installPackage` — so the records under test are the records
 * production holds, not a literal someone typed next to the assertion. A
 * fixture that hand-listed the record's keys would be a third copy of the same
 * truth and would drift with the two it is meant to compare.
 */
function realRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as unknown as { logLevel: string }).logLevel = 'silent';

    const plugin = new FakeConnectorPlugin();
    registry.installPackage({
        id: CODE_PROJECT,
        name: 'Showcase',
        namespace: 'showcase',
        version: '0.3.16',
        type: 'app',
        scope: 'project',
        description: 'Kitchen-sink showcase workspace',
        objects: [{ name: 'invoice', fields: { total: { type: 'currency' } } }],
        apps: [{ name: 'showcase', label: 'Showcase' }],
        plugins: [plugin],
    } as never);
    // Init AFTER install — the measured ordering: the manifest serialised
    // cleanly during boot and only became cyclic once the plugins came up.
    plugin.init(cyclicEngine());

    registry.installPackage({
        id: SYSTEM_SCOPED, name: 'Setup', namespace: 'setup', version: '9.3.0',
        type: 'plugin', scope: 'system',
    } as never);

    registry.installPackage({
        id: DB_BASE, name: 'My Base', namespace: 'mybase', version: '1.0.0', type: 'app',
    } as never);

    return registry;
}

/**
 * The dispatcher over that registry. `manifests` is what `ObjectQL.registerApp`
 * records for every package of a loaded artifact — the ADR-0070 D2 predicate
 * reads it FIRST, so it is what makes the `writable` stamp a real computation
 * rather than a constant.
 */
function dispatcherOver(registry: SchemaRegistry): HttpDispatcher {
    const qlService: any = {
        registry,
        manifests: new Map<string, unknown>([
            [CODE_PROJECT, registry.getPackage(CODE_PROJECT)?.manifest],
            [SYSTEM_SCOPED, registry.getPackage(SYSTEM_SCOPED)?.manifest],
        ]),
    };
    const kernel: any = {
        context: { getService: (n: string) => (n === 'objectql' ? qlService : null) },
    };
    return new HttpDispatcher(kernel);
}

type Row = Record<string, unknown> & { manifest?: { id?: unknown } };

const rowId = (row: Row): string | undefined => {
    const fromManifest = row?.manifest?.id;
    if (typeof fromManifest === 'string') return fromManifest;
    return typeof row.id === 'string' ? row.id : undefined;
};

/** MEASURE the record's key set from the real registry — never a literal. */
const recordKeysOf = (registry: SchemaRegistry, id: string): Set<string> =>
    new Set(Object.keys(registry.getPackage(id) as object));

/**
 * THE DETECTOR. Shared in shape with the REST twin: the keys a door drops are
 * `expected − served − excluded`, and a non-empty answer is the defect.
 *
 * Returns the dropped keys rather than asserting, so the caller can name the
 * row in the failure message.
 */
function droppedKeys(
    expected: ReadonlySet<string>,
    served: ReadonlySet<string>,
    excluded: readonly string[],
): string[] {
    const exempt = new Set(excluded);
    return [...expected].filter((k) => !served.has(k) && !exempt.has(k)).sort();
}

async function listRows(registry: SchemaRegistry): Promise<Row[]> {
    const r = await dispatcherOver(registry).handlePackages('/', 'GET', undefined, {}, reader());
    expect(r.response?.status).toBe(200);
    return (r.response?.body?.data?.packages ?? []) as Row[];
}

async function detailRow(registry: SchemaRegistry, id: string): Promise<Row> {
    const r = await dispatcherOver(registry).handlePackages(`/${id}`, 'GET', undefined, {}, reader());
    expect(r.response?.status).toBe(200);
    return (r.response?.body?.data ?? {}) as Row;
}

describe('GATE: runtime /packages carries every declared and stamped key', () => {
    it('control: the registry record is non-trivial and carries no verdict of its own', async () => {
        // ANTI-VACUITY, both halves. An empty record would make the coverage
        // assertion pass over an allowlist that was never asked a question; a
        // record that already carried `writable` would make the stamp
        // measurement below read a field this door never computed.
        const registry = realRegistry();
        const keys = recordKeysOf(registry, CODE_PROJECT);
        expect(keys.size).toBeGreaterThan(3);
        expect(keys.has('manifest')).toBe(true);
        expect(keys.has('status')).toBe(true);
        for (const stamp of DOOR_COMPUTED_STAMPS) expect(keys.has(stamp)).toBe(false);
    });

    it('every record key survives to the wire, on the list door and the detail door', async () => {
        // THE GATE, half 1. Add a field to the installed-package record without
        // adding it to `INSTALLED_PACKAGE_RESPONSE_FIELDS` and this reds with
        // the key's own name, instead of shipping a 200 with the field absent.
        const registry = realRegistry();
        const rows = await listRows(registry);
        const report: string[] = [];

        for (const id of [CODE_PROJECT, SYSTEM_SCOPED, DB_BASE]) {
            const record = recordKeysOf(registry, id);

            const listed = rows.find((p) => rowId(p) === id);
            expect(listed, `package ${id} vanished from GET /packages`).toBeDefined();
            const listDropped = droppedKeys(record, new Set(Object.keys(listed as object)), DELIBERATELY_NOT_SERVED);
            if (listDropped.length) report.push(`list ${id}: ${listDropped.join(', ')}`);

            const detail = await detailRow(registry, id);
            const detailDropped = droppedKeys(record, new Set(Object.keys(detail)), DELIBERATELY_NOT_SERVED);
            if (detailDropped.length) report.push(`detail ${id}: ${detailDropped.join(', ')}`);
        }

        expect(
            report,
            'runtime /packages dropped declared record key(s). Either add them to '
            + '`INSTALLED_PACKAGE_RESPONSE_FIELDS` in packages.ts, or record the '
            + 'withholding in `DELIBERATELY_NOT_SERVED` in this file with the reason.',
        ).toEqual([]);
    });

    it('the keys this door stamps after the projection are exactly the recorded set', async () => {
        // THE GATE, half 2 — the ORDER invariant, generalised past `writable`.
        //
        // The stamp set is MEASURED (`served − record`), never listed, and then
        // compared for SET EQUALITY against the annotated register. Reorder the
        // door to stamp before it projects and the projection deletes the stamp:
        // the measured set goes empty and this reds, where the wire would have
        // shown only a 200 with the field absent. Add a new stamp and this reds
        // until the decision is written down.
        const registry = realRegistry();
        const rows = await listRows(registry);
        const expectedStamps = [...DOOR_COMPUTED_STAMPS].sort();

        for (const id of [CODE_PROJECT, SYSTEM_SCOPED, DB_BASE]) {
            const record = recordKeysOf(registry, id);

            const listed = rows.find((p) => rowId(p) === id) as Row;
            const listStamps = Object.keys(listed).filter((k) => !record.has(k)).sort();
            expect(listStamps, `GET /packages stamp set for ${id}`).toEqual(expectedStamps);

            const detail = await detailRow(registry, id);
            const detailStamps = Object.keys(detail).filter((k) => !record.has(k)).sort();
            expect(detailStamps, `GET /packages/${id} stamp set`).toEqual(expectedStamps);
        }
    });

    it('control: the detector reports a dropped key rather than passing vacuously', async () => {
        // Proves the coverage assertion can FAIL, without mutating source. The
        // door is real and so is the drop: an undeclared key on the record is
        // exactly what the allowlist deletes, and the detector must say so.
        const registry = realRegistry();
        (registry.getPackage(CODE_PROJECT) as Record<string, unknown>).nextDeclaredField = 'v1';

        const rows = await listRows(registry);
        const listed = rows.find((p) => rowId(p) === CODE_PROJECT) as Row;
        const served = new Set(Object.keys(listed));

        expect(droppedKeys(recordKeysOf(registry, CODE_PROJECT), served, DELIBERATELY_NOT_SERVED))
            .toEqual(['nextDeclaredField']);
        // …and the exclusion register is the one way to make that green again.
        expect(droppedKeys(recordKeysOf(registry, CODE_PROJECT), served, ['nextDeclaredField']))
            .toEqual([]);
    });

    it('the projection still drops an undeclared LIVE member — the gate does not undo it', async () => {
        // The coverage assertion is one-directional (⊇), on purpose: this door
        // must keep degrading an unserializable member to a missing field. A
        // gate written as set EQUALITY over the record would have forced that
        // member back onto the wire and re-opened the 500.
        const registry = realRegistry();
        (registry.getPackage(CODE_PROJECT) as Record<string, unknown>).liveEngineHandle = cyclicEngine();

        const rows = await listRows(registry);
        expect(() => JSON.stringify(rows)).not.toThrow();
        expect(rows.some((p) => 'liveEngineHandle' in p)).toBe(false);
    });
});
