---
'@objectstack/spec': minor
'@objectstack/rest': minor
---

feat(spec,rest)!: retire `api.responseFormat` and `api.documentation.enabled` — parsed, defaulted, and read by nothing (#20295)

Clause-②: yes (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
never by the level).

Two keys of `RestServerConfig.api` (`RestApiConfigSchema`) were accepted, given
defaults and copied into the REST server's config by `normalizeConfig` — and no
site ever read them back. `responseFormat` (`envelope`, `includeMetadata`,
`includePagination`) toggled nothing: `envelope: false` unwrapped no response.
`documentation.enabled` was a second on/off switch for the OpenAPI document that
nothing consulted: `api.enableOpenApi` decides that mount. Measured before
removal, each against a lit control on the same instrument: no reader in this
repo's packages, and no author in objectui at its pinned commit or in cloud.
ADR-0049 enforce-or-remove; the verdict is RETIRE, by the maintainer's criterion —
mainstream data APIs keep a fixed response envelope that no administrator toggles
server-wide, and the OpenAPI switch already exists and is enforced.

```
FROM  new RestServer(server, protocol, { api: { responseFormat: { envelope: false } } })
      -> constructed; `envelope: false` changed nothing
TO    -> throws: REST API configuration is invalid: `api` does not satisfy
         `RestApiConfigSchema` …
           - api.responseFormat: `api.responseFormat` was removed in @objectstack/spec 17.5.0
             (ADR-0049 enforce-or-remove) — … Delete the key. Response shapes are fixed, …

FROM  RestApiConfigSchema.parse({ documentation: { enabled: false, title: 'My API' } })
      -> { documentation: { enabled: false, title: 'My API' }, … }   // served the document anyway
TO    -> ZodError { code: 'invalid_type', path: ['documentation', 'enabled'],
         message: '`api.documentation.enabled` was removed in @objectstack/spec 17.5.0 (ADR-0049
         enforce-or-remove) — … Delete the key; `api.enableOpenApi: false` is the switch …' }
```

**Fix.** `api.responseFormat` → delete the key; response shapes are fixed, so
there is nothing to configure. `api.documentation.enabled` → delete the key; to
serve no OpenAPI document, set `api.enableOpenApi: false` (it leaves
`GET /openapi.json` and `GET /docs` unmounted). `tsc` refuses both keys at the
authoring site (their input type is `never`).

**What does not change.** Every live key of the `api` block parses exactly as
before, including the rest of `documentation` (`title`, `description`,
`version`, `termsOfService`, `contact`, `license` — a separate decision). A
config without the two keys mounts the same REST surface: neither key ever
reached it. A `documentation` block no longer grows an `enabled: true` default.

### The retirement kit

- **Schema.** `RestApiConfigSchema` and its inline `documentation` object are
  non-strict `z.object()`s, so each key is a `retiredKey()` tombstone carrying its
  prescription (a bare deletion would have stripped it in silence).
  `responseFormat` retires whole — its three members were its only members.
- **REST server.** `normalizeConfig` runs the tombstones (the `crud.patterns`
  posture, not `requireAuth`'s warn-and-ignore), so a config carrying either key
  now fails `RestServer` construction and the REST plugin's `start` with the
  prescription, and the normalized config no longer carries or re-defaults them.
- **ADR-0087.** `RETIRED_KEYS_BY_MAJOR[18]` gains `api/RestApiConfig:responseFormat`
  and `api/RestApiConfig:documentation.enabled`. No D2 conversion: a
  `RestServerConfig` is plugin TS configuration, never a stack collection member or
  a stored row. The family's D3 entry, `rest-api-config-dead-keys-retired`, carries
  the prescription to `os migrate meta` and the upgrade guide.
- **Ledger and docs.** `liveness/rest_api.json` keeps both rows `dead` with a
  REMOVED note (`responseFormat`'s three child rows collapse into its one row);
  the generated `state-counts.md` moves `rest_api` from 14 to 12 dead; the
  reference page for `rest-server` is regenerated.

<!-- adr-0087: registered rest-api-config-dead-keys-retired -->
