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
   suffixes; nothing else. Run it a second time: the file must not change.
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
