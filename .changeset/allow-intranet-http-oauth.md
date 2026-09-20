---
'@objectstack/plugin-auth': patch
---

Allow operators to explicitly enable MCP OAuth on non-loopback HTTP deployments
with `OS_ALLOW_INSECURE_OAUTH_HTTP=true`; the default TLS requirement remains
unchanged and malformed opt-in values fail closed.
