// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17123 — a `notify` node that reached NOBODY must not read like a run that
 * had nobody to reach.
 *
 * ## What was measured, and why a green suite proved nothing
 *
 * The card's reading: a `notify` node whose delivery count came back zero
 * contributed `acted: 0` and nothing else to the run summary, so a flow whose
 * only effect-bearing node is that one folded to
 * `selected: 0, acted: 0, unmeasured: 0` — byte for byte the summary of a run
 * that had nothing to notify about, and of a run whose `notify` node never
 * executed. The run reported healthy. Everything was green while nothing was
 * delivered, which is why the assertions below are about the RUN SUMMARY an
 * operator reads and never about a call count.
 *
 * ⛔ The one signal that existed was a log line, and the log line is precisely
 * what nobody saw. It is not asserted here as the remedy; the remedy has to be
 * on the durable summary.
 *
 * ## The differential control IS the whole reading (the card's ⭐)
 *
 * `unmeasured=0` on its own is unreadable: it is equally "this flow notified
 * nobody" and "this flow had nothing to notify about today". What separates
 * them is driving the SAME flow, with the SAME recipient configuration, over
 * the SAME data, through the two trigger families — and on both storage backends. So
 * every case below runs as a matrix:
 *
 *   trigger family  x  data layer
 *   ─────────────────────────────────────────────────────────────────────────
 *   `type: 'schedule'` cron tick             x  in-process (non-SQL) engine
 *   `POST /api/v1/automation/:name/trigger`  x  SQL (ObjectQL + better-sqlite3)
 *
 * ⚠️ DECLARED DEVIATION — the card asks for "memory and sqlite", and the SQL
 * half is exactly that. The memory half is NOT the mingo `InMemoryDriver`, and
 * neither substitute was available without a maintainer-only widening:
 *
 *   - `@objectstack/driver-memory` is investment-FROZEN and its consumer set is
 *     a maintainer ruling. `pnpm check:driver-memory-census` refuses a new
 *     binding and says in as many words that adding a ledger entry to silence
 *     it is not this author's call.
 *   - `@objectstack/driver-sqlite-wasm` (the migrate route) is outside this
 *     package's SHRINK-ONLY type-source registry, and
 *     `pnpm check:type-source-resolution` states that widening it is not the
 *     fix and that `paths` is the measured-wrong tool here (this package's
 *     `rootDir` is `src`, which is the TS6059 shape that gate names). Its own
 *     remedy for that case is "do NOT take the dependency".
 *
 * So the second arm is an in-process `IDataEngine` — the same CLASS of store as
 * the mingo driver (in-process, non-SQL, no schema sync) — stood up here rather
 * than imported. It is a functional store, not a capture: the control case
 * below requires it to actually deliver, so an arm that could not answer "yes"
 * fails instead of passing quietly. Admitting the real memory driver needs the
 * ruling named above.
 *
 * Neither family is hand-rolled here. The schedule arm is handed the literal
 * `AutomationContext` the production `ScheduleTrigger` builds for a fired
 * window — `{ event: 'schedule', params: { jobId, flowName, schedule } }`,
 * carrying no user and no organization — and the API arm is handed the output
 * of the production `buildAutomationContext` (`@objectstack/runtime`'s ONE
 * construction point for both trigger routes) over a session execution
 * context. A test that invented its own two context shapes could agree with
 * itself while disagreeing with both doors.
 *
 * ## Why #16659 landing does not close this, stated as a measurement
 *
 * #16659 makes a scheduled flow carry its organization. That stops ONE cause
 * of a zero delivery; it does not make a zero delivery visible. The schedule
 * arm here is therefore driven in BOTH shapes:
 *
 *   - `cronTickToday()`   — no organization, the shape production builds now;
 *   - `cronTickWithOrg()` — carrying the PLATFORM organization, the shape a
 *     scheduled flow has once #16659 lands.
 *
 * On a multi-organization install the platform organization is not where the
 * recipients live, so the org-scoped `role:` expansion
 * (`RecipientResolver.resolveRole` -> `where { role, organization_id }`)
 * resolves to nobody and `emit()` returns `delivered: 0, enqueued: 0` from its
 * "resolved to 0 recipients" path. The silence is identical to the card's, and
 * it arrives through a completely different cause — which is the card's point.
 *
 * ## The three-way comparison the fix is actually judged on
 *
 * Pairwise inequality is too weak: before the fix the zero-delivery run and
 * the delivering run already differed by an `unmeasured` token that sat on the
 * OTHER row. What was wrong is that the zero-delivery run rendered as the
 * platform's EMPTY state, so the rows compared are three:
 *
 *   1. the zero-delivery run,
 *   2. the delivering run,
 *   3. a run of the same flow that genuinely had nothing to notify about.
 *
 * Before the fix (1) === (3). The pin is that (1) now differs from both, and
 * specifically that (1) lands INSIDE the broken-sweep first filter
 * (`selected > 0 AND acted = 0 AND unmeasured = 0`) whose first clause it could
 * never satisfy while the node reported no `selected` at all.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
    MessagingService,
    MemoryNotificationOutbox,
    createInboxChannel,
    InboxMessage,
    NotificationReceipt,
    NotificationPreference,
} from '@objectstack/service-messaging';
import type { AutomationContext, IDataEngine } from '@objectstack/spec/contracts';
import type { FlowRunSummary } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerNotifyNode } from './notify-node.js';
import { formatRunSummaryLine } from '../run-summary.js';

