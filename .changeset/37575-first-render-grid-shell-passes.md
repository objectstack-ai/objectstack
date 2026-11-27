---
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
'@object-ui/react': patch
'@object-ui/layout': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@objectstack/console': patch
---

perf(console): a list page draws its rows once before they paint, and the shell re-renders less during first load

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, metadata type or stored row is added, removed or renamed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the value two React hooks of @object-ui/i18n return: `useObjectTranslation()` and `useI18nContext()` no longer carry `appContentLanguages`, which moved to its own hook. Its consumer is code, and the compiler names every reader left behind. `runtime-interface-only` does not fit on a checked fact: the context value's interface is not exported, so it cannot be named by path. -->

On a list page's first load the grid drew its whole table several times between the rows' first render and their first paint: once with row-end controls before the list page scope was known, once when the inline-action fold found its host, and once when the record verdicts were republished with nothing new in them. The rows now draw once, without row-end controls, and those passes are gone.

The shell does less during first load too. The app's own locale list lands after the console has drawn; it used to re-render every component that reads a translation, about 1,900 of them. It is now read with `useAppContentLanguages()` from `@object-ui/i18n`, and only the language menus re-render for it. `useObjectTranslation()` and `useI18nContext()` no longer carry `appContentLanguages`. A sidebar entry is not redrawn when a new capability checker gives it the same answer.

Nothing changes in what the list, the sidebar or the language menus show.

**BREAKING** (`@object-ui/i18n`, and `@object-ui/react`, which re-exports the same two hooks: their return values), shipped as `patch`: the change is not to the metadata protocol (`Metadata-protocol: none`).

- Removed: the `appContentLanguages` field from what `useObjectTranslation()` and `useI18nContext()` return, whether they are imported from `@object-ui/i18n` or from `@object-ui/react`. It was added there by #36040.
- Use instead: `useAppContentLanguages()`, which both entries now export: `@object-ui/i18n`, and `@object-ui/react` beside the two hooks. It returns the same value, the app's declared content languages or `null` while they are unknown, and `null` outside an `I18nProvider`.
- Why: the list lands after the console has drawn. While it rode on the translation context, its arrival re-rendered every component that reads a translation, about 1,900 of them on first load. In its own context only the components that read it re-render.
