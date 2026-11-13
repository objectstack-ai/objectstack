// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 8] The email route of `RestServer` —
 * `POST {basePath}/email/send`, the transactional send door onto the
 * `IEmailService` provider — moved out of `rest-server.ts` whole. The
 * registrar runs once per mounted base, unconditionally, so an
 * environment-scoped deployment mounts the door twice.
 *
 * A MOVE, not a redesign. The function below is the body of
 * `RestServer#registerEmailEndpoints` as it stood, re-indented one level and
 * otherwise unedited: the same route, registered at the same position, by the
 * same handler, answering the same bodies. It calls no class `static`, so no
 * token of it changed. The send door's bounds (below, "Who may send, and as
 * whom") were added to the moved body afterwards, as their own change.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps the private method —
 * the published `dist/*.d.ts` lists its name, docblock and position — and the
 * body is one host literal ({@link EmailRouteHost}) plus
 * `.call(host, basePath)`. A method is handed over as a closure that calls it
 * on the server at call time, so a test double or spy set on the server is
 * still the one the body reaches.
 *
 * Each field was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE. The body reads it only for its one
 *   `register` call, which runs while registration runs, and the class's one
 *   `routeManager` reassignment wraps `registerMetadataEndpointsInner`, never
 *   this registrar.
 * - `emailServiceProvider` goes as a GETTER. Both of the body's reads of it
 *   (the wiring guard and the provider call) are inside the handler, so they
 *   happen at REQUEST time, and the field is not `readonly`, so a value copied
 *   at registration could part from it. The getter reads the field the handler
 *   read, when it read it.
 *
 * Module-level helpers stay where they were. `logError` is imported from the
 * module `rest-server.ts` imports it from. The one helper declared in
 * `rest-server.ts` itself, `seamOrUndefined` (the provider-seam normalisation
 * its docblock there explains), is exported from there and imported here: one
 * declaration, never a copy. The package entry does not re-export it, so the
 * published surface does not move.
 *
 * ## Who may send, and as whom (ADR-0124: the server is the authority)
 *
 * The door hands a caller's message to the deployment's own mail transport,
 * so an authenticated session is not enough on its own. Four bounds sit
 * between the auth floor and the send, every one of them answered before the
 * service is called:
 *
 *  1. CAPABILITY — the caller must hold {@link EMAIL_SEND_CAPABILITY}. It is
 *     `manage_platform_settings`, the capability that already governs the
 *     mail surface: the `mail` settings namespace (sender address, transport)
 *     reads and writes on it, `sys_identity_email` requires it for the whole
 *     row, and `sys_email` requires it for its two body columns (`body_text`,
 *     `body_html`; the rest of a `sys_email` row is not gated on it). Reused
 *     rather than invented, so this door cannot admit a different set of
 *     callers than the surface that configures the same transport. Checked
 *     BEFORE the provider lookup, so a refused caller does not learn from a
 *     `501` whether this deployment wired mail. The held set is read from the
 *     resolved context's `systemPermissions`, the platform's one capability
 *     resolution; no `isSystem` arm, since `isSystem` is never resolved
 *     from inbound HTTP.
 *  2. ATTRIBUTION — `sentBy` is the authenticated caller, always. A body that
 *     names a different user is refused rather than silently rewritten; a
 *     body naming the caller (or none) is stamped with the caller.
 *  3. SENDER — the envelope sender is the deployment's configured sender
 *     (`IEmailService.getDefaultFrom`). A `from` naming any other address is
 *     refused; one naming the configured address is accepted and replaced
 *     by the configured value, so no caller-chosen display name or spelling
 *     reaches the transport. A service that cannot report its sender, or a
 *     deployment with none configured, refuses a caller `from` (unknown is
 *     not permission). Custom `headers` may not set the sender either
 *     ({@link SENDER_HEADER_NAMES}), and the door accepts them in one shape
 *     only: the contract's `Record<string, string>`, a plain object whose
 *     every key is a header field name and whose every value is a single-line
 *     string (`boundCallerMail`, `@objectstack/core`). Any other shape is refused, so the
 *     reserved-name check reads each header exactly as a transport will.
 *  4. TENANT — the message's mail-log row belongs to the caller's active
 *     organization: the `tenantId` the identity resolver vetted onto the
 *     execution context (`meta-item-read-gate.ts`, "The caller's
 *     organization", says why that and not the session's stored claim). The
 *     door stamps it as `organizationId`, which the service stamps verbatim
 *     onto `sys_email.organization_id`. A body naming any other organization,
 *     or naming one when the caller has no active organization, is refused.
 *     `identityMail` is refused too: identity mail (verification, password
 *     reset, invitations) is sent by the server itself, and its log,
 *     `sys_identity_email`, is not a destination an HTTP caller chooses. A
 *     body restating the door's own answer (`identityMail: false`) is
 *     admitted, and the forwarded message never carries the caller's value.
 *
 * Every refusal is `403 PERMISSION_DENIED` in the nested ADR-0112 envelope —
 * the standard-catalog code for the status, the spelling `enforceAuth` above
 * it answers in. Server-internal senders (flows, notifications, auth mail)
 * call `IEmailService.send` directly and never pass through this door.
 *
 * `replyTo` is NOT bounded. The contract (`SendEmailInput.replyTo`) declares
 * it a caller-supplied address for the Reply-To header and makes no sender
 * claim of it, so no configured value exists to bound it to.
 */

import { boundCallerMail, isPlainMailObject as isPlainObject } from '@objectstack/core';
import { logError } from './log.js';
import { seamOrUndefined, type RestServer } from './rest-server.js';

/**
 * The capability `POST {base}/email/send` requires. See the module header,
 * bound 1, for why it is the mail surface's existing capability.
 */
export const EMAIL_SEND_CAPABILITY = 'manage_platform_settings';

/**
 * Custom header names a caller of the send door may not set. Re-exported from
 * the shared mail bounds (`@objectstack/core`), which both mail doors apply.
 */
export { SENDER_HEADER_NAMES } from '@objectstack/core';

/** The nested ADR-0112 refusal every bound of this door answers with. */
function refuse(res: any, message: string): void {
    res.status(403).json({ error: { code: 'PERMISSION_DENIED', message } });
}

/**
 * The `RestServer` members {@link registerEmailEndpoints} reads — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for why `emailServiceProvider` is a getter.
 */
export interface EmailRouteHost {
    readonly routeManager: RestServer['routeManager'];
    readonly emailServiceProvider: RestServer['emailServiceProvider'];
    resolveRequestEnvironmentId: RestServer['resolveRequestEnvironmentId'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
}

/**
 * Register the transactional email send endpoint —
 * `RestServer#registerEmailEndpoints`' body, called by that method with the
 * server as `this`. The method's own docblock, which the published declaration
 * carries, names the route and its request body.
 */
export function registerEmailEndpoints(this: EmailRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');
    this.routeManager.register({
        method: 'POST',
        path: `${basePath}/email/send`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const context = await this.resolveExecCtx(environmentId, req);
                if (this.enforceAuth(req, res, context)) return;

                // Bound 1 (module header): the capability, before the provider
                // lookup so a refusal reveals nothing about the wiring.
                const held: unknown = (context as any)?.systemPermissions;
                if (!Array.isArray(held) || !held.includes(EMAIL_SEND_CAPABILITY)) {
                    refuse(res, `Sending email through this door requires the \`${EMAIL_SEND_CAPABILITY}\` capability.`);
                    return;
                }

                if (!this.emailServiceProvider) {
                    res.status(501).json({
                        code: 'NOT_IMPLEMENTED',
                        message: 'Email service is not configured on this deployment',
                    });
                    return;
                }
                // [#15405] `seamOrUndefined`, not the retired
                // `.catch(() => undefined)`. That handler attaches to the
                // promise the call RETURNS, so it can only ever see a
                // REJECTION: a host wiring a non-`async` provider — which
                // the seam's declared type cannot prevent, and
                // `RestServer`'s constructor is the public wiring point —
                // throws while the expression is still being evaluated, so
                // there is no promise to attach to and the handler is never
                // reached (commit add6a1b1c).
                //
                // ⚠️ NOT reachable from the SHIPPED wiring: the provider
                // `rest-api-plugin.ts` hands over is declared `async`.
                // Repaired because it is the same retired spelling at an
                // embedder-reachable seam, ⛔ not on a claim of live impact.
                //
                // The ANSWER is deliberately unchanged — absorb to
                // `undefined` and take the 501 below. ⛔ Unlike the engine
                // seam, this one must NOT go loud: the
                // `if (!this.emailServiceProvider)` guard above has already
                // answered the wiring question, and "not configured" and
                // "configured and unusable" both mean this deployment cannot
                // send mail — one 501, no fact lost by folding them.
                //
                // [#30011] Asked for the REQUEST's environment — the scoped
                // param, else the shared request→environment resolver — so a
                // hosted environment's send goes through its own kernel's
                // email service, never the host's. Resolved inside the seam,
                // so a resolver fault takes the same 501 as any other.
                const emailService = await seamOrUndefined(async () =>
                    this.emailServiceProvider!(await this.resolveRequestEnvironmentId(environmentId, req)));
                if (!emailService || typeof emailService.send !== 'function') {
                    res.status(501).json({
                        code: 'NOT_IMPLEMENTED',
                        message: 'Email service is not configured on this deployment',
                    });
                    return;
                }

                // An absent body is the empty message, for the service to
                // judge. A body that is present must be a JSON object: an
                // array is `typeof 'object'` and a JSON `null` is present, and
                // neither is a message, so both take this route's own 400
                // before the service is reached.
                const body = req.body === undefined ? {} : req.body;
                if (!isPlainObject(body)) {
                    res.status(400).json({ code: 'INVALID_REQUEST', error: 'JSON body required' });
                    return;
                }
                // Bounds 2-4 (module header): one implementation, shared with
                // the script-body mail door (`@objectstack/core`
                // `boundCallerMail`). `enforceAuth` above has already proved
                // `userId` present.
                const tenantId: unknown = (context as any).tenantId;
                const bounded = boundCallerMail(
                    body,
                    {
                        userId: String((context as any).userId),
                        organizationId: typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined,
                    },
                    emailService,
                );
                if (!bounded.ok) {
                    refuse(res, bounded.reason);
                    return;
                }
                const input = bounded.input as any;

                try {
                    const result = await emailService.send(input);
                    if (result?.status === 'sent') {
                        res.status(200).json(result);
                    } else {
                        // failed / queued — still surface to client with 200 so clients can branch on status.
                        res.status(200).json(result);
                    }
                } catch (err: any) {
                    // Validation errors from normalizeMessage are surfaced as 400.
                    const message = String(err?.message ?? err ?? 'send failed');
                    if (message.startsWith('VALIDATION_FAILED')) {
                        res.status(400).json({
                            code: 'VALIDATION_FAILED',
                            error: message.replace(/^VALIDATION_FAILED:\s*/, ''),
                        });
                        return;
                    }
                    throw err;
                }
            } catch (error: any) {
                logError('[REST] Email send unhandled error:', error);
                res.status(500).json({
                    code: 'EMAIL_SEND_FAILED',
                    error: String(error?.message ?? error ?? 'send failed').slice(0, 500),
                });
            }
        },
        metadata: {
            summary: 'Send a transactional email via the configured EmailService',
            tags: ['email'],
        },
    });
}
