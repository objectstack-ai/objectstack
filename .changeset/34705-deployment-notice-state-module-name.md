---
'@object-ui/app-shell': patch
---

fix(app-shell): the deployment notice's state module no longer shares its name with the component, so app-shell builds on a case-insensitive file system

Clause-②: no
Metadata-protocol: none
Skills-docs: none — an internal module rename; no skill page names either file.

`ui/packages/app-shell/src/console/deployment-notice/` held `DeploymentNotice.tsx` (the component) and `deploymentNotice.ts` (its wire and storage), two names that differ only in letter case. On a case-insensitive file system, the default on macOS, `../deployment-notice/DeploymentNotice.js` resolved to the state module, so `tsc` failed the app-shell build (`TS2724`, `TS1261`). The state module is now `deploymentNoticeState.ts`, and its two importers follow. Nothing exported by the package changes.
