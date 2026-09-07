---
"@objectstack/runtime": minor
---

Package lifecycle state is keyed by the PROJECT as well as the environment id, so two projects on one machine stop sharing which packages an operator has disabled.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, export, config field or stored metadata changes spelling or shape, `packages/spec` is untouched, and `objectstack migrate meta` has nothing to rewrite. What changes is the NAME of an operational state file the runtime writes under the ObjectStack home — a path on disk, not a metadata surface the ledger can project into `spec-changes.json` or the generated upgrade guide. The runtime reads the old name itself while no per-project file exists, so no consumer rewrites anything and there is no authored artifact a metadata upgrader could reach. -->

**BREAKING** for a machine that relied on one environment id meaning one shared disable list. Shipped as `minor` under the launch-window convention: while the whole workspace versions in lockstep the bump level carries no breaking-ness, so this banner and the ADR-0087 disposition above are the carriers.

`packages/runtime/src/package-state-store.ts` is the only durable record of which packages an operator has disabled, and `AppPlugin.start()` replays it at boot. It was stored at `<OS_HOME>/package-state/<environmentId>.json`, and both halves of where that lived were machine-global: `resolveObjectStackHome()` takes no arguments (it reads `OS_HOME`, else `~/.objectstack`), and an environment id is not a project identity. Two different projects on one machine, both in the ordinary `env_local` environment, therefore wrote one file.

Driven with two real project roots, one home and one environment id, that produced two failures with one cause:

- project B disabling `com.acme.billing` made project A's **boot read** answer `{ com.acme.billing, com.acme.reporting }` — A had never installed, seen or disabled that package, and the disable takes it out of A's running system;
- project B enabling `com.acme.reporting` erased project A's disable of it, so one project's operator action silently undid another project's operator intent.

The file is now `<OS_HOME>/package-state/<environmentId>.<project>.json`, where the project component is a sanitised basename plus a short digest of the resolved project root — the same naming convention `os serve`'s runtime state file settled on, rather than a second spelling of one idea. The payload is unchanged.

**An existing `<environmentId>.json` keeps working and is not deleted.** While a project has no per-project file of its own the runtime still reads the old name, and that project's first write lands under the new one. The old file is never written and never removed, so a machine that rolls back to the previous release still finds its operator's disables where that release looks for them. Disables made after the upgrade live under the new name only.

**Which project the key is taken from:** the runtime's working directory, the base every path in a boot with no served-app anchor already resolves against. Two boundaries follow, stated rather than fixed. `os serve` anchors host resolution at the config file's own directory when that directory carries a `package.json`, so serving a config from elsewhere keys this file by the working directory while the CLI's supervision file keys by the config's directory; and the key is the resolved path rather than the realpath, so two symlinked spellings of one project key two files, each internally consistent. Two boots of the same project from the same directory still share one file, which is the same-project case and unchanged here.