/** The employer organization whose admin members are the intended recipients. */
const ORG_EMPLOYER = 'org_employer_alpha';
/** The platform organization — the one a cron tick acts under; no admin members. */
const ORG_PLATFORM = 'org_platform';
/** The employer organization's admin members — the intended recipients. */
const MANAGERS = ['user_m1', 'user_m2', 'user_m3', 'user_m4'];

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

// ── The two trigger families, each in the shape its production door builds ──

/**
 * `type: 'schedule'` as it fires TODAY: `ScheduleTrigger.start`'s callback
 * context, verbatim — no `userId`, no `tenantId`.
 */
function cronTickToday(): AutomationContext {
    return {
        event: 'schedule',
        params: { jobId: 'job_nudge', flowName: 'nudge', schedule: '0 9 * * *' },
    } as AutomationContext;
}

/**
 * `type: 'schedule'` as it fires once #16659 lands: the same context, now
 * carrying the organization the scheduled flow belongs to. On a
 * multi-organization install that is the platform organization, not the
 * employer one the recipients live in.
 */
function cronTickWithOrg(): AutomationContext {
    return { ...cronTickToday(), tenantId: ORG_PLATFORM } as AutomationContext;
}

/**
 * `POST /api/v1/automation/:name/trigger` under a session, built by the
 * production context builder rather than by hand.
 *
 * Inlined rather than imported: `@objectstack/runtime` depends on this package,
 * so importing it here would invert the dependency. The shape is the tail of
 * `buildAutomationContext` (`runtime/src/domains/automation.ts`) — the identity
 * fields it copies off `context.executionContext` — and
 * `apiTriggerMatchesProductionBuilder` below pins that this local copy still
 * equals what that function produces for the same session.
 */
function apiTrigger(session: { userId: string; tenantId: string }): AutomationContext {
    return {
        params: {},
        object: undefined,
        event: 'manual',
        userId: session.userId,
        tenantId: session.tenantId,
    } as AutomationContext;
}

// ── The stack ───────────────────────────────────────────────────────────────

type DriverKind = 'in-process' | 'sqlite';

/**
 * The `sys_member` / `sys_notification` shapes this harness needs, declared as
 * fixtures rather than imported from `@objectstack/platform-objects` — that
 * package is outside this package's shrink-only type-source registry (see the
 * deviation note in the header), and only two columns of each are load-bearing
 * here anyway: what `RecipientResolver.resolveRole` filters on, and what
 * `MessagingService.writeEvent` inserts.
 */
const MEMBER_FIXTURE = {
    name: 'sys_member',
    label: 'Member',
    fields: {
        user_id: { name: 'user_id', label: 'User', type: 'text' },
        role: { name: 'role', label: 'Role', type: 'text' },
        organization_id: { name: 'organization_id', label: 'Organization', type: 'text' },
    },
};

