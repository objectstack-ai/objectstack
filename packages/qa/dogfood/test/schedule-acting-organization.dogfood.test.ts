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
        extraPlugins: [new MessagingServicePlugin()],
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

    it('precondition: the declaring flow BOUND and the tick actually ran', async () => {
      expect(
        job.has(`flow-schedule:${DECLARED_FLOW}`),
        `the declaring flow did not bind — registered jobs: ${job.names().join(', ') || '(none)'}`,
      ).toBe(true);
      await job.fire(`flow-schedule:${DECLARED_FLOW}`, 'tick-16659');
      const history = await rows(RUN_HISTORY_OBJECT, { flow_name: DECLARED_FLOW });
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
      const notifications = await rows(NOTIFICATION_EVENT_OBJECT);
      expect(notifications.length, 'the notify node emitted nothing').toBeGreaterThanOrEqual(1);
      expect(
        notifications.map((n) => n.organization_id ?? 'NULL'),
        'a scheduled run must stamp the organization it declared — NULL is the unfixed reading',
      ).toContain(orgA);

      const inbox = await rows(INBOX_OBJECT);
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
      const history = await rows(RUN_HISTORY_OBJECT, { flow_name: DECLARED_FLOW });
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

    // ── THE DIFFERENTIAL CONTROL ──────────────────────────────────────────
    //
    // The same flow, the same nodes, the same messaging chain — reached through
    // `POST /api/v1/automation/:name/trigger` under a SESSION, which is the run
    // shape the card reported as already working (`unmeasured=4`, every
    // recipient sees the row). It is here so the pins above cannot pass
    // vacuously: if delivery were broken for some reason unrelated to the
    // organization, this would be red too, and the schedule pins' green would
    // mean nothing.
    it('differential control: the same flow via POST /automation/:name/trigger under a session delivers', async () => {
      const before = (await rows(INBOX_OBJECT)).length;
      const res = await stack.apiAs(memberToken, 'POST', `/automation/${DECLARED_FLOW}/trigger`, {});
      expect(
        res.status,
        `the session-triggered run did not start (${res.status}) — the control cannot certify the pins above`,
      ).toBeLessThan(300);
      const after = (await rows(INBOX_OBJECT)).length;
      expect(
        after,
        'the session-triggered run delivered nothing — delivery is broken for a reason unrelated to this card',
      ).toBeGreaterThan(before);
    });
  });
}
