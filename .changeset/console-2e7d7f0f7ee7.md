---
"@objectstack/console": patch
---

Console (objectui) refreshed to `2e7d7f0f7ee7`. Frontend changes in this range:

- feat(evaluator): route CEL-dialect component/action predicates to the canonical engine (#2664)
- fix(grid): explain the import wizard's disabled Next and silent downgrade (#2640, #2639) (#2646)
- fix(form+detail): single-file children stay inline grids; drop non-spec `attachment` (#2654, #2655) (#2656)
- feat(access): localize curated capability labels client-side (#2600 B5 follow-up) (#2657)
- feat(access): localize capability picker group headers (#2600 B5, objectui side) (#2653)
- fix(access): Studio permission matrix — stop clipping the Bulk column at narrow widths (#2600 B3) (#2652)
- feat(access): Studio permission matrix — field-level bulk + filter for wide objects (#2600 B4) (#2651)
- feat(access): Studio Explain panel — package-scoped object dropdown instead of free-text api-name (#2600 B2) (#2650)
- feat(access): Studio permission matrix — collapse identity + zero-grant capabilities so the matrix hits the first screen (#2600 B1) (#2649)
- feat(plugin-list): 列表工具栏增加手动刷新按钮 (#2634) (#2645)
- fix(studio): approver Type dropdown drops deprecated `role`, membership-tier picker (#2643)
- fix(components): route internal html-page links through the SPA navigation handler (#2642)
- feat(discovery): trust only handlerReady/available services (ADR-0076 D12) (#2637)
- feat(types)!: adopt @objectstack/spec 15.1.1; drop value-erased spec/ui `…Schema` re-exports (#2589)
- feat(console): dev-seeded admin credentials hint on the login page (#2635)
- fix(auth): 注册页去掉重复的「or」分隔线(与 #2629 登录页修复对齐) (#2633)
- feat(app-shell/react): adapt to framework 15.1 — atomic publish rendering + honest discovery (#2630)
- fix(chatbot): plan approval flips the card to a Building… badge immediately (#2632)
- fix(app-shell,components): welcome CTA deep-links into the environment create dialog (#2631)
- fix(auth): login-page config race + sign-in watchdog — never strand SSO-only users on a password wall (#2629)
- feat(types): derive ListViewSchema from @objectstack/spec/ui (#2231) (#2622)

objectui range: `077e45b4bc55...2e7d7f0f7ee7`
