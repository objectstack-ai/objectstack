---
'@objectstack/cli': minor
---

Ratify `./console` as a public subpath export — `resolveConsolePath`, `hasConsoleDist`, `createConsoleStaticPlugin` and the drift-guard helpers were reachable as a deep `dist/` import until #13123 sealed the surface, and cloud's `objectos-runtime` node server consumes them to mount the Console SPA. The #13123 body names exactly this remedy for an out-of-repo consumer: ratify the subpath as public surface rather than read `dist/` paths.
