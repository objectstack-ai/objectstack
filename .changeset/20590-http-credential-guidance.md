---
'@objectstack/service-automation': patch
---

The `http` node's designer form says an outbound credential never goes in the node's `url` or `headers`, and where it goes instead (#20590)

Clause-②: no

The `http` action descriptor's `configSchema` is what the flow designer's palette and property form read (`GET /api/v1/automation/actions`). It described `url` as "Target URL" and `headers` as "Request headers", with no word about credentials. Both values are stored in the flow definition, and a flow definition is served to every member who can read flows; of the node's config, only `signingSecret` is withheld. The two field descriptions now say this, and name where the credential goes instead:

- a credential in a header: a `connector_action` on a declarative connector whose `auth.credentialRef` names the secret;
- a key in the query string: a declarative `rest` connector with `api-key` auth, whose `paramName` names the parameter and whose `auth.credentialRef` names the secret;
- a webhook whose path is the secret: a token-authenticated connector instead, such as the `slack` connector with its bot token. No `credentialRef` variant carries a secret in the url path.

Description text only. No config key is added or removed, nothing more is withheld on read, and there is nothing to migrate.
