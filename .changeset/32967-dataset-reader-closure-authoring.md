---
'@objectstack/lint': minor
'@objectstack/core': patch
'@objectstack/cli': patch
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

Clause-②: no (narrowing) — `os validate`, `os build` and `os lint` refuse (`widget-dataset-unknown`, error) a dashboard widget in a package of a multi-package artifact whose `dataset` only a package outside that package's declared dependency closure holds, or two packages inside it hold, where they accepted it. The runtime already refused both reads (`409 RESOURCE_CONFLICT`) since 18.4.0; no runtime answer changes.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` teaches neither cross-package dataset resolution nor `widget-dataset-unknown`.

<!-- adr-0087: registered dashboard-dataset-outside-reader-closure-refused -->

fix(lint)!: `os validate` and `os build` resolve a dashboard's dataset through the reading package's declared dependency closure, as the runtime does

**BREAKING** accept-set narrowing in the authoring doors (`os validate`, `os build`, `os lint`; `@objectstack/lint`'s `widget-dataset-unknown`), for a package of a multi-package artifact (`packages[]`, the `composeStacks(stacks, { manifest: 'preserve' })` shape).

- **Before.** The per-package pass resolved a dashboard widget's `dataset` against every package of the artifact, so a widget bound to a dataset another package holds was accepted whether or not the reading package declares it.
- **Now.** The name resolves in the reading package, then to the one holder in its declared dependency closure (`manifest.dependencies`, transitively, plus `sys`). A name held only outside that closure, or by two packages inside it, is refused with `widget-dataset-unknown` (error), naming the dataset, the holders and the open fix. When the reading package declares a dependency the artifact does not carry, an outside-closure name is reported (`widget-dataset-unknown`, warning, suppressible with `suppressWarnings`) instead, since that package may hold it once installed; two holders inside the closure are refused even then.
- **Unchanged.** A stack without `packages[]`, the union run over the whole artifact, a package's own dataset, a dataset of a declared dependency, and a name no package holds (refused as before). Every runtime answer.
- **Fix.** Declare the holding package in the reading package's `dependencies`; where the holder already depends on the reader (a module of the app), move the dashboard into the holder, or move the dataset into the reader. Upgrade-guide entry `dashboard-dataset-outside-reader-closure-refused`.

Since 18.2.0 (#25514) the per-package authoring pass resolved a widget's `dataset` against every package of the artifact. The runtime does not: since 18.4.0 a package's dashboard resolves a dataset name in its own package, then in the packages its manifest declares in `dependencies` (transitively) plus `sys`, and refuses the rest (ADR-0150 D3, the maintainer's ruling on #32929). So `os validate` passed a dashboard that answered `409 RESOURCE_CONFLICT` once installed. HotCRM is the first-party app built this way: its app package's CRM Overview read `product_metrics`, which its revenue module holds. Repository examples affected: 0. Other first-party apps outside this repository: not measured.

The authoring pass now asks the same question. Who moves: an app whose package dashboard binds a dataset that another package of the same artifact holds, without declaring that package. The finding names the dataset, the holders and the open fix, read off the artifact:

- the holder does not depend on the reading package: declare it in the reader's `dependencies`, or move the dataset into the reader;
- the holder already depends on the reading package (a module of the app): declaring it back is a dependency cycle the kernel refuses at boot, so move the dashboard into the holder, or move the dataset into the reader;
- two holders inside the closure: nothing picks one; keep one, or depend on one.

A report's (or a joined block's) `runtimeFilter` reads the same index: on the per-package pass its keys are no longer judged against a dataset the report cannot resolve. No verdict is lost: `chart-dataset-unknown` already refuses that report there, and the union run still judges the filter.

The refusal sentences that name a fix for `outside-closure` now name the open one too: the core sentence (`409` at every package-scoped by-name door) says "move the TYPE into P" alone when only the environment holds the item, and asks for a dependency on ONE package when two or more hold it; `os migrate stored-references` (the report and `bind`), the CLI's picklist-reference hint and the publish probe's `widget_not_probed` fix name the move beside the dependency. Which item a read answers, its status, code and `details.candidates` do not change.

The remedy (correcting the 18.4.0 note of #32310, which named only the dependency and the `?package=` qualifier): declare the holder in the reading package's `dependencies`; where the holder already depends on the reader, move the reading item into the holder, or move the read item into the reader.
