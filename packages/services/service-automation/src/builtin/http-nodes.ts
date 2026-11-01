// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { HTTP_SIGNATURE_HEADER, signHttpBody } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, HttpConfigSchema } from '@objectstack/spec/automation';
import type { HttpConfigParsed } from '@objectstack/spec/automation';
import { randomUUID } from 'node:crypto';
import type { AutomationEngine } from '../engine.js';
import { refuseNode } from '../guard-refusal.js';
import { renderTextSlot, type VariableMap } from './template.js';
import { parseNodeConfig } from './parse-config.js';
import { resolveValueSlot } from './value-slot-map.js';
import { FLOW_CREDENTIAL_CLEARED, HTTP_SIGNING_SECRET_KEY } from '../flow-credential-projection.js';

/**
 * HTTP built-in node — canonical `http` (ADR-0018 M3).
 *
 * `http` is the single outbound-callout verb the platform offers Flow, Workflow
 * Rules and Approval. It supersedes the older divergent names (`http_request` /
 * `http_call` / `webhook`), which were removed in 11.0 — author `http`.
 *
 * Two execution modes:
 *
 *  - **Durable (`config.durable: true`)** — fire-and-forget callout enqueued
 *    onto the `service-messaging` HTTP outbox (`sys_http_delivery`), inheriting
 *    retry / idempotency / dead-letter. The flow gets back `{ deliveryId }` and
 *    does NOT block on the response. This closes the "`http_request` is a bare
 *    fetch with no retry" reliability gap (ADR-0018 §4). When no messaging HTTP
 *    outbox is wired the node degrades to the inline call below.
 *
 *  - **Request/response (default)** — a synchronous `fetch()` returning
 *    `{ response, status }` to the flow, preserving the historical `http_request`
 *    behavior so existing flows that read the response keep working. (The ADR's
 *    suspend-and-resume variant is future work. ADR-0018 called it the `isAsync`
 *    path; that descriptor key was retired in #6748 — a suspending HTTP node
 *    would declare `supportsPause: true` plus a `resumeAuthority` and return
 *    `suspend: true`, which is the mechanism the engine actually enforces.)
 *
 * `signingSecret` means `X-Objectstack-Signature` on EVERY arm, with ONE scheme
 * (`@objectstack/core`'s `signHttpBody`): the outbox signs the body it will
 * POST, and the inline call — including the durable arm's no-outbox fallback —
 * signs the exact bytes it hands `fetch`, the empty string when there is no
 * body. An authored `''` sends unsigned on purpose, on every arm.
 *
 * ## What each key is (#19939)
 *
 * The config is parsed AS AUTHORED — after the credential channel's
 * `signingSecret` — and each key is read by what it is (`HttpConfigSchema`):
 *
 *  - `url` and every `headers` value are TEXT slots, rendered through
 *    {@link renderTextSlot} — `{{ }}` holes over the flow's variables. A url
 *    that renders to no text refuses the node; a header that renders to no
 *    text is not sent.
 *  - `body` is a VALUE slot, resolved through the shared
 *    {@link resolveValueSlot}: a CEL value envelope is evaluated in the run's
 *    scope to the payload, and a literal is sent as written.
 *  - `method`, `durable`, `timeoutMs` and `signingSecret` are literals, read
 *    as written.
 *
 * All three are rendered and evaluated ONCE, before either mode, so the
 * durable outbox enqueues exactly the request the inline call would send and
 * nothing renders at delivery. Until #19939 the whole config went through the
 * single-brace `interpolate()` first; a `{…}` token is refused now, by the
 * contract parse below and, before a run starts, by `registerFlow` and
 * `objectstack validate`.
 */

/**
 * Render each `headers` value — a text slot — for this run. A header that
 * renders to no text is not sent (absent in, absent out, like every text
 * slot), where the 17.x interpolation sent it empty.
 */
function renderHeaders(
    headers: Readonly<Record<string, string>> | undefined,
    variables: VariableMap,
    currency: string | undefined,
): Record<string, string> | undefined {
    if (headers === undefined) return undefined;
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        const text = renderTextSlot(value, variables, currency);
        if (text !== undefined) out[name] = text;
    }
    return out;
}

/** Structural view of `service-messaging`'s HTTP outbox surface (ADR-0018 M3). */
interface MessagingHttpSurface {
    isHttpDeliveryReady?(): boolean;
    enqueueHttp?(input: {
        source: string;
        refId: string;
        dedupKey: string;
        label?: string;
        url: string;
        method?: string;
        headers?: Record<string, string>;
        signingSecret?: string;
        timeoutMs?: number;
        payload: unknown;
        /**
         * [#13546] Organization the delivery row belongs to — the tenant
         * column the `redeliver()` cross-organization wall scopes by (#10740).
         */
        organizationId?: string;
    }): Promise<string>;
}

