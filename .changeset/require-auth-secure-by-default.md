---
"@objectstack/spec": major
"@objectstack/rest": major
"@objectstack/verify": patch
"@objectstack/cli": patch
---

feat(security)!: `api.requireAuth` now defaults to `true` — anonymous access to the data API is denied by default (ADR-0056 D2 flip)

**BREAKING.** The global `requireAuth` default flipped FROM `false` TO `true`
(`RestApiConfigSchema.requireAuth` in `@objectstack/spec`, mirrored by
`RestServer.normalizeConfig` in `@objectstack/rest`). Anonymous requests to
the `/data/*` CRUD + batch endpoints are now rejected with HTTP 401 unless the
deployment explicitly opts out. (Scope note: this gate covers the REST
`/data/*` surface — the metadata read/write endpoints and the dispatcher
GraphQL route have their own pre-existing anonymous posture, tracked
separately; this flip does not change them.)

**Migration (one line):** a deployment that intentionally serves data publicly
(demo / playground / kiosk) sets the flag on the stack config — now a declared
`ObjectStackDefinitionSchema.api` field, so it survives `defineStack` strict
parsing (previously an undeclared top-level `api` key was silently stripped):

```ts
export default defineStack({
  // …
  api: { requireAuth: false },
});
```

The REST plugin logs a boot warning for the explicit opt-out so a fail-open
posture is always visible. A misplaced `api.requireAuth` at the plugin level
(one nesting short) is now also called out with a boot warning instead of
being silently ignored.

**What keeps working with no action:**

- **Share links** — validate their token, then read under a system context.
- **Public forms** — self-authorizing via the declaration-derived
  `publicFormGrant` (create + read-back on the declared target object only);
  no `guest_portal` profile needed.
- **Control plane** — `/auth`, `/health`, `/discovery` are exempt.
- **`objectstack serve` with an auth-less stack** — the CLI passes an explicit
  `requireAuth: false` for stacks whose tier set has no `auth` (nothing could
  authenticate against them), with the boot warning.
