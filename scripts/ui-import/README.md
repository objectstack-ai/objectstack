# ui-import: the objectui side of the release-lane merge (objectstack#25711)

`4a-ui-side.patch` is the `ui/` half of sub-issue 4a of objectstack#25677: it removes
objectui's pin on objectstack (`.objectstack-sha`, `.objectstack-pin/`, the scripts that
read them), the dist-injection Vite probes, objectui's own release lane and its own
Changesets config. It is a patch file and not tree edits because `ui/` does not exist on
`main` until the subtree PR of sub-issue 5 lands; it is applied in that cutover window,
right after the subtree PR, together with the root half of 4a.

## What it changes

Deleted (step 2 below; the patch carries only modifications and additions, so the
deleted files' lines are not repeated here):

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

Changed by the patch:

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

## Apply

From the monorepo root, on the tree the subtree PR produced:

```sh
# 1. Pending objectui changesets join the root ones (changesets reads one directory).
for f in ui/.changeset/*.md; do
  [ "$(basename "$f")" = README.md ] || git mv "$f" .changeset/
done

# 2. The deletions.
git rm -r -q -- \
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

# 3. The modifications and the three new files.
git apply --directory=ui --check scripts/ui-import/4a-ui-side.patch
git apply --directory=ui scripts/ui-import/4a-ui-side.patch
```

The patch is written against the verification branch head `9e37acd126` (objectstack#25697,
the run 8 tree: objectui `main` imported under `ui/` plus the adaptations). Before the
cutover, run step 3's `--check` against the final tree and regenerate the patch if it
fails (sub-issue 5 owns that re-check).

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
  `check-changeset-fixed` both pass (112 public packages plus `object-ui`).
  `changeset version` moves all 113 to 18.2.0 together, `object-ui` included;
- `vitest run scripts/__tests__`: 17 failed / 5,573 passed. Two of them are 15 s
  timeouts under load (`check-vi-mock-inherit`, `dollar-dialect-alias-census`), which
  pass alone (125/125). Two failed the same way on the earlier merged tree without the
  patch: `check-lockfile-integrity`, and `quick-reference-commands-4149` on the root
  scripts the adaptation drops (cutover bill). The other 14 all read objectui's nested `ui/.github/`
  (`ci-cd-pipeline-doc` ×10, `workflow-cache-save-bound` ×2,
  `check-pre-install-import-graph`, `markdown-test-inputs` over
  `.github/pull_request_template.md`). Those workflows never run nested, and sub-issue 4b
  (objectstack#25712) PR 2 deletes them together with the tests that read them.
