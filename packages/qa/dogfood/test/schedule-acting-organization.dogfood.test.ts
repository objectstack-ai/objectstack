// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#16659] A time-triggered flow declares its acting organization and the run
// executes as it — proven end to end through the real automation + messaging +
// ObjectQL stack, on BOTH drivers.
//
// @proof: schedule-acting-organization
//
// ## What was green and wrong
//
// `ScheduleTrigger` built its `AutomationContext` with no `tenantId`, because a
// job tick carries no identity. Two consumers read that key and both resolved
// NULL: `notify-node.ts` threads it onto the notification it emits (#11303),
// and `AutomationEngine.recordLog` copies it onto the `sys_automation_run`
// history row (#10101). On an install holding more than one `sys_organization`
// the #8844 guard then refused every tenant-scoped row beneath the run — the
// inbox rows and the history row — one layer BELOW anything that summarises the
// run, so the tick reported `unmeasured=0` and read healthy.
//
// ⚠️ Every assertion in this file passes vacuously if the run never happens at
// all, which is why each pin also asserts a POSITIVE fact about the run
// (the flow bound, the tick fired, the notification carries the declared id) and
// why the DIFFERENTIAL CONTROL below is in the same file: the same flow, on the
// same stack, through `POST /api/v1/automation/:name/trigger` under a session.
// That run reaches the identical `notify` node through the identical messaging
// chain, and its organization comes from the SESSION rather than from the
// declaration — so if the schedule pin ever goes green for a reason that has
// nothing to do with the fix, the control goes green the same way and the
// contrast that carries the proof is gone.
//
// ## The multi-organization condition
//
// Two `sys_organization` rows under the DEFAULT `single` posture — which is
// exactly the install the card measured, and exactly the state
// `system-write-organization.ts` calls `ambiguous-organization`: the posture is
// what the deployment asked for, the count is what the data is, and where they
// disagree the guard refuses rather than guessing. No enterprise organization
// plugin and no walled posture are needed to reach it, and using one would test
// a different topology than the report.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MessagingServicePlugin, INBOX_OBJECT, NOTIFICATION_EVENT_OBJECT } from '@objectstack/service-messaging';
import { ScheduleTrigger, type JobServiceSurface, type TriggerLogger } from '@objectstack/trigger-schedule';
import type { JobHandler, JobSchedule } from '@objectstack/spec/contracts';
import {
  scheduleOrganizationStack,
  declaringScheduleFlow,
  organizationLessScheduleFlow,
} from './fixtures/schedule-organization-fixture.js';

const RUN_HISTORY_OBJECT = 'sys_automation_run';
const DECLARED_FLOW = 'sched_org_declared';
const UNDECLARED_FLOW = 'sched_org_undeclared';

/**
 * A job service the test fires by hand. The platform's own adapter owns cron
 * timing; what these pins need is a DETERMINISTIC tick, and a real cron would
 * make the suite wait on a wall clock to observe a property that has nothing to
 * do with when the tick happens.
 */
function fakeJobService(): {
  service: JobServiceSurface;
  has(name: string): boolean;
  names(): string[];
  fire(name: string, jobId?: string): Promise<void>;
} {
  const jobs = new Map<string, { schedule: JobSchedule; handler: JobHandler }>();
  return {
    service: {
      async schedule(name: string, schedule: JobSchedule, handler: JobHandler) {
        jobs.set(name, { schedule, handler });
      },
      async cancel(name: string) {
        jobs.delete(name);
      },
    },
    has: (name) => jobs.has(name),
    names: () => [...jobs.keys()],
    async fire(name, jobId = 'tick-1') {
      const job = jobs.get(name);
      if (!job) throw new Error(`no job registered under '${name}' — registered: ${[...jobs.keys()].join(', ') || '(none)'}`);
      await job.handler({ jobId, data: {} } as never);
    },
  };
}

