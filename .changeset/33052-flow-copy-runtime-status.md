---
'@object-ui/app-shell': patch
---

fix(app-shell): a flow copy made by New similar shows its runtime status as soon as it opens

Clause-②: no
Metadata-protocol: none

**New similar in Studio Automations.** A copy that opens in the same Automations pillar, the open writable package or a read-only base's paired `.custom` package, now reads its runtime state at once. The server stores the copy live and switched off, so its header Status reads "Switched off" with no reload. Before, the pillar kept the runtime status snapshot it had read before the copy existed, found no row for the copy, and read it as "Unpublished draft" until the page was reloaded. The pillar now reads the automation status once more after each copy lands. A flow the engine really holds no row for still reads "Unpublished draft". A copy that lands in another package opens that package's pillar, which reads the status itself, as before.
