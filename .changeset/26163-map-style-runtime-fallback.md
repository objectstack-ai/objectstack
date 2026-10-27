---
'@object-ui/plugin-map': patch
'@object-ui/react': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(plugin-map): a map view with no style of its own draws the deployment's default map style before the public demo style

Clause-②: no
Metadata-protocol: none

An operator who sets `OS_CONSOLE_MAP_STYLE_URL` now gets that style on every map view that names none. A map draws the first style it finds, in this order:

1. the view's own style: `mapStyle`, then `map.style`;
2. the deployment's default style, the runtime-config `mapStyleUrl`;
3. the public MapLibre demo style.

- **`@object-ui/react`:** `HostMapStyleProvider` and `useHostMapStyle()` let a host hand the deployment's default map style to the map renderer. Outside a provider, the hook answers `undefined` and the map keeps the demo style.
- **`@object-ui/app-shell`:** the runtime config reads the top-level `mapStyleUrl` into `AppShellRuntimeConfig.mapStyleUrl`, re-read from each payload, and `ConsoleShell` supplies it through `HostMapStyleProvider`.
- **`@object-ui/plugin-map`:** `ObjectMap` reads the host's style after the view's own. When the deployment's style fails to load, the notice above the record list says the deployment's default map style could not be loaded and asks the reader to have an administrator check it. It no longer blames the public default tiles, which that map never drew.
- **`@object-ui/i18n`:** one new key, `element.map.styleFailedDeployment`, in all ten packs.

What to do: nothing. A deployment that sets no `OS_CONSOLE_MAP_STYLE_URL` draws the demo style as before, and a view's own `mapStyle` still wins.
