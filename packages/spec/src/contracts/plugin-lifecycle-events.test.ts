import { describe, it, expect } from 'vitest';
import type { IPluginLifecycleEvents, LifecycleEventName } from './plugin-lifecycle-events';

/**
 * Pins the lifecycle-event registry to the fire-site inventory.
 *
 * Every name below has a real emitter (listed next to it). If you add a key
 * to `IPluginLifecycleEvents`, add it here WITH its fire site; if you remove
 * one, remove it here too. A name with no emitter does not belong in the
 * registry — that is the disease the #4212 retirement cured (seventeen
 * declared-never-fired names, an unused typed-emitter interface, and a dead
 * parallel Zod schema file), and this pin is what keeps it cured.
 */
const FIRED_EVENTS = [
    'kernel:ready', //              core/src/kernel.ts, core/src/lite-kernel.ts
    'kernel:bootstrapped', //       core/src/kernel.ts, core/src/lite-kernel.ts
    'kernel:listening', //          core/src/kernel.ts, core/src/lite-kernel.ts
    'kernel:shutdown', //           core/src/kernel.ts, core/src/lite-kernel.ts
    'app:seeded', //                runtime/src/app-plugin.ts (inline seeder)
    'metadata:reloaded', //         metadata/src/plugin.ts (artifact watcher)
    'external.schema.drift', //     runtime/src/external-validation-plugin.ts
    'ai:routes', //                 cloud AI service plugin (out-of-repo); listener in runtime/src/dispatcher-plugin.ts
    'auth:configure', //            plugins/plugin-auth/src/auth-plugin.ts
    // The `{service}:ready` convention — payload is the live service instance.
    'mcp:ready', //                 mcp/src/plugin.ts
    'automation:ready', //          services/service-automation/src/plugin.ts
    'analytics:ready', //           services/service-analytics/src/plugin.ts
    'external-datasource:ready', // services/service-datasource/src/plugin.ts
    'datasource-admin:ready', //    services/service-datasource/src/datasource-admin-plugin.ts
] as const;

type FiredEvent = (typeof FIRED_EVENTS)[number];
type AssertNever<T extends never> = T;

// Two-way exhaustiveness, checked at compile time: the test file fails to
// build if the registry and this inventory drift apart in either direction.
type _EveryFiredNameIsDeclared = AssertNever<Exclude<FiredEvent, LifecycleEventName>>;
type _EveryDeclaredNameFires = AssertNever<Exclude<LifecycleEventName, FiredEvent>>;

describe('lifecycle-event registry', () => {
    it('declares exactly the events that fire', () => {
        expect([...FIRED_EVENTS].sort()).toEqual(
            [
                'ai:routes',
                'analytics:ready',
                'app:seeded',
                'auth:configure',
                'automation:ready',
                'datasource-admin:ready',
                'external-datasource:ready',
                'external.schema.drift',
                'kernel:bootstrapped',
                'kernel:listening',
                'kernel:ready',
                'kernel:shutdown',
                'mcp:ready',
                'metadata:reloaded',
            ].sort(),
        );
    });

    it('payload tuples match the fire sites', () => {
        // Compile-time assignability against the shapes each emitter passes.
        const kernelReady: IPluginLifecycleEvents['kernel:ready'] = [];
        const seeded: IPluginLifecycleEvents['app:seeded'] = [
            { appId: 'crm', overBudget: false },
        ];
        // `metadata` is optional: the artifact watcher includes it, but the
        // documented contract lets announcers omit it.
        const reloaded: IPluginLifecycleEvents['metadata:reloaded'] = [
            { changed: ['flow/ticket_closed'] },
        ];
        const drift: IPluginLifecycleEvents['external.schema.drift'] = [
            { datasource: 'erp', object: 'invoice', diffs: [] },
        ];
        const authConfigure: IPluginLifecycleEvents['auth:configure'] = [{}, {}];
        const mcpReady: IPluginLifecycleEvents['mcp:ready'] = [{}];
        const automationReady: IPluginLifecycleEvents['automation:ready'] = [{}];
        const aiRoutes: IPluginLifecycleEvents['ai:routes'] = [[]];

        expect(kernelReady).toEqual([]);
        expect(seeded[0].overBudget).toBe(false);
        expect(reloaded[0].changed).toEqual(['flow/ticket_closed']);
        expect(drift[0].object).toBe('invoice');
        expect(authConfigure).toHaveLength(2);
        expect(mcpReady).toHaveLength(1);
        expect(automationReady).toHaveLength(1);
        expect(aiRoutes[0]).toEqual([]);
    });
});
