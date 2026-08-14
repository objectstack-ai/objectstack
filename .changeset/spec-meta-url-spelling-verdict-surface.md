---
"@objectstack/spec": minor
---

refactor(spec): narrow the `@objectstack/spec/shared` metadata-url-spelling surface to the verdict (#8424)

Per the #8424 spec-seat ruling (amended, option A), the `/meta` URL-spelling
module's surface is three symbols with three roles: `META_URL_TO_SINGULAR` (the
spelling contract), `canonicalMetaUrlType` (the fold), and the new
`metaUrlSpellingRefusal(urlType)` → `{ declared, hint } | null` (the composed
#7894 boundary refusal verdict: "this spelling is an unrecognised plural of
declared type `declared`; the accepted spellings are `declared` and `hint`").

Three helpers that briefly rode the surface become module-internal:
`unmappedDeclaredTypeSpelling` and `restPluralOfMetaType` (their one
out-of-package consumer, `metadata-protocol`'s 400 refusal, now consumes the
composed verdict — `metaUrlSpellingRefusal(t)?.declared` / `?.hint` replace the
two calls) and `DECLARED_META_TYPES` (no consumer; it read like a live registry
of registered types and is not one).

**Not a breaking change for any released consumer, hence no breaking
declaration**: the three internalized exports landed on `main` 2026-08-13
(PR #8420) and no version has published since `17.0.0-rc.6` (2026-08-10), so no
released artifact ever carried them — relative to every published version this
release only *adds* spelling exports. Even had they been published, the
launch-window convention (`scripts/check-changeset-no-major.mjs`) would ship the
trim as `minor`.

No runtime behaviour changes: the `/meta` boundary's 400 `INVALID_REQUEST`
refusal wording and status are byte-identical (#7894's pins are the proof).
