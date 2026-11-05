---
'@object-ui/plugin-dashboard': patch
---

refactor(plugin-dashboard)!: retire five zero-consumer exports (the config panel's defaults table and hook, the retired-node tombstone and its report and reset helpers)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-dashboard#CONFIG_PANEL_DEFAULT_TRANSLATIONS, @object-ui/plugin-dashboard#useConfigPanelTranslation, @object-ui/plugin-dashboard#RetiredDashboardNodeTombstone, @object-ui/plugin-dashboard#reportRetiredDashboardNodeType, @object-ui/plugin-dashboard#resetRetiredDashboardNodeTypeReports) the retired operands are a provider-less English defaults table, the translation hook that reads it, the React widget that refuses a retired dashboard node type and its two console-report helpers; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these five names from `@object-ui/plugin-dashboard`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Every module stays in the package: the config panels keep using the hook and its table, and the package still registers the tombstone for every retired dashboard node type, so an authored `view:dashboard` is refused by name exactly as before. Only the entry stops publishing them. `RETIRED_DASHBOARD_NODE_TYPES`, `ConfigPanelTranslate`, `DashboardMetricNodeSchema`, the three `WidgetDataset*` types and every component stay exported unchanged.

What leaves, and what to write instead (none has a replacement export):

- FROM `CONFIG_PANEL_DEFAULT_TRANSLATIONS`, `useConfigPanelTranslation` TO no replacement: `DashboardConfigPanel` and `WidgetConfigPanel` translate their own labels; mount an `I18nProvider` to change them.
- FROM `RetiredDashboardNodeTombstone` TO no replacement: the package registers it under every key of `RETIRED_DASHBOARD_NODE_TYPES` itself, so rendering a retired node through `SchemaRenderer` still shows the refusal.
- FROM `reportRetiredDashboardNodeType`, `resetRetiredDashboardNodeTypeReports` TO no replacement: the tombstone reports on its own, once per retired type; read the migration text from `RETIRED_DASHBOARD_NODE_TYPES`.
