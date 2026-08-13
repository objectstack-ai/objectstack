// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8442 — the `errors[].message` limb of `seedApplied`, the third field in the
 * family after #8333's `error` string and #8441's `code`.
 *
 * ## Which question this sink asks, and why it is neither sibling's answer
 *
 * | limb | question | predicate |
 * |:--|:--|:--|
 * | `error` (#8333) | did the producer AUTHOR this sentence for a caller? | 4xx `status` |
 * | `code` (#8441) | is this value a MEMBER of the catalog? | `StandardErrorCode ∪ ERROR_CODE_LEDGER` |
 * | `errors[].message` (this card) | did the producer AUTHOR this sentence? | 4xx `status` **OR** the `VALIDATION_FAILED` shape |
 *
 * A message is free text, so no catalog bounds it: #8441's membership rule does
 * not apply and this is #8333's QUESTION. But #8333's ANSWER — a numeric 4xx
 * `status` — is measurably insufficient at this producer, because this sink
 * receives a population `protocol.ts`'s collectors never see: the data engine's
 * VALIDATION layer.
 *
 * Measured on `main`, `@objectstack/objectql`'s `ValidationError` carries own
 * properties `[stack, message, code, name, fields]` — `code =
 * 'VALIDATION_FAILED'` and deliberately NO `status`, because (per
 * `@objectstack/types`' `validation-failure.ts`) "deciding it means 400 is the
 * job of whichever boundary serves it". For the seed channel this loader IS
 * that boundary, and `VALIDATION_FAILED_STATUS = 400` is the repo already
 * stating that such a throw is a 4xx client refusal missing only the property.
 *
 * ## ⚠️ Why that distinction is the whole card
 *
 * On this producer the STRUCTURED keys do not carry the offending field.
 * `buildWriteError` reports `field: '(write)'`, with `targetField` /
 * `attemptedValue` naming the record's EXTERNAL key — i.e. WHICH ROW. "Which
 * key was rejected and why" (`plan`, `max_length`) exists only inside the
 * validation sentence. So answering with the 4xx test alone would blank exactly
 * the per-record authoring feedback the issue names as the review bar, trading
 * an authoring surface for a disclosure — the trade #8441 explicitly refused.
 * Section 2 is that bound, and `seed-loader-authoring-feedback.test.ts` in
 * `@objectstack/objectql` drives the same guarantee through the REAL validator.
 *
 * ## ⚠️ Anti-vacuity — the lesson #8441 recorded against #8333's pins
 *
 * #8333's fixture threw a bare `Error` with no `code`, so its scan could not
 * see the `code` disclosure: the fixture never carried the field under test.
 * The trap here is the mirror image — a fixture whose "validation failure" does
 * not actually carry the shape the predicate reads would make section 2 pass
 * for the wrong reason. Section 6 asserts the fixtures' own properties, and
 * asserts the double is recognised by `validationFailureDetails` itself — the
 * canonical recogniser, imported, not re-spelled. The double's shape was
 * measured from the real class rather than guessed (objectql cannot be imported
 * here: it depends on THIS package and would close a cycle).
 *
 * ## Reverse verification — both directions predicted BEFORE running
 *
 * **(a) `seed-loader.ts` reverted to pre-#8442.** Predicted **6 red / 4 green**:
 * sections 1 (2), 3 (1), 4 (2) and 5 (1) go red because the driver text ships;
 * section 2 (3) stays green because a declared refusal was quoted verbatim
 * before this card too, and section 6 (1) is a pure fixture assertion
 * independent of the loader. Section 5 is predicted RED deliberately — it
 * asserts the PAYLOAD as well as the log, which is the miss both #8333 and
 * #8441 recorded for their own operator-half case, so it is predicted rather
 * than rediscovered.
 * Measured: **6 red / 4 green** — every prediction held.
 *
 * **(b) The over-broad "just blank the tail" variant** — `WITHHELD_WRITE_REASON`
 * unconditionally, the tempting wrong fix this card exists to refuse. Predicted
 * **3 red / 7 green**: section 2's three cases go red (the authoring feedback
 * vanishes) and everything else stays green, since nothing else asserts a
 * quoted sentence.
 * Measured: **3 red / 7 green** — every prediction held.
 *
 * Together the directions bound the fix on both sides: (a) proves it does
 * something, (b) proves it does not do too much.
 */
import { describe, expect, it, vi } from 'vitest';
// The canonical recogniser the fix reads. Imported in the TEST as well so
// section 6 can prove the fixture really satisfies it — a double the predicate
// would not recognise is how a guard passes for the wrong reason.
import { validationFailureDetails } from '@objectstack/types';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

// ---------------------------------------------------------------------------
// The physical conditions
// ---------------------------------------------------------------------------

/** The sqlite phrasing of "`sys_metadata` is not there". */
const DRIVER_TEXT = 'SQLITE_ERROR: no such table: sys_metadata';

/** Fragments that must never appear anywhere in a client-facing payload. */
const LEAKED_FRAGMENTS = ['SQLITE_ERROR', 'no such table', 'sys_metadata'];

/** The sentence a caller gets when nothing may be quoted. */
const WITHHELD = 'the data engine rejected the write; the reason is in the server log';

/** A real better-sqlite3 failure: the dialect on a property, not only in the sentence. */
const driverFault = () =>
    Object.assign(new Error(DRIVER_TEXT), { code: 'SQLITE_ERROR', errno: 1 });

/**
 * Byte-faithful stand-in for `@objectstack/objectql`'s `ValidationError`.
 *
 * Measured from the real class rather than guessed — own properties
 * `[stack, message, code, name, fields]`, `code = 'VALIDATION_FAILED'`, and NO
 * `status` / `statusCode`. objectql cannot be imported here (it depends on this
 * package), so section 6 pins the shape and the real-validator half of the
 * guarantee lives in `@objectstack/objectql`'s
 * `seed-loader-authoring-feedback.test.ts`.
 */
const validationFault = (message: string, fields: unknown[]) => () =>
    Object.assign(new Error(message), {
        name: 'ValidationError',
        code: 'VALIDATION_FAILED',
        fields,
    });

function expectNothingLeaked(payload: unknown): void {
    const wire = JSON.stringify(payload) ?? '';
    expect(wire).not.toContain(DRIVER_TEXT);
    for (const fragment of LEAKED_FRAGMENTS) expect(wire).not.toContain(fragment);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** One business object, one text field beside the natural key. */
function createMetadata(): IMetadataService {
    const objects: Record<string, unknown> = {
        acct: { name: 'acct', fields: { name: { type: 'text' }, plan: { type: 'text' } } },
    };
    return {
        getObject: vi.fn(async (name: string) => objects[name]),
        listObjects: vi.fn(async () => Object.values(objects)),
        register: vi.fn(async () => {}),
    } as unknown as IMetadataService;
}

/** An engine whose every write fails the way `thrown` says. */
function failingEngine(thrown: () => unknown): IDataEngine {
    return {
        find: vi.fn(async () => []),
        findOne: vi.fn(async () => null),
        insert: vi.fn(async () => { throw thrown(); }),
        update: vi.fn(async () => { throw thrown(); }),
        delete: vi.fn(async () => ({ deleted: 1 })),
        count: vi.fn(async () => 0),
        aggregate: vi.fn(async () => []),
    } as unknown as IDataEngine;
}

const SEED = [{
    object: 'acct',
    externalId: 'name',
    mode: 'upsert',
    env: ['prod', 'dev', 'test'],
    records: [{ name: 'acme', plan: 'pro' }],
}];

const CONFIG = {
    dryRun: false, haltOnError: false, multiPass: true,
    defaultMode: 'upsert', batchSize: 1000, transaction: false,
};

/** Drive a pass-1 write failure and return the load result. */
async function loadFailing(thrown: () => unknown, logger = createLogger()) {
    const svc = new SeedLoaderService(failingEngine(thrown), createMetadata(), logger as never);
    const result = await svc.load({ seeds: SEED, config: CONFIG } as never);
    return { result, logger };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. EVIDENCE — the driver's sentence never reaches `errors[].message`
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8442] raw driver text is withheld from the seed `errors[].message`', () => {
    it('the pass-1 record write answers the stable line, not `SQLITE_ERROR`', async () => {
        const { result } = await loadFailing(driverFault);

        expect(result.success).toBe(false);
        const error = result.errors[0];
        // The authored prefix is unchanged, byte for byte — two runtime pins
        // read it, and it is the operation description an author needs.
        expect(error.message).toContain('Failed to write acct record #0 (name=acme):');
        // ⛔ NOT blanked: the limb still answers, with the withheld-reason line.
        expect(error.message).toContain(WITHHELD);
        expectNothingLeaked(result);
    });

    it('the pass-2 deferred back-fill answers the stable line too', async () => {
        // Two objects referencing each other force the multi-pass back-fill:
        // `dept.head_id` is deferred to pass 2, whose `update` then fails.
        const objects: Record<string, unknown> = {
            dept: { name: 'dept', fields: { name: { type: 'text' }, head_id: { type: 'lookup', reference: 'worker' } } },
            worker: { name: 'worker', fields: { name: { type: 'text' }, dept_id: { type: 'lookup', reference: 'dept' } } },
        };
        const metadata = {
            getObject: vi.fn(async (n: string) => objects[n]),
            listObjects: vi.fn(async () => Object.values(objects)),
            register: vi.fn(async () => {}),
        } as unknown as IMetadataService;

        const store: Record<string, any[]> = {};
        let id = 0;
        const engine = {
            find: vi.fn(async (o: string, q?: any) => {
                const rows = store[o] || [];
                return q?.where
                    ? rows.filter((r) => Object.entries(q.where).every(([k, v]) => r[k] === v))
                    : rows;
            }),
            findOne: vi.fn(async (o: string, q?: any) => {
                const rows = await (engine.find as any)(o, q);
                return rows[0] ?? null;
            }),
            insert: vi.fn(async (o: string, data: any) => {
                if (!store[o]) store[o] = [];
                const rec = { id: `gen-${++id}`, ...data };
                store[o].push(rec);
                return rec;
            }),
            // The ONLY update in this load is pass-2's back-fill.
            update: vi.fn(async () => { throw driverFault(); }),
            delete: vi.fn(async () => ({ deleted: 1 })),
            count: vi.fn(async () => 0),
            aggregate: vi.fn(async () => []),
        } as unknown as IDataEngine;

        const logger = createLogger();
        const result = await new SeedLoaderService(engine, metadata, logger as never).load({
            seeds: [
                { object: 'dept', externalId: 'name', mode: 'insert', env: ['prod', 'dev', 'test'], records: [{ name: 'Engineering', head_id: 'Alice' }] },
                { object: 'worker', externalId: 'name', mode: 'insert', env: ['prod', 'dev', 'test'], records: [{ name: 'Alice', dept_id: 'Engineering' }] },
            ],
            config: CONFIG,
        } as never);

        const backfill = result.errors.find((e) => e.message.includes('Failed to write deferred reference'));
        expect(backfill, 'the pass-2 back-fill failure was not reported').toBeDefined();
        // The located structure survives whole — which field, which target.
        expect(backfill!.message).toContain('dept.head_id');
        expect(backfill!.message).toContain('worker.name');
        expect(backfill!.message).toContain(WITHHELD);
        expectNothingLeaked(result);

        // THE OPERATOR HALF OF *THIS* PASS — pinned here rather than left to
        // section 5, which drives pass 1 only. Without this assertion a later
        // edit could withhold the pass-2 log line too and every pin in the file
        // would stay green while the deferred diagnostic disappeared: a payload
        // pinned for both passes and an operator half pinned for one is exactly
        // the "green pin narrower than its name" shape this family has already
        // recorded once.
        const logged = logger.error.mock.calls.map((c) => String(c[0])).join('\n');
        expect(logged).toContain(DRIVER_TEXT);
        // …under the SAME marked vocabulary pass 1 uses, so an operator reading
        // a pass-2 line learns the reporter never received this sentence.
        expect(logged).toContain('Cause (withheld from the seed response)');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. [GUARD] The authoring surface — red under the "just blank the tail" fix
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8442] [GUARD] a DECLARED refusal is quoted whole — the per-record authoring feedback', () => {
    /**
     * THE DISCRIMINATOR of this card. A validation failure declares itself by
     * SHAPE and carries no `status`, so #8333's rule alone would withhold it —
     * and with it the only statement of WHICH KEY was rejected, since the
     * structured keys name only which ROW. Membership (#8441's rule) would not
     * help either: `VALIDATION_FAILED` is not what bounds a free-text message.
     */
    it('an objectql `ValidationError` (no `status`) keeps its per-field sentence', async () => {
        const { result } = await loadFailing(validationFault(
            'Plan must be at most 4 characters.',
            [{ field: 'plan', code: 'max_length', message: 'Plan must be at most 4 characters.' }],
        ));

        const error = result.errors[0];
        // WHICH ROW — the structured half.
        expect(error.recordIndex).toBe(0);
        expect(error.attemptedValue).toBe('acme');
        // WHICH KEY AND WHY — the half that lives only in the sentence.
        expect(error.message).toContain('Plan must be at most 4 characters.');
    });

    it('a validation-RULE veto keeps its author-written sentence', async () => {
        const { result } = await loadFailing(validationFault(
            'Cannot move a closed account back to draft.',
            [{ field: '_record', code: 'rule_violation', message: 'Cannot move a closed account back to draft.' }],
        ));

        expect(result.errors[0].message).toContain('Cannot move a closed account back to draft.');
    });

    it('a declared 4xx refusal keeps its sentence (#8333’s rule, still in force)', async () => {
        const { result } = await loadFailing(() => Object.assign(
            new Error('[item_locked] Cannot overlay this item: the package is read-only.'),
            { code: 'ITEM_LOCKED', status: 403 },
        ));

        expect(result.errors[0].message).toContain('[item_locked]');
        expect(result.errors[0].message).toContain('the package is read-only.');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The structured per-record keys survive the withhold
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8442] the located structure is untouched by the withhold', () => {
    /**
     * The issue's review bar: `errors[]` is per-record authoring feedback, so
     * the fix must FILTER, not delete. Every key here is built from the seed
     * declaration and the record — never from the caught error — so a withheld
     * sentence costs none of them.
     */
    it('every structured key is present and correct under a withheld driver fault', async () => {
        const { result } = await loadFailing(driverFault);

        expect(result.errors[0]).toMatchObject({
            sourceObject: 'acct',
            field: '(write)',
            targetObject: 'acct',
            targetField: 'name',
            attemptedValue: 'acme',
            recordIndex: 0,
        });
        expectNothingLeaked(result);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The bounds — what a declaration is NOT
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8442] an undeclared fault is withheld however it is dressed', () => {
    /**
     * The 5xx counterpart of #8441's discriminator, pointing the other way. A
     * ledger-registered `code` and a declared `status` are both present, yet
     * the status is 5xx — a SERVER fault, not a client refusal — so the
     * sentence is withheld. That the code would survive #8441's rule on the
     * sibling limb is exactly the point: the two limbs answer different
     * questions about the same error.
     */
    it('a declared 503 carrying a ledger code still has its sentence withheld', async () => {
        const { result } = await loadFailing(() => Object.assign(new Error(DRIVER_TEXT), {
            code: 'ERR_DATASOURCE_UNAVAILABLE',
            status: 503,
        }));

        expect(result.errors[0].message).toContain(WITHHELD);
        expectNothingLeaked(result);
    });

    it('a bare `Error` declaring nothing is withheld', async () => {
        const { result } = await loadFailing(() => new Error(DRIVER_TEXT));

        expect(result.errors[0].message).toContain(WITHHELD);
        expectNothingLeaked(result);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The operator half — withheld from the caller, intact in the log
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8442] the withheld driver line still reaches the server log', () => {
    /**
     * Without this the fix would be indistinguishable from DELETING the
     * diagnostic — the failure mode that makes a disclosure fix a net loss for
     * whoever has to fix the database. Asserts the payload half too, which is
     * why it is predicted RED in reverse direction (a).
     */
    it('`logger.error` carries the driver sentence while the payload stays clean', async () => {
        const { result, logger } = await loadFailing(driverFault);

        expectNothingLeaked(result);
        const logged = logger.error.mock.calls.map((c) => String(c[0])).join('\n');
        expect(logged).toContain(DRIVER_TEXT);
        // …and says plainly that the caller did not get it.
        expect(logged).toContain('withheld from the seed response');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ANTI-VACUITY — the fixtures really carry the fields under test
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8442] the harness is non-vacuous', () => {
    /**
     * #8441's warning, applied to this card's own fixtures. #8333's pins could
     * not see the `code` disclosure because its fake carried no `code`; the
     * mirror trap here is a "validation failure" double that the predicate
     * would not actually recognise, which would make section 2 green for the
     * wrong reason. Both fixtures are asserted against the properties the fix
     * reads — the validation double against the canonical recogniser itself.
     */
    it('the validation double is recognised by `validationFailureDetails` and declares NO status', () => {
        const err = validationFault('Plan must be at most 4 characters.', [
            { field: 'plan', code: 'max_length', message: 'Plan must be at most 4 characters.' },
        ])() as Record<string, unknown>;

        // The exact own-property set measured from the real class.
        expect(Object.getOwnPropertyNames(err).sort())
            .toEqual(['code', 'fields', 'message', 'name', 'stack']);
        // It declares NO status — the whole reason #8333's rule is insufficient.
        expect(err.status).toBeUndefined();
        expect((err as { statusCode?: unknown }).statusCode).toBeUndefined();
        // …and the canonical recogniser accepts it, so section 2 cannot be
        // green because of a shape the production predicate would reject.
        expect(validationFailureDetails(err)).toBeDefined();

        // The driver fixture carries its dialect on a PROPERTY, not only in the
        // sentence — and is NOT mistaken for a validation failure.
        const driver = driverFault() as Record<string, unknown>;
        expect(driver.code).toBe('SQLITE_ERROR');
        expect(driver.errno).toBe(1);
        expect(driver.status).toBeUndefined();
        expect(validationFailureDetails(driver)).toBeUndefined();
    });
});
