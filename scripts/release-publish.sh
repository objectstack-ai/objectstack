#!/usr/bin/env bash
# release-publish.sh — npm publish + atomic git-tag push for the Release workflow.
#
# Why this exists (the bug it fixes):
#   `changeset publish` publishes every package to npm and creates a local
#   annotated git tag (`<pkg>@<version>`) for each one. changesets/action
#   then pushes those tags — but it fires one `git push origin <tag>` per tag
#   *concurrently* (Promise.all). With this monorepo's large Changesets "fixed"
#   group (~70+ packages all bumping in lockstep), that burst of simultaneous
#   ref-creation pushes races on GitHub's ref backend, which responds with
#   `remote: fatal error in commit_refs` and rejects a chunk of the tags. npm
#   publishing has already fully succeeded by then, yet the job fails and the
#   rejected version tags never make it to the remote (#2191).
#
# The fix:
#   Push ALL new tags ourselves in a SINGLE atomic `git push origin --tags`
#   immediately after `changeset publish`. One push = one ref transaction, so
#   there is no concurrency to race. By the time changesets/action runs its own
#   per-tag pushes, every tag already exists on the remote at the same SHA, so
#   each of those pushes is a harmless no-op ("Everything up-to-date").
#
#   git push auth comes from the persisted actions/checkout credentials. The
#   tags themselves are already created by `changeset publish` (which configures
#   the CI git identity); this script only pushes them. Run as the `publish:`
#   command of changesets/action (see
#   .github/workflows/release.yml) so the atomic push happens before the action
#   pushes tags itself.
set -euo pipefail

# ⛔ Do not restore npm_config_globalconfig, and do not "simplify" this away.
#
#   npm refuses to start when its "user" and its "global" config resolve to the
#   SAME file. It aborts inside @npmcli/config before it parses argv:
#
#     Exit prior to config file resolving
#     cause
#     double-loading config "/home/runner/.config/pnpm/rc" as "global", previously loaded as "user"
#
#   Three layers stack up to produce exactly that (#10146):
#     1. `pnpm run release` exports npm_config_globalconfig=~/.config/pnpm/rc to
#        every child — pnpm forces `{globalconfig: join(configDir, 'rc')}` into
#        its rawConfig unconditionally.
#     2. `changeset publish` v3 detects the pnpm workspace and shells out to
#        `pnpm info` / `pnpm publish` per package, where v2 always shelled out to
#        `npm`. The publish therefore runs a NESTED pnpm underneath `pnpm run`.
#     3. That nested pnpm reads the inherited value back in and, delegating
#        `info` to npm, hands the npm child BOTH npm_config_userconfig AND
#        npm_config_globalconfig pointing at that one file (pnpm/pnpm#10914,
#        unfixed on the 10.31.0 line we pin).
#
#   The abort happens before npm has an error code, so changesets can only
#   report `Received an unexpected error for <pkg>: (no code)` — which is how
#   run 32355381481 failed 17.5.0 after a fully green build.
#
#   Dropping the inherited value is the whole fix: pnpm recomputes its own
#   global config path from configDir either way, so nothing pnpm needs is lost,
#   and npm falls back to its own default global config while keeping
#   $HOME/.npmrc — where release.yml writes NPM_TOKEN — as the user config.
#   Forcing npm_config_userconfig instead does NOT work: the nested pnpm
#   recomputes it and overrides whatever we export.
unset npm_config_globalconfig NPM_CONFIG_GLOBALCONFIG

# Publish to npm and create the local version tags.
changeset publish

# Push every new tag in one atomic transaction (see header). --tags pushes ALL
# local tags regardless of reachability; --follow-tags would push nothing here
# since this is a bare push with no branch ref attached.
git push origin --tags
