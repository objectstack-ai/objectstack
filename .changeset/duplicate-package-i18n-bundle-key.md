---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `duplicatePackage` no longer drops a locale from a two-tier i18n bundle (#7932)

Duplicating a package as an org-scoped caller copied **one locale of a
two-locale email-template customization** and reported `success: true`.

`duplicatePackage`'s source-row scan deduplicates the scanned `sys_metadata`
rows with a `NUL`-separated key built from the row's `type` and `name` only,
keeping the org-scoped row over the env-wide one. That key is `(type, name)`
with **no discriminator**, so for a type whose identity the spec declares as a
**pair** it collapses two rows that are two different things.
`EmailTemplateDefinitionSchema` declares exactly such a type: multiple rows with
the same `name` but different `locale` form an i18n bundle, resolved by
`(name, locale)`.

**Why the exposure is narrow, and why it is nevertheless real.**
`sys_metadata`'s overlay uniqueness is
`idx_sys_metadata_overlay_active = (type, name, organization_id, package_id)`,
and the table has **no locale column** — an `email_template`'s locale lives in
the `metadata` JSON body. So within **one** org, two rows differing only by body
locale cannot exist and no collapse is possible. Across the **env-wide**
(`organization_id IS NULL`) and **org** tiers they can, and this scan — widened
to span both tiers in #7819 — is the one place the two tiers meet. An env-wide
`auth.welcome` customized in `en-US` plus an org-scoped `auth.welcome`
customized in `zh-CN` are two distinct bundle members; the scan kept only the
org one. Registry-shipped (code-authored) members are unaffected, because this
scan reads `sys_metadata` overlays only — the exposure is limited to templates
customized at **both** scopes.

The dedup key now appends the canonical-normalized discriminator **when the type
declares one, and nothing otherwise** — the same shape #7774 gave `metaItemKey`
and `mergePackageAwareOverlay` for the `GET /meta/<type>` list. `email_template`
is the only type in `ITEM_KEY_DISCRIMINATORS` today, so **every other type's key
is byte-identical** to what it was before and this change's blast radius is
provable rather than argued.

**Precedence is unchanged wherever it was ever meaningful.** An org row still
overrides the env-wide row of the *same* bundle member; a member that declares
no locale is still keyed as the canonical (`en-US`) member, so the bundle-blind
and bundle-aware answers continue to agree for a single-member "bundle". Only
rows that were never the same thing stay separate. The no-`organizationId` door
never ran this dedup and is untouched.
