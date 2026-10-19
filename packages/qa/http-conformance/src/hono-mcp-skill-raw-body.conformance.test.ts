// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24287] On a `createHonoApp` host, `GET /api/v1/mcp/skill` answers the raw
 * markdown the standalone server answers — through the host's own pipeline.
 *
 * ## The defect
 *
 * `handleMcpSkillRequest` (`packages/runtime/src/domains/mcp.ts`) serves the
 * skill as a single-chunk `result` stream: one string event, its own lowercase
 * `content-type` / `content-disposition` / `cache-control`. The standalone
 * server writes a string event verbatim and lets the domain's headers replace
 * its defaults. `toResponse`'s events arm in `@objectstack/hono` SSE-framed
 * every event outside a Vercel data stream (`data: ${JSON.stringify(event)}`)
 * and appended the domain's headers beside its own capitalised defaults.
 * Measured through this host before the fix:
 *
 *     GET /api/v1/mcp/skill
 *       body          : data: "---\nname: objectstack\n---\n\n# …"   (an SSE frame of a JSON string)
 *       content-type  : text/markdown; charset=utf-8, text/markdown; charset=utf-8
 *       cache-control : no-cache, no-store
 *
 * ## What is pinned
 *
 *  1. On the hosted door (`app.request` into the Hono app `createHonoApp`
 *     returns): the body is the markdown byte for byte, and the three headers
 *     the domain declares are each its one value.
 *  2. The hosted answer equals the standalone answer (`HonoServerPlugin` + the
 *     dispatcher plugin, over a real socket): status, body and those headers.
 *
 * The skill text carries newlines, double quotes and a non-ASCII character, so
 * any JSON or SSE encoding of it differs from it. A real socket on a
 * `createHonoApp` host is not booted here. `LiteKernel`, a fake `mcp` service
 * that renders only the skill.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createDispatcherPlugin } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';
import type { IHttpServer } from '@objectstack/spec/contracts';

const PREFIX = '/api/v1';
const SKILL = '---\nname: objectstack\ndescription: "Use the MCP server"\n---\n\n# Skill — fixture\n\nLine two.\n';

/** The headers the skill domain declares, each with its one value. */
const SKILL_HEADERS: Record<string, string> = {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': 'inline; filename="SKILL.md"',
    'cache-control': 'no-store',
};

function fakeMcpPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-mcp-skill-raw-body',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('mcp', { renderSkill: () => SKILL });
        },
    };
}

describe('[#24287] GET /mcp/skill answers the raw markdown on a createHonoApp host (conformance)', () => {
    let hostedKernel: LiteKernel;
    let standaloneKernel: LiteKernel;
    let hosted: () => Promise<Response>;
    let standalone: () => Promise<Response>;

    beforeAll(async () => {
        hostedKernel = new LiteKernel();
        hostedKernel.use(fakeMcpPlugin());
        await hostedKernel.bootstrap();
        const app = createHonoApp({ kernel: hostedKernel as any, prefix: PREFIX, cors: false });
        hosted = async () => app.request(`http://hosted.test${PREFIX}/mcp/skill`);

        standaloneKernel = new LiteKernel();
        standaloneKernel.use(fakeMcpPlugin());
        standaloneKernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        standaloneKernel.use(createDispatcherPlugin({ prefix: PREFIX, securityHeaders: false }));
        await standaloneKernel.bootstrap();
        const base = `http://127.0.0.1:${standaloneKernel.getService<IHttpServer>('http.server').getPort!()}`;
        standalone = () => fetch(`${base}${PREFIX}/mcp/skill`);
    }, 30_000);

    afterAll(async () => {
        for (const kernel of [hostedKernel, standaloneKernel]) {
            if (!kernel) continue;
            await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
        }
    }, 30_000);

    it('the hosted door answers the markdown verbatim, with one value per declared header', async () => {
        const res = await hosted();

        expect(res.status).toBe(200);
        expect(await res.text()).toBe(SKILL);
        // `Headers.get` joins repeated values with ", ", so equality is one value.
        for (const [name, value] of Object.entries(SKILL_HEADERS)) {
            expect(res.headers.get(name), name).toBe(value);
        }
    });

    it('the hosted answer is the standalone answer', async () => {
        const viaHost = await hosted();
        const viaStandalone = await standalone();

        expect(viaStandalone.status).toBe(200);
        expect(viaHost.status).toBe(viaStandalone.status);
        const standaloneBody = await viaStandalone.text();
        expect(standaloneBody).toBe(SKILL);
        expect(await viaHost.text()).toBe(standaloneBody);
        for (const name of Object.keys(SKILL_HEADERS)) {
            expect(viaHost.headers.get(name), name).toBe(viaStandalone.headers.get(name));
        }
    });
});
