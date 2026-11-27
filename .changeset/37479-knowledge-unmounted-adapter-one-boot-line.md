---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): a source naming an unmounted adapter is logged once at boot, not twice

Clause-②: no
Metadata-protocol: none

At boot, a knowledge source whose `adapter` names a store nothing mounted was named twice: once at `error` by the boot's reading of unmounted adapters, and once more at `warn` by the first-build pass ("is not built at boot: what the adapter holds could not be read"). The first-build pass now skips such a source without a line, so the one boot line is the `error` that names the source, the adapter and the mounted choices. Nothing else changes: indexing and searching the source still answer `SERVICE_UNAVAILABLE`, and a source loaded while the process runs is still named at `warn` by its reload build, since no boot reading runs then.
