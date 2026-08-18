// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * End-to-end regression for #7649 — `POST /api/v1/mcp/skill` answered 405 with
 * the WRONG envelope.
 *
 * ## What was measured (QA run #7627)
 *
 * ```
 * POST /api/v1/mcp/skill
 * → HTTP 405
 * {"error":"Method Not Allowed","code":"METHOD_NOT_ALLOWED",
 *  "message":"POST is not supported for /api/v1/mcp/skill. Allowed: GET.",
 *  "method":"POST","path":"/api/v1/mcp/skill","allowed":["GET"]}
 * ```
 *
 * …instead of the standard dispatcher envelope
 * `{success:false, error:{code, message, httpStatus}}` carrying the documented
 * message "Method not allowed — use GET".
 *
 * ⚠️ The quoted body above is the shape MEASURED IN #7627, and the adapter no
 * longer emits it: #9364 converted `unmatchedResponse()` onto the same declared
 * envelope, nesting `method`/`path`/`allowed` under `error.details`. The defect
 * this file guards is unchanged — the wrong DOOR answering — but the two doors
 * are no longer told apart by envelope shape, only by which optional member
 * each fills (`httpStatus` for the domain, `details` for the adapter). See the
 * note on the negative case below; several assertions here had to move for
 * exactly that reason, and would otherwise have gone quietly vacuous.
 *
 * ## Why the defect was invisible to the existing tests
 *
 * The 405 branch is NOT missing. `handleMcpSkillRequest` has had one since
 * #3842 routed it through `buildApiError`, and
 * `http-dispatcher.mcp.test.ts` covers it — by calling
 * `dispatcher.handleMcpSkill('POST', …)` DIRECTLY. That call cannot observe the
 * defect, because the defect is one layer above the dispatcher: the plugin
 * mounted `${prefix}/mcp/skill` for GET only, so a POST matched no route at
 * all, Hono routed it to `notFound`, and the hono adapter's
 * `unmatchedResponse()` — which re-matches the path across verbs and answers
 * 405 with its own hand-rolled body — replied first. The domain's branch was
 * dead code on this adapter.
 *
 * That is exactly the class of bug `dispatcher-plugin.routes.test.ts` opens by
 * naming ("unit tests called the handlers directly, hiding it"), with one extra
 * turn of the screw: here the status was already RIGHT. Only the body differed,
 * so a test asserting `res.status === 405` passes in both worlds. Hence this
 * suite drives a REAL Hono server over real `fetch` and asserts the BODY.
 *
 * ## Shape of the suite
 *
 * `LiteKernel` (as in `auth-unknown-subpath.hono.integration.test.ts`): this is
 * about the HTTP mount seam, and a full `ObjectKernel` would demand a `data`
 * service no assertion here reads. The fake `mcp` service implements only
 * `renderSkill`, which is all `GET /mcp/skill` calls — enough for the happy-path
 * control that proves the fix did not disturb the method the route serves.
 */

/** The standard envelope's message for this branch — contract, not prose. */
const EXPECTED_MESSAGE = 'Method not allowed — use GET';
const SKILL_PATH = '/api/v1/mcp/skill';
const SKILL_MARKER = 'OBJECTSTACK_SKILL_FIXTURE';

/** An `mcp` service that can render the skill and nothing else. */
function fakeMcpPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-mcp-skill',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('mcp', {
                renderSkill: (o: any) =>
                    `---\nname: objectstack\n---\n\n# ${SKILL_MARKER}\n\nMCP: ${o?.mcpUrl ?? '<YOUR_ENV_MCP_URL>'}\n`,
            });
        },
    };
}