const NOTIFICATION_FIXTURE = {
    name: 'sys_notification',
    label: 'Notification',
    fields: {
        // Exactly the columns `MessagingService.writeEvent` inserts — a fixture
        // that drifts from the producer fails loudly on the SQL arm (an unknown
        // field is refused there), which is the arm keeping this honest.
        topic: { name: 'topic', label: 'Topic', type: 'text' },
        payload: { name: 'payload', label: 'Payload', type: 'json' },
        severity: { name: 'severity', label: 'Severity', type: 'text' },
        dedup_key: { name: 'dedup_key', label: 'Dedup key', type: 'text' },
        source_object: { name: 'source_object', label: 'Source object', type: 'text' },
        source_id: { name: 'source_id', label: 'Source id', type: 'text' },
        actor_id: { name: 'actor_id', label: 'Actor', type: 'text' },
        organization_id: { name: 'organization_id', label: 'Organization', type: 'text' },
        created_at: { name: 'created_at', label: 'Created at', type: 'datetime' },
    },
};

const FIXTURES = [MEMBER_FIXTURE, NOTIFICATION_FIXTURE, InboxMessage, NotificationReceipt, NotificationPreference];

/**
 * An in-process, non-SQL `IDataEngine` — a real store (rows go in, `find` and
 * `findOne` read them back through the same `where` the SQL arm uses), not a
 * capture. This is the arm that stands in for the frozen mingo driver.
 */
function inProcessEngine(): IDataEngine {
    const tables = new Map<string, Record<string, unknown>[]>();
    let seq = 0;
    const rowsOf = (object: string): Record<string, unknown>[] => {
        const existing = tables.get(object);
        if (existing) return existing;
        const fresh: Record<string, unknown>[] = [];
        tables.set(object, fresh);
        return fresh;
    };
    const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => row[k] === v);

    return {
        async insert(object: string, row: Record<string, unknown>) {
            const stored = { ...row, id: row.id != null ? String(row.id) : `row_${++seq}` };
            rowsOf(object).push(stored);
            return stored;
        },
        async find(object: string, query?: { where?: Record<string, unknown>; limit?: number }) {
            const hits = rowsOf(object).filter((r) => matches(r, query?.where));
            return query?.limit ? hits.slice(0, query.limit) : hits;
        },
        async findOne(object: string, query?: { where?: Record<string, unknown> }) {
            return rowsOf(object).find((r) => matches(r, query?.where));
        },
    } as unknown as IDataEngine;
}

/**
 * A real stack: ObjectQL over a real driver, the real `MessagingService` with
 * the real outbox-backed (ADR-0030 P1) delivery path and the real inbox
 * channel, behind the real `notify` node. The defect lives in the seam between
 * `emit()` and the run summary, so a fake that answers `emit()` in one shot
 * could not express it.
 */
async function boot(kind: DriverKind) {
    let data: IDataEngine;
    let driver: any;

    if (kind === 'sqlite') {
        driver = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
        });
        await driver.connect();
        const ql = new ObjectQL();
        ql.registerDriver(driver, true);
        const PKG = '@objectstack/service-messaging';
        for (const o of FIXTURES) ql.registry.registerObject(o as any, PKG, PKG);
        await ql.syncSchemas();
        data = ql as unknown as IDataEngine;
    } else {
        data = inProcessEngine();
    }

    // The employer organization's admins — the ONLY members on the install.
    for (const userId of MANAGERS) {
        await (data as any).insert(
            'sys_member',
            { user_id: userId, role: 'admin', organization_id: ORG_EMPLOYER },
            { context: { isSystem: true } } as any,
        );
    }

    const outbox = new MemoryNotificationOutbox(1);
    const messaging = new MessagingService({
        logger: silentLogger(),
        getData: () => data as any,
        outbox,
    });
    messaging.registerChannel(createInboxChannel({ getData: () => data as any }));

    const engine = new AutomationEngine(silentLogger());
    registerNotifyNode(engine, {
        logger: silentLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging : undefined),
    } as any);
    engine.registerFlow('nudge', notifyFlow());
    engine.registerFlow('quiet_day', nothingToNotifyFlow());

    return { data, engine, outbox, driver };
}

/**
 * ONE flow, ONE recipient configuration — `role:admin`, resolved against the
 * acting organization by the messaging service. Both trigger families run this
 * same registration.
 */
