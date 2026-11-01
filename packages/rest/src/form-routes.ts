// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 11] The public (anonymous) form routes of `RestServer` —
 * `GET {basePath}/forms/:slug`, which resolves a form its author opened to
 * anonymous intake, and `POST {basePath}/forms/:slug/submit`, which inserts a
 * record through it — moved out of `rest-server.ts` whole. `registerRoutes`
 * calls the registrar once for each base it mounts, under no switch of its
 * own, and before the greedy `/data/:object` matcher.
 *
 * A MOVE, not a redesign. The function below is the body of
 * `RestServer#registerFormEndpoints` as it stood, re-indented one level: the
 * same two routes, registered in the same order, by the same handlers,
 * answering the same bodies, with the one form resolution
 * (`resolveFormBySlug`) still shared by both doors. Which forms are open is
 * still the one rule `@objectstack/metadata-core` owns, imported here under the
 * same names.
 *
 * ## How the moved body reaches the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps the private method —
 * the published `dist/*.d.ts` lists its name, docblock and position — and the
 * body is one host literal ({@link FormRouteHost}) plus `.call(host, basePath)`.
 * A method is handed over as a closure that calls it on the server at call
 * time, so a test double or spy set on the server is still the one the body
 * reaches.
 *
 * Each member was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE. The body reads it only for its two
 *   `register` calls, which run while registration runs, and the class's one
 *   `routeManager` reassignment wraps `registerMetadataEndpointsInner`, never
 *   this registrar.
 * - No member goes as a getter, because the body reads no FIELD at request
 *   time. The protocol, the tenancy service, the object definitions, the i18n
 *   service, its bundle and locale, and the packaged base are each resolved
 *   per request by a METHOD of the class, and every method goes as a closure.
 *   No provider field is read either, so the provider ruling has nothing to
 *   apply to here.
 *
 * ## The two tokens that are not byte-identical
 *
 * The resolve door translates the served object schema and the form's section
 * headings with options from the class's PRIVATE STATIC `translateOptionsFor`,
 * which it used to call as `RestServer.translateOptionsFor(…)`, twice. A
 * private static is reachable by name only inside the class, so that spelling
 * does not compile here, and making the member public, or moving it, changes
 * the published declaration the move must keep byte-identical. So both calls
 * reach it the way every other class member this body reads is reached:
 * through the host, as `this.translateOptionsFor(…)`, a closure on
 * {@link FormRouteHost} that calls `RestServer.translateOptionsFor` with the
 * same two arguments. The static reads nothing but its arguments, so the
 * receiver is the whole difference, as it was for slice 7's
 * `overlayDocumentationInfo`. Those two receivers are the only tokens of the
 * body that changed.
 *
 * Module-level names stay where they are declared. The meta doors' request
 * envelope `TransportScopedMetaRequest` is imported from
 * `meta-collection-routes.ts`, where slice 13a moved it on from `ui-routes.ts`
 * (slice 10's home for it), and the data doors' `ServerScopedDataRequest` from
 * `data-action-routes.ts`, where slice 1 moved it. `anonymousFormIntakeWithdrawnIn`,
 * `PUBLIC_FORM_SERVER_MANAGED_FIELDS` and `isExpectedRouteError`, which only
 * this body read, are imported here instead of there. No export was added
 * anywhere, and the published surface does not move.
 */

import {
    anonymousFormIntakeCandidates,
    anonymousFormIntakePosture,
    anonymousFormIntakeUnavailability,
    anonymousFormIntakeWithdrawnIn,
    anonymousFormObjectName,
} from '@objectstack/metadata-core';
import { isEmptyForRequired, isMissing } from '@objectstack/core';
import type { CreateDataRequest, GetMetaItemsRequest, PublicFormSubmitResponse } from '@objectstack/spec/api';
import { PUBLIC_FORM_SERVER_MANAGED_FIELDS } from '@objectstack/spec/security';
import { renderValidationMessage } from '@objectstack/spec/system';
import { thankYouRecordFieldNames } from '@objectstack/spec/ui';
import { validationFailure } from '@objectstack/types';
import { FILE_REFERENCE_TYPES, RUNTIME_OWNED_FIELD_TYPES } from '@objectstack/spec/data';
import type { ServerScopedDataRequest } from './data-action-routes.js';
import { isExpectedRouteError, mapDataError } from './error-response.js';
import { logError } from './log.js';
import type { TransportScopedMetaRequest } from './meta-collection-routes.js';
import type { RestServer } from './rest-server.js';

/**
 * The `RestServer` members {@link registerFormEndpoints} reads — every one of
 * them, and no other, in the order the body first reads them. Each is typed AS
 * the class member (an indexed access on the class), so a change to a member's
 * signature on the class is a change here too, and naming a member the class
 * does not have is a compile error. `translateOptionsFor` is the class's
 * private STATIC, typed as the static it is. The module header says why the
 * body reaches it through the host, and why none of the members is a getter.
 */
export interface FormRouteHost {
    resolveProtocol: RestServer['resolveProtocol'];
    resolveAnonymousFormTenancy: RestServer['resolveAnonymousFormTenancy'];
    readFormObjectDefinitions: RestServer['readFormObjectDefinitions'];
    readonly routeManager: RestServer['routeManager'];
    resolveI18nService: RestServer['resolveI18nService'];
    buildTranslationBundle: RestServer['buildTranslationBundle'];
    extractLocale: RestServer['extractLocale'];
    translateOptionsFor: (typeof RestServer)['translateOptionsFor'];
    packagedObjectBase: RestServer['packagedObjectBase'];
}

/**
 * [#28005, ruling B] The `fields` of the public submit answer: the stored value
 * of each name the form's `thank-you` panel interpolates
 * (`thankYouRecordFieldNames`), keyed by name, or `undefined` when none
 * survives (the answer is then `{ id }` alone).
 *
 * A name survives only when, at answer time, its field is declared on the
 * object with a type in `RUNTIME_OWNED_FIELD_TYPES` (today `autonumber`): a
 * value the ENGINE generated on insert. Any other stored value may have been
 * set by a `beforeInsert` / `afterInsert` hook, an elevated one included, from
 * records the anonymous form grant cannot read. The authoring rule
 * `thank-you-record-field` refuses such a name at publish; this re-check covers
 * an object retyped after the form was published, and a name that is no field
 * at all (a system column, an undeclared name, a prototype key).
 *
 * The value is read off the row `createData` answered — already stripped of
 * `internal: true` fields and masked for the grant — never by a second read. A
 * name the row does not carry, or carries as anything but a string or a number,
 * is dropped, never answered as `null`.
 */
function thankYouAnswerFields(
    names: readonly string[],
    objectDef: any,
    record: unknown,
): Record<string, string | number> | undefined {
    const declared = objectDef?.fields;
    if (!declared || typeof declared !== 'object' || !record || typeof record !== 'object') return undefined;
    const fields: Record<string, string | number> = {};
    let kept = 0;
    for (const name of names) {
        // A name that is no declared field (a system column, a prototype key
        // such as `constructor`) has no string `type` here: dropped.
        const type = declared[name]?.type;
        if (typeof type !== 'string' || !RUNTIME_OWNED_FIELD_TYPES.has(type)) continue;
        // Absent (masked, stripped, never generated), `null`, or any other
        // shape: dropped.
        const value = (record as Record<string, unknown>)[name];
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        fields[name] = value;
        kept += 1;
    }
    return kept > 0 ? fields : undefined;
}

/**
 * Register the public (anonymous) form endpoints —
 * `RestServer#registerFormEndpoints`' body, called by that method with the
 * server as `this`. The method's own docblock, which the published declaration
 * carries, names the two routes and what authorizes them.
 */
export function registerFormEndpoints(this: FormRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');

    // Which form candidates are open to anonymous intake is ONE rule,
    // shared with the write-time judgement in `@objectstack/metadata-protocol`
    // (`anonymousFormIntakeCandidates`): `sharing.enabled === true`,
    // `sharing.allowAnonymous === true` and a `publicLink` naming the slug.
    //
    // A withdrawal is a kill switch: layering may only narrow anonymous
    // intake, never re-open it. [#28409, ADR-0146 D8] The doors offer the
    // forms of the ONE effective read — the environment's list
    // (environment → code) as every door that serves a view name serves it:
    // one item per name a code package ships, that package's declared
    // override where one is stored. They judge every candidate's withdrawal
    // against a layer never narrower than the one they judged before: that
    // same list beside the per-package layer
    // (`ObjectStackProtocolImplementation.getMetaItemsPerPackage`), which
    // still holds one item per package of a view name and the base's own
    // document under its override (the hard requirement ruled on #28238,
    // option 3). A candidate is served only when no body of its view name
    // in that layer explicitly withdraws the same form
    // (`anonymousFormIntakeWithdrawnIn`: matched by slot or by slug, the
    // link kept with a switch set to `false`), so a withdrawal in one
    // package closes the name's form in every package (a known limit that
    // fails closed). Another view publishing the same slug is a different
    // form and closes nothing.
    //
    // A form only a body the effective read no longer serves offered — a
    // dependent package's same-named row, the base's form the override
    // removed — is not offered: that narrows intake, the direction a layer
    // may take.
    const findPublicFormView = (
        views: any[],
        withdrawalLayer: any[],
        slug: string,
    ): { view: any; form: any; object: string } | null => {
        for (const view of views ?? []) {
            if (!view || typeof view !== 'object') continue;
            for (const c of anonymousFormIntakeCandidates(view)) {
                if (c.slug !== slug) continue;
                if (anonymousFormIntakeWithdrawnIn(withdrawalLayer, view, c)) continue;
                const objectName = anonymousFormObjectName(view, c.form);
                if (!objectName) continue;
                return { view, form: c.form, object: objectName };
            }
        }
        return null;
    };

    // [ADR-0131 D6, C7] WHICH metadata an anonymous form request reads:
    // the environment's, like every other metadata read. Until v18 the
    // `view` read also kept the Default Organization's legacy layer, so an
    // organization's withdrawal still closed the form. The v18 ceremony
    // (`os migrate organization-ownership --apply`, its metadata-promotion
    // step) carries every organization-layer withdrawal onto the
    // environment, fail-closed (rulings A on #22008 and #22011), and that
    // read is deleted with it.
    //
    // The tenancy service is still read: it answers the posture the
    // intake-availability rule judges (#21476).
    //
    // Asked ONCE per request, in `resolveFormBySlug`. Every door below
    // reads the form through that one resolution, so no door keeps its
    // own copy of "is this form public" — nor, since #21476, of "can it
    // take intake on this posture", which the same tenancy read answers.
    //
    // Fails CLOSED. A tenancy service that is registered but cannot be
    // reached raises `AuthzStoreUnavailableError`, the classification
    // `classifyAdmissionTenancyPosture` applies to the same seam. The
    // door then refuses instead of judging intake without a posture.
    // Only the registry's own "never registered" brand reads as the
    // supported no-tenancy composition. The wiring mirrors
    // `resolveProtocol`, so the tenancy service and the protocol always
    // come from the same kernel.
    const resolveFormBySlug = async (
        environmentId: string | undefined,
        req: any,
        slug: string,
    ): Promise<{ view: any; form: any; object: string } | null> => {
        const p = await this.resolveProtocol(environmentId, req);
        if (typeof (p as any).getMetaItems !== 'function') return null;
        const tenancy = await this.resolveAnonymousFormTenancy(environmentId, req);
        const viewsRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
            type: 'view',
            ...(environmentId ? { environmentId } : {}),
        };
        const listOf = (result: any): any[] => (Array.isArray(result?.items)
            ? result.items
            : Array.isArray(result)
                ? result
                : []);
        const items = listOf(await p.getMetaItems(viewsRequest));
        // [#28409] The per-package layer, where the protocol serves one: a
        // server-only extension, feature-detected like the other extensions
        // the doors read. A protocol without it serves no narrower list than
        // the one it lists, which is then the whole layer.
        const perPackage = typeof (p as any).getMetaItemsPerPackage === 'function'
            ? listOf(await (p as any).getMetaItemsPerPackage(viewsRequest))
            : [];
        const match = findPublicFormView(items, [...items, ...perPackage], slug);
        if (!match) return null;
        // [#21476] A form that cannot take intake on this posture is not
        // offered: `null` here IS the withdrawn form's answer on both
        // doors, so an anonymous caller learns nothing about the tenancy.
        const unavailable = await anonymousFormIntakeUnavailability(
            match.object,
            anonymousFormIntakePosture(tenancy),
            async () => (await this.readFormObjectDefinitions(p, environmentId))
                .find((o: any) => o?.name === match.object),
        );
        return unavailable ? null : match;
    };

    // GET /forms/:slug — resolve and return the public form spec
    this.routeManager.register({
        method: 'GET',
        path: `${basePath}/forms/:slug`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const slug = String(req.params?.slug ?? '').trim();
                if (!slug) {
                    res.status(400).json({ code: 'INVALID_REQUEST', error: 'slug is required' });
                    return;
                }
                const match = await resolveFormBySlug(environmentId, req, slug);
                if (!match) {
                    res.status(404).json({
                        code: 'FORM_NOT_FOUND',
                        error: `No public form configured at /forms/${slug}`,
                    });
                    return;
                }
                // Embed the target object's schema — limited to exactly the
                // fields the form's sections DECLARE — so anonymous
                // front-ends can render the form without a separate,
                // auth-protected meta lookup.
                //
                // [#6601] "Exactly" is load-bearing and used not to be. The
                // narrowing read `allowed.size === 0 || allowed.has(name)`,
                // so a form with no sections (or sections declaring no
                // fields) fell through to EVERY non-server-managed field of
                // the object — published to an ANONYMOUS caller, with
                // labels, types, picklist option values and formula
                // expressions. A form created before its sections are wired
                // is an ordinary authoring mid-state, so that was reachable
                // without an exotic configuration, and this comment claimed
                // the opposite. Publication is a DECLARATION now: declare no
                // fields and nothing is published (AGENTS.md "Explicit
                // composition over default magic").
                //
                // Do NOT reach for the submit handler as the backstop here.
                // It enforces a field whitelist on WRITES, which cannot
                // bound a READ disclosure — and when #6601 landed, its own
                // accepted set still degenerated identically for a
                // section-less form (`allowedFields.size === 0 ||`), so
                // narrowing this schema to "what submit would accept" would
                // have republished precisely the set being removed. #6920
                // has since closed that write-side twin, so the two planes
                // now agree — but they agree by each enforcing the
                // declaration itself, NOT by one deferring to the other.
                let objectSchema: any = null;
                // [#23497] The form served below: the matched form, with its
                // sections' `label` / `description` localized beside the
                // schema's field labels (see the translation block).
                let servedForm: any = match.form;
                // The top-level `label`, served from the TRANSLATED view
                // when the view authors one (see the translation block). A
                // view that authors none keeps the route's own reading, so
                // the console's `label ?? form.title ?? objectSchema.label`
                // still reaches the form's (translated) title.
                let servedLabel: any = match.view?.label ?? match.form?.label;
                try {
                    const p = await this.resolveProtocol(environmentId, req);
                    if (typeof (p as any).getMetaItems === 'function') {
                        // [#21331] The environment's object schema, as
                        // every object read is (ADR-0131 D6).
                        const objectsRequest: TransportScopedMetaRequest<GetMetaItemsRequest> = {
                            type: 'object',
                            ...(environmentId ? { environmentId } : {}),
                        };
                        const r: any = await p.getMetaItems(objectsRequest);
                        const items: any[] = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
                        const obj = items.find((o: any) => o?.name === match.object);
                        if (obj && obj.fields && typeof obj.fields === 'object') {
                            const allowed = new Set<string>();
                            for (const sec of match.form?.sections ?? []) {
                                for (const f of sec?.fields ?? []) {
                                    if (typeof f === 'string') allowed.add(f);
                                    else if (f?.field) allowed.add(f.field);
                                }
                            }
                            const fields: Record<string, any> = {};
                            for (const [name, def] of Object.entries(obj.fields)) {
                                // [#3022] Server-managed anchors are never
                                // renderable/writable on the anonymous form
                                // surface — the submit route refuses them, so
                                // don't advertise them here even when a form
                                // (mis)declares one in a section.
                                if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(name)) continue;
                                // [#6601] Declared or not published. An empty
                                // `allowed` yields an empty `fields`.
                                if (!allowed.has(name)) continue;
                                fields[name] = def;
                            }
                            objectSchema = { name: obj.name, label: obj.label, fields };
                            // Localize labels / help text / option labels so anonymous
                            // clients render in the visitor's preferred language.
                            // `resolveFormBySlug` returns the raw view spec, so both
                            // halves of the payload are hydrated here: the schema, and
                            // the form's section headings ([#23497], below).
                            try {
                                const i18n = await this.resolveI18nService(environmentId, req);
                                const bundle = this.buildTranslationBundle(i18n);
                                const locale = this.extractLocale(req, i18n);
                                if (bundle && locale) {
                                    const { translateMetadataDocument } = await import('@objectstack/spec/system');
                                    // [#8284] Same rule as the two `/meta/object`
                                    // reads: the catalog yields to a scalar the
                                    // package's own extension or the tenant
                                    // authored. The public form must not be the
                                    // one surface still serving the packaged
                                    // string back at a tenant who renamed it.
                                    objectSchema = translateMetadataDocument('object', objectSchema, bundle, {
                                        ...this.translateOptionsFor(i18n, locale),
                                        packagedBase: this.packagedObjectBase(p, 'object', objectSchema?.name),
                                    });
                                    // [#23497] The section headings. An anonymous
                                    // visitor cannot load the bundle client-side (the
                                    // `/i18n` domain answers it 401), so a section's
                                    // `objects.OBJECT._sections.NAME` copy reaches it
                                    // here or not at all. ONE call into the spec's view
                                    // translator, which owns every rule: the key is the
                                    // section's `name` (a nameless section is returned
                                    // as authored), a missing key keeps the authored
                                    // text, only authored copy is translated, and an
                                    // explicit override beats the catalog against the
                                    // packaged view, handed over exactly as the object
                                    // call above hands its own base. ⛔ No walk of
                                    // `_sections` and no locale chain here.
                                    //
                                    // The protocol's view list serves view ITEMS only
                                    // (a container is dropped and served as the
                                    // `viewKind: 'form'` items it expands to), so the
                                    // matched form is the item's `config`, the address
                                    // `translateView` translates sections at. A form
                                    // matched in any other slot is served as matched,
                                    // never swapped for the item's `config`. It runs
                                    // BEFORE the strip below and returns each section's
                                    // `fields` untouched, so it cannot re-introduce a
                                    // stripped field. The same call translates the
                                    // form's `title` (`objects.OBJECT._views.VIEW.title`,
                                    // at `config.title`), so the served form carries it.
                                    //
                                    // The top-level `label` is taken from the translated
                                    // view only when the view AUTHORS one: the translator
                                    // falls back to the view's machine name, which must
                                    // never shadow the form's title in the console's
                                    // `label ?? form.title ?? objectSchema.label`.
                                    const view = translateMetadataDocument('view', match.view, bundle, {
                                        ...this.translateOptionsFor(i18n, locale),
                                        packagedBase: this.packagedObjectBase(p, 'view', match.view?.name),
                                    });
                                    if (match.form === match.view?.config) servedForm = view?.config;
                                    if (match.view?.label !== undefined && view?.label !== undefined) {
                                        servedLabel = view.label;
                                    }
                                }
                            } catch (e: any) {
                                logError('[REST] Public form schema translation failed:', e);
                            }
                        }
                    }
                } catch (e: any) {
                    logError('[REST] Public form schema load failed:', e);
                }
                // Anonymous public forms NEVER include a lookup, master-detail
                // or user field. [#21180] This used to be an opt-in — a
                // per-field picker block on the section entry kept the field
                // and opened an anonymous record-search route for it. Ruling
                // E on #21079 (comment 5933054144) retired the picker and
                // deleted that route, so the strip below is now
                // unconditional: no declaration can put record search on the
                // internet through a public form.
                const safeForm = (() => {
                    if (!servedForm || !Array.isArray(servedForm.sections)) return servedForm;
                    const allow = (name: string): boolean => {
                        // [#3022] A declared server-managed anchor (e.g. a
                        // FormView listing `owner_id`) is a spec mistake —
                        // drop it from the rendered sections so the form
                        // never collects a value the submit route refuses.
                        if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(name)) return false;
                        const def = objectSchema?.fields?.[name];
                        const t = def?.type;
                        // `user` is a lookup specialized to sys_user — same risk as a
                        // raw lookup: surfacing it on an anonymous public form would
                        // expose unrestricted user search to the internet.
                        return t !== 'lookup' && t !== 'master_detail' && t !== 'user';
                    };
                    const sections = servedForm.sections.map((sec: any) => {
                        const fields = (sec?.fields ?? []).filter((f: any) => {
                            const name = typeof f === 'string' ? f : f?.field;
                            if (!name) return false;
                            return allow(name);
                        });
                        return { ...sec, fields };
                    });
                    return { ...servedForm, sections };
                })();
                res.header('Vary', 'Accept-Language');
                res.json({
                    slug,
                    object: match.object,
                    label: servedLabel,
                    form: safeForm,
                    objectSchema,
                });
            } catch (error: any) {
                logError('[REST] Public form resolve error:', error);
                res.status(500).json({
                    code: 'FORM_RESOLVE_FAILED',
                    error: String(error?.message ?? error ?? 'resolve failed').slice(0, 500),
                });
            }
        },
        metadata: {
            summary: 'Resolve a public form spec by slug (anonymous)',
            tags: ['forms', 'public'],
        },
    });

    // POST /forms/:slug/submit — INSERT a record on the target object,
    // authorized by the form's own declaration (`publicFormGrant`, below).
    this.routeManager.register({
        method: 'POST',
        path: `${basePath}/forms/:slug/submit`,
        handler: async (req: any, res: any) => {
            try {
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const slug = String(req.params?.slug ?? '').trim();
                if (!slug) {
                    res.status(400).json({ code: 'INVALID_REQUEST', error: 'slug is required' });
                    return;
                }
                const match = await resolveFormBySlug(environmentId, req, slug);
                if (!match) {
                    res.status(404).json({
                        code: 'FORM_NOT_FOUND',
                        error: `No public form configured at /forms/${slug}`,
                    });
                    return;
                }

                // Only allow the fields declared on the matched FormView.
                // This prevents a public visitor from stuffing privileged
                // columns (owner_id, status, internal_notes, …) into the
                // row. What the form does not collect, the object fills: a
                // field's `defaultValue` (`crm_lead.status` in
                // `examples/app-crm`) or, on a select that declares none, its
                // `default: true` option; or a `beforeInsert` hook where the
                // value needs logic (`StampInquiryDefaultsHook` in
                // `examples/app-showcase/src/data/hooks/index.ts`).
                const allowedFields = new Set<string>();
                // [#24131] …and, off the SAME entries, the fields the form
                // requires the visitor to fill: an entry declaring
                // `required: true` that the form shows unconditionally. See
                // the refusal below for why a hidden or conditionally visible
                // entry is not judged here.
                const requiredFields: string[] = [];
                // [#27606] …and the `options` subset each field's entries offer:
                // the union of every entry that lists `options`. An entry that
                // lists none (or a bare-string entry) offers the object's full
                // set, so it marks the field `null`, not narrowed, whatever
                // another entry lists. See the refusal below.
                const optionSubsets = new Map<string, Set<string> | null>();
                for (const section of match.form?.sections ?? []) {
                    const sectionConditional = section?.visibleWhen != null;
                    for (const f of section?.fields ?? []) {
                        if (typeof f === 'string') {
                            allowedFields.add(f);
                            optionSubsets.set(f, null);
                        } else if (f?.field) {
                            allowedFields.add(f.field);
                            const offered = Array.isArray(f.options) && f.options.length > 0 ? f.options : null;
                            const sofar = optionSubsets.get(f.field);
                            if (offered === null || sofar === null) {
                                optionSubsets.set(f.field, null);
                            } else {
                                const subset = sofar ?? new Set<string>();
                                for (const o of offered) {
                                    // A bare-string option is its own value, as the engine's
                                    // and the console's option readers take it.
                                    const v = typeof o === 'string' ? o : o?.value;
                                    if (v !== undefined && v !== null) subset.add(String(v));
                                }
                                optionSubsets.set(f.field, subset);
                            }
                            if (
                                f.required === true
                                && f.hidden !== true
                                && f.visibleWhen == null
                                && !sectionConditional
                                && !requiredFields.includes(f.field)
                            ) requiredFields.push(f.field);
                        }
                    }
                }
                // [#6920] A form that declares NO fields collects nothing, so
                // it has nothing to accept — refuse instead of inserting.
                //
                // The filter below used to read
                // `allowedFields.size === 0 || allowedFields.has(k)`, and that
                // fall-through was not "accept every field of the object": it
                // accepted every KEY THE CALLER SENT, minus the anchors and the
                // three prototype keys — measured as
                // `["email","internal_margin","internal_tier","not_even_a_field",
                // "status","subject"]` on a `sections: []` form, `not_even_a_field`
                // not being a field of the object at all. On an ANONYMOUS surface
                // that is unbounded mass assignment across the target object, and
                // the form created-before-its-sections-are-wired mid-state reaches
                // it without anything exotic.
                //
                // Symmetric with #6601 on the read side of the same pair: declare
                // it or it is not published / not accepted, one rule on both planes
                // (AGENTS.md "Explicit composition over default magic"). Post-#6601
                // such a form publishes `fields: {}`, so no legitimate client can
                // even learn what to send here.
                //
                // REFUSAL, not a silent discard: dropping the keys would leave the
                // `201` intact while swallowing data the caller believes it wrote —
                // exactly the silence AGENTS.md's warn-vs-error rule forbids. The
                // author's fix is to wire the sections, so the message says that;
                // the code is the standard ADR-0112 catalog's generic 400
                // (`HttpStatusErrorCodeMap[400]`), not a minted synonym, and the
                // message names no object, field or slug — this reply is readable
                // by anyone on the internet.
                //
                // NOTE the #3022 pin ('zero declared sections: business fields fall
                // through, anchors do NOT') asserted this fall-through as intended.
                // Re-judged by maintainer ruling 5229989845 (2026-08-09): the
                // anchor half is preserved and still pinned; the fall-through half
                // was the wrong invariant.
                if (allowedFields.size === 0) {
                    res.status(400).json({
                        code: 'VALIDATION_ERROR',
                        error: 'This form declares no fields, so it cannot accept a submission. '
                            + "Wire the fields it collects into the form's sections and publish it again.",
                    });
                    return;
                }
                // [#3022] System-managed anchors (owner_id, organization_id,
                // audit columns, id, …) are NEVER client-suppliable on this
                // anonymous surface, even when a FormView explicitly declares
                // one in a section (the insert-forge of #3004, with no
                // credentials at all). The SecurityPlugin's publicFormGrant
                // branch strips the same set at the data layer, so this filter
                // and the engine boundary cannot drift.
                const rawBody = (req.body && typeof req.body === 'object') ? req.body : {};
                const filteredData: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(rawBody)) {
                    if (PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(k)) continue;
                    // JSON.parse yields `__proto__` as an OWN key; assigning it
                    // here would REPLACE filteredData's prototype and smuggle
                    // inherited anchors past every own-property check downstream.
                    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
                    if (allowedFields.has(k)) filteredData[k] = v;
                }

                // ADR-0056 (Option A): authorization DERIVED from the declared
                // form — a narrow create grant scoped to exactly this form's target
                // object. The SecurityPlugin honors `publicFormGrant` (create + the
                // immediate read-back, that object ONLY) before it resolves any
                // permission set, so public forms work under secure-by-default
                // (anonymous-deny) whether or not the deployment registers a
                // `guest_portal` set, and no set's object bits widen or narrow
                // this insert.
                //
                // `permissions: ['guest_portal']` admits nothing. It names the set
                // the SecurityPlugin resolves for this caller: where a deployment
                // registers one under that name, the grant's result masker reads
                // that set's field permissions (and the capabilities it holds
                // against a field's `requiredPermissions`) over what the grant
                // hands back; where none is registered, it resolves to no set and
                // the masker reads the zero-set posture. ADR-0138 records the name
                // (fate: keep). The answer below is the created id only (#22437),
                // so the masked record never reaches the visitor through this door.
                //
                // Neither `permissions` nor `anonymous` reaches an object hook:
                // the engine builds `ctx.session` and `ctx.user` without either
                // key. With no `userId` here, `ctx.user` is unset, so a hook sees
                // this submission as a write with no user, like any other.
                const context: any = {
                    publicFormGrant: { object: match.object },
                    permissions: ['guest_portal'],
                    anonymous: true,
                };

                const p = await this.resolveProtocol(environmentId, req);

                // [#24131] The form's own `required`, enforced BEFORE the write.
                // The engine judges only the fields the OBJECT requires, so a
                // field the form requires and the object does not used to be
                // stored empty with a `201` — while the rendered form refused
                // the same submission. This door is exactly the one a script or
                // bot uses without the rendered form.
                //
                // - ONE emptiness rule: `isEmptyForRequired` from
                //   `@objectstack/core`, the rule the engine's object-level check
                //   runs (absent, `null`, a blank string, and `[]` where the
                //   declared value is a set). Judged on what this door WRITES
                //   (`filteredData`), so an object default or a hook stamp does
                //   not satisfy a field the visitor omitted.
                // - ONE envelope: thrown as `validationFailure`, so the catch's
                //   `mapDataError` arm answers the flat `400 VALIDATION_FAILED`
                //   with `fields[]` the object-level refusal answers on this
                //   route, worded by the same catalog (`renderValidationMessage`,
                //   `required`) and naming the field by the object's label.
                // - Judged only where the form ASKS: an entry that is
                //   `hidden: true`, or carries a `visibleWhen` on itself or its
                //   section, is not judged — nothing server-side evaluates a
                //   form-view `visibleWhen`, and judging it unconditionally would
                //   refuse a submission whose visitor was never shown the field.
                //   A server-managed anchor is never written by this door, so it
                //   is never judged either.
                const judged = requiredFields.filter((name) =>
                    !PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(name)
                    && name !== '__proto__' && name !== 'constructor' && name !== 'prototype');
                // [#25572, ruling C (record 6384525042)] An anonymous public-form
                // submission carries no file. A value in a field whose declared
                // type is a file type (`FILE_REFERENCE_TYPES`) is refused, naming
                // the field, before anything is written; an empty or absent file
                // field submits as before. A file is provided by a signed-in
                // caller, through the authenticated upload doors; this door has
                // none, by that ruling, and a guest-facing form that declares a
                // file field is refused at publish (the protocol half, #25650).
                // Forms published before that refusal existed are why the door
                // judges it too.
                //
                // - Judged on what this door WRITES (`filteredData`): only the
                //   fields the form declares, which `GET /forms/:slug` already
                //   publishes, so the refusal names nothing the form does not.
                // - The same emptiness rule as `required` (`isEmptyForRequired`).
                // - ONE envelope with the `required` judgement above: both are
                //   collected into one `validationFailure`, the flat
                //   `400 VALIDATION_FAILED` with `fields[]`, so a submission with
                //   both problems is told both at once. The field code is the
                //   closed ADR-0114 catalog's `invalid_value`.
                // [#27606] A value outside the `options` subset a form entry
                // offers is refused, naming the field, before anything is
                // written. `GET /forms/:slug` serves that subset; the engine
                // judges a value against the OBJECT's options only, so this door
                // stored a member the form never offered (a guest filing a
                // `critical` case through a form that offers up to `high`).
                //
                // - Judged on what this door WRITES, with the same emptiness
                //   rule as `required`: an empty or absent value is not judged.
                // - A multi-valued value is judged element by element, the first
                //   outside element named, as the engine judges the object's set.
                // - The same envelope again, with the closed catalog's
                //   `invalid_option`, worded by the catalog (`invalid_option`,
                //   or `invalid_option_value` for an element). The allowed values
                //   it names are the subset's only, which the form publishes.
                // - A field no entry narrows keeps the object's full set, judged
                //   by the engine as before.
                // The declared fields this submission carries a value in: the
                // only ones the file and subset judgements can refuse, so a
                // submission that carries none reads no object declarations for
                // them.
                const valued = [...allowedFields].filter((name) =>
                    Object.prototype.hasOwnProperty.call(filteredData, name)
                    && !isMissing(filteredData[name]));
                // The target object's declaration, read at most once per
                // submission: by the judgements below, and by the answer's
                // thank-you fields after the write.
                let objectDefRead: Promise<any> | undefined;
                const readObjectDef = (): Promise<any> => (objectDefRead ??= this
                    .readFormObjectDefinitions(p, environmentId)
                    .then((defs) => defs.find((o: any) => o?.name === match.object)));
                if (judged.length > 0 || valued.length > 0) {
                    const objectDef = await readObjectDef();
                    const labelOf = (def: any, name: string): string => {
                        const declared = typeof def?.label === 'string' ? def.label.trim() : '';
                        return declared.length > 0 ? declared : name;
                    };
                    const refused: Array<{
                        field: string;
                        code: 'required' | 'invalid_value' | 'invalid_option';
                        message: string;
                        label: string;
                        constraint?: Record<string, unknown>;
                        value?: string;
                    }> = [];
                    for (const name of judged) {
                        const def = objectDef?.fields?.[name];
                        const value = Object.prototype.hasOwnProperty.call(filteredData, name)
                            ? filteredData[name]
                            : undefined;
                        const empty = def && typeof def.type === 'string'
                            ? isEmptyForRequired(def, value)
                            : isMissing(value);
                        if (!empty) continue;
                        const label = labelOf(def, name);
                        refused.push({
                            field: name,
                            code: 'required',
                            message: renderValidationMessage({ messageKey: 'required', label, field: name, params: {} }),
                            label,
                        });
                    }
                    for (const name of valued) {
                        const def = objectDef?.fields?.[name];
                        if (!def || typeof def.type !== 'string' || !FILE_REFERENCE_TYPES.has(def.type)) continue;
                        if (isEmptyForRequired(def, filteredData[name])) continue;
                        const label = labelOf(def, name);
                        refused.push({
                            field: name,
                            code: 'invalid_value',
                            message: `${label} cannot take a file here: an anonymous public-form submission carries no file. `
                                + 'Leave it empty, or sign in and provide the file from your account.',
                            label,
                        });
                    }
                    for (const name of valued) {
                        const subset = optionSubsets.get(name);
                        // A subset that collected no values narrows nothing (fail
                        // open to the engine's judgement, never refuse every value).
                        if (!subset || subset.size === 0) continue;
                        const def = objectDef?.fields?.[name];
                        const value = filteredData[name];
                        const empty = def && typeof def.type === 'string'
                            ? isEmptyForRequired(def, value)
                            : isMissing(value);
                        if (empty) continue;
                        const elements = Array.isArray(value) ? value : [value];
                        const outside = elements.findIndex((v) => !subset.has(String(v)));
                        if (outside < 0) continue;
                        const allowed = [...subset].join(', ');
                        const label = labelOf(def, name);
                        refused.push({
                            field: name,
                            code: 'invalid_option',
                            message: Array.isArray(value)
                                ? renderValidationMessage({
                                    messageKey: 'invalid_option_value',
                                    label,
                                    field: name,
                                    params: { allowed, value: String(elements[outside]) },
                                })
                                : renderValidationMessage({ messageKey: 'invalid_option', label, field: name, params: { allowed } }),
                            label,
                            constraint: { allowed },
                            // The offending element, as the engine's multi-valued
                            // `invalid_option` ships it; its single-value arm ships none.
                            ...(Array.isArray(value) ? { value: String(elements[outside]) } : {}),
                        });
                    }
                    if (refused.length > 0) {
                        throw validationFailure(refused.map((f) => f.message).join('; '), refused);
                    }
                }

                const formCreateRequest: ServerScopedDataRequest<CreateDataRequest> = {
                    object: match.object,
                    data: filteredData,
                    ...(environmentId ? { environmentId } : {}),
                    context,
                };
                const result = await p.createData(formCreateRequest);
                // [#22437] The answer is the created record's id, and
                // nothing else the insert stored. `createData` answers
                // `{ object, id, record, droppedFields? }`, and its `record`
                // is the row as stored AFTER the insert pipeline: defaults,
                // and whatever a `beforeInsert` / `afterInsert` hook stamped
                // — including a value an elevated (`runAs: 'system'`) hook
                // derived from existing records this anonymous caller's
                // grant may never read. The whitelist above filters what the
                // caller WRITES; this answer is what filters what it is SHOWN.
                // The caller already knows what it submitted, so the one
                // fact it lacks is the id. Projecting the row to the form's
                // declared fields would not do: a hook may rewrite a
                // declared field too. The key stays the top-level `id` of a
                // bare body — where the console's public form page reads
                // the created id — and no second read builds this answer.
                //
                // [#28005, ruling B] The one widening: the values the form's
                // `thank-you` panel names as `{{record.field_name}}`, under
                // `fields` (`PublicFormSubmitResponseSchema`) — a web-to-case
                // visitor's case number. See `thankYouAnswerFields` for which
                // names survive to the answer.
                const answer: PublicFormSubmitResponse = { id: result.id };
                const named = thankYouRecordFieldNames(match.form?.submitBehavior);
                if (named.length > 0) {
                    const fields = thankYouAnswerFields(named, await readObjectDef(), result.record);
                    if (fields) answer.fields = fields;
                }
                res.status(201).json(answer);
            } catch (error: any) {
                const mapped = mapDataError(error);
                // Distinct message (this is not the "unhandled" channel),
                // same shared verdict — see `isExpectedRouteError`.
                if (!isExpectedRouteError(mapped.status, mapped.body)) {
                    logError('[REST] Public form submit error:', error);
                }
                res.status(mapped.status).json(mapped.body);
            }
        },
        metadata: {
            summary: 'Submit an anonymous public form',
            tags: ['forms', 'public'],
        },
    });
}
