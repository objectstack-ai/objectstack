// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14389 — `classifyDataError`'s arm for the engine's insert-conflict envelope.
 *
 * ## What was measured
 *
 * Since #14095 `engine.insert` refuses a driver's unique violation with the
 * `DuplicateRecordError` envelope: `code: 'DUPLICATE_RECORD'`, `status: 409`,
 * `object`, `field` when the dialect determinably named the column, and the
 * driver error whole on `cause`. Because the envelope DECLARES a status,
 * `classifyDataError` answered it from the generic declared-status
 * passthrough — 409, but `code: 'DUPLICATE_RECORD'`, no `field`, and the
 * engine's own sentence in `error` — and the `isUniqueViolationError` arm that
 * curates the end-user sentence and names the column (#6250 / #7821) was never
 * reached for an insert conflict any more. Measured on `origin/main` @
 * `ed44512199`, real engine, real drivers, the real `mapDataError`, the same
 * conflict handed to the boundary as the raw driver error (BEFORE) and as the
 * envelope that now carries it (AFTER):
 *
 *   driver-sqlite-wasm, single column
 *     BEFORE 409 UNIQUE_VIOLATION  field=email  "A record with this email already exists"
 *     AFTER  409 DUPLICATE_RECORD  (no field)   "Duplicate record refused on 'duly_note': …"
 *   driver-sqlite-wasm, composite    BEFORE/AFTER both carry no `field` — by contract
 *   driver-memory, single column
 *     BEFORE 409 UNIQUE_VIOLATION  (no field)   the driver's OWN message, which quotes the
 *                                               offending value as JSON, through the passthrough
 *     AFTER  409 DUPLICATE_RECORD  (no field)   the engine's sentence, no value
 *
 * ## What this file pins
 *
 *  §1 the wire body, through the real `mapDataError`, for a REAL envelope
 *     (the engine's own class, wrapping each dialect's measured raw error);
 *  §2 the same, end to end: a real `ObjectQL` on a real `@objectstack/driver-sql`
 *     (better-sqlite3 `:memory:`) with a real UNIQUE index, insert twice;
 *  §3 parity with the pre-#14095 body — for one conflict, the envelope and the
 *     raw driver error it carries answer the same status / code / field /
 *     sentence / object, which is the whole of what "restoration" means;
 *  §4 the `driver-memory` control: no offending value reaches the wire, on the
 *     shape whose raw refusal used to put one there;
 *  §5 the gate is the ENVELOPE, not the registered code: a sandbox body that
 *     throws `DUPLICATE_RECORD` itself keeps the answer it gets today.
 *
 * Refusal assertions state `code` AND `status` (ADR-0112) — never `toThrow()`
 * alone, which is green for the envelope and for a raw driver error alike.
 *
 * ⚠️ `declaredCode` on this body is a vocabulary MEMBER. The triage ruling on
 * the card (2026-09-02) keeps `UNIQUE_VIOLATION` on the wire and carries the
 * producer's spelling beside it in `declaredCode`; `ApiErrorSchema.declaredCode`
 * and ADR-0112's 2026-08-16 amendment define the field's presence as the
 * DEMOTION of an UNREGISTERED spelling. §0 controls that both codes are
 * registered so the contradiction is stated by a measurement, not assumed; the
 * ruling is pinned as written and the contract question is the review's.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ErrorCode } from '@objectstack/spec/api';
import { uniqueViolationColumn } from '@objectstack/types';
import { ObjectQL, DuplicateRecordError } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { mapDataError } from './error-response.js';

/**
 * A value no fixture, sentence or identifier in this file otherwise contains,
 * so `not.toContain(VALUE)` can only be satisfied by withholding it.
 */
const VALUE = 'zq7-distinctive-value@example.test';
/** The index name the SQL dialects put in their prose — never a column. */
const INDEX = 'idx_duly_note_email';

const CURATED_NAMED = 'A record with this email already exists';
const CURATED_UNNAMED = 'A record with this value already exists';

/* --------------------------------------------------------------------------
 * The measured raw driver errors, each the shape the real driver emitted.
 * ----------------------------------------------------------------------- */

/** better-sqlite3 / sqlite-wasm via knex: names the COLUMN, behind the compiled statement. */
const sqliteRaw = () =>
    Object.assign(
        new Error(
            'insert into `duly_note` (`email`, `id`, `title`) values (?, ?, ?) returning * - ' +
                'UNIQUE constraint failed: duly_note.email',
        ),
        { code: 'SQLITE_CONSTRAINT_UNIQUE' },
    );

/** sqlite over a composite index: two columns, so no single column to name. */
const sqliteCompositeRaw = () =>
    Object.assign(new Error('UNIQUE constraint failed: duly_pair.tenant, duly_pair.email'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE',
    });

/** node-postgres: the column is on `detail`, with the VALUE beside it. */
const postgresRaw = () =>
    Object.assign(new Error(`duplicate key value violates unique constraint "${INDEX}"`), {
        code: '23505',
        detail: `Key (email)=(${VALUE}) already exists.`,
    });

/** mysql2: names the INDEX and the VALUE; `uniqueViolationColumn` refuses the index. */
const mysqlRaw = () =>
    Object.assign(new Error(`Duplicate entry '${VALUE}' for key '${INDEX}'`), {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
    });

/**
 * driver-memory (#13197): already an ADR-0112 envelope of its own —
 * `UNIQUE_VIOLATION` / 409 — whose sentence quotes the offending value as JSON.
 * Measured template, byte for byte (`memory-unique-constraint.ts`).
 */
const memoryRaw = () =>
    Object.assign(
        new Error(
            'Unique constraint violated on `duly_note.email`: a record with the value ' +
                `${JSON.stringify(VALUE)} already exists. No record was written.`,
        ),
        { code: 'UNIQUE_VIOLATION', status: 409 },
    );

/** driver-memory over a declared composite index: every key value, as a JSON object. */
const memoryCompositeRaw = () =>
    Object.assign(
        new Error(
            'Unique constraint violated on `duly_pair` over (`tenant`, `email`): a record with the values ' +
                `${JSON.stringify({ tenant: 'acme', email: VALUE })} already exists. No record was written.`,
        ),
        { code: 'UNIQUE_VIOLATION', status: 409 },
    );

/**
 * The envelope exactly as `engine.insert` builds it: the engine's class, the
 * raw error whole on `cause`, and `field` resolved by the same helper the
 * engine calls — never a hand-picked column, so the fixture cannot claim a
 * field the engine would not have named.
 */
function envelope(object: string, raw: Error): DuplicateRecordError {
    return new DuplicateRecordError(object, raw, uniqueViolationColumn(raw));
}

interface Leg {
    readonly label: string;
    readonly object: string;
    readonly raw: () => Error;
    /** The column the envelope carries, or `undefined` when it must carry none. */
    readonly field: string | undefined;
}

const LEGS: readonly Leg[] = [
    { label: 'sqlite, single column', object: 'duly_note', raw: sqliteRaw, field: 'email' },
    { label: 'sqlite, composite index', object: 'duly_pair', raw: sqliteCompositeRaw, field: undefined },
    { label: 'postgres, column on DETAIL', object: 'duly_note', raw: postgresRaw, field: 'email' },
    { label: 'mysql, index name only', object: 'duly_note', raw: mysqlRaw, field: undefined },
    { label: 'driver-memory, single column', object: 'duly_note', raw: memoryRaw, field: undefined },
    { label: 'driver-memory, composite index', object: 'duly_pair', raw: memoryCompositeRaw, field: undefined },
];

const NAMED = LEGS.filter((l) => l.field !== undefined);
const UNNAMED = LEGS.filter((l) => l.field === undefined);

/* --------------------------------------------------------------------------
 * §0 — controls that make the rest of the file evidence
 * ----------------------------------------------------------------------- */

describe('#14389 §0 — controls', () => {
    it('both halves of the table are populated', () => {
        expect(NAMED.length).toBeGreaterThan(0);
        expect(UNNAMED.length).toBeGreaterThan(0);
    });

    it('the fixtures resolve the field the engine would — not the one this file wants', () => {
        for (const leg of LEGS) expect(uniqueViolationColumn(leg.raw())).toBe(leg.field);
    });

    it('the fixture is the engine\'s envelope: registered code, declared 409, cause whole', () => {
        const raw = sqliteRaw();
        const env = envelope('duly_note', raw);
        expect(env).toBeInstanceOf(DuplicateRecordError);
        expect(env.name).toBe('DuplicateRecordError');
        expect(env.code).toBe('DUPLICATE_RECORD');
        expect(env.status).toBe(409);
        expect(env.cause).toBe(raw);
        expect(env.field).toBe('email');
    });

    it('BOTH codes are vocabulary members — the `declaredCode` reading below is measured, not assumed', () => {
        expect(ErrorCode.safeParse('UNIQUE_VIOLATION').success).toBe(true);
        expect(ErrorCode.safeParse('DUPLICATE_RECORD').success).toBe(true);
    });
});

/* --------------------------------------------------------------------------
 * §1 — the wire body, through the real `mapDataError`
 * ----------------------------------------------------------------------- */

describe('#14389 §1 — the engine\'s DUPLICATE_RECORD envelope answers 409 UNIQUE_VIOLATION with `field` restored', () => {
    it.each(NAMED.map((l) => [l.label, l] as const))('%s: names the field and curates the sentence', (_n, leg) => {
        const env = envelope(leg.object, leg.raw());
        const r = mapDataError(env, leg.object);

        // `code` AND `status` — never "it stopped being the passthrough".
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('UNIQUE_VIOLATION');
        expect(r.body.field).toBe(leg.field);
        expect(r.body.error).toBe(`A record with this ${leg.field} already exists`);
        expect(r.body.object).toBe(leg.object);
    });

    it.each(UNNAMED.map((l) => [l.label, l] as const))('%s: degrades to the unnamed sentence and NO `field` key', (_n, leg) => {
        const env = envelope(leg.object, leg.raw());
        const r = mapDataError(env, leg.object);

        expect(r.status).toBe(409);
        expect(r.body.code).toBe('UNIQUE_VIOLATION');
        // `not.toHaveProperty`, not `toBeUndefined`: a `field: null` or
        // `field: ''` on the wire is the same defect in a different type.
        expect(r.body).not.toHaveProperty('field');
        expect(r.body.error).toBe(CURATED_UNNAMED);
    });

    it('the producer\'s spelling rides beside the wire code as `declaredCode` (triage ruling, as written)', () => {
        const r = mapDataError(envelope('duly_note', sqliteRaw()), 'duly_note');
        expect(r.body.code).toBe('UNIQUE_VIOLATION');
        expect(r.body.declaredCode).toBe('DUPLICATE_RECORD');
    });

    it('the DELETE_RESTRICTED split: curated sentence on `error`, the engine\'s sentence on `developerMessage`', () => {
        const env = envelope('duly_note', sqliteRaw());
        const r = mapDataError(env, 'duly_note');

        expect(r.body.error).toBe(CURATED_NAMED);
        expect(r.body.developerMessage).toBe(env.message);
        expect(r.body.developerMessage).toBe(
            "Duplicate record refused on 'duly_note': a unique constraint on 'email' already holds this value. " +
                'No record was written.',
        );
        // The envelope's OWN `developerMessage` addresses the in-process caller
        // of `engine.insert` ("attached as `cause`", "branch on `code ===
        // 'DUPLICATE_RECORD'`") and neither holds on this wire — it is not
        // relayed.
        expect(r.body.developerMessage).not.toBe(env.developerMessage);
        expect(String(r.body.developerMessage)).not.toContain('cause');
    });

    it('the body is exactly these keys — nothing from the envelope rides that is not named here', () => {
        const env = envelope('duly_note', sqliteRaw());
        expect(mapDataError(env, 'duly_note').body).toEqual({
            error: CURATED_NAMED,
            code: 'UNIQUE_VIOLATION',
            declaredCode: 'DUPLICATE_RECORD',
            developerMessage: env.message,
            field: 'email',
            object: 'duly_note',
        });
        // …and the unnamed shape drops exactly one of them.
        const composite = envelope('duly_pair', sqliteCompositeRaw());
        expect(mapDataError(composite, 'duly_pair').body).toEqual({
            error: CURATED_UNNAMED,
            code: 'UNIQUE_VIOLATION',
            declaredCode: 'DUPLICATE_RECORD',
            developerMessage: composite.message,
            object: 'duly_pair',
        });
    });

    it('`object` is the object the engine refused — present even when the route named none', () => {
        const env = envelope('duly_note', sqliteRaw());
        expect(mapDataError(env).body.object).toBe('duly_note');
        expect(mapDataError(env, 'duly_note').body.object).toBe('duly_note');
    });

    it.each(LEGS.map((l) => [l.label, l] as const))('%s: the body echoes nothing the driver said', (_n, leg) => {
        const raw = leg.raw();
        const wire = JSON.stringify(mapDataError(envelope(leg.object, raw), leg.object).body);

        expect(wire).not.toContain(VALUE);
        expect(wire).not.toContain(INDEX);
        expect(wire).not.toContain(raw.message);
        expect(wire.toLowerCase()).not.toContain('insert into');
        expect(wire).not.toContain('duly_note.email');
        expect(wire).not.toContain('duly_pair.tenant');
    });

    it('the sentence is assembled from fixed text — exactly two sentences, one bare identifier apart', () => {
        const sentences = new Set(LEGS.map((l) => String(mapDataError(envelope(l.object, l.raw()), l.object).body.error)));
        expect(sentences).toEqual(new Set([CURATED_NAMED, CURATED_UNNAMED]));
    });
});

/* --------------------------------------------------------------------------
 * §2 — end to end: real engine, real SQL driver, real UNIQUE index
 * ----------------------------------------------------------------------- */

const SINGLE = {
    name: 'duly_note', label: 'Duly note', systemFields: false,
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        title: { name: 'title', type: 'text' as const, label: 'Title' },
        email: { name: 'email', type: 'text' as const, label: 'Email', unique: true },
    },
};

