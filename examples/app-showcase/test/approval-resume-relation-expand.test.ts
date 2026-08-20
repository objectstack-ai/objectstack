// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7381] Approving Invoice Dual Sign-off must deliver "Notify: Cleared", not
 * strand its run.
 *
 * THE DEFECT. `showcase_invoice_signoff`'s `notify_cleared` node addressed
 * `{record.account.owner}` while its `start` node declared no `config.expand`.
 * A flow record carries a lookup as the scalar FK it was written as, so the hop
 * read nothing, and the notify node refuses a run with zero recipients — the
 * approve decision landed on `sys_approval_request` while the flow run it was
 * supposed to release died on resume. The showcase's marquee approval demo
 * therefore dead-ended at exactly its payoff moment on a stock boot.
 *
 * WHY THE OBVIOUS REPAIR IS NOT THE REPAIR. Triage proposed keeping the hop and
 * adding `expand: ['account']`. Measured against the schema, that fixes
 * nothing: `showcase_account` HAS NO `owner` FIELD. Its people-ish keys are
 * `billing_email` and the platform-injected `owner_id` (`OWNER_COLUMN` in
 * `@objectstack/spec`'s `injected-system-columns.ts`), so `account.owner` is
 * `undefined` however thoroughly the relation is hydrated, and the run strands
 * identically. `showcase_invoice.owner` — the seeded rep, and the anchor the
 * `showcase_contributor` permission set scopes invoices by — is the field that
 * holds a person, so that is who the notification addresses. The relation
 * hydration the demo should teach is kept and made LIVE by the message body's
 * `{record.account.name}`, which is a field the account really has.
 *
 * WHY THIS NEEDS THE RESUME PATH AND NOT A PARSE CHECK. `expandDeclaredLookups`
 * runs once in `prepareRunContext`, i.e. at flow START — but the failing read
 * happens after an approval pause that can last days. What makes the fix work
 * is that the expander mutates the run's `record` IN PLACE, so the hydrated
 * relation is part of the state persisted at suspend and restored verbatim by
 * `resumeInternal` (`const variables = new Map(Object.entries(run.variables))`).
 * Nothing static observes that: the flow parsed fine before the fix, and
 * `pnpm verify` plus the seed both pass on the broken version. Only driving a
 * real approval to a real resume can tell the two apart, so that is what this
 * suite does — and the reverse check re-authors the pre-fix shape on the same
 * harness to prove the assertions can still go red.
 *
 * THE HARNESS IS THE PRODUCTION ONE: a real `ObjectKernel` with the real
 * ObjectQL, automation, approvals and messaging plugins over real sqlite, the
 * app's REAL objects and REAL flow definitions. Requests are opened the way
 * `registerShowcaseApprovalDemo` opens them (`engine.execute` with `record` /
 * `previous` / `object`), and decided through `ApprovalService.decide` with the
 * `position:` actor ids `InvoiceDualSignoffFlow`'s own docblock documents.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { MessagingServicePlugin } from '@objectstack/service-messaging';

import { Account, Project, Task, Product, Invoice, InvoiceLine } from '../src/data/objects/index.js';
import {
  InvoiceDualSignoffFlow,
  TaskDoneNotifyOwnerFlow,
  NotifyOwnerSubflow,
} from '../src/automation/flows/index.js';

/** Everything the approvals service treats as an unconditional actor. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const SYS = { context: SYSTEM_CTX };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const openKernels: Array<{ shutdown?: () => Promise<void> }> = [];
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];
afterEach(async () => {
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
  while (openKernels.length) {
    try { await openKernels.pop()?.shutdown?.(); } catch { /* noop */ }
  }
});

interface Booted {
  automation: AutomationEngine & Record<string, any>;
  approvals: any;
  data: any;
  /** Every notification the messaging service materialised, newest last. */
  inbox: () => Promise<any[]>;
}

/**
 * The showcase's real objects + real flows on a real kernel.
 *
 * `flows` is a parameter for one reason only: the reverse check needs to boot
 * an otherwise identical stack carrying the PRE-FIX flow definition. Every
 * other caller passes the shipped ones.
 */
