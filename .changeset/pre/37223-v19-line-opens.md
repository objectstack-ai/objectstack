---
"@objectstack/spec": major
---

The v19 line opens (maintainer rulings 7153326968 and 7153441862). Every release from here is a `19.0.0-next.N` prerelease on the npm dist-tag `next`, until 19.0 GA.

Clause-②: no

- **What this marks.** Changesets is in pre mode with the tag `next`. Every package in the `fixed` group versions together, so this `major` takes all of them to 19, and the first version cut is `19.0.0-next.0`. `PROTOCOL_VERSION` moves to 19 ahead of the version pass, in its own changeset. The marker itself changes no code, key, export or stored shape.
- **What the line carries.** Each breaking change on the line says so in its own changeset. The first change graded `major` is `@object-ui/i18n`'s retirement of the translation keys 18.6.0 shipped and no code reads any more; a second `major` in the same `fixed` group still gives one 19.0.0.
- **Who receives it.** A plain install still resolves the dist-tag `latest`, which stays on 18.x until 19.0 GA. A prerelease is installed only on request: `@objectstack/spec@next`, or an exact `19.0.0-next.N`.
- **What ends it.** 19.0 GA exits pre mode and publishes to `latest`.

<!-- adr-0087: not-required (no-migration-prescription) the v19 line's opening marker: Changesets pre mode plus one major on the fixed group, so the train versions 19.0.0-next.N. No authorable key, spelling, export, type or stored shape moves in this changeset, and no stored row is read, rewritten or converted; each breaking change of the line states its own disposition in its own changeset. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no TypeScript declaration moves (not runtime-interface-only or type-surface-only). -->
