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

describe('client SDK return-type precision (#8140)', () => {
    it('exposes the type-level pins to tsc without executing a request', () => {
        // The assertions above are evaluated by `tsc` under
        // `tsconfig.test.json`, not by this runtime. This case exists so the
        // file is a test file and the functions are referenced; it is NOT the
        // pin, and it cannot be — a runtime call cannot observe a return-type
        // narrowing at all.
        expect(typeof returnTypePrecisionPins).toBe('function');
        expect(typeof searchResultIsNotTheGlobalSearchShape).toBe('function');
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