async function bootShowcaseApprovals(
  flows: readonly any[] = [InvoiceDualSignoffFlow, TaskDoneNotifyOwnerFlow, NotifyOwnerSubflow],
): Promise<Booted> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.use(new ApprovalsServicePlugin());
  await kernel.use(new MessagingServicePlugin());
  await kernel.bootstrap();
  openKernels.push(kernel as any);

  const objectql: any = kernel.getService('objectql');
  const data: any = kernel.getService('data');
  const automation = kernel.getService<AutomationEngine>('automation') as AutomationEngine & Record<string, any>;
  const approvals: any = kernel.getService('approvals');

  const driver: any = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();
  objectql.registerDriver(driver, true);
  openDrivers.push(driver);

  for (const obj of [Account, Project, Task, Product, Invoice, InvoiceLine]) {
    objectql.registry.registerObject(obj, 'showcase', 'showcase');
  }
  await objectql.syncSchemas();

  for (const flow of flows) automation.registerFlow(flow.name, flow);

  // `sys_inbox_message` and not the L2 `sys_notification` event: the inbox row
  // is what a user actually sees, it is the thing the demo promises, and it is
  // the only one of the two that carries the resolved RECIPIENT (`user_id`) —
  // which is the half this card is about. It is also materialized a channel hop
  // later, hence the polling in `deliveredInbox`.
  const inbox = async () => {
    const rows = await data.find('sys_inbox_message', { ...SYS });
    return Array.isArray(rows) ? rows : ((rows as any)?.records ?? []);
  };

  return { automation, approvals, data, inbox };
}

/**
 * How long either direction watches the inbox. [#10106] Deliberately NOT
 * raised: a wrong verdict handed over later is still a wrong verdict, and the
 * defect below was never about the size of the window.
 */
const INBOX_WATCH_MS = 5_000;

/**
 * The verdict of one inbox watch. Discriminated on purpose — "N arrived",
 * "the window elapsed and the inbox is empty" and "the watch gave up" are
 * three different facts, and the `any[]` this replaces conflated the last two
 * into the same value.
 */
type InboxWatch =
  | { readonly outcome: 'delivered'; readonly hits: any[]; readonly waitedMs: number }
  | { readonly outcome: 'quiet'; readonly hits: any[]; readonly waitedMs: number }
  | { readonly outcome: 'timeout'; readonly hits: any[]; readonly waitedMs: number; readonly expected: number };

/**
 * Watch the inbox for messages whose title matches, and report WHY the watch
 * ended — not merely what had accumulated when it did.
 *
 * [#10106] THE DEFECT THIS REPLACES. The previous helper returned its last
 * sample when the deadline passed. Nothing distinguished that from a real
 * absence, and both halves were measured on this very file:
 *
 *   - the positive sites failed with an annotation asserting something untrue
 *     ("the Notify: Cleared inbox message was never delivered" for a message
 *     that HAD been delivered — the poll had merely given up), and
 *   - the negative site PASSED on a give-up: with a matching row inserted
 *     200 ms into the window, `expect(...).toHaveLength(0)` stayed green.
 *
 * THE MECHANISM, since it decides the shape of the repair. A `find` ISSUED at
 * time T and resolving at T+Δ reports the inbox as it stood at T, while the
 * deadline is checked at T+Δ. When Δ is large — a saturated shard, the
 * condition this suite runs under — the verdict about the whole window rests
 * on a sample taken near its start. So the verdict here never rests on that
 * sample: once the deadline has passed, one FINAL, FRESH read is taken and
 * that read is what is judged. `sys_inbox_message` rows accumulate and are
 * never retracted, so a single read after the window sees everything the
 * window delivered — which is why one terminal read is sufficient evidence,
 * and why poll DENSITY (how many samples fit) is not the thing to guard.
 *
 * `budgetMs` exists so this helper's own contract can be pinned in
 * milliseconds instead of seconds. It is clamped to `INBOX_WATCH_MS`, so it
 * can only ever SHRINK the window — widening it is not expressible, which is
 * the ban in #10106 made structural rather than asked for in a comment.
 */
const watchWindowMs = (budgetMs: number = INBOX_WATCH_MS): number =>
  Math.min(budgetMs, INBOX_WATCH_MS);

async function watchInbox(
  booted: Booted,
  titleFragment: string,
  expected: number,
  budgetMs: number = INBOX_WATCH_MS,
): Promise<InboxWatch> {
  const started = Date.now();
  const deadline = started + watchWindowMs(budgetMs);
  const matches = async (): Promise<any[]> =>
    (await booted.inbox()).filter((n: any) => String(n.title ?? '').includes(titleFragment));

  for (;;) {
    const hits = await matches();
    if (expected > 0 && hits.length >= expected) {
      return { outcome: 'delivered', hits, waitedMs: Date.now() - started };
    }
    if (Date.now() >= deadline) {
      // The one observation the verdict is allowed to rest on: taken at or
      // after the deadline, never before it.
      const final = await matches();
      const waitedMs = Date.now() - started;
      if (expected > 0) {
        return final.length >= expected
          ? { outcome: 'delivered', hits: final, waitedMs }
          : { outcome: 'timeout', hits: final, waitedMs, expected };
      }
      return final.length === 0
        ? { outcome: 'quiet', hits: final, waitedMs }
        : { outcome: 'delivered', hits: final, waitedMs };
    }
    await sleep(50);
  }
}

