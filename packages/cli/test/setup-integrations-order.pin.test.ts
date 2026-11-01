// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The MERGED-ORDER pin for Setup → Integrations.
//
// ---------------------------------------------------------------------------
// What this pins
// ---------------------------------------------------------------------------
// `SETUP_APP` declares `group_integrations` as an empty anchor (ADR-0029 D7);
// every entry in it is contributed at runtime by the package that owns the
// capability, and `SchemaRegistry.applyNavContributions` orders the
// contributions by their `priority`, lowest first. Today that reads:
//
//   Webhooks / HTTP Deliveries   `@objectstack/plugin-webhooks`
//   Datasources                  `@objectstack/service-datasource`
//   Connect an Agent             `@objectstack/mcp`
//   Connector Credentials        `@objectstack/service-automation`
//   Connector Connections        `@objectstack/service-automation` (same contribution)
//   Cloud Connection             `@objectstack/cloud-connection`
//
// Each contributor states the group's other priorities in its own header so
// that its number sorts where it means to — and nothing held those headers to
// the code. A later contributor could renumber one of the five and silently
// reorder the menu an administrator reads. This file is that hold.
//
// ⛔ The priorities are READ from the real contributions, never copied here as
// literals: a pin that restated `110` / `120` would pass beside a source that
// had moved, as long as nobody re-ran the arithmetic. What the file does state
// is the ORDER of the ids, which is the user-visible fact under protection.
//
// The first two contributors share one priority, so the fold's stable sort
// leaves their relative order to registration order, which belongs to the
// composition root's plugin list and not to any priority. That tier is pinned
// as a set; every tier boundary is pinned as an order.
//
// ---------------------------------------------------------------------------
// Why it lives in `packages/cli/test/`
// ---------------------------------------------------------------------------
// The same reason as `connect-agent-both-halves-wire.pin.test.ts` beside it:
// this is a COMPOSED fact across five packages and the registry fold, and
// `packages/cli` is the only workspace package that depends on all of them.
//
// Two of the five register their contribution from inside `init()` through
// the `manifest` service rather than exporting it, so they are booted here on
// a context that serves exactly that service — the shape
// `packages/cli/scripts/check-app-nav-i18n.mjs` boots the same two with.
// `@objectstack/service-automation` registers its bundle at `kernel:ready`,
// which this context never fires, so its exported bundle is read directly, as
// that gate does too.

import { describe, expect, it } from 'vitest';
import { CLOUD_CONNECTION_UI_BUNDLE } from '@objectstack/cloud-connection';
import { CONNECT_AGENT_UI_BUNDLE } from '@objectstack/mcp';
import { SchemaRegistry } from '@objectstack/objectql';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects/apps';
import { WebhookOutboxPlugin } from '@objectstack/plugin-webhooks';
import { CONNECTOR_CREDENTIALS_UI_BUNDLE } from '@objectstack/service-automation';
import { DatasourceAdminServicePlugin } from '@objectstack/service-datasource';

type AnyRec = Record<string, any>;

const GROUP = 'group_integrations';

/**
 * The group, in the order an administrator reads it. Each inner array is one
 * priority tier; ids inside a tier are compared as a set (see the header).
 */
const EXPECTED_TIERS: readonly (readonly string[])[] = [
    ['nav_webhooks', 'nav_http_deliveries', 'nav_datasources'],
    ['nav_connect_agent'],
    // One contribution carries both, in this order (ADR-0143 D5 added the second).
    ['nav_connector_credentials', 'nav_connector_connections'],
    ['nav_cloud_connection'],
];

/**
 * The manifests a plugin registers from `init()`, captured off a context that
 * serves the `manifest` service and inert, complete stand-ins for the rest of
 * the interface (`packages/core/src/types.ts`), so a missing member cannot be
 * misread as a plugin that contributes nothing.
 */
async function manifestsRegisteredBy(plugin: { init(ctx: any): Promise<void> | void }): Promise<AnyRec[]> {
    const manifests: AnyRec[] = [];
    const ctx = {
        getService: (name: string) => (name === 'manifest' ? { register: (m: AnyRec) => manifests.push(m) } : undefined),
        registerService: () => {},
        registerServiceFactory: () => {},
        replaceService: () => {},
        getServiceScoped: async () => undefined,
        getServices: () => new Map(),
        hook: () => {},
        trigger: async () => {},
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        getKernel: () => undefined,
    };
    await plugin.init(ctx);
    return manifests;
}

