// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8671 — `GET /api/v1/meta/:type/:name/diff` must not serve stored credential
 * VALUES, while still reporting that the credential CHANGED.
 *
 * The endpoint is routed and live (`rest-server.ts` answers `res.json(result)`
 * unmodified), and `diffMetaItem` reads `sys_metadata_history` bodies plus the
 * active row through `repo.get()` — both VERBATIM. A pre-#8078 `datasource` row
 * whose credential rotated therefore emitted both the old and the new password
 * in cleartext.
 *
 * ## Why this is not #8154's item redactor one line over
 *
 * A diff is not an item body: it is a list of `(path, value)` triples, so there
 * is no body for the item-level redactor to take. This is the same "different
 * plane, same stored bytes" split that made #7990 its own card.
 *
 * ## The ruled shape (maintainer ruling, issue comment 5299845282 — Option B)
 *
 *   > Ruled: Option B — diff raw, then redact emitted values at redactor-named
 *   > paths, keeping the path and the "changed" signal.
 *
 * ⛔ Option A (redact BOTH bodies before diffing) is ruled out and these pins
 * are written to catch a drift back to it: two redacted bodies are EQUAL at a
 * redacted path, so the rotation would vanish into a no-diff. `pins the path as
 * changed` below fails under Option A, which is the point of asserting the
 * path's presence and its values' absence as two separate facts rather than
 * just sweeping for the secret.
 *
 * ## Anti-vacuity
 *
 * The `ablate the redactor` block re-registers `datasource` with an IDENTITY
 * redactor through the public `registerMetadataTypeRedactor` overlay and
 * asserts the cleartext comes back. So the green above is a statement about the
 * redaction running — not about the fixture happening to be credential-free.
 * The `label` control is the second arm: it proves the redaction is
 * PATH-SELECTIVE rather than a blanket value scrub, which a sweep-only test
 * cannot distinguish (a diff that emitted no values at all would pass it).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, hashSpec } from '@objectstack/metadata-core';
import { getMetadataTypeRedactor, registerMetadataTypeRedactor } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './index.js';

/** The rotating inline credential, one spelling per version. */
const PW_V2 = 'hunter2-old';
const PW_V3 = 'hunter3-new';
/** …and the same secret embedded in a URL, which #8078 leaves schema-ACCEPTED. */
const URL_PW_V2 = 's3cr3t-old';
const URL_PW_V3 = 's3cr3t-new';
const URL_V2 = `postgresql://reporting:${URL_PW_V2}@db.internal:5432/warehouse`;
const URL_V3 = `postgresql://reporting:${URL_PW_V3}@db.internal:5432/warehouse`;
/** What the read path serves in the URL's place — username kept, password gone. */
const SERVED_URL = 'postgresql://reporting@db.internal:5432/warehouse';

/** The ordinary, non-credential field whose values MUST still be served. */
const LABEL_V2 = 'Warehouse';
const LABEL_V3 = 'Warehouse Reporting';

/** v1: before the datasource had a `config` at all — the `added` bucket's fixture. */
const BODY_V1 = { name: 'warehouse', label: LABEL_V2, driver: 'postgres' };
/** v2: a legacy row at rest from before #8078 — inline password AND URL password. */
const BODY_V2 = {
    name: 'warehouse',
    label: LABEL_V2,
    driver: 'postgres',
    config: { host: 'db.internal', username: 'reporting', password: PW_V2, url: URL_V2 },
};
/** v3: the ROTATION — both credential spellings change, and so does `label`. */
const BODY_V3 = {
    name: 'warehouse',
    label: LABEL_V3,
    driver: 'postgres',
    config: { host: 'db.internal', username: 'reporting', password: PW_V3, url: URL_V3 },
};

/**
 * Scalar equality only — and it REFUSES anything else rather than guessing.
 *
 * The two readers this double serves issue flat filters: `diffMetaItem` queries
 * `sys_metadata_history` by `{ organization_id, type, name }`, and
 * `SysMetadataRepository.history` by the same three. No combinator ever arrives.
 *
 * The `throw` is the point (`check:where-matcher`). Treating a `$or` / `$and`
 * key as an ordinary column name is the gate's shape (b): `r.$or` is
 * `undefined`, the comparison fails, the row is silently excluded, and the
 * suite goes green while asserting on a query nobody wrote. Refusing makes this
 * file RED the moment a combinator arrives, which is the honest failure — this
 * double is not a query engine and must not pretend to be one.
 */
