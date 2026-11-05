---
'@object-ui/plugin-list': patch
---

refactor(plugin-list)!: retire three zero-consumer exports (the view switcher dropdown, the tab bar select and the conditional formatting wrapper)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-list#ViewSwitcherDropdown, @object-ui/plugin-list#TabBarSelect, @object-ui/plugin-list#evaluateConditionalFormatting) the retired operands are two React components and a function that wraps `@object-ui/core`'s conditional formatting resolver; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these three names from `@object-ui/plugin-list`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Every module stays in the package (`ListView` keeps rendering `ViewSwitcherDropdown`); only the entry stops publishing them. `ListView`, `ViewSwitcher`, `TabBar`, `UserFilters`, `normalizeFilterCondition`, `normalizeFilters`, `LIST_DEFAULT_TRANSLATIONS` and every exported type, `TabBarProps` included, stay exported unchanged.

What leaves, and what to write instead:

- FROM `ViewSwitcherDropdown` TO `ViewSwitcher`, or render `ListView`, which draws the dropdown itself.
- FROM `TabBarSelect` TO `TabBar`, which takes the same `TabBarProps`.
- FROM `evaluateConditionalFormatting` TO `resolveConditionalFormatting` from `@object-ui/core`, the function it wrapped: same arguments, result typed as `React.CSSProperties`.
