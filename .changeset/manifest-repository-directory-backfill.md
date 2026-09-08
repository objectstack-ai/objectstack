---
"@objectstack/connector-mcp": patch
"@objectstack/connector-openapi": patch
"@objectstack/connector-rest": patch
"@objectstack/connector-slack": patch
"@objectstack/embedder-openai": patch
"@objectstack/knowledge-memory": patch
"@objectstack/knowledge-ragflow": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-pinyin-search": patch
"@objectstack/plugin-reports": patch
"@objectstack/plugin-sharing": patch
"@objectstack/service-sms": patch
"@objectstack/trigger-api": patch
---

These fourteen packages now declare `repository.directory`, so their npm pages carry a working "source" deep link to their own directory in the monorepo.

npm renders that field by concatenating it onto `repository.url`. None of these fourteen manifests carried a `repository` block at all, so every one of their npm pages offered no route from the package back to its code — not a broken link, no link. That is what this publishes: the block those pages read, naming each package's own directory.

Nothing else about these packages changes. No export, no runtime behaviour, no dependency and no file in the tarball other than the manifest's own `repository` key. The version bump exists because the fix is only real once it is published: the field lives in the manifest npm serves, so a corrected manifest sitting in the repository leaves the package page exactly as wrong as it was.

The rule behind it is now mechanical rather than remembered — `check:manifest-repository-directory` makes a publishable (non-private) workspace manifest declare the field naming its own directory, so a package added or moved after this cannot quietly go back to having no source link.
