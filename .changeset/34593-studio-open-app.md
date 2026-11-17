---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Studio's top bar opens the running app, the package switcher hides kernel packages, and the read-only app bar entry shows its text

Clause-②: yes (widening) — locale keys only: three new `@object-ui/i18n` studio keys (`engine.studio.openApp`, `engine.studio.openAppTitle`, `engine.studio.openAppPick`) and the added `{{app}}` variable in `topbar.openAppInStudio`; nothing that worked before is refused
Metadata-protocol: none

- Studio's workbench top bar has an "Open app" button that returns to the package's running app in the same tab. It reads the `?surface=` the workbench has in focus, which is the same target the app bar's Edit app hands Studio. From an object it lands on that object's list in the app. From a dashboard, page or report it lands on that interface. Otherwise it lands on the app's home. When the package has several published apps, the button opens a picker. A package whose only app is still a draft gets no button. Unsaved pillar work asks before leaving, as the Home button does.
- The Studio package switcher no longer lists kernel packages. Before, the rows served with only a top-level `scope` of `system` or `cloud` (such as `sys.env-artifact-cache`) were still listed. ADR-0016 §3.8 keeps kernel packages out of the authoring selector, so there is no toggle to show them. `parsePackages` still returns those rows tagged `kernel`, because the app → Studio entry gate reads the tag.
- In the app bar, the entry for a read-only package shows its text next to the eye: "Open {app} in Studio" (「在 Studio 中查看 {app}」, ADR-0146 D5). Below `sm` it is still not drawn, and the app switcher's Studio row stays the phone's way in.
- New strings `engine.studio.openApp`, `engine.studio.openAppTitle` and `engine.studio.openAppPick` (en, zh). The `topbar.openAppInStudio` text now names the app in every locale.
