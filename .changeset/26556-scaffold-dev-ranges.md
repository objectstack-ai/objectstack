---
'@object-ui/cli': patch
'@object-ui/create-plugin': patch
---

chore(scaffold): generated apps and plugins declare the dev ranges this repository now builds with

Clause-②: no
Metadata-protocol: none

The workspace moved `react-router-dom` to `^7.18.4` and `vite-plugin-dts` to `^5.1.2`. A routed app scaffolded by `@object-ui/cli` now declares `react-router-dom` `^7.18.4`, and a plugin scaffolded by `@object-ui/create-plugin` now declares `vite-plugin-dts` `^5.1.2`, so a new project starts on the same versions the in-repo packages are tested on.
