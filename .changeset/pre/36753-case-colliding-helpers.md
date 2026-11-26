---
'@object-ui/app-shell': patch
---

fix(app-shell): the console builds on macOS again — two helper modules no longer differ from their component only by letter case

Clause-②: no
Metadata-protocol: none

`layout/DesignModeHeaderPins.tsx` sat beside `layout/designModeHeaderPins.ts`, and `views/RecordTabsConfig.tsx` beside `views/recordTabsConfig.ts`. On a case-insensitive file system (macOS by default) an import of the component resolved to the helper, so the app-shell type build and the console bundle failed there (`MISSING_EXPORT`, TS1149) while Linux CI stayed green. The helpers are now `designModeHeaderPinsModel.ts` and `recordTabsConfigModel.ts`, with their importers and unit-test file names updated. No behaviour changes.

A repo-wide check, `scripts/check-case-colliding-paths.mjs`, now runs in CI through `pnpm check:gitlink-declared` and refuses two tracked entries in one directory whose names, with the last extension dropped, differ only by case.
