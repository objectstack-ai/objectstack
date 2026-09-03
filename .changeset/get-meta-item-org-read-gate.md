---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `getMetaItem` gates its own overlay read, so a phantom org-scoped row can no longer replace the live env-wide document

The singular `/meta` read verb applied no organization gate of its own — whatever
`organizationId` a caller passed was spent on whatever type it passed. On the
plural verb (`getMetaItems`, gated in the previous release) the two overlay reads
are UNIONed, so an ungated organization could only add rows. On this one they
combine with `??` — precedence — so it could **substitute**: for a type the
registry declares `allowOrgOverride: false`, a pre-#6190 phantom org-scoped row
was served *instead of* the live env-wide document, to a caller that asked for
the live one. Those rows are the ones boot hydration deliberately walks past and
`reportUnhydratableOrgScopedRows` warns about, so the served document also
vanished at the next restart.

`getMetaItem` now resolves its read scope through `organizationIdForMetaRead`
itself — the same registry-derived predicate the REST `/meta` doors and the
plural verb already apply — once, for both the active-overlay read and the
ADR-0033 `previewDrafts` read.

Read-scope resolution is unchanged for callers that already gated (the predicate
is idempotent, and the gate sits after the same canonical type fold the REST
by-name door gates on) and for callers that name no organization at all. What
changes is a caller that hands this verb a raw active organization: for a type
with no per-org read channel it now reads the env-wide row, as the REST doors
already did.

ADR-0005's overlay-wins resolution order is deliberately untouched: an
organization that legitimately has a per-org channel still sees its own overlay
row win outright, whole, with no merge against the env-wide row.
