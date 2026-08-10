// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'rest-server-openapi31-block-removed',
  surface: 'restServer.openApi31',
  replacement:
    '(removed — no replacement key exists. Delete the key; for a real outbound webhook use '
    + '`Webhook` from `@objectstack/spec/automation`. Config-driven OpenAPI 3.1 '
    + 'webhooks/callbacks documentation returns, if ever, via the enforce route of ADR-0049 '
    + 'through a new ADR)',
  reason:
    'The `openApi31` block (`webhooks` / `callbacks` / `jsonSchemaDialect` / '
    + '`pathItemReferences`, typed by `OpenApi31ExtensionsSchema` with '
    + '`OpenApiWebhookEventSchema` and `CallbackSchema` under it) promised OpenAPI 3.1 '
    + "document synthesis nothing delivered: the REST server's `normalizeConfig` forwards "
    + 'only `api`/`crud`/`metadata`/`batch`/`routes`, and the served /openapi.json is the '
    + 'pre-generated @objectstack/spec contract enriched with the live server URL and the '
    + 'registered objects — a webhook declared here never appeared in any served document '
    + '(ADR-0049; the #3197 connector-webhook shape one layer up). There is no behaviour '
    + 'to preserve and nothing stored to rewrite: `RestServerConfig` is plugin TS '
    + 'configuration (REST plugin constructor / `plugin-hono-server` `restConfig`), never '
    + "a `sys_metadata` shape — the stack tree's `api` block declares only its four "
    + 'scoping/auth knobs. The three schemas are removed with the key (zero import-level '
    + 'consumers in objectstack / cloud / objectui); the key itself is tombstoned because '
    + 'the schema is not `.strict()` and a plain delete would strip it silently. #4579.',
  acceptanceCriteria:
    'No `RestServerConfig` value passed to the REST plugin (or `plugin-hono-server` '
    + '`restConfig`) carries `openApi31` — a config that includes it now fails the parse '
    + 'with the retirement prescription instead of being silently stripped. No code '
    + 'imports `OpenApi31Extensions(Schema)`, `Callback(Schema)` or '
    + '`OpenApiWebhookEvent(Schema)` from `@objectstack/spec/api` (TS2305 after upgrade). '
    + 'The served /openapi.json is byte-identical before and after — the block never '
    + 'reached it.',
};
