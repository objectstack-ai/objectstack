// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type {
  IHttpServer,
  II18nService,
  IJobService,
  IObjectQLEngine,
} from '@objectstack/spec/contracts';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalToken } from './sys-approval-token.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { renderConfirmPage, renderResultPage } from './action-link-pages.js';
import {
  ApprovalService,
  ESCALATION_JOB_NAME,
  ESCALATION_SCAN_INTERVAL_MS,
  type ApprovalEngine,
  type ApprovalMessagingSurface,
} from './approval-service.js';
import { bindApprovalLockHook, bindDelegationWriteGuard, unbindAllHooks } from './lifecycle-hooks.js';
import { registerApprovalNode, type ApprovalAutomationSurface } from './approval-node.js';

export interface ApprovalsPluginOptions {
  /** Disable runtime registration (schemas still register). */
  disableService?: boolean;
  /**
   * Interval between SLA escalation scans (ADR-0042). Defaults to
   * {@link ESCALATION_SCAN_INTERVAL_MS} (5 min). Only takes effect when a
   * `job` service is installed; without one, SLA stays display-only.
   */
  escalationScanIntervalMs?: number;
  /**
   * Absolute origin for actionable links in outbound notifications
   * (ADR-0043), e.g. `https://app.example.com`. Relative by default.
   */
  publicBaseUrl?: string;
  /**
   * Disable the record-lock hook. Schema + service stay intact; only the
   * engine-level lock wiring is suppressed. Useful when a caller wants the
   * manual API only (e.g. tests).
   */
  disableAutoHooks?: boolean;
  /**
   * [#8652] Objects on which a user who can READ the target business record may
   * also see that record's approval requests and full action history —
   * **read-only**. No approval action is delivered through this tier: approve,
   * reject, reassign, recall and comment keep authorizing exactly as they do
   * now, on the pending-approver slate, the submitter, or admin override.
   *
   * ```ts
   * new ApprovalsServicePlugin({ recordReaderVisibleObjects: ['exam_sheet'] })
   * ```
   *
   * **Default OFF.** Omitted (or empty) leaves visibility precisely as it is
   * today — submitter ∪ current approver ∪ historical actor, plus the admin
   * override — so an existing deployment's confidentiality posture is unchanged
   * on upgrade. Opting in is per object and deliberate: enabling it for a
   * ledger object does not enable it anywhere else.
   *
   * **What an enabled object exposes**, so the opt-in is informed: the request
   * row (including its `payload` snapshot of the record at submission time) and
   * the full action history — actor, decision, timestamp, the action's COMMENT
   * text, and any decision attachments. Enable it on objects whose approval
   * commentary the record's readers are meant to see.
   *
   * Anchored on the existing record-read permission: the platform asks the
   * engine to read the record as the caller, so object CRUD and RLS decide.
   * There is no new permission, role or grant type, and no host-side hook.
   */
  recordReaderVisibleObjects?: string[];
}

/**
 * ApprovalsServicePlugin — registers sys_approval_{request,action}, the
 * `approvals` service, the `approval` flow node executor (ADR-0019), and the
 * record-lock hook.
 *
 * ADR-0019: approval is no longer a standalone process engine. A flow's
 * Approval node opens a request and suspends the run; a decision via the
 * service resumes it down the matching branch.
 */
export class ApprovalsServicePlugin implements Plugin {
  name = 'com.objectstack.service.approvals';
  version = '1.0.0';
  type = 'standard';
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: ApprovalsPluginOptions;
  private service?: ApprovalService;
  private engine?: IObjectQLEngine;
  private escalationJobScheduled = false;

