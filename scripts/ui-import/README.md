# ui-import — dependency-neutral lockfile for the `ui/` subtree

Importing objectui under `ui/` must not change which dependency versions objectui's
code runs on. Deleting objectui's lockfile and running `pnpm install` re-resolves every
`ui/*` dependency from its range and moves dozens of them; `splice-lockfile.mjs` instead
carries objectui's own resolutions into the root `pnpm-lock.yaml`. The script header is
the authority on what it writes and refuses.

## Procedure (cutover, from the repository root)

1. `git subtree add --prefix ui <objectui> <sha>`, then the adaptation commits: ui
   manifests take `workspace:^` for every `@objectstack/*`, objectui's `pnpm` field
   (react pins, security floors, the focus-scope patch) moves to the root
   `pnpm-workspace.yaml`.
2. Keep objectui's lockfile for the splice, then delete it from the tree:
   `git show <sha>:pnpm-lock.yaml > /tmp/objectui-lock.yaml && git rm ui/pnpm-lock.yaml`.
3. Splice:
   `node scripts/ui-import/splice-lockfile.mjs --base pnpm-lock.yaml --import /tmp/objectui-lock.yaml --prefix ui --out pnpm-lock.yaml`
   It must end with `moved 0`.
4. Reconcile with pnpm: `pnpm install --lockfile-only`. pnpm applies the root
   `overrides` (security floors) to the imported subgraph and re-resolves peer
   suffixes; nothing else. Run it a second time: the file must not change. Then
   `pnpm dedupe`, so one copy of a package serves both trees wherever both ranges admit it
   (one `vite` and one `postcss` for ui/ and packages/, one `ai` 7.0.118 and one
   `@ai-sdk/react` 4.0.121; objectstack#25752 item 16). `pnpm dedupe --check` then exits 0.
5. `pnpm install --frozen-lockfile` must pass.
6. Re-measure the reconciled file:
   `node scripts/ui-import/splice-lockfile.mjs --measure pnpm-lock.yaml --import /tmp/objectui-lock.yaml --prefix ui`. Every row still moved must be an override the root
   `pnpm-workspace.yaml` keeps on purpose, named in its comment block.
7. Regenerate nothing. With the ui importers on objectui's versions no generated file
   (for example `ui/packages/components/src/lib/lucide-record-icon-names.ts`) changes;
   if a `check:` gate asks for a regeneration, a dependency moved, and step 6 says which.

An override that would move a dependency objectui pins onto another major, or split one
line (react-router under react-router-dom), is scoped in `pnpm-workspace.yaml` with a
comment naming the advisory range it still covers; dependency upgrades for objectui are
their own changes after the cutover.

# ui-import: the objectui side of the release-lane merge (objectstack#25711)

This is the record of the `ui/` half of sub-issue 4a of objectstack#25677. It removed
objectui's pin on objectstack (`.objectstack-sha`, `.objectstack-pin/`, the scripts that
read them), the dist-injection Vite probes, objectui's own release lane and its own
Changesets config. While `ui/` did not exist on `main` it was carried as a patch file,
`4a-ui-side.patch`. In the cutover sitting, right after the subtree PR (objectstack#25825)
landed on `main` (`fd40831416`), 4a's own PR (objectstack#25745) applied it as tree edits
together with the root half of 4a, and deleted the patch file in the same commit.

## What it changed

Deleted (step 2 below):

- the pin: `.objectstack-sha`, `.objectstack-pin/` (7 packed manifests),
  `scripts/bump-objectstack.sh`, `scripts/objectstack-pin.mjs`,
  `scripts/objectstack-floor.mjs`, `scripts/check-spec-range-floors.mjs`,
  `scripts/check-installed-spec-pin-claims.mjs`, and their tests;
- the dist-pin Vite probes: `scripts/vite-objectstack-spec-dist.ts`,
  `scripts/vite-objectstack-client-dist.ts` (`OBJECTSTACK_SPEC_DIST` /
  `OBJECTSTACK_CLIENT_DIST`), and their tests. The workspace arm
  (`scripts/vite-objectstack-workspace.ts`) is what remains;
- objectui's release lane: `.github/workflows/changeset-release.yml`,
  `.github/workflows/spec-range-floors.yml`, `scripts/release-github-releases.mjs`, and
  their tests (the root `release.yml` publishes both scopes, and the root
  `scripts/release-github-releases.mjs` cuts a Release per package tag of both);
- `.changeset/config.json`: changesets reads one config per repository, the root's;
- the QUICK_REFERENCE release sync (decision 17c, ruling B, carried here):
  `scripts/sync-quick-reference-release.mjs`, its test, and the
  `quick-reference-current-release-4143` pin. Its only release-path caller was
  `changeset-release.yml`, deleted above.

Changed (step 3 below):

- `scripts/vite-single-zod.ts` (new): the single-zod build guard, moved out of the deleted
  spec probe because it runs in every console build. `apps/console/vite.config.ts` drops
  both injections and imports the guard from there. Its tests move to
  `vite-single-zod.test.ts`, `console-optimize-deps.test.ts` and
  `console-lazy-linter.test.ts` (the cases that did not depend on an injection);
- `scripts/workspace-root.mjs` gains `changesetConfigPath()`: the tree's own
  `.changeset/config.json` standalone, the monorepo root's when nested. Every reader of
  that config (`check-changeset-fixed`, `check-changeset-no-major`,
  `check-changeset-presence`, `check-phantom-dependencies`, and the
  `check-changeset-fixed` test) reads it through that helper;
- the private VS Code extension `object-ui` stays in the one fixed group (decision 17b,
  ruling B): the root config lists it, and objectui's `check-changeset-fixed` and
  `check-unused-dependencies` keep their extension rules and rows unchanged;
- `QUICK_REFERENCE.md`: "Current Release" holds no version literal any more and points
  at the monorepo's fixed group; `package.json` drops `quick-reference:sync` /
  `quick-reference:check` and the sync leg of `changeset:version`;
- `check-lockfile-dedupe.mjs`: the pinned-build precondition is gone;
- `package.json`: `setup` is a frozen install, `changeset:publish` loses the floor and
  range-floor legs, `objectstack:build` / `objectstack:status` / `check:spec-floors` /
  `check:installed-pin-claims` are gone;
- `.gitignore`, `eslint.config.js`, `turbo.objectui.json`, `scripts/setup.sh`,
  `CONTRIBUTING.md`, `check-action-ref-convention.mjs`, `check-ui-root-lookups.mjs`,
  `check-entry-guard.mjs`, `markdown-test-inputs.mjs`,
  `quick-reference-commands-4149.test.ts`: their pin, release-lane and release-sync
  rows.

## How it was applied

From the monorepo root, after `git merge origin/main` brought the subtree in:

```sh
# 1. Not here: objectui's 65 pending ui/.changeset/*.md stay under ui/ for the
#    aftercare card objectstack#25831, which conforms them to the root changeset
#    gates and moves them before the first post-cutover Version PR. Measured on
#    c04b36dcb9, moving them as they stand reds check-empty-changeset (3 empty
#    frontmatters) and check-adr-0087-registration (41 breaking changesets with no
#    `adr-0087:` disposition), and one name collides with a root changeset.

# 2. The deletions. `--ignore-unmatch`: the cutover tree already dropped
#    ui/.objectstack-pin. The nested pull_request_template.md never renders (GitHub
#    reads the root one) and its only markdown-test-inputs reader was the claims test.
git rm -r -q --ignore-unmatch -- \
  ui/.github/pull_request_template.md \
  ui/.changeset/config.json \
  ui/.objectstack-sha ui/.objectstack-pin \
  ui/.github/workflows/changeset-release.yml ui/.github/workflows/spec-range-floors.yml \
  ui/scripts/bump-objectstack.sh ui/scripts/objectstack-pin.mjs ui/scripts/objectstack-floor.mjs \
  ui/scripts/check-spec-range-floors.mjs ui/scripts/check-installed-spec-pin-claims.mjs \
  ui/scripts/vite-objectstack-spec-dist.ts ui/scripts/vite-objectstack-client-dist.ts \
  ui/scripts/release-github-releases.mjs ui/scripts/sync-quick-reference-release.mjs \
  ui/scripts/__tests__/bump-objectstack.test.ts \
  ui/scripts/__tests__/changeset-release-action-ref-pin.test.ts \
  ui/scripts/__tests__/check-installed-spec-pin-claims.test.ts \
  ui/scripts/__tests__/check-spec-range-floors.test.ts \
  ui/scripts/__tests__/objectstack-floor.test.ts \
  ui/scripts/__tests__/objectstack-pin.test.ts \
  ui/scripts/__tests__/quick-reference-current-release-4143.test.ts \
  ui/scripts/__tests__/release-github-releases.test.ts \
  ui/scripts/__tests__/sync-quick-reference-release.test.ts \
  ui/scripts/__tests__/vite-objectstack-client-dist.test.ts \
  ui/scripts/__tests__/vite-objectstack-spec-dist.test.ts

# 3. The modifications and the three new files: `git apply --directory=ui` of
#    4a-ui-side.patch, deleted in the same commit.

# 4. The SDUI manifest regenerated from ui/ for the merged tree (107 -> 106
#    components; objectui#13449 retired `html`): sdui.manifest.json and
#    scripts/sdui-manifest.record.json, from the patch the 4b PR 2a thread measured.
```

The patch was written against the verification branch head `9e37acd126` (objectstack#25697,
the run 8 tree) and re-checked with `git apply --check` on the cutover heads `1c0d02eda4`
and `c04b36dcb9` and on `main` at `fd40831416` before it was applied.

## Verify

```sh
pnpm --dir ui exec vitest run scripts/__tests__     # the whole suite, never a subset
pnpm --dir ui run type-check:scripts
pnpm --dir ui run type-check:vitest-config
pnpm --dir ui run lint:root
pnpm console:build                                   # the single-zod and lazy-linter guards run inside it
```

Measured on 2026-10-25:

- on `9e37acd126`, steps 1–3 apply cleanly and reproduce the edited `ui/` tree byte for
  byte; the same edits on the earlier merged tree (objectui `cd70b7818`) did too
  (60 files);
- on `9e37acd126` with steps 1–3 and the root half of 4a, after `pnpm install
  --frozen-lockfile` and `pnpm run build`: `type-check:scripts`,
  `type-check:vitest-config`, `lint:root` exit 0, and root and objectui
  `check-changeset-fixed` both pass (112 public packages plus `object-ui` at that base).
  `changeset version` moved all 113 to 18.2.0 together, `object-ui` included;
- on the cutover head `1c0d02eda4` (objectui frozen at `9e1fe03286`), with step 3 and
  the root half of 4a: `@object-ui/runner` is private there and in objectui's `ignore`
  (objectui#13506), so the root `fixed` group drops it and the root `ignore` takes it.
  Root and objectui `check-changeset-fixed` exit 0 (111 public packages plus `object-ui`),
  `check:lockstep-package-count` reads 111, and `changeset version` moves all 112 members
  to 18.2.0 together while `@object-ui/runner` stays at 18.1.0;
- on the cutover head `c04b36dcb9` with steps 1–3 and the root half of 4a, against the
  same head without them (both installed, neither built): `vitest run scripts/__tests__`
  clears the 12 the cutover leaves to 4a (`check-installed-spec-pin-claims` ×4,
  `quick-reference-current-release-4143` ×3, `sync-quick-reference-release` ×5) and the
  rest of the deleted pin class with them. It adds 12 that read objectui's nested
  `ui/.github/workflows/` (`ci-cd-pipeline-doc` ×9, `workflow-cache-save-bound` ×2,
  `check-pre-install-import-graph` ×1: they still name the two deleted workflows and
  `scripts/objectstack-pin.mjs`). 4b PR 2 (objectstack#25712) deletes those workflows with
  the tests that read them. `markdown-test-inputs`, `check-changeset-fixed` and
  `check-unused-dependencies` pass. The `optimizeDeps` case fails identically on both
  sides, because there is no spec build, and only moved to `console-optimize-deps.test.ts`;
- earlier, on `9e37acd126`: `vitest run scripts/__tests__`: 17 failed / 5,573 passed. Two of them are 15 s
  timeouts under load (`check-vi-mock-inherit`, `dollar-dialect-alias-census`), which
  pass alone (125/125). Two failed the same way on the earlier merged tree without the
  patch: `check-lockfile-integrity`, and `quick-reference-commands-4149` on the root
  scripts the adaptation drops (cutover bill). The other 14 all read objectui's nested `ui/.github/`
  (`ci-cd-pipeline-doc` ×10, `workflow-cache-save-bound` ×2,
  `check-pre-install-import-graph`, `markdown-test-inputs` over
  `.github/pull_request_template.md`). Those workflows never run nested, and sub-issue 4b
  (objectstack#25712) PR 2 deletes them together with the tests that read them.
