// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#16659 F2] A `time_relative` sweep SELECTS inside its declared organization
// — proven on the real ObjectQL + driver stack, with matching rows in TWO
// organizations.
//
// @proof: schedule-acting-organization
//
// ## What this file measures that its sibling does not
//
// `schedule-acting-organization.dogfood.test.ts` proves the RUN carries the
// declared organization. That left the other half unmeasured, and it was wrong:
// the sweep's own query carried `context: { isSystem: true }` and nothing else,
// so a sweep declared for org A still MATCHED rows in org B and launched one run
// per match — each stamped A. Downstream that is worse than the defect the card
// opened on, not better:
//
//   - the run is scoped to A, so its `update_record` on a B row matches nothing
//     and reports success;
//   - `notify` posts into A's inbox about B's record — a cross-tenant disclosure
//     that was previously refused outright, because an org-less run could write
//     nowhere;
//   - the history row is stamped SUBJECT-first, so it lands under B while the
//     inbox rows sit under A.
//
// ⚠️ THE DISCRIMINATING NUMBER IS THE COUNT OF LAUNCHED RUNS. A pin asserting
// only "A's row was touched" passes on the defect too — the defect touched it,
// alongside launching two runs about B's rows. So the fixture puts ONE matching
// row in A and TWO in B, and the pins read 1 vs 3.
//
// ## The multi-organization condition
//
// Two `sys_organization` rows under the DEFAULT `single` posture — the same
// install the card was measured on, and the state
// `system-write-organization.ts` calls `ambiguous-organization`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MessagingServicePlugin, INBOX_OBJECT, NOTIFICATION_EVENT_OBJECT } from '@objectstack/service-messaging';
import { TimeRelativeTrigger, type JobServiceSurface, type TriggerLogger } from '@objectstack/trigger-schedule';
import type { JobHandler, JobSchedule } from '@objectstack/spec/contracts';
import { SCHEDULED_WORK_ENV, SCHEDULED_WORK_DISABLED_REASON } from '@objectstack/types';
import {
  scheduleOrganizationStack,
  declaringTimeRelativeFlow,
} from './fixtures/schedule-organization-fixture.js';

const TARGET_OBJECT = 'sched_org_target';
const SWEEP_FLOW = 'sched_org_sweep';
const SWEEP_JOB = `flow-time-relative:${SWEEP_FLOW}`;

