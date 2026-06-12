// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalToken } from './sys-approval-token.object.js';
import { renderConfirmPage, renderResultPage } from './action-link-pages.js';
import {
  ApprovalService,
  ESCALATION_JOB_NAME,
  ESCALATION_SCAN_INTERVAL_MS,
  type ApprovalEngine,
} from './approval-service.js';
import { bindApprovalLockHook, unbindAllHooks } from './lifecycle-hooks.js';
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
  private engine?: any;
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
      objects: [SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalToken],
      // ADR-0029 D7 — contribute the Approvals entries into the Setup app's
      // `group_approvals` slot. This plugin owns these objects (K2.b), so it
      // ships their menu too; when the plugin isn't installed the slot is empty.
      navigationContributions: [
        {
          app: 'setup',
          group: 'group_approvals',
          priority: 100,
          items: [
            { id: 'nav_approval_requests', type: 'object', label: 'Requests', objectName: 'sys_approval_request', icon: 'inbox', requiresObject: 'sys_approval_request' },
            { id: 'nav_approval_actions', type: 'object', label: 'Action History', objectName: 'sys_approval_action', icon: 'history', requiresObject: 'sys_approval_action' },
          ],
        },
      ],
    });
    // ADR-0029 D8 — contribute this plugin's object translations to the i18n
    // service on kernel:ready (the i18n plugin may register after this one).
    if (typeof (ctx as any).hook === 'function') {
      (ctx as any).hook('kernel:ready', async () => {
        try {
          const i18n = ctx.getService<any>('i18n');
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
    let engine: any = null;
    try { engine = ctx.getService<any>('objectql'); }
    catch { try { engine = ctx.getService<any>('data'); } catch { /* ignore */ } }
    if (!engine) {
      ctx.logger.warn('ApprovalsServicePlugin: no ObjectQL engine — service NOT registered');
      return;
    }
    this.engine = engine;

    this.service = new ApprovalService({
      engine: engine as ApprovalEngine,
      logger: ctx.logger,
      publicBaseUrl: this.options.publicBaseUrl,
    });

    // Record lock: block edits to a record while it has a pending request.
    if (!this.options.disableAutoHooks) {
      try {
        unbindAllHooks(engine);
        bindApprovalLockHook(engine, ctx.logger);
      } catch (err: any) {
        ctx.logger.warn?.('[approvals] failed to bind record-lock hook', { error: err?.message });
      }
    }

    ctx.registerService('approvals', this.service);
    ctx.logger.info('ApprovalsServicePlugin: service registered');

    // Optional messaging service (ADR-0012): thread interactions (reassign /
    // remind / request-info / comment) notify users when present; without it
    // they degrade to audit-only.
    try {
      const messaging = ctx.getService<any>('messaging');
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
        const jobs = ctx.getService<any>('job');
        if (!jobs || typeof jobs.schedule !== 'function' || !this.service) return;
        const svc = this.service;
        const intervalMs = this.options.escalationScanIntervalMs ?? ESCALATION_SCAN_INTERVAL_MS;
        await jobs.schedule(ESCALATION_JOB_NAME, { type: 'interval', intervalMs }, async () => {
          await svc.runEscalations();
        });
        this.escalationJobScheduled = true;
        void svc.runEscalations().catch((err: any) => {
          ctx.logger.warn?.('[approvals] boot escalation sweep failed', { error: err?.message });
        });
        ctx.logger.info('ApprovalsServicePlugin: SLA escalation scan scheduled', { intervalMs });
      } catch { /* job service not installed */ }
    };
    // Actionable-link pages (ADR-0043): session-less confirm + redemption,
    // mounted straight on the host Hono app. GET only renders; the decision
    // happens exclusively on the POST (mail-gateway prefetch safe).
    const mountActionPages = async () => {
      try {
        const http = ctx.getService<any>('http-server');
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
    try {
      const automation = ctx.getService<ApprovalAutomationSurface>('automation');
      if (automation && typeof automation.registerNodeExecutor === 'function') {
        this.service.attachAutomation(automation);
        registerApprovalNode(automation, this.service, ctx.logger);
      }
    } catch {
      ctx.logger.info('ApprovalsServicePlugin: no automation engine — approval node not registered');
    }
  }

  async stop(ctx: PluginContext): Promise<void> {
    if (this.escalationJobScheduled) {
      try {
        const jobs = ctx.getService<any>('job');
        await jobs?.cancel?.(ESCALATION_JOB_NAME);
      } catch { /* ignore */ }
      this.escalationJobScheduled = false;
    }
    if (this.engine) {
      try { unbindAllHooks(this.engine); } catch { /* ignore */ }
    }
  }
}
