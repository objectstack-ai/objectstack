// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11095] The runtime dispatcher's `PUT /meta` is the door that does NOT gain
 * `force` — and its `409 DESTRUCTIVE_CHANGE` must stop prescribing one.
 *
 * ## The defect
 *
 * `saveMetaItem`'s Phase 3a-destructive gate raises ONE refusal, and its remedy
 * clause used to end `— re-submit with ?force=true to proceed.` on every face.
 * That is true of the two REST `PUT` doors, which read the parameter off a
 * query string. It was false here: this branch is reached with a path, a method
 * and a body, and it built its `saveMetaItem` request field by field with no
 * `force` among the fields. A caller refused at this door and doing exactly
 * what the refusal said got the identical refusal back.
 *
 * ## Why this half was NOT repaired by threading the parameter
 *
 * The maintainer ruled a SPLIT (2026-08-23) over the two doors #11015 left
 * open, and the split is the decision rather than an inconsistency to be tidied
 * away later:
 *
 *  - `@objectstack/rest`'s compound-name `PUT /meta/:type/:a/:b` DID gain
 *    `?force`, inheriting #7019's "the compound route is word for word the same
 *    operation as its single-segment twin" with its measured reason. Pinned in
 *    `packages/rest/src/meta-compound-save-force-parity.test.ts`.
 *  - This door has no twin precedent and a different call shape. `?force=true`
 *    here does not name a parameter someone forgot to read — it names a channel
 *    the transport does not have. Threading one would be a NEW public surface,
 *    which no ruling has opened.
 *
 * So the repair is #11015's landed mechanism, applied mechanically: a face value
 * (`'meta-dispatch'`), stated at this call site, that renders a clause naming
 * what a caller can actually do HERE.
 *
 * ## The coupling that makes this more than a wording change
 *
 * `writeFace` feeds TWO switches — `destructiveChangeRemedy` (409, "which
 * remedy exists on this door") and `specValidationFindings` (422, "does a
 * structured channel reach the consumer beside the message"). This door's
 * answers DIFFER: no `force`, but it does carry `issues[]`
 * (`errorFromThrown` → `details.issues`), which is why it declared
 * `'meta-envelope'` in the first place. Splitting the face for the 409's sake
 * therefore had to leave the 422 exactly where it was, and the 422's polarity
 * is "declare to trim" — silence renders the FULL prose — so a face that fell
 * through would re-introduce #10888's duplication on this door alone, silently,
 * with every 409 assertion green. Section 3 is that pin.
 *
 * ## Harness
 *
 * The REAL `ObjectStackProtocolImplementation` over a `sys_metadata`-backed
 * engine double, behind the REAL `HttpDispatcher`. A protocol double that
 * refused with a hand-written message would be pinning this file's own idea of
 * the producer's clause, which is the one thing worth measuring here.
 *
 * ⚠️ `@objectstack/metadata-protocol` resolves through `exports` to its
 * **`dist/`** (registered for this package in `check-test-source-alias.mjs`'s
 * `KNOWN_UNALIASED_TEST_IMPORTS`), so this suite reports on the BUILT protocol.
 * Rebuild it after touching `protocol.ts` before reading a result here — a
 * `dist/` merely behind renders the pre-fix clause and says nothing about it.
 *
 * ## What the cases assert
 *
 * `status` AND `code` (the ADR-0112 envelope) on refusal AND on acceptance, not
 * merely the prose — a card that moved the wording and the status together
 * would pass a prose-only test. The dispatcher answers by RETURNING a response
 * object rather than throwing, so a `toThrow`-shaped assertion could not tell
 * "refused with the wrong envelope" from "did not refuse at all".
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch, assertEngineDeleteDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from '../http-dispatcher.js';

/**
 * A spec-valid `object` body. `sharingModel` is load-bearing, not decoration:
 * ADR-0090 D1's author-time gate refuses an unset OWD (`security-owd-unset`),
 * and the ACCEPTANCE case would otherwise fail one phase past the one under
 * test with a red that reads like "the save is broken".
 */
const objectBody = (name: string, fields: readonly string[]) => ({
    name,
    label: name,
    sharingModel: 'private',
    fields: Object.fromEntries(fields.map((f) => [f, { name: f, type: 'text', label: f }])),
});

const NAME = 'crm_task';
/** What the fixture starts with … */
const STORED_FIELDS = ['a', 'b', 'c', 'd'];
/** … and the body that would drop three of its columns. */
const SHRUNK_FIELDS = ['a'];

interface StoredRow {
    id: string; type: string; name: string;
    organization_id: string | null; package_id: string | null;
    state: string; metadata: string; checksum: string; version: number;
}

function boot() {
    const rows = new Map<string, StoredRow>();
    rows.set('row_task', {
        id: 'row_task', type: 'object', name: NAME,
        organization_id: null, package_id: null, state: 'active',
        metadata: JSON.stringify(objectBody(NAME, STORED_FIELDS)),
        checksum: 'sha256_11095_fixture', version: 1,
    });

    /**
     * Scalar equality ONLY, and every combinator is REFUSED rather than
     * approximated — `pnpm check:where-matcher`
     * (`scripts/check-where-matcher-conformance.mjs`, #8494): "a discovered
     * matcher must answer every combinator probe CORRECTLY, or REFUSE it by
     * throwing".
     *
     * The refusal is MEASURED, not assumed. Instrumenting this `match` to log
     * every `where` it receives across all 8 cases recorded 9 calls — every
     * one of them a flat scalar object over `type` / `name` / `state` /
     * `organization_id` / `package_id` — zero `$or`, zero `$and`. The `$or` arm
     * this replaces was therefore dead code, and it was also HALF a surface:
     * `$and` fell straight through to `r['$and']`, compared `undefined` against
     * an array, excluded the row and returned an empty result set with nothing
     * erroring. A suite can go green on that while asserting about a DIFFERENT
     * query than the one the protocol sent — the exact "declared ≠ enforced"
     * shape this card is about, one layer down in its own fixture.
     *
     * A `throw` cannot do that. The protocol does build `$or` against
     * `sys_metadata` elsewhere (org-scoped reads); if one is ever routed through
     * this door, this suite goes RED and asks for a real implementation instead
     * of quietly asserting on nothing. `$`-prefixed keys are never field names —
     * `protocol.ts`'s own `FILTER_LOGICAL_KEYS` rule — so the guard is a prelude
     * rather than an arm inside the loop: a preceding scalar miss must not be
     * able to short-circuit `.every` past an operator we cannot answer.
     */
    const match = (r: any, where: Record<string, unknown>): boolean => {
        for (const k of Object.keys(where ?? {})) {
            if (k.startsWith('$')) {
                throw new Error(`fake engine: unsupported logical operator ${k}`);
            }
        }
        return Object.entries(where ?? {}).every(([k, v]) =>
            v === null || v === undefined
                ? r[k] === null || r[k] === undefined
                : r[k] === v,
        );
    };

    const engine: any = {
        async find(table: string, o?: { where?: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return [];
            return [...rows.values()].filter((r) => match(r, o?.where ?? {}));
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table !== 'sys_metadata') return null;
            for (const r of rows.values()) if (match(r, o?.where ?? {})) return r;
            return null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata') {
                const r = { ...(data as any), id: String(data.id ?? `r_${rows.size}`) } as StoredRow;
                rows.set(r.id, r);
            }
            return { id: String(data.id ?? 'r_new') };
        },
        // ⛔ Through the producer-side predicates, never hand-mirrored — a double
        // looser than `ObjectQL` turns a green suite into no suite
        // (`check:engine-double-contract`, #4550 / #5480). The write verbs are
        // needed here because the acceptance case is asserted against the STORE.
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            const id = (opts as any)?.where?.id;
            const existing = id ? rows.get(String(id)) : undefined;
            if (existing) rows.set(String(id), { ...existing, ...(data as any) });
            return { id: id ?? null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined, getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
        },
    };

    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map());

    /** Every request the door hands the protocol — "with what", beside the store's "did it land". */
    const seen: any[] = [];
    const realSave = protocol.saveMetaItem.bind(protocol);
    protocol.saveMetaItem = async (request: any) => { seen.push(request); return realSave(request); };

    const kernel = {
        context: { getService: (n: string) => (n === 'protocol' ? protocol : null) },
    } as any;

    return {
        dispatcher: new HttpDispatcher(kernel),
        seen,
        storedFields: () => Object.keys(JSON.parse(rows.get('row_task')!.metadata).fields ?? {}).sort(),
    };
}

