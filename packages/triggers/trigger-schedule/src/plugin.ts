// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { ScheduleTrigger } from './schedule-trigger.js';
import type { FlowTrigger, JobServiceSurface } from './schedule-trigger.js';

/**
 * The slice of the automation engine this plugin needs: register a trigger on
 * its `FlowTrigger` extension point. Declared structurally so the plugin does
 * not take a build dependency on `@objectstack/service-automation`.
 */
interface AutomationTriggerRegistry {
    registerTrigger(trigger: FlowTrigger): void;
    unregisterTrigger?(type: string): void;
}

/**
 * ScheduleTriggerPlugin
 *
 * Makes schedule-triggered flows actually fire. The automation engine ships the
 * `FlowTrigger` wiring (it parses each flow's start node — `flow.type ===
 * 'schedule'` or a start-node `config.schedule` descriptor — into a binding and
 * calls `trigger.start(...)`), but the *concrete* schedule trigger lives here as
 * a plugin and delegates timing to the platform `IJobService` (the `'job'`
 * service). This mirrors the connector / record-change split (engine baseline +
 * trigger plugin).
 *
 * With this plugin (and a job service) installed, a flow whose start node
 * declares `config: { schedule: { type: 'cron', expression: '0 1 * * *' } }`
 * auto-launches on that schedule — no manual `engine.execute()`.
 *
 * Depends on the job service plugin so its `kernel:ready` upgrade (to the
 * durable DbJobAdapter) runs before ours; the job service is nonetheless
 * resolved lazily per `start()` so we always use its current adapter.
 */
export class ScheduleTriggerPlugin implements Plugin {
    name = 'com.objectstack.trigger.schedule';
    type = 'standard' as const;
    version = '7.3.0';
    dependencies = ['com.objectstack.service.job'];

    async init(ctx: PluginContext): Promise<void> {
        ctx.logger.info('Schedule trigger plugin initialized');
    }

    async start(ctx: PluginContext): Promise<void> {
        // The automation service + job service are resolvable once the kernel is
        // ready (kernel:ready fires after AutomationServicePlugin.start() has
        // pulled flows in and after the job service upgrades its adapter).
        ctx.hook('kernel:ready', async () => {
            const automation = this.resolveService<AutomationTriggerRegistry>(ctx, 'automation');
            if (!automation || typeof automation.registerTrigger !== 'function') {
                ctx.logger.warn(
                    'ScheduleTriggerPlugin: automation service not available — schedule trigger NOT installed',
                );
                return;
            }

            // Probe once for a clear startup warning; the trigger re-resolves
            // lazily on each start() so adapter upgrades are always picked up.
            if (!this.resolveService<JobServiceSurface>(ctx, 'job')) {
                ctx.logger.warn(
                    'ScheduleTriggerPlugin: job service not available — scheduled flows will not run until one is registered',
                );
            }

            const trigger = new ScheduleTrigger(
                () => this.resolveService<JobServiceSurface>(ctx, 'job'),
                ctx.logger,
            );
            automation.registerTrigger(trigger);
            ctx.logger.info('ScheduleTriggerPlugin: schedule trigger registered');
        });
    }

    private resolveService<T>(ctx: PluginContext, name: string): T | null {
        try {
            return ctx.getService<T>(name) ?? null;
        } catch {
            return null;
        }
    }
}
