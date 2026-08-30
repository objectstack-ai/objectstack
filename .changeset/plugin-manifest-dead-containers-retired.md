---
"@objectstack/spec": minor
---

feat(spec)!: retire the plugin manifest's three dead top-level containers — `capabilities`, `configuration`, `extensions` (#11332, ADR-0049)

<!-- adr-0087: registered plugin-manifest-dead-containers-retired -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the prescriptions are registered
under protocol major 18 — `RETIRED_KEYS_BY_MAJOR[18]` + the D3 semantic entry
`plugin-manifest-dead-containers-retired` — where `os migrate meta` users will
look).

The census (#11332, cloud leg #12400) measured ZERO reads of each container
itself across objectstack, objectui and cloud, with positive controls — which
settles every key beneath them at once, because a key cannot be read if the
object holding it never is. `configuration.properties.secret` is why this is
false compliance rather than tidying: its describe() promised "value is
encrypted/masked (e.g. API Keys)" while nothing encrypted, masked or even
parsed the flag — `secret: true` next to an API key got exactly the same
handling as `secret: false`. `capabilities`' describe() sold "interoperability
and automatic discovery" no discovery path ever performed, and `extensions`
was an untyped `z.record(z.string(), z.unknown())` catch-all nothing
consulted.

FROM → TO:

- `manifest.capabilities` (`implements` / `provides` / `requires` /
  `extensionPoints` / `extensions`) → *(removed — no replacement block)*.
  Real dependency resolution runs off top-level `manifest.dependencies`,
  which stays unchanged. `PluginCapabilityManifestSchema` itself stays
  exported: the plugin-registry surface (`plugin-registry.zod.ts`) still
  declares it.
- `manifest.configuration` (`{ title, properties }`) → pass options to the
  plugin's constructor in `defineStack({ plugins: [new MyPlugin({ … })] })` —
  the channel hosts already use, and the only one anything reads.
- `manifest.extensions` → the enforced extension channels:
  `contributes.kinds` registers metadata kinds, `navigationContributions`
  (ADR-0029 D7) injects navigation into other packages' apps, and code-level
  extension lives in the plugin itself (`init`/`start`).

One-line fix: delete the keys (they configured nothing); if you passed
settings via `configuration`, move them to the constructor options your host
already hands the plugin.

The retirement kit:

- `retiredKey()` tombstones on all three keys (`ManifestSchema` is not
  `.strict()`, so a plain deletion would silently strip the key — the
  `manifest.loading` precedent): authoring one is a `tsc` error (input typed
  `never`) and a parse error carrying the prescription
- `kernel/Manifest:capabilities` / `kernel/Manifest:configuration` /
  `kernel/Manifest:extensions` in `RETIRED_KEYS_BY_MAJOR[18]`, plus the D3
  semantic entry `plugin-manifest-dead-containers-retired`; deliberately NO
  D2 conversion — a package manifest is not a stack collection member
  (`PLURAL_TO_SINGULAR` has no `packages` / `plugins` entry), so a conversion
  would be a transform with no seam that ever runs (the
  `kernel/Manifest:loading` reasoning)
- pin tests (`kernel/manifest.test.ts`): per-container rejection carrying the
  prescription as the specific zod issue; live neighbours
  (`dependencies`, `contributes.kinds`, `navigationContributions`) pinned
  green
- the two in-repo authors (driver-memory and plugin-hono-server, each
  writing `configuration` + `capabilities` blocks nothing read) stop
  authoring the keys; liveness ledger rows move to the tombstone
  disposition
