---
"@objectstack/console": minor
---

Console (objectui) refreshed to `2cb8d78e24ad`. Frontend changes in this range:

- fix(console): dispatch flow actions from every surface + cover the screen-flow round trip (framework#3528) (#2833)
- feat(approvals): typed output pickers, quick-path guard, expression completion (framework#3447, #2829) (#2831)
- fix(console): make a paused screen flow completable, and stop the runner from tearing down its host (framework#3528) (#2830)
- feat(fields): adopt the file-as-reference value shape — ObjectStack ADR-0104 D3 wave 2 (PR-7) (#2828)
- fix(console): resolve a modal action's `target` as a page, not an object (#3530) (#2826)
- feat(approvals): dynamic decision-output fields + expression approver editing (framework#3447 P2) (#2827)
- feat: render the server's effective API operation set (#3391 PR-4) (#2823)
- fix(console): approval timeline attachment chip shows its name and opens (#2820) (#2821)
- fix(i18n): localize FileField upload widget + approvals snapshot field labels (#2819)
- feat(report)!: drop SpecReportColumn/SpecReportGrouping re-exports + retire the legacy ReportViewer chart fallback (#3463) (#2816)
- feat(plugin-grid): "Import as historical data" option in the Import Wizard (framework #3479) (#2815)
- feat(app-shell): toast when a save silently dropped read-only fields (framework #3431/#3455) (#2814)
- fix(app-shell): remove never-firing `record-change` option from the flow trigger picker (#3427) (#2812)
- fix(form): scroll+focus the first errored field on invalid submit (#2793) (#2813)
- feat(approvals): label pending-approver chips with their group (objectui#2807) (#2811)
- feat(approvals): label pending-approver chips with their group (objectui#2807) (#2811)
- fix(approvals): surface the admin override for a stuck request in the inbox (#3424) (#2810)
- feat(studio): first-class notify flow node in the Studio palette + inspector (#2808)
- feat(app-shell): Studio flow start node offers a "Record created or updated" trigger (#3427) (#2809)
- fix: read spec-canonical keys for dashboard header title and field length rules (#2806)
- fix(kanban): surface off-column records in an Uncategorized lane (#2792) (#2804)
- fix(approvals): Approval Center density + amount emphasis (#2762 P2) (#2805)
- fix(i18n): 补齐记录详情审批按钮与弹窗的国际化文案 (#2791)
- fix(approvals): Approval Center triage + drawer readability pass (#2762 P1-2/3/4/5, P2) (#2803)
- feat(app-shell): surface step warnings in the Flow Runs panel (#3407) (#2802)
- feat(studio): surface the enable.searchable toggle in ObjectSettingsPanel (#2800) (#2801)
- feat(app-shell): localize the automations flow designer & inspector (en-US + zh-CN) (#2796)
- feat(form): consume spec-aligned FormView buttons/defaults in ObjectForm (#2790)
- fix(approvals): Approval Center UX pass — badge nowrap, approve confirm, progress bar, localized declared actions (#2762) (#2789)
- feat(app-shell): group/coalesce repeat notifications in the message center (#2765) (#2788)
- fix(app-shell): 首页与消息中心的未国际化文案 (#2787)
- fix(app-shell): give inline `lookup` action params a real record picker (#3405) (#2786)
- fix(app-shell): map raw sys_activity rows in the inbox Activity tab (#2781) (#2782)
- fix(app-shell): i18n the "Switch Object" breadcrumb dropdown label (#2783)
- fix(data-table): keep right-pinned action column header sticky on horizontal scroll (#2785)
- fix(app-shell): keep list-origin back link when switching detail tabs (#2775)

objectui range: `cf2d56e32a11...2cb8d78e24ad`
