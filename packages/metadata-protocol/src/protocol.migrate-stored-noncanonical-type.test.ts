// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8957 — the stored migration stops calling a row it never looked at
 * `canonical`.
 *
 * ## The defect, as measured on `origin/main` before this pin existed
 *
 * `migrateStoredMetadata` opened every row with
 * `PLURAL_TO_SINGULAR[rawType] ?? rawType` — the MANIFEST-COLLECTION map, which
 * legitimately omits the types that are not stack collections. For a row stored
 * under one of their plural spellings the fold was a no-op, so the pass looked
 * up ADR-0087 body conversions registered for a type named `fields`, found
 * none, saw `changed === false`, and recorded the row `canonical`. `canonical`
 * is counted and never itemised — by design, because on a healthy deployment
 * that is every row — so the row vanished from `report.rows` entirely.
 *
 * `canonical` means "nothing to do", and there is something to do: the row sits
 * in a second namespace that no registry read and no compliance query on the
 * canonical type can reach. Since #8908 landed, `publishPackageDrafts` REFUSES
 * exactly these rows at its pre-flight (`STORED_TYPE_NOT_CANONICAL`) — so the
 * door an operator naturally reaches for after that refusal was the one that
 * told them the row was already fine. Two doors, one row, opposite answers.
 *
 * ## What is pinned here, and what is deliberately NOT
 *
 * Shape 1 of the card, and only shape 1: the scan gets the canonical fold it
 * lacked, and a row whose STORED spelling is non-canonical is reported
 * `skipped` WITH ITS REASON, so it lands in `report.rows`. The method's
 * contract is unchanged — it still canonicalizes BODIES and still writes
 * nothing for this class.
 *
 * ⛔ Shape 2 — rewriting the stored `type` — is an identity move (a new
 * `(org, type, name, package_id)` key, history and audit continuity, and a
 * collision question when the canonical row already exists). #8908's ruling
 * parked it as a follow-up needing its own appetite. The `writes nothing` case
 * below is the pin that keeps this pass from drifting into it: with the
 * canonical fold in place, a row that fell THROUGH the skip would be re-saved
 * under `saveMetaItem({ type: 'field' })` and perform that move by accident.
 *
 * ## Literals, not derivations
 *
 * Every expectation below is a literal string. The source derives the class
 * from the two maps (`isNonCanonicalStoredType`, #8908) precisely so it cannot
 * drift; a test that re-derived it from the same maps would agree with the
 * implementation by construction and prove nothing. Each refusal is therefore
 * paired with a positive control in the same describe — a genuinely canonical
 * row still reported `canonical`, and a manifest-PRESENT plural still behaving
 * exactly as it did — so a vacuous pass is impossible in either direction.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so this fake engine
// cannot accept a call the real ObjectQL engine refuses (#4550 delete / #5480
// update). Imported from `@objectstack/metadata-core` rather than
// `@objectstack/objectql`, which depends on this package.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { formatStoredMigrationReport, storedMigrationClean } from './stored-migration.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    checksum: string | null;
    metadata: string;
}

function matches(r: Record<string, any>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if ((r[k] ?? null) !== v) return false;
    }
    return true;
}

/**
 * The same multi-table stub as `protocol.stored-migration.test.ts`: rows are
 * seeded STRAIGHT into `sys_metadata`, bypassing `saveMetaItem`'s canonical-type
 * fold — which is the only way to produce this card's population at all. No
 * code path in the repository can mint a non-canonical stored `type` today
 * (#8908 enumerated them); the residue is historical, written before #7894
 * closed the plural `/meta` URL door.
 */
function makeStubEngine(
    seedRows: Array<Partial<Row> & { type: string; name: string; metadata: unknown }>,
) {
    let nextId = 0;
    const tables = new Map<string, Record<string, any>[]>();
    tables.set(
        'sys_metadata',
        seedRows.map((r) => ({
            id: `r_${++nextId}`,
            organization_id: null,
            package_id: null,
            state: 'active',
            checksum: `sha256:seed_${nextId}`,
            ...r,
            metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata),
        })),
    );
    const rowsOf = (t: string): Record<string, any>[] => {
        let rows = tables.get(t);
        if (!rows) tables.set(t, (rows = []));
        return rows;
    };

    const engine: any = {
        async find(t: string, opts?: { where?: Record<string, unknown> }) {
            return rowsOf(t).filter((r) => matches(r, opts?.where ?? {}));
        },
        async findOne(t: string, opts?: { where?: Record<string, unknown> }) {
            return rowsOf(t).find((r) => matches(r, opts?.where ?? {})) ?? null;
        },
        async insert(t: string, row: Record<string, any>) {
            const withId = { id: row.id ?? `r_${++nextId}`, ...row };
            rowsOf(t).push(withId);
            return withId;
        },
        async update(t: string, patch: Record<string, any>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(patch, opts);
            const target = rowsOf(t).find((r) => matches(r, opts.where));
            if (target) Object.assign(target, patch);
            return target ?? { id: 'x' };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            registerItem: () => { /* no-op */ },
            registerObject: () => { /* no-op */ },
        },
    };
    return { engine, tables };
}