/**
 * The POSITIVE direction: `expected` matching messages, or a loud and ACCURATE
 * failure. It throws rather than returning short, so no assertion downstream
 * can read a timeout as an absence — which is what the annotations at the two
 * positive call sites used to do out loud.
 */
async function deliveredInbox(
  booted: Booted, titleFragment: string, expected: number, budgetMs?: number,
): Promise<any[]> {
  if (expected < 1) {
    throw new Error('deliveredInbox is the POSITIVE direction — use inboxStayedQuiet() for the empty case');
  }
  const watch = await watchInbox(booted, titleFragment, expected, budgetMs);
  if (watch.outcome !== 'delivered') {
    throw new Error(
      `inbox watch TIMED OUT after ${watch.waitedMs} ms: saw ${watch.hits.length} of ${expected} message(s) ` +
        `titled ~"${titleFragment}". This says the message did not arrive INSIDE THE WINDOW; it does NOT say ` +
        'nobody was notified. Read it as either a real delivery failure or a runner too slow to observe one — ' +
        'and do not "fix" it by widening the window (#10106).',
    );
  }
  return watch.hits;
}

/**
 * The NEGATIVE direction. Returns the VERDICT, never a bare array: the caller
 * asserts on `outcome`, and `'quiet'` is constructible at exactly one place
 * above — after a fresh read taken past the deadline. A watch that gave up
 * therefore cannot satisfy a stays-empty assertion, which is the half of
 * #10106 that a louder timeout alone would not have fixed.
 */
async function inboxStayedQuiet(
  booted: Booted, titleFragment: string, budgetMs?: number,
): Promise<InboxWatch> {
  return watchInbox(booted, titleFragment, 0, budgetMs);
}

/** Insert the demo's account + a `sent` invoice owned by a real rep. */
async function seedInvoice(data: any): Promise<{ invoice: any; account: any }> {
  const account = await one(await data.insert('showcase_account', {
    name: 'Fabrikam',
    industry: 'healthcare',
    status: 'prospect',
    billing_email: 'accounts@fabrikam.example',
  }, SYS));

  const invoice = await one(await data.insert('showcase_invoice', {
    name: 'INV-1010',
    account: account.id,
    owner: 'grace@example.com',
    status: 'sent',
    issued_on: '2026-05-27',
    tax_rate: 20,
    region: 'emea',
  }, SYS));

  return { invoice, account };
}

function one(res: any): any {
  return Array.isArray(res) ? res[0] : res;
}

function rows(res: any): any[] {
  return Array.isArray(res) ? res : (res?.records ?? []);
}

/**
 * Open the dual sign-off request exactly as `registerShowcaseApprovalDemo`'s
 * `launchSignoff` does — `previous` supplied so the start gate
 * (`status == "sent" && previous.status != "sent"`) is satisfied, `object` so
 * the approval node knows its target and the expander knows what to re-read.
 */
async function launchSignoff(booted: Booted, invoice: any, flowName = 'showcase_invoice_signoff') {
  return booted.automation.execute(flowName, {
    record: invoice,
    previous: { ...invoice, status: 'draft' },
    object: 'showcase_invoice',
    organizationId: null,
    userId: 'admin@objectos.ai',
  } as any);
}

async function pendingRequest(data: any): Promise<any> {
  return rows(await data.find('sys_approval_request', { where: { status: 'pending' }, ...SYS }))[0];
}

