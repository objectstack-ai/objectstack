// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8140] The SDK boundary must not erase the spec types it already depends on.
 *
 * ## What can and cannot pin a return-type narrowing
 *
 * These pins are **type-level on purpose**, and the distinction is load-bearing
 * rather than stylistic. A runtime test — call the method against a stubbed
 * transport, assert on the value — stays GREEN against a client that still
 * declares `Promise<any>`, because the value is identical either way. Only the
 * DECLARED type changed, so only a compile-time assertion can observe it.
 *
 * They are compiled: `packages/client/tsconfig.test.json` includes `src/**\/*`
 * and `package.json`'s `typecheck` script names it through
 * `check:test-typecheck`. A pin in a file no tsc program reads is a phantom
 * check (AGENTS.md, "Build & Test") — this one is read by the same gate that
 * holds every other file in this package at zero errors.
 *
 * ## Two independent failure modes, both red without the change
 *
 * 1. `expectTypeOf(...).toEqualTypeOf<X>()` — `any` is not equal to `X` under
 *    vitest's branded equality, so each of these errors while the method still
 *    returns `any`.
 * 2. `@ts-expect-error` on an assignment to a deliberately WRONG shape — `any`
 *    is assignable to everything, so the suppression goes unused and tsc
 *    reports TS2578 ("Unused '@ts-expect-error' directive"). This is the
 *    direction that catches a "narrowing" to something still permissive.
 *
 * The one guard below that is green in BOTH states is labelled as such; it
 * pins a near-miss trap in the spec rather than this package's annotations.
 */

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { ObjectStackClient, ScopedProjectClient } from './index';
import type {
    AutomationResult,
    DelegableScope,
    ImportObjectResult,
    RecordShare,
    RemoteTable,
    ReportSchedule,
    SavedReport,
    SearchResult,
    ShareLink,
    SharingRuleRow,
} from '@objectstack/spec/contracts';
import type { ActionDescriptor, ExecutionLog, FlowParsed } from '@objectstack/spec/automation';
import type { ExplainDecision } from '@objectstack/spec/security';
import type { InstalledPackage } from '@objectstack/spec/kernel';
import type { PackageRollbackResponse } from '@objectstack/spec/api';
import type { Environment } from '@objectstack/spec/cloud';

declare const client: ObjectStackClient;
declare const scoped: ScopedProjectClient;

/**
 * Compiled, never invoked. Every statement is an assertion tsc evaluates; none
 * of them may perform a request, which is why this is not an `it()` body.
 */
