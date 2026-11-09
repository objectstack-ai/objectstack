---
'@objectstack/objectql': patch
---

fix(objectql): a package registered again lists its navigation contributions once, not once more per registration

Clause-②: no — the served app navigation returns to what a fresh boot serves; nothing a caller sends is refused
Metadata-protocol: none

- **Before.** Registering a package body appended its `navigationContributions` to the target app's list every time. An artifact reload (`metadata:reloaded`, fired when `os dev` recompiles the artifact or on the HMR reload POST) re-registers every package of the artifact, so after one reload the sidebar listed every module's contributed entries twice, three times after the next, until the server restarted. An uninstalled package's contributions also stayed in the app.
- **Now.** A package body's contributions replace that package's previous set (`SchemaRegistry.setPackageNavContributions`, new), in the place its first registration put them, so the navigation after any number of reloads, re-registrations and disable/enable cycles equals a fresh boot's, in the same order. Uninstalling a package drops its contributions. `registerAppNavContribution` keeps its additive meaning.