/** Every Setup contribution the composition carries, tagged with its package. */
async function setupContributions(): Promise<Array<{ packageId: string; contribution: AnyRec }>> {
    const sources: Array<[string, AnyRec[]]> = [
        ['@objectstack/plugin-webhooks', await manifestsRegisteredBy(new WebhookOutboxPlugin({ autoEnqueue: false }))],
        ['@objectstack/service-datasource', await manifestsRegisteredBy(new DatasourceAdminServicePlugin({}) as any)],
        ['@objectstack/mcp', [CONNECT_AGENT_UI_BUNDLE as AnyRec]],
        ['@objectstack/service-automation', [CONNECTOR_CREDENTIALS_UI_BUNDLE as AnyRec]],
        ['@objectstack/cloud-connection', [CLOUD_CONNECTION_UI_BUNDLE as AnyRec]],
    ];
    const out: Array<{ packageId: string; contribution: AnyRec }> = SETUP_NAV_CONTRIBUTIONS.map((contribution) => ({
        packageId: '@objectstack/platform-objects',
        contribution: contribution as AnyRec,
    }));
    for (const [packageId, manifests] of sources) {
        for (const manifest of manifests) {
            for (const contribution of manifest?.navigationContributions ?? []) {
                if (contribution?.app === 'setup') out.push({ packageId, contribution });
            }
        }
    }
    return out;
}

/** The children of one nav group in the merged app, by id. */
function groupChildren(app: AnyRec | undefined, groupId: string): string[] {
    const group = (app?.navigation ?? []).find((item: AnyRec) => item?.id === groupId);
    return (group?.children ?? []).map((child: AnyRec) => String(child?.id));
}

describe('Setup → Integrations: the merged order follows each contributor\'s priority', () => {
    it('serves the five contributors in priority order, read from the contributions themselves', async () => {
        const contributions = await setupContributions();

        // `structuredClone`: `registerApp` writes the `_lock` envelope onto
        // what it is handed (ADR-0010 §3.7); the module constant stays clean.
        const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
        (registry as AnyRec).logLevel = 'silent';
        registry.registerApp(structuredClone(SETUP_APP), '@objectstack/platform-objects');
        for (const { packageId, contribution } of contributions) {
            registry.registerAppNavContribution(contribution as any, packageId);
        }

        const merged = groupChildren(registry.getApp('setup'), GROUP);

        // ── The order an administrator reads ──────────────────────────────
        expect(merged).toHaveLength(EXPECTED_TIERS.flat().length);
        let offset = 0;
        for (const tier of EXPECTED_TIERS) {
            expect(new Set(merged.slice(offset, offset + tier.length))).toEqual(new Set(tier));
            offset += tier.length;
        }

        // ── The priorities behind it, read where they are declared ────────
        // Every id in the group, mapped to the priority of the contribution
        // that carries it — and to that contribution's package, so a red names
        // who moved.
        const declared = new Map<string, { priority: number; packageId: string }>();
        for (const { packageId, contribution } of contributions) {
            if (contribution.group !== GROUP) continue;
            for (const item of contribution.items ?? []) {
                declared.set(String(item.id), { priority: contribution.priority, packageId });
            }
        }
        // Nothing contributes into the group that this pin does not order.
        expect([...declared.keys()].sort()).toEqual([...EXPECTED_TIERS.flat()].sort());

        const tierPriority = EXPECTED_TIERS.map((tier) => {
            const priorities = new Set(tier.map((id) => declared.get(id)?.priority));
            expect(priorities.size, `${tier.join(', ')} share one priority`).toBe(1);
            const [priority] = priorities;
            expect(typeof priority, `${tier.join(', ')} declare a numeric priority`).toBe('number');
            return { tier, priority: priority as number };
        });
        for (let i = 1; i < tierPriority.length; i += 1) {
            const before = tierPriority[i - 1];
            const after = tierPriority[i];
            const owner = (id: string) => declared.get(id)?.packageId;
            expect(
                before.priority < after.priority,
                `${before.tier[0]} (${owner(before.tier[0])}, ${before.priority}) sorts before ` +
                    `${after.tier[0]} (${owner(after.tier[0])}, ${after.priority})`,
            ).toBe(true);
        }
    });
});
