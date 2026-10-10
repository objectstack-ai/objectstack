# @objectstack/skills

**The ObjectStack skills catalog, shipped at the version of the packages it teaches.**

This package contains nothing but `dist/skills/`: a byte-for-byte copy of the
[`skills/`](https://github.com/objectstack-ai/objectstack/tree/main/skills) tree
of the `objectstack-ai/objectstack` repository — one directory per skill, each
with its `SKILL.md`, `references/`, `rules/` and `evals/` — taken at the commit
that released this version.

It is published from the Changesets `fixed` group, so its version is always the
version of `@objectstack/spec`, `@objectstack/cli` and every other
`@objectstack/*` package released with it. A project that depends on
`@objectstack/skills@17.7.0` reads the skills written for `@objectstack/spec`
17.7.0 — never the ones already teaching the next major, and never a catalog
that has moved on since the project was created.

## Installing the skills into an agent's directory

The catalog is read from `node_modules`, so it follows the version the project
depends on. With this package in `devDependencies`, the
[skills CLI](https://www.npmjs.com/package/skills) syncs it into the detected
agent's own skills directory (`.claude/skills/` for Claude Code, and so on):

```sh
npm install --save-dev @objectstack/skills
npx skills experimental_sync
```

`experimental_sync` discovers the skills at `dist/skills/<skill>/SKILL.md` of
every dependency and links or copies them for the agent runtimes it detects
(`--agent <name>` names one; `--copy` copies instead of linking). Re-running it
after `pnpm up @objectstack/skills` — which moves with the rest of the
`@objectstack/*` set — refreshes the installed catalog.

`npm create objectstack` scaffolds projects with this package as their catalog
source, and the ObjectStack docs give this package-based command as the
install path.

## The `next` channel

The repository's `skills/` tree on `main` is the catalog of the **next**
release. `npx skills add objectstack-ai/objectstack/skills --skill '*' --agent claude-code -y`
reads it directly from GitHub — for trying the skills of the version that is
not published yet, not for a released project.

## How the tree is produced

`scripts/sync-catalog.mjs`, this package's `build`, wipes `dist/` and copies the
repository's `skills/**` into `dist/skills/**`, reads the copy back and
refuses to finish unless the two trees are equal, file for file and byte for
byte. Its `prepack` runs the same comparison, so a stale or absent copy is never
packed. The copy is gitignored; the repository's `skills/**` is the one source
of truth, reviewed and gated there.

## Related

- [Skills reference](https://objectstack.ai/docs/ai/skills-reference) — every skill in the catalog, with what it covers.
- [`@objectstack/spec`](https://www.npmjs.com/package/@objectstack/spec) — the schemas the skills point at (`node_modules/@objectstack/spec/src/**/*.zod.ts`), shipped at the same version.
