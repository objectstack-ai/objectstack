// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11014 — the Phase 3a-destructive gate's REACHABLE TYPE SET is `object`
 * alone, and this file is the measurement that says so.
 *
 * ## Why a type set needs a pin at all
 *
 * The gate in {@link ObjectStackProtocolImplementation.saveMetaItem} used to
 * open on `(singularType === 'object' || singularType === 'field')`. The
 * `field` limb could not produce a finding, so the condition made the gate's
 * coverage READ wider than it is — and that is not a cosmetic problem:
 * #10886's face inventory had to establish, per face, exactly which types can
 * reach this gate, and the `field` spelling is the one thing that made the
 * answer look bigger. An inventory that trusted the condition chased a face
 * population that does not exist.
 *
 * Deleting the limb fixes the reading once. This file is what stops it
 * growing back, because a condition is not self-documenting: the next author
 * to see `singularType === 'object'` next to a detector that says "field" in
 * every message has an obvious-looking one-word repair available.
 *
 * ## The two independent reasons, each with its own section
 *
 * Either alone is sufficient, so each is measured on its own rather than
 * folded into one end-to-end case.
 *
 *  - **Reason 1 (§2)** — a `field` body has NO `fields` map to diff.
 *    `detectDestructiveObjectChanges` reads `prev.fields` / `next.fields`; a
 *    `field` item's body IS one field definition (`FieldSchema`, a
 *    `strictObject` declaring no `fields` key), so both sides fold to `{}` and
 *    every loop in the detector iterates zero times.
 *  - **Reason 2 (§1)** — `field` cannot reach the gate at all under the
 *    default posture. The type is code-only in the `packages/spec` kernel
 *    registry (`allowRuntimeCreate: false` AND `allowOrgOverride: false`), so
 *    the #5086 refusal one gate up answers first.
 *
 * ## ⚠️ Where each reason STOPS — measured, and the reason the trim is right
 *
 * Both reasons were re-measured before the trim and neither is absolute. That
 * is recorded here rather than smoothed over, because a future reader who
 * finds the boundary on their own will otherwise read it as a defect:
 *
 *  - Reason 2 stops at the documented operator hatch. `OS_METADATA_WRITABLE=field`
 *    DOES carry a `field` write past the code-only refusal and into this gate
 *    (§2 drives exactly that door) — reason 1 then holds it inert on its own.
 *  - Reason 1 stops at SCHEMA-VALID bodies. The detector is type-agnostic, so
 *    a stored `field` row carrying a `fields` map did fire the gate. §3 pins
 *    what such a body is: one `FieldSchema` REJECTS (`unrecognized_keys:
 *    ['fields']`) — corruption, not authoring — whose finding named columns
 *    that do not exist, since a `field` write mints a standalone
 *    `sys_metadata` row nothing composes into its parent object (#7893).
 *
 * So the limb's only reachable behaviour was a false data-loss alarm behind a
 * double fault. Trimming removes no coverage; §3 records the one behaviour
 * delta so it is a decision on the record and not a surprise.
 *
 * ## ⭐ Every "no 409" assertion here is paired with a LIVE CONTROL
 *
 * A test that asserts a refusal does NOT happen is green when the harness
 * never reaches the gate at all — the exact false green this card is about, in
 * miniature. So §0 proves the harness raises the real 409, and §2 re-proves it
 * inside the hatch-open environment where the `field` case runs. Without those
 * controls the `field` cases pin nothing.
 *
 * ## Assertion discipline
 *
 * ⛔ Never a bare `toThrow()`: every refusal asserts `code` + `status` (the
 * ADR-0112 envelope), with message text on top only where the wording is the
 * contract being held. And every refusal case asserts NOTHING WAS PERSISTED —
 * "refused after writing" is a log line, not a gate.
 *
 * The subject is imported as `./protocol.js`, a RELATIVE source specifier, so
 * vitest resolves it to `src/protocol.ts` with no `dist/` on the path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decision (#5480), so the fake
// engine below cannot accept an `update` call ObjectQL itself refuses.
// Imported from `@objectstack/metadata-core`, ⛔ never from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import { assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
// Reason 1 is a claim about the AUTHORABLE SHAPE of a `field` body, so it is
// asserted against the schema itself rather than restated in prose here.
import { FieldSchema } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

// ---------------------------------------------------------------------------
// Harness — a `sys_metadata`-backed kernel, the shape the #10886 face
// inventory uses. `update` is present because §2's hatch-open cases really do
// PERSIST (that is what "the write got past reason 2" means), and it routes
// through the producer's predicate for the reason above. `delete` is
// deliberately absent: no case here reaches it, and a double implementing a
// verb its subject never calls is dead code that also has to be pinned.
// ---------------------------------------------------------------------------

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum: string;
    version?: number;
}

const row = (o: Partial<Row> & { type: string; name: string }): Row => ({
    id: `row_${o.type}_${o.name}`,
    organization_id: null,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify({ name: o.name }),
    checksum: 'sha256_11014_fixture',
    version: 1,
    ...o,
});

/** The parent object and the field addressed under it — `<object>.<field>`. */
const PARENT = 'crm_task';
const FIELD = 'zz_probe';
const DOTTED = `${PARENT}.${FIELD}`;

/**
 * A stored `field` row whose body is what `FieldSchema` actually describes: a
 * single field definition, with no container of its own.
 */
const fieldRow = (type: string): Row => row({
    type: 'field',
    name: DOTTED,
    metadata: JSON.stringify({ name: FIELD, label: 'Probe', type }),
});

/** An `object` row carrying a real `fields` map — the only diffable shape. */
const objectRow = (name: string, fields: readonly string[]): Row => row({
    type: 'object',
    name,
    metadata: JSON.stringify({
        name,
        label: name,
        fields: Object.fromEntries(fields.map((f) => [f, { name: f, type: 'text' }])),
    }),
});

function makeKernel(seed: Row[] = [], artifacts: Record<string, unknown> = {}) {
    const rows = new Map<string, Row>();
    for (const r of seed) rows.set(r.id, r);
    /** Every `sys_metadata` mutation the engine was asked for, in order. */
    const writes: Array<{ op: 'insert' | 'update'; table: string }> = [];

    const match = (r: Row, where: Record<string, unknown>): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k === '$or') return (v as Array<Record<string, unknown>>).some((c) => match(r, c));
            return v === null || v === undefined
                ? (r as any)[k] === null || (r as any)[k] === undefined
                : (r as any)[k] === v;
        });

    const engine: any = {
        async find(table: string, o?: { where?: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => match(r, o?.where ?? {}));
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table !== 'sys_metadata') return null;
            for (const r of rows.values()) if (match(r, o?.where ?? {})) return r;
            return null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            writes.push({ op: 'insert', table });
            if (table === 'sys_metadata') {
                const r = { ...(data as any) } as Row;
                r.id = String(data.id ?? `r_${rows.size}`);
                rows.set(r.id, r);
            }
            return { id: String(data.id ?? 'r_new') };
        },
        async update(table: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            writes.push({ op: 'update', table });
            return { id: null };
        },
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined,
            // A hit here means the name is shipped by a code package.
            getArtifactItem: (t: string, n: string) => artifacts[`${t}|${n}`],
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
        },
    };

    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, rows, writes };
}

