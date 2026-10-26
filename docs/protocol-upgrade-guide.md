# Metadata protocol upgrade guide

This file is a pointer, plus the one note that must not wait for the site. The guide is generated from the ADR-0087 registries and is not committed; published READMEs and CHANGELOGs name this path, so it stays here and names where the guide lives.

## Upgrading from protocol 16 or earlier

One major at a time, each major's CLI in turn — a major's CLI carries the steps for itself and the major before it, so the same sequence holds at 19:

```bash
npx @objectstack/cli@17.7.0 migrate meta --from 16 --apply   # 16 → 17, on the last 17.x release (its floor is 16)
npx @objectstack/cli@17.7.0 migrate meta --stored --apply    # the sys_metadata rows, BEFORE the runtime moves
# move the dependencies / the deployment's image to 18.2, then
os migrate meta --from 17 --apply                             # 17 → 18
os validate && os build
```

**Alternative, one shot:** `@objectstack/cli@18.1.0` is the last release whose floor is 16, so `npx @objectstack/cli@18.1.0 migrate meta --from 16` (then `--apply`) runs both hops in one command — work the to-do list it prints, then move the dependencies to 18.2 and run `os migrate meta --from 17`, `os validate` and `os build`; its `migrate meta --stored --apply` canonicalizes the stored rows the same way.

**Stored metadata (`sys_metadata`, Studio-authored) is migrated BEFORE the deployment's image or dependencies move to 18.2.** 18.2 no longer rewrites a ≤16.x row at read: a row left behind is refused by the strict parse until it is migrated.

**If the first hop is skipped:** on 18.2, `os migrate meta --from 16` refuses with `MigrationFloorError` and rewrites nothing, and a key retired at or below 16.x meets the strict unknown-key refusal naming this guide.

## Where the guide lives

**Address:** the docs site, one page per protocol major.

- Every major: https://objectstack.ai/docs/protocol-upgrade
- Protocol 17 → 18: https://objectstack.ai/docs/protocol-upgrade/18

Protocol N's page is `https://objectstack.ai/docs/protocol-upgrade/N`, so a link to one major keeps resolving after the next major opens. The site builds from `main`, so each page says whether its major is released, in prerelease, or not released yet. A hop leaves the site when the migration chain's support floor rises past it, which happens at every major cut since ADR-0087's 2026-10-26 amendment (#25767): the floor is one major below the current one, so the 16 → 17 hop left with the 16.x retirement kits at 18. The schema's strict unknown-key refusal links every retired key here, and a kit's prescription lives in the release that carried it (its CHANGELOG, and the generated guide shipped in that `@objectstack/spec` release).

**The copy a release shipped:** every `@objectstack/spec` release after 17.7.0 carries `protocol-upgrade-guide.md` in the package (`node_modules/@objectstack/spec/protocol-upgrade-guide.md`) and attached to its `@objectstack/spec@VERSION` GitHub Release.

**Generating it:** `pnpm --filter @objectstack/spec gen:upgrade-guide` writes the docs pages into `content/docs/protocol-upgrade/` (gitignored; the docs build runs it). `pnpm --filter @objectstack/spec exec tsx scripts/build-upgrade-guide.ts --out FILE` writes the single-file guide the package ships.