describe('#7381 — approving Invoice Dual Sign-off delivers the cleared notice', () => {
  it('satisfies both unanimous slots and runs through to end_ok with the inbox message delivered', async () => {
    const booted = await bootShowcaseApprovals();
    const { invoice, account } = await seedInvoice(booted.data);

    const launched: any = await launchSignoff(booted, invoice);
    expect(launched.status, `launch did not park on the approval node: ${launched.error ?? ''}`).toBe('paused');

    const request = await pendingRequest(booted.data);
    expect(request, 'no pending approval request was opened').toBeTruthy();

    // One `unanimous` slot each, through the actor ids the flow's own docblock
    // documents. The first must NOT release the run.
    const first = await booted.approvals.decide(
      request.id, { decision: 'approve', actorId: 'position:finance' }, SYSTEM_CTX,
    );
    expect(first.finalized, 'a unanimous step finalized on one of two approvals').toBe(false);

    const second = await booted.approvals.decide(
      request.id, { decision: 'approve', actorId: 'position:legal' }, SYSTEM_CTX,
    );
    expect(second.finalized).toBe(true);
    // THE REGRESSION: pre-fix this came back false, with the strand error.
    expect(second.resumed, 'the flow run was not resumed by the final approval').toBe(true);

    await sleep(200);

    // The run reached the success end, not a failure.
    //
    // `end_ok` itself is deliberately NOT asserted by name in the step log:
    // `executeNode` returns early for `type: 'end'` (engine.ts), so no end node
    // is ever stepped and looking for one would assert a thing that cannot
    // happen. What identifies the branch is the pair — `notify_cleared` ran,
    // `flag_held` (the reject arm) did not — plus the edge below, which pins
    // the inference to the shipped graph rather than to this comment.
    const runs: any[] = await booted.automation.listRuns('showcase_invoice_signoff');
    const run = runs[0];
    expect(run.status, `run ended ${run.status}: ${run.error ?? ''}`).toBe('completed');

    const stepped = run.steps.map((s: any) => s.nodeId);
    expect(stepped).toContain('notify_cleared');
    expect(stepped).not.toContain('flag_held');
    expect(run.steps.find((s: any) => s.nodeId === 'notify_cleared').status).toBe('success');
    expect(
      (InvoiceDualSignoffFlow.edges as any[]).some(
        (e) => e.source === 'notify_cleared' && e.target === 'end_ok',
      ),
      'notify_cleared no longer leads to end_ok — the branch this asserts moved',
    ).toBe(true);

    // ...and "Notify: Cleared" was really delivered, to a real recipient.
    // A timeout here THROWS, naming itself as a timeout — so the annotation
    // below no longer has to double as a diagnosis of absence (#10106). What
    // is left for it to catch is the other direction: duplicate delivery.
    const delivered = await deliveredInbox(booted, 'Invoice cleared', 1);
    expect(delivered, 'Notify: Cleared was delivered more than once').toHaveLength(1);

    const notice = delivered[0];
    expect(notice.title).toBe('Invoice cleared: INV-1010');
    // The recipient is the INVOICE's owner — the field that actually holds a
    // person. This is the assertion the shipped `{record.account.owner}` could
    // never satisfy, because `showcase_account` has no such field.
    expect(notice.user_id).toBe('grace@example.com');
    // The start node's `expand: ['account']` is what makes this readable — an
    // un-hydrated relation renders the raw FK, or nothing at all.
    expect(notice.body_md).toContain(account.name);
    expect(notice.body_md).not.toContain(account.id);
  }, 30_000);

  /**
   * The hydration itself, pinned where it is durable rather than inferred from
   * the message text: the approval request's stored `payload` IS the run's
   * record, snapshotted at suspend. #7381 quoted the shipped build's payload as
   * `"account": "h8AhbJyB-W2ZgO81"` — a bare id — which is precisely why the
   * post-pause read found nothing.
   */
  it('persists the invoice with its account HYDRATED, which is what survives the pause', async () => {
    const booted = await bootShowcaseApprovals();
    const { invoice, account } = await seedInvoice(booted.data);
    const launched: any = await launchSignoff(booted, invoice);
    expect(launched.status, `launch did not park: ${launched.error ?? ''}`).toBe('paused');

    const request = await pendingRequest(booted.data);
    expect(request, 'no pending approval request was opened').toBeTruthy();

    // `payload_json` is the column ON DISK — the service's `payload` is a parsed
    // view of it. Reading the stored text is the stronger evidence: this is the
    // snapshot that outlives the process across the pause.
    const snapshot = JSON.parse(String(request.payload_json));
    const payloadAccount = snapshot.account;

    expect(typeof payloadAccount, 'the relation was stored as a scalar id, not hydrated').toBe('object');
    expect(payloadAccount.id).toBe(account.id);
    expect(payloadAccount.name).toBe('Fabrikam');

    // ...and the reason the shipped template could never work, asserted rather
    // than argued: the hydrated account has no `owner` key to read.
    expect(Object.keys(payloadAccount)).not.toContain('owner');
    expect(Object.keys(payloadAccount)).toContain('billing_email');
  }, 30_000);

  /**
   * Reverse verification. Same harness, same seed, same decisions — only the
   * flow definition is rolled back to the shape that shipped: the hop
   * `{record.account.owner}` with no `expand` on the start node.
   *
   * Direction is RED-on-resume, and specifically red at the SECOND decision:
   * the first approval must still be accepted (the defect is downstream of the
   * tally), and the request itself still flips to `approved` — the stranded run
   * is the whole of the damage, which is exactly why it went unnoticed.
   */
  it('pre-fix shape: the same approvals strand the run with the recipient diagnostic', async () => {
    const preFix = {
      ...InvoiceDualSignoffFlow,
      nodes: (InvoiceDualSignoffFlow.nodes as any[]).map((n) => {
        if (n.id === 'start') {
          const { expand: _dropped, ...config } = n.config as any;
          return { ...n, config };
        }
        if (n.id === 'notify_cleared') {
          return { ...n, config: { ...n.config, recipients: ['{record.account.owner}'] } };
        }
        return n;
      }),
    };
    // The rollback must actually be a rollback.
    expect((preFix.nodes as any[]).find((n) => n.id === 'start').config.expand).toBeUndefined();

    const booted = await bootShowcaseApprovals([preFix, TaskDoneNotifyOwnerFlow, NotifyOwnerSubflow]);
    const { invoice } = await seedInvoice(booted.data);
    await launchSignoff(booted, invoice);

    const request = await pendingRequest(booted.data);
    const first = await booted.approvals.decide(
      request.id, { decision: 'approve', actorId: 'position:finance' }, SYSTEM_CTX,
    );
    expect(first.finalized).toBe(false);

    let strand = '';
    try {
      const second = await booted.approvals.decide(
        request.id, { decision: 'approve', actorId: 'position:legal' }, SYSTEM_CTX,
      );
      // Whichever way the service reports it, the run must NOT have resumed.
      expect(second.resumed).not.toBe(true);
      strand = String(second.error ?? second.resumeError ?? '');
    } catch (err) {
      strand = (err as Error).message;
    }

    // The engine's diagnostic names the template that came up empty and both
    // remedies. Asserting the envelope, not merely "something threw": a bare
    // throw assertion here would stay green on any unrelated failure.
    expect(strand).toContain('notify_cleared');
    expect(strand).toContain('{record.account.owner}');
    expect(strand).toContain('expand');

    // And nothing was delivered — the payoff message the demo promises.
    //
    // [#10106] Asserted on the WATCH VERDICT, not on a length. A length
    // assertion here was satisfied by a watch that gave up early, so this
    // reverse check could stay green while no longer checking anything;
    // `'quiet'` is only reachable from a fresh read taken past the deadline.
    const quiet = await inboxStayedQuiet(booted, 'Invoice cleared');
    expect(
      quiet.outcome,
      `the inbox did not stay quiet: ${quiet.outcome} after ${quiet.waitedMs} ms ` +
        `with ${quiet.hits.length} match(es) — the pre-fix shape is no longer stranding the run`,
    ).toBe('quiet');
  }, 30_000);

  /**
   * The sweep's second instance, same class and same file face:
   * `showcase_task_done_notify_owner` hops `{record.project.owner}` into a
   * subflow whose `notify` addresses `{ownerId}`. Here the hop is SOUND —
   * `showcase_project.owner` is a real, seeded field — so declaring the
   * relation is the whole fix, and this is the case that demonstrates the
   * hydration path resolving a recipient end to end.
   */
  it('sweep: the task-done subflow resolves the project owner through the declared expand', async () => {
    const booted = await bootShowcaseApprovals();

    // `showcase_project.account` is required, so the sweep case needs the same
    // account the invoice case seeds.
    const account = one(await booted.data.insert('showcase_account', {
      name: 'Fabrikam', industry: 'healthcare', status: 'prospect',
    }, SYS));

    // `planned` is the FSM's only `initialStates` entry (project_status_flow).
    const project = one(await booted.data.insert('showcase_project', {
      name: 'Compliance Audit',
      account: account.id,
      status: 'planned',
      owner: 'grace@example.com',
    }, SYS));

    const task = one(await booted.data.insert('showcase_task', {
      title: 'Collect the signed SOC2 report',
      project: project.id,
      assignee: 'ada@example.com',
      status: 'in_progress',
      priority: 'medium',
    }, SYS));

    const res: any = await booted.automation.execute('showcase_task_done_notify_owner', {
      record: { ...task, status: 'done' },
      previous: { ...task, status: 'in_progress' },
      object: 'showcase_task',
      organizationId: null,
      userId: 'ada@example.com',
    } as any);

    expect(res.success, `run failed: ${res.error ?? ''}`).toBe(true);

    // As at the first call site: a timeout throws and says so, so this
    // annotation is free to name the only other way it can fail (#10106).
    const delivered = await deliveredInbox(booted, 'Project update', 1);
    expect(delivered, 'the subflow notified more than one recipient').toHaveLength(1);
    expect(delivered[0].user_id, 'the recipient is not the project owner the hop names').toBe('grace@example.com');
  }, 30_000);
});

