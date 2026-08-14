// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8154 — the metadata READ path must not serve stored cleartext credentials,
 * and the WRITE path must not turn that scrub into silent credential deletion.
 *
 * Both halves are pinned here because shipping either alone is a defect:
 *
 *  - read alone ⇒ an ordinary `/meta` GET → edit → PUT round trip converts
 *    today's loud `422` into SILENT credential DELETION (measured on
 *    `origin/main`; it is the reason this card is one PR);
 *  - write alone ⇒ nothing changes.
 *
 * Every row here is seeded DIRECTLY into the stub engine, never through
 * `saveMetaItem`. That is not a shortcut — it is the population under test:
 * #8078 closed the write door on inline credentials, so a legacy row holding
 * `config.password` can no longer be created through any authoring path. The
 * rows that leak are the ones written BEFORE that door closed, and only a
 * direct seed reproduces them.
 *
 * ## Anti-vacuity
 *
 * Two arms, both wired:
 *
 *  1. **The redaction assertions go red when the redactor is removed.** The
 *     `ablate the redactor` block re-registers `datasource` with an IDENTITY
 *     redactor through the public `registerMetadataTypeRedactor` overlay and
 *     asserts the cleartext comes back — so the green in the blocks above is a
 *     statement about the redactor running, not about the fixture being
 *     credential-free.
 *  2. **The badge assertions go red when the `_diagnostics` ordering is
 *     inverted.** `computeMetadataDiagnostics` on the REDACTED body returns
 *     `valid:true` (pinned directly below), because the redacted body is
 *     exactly what the post-#8078 schema accepts. So the `valid:false`
 *     assertions on the read exits fail the moment diagnostics are computed
 *     after redaction instead of before — which is the ordering that would
 *     destroy the #8081 item-3 operator inventory.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, hashSpec } from '@objectstack/metadata-core';
import {
    getMetadataTypeRedactor,
    getMetadataTypeSchema,
    registerMetadataTypeRedactor,
} from '@objectstack/spec/kernel';
import {
    ObjectStackProtocolImplementation,
    carryForwardRedactedValues,
    computeMetadataDiagnostics,
    hasMetadataRedactor,
    redactMetadataItem,
} from './index.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

function matches(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => matches(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
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
    return { engine, rows };
}

/** The password the fixture stores inline, and the one embedded in its URL. */
const INLINE_PASSWORD = 'hunter2';
const URL_PASSWORD = 's3cr3t';
const STORED_URL = `postgresql://reporting:${URL_PASSWORD}@db.internal:5432/warehouse`;
/** What the read path serves in the URL's place — username kept, password gone. */
const SERVED_URL = 'postgresql://reporting@db.internal:5432/warehouse';

/**
 * A `datasource` row exactly as it exists at rest from before #8078: an inline
 * `config.password` AND a password embedded in `config.url`. Both spellings
 * matter — dropping the inline key while serving the identical credential one
 * key over would be a scrub in name only.
 */
function legacyDatasourceBody() {
    return {
        name: 'warehouse',
        label: 'Warehouse',
        driver: 'postgres',
        config: {
            host: 'db.internal',
            port: 5432,
            database: 'warehouse',
            username: 'reporting',
            password: INLINE_PASSWORD,
            url: STORED_URL,
        },
    };
}

function seedLegacyRow(rows: Map<string, Row>, state: 'active' | 'draft' = 'active') {
    const where = {
        type: 'datasource',
        name: 'warehouse',
        organization_id: null,
        package_id: null,
        state,
    };
    const body = legacyDatasourceBody();
    rows.set(keyOf(where), {
        id: 'r_seed',
        ...where,
        metadata: JSON.stringify(body),
        // A real row carries its own checksum. Omitting it makes the
        // optimistic-lock parent (`repo.get()` → `row.checksum ?? hashSpec`)
        // disagree with the conflict check (which reads the column), and every
        // save 409s for a reason that has nothing to do with this card.
        checksum: hashSpec(body),
        version: 1,
    } as Row);
}

const storedRow = (rows: Map<string, Row>, state: 'active' | 'draft' = 'active') =>
    Array.from(rows.values()).find((r) => r.name === 'warehouse' && r.state === state)!;

const storedBody = (rows: Map<string, Row>, state: 'active' | 'draft' = 'active') =>
    JSON.parse(storedRow(rows, state).metadata);

/** Every string anywhere in a served payload, so a leak cannot hide in a nested key. */
function allStrings(value: unknown, out: string[] = []): string[] {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, out));
    return out;
}