const COMPOSITE = {
    name: 'duly_pair', label: 'Duly pair', systemFields: false,
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        tenant: { name: 'tenant', type: 'text' as const, label: 'Tenant' },
        email: { name: 'email', type: 'text' as const, label: 'Email' },
    },
    indexes: [{ name: 'idx_duly_pair', fields: ['tenant', 'email'], unique: true }],
};

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** The rejection, as the value the caller actually receives — never `toThrow()`. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    return run().then(
        () => { throw new Error('expected the insert to be refused'); },
        (e) => e as any,
    );
}

async function conflictOn(schema: typeof SINGLE | typeof COMPOSITE, row: Record<string, unknown>) {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
        true,
    );
    await engine.init();
    engine.registry.registerObject(schema as any);
    await engine.syncSchemas();
    await engine.insert(schema.name, { id: 'r1', ...row });
    return refusalOf(() => engine.insert(schema.name, { id: 'r2', ...row }));
}

describe('#14389 §2 — a real insert conflict, real engine on real better-sqlite3, through the real boundary', () => {
    it('single-column UNIQUE index: 409 UNIQUE_VIOLATION, `field: "email"`, both sentences, no value', async () => {
        const env = await conflictOn(SINGLE, { title: 't', email: VALUE });

        // The engine's half, restated so a red below is attributable.
        expect(env.code).toBe('DUPLICATE_RECORD');
        expect(env.status).toBe(409);
        expect(env.field).toBe('email');
        expect(String(env.cause?.message)).toContain(VALUE); // the leak the boundary must withhold

        const r = mapDataError(env, 'duly_note');
        expect(r.status).toBe(409);
        expect(r.body).toEqual({
            error: CURATED_NAMED,
            code: 'UNIQUE_VIOLATION',
            declaredCode: 'DUPLICATE_RECORD',
            developerMessage: env.message,
            field: 'email',
            object: 'duly_note',
        });
        expect(JSON.stringify(r.body)).not.toContain(VALUE);
    }, 60_000);

    it('composite UNIQUE index: 409 UNIQUE_VIOLATION, the unnamed sentence, NO `field` key', async () => {
        const env = await conflictOn(COMPOSITE, { tenant: 'acme', email: VALUE });

        expect(env.code).toBe('DUPLICATE_RECORD');
        expect(env.status).toBe(409);
        expect(env.field).toBeUndefined();

        const r = mapDataError(env, 'duly_pair');
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('UNIQUE_VIOLATION');
        expect(r.body).not.toHaveProperty('field');
        expect(r.body.error).toBe(CURATED_UNNAMED);
        expect(JSON.stringify(r.body)).not.toContain(VALUE);
        expect(JSON.stringify(r.body)).not.toContain('acme');
    }, 60_000);
});

