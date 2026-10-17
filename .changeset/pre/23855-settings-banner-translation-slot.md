---
'@objectstack/spec': minor
---

Clause-②: yes (widening)

The platform translation bundle (`PlatformTranslationDataSchema`) gains a slot for a settings
`info_banner` row: `settings.<namespace>.banners.<banner_id>.title` and `.text`, keyed by the
specifier's `id`, beside `groups`, `keys` and `actions`. `title` translates the specifier's `label`
(the heading spelling `groups` already uses) and `text` translates its `bannerText` (markdown).
Before this, a translated banner was refused with `unrecognized_keys`, so a banner reached every
locale in its manifest English. The slot is strict: a borrowed `label`, `bannerText` or
`description` leaf, or a singular `banner` group, is refused with the spelling it meant.

Two resolvers read it, `resolveSettingsBannerTitle` and `resolveSettingsBannerText`, from the
`resolveSettings*` family: they walk the requested locale and the declared fallback chain, then
return the manifest literal. The `info_banner` specifier's own accept set is unchanged. Give the
banner an `id` to make it addressable; a banner without one keeps rendering its literals.
