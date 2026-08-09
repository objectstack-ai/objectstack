// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The composition step that mounts `@objectstack/rest`'s direct-mount
 * registrars and records what they mounted (#5822).
 *
 * ## Why this is a module and not four blocks inside `rest-api-plugin.ts`
 *
 * It is the one place that knows WHICH registrars bypass `RouteManager` and
 * under which conditions each is called. Before #5822 that knowledge existed
 * twice: once in the plugin's `start()`, and once — copied by hand — in
 * `rest-route-ledger.conformance.test.ts`, which re-invoked the two registrars
 * against a mock server to enumerate them. A third registrar added to the
 * plugin would have been mounted, undocumented and unguarded, with every test
 * still green. Now the guard drives THIS function, so the set of registrars is
 * declared once and the ledger sees whatever production mounts.
 *
 * ## The honesty contract, in both directions
 *
 * Each registrar returns the array it iterated to mount, and that array is what
 * gets recorded on the `RestServer`. So:
 *
 *  - a registrar this boot called ⇒ its routes are enumerable through
 *    `getRoutes()` and appear in `GET {apiPath}/openapi.json`;
 *  - a registrar this boot skipped (no `package` service) ⇒ nothing is
 *    recorded, nothing is documented, and the 404 a caller would get from that
 *    deployment is what the document says too.
 *
 * The service gate stays exactly where it was — here, at composition — and the
 * record follows it rather than restating it. What is deliberately NOT recorded
 * is any verdict about a service that a later phase could still contradict: the
 * federation routes mount unconditionally and decide per request whether the
 * `external-datasource` service is there (503 if not), so this file records
 * them as mounted and says nothing about federation being available.
 */

import type { PluginContext } from '@objectstack/core';
import type { IHttpServer } from '@objectstack/spec/contracts';
import type { PackageService } from '@objectstack/service-package';
import { registerPackageRoutes, type PackageRoutesOptions } from './package-routes.js';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';
import type { DirectMountRecorder } from './direct-mount.js';

export interface DirectMountComposition {
    /** The host server the registrars mount on — the same one `RestServer` wraps. */
    server: IHttpServer;
    /** Where the mounted facts land, so `getRoutes()` reports them. */
    recorder: DirectMountRecorder;
    /** Service lookups (`package`) and the logger this step reports through. */
    ctx: PluginContext;
    /** The configured API base, e.g. `/api/v1`. */
    versionedBase: string;
    /** The `protocol` slice the package routes read registry packages through. */
    protocol?: PackageRoutesOptions['protocol'];
    /**
     * [#7033 / #7023] Resolves the caller's execution context for the package
     * routes' authorization gate — the `RestServer`'s own resolver, so the
     * capability check reads the same identity the rest of the surface does.
     */
    resolveExecutionContext?: PackageRoutesOptions['resolveExecutionContext'];
    /** ADR-0006 project scoping — mirrors the package routes under the scoped base. */
    enableProjectScoping?: boolean;
    /** `'auto'` (both bases) or `'required'` (scoped only). */
    projectResolution?: string;
}

/**
 * Mount the direct-mount registrars for this boot and record every route they
 * mounted on {@link DirectMountComposition.recorder}.
 */
export function mountAndRecordDirectRoutes(composition: DirectMountComposition): void {
    const { server, recorder, ctx, versionedBase, protocol, resolveExecutionContext } = composition;
    const enableProjectScoping = composition.enableProjectScoping ?? false;
    const projectResolution = composition.projectResolution ?? 'auto';

    // Package management routes — only when the service backing them exists.
    try {
        const packageService = ctx.getService<PackageService>('package');
        if (packageService) {
            // `required` scoping serves ONLY the scoped variant; `auto` serves
            // both. Unchanged from the pre-#5822 plugin — expressed as the list
            // of bases so the mount and the record cannot disagree about it.
            const scopedBase = `${versionedBase}/environments/:environmentId`;
            const bases = enableProjectScoping
                ? (projectResolution === 'required' ? [scopedBase] : [versionedBase, scopedBase])
                : [versionedBase];
            for (const base of bases) {
                recorder.recordDirectMountedRoutes(
                    registerPackageRoutes(server, packageService, base, { protocol, resolveExecutionContext }),
                );
            }
            ctx.logger.info('Package management routes registered');
        }
    } catch (e) {
        // Package service not available, skip
        ctx.logger.debug('Package service not available, package routes skipped');
    }

    // External Datasource Federation routes (ADR-0015): catalog / draft /
    // import / validate. Registered unconditionally — they degrade gracefully
    // (503) when the `external-datasource` service is absent.
    // NOTE: the datasource *lifecycle* routes (ADR-0015 Addendum:
    // list / test / create / update / remove) moved to the private
    // `@objectstack/datasource-admin` package, which registers its own.
    try {
        recorder.recordDirectMountedRoutes(
            registerExternalDatasourceRoutes(server, ctx, versionedBase),
        );
        ctx.logger.info('Datasource federation routes registered');
    } catch (e: any) {
        // Nothing is recorded on this path: a registrar that threw part-way
        // may have mounted some routes, and under-claiming a mounted route is
        // the safe direction — a document that omits a live route is visibly
        // incomplete, one that invents a dead route is not.
        ctx.logger.warn('Datasource federation routes registration failed', { error: e?.message });
    }
}
