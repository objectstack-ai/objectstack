---
"create-objectstack": patch
"@objectstack/knowledge-ragflow": patch
"@objectstack/plugin-audit": patch
"@objectstack/service-analytics": patch
"@objectstack/service-automation": patch
"@objectstack/service-cache": patch
"@objectstack/service-i18n": patch
"@objectstack/service-job": patch
"@objectstack/service-knowledge": patch
---

Point every documentation link in these packages' published READMEs — and in
the project `create-objectstack` scaffolds — at the canonical docs origin
`https://objectstack.ai`, replacing the `docs.objectstack.ai` spelling.

Both spellings reach the same pages (the alias redirects to the apex,
path-preserving), so no link was broken. The reason it needs a release rather
than an in-repo fix alone: a README ships inside the npm tarball, so the
version already on npm keeps showing the old host to every reader of the
package page until a new one is published.
