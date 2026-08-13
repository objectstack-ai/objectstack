// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8443 — the runtime package-publish door's own copy of #8333's **P9**.
 *
 * `POST /packages/:id/publish-drafts` keeps a route-level seed apply for
 * protocols that do not self-apply seeds inside `publishPackageDrafts`. That
 * fallback is a second copy of `metadata-protocol`'s `applySeedBodies`, and it
 * carried the same defect after PR #8436 converted the original: caught driver
 * text interpolated straight onto a client-facing payload.
 *
 * ## Why an HTTP boundary cannot save this one
 *
 * `seedApplied` rides on a **200** publish response as DATA. Every 5xx message
 * withhold in the stack reads a *thrown* error's message; none of them can see
 * a field on a successful body. That is the whole argument for fixing the
 * producer, and it is why every case below asserts the CONTENTS of that field
 * inside a 200 — never a status code, never that something threw.
 *
 * ## The defect, as measured on `origin/main` BEFORE the change
 *
 * The card was explicit that it was read from source, not reproduced. It was
 * driven for real first, through `HttpDispatcher.handlePackages` with a real
 * `SeedLoaderService`, and the reproduction found the door's catch is only ONE
 * of two carriers on the same field:
 *
 * | # | injection | pre-change `seedApplied` |
 * |:--|:--|:--|
 * | B | `metadata.getObject` throws (the loader's dependency-graph read, unguarded in `resolveObjectDefinition`) | `error: "SQLITE_ERROR: no such table: sys_metadata"` |
 * | C | `protocol.getMetaItem` throws (the seed body read-back) | `errors: ["read project_seed: SQLITE_ERROR: no such table: sys_metadata", …]` |
 * | D | a malformed seed body | `error:` a multi-line JSON dump of raw zod internals |
 * | E | a DECLARED 4xx refusal on the read-back | the authored sentence, verbatim — correct, and must stay |
 *
 * C is the carrier the card did not name, and it is the one a `sys_metadata`
 * outage reaches FIRST: the read-back happens before the loader is ever
 * constructed, so a fix confined to the door's catch would have left the
 * commonest outage shape disclosing exactly as before. Both are fixed here.
 *
 * ## The rule, imported rather than restated
 *
 * A caught error's sentence may be quoted to a caller only when that error
 * DECLARED itself a client-facing refusal (4xx `status`, ADR-0112). The
 * predicate and the sentence live in `@objectstack/metadata-protocol` and are
 * now exported (`clientFacingFailureText`), because two copies of "when may a
 * caught sentence be quoted" is precisely how the rule drifts apart.
 *
 * D is the population the rule cannot simply be applied to — a raw `ZodError`
 * declares nothing, so the withhold would have blanked the author's feedback.
 * The cure is #8333's, not a loosened collector: the parse becomes a
 * `safeParse` and its rejection is minted as a real 422 by the producer's own
 * `seedRequestValidationError`, so it satisfies the positive list on its own
 * merits. Section 3 pins that the envelope is the PRODUCER'S — one authoring
 * mistake must not get two different sentences depending on which protocol
 * served the publish.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Predicted with `domains/packages.ts` reverted to `origin/main` (the
 * `metadata-protocol` export kept, or the file would not compile):
 *
 *  - RED: section 1 (B and C, the two withholds) and section 3 (D, the
 *    authoring envelope) = 4 cases. Each asserts the POSITIVE post-fix shape
 *    plus the absence of the driver line, so an unfixed door fails on the
 *    text rather than on a vague "it changed".
 *  - GREEN IN BOTH DIRECTIONS — section 0 (the positive control: it proves the
 *    injection points sit on the live path, and the live path is not what
 *    changed) and section 3's `[GUARD]` (a declared 4xx refusal quoted
 *    verbatim — true before and after).
 *
 * Predicted **4 failed | 2 passed**. Measured **4 failed | 2 passed**, and
 * every red failed on the TEXT — `expected 'SQLITE_ERROR: no such table:
 * sys_metadata' to be 'seed apply failed'` — not on a vague "it changed".
 *
 * The `[GUARD]` earns its place under a DIFFERENT variant, which is the run
 * that makes it load-bearing: with `clientFacingFailureText` forced to withhold
 * unconditionally (never quoting, so the rule becomes a blanket blank), the
 * predicted casualties are section 2's two quotes and section 3's guard —
 * **3 failed | 3 passed**. Measured **3 failed | 3 passed**, those exact three.
 * Without them this file would be satisfied by "withhold everything", which
 * deletes the self-correcting refusals #4277 exists for and the authoring
 * feedback #8333 went out of its way to preserve.
 *
 * Both predictions held; there is no missed prediction to record on this card.
 *
 * ⛔ Never a bare `toThrow()` here: this door does not throw, it REPORTS, and
 * the whole defect is what the report says.
 */
import { describe, expect, it, vi } from 'vitest';
import { seedRequestValidationError } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from '../http-dispatcher.js';

