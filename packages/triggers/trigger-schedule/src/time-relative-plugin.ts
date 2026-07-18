// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { TimeRelativeTrigger } from './time-relative-trigger.js';
import type { TimeRelativeDataEngine } from './time-relative-trigger.js';
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
 * TimeRelativeTriggerPlugin
 *
 * Arms **declarative time-relative flows** (#1874): a flow whose start node
 * declares `config.timeRelative` (object + dateField + `withinDays`/`offsetDays`)
 * is swept on a schedule and launched once per record whose date field falls in
 * the window — no hand-written cron + range query, no fragile
 * date-equality-on-record-change.
 *
 * It ships in `@objectstack/trigger-schedule` alongside the plain schedule
 * trigger (both are schedule-driven) but is a **separate** plugin: the
 * time-relative trigger additionally needs the ObjectQL engine (for the sweep
 * query), so keeping it separate leaves the plain `ScheduleTriggerPlugin`'s
 * dependency surface unchanged. Depends on the job service (sweep cadence) and
 * the ObjectQL engine (record discovery); both are resolved lazily per `start()`
 * so adapter upgrades are always picked up.
 */
export class TimeRelativeTriggerPlugin implements Plugin {
    name = 'com.objectstack.trigger.time-relative';
    type = 'standard';
    version = '1.0.0';
    dependencies = ['com.objectstack.service.job', 'com.objectstack.engine.objectql'];

    async init(ctx: PluginContext): Promise<void> {
        ctx.logger.info('Time-relative trigger plugin initialized');
    }

    async start(ctx: PluginContext): Promise<void> {
        // The automation service, job service, and ObjectQL engine are all
        // resolvable once the kernel is ready (kernel:ready fires after
        // AutomationServicePlugin.start() has pulled flows in and after the job
        // service upgrades its adapter).
        ctx.hook('kernel:ready', async () => {
            const automation = this.resolveService<AutomationTriggerRegistry>(ctx, 'automation');
            if (!automation || typeof automation.registerTrigger !== 'function') {
                ctx.logger.warn(
                    'TimeRelativeTriggerPlugin: automation service not available — time-relative trigger NOT installed',
                );
                return;
            }

            // Probe once for a clear startup warning; the trigger re-resolves
            // both collaborators lazily on each start()/sweep so late upgrades
            // are always picked up.
            if (!this.resolveService<JobServiceSurface>(ctx, 'job')) {
                ctx.logger.warn(
                    'TimeRelativeTriggerPlugin: job service not available — time-relative sweeps will not run until one is registered',
                );
            }
            if (!this.resolveDataEngine(ctx)) {
                ctx.logger.warn(
                    'TimeRelativeTriggerPlugin: ObjectQL engine not available — time-relative sweeps will find no records until it is',
                );
            }

            const trigger = new TimeRelativeTrigger(
                () => this.resolveService<JobServiceSurface>(ctx, 'job'),
                () => this.resolveDataEngine(ctx),
                ctx.logger,
            );
            automation.registerTrigger(trigger);
            ctx.logger.info('TimeRelativeTriggerPlugin: time-relative trigger registered');
        });
    }

    private resolveService<T>(ctx: PluginContext, name: string): T | null {
        try {
            return ctx.getService<T>(name) ?? null;
        } catch {
            return null;
        }
    }

    private resolveDataEngine(ctx: PluginContext): TimeRelativeDataEngine | null {
        // Primary alias 'objectql', fallback 'data' (some kernels register the
        // engine under both) — same lookup the record-change trigger uses.
        return (
            this.resolveService<TimeRelativeDataEngine>(ctx, 'objectql') ??
            this.resolveService<TimeRelativeDataEngine>(ctx, 'data')
        );
    }
}