function notifyFlow(): any {
    return {
        name: 'nudge',
        label: 'Nudge',
        type: 'autolaunched',
        nodes: [
            // The schedule binding lives on the START node's config, which is
            // what makes this the `type: 'schedule'` half of the differential.
            { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
            {
                id: 'notify',
                type: 'notify',
                label: 'Notify admins',
                config: {
                    topic: 'renewal.due',
                    recipients: ['role:admin'],
                    title: 'Renewal due',
                    message: 'Ping',
                    channels: ['inbox'],
                },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'notify' },
            { id: 'e2', source: 'notify', target: 'end' },
        ],
    };
}

/**
 * Row 3 of the comparison: the same shape of run with genuinely nothing to
 * notify about — the reading the card says `unmeasured=0` collapses into.
 */
function nothingToNotifyFlow(): any {
    return {
        name: 'quiet_day',
        label: 'Quiet day',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

/** The triple the broken-sweep first filter reads, as one comparable value. */
function triple(s: FlowRunSummary): string {
    return `selected=${s.selected} acted=${s.acted} unmeasured=${s.unmeasured ?? 'absent'}`;
}

/** Inside `selected > 0 AND acted = 0 AND unmeasured = 0`? */
function insideBrokenSweepFilter(s: FlowRunSummary): boolean {
    return s.selected > 0 && s.acted === 0 && s.unmeasured === 0;
}

/** The notify node's own row of the per-node breakdown. */
function notifyNodeRow(s: FlowRunSummary) {
    return s.nodes.find((n) => n.nodeId === 'notify');
}

const LINE = { flowName: 'nudge', runId: 'run_fixed', status: 'completed' };

const DRIVERS: DriverKind[] = ['in-process', 'sqlite'];

describe.each(DRIVERS)('#17123 zero-delivery is distinguishable [driver=%s]', (kind) => {
    let stack: Awaited<ReturnType<typeof boot>> | undefined;

    afterEach(async () => {
        try { await (stack?.driver as any)?.disconnect?.(); } catch { /* noop */ }
        stack = undefined;
    });

    it('DIFFERENTIAL CONTROL: the two trigger families no longer render the same run', async () => {
        stack = await boot(kind);

        // Family 1 — the cron tick, in the shape #16659 gives it. The platform
        // organization has no admin members, so the org-scoped `role:` expansion
        // resolves to nobody and `emit()` returns delivered 0 / enqueued 0.
        const scheduled = await stack.engine.execute('nudge', cronTickWithOrg());
        // Family 2 — the REST trigger under an employer session.
        const triggered = await stack.engine.execute(
            'nudge',
            apiTrigger({ userId: 'user_admin', tenantId: ORG_EMPLOYER }),
        );

        expect(scheduled.success, JSON.stringify(scheduled)).toBe(true);
        expect(triggered.success, JSON.stringify(triggered)).toBe(true);

        const zero = scheduled.summary!;
        const delivering = triggered.summary!;

        // The measurement that says the two arms really are what they claim:
        // one reached nobody, the other reached the four admins. Asserted on
        // the durable outbox, not on the summary the fix touches.
        const enqueued = await stack.outbox.list();
        expect(
            enqueued.map((r) => r.recipientId ?? (r as any).recipient_id).sort(),
            `only the API arm may have enqueued anything: ${JSON.stringify(enqueued)}`,
        ).toEqual([...MANAGERS].sort());

        // ⭐ The card's acceptance shape: the two rows must not be equal.
        expect(triple(zero)).not.toBe(triple(delivering));

        // …and specifically, the zero-delivery run now SAYS it reached nobody:
        // it addressed a recipient list and dispatched nothing, measured.
        expect(zero.selected).toBeGreaterThan(0);
        expect(zero.acted).toBe(0);
        expect(zero.unmeasured).toBe(0);
        expect(insideBrokenSweepFilter(zero)).toBe(true);

        // NEGATIVE CONTROL: the delivering run stays OUT of that filter — the
        // fix must not turn a healthy notify into an alert.
        expect(insideBrokenSweepFilter(delivering)).toBe(false);
        expect(delivering.unmeasured).toBeGreaterThan(0);

        // The rendered summary line, which is what an operator greps.
        const zeroLine = formatRunSummaryLine(LINE, zero);
        const deliveringLine = formatRunSummaryLine(LINE, delivering);
        expect(zeroLine).not.toBe(deliveringLine);
        expect(zeroLine).toContain(`selected=${zero.selected}`);
        expect(zeroLine).toContain('acted=0');
        // The zero is MEASURED, so no `unmeasured` token qualifies it away.
        expect(zeroLine).not.toContain('unmeasured=');

        // ⭐ The card's table, pinned VERBATIM rather than described, so the
        // rows published on the PR are a measurement anyone can re-run and not
        // a recollection. Before this fix both of these read `selected=0`, and
        // the first was byte-identical to the quiet-day row below.
        expect(zeroLine).toBe(
            '[automation] run flow=nudge run=run_fixed status=completed selected=1 acted=0 skipped=0 failed=0',
        );
        expect(deliveringLine).toBe(
            '[automation] run flow=nudge run=run_fixed status=completed selected=1 acted=0 skipped=0 failed=0 unmeasured=1',
        );
    });

    it('the zero-delivery run stops reading like a run that had nothing to notify about', async () => {
        // Row 3 of the three-way comparison. Before the fix rows 1 and 3 were
        // the same triple, which is the whole finding: a flow that quietly
        // stopped delivering read exactly like a quiet day.
        stack = await boot(kind);

        const zero = (await stack.engine.execute('nudge', cronTickWithOrg())).summary!;
        const quiet = (await stack.engine.execute('quiet_day', cronTickWithOrg())).summary!;

        expect(triple(quiet)).toBe('selected=0 acted=0 unmeasured=0');
        expect(triple(zero)).not.toBe(triple(quiet));
        // The third row of the published table, verbatim.
        expect(formatRunSummaryLine({ ...LINE, flowName: 'quiet_day' }, quiet)).toBe(
            '[automation] run flow=quiet_day run=run_fixed status=completed selected=0 acted=0 skipped=0 failed=0',
        );
        expect(insideBrokenSweepFilter(quiet)).toBe(false);
        expect(insideBrokenSweepFilter(zero)).toBe(true);
    });

    it('the notify node names it on its own row, not only in the run totals', async () => {
        stack = await boot(kind);

        const zero = (await stack.engine.execute('nudge', cronTickWithOrg())).summary!;
        const delivering = (
            await stack.engine.execute('nudge', apiTrigger({ userId: 'user_admin', tenantId: ORG_EMPLOYER }))
        ).summary!;

        const zeroRow = notifyNodeRow(zero)!;
        const deliveringRow = notifyNodeRow(delivering)!;

        // The node ran, succeeded, addressed recipients — and dispatched none.
        expect(zeroRow.status).toBe('success');
        expect(zeroRow.runs).toBe(1);
        expect(zeroRow.selected).toBeGreaterThan(0);
        expect(zeroRow.acted).toBe(0);
        expect(zeroRow.unmeasured).toBeUndefined();

        // The delivering node reports the SAME `selected` and qualifies its
        // count instead of claiming a delivery the outbox has not made yet.
        expect(deliveringRow.selected).toBe(zeroRow.selected);
        expect(deliveringRow.unmeasured).toBe(1);
        expect(JSON.stringify(zeroRow)).not.toBe(JSON.stringify(deliveringRow));
    });

    it('CONTROL: the cron tick as it fires TODAY (no organization) still delivers — the schedule family is not blanket-silent', async () => {
        // Without this, the zero above could be read as "scheduled runs never
        // deliver in this harness". Today's org-less cron tick resolves
        // `role:admin` UNSCOPED, so it reaches the four admins and its run
        // reads like the API arm's.
        stack = await boot(kind);

        const orgless = (await stack.engine.execute('nudge', cronTickToday())).summary!;

        expect(orgless.selected).toBeGreaterThan(0);
        expect(orgless.unmeasured).toBeGreaterThan(0);
        expect(insideBrokenSweepFilter(orgless)).toBe(false);
        expect((await stack.outbox.list()).length).toBe(MANAGERS.length);
    });
});

describe('#17123 the API arm matches the production trigger-context builder', () => {
    it('apiTriggerMatchesProductionBuilder: the identity fields this file builds are the ones the REST door copies', () => {
        // `buildAutomationContext` cannot be imported here without inverting the
        // package dependency, so the coupling is pinned as a shape assertion
        // over the fields it copies off `executionContext` — `userId` and
        // `tenantId` — plus the `event: 'manual'` default it sets for a body
        // that names no event. A drift in either makes this fail loudly instead
        // of leaving the API arm quietly unlike the door it stands for.
        const ctx = apiTrigger({ userId: 'user_admin', tenantId: ORG_EMPLOYER }) as any;
        expect(ctx.userId).toBe('user_admin');
        expect(ctx.tenantId).toBe(ORG_EMPLOYER);
        expect(ctx.event).toBe('manual');
        expect(ctx.params).toEqual({});
    });
});