  constructor(options: ApprovalsPluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: 'com.objectstack.service.approvals',
      name: 'Approvals Service',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      defaultDatasource: 'cloud',
      namespace: 'sys',
      objects: [SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalToken, SysApprovalDelegation],
      // ADR-0029 D7 — contribute the Approvals entries into the Setup app's
      // `group_approvals` slot. This plugin owns these objects (K2.b), so it
      // ships their menu too; when the plugin isn't installed the slot is empty.
      //
      // #7234 — order inside the slot is ARRAY ORDER: `applyNavContributions`
      // does `group.children.push(...c.items)` per contribution (sorted by
      // `priority`), so the inbox being first in this array is what puts it
      // above the raw tables. Do not reorder without meaning to.
      //
      // The inbox entry is the working surface (decision actions, node
      // progress, drawer); the three object entries below stay as the
      // admin/diagnostic view of the engine's own tables — reachable only here,
      // behind `group_approvals`' `manage_platform_settings` gate.
      navigationContributions: [
        {
          app: 'setup',
          group: 'group_approvals',
          priority: 100,
          items: [
            { id: 'nav_approvals_inbox', type: 'component', label: 'Approvals Inbox', componentRef: 'approvals:inbox', icon: 'list-checks' },
            { id: 'nav_approval_requests', type: 'object', label: 'Requests', objectName: 'sys_approval_request', icon: 'inbox', requiresObject: 'sys_approval_request' },
            { id: 'nav_approval_actions', type: 'object', label: 'Action History', objectName: 'sys_approval_action', icon: 'history', requiresObject: 'sys_approval_action' },
            { id: 'nav_approval_delegations', type: 'object', label: 'Delegations (OOO)', objectName: 'sys_approval_delegation', icon: 'user-clock', requiresObject: 'sys_approval_delegation' },
          ],
        },
      ],
    });
    // ADR-0029 D8 — contribute this plugin's object translations to the i18n
    // service on kernel:ready (the i18n plugin may register after this one).
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', async () => {
        try {
          const i18n = ctx.getService<II18nService>('i18n');
          if (i18n && typeof i18n.loadTranslations === 'function') {
            const { ApprovalsTranslations } = await import('./translations/index.js');
            for (const [locale, data] of Object.entries(ApprovalsTranslations)) {
              i18n.loadTranslations(locale, data as Record<string, unknown>);
            }
          }
        } catch { /* i18n optional */ }
      });
    }
    ctx.logger.info('ApprovalsServicePlugin: schemas registered');
  }

  async start(ctx: PluginContext): Promise<void> {
    if (this.options.disableService) return;
    // This plugin needs the engine SEEN WHOLE, not the data plane: it binds
    // `registerHook` / `unregisterHooksByPackage` below. That is `objectql`,
    // whose ledger entry (`CoreServiceContracts`) records it as "the SAME
    // instance as `data`, seen whole" — so the alias fallback resolves the same
    // object and is typed as the same contract.
    let engine: IObjectQLEngine | null = null;
    try { engine = ctx.getService<IObjectQLEngine>('objectql'); }
    catch { try { engine = ctx.getService<IObjectQLEngine>('data'); } catch { /* ignore */ } }
    if (!engine) {
      ctx.logger.warn('ApprovalsServicePlugin: no ObjectQL engine — service NOT registered');
      return;
    }
    this.engine = engine;

    this.service = new ApprovalService({
      engine: engine as ApprovalEngine,
      logger: ctx.logger,
      publicBaseUrl: this.options.publicBaseUrl,
      // [#8652] Read-only record-reader visibility. Default OFF — an absent
      // declaration reaches the service as an empty set and changes nothing.
      recordReaderVisibleObjects: this.options.recordReaderVisibleObjects,
      // [ADR-0105 D9] Cross-organization approver targeting is a `group`-posture
      // capability. Read LAZILY (not captured at start) because the tenancy
      // service resolves its posture during its own start, which may not have
      // run yet; an unresolvable posture reads as "unknown" and the guard
      // stands down rather than refusing a legitimate flow on a minimal stack.
      tenancyPosture: () => {
        try {
          const tenancy = ctx.getService<{ posture?: string }>('tenancy');
          const posture = tenancy?.posture;
          return typeof posture === 'string' && posture ? posture : undefined;
        } catch {
          return undefined;
        }
      },
    });

    // Record lock: block edits to a record while it has a pending request.
    // Delegation write-guard: a self-service OOO delegation may only name the
    // acting user as delegator (#1322 follow-up). Both bind under the same
    // package id, so unbindAllHooks clears them together.
    if (!this.options.disableAutoHooks) {
      try {
        unbindAllHooks(engine);
        bindApprovalLockHook(engine, ctx.logger);
        bindDelegationWriteGuard(engine, ctx.logger);
      } catch (err: any) {
        ctx.logger.warn?.('[approvals] failed to bind approval hooks', { error: err?.message });
      }
    }

    ctx.registerService('approvals', this.service);
    ctx.logger.info('ApprovalsServicePlugin: service registered');

    // Optional messaging service (ADR-0012): thread interactions (reassign /
    // remind / request-info / comment) notify users when present; without it
    // they degrade to audit-only.
    try {
      // `messaging` has no contract in the ledger, so this is the named local
      // surface the service itself already declares — not `any`. It omits
      // members on purpose; omitting one it USES would be a compile error at
      // the `attachMessaging` call, which is the whole point.
      const messaging = ctx.getService<ApprovalMessagingSurface>('messaging');
      if (messaging && typeof messaging.emit === 'function') {
        this.service.attachMessaging(messaging);
      }
    } catch { /* messaging not installed */ }

    // SLA escalation clock (ADR-0042): a plugin-internal job, deliberately
    // NOT a flow trigger (ADR-0041 §1). Interval sweep + one catch-up scan at
    // boot so a restart doesn't extend a breach by a scan period. Wired on
    // kernel:ready — the job service may start after this plugin. No `job`
    // service → SLA stays display-only.
    const wireEscalationClock = async () => {
      try {
        const jobs = ctx.getService<IJobService>('job');
        if (!jobs || typeof jobs.schedule !== 'function' || !this.service) return;
        const svc = this.service;
        const intervalMs = this.options.escalationScanIntervalMs ?? ESCALATION_SCAN_INTERVAL_MS;
        // Both sweeps ride this one clock: they walk the same `pending` set, and
        // the dead-run release (#3456) is reconciliation with the same "catch up
        // after a restart" requirement — a run killed BY the restart is exactly
        // the shape no in-band handler can clean up.
        // Genuinely independent — an escalation failure must not strand locked
        // records, and vice versa, so neither can short-circuit the other.
        const sweep = async () => {
          const results = await Promise.allSettled([
            svc.runEscalations(),
            svc.releaseDeadRunRequests(),
            // #4469 — the other half of the dead-run picture, and the one no
            // sweeper could see: a request already TERMINAL whose run is gone.
            // Read-only by design (it reports; it never rewrites a decision
            // that really happened), so it rides the same clock purely to make
            // the finding surface without an operator knowing to go looking.
            svc.inspectStrandedRequests(),
          ]);
          for (const r of results) {
            if (r.status === 'rejected') {
              ctx.logger.warn?.('[approvals] periodic sweep leg failed', {
                error: (r.reason as any)?.message ?? String(r.reason),
              });
            }
          }
        };
        await jobs.schedule(ESCALATION_JOB_NAME, { type: 'interval', intervalMs }, sweep);
        this.escalationJobScheduled = true;
        void sweep().catch((err: any) => {
          ctx.logger.warn?.('[approvals] boot sweep failed', { error: err?.message });
        });
        ctx.logger.info('ApprovalsServicePlugin: SLA escalation scan scheduled', { intervalMs });
      } catch { /* job service not installed */ }
    };
    // Actionable-link pages (ADR-0043): session-less confirm + redemption,
    // mounted straight on the host Hono app. GET only renders; the decision
    // happens exclusively on the POST (mail-gateway prefetch safe).
    const mountActionPages = async () => {
      try {
        // [#4251 B5] Canonical name FIRST. This read was `http-server`-only,
        // and `http-server` is the deprecated alias: the ledger records
        // `http.server` as canonical and as "the ONLY name present on all
        // provider paths" — `runtime.ts`'s `config.server` path registers no
        // alias at all. On that path this lookup threw, the catch below
        // swallowed it, and the ADR-0043 action pages silently never mounted,
        // so every approval e-mail link 404'd. Same latent alias-only miss
        // #4393 fixed in metadata/cloud-connection; per-name `try` because
        // `getService` THROWS on an empty slot, so `a() ?? b()` in one `try`
        // never reaches `b`.
        const readServer = (name: string): IHttpServer | undefined => {
          try { return ctx.getService<IHttpServer>(name); } catch { return undefined; }
        };
        const http = readServer('http.server') ?? readServer('http-server');
        const rawApp = http && typeof http.getRawApp === 'function' ? http.getRawApp() : null;
        if (!rawApp || !this.service) return;
        const svc = this.service;
        const ACT_PATH = '/api/v1/approvals/act';
        const html = (c: any, body: string, status = 200) =>
          c.body(body, status, { 'Content-Type': 'text/html; charset=utf-8' });
        rawApp.get(ACT_PATH, async (c: any) => {
          const token = String(c.req.query('token') ?? '');
          const peek = await svc.peekActionToken(token);
          if (!peek.ok) return html(c, renderResultPage(peek.reason, peek.request), 200);
          return html(c, renderConfirmPage({
            request: peek.request, action: peek.action, approverId: peek.approverId,
            token, actPath: ACT_PATH,
          }));
        });
        rawApp.post(ACT_PATH, async (c: any) => {
          let token = '';
          try {
            const body = await c.req.parseBody();
            token = String(body?.token ?? '');
          } catch { /* fall through to invalid */ }
          const out = await svc.redeemActionToken(token);
          if (!out.ok) return html(c, renderResultPage(out.reason, out.request), 200);
          return html(c, renderResultPage(out.action === 'approve' ? 'approved' : 'rejected', out.request));
        });
        ctx.logger.info(`ApprovalsServicePlugin: actionable-link pages mounted at ${ACT_PATH}`);
      } catch { /* http server not installed */ }
    };

    // Pending-approver index backfill (issue #1745): rebuild the normalized
    // sys_approval_approver rows from the pending_approvers CSV so requests
    // written before the index existed (or drifted past a crashed sync) are
    // queryable. Idempotent; cost tracks the live pending queue.
    const backfillApproverIndex = async () => {
      try {
        const svc = this.service;
        if (!svc) return;
        const out = await svc.rebuildApproverIndex();
        if (out.inserted > 0 || out.deleted > 0) {
          ctx.logger.info('ApprovalsServicePlugin: approver index rebuilt', out);
        }
      } catch (err: any) {
        ctx.logger.warn?.('[approvals] approver index backfill failed', { error: err?.message });
      }
    };

    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', wireEscalationClock);
      (ctx as any).hook('kernel:ready', mountActionPages);
      (ctx as any).hook('kernel:ready', backfillApproverIndex);
    } else {
      await wireEscalationClock();
      await mountActionPages();
      await backfillApproverIndex();
    }

    // ADR-0019: contribute the `approval` node to the flow engine when one is
    // present. The node lets a flow suspend on an approval and resume on
    // decision; the service is wired to the same engine so `decide()` can
    // resume the suspended run.
    //
    // #4771 — the degradation must be LOUD (#4632). This used to be one
    // try/catch logging at `info`, and dev's default log level is `warn`: the
    // one line that says "every `approval` node in this deployment is dead"
    // was invisible in exactly the deployment where it is true, while the flow
    // registration was warning about `approval` in the deployments where it is
    // false. The catch is also narrowed to the service *lookup*, so a genuine
    // failure inside registerApprovalNode surfaces as itself instead of being
    // relabelled "no automation engine".
    let automation: ApprovalAutomationSurface | undefined;
    try {
      automation = ctx.getService<ApprovalAutomationSurface>('automation');
    } catch {
      automation = undefined; // no automation service registered in this stack
    }
    if (automation && typeof automation.registerNodeExecutor === 'function') {
      this.service.attachAutomation(automation);
      registerApprovalNode(automation, this.service, ctx.logger);
    } else {
      ctx.logger.warn(
        'ApprovalsServicePlugin: no automation engine — the `approval` flow node is NOT registered. '
        + 'Every ADR-0019 approval flow in this deployment fails at execution time with NO_EXECUTOR. '
        + 'Add @objectstack/service-automation to the stack to enable them.',
      );
    }
  }

  async stop(ctx: PluginContext): Promise<void> {
    if (this.escalationJobScheduled) {
      try {
        const jobs = ctx.getService<IJobService>('job');
        await jobs?.cancel?.(ESCALATION_JOB_NAME);
      } catch { /* ignore */ }
      this.escalationJobScheduled = false;
    }
    if (this.engine) {
      try { unbindAllHooks(this.engine); } catch { /* ignore */ }
    }
  }
}