function matches(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k.startsWith('$')) {
            throw new Error(
                `stub engine: WHERE combinator '${k}' is not implemented by this double — `
                + 'it matches scalar equality only. Implement it here rather than letting it '
                + 'be read as a field name.',
            );
        }
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

/**
 * Table-aware stub: `diffMetaItem` reads `sys_metadata_history` directly while
 * `historyMetaItem` and `repo.get()` read it and `sys_metadata`. A single-map
 * stub would answer the history query with the active row and quietly make the
 * version selection meaningless.
 */
function makeStubEngine() {
    const tables: Record<string, Array<Record<string, unknown>>> = {
        sys_metadata: [],
        sys_metadata_history: [],
    };
    const engine: any = {
        async find(table: string, opts: { where: Record<string, unknown> }) {
            return (tables[table] ?? []).filter((r) => matches(r, opts.where));
        },
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            return (tables[table] ?? []).find((r) => matches(r, opts.where)) ?? null;
        },
        async insert() { return { id: 'stub' }; },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL in this stub */ },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, tables };
}

/**
 * Seed the three history versions plus the active row.
 *
 * Seeded DIRECTLY, never through `saveMetaItem`: #8078 closed the write door on
 * inline credentials, so the rows that leak are precisely the ones no authoring
 * path can create any more, and only a direct seed reproduces them.
 */
function seedVersions(tables: Record<string, Array<Record<string, unknown>>>) {
    const base = { organization_id: null, type: 'datasource', name: 'warehouse' };
    const bodies = [BODY_V1, BODY_V2, BODY_V3];
    bodies.forEach((body, i) => {
        tables.sys_metadata_history!.push({
            ...base,
            id: `h_${i + 1}`,
            version: i + 1,
            event_seq: i + 1,
            operation_type: i === 0 ? 'create' : 'update',
            metadata: JSON.stringify(body),
            checksum: hashSpec(body),
            recorded_at: new Date(i + 1).toISOString(),
        });
    });
    tables.sys_metadata!.push({
        ...base,
        id: 'r_active',
        package_id: null,
        state: 'active',
        metadata: JSON.stringify(BODY_V3),
        checksum: hashSpec(BODY_V3),
        version: 3,
    });
}

/** Every string anywhere in a payload, so a leak cannot hide in a nested key. */
function allStrings(value: unknown, out: string[] = []): string[] {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, out));
    return out;
}

function expectNoCredential(payload: unknown) {
    const strings = allStrings(payload);
    for (const secret of [PW_V2, PW_V3, URL_PW_V2, URL_PW_V3]) {
        expect(strings.some((s) => s.includes(secret))).toBe(false);
    }
}

const entry = (list: Array<{ path: string }>, path: string) => list.find((e) => e.path === path);

// The registry overlay is process-global; a leaked identity redactor would
// silently vacuum every later assertion in the run.
const BUILTIN_DATASOURCE_REDACTOR = getMetadataTypeRedactor('datasource')!;
afterEach(() => {
    registerMetadataTypeRedactor('datasource', BUILTIN_DATASOURCE_REDACTOR);
});

async function diff(from: number, to: number) {
    const { engine, tables } = makeStubEngine();
    seedVersions(tables);
    const protocol = new ObjectStackProtocolImplementation(engine);
    return await protocol.diffMetaItem({
        type: 'datasource',
        name: 'warehouse',
        fromVersion: from,
        toVersion: to,
    }) as any;
}

