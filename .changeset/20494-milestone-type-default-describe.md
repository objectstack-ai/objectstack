---
'@objectstack/spec': patch
---

`activityMilestones[].type`'s `.describe()` now states the real default: an unset `type` keeps the update row's kind, `updated` (#20494)

Clause-②: no

No behaviour changes and no schema shape change. `object.zod.ts`'s `activityMilestones[].type` field described its default as `"completed"`; the runtime never wrote that. `audit-writers.ts` starts `activityType` from `activityTypeFor(action)`, and a milestone can only fire on the UPDATE branch (`create` / `delete` return their own summary before the milestone match ever runs), so an unset `type` has always emitted `updated`. `milestone.type` overrides it only when the author actually sets it — that half of the describe was correct and is unchanged.

The corrected string is the published half: it ships in `packages/spec/dist/*.d.ts`, in the JSON Schema under `packages/spec/json-schema/`, and in the generated `content/docs/references/data/object.mdx` (regenerated with `gen:docs`, never hand-edited). A repo-wide search for the old wording found no other hand-written copy; `object.form.ts`'s `activityMilestones.type` help text ("Unset: updated.", shipped with PR #20485) already stated the real default and is unchanged.

`packages/plugins/plugin-audit/src/activity-type-vocabulary-enforcement.test.ts` already measured the runtime's real answer — its title and docblock are corrected in the same PR to stop describing a divergence and stop saying the finding was "filed separately" (this card, #20494, is where it was filed). Its assertions are byte-for-byte unchanged.
