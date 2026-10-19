// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 13c] The `/meta` per-item writes of `RestServer` — the item save
 * (`PUT {metaPath}/:type/:name`) and the reset to the artifact default
 * (`DELETE {metaPath}/:type/:name`) — moved out of `rest-server.ts`. They were
 * the fifth group of `RestServer#registerMetadataEndpointsInner`'s body, two
 * statements, and that method now calls the function below at their old
 * position, so the `/meta` routes still register in one order: after the
 * per-item reads, and above the history family.
 *
 * A MOVE, not a redesign. The function below is those two statements as they
 * stood, re-indented one level: the same two routes per base, by the same
 * handlers, answering the same bodies, each still registered through the
 * per-item switch's registrar. The moved comments are moved text too: where one
 * says "the `PUT` twins", "next door" or "a few hundred lines up", it still
 * describes the inner method's order as it was, in which `POST
 * {metaPath}/_migrate-stored` (now in `meta-collection-routes.ts`) sat above
 * these two doors.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 13a set for `/meta` (`meta-collection-routes.ts`' header
 * carries the full reasoning). The class keeps the private method, and the
 * method keeps its head; at the position of the moved statements it builds one
 * host literal ({@link MetaItemWriteRouteHost}) and hands it, with the head's
 * one {@link MetaRouteScope}, to the function below as its `this` and its
 * argument. A method is handed over as a closure that calls it on the server
 * at call time, so a test double or spy set on the server is still the one the
 * body reaches.
 *
 * Each member was checked on its own, not inherited from an earlier slice:
 *
 * - There is NO `routeManager` member, and that absence is the load-bearing
 *   part. This is the first `/meta` module that registers nothing on the
 *   server's route manager itself: both statements register through the inner
 *   method's per-item registrar, which reaches this module in the scope as the
 *   ONE closure the inner head declares. That closure reads the server's route
 *   manager at CALL time, and every call below runs during the inner call,
 *   while `registerMetadataEndpoints`, the umbrella, has swapped that manager
 *   for its wrapping registrar; so these two routes still mount behind the
 *   anonymous-deny gate (#3963) and the type-level write admission (#21124),
 *   and still answer to the per-item switch (`metadata.endpoints.item`), which
 *   the same closure reads. ⛔ Never a module-local registrar: a copy here would
 *   be a second copy of a helper, it would read a host field instead of the
 *   server's manager, and a manager captured anywhere but inside the swap would
 *   mount both writes outside those gates.
 * - No member goes as a getter, because the body reads no instance FIELD at
 *   request time. The caller, the walled refusal, the protocol and the write
 *   actor are each resolved per request by a METHOD of the class, and every
 *   method goes as a closure.
 *
 * The inner method's head declares the bindings every `/meta` group reads and
 * hands them over as ONE parameter, {@link MetaRouteScope}, built once there;
 * the function destructures the three its body reads (`metaPath`, `isScoped`
 * and the per-item registrar). It does not read `metadata`: the per-item
 * switch is read inside that registrar, where it always was. The host stays
 * class members only.
 *
 * ## The one token that is not byte-identical
 *
 * The save door asked the class's PRIVATE STATIC `metaSaveVerdict`, which it
 * used to call as `RestServer.metaSaveVerdict(…)`. A private static is reachable
 * by name only inside the class, so that spelling does not compile here, and
 * making the member public, or moving it, changes the published declaration
 * the move must keep byte-identical (the stored-version read doors ask the same
 * static from the class head, which is why it is spelled once there). So the
 * call reaches it the way every other class member this body reads is reached:
 * through the host, as `this.metaSaveVerdict(…)`, a closure on
 * {@link MetaItemWriteRouteHost} that calls the static with the same argument.
 * The static reads nothing but its argument, so the receiver is the whole
 * difference, as it was for slice 13a's `metaTypeSingular`. That receiver is
 * the only token of the body that changed.
 *
 * ## Module-level names
 *
 * Two names declared in `rest-server.ts` stay there and are imported from it:
 * the reset's closed query set (its member-selector tests import it from
 * there) and the package binding (on the package entry). Both are read only at
 * request time, so the two modules importing each other cannot see one
 * uninitialised. The imports only this body read left `rest-server.ts` with
 * it: the save's closed query set (whose re-export there stays), the save's
 * request mapping and the two declared request types. Every other name is
 * imported from the module `rest-server.ts` imports it from. The package entry
 * re-exports nothing from here, and the published surface does not move.
 */

import { rethrowAuthzStoreUnavailable } from '@objectstack/core';
// [#12702 · #20156] The `/meta` item write doors' capability predicate — see
// `rest-server.ts`' import of the same name for why it is shared.
import { metaWriteCapabilityVerdict } from '@objectstack/metadata-core';
import type { DeleteMetaItemRequest, SaveMetaItemRequest } from '@objectstack/spec/api';
import { handleRouteError } from './error-response.js';
import type { MetaRouteScope, TransportScopedMetaRequest } from './meta-collection-routes.js';
import { META_ITEM_MEMBER_PARAM, META_ITEM_SAVE_PARAMS, metaMemberSelector } from './meta-item-read-gate.js';
// [#22141] The save door's precondition and lifecycle, read through the ONE
// mapping the runtime dispatcher's `/meta` domain asks too.
import { metaSaveRequestOptions } from './meta-save-request.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { refuseRepeatedQueryParams } from './query-multiplicity.js';
import { META_ITEM_RESET_PARAMS, metaItemPackageBinding, type RestServer } from './rest-server.js';

/**
 * The `RestServer` members {@link registerMetaItemWriteRoutes} reads — every
 * one of them, and no other, in the order the body first reads them. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member the
 * class does not have is a compile error. `metaSaveVerdict` is the class's
 * private STATIC, typed as the static it is. The module header says why there
 * is no `routeManager` member, why the body reaches the static through the
 * host, and why none of the members is a getter.
 */
export interface MetaItemWriteRouteHost {
    resolveExecCtx: RestServer['resolveExecCtx'];
    metaSaveVerdict: (typeof RestServer)['metaSaveVerdict'];
    walledCatalogRefusal: RestServer['walledCatalogRefusal'];
    resolveProtocol: RestServer['resolveProtocol'];
    resolveMetaWriteActor: RestServer['resolveMetaWriteActor'];
}

/**
 * Register the `/meta` per-item writes — the item save and the reset, the fifth
 * group of `RestServer#registerMetadataEndpointsInner`' body, called by that
 * method at its position in its registration order, with the server's members
 * as `this` and the method's head bindings as `scope`. The method's own
 * docblock, which the published declaration carries, names the families, their
 * switches and the ordering facts the routes below keep.
 */