/** A job service the test fires by hand — the sweep's cadence is not the subject. */
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
 * Both drivers, and they answer DIFFERENT questions here — the split is the
 * point, not an exemption:
 *
 *  - **sqlite-wasm** enforces tenant isolation, so it can be asked the real
 *    differential question: with rows in A and B, which come back?
 *  - **memory** implements none and REFUSES any call handed a tenant scope
 *    (`MEMORY_MULTI_TENANT_UNSUPPORTED`, #16589). The question it answers is the
 *    one the card is really about: when a sweep required to stay inside one
 *    organization cannot be served, does it SAY SO or go quiet?
 */
for (const databaseDriver of ['sqlite-wasm', 'memory'] as const) {
  describe(`dogfood [${databaseDriver}]: a time-relative sweep selects inside its declared organization (#16659)`, () => {
    let stack: VerifyStack;
    let ql: Ql;
    let automation: Engine;
    let job: ReturnType<typeof fakeJobService>;
    let log: ReturnType<typeof recordingLogger>;
    let orgA: string;
    let orgB: string;
    let rowA: string;
    let rowsB: string[];
    let recipientId: string;
    let priorSwitch: string | undefined;
    let priorPosture: string | undefined;

    beforeAll(async () => {
      stack = await bootStack(scheduleOrganizationStack as never, {
        automation: true,
        databaseDriver,
        orgContext: databaseDriver === 'sqlite-wasm',
        // ⛔ Reliable delivery OFF for the same reason the sibling suite turns
        // it off: with the outbox + dispatcher on, `sys_inbox_message` is
        // written by a background dispatcher on its own schedule, so a count
        // taken right after the tick reads empty whatever the sweep selected.
        extraPlugins: [new MessagingServicePlugin({ reliableDelivery: false })],
      });
      await stack.signIn();
      ql = await stack.kernel.getServiceAsync('objectql');
      automation = stack.kernel.getService('automation');
      expect(automation?.registerFlow, 'automation engine must be wired').toBeTruthy();

      const a = await ql.insert('sys_organization', { name: 'Acme Employer' }, SYS);
      const b = await ql.insert('sys_organization', { name: 'Beta Employer' }, SYS);
      orgA = String(a.id);
      orgB = String(b.id);
      expect(orgA).not.toBe(orgB);

      const admin = await ql.findOne('sys_user', { where: { email: 'admin@objectos.ai' }, ...SYS });
      recipientId = String(admin?.id ?? 'usr_system');

      // ── the differential fixture ──────────────────────────────────────
      // One matching row in A, TWO in B. Every row is inside the window, so
      // the ONLY thing that can keep B's out is the tenant scope.
      const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const inA = await ql.insert(TARGET_OBJECT, { name: 'A-1', due_date: due, organization_id: orgA }, SYS);
      const inB1 = await ql.insert(TARGET_OBJECT, { name: 'B-1', due_date: due, organization_id: orgB }, SYS);
      const inB2 = await ql.insert(TARGET_OBJECT, { name: 'B-2', due_date: due, organization_id: orgB }, SYS);
      rowA = String(inA.id);
      rowsB = [String(inB1.id), String(inB2.id)];

      const seeded = (await ql.find(TARGET_OBJECT, { ...SYS })) ?? [];
      expect(
        seeded.length,
        'precondition: three rows must exist, or "B was not selected" proves nothing',
      ).toBe(3);
      expect(
        seeded.map((r: Record<string, unknown>) => String(r.organization_id ?? 'NULL')).sort(),
        'precondition: the rows must actually carry the two organizations — a NULL-org row is visible under ANY scope (`org = :tenant OR org IS NULL`), so a fixture that failed to stamp them would make this suite pass unfixed',
      ).toEqual([orgA, orgB, orgB].sort());

      // ── [#17396] The DEPLOYMENT this suite is about ───────────────────
      //
      // Ruling G put two environment facts in front of every bind, and both
      // are set HERE, around the bind, rather than at boot:
      //
      //  1. `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` — package-authored
      //     scheduled work is OFF by default in every posture, so without it
      //     NOTHING arms and the `precondition: the sweep BOUND` case below
      //     fails, taking every assertion built on it with it. ⛔ It is a
      //     PRECONDITION of this file's subject, not a convenience: what these
      //     pins measure is which rows an ARMED sweep selects, and an unarmed
      //     sweep selects nothing for a reason that has nothing to do with
      //     tenancy.
      //  2. `OS_TENANCY_POSTURE=isolated` — the acting-organization
      //     declaration this sweep carries is REQUIRED only behind a wall.
      //     Under `single` the same flow arms while declaring nothing and
      //     sweeps unscoped, which is a different subject with a different
      //     correct answer.
      //
      // ⚠️ Set around the BIND, not around `bootStack`: both triggers read
      // these live at `start()`, while booting the STACK under a wall would
      // demand the enterprise organizations plugin this suite deliberately
      // does not install (ADR-0093 D5 refuses to boot a wall it cannot
      // enforce). Nothing the pins measure moves: which rows the sweep selects
      // is decided by the two `sys_organization` rows and the declaration.
      priorSwitch = process.env[SCHEDULED_WORK_ENV];
      priorPosture = process.env.OS_TENANCY_POSTURE;
      process.env[SCHEDULED_WORK_ENV] = 'true';
      process.env.OS_TENANCY_POSTURE = 'isolated';

      automation.registerFlow(SWEEP_FLOW, declaringTimeRelativeFlow(orgA, recipientId));

      job = fakeJobService();
      log = recordingLogger();
      automation.registerTrigger(new TimeRelativeTrigger(() => job.service, () => ql, log.logger));
      await new Promise<void>((r) => setTimeout(r, 0));
    }, 120_000);

    afterAll(async () => {
      // [#17396] Restore the PREVIOUS values rather than deleting the keys — a
      // CI box that exported either one must be left exactly as it was found.
      if (priorSwitch === undefined) delete process.env[SCHEDULED_WORK_ENV];
      else process.env[SCHEDULED_WORK_ENV] = priorSwitch;
      if (priorPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = priorPosture;
      await stack?.stop();
    });

    async function rows(object: string, where: Record<string, unknown> = {}): Promise<Array<Record<string, unknown>>> {
      return (await ql.find(object, { where, ...SYS })) ?? [];
    }

    it('precondition: the sweep BOUND', () => {
      expect(
        job.has(SWEEP_JOB),
        `the sweep did not bind — registered jobs: ${job.names().join(', ') || '(none)'}`
          + ` (⚠️ #17396: this is also the case that fails when ${SCHEDULED_WORK_ENV} is not set —`
          + ' package-authored scheduled work is off by default in every posture, and an unarmed'
          + ' sweep selects nothing for a reason that has nothing to do with tenancy)',
      ).toBe(true);
    });

    // ── [#17396] The OTHER deployment state, which ruling G item 6 requires
    //    and nothing measured before this card ────────────────────────────
    //
    // With the switch OFF neither trigger arms anything, and every such flow is
    // listed in `getTriggerBindingAudit()` — the surface the automation
    // plugin's `kernel:bootstrapped` warning, the CLI startup summary and
    // Studio all read — with a DISTINCT reason: *disabled by deployment
    // policy*, ⛔ NEVER "binding failed".
    //
    // ⭐ That distinction is the whole of the ruled item, and it is not
    // cosmetic: a binding failure is a defect with an engineering remedy, while
    // this is a deployment policy with an operator remedy, and the two send
    // whoever reads the boot summary to different places. It is pinned HERE,
    // on the real engine with a real registered trigger, because the engine's
    // own catch — the one that writes "binding failed" — is the thing that must
    // NOT be reached.
    it('[#17396] switch OFF: the sweep does not arm, and the audit says disabled by deployment policy', async () => {
      const OFF_FLOW = `${SWEEP_FLOW}_policy_off`;
      const OFF_JOB = `flow-time-relative:${OFF_FLOW}`;
      const restore = process.env[SCHEDULED_WORK_ENV];
      try {
        delete process.env[SCHEDULED_WORK_ENV];
        automation.registerFlow(OFF_FLOW, declaringTimeRelativeFlow(orgA, recipientId));
        await new Promise<void>((r) => setTimeout(r, 0));
      } finally {
        if (restore === undefined) delete process.env[SCHEDULED_WORK_ENV];
        else process.env[SCHEDULED_WORK_ENV] = restore;
      }

      // ⛔ The flow is well-formed and DECLARES its organization — the same
      // fixture the armed sweep above uses. Nothing about it is wrong; the
      // deployment simply has not asked for scheduled work.
      expect(
        job.has(OFF_JOB),
        `a policy-disabled flow must have no job at all — registered: ${job.names().join(', ') || '(none)'}`,
      ).toBe(false);

      const states = automation.getFlowRuntimeStates() as Array<{ name: string; bound: boolean }>;
      expect(
        states.find((st: { name: string }) => st.name === OFF_FLOW)?.bound,
        "Studio's status badge must not report this flow as armed",
      ).toBe(false);
      expect(
        states.find((st: { name: string }) => st.name === SWEEP_FLOW)?.bound,
        'control: the sweep armed while the switch was ON must still read as bound, or this pin would pass with everything broken',
      ).toBe(true);

      const audit = automation.getTriggerBindingAudit() as Array<{
        flowName: string;
        triggerType: string;
        reason: string;
      }>;
      const entry = audit.find((a: { flowName: string }) => a.flowName === OFF_FLOW);
      expect(
        entry,
        `ruled item 6: the flow must be LISTED, so the boot summary names it; audit: ${JSON.stringify(audit)}`,
      ).toBeTruthy();
      expect(entry!.triggerType).toBe('time_relative');
      expect(
        entry!.reason,
        'the reason must be the one sentence every surface shares, so the audit, the CLI summary and Studio cannot drift',
      ).toBe(SCHEDULED_WORK_DISABLED_REASON);
      expect(entry!.reason, 'and it must name the switch the operator has to set').toContain(SCHEDULED_WORK_ENV);
      // ⭐ The prohibition, pinned by absence because the branch it must not
      // take produces exactly this phrase.
      expect(
        entry!.reason,
        'ruled item 6: a policy-disabled flow is ⛔ NEVER reported as a binding failure',
      ).not.toMatch(/binding failed/);
      expect(
        audit.map((a: { flowName: string }) => a.flowName),
        'control: the armed sweep must not be listed as a silent miss',
      ).not.toContain(SWEEP_FLOW);

      // And the trigger was never asked: with the switch off the engine does
      // not call `start()` at all, so nothing threw and nothing was logged as
      // a failure.
      expect(
        log.errors.filter((l) => l.includes(OFF_FLOW)),
        'a deployment running the configuration it asked for must not print an error',
      ).toEqual([]);
    });

    if (databaseDriver === 'memory') {
      /**
       * The store cannot honour the scope, so the sweep must be LOUD.
       *
       * PREDICTION, written before the run: `driver-memory` refuses the scoped
       * `find` (#16589), the sweep's own error isolation catches it, and the
       * failure is logged at `error` naming the flow. ⛔ What must NOT happen is
       * the sweep quietly answering with every organization's rows — that is the
       * silent non-isolation the driver's refusal exists to remove, and this
       * card's whole subject is a tick that looks healthy while being wrong.
       */
      it('a store with no tenant isolation REFUSES the sweep, loudly, and launches nothing', async () => {
        await job.fire(SWEEP_JOB, 'tick-16659-f2');

        const failure = log.errors.find((l) => l.includes('sweep failed'));
        expect(
          failure,
          `the sweep did not report a failure; errors: ${JSON.stringify(log.errors)} · warns: ${JSON.stringify(log.warns)}`,
        ).toBeTruthy();
        expect(failure, 'the failure must be attributable to a flow').toContain(SWEEP_FLOW);
        expect(
          failure,
          "and carry the driver's own refusal, not some unrelated error that happens to throw",
        ).toContain('NO row-level tenant isolation');

        const touched = (await rows(TARGET_OBJECT)).filter((r) => r.touched === true || r.touched === 1);
        expect(
          touched.map((r) => String(r.id)),
          'a refused sweep must launch no runs at all — a partially-served sweep is the cross-organization task the ruling forbids',
        ).toEqual([]);
      });

      it('control: the refusal is about the SCOPE, not about the object or the window', async () => {
        // The same query without a tenant scope is served. So "nothing came
        // back" above is attributable to the scope the sweep asked for, and not
        // to a fixture whose rows never matched.
        const unscoped = (await ql.find(TARGET_OBJECT, { where: {}, context: { isSystem: true } })) ?? [];
        expect(
          unscoped.length,
          'the unscoped read must still see all three rows, or the fixture — not the scope — is what this suite measured',
        ).toBe(3);
      });
      return;
    }

    /**
     * PREDICTION, written before the run: on the unfixed tree the sweep selects
     * all THREE rows (the query carried no scope), launches three runs, and
     * three inbox rows land under org A — two of them naming org B's records.
     * With the fix it selects one, launches one, and one inbox row lands.
     */
    it('DIFFERENTIAL: exactly ONE run is launched — the declared organization\'s row', async () => {
      const before = new Set((await rows(INBOX_OBJECT)).map((r) => String(r.id)));
      await job.fire(SWEEP_JOB, 'tick-16659-f2');

      const deadline = Date.now() + 5_000;
      let fresh: Array<Record<string, unknown>> = [];
      do {
        fresh = (await rows(INBOX_OBJECT)).filter((r) => !before.has(String(r.id)));
        if (fresh.length > 0) break;
        await new Promise<void>((r) => setTimeout(r, 50));
      } while (Date.now() < deadline);

      expect(
        fresh.length,
        `the sweep launched ${fresh.length} run(s); 3 is the unfixed reading (org B's two rows swept in), 0 means the sweep delivered nothing and the pin below would be vacuous`,
      ).toBe(1);
    });

    it('the run acts on the DECLARED organization\'s record, and on no other', async () => {
      const all = await rows(TARGET_OBJECT);
      const dump = JSON.stringify(all.map((r) => ({ id: r.id, name: r.name, touched: r.touched, org: r.organization_id })));
      const touched = all.filter((r) => Boolean(r.touched)).map((r) => String(r.id));
      expect(
        touched,
        `the sweep's \`update_record\` must land on org A's row; rows: ${dump}`,
      ).toEqual([rowA]);
      for (const id of rowsB) {
        expect(
          touched,
          'a row in an organization this flow never declared was acted on — the cross-organization scheduled task the ruling forbids',
        ).not.toContain(id);
      }
    });

    it('no notification describes a record from an organization the flow never declared', async () => {
      // ⭐ The DISCLOSURE half, and the one the write-side pin above cannot
      // reach. An unscoped sweep launches a run per matched row whatever the
      // run is then scoped to: the `update_record` on org B's row matches
      // nothing — silently — but the `notify` node has already emitted, so B's
      // record is named in a notification stamped with A's organization. A
      // fix that only narrowed the WRITES would leave this leak open.
      //
      // Read off `sys_notification` rather than `sys_inbox_message`: the
      // `sourceObject`/`sourceId` click-through pair writes
      // `source_object`/`source_id` THERE (io-node-config.zod.ts), and the
      // inbox row carries the rendered `action_url` instead.
      const notifications = await rows(NOTIFICATION_EVENT_OBJECT);
      const dump = JSON.stringify(notifications.map((r) => ({ org: r.organization_id, src: r.source_id, title: r.title })));
      const sourceIds = notifications
        .map((r) => String((r as Record<string, unknown>).source_id ?? ''))
        .filter((v) => v !== '');
      for (const id of rowsB) {
        expect(
          sourceIds,
          `a notification under the declared organization names another organization's record — a cross-tenant disclosure; notifications: ${dump}`,
        ).not.toContain(id);
      }
      expect(
        sourceIds,
        `control: the declared organization's own record IS named, so the assertion above is not passing on an empty set; notifications: ${dump}`,
      ).toContain(rowA);
      expect(
        notifications.map((r) => String(r.organization_id ?? 'NULL')),
        'and every one of them is stamped with the declared organization',
      ).toEqual([orgA]);
    });
  });
}