/* --------------------------------------------------------------------------
 * §3 — restoration means parity with the body the raw driver error produced
 * ----------------------------------------------------------------------- */

describe('#14389 §3 — the envelope and the raw error it carries answer the same status / code / field / sentence', () => {
    // The raw error still reaches this boundary from engine-direct callers and
    // from every write door that is not `insert` (#14390 is the `update` door),
    // through the untouched `isUniqueViolationError` arm. For ONE conflict the
    // two must agree, or the platform gives two answers to one constraint
    // depending on whether the engine happened to envelope it.
    it.each(LEGS.filter((l) => l.raw().code !== 'UNIQUE_VIOLATION').map((l) => [l.label, l] as const))(
        '%s',
        (_n, leg) => {
            const raw = leg.raw();
            const before = mapDataError(raw, leg.object);
            const after = mapDataError(envelope(leg.object, raw), leg.object);

            expect(before.status).toBe(409);
            expect(before.body.code).toBe('UNIQUE_VIOLATION');
            expect(after.status).toBe(before.status);
            expect(after.body.code).toBe(before.body.code);
            expect(after.body.error).toBe(before.body.error);
            expect(after.body.object).toBe(before.body.object);
            expect(after.body.field).toBe(before.body.field);
            expect('field' in after.body).toBe('field' in before.body);
        },
    );

    it('the raw error\'s arm is untouched: no `declaredCode`, no `developerMessage` on the pre-existing body', () => {
        const before = mapDataError(sqliteRaw(), 'duly_note');
        expect(before.body).toEqual({
            error: CURATED_NAMED,
            code: 'UNIQUE_VIOLATION',
            field: 'email',
            object: 'duly_note',
        });
    });
});

