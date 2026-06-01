// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { ApprovalService, type ApprovalEngine } from './approval-service.js';
import { bindApprovalLockHook, unbindAllHooks } from './lifecycle-hooks.js';
import { registerApprovalNode, type ApprovalAutomationSurface } from './approval-node.js';

export interface ApprovalsPluginOptions {
  /** Disable runtime registration (schemas still register). */
  disableService?: boolean;
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
      objects: [SysApprovalRequest, SysApprovalAction],
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

  async stop(_ctx: PluginContext): Promise<void> {
    if (this.engine) {
      try { unbindAllHooks(this.engine); } catch { /* ignore */ }
    }
  }
}
