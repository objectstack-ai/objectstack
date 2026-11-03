---
'@object-ui/cli': patch
---

fix(cli): scaffolded apps declare `postcss ^8.5.32`, the range the repo itself uses

Clause-②: no
Metadata-protocol: none

The development-dependencies bump moved every in-repo `postcss` to `^8.5.32`. The scaffold's own table (`SCAFFOLD_DEV_DEPENDENCIES` in `ui/packages/cli/src/utils/scaffold-dependencies.ts`) still said `^8.5.26`, so the routed, plain and init manifests it generates named a range the repo no longer uses. They now name `^8.5.32`.
