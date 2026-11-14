---
'@objectstack/mcp': patch
---

fix(mcp): `validate_expression` no longer lists the hidden `__search` search companion in `inScope.fields`, and a read of it is refused as `os validate` refuses it

Clause-②: no
Metadata-protocol: none

Where pinyin search is on, the object an MCP caller is served carries the hidden `__search` companion column beside its declared fields. `validate_expression` took its field list from that object, so it named `__search` in `inScope.fields` and answered `ok` for an expression such as `record.__search != ''`. Every record read strips that column, and `os validate` judges an expression against the declared and injected columns only, so the same rule failed there with `unknown-field`.

The tool now leaves the companion out of the fields it judges and lists. The name comes from the engine's own constant (`SEARCH_COMPANION_FIELD`, `@objectstack/objectql`), so `@objectstack/mcp` now depends on `@objectstack/objectql`. It is loaded on the first `validate_expression` call, the way `@objectstack/lint` is, and not when the package loads. Every other field, injected system columns such as `organization_id` among them, is listed and judged as before.