/** The artifact registry entry that makes `crm_task.zz_probe` a PACKAGED field. */
const PACKAGED_PARENT = {
    [`object|${PARENT}`]: {
        name: PARENT,
        _packageId: 'showcase',
        fields: { [FIELD]: { name: FIELD, type: 'text' } },
    },
};

/** Drive the real producer and report the outcome without deciding it. */
async function save(protocol: any, request: Record<string, unknown>): Promise<
    { outcome: 'resolved'; value: any } | { outcome: 'threw'; error: any }
> {
    try {
        return { outcome: 'resolved', value: await protocol.saveMetaItem(request) };
    } catch (error: any) {
        return { outcome: 'threw', error };
    }
}

/**
 * Only the rows a case actually WROTE — the seed is not evidence of a write.
 * Generic so a caller keeps its own row shape: narrowing the parameter to
 * `{ table: string }` would erase the `op` a caller asserts on.
 */
const metadataWrites = <T extends { table: string }>(writes: readonly T[]): T[] =>
    writes.filter((w) => w.table === 'sys_metadata');

function openOperatorHatch() {
    process.env.OS_METADATA_WRITABLE = 'field';
    // Two memoised readers of the same env var — the protocol's gate and the
    // repository's `assertAllowed`. Both must be reset or the second answers
    // from a stale parse.
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
}

beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

