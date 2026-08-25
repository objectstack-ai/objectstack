---
'@objectstack/rest': minor
---

**BREAKING (accept-set tightening)**: `RestServer` now parses `config.api`
against `RestApiConfigSchema` at construction instead of casting to it, so a
deployment whose `api` config the spec rejects fails loudly at boot rather than
booting into a structurally broken URL space (#11637).

The regex was always declared. `packages/spec/src/api/rest-server.zod.ts`
constrains `version: z.string().regex(/^[a-zA-Z0-9_\-\.]+$/).default('v1')`, and
`version` is spliced into `getApiBasePath()` — the base of **every** route this
server mounts. Nothing ran it: both hops into `@objectstack/rest` are casts
(`config.api as any` in `rest-api-plugin.ts`, then `as Partial<RestApiConfig>`
in `normalizeConfig`), the plugin declares no `configSchema`, and the kernel's
`PluginConfigValidator` could not have covered it either — `PluginLoader`
invokes its own `validatePluginConfig(metadata)` with **no config argument** and
returns early, and `createRestApiPlugin` closes over its config so the kernel
never receives it. `??` was the only guard left, and `??` substitutes
`null`/`undefined` only. Measured on the pre-fix code: `api.version: ''`
constructed happily and mounted the whole API — `/data`, `/meta`, `/discovery`,
`openapi.json` — under `/api//`.

**Newly refused, all at `new RestServer(...)` / `createRestApiPlugin().start()`:**

- `api.version: ''` — the reported case. Refused with
  `Invalid string: must match pattern /^[a-zA-Z0-9_\-\.]+$/`.
- `api.version` carrying any character outside `[a-zA-Z0-9_-.]` — `'v1/beta'`
  (which spliced an extra path segment into every route), `'v1 beta'`, `'v1%2F'`
  and so on.
- `api.projectResolution` outside `'required' | 'optional' | 'auto'` — same
  seam, same cast, equally unenforced until now.
- A declared key written with the wrong type: `api.enableCrud: 'yes'`,
  `api.basePath: 42`, a malformed `api.documentation` / `api.responseFormat`.

**Deliberately NOT refused** — the narrowing is exactly what the schema
declares, and no more:

- `api.requireAuth`. The retired key (#3963) is `.omit()`ed from the
  validation: it keeps the warn-and-ignore posture `rest-api-plugin.ts` gives
  it, and `tsc` still refuses it at any typed authoring site. Converting that
  warn into a boot failure is #3963's decision to make, not this seam's.
- Keys no schema in `packages/spec` declares, `api.enableSearch` first among
  them. The parse is run for its verdict only and its output is **discarded** —
  `RestApiConfigSchema` is not `.strict()`, so a non-strict `z.object()` strips
  what it does not declare, and consuming the parsed value would have silently
  turned search back on for a deployment that turned it off.
- `api.basePath: ''` — a bare `z.string()` with no declared constraint stays
  accepted.
- `crud`, `metadata`, `batch` and `routes`. Those sub-objects are still cast,
  not parsed, and carry unenforced constraints of their own
  (`batch.maxBatchSize: z.number().int().min(1).max(1000)`, the
  `routes.nameTransform` enum). Same defect class, filed separately — this
  change deliberately puts one narrowing in front of contract review, not five.

**Migration.** Delete or correct the offending key; the refusal names the path,
the declared rule that rejected it, and why an empty version is not survivable.
A deployment that meant "no version segment" wants `api.apiPath: '/api'`, which
sets the base outright and is unconstrained.

**In-repo blast radius, measured before shipping:** exactly one in-repo site
constructed a server this parse refuses — the `rest-openapi-route.test.ts` pin
for a falsy `api.version`, which carried its own written instruction to retire
if normalization ever started rejecting it, and is replaced here by a pin on the
refusal. The 96 fixtures passing the retired `api.requireAuth` are unaffected by
design, as are `packages/cli`'s `os serve` composition and the `@objectstack/client`
integration boots. Full `@objectstack/rest` suite: 146 files, 2354 tests, green.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed or renamed — no spec key, export or config field changes spelling, and `RestApiConfigSchema` itself is untouched. What changes is that the schema already declaring `api.version` is finally executed at the consumption seam, so `objectstack migrate meta` has no mechanical rewrite to list: a config carrying `version: ''` or `'v1/beta'` states an intent (which path segment did you mean?) that no conversion can decide for the author, and the refusal text names the fix at the call site. -->
