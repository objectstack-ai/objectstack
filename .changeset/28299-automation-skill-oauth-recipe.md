---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation teaches `oauth2` and `app-credential` as a served recipe now that the built-in connector providers run the grant

Clause-②: no
Metadata-protocol: none

- **Before.** `references/integration-recipes.md` filed the OAuth-protected vendor under "Not yet": `auth` could declare `oauth2` and `app-credential`, but "no server runs the grant yet", so the integration was to be marked blocked. Eval 1 (DocuSign) graded that answer, and `SKILL.md` listed OAuth among the documents the loader cannot take.
- **Now.** The built-in `rest`, `openapi` and `mcp` providers ask the per-dispatch credential handle, so both kinds are served. Recipe 6 teaches the three `auth` shapes (`authorization_code`, `client_credentials`, `app-credential` with `feishu` / `dingtalk` / `wecom`), where the token is held, that `client_credentials` and `app-credential` dispatch once the ref is set, and how an administrator holding `manage_connector_connections` connects an `authorization_code` instance once per organization (`POST /api/v1/automation/connectors/:name/connection`, the vendor's redirect to the callback, status, revoke). The warning against parking a short-lived token behind a `bearer` ref stays. Eval 1 now expects that recipe and names one remaining gap (the vendor-signed webhook); `SKILL.md`'s loader-gap line no longer names OAuth. WeChat Pay stays under "Not yet" (no `signed` scheme).
- The file's token ceiling moves to the measured count after two same-file restatement cuts; no schema, key or behaviour changes.
