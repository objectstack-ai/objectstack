---
"@objectstack/skills": patch
---

Clause-②: no
Metadata-protocol: none

objectstack-automation: integrations are declared, not coded. The `connector_action`
node row no longer calls a connector "pre-built"; a new SKILL.md section states the
declarative-connector-first rule (a vendor system over HTTP is a `connectors:` entry
with `provider: 'openapi' | 'mcp' | 'rest'`, a packaged spec and `auth.credentialRef`,
dispatched by `connector_action`; a vendor callback is an `api` flow), the five cases
that justify platform code, and that a document the loader cannot take yet is a gap to
name — never a reason to write a plugin. `references/integration-recipes.md` carries one
recipe per archetype with the author / administrator credential hand-off and today's
limits (`connectorConfig.input` is sent as written; no `oauth2`; no vendor-signed
callbacks). `evals/integrations-declared.json` adds the DocuSign, Stripe-read and
vendor-without-spec cases; the DocuSign case fails any answer that proposes a plugin.
