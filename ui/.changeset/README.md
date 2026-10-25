# Changesets

This directory contains changeset files that track changes to packages in the Object UI monorepo.

## What are Changesets?

Changesets are a way to declare your intent to release packages. They help us:
- Track which packages have changed
- Determine appropriate version bumps (major, minor, patch)
- Generate comprehensive changelogs
- Automate the release process

## Quick Start

### Creating a Changeset

When you make changes to packages, run:

```bash
pnpm changeset
```

This will guide you through:
1. Selecting which packages changed
2. Choosing the type of version bump
3. Writing a description of the changes

### Example

```bash
$ pnpm changeset

🦋  Which packages would you like to include?
◉ @object-ui/react
◯ @object-ui/core
◯ @object-ui/components

🦋  What kind of change is this for @object-ui/react?
◯ major (breaking change)
◉ minor (new feature)
◯ patch (bug fix)

🦋  Please enter a summary for this change:
Add support for custom validators in form components
```

### ⚠️ Rename the generated file — don't ship the `adjective-animal-verb` name

`pnpm changeset` writes the file above under a randomly generated name like
`olive-donkeys-smile.md`. **Before committing it, rename it to
`.changeset/<issue>-<slug>.md`** — the issue number the change settles, a short
slug, `.md` (e.g. `6439-changeset-naming-readme.md`).

**Why this matters, not just style:** `pnpm changeset` allocates its
`adjective-animal-verb` names against the files *already present* in this
directory, so it cannot collide. A hand-picked or copy-pasted name has no such
guarantee — pick one that another pending changeset already uses and you
**overwrite that file**, silently deleting a third party's release
declaration. The cost lands on them, not you, and nothing catches it at the
time: `git status` shows ` M` (modified) rather than `??` (untracked), so it
reads like your own new file landing, and a deleted release declaration is
flagged by nothing downstream — the affected package simply never gets
bumped (objectui#6336). An issue-number-prefixed name cannot collide with
another pending changeset, because no two open issues share a number.

A report-only gate (`scripts/check-changeset-overwrite.mjs`, wired into
`changeset-guard.yml`) flags it after the fact if this still happens — but by
then the damage (a silently dropped release declaration) is already done.
Renaming the file before you commit is what actually prevents it.

### When to Create a Changeset

✅ **DO** create a changeset for:
- New features
- Bug fixes
- Breaking changes
- Performance improvements
- API changes

❌ **DON'T** create a changeset for:
- Documentation updates
- Changes to examples or apps
- Internal refactoring with no API changes
- Test-only updates

## Automated Release Process

1. **Merge PR with changeset** → Triggers automation
2. **Bot opens or refreshes the release PR** → Updates versions and changelogs
3. **Merge the release PR** → Automatically publishes to npm

**Find that release PR by its head branch, never by its title.** The
[Changesets action](https://github.com/changesets/action) derives the head branch
from the base branch — `changeset-release/main` here — so it is a convention that
holds in every repository running the action:

```text
is:pr is:open head:changeset-release
```

The title is not a convention. It is the `title:` input this repository passes to
the action in
[`.github/workflows/changeset-release.yml`](../.github/workflows/changeset-release.yml),
so it is repository-local configuration and differs between repositories. Read
that input when you need the current title instead of memorising one.

## Learn More

- [Full Changesets Documentation](https://github.com/changesets/changesets)
- [Object UI Contributing Guide](../CONTRIBUTING.md#versioning-and-releases)
- [Common Questions](https://github.com/changesets/changesets/blob/main/docs/common-questions.md)

