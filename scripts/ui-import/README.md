# ui-import: the objectui side of the release-lane merge (objectstack#25711)

`4a-ui-side.patch` is the `ui/` half of sub-issue 4a of objectstack#25677: it removes
objectui's pin on objectstack (`.objectstack-sha`, `.objectstack-pin/`, the scripts that
read them), the dist-injection Vite probes, objectui's own release lane and its own
Changesets config. It is a patch file and not tree edits because `ui/` does not exist on
`main` until the subtree PR of sub-issue 5 lands; it is applied in that cutover window,
right after the subtree PR, together with the root half of 4a.

## What it changes

Deleted (step 2 below; the patch carries only modifications and additions, so the
deleted files' 14,727 lines are not repeated here):

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
- `.changeset/config.json`: changesets reads one config per repository, the root's.

Changed by the patch:

- `scripts/vite-single-zod.ts` (new): the single-zod build guard, moved out of the deleted
  spec probe because it runs in every console build. `apps/console/vite.config.ts` drops
  both injections and imports the guard from there. Its tests move to
  `vite-single-zod.test.ts`, `console-optimize-deps.test.ts` and
  `console-lazy-linter.test.ts` (the cases that did not depend on an injection);
- `scripts/workspace-root.mjs` gains `changesetConfigPath()`: the tree's own
  `.changeset/config.json` standalone, the monorepo root's when nested. Every reader of
  that config (`check-changeset-fixed`, `check-changeset-no-major`,
  `check-changeset-presence`, `check-phantom-dependencies`, `check-published-dist-tooling`
  through it, `check-unused-dependencies`, `sync-quick-reference-release`, and two tests)
  reads it through that helper;
- `check-changeset-fixed.mjs`: a private package outside `fixed` is classified when
  `privatePackages.version` is true. The root `fixed` group holds public packages only,
  so the private VS Code extension (`object-ui`) now versions on its own;
- `check-unused-dependencies.mjs`: the extension's two allowance rows leave with it;
- `check-lockfile-dedupe.mjs`: the pinned-build precondition is gone;
- `package.json`: `setup` is a frozen install, `changeset:publish` loses the floor and
  range-floor legs, `objectstack:build` / `objectstack:status` / `check:spec-floors` /
  `check:installed-pin-claims` are gone;
- `.gitignore`, `eslint.config.js`, `turbo.objectui.json`, `scripts/setup.sh`,
  `CONTRIBUTING.md`, `QUICK_REFERENCE.md`, `check-action-ref-convention.mjs`,
  `check-ui-root-lookups.mjs`, `markdown-test-inputs.mjs`: their pin and release-lane
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
  ui/scripts/release-github-releases.mjs \
  ui/scripts/__tests__/bump-objectstack.test.ts \
  ui/scripts/__tests__/changeset-release-action-ref-pin.test.ts \
  ui/scripts/__tests__/check-installed-spec-pin-claims.test.ts \
  ui/scripts/__tests__/check-spec-range-floors.test.ts \
  ui/scripts/__tests__/objectstack-floor.test.ts \
  ui/scripts/__tests__/objectstack-pin.test.ts \
  ui/scripts/__tests__/release-github-releases.test.ts \
  ui/scripts/__tests__/vite-objectstack-client-dist.test.ts \
  ui/scripts/__tests__/vite-objectstack-spec-dist.test.ts

# 3. The modifications and the three new files.
git apply --directory=ui --check scripts/ui-import/4a-ui-side.patch
git apply --directory=ui scripts/ui-import/4a-ui-side.patch
```

The patch is written against the merged tree (objectui `main` imported under `ui/` plus
the verification branch's adaptations: `turbo.objectui.json`, the `workspace:^` manifests).
Against objectui `main` standalone, `package.json` and `turbo.objectui.json` do not apply
and every other file does.

## Verify

```sh
pnpm --dir ui exec vitest run scripts/__tests__     # the whole suite, never a subset
pnpm --dir ui run type-check:scripts
pnpm --dir ui run type-check:vitest-config
pnpm --dir ui run lint:root
pnpm console:build                                   # the single-zod and lazy-linter guards run inside it
```

Measured on the merged scratch tree (objectstack `main` 43edf90b + PR A + objectui
cd70b7818 under `ui/` + the verification branch's adaptations), 2026-10-25:

- steps 1–3 reproduce the edited tree byte for byte (56 files);
- `type-check:scripts`, `type-check:vitest-config`, `lint:root`: exit 0;
- `pnpm console:build` (CI=true): exit 0, single-zod canary green, the dist file list
  identical to the build before the patch modulo content hashes (2,389 files);
- `vitest run scripts/__tests__`: 31 failed / 5,488 passed. 17 of the 31 fail
  identically on the tree without the patch (`check-doc-snippet-types`,
  `check-lockfile-integrity`, `check-lucide-icon-record-names`, the live-e2e row of
  `ci-cd-pipeline-doc`, `quick-reference-*`, `sync-quick-reference-release`,
  `vite-maplibre-worker`, `vite-objectstack-workspace`). The other 14 all read
  objectui's nested `ui/.github/` (`ci-cd-pipeline-doc`, `workflow-cache-save-bound`,
  `check-pre-install-import-graph`, `markdown-test-inputs` over
  `.github/pull_request_template.md`, `sync-quick-reference-release` over
  `changeset-release.yml`), whose workflows never run nested and are deleted by
  sub-issue 4b (objectstack#25712) PR 2 together with the tests that read them.
