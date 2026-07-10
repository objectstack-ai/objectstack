---
'@objectstack/spec': minor
'@objectstack/rest': minor
'@objectstack/plugin-security': minor
'@objectstack/lint': minor
'@objectstack/metadata': minor
'@objectstack/platform-objects': patch
---

ADR-0090 follow-through wave: enforce book audience at the read layer; finish the D2/D3 cleanup the P1 rename missed.

- **rest**: `/meta/book`, `/meta/doc`, and `/meta/book/:name/tree` now ENFORCE
  the ADR-0046 §6.7 audience model (ADR-0049 — no unenforced security
  properties): anonymous callers see only `public` books/docs;
  `{ permissionSet }`-gated books require the caller to hold the named set;
  a doc's effective audience is the union over the books that CLAIM it
  (unclaimed docs default to `org`; orphan rendering never inherits `public`).
  Gated evaluation fails CLOSED when holdings cannot be resolved. `doc`/`book`
  single-item reads bypass the shared meta cache (per-caller gate vs shared ETag).
- **spec**: new pure helpers powering that gate — `audienceAllows`,
  `resolveDocAudiences`, `docAudienceAllows`, `resolveBookClaimedDocs`
  (+ `AudienceCaller`/`AudienceBook` types). BREAKING but ships as a `minor`
  per the launch-window convention (pre-1.0 semantics — breaking changes do
  not burn a major version number while the whole stack is in lockstep):
  `METADATA_FORM_REGISTRY` keys `role`/`profile` are gone — `position` is the
  registered form (the `position` type had LOST its form layout in the P1
  rename); `EnvironmentArtifactMetadataSchema` declares `positions` instead of
  retired `roles`/`profiles`.
- **plugin-security**: the `security` service exposes
  `resolvePermissionSetNames(ctx)` — the same resolution as data-plane
  enforcement, for the docs gate.
- **metadata**: artifact ingestion maps `positions → 'position'` (the stale
  `roles → 'role'` mapping matched nothing since the P1 rename, silently
  dropping compiled positions from metadata registration).
- **lint**: books join the D3 role-word scan (their `audience` is a
  permission-model reference now), and a new advisory rule
  `security-book-audience-unknown-set` flags a `{ permissionSet }` audience
  naming a set the stack does not declare (runtime fails closed — the typo
  cost is "nobody can read the book", so say it at author time).
- **platform-objects**: metadata-form translations regain `position` (all four
  locales) and drop the retired `role`/`profile` groups, with a vocabulary
  regression test.
