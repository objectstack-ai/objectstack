---
'@objectstack/lint': patch
---

Clause-②: no
Metadata-protocol: none

fix(lint): `os validate` and `os build` resolve a report's dataset through the reading package's declared dependency closure, as the runtime does

`chart-dataset-unknown` (`@objectstack/lint`) read the judged stack's own `datasets` alone. On the per-package pass of a multi-package artifact (`packages[]`, the `composeStacks(stacks, { manifest: 'preserve' })` shape), a report, a joined report block, a list-view chart or a dataset-bound page chart bound to a dataset that a package it declares in `dependencies` holds was refused ("resolves to no declared dataset"), although the runtime serves it: every one of those readers sends its own package as `callerPackage`, and the dataset doors resolve the name from that package by ADR-0150 D3.

- **Now.** The binding resolves the way the dashboard rule (`widget-dataset-unknown`) already resolves it: the reading package's own dataset, then the one holder in its declared dependency closure (transitively, plus `sys`). A dataset of a declared dependency is accepted, and the report's rows, values and chart axes are judged against it.
- **Still refused**, now with the reason and the open fix: a dataset held only by a package outside that closure (the finding names the holder, and asks for the dependency, or for a move when the holder already depends on the reader), and a dataset two packages inside the closure hold (the finding names both; nothing picks one). When the reading package declares a dependency the artifact does not carry, an outside-closure name is reported as a warning instead, since that package may hold it once installed, as the dashboard rule reports it.
- **The union run** reads every package body of the artifact, as the dashboard rule has since it learnt `packages[]`: a module's report on the module's own dataset is no longer refused there when a top-level `datasets` sits beside the composition.
- **Unchanged:** a dataset no package of the artifact declares, any stack without `packages[]`, and the publish door. No runtime answer changes.
