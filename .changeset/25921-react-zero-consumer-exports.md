---
'@object-ui/react': patch
---

refactor(react)!: retire twenty zero-consumer exports, and delete the two motion hooks, two helpers and one type nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/react#formatUnresolvableVisibilityMessage, @object-ui/react#evaluateConfigBagInScope, @object-ui/react#useHasPageVariables, @object-ui/react#getShortcutDescriptions, @object-ui/react#useReducedMotion, @object-ui/react#AnimationTriggerType, @object-ui/react#SUPPORTED_TRANSITION_PRESETS, @object-ui/react#SUPPORTED_EASING_FUNCTIONS, @object-ui/react#useViewTransition, @object-ui/react#ViewTransitionConfig, @object-ui/react#ViewTransitionResult, @object-ui/react#useOptionalTheme, @object-ui/react#resolveNotificationPresentation, @object-ui/react#SUPPORTED_NOTIFICATION_DISPLAY_TYPES, @object-ui/react#SUPPORTED_NOTIFICATION_POSITIONS, @object-ui/react#SUPPORTED_NOTIFICATION_ACTION_VARIANTS, @object-ui/react#HostMapStyleContext, @object-ui/react#RecordPagePreferencesContext, @object-ui/react#PrintPageContext, @object-ui/react#NoDataSourcePanel) the retired operands are React hooks, three raw context objects, a diagnostic formatter, a config-bag evaluator, a fallback panel component, four supported-value sets, one presentation resolver and three option interfaces; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these twenty names from `@object-ui/react`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

Seven of them are **gone from the package, not only from the entry**, because nothing inside the package read them either: the `hooks/useReducedMotion.ts` module (`useReducedMotion`) and the `hooks/useViewTransition.ts` module (`useViewTransition`, `ViewTransitionConfig`, `ViewTransitionResult`) are deleted, and the functions `useHasPageVariables` and `getShortcutDescriptions` and the type `AnimationTriggerType` are deleted from their modules.

The other thirteen stay in their modules for the code that reads them and only leave the entry: `formatUnresolvableVisibilityMessage` (the visibility reporter still formats with it), `evaluateConfigBagInScope` (`useConfigBagEvaluator` still calls it), `SUPPORTED_TRANSITION_PRESETS` / `SUPPORTED_EASING_FUNCTIONS` (`useAnimation` still validates with them), `useOptionalTheme`, `resolveNotificationPresentation` and the three `SUPPORTED_NOTIFICATION_*` sets (`NotificationProvider` still uses them), the raw `HostMapStyleContext` / `RecordPagePreferencesContext` / `PrintPageContext` objects, and `NoDataSourcePanel` (`ElementDataSourceGate` still renders it). Every other name the entry exported stays exported unchanged, among them `reportUnresolvableVisibilityPredicate`, `UNRESOLVABLE_VISIBILITY_PREFIX`, `UNRESOLVABLE_ENABLEMENT_PREFIX`, `useAnimation`, `useTheme`, `useNotifications`, `NotificationProvider`, the `HostMapStyleProvider` / `RecordPagePreferencesProvider` / `PrintPageProvider` providers with their `useHostMapStyle` / `useRecordPagePreferences` / `usePrintPage` hooks, `usePageVariables`, `useKeyboardShortcuts` and `ElementDataSourceGate`.

What leaves, and what to write instead:

- FROM `useReducedMotion` TO `window.matchMedia('(prefers-reduced-motion: reduce)')` in your own hook; the package no longer carries one.
- FROM `useViewTransition`, `ViewTransitionConfig`, `ViewTransitionResult` TO `document.startViewTransition` called directly; the package no longer carries a wrapper.
- FROM `useHasPageVariables` TO `usePageVariables()`, which answers a frozen empty value outside a `PageVariablesProvider`.
- FROM `getShortcutDescriptions` TO a local map over your `KeyboardShortcutDefinition[]` (filter on `description` and `enabled !== false`).
- FROM `AnimationTriggerType` TO a local string union: no function in the package takes it.
- FROM `formatUnresolvableVisibilityMessage` TO `reportUnresolvableVisibilityPredicate`, which formats and reports in one call; filter its lines by `UNRESOLVABLE_VISIBILITY_PREFIX` / `UNRESOLVABLE_ENABLEMENT_PREFIX`.
- FROM `evaluateConfigBagInScope` TO `SchemaRenderer`, which evaluates a node's config bag itself.
- FROM `SUPPORTED_TRANSITION_PRESETS`, `SUPPORTED_EASING_FUNCTIONS` TO the `TransitionPresetType` / `EasingPreset` types; `useAnimation` already validates the preset.
- FROM `useOptionalTheme` TO `useTheme` inside a `ThemeProvider`.
- FROM `resolveNotificationPresentation`, `SUPPORTED_NOTIFICATION_DISPLAY_TYPES`, `SUPPORTED_NOTIFICATION_POSITIONS`, `SUPPORTED_NOTIFICATION_ACTION_VARIANTS` TO `NotificationProvider` and `useNotificationsByPresentation`, which resolve the presentation and validate the options themselves.
- FROM `HostMapStyleContext`, `RecordPagePreferencesContext`, `PrintPageContext` TO their providers (`HostMapStyleProvider`, `RecordPagePreferencesProvider`, `PrintPageProvider`) and hooks (`useHostMapStyle`, `useRecordPagePreferences`, `usePrintPage`).
- FROM `NoDataSourcePanel` TO `ElementDataSourceGate`, which renders it when no data source resolves, or `noDataSourceMessage` for the text.
