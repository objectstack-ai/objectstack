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
`@objectstack/skills` at the version of its `@objectstack/spec` reads the skills
written for that spec — never the ones already teaching the next major, and
never a catalog that has moved on since the project was created.

## Installing the skills into an agent's directory

The catalog is read from `node_modules`, so it follows the version the project
depends on. Install it at the version of the `@objectstack/spec` your project
has installed — the catalog's version is then your spec's — and let the
[skills CLI](https://www.npmjs.com/package/skills) sync it into your coding
agent's own skills directory (`.claude/skills/` for Claude Code, and so on):

```sh
# 1 · the catalog, at the version of your installed @objectstack/spec
npm install --save-dev "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"

# 2 · link it from node_modules into your agent's skills directory
npx skills experimental_sync --agent claude-code -y
```

`experimental_sync` discovers the skills at `dist/skills/<skill>/SKILL.md` of
every dependency and links each one into the named agent's skills directory
(`--agent <name>` names the runtime — `codex`, `cursor`, …; `--copy` writes real
files instead of links). Keep the version in step 1: a bare
`npm install --save-dev @objectstack/skills` installs whichever version the
registry tags `latest`, not your spec's.

**Updating.** The catalog moves only with your ObjectStack version: bump
`@objectstack/skills` with the other `@objectstack/*` packages, then re-run the
sync (step 2, same flags).

**Which versions exist.** The package is published from `18.0.0-next.0` on;
there is no 17.x release of it, so on a project whose `@objectstack/spec` is
17.x step 1 refuses with `ETARGET` (`No matching version found`).

**Projects scaffolded by `create-objectstack`.** Through `18.0.0-next.0` the
scaffolder installs the skills from the `next` channel below with `skills add`,
and step 2 skips every skill a `skills add` installed (it prints `Skipped …
installed with skills add`). Remove them first — `npx skills remove --all`, or
name the `objectstack-*` skills if you added others — then run steps 1 and 2.

## The `next` channel

The repository's `skills/` tree on `main` is the catalog of the **next**
release. `npx skills add objectstack-ai/objectstack/skills --skill '*' --agent claude-code -y`
reads it straight from the repository's unreleased `main` — for trying the next
version's skills, not for a released project.

## How the tree is produced

`scripts/sync-catalog.mjs`, this package's `build`, wipes `dist/` and copies the
repository's `skills/**` into `dist/skills/**`, reads the copy back and
refuses to finish unless the two trees are equal, file for file and byte for
byte. Its `prepublishOnly` runs the same comparison, so a stale or absent copy is
never published. The copy is gitignored; the repository's `skills/**` is the one source
of truth, reviewed and gated there.

## Related

- [Skills reference](https://objectstack.ai/docs/ai/skills-reference#installing-skills) — every skill in the catalog, with what it covers, and the install reference.
- [`@objectstack/spec`](https://www.npmjs.com/package/@objectstack/spec) — the schemas the skills point at (`node_modules/@objectstack/spec/src/**/*.zod.ts`), shipped at the same version.
