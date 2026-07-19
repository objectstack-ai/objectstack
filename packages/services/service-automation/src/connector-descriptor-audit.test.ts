// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Descriptor-only contract audit (#2612): declarative `connectors:` stack
// entries are catalog descriptors — registerApp stores them as metadata, but
// the engine's connector registry is populated only by plugins calling
// `engine.registerConnector(def, handlers)` (ADR-0018 §Addendum). A declared
// connector with actions and no plugin behind it LOOKS dispatchable but is
// inert; the audit at kernel:ready surfaces exactly those entries as a loud
// warning instead of letting `connector_action` fail mysteriously at runtime.
// Provider-bound declarative instances (which upgrade this warning to an
// error) are tracked in #2977 / ADR-0097.

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin, findInertDeclaredConnectors } from './plugin.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A declarative connector entry, the raw shape registerApp registers. */
function declaredConnector(name: string, opts: { actions?: number; enabled?: boolean } = {}) {
    const { actions = 1, enabled } = opts;
    return {
        name,
        label: name,
        type: 'api',
        authentication: { type: 'none' },
        ...(enabled === undefined ? {} : { enabled }),
        actions: Array.from({ length: actions }, (_, i) => ({
            key: `action_${i}`,
            label: `Action ${i}`,
        })),
    };
}

/**
 * Boot a kernel with the automation plugin, a fake objectql registry serving
 * the declared connector metadata, and (optionally) a live plugin-registered
 * connector. Returns the shared kernel logger's warn spy.
 */
async function bootWithConnectors(
    declared: unknown[],
    opts: { registerLive?: string[] } = {},
) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    let warnSpy!: ReturnType<typeof vi.spyOn>;
    const harness = {
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: [] as string[],
        async init(ctx: any) {
            // Kernel contexts share one logger instance (KernelBase.createContext),
            // so spying here observes the automation plugin's warn calls too.
            warnSpy = vi.spyOn(ctx.logger, 'warn');
            ctx.registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'connector' ? declared : []),
                },
            });
            for (const name of opts.registerLive ?? []) {
                ctx.getService('automation').registerConnector(
                    {
                        name,
                        label: name,
                        type: 'api',
                        authentication: { type: 'none' },
                        actions: [{ key: 'action_0', label: 'Action 0' }],
                    },
                    { action_0: async () => ({ ok: true }) },
                );
            }
        },
        async start() {},
    };
    kernel.use(harness as never);
    await kernel.bootstrap();
    await flush();
    return { kernel, warnSpy };
}

function auditWarnings(warnSpy: ReturnType<typeof vi.spyOn>): string[] {
    return warnSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((m: string) => m.includes('declarative connector'));
}

describe('findInertDeclaredConnectors (pure contract)', () => {
    it('flags declared connectors with actions and no runtime registration', () => {
        const inert = findInertDeclaredConnectors(
            [declaredConnector('crm_billing'), declaredConnector('crm_erp')],
            new Set(['rest']),
        );
        expect(inert).toEqual(['crm_billing', 'crm_erp']);
    });

    it('does not flag connectors that ARE runtime-registered under the same name', () => {
        expect(
            findInertDeclaredConnectors([declaredConnector('rest')], new Set(['rest'])),
        ).toEqual([]);
    });

    it('does not flag action-less catalog descriptors', () => {
        expect(
            findInertDeclaredConnectors([declaredConnector('catalog_only', { actions: 0 })], new Set()),
        ).toEqual([]);
    });

    it('does not flag entries explicitly opted out with enabled: false', () => {
        expect(
            findInertDeclaredConnectors(
                [declaredConnector('deliberate_descriptor', { enabled: false })],
                new Set(),
            ),
        ).toEqual([]);
    });

    it('tolerates malformed entries (no name, non-object) without throwing', () => {
        expect(
            findInertDeclaredConnectors(
                [null, 42, {}, { actions: [{ key: 'a' }] }],
                new Set(),
            ),
        ).toEqual([]);
    });
});

describe('kernel:ready audit (wiring)', () => {
    it('warns once at boot for an inert declared connector, naming it', async () => {
        const { kernel, warnSpy } = await bootWithConnectors([declaredConnector('crm_billing')]);
        const warnings = auditWarnings(warnSpy);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('crm_billing');
        expect(warnings[0]).toContain('#2612');
        await kernel.shutdown();
    });

    it('stays silent when the declared connector is plugin-registered', async () => {
        const { kernel, warnSpy } = await bootWithConnectors([declaredConnector('rest')], {
            registerLive: ['rest'],
        });
        expect(auditWarnings(warnSpy)).toHaveLength(0);
        await kernel.shutdown();
    });

    it('stays silent for a deliberate catalog-only entry (enabled: false)', async () => {
        const { kernel, warnSpy } = await bootWithConnectors([
            declaredConnector('catalog_entry', { enabled: false }),
        ]);
        expect(auditWarnings(warnSpy)).toHaveLength(0);
        await kernel.shutdown();
    });

    it('stays silent when nothing is declared', async () => {
        const { kernel, warnSpy } = await bootWithConnectors([]);
        expect(auditWarnings(warnSpy)).toHaveLength(0);
        await kernel.shutdown();
    });
});
