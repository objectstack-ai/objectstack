---
"@objectstack/plugin-auth": patch
---

A deployment that serves its OAuth authorization-server discovery documents over **public plain HTTP** now says so at startup. Previously it was the quietest configuration on the box: the `.well-known` discovery routes go up regardless of transport, while the only line that mentioned the refused transport sat inside the MCP-surface condition — so a public plain-HTTP boot with `OS_MCP_SERVER_ENABLED=false` emitted no warning at all.

Eligibility now decides **which** sentence is emitted, never **whether** one is:

- an origin the transport rule ACCEPTS (loopback / private / link-local) keeps its line, `OAuth is served UNENCRYPTED`;
- an origin it REFUSES (a public host) gets a new, distinct line, `OAuth discovery is served over PUBLIC plain HTTP`, naming the issuer and the discovery documents, stating that the MCP OAuth track is disabled, and pointing at TLS as the remedy.

Both are emitted once, at mount; neither under TLS. ⛔ No configuration key and ⛔ no environment variable gates either line.

**No admission decision changes.** `isOAuthEligibleBaseUrl` and every transport-rule predicate are untouched, the discovery routes are mounted exactly where and when they were before, no export is added or removed, and no published payload gains a key. The change is two log lines and a comment.

The startup line is also now written in English, this repository's convention for code artefacts. The maintainer's wording 「OAuth 未加密:仅限可信内网」 is carried as the sentence's meaning and kept verbatim in the code comment beside the call.

Clause-②: no