export async function returnTypePrecisionPins(): Promise<void> {
    // ── shape class 1: the contract type, served bare ────────────────────
    // `res.json(await svc.describeDelegableScope(context))` — no envelope.
    expectTypeOf(await client.security.describeDelegableScope()).toEqualTypeOf<DelegableScope>();

    // ── shape class 2: contract type inside a route-built ENVELOPE ───────
    // The census's highest-risk band: `sendOk(res, { tables })` means the
    // caller holds `{ tables: RemoteTable[] }`, NOT `RemoteTable[]`. Binding
    // the obvious-but-wrong `RemoteTable[]` would typecheck against `any` and
    // ship a false declaration — this pin is what makes that a compile error.
    expectTypeOf(await client.datasources.external.listTables('ds')).toEqualTypeOf<{
        tables: RemoteTable[];
    }>();
    expectTypeOf(await client.datasources.external.import('ds', 'people')).toEqualTypeOf<{
        object: ImportObjectResult;
    }>();

    // ── shape class 3: array ELEMENT typed through the client's own unwrap ─
    // These routes answer `{ data: rows }` with no `success` flag, so
    // `unwrapResponse` passes it through and the method folds it to an array.
    expectTypeOf(await client.reports.list()).toEqualTypeOf<SavedReport[]>();
    expectTypeOf(await client.reports.listSchedules('rep_1')).toEqualTypeOf<ReportSchedule[]>();
    expectTypeOf(await client.shares.list('lead', 'rec_1')).toEqualTypeOf<RecordShare[]>();
    expectTypeOf(await client.shares.rules.list()).toEqualTypeOf<SharingRuleRow[]>();
    expectTypeOf(await client.shareLinks.list()).toEqualTypeOf<ShareLink[]>();

    // ── shape class 4: PARTIAL erasure — precise envelope, `any[]` member ──
    expectTypeOf(await client.automation.listActions()).toEqualTypeOf<{
        actions: ActionDescriptor[];
        total: number;
    }>();
    expectTypeOf(await client.automation.runs.list('flow_a')).toEqualTypeOf<{
        runs: ExecutionLog[];
        hasMore: boolean;
    }>();

    // ── shape class 5: the `<T = …>` DEFAULT on a fixed-shape method ───────
    // Called with no type argument, so the default is what is under test. The
    // caller-supplied `data.*` and `actions.*` generics are deliberately NOT
    // here — see this card's report for why they stay `T = any`.
    expectTypeOf(await client.automation.getFlow('flow_a')).toEqualTypeOf<FlowParsed>();
    expectTypeOf(await client.automation.execute('flow_a')).toEqualTypeOf<AutomationResult>();
    expectTypeOf(await client.automation.getRun('flow_a', 'run_1')).toEqualTypeOf<ExecutionLog>();

    // Explicit type arguments still work for a LEGITIMATE narrowing — the
    // parameter was kept, its default moved off `any`, and a constraint was
    // added. This is the compatibility half of the narrowing.
    expectTypeOf(
        await client.automation.getFlow<FlowParsed & { name: 'onboarding' }>('flow_a'),
    ).toEqualTypeOf<FlowParsed & { name: 'onboarding' }>();

    // …and an UNRELATED type is now refused. Without the constraint TypeScript
    // infers `T` from the contextual type and this compiles — which is how the
    // `<T = FlowParsed>` spelling was measured to be only half a fix.
    // @ts-expect-error ExecutionLog does not satisfy `T extends FlowParsed`
    await client.automation.getFlow<ExecutionLog>('flow_a');

    // ── shape class 6: the ScopedProjectClient MIRROR carries the same types ─
    expectTypeOf(await scoped.automation.getFlow('flow_a')).toEqualTypeOf<FlowParsed>();
    expectTypeOf(await scoped.automation.getRun('flow_a', 'run_1')).toEqualTypeOf<ExecutionLog>();
    expectTypeOf(await scoped.packages.list()).toEqualTypeOf<{
        packages: InstalledPackage[];
        total: number;
    }>();

    // ── shape class 7: z.input vs z.infer, decided by the CONTRACT ─────────
    // `ISecurityService.explain` declares `Promise<ExplainDecision>` (the
    // `z.input` form) and the route relays it with `res.json(decision)` — no
    // parse step anywhere on the path. Binding the post-parse
    // `ExplainDecisionParsed` would assert more than the contract guarantees.
    expectTypeOf(await client.security.explain({ object: 'lead' })).toEqualTypeOf<ExplainDecision>();

    // ── direction 2: a WRONG shape must now be rejected ───────────────────
    // Each suppression below is unused — and therefore a TS2578 error — while
    // the method still returns `any`.

    // @ts-expect-error a DelegableScope is not a string
    const wrongScope: string = await client.security.describeDelegableScope();

    // @ts-expect-error the route answers `{ tables }`, not a bare array
    const wrongTables: RemoteTable[] = await client.datasources.external.listTables('ds');

    // @ts-expect-error `reports.list` answers SavedReport[], not a single row
    const wrongReport: SavedReport = await client.reports.list();

    // @ts-expect-error a flow definition is not an execution log
    const wrongFlow: ExecutionLog = await client.automation.getFlow('flow_a');

    void wrongScope;
    void wrongTables;
    void wrongReport;
    void wrongFlow;
}

/**
 * ⚠️ GREEN IN BOTH STATES, and recorded as such rather than padded into the
 * red list above. This pins a trap in `@objectstack/spec`, not an annotation
 * in this file: `SearchResult` sits one import away from `client.search` and
 * is the WRONG type for it — it contracts the per-object
 * `ISearchService.search`, whose hits carry `score` / `document`, while the
 * cross-object route answers hits of `object` / `id` / `title` / `snippet` /
 * `record`. Binding it would compile and be false. `client.search` therefore
 * stays `Promise<any>` deliberately (a missing contract, not a missing
 * annotation) and this guard exists so the next sweep does not "finish" the
 * card by reaching for the same-named neighbour.
 */
