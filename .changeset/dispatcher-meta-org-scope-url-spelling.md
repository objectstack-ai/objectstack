---
'@objectstack/runtime': patch
---

The dispatcher `/metadata` transport folds the URL segment before deciding
organization scope — `/metadata/translations/:name` no longer writes to a
different partition than `/metadata/translation/:name`

Two maps that must agree did not. `protocol.saveMetaItem` folds the path
segment through `canonicalizeMetaRequestType` → `META_URL_TO_SINGULAR`, the
**complete** spelling map, for storage. The dispatcher handed the same string
**raw** to `organizationIdForMetaWrite`, whose `declaresOrgOverride` tolerates
only the manifest-collection spellings — incomplete by design.

For the two URL-only spellings of `allowOrgOverride: true` types the two
answers diverged. `translation` has no manifest collection key at all;
`email_template`'s is the camelCase `emailTemplates`, so the snake_case plural
the registry derivation adds is URL-only too:

```
PUT /metadata/translation/:name     → org-scoped row      (correct)
PUT /metadata/translations/:name    → env-wide row        (the defect)
PUT /metadata/email_template/:name  → org-scoped row      (correct)
PUT /metadata/email_templates/:name → env-wide row        (the defect)
```

Storage folded both spellings to the same canonical type, so the rows differed
in `organization_id` alone: one item in two partitions, addressed by spelling.
Measured end-to-end through the real dispatcher, protocol and repository —
writing an item under both spellings left **two** `sys_metadata` rows where
there should be one, and the env-wide one is shadowed by every read the
org-active author makes. Persisted, receipted 200, served by nothing.

`GET /metadata/:type/:name/published` is the smaller second site of the same
class. After the layered overlay consult misses, the fallback reads the
code/package store, which is keyed by canonical type; handed the raw segment it
answered **404** under a recognised plural for an item the singular twin
answered **200** for.

Both sites now fold through `canonicalMetaUrlType` at the boundary — the
correction the REST `/meta` doors already carry, and the one
`metadata-url-spelling.ts` mandates ("folding happens at the boundary and only
there; the layers below keep reading the single canonical singular"). ⛔ Not by
widening `declaresOrgOverride`: a predicate below the boundary consuming the
URL spelling contract is the repair that module's header forbids.

Only the scope **argument** is folded. The request `type` stays the raw
segment, exactly as the REST doors leave it — the protocol boundary folds it
itself, and two pre-folds would hide a drift between them from the protocol's
own tests. A type the contract does not map (a plugin-registered kind such as
`webhook`) still reaches the store verbatim: the fold is a lookup, never a
spelling guesser.

⚠️ Whether real callers reach this transport with plural spellings has **not**
been measured. The REST transport was the measured, user-visible surface; this
one is corrected so the class is closed on both transports rather than one.