const metaRows = (tables: Map<string, Record<string, any>[]>) => tables.get('sys_metadata')!;
const historyRows = (tables: Map<string, Record<string, any>[]>) =>
    tables.get('sys_metadata_history') ?? [];

/**
 * The residue: a field item persisted under `type='fields'`. `PUT
 * /meta/fields/…` answered 200 and wrote this row until #7894 closed that door;
 * `PUT /meta/field/…` answered 403 NOT_OVERRIDABLE the whole time.
 */
const storedFieldsRow = {
    type: 'fields',
    name: 'showcase_task.title',
    metadata: { name: 'title', type: 'text', label: 'Title' },
};

/** The positive control: an ordinary, genuinely canonical row. */
const canonicalObjectRow = {
    type: 'object',
    name: 'crm_quote',
    metadata: {
        name: 'crm_quote',
        label: 'Quote',
        fields: {
            status: { type: 'select', label: 'Status' },
            amount: { type: 'currency', label: 'Amount', requiredWhen: "record.status == 'sent'" },
        },
    },
};

/**
 * The boundary control: a pre-17 object body stored under the manifest-PRESENT
 * plural `objects`. Both maps fold it to `object`, so it is NOT this class and
 * must keep behaving exactly as it did — a `pending` conversion, not a skip.
 */
const legacyObjectsPluralRow = {
    type: 'objects',
    name: 'crm_invoice',
    metadata: {
        name: 'crm_invoice',
        label: 'Invoice',
        fields: {
            status: { type: 'select', label: 'Status' },
            amount: { type: 'currency', label: 'Amount', conditionalRequired: "record.status == 'sent'" },
        },
    },
};

