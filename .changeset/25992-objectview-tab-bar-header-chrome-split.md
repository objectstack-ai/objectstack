---
'@object-ui/app-shell': patch
---

refactor(app-shell): the Console `ObjectView`'s view tab strip, plugin schema and header chrome move into sibling hooks

Clause-②: no
Metadata-protocol: none

Three concerns move verbatim out of `ObjectViewInner` in `views/ObjectView.tsx`. The view tab items, the `ViewTabBar` handed to the list toolbar and its own-row face move into `useObjectViewTabBar` in `objectViewTabBar.tsx`. The views with the open draft merged in and the `ObjectViewSchema` handed to the plugin `ObjectView` move into `useObjectViewPluginSchema` in `objectViewPluginSchema.ts`. The header's create button, its folded actions menu and the list area for a refused view move into `useObjectViewHeaderChrome` in `objectViewHeaderChrome.tsx`. The component passes every input in and reads the returned values. No logic, name or rendered output changes, and the package entry is unchanged.

What to do: nothing.
