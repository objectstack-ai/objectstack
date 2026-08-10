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
 * Inbox messages whose title matches, waited for rather than slept on — the
 * inbox channel materializes asynchronously after `emit()` returns.
 *
 * `expected` is required so the NEGATIVE case cannot pass by being early: when
 * none are expected this still burns the full deadline before answering.
 */
async function deliveredInbox(booted: Booted, titleFragment: string, expected: number): Promise<any[]> {
  const deadline = Date.now() + 5_000;
  let hits: any[] = [];
  for (;;) {
    hits = (await booted.inbox()).filter((n: any) => String(n.title ?? '').includes(titleFragment));
    if (hits.length >= expected && expected > 0) return hits;
    if (Date.now() > deadline) return hits;
    await sleep(50);
  }
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
    const delivered = await deliveredInbox(booted, 'Invoice cleared', 1);
    expect(delivered, 'the Notify: Cleared inbox message was never delivered').toHaveLength(1);

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
    expect(await deliveredInbox(booted, 'Invoice cleared', 0)).toHaveLength(0);
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

    const delivered = await deliveredInbox(booted, 'Project update', 1);
    expect(delivered, 'the subflow notified nobody — the project hop resolved to nothing').toHaveLength(1);
    expect(delivered[0].user_id, 'the recipient is not the project owner the hop names').toBe('grace@example.com');
  }, 30_000);
});
