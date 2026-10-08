# Contributing to ObjectStack

Thank you for your interest in contributing to ObjectStack! This repository is the
whole open stack, not only the protocol: the Zod protocol (`packages/spec`), the
microkernel, the runtime, the drivers, plugins and services, the CLI, the client SDK,
the example apps and the documentation site. This guide takes you from a fork to a
pull request.

**[AGENTS.md](./AGENTS.md) is the rulebook, for human contributors and coding agents
alike.** It holds naming, the Zod-first and contract-first rules, the documentation
guardrails and the changeset rules. This file does not restate them. Where a rule
matters, it points you to AGENTS.md, and if the two ever disagree, AGENTS.md wins.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Making a Change](#making-a-change)
- [Where Things Live](#where-things-live)
- [Pull Request Process](#pull-request-process)
- [Community](#community)

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please read the
[Code of Conduct](./CODE_OF_CONDUCT.md) and be respectful and professional in all
interactions.

## Getting Started

### Prerequisites

- **Node.js** 22 or later (`engines.node` in the root `package.json`)
- **pnpm 10**. `corepack enable` installs the exact version the root `package.json`
  pins in `packageManager`, and a pnpm 10 you installed yourself switches to that
  pinned version inside this repository. pnpm 8 and 9 cannot install this workspace:
  pnpm 8 refuses the lockfile, and pnpm 9 stops a frozen install on the `overrides`
  that live in `pnpm-workspace.yaml`.
- **Git**

### Initial Setup

```bash
# 1. Fork objectstack-ai/objectstack on GitHub
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/objectstack.git
cd objectstack

# 3. Add the upstream remote
git remote add upstream https://github.com/objectstack-ai/objectstack.git

# 4. Install dependencies
corepack enable
pnpm install

# 5. Build the workspace (nothing builds it implicitly)
pnpm build
```

The README's [Hack on the framework](./README.md#hack-on-the-framework) section
covers the rest: building the Console, running an example app with `pnpm dev`, and
how long a first build and a full test run take.

## Making a Change

1. **Start from an issue.** Pick one from the
   [issue tracker](https://github.com/objectstack-ai/objectstack/issues), or open one
   that describes the bug or the proposal before you write code.
   [ROADMAP.md](./ROADMAP.md) and [docs/NORTH-STAR.md](./docs/NORTH-STAR.md) show
   where the project is going.
2. **Branch off an up-to-date `main`, one branch and one pull request per issue**,
   with the issue number in the branch name:

   ```bash
   git fetch upstream
   git checkout -b fix/issue-1234-short-slug upstream/main
   ```

   Working in a checkout that coding agents also use? Give every task its own
   `git worktree` instead of switching branches in a shared tree. AGENTS.md
   (Prime Directive #11 and *Multi-agent working discipline*) explains why, and what
   a worktree does not isolate.
3. **Make the change, following AGENTS.md.** Read its *Prime Directives* before a
   structural change, and its *Context Routing* table for the rules of the path you
   are editing.
4. **Test what your change reaches**, not only the file you edited:

   ```bash
   pnpm --filter @objectstack/<pkg> test       # one package
   pnpm --filter @objectstack/<pkg> typecheck  # a type-check-covered package
   pnpm turbo run test --affected              # every package your branch reaches
   pnpm lint                                   # the only style authority (no formatter)
   ```

   Did you touch `packages/spec`? Then regenerate its checked-in artifacts before you
   push. The steps are in AGENTS.md under *Touched `packages/spec`?*.
5. **Add a changeset when the change publishes.** Run `pnpm changeset` and commit the
   `.changeset/*.md` file it writes. A bug fix in a released package takes a `patch`
   changeset. AGENTS.md's *Post-Task Checklist* (step 3) states the whole rule: which
   bump a change takes, the `Clause-②` declaration, and the migration a breaking
   change must carry.

## Where Things Live

| Path | What it holds |
|:---|:---|
| `packages/spec/src/` | The protocol: Zod schemas, types and constants. AGENTS.md lists the domains. |
| `packages/`, `packages/plugins/`, `packages/services/`, … | The kernel, runtime, drivers, plugins, services, CLI and SDK. The README's package directory has them all. |
| `content/docs/` | The documentation site's pages, in trees such as `getting-started/`, `concepts/`, `data-modeling/`, `ui/`, `automation/`, `api/` and `deployment/`. Preview with `pnpm docs:dev`. |
| `content/docs/references/` | Generated from the Zod schemas by `packages/spec/scripts/build-docs.ts`. Never edit it by hand. |
| `content/docs/releases/` | Written at release time from changesets. Never edit it in a code pull request. |
| `examples/` | The example apps. The README's *Examples* table describes each one. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Design details, the plugin lifecycle and the dependency graph. |

AGENTS.md (*Documentation Guardrails*) has the rules for every docs path, including what a
new page needs before it shows up in the navigation.

## Pull Request Process

### Before Submitting

- [ ] The tests and type-check for what your change reaches pass
- [ ] `pnpm lint` passes
- [ ] Documentation is updated where behaviour changed
- [ ] A changeset is included if the change publishes
- [ ] No unrelated changes are included
- [ ] If the PR changes the auth/audience **defaults** or the **accept/reject behaviour** of
      the unauthenticated surface, label it `needs:pack-smoke` — that runs the packed-install
      smoke on the merge preview before you merge, instead of finding out at release time.

### Opening the Pull Request

Push your branch to your fork and open a pull request against `main`. Its first line
names the issue it fixes (`Fixes #1234`). The body says what changed, why, and how you
verified it.

### Review Process

1. **Automated checks:** CI runs the repository gates, the type-check, the tests and the
   builds.
2. **Code review:** maintainers review your change.
3. **Feedback:** address the review comments.
4. **Merge:** maintainers land the pull request through the merge queue.

## Community

- **[GitHub Discussions](https://github.com/objectstack-ai/objectstack/discussions)** —
  questions and ideas
- **[GitHub Issues](https://github.com/objectstack-ai/objectstack/issues)** — bug reports
  and feature requests
- **[Documentation](https://objectstack.ai/docs)** — the published docs site

## License

By contributing, you agree that your contributions will be licensed under the
Apache License, Version 2.0 (see [LICENSE](./LICENSE) and [LICENSING.md](./LICENSING.md)).

**Thank you for contributing to ObjectStack! 🚀**