/* --------------------------------------------------------------------------
 * §4 — the driver-memory control
 * ----------------------------------------------------------------------- */

describe('#14389 §4 — driver-memory: the value its raw refusal quoted never reaches the wire', () => {
    it('the raw refusal really does carry the value — the control is live', () => {
        expect(memoryRaw().message).toContain(VALUE);
        expect(memoryCompositeRaw().message).toContain(`"email":${JSON.stringify(VALUE)}`);
    });

    it('single column: 409 UNIQUE_VIOLATION, curated sentence, no value, no field (the dialect names none)', () => {
        const env = envelope('duly_note', memoryRaw());
        const r = mapDataError(env, 'duly_note');

        expect(r.status).toBe(409);
        expect(r.body.code).toBe('UNIQUE_VIOLATION');
        expect(r.body.error).toBe(CURATED_UNNAMED);
        expect(r.body).not.toHaveProperty('field');
        expect(JSON.stringify(r.body)).not.toContain(VALUE);
    });

    it('composite: the JSON object of key values is withheld whole', () => {
        const env = envelope('duly_pair', memoryCompositeRaw());
        const wire = JSON.stringify(mapDataError(env, 'duly_pair').body);

        expect(wire).not.toContain(VALUE);
        expect(wire).not.toContain('acme');
        expect(wire).not.toContain('"tenant"');
    });
});

