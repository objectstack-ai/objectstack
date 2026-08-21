---
"@objectstack/rest": patch
"@objectstack/metadata-core": patch
---

**Fix:** the REST `/meta` doors now decide **organization scope on the folded type**, never on the raw URL spelling (#10340).

Storage folds `/meta/:type` through `META_URL_TO_SINGULAR` — the complete spelling map — while the doors' scope predicate (`declaresOrgOverride`) tolerates only the manifest-collection spellings. For the two registry-derived spellings, `translations` and `email_templates`, the doors therefore read and wrote **env-wide** where the singular twin was org-scoped: an org-active author's `PUT /meta/translations/:name` landed an env-wide row their own org-scoped read then shadowed (persisted, receipted as live, served by nothing), and `GET` under one spelling answered a different partition than the other — one item, two namespaces, addressed by spelling (#4432 / #7894's defect one layer down).

- All nine `/meta` org-scope call sites (list, single read, layers view, compound read, save, compound save, delete, publish, rollback) fold the segment through `canonicalMetaUrlType` **before** calling `organizationIdForMetaRead` / `organizationIdForMetaWrite`, exactly as `metadata-url-spelling.ts` mandates: folding happens at the boundary and only there.
- The `GET /meta/:type/:name/published` code-store fallback folds too — the smaller second site of the same class: it reads a registry keyed by canonical types, so a recognised plural of a code-published item answered 404 while the singular answered 200.
- **Deliberately unchanged:** `GET /meta/_drafts` still applies no fold (it filters by the draft row's *stored* type, which is canonical because the protocol folds on save), the request `type` handed to the protocol stays the raw segment (the protocol owns its own fold), and `declaresOrgOverride` does **not** absorb the URL map — a predicate below the boundary consuming the URL spelling contract is the repair #7894 forbids. `@objectstack/metadata-core` changes are documentation and pins only: the predicate's header no longer claims parity with the protocol's normalization (measured false), and new tests pin both the composed fold→predicate contract and the predicate's deliberate limit.

No stored rows move: rows previously minted env-wide through a plural spelling stay env-wide and keep serving org-less callers (and org-active callers until an org overlay exists), which is the same layering the singular spelling always had.
