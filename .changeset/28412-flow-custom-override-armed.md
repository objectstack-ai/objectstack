---
'@objectstack/metadata-protocol': minor
'@objectstack/service-automation': minor
---

feat(service-automation, metadata-protocol): a flow override declared in the shipping package's paired `<base>.custom` is the packaged flow — saved, served and armed in place of the base, and deleting it restores the base (#28412)

Clause-②: yes (widening)
Metadata-protocol: semantic

ADR-0146 D9 item 1 for `flow`. A flow a code package ships could be changed only by cloning it under a new name, so the clone and the base both ran on every record change. Now the base package's paired `.custom` package can override it in place:

- **The save door admits it.** A flow saved into `<base>.custom` under the base flow's name, declaring `overrides: { package: '<base>', basedOn }`, passes the ADR-0146 D2 override write gate (`flow` is open there now; `action` still answers "not yet available"). The draft save, the per-item publish, `publishPackageDrafts`, `os validate` and the install-local gate admit it as they admit a declared view override.
- **Every read serves it as the base.** The flow view (`getMetaItems` / `getMetaItemsForExecution`), the by-name read, the layered read (`code` = the base's flow, `effective` = the override) and the per-package customization list serve the override in the base's slot, under the base's `_packageId`, once per name. The one predicate is N-10's `isServedOverrideRowOf`, judged on the row's stored `package_id` — never on the body's `_packageId`.
- **The automation engine arms it in place of the base.** The boot pull, the `kernel:ready` sync, the `metadata:reloaded` re-sync and the metadata-mutation sync each arm the override. One record change runs one body. The boot pull ranks it above the loader's body (a new `override` contender rank), reading the row's stored binding, which the protocol's registry hydration now records on the hydrated flow body as a non-enumerable symbol (`bindStoredRow` / `storedRowBindingOf`, newly exported). That symbol cannot be authored in JSON and never leaves the process.
- **The ledger identity stays the base's.** The override keeps the base flow's name and owner, so the activation toggle, the ledger row, `FLOW_DISABLED` and the §7.3 subflow guard treat it as the base. Switched off, it is silent. Switched on, it is armed again.
- **Deleting it restores the base.** A `/meta` delete naming the pair removes its row (admitted past the sealed-removal refusal, as the narrowing direction), and each arming step re-arms the base with one registration, never a withdraw first. A run suspended on the base finishes on the base (N-12), while new runs start on the override.
- **Every other stored row stays shadowed.** A dependent package's declaration, a package-less row whose body names the pair, and the pair's undeclared row are not armed. The shadowing warning's remedy is now "declare it as an override in '<base>.custom' (overrides: { package, basedOn }), or save it under a new name". It no longer says "clone".
- **The sealed save sentence for a packaged flow** names the declaration in place of the clone route: "… Declare an override from '<base>.custom' or rename it to customize it, or switch it off (…). See docs/adr/0126-packaged-metadata-customization-model.md." A delete still names the clone and the switch.

No spec key is added or reshaped. A flow item's existing `overrides` declaration, refused before, now takes effect.