type GlobalSearchHit = {
    object: string;
    id: string;
    title: string;
    snippet?: string;
    record: unknown;
};
declare const searchHit: SearchResult['hits'][number];

export function searchResultIsNotTheGlobalSearchShape(): void {
    // @ts-expect-error `SearchHit` (score/document) is not the global-search hit
    const mismatched: GlobalSearchHit = searchHit;
    void mismatched;
}

/**
 * [#11925] The FIFTH erasure spelling: methods with no return annotation at
 * all, whose published type was inferred from `unwrapResponse< …any… >`.
 *
 * Re-measured at `origin/main` the population is **39**, not the 38 the card
 * recorded — its own single-line reproducer cannot see `projects.get`, whose
 * type argument spans several lines. Of the 39, exactly **three** had a
 * verifiable published type to bind to; the other 36 are recorded on the
 * methods themselves and filed (#12034, #12036, #12038). The bar was not "a
 * plausible type exists" but "the route this method calls demonstrably sends
 * this shape", which is what disqualified most of the population.
 *
 * These pins are type-level for the reason the header of this file gives: a
 * runtime test cannot observe a return-type narrowing at all.
 */
export async function returnTypePrecisionPins11925(): Promise<void> {
    // ── bound 1/3: both surfaces agree on this envelope ──────────────────
    // `runtime`'s `/packages` domain and `rest`'s `GET {base}/packages` both
    // send `{ packages, total: packages.length }`. The REST rows also carry a
    // `source` discriminator the dispatcher rows lack, so it stays undeclared
    // — the same treatment #8140 gave the scoped sibling directly above.
    expectTypeOf(await client.packages.list()).toEqualTypeOf<{
        packages: InstalledPackage[];
        total: number;
    }>();

    // ── bound 2/3: the BARE row, no envelope ─────────────────────────────
    // `PATCH /packages/:id` is dispatcher-only and answers `success(pkg)`.
    // This method declared no envelope before the binding either, so only the
    // erased `any` moved.
    expectTypeOf(await client.packages.update('com.acme.crm', { name: 'Acme' }))
        .toEqualTypeOf<InstalledPackage>();

    // ── bound 3/3: the asymmetry named on the card, closed ───────────────
    // `scoped.packages.list` was bound by #8140 because it happened to carry
    // an annotation; its neighbour `get` was not, purely because it lacked
    // one. Same object literal, same route family. The scoped mount is served
    // ONLY by the REST registrar, so unlike the global `client.packages.get`
    // there is one surface and one shape.
    expectTypeOf(await scoped.packages.get('com.acme.crm')).toEqualTypeOf<{
        package: InstalledPackage;
    }>();

    // ── direction 2: a WRONG shape must now be rejected ───────────────────
    // ⚠️ Only ONE of the three below is red before this change, and the split
    // is stated here rather than glossed, because a suppression that was
    // already used is a regression guard and not evidence the binding was
    // needed. Ablation (revert `index.ts` to `origin/main`, keep this file)
    // measured it: the ablated run reports TS2578 at `wrongUpdate` ONLY.
    //
    // `packages.update` was bare `any` before, and `any` IS assignable to
    // `string`, so its suppression went unused → TS2578. The other two were
    // never bare: they declared a real envelope (`{ packages: any[]; total }`
    // and `{ package: any }`) whose MEMBER was the erased part, and an
    // envelope is not assignable to a bare row or array in either state. Their
    // suppressions are used before AND after — regression guards against a
    // future "narrowing" that flattens the envelope away.

    // GREEN IN BOTH STATES — regression guard, not red-before evidence.
    // @ts-expect-error the route answers `{ packages, total }`, not a bare array
    const wrongList: InstalledPackage[] = await client.packages.list();

    // RED BEFORE: `any` is assignable to `string`, so this suppression is
    // unused (TS2578) until `packages.update` is bound.
    // @ts-expect-error `packages.update` answers the row, not a string
    const wrongUpdate: string = await client.packages.update('com.acme.crm', { name: 'Acme' });

    // GREEN IN BOTH STATES — regression guard, not red-before evidence.
    // @ts-expect-error the scoped detail route answers `{ package }`, not the bare row
    const wrongScopedGet: InstalledPackage = await scoped.packages.get('com.acme.crm');

    void wrongList;
    void wrongUpdate;
    void wrongScopedGet;
}

