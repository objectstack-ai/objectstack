---
'@objectstack/service-automation': patch
---

A flow saved through the metadata API is armed on the running engine at once, as hooks and actions saved through the same door already are

Clause-②: no

`PUT /api/v1/meta/flow/:name` answered `200 "Saved flow … (env-wide, state=active)"` and `GET /api/v1/meta/flow/:name` served the row, but the automation engine registered nothing until the process restarted: `GET /api/v1/automation/:name` and `POST /api/v1/automation/:name/trigger` answered `404 Flow not found`, and a record-triggered flow never fired. The engine armed flows only at boot, at `kernel:ready` and on `metadata:reloaded`, and only the publish doors announce that event.

The automation service now listens to the metadata protocol's post-write signal (`onMetadataMutation`), the one ObjectQL already re-binds authored hooks and actions on, and makes the engine follow the stored row of each flow it names:

- an active save or a publish registers the flow, or re-registers it over the definition the engine held;
- a save whose `status` is `'obsolete'` or `'invalid'` keeps it registered and unbound, as a boot does;
- a delete unregisters it;
- a draft save changes nothing until it is published.

The flow is re-read through the same execution view, precedence and env-wide scope the boot reads, so a save never arms a flow beyond the reach a restart would give it. The save answers first, and the registration follows it by one read of the stored metadata.

A publish raises this signal and `metadata:reloaded` together, and the published flow is still registered once, not twice. `PUT /api/v1/automation/:name`, which registers the flow before it saves it, is not registered a second time either.

A run already executing keeps the definition it started with. A suspended run resumes against the definition registered when it resumes, and answers `RUN_NOT_FOUND` once its flow is deleted. Both already held for a re-registration through a publish or `PUT /api/v1/automation/:name`.
