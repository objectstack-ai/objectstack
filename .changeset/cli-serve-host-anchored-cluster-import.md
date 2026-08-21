---
"@objectstack/cli": patch
---

Fix `os serve` failing to boot with `OS_CLUSTER_DRIVER=redis` when the app
declares `@objectstack/service-cluster` (#10645). The cluster gate and its
driver were reached through a bare dynamic `import()`, which Node ESM resolves
against the CLI's own realpath — inside the framework workspace — so packages
installed under the host app were invisible to it and boot died with
`Cannot find package '@objectstack/service-cluster'`. Both loads now go through
the host-anchored importer `serve` already uses for its other optional and
enterprise packages, so any package the app declares resolves the way the app
declares it. The host importer is now defined at the top of the boot sequence
rather than partway down, which is what made these two loads fall back to bare
resolution in the first place. No change to what `serve` accepts or refuses:
an undeclared package is still refused by the same declaration gate.
