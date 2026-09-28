---
'@objectstack/spec': minor
'@objectstack/rest': minor
---

feat(spec,rest)!: the served OpenAPI `info` carries the publisher's `api.documentation` identity; `api.documentation.version` retired (#20294)

Clause-②: yes (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
never by the level). The breaking half is one key: `api.documentation.version`.

`RestServerConfig.api.documentation` (`RestApiConfigSchema`) declared nine
members, and `RestServer` parsed them, copied them into its config — and never
read them back. Measured before this change, with every member authored: both
doors that serve the OpenAPI document (`{apiPath}/openapi.json` and its
environment-scoped twin) answered the bundled artifact's `info` unchanged, 0 of 9
honoured. ADR-0049 enforce-or-remove, split by who owns each field:

- **Enforced — the publisher's identity.** `title`, `description`,
  `termsOfService`, `contact` (`name` / `url` / `email`) and `license` (`name` /
  `url`) now overlay the served `info` on both doors. A member you leave unset
  keeps the bundled value, and a config with nothing authored — no block,
  `documentation: {}` — serves `info` byte-identical to
  `@objectstack/spec/openapi.json`, exactly as before. `contact` and `license`
  replace the bundled object **whole**: `license: { name: 'MIT' }` serves
  `{ name: 'MIT' }` with no URL, never MIT at the bundled Apache-2.0 URL, and a
  partial `contact` never keeps ObjectStack's name or URL.
- **Retired — `documentation.version`.** The served `info.version` is the
  protocol version, the version of the `@objectstack/spec` package that generated
  the document, with no configured override: an earlier ruling made it equal the
  published artifact's so an integrator can read which protocol version they are
  talking to. A publisher-set version would give the field a third meaning, so
  the key is now refused.

```
FROM  new RestServer(server, protocol, { api: { documentation: { title: 'Acme Orders API', version: '2.3.0' } } })
      -> constructed; GET /api/v1/openapi.json served info.title 'ObjectStack REST API'
         and info.version = the spec version — both authored values ignored
TO    -> throws: REST API configuration is invalid: `api` does not satisfy
         `RestApiConfigSchema` …
           - api.documentation.version: `api.documentation.version` was removed in
             @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — … Delete the key. To publish
             your app's own release number, write it into `api.documentation.description`, …

FROM  new RestServer(server, protocol, { api: { documentation: { title: 'Acme Orders API' } } })
      -> GET /api/v1/openapi.json: info.title 'ObjectStack REST API'
TO    -> GET /api/v1/openapi.json: info.title 'Acme Orders API' (and on the environment-scoped door)

FROM  RestApiConfigSchema.parse({ documentation: { description: 'd' } }).documentation
      -> { title: 'ObjectStack API', description: 'd' }   // a default no document ever served
TO    -> { description: 'd' }
```

**Fix.** `api.documentation.version` → delete the key. The served
`info.version` is always the protocol version; to publish your app's own release
number, write it into `api.documentation.description`. `tsc` refuses the key at
the authoring site (its input type is `never`), and `RestServer` construction and
the REST plugin's `start` refuse it with that prescription.

**What else changes.** `documentation.title` is `.optional()` instead of
`.default('ObjectStack API')`: that default was materialized into every present
block and never served, so the parsed block now carries exactly what was
authored (the parsed `title` is typed `string | undefined` now). `api.version` (the route identifier) and the runtime version still
never reach `info.version`. A host that authors none of these keys — every
CLI-started deployment, since `os serve` forwards only `enableProjectScoping`
and `projectResolution` — serves the same document as before.

### The kit

- **Schema.** The eight identity members carry describes naming the served
  `info` field; `version` is a `retiredKey()` tombstone inside the live
  `documentation` block (a non-strict `z.object()`, so a bare deletion would have
  stripped it in silence), next to the `enabled` tombstone.
- **REST server.** `registerOpenApiEndpoints` builds `info` through a pure
  helper that returns a NEW object — the cached artifact's own `info` is never
  written — and the same handler serves both doors.
- **ADR-0087.** `RETIRED_KEYS_BY_MAJOR[18]` gains
  `api/RestApiConfig:documentation.version`; the D3 entry
  `rest-api-documentation-version-retired` carries the prescription to
  `os migrate meta` and the upgrade guide. No D2 conversion: a `RestServerConfig`
  is plugin TS configuration, never a stack collection member or a stored row.
- **Ledger and docs.** `liveness/rest_api.json`: the eight identity leaves and
  the `contact` / `license` containers flip to `live` with the overlay as
  evidence; the `version` row stays `dead` with a REMOVED note. The generated
  `state-counts.md` moves `rest_api` from 12 live / 12 dead to 20 / 4; the
  `rest-server` reference page is regenerated.

<!-- adr-0087: registered rest-api-documentation-version-retired -->
