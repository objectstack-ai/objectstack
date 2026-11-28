---
'@object-ui/app-shell': patch
---

perf(app-shell): on a cold Console load the app bundle request leaves the moment the app list answers

Clause-②: no
Metadata-protocol: none

On an app route the console root asked the app's metadata bundle (`GET /api/v1/meta/app/:name/bundle`) from an effect of the render that names the app, so a whole tree re-render sat between the app list's answer (`GET /api/v1/meta/app`) and the bundle request: 226 ms on an idle box and 378 ms on a busy one (medians over 27 cold loads each). The bundle is now asked in the app list's own answer. The app list still decides which app the route names (the route segment is a package id or an app name) and whether the user may see it, so it is the same request, through the same adapter and session, for the same app, once; a route naming an app the list does not hold still asks no bundle. Measured on the live lane's build (backend `--fresh`, `vite build` with `VITE_BASE_PATH=/`, `vite preview`), the bundle request moved from 946 ms to 764 ms after navigation idle and from 1343 ms to 974 ms with four CPU-bound processes running; the page heading moved from 2300 ms to 2035 ms (median) on the busy box and did not move outside noise on the idle one.
