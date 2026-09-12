// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /api/v1/packages/:id?version=` is a VERSION-SCOPED read, and its answer
 * is distinguishable from the unversioned one (#17416).
 *
 * ## The defect
 *
 * The route accepted `?version=` and the only surface serving it never read the
 * parameter. `ScopedEnvironmentClient.packages.get(id, version)` declares
 * `version?: string` and appends it, so `?version=99.0.0` against an installed
 * `1.0.0` was answered `200` with the `1.0.0` row — and no status, header or
 * field told the caller which of the two reads it got. The handler that
 * honoured it (with the store predicate `AND version = ?`) went with the REST
 * twin in #14503 / #16628; this dispatcher domain never had it to inherit.
 *
 * ## What is pinned, and why each half is here
 *
 * The card's acceptance criterion is a PAIR, because either half alone passes
 * for the wrong reason:
 *
 *  - **§1 the discriminating pin** — the same request with and without
 *    `?version=<a version that is not installed>` must not produce the same
 *    response. Asserted as `status` PLUS the discriminating field (the error
 *    message naming the version, and the body carrying no package row), ⛔
 *    never as "it returned 200": that reading is precisely what hid this
 *    defect for the whole of its life.
 *  - **§2 the lit control** — the unversioned read still answers exactly as it
 *    did, down to the row it serves. A green that only exercised the new
 *    scoped path would also be green if the ordinary read were broken, and
 *    this door is the single implementation of the route.
 *
 * §3 pins the two requests that mean "the installed row" — no parameter and
 * `?version=latest` — as ONE request, which is the contract the deleted
 * handler published (`requested.value || 'latest'`).
 *
 * §4 pins the repeated parameter. ⚠️ [#17672] **This section's pin was changed
 * deliberately.** As written for #17416 it asserted only that the DEFECT CLASS
 * was closed (`status` is not `200`, no installed row rides out) and explicitly
 * NOT the status, because the repo's one rule for a repeated single-valued
 * parameter answers `400 VALIDATION_ERROR` and was then reachable from nowhere
 * outside `@objectstack/rest` — so the door shipped a `404` and this pin was
 * written loose enough to survive the eventual fix. ⛔ That `404` was never
 * this door's contract: it was the interim answer of an unreachable rule, and
 * #17672 filed it because it made a request-shape error indistinguishable from
 * the two genuine not-founds §1 pins. The rule is reachable now
 * (`@objectstack/rest` publishes `repeatedQueryParamMessage`), so §4 pins the
 * END state — the status, the `VALIDATION_ERROR` code, the ADR-0112 nested
 * body, and the message BY DERIVATION from the shared function rather than as a
 * literal, so a caller is told the same sentence here as on every other door
 * that carries the rule.
 *
 * §5 is the card's actual acceptance criterion, which neither §1 nor §4 states
 * on its own: the three refusals this door can give are mutually
 * distinguishable by `status` + `error.code`, so a client branching on them can
 * finally tell "your request named the parameter twice" from "not found".
 *
 * ## The harness
 *
 * A real {@link SchemaRegistry} behind the real {@link HttpDispatcher}, the way
 * `packages-writable-verdict.test.ts` and `packages-readonly-gate.test.ts` next
 * door do it — so the rows under test are what `installPackage` actually
 * produces and the answers are the ones the composed door gives.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
// [#17672] The SHARED rule's message, from the module that owns it. §4 asserts
// the wire text by DERIVATION from this function — ⛔ never as a literal, which
// would go on passing while the door answered a sentence of its own that
// happened to match the day it was written. The control that makes the
// derivation falsifiable is the ablation recorded in the PR: change the
// sentence here and this door's answer moves with it.
import { repeatedQueryParamMessage } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.acme.crm';
/** The version actually installed — the row every read below can legitimately serve. */
const INSTALLED = '1.0.0';
/** The card's own repro value: a version this registry does not hold. */
const ABSENT = '99.0.0';

function make() {
    const registry = new SchemaRegistry({ logLevel: 'silent' } as any);
    registry.installPackage({ id: PKG, name: PKG, version: INSTALLED, scope: 'project', type: 'app' } as any);
    const objectql = { registry, manifests: new Map<string, any>() };
    const kernel: any = {
        context: { getService: (name: string) => (name === 'objectql' ? objectql : null) },
    };
    return new HttpDispatcher(kernel);
}

/** Holds the ADR-0106 D4 read set; the caller gate is not this file's subject. */
const reader = (): any => ({
    request: {},
    environmentId: 'pkg-get-version-scope-test',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] },
});

