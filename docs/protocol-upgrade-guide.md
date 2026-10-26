# Metadata protocol upgrade guide

This file is a pointer. The guide is generated from the ADR-0087 registries and is not committed; published READMEs and CHANGELOGs name this path, so it stays here and names where the guide lives.

**Address:** the docs site, one page per protocol major.

- Every major: https://objectstack.ai/docs/protocol-upgrade
- Protocol 17 → 18: https://objectstack.ai/docs/protocol-upgrade/18

Protocol N's page is `https://objectstack.ai/docs/protocol-upgrade/N`, so a link to one major keeps resolving after the next major opens. The site builds from `main`, so each page says whether its major is released, in prerelease, or not released yet. A hop leaves the site when the migration chain's support floor rises past it, which happens at every major cut since ADR-0087's 2026-10-26 amendment (#25767): the floor is one major below the current one, so the 16 → 17 hop left with the 16.x retirement kits at 18. The schema's strict unknown-key refusal links every retired key here, and a kit's prescription lives in the release that carried it (its CHANGELOG, and the generated guide shipped in that `@objectstack/spec` release).

**The copy a release shipped:** every `@objectstack/spec` release after 17.7.0 carries `protocol-upgrade-guide.md` in the package (`node_modules/@objectstack/spec/protocol-upgrade-guide.md`) and attached to its `@objectstack/spec@VERSION` GitHub Release.

**Generating it:** `pnpm --filter @objectstack/spec gen:upgrade-guide` writes the docs pages into `content/docs/protocol-upgrade/` (gitignored; the docs build runs it). `pnpm --filter @objectstack/spec exec tsx scripts/build-upgrade-guide.ts --out FILE` writes the single-file guide the package ships.
