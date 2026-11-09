---
'@objectstack/service-settings': patch
'@objectstack/spec': patch
---

fix(service-settings): the settings manifest list serves a sourced select's options, the table the save judges against, as the namespace read does

Clause-②: no — the manifest list now states the table the save already enforces; nothing a caller sends is refused differently.
Metadata-protocol: none

A select key whose options come from the running system (`localization.locale`: the languages the deployment's i18n service reports) was served its live options only by the namespace read (`GET /api/settings/:namespace`). `SettingsService.getManifest()`, `SettingsService.listManifests()` and `GET /api/settings` still carried the declared table (the four codes `en-US`, `zh-CN`, `ja-JP`, `es-ES`), so a reader of the manifest list (the Setup hub, an SDK caller) was told a table that is not the one a save is judged against.

- **Now.** All three are served through the same resolution as the namespace read: a sourced key carries its source's options; every other key, and a sourced key whose source has no answer (no i18n service in the composition), carries the declared table as before. `getManifest(namespace, display?)` and `listManifests(ctx?, display?)` take an optional display language; `GET /api/settings` passes the request's. The registered manifest is never changed.
- **Spec.** The `valueDomain` description in `settings-manifest.zod.ts` names the runtime option source beside `valueDomain` as the other mover of a select's enforcement boundary: where a source answers, the declared `options` are the fallback.
