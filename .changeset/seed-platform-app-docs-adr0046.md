---
"@objectstack/setup": patch
"@objectstack/studio": patch
---

feat(ADR-0046): seed first-party package docs for the Setup and Studio apps

A fresh platform install shipped **no** first-party `doc` metadata, so the
in-product documentation hub (`/_console/docs`) opened completely empty and the
ADR-0046 feature had zero reference implementation. This seeds a deliberately
minimal first version — one short overview per built-in app — so the hub is
non-empty out of the box and there is a worked example to copy.

- `@objectstack/setup` registers `setup_overview` (for administrators: users &
  authentication, the roles & permissions model, and record visibility/sharing).
- `@objectstack/studio` registers `studio_overview` (for builders: the
  metadata-first model, the invisible draft/overlay precedence rule per
  ADR-0005/ADR-0033, and publish vs deploy).

Both follow the HotCRM principle — document the *invisible* business logic, not
what the UI already shows — and link to <https://docs.objectstack.ai> for depth.

Mechanism note: these are TS-first code packages built by `tsup`, not user apps
built by `os build`, so they do **not** go through the flat `src/docs/*.md`
collection + lint. The docs are declared inline as `Doc` items on each package's
`manifest.register({ docs })` call — the path `DocSchema` explicitly blesses for
TS-first stacks. They register under their owning package id, so the docs hub
groups them under Setup and Studio respectively. No framework change was needed.
