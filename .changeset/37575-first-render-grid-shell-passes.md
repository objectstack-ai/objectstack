---
'@object-ui/plugin-grid': patch
'@object-ui/i18n': minor
'@object-ui/layout': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@objectstack/console': patch
---

perf(console): a list page draws its rows once before they paint, and the shell re-renders less during first load

Clause-②: no
Metadata-protocol: none

On a list page's first load the grid drew its whole table several times between the rows' first render and their first paint: once with row-end controls before the list page scope was known, once when the inline-action fold found its host, and once when the record verdicts were republished with nothing new in them. The rows now draw once, without row-end controls, and those passes are gone.

The shell does less during first load too. The app's own locale list lands after the console has drawn; it used to re-render every component that reads a translation, about 1,900 of them. It is now read with `useAppContentLanguages()` from `@object-ui/i18n`, and only the language menus re-render for it. `useObjectTranslation()` and `useI18nContext()` no longer carry `appContentLanguages`. The expanded sidebar no longer mounts a tooltip on every entry (it never showed one there; the icon rail still does), and an entry is not redrawn when a new capability checker gives it the same answer.

Nothing changes in what the list, the sidebar or the language menus show.
