// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'view-management-protocol-retired',
  surface:
    'api.listViews / api.getView / api.createView / api.updateView / api.deleteView '
    + '(the ViewProtocol interface and its ten Request/Response schemas in '
    + 'api/protocol.zod.ts — 10 defs, 25 exported names)',
  replacement:
    'the two view surfaces that are actually routed. For a view\'s STORED definition, the '
    + 'generic metadata methods with `type: \'view\'` — `getMetaItem` / `getMetaItems` / '
    + '`saveMetaItem` / `deleteMetaItem`, served at `/api/v1/meta/view/:name`. For the '
    + 'RESOLVED render-time view, `getUiView` (`GetUiViewRequest` / `GetUiViewResponse`), '
    + 'served at `/api/v1/ui/view/:object/:type`. Neither is addressed by a `viewId`, which '
    + 'is the one thing the retired surface offered and the one thing nothing implemented',
  reason:
    'A complete viewId-addressed CRUD surface — list (with a list/form filter), read, '
    + 'create, patch, delete — with none of the three things a protocol method needs. '
    + 'Measured on origin/main immediately before the removal: no implementation '
    + '(`packages/metadata-protocol/src/protocol.ts` declares no `listViews` / `getView` / '
    + '`createView` / `updateView` / `deleteView`; its only view resolver is `getUiView`), '
    + 'no route (`packages/rest/src/rest-server.ts` never mentions `viewId`, so nothing '
    + 'viewId-addressed is reachable over HTTP at all), and no caller (the only '
    + '`ViewProtocol` mention outside its own file was the services checklist, which '
    + 'already recorded the five as declared-and-unrouted). The look-alike hits a bare-name '
    + 'grep turns up are all different contracts: `metadata-manager.ts`\'s '
    + '`getView(name: string)` is another class, and objectui\'s '
    + '`getView(objectName, viewId)` resolves through `client.meta.getItem(\'view\', …)`, '
    + 'i.e. the metadata route. '
    + 'What makes this worth a removal rather than a note is that the cost is already '
    + 'measured. A declared surface that is name-identical and semantics-adjacent to a real '
    + 'one is an attractive nuisance in every grep, and it mis-directed a decision once: '
    + '#5948\'s issue body AND its 2026-08-07 maintainer ruling both read '
    + '`GetViewResponseSchema` (zero implementations) as the contract of '
    + '`GET /ui/view/:object/:type`, whose declared response is `GetUiViewResponseSchema` — '
    + 'one word apart, 250 lines up. That ruling\'s reasoning happened to survive the '
    + 'mix-up ("nobody can consume `{object, view}` successfully today" was true, though '
    + 'not for the stated reason), which is the luck this removal stops relying on. '
    + 'Route 3: none of the ten was a key on an authorable shape, nothing parsed them, so '
    + 'there is no tombstone and no D2 conversion — RETIRED_DEFS_BY_MAJOR plus this entry '
    + 'are the declaration. If reading and writing ONE view by id becomes a real '
    + 'requirement it returns implementation-first. ADR-0049, ADR-0087, maintainer ruling '
    + '2026-08-07, #6239.',
  acceptanceCriteria:
    'No source imports `ListViewsRequest(Schema)`, `ListViewsResponse(Schema)`, '
    + '`GetViewRequest(Schema)`, `GetViewResponse(Schema)`, `CreateViewRequest(Schema)`, '
    + '`CreateViewResponse(Schema)`, `UpdateViewRequest(Schema)`, '
    + '`UpdateViewResponse(Schema)`, `DeleteViewRequest(Schema)` or '
    + '`DeleteViewResponse(Schema)` from `@objectstack/spec/api`, and no host declares a '
    + '`ViewProtocol` member. Reading and writing views still works end to end through the '
    + 'surfaces that were always the live ones: `GET /api/v1/meta/view/:name` returns the '
    + 'stored definition and `GET /api/v1/ui/view/:object/:type` returns the resolved view, '
    + 'both unchanged by this removal. `GetUiViewRequestSchema` / `GetUiViewResponseSchema` '
    + 'still resolve — they are the shapes #5948 meant.',
};
