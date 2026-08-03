---
"@objectstack/spec": major
---

feat(spec)!: `@objectstack/spec/api` no longer exports the bare names `WebhookConfig` / `WebhookEvent` — they belong to `./integration` alone (#4572)

The names `WebhookConfig(Schema)` / `WebhookEvent(Schema)` resolved to **two
different declarations** depending on the import path (`./api` vs
`./integration`) — the #4411 dual-source trap, and a cross-form one:
`./api`'s `WebhookEventSchema` was a `z.object` (an OpenAPI 3.1 webhook
*definition* descriptor: `name`/`description`/`method`/`payloadSchema`/
`security`) while `./integration`'s is a `z.enum` of connector event types
(`'record.created'` … `'rate_limit.exceeded'`). Auto-importing the wrong side
compiled and validated the wrong contract. Resolution (three-repo,
import-statement-level consumer scan: framework, cloud, objectui):

- **Removed** `WebhookConfigSchema` / `WebhookConfig` from
  `@objectstack/spec/api`. This pair was dead: wired into nothing — not even
  `RestServerConfigSchema` — with zero import-level consumers in all three
  repos, and no runtime ever read a REST-server webhook config.
  - FROM `import { WebhookConfig } from '@objectstack/spec/api'` →
    TO: no replacement exists for a REST-server webhook config (it never had a
    runtime). For a real outbound webhook use `Webhook` from
    `@objectstack/spec/automation`; for a connector webhook use
    `WebhookConfig` from `@objectstack/spec/integration` (a **different
    shape**: it extends the canonical automation `WebhookSchema` with
    `events` / `signatureAlgorithm`, and has no `deliveryConfig` /
    `registrationEndpoint` / `enabled`).
- **Renamed** `WebhookEventSchema` / `WebhookEvent` in `@objectstack/spec/api`
  → `OpenApiWebhookEventSchema` / `OpenApiWebhookEvent` (same shape, rename
  only; joins the existing `OpenApi*` family).
  **Superseded in the same major (#4579, ADR-0049):** the renamed pair was
  then removed outright with the whole inert `RestServerConfig.openApi31`
  block, so the rename never ships as a landing spot — see the
  `rest-server-openapi31-block-removed` changeset.
  - FROM `import { WebhookEvent } from '@objectstack/spec/api'` →
    TO: no `./api` replacement exists (the OpenAPI 3.1 webhook descriptor was
    removed in #4579 — nothing ever rendered it into the served
    `/openapi.json`). Use
    `import { WebhookEvent } from '@objectstack/spec/integration'` if you
    meant the connector event enum (check which shape you actually consume:
    object vs string enum), or `Webhook` from `@objectstack/spec/automation`
    for a real outbound webhook.
- `@objectstack/spec/integration`'s `WebhookConfig(Schema)` /
  `WebhookEvent(Schema)` are **unchanged** and are now the sole owners of the
  bare names. Imports from `./integration` need no migration.

`dual-source-exports.baseline.json` shrinks by exactly these 4 rows (35 → 31,
#4535 C1).
