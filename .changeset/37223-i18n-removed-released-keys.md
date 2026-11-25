---
'@object-ui/i18n': major
---

feat(i18n)!: the 67 translation keys `@object-ui/i18n@18.6.0` shipped that no code reads any more are retired in 19.0.0

**BREAKING**: released keys are retired in 19.0.0. `@object-ui/i18n@18.6.0` shipped every key listed below; none of them is in the package any more, in any locale. No code in the platform reads them.

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) The retired operands are translation keys in the published i18n catalogues: no packages/spec schema, registered node type, stored metadata row or ADR-0087 conversion surface names them, and nothing a metadata author writes changes, so there is nothing for objectstack migrate meta to rewrite -->

If a deployment overrides one of these keys (in its own i18next resources, or a Studio catalogue it registers), that override no longer applies: nothing in the console or Studio asks for the key, so the overriding text is never shown. Remove the override, or move the text to the key the surface reads now.

`@object-ui/i18n` is in the changesets `fixed` group, so this `major` moves every package in that group to 19, every `@objectstack/*` package included. The line's opening marker is a second `major` (on `@objectstack/spec`) in the same group; two majors in one fixed group still give one 19.0.0. In pre mode under `next` the first version step reads `19.0.0-next.0`.

The list is reproduced by `node ui/packages/i18n/scripts/released-keys-removed.mjs` (the tag against `origin/main`, every locale and namespace the package publishes, nested keys flattened).

## Removed translation keys

### Language packs (`@object-ui/i18n`, `@object-ui/i18n/locales`), 32 keys

Each key below is removed from all eleven locales: ar, de, en, es, fr, ja, ko, pt-BR, ru, zh-Hans, zh-Hant.

- `appDesigner.fieldDesigner.trackHistory`
- `console.firstRunChecklist.confirm`
- `console.firstRunChecklist.currency.saved`
- `console.firstRunChecklist.currency.title`
- `console.firstRunChecklist.currency.todo`
- `console.firstRunChecklist.languageCountry.saved`
- `console.firstRunChecklist.languageCountry.title`
- `console.firstRunChecklist.languageCountry.todo`
- `console.firstRunChecklist.organizationName.action`
- `console.firstRunChecklist.organizationName.title`
- `console.firstRunChecklist.organizationName.todo`
- `console.firstRunChecklist.prefilled`
- `console.firstRunChecklist.timezone.saved`
- `console.firstRunChecklist.timezone.title`
- `console.firstRunChecklist.timezone.todo`
- `console.nav.design`
- `console.nav.phoneBarHint`
- `console.nav.searchMenu`
- `console.objectView.openAsPage`
- `console.objectView.personalizedParts.rowNumbers`
- `dashboard.exportCsv`
- `detail.collapseToDrawer`
- `filterBuilder.where`
- `list.recordOpen`
- `list.recordOpenDeclaredPage`
- `list.recordOpenDrawer`
- `list.recordOpenNote`
- `list.recordOpenPage`
- `list.rowNumbers`
- `sidebar.keepOpen`
- `view.switcher.all`
- `view.switcher.saveAsMyView`

### Studio namespace (`@object-ui/i18n/namespaces/studio`), 35 keys

Each key below is removed from both locales the namespace ships: en, zh.

- `designer.field.relatedList.parentFallback`
- `designer.field.trackHistory`
- `engine.edit.autoSaveOff`
- `engine.edit.autoSaveOn`
- `engine.edit.autoSavingShortly`
- `engine.edit.related`
- `engine.packages.installedApps.description`
- `engine.packages.installedApps.title`
- `engine.studio.autoSaved`
- `engine.studio.data.form.flowCreate`
- `engine.studio.data.form.flowEdit`
- `engine.studio.data.form.flowLabel`
- `engine.studio.data.form.layoutSource.fieldGroups`
- `engine.studio.data.form.layoutSource.fieldGroupsTitle`
- `engine.studio.data.form.layoutSource.formView`
- `engine.studio.data.form.layoutSource.formViewTitle`
- `engine.studio.designer.offForm`
- `engine.studio.designer.sectionDeleteTitle`
- `engine.studio.flowSavedNamed`
- `engine.studio.flowSaveFailed`
- `engine.studio.inspector.listView.kanbanCard.mode.drawer`
- `engine.studio.inspector.listView.kanbanCard.mode.newWindow`
- `engine.studio.inspector.listView.kanbanCard.mode.page`
- `engine.studio.openApp`
- `engine.studio.openAppPick`
- `engine.studio.openAppTitle`
- `engine.studio.owd.save`
- `engine.studio.owd.saved`
- `engine.studio.owd.saveNone`
- `engine.studio.pillar.access`
- `engine.studio.pillar.automations`
- `engine.studio.pillar.data`
- `engine.studio.pillar.interfaces`
- `engine.studio.pillar.metadata`
- `engine.studio.settings.highlightPreview`