/**
 * `manage_metadata` held — #7019's capability gate is a different card and must
 * not be the thing answering in any case here.
 */
const ctx = (): any => ({
    request: {}, environmentId: 'platform',
    executionContext: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
});

/** The sentence that is TRUE on the REST doors and was never true on this one. */
const PUT_REMEDY = 're-submit with ?force=true to proceed.';

const put = (stack: ReturnType<typeof boot>, body: unknown) =>
    stack.dispatcher.handleMetadata(`/object/${NAME}`, ctx(), 'PUT', body);

// ═══════════════════════════════════════════════════════════════════════════
// 1. The refusal — same envelope, honest clause
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095] dispatcher PUT /meta — the destructive refusal', () => {
    it('refuses a data-dropping save with the ADR-0112 envelope, and writes NOTHING', async () => {
        const stack = boot();

        const res: any = await put(stack, objectBody(NAME, SHRUNK_FIELDS));

        expect(res.response?.status).toBe(409);
        expect(res.response?.body?.error?.code).toBe('DESTRUCTIVE_CHANGE');
        // "Refused after writing" satisfies both assertions above and is still
        // the bug — so the store is asserted, not just the answer.
        expect(stack.storedFields()).toEqual(STORED_FIELDS);
    });

    it('⭐ ⛔ never prescribes `?force=true` — this door has no query string to carry it', async () => {
        const stack = boot();

        const res: any = await put(stack, objectBody(NAME, SHRUNK_FIELDS));
        const message: string = res.response?.body?.error?.message;

        // The defect, stated as the assertion that fails without the fix. What
        // must be gone is the MECHANISM NAME: a caller who reads it goes looking
        // for a parameter this transport cannot accept, does what the sentence
        // says, and is refused identically.
        expect(message).not.toContain('force=true');
        expect(message).not.toContain(PUT_REMEDY);
    });

    it('prescribes what a caller CAN do here, and says why force is absent', async () => {
        const stack = boot();

        const res: any = await put(stack, objectBody(NAME, SHRUNK_FIELDS));
        const message: string = res.response?.body?.error?.message;

        expect(message).toContain('this save cannot be forced');
        expect(message).toContain('accepts no `force`');
        expect(message).toContain('reconcile');
        // …and WHICH item, so a caller reading several of these can tell them apart.
        expect(message).toContain(NAME);
    });

    it('[#10886 non-effect] the per-field findings survive, in the prose AND structurally', async () => {
        const stack = boot();

        const res: any = await put(stack, objectBody(NAME, SHRUNK_FIELDS));

        // Only the remedy clause is face-aware. #10886's sole-carrier verdict is
        // untouched by this card exactly as it was untouched by #11015.
        expect(res.response?.body?.error?.message).toContain("Field 'b' removed");
        // Row 3 of the face inventory says this door is NOT a sole carrier, and
        // the claim is about THIS body.
        expect(res.response?.body?.error?.details?.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'field_removed', field: 'b' }),
        ]));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ⛔ Acceptance — and the acceptance set this card did NOT widen
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095] dispatcher PUT /meta — the accept set is unchanged', () => {
    it('a NON-destructive save still succeeds — this is a message repair, not a lockout', async () => {
        const stack = boot();

        // Same four columns plus a relabel: nothing is dropped, so the gate
        // never fires. Without this case the whole card could be "satisfied" by
        // a door that refuses everything.
        const res: any = await put(stack, { ...objectBody(NAME, STORED_FIELDS), label: 'Task (renamed)' });

        expect(res.handled).toBe(true);
        expect(res.response?.status).toBe(200);
        expect(res.response?.body?.error).toBeUndefined();
        expect(stack.storedFields()).toEqual(STORED_FIELDS);
    });

    it('⭐ ⛔ `force` in the BODY does not lift the refusal — the surface was not widened', async () => {
        const stack = boot();

        // The only channel a caller has on this transport. The request object is
        // built field by field precisely so `item` stays data and never becomes
        // a control channel — asserted from the OUTSIDE rather than by reading
        // the type, because the type is what a future edit would widen.
        const res: any = await put(stack, { ...objectBody(NAME, SHRUNK_FIELDS), force: true });

        expect(res.response?.status).toBe(409);
        expect(res.response?.body?.error?.code).toBe('DESTRUCTIVE_CHANGE');
        expect(stack.storedFields()).toEqual(STORED_FIELDS);
        // …and the request that reached the producer carried no `force` at all,
        // which is the fact the status alone cannot establish.
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0].force).toBeUndefined();
        expect(stack.seen[0].writeFace).toBe('meta-dispatch');
    });

    it('⛔ a `writeFace` in the body cannot be smuggled either — the face is SERVER-stated', async () => {
        const stack = boot();

        // If a caller could name the face they could re-select the `?force=true`
        // clause on a door that has no `force` — restoring the exact defect this
        // card removed, from the outside.
        const res: any = await put(stack, { ...objectBody(NAME, SHRUNK_FIELDS), writeFace: 'meta-envelope' });

        expect(res.response?.status).toBe(409);
        expect(res.response?.body?.error?.message).not.toContain(PUT_REMEDY);
        expect(stack.seen[0].writeFace).toBe('meta-dispatch');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. ⭐ [COUPLING] One field, two switches — the 422 must NOT have moved
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095] [GUARD] splitting the face changed the 409 and nothing else', () => {
    it('⛔ the 422 still renders the #10888 HEADLINE, not the restated prose', async () => {
        const stack = boot();

        // A view body whose `summary` carries a typo'd key — the same shape the
        // 422 face inventory drives, so the two files agree on what a 422 is.
        const res: any = await stack.dispatcher.handleMetadata(
            '/view/task_list', ctx(), 'PUT',
            {
                name: 'task_list', object: 'task', type: 'list', label: 'Tasks',
                columns: [{ field: 'title', summary: { type: 'sum', fieldd: 'amount' } }],
            },
        );

        expect(res.response?.status).toBe(422);
        expect(res.response?.body?.error?.code).toBe('INVALID_METADATA');

        const message: string = res.response?.body?.error?.message;
        const issues: Array<{ message: string }> = res.response?.body?.error?.details?.issues ?? [];

        // The headline grammar — count plus `path [zod code]` locators …
        expect(message).toContain('failed spec validation: ');
        expect(message).toMatch(/\d+ issues? — /);
        // … and NOT one finding restated in the sentence. This is the assertion
        // that goes red if `'meta-dispatch'` ever falls through to the prose
        // default: the polarity is "declare to trim", so the regression is
        // silent in exactly this direction.
        expect(issues.length).toBeGreaterThan(0);
        for (const i of issues) expect(message).not.toContain(i.message);
    });
});
