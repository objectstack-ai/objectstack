---
"@objectstack/metadata-core": minor
"@objectstack/plugin-security": minor
"@objectstack/runtime": minor
"@objectstack/rest": minor
---

feat(meta): object schemas served by `/meta` and `/metadata` are masked per caller (ADR-0106, #3682)

The data plane has enforced field-level security everywhere it matters for
several releases — list reads mask values, exports project columns, and the
write path 403s forbidden fields. The **metadata** plane did not: any
authenticated caller who asked `GET /meta/object/:name` received the full object
schema, including fields they have no read access to at all.

That is more than a list of names. A field carries its label, type, **picklist
option values** (often a sensitive operational taxonomy), its **formula**
expression (pricing and scoring IP), its `visibleWhen` predicate, its
`defaultValue`, and — via ADR-0066 D3 — the `requiredPermissions` capability
names guarding it. For a customer running a dealer, supplier or patient portal
on ObjectStack, the only remediation available in their own tier was modelling
discipline: keep sensitive fields off portal-visible objects, or split one
business entity into an internal object and a portal object and synchronize
them. This is a platform-side fix, so every deployment inherits it.

**What changes.** Serving an object schema now projects `fields` onto the set
the caller may read, and a field outside that set is removed **whole** — no
name, no label, no options, no formula, no `requiredPermissions`. Partial
redaction was rejected: keeping the name still leaks existence and invites
clients to render ghost columns. Masking keys on the `readable` bit only; a
readable-but-not-editable field stays in the schema, because the UI must render
it and the `editable` affordance is already served per caller by
`/auth/me/permissions`.

Every outlet that serves an object schema goes through one shared projection,
so coverage is not a per-route promise:

- `GET /meta/object/:name` — the cached branch (the default) **and** the
  uncached branch, which is what `?state=draft`, `?preview=draft` and
  `?package=` take;
- `GET /meta/object/:name?layers=true` — the layered diagnostic view, all three
  of `code` / `overlay` / `effective`;
- `GET /meta/:type/:section/:name` — the compound-name read;
- `GET /meta/object` — the list read, each item projected independently;
- the runtime `/metadata` catch-all — the protocol-backed, registry-backed and
  last-ditch single reads, the `/metadata/objects` list (protocol and registry),
  and the legacy one-segment `/metadata/:objectName` spelling.

**Caching is unchanged in cost and correct per cohort.** The shared metadata
cache still stores one full schema per (type, name, locale, environment) — no
caller dimension in the key — and the mask runs after retrieval. What varies
per caller is the validator: a stable hash of the caller's *denied* field set is
folded into the ETag. A caller who can read everything denies nothing, so their
fingerprint is empty and both their ETag and their response body are
**byte-identical** to previous releases. Callers in one permission cohort share
`304`s; a permission change moves the fingerprint and self-invalidates the stale
`304`, so nothing needs purging after a permission-set edit.

**Exemptions** are a property of the caller, not of the route: `isSystem` and
platform-admin callers (holders of `studio.access` / `setup.access`, the same
judgement the app filter uses) receive the full schema on any route, because
Studio and Setup authoring cannot work against a projected schema.

**Failure posture is explicit and three-tiered.** With no `security` service
registered the schema is served unmasked — that deployment has no FLS posture at
all and tightening only the metadata plane would be theater. When field
visibility cannot be *determined* (a registry-hydration window), the schema is
served unmasked but loudly: a structured warning, a new
`objectstack_meta_field_visibility_undetermined_total` counter, and a response
downgraded to `Cache-Control: private, no-store` with no shared ETag. Failing
closed there would brick every render of the object for every user and can
deadlock console bootstrap, since permission sets are themselves metadata. When
permission evaluation **throws**, the request fails with `503
FIELD_VISIBILITY_UNRESOLVED` — an unhealthy security service must not auto-open
a disclosure hole, and an empty-fields `200` would be both a silently wrong UI
and cacheable poison.

**Guest and public deployments** get a deliberate posture rather than an
accidental one: `@objectstack/plugin-security` gains
`getMetadataReadableFields`, which resolves the configured fallback permission
set (`security.fallbackPermissionSet`, default `member_default`) for a caller
who resolves to zero sets, exactly as `/auth/me/permissions` does.
`getReadableFields` is unchanged — on the data plane, mirroring the engine
middleware's fall-open is what keeps it drift-free.

**Escape hatch.** Masking is the platform default. A deployment that explicitly
wants an unmasked metadata plane sets `OS_ALLOW_UNMASKED_OBJECT_METADATA=1`, or
`metadata.maskObjectFields: false` on the REST server. Toggling it changes
disclosure only: the console reads every field affordance from
`/auth/me/permissions`, so UI correctness is unaffected either way.

Operators fronting the runtime with a CDN or reverse proxy should read the new
"CDN / reverse-proxy caching of `/meta` object schemas" section in the
production-readiness guide before tuning anything — in particular, do not
configure a proxy to ignore `Cache-Control: private`, and do not strip or
rewrite `ETag` on these routes.
