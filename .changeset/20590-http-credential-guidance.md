---
'@objectstack/service-automation': patch
---

The `http` node's designer form says where an outbound credential belongs: a declarative connector's `auth.credentialRef`, not the node's `url` or `headers` (#20590)

Clause-②: no

The `http` action descriptor's `configSchema` is what the flow designer's palette and property form read (`GET /api/v1/automation/actions`). It described `url` as "Target URL" and `headers` as "Request headers", with no word about credentials. Both values are stored in the flow definition, and a flow definition is served to every member who can read flows; of the node's config, only `signingSecret` is withheld. The two field descriptions now say this, and send an outbound credential to a `connector_action` on a declarative connector whose `auth.credentialRef` names the secret.

Description text only. No config key is added or removed, nothing more is withheld on read, and there is nothing to migrate.
