// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0097 §6 acceptance, `provider: 'mcp'` form (#3056; deferred from #3017):
// a declarative `connectors:` entry pointing at an MCP server — here the
// in-repo stdio fixture (examples/app-showcase/scripts/mcp-fixture.mjs) — is
// materialized at boot into a live connector (spawn → tools/list → actions)
// and dispatched end-to-end by a flow `connector_action`. Also pins:
//  - #3055: the spawn only happens because the host allowlists `node` via
//    `declarativeStdio` (remove it and boot fails loudly);
//  - the GET /connectors surface: origin 'declarative' + state 'ready' for
//    all three generic-executor instances (rest / openapi / mcp).
//
// cwd note: the fixture command (`node ./scripts/mcp-fixture.mjs`) and the
// openapi instance's file-path spec both resolve relative to the app root —
// exactly how `os dev`/`serve` run — so the boot chdirs there for its
// duration (vitest gives each test FILE its own process, so this is isolated).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';

const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

interface ConnectorDescriptor {
    name: string;
    origin?: string;
    state?: string;
    degradedReason?: string;
    actions?: Array<{ key: string }>;
}

describe('showcase declarative MCP connector — ADR-0097 §6 acceptance (#3056)', () => {
    let stack: VerifyStack;
    let token: string;
    let prevCwd: string;

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        // The three generic executors, exactly as objectstack.config.ts wires
        // them (bootStack does not register a stack's `plugins:` — it mirrors
        // the service pairs only — so the harness injects them here).
        stack = await bootStack(showcaseStack, {
            automation: true,
            extraPlugins: [
                new ConnectorRestPlugin(),
                new ConnectorOpenApiPlugin(),
                new ConnectorMcpPlugin({ declarativeStdio: ['node'] }),
            ],
        });
        token = await stack.signIn();
    }, 120_000);

    afterAll(async () => {
        await stack?.stop();
        process.chdir(prevCwd);
    });

    it('materializes all three generic-executor instances at boot — mcp included, state ready', async () => {
        const res = await stack.apiAs(token, 'GET', '/automation/connectors');
        expect(res.status).toBeLessThan(300);
        const body = (await res.json()) as { data?: { connectors?: ConnectorDescriptor[] } };
        const connectors = body.data?.connectors ?? [];
        const byName = Object.fromEntries(connectors.map((c) => [c.name, c]));

        // The MCP instance: fixture spawned, tools/list mapped to actions.
        const mcp = byName['showcase_mcp_tools'];
        expect(mcp, `showcase_mcp_tools missing from registry: ${JSON.stringify(Object.keys(byName))}`).toBeDefined();
        expect(mcp.origin).toBe('declarative');
        expect(mcp.state, `mcp instance degraded: ${mcp.degradedReason ?? ''}`).toBe('ready');
        expect(mcp.actions?.map((a) => a.key)).toContain('echo_upper');

        // Its rest / openapi siblings (ADR-0097 + #3016) on the same surface.
        expect(byName['showcase_status_api']?.state).toBe('ready');
        expect(byName['showcase_status_openapi']?.state).toBe('ready');

        // The catalog descriptor stays inert (never reaches this registry).
        expect(byName['showcase_erp_catalog']).toBeUndefined();
    });

    it('dispatches the MCP tool end-to-end through the flow connector_action', async () => {
        const res = await stack.apiAs(token, 'POST', '/automation/showcase_mcp_connector_echo/trigger', {});
        expect(res.status, `trigger failed: ${res.status} ${await res.clone().text()}`).toBeLessThan(300);
        const body = (await res.json()) as {
            success?: boolean;
            data?: { success?: boolean; error?: string; output?: Record<string, unknown> };
        };
        expect(body.success).toBe(true);
        expect(body.data?.success, `flow run failed: ${JSON.stringify(body.data)}`).toBe(true);
        // The fixture's tools/call result round-tripped into the run output.
        expect(JSON.stringify(body.data?.output ?? body.data)).toContain('OBJECTSTACK');
    });
});