/* --------------------------------------------------------------------------
 * §5 — the gate is the envelope, not the registered code
 * ----------------------------------------------------------------------- */

describe('#14389 §5 — a producer that merely SPEAKS `DUPLICATE_RECORD` is not the engine\'s envelope', () => {
    // The two structured 409s beside this arm relay `error.message`, so keying
    // on `code` alone costs a hook nothing. This arm REPLACES the sentence, so
    // it fires only for the producer whose sentence it curates: the engine's
    // class. A sandbox body throwing the registered code keeps the answer the
    // sandbox unwrap door gives it today — its own sentence, its own code
    // verbatim (`rest-thrown-code-vocabulary.test.ts` §2) — and never gets the
    // QuickJS debug wrapper shipped as `developerMessage`.
    it('a sandbox body throwing `DUPLICATE_RECORD` keeps its own sentence and its own code', () => {
        const hookThrown: any = Object.assign(new Error("hook 'guard' threw: Error: Already there"), {
            code: 'DUPLICATE_RECORD',
            status: 409,
        });
        hookThrown.name = 'SandboxError';
        hookThrown.innerMessage = 'Already there';

        const r = mapDataError(hookThrown, 'duly_note');
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('DUPLICATE_RECORD');
        expect(r.body.error).toBe('Already there');
        expect(r.body).not.toHaveProperty('declaredCode');
        expect(r.body).not.toHaveProperty('developerMessage');
        expect(r.body).not.toHaveProperty('field');
    });

    it('a bare `{ code, status }` in the vocabulary is the declared-status passthrough\'s, unchanged', () => {
        const spoken = Object.assign(new Error('Spoken by a plugin'), {
            code: 'DUPLICATE_RECORD',
            status: 409,
        });
        const r = mapDataError(spoken, 'duly_note');
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('DUPLICATE_RECORD');
        expect(r.body.error).toBe('Spoken by a plugin');
        expect(r.body).not.toHaveProperty('declaredCode');
        expect(r.body).not.toHaveProperty('field');
    });
});
