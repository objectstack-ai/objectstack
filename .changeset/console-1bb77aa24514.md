---
"@objectstack/console": minor
---

Console (objectui) refreshed to `1bb77aa24514`. Frontend changes in this range:

- fix(flow-runner): honor a screen field's `visibleWhen` — render and validation (framework#3528) (#2899)
- fix(i18n): unconditional Chinese in the chatbot confirm card and field inspector (#2884, #2885) (#2900)
- fix(actions): one precedence for `target`/`execute`, and stop mislabeling server-side `body` (#2896) (#2895)
- fix(i18n): close the last three zh-branch gaps (#2871, part 3) (#2898)
- feat(grid): compute all eleven spec column summary aggregations (#2890)
- feat(console): make `delegated_admin` reachable and narrow both role pickers (framework#3697) (#2891)
- fix(app-shell): localize the two DeclaredActionsBar strings that bypassed i18n (#2762 P0-3) (#2894)
- fix(i18n): delete the four `pick({en,zh})` clones (#2871, part 2) (#2893)
- fix(views): the five per-view-type configs speak the spec vocabulary (#2231 phase 3) (#2892)
- feat(grid): gate list row Edit/Delete and bulk delete on the effective operation set (objectstack#3720) (#2889)
- feat(charts): honor `ChartAxis.stepSize`, `ChartConfig.description` and `.height` (framework#3752) (#2888)
- fix(i18n): retire four hand-rolled zh/en branches (#2871, part 1) (#2887)
- feat(charts): ObjectChart honors the spec `ChartConfig` author shape (#2880) (#2883)
- fix(hooks): stop calling translation hooks inside try/catch (#2879) (#2881)
- fix(charts): a fieldless `count` aggregate keyed its value column `undefined` (framework#3701) (#2878)
- fix(i18n): make `en` the complete source of truth for grid import and set-password (#2872 b/c) (#2877)
- fix(auth): localize the ADR-0069 remediation gate and the auth split-panel (#2870) (#2875)
- fix(metadata-admin): drop the SkillPreview "Required Permissions" panel (framework#3686) (#2874)
- feat(console): scoped-invitation placement — invite straight into a unit and positions (framework ADR-0105 D8) (#2868)
- fix(attachments): read the storage service's new error envelope so gated downloads keep their friendly copy (objectstack#3675) (#2869)
- fix(fls): wire real per-caller FLS into import targets and grid columns, drop dead field.permissions shape (objectstack#3661) (#2866)
- fix(page,field): consume the spec's type/label/maxLength keys (framework#1878 §3 recheck) (#2867)
- fix(cloud-connection): localize the Cloud Connection panel (objectstack#3589 follow-up) (#2865)
- fix(dashboard,charts): send widget query options to the server, order funnel stages by the pipeline (#2864)
- fix(action): honor the spec disabled predicate on every action-rendering surface (#1885 follow-through) (#2863)

objectui range: `09c6a177bb4a...1bb77aa24514`
