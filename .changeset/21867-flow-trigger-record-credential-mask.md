---
'@objectstack/trigger-record-change': minor
'@objectstack/spec': patch
---

fix(trigger-record-change)!: a record-change flow's trigger record carries the credential mask and omits internal fields

Clause-②: no

<!-- adr-0087: registered flow-trigger-record-credential-masked -->

**BREAKING**: the `record` and `previous` a record-change flow receives are now served on the generic read path's terms (ADR-0100). A credential-class field — every `secret` field, and every `password` field outside the exempt `managedBy` buckets — reads as the mask `SECRET_MASK` when set and `null` when unset, and a field declared `internal: true` is absent. It ships as `minor` under the launch-window convention for a changed answer. No export, schema key or error code is added or removed.

**What changed.** The trigger built both roots from the engine's own write result, which keeps the stored row whole for privileged in-process callers. A credential's stored value and an internal field's value therefore reached the flow, and from there its variables map, a paused run's persisted state and the read doors over that state. The trigger now projects both roots through `omitInternalFieldsFromWriteResponse` from `@objectstack/core`, the helper every external write response already uses, with the trigger object's definition. Everything downstream inherits the projection: the variables map, a paused run's persisted state and its read doors, and the run a resume rehydrates, in the same process and after a restart.

**FROM → TO.**
- `{record.<password or secret field>}` and `{previous.<password or secret field>}` in a record-change flow: FROM the stored value (the plaintext password, or the secret's stored handle) → TO `SECRET_MASK` when set, `null` when unset.
- `{record.<internal field>}` and `{previous.<internal field>}`: FROM the stored value → TO absent.

**If you are affected.** A flow that needs a credential reads it through a privileged binder (the flow credential channel, or a privileged server-side read such as the engine's `resolveSecretField`), never off the trigger record. A start or edge condition that compared such a field with a literal tests whether it is set (`!= null`) instead. A condition that compares `record.<credential field>` with `previous.<credential field>` now sees two equal masks whenever the field is set on both sides, so it can no longer detect a change; use a privileged binder to detect a credential change.

**Runs stored before this release.** The mask applies to trigger records built after the upgrade. Paused runs, and terminal runs that keep a restorable snapshot, created before it still hold the clear values in `variables_json`, `context_json` and `steps_json`. After upgrading, resume, cancel or purge those runs.

**Unchanged.**
- Every ordinary field of the trigger record keeps its value, and every other flow variable is untouched.
- The engine's own write result, the stored row and the privileged read paths (`resolveSecret`, `resolveSecretField`) are unchanged.
- Records a flow reads later through its data nodes already came through the generic read path, which masks them.
