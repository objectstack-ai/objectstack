---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": patch
"@objectstack/example-showcase": patch
---

feat(spec,sharing): canonical OWD vocabulary on `object.sharingModel` (ADR-0056 D1)

Reconciles the Org-Wide-Default naming so authors use ONE vocabulary. `object.sharingModel`
now accepts the canonical OWD names — `private` | `public_read` | `public_read_write` |
`controlled_by_parent` — alongside the legacy `read` / `read_write` / `full` aliases (kept,
non-breaking). The sharing runtime maps them onto the three enforced behaviours
(`public_read` ≡ legacy `read` = everyone reads / owner writes; `public_read_write` =
unscoped). Unknown values remain rejected by the enum (authoring-time, fail-closed). The
showcase announcement now declares the canonical `public_read`, exercised end-to-end by the
public-read dogfood proof.