const HTTP_TYPE = 'http' as const;

export function registerHttpNodes(engine: AutomationEngine, ctx: PluginContext): void {
    const getMessaging = (): MessagingHttpSurface | undefined => {
        try {
            return ctx.getService<MessagingHttpSurface>('messaging');
        } catch {
            return undefined;
        }
    };

    engine.registerNodeExecutor({
        type: HTTP_TYPE,
        descriptor: defineActionDescriptor({
            type: HTTP_TYPE,
            version: '1.0.0',
            name: 'HTTP',
            // The description and the config help below are the Studio flow
            // palette and node-card text an admin reads, so they speak business
            // words. The engineer detail they used to carry lives here: with
            // `durable: true` the call is enqueued on the messaging HTTP outbox
            // (retry / dead-letter) and the run does not see the response;
            // otherwise it runs inline and returns the response.
            description:
                'Send a request to an outside web service: wait for its answer, or hand it off to be '
                + 'delivered in the background with automatic retries.',
            icon: 'globe',
            category: 'io',
            source: 'builtin',
            // Capable of outbox-backed durable delivery (used when durable:true
            // and the messaging HTTP outbox is wired).
            needsOutbox: true,
            supportsRetry: true,
            paradigms: ['flow', 'approval'],
            configSchema: {
                type: 'object',
                required: ['url'],
                properties: {
                    // #20590 — `url` and `headers` carry the credential steer, the
                    // same steer #20654 brings to the `HttpConfigSchema` describes
                    // in `@objectstack/spec/automation`. This config is stored in
                    // the flow definition, and every definition read serves it to
                    // any member who can read flows. Only `signingSecret` is
                    // withheld (`flow-credential-projection.ts`), so a credential in
                    // `url` or `headers` is served as authored. Nothing else is
                    // withheld, because a withheld non-credential breaks the round
                    // trip; the remedy is to keep the credential out of the
                    // definition. The route depends on where the credential sits.
                    // A header or a query-string key is carried by a declarative
                    // connector's `auth.credentialRef` (`bearer` / `basic` /
                    // `api-key`, whose `paramName` puts the key in the query). No
                    // `credentialRef` variant carries a secret in the url PATH, so
                    // a path-secret webhook is replaced by a token-authenticated
                    // connector (`@objectstack/connector-slack`'s bot token).
                    url: {
                        type: 'string',
                        description:
                            'Target URL, rendered per run with `{{ }}` holes (`https://api.example.com/v1/orders/{{ record.id }}`); '
                            + 'a single-brace `{token}` is refused. '
                            + 'Stored in the flow definition, which is served to every member who can read '
                            + 'flows, so never a secret-bearing URL. A key in the query string: call the upstream with a '
                            + '`connector_action` on a declarative `rest` connector with `api-key` auth, whose '
                            + '`paramName` names the parameter and `auth.credentialRef` names the secret. A webhook whose '
                            + 'path is the secret: call the service through a token-authenticated connector instead, such '
                            + 'as the `slack` connector with its bot token.',
                    },
                    // `method` is a literal, read as written (#19939): no `{{ }}`
                    // rendering. Default `GET`; `POST` when `durable` is true.
                    method: {
                        type: 'string',
                        description:
                            'The kind of request, such as GET or POST. GET by default; POST when the request is '
                            + 'delivered in the background.',
                    },
                    headers: {
                        type: 'object',
                        description:
                            'Request headers, each value rendered per run with `{{ }}` holes; a single-brace `{token}` '
                            + 'is refused, and a header that renders to no text is not sent. '
                            + 'Stored in the flow definition, which is served to every member who can '
                            + 'read flows, so never put a credential here (an `Authorization` value, an API key): call an '
                            + 'authenticated upstream through a `connector_action` on a declarative connector whose '
                            + '`auth.credentialRef` names the secret.',
                    },
                    // `body` is JSON-serialised: a CEL value envelope
                    // `{ dialect: 'cel', source }` evaluated per run to the payload,
                    // or a literal sent as written.
                    body: {
                        description: 'What to send, as JSON: a fixed value, or an expression worked out on each run.',
                    },
                    // `durable: true` is fire-and-forget through the messaging HTTP
                    // outbox (retry / dead-letter) instead of an inline
                    // request / response.
                    durable: {
                        type: 'boolean',
                        description:
                            'Deliver the request in the background and keep retrying if it fails, instead of '
                            + 'waiting for the answer; the flow does not see the response.',
                    },
                    // Per-request timeout in milliseconds, on both arms; a literal
                    // number, read as written.
                    timeoutMs: { type: 'number', description: 'How long to wait for an answer, in milliseconds.' },
                    // The HMAC-SHA256 secret that signs the request body into the
                    // `X-Objectstack-Signature` header, on every arm; the secret
                    // itself, read as written (`''` sends unsigned on purpose).
                    signingSecret: {
                        type: 'string',
                        description:
                            'A shared secret used to sign each request, so the receiving service can check it came '
                            + 'from you (sent as the X-Objectstack-Signature header).',
                    },
                },
            },
        }),
        async execute(node, variables, context) {
            const authored = (node.config ?? {}) as Record<string, unknown>;
            // [#20790] A signing secret the write-only credential channel holds
            // is not in the definition: it is read now, at execution, and takes
            // the place the literal would have had — so everything below (the
            // contract parse, the signing) treats it exactly as an authored one.
            // The channel's row wins where one exists (a packaged flow's literal
            // is the fallback). A cleared `''` is the author's "unsigned": the
            // channel is not asked. A held secret that does not come back
            // refuses the node — it is never sent unsigned.
            let raw = authored;
            const flowName = context.flowName;
            if (
                typeof flowName === 'string'
                && authored.signingSecret !== FLOW_CREDENTIAL_CLEARED
                && engine.holdsFlowCredential(flowName, node.id, HTTP_SIGNING_SECRET_KEY)
            ) {
                let held: string | undefined;
                try {
                    held = await engine.resolveFlowCredential(flowName, node.id, HTTP_SIGNING_SECRET_KEY);
                } catch (err) {
                    return refuseNode(
                        `http '${node.id}': its signing secret is held by the flow credential store and could not be ` +
                            `read (${(err as Error)?.message ?? String(err)}), so the request cannot carry ` +
                            `${HTTP_SIGNATURE_HEADER} and was not sent.`,
                    );
                }
                if (held !== undefined) raw = { ...authored, signingSecret: held };
            }
            // [#19939] Parsed AS AUTHORED, like every other contract-carrying
            // builtin: a `{…}` token is refused here at any key (the text
            // slots', the body's and the literals' own refusals), and the
            // evaluation below sees only what the contract accepted. Until
            // #19939 this executor interpolated the whole config first and
            // parsed the result.
            const parsed = parseNodeConfig<HttpConfigParsed>('http', node.id, HttpConfigSchema, raw);
            if (!parsed.ok) return parsed.refusal;
            const cfg = parsed.config;

            // The request, rendered and evaluated ONCE, before either mode: the
            // durable outbox enqueues what the inline call would send.
            const url = renderTextSlot(cfg.url, variables, context.currency);
            if (!url) return refuseNode('http: url is required');
            const headers = renderHeaders(cfg.headers, variables, context.currency);
            const body = cfg.body === undefined ? undefined : resolveValueSlot(engine, cfg.body, variables, 'body', context);

            const durable = cfg.durable === true;
            const timeoutMs = cfg.timeoutMs;
            // Read as written (or as the credential channel holds it): no
            // template resolves here, so what was authored is what signs.
            const signingSecret = cfg.signingSecret;

            // ── Durable mode: enqueue onto the messaging HTTP outbox ──────────
            if (durable) {
                const messaging = getMessaging();
                if (messaging?.isHttpDeliveryReady?.() && messaging.enqueueHttp) {
                    // [#13546] The organization this delivery belongs to,
                    // THREADED from the run's own acting context — never
                    // fabricated. Same source and same no-fallback rule as the
                    // `notify` node's #11303 repair one file over:
                    // `AutomationContext.tenantId` is the acting run's
                    // organization, and a wrong value is worse than a null (a
                    // null is visibly missing; a wrong one is silently
                    // authoritative). Without it the sys_http_delivery row
                    // lands `organization_id = NULL` — a row of no
                    // organization, which no tenant-scoped read or redeliver()
                    // reaches (ADR-0131 D8 retired the driver's NULL arm).
                    const organizationId =
                        typeof context.tenantId === 'string' && context.tenantId !== ''
                            ? context.tenantId
                            : undefined;
                    if (!organizationId) {
                        // Fail-LOUD, not fail-guess, not fail-closed (#11303's
                        // triage): a `single`-posture install and a stack before
                        // its first organization legitimately have none, and a
                        // durable callout there must still enqueue.
                        // (Issue anchor lives in these comments, not in the
                        // runtime string — operators cannot resolve a tracker
                        // id; see check:doc-authoring.)
                        ctx.logger.warn(
                            `[http] node '${node.id}': no organization in scope for this durable callout — its ` +
                                `sys_http_delivery row will carry organization_id = NULL, a row of no organization ` +
                                `that no organization's redeliver door can reach on a walled deployment. ` +
                                `On a multi-organization install the triggering context lost its tenant: give the ` +
                                `flow's trigger an acting organization (AutomationContext.tenantId). On a ` +
                                `single-organization install this is expected and can be ignored.`,
                        );
                    }
                    try {
                        const deliveryId = await messaging.enqueueHttp({
                            source: 'flow',
                            refId: node.id,
                            dedupKey: randomUUID(),
                            label: `flow:${node.id}`,
                            url,
                            method: cfg.method ?? 'POST',
                            headers,
                            signingSecret,
                            timeoutMs,
                            payload: body ?? {},
                            // [#13546] Absent (not null) when the run has no
                            // organization; the outbox normalizes a missing
                            // value to NULL exactly once, at the insert.
                            ...(organizationId ? { organizationId } : {}),
                        });
                        // #4354 — the outbox row IS a durable effect this run
                        // caused, but it is NOT a countable one (#7882). What
                        // `enqueueHttp` returns is the id of a `pending` row;
                        // the dispatcher decides the real outcome afterwards,
                        // and that outcome includes dead-lettering the callout
                        // entirely. Counting the enqueue as `acted` made the run
                        // summary assert a delivery that `sys_http_delivery`
                        // recorded as `dead` — the same overstatement #7747
                        // fixed at the `notify` node.
                        //
                        // The honest answer when the run settles is "an effect I
                        // cannot count yet", which is exactly `unmeasuredEffect`
                        // — and pointedly NOT a bare `acted: 0`, which would
                        // claim the run did nothing (`connector.zod.ts:613`) and
                        // trip the broken-sweep alert on every healthy durable
                        // callout. That alert is `selected > 0 AND acted = 0 AND
                        // unmeasured = 0`, so a pending delivery suppresses it
                        // without asserting success.
                        //
                        // Waiting for the real outcome is not on the table: the
                        // whole point of `durable: true` is that the flow does
                        // NOT block on the callout. The inline path below keeps
                        // its measured `acted` — its outcome IS terminal by the
                        // time it returns.
                        return {
                            success: true,
                            output: { deliveryId, enqueued: true },
                            metrics: { unmeasuredEffect: true },
                        };
                    } catch (err) {
                        return { success: false, error: `http (durable) failed to enqueue: ${(err as Error).message}` };
                    }
                }
                // No outbox available — degrade to a best-effort inline call,
                // which signs exactly as the outbox would have.
                ctx.logger.warn(
                    `[http] node '${node.id}' requested durable delivery but no messaging HTTP outbox is wired; falling back to inline fetch`,
                );
            }

            // ── Request/response mode (default; preserves http_request) ───────
            const method = cfg.method ?? 'GET';
            // #4354 — unlike a connector action, an HTTP call's effect IS
            // knowable: the method says it. A GET reads and can never write, so
            // it reports a real `0`; anything else is a mutating call.
            const reads = /^(GET|HEAD|OPTIONS)$/i.test(method);
            const controller = new AbortController();
            const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
            // The exact bytes this arm sends, and therefore the bytes it signs.
            // They are this arm's own serialization, not the outbox's
            // `deliveryBody`; a receiver verifies over what it received, so each
            // arm signs what it sends. No body is signed as the empty string.
            const requestBody = body !== undefined && body !== null ? JSON.stringify(body) : undefined;
            const requestHeaders = signingSecret
                ? { ...headers, [HTTP_SIGNATURE_HEADER]: signHttpBody(requestBody ?? '', signingSecret) }
                : headers;
            try {
                const response = await fetch(url, {
                    method,
                    headers: requestHeaders,
                    body: requestBody,
                    signal: controller.signal,
                });
                const data = await readBody(response);
                return {
                    success: response.ok,
                    output: { response: data, status: response.status },
                    error: response.ok ? undefined : `HTTP ${response.status}`,
                    // A mutating call the upstream ACCEPTED is one effect. One it
                    // rejected is unknown, not zero: a 500 can arrive after the
                    // write landed, and claiming `0` there would let a run report
                    // it changed nothing while it had.
                    metrics: reads
                        ? { acted: 0 }
                        : response.ok
                            ? { acted: 1 }
                            : { unmeasuredEffect: true },
                };
            } catch (err) {
                const e = err as { name?: string; message?: string };
                const msg = e?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e?.message ?? String(err);
                // A timed-out or aborted mutating request may well have landed —
                // the response is what we lost, not necessarily the write.
                return {
                    success: false,
                    error: `http: ${msg}`,
                    metrics: reads ? { acted: 0 } : { unmeasuredEffect: true },
                };
            } finally {
                if (timer) clearTimeout(timer);
            }
        },
    });

    ctx.logger.info('[HTTP] http executor registered');
}

/** Read a response body as JSON, falling back to text (empty body → null). */
async function readBody(response: { json(): Promise<unknown>; text(): Promise<string> }): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        try {
            const text = await response.text();
            return text || null;
        } catch {
            return null;
        }
    }
}
