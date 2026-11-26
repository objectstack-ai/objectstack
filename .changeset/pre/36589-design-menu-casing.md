---
'@object-ui/app-shell': patch
---

fix(app-shell): the design-mode menu builds on a case-insensitive file system — its helper module no longer shares the component's name up to letter case

Clause-②: no
Metadata-protocol: none

`layout/` held the menu editor component `DesignModeMenu.tsx` beside its pure tree helpers `designModeMenu.ts`. On a case-insensitive file system (the macOS default) the sidebar's lazy `import('./DesignModeMenu.js')` tried `.ts` first and found the helper module, which has no default export: the `@object-ui/app-shell` build failed with TS1149 ("differs from already included file name … only in casing"), and a Console bundled there turned the whole page white when 「Edit app」 opened design mode. The helpers are now `designModeMenuModel.ts` (its test `designModeMenuModel-36363.test.ts`), so `./DesignModeMenu.js` can only reach the component. No behaviour changes; Linux builds were never affected.