describe('#8671 — a credential ROTATION diffs as changed, with neither value served', () => {
    it('pins the path as changed and withholds BOTH sides (the ruling`s named pin)', async () => {
        const res = await diff(2, 3);

        // ① The audit fact SURVIVES: the path is reported as changed. This is
        //    the assertion Option A cannot pass — redacting before the compare
        //    makes the two bodies equal at `config`, and the entry disappears.
        const changed = entry(res.changed, 'config');
        expect(changed).toBeDefined();

        // ② Neither the old nor the new value is served, in either spelling.
        expect((changed as any).from.password).toBeUndefined();
        expect((changed as any).to.password).toBeUndefined();
        expect((changed as any).from.url).toBe(SERVED_URL);
        expect((changed as any).to.url).toBe(SERVED_URL);
        expectNoCredential(res);
    });

    it('is PATH-SELECTIVE — an ordinary field still diffs with both values visible', async () => {
        // The discriminating control. Without it these pins cannot tell
        // "correct" from "redacts everything": a diff that emitted no values at
        // all would satisfy the sweep above while destroying the endpoint.
        const res = await diff(2, 3);

        const label = entry(res.changed, 'label') as any;
        expect(label).toBeDefined();
        expect(label.from).toBe(LABEL_V2);
        expect(label.to).toBe(LABEL_V3);
    });

    it('keeps the non-credential keys INSIDE the redacted value', async () => {
        // Redaction is per credential key, not per entry: an operator still
        // sees what else moved in `config`. `diffShallow` is top-level, so the
        // emitted value is the whole sub-object — and it is the redactor's
        // nested projection of it, not a hole.
        const res = await diff(2, 3);

        const changed = entry(res.changed, 'config') as any;
        expect(changed.from.host).toBe('db.internal');
        expect(changed.from.username).toBe('reporting');
        expect(changed.to.host).toBe('db.internal');
        expect(changed.to.username).toBe('reporting');
    });
});

describe('#8671 — the other two emission buckets', () => {
    it('`added` — a credential appearing in a later version is not served', async () => {
        const res = await diff(1, 2);

        const added = entry(res.added, 'config') as any;
        expect(added).toBeDefined();
        expect(added.value.password).toBeUndefined();
        expect(added.value.url).toBe(SERVED_URL);
        expect(added.value.username).toBe('reporting');
        expectNoCredential(res);
    });

    it('`removed` — a credential dropped in a later version is not served', async () => {
        const res = await diff(2, 1);

        const removed = entry(res.removed, 'config') as any;
        expect(removed).toBeDefined();
        expect(removed.value.password).toBeUndefined();
        expect(removed.value.url).toBe(SERVED_URL);
        expectNoCredential(res);
    });
});

describe('#8671 — anti-vacuity: ablate the redactor', () => {
    it('the cleartext comes back when `datasource` carries an identity redactor', async () => {
        // Proves the green above is the redaction RUNNING, not a fixture that
        // never held a credential. Ablated through the public registry overlay
        // — the same door a type owner registers through — so nothing about the
        // production wiring is reached around.
        registerMetadataTypeRedactor('datasource', (item) => ({ item, redactedKeys: [] }));

        const res = await diff(2, 3);
        const changed = entry(res.changed, 'config') as any;
        expect(changed.from.password).toBe(PW_V2);
        expect(changed.to.password).toBe(PW_V3);
        expect(changed.from.url).toBe(URL_V2);
        expect(changed.to.url).toBe(URL_V3);
    });

    it('an ordinary type with no redactor keeps serving its values untouched', async () => {
        // The passthrough branch: `hasMetadataRedactor` is false for `view`, so
        // the emitted values are the raw diff's, by reference.
        const { engine, tables } = makeStubEngine();
        const base = { organization_id: null, type: 'view', name: 'grid' };
        [{ name: 'grid', label: 'A' }, { name: 'grid', label: 'B' }].forEach((body, i) => {
            tables.sys_metadata_history!.push({
                ...base,
                id: `h_${i + 1}`,
                version: i + 1,
                event_seq: i + 1,
                operation_type: i === 0 ? 'create' : 'update',
                metadata: JSON.stringify(body),
                checksum: hashSpec(body),
                recorded_at: new Date(i + 1).toISOString(),
            });
        });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({
            type: 'view',
            name: 'grid',
            fromVersion: 1,
            toVersion: 2,
        });
        const label = entry(res.changed, 'label') as any;
        expect(label.from).toBe('A');
        expect(label.to).toBe('B');
    });
});
