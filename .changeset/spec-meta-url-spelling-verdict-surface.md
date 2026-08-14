---
"@objectstack/spec": minor
---

refactor(spec): narrow the `@objectstack/spec/shared` metadata-url-spelling surface to the verdict (#8424)

**BREAKING** — three exports are removed from `@objectstack/spec/shared` and one
purpose-shaped export is added, per the #8424 spec-seat ruling (amended, option A):

| removed export | successor |
|:--|:--|
| `unmappedDeclaredTypeSpelling(type)` | `metaUrlSpellingRefusal(type)?.declared` |
| `restPluralOfMetaType(type)` | `metaUrlSpellingRefusal(type)?.hint` (the declared type's canonical REST plural) |
| `DECLARED_META_TYPES` | none — it looked like a live registry and is not one; the refusal verdict is the supported question |

FROM → TO: replace
`unmappedDeclaredTypeSpelling(t)` / `restPluralOfMetaType(t)` compositions with a
single `metaUrlSpellingRefusal(t)` call — it returns
`{ declared, hint } | null`, i.e. the composed #7894 boundary verdict ("this
spelling is an unrecognised plural of declared type `declared`; the accepted
spellings are `declared` and `hint`"), which is the one measured out-of-package
use. `META_URL_TO_SINGULAR` and `canonicalMetaUrlType` are unchanged.

Graded `minor`, not `major`: every publishable package sits in the Changesets
`fixed` lockstep group during the launch window
(`scripts/check-changeset-no-major.mjs`), so a `major` here would promote the
whole ~70-package stack for a three-symbol surface trim. The removed exports
have never been published: they landed on `main` 2026-08-13 (PR #8420) and the
last published version is `17.0.0-rc.6` (2026-08-10), so no released consumer
can hold an import of them.

No runtime behaviour changes: the `/meta` boundary's 400 `INVALID_REQUEST`
refusal wording and status are byte-identical (#7894's pins are the proof);
`metadata-protocol` now consumes the composed verdict instead of the parts.

<!-- adr-0087: not-required (unpublished) the three removed exports merged 2026-08-13 (PR #8420) and no version has published since 17.0.0-rc.6 (2026-08-10), so they exist in no released artifact an upgrader could hold; TypeScript-surface change only, no stored metadata shape involved -->
