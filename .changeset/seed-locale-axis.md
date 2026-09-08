---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

Seed datasets gain a `locale` filter axis, composed with `env` by the loader.

An app shipping demo data for two language markets — the same records, different display strings — had no declarative way to say which dataset applies. `SeedSchema` is a `strictObject`, so the app could not add the key itself; the selection had to happen in application code while the config was assembled. That is the wrong layer twice over: the choice is cached in the build output (switching markets means deleting `dist`), and because every profile is an `upsert` and the loader only writes, the other market's rows stay resident in the database.

- **`Seed.locale?: string[]`** — BCP-47 tags scoping the dataset to one or more language markets. **Omitted means every locale.** Unlike `env`, whose three environments are a closed set that can be spelled out as a default, locales are open-ended tags with no enumerable universe — so absence, not a default array, is what carries "unrestricted". An empty array is rejected: a dataset that applies nowhere is an authoring mistake, the same reasoning that already governs a composite `externalId`. `locales`, `language` and `languages` are aliased onto it, matching the existing `environment` / `environments` → `env` pair.
- **`SeedLoaderConfig.locale?: string`** — the tag the load filters on.
- **The loader composes both axes by conjunction.** A dataset is loaded when it passes `env` **and** `locale`; neither axis can rescue a dataset the other excluded. `filterByLocale` mirrors `filterByEnv` down to the reporting posture — skipping is the declared, intended outcome, so it logs at `info`, but it always names what it dropped. Tags compare case-insensitively (BCP-47 casing is a convention, not part of a tag's identity) and otherwise exactly: `['zh']` does not match `zh-CN`, and widening that would be the lenient consumer-side fallback the contract-first rule forbids.

The platform still translates nothing and merges nothing. The app authors both record sets; this adds only the axis that selects between them.

**What is not wired yet, stated plainly.** The locale axis is evaluated against `config.locale`, and no first-party call site supplies one — the runtime wiring that would resolve it from the stack's configured locale is a separate change in `packages/runtime`. An embedding host that passes `config.locale` itself gets the full behaviour today; on the default boot path the axis is inert. That is the shape `Seed.env` was in before framework#4704, so it is not left silent: a load carrying locale-scoped datasets and no `config.locale` warns naming each dataset it let through and the config key that would make the scope take effect. The liveness ledger records `seed.locale` as `experimental` for exactly this reason, with the consumer side cited and the producer gap spelled out, rather than claiming `live` on a correct-but-insufficient consumer pointer.
