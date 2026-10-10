# Metadata protocol upgrade guide

This file is a pointer. The guide is generated from the ADR-0087 registries and is not committed; published READMEs and CHANGELOGs name this path, so it stays here and names where the guide lives.

**Address:** the docs site, one page per protocol major.

- Every major: https://objectstack.ai/docs/protocol-upgrade
- Protocol 16 → 17: https://objectstack.ai/docs/protocol-upgrade/17
- Protocol 17 → 18: https://objectstack.ai/docs/protocol-upgrade/18

Protocol N's page is `https://objectstack.ai/docs/protocol-upgrade/N`, so a link to one major keeps resolving after the next major opens. The site builds from `main`, so each page says whether its major is released, in prerelease, or not released yet. A hop leaves the site only when the migration chain's support floor rises past it (ADR-0087 D3).

**The copy a release shipped:** every `@objectstack/spec` release after 17.7.0 carries `protocol-upgrade-guide.md` in the package (`node_modules/@objectstack/spec/protocol-upgrade-guide.md`) and attached to its `@objectstack/spec@VERSION` GitHub Release.

**Generating it:** `pnpm --filter @objectstack/spec gen:upgrade-guide` writes the docs pages into `content/docs/protocol-upgrade/` (gitignored; the docs build runs it). `pnpm --filter @objectstack/spec exec tsx scripts/build-upgrade-guide.ts --out FILE` writes the single-file guide the package ships.
