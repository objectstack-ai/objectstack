---
"@objectstack/cli": patch
---

fix(cli): `serve`'s optional i18n load prints the host-import classification it used to swallow (#14118)

The auto-registration of `@objectstack/service-i18n` ended in a bare `catch {}`.
Tolerating the absence was right — a missing i18n package is a supported
configuration, and the kernel pre-injects its in-memory `i18n` fallback — but
the catch also discarded the classification `createHostImporter` had already
produced. An app that DECLARES the package and whose install is pruned,
unbuilt, or published with no loadable entry reached that catch as exactly the
same silence as an app that never installed it, so a broken install read as a
deliberate opt-out.

The catch now captures the error, reads `hostImportFailureKind`, and warns on
**stderr** with the kind and the importer's own per-kind remedy text; an error
carrying no kind resolved and then crashed while evaluating, and says so with
its stack. Behaviour is unchanged in every branch — nothing is re-thrown, the
boot continues, and the consequence ("this boot serves i18n from the kernel
in-memory fallback") is stated ahead of the diagnosis.

Only the kind token is interpolated locally; every word of remedy comes from
the importer, so the site is correct for all three kinds — including
`declared-no-loadable-entry` — without a branch table that can go stale.

This is the same class PR #14042 repaired at the cluster-driver load, at the
one site that repair did not reach.
