// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  SysApprovalProcess,
  SysApprovalRequest,
  SysApprovalAction,
} from '@objectstack/platform-objects/audit';
import { ApprovalService, type ApprovalEngine } from './approval-service.js';

export interface ApprovalsPluginOptions {
  /** Disable runtime registration (schemas still register). */
  disableService?: boolean;
}

/**
 * ApprovalsServicePlugin — registers sys_approval_{process,request,action},
 * the `approvals` service, and (later) the SLA escalation dispatcher.
 */
export class ApprovalsServicePlugin implements Plugin {
  name = 'com.objectstack.service.approvals';
  version = '1.0.0';
  type = 'standard';
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: ApprovalsPluginOptions;
  private service?: ApprovalService;

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
      objects: [SysApprovalProcess, SysApprovalRequest, SysApprovalAction],
    });
    ctx.logger.info('ApprovalsServicePlugin: schemas registered');
  }

  async start(ctx: PluginContext): Promise<void> {
    if (this.options.disableService) return;
    // Register the service directly (not on kernel:ready) so it's available
    // when other plugins' `kernel:ready` hooks fire — e.g. AppPlugin's
    // declarative approval-process seeder. `objectql` is in our
    // `dependencies` array, so it's guaranteed to be started first.
    let engine: any = null;
    try { engine = ctx.getService<any>('objectql'); }
    catch { try { engine = ctx.getService<any>('data'); } catch { /* ignore */ } }
    if (!engine) {
      ctx.logger.warn('ApprovalsServicePlugin: no ObjectQL engine — service NOT registered');
      return;
    }
    this.service = new ApprovalService({
      engine: engine as ApprovalEngine,
      logger: ctx.logger,
    });
    ctx.registerService('approvals', this.service);
    ctx.logger.info('ApprovalsServicePlugin: service registered');
  }

  async stop(_ctx: PluginContext): Promise<void> {
    // nothing yet (no dispatcher)
  }
}