describe('migrateStoredMetadata — a non-canonical stored `type` is reported, not counted canonical (#8957)', () => {
    it('reports the row `skipped`, in `report.rows`, instead of folding it into the `canonical` count', async () => {
        const { engine } = makeStubEngine([storedFieldsRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.scanned).toBe(1);
        expect(report.skipped).toBe(1);
        // The defect verbatim: this was 1 before the fix, with `rows` empty.
        expect(report.canonical).toBe(0);
        expect(report.rows).toHaveLength(1);
        expect(report.rows[0]).toMatchObject({
            type: 'field',
            name: 'showcase_task.title',
            outcome: 'skipped',
            state: 'active',
        });
    });

    it('names the stored spelling, the canonical type, the other door, and the way out', async () => {
        const { engine } = makeStubEngine([storedFieldsRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const reason = (await protocol.migrateStoredMetadata()).rows[0]!.reason ?? '';

        // The stored spelling, in the SAME `type/name` form the publish refusal
        // quotes — so an operator can text-match the two doors' output.
        expect(reason).toContain("stored under the non-canonical metadata type 'fields'");
        expect(reason).toContain("'fields/showcase_task.title'");
        expect(reason).toContain("its canonical type is 'field'");
        // Why this pass will not fix it, in the card's own terms.
        expect(reason).toContain('canonicalizes BODIES');
        expect(reason).toContain('identity move');
        expect(reason).toContain('(a new (org, type, name, package_id) key)');
        // The other door, by its wire-visible code, so the two agree.
        expect(reason).toContain('STORED_TYPE_NOT_CANONICAL');
        // The actionable path, identical to the one the publish refusal states.
        expect(reason).toContain("Re-author the item under 'field'");
        expect(reason).toContain('PUT /meta/field/showcase_task.title');
        expect(reason).toContain("drop the 'fields' row");
    });

    it('POSITIVE CONTROL — a genuinely canonical row in the same run is still `canonical`, still not itemised', async () => {
        const { engine } = makeStubEngine([storedFieldsRow, canonicalObjectRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.scanned).toBe(2);
        expect(report.canonical).toBe(1);
        expect(report.skipped).toBe(1);
        // Exactly one row itemised, and it is the residue — not the healthy one.
        expect(report.rows).toHaveLength(1);
        expect(report.rows[0]!.name).toBe('showcase_task.title');
    });

    it('covers every spelling of the class, including the two a hand-written list of four misses', async () => {
        // Literals on purpose. #8908 derived this class from the two maps and
        // measured it at SIX; the card that filed this defect named four.
        // `externalCatalogs` and `email_templates` are the two a list misses.
        const spellings: Array<[string, string]> = [
            ['fields', 'field'],
            ['seeds', 'seed'],
            ['external_catalogs', 'external_catalog'],
            ['externalCatalogs', 'external_catalog'],
            ['translations', 'translation'],
            ['email_templates', 'email_template'],
        ];
        const { engine } = makeStubEngine(
            spellings.map(([stored], i) => ({ type: stored, name: `residue_${i}`, metadata: { name: `residue_${i}` } })),
        );
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.scanned).toBe(6);
        expect(report.skipped).toBe(6);
        expect(report.canonical).toBe(0);
        for (const [i, [stored, canonical]] of spellings.entries()) {
            const row = report.rows[i]!;
            expect(row.outcome).toBe('skipped');
            expect(row.type).toBe(canonical);
            expect(row.reason).toContain(`type '${stored}'`);
            expect(row.reason).toContain(`canonical type is '${canonical}'`);
        }
    });

    it('BOUNDARY CONTROL — a manifest-PRESENT plural is not this class and converts exactly as before', async () => {
        // `objects` is folded by BOTH maps, so the canonical fold changed
        // nothing for it. Widening the skip over it would silence a real
        // conversion — this is the limb #8908 refused to drop, from the other
        // side.
        const { engine } = makeStubEngine([legacyObjectsPluralRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.skipped).toBe(0);
        expect(report.pending).toBe(1);
        const row = report.rows[0]!;
        expect(row).toMatchObject({ type: 'object', name: 'crm_invoice', outcome: 'pending' });
        expect(row.notices[0]!.from).toBe('conditionalRequired');
        expect(row.notices[0]!.to).toBe('requiredWhen');
    });

    it('⛔ an apply run writes NOTHING for it — the identity move stays unruled', async () => {
        const { engine, tables } = makeStubEngine([storedFieldsRow]);
        const before = JSON.stringify(metaRows(tables));
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.skipped).toBe(1);
        expect(report.rewritten).toBe(0);
        // The bytes are untouched: no canonical row minted, no `fields` row
        // rewritten, no history appended. A pass that fell through the skip
        // would re-save this body under `type: 'field'` and perform the very
        // move #8908's ruling parked.
        expect(JSON.stringify(metaRows(tables))).toBe(before);
        expect(metaRows(tables)).toHaveLength(1);
        expect(metaRows(tables)[0]!.type).toBe('fields');
        expect(historyRows(tables)).toHaveLength(0);
    });

    it('is reachable under BOTH spellings of `--type`, because the filter folds the same way', async () => {
        // An operator arrives here holding the spelling the publish refusal
        // quoted (`fields`); another holds the canonical one. Both are asking
        // about this row, and before the filter folded canonically the first
        // spelling was the only one that reached it.
        for (const types of [['field'], ['fields']]) {
            const { engine } = makeStubEngine([storedFieldsRow, canonicalObjectRow]);
            const protocol = new ObjectStackProtocolImplementation(engine);

            const report = await protocol.migrateStoredMetadata({ types });

            expect(report.scanned).toBe(1);
            expect(report.skipped).toBe(1);
            expect(report.rows[0]!.name).toBe('showcase_task.title');
        }
    });

    it('is judged on identity, before the body is read at all', async () => {
        // Ordering pin, not trivia: the verdict is about where the row LIVES,
        // which is decided without its body. An unparseable body on such a row
        // is still `skipped` for the namespace reason rather than `failed` for
        // the parse — a later refactor that moves the guard below the parse
        // changes that, and this case is what makes the change visible.
        const { engine } = makeStubEngine([{ ...storedFieldsRow, metadata: '{not json' }]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.failed).toBe(0);
        expect(report.skipped).toBe(1);
        expect(report.rows[0]!.reason).toContain('identity move');
    });
});

describe('the report a `skipped` residue row produces (#8957)', () => {
    it('prints under the skipped section, carrying its reason', async () => {
        const { engine } = makeStubEngine([storedFieldsRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const text = formatStoredMigrationReport(await protocol.migrateStoredMetadata()).join('\n');

        expect(text).toContain('1 row(s) are outside this pass');
        expect(text).toContain('field/showcase_task.title');
        expect(text).toContain("stored under the non-canonical metadata type 'fields'");
    });

    it('does NOT flip `storedMigrationClean` — the deliberate boundary between shape 1 and shape 2', async () => {
        // Not an oversight, and the reason is on `storedMigrationClean`'s doc:
        // this pass has no lever for the condition, so failing the verdict over
        // it would give `os migrate meta --stored` a non-zero exit that no run
        // of that command could ever clear. It reports, loudly and per row, and
        // the publish door is what refuses the row.
        const { engine } = makeStubEngine([storedFieldsRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(storedMigrationClean(report)).toBe(true);
        expect(report.rows).toHaveLength(1);
    });
});