/**
 * [#10106] The watch helper's OWN contract, pinned. No kernel is booted: the
 * whole subject is which verdict `watchInbox` returns, and its only input is
 * `booted.inbox`. Budgets are milliseconds — clamped down, never up — so these
 * cost no meaningful wall clock on a saturated shard.
 */
describe('#10106 — the inbox watch reports WHY it ended, not just what it had', () => {
  /**
   * An inbox whose read is ISSUED at one moment and RESOLVES much later,
   * reporting the rows that existed when it was ISSUED. That is what a real
   * `find` does, and it is the whole mechanism: it lets a verdict about the
   * window rest on a sample taken near the window's start.
   */
  function laggingInbox(readLatencyMs: number, deliverAtMs: number) {
    const t0 = Date.now();
    let first = true;
    return async (): Promise<any[]> => {
      const issuedAt = Date.now();
      if (first) {
        first = false;
        await sleep(readLatencyMs);
      }
      return issuedAt - t0 >= deliverAtMs
        ? [{ title: 'Invoice cleared: INV-1010', user_id: 'grace@example.com' }]
        : [];
    };
  }

  const fakeBooted = (inbox: () => Promise<any[]>): Booted => ({ inbox } as unknown as Booted);

  it('stays-quiet is NOT satisfiable by a watch that gave up — a row landing inside the window is seen', async () => {
    // First read issued at t=0 against an empty inbox and resolving only after
    // the whole budget; the row lands at 20% of the window. This is exactly the
    // shape that made the negative call site pass for the wrong reason.
    const verdict = await inboxStayedQuiet(fakeBooted(laggingInbox(400, 60)), 'Invoice cleared', 300);
    expect(verdict.outcome, 'a row delivered inside the window was reported as quiet').toBe('delivered');
    expect(verdict.hits).toHaveLength(1);
  }, 30_000);

  it('an empty window really does read as quiet, so the pin above is not vacuous', async () => {
    const verdict = await inboxStayedQuiet(fakeBooted(async () => []), 'Invoice cleared', 300);
    expect(verdict.outcome).toBe('quiet');
    expect(verdict.hits).toHaveLength(0);
  }, 30_000);

  it('a positive watch that runs out of window THROWS, and names a timeout rather than an absence', async () => {
    const err: Error = await deliveredInbox(fakeBooted(async () => []), 'Invoice cleared', 1, 300)
      .then(() => new Error('NO THROW: the watch returned short instead of failing loudly'))
      .catch((e: unknown) => e as Error);
    // The message IS the contract here, so it is asserted rather than the bare
    // fact that something threw: a bare throw assertion stays green on any
    // unrelated failure, including the very "returned short" shape this pins.
    expect(err.message).toContain('TIMED OUT');
    expect(err.message).toContain('did not arrive INSIDE THE WINDOW');
    expect(err.message).not.toContain('NO THROW');
    expect(err.message).not.toContain('never delivered');
  }, 30_000);

  it('a positive watch still returns as soon as the message lands', async () => {
    const hits = await deliveredInbox(fakeBooted(laggingInbox(0, 60)), 'Invoice cleared', 1, 300);
    expect(hits).toHaveLength(1);
  }, 30_000);

  it('the budget knob can only SHRINK the window — widening it is not expressible', () => {
    // The #10106 ban on raising the deadline, made structural. Pinned where the
    // clamp is decided, so it costs no wall clock to assert.
    expect(watchWindowMs(3_600_000)).toBe(INBOX_WATCH_MS);
    expect(watchWindowMs(INBOX_WATCH_MS + 1)).toBe(INBOX_WATCH_MS);
    expect(watchWindowMs(300)).toBe(300);
    expect(watchWindowMs()).toBe(INBOX_WATCH_MS);
  });
});
