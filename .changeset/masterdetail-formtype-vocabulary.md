---
'@objectstack/spec': minor
---

feat(spec)!: `ObjectMasterDetailFormPropsSchema.formType` narrows from bare `string` to the measured `simple | tabbed` (#11873 — the spec half of objectui#5939).

**Newly rejected:** `wizard`, `split`, `drawer` and `modal` — each names an `object-form` renderer branch that breaks `object-master-detail-form`'s atomic parent+details contract (wizard mounts only the current step and turns the Save bar into Next; split persists via `dataSource.create` around the batch; drawer/modal move the parent half into a portal dialog the Save bar cannot submit). Each refuses with a per-value prescription; any other string (e.g. `wizzard`) now gets the plain enum refusal instead of parsing clean and rendering a silently sectionless parent form.

**Write instead:** `simple` or `tabbed` — the two variants the renderer honours end-to-end for the parent half. For a wizard/split/drawer/modal presentation without inline details, author an `object-form`, whose `formType` keeps all six values.

Breaking ships as minor per the launch-window convention (`scripts/check-changeset-no-major.mjs`).

<!-- adr-0087: not-required (no-migration-prescription) the four dropped names were never this block's declared vocabulary — the key was a bare `z.string()`, so unlike the #8762 / #8010 precedents there is no spec-promised old value to rewrite — and the authored-value census on both repos (this repo, #11873; objectui, objectui#5939) found zero out-of-vocabulary occurrences. Nothing exists to migrate, so no migration is prescribed; live authors are taught at parse by the enum's per-value error-map prescriptions. -->

