---
'@objectstack/spec': minor
---

Declare 14 registry-published props on the react-tier `ObjectForm` block (ADR-0082 D4 declaration parity, #9392): `modalCloseButton`, `contentLayout`, `confirmOnDiscard`, `customFields`, `readOnly`, `submitText`, `cancelText`, `nextText`, `prevText`, `showSubmit`, `showCancel`, `showReset`, `successMessage`, `resetOnSuccess` — the inputs objectui#4648/objectui#4901 published on the `object-form` registration that the react-blocks channel of the spec never declared. Descriptions are adapted from objectui's own registration; the generated react-blocks contract (`skills/objectstack-ui`) picks them up.

Three registry inputs are deliberately NOT declared and are instead baselined with recorded reasons (maintainer ruling 2026-08-18 on #9392): `initialData` (alias spelling of `initialValues` — aliases are not promoted into spec), `mobile` (internal presentation override, not an authoring surface), and `navigateOnSuccess` (parked pending the action-success-navigation family ruling; revisit tracked on #9392).