/**
 * `GET /packages/:id` against an EXISTING host.
 *
 * ⛔ Every case that compares two RESPONSE BODIES must issue both requests
 * through this, against ONE `make()`. `SchemaRegistry.installPackage` stamps
 * `installedAt` and `updatedAt` from a single `new Date()` per install
 * (`packages/objectql/src/registry.ts`), and both are declared record fields
 * that `toPackageResponse` carries to the wire. So two hosts hold two rows
 * whose stamps differ whenever the installs straddle a millisecond boundary,
 * and a whole-body `toEqual` between them fails on the clock rather than on
 * anything this door did — a flake that passes on a re-run and comes back.
 *
 * One host makes it deterministic rather than merely likelier: both responses
 * are projections of ONE row, so there is no second install and no second
 * clock read to disagree. Nothing on the read path reads a clock at all —
 * neither `toPackageResponse` (an allowlist copy) nor `withWritableVerdict` (a
 * spread) nor the dispatcher's `success()` envelope — so with one install the
 * stamps cannot move, at any scheduling.
 *
 * ⛔ The repair for such a failure is this shape, ⛔ never dropping the two
 * stamps out of the comparison: whole-body equality is what makes «the same
 * request» mean the same RESPONSE rather than the same status.
 */
async function read(dispatcher: HttpDispatcher, query: Record<string, unknown> | undefined) {
    const r = await dispatcher.handlePackages(`/${PKG}`, 'GET', undefined, query, reader());
    return { status: r.response?.status ?? 200, body: r.response?.body };
}

/** One request on a host of its own — for the cases that compare against no other body. */
async function get(query: Record<string, unknown>) {
    return read(make(), query);
}

