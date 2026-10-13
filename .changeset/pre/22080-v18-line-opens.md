---
"@objectstack/spec": major
---

The v18 line opens (ADR-0131; #22050). Every release from here is an `18.0.0-next.N` prerelease on the npm dist-tag `next`, until 18.0 GA.

Clause-②: no

- **What this marks.** Changesets is in pre mode with the tag `next`. Every `@objectstack/*` package versions together, so this one `major` takes all of them to 18, and the first version cut is `18.0.0-next.0`. `PROTOCOL_VERSION` follows `@objectstack/spec`'s major at version time, so it reads `18.0.0` from that prerelease on. The marker itself changes no code, key, export or stored shape.
- **What the line carries.** ADR-0131 (organization ownership is total: no NULL `organization_id`) lands on this line in stages. Each stage that breaks something says so in its own changeset, with its own migration.
- **Who receives it.** A plain install still resolves the dist-tag `latest`, which stays on 17.x until 18.0 GA. A prerelease is installed only on request: `@objectstack/spec@next`, or an exact `18.0.0-next.N`.
- **What ends it.** 18.0 GA exits pre mode and publishes to `latest`.

<!-- adr-0087: not-required (no-migration-prescription) the v18 line's opening marker: Changesets pre mode plus one major on the fixed group, so the train versions 18.0.0-next.N. No authorable key, spelling, export, type or stored shape moves in this diff, and no stored row is read, rewritten or converted; each breaking stage of the line states its own disposition in its own changeset. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no TypeScript declaration moves (not runtime-interface-only or type-surface-only). -->