function expectNoCredential(payload: unknown) {
    const strings = allStrings(payload);
    expect(strings).not.toContain(INLINE_PASSWORD);
    expect(strings.some((s) => s.includes(URL_PASSWORD))).toBe(false);
}

// Restore the built-in after any block that overlays it (the registry overlay
// is process-global, and a leaked identity redactor would silently vacuum every
// later assertion in the run).
const BUILTIN_DATASOURCE_REDACTOR = getMetadataTypeRedactor('datasource')!;
afterEach(() => {
    registerMetadataTypeRedactor('datasource', BUILTIN_DATASOURCE_REDACTOR);
});

describe('#8154 — the seam this card consumes', () => {
    it('resolves a redactor for `datasource`, in both the plural and singular spellings', () => {
        // `GET /api/v1/meta/datasources` arrives as the plural; the registry is
        // keyed singular. A read that normalised one way and not the other
        // would serve cleartext on exactly one of the two URLs.
        expect(hasMetadataRedactor('datasource')).toBe(true);
        expect(hasMetadataRedactor('datasources')).toBe(true);
    });

    it('registers no redactor for an ordinary type, and leaves its body by reference', () => {
        expect(hasMetadataRedactor('view')).toBe(false);
        const body = { name: 'v', label: 'V' };
        expect(redactMetadataItem('view', body)).toBe(body);
    });
});

describe('#8154 — the `_diagnostics` ordering is load-bearing (ruling 4)', () => {
    it('the RAW stored body is `valid:false` and the REDACTED body is `valid:true`', () => {
        // This is the whole reason the ordering is pinned rather than assumed,
        // and it is what makes every `valid:false` assertion below an
        // anti-vacuity arm: computing diagnostics AFTER redaction flips the
        // verdict, because the redacted body is precisely the shape #8078's
        // schema accepts. The #8081 item-3 operator inventory — "which rows
        // still hold a stored credential" — is that `valid:false` badge, so an
        // inverted ordering deletes the remedy while the leak looks fixed.
        const raw = legacyDatasourceBody();
        expect(computeMetadataDiagnostics('datasource', raw)?.valid).toBe(false);

        const redacted = redactMetadataItem('datasource', raw);
        expect(computeMetadataDiagnostics('datasource', redacted)?.valid).toBe(true);

        // …and the schema agrees directly, so the pin does not depend on the
        // diagnostics wrapper keeping its current shape.
        const schema = getMetadataTypeSchema('datasource')!;
        expect(schema.safeParse(raw).success).toBe(false);
        expect(schema.safeParse(redacted).success).toBe(true);
    });

    it('does not mutate the stored body — the connect path still reads cleartext', () => {
        const raw = legacyDatasourceBody();
        const redacted = redactMetadataItem('datasource', raw) as any;
        expect(redacted).not.toBe(raw);
        expect(raw.config.password).toBe(INLINE_PASSWORD);
        expect(raw.config.url).toBe(STORED_URL);
        expect(redacted.config.password).toBeUndefined();
        expect(redacted.config.url).toBe(SERVED_URL);
    });
});

