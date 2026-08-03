---
---

Tooling-only: `merge.os-regen.driver` is registered as a worktree-independent
command, and `check:merge-driver` now asserts the registered driver actually
resolves (#4868). Releases nothing.

`setup-git-hooks.mjs` baked an absolute `${REPO_ROOT}/scripts/git-merge-regen.mjs`
into `.git/config`. Linked worktrees SHARE one `.git/config`, so every
`pnpm install` re-pointed the container-wide driver at whichever worktree had just
installed — and the moment that worktree was removed, which AGENTS.md *requires*
on task cleanup, every merge touching a `merge=os-regen` path in every other
worktree died with `MODULE_NOT_FOUND`. Following the cleanup rule is what
triggered the breakage, which is why it recurred across four worktrees.

The value is now `node "$(git rev-parse --show-toplevel)/scripts/git-merge-regen.mjs" %O %A %B %P`.
Git hands a merge driver to a shell, so the substitution runs per invocation
inside the worktree being merged: it binds to no worktree yet still resolves to
the right root — the property the absolute path was there to guarantee. Existing
clones self-heal on the next `pnpm install`.

The gate could not see any of this, because it never looked: every existing
`--self-test` check builds its own temp repo and registers its own driver, so all
of them stayed green while the live config dangled. A new `registeredDriverResolves()`
check reads the *live* config and fails when the script does not exist, when it
points outside the current worktree (the same bug one step before it bites), or
when the value has drifted from what the registrar writes. The registrar and the
gate now read one declaration, `GIT_SETTINGS` in `regen-artifacts.mjs`.