describe('#17416 GET /packages/:id — ?version= scopes the read', () => {
    describe('§1 the discriminating pin — with and without ?version= are not the same answer', () => {
        it('a non-installed ?version= is NOT answered with the installed row', async () => {
            // ONE host: the criterion is «the SAME request with and without
            // `?version=`», so both answers have to be about the same row —
            // two hosts would let a difference come from the rows instead.
            const host = make();
            const scoped = await read(host, { version: ABSENT });
            const unscoped = await read(host, {});

            // The discriminating field, not the status alone.
            expect(scoped.status).toBe(404);
            // [#17672] A GENUINE not-found, and it stays one: this is the half
            // of the card that must SURVIVE the repeated-parameter fix.
            expect(scoped.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
            expect(scoped.body?.error?.message).toContain(ABSENT);
            expect(scoped.body?.error?.message).toContain(INSTALLED);
            // ⛔ No package row rode out on the refusal.
            expect(scoped.body?.data).toBeUndefined();

            // ...and the SAME request without the parameter is a different answer.
            expect(unscoped.status).toBe(200);
            expect(unscoped.body?.data?.manifest?.version).toBe(INSTALLED);
            expect(scoped.status).not.toBe(unscoped.status);
            expect(scoped.body).not.toEqual(unscoped.body);
        });

        it('the installed version IS served when it is the one asked for', async () => {
            const r = await get({ version: INSTALLED });
            expect(r.status).toBe(200);
            expect(r.body?.data?.manifest?.id).toBe(PKG);
            expect(r.body?.data?.manifest?.version).toBe(INSTALLED);
        });

        it('an id this registry does not hold keeps the wording packages-single-door pins', async () => {
            const dispatcher = make();
            const r = await dispatcher.handlePackages('/com.absent.pkg', 'GET', undefined, { version: ABSENT }, reader());
            expect(r.response?.status).toBe(404);
            // ⛔ The id 404 is NOT re-worded by the version scope: a package that
            // is not here cannot be "at the wrong version".
            expect(r.response?.body?.error?.message).toBe(`Package 'com.absent.pkg' not found`);
            // [#17672] The second genuine not-found, pinned on its code too.
            expect(r.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        });

        it('an unknown id wins over a repeated ?version= — the #17416 ordering, unchanged', async () => {
            // [#17672] The multiplicity check sits AFTER the id lookup, where
            // #17416 put the version scope. This card moved the STATUS of a
            // refusal, ⛔ not the order of two refusals — so an id this registry
            // does not hold keeps answering `not found` with a repeated
            // parameter riding along, and that is pinned rather than incidental.
            const dispatcher = make();
            const r = await dispatcher.handlePackages('/com.absent.pkg', 'GET', undefined, { version: ['a', 'b'] }, reader());
            expect(r.response?.status).toBe(404);
            expect(r.response?.body?.error?.message).toBe(`Package 'com.absent.pkg' not found`);
        });
    });

    describe('§2 the lit control — the unversioned read is untouched', () => {
        it('answers 200 with the installed row and its writability verdict', async () => {
            const r = await get({});
            expect(r.status).toBe(200);
            expect(r.body?.success).toBe(true);
            expect(r.body?.data?.manifest?.id).toBe(PKG);
            expect(r.body?.data?.manifest?.version).toBe(INSTALLED);
            // The #14375 verdict the door has always stamped, still stamped.
            expect(r.body?.data?.writable).toBe(true);
        });

        it('is byte-identical to the read with no query object at all', async () => {
            const host = make();
            const withEmpty = await read(host, {});
            const withNone = await read(host, undefined);
            expect(withNone.status).toBe(200);
            expect(withNone.body).toEqual(withEmpty.body);
        });
    });

    describe('§3 `latest` and absent name the SAME request', () => {
        it('?version=latest serves the installed row, exactly as no parameter does', async () => {
            const host = make();
            const latest = await read(host, { version: 'latest' });
            const unscoped = await read(host, {});
            expect(latest.status).toBe(200);
            expect(latest.body).toEqual(unscoped.body);
        });
    });

    describe('§4 a repeated ?version= is refused 400 VALIDATION_ERROR, in the shared rule’s words', () => {
        it('two conflicting values are not answered 200 with the installed row', async () => {
            const r = await get({ version: [ABSENT, INSTALLED] });
            // The defect class #17416 closed: a success carrying a row the
            // caller did not ask for. Kept as its own assertion — the status
            // pin below is a stronger claim, and this one is the reason.
            expect(r.status).not.toBe(200);
            expect(r.body?.data).toBeUndefined();
        });

        it('[#17672] answers 400 VALIDATION_ERROR — a request-shape error, not a not-found', async () => {
            const r = await get({ version: [ABSENT, INSTALLED] });
            // ⚠️ The interim answer was `404`. See this file's header: that was
            // the answer of an unreachable rule, never this door's contract.
            expect(r.status).toBe(400);
            // ADR-0112 NESTED body, and the standard catalog's member for 400 —
            // derived by `buildApiError` from the status, so nothing in
            // `packages/spec` moved for it.
            expect(r.body?.error?.code).toBe('VALIDATION_ERROR');
            expect(r.body?.error?.httpStatus).toBe(400);
            expect(r.body?.success).toBe(false);
            expect(r.body?.data).toBeUndefined();
        });

        it('[#17672] the sentence is the SHARED one, by derivation — not a local copy that matches', async () => {
            const r = await get({ version: [ABSENT, INSTALLED] });
            // ⛔ Not a literal. This is the whole point of the card: one rule,
            // one message. Computed from `@objectstack/rest`'s function, so the
            // day that sentence changes, this door's answer changes with it —
            // and a door that grew a second sentence of its own turns this red.
            expect(r.body?.error?.message).toBe(repeatedQueryParamMessage('version', 2));
            // The count is the door's own reading, not a constant in the
            // message: three occurrences say three.
            const three = await get({ version: ['a', 'b', 'c'] });
            expect(three.body?.error?.message).toBe(repeatedQueryParamMessage('version', 3));
            expect(three.status).toBe(400);
        });

        it('ONE occurrence encoded as a one-element array is one occurrence', async () => {
            const host = make();
            const arr = await read(host, { version: [INSTALLED] });
            const str = await read(host, { version: INSTALLED });
            expect(arr.status).toBe(200);
            expect(arr.body).toEqual(str.body);
        });

        it('a one-element array naming an absent version still refuses', async () => {
            const r = await get({ version: [ABSENT] });
            expect(r.status).toBe(404);
            expect(r.body?.error?.message).toContain(ABSENT);
            // [#17672] Still a genuine not-found — the unwrapping rule means
            // one occurrence is one occurrence, so this is NOT a shape error.
            expect(r.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        });
    });

    describe('§5 [#17672] the three refusals are mutually distinguishable', () => {
        it('a client branching on status + code can tell shape-error from not-found', async () => {
            // The card's acceptance criterion, stated as one reading. Before
            // this fix all three were `404` / `RESOURCE_NOT_FOUND` — the whole
            // defect, and the reason §1's two pins alone did not catch it.
            const host = make();
            const repeated = await read(host, { version: [ABSENT, INSTALLED] });
            const wrongVersion = await read(host, { version: ABSENT });
            const unknownId = await (async () => {
                const r = await host.handlePackages('/com.absent.pkg', 'GET', undefined, {}, reader());
                return { status: r.response?.status ?? 200, body: r.response?.body };
            })();

            const seen = [repeated, wrongVersion, unknownId]
                .map((r) => `${r.status} ${r.body?.error?.code}`);
            expect(seen).toEqual([
                '400 VALIDATION_ERROR',
                '404 RESOURCE_NOT_FOUND',
                '404 RESOURCE_NOT_FOUND',
            ]);
            // The request-shape error is separated from BOTH not-founds, which
            // is the distinction the card asked for. The two not-founds remain
            // one class on purpose — they differ by message, and §1 pins that.
            expect(seen[0]).not.toBe(seen[1]);
            expect(seen[0]).not.toBe(seen[2]);
            expect(wrongVersion.body?.error?.message).not.toBe(unknownId.body?.error?.message);
        });
    });
});