/**
 * ⚠️ GREEN IN BOTH STATES — regression guards, recorded as such rather than
 * counted as evidence that this card's change was needed. Each pins a
 * near-miss in a DEPENDENCY that the next sweep would otherwise reach for.
 *
 * 1. `PackageRollbackResponse` sits one import away from
 *    `client.packages.rollback` and is the wrong type for it: it declares the
 *    VERSION rollback (`{ success, restoredVersion?, message? }`, per its
 *    file header `POST /api/v1/packages/:packageId/rollback — Rollback a
 *    package`), while the client method posts `{ commitId }` and the
 *    dispatcher routes it to `rollbackToPackageCommit` — the ADR-0067 COMMIT
 *    rollback. Binding it would compile and be false.
 *
 * 2. `Environment` is the obvious-looking binding for `client.projects.*` and
 *    is camelCase, while the `/api/v1/cloud/*` control plane those methods
 *    call speaks snake_case (measured from this repo's own CLI consumers:
 *    `p.display_name`, `p.organization_id`, `p.is_default`). Binding it would
 *    typecheck, be false, and break those callers.
 */
declare const versionRollbackPayload: PackageRollbackResponse['data'];
declare const specEnvironmentRow: Environment;

export function packageRollbackResponseIsNotTheCommitRollbackShape(): void {
    // @ts-expect-error the VERSION-rollback payload carries no commit identity
    void versionRollbackPayload.commitId;
}

export function environmentIsNotTheCloudWireRow(): void {
    // @ts-expect-error the control plane sends `display_name`; this row declares `displayName`
    void specEnvironmentRow.display_name;
}

describe('client SDK return-type precision (#8140)', () => {
    it('exposes the type-level pins to tsc without executing a request', () => {
        // The assertions above are evaluated by `tsc` under
        // `tsconfig.test.json`, not by this runtime. This case exists so the
        // file is a test file and the functions are referenced; it is NOT the
        // pin, and it cannot be — a runtime call cannot observe a return-type
        // narrowing at all.
        expect(typeof returnTypePrecisionPins).toBe('function');
        expect(typeof searchResultIsNotTheGlobalSearchShape).toBe('function');
        expect(typeof returnTypePrecisionPins11925).toBe('function');
        expect(typeof packageRollbackResponseIsNotTheCommitRollbackShape).toBe('function');
        expect(typeof environmentIsNotTheCloudWireRow).toBe('function');
    });

    it('unwraps exactly one `{ success, data }` envelope — the premise the annotations rest on', async () => {
        // Runtime-observable and deliberately so: every annotation added by
        // this card describes the POST-unwrap value, so if `unwrapResponse`
        // ever stripped two envelopes (or none) the declarations would become
        // false without a single type error. This guard is green before and
        // after the change — it protects the premise, not the narrowing.
        const enveloped = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ success: true, data: { isTenantAdmin: true, scopes: [], placeableBusinessUnitIds: [], assignablePositions: [] } }),
            headers: new Headers(),
        });
        const c1 = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: enveloped });
        expect(await c1.security.describeDelegableScope()).toEqual({
            isTenantAdmin: true,
            scopes: [],
            placeableBusinessUnitIds: [],
            assignablePositions: [],
        });

        // A bare body (no `success` flag) is passed through untouched — this is
        // the arm `security.explain`, `approvals.*` and the report routes take.
        const bare = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ isTenantAdmin: false, scopes: [], placeableBusinessUnitIds: ['bu_1'], assignablePositions: [] }),
            headers: new Headers(),
        });
        const c2 = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: bare });
        expect((await c2.security.describeDelegableScope()).placeableBusinessUnitIds).toEqual(['bu_1']);
    });
});
