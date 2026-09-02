// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'rest-api-endpoint-handler-status-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'RestApiEndpoint.handlerStatus (the implemented / stub / planned marker an '
    + 'endpoint in a REST API plugin route registration could carry), the '
    + 'HandlerStatusSchema / HandlerStatus value def it was typed with, and the '
    + 'RouteCoverageEntrySchema / RouteCoverageReportSchema report shapes (with '
    + 'their RouteCoverageEntry / RouteCoverageReport types) that re-declared it',
  replacement:
    'nothing declarative — the key never changed what the platform served, so '
    + 'there is no working configuration to migrate to. Delete the key; an '
    + 'endpoint that has no handler yet is simply not registered. Route '
    + 'readiness that IS measured is unchanged and lives elsewhere: the '
    + "discovery payload reports each service's status and handlerReady "
    + '(api/discovery.zod.ts), and packages/runtime/src/route-ledger.ts asserts '
    + 'per-route coverage in CI. A declared-but-unbuilt route answering 501 '
    + 'instead of 404 is a new capability the ruling explicitly excluded (zero '
    + 'pull); if it is ever wanted it re-declares fresh under its own ruling, '
    + 'executor first',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-01 on #13823 '
    + '(director decision batch #27, verbatim 「同意」: remove; enforce '
    + 'excluded). The key was DOCUMENTED to cause a specific runtime behaviour '
    + '— its docstring said a stub handler "returns 501 Not Implemented" — and '
    + 'that behaviour has a different cause: every '
    + 'DispatcherErrorCode.enum.NOT_IMPLEMENTED site (runtime/src/'
    + 'endpoint-executor.ts ×3, runtime/src/api-mapping.ts, '
    + 'runtime/src/api-endpoint-step.ts) is the declarative-endpoint executor '
    + 'refusing a target or mapping it cannot serve, and none of them consults '
    + 'handlerStatus. Measured at the retirement base (origin/main a9b2be0b0, '
    + '2026-09-02, skills/** and tests excluded): the only identifier hits were '
    + 'the declaration on RestApiEndpointSchema, the re-declaration on '
    + 'RouteCoverageEntrySchema and a docblock saying adapters SHOULD warn on '
    + 'it; RouteCoverageReportSchema — the one shape that would have carried '
    + 'the status outward — had zero constructors in objectstack, objectui '
    + '(pinned sha) and cloud. So an author who wrote handlerStatus: \'stub\' '
    + 'expecting the dispatcher to answer 501 got an ordinarily served route, '
    + 'and the declaration reported progress to nobody — a declared ≠ enforced '
    + 'gap on the same endpoint vocabulary ApiEndpointSchema closed strictly in '
    + '#5384, and the surface a published skill had been teaching as working '
    + 'machinery (the sentence corrected in #13808 is where this card came '
    + 'from). Bookkeeping: the KEY is tombstoned with retiredKey() on the '
    + 'non-strict RestApiEndpointSchema (api/RestApiEndpoint:handlerStatus in '
    + 'RETIRED_KEYS_BY_MAJOR[18]); the DEFS leave whole — api/HandlerStatus '
    + '(orphan value enum once both carriers are gone, the #3950 rule), '
    + 'api/RouteCoverageEntry and api/RouteCoverageReport (route 3: nobody '
    + 'ever parsed or constructed one) — all three in RETIRED_DEFS_BY_MAJOR[18]. '
    + 'It is a SEMANTIC entry rather than a D2 conversion because there is no '
    + 'source to rewrite: nothing in the tree parses RestApiEndpointSchema '
    + 'outside its own unit tests — a REST API plugin route registration is not '
    + 'a stack collection member and never a sys_metadata row — so the '
    + 'conversion chain has no seam that would ever see one (the '
    + 'kernel/Manifest:loading disposition). ENFORCE was excluded by the ruling: '
    + 'mounting a 501 stub for stub / planned endpoints is a zero-pull new '
    + 'capability, not a repair. The same ruling records the class direction '
    + 'for the two sibling ADR-0049 cards (#13612 / #13613, not ruled by it): '
    + 'a declared-but-unenforced key with no pull retires; enforce/bind only on '
    + 'a named consumer or measured pull. ADR-0049 / ADR-0087, #13823.',
  acceptanceCriteria:
    'No source writes handlerStatus on a RestApiEndpoint: authoring it is now a '
    + 'tsc error at the site (the tombstone types the key never) and a parse '
    + 'error carrying the prescription at path handlerStatus, for every former '
    + "value including the documented default 'implemented' (which was prose "
    + 'only — the key never carried a Zod .default(), so no built artifact '
    + 'materialised it and there is no residue window). Pinned in '
    + 'api/plugin-rest-api.handler-status-retirement.test.ts. Concretely, check '
    + 'two places. (1) Every RestApiEndpoint literal — in a route registration '
    + 'passed to the REST API plugin, or standalone: delete the handlerStatus '
    + 'line; nothing served changes, because nothing ever read it. (2) Code '
    + 'importing HandlerStatusSchema, HandlerStatus, RouteCoverageEntrySchema, '
    + 'RouteCoverageEntry, RouteCoverageReportSchema or RouteCoverageReport from '
    + '@objectstack/spec or @objectstack/spec/api: every one is TS2305 after '
    + 'upgrade; no replacement exists to point at, because no producer ever '
    + 'emitted the report. Everything else on RestApiEndpointSchema — method, '
    + 'path, handler, category, public, permissions, the OpenAPI and '
    + 'performance keys — parses exactly as before, and the shipped default '
    + 'route registrations (getDefaultRouteRegistrations) never carried the '
    + 'key and still parse.',
};
