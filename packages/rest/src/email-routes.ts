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
 * token of it changed.
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
 */

import { logError } from './log.js';
import { seamOrUndefined, type RestServer } from './rest-server.js';

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
                const emailService = await seamOrUndefined(() => this.emailServiceProvider!(environmentId));
                if (!emailService || typeof emailService.send !== 'function') {
                    res.status(501).json({
                        code: 'NOT_IMPLEMENTED',
                        message: 'Email service is not configured on this deployment',
                    });
                    return;
                }

                const body = req.body ?? {};
                if (!body || typeof body !== 'object') {
                    res.status(400).json({ code: 'INVALID_REQUEST', error: 'JSON body required' });
                    return;
                }
                // Stamp sentBy from the authenticated context when caller didn't supply one.
                const input = {
                    ...body,
                    ...(body.sentBy === undefined && (context as any)?.userId
                        ? { sentBy: (context as any).userId }
                        : {}),
                };

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