/**
 * The sqlite phrasing of "`sys_metadata` is not there". One dialect is a
 * sufficient carrier: the dialect matrix and the proof that the shared
 * `looksLikeInternalErrorLeak` heuristic is dialect-bounded belong to
 * `metadata-protocol`'s `protocol.driver-text-disclosure.test.ts` (#8136). The
 * rule under test here — "was a client refusal DECLARED" — is phrasing-blind by
 * construction, so this file inherits that conclusion instead of re-deriving it.
 */
const DRIVER_TEXT = 'SQLITE_ERROR: no such table: sys_metadata';

/** Fragments that must never appear anywhere in a client-facing payload. */
const LEAKED_FRAGMENTS = ['SQLITE_ERROR', 'no such table', 'sys_metadata'];

/** The whole 200 body, the way the door ships it. */
function expectNothingLeaked(payload: unknown): void {
    const wire = JSON.stringify(payload) ?? '';
    expect(wire).not.toContain(DRIVER_TEXT);
    for (const fragment of LEAKED_FRAGMENTS) expect(wire).not.toContain(fragment);
}

/**
 * [#7033 / #7023] `/packages` carries an anonymous-deny floor plus per-route
 * capability predicates; every state-changing route demands `manage_metadata`.
 * Without a caller these cases would stop at the 401 before reaching the
 * behaviour they are named after. The gates themselves are pinned in
 * `packages-capability-gate.test.ts`.
 */
const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** The malformed seed body's one planted defect — `mode` is a closed enum. */
const BAD_MODE = 'sideways';

/**
 * A self-correcting refusal of the shape `SysMetadataRepository` raises: it
 * DECLARED 4xx, so the author must receive it whole. This is the sentence the
 * over-block variant deletes.
 */
const DECLARED_REFUSAL = () => {
    const e: any = new Error('[item_locked] seed "project_seed" is locked by another publish');
    e.code = 'ITEM_LOCKED';
    e.status = 403;
    return e;
};

/**
 * A dispatcher whose protocol does NOT self-apply seeds — the exact composition
 * the door's fallback documents itself as existing for — driving the REAL
 * `SeedLoaderService`. Only the engine, the metadata service and the protocol
 * are doubled, so the seed apply chain under test is the shipping one.
 */
function makeDoor(opts: {
    failGetObject?: boolean;
    failGetMetaItem?: boolean;
    malformedSeedBody?: boolean;
    refusalOnGetMetaItem?: boolean;
} = {}) {
    const records = [
        { name: 'Apollo', status: 'active' },
        { name: 'Gemini', status: 'planned' },
    ];
    const publishPackageDrafts = vi.fn().mockResolvedValue({
        success: true, publishedCount: 1, failedCount: 0,
        published: [{ type: 'seed', name: 'project_seed', version: 'h' }], failed: [],
    });
    const body = {
        object: 'project',
        externalId: 'name',
        mode: opts.malformedSeedBody ? BAD_MODE : 'upsert',
        records,
    };
    const getMetaItem = vi.fn().mockImplementation(async () => {
        if (opts.failGetMetaItem) throw new Error(DRIVER_TEXT);
        if (opts.refusalOnGetMetaItem) throw DECLARED_REFUSAL();
        // The WRAPPER shape: the seed body lives under `.item`.
        return { type: 'seed', name: 'project_seed', lock: null, editable: true, item: body };
    });
    // Mirror the real engine's array-form insert (bulk path).
    const insert = vi.fn().mockImplementation(async (_object: string, rec: any) => (
        Array.isArray(rec) ? rec.map((r: any) => ({ id: `id_${r.name}` })) : { id: `id_${rec.name}` }
    ));
    const find = vi.fn().mockResolvedValue([]);
    const getObject = opts.failGetObject
        ? vi.fn().mockImplementation(async () => { throw new Error(DRIVER_TEXT); })
        : vi.fn().mockResolvedValue({
            name: 'project',
            fields: { name: { type: 'text' }, status: { type: 'select' } },
        });

    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return Promise.resolve({ publishPackageDrafts, getMetaItem });
            if (name === 'objectql') {
                return Promise.resolve({
                    insert, find, update: vi.fn(),
                    registry: { getAllPackages: vi.fn().mockReturnValue([]) },
                });
            }
            if (name === 'metadata') return Promise.resolve({ getObject });
            return null;
        },
        context: { getService: () => null },
    };
    return { dispatcher: new HttpDispatcher(kernel), insert, getObject, getMetaItem };
}

async function publishDrafts(opts: Parameters<typeof makeDoor>[0] = {}) {
    const door = makeDoor(opts);
    const result = await door.dispatcher.handlePackages(
        '/com.workspace/publish-drafts', 'POST', {}, {}, PKG_ADMIN(),
    );
    // The field under test is DATA on a success body — assert that framing once
    // here so every case below reads as "what the 200 said".
    expect(result.response?.status).toBe(200);
    const body: any = (result.response as any)?.body;
    return { ...door, body, seedApplied: body?.data?.seedApplied };
}

