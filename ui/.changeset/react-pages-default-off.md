---
'@object-ui/core': minor
'@object-ui/components': minor
'@object-ui/app-shell': minor
'@object-ui/console': minor
---

The `react-pages` capability (`kind: 'react'` pages, whose source runs in the application with no sandbox) now defaults to **off** in `@object-ui/core`. A host turns it on explicitly. This changes a published default; it is marked `minor` under this repository's version policy.

- **ObjectStack deployments.** The server decides: with `OS_PAGE_REACT_ENABLED=true` it writes the enable global (`window.__OBJECTUI_CAPABILITIES__`) into the Console document, and otherwise the disable global. A server older than that writes only the disable global, and only when the deployment set `OS_PAGE_REACT=off`, so on such a server react pages stay off until it is upgraded.
- **A host that embeds the renderer.** FROM: react pages ran unless the host called `disableCapability('react-pages')`. TO: they run only after the host calls `enableCapability('react-pages')` (or sets the enable global before the bundle runs).
- **While off**, a react page renders the "React pages are disabled on this deployment" notice, which now names `OS_PAGE_REACT_ENABLED=true` as the switch, and the Studio's new-page dialog offers only the `html` kind. `kind: 'html'` pages are unaffected.

Clause-②: no
Metadata-protocol: none