describe('POST /api/v1/mcp/skill answers the standard 405 envelope (integration, #7649)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;
    const prevEnabled = process.env.OS_MCP_SERVER_ENABLED;

    beforeAll(async () => {
        // Default-on; set explicitly so a stray env var in the runner cannot
        // turn every assertion below into a 404 that still "passes" a laxer read.
        delete process.env.OS_MCP_SERVER_ENABLED;

        kernel = new LiteKernel();
        kernel.use(fakeMcpPlugin());
        // port 0 → OS-assigned free port; resolved via getPort() after listening.
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        // No `requireAuth: false` here, though the sibling integration suites in
        // this package still pass one: `DispatcherPluginConfig` has no such field
        // (the deployment-wide gate was removed — see the comment at
        // `dispatcher-plugin.ts:209` and `http-dispatcher.requireauth.test.ts:56`,
        // "There is no `requireAuth: false` any more"). It was silently ignored,
        // and copying it here bought nothing but a type error. The route under
        // test is public by design, so nothing needs relaxing.
        kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));

        await kernel.bootstrap();

        const httpServer = kernel.getService<IHttpServer>('http.server');
        baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
    }, 30_000);

    afterAll(async () => {
        if (prevEnabled === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
        else process.env.OS_MCP_SERVER_ENABLED = prevEnabled;
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    /**
     * Drive the route and parse the body.
     *
     * `Response.json()` is typed `unknown`, and there is no honest interface to
     * narrow it to HERE: this suite exists precisely because **two different
     * body shapes** can arrive on this path, and one of the cases reads keys
     * that must NOT exist. A type admitting only the correct envelope would
     * encode the very conclusion the suite is meant to prove, and would make
     * the negative case unwritable. So the cast is to an open record and every
     * assertion below stays a RUNTIME assertion — nothing is checked by the
     * compiler here that the wire is not also checked for.
     */
    async function call(method: string): Promise<{ res: Response; body: Record<string, any> }> {
        const res = await fetch(`${baseUrl}${SKILL_PATH}`, { method });
        return { res, body: (await res.json()) as Record<string, any> };
    }

    // ── ① the defect ────────────────────────────────────────────────────────
    it('POST returns {success:false, error:{code, message, httpStatus}} — not the adapter\'s hand-rolled body', async () => {
        const { res, body } = await call('POST');

        expect(res.status).toBe(405);
        // The envelope, field by field — the whole defect is that these differ,
        // so the status assertion above proves nothing on its own.
        expect(body.success).toBe(false);
        expect(body.error).toBeTypeOf('object');
        expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
        expect(body.error.message).toBe(EXPECTED_MESSAGE);
        expect(body.error.httpStatus).toBe(405);
    });

    it('POST does not answer with `unmatchedResponse()`\'s shape', async () => {
        const { body } = await call('POST');

        // ⚠️ The tell CHANGED with #9364, and the old one would now pass
        // vacuously. Before that card the adapter's 405 answered
        // `error: 'Method Not Allowed'` (a STRING) with `method`/`path`/
        // `allowed` as TOP-LEVEL siblings, so `typeof body.error !== 'string'`
        // and three `not.toHaveProperty` checks genuinely separated the two
        // doors. #9364 put the adapter's refusal into the same declared
        // envelope, nesting its context under `error.details` — so all four of
        // those assertions are now true of the ADAPTER answer as well, and
        // would keep this test green in exactly the world it exists to catch.
        //
        // What still separates the doors is which OPTIONAL member each fills:
        // the dispatcher's `buildApiError` carries `httpStatus` and no
        // `details`; the adapter's `unmatchedResponse` carries
        // `details.{method,path,allowed}` and no `httpStatus`. Both halves are
        // asserted here so this case discriminates on its own.
        expect(body.error).not.toHaveProperty('details');
        expect(body.error.httpStatus).toBe(405);
    });

    // The `Allow` header CHANGES with this fix, which is worth stating exactly
    // rather than filing under "unchanged". Before, the adapter derived it from
    // its own route table and Hono registers HEAD implicitly alongside every
    // GET, so the hint read `GET, HEAD`. Now the domain branch's own literal
    // answers, and it says `GET` — matching the message next to it ("use GET")
    // and the one verb this route actually serves. HEAD is still served; the
    // hint just no longer enumerates it.
    it('answers Allow: GET — the domain branch\'s literal, not the adapter\'s derived `GET, HEAD`', async () => {
        const res = await fetch(`${baseUrl}${SKILL_PATH}`, { method: 'POST' });
        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toBe('GET');
    });

    // DELETE is mounted for the same reason POST is — `/mcp` carries all three
    // verbs, and one of them answering a different 405 envelope than the other
    // is the drift this issue closes.
    it('DELETE gets the same standard envelope', async () => {
        const { res, body } = await call('DELETE');

        expect(res.status).toBe(405);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
        expect(body.error.message).toBe(EXPECTED_MESSAGE);
        expect(body.error.httpStatus).toBe(405);
    });

    // ── ② positive control: the happy path is untouched ─────────────────────
    it('GET still serves the SKILL.md as text/markdown, anonymously', async () => {
        const res = await fetch(`${baseUrl}${SKILL_PATH}`, { method: 'GET' });
        const text = await res.text();

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/markdown');
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(text).toContain(SKILL_MARKER);
        // Derived from the request host — the auth service is absent here.
        expect(text).toContain(`${baseUrl}/api/v1/mcp`);
    });

    // A verb with no mount at all still falls to the adapter, and should:
    // `unmatchedResponse()` is the correct owner of a route that does not
    // exist under that verb. This pins the BOUNDARY of the fix rather than
    // claiming the adapter answer is wrong everywhere.
    it('PUT — unmounted — still falls through to the adapter (boundary, not a regression)', async () => {
        const { res, body } = await call('PUT');
        expect(res.status).toBe(405);

        // The adapter's own 405. Since #9364 it speaks the SAME declared
        // envelope as the domain branch, so `success`/`error.code` no longer
        // tell the two apart — `error.details.allowed` is what does, and it is
        // the direct successor of the top-level `allowed` this case used to
        // read. Asserted by VALUE, not by presence — and the value is the
        // whole four-verb set because #7649's fix mounts GET/POST/DELETE, with
        // Hono registering HEAD implicitly alongside GET. That is precisely
        // why PUT is the boundary probe: it is the one verb left unmounted.
        expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
        expect(body.error.details.allowed).toEqual(['DELETE', 'GET', 'HEAD', 'POST']);
        expect(body.error.details.method).toBe('PUT');
        expect(body.error.details.path).toBe(SKILL_PATH);
        // …and it is NOT the domain branch's answer, which fills `httpStatus`
        // and no `details`.
        expect(body.error).not.toHaveProperty('httpStatus');
    });
});