/** Records every line the trigger logs, so the refusal pin can read it. */
function recordingLogger(): { logger: TriggerLogger; errors: string[]; warns: string[] } {
  const errors: string[] = [];
  const warns: string[] = [];
  return {
    logger: {
      info: () => {},
      debug: () => {},
      warn: (msg: string) => { warns.push(String(msg)); },
      error: (msg: string) => { errors.push(String(msg)); },
    },
    errors,
    warns,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ql = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Engine = any;

const SYS = { context: { isSystem: true } };

/**
 * Both drivers. The organization a run carries is resolved by the ObjectQL
 * engine's system-insert path and stamped by the driver, and the two drivers
 * reach that path differently — the SQL driver through
 * `injectTenantOnInsert` + the partitioned unique index, the memory driver
 * through its own tenant scope. A property about which organization a row lands
 * with cannot be measured on one of them.
 */
for (const databaseDriver of ['sqlite-wasm', 'memory'] as const) {
  describe(`dogfood [${databaseDriver}]: a scheduled run executes as its declared organization (#16659)`, () => {
    let stack: VerifyStack;
    let ql: Ql;
    let automation: Engine;
    let job: ReturnType<typeof fakeJobService>;
    let log: ReturnType<typeof recordingLogger>;
    let orgA: string;
    let orgB: string;
    let recipientId: string;
    let memberToken: string;

    beforeAll(async () => {
      stack = await bootStack(scheduleOrganizationStack as never, {
        automation: true,
        databaseDriver,
        // `orgContext` binds the harness admin to a default organization, which
        // is what lets the HTTP differential control carry an organization of
        // its OWN (a caller bound to none fails to deliver for the same reason
        // the schedule path used to, leaving the contrast certifying nothing).
        //
        // ⚠️ sqlite-wasm ONLY, and the asymmetry is measured rather than
        // assumed: `driver-memory` declares NO row-level tenant isolation and
        // REFUSES any call the engine hands a tenant scope
        // (`MemoryMultiTenantUnsupportedError`, #16589 / #6915). An org-bound
        // session makes the authorization resolver's own `sys_position` read
        // tenant-scoped, so on that driver every HTTP request from such a
        // session 503s before reaching any route. The HTTP control is therefore
        // structurally unavailable there — see the driver-split control below,
        // which pins that refusal so this exemption expires by itself the day
        // the driver gains isolation.
        orgContext: databaseDriver === 'sqlite-wasm',
        // ⛔ Reliable delivery OFF, and not as a convenience: with the outbox +
        // dispatcher on, `sys_inbox_message` is written by a background
        // dispatcher on its own schedule, so an assertion made right after the
        // tick reads an empty table whether or not the organization threaded.
        // The property under test is WHICH ORGANIZATION the row carries, not
        // when the dispatcher gets to it.
        extraPlugins: [new MessagingServicePlugin({ reliableDelivery: false })],
      });
      memberToken = await stack.signIn();
      ql = await stack.kernel.getServiceAsync('objectql');
      automation = stack.kernel.getService('automation');
      expect(automation?.registerFlow, 'automation engine must be wired').toBeTruthy();

      // ── the multi-organization condition ──────────────────────────────
      // TWO organizations, so "which organization owns this row" stops being
      // derivable and the #8844 guard is live. One would make every pin below
      // pass without the fix, because a single-organization install has a
      // derivable answer and the guard supplies it.
      // Two MORE organizations on top of whatever `orgContext` bootstrapped.
      const a = await ql.insert('sys_organization', { name: 'Acme Employer' }, SYS);
      const b = await ql.insert('sys_organization', { name: 'Beta Employer' }, SYS);
      orgA = String(a.id);
      orgB = String(b.id);
      expect(orgA, 'organization A must have an id').toBeTruthy();
      expect(orgB, 'organization B must have an id').toBeTruthy();
      expect(orgA).not.toBe(orgB);
      const orgs = await ql.find('sys_organization', { ...SYS });
      expect(
        (orgs ?? []).length,
        'the guard only refuses when the install holds MORE THAN ONE organization — with one, every pin below passes unfixed',
      ).toBeGreaterThanOrEqual(2);

      const admin = await ql.findOne('sys_user', { where: { email: 'admin@objectos.ai' }, ...SYS });
      recipientId = String(admin?.id ?? 'usr_system');

      automation.registerFlow(DECLARED_FLOW, declaringScheduleFlow(orgA, recipientId));
      automation.registerFlow(UNDECLARED_FLOW, organizationLessScheduleFlow(recipientId));

      job = fakeJobService();
      log = recordingLogger();
      automation.registerTrigger(new ScheduleTrigger(() => job.service, log.logger));
      await new Promise<void>((r) => setTimeout(r, 0));
    }, 120_000);

    afterAll(async () => {
      await stack?.stop();
    });

    /** Rows of `object` this run wrote, read elevated so RLS never hides one. */
    async function rows(object: string, where: Record<string, unknown> = {}): Promise<Array<Record<string, unknown>>> {
      return (await ql.find(object, { where, ...SYS })) ?? [];
    }

    /**
     * Wait for a row to appear, bounded.
     *
     * `recordTerminal` is a fire-and-forget write (`void this.store.recordTerminal(...)`),
     * so the history row lands SHORTLY AFTER the tick's handler resolves. ⛔ This
     * is a settle, never a retry that could paper over a refusal: a REFUSED
     * insert never lands, so the bound expires and the assertion is red — which
     * is exactly what it read on the unfixed tree.
     */
    async function settleRows(
      object: string,
      where: Record<string, unknown> = {},
      timeoutMs = 5_000,
    ): Promise<Array<Record<string, unknown>>> {
      const deadline = Date.now() + timeoutMs;
      let seen: Array<Record<string, unknown>> = [];
      do {
        seen = await rows(object, where);
        if (seen.length > 0) return seen;
        await new Promise<void>((r) => setTimeout(r, 50));
      } while (Date.now() < deadline);
      return seen;
    }

    it('precondition: the declaring flow BOUND and the tick actually ran', async () => {
      expect(
        job.has(`flow-schedule:${DECLARED_FLOW}`),
        `the declaring flow did not bind — registered jobs: ${job.names().join(', ') || '(none)'}`,
      ).toBe(true);
      await job.fire(`flow-schedule:${DECLARED_FLOW}`, 'tick-16659');
      const history = await settleRows(RUN_HISTORY_OBJECT, { flow_name: DECLARED_FLOW });
      expect(
        history.length,
        'the tick produced no run at all — every pin below would then pass vacuously',
      ).toBeGreaterThanOrEqual(1);
    });

    // ── CONSEQUENCE (1) — delivery ────────────────────────────────────────
    //
    // PREDICTION, written before the run: on the unfixed tree the notification
    // lands with `organization_id = NULL` and `sys_inbox_message` is EMPTY,
    // because the inbox row is tenant-scoped and the guard refuses a
    // system-context write that carries no organization on an install holding
    // two. After the fix the notification carries `orgA` and the inbox row
    // exists and carries `orgA`.
    it('(1) the notification and its inbox row carry the DECLARED organization', async () => {
      const notifications = await settleRows(NOTIFICATION_EVENT_OBJECT);
      expect(notifications.length, 'the notify node emitted nothing').toBeGreaterThanOrEqual(1);
      expect(
        notifications.map((n) => n.organization_id ?? 'NULL'),
        'a scheduled run must stamp the organization it declared — NULL is the unfixed reading',
      ).toContain(orgA);

      const inbox = await settleRows(INBOX_OBJECT);
      expect(
        inbox.length,
        'sys_inbox_message is EMPTY — the tenant-scoped write below the notification was refused, which is the defect',
      ).toBeGreaterThanOrEqual(1);
      expect(inbox.map((r) => r.organization_id ?? 'NULL')).toContain(orgA);

      // ⭐ Identity, not just presence: the declared organization is the one
      // that landed, and the OTHER organization on this install never appears.
      // A fix that stamped "some organization" would satisfy a presence check.
      expect(
        [...notifications, ...inbox].map((r) => r.organization_id).filter((v) => v === orgB),
        'a row landed in the organization the flow did NOT declare — cross-organization writes are exactly what the ruling forbids',
      ).toHaveLength(0);
    });

    // ── CONSEQUENCE (2) — run history ─────────────────────────────────────
    //
    // Its OWN pin, deliberately not folded into (1): the history row is written
    // by a different producer (`AutomationEngine.recordLog`) through a
    // different consumer of the same key, and the card measured its refusal
    // separately ("Insert on 'sys_automation_run' was REFUSED").
    //
    // PREDICTION: unfixed, no `sys_automation_run` row exists for this flow at
    // all. Fixed, exactly the scheduled run's row exists and carries `orgA`.
    it('(2) the sys_automation_run history row persists, carrying the declared organization', async () => {
      const history = await settleRows(RUN_HISTORY_OBJECT, { flow_name: DECLARED_FLOW });
      expect(
        history.length,
        "run history never persisted — the tick's sys_automation_run insert was refused",
      ).toBeGreaterThanOrEqual(1);
      expect(
        history.map((r) => r.organization_id ?? 'NULL'),
        'the history row must carry the run\'s acting organization',
      ).toContain(orgA);
      expect(
        history.map((r) => r.trigger_type),
        'the persisted row must still name WHAT fired the run (#7533)',
      ).toContain('schedule');
    });

    // ── CONSEQUENCE (3) — the declaration error ───────────────────────────
    //
    // PREDICTION: unfixed, the organization-less flow binds exactly like the
    // declaring one and its tick runs, delivering nothing. Fixed, it does NOT
    // bind, the refusal is logged at `error`, and it names the flow.
    //
    // ⛔ The assertion is deliberately NOT "it logged something". It is: no job
    // exists for it, so there is no path by which an organization-less
    // time-triggered run reaches the data layer at all.
    it('(3) an organization-less scheduled flow is REFUSED at bind, naming the flow', () => {
      expect(
        job.has(`flow-schedule:${UNDECLARED_FLOW}`),
        'the organization-less flow BOUND — it will tick, run, and deliver nothing, which is the defect',
      ).toBe(false);

      const refusal = log.errors.find((l) => l.includes(UNDECLARED_FLOW));
      expect(refusal, `no refusal named '${UNDECLARED_FLOW}'; errors seen: ${JSON.stringify(log.errors)}`).toBeTruthy();
      expect(refusal, 'the refusal must be attributable to a flow, not to "a flow"').toContain(UNDECLARED_FLOW);
      expect(refusal, 'the refusal must name the key the author has to write').toContain('organization');
      expect(refusal, 'a refused binding must say it is NOT BOUND').toContain('NOT BOUND');

      // ⛔ And it must not have silently defaulted: neither organization on
      // this install may appear in the refusal as a chosen value.
      expect(refusal).not.toContain(orgA);
      expect(refusal).not.toContain(orgB);
    });

    it('(3, control) refusing the organization-less flow did not disarm the declaring one', () => {
      expect(
        job.has(`flow-schedule:${DECLARED_FLOW}`),
        'the refusal took the sibling flow down with it — the refusal is per flow, not per trigger',
      ).toBe(true);
    });

    // ⭐ (3) has a second half, and skipping it is how the first round of this
    // card shipped a refusal the machine could not see. `job.has(...) === false`
    // proves the JOB SERVICE was never asked; it says nothing about what the
    // ENGINE recorded. `FlowTrigger.start()` returns `void`, so a trigger that
    // logs and returns is indistinguishable from one that armed: the engine
    // sets `boundFlowTriggers` and logs "bound" one line after the trigger said
    // NOT BOUND, and every structured surface this repo built for "declared but
    // not armed" then reports the opposite of the stderr line — Studio's badge
    // via `getFlowRuntimeStates()`, and the silent-miss audit the automation
    // plugin warns from at `kernel:bootstrapped` and the CLI prints in its
    // startup summary via `getTriggerBindingAudit()`.
    //
    // PREDICTION, before the run: with a logged-and-returned refusal this pin
    // is RED on both assertions (`bound: true`, audit empty of this flow); with
    // the refusal thrown it is green, and the declaring flow stays out of the
    // audit as the paired control.
    it('(3, structured) the refused flow reads as NOT BOUND on every machine-readable surface', () => {
      const states = automation.getFlowRuntimeStates() as Array<{ name: string; bound: boolean }>;
      const refused = states.find((s) => s.name === UNDECLARED_FLOW);
      expect(refused, `the refused flow is missing from getFlowRuntimeStates(): ${JSON.stringify(states.map((s) => s.name))}`).toBeTruthy();
      expect(
        refused!.bound,
        "Studio's status badge says this flow is armed while the trigger refused it — the loud channel and the structured channel disagree, which is the silent miss this card closes",
      ).toBe(false);
      expect(
        states.find((s) => s.name === DECLARED_FLOW)?.bound,
        'control: the declaring flow must still read as bound, or this pin would pass with everything broken',
      ).toBe(true);

      const audit = automation.getTriggerBindingAudit() as Array<{
        flowName: string;
        triggerType: string;
        reason: string;
      }>;
      const entry = audit.find((a) => a.flowName === UNDECLARED_FLOW);
      expect(
        entry,
        `the silent-miss audit omits the refused flow, so the kernel:bootstrapped warning and the CLI startup summary both report every triggered flow as wired; audit: ${JSON.stringify(audit)}`,
      ).toBeTruthy();
      expect(entry!.triggerType).toBe('schedule');
      expect(
        entry!.reason,
        'the audit must say the binding FAILED (the trigger is registered), not that no trigger exists',
      ).toContain('binding failed');
      expect(
        audit.map((a) => a.flowName),
        'control: a flow that bound must not be listed as a silent miss',
      ).not.toContain(DECLARED_FLOW);
    });

    // ── THE DIFFERENTIAL CONTROLS ─────────────────────────────────────────
    //
    // The pins above all assert that a row landed. Every one of them would also
    // pass if delivery were simply broken in a way that happened to look like
    // the fix working — so two controls run the SAME flow, the SAME nodes and
    // the SAME messaging chain with the organization coming from somewhere
    // OTHER than the start-node declaration.

    /**
     * Control A — driver-portable, and the sharper of the two.
     *
     * The same flow, executed with an organization supplied by the CALLER's
     * context (`tenantId`) instead of by the declaration: the record-change
     * shape the card reports as unaffected ("the triggering session's
     * organization is threaded, and delivery works on both drivers").
     *
     * ⭐ It carries `orgB`, deliberately — the organization the flow does NOT
     * declare. So it proves two things at once: the notify chain and the inbox
     * write are live on this driver (the pins above are not vacuous), and the
     * `orgA` those pins observed is attributable to the DECLARATION rather than
     * to "whichever organization this install happens to have".
     */
    it('control A: the same flow with a context-supplied organization delivers under THAT organization', async () => {
      const before = new Set((await rows(INBOX_OBJECT)).map((r) => String(r.id)));
      const result = await automation.execute(DECLARED_FLOW, {
        event: 'api',
        tenantId: orgB,
        params: {},
      });
      expect(result?.success, `the control run failed: ${result?.error ?? '(no error)'}`).toBe(true);

      const deadline = Date.now() + 5_000;
      let fresh: Array<Record<string, unknown>> = [];
      do {
        fresh = (await rows(INBOX_OBJECT)).filter((r) => !before.has(String(r.id)));
        if (fresh.length > 0) break;
        await new Promise<void>((r) => setTimeout(r, 50));
      } while (Date.now() < deadline);

      expect(
        fresh.length,
        'a context-supplied organization delivered nothing — delivery is broken for a reason unrelated to this card, and the pins above certify nothing',
      ).toBeGreaterThanOrEqual(1);
      expect(
        fresh.map((r) => r.organization_id ?? 'NULL'),
        'the control row must carry the organization the CALLER supplied, not the one the flow declares',
      ).toContain(orgB);
      expect(
        fresh.map((r) => r.organization_id),
        "the caller's organization was overruled by the flow's declaration — a scheduled declaration must not reach a run it did not launch",
      ).not.toContain(orgA);
    });

    /**
     * Control B — the card's own control: the same flow through
     * `POST /api/v1/automation/:name/trigger` under a session.
     *
     * Driver-split, because the drivers genuinely differ here and the split is
     * pinned rather than papered over:
     *
     *  - **sqlite-wasm** — the session is bound to the harness's default
     *    organization, so the run delivers under THAT organization: a third
     *    distinct id, and one more witness that `orgA` came from the
     *    declaration.
     *  - **memory** — the control is UNAVAILABLE, and this limb says so
     *    plainly rather than asserting something that cannot fail.
     *
     *    All of control B's discriminating power comes from the session being
     *    bound to an organization OF ITS OWN: the run then delivers under that
     *    third id, and `orgA`'s absence is the witness. On `driver-memory` no
     *    session can be org-bound — the driver declares no row-level tenant
     *    isolation and refuses any tenant-scoped call
     *    (`MEMORY_MULTI_TENANT_UNSUPPORTED`, #16589 / #6915), so the
     *    authorization resolver's own `sys_position` read is refused and the
     *    door answers 503 before any route runs. This suite therefore boots
     *    memory with `orgContext: false`, which leaves the HTTP caller carrying
     *    no organization at all — the very state the unfixed schedule path was
     *    in. A run triggered that way discriminates nothing.
     *
     *    ⛔ The first shape of this limb asserted `status < 300` under a message
     *    claiming it pinned a 503 refusal: opposite polarity, no delivery check,
     *    so it certified nothing in either direction. What is pinned instead is
     *    the REASON the control is unavailable, measured at the seam that makes
     *    it so — a tenant-scoped read on this driver produces NO ANSWER. The
     *    day the driver gains isolation that goes red and whoever fixes it
     *    enables the real control here.
     */
    it('control B: the same flow via POST /automation/:name/trigger under a session', async () => {
      if (databaseDriver === 'memory') {
        // Not the control — the control cannot run here. This pins the reason,
        // so the exemption expires by itself.
        let thrown: unknown = null;
        let answered: unknown = null;
        try {
          answered = await ql.find(INBOX_OBJECT, { where: {}, context: { userId: recipientId, tenantId: orgA } });
        } catch (err) {
          thrown = err;
        }

        expect(
          thrown,
          `driver-memory ANSWERED a tenant-scoped read (${JSON.stringify(answered)}) — it has gained row-level isolation, so an org-bound session is now possible here: boot this driver with orgContext and enable the real control B (#16589 / #6915)`,
        ).toBeTruthy();
        // ⛔ Taken as a nullable value, not with `.toHaveLength`: a refused call
        // must produce NO row count at all, and `.not.toHaveLength` passes over
        // a null target for the wrong reason.
        expect(Array.isArray(answered) ? answered.length : null).toBeNull();
        expect(
          String((thrown as { code?: string }).code ?? (thrown as Error).message),
          'the refusal must be the driver\'s own tenancy refusal, not some unrelated failure that happens to throw',
        ).toContain('MULTI_TENANT_UNSUPPORTED');
        return;
      }

      const before = new Set((await rows(INBOX_OBJECT)).map((r) => String(r.id)));
      const res = await stack.apiAs(memberToken, 'POST', `/automation/${DECLARED_FLOW}/trigger`, {});
      expect(
        res.status,
        `the session-triggered run did not start (${res.status}) — the control cannot certify the pins above`,
      ).toBeLessThan(300);

      const deadline = Date.now() + 5_000;
      let fresh: Array<Record<string, unknown>> = [];
      do {
        fresh = (await rows(INBOX_OBJECT)).filter((r) => !before.has(String(r.id)));
        if (fresh.length > 0) break;
        await new Promise<void>((r) => setTimeout(r, 50));
      } while (Date.now() < deadline);

      expect(
        fresh.length,
        'the session-triggered run delivered nothing — delivery is broken for a reason unrelated to this card',
      ).toBeGreaterThanOrEqual(1);
      expect(
        fresh.map((r) => r.organization_id),
        "the session-triggered row must carry the SESSION's organization, not the schedule declaration's",
      ).not.toContain(orgA);
    });
  });
}
