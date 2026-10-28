---
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(console,i18n): the OAuth consent screen explains the `metadata:write` scope and never shows an unknown scope as its bare spelling

Clause-②: yes
Metadata-protocol: none

- **`@object-ui/console`.** The consent screen at `/oauth/consent` names every MCP scope in a sentence. The sentences come from `@objectstack/spec`'s `MCP_OAUTH_SCOPE_CONSENT_COPY`, the copy the spec declares beside each scope, through a switch that is exhaustive over `McpOauthScope`: a scope added to the spec without a case here fails to compile. `metadata:write` used to appear as that raw string beside three plain sentences. It now reads "Build and change this app's metadata as drafts, within your own permissions — a person publishes them". A scope the page cannot name renders as "Unrecognised permission: SCOPE" instead of the bare scope string, which could read as a description of the grant.
- **`@object-ui/i18n`.** Every locale pack gains `oauth.consent.scope.metadataWrite` and `oauth.consent.scope.unrecognised` (the latter takes a `{{scope}}` placeholder). `TranslationKeys` widens by these two keys.