// ═══════════════════════════════════════════════════════════════════════════
// 0. CONTROL — the harness really does reach the gate
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11014 §0 CONTROL] the gate fires for `object` through this harness', () => {
    it('refuses a field-dropping `object` save with the ADR-0112 envelope', async () => {
        const { protocol } = makeKernel([objectRow(PARENT, ['a', 'b'])]);

        const r = await save(protocol, {
            type: 'object',
            name: PARENT,
            item: { name: PARENT, label: PARENT, fields: { a: { name: 'a', type: 'text' } } },
        });

        expect(r.outcome, 'the destructive `object` save was accepted').toBe('threw');
        const err = (r as { error: any }).error;
        expect(err.code).toBe('DESTRUCTIVE_CHANGE');
        expect(err.status).toBe(409);
        expect(err.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'field_removed', field: 'b' }),
        ]));
        // ⭐ Without this case green, every "no DESTRUCTIVE_CHANGE" assertion
        // below is satisfied by a harness that never reached the gate.
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. REASON 2 — under the default posture a `field` write never gets here
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11014 §1 reason 2] `field` is refused BEFORE the destructive gate', () => {
    it('a `field` create is refused NOT_CREATABLE with nothing persisted', async () => {
        const { protocol, writes } = makeKernel();

        const r = await save(protocol, {
            type: 'field',
            name: DOTTED,
            item: { name: FIELD, label: 'Probe', type: 'text' },
        });

        expect(r.outcome).toBe('threw');
        const err = (r as { error: any }).error;
        expect(err.code).toBe('NOT_CREATABLE');
        expect(err.status).toBe(403);
        // The refusal names the registry declaration it acted on, so an author
        // can tell it apart from the destructive gate without reading source.
        expect(err.message).toContain('allowRuntimeCreate=false');
        expect(metadataWrites(writes)).toEqual([]);
    });

    /**
     * ⭐ The case that matters most: an EXISTING row under the target name is
     * one of the gate's own preconditions (`prev` must be non-null), so this
     * is the configuration in which the gate would fire if `field` could
     * reach it. It is still refused one gate earlier.
     */
    it('a `field` UPDATE over an existing row is refused before the diff runs', async () => {
        const { protocol, writes } = makeKernel([fieldRow('text')]);

        const r = await save(protocol, {
            type: 'field',
            name: DOTTED,
            // `text` → `number` is `field_type_change` when it happens inside
            // an object body — the diff this gate exists to catch.
            item: { name: FIELD, label: 'Probe', type: 'number' },
        });

        expect(r.outcome).toBe('threw');
        const err = (r as { error: any }).error;
        expect(err.code).toBe('NOT_CREATABLE');
        expect(err.status).toBe(403);
        // ⭐ Not a 409. The refusal came from the code-only registry consult,
        // not from the destructive diff.
        expect(err.code).not.toBe('DESTRUCTIVE_CHANGE');
        expect(metadataWrites(writes)).toEqual([]);
    });

    /**
     * The second refusal shape reason 2 wears. #7743's `isNestedArtifactField`
     * classifies a `field` whose parent object IS artifact-backed as an
     * OVERLAY rather than a create, so it earns a different code — and lands
     * just as far above this gate.
     */
    it('a `field` under an ARTIFACT-BACKED parent is refused NOT_OVERRIDABLE', async () => {
        const { protocol, writes } = makeKernel([fieldRow('text')], PACKAGED_PARENT);

        const r = await save(protocol, {
            type: 'field',
            name: DOTTED,
            item: { name: FIELD, label: 'Probe', type: 'number' },
        });

        expect(r.outcome).toBe('threw');
        const err = (r as { error: any }).error;
        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(err.status).toBe(403);
        expect(err.code).not.toBe('DESTRUCTIVE_CHANGE');
        expect(metadataWrites(writes)).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. REASON 1 — past reason 2, the diff still has nothing to find
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11014 §2 reason 1] a `field` body has no `fields` map to diff', () => {
    /**
     * `OS_METADATA_WRITABLE=field` is the ONE documented door that gets a
     * `field` write past §1 — the code-only refusal names it in its own
     * message as the operator escape hatch. Driving it here is what makes
     * reason 1 an INDEPENDENT measurement instead of a claim shadowed by
     * reason 2.
     */
    it('the operator hatch really does carry a `field` write past reason 2', async () => {
        openOperatorHatch();
        const { protocol, writes } = makeKernel([fieldRow('text')]);

        const r = await save(protocol, {
            type: 'field',
            name: DOTTED,
            item: { name: FIELD, label: 'Probe', type: 'number' },
        });

        // It persisted — so the request reached, and passed, the gate.
        expect(r.outcome, 'the hatch did not open the door — §2 below would be vacuous').toBe('resolved');
        expect(metadataWrites(writes).map((w) => w.op)).toContain('update');
    });

    it('⭐ a `text` → `number` change on a `field` produces NO destructive finding', async () => {
        openOperatorHatch();
        const { protocol } = makeKernel([fieldRow('text')]);

        const r = await save(protocol, {
            type: 'field',
            name: DOTTED,
            item: { name: FIELD, label: 'Probe', type: 'number' },
        });

        expect(r.outcome).toBe('resolved');
        // The same edit INSIDE an object body is `field_type_change`. Here the
        // detector reads `prev.fields` / `next.fields`, both absent, and
        // returns `[]`.
    });

    /**
     * ⭐ The control for the case above, in the SAME environment. An assertion
     * that a 409 did not happen is worthless if the hatch-open environment
     * cannot raise one at all.
     */
    it('[CONTROL] the same environment still refuses a destructive `object` save', async () => {
        openOperatorHatch();
        const { protocol } = makeKernel([objectRow(PARENT, ['a', 'b'])]);

        const r = await save(protocol, {
            type: 'object',
            name: PARENT,
            item: { name: PARENT, label: PARENT, fields: { a: { name: 'a', type: 'text' } } },
        });

        expect(r.outcome).toBe('threw');
        expect((r as { error: any }).error.code).toBe('DESTRUCTIVE_CHANGE');
        expect((r as { error: any }).error.status).toBe(409);
    });

    /**
     * The shape claim reason 1 rests on, asserted against the schema rather
     * than restated in prose. A `field` body that PARSES carries no `fields`
     * key, so `detectDestructiveObjectChanges` has nothing to read — and that
     * stays true only while `FieldSchema` stays a container-free definition.
     */
    it('`FieldSchema` accepts a field body and declares no `fields` key', () => {
        const body = { name: FIELD, label: 'Probe', type: 'text' as const };
        // Full parse: the claim is about a body being VALID, not merely
        // key-recognised.
        expect(FieldSchema.safeParse(body).success).toBe(true);

        const withContainer = { ...body, fields: { a: { name: 'a', type: 'text' } } };
        const rejected = FieldSchema.safeParse(withContainer);
        expect(rejected.success).toBe(false);
        // The KEY claim — `fields` is not part of this surface at all.
        expect(
            rejected.success ? [] : rejected.error.issues.map((i: any) => i.code),
        ).toContain('unrecognized_keys');
        expect(
            rejected.success ? [] : rejected.error.issues.flatMap((i: any) => i.keys ?? []),
        ).toContain('fields');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE ONE BEHAVIOUR DELTA — recorded, not smoothed over
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11014 §3] the double fault the trimmed limb used to catch', () => {
    /**
     * Before the trim, a stored `field` row carrying a `fields` map DID fire
     * the gate (the detector is type-agnostic — it reads `prev.fields`
     * whatever the type is). Reaching that needed two faults at once: the
     * operator hatch open, AND a stored body `FieldSchema` rejects.
     *
     * That refusal was a FALSE alarm and removing it is the point, not a
     * regression: a `field` write mints a standalone `sys_metadata` row that
     * nothing composes into its parent object (#7893), so the "existing data
     * in this column" the finding names was never materialised by any driver.
     *
     * Pinned so the delta is on the record: if a future change makes `field`
     * runtime-writable, this case is the one that must be revisited — and at
     * that point the answer is a real destructive diff for `field`, filed as a
     * Feature, not this limb restored.
     */
    it('a corrupt `field` body with a `fields` map now saves instead of 409-ing', async () => {
        openOperatorHatch();
        const corrupt = row({
            type: 'field',
            name: DOTTED,
            metadata: JSON.stringify({
                name: FIELD, label: 'Probe', type: 'text',
                fields: { a: { name: 'a', type: 'text' }, b: { name: 'b', type: 'text' } },
            }),
        });
        const { protocol } = makeKernel([corrupt]);

        const r = await save(protocol, {
            type: 'field',
            name: DOTTED,
            item: { name: FIELD, label: 'Probe', type: 'text' },
        });

        expect(r.outcome).toBe('resolved');
    });

    it('…and that stored body is one `FieldSchema` refuses, i.e. corruption', () => {
        const stored = {
            name: FIELD, label: 'Probe', type: 'text',
            fields: { a: { name: 'a', type: 'text' }, b: { name: 'b', type: 'text' } },
        };
        // No authoring path produces this body — which is why the finding it
        // used to raise could never be acted on by the author it was shown to.
        expect(FieldSchema.safeParse(stored).success).toBe(false);
    });
});
