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

A package can now ship a flow switched off: declare `defaultActive: false` on the flow, beside `status: 'active'`. On an installation where no administrator has switched the flow, it is not armed and does not run, and `GET /api/v1/automation/_status` reports it `enabled: false`. An administrator turns it on with the packaged-flow switch (`POST /api/v1/automation/:name/toggle`, or the Enabled switch on a read-only package's flow in Studio), which writes an activation-ledger row (`sys_metadata_activation`). That row wins over the declared default in either state: a flow switched on stays on across a restart, an upgrade and a reinstall, and one switched off stays off. With no row the flow follows the version installed today, so an upgrade that changes the declaration moves only installations nobody switched. Absent or `true`, the flow ships on, as every packaged flow did before.

`status` stays the author's switch: `obsolete` and `invalid` disarm the flow everywhere, and the packaged-flow switch does not override them.

Only a flow a package ships has the packaged-flow switch, so:

- registering a flow authored in the environment that declares `defaultActive` is refused (the write doors answer `VALIDATION_FAILED`, 400), with a sentence saying its switch is its `status` (`'obsolete'` to keep it off, `'active'` to arm it);
- `POST /api/v1/automation/:name/clone` drops `defaultActive` from the copy, which is written switched off by its own `status` as before;
- an unmanaged install copies `defaultActive: false` as `status: 'obsolete'` (unless the status already disarms the flow) and drops the key, so the copy arrives switched off.

ADR-0126 §4 carries an amendment note: "absence of a row means the packaged default" now reads the default a packaged flow declares; the ledger's shape is unchanged.
