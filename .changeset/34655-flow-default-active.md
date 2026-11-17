---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
---

feat(spec, service-automation): a packaged flow can ship switched off for an administrator to turn on (`defaultActive: false`)

Clause-②: yes (widening) — `FlowSchema` gains the optional `defaultActive` boolean. A flow that declares it was refused before as an unknown key; a packaged flow that declares it now registers. A flow authored in the environment that declares it is still refused, now with a sentence naming its `status` as its switch. Nothing that registered before is refused.
Metadata-protocol: added
Skills-docs: updated here — skills/objectstack-automation/SKILL.md (one paragraph under "A flow an installed package ships"), evals/flows-triggers-approvals.json (eval id 24)

A package can now ship a flow switched off: declare `defaultActive: false` on the flow, beside `status: 'active'`. On an installation where no administrator has switched the flow, it is not armed and does not run, and `GET /api/v1/automation/_status` reports it `enabled: false`. An administrator turns it on with the packaged-flow switch (`POST /api/v1/automation/:name/toggle`, or the Enabled switch on a read-only package's flow in Studio), which writes an activation-ledger row (`sys_metadata_activation`). That row wins over the declared default in either state: a flow switched on stays on across a restart, an upgrade and a reinstall, and one switched off stays off. With no row the flow follows the package's own declaration for the version installed today, so an upgrade that changes it moves only installations nobody switched; a declared `.custom` override armed in the package's place does not change the default, whatever it declares. Absent or `true`, the flow ships on, as every packaged flow did before. A package that declares the key needs a platform at or above this release: an older one refuses the flow as an unknown key.

`status` stays the author's switch: `obsolete` and `invalid` disarm the flow everywhere, and the packaged-flow switch does not override them.

Only a flow a package ships has the packaged-flow switch, so:

- registering a flow authored in the environment that declares `defaultActive` is refused, with a sentence saying its switch is its `status` (`'obsolete'` to keep it off, `'active'` to arm it). The automation write doors (`POST /api/v1/automation`, `PUT /api/v1/automation/:name`) answer `VALIDATION_FAILED`, 400, and store nothing; a dry run refuses the draft; the metadata door (`PUT /api/v1/meta/flow/:name`), which parses without registering, stores the row, the engine refuses to arm it, and `os migrate meta --stored` lists it at the key;
- `POST /api/v1/automation/:name/clone` drops `defaultActive` from the copy, which is written switched off by its own `status` as before;
- an unmanaged install copies `defaultActive: false` as `status: 'obsolete'` (unless the status already disarms the flow) and drops the key, so the copy arrives switched off.

A name two packages ship is a package's flow too: each holder's body registers with the key, on every re-sync and upgrade, and the refusal above is only for a name no package ships.

For hosts that compose the engine themselves, `AutomationEngine.setPackagedFlowDefaultSource(source)` and its `PackagedFlowDefaultSource` type are new public API. The automation plugin attaches the reader (it asks the metadata protocol for the package's own body); it is how the engine reads the package's default while a declared `.custom` override is armed in the package's place, and it is asked once per registration, not on every enablement read. `AutomationEngine.refreshPackagedFlowDefaults()` is new public API too: it asks the reader again for every armed body that is not the package's own, and re-arms or disarms each flow whose answer moved; the automation plugin calls it at every `metadata:reloaded` re-sync, so a hot upgrade that changes the declared default reaches a flow whose override body was not re-registered. A host composing the engine itself calls it after the set of installed packages changes. An engine composed without a reader reads the default only off an armed package body, so while an override is armed a flow its package ships off runs (fail-open): such an engine cannot see the package's body, and treating an unknown default as on keeps the behaviour every packaged flow had before this release instead of switching off a flow no package was seen to declare off.

ADR-0126 §4 carries an amendment note: "absence of a row means the packaged default" now reads the default a packaged flow declares; the ledger's shape is unchanged.
