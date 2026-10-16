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
 * Each reader keeps its own sum over the list and pins the list's `length`, so
 * a module added here makes every one of them re-read its number instead of
 * widening unnoticed. ⛔ Not a gate: nothing runs this list on its own, and a
 * reader that imports it stays the authority on what it counts.
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
] as const;

/** One file on {@link REST_SERVER_REGISTRAR_FILES}. */
export type RestServerRegistrarFile = (typeof REST_SERVER_REGISTRAR_FILES)[number];

/**
 * The repo-relative directory of {@link REST_SERVER_REGISTRAR_FILES}, for a
 * reader outside this package (the dogfood suite reads them by repo path).
 */
export const REST_SERVER_REGISTRAR_DIR = 'packages/rest/src';
