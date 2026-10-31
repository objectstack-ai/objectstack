// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 3] THE list of the files `RestServer`'s registrars live in:
 * `rest-server.ts`, plus each module a registrar's body moved to when the split
 * of that file took it out.
 *
 * Test layer only — nothing in `src/index.ts` reaches it, so tsup (entry:
 * `src/index.ts`) never emits it into `dist` and it is not published. Same
 * placement, and for the same reason, as `src/http-request-test-builder.ts`.
 *
 * ## Why one list
 *
 * A whole-file reader of `rest-server.ts` (a census that counts a spelling
 * over the file, a structural pin, a tripwire) reads the code `RestServer`'s
 * registrars run. Each slice of the split moves one registrar's body to its
 * own module, and a reader that never learns of that module stops seeing
 * whatever is written there later: still green, and reading less than it says.
 * Those readers import THIS list and read every file on it, so the slice that
 * moves the next body adds its module here once, and every reader widens with
 * it.
 *
 * Each reader keeps its own sum over the list; none pins the list's `length`,
 * so a module added here widens every reader with no edit to any of them.
 * ⛔ Not a gate: nothing runs this list on its own, and a reader that imports
 * it stays the authority on what it counts.
 *
 * Names are relative to this directory, which every file on the list lives in.
 */
export const REST_SERVER_REGISTRAR_FILES = [
    'rest-server.ts',
    // [#23050 slice 1] `registerDataActionEndpoints`' body.
    'data-action-routes.ts',
    // [#23050 slice 2] `registerBatchEndpoints`' body.
    'batch-routes.ts',
    // [#23050 slice 3] `registerApprovalsEndpoints`' body.
    'approvals-routes.ts',
    // [#23050 slice 4] `registerSharingEndpoints`' and `registerSharingRuleEndpoints`' bodies.
    'sharing-routes.ts',
    // [#23050 slice 5] `registerAnalyticsEndpoints`' body.
    'analytics-routes.ts',
    // [#23050 slice 6] `registerSecurityExplainEndpoints`' and `registerSecurityEndpoints`' bodies.
    'security-routes.ts',
    // [#23050 slice 7] `registerDiscoveryEndpoints`' and `registerOpenApiEndpoints`' bodies.
    'discovery-routes.ts',
    // [#23050 slice 8] `registerEmailEndpoints`' body.
    'email-routes.ts',
    // [#23050 slice 9] `registerSearchEndpoints`' body.
    'search-routes.ts',
    // [#23050 slice 10] `registerUiEndpoints`' body.
    'ui-routes.ts',
    // [#23050 slice 11] `registerFormEndpoints`' body.
    'form-routes.ts',
    // [#23050 slice 12] `registerCrudEndpoints`' body.
    'crud-routes.ts',
    // [#23050 slice 13a] The first three `/meta` groups of
    // `registerMetadataEndpointsInner`' body — see {@link REST_SERVER_META_ROUTE_FILES}.
    'meta-collection-routes.ts',
    // [#23050 slice 13b] The fourth `/meta` group of `registerMetadataEndpointsInner`'
    // body, the per-item reads — see {@link REST_SERVER_META_ROUTE_FILES}.
    'meta-item-read-routes.ts',
    // [#23050 slice 13c] The fifth `/meta` group of `registerMetadataEndpointsInner`'
    // body, the per-item writes — see {@link REST_SERVER_META_ROUTE_FILES}.
    'meta-item-write-routes.ts',
    // [#23050 slice 13d] The sixth `/meta` group of `registerMetadataEndpointsInner`'
    // body, the history family — see {@link REST_SERVER_META_ROUTE_FILES}. [#23050 slice
    // 13e] It holds the eighth and last too, the published read, as a second registrar.
    'meta-item-history-routes.ts',
    // [#23050 slice 13e] The seventh `/meta` group of `registerMetadataEndpointsInner`'
    // body, the object state-machine read — see {@link REST_SERVER_META_ROUTE_FILES}.
    'meta-object-state-routes.ts',
    // [#27627] `registerRecordPageEndpoints`' body, the record page payload. New, not a
    // moved slice: a registrar added beside the others joins the list in its own PR.
    'record-page-routes.ts',
    // [#27627] `registerMetaAppBundleRoute`' body, the app metadata bundle. New, not a
    // moved slice, and a `/meta` group — see {@link REST_SERVER_META_ROUTE_FILES}.
    'meta-app-bundle-routes.ts',
] as const;

/** One file on {@link REST_SERVER_REGISTRAR_FILES}. */
export type RestServerRegistrarFile = (typeof REST_SERVER_REGISTRAR_FILES)[number];

/**
 * [#23050 slice 13a] The files on {@link REST_SERVER_REGISTRAR_FILES} that hold a
 * moved `/meta` group: a module `RestServer#registerMetadataEndpointsInner` calls
 * from inside its own body, with the host literal built there.
 *
 * A route registered from one of these runs inside the umbrella
 * `registerMetadataEndpoints`' swap, behind the same wrapping registrar as the
 * routes still in that method, even though no line of it is lexically inside
 * the method. A reader that judges "inside the umbrella" by position in
 * `rest-server.ts` reads these files as well; the dogfood blind-spot census is
 * the one that does today.
 *
 * Named file by file, ⛔ never by a naming convention: a module joins this
 * subset in the slice that moves a `/meta` group into it, and a reader that
 * depends on it pins it against the module calls inside the inner method (one
 * per file, and two for `meta-item-history-routes.ts`, the one module the inner
 * method calls at two positions).
 */
export const REST_SERVER_META_ROUTE_FILES: readonly RestServerRegistrarFile[] = [
    // [#23050 slice 13a] The type list, the whole-store maintenance family and the
    // per-type list.
    'meta-collection-routes.ts',
    // [#23050 slice 13b] The per-item reads: `/references`, `/layers`, the book tree
    // and the item read.
    'meta-item-read-routes.ts',
    // [#23050 slice 13c] The per-item writes: the item save and the reset. The first
    // module here that registers nothing on the route manager itself: both routes go
    // through the inner method's per-item registrar, handed over in its scope.
    'meta-item-write-routes.ts',
    // [#23050 slice 13d] The history family: `/history`, `/audit`, `/publish`,
    // `/rollback` and `/diff`. Like the per-item writes, all five routes go through the
    // inner method's per-item registrar, handed over in its scope. [#23050 slice 13e]
    // The published read joined them, the same way, through a second function the inner
    // method calls at its own position: the one module here it calls twice.
    'meta-item-history-routes.ts',
    // [#23050 slice 13e] The object state-machine read, `GET {metaPath}/object/:name/state/:field`.
    // It is in no per-family switch and registers on the route manager itself, by value
    // from a host literal built inside the inner method.
    'meta-object-state-routes.ts',
    // [#27627] The app metadata bundle, `GET {metaPath}/app/:appId/bundle`. New, not a
    // moved slice; like the per-item writes it goes through the inner method's per-item
    // registrar, handed over in its scope.
    'meta-app-bundle-routes.ts',
];

/**
 * The repo-relative directory of {@link REST_SERVER_REGISTRAR_FILES}, for a
 * reader outside this package (the dogfood suite reads them by repo path).
 */
export const REST_SERVER_REGISTRAR_DIR = 'packages/rest/src';
