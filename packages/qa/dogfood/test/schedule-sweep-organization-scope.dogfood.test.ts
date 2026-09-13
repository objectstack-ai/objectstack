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
      const recipientId = String(admin?.id ?? 'usr_system');

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

      automation.registerFlow(SWEEP_FLOW, declaringTimeRelativeFlow(orgA, recipientId));

      job = fakeJobService();
      log = recordingLogger();
      automation.registerTrigger(new TimeRelativeTrigger(() => job.service, () => ql, log.logger));
      await new Promise<void>((r) => setTimeout(r, 0));
    }, 120_000);

    afterAll(async () => {
      await stack?.stop();
    });

    async function rows(object: string, where: Record<string, unknown> = {}): Promise<Array<Record<string, unknown>>> {
      return (await ql.find(object, { where, ...SYS })) ?? [];
    }

    it('precondition: the sweep BOUND', () => {
      expect(
        job.has(SWEEP_JOB),
        `the sweep did not bind — registered jobs: ${job.names().join(', ') || '(none)'}`,
      ).toBe(true);
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