describe('#8154 — the read exits withhold the stored credential', () => {
    it('getMetaItems (GET /api/v1/meta/datasources — the card`s named door)', async () => {
        const { engine, rows } = makeStubEngine();
        seedLegacyRow(rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.getMetaItems({ type: 'datasource' });
        const item = res.items.find((i: any) => i.name === 'warehouse');
        expect(item).toBeDefined();
        expect(item.config.password).toBeUndefined();
        expect(item.config.url).toBe(SERVED_URL);
        expectNoCredential(res);

        // The migration-inventory badge survives — computed on the RAW body.
        expect(item._diagnostics.valid).toBe(false);

        // …and the stored row is untouched: redaction is a SERVING act.
        expect(storedBody(rows).config.password).toBe(INLINE_PASSWORD);
        expect(storedBody(rows).config.url).toBe(STORED_URL);
    });

    it('getMetaItem (single-item read)', async () => {
        const { engine, rows } = makeStubEngine();
        seedLegacyRow(rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.getMetaItem({ type: 'datasource', name: 'warehouse' });
        expect(res.item.config.password).toBeUndefined();
        expect(res.item.config.url).toBe(SERVED_URL);
        expect(res.item._diagnostics.valid).toBe(false);
        expectNoCredential(res);
    });

    it('getMetaItemLayered — ALL THREE layers, `code` and `overlay` included', async () => {
        // The exit `decorateMetadataItem` does not reach: this method computes
        // `_diagnostics` itself and serves its layers raw. Before this change
        // it returned `hunter2` in BOTH `overlay` and `effective`.
        //
        // Redacting `code`/`overlay` is a reading of #7556's deliberate
        // rawness, stated in the PR body for its lane to contest: those layers
        // are raw so a Studio diff shows what the tenant customised, and
        // redacting the key on BOTH sides leaves that diff unchanged.
        const { engine, rows } = makeStubEngine();
        seedLegacyRow(rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.getMetaItemLayered({ type: 'datasource', name: 'warehouse' });
        expect(res.overlay).not.toBeNull();
        expect(res.overlay.config.password).toBeUndefined();
        expect(res.overlay.config.url).toBe(SERVED_URL);
        expect(res.effective.config.password).toBeUndefined();
        expect(res.effective.config.url).toBe(SERVED_URL);
        expectNoCredential(res);

        // The badge on this exit is computed from the raw effective body too.
        expect(res._diagnostics.valid).toBe(false);
    });

    it('ABLATION — every assertion above goes red when the redactor is removed', async () => {
        // Anti-vacuity arm 1. Overlay the registry entry with an identity
        // redactor (the public extension seam), re-run the three exits, and
        // watch the cleartext come back. If this block ever goes green, the
        // blocks above are asserting nothing.
        registerMetadataTypeRedactor('datasource', (item) => ({ item, redactedKeys: [] }));

        const { engine, rows } = makeStubEngine();
        seedLegacyRow(rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const list: any = await protocol.getMetaItems({ type: 'datasource' });
        expect(list.items[0].config.password).toBe(INLINE_PASSWORD);

        const one: any = await protocol.getMetaItem({ type: 'datasource', name: 'warehouse' });
        expect(one.item.config.url).toBe(STORED_URL);

        const layered: any = await protocol.getMetaItemLayered({ type: 'datasource', name: 'warehouse' });
        expect(layered.overlay.config.password).toBe(INLINE_PASSWORD);
        expect(layered.effective.config.password).toBe(INLINE_PASSWORD);
    });
});

describe('#8154 — the write-path inverse (the read scrub may NOT ship alone)', () => {
    it('the GET → edit → PUT round trip KEEPS the stored credential', async () => {
        const { engine, rows } = makeStubEngine();
        seedLegacyRow(rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        // Exactly what Studio holds: the SERVED (redacted) document.
        const served: any = (await protocol.getMetaItem({ type: 'datasource', name: 'warehouse' })).item;
        expect(served.config.password).toBeUndefined();

        // The author edits one label and PUTs the whole body back.
        await protocol.saveMetaItem({
            type: 'datasource',
            name: 'warehouse',
            item: { ...served, label: 'Warehouse (edited)' },
        });

        const stored = storedBody(rows);
        expect(stored.label).toBe('Warehouse (edited)');
        // Without the carry-forward, BOTH of these are gone — that is the
        // silent credential deletion this card refuses to ship.
        expect(stored.config.password).toBe(INLINE_PASSWORD);
        expect(stored.config.url).toBe(STORED_URL);
    });

    it('an UNTOUCHED save persists a byte-identical body (#4326 invariant preserved)', async () => {
        const { engine, rows } = makeStubEngine();
        seedLegacyRow(rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const before = storedBody(rows);
        const served: any = (await protocol.getMetaItem({ type: 'datasource', name: 'warehouse' })).item;
        await protocol.saveMetaItem({ type: 'datasource', name: 'warehouse', item: served });

        expect(storedBody(rows)).toEqual(before);
    });

    it('the AUTHOR`s word wins — a changed URL is persisted verbatim, not carried over', async () => {
        const { engine, rows } = makeStubEngine();
        seedLegacyRow(rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const served: any = (await protocol.getMetaItem({ type: 'datasource', name: 'warehouse' })).item;
        await protocol.saveMetaItem({
            type: 'datasource',
            name: 'warehouse',
            item: { ...served, config: { ...served.config, url: 'postgresql://reporting@db2.internal:5432/warehouse' } },
        });

        const stored = storedBody(rows);
        expect(stored.config.url).toBe('postgresql://reporting@db2.internal:5432/warehouse');
        // The inline password was still untouched by the author, so it stays.
        expect(stored.config.password).toBe(INLINE_PASSWORD);
    });

    it('does NOT launder a typed-in credential past #8078`s write gate', async () => {
        const { engine, rows } = makeStubEngine();
        seedLegacyRow(rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const served: any = (await protocol.getMetaItem({ type: 'datasource', name: 'warehouse' })).item;
        await expect(protocol.saveMetaItem({
            type: 'datasource',
            name: 'warehouse',
            item: { ...served, config: { ...served.config, password: 'typed-by-hand' } },
        })).rejects.toMatchObject({ code: 'INVALID_METADATA', status: 422 });

        // Refused ⇒ the stored row is unchanged.
        expect(storedBody(rows).config.password).toBe(INLINE_PASSWORD);
    });

    it('a DRAFT save of a legacy row carries the credential forward from the ACTIVE row', async () => {
        // The load-bearing fallback: the first `?mode=draft` save has no draft
        // row of its own to compare against, while the body the author edited
        // came from the active row. Without it the draft drops the credential
        // and `promoteDraft` later publishes that loss.
        const { engine, rows } = makeStubEngine();
        seedLegacyRow(rows);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const served: any = (await protocol.getMetaItem({ type: 'datasource', name: 'warehouse' })).item;
        await protocol.saveMetaItem({
            type: 'datasource',
            name: 'warehouse',
            mode: 'draft',
            item: { ...served, label: 'Warehouse (draft)' },
        });

        const draft = storedBody(rows, 'draft');
        expect(draft.label).toBe('Warehouse (draft)');
        expect(draft.config.password).toBe(INLINE_PASSWORD);
        expect(draft.config.url).toBe(STORED_URL);
    });
});

describe('#8154 — carryForwardRedactedValues, the three outcomes', () => {
    const stored = legacyDatasourceBody();

    it('carries forward where the incoming body is INDISTINGUISHABLE from what was served', () => {
        const served = redactMetadataItem('datasource', stored) as any;
        const out: any = carryForwardRedactedValues('datasource', served, stored);
        expect(out.config.password).toBe(INLINE_PASSWORD);
        expect(out.config.url).toBe(STORED_URL);
    });

    it('leaves the author`s own value alone', () => {
        const served = redactMetadataItem('datasource', stored) as any;
        const incoming = { ...served, config: { ...served.config, password: 'new-one', url: 'postgresql://u@h:5432/w' } };
        const out: any = carryForwardRedactedValues('datasource', incoming, stored);
        expect(out.config.password).toBe('new-one');
        expect(out.config.url).toBe('postgresql://u@h:5432/w');
    });

    it('⛔ never MINTS a container the author removed', () => {
        // A body with no `config` at all is an author deleting the container.
        // Grafting `config.password` back would create a config holding
        // nothing but a credential.
        const incoming = { name: 'warehouse', label: 'Warehouse', driver: 'postgres' };
        const out: any = carryForwardRedactedValues('datasource', incoming, stored);
        expect(out.config).toBeUndefined();
    });

    it('does not mutate the incoming body, and is a no-op without a redactor', () => {
        const served = redactMetadataItem('datasource', stored) as any;
        const incoming = { ...served, config: { ...served.config } };
        const out = carryForwardRedactedValues('datasource', incoming, stored);
        expect(out).not.toBe(incoming);
        expect((incoming as any).config.password).toBeUndefined();

        const view = { name: 'v', label: 'V' };
        expect(carryForwardRedactedValues('view', view, { name: 'v', secret: 'x' })).toBe(view);
    });
});