export function registerMetaItemWriteRoutes(this: MetaItemWriteRouteHost, scope: MetaRouteScope): void {
    const { metaPath, isScoped, registerPerItemRoute } = scope;

    // PUT /meta/:type/:name - Save metadata item
    // We always register this route, but return 501 if protocol doesn't support it
    // This makes it discoverable even if not implemented
    registerPerItemRoute({
        method: 'PUT',
        path: `${metaPath}/:type/:name`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                // [#6603] Authoring capability gate — the SAME mechanism
                // `POST /meta/_migrate-stored` uses next door, deliberately
                // not a second way of demanding the same capability.
                //
                // Two independent reasons, either sufficient:
                //
                //  1. **The ADR-0106 round-trip.** D1 removes an unreadable
                //     field WHOLE from a served object schema, and this
                //     route persists the body it is handed. So a non-exempt
                //     caller's ordinary GET → edit a label → PUT used to
                //     store the schema back MINUS the fields masked out of
                //     their own read — silent deletion of fields they were
                //     never allowed to see, with nothing in the exchange
                //     saying so. Refusing the write is the write-side answer
                //     the masking needs: it makes "whoever may write a
                //     schema is whoever sees all of it" an enforced
                //     invariant instead of a coincidence, rather than
                //     teaching `saveMetaItem` that absent means keep (which
                //     would make field DELETION inexpressible for everyone).
                //  2. It closes a hole that predates masking entirely: any
                //     authenticated session could clobber any metadata item.
                //
                // Gate FIRST — before the protocol is resolved — so an
                // unauthorized caller cannot use the 501-vs-200 answer to
                // probe which kernels implement saving, and so nothing is
                // written before the refusal. `manage_metadata` is
                // ADR-0066 D1's authoring capability and saving a metadata
                // item is authoring; `isSystem` bypasses, matching every
                // other capability gate on the platform.
                //
                // [#12702 · ADR-0131 D6] The gate is the shared
                // `metaWriteCapabilityVerdict` (`@objectstack/metadata-core`):
                // `manage_metadata` or `isSystem`. The org-scoped
                // `manage_org_presentation` arm retired with the
                // per-organization overlay axis — this door threads no
                // organization, so that arm would have admitted its holders
                // to environment-wide authoring.
                //
                // [#20156] Asked through {@link metaSaveVerdict}, the ONE
                // spelling the stored-version read doors' author exemption
                // asks too (ruling 5856774816): whoever this door admits
                // reads the stored version whole there, whatever the plain
                // read withholds from them — so what they save back is
                // everything that was stored.
                const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                {
                    const verdict = this.metaSaveVerdict(ctx);
                    if (!verdict.allowed) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: verdict.message,
                            },
                        });
                        return;
                    }
                }
                // [ADR-0131 D3 · D12 items 7–8] The walled refusal, after the
                // capability gate and before the protocol is resolved: under
                // `isolated` / `group` every organization shares the
                // environment's metadata, so only the platform operator rung
                // (or the engine itself) writes it, whatever the type. Inert
                // under `single`. See {@link walledCatalogRefusal}.
                {
                    const walled = await this.walledCatalogRefusal(req.params.type, ctx, environmentId, req);
                    if (!walled.allowed) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: walled.message,
                            },
                        });
                        return;
                    }
                }
                const p = await this.resolveProtocol(environmentId, req);
                if (!p.saveMetaItem) {
                    // [#7035] ADR-0112 envelope: the semantic code lives at
                    // `error.code`, NOT as a sibling of `error`. This site
                    // used to answer `{ error: '<msg>', code: 'NOT_IMPLEMENTED' }`
                    // while `POST /meta/_migrate-stored` a few hundred lines
                    // up answered the nested shape for the same condition,
                    // so a client reading `err.error.code` got `undefined`
                    // here — and `undefined` takes the "no code" branch, not
                    // an error branch. `NOT_IMPLEMENTED` is unchanged: it is
                    // already the standard-catalog code ADR-0112 maps 501 to
                    // (`spec/src/api/errors.zod.ts` — the catalog member and
                    // `standardErrorCodeForHttpStatus(501)`).
                    res.status(501).json({
                        error: {
                            code: 'NOT_IMPLEMENTED',
                            message: 'Save operation not supported by protocol implementation',
                        },
                    });
                    return;
                }

                // Accept both `{ ...itemFields }` (bare) and `{ metadata: {...} }`
                // / `{ item: {...} }` envelope shapes. Studio and direct API
                // callers historically use either; ADR-0005 settles on
                // unwrapping to a single payload before persistence.
                const body = req.body ?? {};
                const item = (body && typeof body === 'object' && 'metadata' in body)
                    ? (body as any).metadata
                    : (body && typeof body === 'object' && 'item' in body)
                        ? (body as any).item
                        : body;

                // Opt-in OCC under ADR-0008 PR-10d.3: callers (Studio,
                // CLI) may set `If-Match` to the version token a receipt
                // served, to enforce that the overlay row has not advanced
                // since they last read it. A `null`/empty body or no header
                // preserves the legacy last-write-wins behaviour. [#21207]
                // The token is the crypto provider's keyed digest of the
                // stored content hash, never the hash itself; the protocol
                // compares it in that form, so it passes through here as sent.
                // [#22114] The item read serves the same token as `version`,
                // and `If-None-Match: *` pins a save that expects no row.
                // [#22141] The pin and `?mode=draft` are read through
                // {@link metaSaveRequestOptions} — the ONE mapping the
                // runtime dispatcher's `/meta` door asks too, so the
                // `@objectstack/hono` catch-all cannot answer this request
                // differently. Its `request` members are spread into the
                // save below, each present only when the caller asked.
                //
                // [#24395] …and `?surface=` (`studio` | `api`; `copilot` is
                // refused there), the authoring surface a draft save stamps
                // on each key path it changes.
                //
                // The multiplicity guard runs FIRST: it refuses a repeated
                // `force`, `package`, `mode` or `surface` (see the `force` read below
                // for why that one is sharp) and UNWRAPS one occurrence
                // encoded as an array, so `?mode=` reaches the mapping as
                // the string it reads.
                //
                // [#23072] …and RECOGNITION before it, over the measured
                // closed set: a name this door does not read — `member`
                // first among them, the save being body-addressed — is a
                // located 400 here, before anything is written, never
                // dropped while the body's own member is saved.
                if (refuseUnknownQueryParams(req, res, META_ITEM_SAVE_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res, ['force', 'package', 'mode', 'surface'])) return;
                const saveOptions = metaSaveRequestOptions({ headers: req.headers, query: req.query });
                if (!saveOptions.ok) {
                    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: saveOptions.message } });
                    return;
                }
                // [#7749 producer, #7941 precedence] The request's authenticated
                // identity — one producer, shared by every `/meta` write (see
                // resolveMetaWriteActor). `X-Actor` is not consulted.
                const actor = await this.resolveMetaWriteActor(environmentId, req);
                // Phase 3a-destructive: `?force=true` opts past the
                // destructive-change safety check. Accept any truthy
                // string ('true', '1', 'yes') for resilience.
                //
                // [#6877] THE sharp one on this surface. The `typeof` ternary
                // below falls to `!!forceRaw` for anything that is not a
                // string, and a non-empty array is truthy — so
                // `?force=false&force=false`, a caller repeating an explicit
                // OPT-OUT, turned the destructive-change guard ON. An
                // inversion, on a destructive verb, reported as 200. The
                // multiplicity guard above refuses it before this read.
                const forceRaw = req.query?.force;
                const force = typeof forceRaw === 'string'
                    ? ['true', '1', 'yes', 'on'].includes(forceRaw.toLowerCase())
                    : !!forceRaw;

                // Software-package binding (Studio package authoring).
                // `?package=<id>` binds the saved row to that package
                // (sys_metadata.package_id). 'all'/empty = env-local overlay
                // ({@link metaItemPackageBinding}, the item read's too).
                const packageId = metaItemPackageBinding(req.query?.package);

                // [ADR-0131 D6] THE WRITE NAMES NO ORGANIZATION. The
                // per-organization overlay axis is retired: every write this
                // door admits lands environment-wide (`organization_id`
                // NULL), its audit row included, whatever the caller's
                // active organization. Until this stage the door threaded
                // the active organization for the five types whose registry
                // flag opened an overlay (then spelled `allowOrgOverride`,
                // `allowEnvironmentOverlay` since 18, which decides no
                // organization); a single-posture Studio save
                // of those types therefore sits under the Default
                // Organization, and is not served again until ADR-0131 C7
                // promotes it to the environment layer.
                // [#12004] The `as any` cast this call carried came off
                // when `SaveMetaItemRequestSchema` caught up with the
                // members this door sends. `saveMetaItem` is a REQUIRED
                // protocol member, so unlike the publish door's old cast
                // (member existence, TS2339) this one was load-bearing on
                // REQUEST SHAPE alone: the schema declared only
                // `{ type, name, item }`, and removing the cast surfaced
                // TS2353 on every other key. The literal is now compiled
                // against the spec contract through the commit 2a29caa53
                // `TransportScopedMetaRequest` wrapper — `environmentId`
                // is the transport-level routing key that wrapper layers
                // on, ⛔ never a protocol key; every other key here is
                // checked against the declared request, so an undeclared
                // member is a compile error instead of a payload member no
                // contract has ever seen.
                const saveRequest: TransportScopedMetaRequest<SaveMetaItemRequest> = {
                    type: req.params.type,
                    name: req.params.name,
                    item,
                    // [commit d806081dd] This door answers with an ADR-0112 error
                    // envelope that carries the refusal's `issues[]`
                    // structurally beside the message (`sendError` threads a
                    // top-level `issues`), so `saveMetaItem`'s 422 renders
                    // its findings as a headline here instead of restating
                    // the per-key prose a console would then show twice.
                    // Server-stated: this object is built field by field
                    // from named `req` values and never spreads the body, so
                    // a client cannot smuggle a face in.
                    writeFace: 'meta-envelope',
                    ...(environmentId ? { environmentId } : {}),
                    // `parentVersion` and `mode`, each only when asked —
                    // a closed two-key object read off the headers and the
                    // query, never the body.
                    ...saveOptions.request,
                    ...(actor ? { actor } : {}),
                    ...(force ? { force: true } : {}),
                    ...(packageId ? { packageId } : {}),
                };
                const result = await p.saveMetaItem(saveRequest);
                res.json(result);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'Save specific metadata item',
            tags: ['metadata'],
        },
    });

    // DELETE /meta/:type/:name - Reset metadata item to artifact default
    // Removes a customization overlay row from sys_metadata (ADR-0005).
    // Returns 200 even when no overlay existed (idempotent reset).
    registerPerItemRoute({
        method: 'DELETE',
        path: `${metaPath}/:type/:name`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                // [#7019] Same gate, same mechanism as the `PUT` twins —
                // but the argument for it is NOT the ADR-0106 round trip,
                // and saying so matters. Nothing is masked here and nothing
                // is round-tripped: this route discards a customization
                // overlay outright, so before this gate an authenticated
                // session holding no authoring capability at all could
                // reset any customized metadata item in the deployment to
                // its artifact default — and with `?dropStorage=true`, drop
                // the object's physical table with it.
                //
                // It belongs with the two PUTs because deleting a
                // customization is authoring it (ADR-0066 D1), and because
                // the fix is the same four lines — not because it is the
                // same argument.
                //
                // Gate FIRST — before the protocol is resolved — so the
                // 501-vs-200 answer leaks no kernel capability, and, the
                // point here, so the refusal happens with the overlay row
                // still intact. A gate that answers 403 after
                // `deleteMetaItem` has run would still be the bug.
                // `isSystem` bypasses, as everywhere else.
                //
                // [#12702 · ADR-0131 D6] Same shared verdict as the PUT
                // door. The reset names no organization either, so it
                // discards the environment-wide row.
                const ctx = await this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);
                {
                    const verdict = metaWriteCapabilityVerdict({
                        isSystem: ctx?.isSystem === true,
                        systemPermissions: ctx?.systemPermissions,
                        operation: 'reset',
                    });
                    if (!verdict.allowed) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: verdict.message,
                            },
                        });
                        return;
                    }
                }
                // [ADR-0131 D3 · D12 items 7–8] The walled refusal, after the
                // capability gate and before the protocol is resolved: under
                // `isolated` / `group` every organization shares the
                // environment's metadata, so only the platform operator rung
                // (or the engine itself) writes it, whatever the type. Inert
                // under `single`. See {@link walledCatalogRefusal}.
                {
                    const walled = await this.walledCatalogRefusal(req.params.type, ctx, environmentId, req);
                    if (!walled.allowed) {
                        res.status(403).json({
                            error: {
                                code: 'FORBIDDEN',
                                message: walled.message,
                            },
                        });
                        return;
                    }
                }
                const p = await this.resolveProtocol(environmentId, req);
                if (!p.deleteMetaItem) {
                    // [#7035] ADR-0112 envelope. This site was the worst of
                    // the three shapes: a BARE STRING `error`, with no code
                    // at all — so neither `err.error.code` nor `err.code`
                    // resolved, and `err.error.message` read `undefined`
                    // too. `NOT_IMPLEMENTED` is the standard-catalog code
                    // for 501 (ADR-0112; `standardErrorCodeForHttpStatus`).
                    res.status(501).json({
                        error: {
                            code: 'NOT_IMPLEMENTED',
                            message: 'Reset operation not supported by protocol implementation',
                        },
                    });
                    return;
                }
                // Mirror saveMetaItem's OCC + actor plumbing (ADR-0008
                // PR-10d wiring): `If-Match` pins the expected current
                // version so concurrent edits get a 409 instead of a
                // silent reset; the request's authenticated identity flows
                // into the history tombstone row (#7749 producer; #7941
                // dropped the `X-Actor` limb that used to outrank it).
                const ifMatchHeader = req.headers?.['if-match'] ?? req.headers?.['If-Match'];
                const parentVersion = typeof ifMatchHeader === 'string'
                    ? ifMatchHeader.replace(/^"|"$/g, '')
                    : undefined;
                // [#7749 producer, #7941 precedence] The request's authenticated
                // identity — one producer, shared by every `/meta` write (see
                // resolveMetaWriteActor). `X-Actor` is not consulted.
                const actor = await this.resolveMetaWriteActor(environmentId, req);

                // [#6877] `?state=` and the destructive `?dropStorage=`
                // both fail SAFE on an array today (the comparisons stop
                // matching), but "the wrong answer happens to be the
                // conservative one" is not a rule a caller can rely on and
                // is not what the request asked for.
                // [#22877] Recognition first, over the measured closed set.
                if (refuseUnknownQueryParams(req, res, META_ITEM_RESET_PARAMS)) return;
                if (refuseRepeatedQueryParams(req, res, ['state', 'dropStorage', 'package', META_ITEM_MEMBER_PARAM])) return;
                const stateParam = typeof req.query?.state === 'string'
                    && req.query.state.toLowerCase() === 'draft'
                    ? 'draft' as const
                    : undefined;

                // `?dropStorage=true` also tears down the object's physical
                // table (object + active only). Used by the "discard a
                // previewed object" flow so a publish-to-preview leaves no
                // orphan table. Destructive — opt-in, defaults off.
                const dropStorage = req.query?.dropStorage === 'true' || req.query?.dropStorage === '1';
                const deletePackageId = metaItemPackageBinding(req.query?.package);

                // [ADR-0131 D6] No organization, as on the `PUT` twin: the
                // reset reaches the environment-wide row.
                // [#11679] The `(p as any)` cast this call carried came off
                // when `DeleteMetaItemRequestSchema` caught up with the
                // eight members this door sends. Unlike the publish door's
                // cast (member existence, TS2339), this one was load-bearing
                // on REQUEST SHAPE: the member was declared all along, but
                // the schema declared only `{ type, name }`, so removing the
                // cast surfaced TS2353 on six keys. The literal is now
                // compiled against the spec contract through the commit 2a29caa53
                // `TransportScopedMetaRequest` wrapper — `environmentId` is
                // the transport-level routing key that wrapper layers on,
                // ⛔ never a protocol key; every other key here is checked
                // against the declared request, so an undeclared member is a
                // compile error instead of a payload member no contract has
                // ever seen. The 501 guard above stays: the member is
                // declared OPTIONAL, and the guard is what narrows it to
                // callable here.
                const deleteRequest: TransportScopedMetaRequest<DeleteMetaItemRequest> = {
                    type: req.params.type,
                    name: req.params.name,
                    ...(environmentId ? { environmentId } : {}),
                    ...(parentVersion !== undefined ? { parentVersion } : {}),
                    ...(actor ? { actor } : {}),
                    ...(stateParam ? { state: stateParam } : {}),
                    ...(dropStorage ? { dropStorage: true } : {}),
                    // [#22877] Resets ONE member of a bundled type.
                    ...metaMemberSelector(req.query),
                    // [#23165, ADR-0048] The package whose row the delete
                    // removes; `all` and an empty value name none, as on
                    // the save door, and the protocol then resolves it.
                    ...(deletePackageId ? { packageId: deletePackageId } : {}),
                };
                const result = await p.deleteMetaItem(deleteRequest);
                res.json(result);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'Reset metadata item to artifact default (deletes customization overlay)',
            tags: ['metadata'],
        },
    });
}