// ---------------------------------------------------------------------------
// Section 0 — the positive control
// ---------------------------------------------------------------------------

describe('#8443 · 0 · the fallback really runs (positive control)', () => {
    it('a healthy engine loads the rows and reports them on the 200', async () => {
        const { seedApplied, insert, getObject } = await publishDrafts();

        expect(seedApplied?.success).toBe(true);
        expect(seedApplied?.inserted).toBe(2);
        // Rows actually reached the engine, batched into one bulk insert — so
        // the injections below are perturbing a path that genuinely runs, not
        // a dead branch. Without this, "no driver text" is indistinguishable
        // from "nothing happened at all".
        expect(insert).toHaveBeenCalledTimes(1);
        expect(getObject).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Section 1 — the withhold, at both carriers on the same field
// ---------------------------------------------------------------------------

describe('#8443 · 1 · undeclared driver text never rides the 200', () => {
    it('the door catch — a driver failure under the loader dependency graph', async () => {
        const { seedApplied, body, getObject } = await publishDrafts({ failGetObject: true });

        // The injection reached the live path (it is the loader's own metadata
        // read), and the failure is still reported — withholding must not turn
        // into silence.
        expect(getObject).toHaveBeenCalled();
        expect(seedApplied?.success).toBe(false);
        expect(seedApplied?.error).toBe('seed apply failed');
        expectNothingLeaked(body);
    });

    it('the read-back — a driver failure reading the published seed body', async () => {
        const { seedApplied, body, getMetaItem } = await publishDrafts({ failGetMetaItem: true });

        expect(getMetaItem).toHaveBeenCalled();
        expect(seedApplied?.success).toBe(false);
        // The stable operational sentence is unchanged; what changed is the
        // per-read entry beside it.
        expect(seedApplied?.error).toBe('seed apply: no readable seed bodies');
        expect(seedApplied?.errors?.[0]).toBe('read project_seed: the reason is in the server log');
        expectNothingLeaked(body);
    });
});

// ---------------------------------------------------------------------------
// Section 2 — the authoring population, quoted BECAUSE it declares 422
// ---------------------------------------------------------------------------

describe('#8443 · 2 · a malformed seed body still reaches its author', () => {
    it('quotes the curated spec-validation summary, not a zod dump', async () => {
        const { seedApplied, body } = await publishDrafts({ malformedSeedBody: true });

        expect(seedApplied?.success).toBe(false);
        expect(seedApplied?.error).toContain('[invalid_metadata]');
        // The author learns WHICH key — the whole reason this population may
        // not be blanked. `seeds.0.mode` is the path through the request the
        // loader parses.
        expect(seedApplied?.error).toContain('seeds.0.mode');
        // ⛔ and NOT the raw `ZodError` stringification the field used to carry.
        expect(seedApplied?.error).not.toContain('"code": "invalid_value"');
        expectNothingLeaked(body);
    });

    it('mints that envelope with the PRODUCER\'s declaration, not a local copy', async () => {
        const { seedApplied } = await publishDrafts({ malformedSeedBody: true });

        // The anti-drift pin, and the reason the helpers were exported rather
        // than restated: the sentence a caller receives here must be the same
        // one `metadata-protocol`'s own seed-apply path mints for the same
        // rejection. A local restatement in runtime — however faithful the day
        // it is written — goes red here the first time either side is edited
        // alone.
        const fromProducer = seedRequestValidationError([{
            code: 'invalid_value',
            path: ['seeds', 0, 'mode'],
            message: 'Invalid option: expected one of "insert"|"update"|"upsert"|"replace"|"ignore"',
        }]);
        expect(seedApplied?.error).toBe(fromProducer.message);
        // The declaration that makes it quotable at all (ADR-0112).
        expect((fromProducer as any).status).toBe(422);
        expect((fromProducer as any).code).toBe('INVALID_METADATA');
    });
});

// ---------------------------------------------------------------------------
// Section 3 — the over-block bound
// ---------------------------------------------------------------------------

describe('#8443 · 3 · [GUARD] a DECLARED 4xx refusal is quoted verbatim', () => {
    it('keeps a self-correcting refusal intact on the read-back', async () => {
        const { seedApplied } = await publishDrafts({ refusalOnGetMetaItem: true });

        // Green before and after this card — it is a BOUND, not evidence. Its
        // job is to fail the "withhold everything" shortcut: measured under the
        // over-broad variant (nothing ever quoted) this case goes red, which is
        // what makes it load-bearing. The author must still be told the seed is
        // locked and by what, because that is a problem they can fix.
        expect(seedApplied?.success).toBe(false);
        expect(seedApplied?.errors?.[0]).toBe(
            'read project_seed: ' + DECLARED_REFUSAL().message,
        );
    });
});
