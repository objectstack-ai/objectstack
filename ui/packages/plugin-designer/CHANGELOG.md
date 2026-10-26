# @object-ui/plugin-designer

## 18.1.0

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [5235d6d]
- Updated dependencies [7c405b7]
- Updated dependencies [0093b2c]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [56cf4d8]
- Updated dependencies [b911ebb]
- Updated dependencies [ff77cfc]
- Updated dependencies [49a536d]
- Updated dependencies [241cb78]
- Updated dependencies [404ccae]
- Updated dependencies [8cf3a86]
- Updated dependencies [ec627ab]
- Updated dependencies [fb25620]
- Updated dependencies [b93c9f6]
- Updated dependencies [d019aaa]
- Updated dependencies [0f4adc3]
- Updated dependencies [fa31856]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [d9aff15]
- Updated dependencies [4eeb174]
- Updated dependencies [afcf654]
- Updated dependencies [2c3dc72]
- Updated dependencies [2958f17]
- Updated dependencies [a78608f]
- Updated dependencies [1d178e0]
- Updated dependencies [a14737b]
- Updated dependencies [2c4e5f5]
- Updated dependencies [6fb31dc]
- Updated dependencies [fbb4b23]
- Updated dependencies [c8f8b10]
- Updated dependencies [ad74e98]
  - @object-ui/types@18.1.0
  - @object-ui/plugin-grid@18.1.0
  - @object-ui/components@18.1.0
  - @object-ui/i18n@18.1.0
  - @object-ui/react@18.1.0
  - @object-ui/core@18.1.0
  - @object-ui/layout@18.1.0
  - @object-ui/data-objectstack@18.1.0
  - @object-ui/plugin-form@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- f62b6ff: Resolve `@objectstack/*` `18.0.0-next.2` (objectui#12626).
  
  The console and the runner bundle `18.0.0-next.2`. `@object-ui/types` and `@object-ui/app-shell` now declare `@objectstack/spec` `^18.0.0-next.2`; the other packages keep `^18.0.0-next.1`, which already admits it.
  
  **The record dialog opens bounded on desktop for every object.** A create, edit or child record dialog on an object with many fields used to open as a 95vw task canvas. `@objectstack/spec` `18.0.0-next.2` derives a bounded modal for it on desktop and keeps the full-screen sheet on a phone, and the console now takes that answer directly.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates a page through the spec's own page checks, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.2` refuses. Each was accepted before:
  
  - On a `kind: 'full'` page, a region whose `name` the page's `template` does not place (with the default template: anything but `header`, `sidebar`, `main`, `aside` and `footer`), and a second region for a slot another region already fills. The renderer stacked such a region under `main` at full width. Rename it to a slot the template places, or choose the `dashboard` template, which lays every other region out as a grid cell.
  - `isDefault: true` on a page whose `type` is its page kind (`record`, `home` or `utility`) unless it is a `record` page bound to an `object`. Delete the key; an app's landing page is its first navigation item.
- 26323c4: Resolve `@objectstack/*` `18.0.0-next.3` (objectui#12873).
  
  The console and the runner bundle `18.0.0-next.3`. Every package keeps its `@objectstack/*` range (`^18.0.0-next.1`, or `^18.0.0-next.2` for `@object-ui/types` and `@object-ui/components`), which already admits it, except `@object-ui/app-shell` (objectui#12943) and `@object-ui/plugin-detail` (objectui#12946), which declare `^18.0.0-next.3`.
  
  **An accept set that narrows with it.** `@object-ui/types` validates a `page:header` node's `properties` through the spec's own `page:header` row, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse `showStar`, which `18.0.0-next.3` retires: the follow star it switched on is not drawn by any renderer. It was accepted before. Delete the key.
  
  **A type that widens with it.** `SelectOptionBase`, and the field and form option types built on it, take the spec's select option by reference, so they now carry its optional `kind` (`'open' | 'won' | 'lost'`), the lifecycle category `18.0.0-next.3` adds. The spec takes it on a single-value `select` or `radio` field's options and requires it on every option of the field an object's `stageField` names.
- 12ff256: The row type of the `VersionHistory` timeline is declared as `VersionHistoryEntry` instead of `VersionEntry` (objectui#6349, batch 10). `@object-ui/collaboration` publishes an unrelated `VersionEntry`: a version its `useConflictResolution` hook records, with an `id` and a per-field `changes` diff. This timeline's rows carry a prose `description` and an `isCurrent` flag instead, and one exported name has one declaration.
  
  **Breaking-change note.** Nothing breaks for a consumer of this package: the package entry never exported `VersionEntry`, so no import named it, and the rows keep the same members (`version`, `timestamp`, `userId`, `userName`, `description`, `isCurrent`). Only the type name shown in the published declaration of `VersionHistory`'s `versions` prop changes.
  
  No runtime behaviour changes.
- 1f1c4b5: The result type of `useConfirmDialog` is declared as `DesignerConfirmDialogState` instead of `ConfirmDialogState` (objectui#6349, batch 6). `@object-ui/app-shell` declares an unrelated `ConfirmDialogState` (the data its action-confirm dialog renders, with the promise's resolver), and one exported name has one declaration.
  
  **Breaking-change note.** Nothing breaks for a consumer of this package: the package entry never exported `ConfirmDialogState`, so no import named it, and the hook's result keeps the same members (`isOpen`, `title`, `message`, `confirm`, `onConfirm`, `onCancel`). Only the type name shown in the published declaration of `useConfirmDialog` changes. `ReturnType<typeof useConfirmDialog>` resolves to the same shape as before.
  
  No runtime behaviour changes.

### Patch Changes

- 2e818d0: The dashboard surfaces read every `widgets[]` entry without leaning on `BaseSchema`'s index signature: a widget key is read on the widget arm alone, and the `chart` node is built as a private hand-off type (objectui#11598).
  
  **N1, the `chart` producers.** `DashboardRenderer` and `DashboardGridLayout` build a `chart` node for a series widget bound to inline rows, and compose two render keys onto it: the dashboard palette (`colors`) and `isAnimationActive: false`, the deterministic first paint inside the grid (#2756). `ChartSchema` declares neither key, on either face, and the chart renderer reads both. Each producer now checks its literal against a hand-off type private to this package, `ChartSchema` plus those two keys, and hands the node on with no cast; the type is not exported, and the keys stay off `@object-ui/types`, because the strict authoring face refuses both on an authored `chart` node. Nothing drawn changes.
  
  **N2, widget keys on the slot entry.** An entry of `widgets[]` is a widget or a component node placed in the slot (a `metric-card`), and only the widget declares the widget keys (`dataset`, `options`, `chartConfig`, `filter`, `component`, `colorVariant`, `values`, `dimensions`, …). Every read of one now narrows the entry to the widget first, on `DashboardRenderer`, `DashboardGridLayout`, `DashboardWithConfig` and `DashboardEditor`. What changes is confined to a `metric-card` entry that carries a widget key, which `@object-ui/types/zod`'s strict face refuses and only the tolerant face accepts:
  
  - a `metric-card` carrying `dataset` draws its card; it used to draw the dataset tile in the card's place, on both dashboard surfaces;
  - a `metric-card` carrying `options` draws its own keys; `options` used to be spread over them, so `options.value` replaced `value`;
  - a `metric-card` carrying a `component` draws its card; the envelope's node used to be drawn instead.
  
  A document the strict face accepts draws exactly as before. `@object-ui/types`' docblocks on `DASHBOARD_COMPONENT_WIDGET_TYPES` and the Zod widget vocabulary, which described the dataset tile in the card's place and the `options` spread as live, were corrected to match; no type in it changes. In `DashboardEditor`, a `metric-card` entry is no longer offered the Color Variant select: the card declares no `colorVariant`, `MetricCard` draws nothing from it, and a pick stored a key publish refuses. A widget is offered it as before.
- da35453: Objects with a picklist-bound field save again from the OWD overview, the Setup fields and objects pages, the metadata-admin embedded-item editor, and `MetadataService.saveFields` (objectui#11692).
  
  The runtime serves a field that names a shared picklist (`picklist: 'NAME'`) with the options it resolved from the list. The authoring door refuses `options` beside `picklist`, with `422 INVALID_METADATA` at `fields.FIELD.options`, and the refusal covers the whole object. objectui#10202 fixed the two designers that host the select-field editor. These writers also seed their save from a served object read, so they sent the resolved options back and were refused, whatever had been edited:
  
  - **Studio → Access → OWD overview.** Changing an object's sharing model and saving was refused.
  - **The Setup fields page** (`MetadataFieldsPage`). Editing any field of such an object was refused.
  - **The Setup objects page** (`MetadataObjectsPage`). Relabelling such an object was refused.
  - **The metadata-admin embedded-item editor** (`EmbeddedItemEditor`, opened from an object's fields, indexes or validations). Saving any item of such an object was refused.
  - **`MetadataService.saveFields`.** A field list built from the served object was refused.
  
  Each now leaves `options` out of every field that names a picklist, before the PUT. A field without `picklist` keeps its inline `options` unchanged, and no other key is touched.
  
  `dropServedPicklistOptions` is now exported from `@object-ui/data-objectstack`. It is the served-to-authored conversion these writers apply, and it moves here from `@object-ui/app-shell` (it was not exported there), because `@object-ui/plugin-designer` does not depend on `app-shell`. It is for code that builds an object PUT from a served read. `MetadataClient.save` does not apply it, and neither do `MetadataService.saveObject` and `MetadataService.saveMetadataItem`, which read nothing: a body that pairs `picklist` with `options` without a served read behind it is still refused by the server, with its prescription.
- 5ad8183: The dashboard designer's widget property panel picks a widget's Type and Color Variant with the shared `Select`, and the designers' property panel (`PropertyEditor`) draws a `select` field with it too: the control the rest of the console picks with (objectui#11865, the dashboard designer's part of that card).
  
  The three pickers were browser-native selects, so they looked and behaved differently from the console's other dropdowns. They now use the shared Radix `Select`: the same trigger, dropdown and keyboard behaviour.
  
  What they write is unchanged. Each option hands the panel the same value as before: a type pick still writes `type`, a colour pick still writes `colorVariant`, and a `select` field still calls `onChange` with the field's name and the option's value, an option whose value is empty included. A type the widget door refuses the widget's measures under is still a disabled option and still writes nothing. Re-picking the current option writes nothing. The Type and Color Variant pickers keep the accessible name their labels gave the native selects; a `select` field's caption named no control before and names none now. Read-only disables the Type and Color Variant triggers in the shared `Select`'s own disabled look; `PropertyEditor` has no read-only state, as before.
  
  One display change: a value none of a picker's options carries now shows as itself (a stored `area` type, a `metric-card` entry's type, a field value no option carries). The native select showed its first option instead ("KPI Metric", "Default"), which is not what the widget or the field holds. A `select` field with no value and no empty option shows nothing rather than its first option.
  
  **Clause-②: no.** No published face moves: the package entry exports the same names, `DashboardEditorProps`, `PropertyEditorProps` and `PropertyField` take the same members, and no i18n key is added. What moves is the panels' own markup, described above: a test that drove one of these controls as a native select now picks through the trigger.
- e8f9977: The designer forms pick with the shared `Select`, the control the rest of the console picks with (objectui#11865, the designer forms' part of that card): `FieldDesigner`'s type filter, `DataModelDesigner`'s field-type picker on each field row, `BrandingEditor`'s font family and `AppCreationWizard`'s template.
  
  The four pickers were browser-native selects, so they looked and behaved differently from the console's other dropdowns. They now use the shared Radix `Select`: the same trigger, dropdown and keyboard behaviour. The type filter keeps its category headings (Text, Number, Date & Time, Choice, Relation, Advanced) as groups of the dropdown.
  
  What they write is unchanged. Each option gives the form the same value as before: "All Types" still clears the type filter, "Default (System)" still clears the branding's `fontFamily`, and "None" still sets the draft's `template` to an empty string. Re-picking the current option writes nothing. The font family and template pickers keep the accessible name their label gave the native select ("Font Family", "Template") and show read-only mode as disabled. The type filter stays enabled in read-only mode, as before, and a read-only data model still shows each field's type as text. On a data model entity card, a click on the type picker still does not select the card, and Delete or Escape on it still does not act on the canvas.
  
  One display change: a value none of a picker's options carries now shows as itself. The native select showed its first option instead (`text` for a field type, "Default (System)" for a font, "None" for a template), which is not what the form holds.
  
  **Clause-②: no.** No published face moves: the package entry exports the same names, the four components take the same props, and no i18n key is added. What moves is the four controls' own markup, described above.
- e723f58: Screen readers hear the names of more controls in the viewer's language (objectui#12145).
  
  These controls carried an English `aria-label`, so under a non-English locale a screen reader announced their names in English: the docs portal's loading spinner, the record form page's breadcrumb, the `Spinner` status region, a data table's row menu button, the `pagination` renderer's previous and next links, the image crop preview, the percent slider, the record picker's grid, the AI composer's send and stop button and an attachment's remove button, the designer's undo and redo buttons, minimap, version history and back button, a dismissible record alert's close button, the bulk-action bar, and the mobile view switcher. Each name now comes from the language packs. English names are unchanged, with two small exceptions: the spinner now reads "Loading…", and the pagination links read "Previous page" and "Next page", the same words the data table pager uses. Sighted use is unchanged.
  
  Added: eight language-pack keys in all ten packs: `help.loadingDocumentation`, `common.breadcrumb`, `table.rowActions`, `fields.image.cropPreview`, `fields.percent.slider`, `designer.canvasMinimap`, `designer.versionHistory` and `grid.bulkActions`. Every other name reuses a key that already holds the same words. The exported `en` pack, and so `TranslationKeys`, gains these eight members. `PromptInputAttachment` (exported through `AIElements`) takes an optional `removeLabel` prop that names its remove button; without it the button keeps its English name.
- d12bc5f: A console reset, delete or draft discard names the package whose row it removes (objectui#12335, the consumer half of objectstack#23165).
  
  Since `@objectstack/rest` 18.0.0-next.1 the metadata delete door reads `?package=`. A delete that names no package addresses the one package that holds the item; when two or more packages hold it the door refuses `409 RESOURCE_CONFLICT`, deletes nothing, and names `?package=` as the remedy. The console could not send that remedy.
  
  - **`MetadataClient.reset()`** now sends `?package=` when `options.packageId` is set, beside `?state=draft` for a draft discard, with the spelling `save()` and `publish()` use. Without a binding the parameter is omitted, never sent empty. Its options type already declared `packageId` (inherited by `MetadataDeleteOptions`); `reset()` used to drop it. No exported type changes.
  - **The metadata editor** (`MetadataResourceEditPage`): Reset/Delete and "Discard draft" state the package the editor's save and publish already state, read from `?package=` on the editor URL (the `all` scope names none). An editor with no package sends none, and a refusal is shown on the page's error line in the server's words.
  - **The Objects page** (`MetadataObjectsPage`, `@object-ui/plugin-designer`): deleting an object states the package the listed row is served from (its `_packageId`). A row no package owns, including one served with the `sys_metadata` sentinel, sends none, and a refusal is shown in the page's error panel.
  - **Unchanged:** the runtime draft bar's Discard and the adapter's `deleteView` hold no package binding, so they keep the package-less delete. Their refusals already reach the caller: the draft bar shows the server's message in its error toast, and `deleteView` throws.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [15f6702]
- Updated dependencies [c096f03]
- Updated dependencies [d92b2a1]
- Updated dependencies [3f0b0cd]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [902ebab]
- Updated dependencies [bdc9049]
- Updated dependencies [e8c0b96]
- Updated dependencies [d768c31]
- Updated dependencies [b92329c]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [b88937b]
- Updated dependencies [c000398]
- Updated dependencies [73b5d77]
- Updated dependencies [7b17705]
- Updated dependencies [846f982]
- Updated dependencies [fc3c2cc]
- Updated dependencies [f9f4a62]
- Updated dependencies [848ba0e]
- Updated dependencies [57d82cb]
- Updated dependencies [de96f3d]
- Updated dependencies [9ca3cac]
- Updated dependencies [c910630]
- Updated dependencies [ce464d9]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [7a2c60b]
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [9fc68aa]
- Updated dependencies [da35453]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [4590363]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [ded4494]
- Updated dependencies [d172f63]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [3bf8894]
- Updated dependencies [b9814b3]
- Updated dependencies [e06365c]
- Updated dependencies [4a9fe31]
- Updated dependencies [6d8bf0c]
- Updated dependencies [5dff027]
- Updated dependencies [8aebc6f]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [bfca7ec]
- Updated dependencies [5e446ab]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [9844bbf]
- Updated dependencies [0aa8c0c]
- Updated dependencies [cef0eee]
- Updated dependencies [7ebff39]
- Updated dependencies [054fd84]
- Updated dependencies [5275d1f]
- Updated dependencies [7241a81]
- Updated dependencies [2063f7a]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [9fc6ad7]
- Updated dependencies [f1781be]
- Updated dependencies [fbad078]
- Updated dependencies [ccddd11]
- Updated dependencies [45d5853]
- Updated dependencies [4f4fc03]
- Updated dependencies [2312bd9]
- Updated dependencies [3f20d5a]
- Updated dependencies [6d5eb34]
- Updated dependencies [c5406c2]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2571a3e]
- Updated dependencies [2a48bd4]
- Updated dependencies [8a55f0c]
- Updated dependencies [c7b30bd]
- Updated dependencies [20c6d35]
- Updated dependencies [417e245]
- Updated dependencies [69bca0a]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [ce991bd]
- Updated dependencies [3c0f806]
- Updated dependencies [1071393]
- Updated dependencies [5f75cfa]
- Updated dependencies [29b9949]
- Updated dependencies [6757a93]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
- Updated dependencies [43e1505]
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [2381c07]
- Updated dependencies [e723f58]
- Updated dependencies [82bb1d5]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [b231607]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [54159d3]
- Updated dependencies [d48071e]
- Updated dependencies [fa778e6]
- Updated dependencies [334f0cf]
- Updated dependencies [c08c933]
- Updated dependencies [92f979d]
- Updated dependencies [c4dd707]
- Updated dependencies [c4dd707]
- Updated dependencies [7578323]
- Updated dependencies [38bb373]
- Updated dependencies [6c437b0]
- Updated dependencies [923504f]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
- Updated dependencies [10aba37]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [51c661e]
- Updated dependencies [7af0ab3]
- Updated dependencies [b434f5f]
- Updated dependencies [9f282ef]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [cea429b]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [40cb13b]
- Updated dependencies [8106db1]
- Updated dependencies [068a540]
- Updated dependencies [ca45c6d]
- Updated dependencies [093d55b]
- Updated dependencies [b64fda3]
- Updated dependencies [a8051d6]
- Updated dependencies [866763b]
- Updated dependencies [72594f2]
- Updated dependencies [524136e]
- Updated dependencies [2b06a91]
- Updated dependencies [df05784]
- Updated dependencies [6f3299f]
- Updated dependencies [d12bc5f]
- Updated dependencies [065a1cf]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [dbc8c11]
- Updated dependencies [1040a0a]
- Updated dependencies [fc211e8]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [37db09f]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [2fc31ea]
- Updated dependencies [919d5cd]
- Updated dependencies [431cece]
- Updated dependencies [cfbca7f]
- Updated dependencies [caac3b2]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [a8e5b73]
- Updated dependencies [d9d9d98]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [c3de0bc]
- Updated dependencies [f8267df]
- Updated dependencies [9b82ced]
- Updated dependencies [3821a3a]
- Updated dependencies [3eb3ec1]
- Updated dependencies [92c2a69]
- Updated dependencies [7b5e558]
- Updated dependencies [646caea]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [0081cdc]
- Updated dependencies [96fa4b9]
- Updated dependencies [85e8961]
- Updated dependencies [8ed7e5a]
- Updated dependencies [6c4d00d]
- Updated dependencies [db8ce2f]
- Updated dependencies [726d8c9]
- Updated dependencies [f0e760a]
- Updated dependencies [a5bb7ac]
- Updated dependencies [f78efdd]
- Updated dependencies [8a8bcf3]
- Updated dependencies [f74638c]
- Updated dependencies [278bc29]
- Updated dependencies [ef71a09]
- Updated dependencies [8614705]
- Updated dependencies [619e3f7]
- Updated dependencies [ca7a4c3]
- Updated dependencies [c9e6742]
- Updated dependencies [f62b6ff]
- Updated dependencies [608033b]
- Updated dependencies [dcd1041]
- Updated dependencies [611566b]
- Updated dependencies [611566b]
- Updated dependencies [efa9cb4]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [9d857c9]
- Updated dependencies [670ea10]
- Updated dependencies [ff215d9]
- Updated dependencies [3e2c763]
- Updated dependencies [71243db]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [a23e804]
- Updated dependencies [c7462e7]
- Updated dependencies [36e2f7b]
- Updated dependencies [684f22e]
- Updated dependencies [ac59073]
- Updated dependencies [44cb469]
- Updated dependencies [3bcf314]
- Updated dependencies [e058d76]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [f114263]
- Updated dependencies [260ef71]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [8d80845]
- Updated dependencies [69a408f]
- Updated dependencies [1aa622a]
- Updated dependencies [d2b21a1]
- Updated dependencies [e43a162]
- Updated dependencies [5ff64ef]
- Updated dependencies [35ef750]
- Updated dependencies [64acb7e]
- Updated dependencies [4ff5b6b]
- Updated dependencies [473e5a0]
- Updated dependencies [b279016]
- Updated dependencies [54e79f9]
- Updated dependencies [bb6c38c]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [2727527]
- Updated dependencies [3da39ae]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [2cfdc99]
- Updated dependencies [2cfdc99]
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
- Updated dependencies [32b492b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
- Updated dependencies [025130c]
- Updated dependencies [76f91f8]
- Updated dependencies [ea34d9b]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [cb80001]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [2493e85]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [47508f3]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [6f877f1]
- Updated dependencies [fe11eb1]
- Updated dependencies [988aa9f]
- Updated dependencies [65fe4c2]
- Updated dependencies [b9e1887]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [cd4623d]
- Updated dependencies [bc98626]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [2d8a8b7]
- Updated dependencies [4b67746]
- Updated dependencies [cbac9d7]
- Updated dependencies [9840695]
- Updated dependencies [9eb1479]
- Updated dependencies [74e37aa]
- Updated dependencies [aaa1296]
- Updated dependencies [f0300be]
- Updated dependencies [961b69f]
- Updated dependencies [52907d7]
- Updated dependencies [f466b0a]
- Updated dependencies [5a8d40f]
- Updated dependencies [d05f33b]
- Updated dependencies [673a71c]
- Updated dependencies [616df65]
- Updated dependencies [58798ec]
- Updated dependencies [8803ca5]
- Updated dependencies [e70c21d]
- Updated dependencies [f22b980]
- Updated dependencies [ab4e4d7]
- Updated dependencies [4b92c5a]
- Updated dependencies [06be396]
- Updated dependencies [3650d94]
- Updated dependencies [7c05f21]
- Updated dependencies [84b4326]
- Updated dependencies [a29f615]
- Updated dependencies [ff128e3]
- Updated dependencies [8cd4db4]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
- Updated dependencies [3c3115e]
- Updated dependencies [55e90fd]
- Updated dependencies [9b75509]
- Updated dependencies [b13ea3c]
- Updated dependencies [d7e9e9a]
- Updated dependencies [cf62edf]
- Updated dependencies [0253416]
- Updated dependencies [5d77c09]
- Updated dependencies [3fd8625]
- Updated dependencies [1473757]
- Updated dependencies [d73d987]
- Updated dependencies [12ff256]
- Updated dependencies [12ff256]
- Updated dependencies [26b0bd2]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [c0c0a0d]
- Updated dependencies [d758f2f]
- Updated dependencies [1b2d016]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [f962cdc]
- Updated dependencies [b403bb3]
- Updated dependencies [8a25fee]
- Updated dependencies [4016370]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/components@18.0.0
  - @object-ui/core@18.0.0
  - @object-ui/plugin-form@18.0.0
  - @object-ui/i18n@18.0.0
  - @object-ui/react@18.0.0
  - @object-ui/plugin-grid@18.0.0
  - @object-ui/layout@18.0.0
  - @object-ui/data-objectstack@18.0.0

## 17.7.0

### Minor Changes

- 37140f4: refactor(plugin-designer)!: retire four builder-chrome node type keys (objectui#10859, batch 8 phase 2b)
  
  **BREAKING (authoring):** the plugin no longer registers `app-creation-wizard`, `navigation-designer`, `dashboard-editor` or `branding-editor` (and with them their `plugin-designer:` keys). `objectui validate` refused each at `type`, and none appears as a node type anywhere in this repository, its examples or objectstack. A node authored with one of these types now renders the "Unknown component type" panel. `AppCreationWizard`, `NavigationDesigner`, `DashboardEditor` and `BrandingEditor` stay named exports.
  
  Migration:
  
  - `{ "type": "app-creation-wizard", … }` → mount `AppCreationWizard` directly;
  - `{ "type": "navigation-designer", … }` → mount `NavigationDesigner` directly;
  - `{ "type": "dashboard-editor", … }` → mount `DashboardEditor` directly;
  - `{ "type": "branding-editor", … }` → mount `BrandingEditor` directly.
  
  **Clause-②: yes** — registrations leave the runtime (narrowing), released as `minor` with this banner.
- e6bc087: feat: a `doc` navigation entry (ADR-0046) validates and draws as a link into the docs portal
  
  `@objectstack/spec` 17.5.0 added a tenth navigation item type, `doc` — `{ type: 'doc', book }`
  opens a book, `{ type: 'doc', doc }` opens one page, both opens that page in that book's
  context. `objectui validate` refused it: `NavigationItemTypeSchema` was a hand-written list of
  the nine older types, while the TypeScript `NavigationItemType`, derived from the spec, already
  carried `doc`. And no renderer drew one — `resolveHref` had no `doc` branch, so the entry
  rendered as a dead `#` link.
  
  - **`@object-ui/types`** — `NavigationItemTypeSchema` is now read off the discriminator of the
    spec's navigation union instead of hand-listed, so it gains `doc`. A `doc` entry is judged by
    the spec's own `DocNavItemSchema`: it accepts exactly what the spec accepts — at least one of
    `book` / `doc`, a doc NAME (a filename or a path is refused), a snake_case `id`, and the closed
    key set of the spec's `doc` arm — and refuses an empty `label` as every sibling type does. The
    parsed entry is never rewritten. `NavigationEntryItem` gains the spec-derived `book` and `doc`
    members. An unknown `type` is now refused with `invalid_union` at `type` (was `invalid_value`),
    the code the spec's own union answers with.
  - **`@object-ui/layout`** — `resolveHref` sends a `doc` entry to the console docs portal under
    its `basePath`: `/docs/DOC`, `/docs/BOOK` or `/docs/BOOK/DOC`. An unlabelled `doc`
    entry shows the page it opens, else the book. It is gated by the same base keys as its
    siblings (`visible`, `requiredPermissions`, `requiresObject`, `requiresService`); the book
    audience gate stays the server's. The mobile tab bar links it the same way.
  - **`@object-ui/app-shell`** — the app designer's preview keys its navigation kinds by
    `NavigationItemType`, so a `doc` entry is drawn with its target and route instead of being
    dropped (label-less) or badged `untyped`.
  - **`@object-ui/plugin-designer`** — `NAV_TYPE_META` drops the `| 'doc'` key that bridged the
    spec pin lag; it is keyed by `NavigationItemType` alone.
  - **`@object-ui/console`** — the docs portal resolves a path segment that is a book's NAME
    rather than its `slug` — what a `{ type: 'doc', book }` entry links to — and redirects to
    the book's canonical slug URL: `/docs/NAME` opens the book, `/docs/NAME/DOC` reads that page
    with the book's sidebar. It is looked up after a book's slug and an installed doc's name, so
    every URL that resolved before answers as it did; only former "Documentation not found"
    answers change.
- 1563d3e: The Field Designer's drawer no longer offers `select` as a field type for a new field, or as a type
  to change an existing non-choice field into.
  
  The drawer has no options editor, and `MetadataFieldsPage` saves every change at once, so a
  picklist created there could only be a choice with nothing to choose, which the object write guard
  now holds client-side (objectui#11253, the objectui half of the ruling on objectstack#20827). The
  type returns once the drawer can author options.
  
  BREAKING (behaviour, released as `minor` per this repository's version policy): a host that relied
  on the drawer to create picklists loses that path until the drawer gains an options editor. An
  existing `select` field keeps its own type in the drawer, so editing it shows and writes back what it
  is, options included. The list's type filter still offers every type.
- 5988b6b: The page and report designers, and all three canvases, draw the members their node declarations always carried and they never read. Every designer registration's `inputs` now lists the members its component reads (objectui#11434).
  
  **BREAKING (rendering)** — a report field element draws its `dataBinding` and no longer reads `properties.field`. The designer writes `dataBinding` itself now: a new field element is born bound to `field_name`, and the property panel's **Data binding** entry edits it on every element type. Migration: move a saved element's `properties.field` to its `dataBinding`. `@object-ui/types` refuses the old key by name in the same release.
  
  **All three canvases.** `canvas.backgroundColor` is drawn on the page, data-model and process canvases. The colour is published as a CSS custom property and painted by a static utility (the styling rule's author-declared-colour carve-out), so a theme can still override it.
  
  **Page designer.**
  
  - A component's `children` are drawn inside it, positioned within it, and indented under it in the component tree. Selecting, editing, moving, copying and deleting all reach nested components.
  - A `locked` component cannot be dragged or deleted on the canvas, and shows a lock. No delete path removes it: its own delete button is withheld, and Delete / Backspace and the toolbar's **Delete selected** delete only the unlocked rest of a selection. A parent that holds a locked component anywhere inside it is kept too, because deleting it would take the locked one with it.
  - A component with `visible: false` is drawn faded, with a dashed edge and a hidden marker, so it can still be found.
  - `zIndex` orders overlapping components.
  - The property panel offers **Visible**, **Locked** and **Z-index**.
  - The palette draws each category's `icon` and each item's `icon` (any Lucide name; an item without one keeps the generic "add" glyph), and an item's `preview` as a thumbnail.
  
  **Report designer.**
  
  - An element draws its `format`: weight, style, alignment, colours, font, border and padding on its content, and `numberFormat` / `dateFormat` beside its binding. Every value goes through a CSS custom property and a static utility.
  - A section draws its `groupField` in its label (`by FIELD`), and a page-break rule across its top when `pageBreakBefore` is set.
  - The page draws its four `margins` as a dashed guide.
  
  **Registration inputs.**
  
  - `page-designer` adds `palette` and `propertyEditor`.
  - `data-model-designer` adds `canvas` and `showRelationshipLabels`.
  - `process-designer` adds `version`, `lanes` and `canvas`.
  - `report-designer` adds `pageSize` and `orientation` (enumerated), and `margins`.
  - Every designer row that was typed `code` is now declared by its value's kind: `page-designer` `canvas` (object) and `components`, `data-model-designer` `entities` / `relationships`, `process-designer` `nodes` / `edges`, `report-designer` `sections`, `object-manager` `objects` and `field-designer` `fields` (each an array). A `code` row is judged as a string, so a legal value drew `type-mismatch` ("expected a string"); none does now.
  
  Each was a member the component already read. The html-tier page compiler, which builds its manifest from every known registration, warned it off as an `unknown-prop`. Each added row declares the kind its value has (`array`, `object`, `enum` or `string`), so a legal value draws no `type-mismatch` either. `object-manager` and `field-designer` already listed theirs.
- 0e9058b: The data-model and process designers draw the members their node declarations always carried and they never read (objectui#11434).
  
  **Data-model designer.**
  
  - Each field row draws its `label` beside the name, a `UQ` badge when `unique`, and its `defaultValue` after the type (as JSON, so a string is quoted and `null` shows), with the field's `description` and default as the row's tooltip.
  - Each relationship line runs from the row of its `sourceField` to the row of its `targetField`, edge to edge, instead of centre to centre whatever the fields said. Cards whose columns overlap are joined on their right edges by a curve. A field name the entity does not declare anchors at the entity header, and the line's tooltip says which name was not found.
  - A relationship's `deleteBehavior` is drawn beside its label and in the line's tooltip. Renaming a field on the canvas renames it in every relationship that names it, so its line stays on the row.
  - The card's header and rows have fixed heights now, so the lines can be anchored at them.
  
  **Process designer.**
  
  - The toolbar draws the process `version` beside its name.
  - Each lane in `lanes` is drawn as a band around the nodes its `nodeIds` names, labelled with its `label` and `role`, under the flows and the nodes.
  - A flow draws its `condition` in brackets, and BPMN's slash marker at its source when it `isDefault`.
  - The property panel of a selected node offers its `assignee` and `dueDate` on a user task, its `script` on a script task, either on any node that already carries a value, and each entry of its `properties` under its key, with a control for the value's type.
  
  Nothing in the components' props changed: `ProcessDesignerProps` already declared `version` and `lanes`, and the rest are members of the records the props already took.
- c4ab6d0: **BREAKING (TypeScript props)** — `DataModelDesignerProps.autoLayout` and `ReportDesignerProps.previewMode` are removed, and the `data-model-designer` registration no longer publishes `autoLayout` as an input (objectui#11434).
  
  Neither prop was ever read: `DataModelDesigner` arranges entities only when the toolbar's Auto Layout button is pressed, and `ReportDesigner` has no preview mode. `@object-ui/types` retires the matching node members in the same release, so the component face, the registration and both node faces now agree.
  
  **Migration.**
  
  - `<DataModelDesigner autoLayout />`: drop the prop; use the toolbar's Auto Layout button. The package README's example no longer passes it.
  - `<ReportDesigner previewMode />`: drop the prop; for a chrome-free, non-editable layout pass `readOnly`, `showToolbar={false}` and `showPropertyPanel={false}`.
  
  The Field Designer's defaults map also drops the labels `appDesigner.fieldDesigner.validationRules` and `appDesigner.fieldDesigner.addRule`, which named an editor that was never built (see the `@object-ui/i18n` note of this release). Nothing renders differently.
- 864154e: The Field Designer no longer offers a formula-expression textarea, and no designer write
  path emits a `formula` key (objectui#6043).
  
  **This is a behaviour change on an authoring surface: a control is removed.** A field's
  `type` may still be set to `formula` — that is a valid spec `FieldType` and stays in the
  palette — but the expression itself is no longer authored here. Authors write formula
  expressions in metadata-admin's field inspector, where they are checked.
  
  The control wrote `formula`, which is not in `FieldSchema`'s accept set. Measured against
  the installed `@objectstack/spec` 17.2.0:
  
  ```
  FieldSchema.safeParse({ type:'formula', label:'Tax', formula:'price * quantity' })
    => success = false
    => unrecognized_keys ['formula']   "Did you mean `formula` -> `expression`?"
  ```
  
  so `PUT /api/v1/meta/object/:name` returned a hard 422 `INVALID_METADATA` — and because
  the key was then stored, it blocked **every later save of that object**, not just the one
  that introduced it.
  
  **The key was deliberately NOT renamed to the spec's `expression`.** `FieldSchema` judges
  the key name and never the expression LANGUAGE — measured, it accepts
  `expression: 'price * quantity'` and even `expression: '!!!not cel at all!!!'`; only the
  empty string is refused. Spec `expression` is CEL rooted at `record`
  (`record.amount * 0.1`), whereas this control's own placeholder taught `price * quantity`
  — bare field refs, which under the scope formulas bind evaluate to null silently. A rename
  would therefore have converted a loud, immediate 422 into a formula that saves clean and
  then quietly computes nothing, which is strictly worse than the bug it appears to fix.
  
  Making refusals loud *in the control* would need CEL lint, autocomplete and `returnType`
  inference — that is `CelPredicateField`, which lives in `@object-ui/app-shell`, and
  app-shell depends on `@object-ui/plugin-designer`, so it cannot be imported back without a
  dependency cycle. Growing a second formula-authoring surface inside plugin-designer is a
  feature, not this fix. `returnType` is likewise not authored here: it is only derivable by
  inferring the CEL result type, and with no expression control there is nothing to infer
  from.
  
  `formula` joins the retired-key tombstone in `MetadataFieldsPage`, so an object already
  carrying the key is stripped clean on its next save instead of staying blocked forever —
  which matters more than usual here, because with the control gone an author would
  otherwise have no way left to clear it. It is dropped rather than migrated to `expression`,
  for the same reason the rename was refused. A `expression` authored in metadata-admin is
  **not** touched: it is a real `FieldSchema` key and rides through the designer's
  round-trip untouched.
  
  Also removes the now-unreachable `formula` read/write from
  `views/metadata-admin/previews/object-fields-bridge.ts`, which was a third emit site for
  the key that neither the card nor the parity gate named.
  
  The `formula` entry is removed from `check-designer-field-key-parity.mjs`'s
  `KNOWN_UNPARSEABLE_KEYS` ledger, which ratchets in both directions — a resolved key that
  left a stale entry behind would be as red as a new offender.
- d18a0d3: Object-level metadata payloads no longer emit the three keys `ObjectSchema` refuses by
  name — **group**, **sortOrder** and **relationships** (objectui#6223).
  
  Measured against the installed `@objectstack/spec` 17.2.0, whose `ObjectSchema` accept set
  is 42 keys:
  
  ```
  const base = { name: 'account', label: 'Account', fields: { n: { type: 'text', label: 'N' } } };
  
  ObjectSchema.safeParse(base)                              => success = true    (control)
  ObjectSchema.safeParse({ ...base, isSystem: true })       => success = true    (control)
  ObjectSchema.safeParse({ ...base, pluralLabel: 'A' })     => success = true    (control)
  
  ObjectSchema.safeParse({ ...base, group: 'Sales' })       => unrecognized_keys ["group"]
  ObjectSchema.safeParse({ ...base, sortOrder: 3 })         => unrecognized_keys ["sortOrder"]
  ObjectSchema.safeParse({ ...base, relationships: [ … ] }) => unrecognized_keys ["relationships"]
  ```
  
  The two controls are what make that a key-by-key result rather than a schema refusing
  everything. Each key was resolved on its own, as the objectui#5761 family ruling requires:
  
  - **group** — the Object Manager's grouping is a UI-only display category. The spec has no
    object-level grouping key (`fieldGroups` groups the fields *inside* one object), so the
    grouping control and its column stay, and the value is now DERIVED from the spec key that
    is accepted (`isSystem`) instead of round-tripped. `MetadataObjectsPage` also strips a
    `group` already stored by an earlier build, because its save-back spreads the server
    document verbatim and would otherwise keep re-sending it forever.
  - **sortOrder** — what populated it was the array index the converter happened to be at,
    i.e. the order the list was already in. The declaration is removed from the object
    payload. The field-level `sortOrder` is a different key with a different card
    (objectui#6045) and is untouched.
  - **relationships** — the spec models relationships on the FIELD (`reference` /
    `master_detail`, plus object-level `indexes`). The object payload stops declaring and
    sending an object-level relationship array; what the designer should author for a
    relationship is a data-model question this change does not settle.
  
  **Breaking for TypeScript consumers of `ObjectMetadataPayload`** (exported from app-shell):
  the three properties are gone from the published type, so code that set them stops
  compiling. That is the point — setting any of them produced a payload the metadata route
  refuses. `ObjectDefinition` (the designer's UI model) is unchanged and still carries all
  three.
  
  The parity gate built for objectui#5761 now has a **second oracle**: every shape in
  `PAYLOAD_SHAPES` names the schema that judges it, `ObjectSchema` alongside `FieldSchema`,
  and reach is resolved within an oracle rather than across one — `group` is a legal
  `FieldSchema` key and a refused `ObjectSchema` key at the same time. That extension found a
  fourth object-level key (`enabled`, objectui#6238) and a value-level rejection the key-name
  check cannot see (`fields` sent as an array where the spec wants a map, objectui#6240);
  both are filed and ledgered rather than fixed here.
- 1cca678: Retire the dashboard-**root** `title` read across all five surfaces (objectui#7509,
  maintainer ruling 2026-09-04, decision batch #29, option C, under ADR-0049).
  
  **What changes for an operator.** A stored dashboard whose header came from a legacy
  root `title` now shows its `label`. `label` is the only header source, then the raw
  `name`.
  
  Per surface:
  
  - Console dashboard page (`DashboardView`) — header falls to `label`, then `name`.
  - Standalone dashboard embed (`DashboardRenderer`) — `header` shows `label`; a document
    with no `label` now shows no header title at all.
  - The `dashboard-grid` SDUI component (`DashboardGridLayout`) — heading falls to
    `label`, then the generic `Dashboard`.
  - Studio dashboard designer (`DashboardEditor` preview panel, `DashboardDesignPage`
    heading) — both fall to `label`, then `name` / the generic heading.
  
  **Why now.** `@objectstack/spec`'s `DashboardSchema` refuses a root `title` **by name**
  (`unrecognized_keys(title)`), and the save route answers `422 INVALID_METADATA` — so no
  authored dashboard can acquire the key, and what retires is compatibility with documents
  stored before that refusal existed. Until now five surfaces read the legacy spelling
  independently, which meant a legacy document could show one header in the console and a
  different one in the designer. One spelling now answers everywhere.
  
  **Migration.** `label` is REQUIRED on `DashboardSchema`, so a spec-valid stored dashboard
  already carries it and needs no change — it simply starts showing that `label` instead of
  the legacy `title`. A document carrying `title` and no `label` was already invalid; give
  it a `label`. No in-repo document needed migrating: a sweep of all 627 tracked JSON found
  9 dashboard-shaped nodes, and the 6 carrying a root `title` are `type: 'dashboard'`
  component examples that declare no `header`, so none of them rendered a header title
  either before or after.
  
  **Not affected: widget titles.** `DashboardWidget.title` is a different, spec-**declared**
  key (the spec's `I18nLabel`) on a different receiver, and is untouched — widget headings,
  the designer's widget-title input and its per-locale write path all behave exactly as
  before. Root and widget arms were separated by receiver, and the retirement's pins carry
  widget-level controls on every surface for that reason.
  
  ⚠️ **Dated note, 2026-10-02 — the `dashboard-grid` node key is retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2b) unregistered the `dashboard-grid`
  node key, so `DashboardGridLayout` is no longer an SDUI component; the heading rule above holds
  for it wherever a host mounts it directly. The rest of this entry is kept as the reading of this
  change.
- bdb4dbd: A half-filled relationship field stays in the client and is never PUT (objectui#7714,
  maintainer ruling on objectui#7122 item 4, 2026-09-05).
  
  **Breaking, deliberately, and stated rather than implied.** Both metadata writers —
  `MetadataService.saveFields` / `saveObject` in `@object-ui/app-shell`, and
  `MetadataFieldsPage` in `@object-ui/plugin-designer` — now REFUSE a `lookup` or
  `master_detail` field whose `reference` is missing, empty, blank or not a string. A
  caller that previously got a PUT now gets a thrown error and **no request at all**. The
  refusal is raised while the wire `fields` map is being built, so nothing is sent and
  nothing is partially applied.
  
  **Why the draft may not leave the client.** `@objectstack/spec` 17.3.0 turned
  `reference` from prose into a hard requirement on relationship types (a `custom`
  refinement at path `reference`). Driven against a real 17.3.0 backend in a running
  designer: creating a `lookup` and leaving its target empty PUT the whole object,
  came back `422 INVALID_METADATA` at `fields.<name>.reference` — and then the NEXT
  edit, to a different and already-saved field, was refused identically, because the
  half-filled draft rides along inside the same document. The author sees that later
  edit rendered as applied while the server has none of it, and the only escape that
  does not require noticing the lookup is a reload, which discards the work. An editing
  session's half-finished state belongs to the client, not to the metadata store.
  
  ⛔ **Not** "strip the incomplete field from the body and report a successful save".
  That shows the author a field the server never received — the silent-drop shape
  objectstack#4001 closed.
  
  **The whitespace row follows the contract; it is not a local opinion.** The predicate
  is `typeof reference === 'string' && reference.trim() !== ''`. It was a declared
  divergence when written — 17.3.0's objectstack#13632 refinement spelled its emptiness test as an
  equality against `''`, so the spec accepted `reference: '   '` while these writers
  refused it. objectstack#16920 applies that test to the TRIMMED value, so the spec now
  refuses the identical shape under the same `custom` issue at the same `reference`
  path, and the divergence note is retired (objectui#8621). Whitespace names no object
  at either end (the spec's own `ObjectSchema.fields` key grammar
  `/^[a-z_][a-z0-9_]*$/` admits no whitespace-bearing name), so admitting it would only
  move the identical failure past the PUT and into a stored document, where it surfaces
  with no field named. ⚠️ objectstack#16920 is an unreleased `minor` upstream and this
  repo's pin is `@objectstack/spec` 17.3.0, which predates it — so until the pin moves,
  these writers are still the only thing refusing `'   '` here, and they refuse it at
  editor time either way, before the PUT rather than at the publish gate.
  
  The refusal message diagnoses which of the four states it found — absent, empty,
  non-string (`invalid_type`, a value of the wrong kind rather than a missing target),
  or blank — because the repair and the consequence differ per state.
  
  `minor` rather than `major` per `AGENTS.md`: objectui's major tracks `@objectstack`'s,
  so objectui's own breaking changes ship as `minor` with the breaking semantics stated.
- 0ea7054: Remove 37 runtime dependencies that no file in the declaring package consumes, and gate
  the direction so the next one cannot land (objectui#8198).
  
  `check:phantom-deps` judges imports that are not declared; nothing judged the reverse,
  so a declaration could outlive its last consumer indefinitely. That is what happened to
  `recharts` in `@object-ui/components` after objectui#7397 deleted its only importer — it
  was removed by hand on objectui#7625, and nothing would have reported the next one. The
  new `pnpm check:unused-deps` asks the reverse question over `dependencies` and
  `optionalDependencies` of every released package.
  
  **Potentially breaking, for consumers relying on hoisting.** Nothing these packages ship
  changes: their Vite `external` predicates are path-based and never read `dependencies`,
  so no built artifact moves. What changes is the install graph — a project that imports
  one of the removed packages while depending only on the ObjectUI package that used to
  drag it in will no longer resolve it. Declare it directly; that is the correct
  dependency edge in either case. The removals, by package:
  
  - `@object-ui/plugin-designer`: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@object-ui/fields`
  - `@object-ui/plugin-chatbot`: `react-markdown`, `react-syntax-highlighter`, `remark-gfm` (and the orphaned `@types/react-syntax-highlighter`)
  - `@object-ui/plugin-report`: `@object-ui/plugin-grid`, `clsx`, `react-i18next`, `tailwind-merge`
  - `@object-ui/plugin-map`: `@objectstack/spec`, `lucide-react`, `zod`
  - `@object-ui/runner`: `class-variance-authority`, `clsx`, `tailwind-merge`
  - `@object-ui/core`: `lodash`, `zod`
  - `@object-ui/layout`: `clsx`, `tailwind-merge`, and `react-dom` — which it pinned at an exact version in `dependencies` while also declaring it as a peer range, i.e. a library hard-depending on the renderer it asks its host to supply
  - `@object-ui/plugin-dashboard`: `clsx`, `tailwind-merge`, and the same `react-dom` defect
  - `@object-ui/plugin-ai`: `@object-ui/react`, `clsx`, `tailwind-merge`
  - `@object-ui/fields`: `clsx`, `tailwind-merge`
  - `@object-ui/console`: `@object-ui/react-runtime`, `sucrase`
  - `@object-ui/auth`: `@object-ui/types`
  - `@object-ui/plugin-calendar`: `@object-ui/fields`
  - `@object-ui/plugin-editor`, `@object-ui/plugin-markdown`: `@object-ui/react`
  - `@object-ui/react`: `react-hook-form`
  
  Every one was verified by a whole-package grep before removal — the name appeared nowhere
  under the package but its own manifest and CHANGELOG — and the whole workspace builds,
  type-checks and tests green afterwards.
- 9662aca: Apply the object-metadata write invariant at the write DOORS instead of at the writers.
  
  objectui#7714 ruled that a half-filled relationship stays client-side and the PUT body never
  carries one without a non-empty `reference`, and implemented that ruling by naming the two
  writers it knew of. The identical defect was then reproduced on a third (fixed in `9073cf018`); a
  sweep found nine more. The doors — the three places in this repo that actually PUT `/meta/:type/:name` —
  now apply the invariant themselves, so every writer is covered without any list of writers
  existing anywhere, and a new door is caught by a gate that derives the door set from the
  tree rather than restating it.
  
  Behaviour change for consumers: `MetadataClient.save('object', …)` now throws BEFORE issuing
  the request when the body carries a relationship field with a missing, empty or whitespace-only
  `reference`. The same document is refused by the server with a 422 on `fields.NAME.reference`,
  so nothing that previously succeeded now fails — the refusal moves earlier, names the field,
  and leaves the draft in the client instead of wedging every later save of that object. Writes
  of every other metadata type are untouched.
  
  New export from `@object-ui/data-objectstack`: `assertObjectMetadataWritable`,
  `RELATIONSHIP_TYPES_REQUIRING_REFERENCE` and `OBJECT_METADATA_TYPE`.
- 7dc31bb: **`MetadataFieldsPage` no longer rewrites a stored field type it cannot author.**
  
  `toDesignerType` mapped every type outside `DESIGNER_FIELD_TYPES` to `'text'` on the
  READ path, and `fromDesignerField` emitted the designer's type on the write path — so
  relabelling one field rewrote every other field whose type this designer does not
  author, on the same PUT. `text` is a legal spec type, so the save succeeded, the
  designer redrew the fields as text, and nothing reported it; restoring a field required
  knowing what its type used to be.
  
  The census: `DESIGNER_FIELD_TYPES` has 27 members, `FieldType` in `@objectstack/spec`
  17.3.0 declares 49, and all 27 are a subset of the 49. The 22 in the difference were
  each a distinct data-loss case — `secret`, `richtext`, `toggle`, `multiselect`, `radio`,
  `checkboxes`, `master_detail`, `tree`, `user`, `avatar`, `video`, `audio`, `summary`,
  `composite`, `repeater`, `record`, `json`, `signature`, `qrcode`, `progress`, `tags`,
  `vector`.
  
  A field whose stored type is outside the designer's set is now carried through the
  save verbatim — the mechanism this page already used one level down, where unknown
  per-field KEYS survive via `carryOver` — and is listed on the page read-only, showing
  its real stored type, instead of being drawn as an editable `text` field. Types inside
  the set are unchanged: still editable, and a type change the author makes is still
  honoured. A stored type in NEITHER vocabulary is carried through too, so an unknown
  type produces a loud 422 naming the field rather than a silent rewrite.
  
  Two behaviour changes worth naming:
  
  - Fields with a carried-through type are no longer editable or deletable from this
    page — including deleting them, which was previously possible only because they had
    already been misrepresented as text. Use metadata-admin to change them.
  - An object holding a target-less stored `master_detail` used to save from this page by
    flattening the field to `text` and losing the relationship. That field now reaches
    the existing relationship-target guard with its real type and is refused by name
    before the PUT. `@objectstack/spec` 17.3.0 requires `reference` on `master_detail`,
    so such a document's PUT answers 422 regardless; refusing here names the field and
    leaves the stored relationship intact.

### Patch Changes

- 1dbb993: fix(plugin-designer): the Navigation Designer has an entry for the spec's `doc` navigation item type
  
  objectstack#19789 added a `doc` member to the spec's navigation item union (an
  item that targets a book and/or a doc). `NAV_TYPE_META` in `NavigationDesigner`
  is keyed by that spec-derived union, so objectui stopped compiling against
  `@objectstack/spec` built from objectstack `main`, and every row reads its badge,
  colour and icon from that map. The map now has a `doc` entry (a `BookOpen` icon,
  its own colour and the `appDesigner.navTypeDoc` label key). The key has an
  English fallback in the designer's defaults and a translation in all ten locale
  packs.
  
  The map is typed `Record<NavigationItemType | 'doc', ...>` so it compiles both
  against the pinned `@objectstack/spec`, which predates `doc`, and against
  objectstack `main`. The `| 'doc'` goes away at the pin bump that ships `doc`.
  `doc` is not added to the quick-add buttons: an empty `doc` item fails the spec's
  book-or-doc requirement, and authoring one is objectui#10188.
- 557abc2: fix(app-shell, plugin-designer): three more forms keep the required `*` out of the control's accessible name
  
  A flow screen's input fields (`ScreenView`), the metadata-admin `SchemaForm` and
  the `AppCreationWizard` basic step each drew the required marker as a bare `*`
  inside the label that names the control. A screen reader therefore announced
  "Title *" instead of "Title", and none of those controls reported that it was
  required.
  
  The marker is now `aria-hidden`, the rule `ActionParamDialog` and `FormPage`
  already follow (objectui#3299, objectui#10178): the `*` is for sighted users, and
  the requirement is announced as `aria-required` on the control. Each marker also
  carries `data-required-marker="true"`, the same locator the shared form
  renderer's marker uses.
  
  - `ScreenView`: every field control (text, number, email, date, textarea,
    checkbox and select) carries `aria-required` when the field is required.
  - `SchemaForm`: the marker is hidden in the default row, in the boolean row, and
    in a grid repeater's column header, which names every cell below it. The
    controls `SchemaForm` renders itself (select, switch, number and text inputs,
    textarea, the comma-separated list input and the JSON editor) carry
    `aria-required` from the same flag that draws the marker.
  - Metadata-admin widgets: `WidgetProps` gains an optional `required` member, and
    `SchemaForm` passes the same flag to a registered widget, in a row and in a
    grid cell. Ten of the eleven `labelling: 'control'` widgets put it on their
    control as `aria-required`: `ref:object`, `ref:component`, `object-selector`,
    `field-selector`, `field-ref`, `view-ref`, `icon`, `color-input`,
    `string-tags` and `secret`. `filter-builder` does not, because its control is
    a plain button, where ARIA does not allow `aria-required`.
  - Colour picker: `ColorVariantPicker` takes an optional `required` and puts
    `aria-required` on its radio group, and the `color-picker` widget passes the
    field's flag through. Its other callers pass nothing, so they are unchanged.
  - `AppCreationWizard`: the App name and Title inputs carry `aria-required`.
  
  Native `required` is not added anywhere, so no browser validation appears beside
  each form's own required check.
- 25cb364: The Studio's app wizard saves an app the platform accepts, and the app favicon has one
  spelling, `branding.favicon` (objectui#10842).
  
  **Creating an app is no longer refused.** The console's "create app" and "edit app" pages save through
  `client.meta.saveItem('app', …)`, and the platform judges that document with
  `@objectstack/spec`'s strict `AppSchema`. `wizardDraftToAppSchema` wrote four top-level keys the
  spec does not declare (`type`, `title`, `favicon` and `layout`), so the save was refused with
  `422 INVALID_METADATA` (`unrecognized_keys`). It now writes only declared keys: the draft's
  title as `label`, the logo and favicon inside `branding`, and no `type` or `layout`. The spec
  has no app layout, so the wizard's layout choice is not saved.
  
  - `@object-ui/types` — **breaking:** `wizardDraftToAppSchema` now returns the app document
    (the spec's `App` shape, with objectui's `NavigationItem[]` as `navigation`) instead of an
    `AppComponentSchema` renderer node. It has no `type`, `title`, top-level `favicon` or `layout`.
    Code that read `result.title` reads `result.label`. Code that fed the result to
    `AppSchemaRenderer` builds the renderer node itself (`type: 'app'`, `title`).
  - `@object-ui/types` — **breaking:** `AppComponentSchema.favicon` is now `never` on the
    TypeScript face, and the zod mirror refuses a top-level `favicon` by name, answering "Did you
    mean `favicon` → `branding`?". This is the objectui#10827 rule that retired the top-level
    `logo`: the spec refuses the key, and the console reads only `branding.favicon`.
  - `@object-ui/layout`: `AppSchemaRenderer` puts `branding.favicon` on the tab. It read the
    top-level `favicon` before, and never `branding.favicon`.
  - `@object-ui/plugin-designer`: `EditAppPage` keeps the keys the wizard does not maintain, but
    only keys the spec's `AppSchema` declares, read from that schema. A row stored before the
    schema closed is served with the old wizard's top-level keys, and echoing them made every
    edit of such an app fail the same way. Its pre-fill no longer falls back onto a top-level
    `logo`, `favicon` or `title`; it reads `branding.logo`, `branding.favicon` and `label`.
  
  Migration: move a top-level `favicon` URL to `branding: { favicon: '…' }`.
  
  ⚠️ **Dated note, 2026-09-28 — the wizard has no layout choice — objectui#10867.**
  Later in this same release the wizard's Layout control was removed, with `AppWizardDraft.layout`, so there is no
  layout choice left to not save. The rest of this entry still holds.
- 7343376: fix(types,plugin-designer)!: the Studio app wizard saves a document the platform accepts, and an edit keeps the stored `accentColor` (objectui#10867)
  
  ⚠️ **BREAKING (authoring)**, marked `minor` under this repository's version-alignment rule (a `major` in the fixed group would move all of it off the `@objectstack` major). Two published `@object-ui/types` members narrow: a navigation separator no longer takes a `label`, and `AppWizardDraft.layout` is removed. A TypeScript literal that writes either no longer compiles. `NavigationItem` is now a union type alias, not an interface. So code that reads `label` off an unnarrowed `NavigationItem` into a `string` slot (its type is now `string | undefined`; objectui#11299, in the same release, widens it to the spec's `I18nLabel` or `undefined`, see `.changeset/11299-types-nav-label-locale-map.md`) also stops compiling, as does code that spreads an entry-only key onto one, and an `interface` that `extends NavigationItem` or augments it (extend `NavigationEntryItem` instead). `objectui validate` now refuses a separator `label` too: the zod mirror's `NavigationItemSchema` refuses every key on a separator that the spec's separator does not declare. The four `appDesigner` layout keys also leave the published `@object-ui/i18n` packs and `DESIGNER_DEFAULT_TRANSLATIONS`, so an application that calls `t()` with one of them now renders the raw key (unless the call passes a `defaultValue`).
  
  **Clause-②: yes (narrowing)** — the separator arm of `NavigationItem` loses `label`, and `AppWizardDraft` loses `layout`.
  
  - **A separator carries only `type`, `id` and `order`.** `@objectstack/spec`'s separator branch declares exactly those keys, and its `AppSchema` refuses anything else. `NavigationItem` required a `label` on every item, so the wizard's "Add separator" wrote `{ id, type: 'separator', label: '' }`, and the console's create-app and edit-app saves were refused with `422 INVALID_METADATA` (`unrecognized_keys` `['label']` at `navigation.N`). `NavigationItem` is now a union of two arms, discriminated by `type`. `NavigationEntryItem` holds every other nav type and keeps its required `label`. `NavigationSeparatorItem` admits `type`, `id` and `order`, and every other entry key is `?: never` on it. Both arms are exported. Reading an entry-only key off an unnarrowed item still compiles, but its type now includes `undefined` (a `label` is `string | undefined`; objectui#11299, in the same release, makes it the spec's `I18nLabel` or `undefined`, see `.changeset/11299-types-nav-label-locale-map.md`), so passing it where a `string` is required does not. Narrow on `item.type === 'separator'` before relying on `label`. `menuItemToNavigationItem` maps a legacy separator to `{ id, type: 'separator' }` and drops its label. `spec-derived-unions.test.ts` no longer pins the separator `label` as a blocker. It asserts, at both spec tiers, that the separator arm admits the spec separator's keys and no others.
  - **`@object-ui/plugin-designer`: the wizard and `NavigationDesigner` write a separator as `{ id, type }`.** `NavigationDesigner` no longer writes a `label` onto a new separator, and its label, icon and visibility patchers skip one.
  - **`@object-ui/layout` narrows on the separator arm; nothing it renders changes.** `resolveNavItemLabel` answers `''` for every separator. A stored separator carrying a non-empty `label`, which `menuItemToNavigationItem` produced before this change, used to resolve to that label. No renderer asks it for a separator's label. The mobile bottom nav's leaf list, which already skipped separators, is now typed as entries.
  - **`@object-ui/app-shell` narrows the same way; nothing it renders changes.** `useNavPins` registers a favorite only for an entry and leaves a separator as it is, and the Studio sidebar's navigation walk passes a separator through unchanged.
  - **`@object-ui/plugin-designer`: `EditAppPage` keeps the stored branding.** The wizard maintains the logo, primary colour and favicon, and its `branding` replaced the stored block, so a stored `accentColor` was dropped on every edit. The console reads that key. The save now keeps every stored `branding` key the spec's `AppBrandingSchema` declares, read from that schema. The wizard's values win for the keys it maintains. A stored key the spec does not declare is still left out.
  - **The wizard's Layout control is removed, with `AppWizardDraft.layout`.** The spec declares no app `layout`, no console surface reads one, and since objectui#10842 the save wrote none. The control persisted nothing. `EditAppPage` no longer reads a stored `layout` into the draft. The Basic Info step's description now reads "Name, title, and icon".
  - **`@object-ui/i18n`:** the four `appDesigner` layout keys (`layout`, `layoutSidebar`, `layoutHeader` and `layoutEmpty`) are removed from all ten packs, and `appDesigner.stepBasicDesc` no longer names a layout.
  
  **Migration:** write a separator as `{ id, type: 'separator' }`, with an optional `order`. Remove `layout` from any `AppWizardDraft` you build. Code that spreads an entry-only key (`label`, `visible`, `requiredPermissions` and the rest) onto a value typed `NavigationItem` narrows it first (`item.type !== 'separator'`) or types it `NavigationEntryItem`: the separator arm refuses those keys. `AppComponentSchema.layout`, the renderer node's own layout strategy, is a different member and is unchanged.
  
  Pinned in `packages/types/src/__tests__/app-wizard-separator-layout-10867.test.ts` and `packages/plugin-designer/src/__tests__/AppWizard.specDocument-10867.test.tsx`.
- 44b67da: fix(plugin-designer): editing an app keeps its stored navigation (objectui#10894)
  
  **Clause-②: no** — an edit stops destroying stored navigation. No declared type, accepted key or published surface moves.
  
  The console's "edit app" page (`EditAppPage`) loads the stored app into `AppCreationWizard`. Leaving the wizard's Objects step replaced the draft's `navigation` with one generated object entry per selected object, and every edit passes through that step. So any edit, even a title change, saved a stored `[object, separator, group, url]` tree as `[object]`. It dropped every separator, group (with its children) and `url` / `dashboard` / `page` / `report` / `component` / `action` entry, and each object entry's own label, icon and order, with no warning.
  
  - **Leaving the Objects step no longer replaces the navigation.** An empty navigation (the create path) is still filled with one object entry per selected object. A non-empty one is merged:
    - a newly selected object gets an object entry, appended at the end;
    - the object entries of a deselected object are dropped, at the top level or inside a group. The group keeps its place and its other children, even when that leaves it with none;
    - every other entry is kept as stored, in its position. That includes each object entry's label, icon and order, and an object entry for an object the Objects step does not list.
  - **`EditAppPage` counts an object as selected when the stored navigation has an object entry for it at the top level or inside a group, at any depth.** It counted only top-level entries, so a grouped object showed as unselected.
  - The same merge applies on the create path once the author has shaped the navigation. Going back to the Objects step and forward again keeps the added separators, groups and links, and the order.
  
  Pinned in `packages/plugin-designer/src/__tests__/EditAppPage.keepsNavigation-10894.test.tsx`.
- 8741cb7: fix(app-shell,plugin-designer): the designer's nav surfaces name a nav entry with no `label` the way the console draws it (objectui#11196)
  
  A navigation entry's `label` is optional: an entry without one shows, at render time, the current
  label of what it opens. The console's sidebar, `nav:menu`, command palette and search already draw
  it that way, and the platform now writes such entries (the console's navigation sync, for every
  page and dashboard). The designer surfaces read the raw label instead, so the same entry showed as
  `(unnamed)` in the app preview, as a positional `Item N` card on the nav canvas, by its positional
  selection id in the app nav inspector, by its target's internal name (or, for a group, a blank
  heading) in the Studio Interfaces rail, and as a blank row in the Navigation Designer and the app
  wizard's Navigation step.
  
  Every one of those surfaces now asks the runtime's own rule, `resolveNavItemLabel` from
  `@object-ui/layout`; none keeps a second copy of it. In app-shell the preview, the canvas, the
  inspector and the Studio rail pass the console's own target resolver, so a label-less entry shows its target's current
  label (a rename shows on the next render), else the target's machine name, else the entry's `id`.
  The app wizard's Navigation step hands the rule its own object list, so a label-less object entry
  there shows the object's label. The Navigation Designer is handed bare items and no metadata, so it
  shows the rule's machine-name rung (`pageName`, `dashboardName`, `objectName`, …), which is what the
  console shows for a page.
  
  Editing keeps inheritance intact. The canvas's inline rename and the inspector's Label field show
  the inherited text as a placeholder, never as a stored value: leaving an entry untouched keeps it
  label-less, and typing writes an author label. Emptying the inspector's Label field restores
  inheritance by removing the `label` key, never by writing `''`; for a locale-map label it drops only
  the designer locale's own entry. The inspector also stops reading `title` and `name`, which are not
  nav-item keys, as the label, and a locale-map label there now shows its text instead of
  `[object Object]` and keeps every other language when edited.
  
  `@object-ui/plugin-designer` now depends on `@object-ui/layout`, which it did not before.
- cb2f6fb: fix(app-shell,plugin-designer): standard navigation entries are written with no `label`, never with a copy of their target's text (objectui#11201)
  
  A navigation entry's `label` is optional. An entry without one shows, at render time, the current
  label of what it opens, in the viewer's language. A present label is shown as written. The
  platform's own producers of standard entries now leave the label out, so the entry keeps following
  its target:
  
  - Studio's Create app with "add objects" seeds one entry per package object. Each entry used to
    store the object's label, or its machine name for a draft or unlabelled object.
  - Binding an object to a placeholder entry in the Studio's nav-item panel used to replace the
    placeholder with the object's label. It now removes the placeholder. A label the author typed, and
    a locale-map label, are kept.
  - The app wizard's generated object entries used to store the object's plural label, else its
    label, and the create and edit pages hand the wizard the machine name for an unlabelled object.
    An entry now stores a label only when the object declares a plural label, and only when that
    plural label differs from both the object's label and its machine name.
  
  The console's navigation sync already writes page and dashboard entries this way. Stored navigation
  is not converted.
- 770cc5b: chore(plugin-designer): follow `@object-ui/layout`'s and `@object-ui/types`' navigation label changes (objectui#11299)
  
  - `@object-ui/layout` removed the three unused resolver arguments of
    `resolveNavItemLabel`, so the app creation wizard's preview of an unlabelled
    navigation entry now calls it as `resolveNavItemLabel(item, undefined, targetLabel)`.
  - `@object-ui/types` now types a navigation entry's `label` as the spec's `I18nLabel`
    (a string or an inline locale map), so the navigation designer's inline rename reads
    the label through a helper that takes both: a string, and objectui's keyed
    reference, start the draft as before, and an inline locale map starts it empty, as it
    already did.
  
  What either component shows is unchanged.
- d893290: `MetadataFieldsPage` shows the per-field prescription when the spec refuses a save, not only the refusal headline (objectui#11302).
  
  A field the spec refuses (for example a name like `Bad Name`, or `__proto__`) made the page show only the 422's headline, "object/NAME failed spec validation: N issues — …", while the sentence telling the author what to do ("Field names must be lowercase snake_case", "Rename the key") rode in the error's structured issues and never reached the screen. The page now renders its errors through `formatMetadataError` from `@object-ui/data-objectstack`, the same reader the Studio surfaces use: one line per issue, naming the field and the fix. Every other failure still shows its own message.
- 6e9c8d2: fix: the widget width / height editors write a whole four-number `layout` (objectui#11388)
  
  The three dashboard widget width / height editors (Studio's widget inspector in
  `@object-ui/app-shell`, `DashboardWithConfig` in `@object-ui/plugin-dashboard` and
  `DashboardEditor` in `@object-ui/plugin-designer`) each spread the one edited
  dimension onto the widget's possibly-absent `layout` and cast the result past the
  declared four-number type. On a widget with no `layout`, which is how Studio adds
  one, they stored `{ w }` or `{ h }`, and `@objectstack/spec`'s widget `layout`
  refuses that box at `x`, `y` and the other dimension.
  
  `@object-ui/types` gains two exports on its main entry:
  
  - `defaultWidgetPlacement(index)`: the box the dashboard grid auto-places the
    widget at that position of `widgets[]` in when it has no `layout`, the fallback
    the spec's widget `layout` states (`x: (i % 4) * 3`, `y: Math.floor(i / 4) * 4`,
    `w: 3`, `h: 4`).
  - `completeWidgetLayout(layout, patch, placement)`: the whole box after an edit,
    each coordinate taken from the edit, else from the stored `layout`, else from
    the placement.
  
  All three editors now write through `completeWidgetLayout`, seeding from
  `defaultWidgetPlacement` for the widget's index, and the casts are gone, so the
  compiler judges each write. A widget that has a `layout` keeps its `x` and `y`.
  The width and height inputs (and `DashboardWithConfig`'s sliders) show the same
  completed box, so a widget with no `layout` now shows the auto-placed 3 × 4 where
  it showed 1 × 1, and the dimension an edit leaves alone is the one on screen.
  `DashboardGridLayout` places a widget with no `layout` through
  `defaultWidgetPlacement`, with no change to where it lands.
  
  `DashboardWithConfig`'s `onWidgetSave` payload keeps its flattened `layoutW` /
  `layoutH` shape. For a widget with no `layout` that the author did not resize,
  the two values it carries are now the auto-placed 3 and 4, not 1 and 1.
- 9d7419b: The dashboard editor reads a `widgets[]` entry by the slot's element type, `DashboardComponentSchema['widgets'][number]`, in its widget card, its property panel, its preview and its measure probe (objectui#11514). `@object-ui/types` no longer lets the slot's component arm stand in for `DashboardWidgetSchema`, and these reads annotated entries with that interface. Type-only: nothing the editor renders, offers or writes changes.
- 39f4309: Published typings from every `vite-plugin-dts` package now carry an explicit extension on
  every relative specifier, and a type error in the declaration build now fails the build
  instead of being printed and ignored (objectui#5439, objectui#5483).
  
  **Consumers on `moduleResolution: nodenext` or `node16` may see NEW type errors, and that
  is the fix working.** These packages re-export mostly through NAMED re-exports —
  `export { useObjectChat } from './useObjectChat'`. TypeScript could not follow the
  extensionless hop, but it still DECLARED the name, so the symbol resolved to a silent
  `any`. Nothing errored; consumers simply got no types. With the extension emitted, the
  symbol carries its real type, and any call site that was relying on the `any` now type
  checks for the first time. This is the mode that produced the 21 residual `TS7006` on
  `@object-ui/app-shell` reported against objectui#5365 — a type hole that opened quietly,
  unlike objectui#5365's own `export * from './ui'` packages where the same defect surfaced
  immediately as `TS2305: has no exported member`.
  
  410 extensionless relative specifiers across 19 packages were emitted before this change;
  the count is now 0 in all 22 packages that build typings through `vite-plugin-dts`.
  `@object-ui/fields` was already clean — its sources write explicit `.js` specifiers — and
  is wired so it stays that way.
  
  The second half changes no emitted output today: 22/22 packages built green unmodified, so
  making the declaration step's exit code honest turns nothing red. It changes what a FUTURE
  regression does — print and exit 0, versus fail the build.
- 2cf69e4: The field designer now reads and writes a lookup field's relationship target under the
  spec's spelling `reference` (objectui#6041), in both directions.
  
  `referenceTo` is not in `FieldSchema`'s accept set. Measured against the installed
  `@objectstack/spec` 17.2.0, through the whole object document that
  `PUT /api/v1/meta/object/:name` validates:
  
  ```
  ObjectSchema.safeParse({ …, fields: { rel: { type: 'lookup', label: 'Owner',
                                              referenceTo: 'user' } } })
    => success = false
    => unrecognized_keys at ["fields","rel"] keys=["referenceTo"]
       "Did you mean `referenceTo` -> `reference`?"
  ```
  
  so authoring a lookup field through the designer returned a hard 422 `INVALID_METADATA`,
  and — because the key is then stored — blocked **every subsequent save** of that object,
  with nothing in the UI to say which key did it.
  
  The read direction was broken symmetrically and is the half that would have survived a
  write-only fix: `toDesignerField` read `raw.referenceTo` while a spec-parsed server sends
  `reference`, so every already-saved lookup field loaded into the designer with an **empty
  reference box**. Both wire-bound payload shapes move — `FieldMetadataPayload`
  (`MetadataService.toFieldPayload`) and `ServerFieldSchema`
  (`MetadataFieldsPage.fromDesignerField`).
  
  `referenceTo` also joins `RETIRED_FIELD_KEYS`. Renaming the emit sites alone does not
  unblock an object whose stored fields already carry the misspelling: `carryOver` spreads
  the previous server def verbatim, so the key would ride straight back out to the same 422.
  The designer's in-memory `DesignerFieldDefinition` keeps `referenceTo` — that is the
  internal prop name every other UI surface in this repo already uses (`LookupField`,
  `filter-builder`, `ObjectChart`, `ListView`, `UserFilters`), it reaches no wire-bound
  shape, and the parity gate classifies it as `uiOnly` rather than a violation.
  
  No behavioural change for a half-filled draft: the spec's prose calls `reference`
  "required for relationship types", but that is not enforced by the zod parse at 17.2.0 —
  `{ type: 'lookup', label: 'L' }` parses green at field level and through `ObjectSchema`,
  and `undefined` is dropped by `JSON.stringify` under either spelling, so the wire bytes
  are identical before and after.
- 2cf69e4: The field designer now reads the system-field marker under the spec's spelling `system`,
  and never hands `isSystem` back to the metadata API (objectui#6044).
  
  `isSystem` is not in `FieldSchema`'s accept set. Measured against the installed
  `@objectstack/spec` 17.2.0:
  
  ```
  FieldSchema.safeParse({ type: 'text', label: 'L', isSystem: true })
    => success = false
    => unrecognized_keys keys=["isSystem"]  "Did you mean `isSystem` -> `system`?"
  ```
  
  Two defects, one misspelling, and they are two different sites.
  
  **The read was dead** — the quieter and worse half. `toDesignerField` read `raw.isSystem`
  while a spec-parsed server sends `system`, so the flag was always `undefined`. Nothing went
  red, because the flag is optional and `undefined` is a valid "not a system field". But it is
  load-bearing: `FieldDesigner` refuses to delete a system field and disables its name and
  type inputs, so with the read dead `organization_id`, `created_at` and friends presented as
  ordinary editable, **deletable** business fields.
  
  **The write had no emit site at all.** `fromDesignerField` never names `isSystem`; its only
  route out is the verbatim `...carryOver(prev)` spread, so a stored misspelling round-tripped
  back to `PUT /api/v1/meta/object/:name` as a hard 422 `INVALID_METADATA` that blocks every
  later save. The repair is a `RETIRED_FIELD_KEYS` tombstone rather than a renamed line — and
  it is deliberately paired with the read fix, never a substitute for it: stripping alone would
  close the 422 and fossilize the dead detection. The spec spelling `system` is not stripped,
  so a server-injected flag rides through untouched and feeds the read.
  
  `app-shell`'s `FieldMetadataPayload` never declared the key, so `toFieldPayload` had nothing
  to fix. The designer's in-memory `DesignerFieldDefinition` keeps `isSystem`: it reaches no
  wire-bound shape and the parity gate classifies it as `uiOnly`.
- 00c665e: `appDesigner.fieldDesigner.formula` is retired — one row removed from each of the ten
  locale packs plus the designer defaults map, 11 lines, zero readers (objectui#6310).
  
  objectui#6043 retired the Field Designer's formula-expression textarea, which was the
  key's only call site (`FieldDesigner.tsx`, the `{ name: 'formula', label:
  t('appDesigner.fieldDesigner.formula') }` field descriptor). The value outlived it in
  eleven places: `DESIGNER_DEFAULT_TRANSLATIONS` in
  `packages/plugin-designer/src/hooks/useDesignerTranslation.ts`, and the `appDesigner >
  fieldDesigner > formula` leaf of `packages/i18n/src/locales/{en,de,es,fr,pt,ru,ja,ko,zh,ar}.ts`.
  
  Removed under objectui#4658's evidence standard, re-measured on this branch rather than
  inherited from the card: zero `t()`/`tt()` call sites, no dynamic template head that could
  reach it (`appDesigner.fieldDesigner.typeCategory.` is the namespace's only one), and its
  sole textual occurrence anywhere in the repo was the defaults-map row this change removes
  with it — so the key goes from NEEDS-REVIEW to no footprint at all.
  
  The map and all ten packs move in one commit, which is what keeps
  `defaults-maps-mirror-en-pack` green: that gate fails a map row whose key the `en` pack
  lacks, and `all-locales-key-parity` fails a pack left behind.
  
  Not touched: `designer.field.formula` (`'Formula (CEL)'`) in
  `packages/app-shell/src/views/metadata-admin/i18n.ts`, a different and live key belonging
  to metadata-admin's `ObjectFieldInspector` — the surface that still authors formula
  expressions.
  
  `packages/i18n/src/__tests__/appDesigner-fieldDesigner-formula-retired-6310.test.ts` pins the
  removal by name, following the four prior retirements (objectui#4145, objectui#4392,
  objectui#4730, objectui#5504). Every i18n gate here runs call site → key, so none of them can
  see a dead key come BACK into the packs: the reverse sweep that found this one is report-only
  by design, `all-locales-key-parity` is fully satisfied by ten packs agreeing on a dead key, and
  `check:i18n-drift` only fires when a value changes. Reverse-verified rather than asserted —
  reviving the row in all ten packs turns exactly that one case red, naming each pack, while the
  parity gate and the defaults-map mirror stay green.
- 73e8c33: The Field Designer builds an object's `fields` map by defining own properties and refuses
  the three field lists a name-keyed map cannot carry (objectui#6489). `MetadataFieldsPage`
  keyed the map by blind assignment — `nextFields[f.name] = fromDesignerField(…)` inside a
  bare `for` loop — which failed silently in three directions, all measured on the installed
  `@objectstack/spec` 17.2.0:
  
  - **A field named `__proto__` never reached the wire.** `map['__proto__'] = def` invokes the
    prototype setter instead of creating a key, so the field vanished from the serialised PUT
    body. `__proto__` matches `ObjectSchema.fields`' key rule `/^[a-z_][a-z0-9_]*$/`, so the
    spec stood ready to accept the field the client had thrown away. The map is now built
    through `Object.fromEntries`, which defines an own property.
  - **A nameless field was stored under the literal key `"undefined"`.** Measured:
    `ObjectSchema.safeParse` with `fields: { undefined: … }` returns `success = true`, so the
    document parsed, persisted, and had no reader anywhere. It is now refused before the
    request.
  - **Two fields sharing a name collapsed into one entry.** A designer list carrying two
    `amount` fields PUT a single entry, the later silently replacing the earlier. Also refused
    before the request.
  
  Both refusals raise before `client.save`, so a refused list issues no PUT at all, and the
  message lands in the page's existing error surface naming the offending index — the caller
  is fire-and-forget (`void handleFieldsChange(next)`), so throwing past it would show the
  author nothing.
  
  This is the plugin-designer port of the refusals objectui#6240 landed in the sibling object
  writer (app-shell's `MetadataService.toFieldsMap`), down to the wording, so the two writers
  of the objectui#5761 parity family cannot drift. `fromDesignerField`'s carry-over semantics
  are untouched.
- b49f9a1: `MetadataObjectsPage` keys its object-name lookups as own entries, so deleting an object
  named `constructor` (or `__proto__`) from the Object Manager actually deletes it
  (objectui#6522).
  
  Both name lookups in the page were plain object literals filled by assignment, and the
  consequential one was a READ. The delete scan asked `!nextByName[name]`, which for an
  object named `constructor` answered out of `Object.prototype` with the `Object` function —
  truthy — so the deletion read as "still present" and `client.reset('object', …)` never
  fired. Not a refusal: the row disappeared from the manager, no error was shown, the save
  reported success, and the object was still there after the next reload. Measured against
  the installed `@objectstack/spec`, `ObjectSchema` pins object names to
  `/^[a-z_][a-z0-9_]*$/` and accepts both `constructor` and `__proto__` — those two are
  exactly the intersection with `Object.prototype`'s own names, so both are storable and
  neither was deletable.
  
  The second lookup, one function over, failed on the WRITE instead: `byName[item.name] =
  item` for an object named `__proto__` invoked the prototype setter rather than creating a
  key, so the object never became an own property, never reached the Object Manager at all,
  and left its payload on the lookup's prototype chain for later name lookups to answer out
  of. Both are now `Map`s — neither container is ever serialised, only its values are, so a
  `Map` fits where the sibling `MetadataFieldsPage` fields map (which IS the PUT body) needs
  `Object.fromEntries`.
  
  Keying only. Nameless and duplicate entries behave exactly as before: this page writes
  per-object, so the refusal semantics objectui#6489 added to the fields map are a separate
  question and are deliberately not ported here.
- 3e028c8: One tombstone registry for the designer seam's retired field keys
  (objectui#6527). Three independently maintained `RETIRED_FIELD_KEYS` literals
  — the metadata-admin read door (`object-fields-io.ts`), `MetadataService`'s
  carry-over and `MetadataFieldsPage`'s carry-over — become derivations from a
  single registry in `@object-ui/types` (`RETIRED_FIELD_KEY_TOMBSTONES` +
  `retiredFieldKeysFor(site)`), naming each retired key, the card that retired
  it, and its PER-SITE applicability.
  
  Per-site behaviour is unchanged — this is a consolidation, and each site's
  effective strip set is pinned equal to its pre-consolidation literal. The two
  deliberate asymmetries a naive union would have destroyed are now recorded as
  data and pinned:
  
  - `formula` stays stripped by the two write-side carry-overs and is NOT
    stripped by the read door — ruled on objectui#6526 (option B): the
    `ObjectFieldInspector` migration path (objectui#6043) stands, and the
    registry test makes that ruling mechanical.
  - `sortOrder` stays a single-site strip at `MetadataService`'s carry-over,
    now explicitly recorded as the registry's one DEFENSIVE entry (objectui#6045
    measured that no shipped writer ever populated a field-level one).
- c6198c2: **Breaking for authored metadata:** `ComponentInput.label`, `ComponentInput.defaultValue` and
  `ComponentInput.advanced` are RETIRED on both faces (objectui#7493 item ① and objectui#7781;
  maintainer ruling A of 2026-09-06, immediate, no deprecation window; ADR-0049 enforce-or-remove).
  They are the three keys the manifest serializer does not forward, and nothing read them on any
  publication or consumption path.
  
  No manifest ever published them, so no consumer could ever have read them. `sdui-parser`'s
  serializer (`packages/sdui-parser/src/index.ts`) forwards exactly seven keys per input — `name`,
  `type`, `of`, `required`, `enum`, `binding`, `description` — so a value authored under any of the three
  never reached `sdui.manifest.json`, the generated JSX `.d.ts`, or a diagnostic; its boundary type
  has no slot for them; the registry's data-source seam reads `name` only; and neither the designer
  nor the app-shell inspectors consult registry `inputs` at all. A structural census over every
  `inputs:` array in the repository (re-measured on this change's merge-base, `name` 951 and `type`
  951 as the controls) counted the writes: `label` 908, `defaultValue` 245, `advanced` 9 — written on
  nearly every registration, read by nothing.
  
  FROM → TO, per key — all three **TOMBSTONED, not removed**, because the route was measured on
  the built face before it was chosen: `ComponentInputSchema` is a non-strict `z.object`, and an
  undeclared key parses GREEN and is silently STRIPPED, so a deletion would have swallowed 1,162
  authored values in silence. The tombstone is what makes the refusal loud and by name.
  
  - `label?: string` → `label?: never` on the interface, `retirementTombstone()` on the Zod mirror.
    Migration: delete the key. An input is identified by its `name` on every path that reaches it;
    nothing ever rendered a label for it.
  - `defaultValue?: any` → `defaultValue?: never` / `retirementTombstone()`. Migration: delete the
    key. The renderer's own fallback read IS the default; tell the author about it in `description`,
    which IS published. (Tightening the type to `unknown` was ruled out: it closes no error class,
    since nothing reads the value.)
  - `advanced?: boolean` → `advanced?: never` / `retirementTombstone()`. Migration: delete the key.
    No designer surface ever hid an "advanced" input; there is nothing to write instead.
  
  The retirement kit: `?: never` on `ComponentInput` (`packages/types/src/base.ts`), so authoring one
  is a `tsc` error at the registration site; `retirementTombstone()` on `ComponentInputSchema`
  (`packages/types/src/zod/base.zod.ts`), so an authored value is REFUSED at parse time with
  `code: 'invalid_type'`, the key named in the issue `path`, and the migration note as the message
  (one string, both channels). Pinned in
  `packages/types/src/__tests__/component-input-retired-keys-7493.test.ts`, which also holds a
  tree-scoped absence census over every `inputs:` array under `packages/**` and `apps/**`.
  
  Accept-set change, stated plainly for reviewers: a document that sets any of the three keys on a
  `ComponentInput` used to parse GREEN (the value was then dropped by the serializer) and now parses
  RED. Every in-repo authoring site — 1,199 keys across 110 registration files, the three standalone
  `ComponentInput[]` arrays and the two named input arrays `tsc` found included — is deleted in the same change, as the ruling's split rule
  requires; the `WidgetRegistry` seam no longer copies the widget-manifest values onto the synthesized
  `ComponentInput` (they fed nothing), and the data-source declaration `ELEMENT_DATA_SOURCE_INPUT`
  drops its `label`. The patch entries on the other packages record exactly that: their registrations
  stop authoring inert keys, with no runtime or published-manifest change.
  
  The nine test files that read `defaultValue` off a registration were re-pinned against the
  renderer's ACTUAL default (its own fallback read, or the `defaultProps` it ships) instead of the
  declaration that went away; two assertions that only restated the shadow default were dropped with
  the reason on the line.
  
  The in-repo zero is what was measured. Whether anything OUTSIDE this repository writes these keys
  is not measurable from here (the objectui#5674 limit); converting such a write from a silent drop
  into a named refusal is exactly what the tombstones buy. `WidgetInput`'s own `label` /
  `defaultValue` / `advanced` (the widget-manifest face) stay declared and writable — nothing has
  ruled on that face; that it now has no reader either is recorded as objectui#7911.
- 3f4b458: fix(plugin-designer): read a lookup's target under the retired `referenceTo` spelling too
  
  `MetadataFieldsPage`'s read door (`toDesignerField`) read the spec spelling
  `reference` and nothing else, while its carry-over strips `referenceTo` from the
  stored definition. A field whose target survives only as the pre-objectui#6041
  `referenceTo` therefore read as target-less, the strip removed the stored value,
  and the field reached the wire as a `lookup` with no target — saving silently at
  `@objectstack/spec` 17.2.0 and answering `422 INVALID_METADATA` at
  `fields.NAME.reference` against 17.3.0, with nothing naming which field.
  
  The read door now reads `reference` and falls back to `referenceTo`. That is a
  pure rename: `FieldSchema`'s own alias map renames `referenceTo` onto
  `reference` and both spellings carry one object machine name, so no value
  changes shape on the way through — unlike the `formula` alias, where the rename
  was refused because the two sides carry different value grammars
  (objectui#6043).
  
  objectui#7714's guard is untouched and still refuses a relationship field with
  no usable target under either spelling, by name, before the PUT.
- c5c0e2a: Per-row operation gating for `ObjectGrid`, and the Field Designer stops drawing a
  delete action it refuses to run (objectui#8674).
  
  **The defect.** `FieldDesigner`'s `handleDelete` returned early on `field.isSystem` —
  before the confirm dialog — while the affordance was wired at the GRID level
  (`onDelete={readOnly ? undefined : handleDelete}`). `ObjectGrid` takes one grid-level
  `onDelete` and derives `{ update: !!onEdit, delete: !!onDelete }`, so the row action
  was drawn for every row: clicking delete on a system field produced no dialog, no
  toast and no console message. `readOnly` was honest in the same component (the
  callback is withheld, so no button is drawn); `isSystem` drew the button and dropped
  the click. The two states differed in the code and did not differ on screen.
  
  **`@object-ui/plugin-grid` — new, additive, opt-in.** `ObjectGridComponentProps`
  gains `rowOperations?: (record) => { update?: boolean; delete?: boolean }`, with the
  new `ObjectGridRowOperations` type exported from the package root. It speaks the same
  `update` / `delete` vocabulary the authored `operations` block speaks, resolved for
  one row instead of for the grid, and it is an INTERSECTION like every layer around it
  (the ADR-0103 lifecycle bucket, the object's `userActions`, the server's effective API
  operations, the principal's own grant, the record-level explain verdict): `false`
  withholds, and nothing it returns can re-open what those closed. A caller that passes
  no predicate renders exactly what it rendered before — measured, not asserted: the
  rendered DOM of a no-predicate grid is byte-identical across this change, and every
  other `<ObjectGrid>` call site in the repository is such a caller.
  
  It is a function value, so no metadata document can hold it and none is invited to:
  like the nine `on*` callbacks it sits beside, it is a renderer prop and not an
  authorable key.
  
  **`@object-ui/plugin-designer` — the first caller, and the user-visible fix.** The
  Field Designer passes the predicate, so a system field's row no longer offers Delete
  at all. Edit is untouched: the drawer still opens for a system field, with `name` and
  `type` disabled exactly as before — `isSystem` has never meant "this row is
  untouchable". The guard inside `handleDelete` stays as a second line for direct
  callers of the prop value, but it is no longer the only refusal.
- db0e9d3: fix(plugin-designer): the dashboard editor's type picker no longer turns a multi-measure widget into a type the widget door refuses (objectui#8894)
  
  `@objectstack/spec` 17.5.0 refuses a second measure on a metric-family widget. The
  dashboard editor authors no measures, but a dashboard it opens carries them, and its
  type picker could turn a stored `bar` over two measures into a `metric` that publish
  then refused — a refusal `DashboardDesignPage`'s save swallows. The picker now asks
  objectui's `DashboardWidgetSchema` (which re-attaches the spec's own check) before it
  offers a type: a type the door refuses this widget's measures under is a disabled
  option, and a change to it writes nothing. A stored widget the door already refuses
  keeps its type and shows the door's own message under the picker. A widget with one
  measure, or none, is offered every type as before.
- a5abc0c: Correct the user-visible refusal banner that told authors a blank relationship
  target would be accepted by the installed `@objectstack/spec` (objectui#8897).
  
  `MetadataService` and `MetadataFieldsPage` both refuse a `lookup` /
  `master_detail` field whose `reference` trims to empty, and both explained the
  refusal by saying the spec **accepts** the value, "so the PUT would succeed and
  the failure would surface later and further away". That was measured and true at
  `@objectstack/spec` 17.3.0. The pin is 17.4.0 (objectui#8772), which carries
  objectstack#16920 — the emptiness test now applies to the TRIMMED value — so
  against the artifact this repo actually installs, the PUT would **not** succeed.
  The product was asserting to authors something the installed artifact
  contradicts.
  
  Measured on the installed 17.4.0 artifact, with controls in the same run:
  
      FieldSchema.safeParse({ type:'lookup', label:'L', reference:'   ' })
        => success = false, custom at ["reference"]
      ObjectSchema.safeParse({ …, fields:{ rel:{ …, reference:'   ' } } })
        => success = false, custom at ["fields","rel","reference"]
      controls: reference:'account' and reference:' account ' both ACCEPTED
  
  The banner now names the trim the contract applies — which is what still tells a
  blank target apart from an empty one now that both are refused — and promises
  the 422 it previously had to withhold. The verbatim pin on that sentence moved
  with it, in the same commit.
  
  ⛔ **The guard's predicate is byte-identical.** objectui#8621 ruled it stays for
  its own reason: it refuses at EDITOR time, before the PUT, naming the field while
  it is still on screen. Only its stated *reason* was wrong.
  
  ⛔ Statements about **when** the contract changed ("17.3.0 made `reference` a
  hard requirement", "at 17.2.0 the requirement was prose only") are permanently
  true and were not touched; only statements about **what is installed** were.
- 7b2fe4d: The Object Manager stops drawing a delete action it refuses to run
  (objectui#9219) — objectui#8674's defect, one component over.
  
  **The defect.** `ObjectManager`'s `handleDelete` returned early on
  `obj.isSystem`, before the confirm dialog, while the affordance was wired at the
  GRID level (`onDelete={readOnly ? undefined : handleDelete}`) — one callback,
  drawn identically for every row. So a system-object row carried a delete entry
  whose click produced no dialog, no toast and no console message. That row is on
  screen by DEFAULT: `showSystemObjects` defaults to true and the component
  filters system objects out only when it is false. `readOnly` was honest in the
  same component (the callback is withheld, so nothing is drawn); `isSystem` drew
  the entry and swallowed the click. The two states differed in the code and did
  not differ on screen.
  
  **The fix.** `ObjectManager` now passes `rowOperations`, the per-row narrowing
  objectui#8674 added to `ObjectGrid`, answering `{ delete: !!obj &&
  !obj.isSystem }` for each row — the same three lines the Field Designer got.
  A system object's row no longer offers Delete at all; an unresolvable row is
  withheld too, because `handleDelete` returns early on a missed lookup and
  offering delete there would reproduce this very defect.
  
  Edit is untouched. `isSystem` disables the `name` input inside the edit form and
  has never meant "this row is untouchable", so the modal still opens for a system
  object exactly as before. The guard inside `handleDelete` also stays, as a
  second line for anyone invoking that published prop value directly — it is just
  no longer the only refusal.
  
  **Why `patch`.** No API surface moves: no prop, type, export or signature is
  added, changed or removed, and `rowOperations` is a prop `ObjectGrid` already
  published. The only user-visible change is that an entry which never did
  anything — the click was dropped before the dialog — is no longer drawn, so
  nothing a caller could have depended on stops working. This is the level the
  merged sibling repair declared for the same defect in the same package.
- a78cd37: Dates and numbers across the console and the plugins format in the session's
  display locale instead of the machine's (objectui#9909).
  
  Every one of these faces handed `Intl` — directly, or through a formatter called
  without one — either no locale tag or an explicit `undefined`, which is not "the
  user's locale": it is the locale of the machine the browser runs on, which is
  neither of this repository's two locale channels.
  A German or Spanish session therefore read, beside a translated label, a date or
  an amount grouped and decimal-marked the machine's way — and an amount with
  inverted separators does not read as unformatted, it reads as a different
  number. They now go through `useDisplayLocale()` (tenant regional default, then
  the active UI language, then `'en'`), and a plain helper takes that tag from its
  caller. The surfaces:
  
  - **`@object-ui/fields`** — `GridField`'s numeric and currency cells (list mode
    and computed columns) and both total cells. The same cell helper's date branch
    already used the display locale, so a single grid row read two conventions at
    once.
  - **`@object-ui/plugin-charts`** — ISO-date x-axis ticks, compact y-axis ticks,
    the single-value face, spec `format` strings and the tooltip value.
  - **`@object-ui/app-shell`** — the organization invitations, members and
    accept-invitation dates; marketplace version dates; the AI conversation row's
    older-than-a-week date and its tooltip; the build-debug token count; the
    record approvals timeline; and the metadata-admin audit, history, external
    datasource snapshot, schema-browser row estimate, flow-run start and job
    next-fire faces. The audit, history and flow-run panels format these in the
    DISPLAY locale, not in the `locale` prop they take for their UI strings
    (`AuditPanel` defaults that prop to `'en-US'`; `HistoryPanel` and
    `FlowRunsPanel` leave it optional).
  - **`@object-ui/console`** — the approvals inbox's timestamp tooltips, amounts
    and payload summary; the audit log's timestamp column; the flow runs table and
    its run detail.
  - **`@object-ui/components`** — the export dialog's record counts and the debug
    panel's event times.
  - **`@object-ui/plugin-form`** — the analytics submission count, the
    master-detail subtotal / tax / total stack and the edit-conflict dialog's
    "their save" time.
  - **`@object-ui/plugin-chatbot`** — the approvals inbox's past-30-days date and
    the times stamped on local-mode chat messages (the user's and the
    auto-response).
  - **`@object-ui/plugin-dashboard`** — the record-count badge, and the currency
    and date-format branches of `renderFieldValue`, which was handed the display
    locale and spent it only on its percent branch.
  - **`@object-ui/plugin-grid`** — the record-detail panel's inferred currency
    value and the mobile card's amount line, siblings of date cells already on the
    display locale.
  - **`@object-ui/plugin-designer`** — `VersionHistory`'s version times.
  
  A host that mounts one of the components that newly read the display locale with
  NO `I18nProvider` now gets react-i18next's once-per-module `NO_I18NEXT_INSTANCE`
  notice in the console on the first such mount; the faces still render, in the
  channel's `'en'` last resort, and mounting an `I18nProvider` (as the console
  does) avoids the notice.
  
  **Additive API** (nothing that compiled before stops compiling):
  
  - `@object-ui/types`: `ValidationContext` gains an optional `locale`. At this
    change, the `@object-ui/core` validation engine prints the `date_min` /
    `date_max` bound in it; omitted, `Intl` follows the runtime default, as
    `formatDisplayNumber` already declares for a caller with no locale in hand.
  
    ⚠️ **Dated note, 2026-09-25 — that engine (`ValidationEngine`) is removed from
    `@object-ui/core` by a later change; `ValidationContext.locale` stays declared in
    `@object-ui/types`, and at that change nothing in `@object-ui/core` reads it —
    objectui#7659.**
  
    ⚠️ **Dated note, 2026-09-27 — `ValidationContext` itself is removed from
    `@object-ui/types` by a later change, with the rest of the Phase 3.5
    validation types it belonged to, so the `locale` member this entry adds no
    longer exists — objectui#10719.**
  - `@object-ui/plugin-report`: `exportReport`, `exportAsHTML` and `exportAsPDF`
    take a trailing optional `locale` for the exported file's "Generated:" time,
    and `LiveExportOptions` gains an optional `locale` that `exportWithLiveData`
    forwards. Omitted, the time uses the display channel's own last resort
    (`'en'`), never the machine's locale. `ReportViewer` passes the session's
    display locale. The locale is deliberately NOT a `ReportExportConfig` member:
    that type is authored report metadata, and a display locale belongs to the
    session.
  
  **One census, repository-wide.** `plugin-detail`'s machine-locale census pin
  (objectui#9786) is now a single test, `machineLocaleCensus-9909.test.ts` in
  `@object-ui/i18n`, covering every workspace package whose manifest depends on
  `@object-ui/i18n`. It refuses any call site that passes nothing, `undefined`,
  the `'default'` pseudo-tag (a subtag no locale data answers, so `Intl` resolves
  it to the machine's locale) or a hard-coded tag, unless the site is declared
  with its reason — for example the `catch` fallback for a tag `Intl` itself
  rejected, or an ISO formatter feeding `<input type="date">`. Each declared site
  is counted exactly, so deleting one without its entry is refused too. The
  per-package pin it replaces is deleted. The runtime tripwire that observes the
  argument each locale-taking call (`Intl` constructors, `Date` and `Number`
  `toLocale*`) actually receives moved into the private `@object-ui/test-support`
  package, and every surface above is pinned with it: the same data under two
  declared locales must render differently, NO locale-taking call may receive the
  machine's locale (nothing, `undefined` or `'default'`), and the surface's own
  calls must receive the declared tag. A call carrying another declared tag, such
  as the `'en'` of the session's UI language, is tolerated by design: only the
  machine's locale is the defect.
- 4db5989: A widget title stored as an inline per-locale map is editable again in both dashboard
  authoring surfaces, and a save writes back only the active locale's entry
  (objectui#5428).
  
  `@objectstack/spec` widened `I18nLabel` from `string` to `string | Record` at
  17.0.0-rc.6, so a stored widget title may be an inline per-locale map while both
  authoring panels edit a title in ONE single-line input. Writing the input's value back
  as the whole value would collapse every other locale on the first keystroke, so both
  surfaces took the same conservative branch: show a map-valued title resolved, and make
  it READ-ONLY.
  
  That branch could not lose data, but it rested on a premise the spec had already
  invalidated — "nothing can reach this path from stored metadata yet, `I18nLabel` was
  plain `string` through rc.5" — stated sixty lines below a comment in the same file
  documenting the rc.6 widening that makes a stored map reachable. Both could not hold.
  The pinned spec is 17.0.0. What the read-only branch did in practice from rc.6 onward
  was not protect an unreachable path: it denied an author the ability to edit a widget
  title in their own locale.
  
  objectui#5301's maintainer ruling settled the write rule for the sibling surface — a
  save replaces only the active locale's entry and preserves the others — and
  `@object-ui/i18n` ships it as `setLocalized`, co-located with `pickLocalized` because
  the read and the write have to agree. Both panels now adopt it:
  
  - `@object-ui/plugin-designer`'s `DashboardEditor` widget property panel;
  - `@object-ui/app-shell`'s `DashboardWidgetInspector` in metadata-admin.
  
  A plain-string title keeps saving as a plain string, so the common path is unchanged.
  An edit made in a locale the stored map does not carry ADDS an entry under that locale
  rather than overwriting the entry the display fell back to.
  
  The pins are preservation pins, not "the input is editable" pins: at both surfaces a
  keystroke on a map-valued title must leave every other locale's entry byte-identical.
  Reverse-verified by mutating each write back to the flattening form and confirming those
  assertions go red at both surfaces.
  
  Not a multi-locale editor: an author still reaches only the entry for the locale they
  are in. Authoring every locale from one panel remains an open product question. The
  stale deferrals both comments carried pointed at objectui#4163, which closed as
  completed on 2026-08-15 while the placeholders were still in the tree; they are replaced
  with the rule that is actually in force rather than re-pointed at another tracker.
- f7e34ca: Close the dashboard widget `type` vocabulary, and admit `metric-card` as objectui's own component extension.
  
  `DashboardWidgetSchema.type` was `string` on the TypeScript interface and `z.string()` in the Zod twin — an unbounded hatch. A typo'd family, a chart type the spec retired, and a component type nothing registers all type-checked and validated, surfacing only as the renderer's red `OBJUI-001` panel at runtime.
  
  It is now the CLOSED `DashboardWidgetTypeName` / `DashboardWidgetTypeSchema`: the spec's own `ChartTypeSchema` families **by reference**, plus two named, closed objectui extension sets — `DASHBOARD_WIDGET_TYPE_EXTENSIONS` (`list`, `custom`: objectui-only widget families) and `DASHBOARD_COMPONENT_WIDGET_TYPES` (`metric-card`: an objectui SDUI **component** type the widget slot holds directly, per the maintainer ruling of 2026-08-14 — objectui's own component enum, explicitly not the spec widget enum).
  
  Three drifts the closure surfaced and this change fixes: the dashboard designer's palette offered `grid`, which is not a widget family in either contract and was refused at publish; the metadata-admin widget inspector and the designer both wrote an unvalidated `string` from their select boxes; and a `@object-ui/types` fixture pinned `bar-chart`, a `plugin-charts` component type, on a dataset-bound widget that could never render as one.
  
  ⚠️ **Dated note, 2026-10-02 — `metric-card` is no widget type — objectui#11483.** At this change, `DashboardWidgetTypeName` / `DashboardWidgetTypeSchema` were the spec's families plus two objectui sets, `DASHBOARD_WIDGET_TYPE_EXTENSIONS` and `DASHBOARD_COMPONENT_WIDGET_TYPES`; now they are the spec's families plus `DASHBOARD_WIDGET_TYPE_EXTENSIONS` only. A `metric-card` in the widget slot is read by the slot's component arm alone, which requires its `value`. `DASHBOARD_COMPONENT_WIDGET_TYPES` still lists `metric-card` as that arm's `type`, and `DashboardWidgetSchema['type']` on the TypeScript face still reads it. `.changeset/11483-metric-card-needs-value.md` states what ships. The rest of this entry is kept as the reading of this change.
  
  ⚠️ **Dated note, 2026-10-03 — the TypeScript widget arm no longer reads `metric-card` — objectui#11514.** At the 2026-10-02 note above, `DashboardWidgetSchema['type']` on the TypeScript face still read `metric-card`, because that interface was the read type of every `widgets[]` entry. Now it is `DashboardWidgetTypeName` alone: an entry is read by the slot's element type, and only the component arm names `metric-card`. `.changeset/11514-types-widget-arm-type.md` states what ships. The rest of this entry is kept as the reading of this change.
- fb336df: Move `lucide-react` from `^1.31.0` to `^1.43.0` in every package that declares it, and
  repair what the jump breaks, so icons resolved from a STRING keep drawing a glyph.
  
  Measured once against the installed 1.43.0 artifact when this change was made; nothing in
  the repository re-derives these readings. Across the jump lucide removes no runtime export,
  no public type name and no `lucide-react/dynamic.mjs` name, and every name this repository
  imports from `lucide-react` resolves. Exactly one key leaves the runtime `icons` record:
  `Trash2`, retired in favour of `trash`.
  
  What a user sees change:
  
  - Icons the lazy icon seam draws (`resolveIcon`, objectui#9251) get their path data again.
    lucide 1.43.0 icon modules export their path data inside `__iconData` and no longer
    export `__iconNode`; the seam now reads both. Reading only `__iconNode` against 1.43.0
    leaves every such glyph an empty box, with nothing thrown or logged.
  - `DetailView`'s delete action and three schema-catalog examples spell their icon
    `trash`, not `trash-2`, so they keep resolving. The glyph is unchanged: 1.43.0's `trash`
    path data is byte-identical to the `trash-2` path data of 1.31.0 and 1.35.0. Anything
    that already authored `trash` now draws that same artwork, because lucide moved it under
    the `trash` name; a few other glyphs were also redrawn upstream.
  - Icons imported as COMPONENTS carry lucide 1.43.0's own classes: one class per declared
    alias (a spinner renders `class="lucide lucide-loader-circle lucide-loader-2 ..."`), and
    no longer the class lucide used to derive from the PascalCase key where that differs
    (`ArrowDown01` no longer carries `lucide-arrow-down01`). The canonical
    `lucide-<icon name>` class is still there, so a `.lucide-loader-circle` selector still
    matches.
  - Icons resolved from a STRING through the seam keep the classes they had: `lucide`, the
    canonical `lucide-<icon name>` class and the key-derived class. They do not carry
    lucide's per-alias classes. That is a maintainer ruling (objectui#8941, option C): the
    alias list lives only inside each lazily loaded icon module, and it was not moved into
    the eager name list. A selector that targets an alias class matches a component-imported
    icon and not a string-resolved one. This also dates the example in the objectui#9251
    entry: `trash-2` no longer resolves as a string, so no seam-drawn glyph carries
    `lucide-trash2 lucide-trash-2`; a digit-bearing name that still resolves, such as
    `arrow-down-0-1`, carries `lucide-arrow-down01 lucide-arrow-down-0-1`.
- 93127bd: Keep a relationship target stored only as the retired `referenceTo` spelling (objectui#8896)
  
  Two field-IO sites deleted the retired `referenceTo` key without keeping its
  value, so an object whose lookup or master-detail target survived only under the
  pre-objectui#6041 spelling lost the target on the way through:
  
  - The Field Designer's carried-through half (fields whose stored type the
    designer cannot author, `7dc31bb8d`) re-emits the stored document verbatim
    with no read door in front of it. The strip took the target and the relationship
    guard then refused the whole object's save — including a save the author
    triggered by editing an entirely different field, on a page that renders the
    offending field read-only, so its "Pick the target object" advice named a
    control that does not exist there.
  - The object designer's single read door for `draft.fields` deleted the target on
    load, leaving the target editor empty and committing the loss on the next save.
  
  Both sites now lift the value onto the spec spelling `reference` before dropping
  the retired key. The retired key still never reaches the wire, a live `reference`
  is never overwritten by a stale legacy value, and a field with no usable target
  under either spelling is still refused.
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [a507334]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [afb2284]
- Updated dependencies [3759c56]
- Updated dependencies [cd7b728]
- Updated dependencies [3ac2de8]
- Updated dependencies [0aacecc]
- Updated dependencies [63f4f92]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [142fdfd]
- Updated dependencies [7b395d8]
- Updated dependencies [185079b]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [162621b]
- Updated dependencies [e026e15]
- Updated dependencies [4c6f549]
- Updated dependencies [80c5412]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [b809375]
- Updated dependencies [6099dd8]
- Updated dependencies [e686f4d]
- Updated dependencies [a04b06d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [fa5fbd9]
- Updated dependencies [d6a1a80]
- Updated dependencies [88a4ef6]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [9ec8ceb]
- Updated dependencies [0651e7a]
- Updated dependencies [bb5d4ee]
- Updated dependencies [dc666f7]
- Updated dependencies [3335767]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [d5cb261]
- Updated dependencies [cff4b77]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [1dbb993]
- Updated dependencies [2b5f509]
- Updated dependencies [808f339]
- Updated dependencies [6cf5999]
- Updated dependencies [274e14a]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [544aca2]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [86982ac]
- Updated dependencies [cdefa2a]
- Updated dependencies [c3025ea]
- Updated dependencies [0961d5e]
- Updated dependencies [6276478]
- Updated dependencies [5e67837]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [09ab32b]
- Updated dependencies [8acc51b]
- Updated dependencies [ea9d17f]
- Updated dependencies [cc139d8]
- Updated dependencies [45362a3]
- Updated dependencies [2a943bf]
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [8740e86]
- Updated dependencies [6ea68e6]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [cc07476]
- Updated dependencies [f99f9cd]
- Updated dependencies [ac2d6f1]
- Updated dependencies [4a3d500]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [0c3f70a]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [41dcbd5]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [5c61e52]
- Updated dependencies [f905090]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [1ea21c4]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [ee6f6c6]
- Updated dependencies [b526480]
- Updated dependencies [5ad3b88]
- Updated dependencies [be0ad00]
- Updated dependencies [f9d772b]
- Updated dependencies [bf14b64]
- Updated dependencies [4345558]
- Updated dependencies [704e05b]
- Updated dependencies [97b6c21]
- Updated dependencies [c58b8e4]
- Updated dependencies [26ca2ad]
- Updated dependencies [cf00ea8]
- Updated dependencies [41ae65b]
- Updated dependencies [baac95a]
- Updated dependencies [0896838]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [f812f37]
- Updated dependencies [b32e7de]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [c5ec15c]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [ed76b1b]
- Updated dependencies [30b11ad]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [3d6badf]
- Updated dependencies [25cb364]
- Updated dependencies [a60539b]
- Updated dependencies [de1b879]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [ad1785c]
- Updated dependencies [3b469c8]
- Updated dependencies [e3782d2]
- Updated dependencies [990a2d6]
- Updated dependencies [37140f4]
- Updated dependencies [37140f4]
- Updated dependencies [ad1785c]
- Updated dependencies [1c84036]
- Updated dependencies [1c84036]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [9e6619f]
- Updated dependencies [f6ae5e2]
- Updated dependencies [eb97ce6]
- Updated dependencies [7343376]
- Updated dependencies [b2683a2]
- Updated dependencies [dded788]
- Updated dependencies [b45d463]
- Updated dependencies [54a7830]
- Updated dependencies [f3135a4]
- Updated dependencies [b5696d3]
- Updated dependencies [3f9d926]
- Updated dependencies [e978ed5]
- Updated dependencies [6a7f24e]
- Updated dependencies [b3c96d6]
- Updated dependencies [8d0ca91]
- Updated dependencies [c30c8dd]
- Updated dependencies [244d516]
- Updated dependencies [deca847]
- Updated dependencies [ac15833]
- Updated dependencies [ac15833]
- Updated dependencies [e2dffc9]
- Updated dependencies [328abeb]
- Updated dependencies [dd0d78f]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [e227156]
- Updated dependencies [cc4e476]
- Updated dependencies [8aa68b1]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [4b742f4]
- Updated dependencies [42687ba]
- Updated dependencies [6cd8f66]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [27ae632]
- Updated dependencies [0bc5c5a]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [e327c89]
- Updated dependencies [2eaf5be]
- Updated dependencies [bf7ab35]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
- Updated dependencies [7e4fa1b]
- Updated dependencies [d0ae5d0]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [51c2949]
- Updated dependencies [a4b017e]
- Updated dependencies [8732846]
- Updated dependencies [559a2e2]
- Updated dependencies [db11afd]
- Updated dependencies [154075a]
- Updated dependencies [582edef]
- Updated dependencies [19f484f]
- Updated dependencies [0a78a20]
- Updated dependencies [615346d]
- Updated dependencies [75dcc81]
- Updated dependencies [55a12a8]
- Updated dependencies [edfcf5a]
- Updated dependencies [0a3e540]
- Updated dependencies [c021b35]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [54997ff]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [1d6a23d]
- Updated dependencies [0645133]
- Updated dependencies [76e9df0]
- Updated dependencies [0ecaa7d]
- Updated dependencies [b24f93a]
- Updated dependencies [6158e4c]
- Updated dependencies [cff8641]
- Updated dependencies [3100bef]
- Updated dependencies [c27b575]
- Updated dependencies [3fa1938]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [385ebc5]
- Updated dependencies [1923d35]
- Updated dependencies [858eafb]
- Updated dependencies [263dcd7]
- Updated dependencies [a8c5509]
- Updated dependencies [c2a8d23]
- Updated dependencies [0ffc423]
- Updated dependencies [3cc4fe5]
- Updated dependencies [cd5b19a]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [2e3da72]
- Updated dependencies [1263e40]
- Updated dependencies [e6bc087]
- Updated dependencies [1ccb5ba]
- Updated dependencies [9419df1]
- Updated dependencies [c18a075]
- Updated dependencies [8bab157]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [18d1a0a]
- Updated dependencies [7fed09d]
- Updated dependencies [1563d3e]
- Updated dependencies [b149617]
- Updated dependencies [58da8ae]
- Updated dependencies [a8b9889]
- Updated dependencies [138ad45]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [6aa029b]
- Updated dependencies [2124d04]
- Updated dependencies [be52115]
- Updated dependencies [be52115]
- Updated dependencies [770cc5b]
- Updated dependencies [770cc5b]
- Updated dependencies [d893290]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [5638529]
- Updated dependencies [5638529]
- Updated dependencies [d0fba91]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [063119f]
- Updated dependencies [5ad9f5d]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [f9c8c4e]
- Updated dependencies [6e9c8d2]
- Updated dependencies [7728c67]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [55d18c6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [c4ab6d0]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [9d1c0bf]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [50c73fe]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
- Updated dependencies [f560ded]
- Updated dependencies [2b188fa]
- Updated dependencies [b654d4e]
- Updated dependencies [f68e0a0]
- Updated dependencies [aea682a]
- Updated dependencies [fcdc8ec]
- Updated dependencies [fcdc8ec]
- Updated dependencies [2d576e4]
- Updated dependencies [8366acc]
- Updated dependencies [95e58a3]
- Updated dependencies [9d7419b]
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [072b7e8]
- Updated dependencies [b0bf413]
- Updated dependencies [dbd1081]
- Updated dependencies [2f54dca]
- Updated dependencies [d0097af]
- Updated dependencies [9c74902]
- Updated dependencies [432882b]
- Updated dependencies [64dae8e]
- Updated dependencies [b06e374]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [5ccc500]
- Updated dependencies [f3c2bb0]
- Updated dependencies [978507b]
- Updated dependencies [778138e]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [460575f]
- Updated dependencies [d796c8d]
- Updated dependencies [594704f]
- Updated dependencies [d3995fe]
- Updated dependencies [1b1d772]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [062943f]
- Updated dependencies [993f312]
- Updated dependencies [636b236]
- Updated dependencies [4172589]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [41b7ce3]
- Updated dependencies [ae476b8]
- Updated dependencies [67a87d9]
- Updated dependencies [39f4309]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [7cd3987]
- Updated dependencies [ee3b878]
- Updated dependencies [e304a4e]
- Updated dependencies [fda49e5]
- Updated dependencies [94e2fa7]
- Updated dependencies [490d9a9]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [3e853c9]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [95f8704]
- Updated dependencies [f8cdbf2]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [e176053]
- Updated dependencies [e30ed15]
- Updated dependencies [17ccec9]
- Updated dependencies [90665e0]
- Updated dependencies [8d3a529]
- Updated dependencies [5ac2e2c]
- Updated dependencies [194fae1]
- Updated dependencies [7e19d03]
- Updated dependencies [beccf1c]
- Updated dependencies [b08b7eb]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [7a72422]
- Updated dependencies [44d075b]
- Updated dependencies [40c479a]
- Updated dependencies [5173a5e]
- Updated dependencies [971d387]
- Updated dependencies [ee851c3]
- Updated dependencies [6414dfd]
- Updated dependencies [a8d5c71]
- Updated dependencies [905b21f]
- Updated dependencies [88e9109]
- Updated dependencies [2c45966]
- Updated dependencies [db3a600]
- Updated dependencies [3a3db76]
- Updated dependencies [0d723a3]
- Updated dependencies [0c95d3d]
- Updated dependencies [3e4fa2c]
- Updated dependencies [b5b928a]
- Updated dependencies [6fd2cf7]
- Updated dependencies [5fa06c4]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [129bcc5]
- Updated dependencies [c9a7252]
- Updated dependencies [5f19b92]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [e0b289d]
- Updated dependencies [46f0bb4]
- Updated dependencies [2da6441]
- Updated dependencies [3b9c774]
- Updated dependencies [06b82b8]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
- Updated dependencies [f8c70f4]
- Updated dependencies [5d3a2d1]
- Updated dependencies [c38162d]
- Updated dependencies [8f1d995]
- Updated dependencies [b362c1b]
- Updated dependencies [5127378]
- Updated dependencies [f9c34df]
- Updated dependencies [dddb942]
- Updated dependencies [00c665e]
- Updated dependencies [29754cf]
- Updated dependencies [d7de534]
- Updated dependencies [3c2b6f7]
- Updated dependencies [6e88630]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [1c19722]
- Updated dependencies [5961030]
- Updated dependencies [faa863d]
- Updated dependencies [fd814d6]
- Updated dependencies [f24de8b]
- Updated dependencies [c8ea8af]
- Updated dependencies [9602dc8]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [30c73cd]
- Updated dependencies [c4987fb]
- Updated dependencies [f55d666]
- Updated dependencies [f241a4d]
- Updated dependencies [830ed58]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [c71e14d]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [748494b]
- Updated dependencies [5967be0]
- Updated dependencies [831be72]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [d0889e2]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [12402a9]
- Updated dependencies [aff3d7a]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [fff9645]
- Updated dependencies [9c3b7ce]
- Updated dependencies [2c1c967]
- Updated dependencies [9486ac6]
- Updated dependencies [9486ac6]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [dc4365c]
- Updated dependencies [e321d52]
- Updated dependencies [969ba84]
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [4ac3769]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [19f3637]
- Updated dependencies [9bd08fe]
- Updated dependencies [b97790a]
- Updated dependencies [dbd5194]
- Updated dependencies [7c9b044]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [b392674]
- Updated dependencies [4f3a1e2]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [26896c6]
- Updated dependencies [67fc3b0]
- Updated dependencies [fab4802]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [f07b976]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [adb2a86]
- Updated dependencies [503cd8b]
- Updated dependencies [03380aa]
- Updated dependencies [d9a0490]
- Updated dependencies [f9984c0]
- Updated dependencies [9700dd9]
- Updated dependencies [4562ea5]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [320374d]
- Updated dependencies [b0d308d]
- Updated dependencies [1349400]
- Updated dependencies [40f34b4]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [ce986aa]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [512bc90]
- Updated dependencies [a29ae2d]
- Updated dependencies [220c18d]
- Updated dependencies [00d3f09]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [3cab570]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [639114c]
- Updated dependencies [639114c]
- Updated dependencies [1490691]
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
- Updated dependencies [78ca238]
- Updated dependencies [d8ec8d6]
- Updated dependencies [351eb31]
- Updated dependencies [866cd1d]
- Updated dependencies [20c04b2]
- Updated dependencies [84ffdbc]
- Updated dependencies [a276480]
- Updated dependencies [01c9023]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [4b5bb95]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [8952395]
- Updated dependencies [e2b3826]
- Updated dependencies [0348bc9]
- Updated dependencies [e8c553b]
- Updated dependencies [2e32ed4]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [67dadd6]
- Updated dependencies [e21308e]
- Updated dependencies [a4514e8]
- Updated dependencies [db3896c]
- Updated dependencies [b9f5ff1]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [4704aa4]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [63a8828]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [72f55c9]
- Updated dependencies [26e06d7]
- Updated dependencies [669d71b]
- Updated dependencies [6a99bb2]
- Updated dependencies [2d3fe73]
- Updated dependencies [ed27d7c]
- Updated dependencies [7dedec6]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [0809f8a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [3399704]
- Updated dependencies [71a4a53]
- Updated dependencies [7bf244b]
- Updated dependencies [f0bb9fa]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [caa0cd3]
- Updated dependencies [20cb8db]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [77b2a18]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [c2f0f48]
- Updated dependencies [1237ae4]
- Updated dependencies [2f61238]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [9ae871d]
- Updated dependencies [efbd566]
- Updated dependencies [2a5bf45]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [daf9d57]
- Updated dependencies [23b9958]
- Updated dependencies [c15d7ec]
- Updated dependencies [5d0876c]
- Updated dependencies [f7ace0a]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [544ecba]
- Updated dependencies [2ce2612]
- Updated dependencies [bc640ec]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [aef97e5]
- Updated dependencies [2af1fa7]
- Updated dependencies [c14d3a0]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [c907a9c]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [91f9276]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [a915064]
- Updated dependencies [dcbf0b2]
- Updated dependencies [52cac38]
- Updated dependencies [93fea2e]
- Updated dependencies [53ded82]
- Updated dependencies [1422a92]
- Updated dependencies [d05fe17]
- Updated dependencies [a480f79]
- Updated dependencies [f08d1a8]
- Updated dependencies [64a252d]
- Updated dependencies [786bc91]
- Updated dependencies [75fca96]
- Updated dependencies [7ca6ddd]
- Updated dependencies [f1cd290]
- Updated dependencies [5a41ce7]
- Updated dependencies [8d50bc2]
- Updated dependencies [604476d]
- Updated dependencies [d1bebb0]
- Updated dependencies [95bf128]
- Updated dependencies [335abea]
- Updated dependencies [edea22a]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [e1c27e4]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [f57ca75]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [a695f50]
- Updated dependencies [fc32921]
- Updated dependencies [4eaa835]
- Updated dependencies [8f9d87a]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [f4abff4]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [6e9a3d4]
- Updated dependencies [4a292d2]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [846cec0]
- Updated dependencies [91facae]
- Updated dependencies [b38014e]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [309728c]
- Updated dependencies [c03d03b]
- Updated dependencies [aa08d7e]
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [40a7c53]
- Updated dependencies [abc1b18]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [270f282]
- Updated dependencies [512c84b]
- Updated dependencies [c300267]
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
- Updated dependencies [7c9145f]
- Updated dependencies [1570eac]
- Updated dependencies [f391ede]
- Updated dependencies [f5cfbbd]
- Updated dependencies [f5cfbbd]
- Updated dependencies [8b532cb]
- Updated dependencies [64c3cdd]
- Updated dependencies [4d65991]
- Updated dependencies [c42554e]
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [0a174f3]
- Updated dependencies [676f677]
- Updated dependencies [0febe1a]
- Updated dependencies [6fda1a9]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [c5c0e2a]
- Updated dependencies [9662aca]
- Updated dependencies [55ba3ff]
- Updated dependencies [baf3776]
- Updated dependencies [c489260]
- Updated dependencies [f1190b0]
- Updated dependencies [8fda009]
- Updated dependencies [fd9bf26]
- Updated dependencies [561abef]
- Updated dependencies [ef52001]
- Updated dependencies [b8a0068]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [c5faf06]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [60e1f80]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [bbf068d]
- Updated dependencies [e82dad1]
- Updated dependencies [58b7b3d]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [358aff8]
- Updated dependencies [f3bc481]
- Updated dependencies [b79aac2]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [19a0b0e]
- Updated dependencies [526fc11]
- Updated dependencies [f8e3e9a]
- Updated dependencies [b9d47ec]
- Updated dependencies [3b6bc69]
- Updated dependencies [6214db6]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [0b8c638]
- Updated dependencies [804831c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [689953a]
- Updated dependencies [30443fb]
- Updated dependencies [8d3dbb2]
- Updated dependencies [efc1c9c]
- Updated dependencies [da45e6b]
- Updated dependencies [7533465]
- Updated dependencies [835f0f3]
- Updated dependencies [a9d97be]
- Updated dependencies [ed35b44]
- Updated dependencies [9ba7e9c]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [345e24a]
- Updated dependencies [20b507a]
- Updated dependencies [2e471dc]
- Updated dependencies [6748587]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [2bf34f7]
- Updated dependencies [15b33ae]
- Updated dependencies [7ec600d]
- Updated dependencies [7cbc724]
- Updated dependencies [4a94c38]
- Updated dependencies [7098eed]
- Updated dependencies [3df7c5c]
- Updated dependencies [fb91ac9]
- Updated dependencies [fb91ac9]
- Updated dependencies [641fb55]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [03370ce]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [502eb58]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [43c0d17]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
- Updated dependencies [6df9141]
- Updated dependencies [3e4f632]
- Updated dependencies [4128188]
- Updated dependencies [269880a]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [4598f6d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [44152c4]
- Updated dependencies [3939545]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [20b5e36]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [63bf47d]
- Updated dependencies [5a311a3]
- Updated dependencies [99c4eb8]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [276d174]
- Updated dependencies [19d1f24]
- Updated dependencies [8f37c4e]
- Updated dependencies [62597c5]
- Updated dependencies [2982ed9]
- Updated dependencies [741864f]
- Updated dependencies [58d65c5]
- Updated dependencies [8813335]
- Updated dependencies [509f8ed]
- Updated dependencies [de5d400]
- Updated dependencies [31d34cb]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [76f1543]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [9f7e846]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [c698a81]
- Updated dependencies [ff5ef1c]
- Updated dependencies [befd40c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [3c76801]
- Updated dependencies [b2e85a9]
- Updated dependencies [60500cb]
- Updated dependencies [d5c1f52]
- Updated dependencies [c7cd2b6]
- Updated dependencies [b2065e7]
- Updated dependencies [2fcefb9]
- Updated dependencies [77f846a]
- Updated dependencies [bc5870c]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [f760064]
- Updated dependencies [dd19463]
- Updated dependencies [6791717]
- Updated dependencies [8ea3bee]
- Updated dependencies [100547e]
- Updated dependencies [3a58149]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [2c8474c]
- Updated dependencies [6ce89da]
- Updated dependencies [0e05aac]
- Updated dependencies [ae61ad4]
- Updated dependencies [5aed9e4]
- Updated dependencies [83c77dc]
- Updated dependencies [3c9fca3]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [b470e91]
- Updated dependencies [fe76ece]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [7102b20]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [c40f3b8]
- Updated dependencies [58770f3]
- Updated dependencies [aefe428]
- Updated dependencies [485f096]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [9e22085]
- Updated dependencies [b655a9d]
- Updated dependencies [8e67cc4]
- Updated dependencies [c574dfb]
- Updated dependencies [02f48b6]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [6a576c9]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [c269ed9]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [fffa30d]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [9d9040d]
- Updated dependencies [20e317c]
- Updated dependencies [425762e]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [8e00bfd]
- Updated dependencies [8d37efb]
- Updated dependencies [584eeca]
- Updated dependencies [0e2ddd4]
- Updated dependencies [73a3c89]
- Updated dependencies [b7479ab]
- Updated dependencies [9850c6e]
- Updated dependencies [9118a31]
- Updated dependencies [de570cc]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [19cbf10]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [1e66879]
- Updated dependencies [c5200f0]
- Updated dependencies [af3861f]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [83ec618]
- Updated dependencies [4f14ad7]
- Updated dependencies [7b43319]
- Updated dependencies [258d264]
- Updated dependencies [4d963a2]
- Updated dependencies [cac64b3]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [c00bf28]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [fd8dace]
- Updated dependencies [72ffc34]
- Updated dependencies [a51fa0c]
- Updated dependencies [51f3d8d]
- Updated dependencies [bf28341]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [42887e0]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [591bf27]
- Updated dependencies [38a9568]
- Updated dependencies [f90b8fb]
- Updated dependencies [91783c4]
- Updated dependencies [982885d]
- Updated dependencies [dba7d84]
- Updated dependencies [ca39427]
- Updated dependencies [43ca9d5]
- Updated dependencies [bd09957]
- Updated dependencies [5a07e67]
- Updated dependencies [2d36552]
- Updated dependencies [45d8288]
- Updated dependencies [b2437a7]
- Updated dependencies [f157423]
- Updated dependencies [7a90afd]
- Updated dependencies [ba306e3]
- Updated dependencies [eddc1dd]
- Updated dependencies [490f482]
- Updated dependencies [27308c5]
- Updated dependencies [8689166]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [26a2238]
- Updated dependencies [9101be5]
- Updated dependencies [f53a8d0]
- Updated dependencies [5d79faf]
- Updated dependencies [968dc1e]
- Updated dependencies [57f9b07]
- Updated dependencies [3c73d99]
- Updated dependencies [d91aed9]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [c86185e]
- Updated dependencies [fb96ecb]
- Updated dependencies [1170ed1]
- Updated dependencies [f75810e]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/i18n@17.7.0
  - @object-ui/components@17.7.0
  - @object-ui/plugin-grid@17.7.0
  - @object-ui/layout@17.7.0
  - @object-ui/plugin-form@17.7.0
  - @object-ui/data-objectstack@17.7.0

## 17.6.0

### Minor Changes

- deb157a: Retire the field designer's `Indexed` toggle — the ObjectStack spec has no
  field-level index flag
  
  `indexed` was never a `FieldSchema` key. The field-level flag built no index
  (objectstack#2377 removed it) and, since objectstack#4001 replaced silent
  drops with loud rejection, `FieldSchema.safeParse` refuses it by name. Ticking
  `Indexed` in Studio therefore made `PUT /api/v1/meta/object/:name` fail with
  `422 INVALID_METADATA`, and — because the key was stored — every later save of
  that object stayed blocked until the author found and cleared the toggle.
  
  Both field designers stop offering the control and stop authoring the key
  (`ObjectFieldInspector`'s Advanced section; `FieldDesigner`'s advanced
  section, `MetadataFieldsPage`, `MetadataService`, `metadataConverters`), the
  `designer.field.indexed` / `appDesigner.fieldDesigner.indexed` labels retire
  with it across all ten locale packs, and `DesignerFieldDefinition.indexed` is
  removed from `@object-ui/types`.
  
  Drafts and objects that already carry the key are un-poisoned on load rather
  than migrated, so an edit-and-save round-trip of previously blocked metadata
  now succeeds. The strip is keyed to the retired key alone — every other
  unknown key on a field definition still survives the round-trip.
  
  Declare indexes on the object instead: `indexes: [{ name, fields, unique }]`.

### Patch Changes

- ad07b65: Four packages stop publishing tooling material in their `dist/`
  
  Each of these packages spelled its build exclusions as `*.test.*`, while this repo's tooling convention is a directory one — `__tests__` / `__mocks__` / `__benchmarks__`, exactly as `TOOLING_FILE` in `scripts/check-phantom-dependencies.mjs` spells it. Any tooling file whose *name* is not `*.test.*` therefore stayed in the emit program and shipped in the tarball. This is the same shape and the same cause as objectui#4006, which fixed `@object-ui/fields` and `@object-ui/plugin-editor` by the filename criterion and so did not reach these four.
  
  Measured by building each package from a cleared `dist/` on both sides of the change. Nine files disappear, none appears, and every surviving file is untouched — the totals move by exactly the count removed:
  
  | package | `dist/` files | removed |
  | --- | --- | --- |
  | `@object-ui/core` | 176 to 174 | `dist/__benchmarks__/core.bench.js`, `core.bench.d.ts` |
  | `@object-ui/plugin-designer` | 70 to 66 | `dist/__tests__/__mocks__/plugin-form.d.ts`, `plugin-grid.d.ts`, and both `.d.ts.map` |
  | `@object-ui/plugin-grid` | 62 to 60 | `dist/__tests__/explainDouble.d.ts` and its `.d.ts.map` |
  | `@object-ui/plugin-view` | 13 to 12 | `dist/__tests__/explainDouble.d.ts` |
  
  Only `@object-ui/core`'s had runtime weight. The other eight are declarations nothing resolves, but `core.bench.js` is a real emitted module whose first import is `import { bench, describe } from 'vitest'` — a runtime import of a package a consumer never installs, since `vitest` is a devDependency of `@object-ui/core` and devDependencies are not installed transitively. Nothing resolves it today either (it is not in the `exports` map), so no consumer breaks in either direction; this is the tarball shedding files nothing reached.
  
  No type coverage leaves with the emit. The three plugins' helper and mock files are already program inputs of the `tsconfig.test.json` that each package's `type-check` chains, reached through the imports in the suites beside them — `tsc --listFiles` names all four files on both sides of the change. `core.bench.ts` had no such edge, since nothing imports a benchmark, so it is now named explicitly in `packages/core/tsconfig.test.json`. That move was deliberate rather than forced: `scripts/check-type-check-coverage.mjs` enumerates `*.test.ts(x)` only, so a benchmark that no program reads is invisible to it, and dropping the coverage silently would have been the "coverage that was right by accident" objectui#4006 recorded. Verified by appending a provably-false annotation to the benchmark, which turns `tsc -p packages/core/tsconfig.test.json` red at exit 2.
- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
- Updated dependencies [a09bc33]
- Updated dependencies [feb6b16]
- Updated dependencies [460c4d0]
- Updated dependencies [0ae27f7]
- Updated dependencies [9aecabe]
- Updated dependencies [2533ec5]
- Updated dependencies [78c0f9a]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [2e82ab2]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [ef0d150]
- Updated dependencies [1ef236e]
- Updated dependencies [f34226e]
- Updated dependencies [564b605]
- Updated dependencies [e1d4251]
- Updated dependencies [40d3a33]
- Updated dependencies [9b20dea]
- Updated dependencies [469b604]
- Updated dependencies [8b9dc62]
- Updated dependencies [d7be3bd]
- Updated dependencies [a954b48]
- Updated dependencies [bda9b12]
- Updated dependencies [e354dd0]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [65e88e6]
- Updated dependencies [a1609a6]
- Updated dependencies [53f23bc]
- Updated dependencies [c4533dc]
- Updated dependencies [be60815]
- Updated dependencies [37f6844]
- Updated dependencies [93de4f6]
- Updated dependencies [2b50261]
- Updated dependencies [384f30d]
- Updated dependencies [ac600e5]
- Updated dependencies [97fba31]
- Updated dependencies [232f61a]
- Updated dependencies [f68018d]
- Updated dependencies [d374caf]
- Updated dependencies [5673576]
- Updated dependencies [c1ef923]
- Updated dependencies [911ceaa]
- Updated dependencies [98eab36]
- Updated dependencies [375efb4]
- Updated dependencies [af5e292]
- Updated dependencies [3fbbea1]
- Updated dependencies [0bffb18]
- Updated dependencies [3e0214c]
- Updated dependencies [800f455]
- Updated dependencies [dbbd38a]
- Updated dependencies [27c9cbd]
- Updated dependencies [5458414]
- Updated dependencies [3241559]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [cf4f8a6]
- Updated dependencies [616a2a5]
- Updated dependencies [6c68b13]
- Updated dependencies [0046d8f]
- Updated dependencies [3b03704]
- Updated dependencies [f1d4748]
- Updated dependencies [bea374e]
- Updated dependencies [b1119ec]
- Updated dependencies [5607092]
- Updated dependencies [9f23d2b]
- Updated dependencies [b4089be]
- Updated dependencies [578e025]
- Updated dependencies [b4bccc7]
- Updated dependencies [af025ee]
- Updated dependencies [d109a4d]
- Updated dependencies [3d053bb]
- Updated dependencies [598c89a]
- Updated dependencies [4a0bd17]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [958d757]
- Updated dependencies [8c0d52e]
- Updated dependencies [bfb64ee]
- Updated dependencies [e09f9e8]
- Updated dependencies [03e5f97]
- Updated dependencies [ae804ec]
- Updated dependencies [b29488f]
- Updated dependencies [9fbb9b5]
- Updated dependencies [90517e1]
- Updated dependencies [aff10e2]
- Updated dependencies [70a774b]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [7458a41]
- Updated dependencies [ad13d63]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [9c60144]
- Updated dependencies [e7747f1]
- Updated dependencies [d2ce342]
- Updated dependencies [a8411ad]
- Updated dependencies [9695da7]
- Updated dependencies [ac2f332]
- Updated dependencies [a777058]
- Updated dependencies [75444e3]
- Updated dependencies [58b8346]
- Updated dependencies [2d0bd16]
- Updated dependencies [a9e17b4]
- Updated dependencies [b8ce7dc]
- Updated dependencies [dad51e5]
- Updated dependencies [1c9c342]
- Updated dependencies [787c738]
- Updated dependencies [8396656]
- Updated dependencies [dbbd38a]
- Updated dependencies [2165d88]
- Updated dependencies [8871c14]
- Updated dependencies [93fe362]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [144ef9b]
- Updated dependencies [138ab04]
- Updated dependencies [d871f8e]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
- Updated dependencies [21e4585]
  - @object-ui/types@17.6.0
  - @object-ui/fields@17.6.0
  - @object-ui/i18n@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/plugin-grid@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0
  - @object-ui/data-objectstack@17.6.0
  - @object-ui/plugin-form@17.6.0

## 17.5.0

### Patch Changes

- d0c3b26: Every plain `<button>` now declares its `type`. HTML defaults an untyped button to
  `type="submit"`, so any of these buttons would submit the form it was composed into
  instead of running its own handler — a real risk for renderers (`drawer`, `tree-view`,
  `navigation-overlay`) whose placement inside a form is a JSON metadata decision. 114
  sites were converted to `type="button"`; no site was a genuine submit button, and the
  DOM is otherwise unchanged.

  The defect class is now closed mechanically by a new `object-ui/button-has-type` ESLint
  rule (error), so the next untyped button fails CI at write time rather than being found
  by a fourth audit round (objectui#4045, closing the objectui#3344 family).

- abb0f81: A dashboard date filter's default has one spelling again — the bare preset name — and the `{ preset }` object becomes a documented legacy alias with a retirement window

  `@objectstack/spec` 17.0.0-rc.6 added a cross-field refinement to `GlobalFilterSchema` holding a `type: 'date'` filter's `defaultValue` to three spellings: a preset NAME (`last_7_days`), an ISO date (`2026-01-15`), or a date-macro token (`{today}`). objectui's derived schema had widened `defaultValue` to `z.any()` and did not carry the refinement, so it accepted `{ preset: 'last_7_days' }` — metadata the platform refuses. That is the tolerant-consumer shape where the designer goes green and the save fails server-side, and it is now closed: the refinement is adopted, the widening is retired, and the object form is refused with the spec's own message.

  Per the maintainer ruling on objectui#4165, the spec stays strict and the bare preset name is the single canonical spelling. `{ preset }` is handled as an ADR-0089 legacy alias rather than by a permanently tolerant schema: `liftLegacyGlobalFilterDefault` / `liftLegacyDashboardFilterDefaults` (new exports on `@object-ui/types`) convert it to the bare name, `@object-ui/core`'s `resolveDashboardFilterDefs` applies the lift when it reads a stored dashboard, and the console's dashboard designer applies it as the document enters the editable draft so the next save persists the canonical spelling. The retirement window is recorded at the read site: the alias may be removed in `@object-ui/types` 18.0.0, and every lift warns on the console so a surviving legacy document is visible rather than silently tolerated.

  No stored dashboard has to change for this release. The lift means a document carrying the object form keeps loading and rendering exactly as before — measured, not assumed: a legacy declaration already resolved correctly, because `{ preset }` also happens to be the runtime value shape objectui's own date filters use, and that coincidence is why the object form went unnoticed for so long. What changes is that the declaration is now canonicalized on read and rewritten on save, so the two spellings converge instead of accreting.

  The other two divergences in this schema — the bare-string `options` shorthand and the optional `optionsFrom.labelField` — are unaffected. Carrying the spec's refinement while keeping them needed a new composition: a refined object schema in zod 4 rejects `.extend()` and `.omit()` outright and types every `.safeExtend()` override as `never`, so objectui's schema now spreads the spec's shape and re-attaches the spec's object-level rules by delegating to the spec schema itself. Nothing restates the spec's grammar, and a refinement the spec adds later flows in with no change here.

- bb68488: An inline per-locale label now renders its locale's string at the thirteen read sites the `@objectstack/spec` 17.0.0-rc.6 bump exposed

  rc.6 widened `I18nLabel` from `string` to `string | Record<string, string>`, so an author may write `label: { en: 'Owner', 'zh-CN': '负责人' }` anywhere the spec accepts a display label. PR #4169 repaired eight such sites; these thirteen were invisible to it because the five packages involved build through vite/rolldown, so `turbo run build` never type-checks their sources — only `turbo run type-check` does. All thirteen are now resolved through a shared resolver against a real locale, and `turbo run type-check` is 78/78 with zero errors.

  | package                       | what an author can now write and see                                                    |
  | ----------------------------- | --------------------------------------------------------------------------------------- |
  | `@object-ui/layout`           | `NavigationArea.label` — the sidebar area switcher's button and its tooltip             |
  | `@object-ui/plugin-list`      | `ViewTab.label` — the inline pill row, and the mobile dropdown's trigger and menu items |
  | `@object-ui/plugin-dashboard` | `DashboardWidget.title` — the widget card heading and its `title` attribute             |
  | `@object-ui/plugin-designer`  | `DashboardWidget.title` — the widget card and the preview tile                          |
  | `@object-ui/app-shell`        | `ActionParam.label` **and** each `ActionParam.options[].label`                          |

  **Patch, not minor, in every case: no public surface changes meaning.** Every entry above is a read site that previously could only be reached with a value the type system rejected, so no caller's working code changes behaviour. `@object-ui/app-shell` is the only package with an exported-type change and it is purely additive on the authoring side — `RawActionParam.label` and `RawActionParam.options[].label` widen to `I18nLabel` (they accept strictly more), `ResolveActionParamsContext` gains an optional `locale`, and the new `RawActionParamOption` names the authoring shape that was previously spelled with the resolved one. What `resolveActionParams` **emits** is unchanged: `ActionParamDef.label` and its options' labels are still plain `string`s.

  Two consequences worth knowing:

  - **The dashboard designer's title input is deliberately read-only for a map-valued title.** Resolving a per-locale map into a single-line input and writing `e.target.value` back would collapse every other locale on the first keystroke, so the write is guarded and an inline map survives an unrelated edit-and-save round trip untouched — the same conservative branch #4169 took for `DashboardWidgetInspector`. What Studio should actually offer for authoring a per-locale label is objectui#4163 part 2, which is unclaimed and pending design.
  - **`@object-ui/layout` resolves at the spec's `en` default, not the viewer's language.** That package carries no i18n dependency by design (its whole i18n story is injection), and `AppSchemaRendererProps` exposes no locale to thread. The choice and what would change it are documented at the call site.

- e076fd5: Inline-edit toggle reads "Edit fields" without an I18nProvider, matching every locale pack

  `DETAIL_DEFAULT_TRANSLATIONS` said `Edit fields inline` where all ten packs say
  `Edit fields`, so `InlineEditSaveBar`'s toggle announced two different names for one
  control — the map's on provider-less hosts (standalone embeds, the preview gallery),
  the pack's in the console. The pack wins; the map row now mirrors it byte for byte.

  The three ungated defaults maps (`plugin-detail`, `plugin-list`, `plugin-designer`) are
  now compared key-by-key against the `en` pack by a new gate, generalizing the
  collaboration-only precedent from objectui#3440. `LIST_DEFAULT_TRANSLATIONS` and
  `DESIGNER_DEFAULT_TRANSLATIONS` are exported for it, as `DETAIL_DEFAULT_TRANSLATIONS`
  and `COLLAB_DEFAULT_TRANSLATIONS` already were.

- dad805d: Six i18n keys no longer render as raw key strings on hosts with no `I18nProvider` (objectui#4396)

  `detail.saving`, `list.resetSortToDefault`, `appDesigner.widgetProperties`, `appDesigner.addWidget`, `appDesigner.modeEdit` and `common.delete` were read through `createSafeTranslation` without a row in their hook's defaults table and without an inline `defaultValue` at the call site — the only two fallbacks that path has. On a provider-less host (standalone embedding, the preview gallery, host apps that never mount a provider) `fallbackT` therefore returned the key itself, so users saw `detail.saving` in the inline-edit save button, `list.resetSortToDefault` on the sort popover's reset control, `appDesigner.widgetProperties` as the dashboard inspector heading, `appDesigner.addWidget` as its toolbar label, `appDesigner.modeEdit` as a button's accessible name, and `common.delete` on the designer's destructive confirm.

  Each key now has a row in its consumer hook's defaults table, byte-identical to the `en` pack value. No pack was edited, no key added, no call site changed.

- bb68488: Stop declaring 14 symbols under names `@objectstack/spec` owns at `17.0.0-rc.6`
  (objectui#4167, objectstack#4115).

  The rc.6 bump published nine names this repo already declared locally, on top of
  four that predate it — `check:spec-symbols` reported all thirteen at once, and a
  fourteenth (`GlobalFilterSchema`) appeared during the bump itself. Each was
  triaged on its own rather than blanket-renamed, because the right answer differs
  per symbol: five bind to the spec, three are renamed because the spec's
  same-named export means something else, five arrive by derivation, and one is a
  declared dialect with a written reason.

  **Breaking for importers of `@object-ui/react`, `@object-ui/app-shell` and
  `@object-ui/types`** — three exported names changed, because the spec exports the
  same name for a _different_ thing:

  | package               | was                | now                            | what the spec's same-named export actually is                                                                                                          |
  | :-------------------- | :----------------- | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `react` / `app-shell` | `MetadataState`    | `MetadataCacheState`           | a metadata item's LIFECYCLE state — `'draft' \| 'active' \| 'deprecated' \| 'archived'` (`MetadataStateSchema`, `@objectstack/spec/system`)            |
  | `react` / `app-shell` | `resolveI18nLabel` | `resolveKeyedI18nLabel`        | a resolver for the INLINE per-locale map (`{ en: 'Owner', 'zh-CN': '负责人' }`) against a BCP-47 locale                                                |
  | `types`               | `DateRangePreset`  | `FilterBuilderDateRangePreset` | the thirteen HISTORICAL dashboard filter-bar presets; this one is the filter-builder set, which adds eight FUTURE windows the dashboard schema rejects |

  `resolveI18nLabel` is the one where the collision had already started costing
  something. rc.6 widened `I18nLabel` from `string` to
  `string | Record< string, string >`, so the same authored value now reaches
  either resolver — and each answers wrongly, silently, for the other's input: the
  keyed one returns `undefined` for `{ en: 'Owner' }` (no `key`, no
  `defaultValue`), and the spec's reads `key` / `defaultValue` / `params` as locale
  tags. The rc.6 bump PR met this and aliased the spec's import as
  `resolveInlineI18nLabel` in five files, with hand-written comments at two of
  them. That is a review convention, which is what objectstack#4115 exists to
  replace with a rule — so `Keyed` is now the counterpart of that `Inline`, and the
  name says which vocabulary it resolves at every call site.

  **Eleven keep their names and are now imported or derived from the spec** instead
  of re-declared: `DATE_RANGE_PRESETS`, `NavigationMode`, `AddressValue`,
  `BreakpointColumnMap`, `BreakpointOrderMap`, `KanbanConfig`, `CalendarConfig`,
  `GanttConfig`, plus the three renamed above at their new names.

  **Four of the copies were losing information, not just duplicating it.**

  - **`GanttConfig` declared six keys and called itself canonical; rc.6's
    `GanttConfigSchema` declares seventeen.** The eleven it never mentioned —
    `parentField`, `typeField`, `baselineStartField`, `baselineEndField`,
    `groupByField`, `resourceView`, `assigneeField`, `effortField`, `capacity`,
    `quickFilters`, `autoZoomToFilter` — are all read by
    `plugin-gantt/src/ObjectGantt.tsx`, through a local `GanttConfigEx`
    intersection that existed only because this type did not carry them. It now
    derives from the spec, with `timeSegments` (shift segmentation) as the one
    genuinely local extension; the schema is `$loose` upstream, so that key is
    legal metadata rather than a second dialect.
  - **`GanttConfig.tooltipFields` carried the comment "not part of the upstream
    GanttConfigSchema".** It is, as of rc.6, so the key now arrives from the spec.
  - **`AddressValue` declared five of the spec's seven parts** — `countryCode` and
    `formatted` were missing, under a comment already claiming to be "the part
    names of `AddressSchema`". The widget still renders five inputs; binding the
    type stops it from asserting the platform cannot store the other two, and makes
    the `{ ...address }` write-through say so.
  - **`DATE_RANGE_PRESETS` was `Object.keys(PRESET_RANGES)`,** a third copy of a
    vocabulary the spec extracted in objectstack#4614 precisely to collapse — its
    own doc comment names this module as one of the three. It is now the spec's
    array by reference, and the local date-macro bounds table is pinned complete
    against it with `satisfies`, so a preset the schema gains without bounds here
    is a compile error rather than a filter that validates clean and then selects
    nothing.

  `NavigationMode` was one hop from the spec already (`NavigationConfig['mode']`);
  it is bound directly, with a both-directions type pin that it stays the same type
  as the config's own `mode`. `KanbanConfig` / `CalendarConfig` /
  `BreakpointColumnMap` / `BreakpointOrderMap` were exact hand copies of `$strict`
  schemas and are now re-exports — "still exact" is the argument for binding them,
  since a copy with nothing to protect can only drift.

  `GlobalFilterSchema` is the one ALLOW entry. It is the same spread-composition
  dialect as `SelectOptionSchema` next to it, and it collided only because rc.6's
  new refinement forced `.extend()` to be respelled as a `.shape` spread — which
  moved a derivation the guard could see into an object literal it deliberately
  does not descend into. The dialect is unchanged and its three divergences are
  pinned; which side moves on the refinement itself is objectui#4165.

  `@objectstack/spec` moves from `devDependencies` to `dependencies` in
  `@object-ui/layout`: its public type surface now references the spec.

- Updated dependencies [0e67b53]
- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee66e2e]
- Updated dependencies [e2e6360]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [932cbcd]
- Updated dependencies [734d186]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [7ffd616]
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f7c6430]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [77d6f28]
- Updated dependencies [0f21348]
- Updated dependencies [d2e2caf]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [4b70d28]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [ebb4e0e]
- Updated dependencies [3a9021e]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [537a0d1]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [b4d3c22]
- Updated dependencies [1f9b905]
- Updated dependencies [8f60d73]
- Updated dependencies [cb13400]
- Updated dependencies [828549a]
- Updated dependencies [e1ade8f]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [51ab34e]
- Updated dependencies [24bb2de]
- Updated dependencies [0ca6096]
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [433ff9f]
- Updated dependencies [5cc847c]
- Updated dependencies [e7663f2]
- Updated dependencies [fa21254]
- Updated dependencies [f565418]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [6d641c9]
- Updated dependencies [479cc7b]
- Updated dependencies [7e4f0e5]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [51ac39f]
- Updated dependencies [5e514c4]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [58bebf6]
- Updated dependencies [36310dc]
- Updated dependencies [52d878a]
- Updated dependencies [405e808]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [4270c11]
- Updated dependencies [bfdf3d4]
- Updated dependencies [bb68488]
- Updated dependencies [c0f9a4b]
- Updated dependencies [b1e42d0]
- Updated dependencies [2459a3e]
- Updated dependencies [2776b11]
- Updated dependencies [ac853ce]
- Updated dependencies [fa51109]
- Updated dependencies [d6aa172]
- Updated dependencies [c32a8a1]
- Updated dependencies [fe52a04]
- Updated dependencies [d46f9b8]
- Updated dependencies [3f5f87c]
- Updated dependencies [605b747]
- Updated dependencies [2fea4d2]
- Updated dependencies [f5e1143]
- Updated dependencies [7f1cb33]
- Updated dependencies [f148a64]
- Updated dependencies [bb68488]
- Updated dependencies [2e3b0c0]
- Updated dependencies [9461dd3]
- Updated dependencies [78fa331]
- Updated dependencies [47f551b]
- Updated dependencies [31ab1ac]
- Updated dependencies [0082db8]
- Updated dependencies [b42558a]
- Updated dependencies [d2f6e6b]
- Updated dependencies [ab04728]
- Updated dependencies [85a3082]
- Updated dependencies [5bf09fd]
- Updated dependencies [06915b0]
- Updated dependencies [ff84b05]
  - @object-ui/i18n@17.5.0
  - @object-ui/react@17.5.0
  - @object-ui/components@17.5.0
  - @object-ui/core@17.5.0
  - @object-ui/fields@17.5.0
  - @object-ui/data-objectstack@17.5.0
  - @object-ui/types@17.5.0
  - @object-ui/plugin-grid@17.5.0
  - @object-ui/plugin-form@17.5.0

## 17.4.0

### Patch Changes

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [0186cdc]
- Updated dependencies [7864f03]
- Updated dependencies [ea41a59]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [18c42c6]
- Updated dependencies [ecae400]
- Updated dependencies [4bc6c23]
- Updated dependencies [d3e738a]
- Updated dependencies [c3b01a7]
- Updated dependencies [f5f8744]
- Updated dependencies [8497579]
- Updated dependencies [f0c9a90]
- Updated dependencies [7ed3360]
- Updated dependencies [3765678]
- Updated dependencies [d83f6b3]
- Updated dependencies [5f08c05]
- Updated dependencies [69becd2]
- Updated dependencies [5e52495]
- Updated dependencies [0fa5e4d]
- Updated dependencies [b750823]
- Updated dependencies [5bfaabd]
- Updated dependencies [022002a]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [65bb513]
- Updated dependencies [c97a45e]
- Updated dependencies [b19162d]
- Updated dependencies [c2fd122]
- Updated dependencies [1bd6faa]
- Updated dependencies [9154d9e]
- Updated dependencies [ac2139c]
- Updated dependencies [b14ab3a]
- Updated dependencies [e24d767]
- Updated dependencies [8c60819]
- Updated dependencies [aca561a]
- Updated dependencies [41d6022]
- Updated dependencies [e64a52e]
- Updated dependencies [844d17f]
- Updated dependencies [d8a0be4]
- Updated dependencies [48132f7]
- Updated dependencies [4dcd52a]
- Updated dependencies [42ae5c6]
- Updated dependencies [0ef9dfd]
- Updated dependencies [f4b97c8]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [6d762da]
- Updated dependencies [e6fdbdc]
- Updated dependencies [54233b1]
- Updated dependencies [c2ecbae]
- Updated dependencies [f9faa7d]
- Updated dependencies [97b63d7]
- Updated dependencies [14c59c0]
- Updated dependencies [aeb8424]
- Updated dependencies [6bb454a]
- Updated dependencies [1a33b1a]
- Updated dependencies [11c1e71]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [33526fd]
- Updated dependencies [32413ec]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/fields@17.4.0
  - @object-ui/i18n@17.4.0
  - @object-ui/types@17.4.0
  - @object-ui/plugin-grid@17.4.0
  - @object-ui/plugin-form@17.4.0
  - @object-ui/data-objectstack@17.4.0

## 17.3.0

### Patch Changes

- Updated dependencies [18cd432]
- Updated dependencies [b7165ce]
- Updated dependencies [532cf8b]
- Updated dependencies [680080a]
- Updated dependencies [a7651e6]
- Updated dependencies [d915c47]
- Updated dependencies [b71fc92]
- Updated dependencies [65516ba]
- Updated dependencies [94c5b7c]
- Updated dependencies [ca0fa8f]
- Updated dependencies [34595eb]
- Updated dependencies [3889ffb]
- Updated dependencies [5781fb1]
- Updated dependencies [7e2406a]
- Updated dependencies [9e9e9a9]
- Updated dependencies [19b8c9b]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [7d08c3f]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [6fe485b]
- Updated dependencies [5c856ec]
- Updated dependencies [23018cc]
- Updated dependencies [53811d1]
- Updated dependencies [68b6a28]
- Updated dependencies [0554e88]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [28b2e65]
- Updated dependencies [509104a]
- Updated dependencies [825bbe3]
- Updated dependencies [6195841]
- Updated dependencies [5dd0127]
- Updated dependencies [06632e9]
- Updated dependencies [a415684]
- Updated dependencies [a4cff5b]
- Updated dependencies [175bd79]
- Updated dependencies [5af2852]
- Updated dependencies [34d9169]
- Updated dependencies [5881a2c]
- Updated dependencies [9bc3709]
- Updated dependencies [f833d3a]
- Updated dependencies [30ae33a]
- Updated dependencies [a6ec93d]
- Updated dependencies [2a9513d]
- Updated dependencies [49f7449]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [c7ed4c3]
- Updated dependencies [2409e1d]
- Updated dependencies [789fe3e]
- Updated dependencies [f789c3b]
- Updated dependencies [a321fa4]
- Updated dependencies [8d8094a]
  - @object-ui/core@17.3.0
  - @object-ui/fields@17.3.0
  - @object-ui/components@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/plugin-grid@17.3.0
  - @object-ui/i18n@17.3.0
  - @object-ui/react@17.3.0
  - @object-ui/plugin-form@17.3.0
  - @object-ui/data-objectstack@17.3.0

## 17.2.0

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [a889e31]
- Updated dependencies [09d30a4]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [c5ccbd5]
- Updated dependencies [d9668a7]
- Updated dependencies [4b470b9]
- Updated dependencies [785b8a5]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [5eaa861]
- Updated dependencies [4a51e77]
- Updated dependencies [f6e8d78]
- Updated dependencies [ea96284]
- Updated dependencies [d3584c6]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/components@17.2.0
  - @object-ui/core@17.2.0
  - @object-ui/react@17.2.0
  - @object-ui/i18n@17.2.0
  - @object-ui/plugin-grid@17.2.0
  - @object-ui/plugin-form@17.2.0
  - @object-ui/data-objectstack@17.2.0
  - @object-ui/fields@17.2.0

## 17.1.0

### Patch Changes

- b5b97e2: fix(types,layout): nav item type `component` joins `NavigationItemType` and its zod enum — objectui#2918

  The renderers have carried a full `type: 'component'` implementation (Phase 3b:
  `componentRef` colon-split to `/component/<ns>/<name>`, `params` serialised as
  querystring, `metadata:*` special-cases) — but the vocabulary never gained the
  member, and `@objectstack/spec` has had `ComponentNavItem` all along. The zod
  enum was the part that bit: `NavigationItemTypeSchema` rejected
  `type: 'component'` at validation time, so authors could not declare one and
  the renderer half was unreachable — dead on arrival rather than dead code.

  - `NavigationItemType` and `NavigationItemTypeSchema` gain `'component'`;
    `NavigationItem` gains the fields the renderer consumes, `componentRef` and
    `params` (also used by `type: 'page'`), mirroring spec's `ComponentNavItem` —
    declared in zod too, so parse no longer strips them.
  - The `(item as any).componentRef` / `params` casts in `NavigationRenderer`
    and `AppSchemaRenderer` become typed access.
  - `NavigationDesigner`'s exhaustive type-meta map gains a `component` badge
    (new `appDesigner.navTypeComponent` key in all 10 locales).
  - `@object-ui/layout` gains `type-check` (src + tests) with the #2915 `paths`
    override; its DEBT entry in `check-type-check-coverage.mjs` is deleted.

- Updated dependencies [62311b6]
- Updated dependencies [fc0272a]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [9b773f9]
- Updated dependencies [1cf0de7]
- Updated dependencies [752e18f]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [5340879]
- Updated dependencies [19e9fa0]
- Updated dependencies [a149e90]
- Updated dependencies [d61efd1]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [9eb932b]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [3cb9646]
- Updated dependencies [68ef584]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [7d35010]
- Updated dependencies [c4d7b20]
- Updated dependencies [c769d3d]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [aeb0bd2]
- Updated dependencies [c735bf7]
- Updated dependencies [02aef0c]
- Updated dependencies [6f29aa5]
- Updated dependencies [d21794c]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [9a04d25]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [07de839]
- Updated dependencies [2a40b5e]
- Updated dependencies [df613fa]
- Updated dependencies [4874117]
- Updated dependencies [ad0183a]
- Updated dependencies [ce08d55]
- Updated dependencies [a17ef09]
- Updated dependencies [eb4b740]
- Updated dependencies [aecc934]
- Updated dependencies [5b084eb]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [e339d60]
- Updated dependencies [2d5d594]
- Updated dependencies [ea7f477]
- Updated dependencies [379728f]
- Updated dependencies [7f23cd0]
- Updated dependencies [0ded602]
- Updated dependencies [24e0e0a]
- Updated dependencies [f8a95e5]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [80edbd4]
- Updated dependencies [c0d0bc8]
- Updated dependencies [9867281]
  - @object-ui/core@17.1.0
  - @object-ui/components@17.1.0
  - @object-ui/plugin-grid@17.1.0
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0
  - @object-ui/data-objectstack@17.1.0
  - @object-ui/i18n@17.1.0
  - @object-ui/plugin-form@17.1.0
  - @object-ui/fields@17.1.0

## 17.0.0

### Patch Changes

- 7d46648: fix(hooks): stop calling translation hooks inside try/catch (objectui#2879)

  Eleven call sites wrapped a React hook in `try`/`catch` to make it
  "provider-safe". `useObjectTranslation` and `useObjectLabel` already are — they
  read context optionally and fall back to react-i18next's global instance, and
  never throw. The `catch` bought nothing and cost correctness: a throw _after_
  the hook ran desyncs hook order on the next render, because React matches hooks
  positionally. objectui#2595/#2596 fixed exactly this in `@object-ui/i18n`'s
  `createSafeTranslation`; nine plugin-local re-implementations kept their own
  copy of the bug, and two more (`ObjectTimeline`, `ObjectView`) were found by the
  new lint rule below — `ObjectView` had even suppressed
  `react-hooks/rules-of-hooks` inline to keep it.

  - Six exact re-implementations now delegate to `createSafeTranslation`:
    `plugin-detail`, `plugin-timeline`, `plugin-list`, `plugin-calendar`,
    `plugin-grid`'s `ObjectGrid`, `plugin-designer`.
  - `components`' `data-table` also delegates; `createSafeTranslation` now
    returns `language` alongside `t` so consumers that localize dates don't need
    a second hook call. Purely additive.
  - `plugin-gantt` and `plugin-grid`'s `ImportWizard` keep their local hooks —
    they fall back _per key_, which a single-probe factory cannot express and
    which their comments justify (a host dictionary that covers common keys but
    lags on newer ones). Only the `try`/`catch` is removed.
  - `ObjectTimeline` and `ObjectView` call the hook directly and probe the
    returned value, mirroring `useSafeFieldLabel`.

  Adds `object-ui/no-try-catch-around-hook` (error) so a twelfth copy fails CI.
  It only matches `use*` names, accepts member calls solely on `React` (so
  `vi.useRealTimers()` is not a hook), and resets its try-depth inside nested
  functions (so `renderHook(() => useThing())` inside a `try` is fine) — both
  false positives were real code in this repo and are pinned in the rule's tests.

  `eslint-rules/**/*.test.js` matched no vitest project glob, so the local
  plugin's specs had never run in CI. They are now included; all three pass.

  `ObjectTimeline`'s test mock of `@object-ui/react` omitted `useObjectLabel` —
  the removed `try`/`catch` had been silently absorbing that gap. The mock is now
  complete.

- dc7a798: fix(plugin-grid,plugin-form,plugin-designer,cli,vscode-extension): type-check the last five unchecked packages, and fix the two runtime bugs that hid there (#2919)

  Closes the remaining `DEBT` entries from the #2911 sweep. Each package gains
  `"type-check": "tsc --noEmit"` and loses its entry in
  `scripts/check-type-check-coverage.mjs`; coverage goes 36 -> 41 of 45 and
  outstanding errors 25 -> 5 (only #2916 `plugin-view` and #2918 `layout` remain).

  **Two of these were real bugs, not just type noise.**

  `@object-ui/cli` — `objectui validate` could never report a validation failure.
  `ZodError.errors` was removed in Zod 4 (the repo is on 4.4.3), so `.errors` read
  `undefined` and `.forEach` threw a `TypeError` that the enclosing `catch`
  reported as `✗ Error reading or parsing schema file: Cannot read properties of
undefined` — swallowing the very errors the command exists to print. Now reads
  `.issues`. Verified against the built CLI: an invalid schema now prints
  `1. Invalid input / Code: invalid_union` and exits 1.

  `@object-ui/plugin-grid` — grouping a grid by a boolean column showed the raw
  i18n key. `t('grid.booleanTrue', 'Yes')` asked for a key present in neither
  `GRID_DEFAULT_TRANSLATIONS` nor any locale bundle, and passed the English
  fallback as a bare second argument — which `createSafeTranslation`'s no-provider
  translator reads as an _options object_, so the fallback never applied and the
  header rendered the literal `grid.booleanTrue`. Switched to the `grid.yes` /
  `grid.no` keys the boolean cell renderer (`ObjectGrid.tsx`) and
  `BulkActionDialog` already use, with the fallback passed as `defaultValue`.
  Covered by a new regression test, confirmed to fail against the old code.

  The rest are type-only corrections that preserve runtime behaviour exactly:

  - **plugin-grid** `importParsers.ts` — `scorePair`'s `score`/`reason` moved into
    one `best` record. They were captured `let`s mutated only inside the `bump`
    closure, which TypeScript's control-flow analysis does not track, so it still
    believed `reason` was `'none'` at the type gate and flagged the comparisons as
    non-overlapping (TS2367). The gate — which stops a text column being mapped
    onto a number field — is unchanged; its two dedicated tests still pass.
  - **plugin-form** — `SectionFieldsContext.fieldLabel` now requires `fallback`,
    matching the `useSafeFieldLabel` producer in `@object-ui/i18n` (an omitted
    fallback could not satisfy the `=> string` return, and all four call sites
    already pass one). This one signature cleared six errors.
    `MasterDetailFormSchema.recordId` widens to `string | number`, matching
    `ObjectFormSchema` and the five envelopes that forward straight into it;
    it is narrowed with `String()` only at the batch-transaction boundary, whose
    `BatchTransactionOperation.id` is a string by protocol (the `isEdit` guard
    already proves it non-null there). `deriveMasterDetail`'s column sort gets an
    explicit `fillPriority` helper — `GridColumn.type` is optional, and a column
    without one keeps sorting at priority 5 exactly as the old
    `TYPE_FILL_PRIORITY[undefined] ?? 5` lookup put it.
  - **plugin-designer** — unused `index` parameter prefixed `_`, matching the
    `_entry` beside it.
  - **cli** — a stale `@ts-expect-error` removed; `viteConfig` is typed `any`, so
    the line it guarded had stopped erroring.
  - **vscode-extension** (`object-ui`) — migrated off `moduleResolution: "node"`,
    which is deprecated and stops working in TypeScript 7, to `node16` paired with
    `module: "node16"` (the package has no `"type": "module"`, so node16 resolves
    it as the CommonJS that tsup emits, and it gains the `exports`-map awareness
    node10 lacks). Its error count was under-reported as 1: that TS5107 config
    error masked four more. The package uses `console`/`Buffer` but sets
    `lib: ["ES2020"]` with no DOM and never declared `@types/node` — added, with an
    explicit `types: ["node", "vscode"]`.

  Also: `plugin-grid`, `plugin-form` and `plugin-designer` gain the `baseUrl` +
  `paths` override their type-checked plugin peers already carry, and `cli` an
  empty `paths`. Without it the inherited root `paths` point `@object-ui/*` at
  sibling `src/`, which is outside each project's `rootDir` and produces the ~104
  spurious TS6059 errors noted in #2915; workspace deps instead resolve through
  node_modules to built `.d.ts`, which `type-check`'s `dependsOn: ["^build"]`
  guarantees exist.

  Verified the gate genuinely covers all five rather than trusting the green:
  injecting a type error into each package makes `pnpm type-check --filter <pkg>`
  fail, which was impossible before this change.

- Updated dependencies [7b21891]
- Updated dependencies [0b3be01]
- Updated dependencies [3c4d935]
- Updated dependencies [4b1ed7d]
- Updated dependencies [4b60d2d]
- Updated dependencies [952b978]
- Updated dependencies [de5e40c]
- Updated dependencies [1a03af6]
- Updated dependencies [3e886eb]
- Updated dependencies [cfc675e]
- Updated dependencies [20df08c]
- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [af705b9]
- Updated dependencies [0502a7c]
- Updated dependencies [7b35e4b]
- Updated dependencies [8fb1295]
- Updated dependencies [e16ed2d]
- Updated dependencies [c6fd752]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [c77108c]
- Updated dependencies [2735de6]
- Updated dependencies [697cda4]
- Updated dependencies [c19ac11]
- Updated dependencies [6dee2cb]
- Updated dependencies [e05f052]
- Updated dependencies [0502a7c]
- Updated dependencies [faad45e]
- Updated dependencies [553443e]
- Updated dependencies [09c6a17]
- Updated dependencies [c7cff19]
- Updated dependencies [df6697f]
- Updated dependencies [ba73a02]
- Updated dependencies [ba45145]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [9b4b952]
- Updated dependencies [341bfb5]
- Updated dependencies [2f947e4]
- Updated dependencies [7d46648]
- Updated dependencies [6e8fd3c]
- Updated dependencies [9b53d72]
- Updated dependencies [bb4aa25]
- Updated dependencies [75f1cdf]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [d62fb1f]
- Updated dependencies [c6cfdf1]
- Updated dependencies [dc7a798]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [263f885]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/i18n@17.0.0
  - @object-ui/fields@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/plugin-grid@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/data-objectstack@17.0.0
  - @object-ui/core@17.0.0
  - @object-ui/plugin-form@17.0.0

## 16.1.0

### Minor Changes

- 199fa83: feat(dashboard): retire the pre-ADR-0021 inline-analytics renderer branches (framework#3320)

  Follow-up to the dashboard analytics migration (framework#3251 / objectui#2703).
  Authoring already emits only the semantic-layer shape (`dataset` + `dimensions` +
  `values`); this removes the renderer's now-unauthored legacy read-branches.

  - **types**: drop the `@deprecated` inline-analytics keys (`object`,
    `categoryField`, `categoryGranularity`, `valueField`, `aggregate`, `measures`)
    from `DashboardWidgetSchema`. They were retained in #2703 only so the renderer
    could read legacy/static metadata during the transition.
  - **plugin-dashboard**: `DashboardRenderer` no longer emits the object-bound
    metric / chart / pivot / table / list branches from the top-level `object` +
    analytics keys. It keeps the renderer-internal static paths (`options.data` /
    `widget.data` array and the `provider: 'object'` async config) and
    `widget.component`. The dashboard renderer no longer emits `object-pivot` /
    `pivot` at all — dataset pivots render through `DatasetWidget` (grouped table /
    cross-tab); the `ObjectPivotTable` / `PivotTable` components stay as public
    SDUI blocks for other surfaces. `DashboardGridLayout` gets the same treatment.
  - **graceful fallback**: a widget that still carries the retired inline shape in
    stored metadata (top-level `object`, no `dataset`, no inline `options.data`)
    now renders a visible error placeholder prompting a rebind to a dataset, rather
    than a blank chart/grid.
  - **plugin-designer**: `DashboardEditor` drops its inline object / value-field /
    aggregate fields (analytics binding is authored via the dataset picker in
    app-shell's `DashboardWidgetInspector` / plugin-dashboard's `WidgetConfigPanel`).

### Patch Changes

- 549c67d: chore(lint): clear the mechanical baseline lint errors so these packages' lint gates protect them again

  Extends the fields/core cleanup from #2709 (objectui#2713). These eight package
  lints were red at baseline on `main`, so their per-package `lint` gate could not
  catch new violations of the same class. Cleared every **error** (no behavior
  change; warnings are out of scope):

  - **`no-useless-catch`** (`data-objectstack`) — unwrapped five try/catch blocks
    whose `catch` only re-threw; errors still propagate identically.
  - **`preserve-caught-error`** (`cli`, `data-objectstack`, `react`) — the caught
    error's message is inlined into the thrown `Error`; a scoped disable with a
    justifying comment carries each one, because these packages target ES2020
    whose lib types the 1-arg `Error` constructor only (so `{ cause }` won't
    compile) — same reasoning as the core case in #2709.
  - **`prefer-const`** (`plugin-calendar`, `plugin-map`) — `let`→`const` for
    never-reassigned bindings.
  - **`no-empty-object-type`** (`plugin-designer`) — empty extend-only interfaces
    → equivalent `type` aliases.
  - **`no-useless-assignment`** (`react`) — dropped a dead initializer that both
    branches overwrite before it is read.
  - **`no-require-imports`** (`plugin-calendar`, `plugin-timeline` tests) —
    hoisted `vi.mock` factories now use an `async` factory with
    `await import('react')` instead of `require('react')`.
  - **stale `eslint-disable` directive** (`plugin-markdown`) — removed a
    `react/no-danger` disable whose plugin is not loaded in the flat config (an
    unknown-rule reference that ESLint v10 reports as an error); the rationale is
    kept as a plain comment.

- Updated dependencies [0318118]
- Updated dependencies [1c8935a]
- Updated dependencies [af1b0db]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [aefcf39]
- Updated dependencies [8c1e415]
- Updated dependencies [0ea5036]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [1100a8b]
- Updated dependencies [7abe4cd]
- Updated dependencies [69fa5d1]
- Updated dependencies [549c67d]
- Updated dependencies [ebe6494]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [f80aaf2]
- Updated dependencies [62b9ab5]
- Updated dependencies [14cb729]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
- Updated dependencies [3b2e4d9]
  - @object-ui/fields@16.1.0
  - @object-ui/i18n@16.1.0
  - @object-ui/core@16.1.0
  - @object-ui/data-objectstack@16.1.0
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/plugin-form@16.1.0
  - @object-ui/components@16.1.0
  - @object-ui/plugin-grid@16.1.0

## 16.0.0

### Patch Changes

- 210806a: chore(designer): drop the inert object "Enabled" toggle (framework#2377)

  The object designer showed an **Enabled** column (`ObjectManager` grid) and an
  editable **Enabled** boolean (add/edit object form), backed solely by the object
  `active` metadata property. `active` had no runtime consumer and was removed from
  `@objectstack/spec` (framework#3199, ADR-0049 enforce-or-remove) — so the toggle
  never disabled anything. Toggling it "off" left the object fully queryable and
  usable: a false affordance.

  Removed the column, the form field, the `active`↔`enabled` mapping/write-back in
  `MetadataObjectsPage`, the `enabled?` field on the designer `ObjectDefinition`
  type, and the now-unused `appDesigner.objectManager.enabled` string. Non-breaking:
  the metadata write path registers objects via `ObjectSchema.parse()`, which already
  strips unknown keys, and `ObjectDefinition.enabled` was designer-only.

  `isSystem` is unchanged (it stays a live spec property).

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [80977d0]
- Updated dependencies [9d4a429]
- Updated dependencies [b4ef588]
- Updated dependencies [ca0f5f0]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/plugin-grid@16.0.0
  - @object-ui/plugin-form@16.0.0
  - @object-ui/i18n@16.0.0
  - @object-ui/fields@16.0.0
  - @object-ui/core@16.0.0
  - @object-ui/data-objectstack@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/i18n@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0
- @object-ui/fields@15.0.0
- @object-ui/data-objectstack@15.0.0
- @object-ui/plugin-form@15.0.0
- @object-ui/plugin-grid@15.0.0

## 14.1.0

### Minor Changes

- dea65f7: Unify the list-view conditional tier onto the canonical CEL engine (#1584).

  Conditional formatting (list / grid / kanban) and row-action `visible` /
  `disabled` predicates are now evaluated by `@objectstack/formula`'s
  `ExpressionEngine` — the same engine the server uses — instead of the legacy
  JS-dialect `ExpressionEvaluator`, matching how `@objectstack/spec` already types
  these surfaces (`ExpressionInputSchema` / CEL). The whole platform now speaks one
  expression dialect (framework ADR-0058).

  - `@object-ui/core`: new `evalRowPredicate` + `resolveConditionalFormatting`
    helpers (next to `evalFieldPredicate`). One implementation of all three
    formatting rule shapes; dialect routing (a `{ dialect: 'cel' }` envelope is
    always CEL; a bare string is CEL unless it carries legacy-only syntax
    (`${…}` / `===` / `?.` / `.includes()`), which routes to the old engine with a
    one-time deprecation warning); the native `{ field, operator, value }` form is
    translated to CEL.
  - `@object-ui/react`: new `useRowPredicate` hook (canonical CEL, ambient
    predicate scope merged).
  - Consumers converged: `ListView.evaluateConditionalFormatting` (thin wrapper,
    export kept), `ObjectGrid` row styling (inline copy removed), kanban card
    styles, and the grid / data-table row-action menus. `plugin-view`'s kanban
    branch now forwards top-level `conditionalFormatting` (previously dropped).
  - Row-action `visible` fails **closed** (broken predicate → hidden + warn);
    `disabled` fails soft. The CEL `in` operator (and list membership) now work in
    row predicates — the legacy engine could not parse them.
  - The legacy `FormField.condition: { field, equals/notEquals/in }` is retired to
    a CEL translation (back-compat preserved); `FieldDesigner` migrated to
    `visibleWhen`.

  Fully back-compat: existing conditional-formatting rules, row-action predicates,
  and form `condition` metadata keep working (translated / routed as needed).

### Patch Changes

- Updated dependencies [82441e4]
- Updated dependencies [2efa9fd]
- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [579b24d]
- Updated dependencies [2b30583]
- Updated dependencies [23d65c3]
- Updated dependencies [06d5ec6]
- Updated dependencies [055e1d2]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [f30ff68]
- Updated dependencies [073e7aa]
- Updated dependencies [3e8bf07]
- Updated dependencies [6c0135c]
- Updated dependencies [5b52624]
- Updated dependencies [4afb251]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f94905d]
- Updated dependencies [2712fc1]
- Updated dependencies [f0f10f5]
  - @object-ui/i18n@14.1.0
  - @object-ui/fields@14.1.0
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/plugin-form@14.1.0
  - @object-ui/plugin-grid@14.1.0
  - @object-ui/components@14.1.0
  - @object-ui/data-objectstack@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [c70bca7]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [a44e7b6]
- Updated dependencies [5971cc4]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/i18n@14.0.0
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/plugin-grid@14.0.0
  - @object-ui/components@14.0.0
  - @object-ui/fields@14.0.0
  - @object-ui/data-objectstack@14.0.0
  - @object-ui/plugin-form@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [53c40c2]
- Updated dependencies [e492b9d]
- Updated dependencies [5da9905]
  - @object-ui/components@13.2.0
  - @object-ui/plugin-grid@13.2.0
  - @object-ui/i18n@13.2.0
  - @object-ui/data-objectstack@13.2.0
  - @object-ui/fields@13.2.0
  - @object-ui/plugin-form@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/i18n@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0
- @object-ui/fields@13.1.0
- @object-ui/data-objectstack@13.1.0
- @object-ui/plugin-form@13.1.0
- @object-ui/plugin-grid@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [9e38270]
- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/i18n@13.0.0
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/fields@13.0.0
  - @object-ui/plugin-form@13.0.0
  - @object-ui/plugin-grid@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0
  - @object-ui/data-objectstack@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [e1840bf]
- Updated dependencies [c31874d]
- Updated dependencies [195121a]
  - @object-ui/components@12.1.0
  - @object-ui/fields@12.1.0
  - @object-ui/i18n@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/plugin-form@12.1.0
  - @object-ui/plugin-grid@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0
  - @object-ui/data-objectstack@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e36a9c7]
- Updated dependencies [e4de456]
- Updated dependencies [68e2d1c]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/fields@12.0.0
  - @object-ui/plugin-form@12.0.0
  - @object-ui/plugin-grid@12.0.0
  - @object-ui/data-objectstack@12.0.0
  - @object-ui/react@12.0.0
  - @object-ui/i18n@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [544d8eb]
- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
- Updated dependencies [ec9c8ee]
- Updated dependencies [6c1ad9e]
  - @object-ui/i18n@11.5.0
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/plugin-form@11.5.0
  - @object-ui/plugin-grid@11.5.0
  - @object-ui/data-objectstack@11.5.0
  - @object-ui/fields@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [144ab55]
- Updated dependencies [1948c5b]
- Updated dependencies [3e42680]
- Updated dependencies [bce581a]
- Updated dependencies [2edcaff]
- Updated dependencies [9cd9be1]
- Updated dependencies [5160832]
- Updated dependencies [69d6b94]
- Updated dependencies [c38d107]
- Updated dependencies [243a9ba]
- Updated dependencies [289be5b]
- Updated dependencies [7782698]
- Updated dependencies [19f2533]
- Updated dependencies [790558b]
- Updated dependencies [c0164ad]
- Updated dependencies [1e9145d]
- Updated dependencies [09e1b26]
- Updated dependencies [e84d64d]
  - @object-ui/plugin-form@11.4.0
  - @object-ui/types@11.4.0
  - @object-ui/plugin-grid@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/fields@11.4.0
  - @object-ui/i18n@11.4.0
  - @object-ui/data-objectstack@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [c55a52a]
- Updated dependencies [2e3e058]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/i18n@11.3.0
  - @object-ui/plugin-grid@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/fields@11.3.0
  - @object-ui/plugin-form@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/data-objectstack@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/fields@11.2.0
  - @object-ui/plugin-form@11.2.0
  - @object-ui/plugin-grid@11.2.0
  - @object-ui/data-objectstack@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0
  - @object-ui/i18n@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [6726a2b]
  - @object-ui/i18n@11.1.0
  - @object-ui/components@11.1.0
  - @object-ui/fields@11.1.0
  - @object-ui/plugin-form@11.1.0
  - @object-ui/plugin-grid@11.1.0
  - @object-ui/react@11.1.0
  - @object-ui/types@11.1.0
  - @object-ui/core@11.1.0
  - @object-ui/data-objectstack@11.1.0

## 7.3.0

### Patch Changes

- Updated dependencies [788dbf9]
  - @object-ui/fields@7.3.0
  - @object-ui/plugin-form@7.3.0
  - @object-ui/plugin-grid@7.3.0
  - @object-ui/types@7.3.0
  - @object-ui/core@7.3.0
  - @object-ui/i18n@7.3.0
  - @object-ui/react@7.3.0
  - @object-ui/components@7.3.0
  - @object-ui/data-objectstack@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [8e7c1da]
- Updated dependencies [0caea33]
- Updated dependencies [4aa8b84]
- Updated dependencies [d23db5c]
  - @object-ui/i18n@7.2.0
  - @object-ui/plugin-grid@7.2.0
  - @object-ui/plugin-form@7.2.0
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/fields@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0
  - @object-ui/data-objectstack@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [aae8791]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/plugin-form@7.1.0
  - @object-ui/components@7.1.0
  - @object-ui/data-objectstack@7.1.0
  - @object-ui/fields@7.1.0
  - @object-ui/plugin-grid@7.1.0
  - @object-ui/i18n@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [5976ba3]
- Updated dependencies [a00e16d]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [30ee761]
- Updated dependencies [053c948]
- Updated dependencies [b99d9bd]
- Updated dependencies [053c948]
- Updated dependencies [89e113c]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [77cc6bb]
- Updated dependencies [6c0c92c]
- Updated dependencies [97c6831]
- Updated dependencies [cb2fdb1]
- Updated dependencies [a58c6b8]
- Updated dependencies [c3749eb]
- Updated dependencies [c09f44e]
- Updated dependencies [f6044fa]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [5332639]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [0ad72a6]
- Updated dependencies [bd398df]
- Updated dependencies [3fa23a7]
- Updated dependencies [18d0339]
- Updated dependencies [66ed3ad]
- Updated dependencies [c6445b6]
- Updated dependencies [80c133c]
- Updated dependencies [5e1b838]
- Updated dependencies [59b6bbb]
- Updated dependencies [d16566f]
- Updated dependencies [69510df]
- Updated dependencies [b148daf]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [514f426]
- Updated dependencies [586a027]
- Updated dependencies [00f8d2d]
- Updated dependencies [9aac2b8]
- Updated dependencies [1394e34]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [db8cd00]
- Updated dependencies [650bd1f]
- Updated dependencies [2f31406]
- Updated dependencies [18728c1]
- Updated dependencies [8426db7]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/plugin-grid@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/data-objectstack@7.0.0
  - @object-ui/i18n@7.0.0
  - @object-ui/types@7.0.0
  - @object-ui/plugin-form@7.0.0
  - @object-ui/fields@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/i18n@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3
- @object-ui/fields@6.2.3
- @object-ui/data-objectstack@6.2.3
- @object-ui/plugin-form@6.2.3
- @object-ui/plugin-grid@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/fields@6.2.2
  - @object-ui/plugin-form@6.2.2
  - @object-ui/plugin-grid@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2
  - @object-ui/i18n@6.2.2
  - @object-ui/data-objectstack@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/i18n@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1
- @object-ui/fields@6.2.1
- @object-ui/data-objectstack@6.2.1
- @object-ui/plugin-form@6.2.1
- @object-ui/plugin-grid@6.2.1

## 6.2.0

### Minor Changes

- fe3c1d3: Metadata Admin engine — unified UI for all 27 metadata types.

  A generic, schema-driven admin shell that replaces the old per-type
  bespoke pages with a single registry-driven engine. Admins can now browse,
  create, override, diff, and roll back every registered metadata type from
  the Setup app → _All Metadata Types_.

  ### New: `@object-ui/app-shell` views/metadata-admin

  - **`MetadataDirectoryPage`** — auto-grouped tile directory by domain, with
    free-text search, domain chips, and a _Writable only_ filter.
  - **`MetadataResourceListPage` / `MetadataResourceEditPage` / `…CreatePage` / `…HistoryPage`** —
    generic CRUD shell. Uses the new `/meta/types` schema field to render
    SchemaForm; uses `?layers=code,overlay,effective` to power a 3-state diff
    tab; uses `/references` to warn before destructive deletes.
  - **`MetadataQuickFind`** — Cmd+Shift+M palette searching across types and
    items.
  - **`PermissionMatrixEditor`** — Salesforce-style matrix custom editor for
    `type=permission`. Objects × CRUD/VAMA/lifecycle columns with cascade
    rules (viewAllRecords ⟹ allowRead, etc.), expandable per-object field
    R/W subtable, bulk-set (R / CRUD / All / None), filter, _only granted_
    toggle, destructive-change confirmation, profile switch.
  - **`DesignerEditorWrapper`** — generic load–edit–save shell that hosts any
    bespoke designer (`ObjectViewConfigurator`, `DashboardEditor`,
    `PageCanvasEditor`, …). Handles dirty tracking, Save / Reset / Refresh /
    History buttons, and the read-only fallback when `allowOrgOverride` is
    false.
  - **`i18n.ts`** — bilingual (`en-US`, `zh-CN`) bundle for built-in type
    labels, domain labels, and engine UI strings, with `detectLocale()` and a
    `t(key)` helper.

  ### New routing variant

  - App nav now supports `{ type: 'component', componentRef, params? }` items.
    `AppContent` resolves them through the existing `ComponentRegistry`.
  - Built-in components registered: `metadata:directory`, `metadata:resource`,
    `metadata:object/edit` (FieldsPage), `metadata:permission/edit`
    (PermissionMatrixEditor), and lazy designer wrappers for view / dashboard
    / page.

  ### Plugin-designer

  - Lazy-exported `ObjectManager`, `FieldDesigner`, `ObjectViewConfigurator`,
    `DashboardEditor`, `PageCanvasEditor`, `MetadataObjectsPage`, and
    `MetadataFieldsPage` so the engine can mount them on demand.

  The temporary `/dev/meta` route is removed. Setup app navigation flows
  through the new component routes.

- ec8dcde: Add visual editing for object & field metadata in the Setup app.

  **`@object-ui/data-objectstack`** — new `MetadataClient` class. A thin,
  auth-friendly wrapper over the framework's `/api/v1/meta/*` REST
  endpoints (list / get / save / reset / history), with first-class
  support for `If-Match` (optimistic concurrency), `X-Actor` (audit
  attribution), environment-scoped paths
  (`/environments/:id/meta/*`), and 404-as-null semantics. Use
  `new MetadataClient({ baseUrl })` or `client.withEnvironment(id)` to
  target a specific environment.

  **`@object-ui/plugin-designer`** — two new route-ready pages that
  together close the "Data Model" management loop in the Setup app:

  - `MetadataObjectsPage` — lists every object schema (via
    `MetadataClient.list('object')`), renders the existing
    `ObjectManager`, and persists edits/deletes through PUT/DELETE on
    the metadata REST surface. Honours `allowRuntimeCreate` and
    surfaces server errors verbatim.
  - `MetadataFieldsPage` — for a single object, loads the parent
    schema, projects `fields` into the existing `FieldDesigner`, and
    on save merges the edited field map back into the object before
    issuing a single PUT. Preserves unknown per-field attributes so
    nothing the designer doesn't render is dropped.

  Both pages take either a pre-built `MetadataClient` or a
  `MetadataClientConfig`; neither imposes a routing convention on the
  host app — they can be mounted anywhere (e.g.
  `/apps/setup/_meta/object` and `/apps/setup/_meta/object/:name/fields`).

  These additions do not modify the underlying `ObjectManager` /
  `FieldDesigner` components, which remain pure controlled-input
  components usable in non-REST contexts.

### Patch Changes

- Updated dependencies [fe3c1d3]
- Updated dependencies [ec8dcde]
  - @object-ui/data-objectstack@6.2.0
  - @object-ui/plugin-form@6.2.0
  - @object-ui/plugin-grid@6.2.0
  - @object-ui/react@6.2.0
  - @object-ui/components@6.2.0
  - @object-ui/fields@6.2.0
  - @object-ui/types@6.2.0
  - @object-ui/core@6.2.0
  - @object-ui/i18n@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/fields@6.1.0
  - @object-ui/plugin-form@6.1.0
  - @object-ui/plugin-grid@6.1.0
  - @object-ui/react@6.1.0
  - @object-ui/i18n@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/i18n@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4
- @object-ui/fields@6.0.4
- @object-ui/plugin-form@6.0.4
- @object-ui/plugin-grid@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/i18n@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3
- @object-ui/fields@6.0.3
- @object-ui/plugin-form@6.0.3
- @object-ui/plugin-grid@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/i18n@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2
- @object-ui/fields@6.0.2
- @object-ui/plugin-form@6.0.2
- @object-ui/plugin-grid@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/i18n@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1
- @object-ui/fields@6.0.1
- @object-ui/plugin-form@6.0.1
- @object-ui/plugin-grid@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/i18n@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/fields@6.0.0
- @object-ui/plugin-form@6.0.0
- @object-ui/plugin-grid@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/i18n@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2
- @object-ui/fields@5.4.2
- @object-ui/plugin-form@5.4.2
- @object-ui/plugin-grid@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/i18n@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1
- @object-ui/fields@5.4.1
- @object-ui/plugin-form@5.4.1
- @object-ui/plugin-grid@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/fields@5.4.0
  - @object-ui/plugin-form@5.4.0
  - @object-ui/plugin-grid@5.4.0
  - @object-ui/react@5.4.0
  - @object-ui/i18n@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/i18n@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2
- @object-ui/fields@5.3.2
- @object-ui/plugin-form@5.3.2
- @object-ui/plugin-grid@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/i18n@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1
- @object-ui/fields@5.3.1
- @object-ui/plugin-form@5.3.1
- @object-ui/plugin-grid@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/i18n@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0
- @object-ui/fields@5.3.0
- @object-ui/plugin-form@5.3.0
- @object-ui/plugin-grid@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/i18n@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1
- @object-ui/fields@5.2.1
- @object-ui/plugin-form@5.2.1
- @object-ui/plugin-grid@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [e3160a5]
- Updated dependencies [9997cae]
- Updated dependencies [321294c]
- Updated dependencies [b2d1704]
- Updated dependencies [0a644f0]
- Updated dependencies [a3cb88f]
- Updated dependencies [5425608]
- Updated dependencies [6c3f018]
- Updated dependencies [d912a60]
- Updated dependencies [5633edd]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [e919433]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d9c3bae]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/plugin-grid@5.2.0
  - @object-ui/i18n@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/fields@5.2.0
  - @object-ui/components@5.2.0
  - @object-ui/plugin-form@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/fields@5.1.1
  - @object-ui/plugin-form@5.1.1
  - @object-ui/plugin-grid@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/i18n@5.1.1
  - @object-ui/react@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [1976691]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [49b1760]
- Updated dependencies [c0b236f]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/i18n@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0
  - @object-ui/plugin-form@5.1.0
  - @object-ui/fields@5.1.0
  - @object-ui/plugin-grid@5.1.0

## 5.0.2

### Patch Changes

- Updated dependencies [cab6a93]
- Updated dependencies [a311e22]
  - @object-ui/plugin-grid@5.0.2
  - @object-ui/i18n@5.0.2
  - @object-ui/plugin-form@5.0.2
  - @object-ui/components@5.0.2
  - @object-ui/fields@5.0.2
  - @object-ui/react@5.0.2
  - @object-ui/types@5.0.2
  - @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/i18n@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1
- @object-ui/fields@5.0.1
- @object-ui/plugin-form@5.0.1
- @object-ui/plugin-grid@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [8930b15]
- Updated dependencies [95b6b21]
- Updated dependencies [ddb08a7]
- Updated dependencies [765d50f]
- Updated dependencies [927187a]
- Updated dependencies [bae8ba8]
- Updated dependencies [8435860]
- Updated dependencies [bb2ea48]
- Updated dependencies [b14fe09]
- Updated dependencies [a7bef6e]
- Updated dependencies [74962b0]
- Updated dependencies [3154334]
- Updated dependencies [fa4c2cb]
- Updated dependencies [7213027]
  - @object-ui/components@5.0.0
  - @object-ui/i18n@5.0.0
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/fields@5.0.0
  - @object-ui/plugin-form@5.0.0
  - @object-ui/plugin-grid@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/i18n@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0
- @object-ui/fields@4.8.0
- @object-ui/plugin-form@4.8.0
- @object-ui/plugin-grid@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/i18n@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0
- @object-ui/fields@4.7.0
- @object-ui/plugin-form@4.7.0
- @object-ui/plugin-grid@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [9aacced]
- Updated dependencies [9661d86]
- Updated dependencies [3ee436d]
  - @object-ui/plugin-grid@4.6.0
  - @object-ui/components@4.6.0
  - @object-ui/fields@4.6.0
  - @object-ui/plugin-form@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/i18n@4.6.0
  - @object-ui/react@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [6b6afd1]
- Updated dependencies [ab5e281]
- Updated dependencies [d714e85]
- Updated dependencies [6b6afd1]
- Updated dependencies [22fa558]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/plugin-form@4.5.0
  - @object-ui/types@4.5.0
  - @object-ui/fields@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/i18n@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/plugin-grid@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [63eb66d]
- Updated dependencies [2bd45af]
  - @object-ui/fields@4.4.0
  - @object-ui/components@4.4.0
  - @object-ui/plugin-form@4.4.0
  - @object-ui/plugin-grid@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/i18n@4.4.0
  - @object-ui/react@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [5f4ac6e]
- Updated dependencies [6b683c8]
  - @object-ui/i18n@4.3.1
  - @object-ui/components@4.3.1
  - @object-ui/fields@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/plugin-form@4.3.1
  - @object-ui/plugin-grid@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [f196cf4]
- Updated dependencies [ee1cc96]
- Updated dependencies [0b032be]
- Updated dependencies [115d36a]
- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/i18n@4.3.0
  - @object-ui/components@4.3.0
  - @object-ui/fields@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/plugin-form@4.3.0
  - @object-ui/plugin-grid@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/i18n@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1
- @object-ui/fields@4.2.1
- @object-ui/plugin-form@4.2.1
- @object-ui/plugin-grid@4.2.1

## 4.2.0

### Patch Changes

- Updated dependencies [eb738bd]
- Updated dependencies [650392e]
- Updated dependencies [84b4bf1]
  - @object-ui/i18n@4.2.0
  - @object-ui/components@4.2.0
  - @object-ui/fields@4.2.0
  - @object-ui/react@4.2.0
  - @object-ui/plugin-form@4.2.0
  - @object-ui/plugin-grid@4.2.0
  - @object-ui/types@4.2.0
  - @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/i18n@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0
- @object-ui/fields@4.1.0
- @object-ui/plugin-form@4.1.0
- @object-ui/plugin-grid@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/i18n@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12
- @object-ui/fields@4.0.12
- @object-ui/plugin-form@4.0.12
- @object-ui/plugin-grid@4.0.12

## 4.0.11

### Patch Changes

- Updated dependencies [1909bc3]
  - @object-ui/i18n@4.0.11
  - @object-ui/components@4.0.11
  - @object-ui/fields@4.0.11
  - @object-ui/react@4.0.11
  - @object-ui/plugin-form@4.0.11
  - @object-ui/plugin-grid@4.0.11
  - @object-ui/types@4.0.11
  - @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/i18n@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10
- @object-ui/fields@4.0.10
- @object-ui/plugin-form@4.0.10
- @object-ui/plugin-grid@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/i18n@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9
- @object-ui/fields@4.0.9
- @object-ui/plugin-form@4.0.9
- @object-ui/plugin-grid@4.0.9

## 4.0.8

### Patch Changes

- Updated dependencies [3d58eaa]
  - @object-ui/i18n@4.0.8
  - @object-ui/components@4.0.8
  - @object-ui/fields@4.0.8
  - @object-ui/react@4.0.8
  - @object-ui/plugin-form@4.0.8
  - @object-ui/plugin-grid@4.0.8
  - @object-ui/types@4.0.8
  - @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
- Updated dependencies [fd15918]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/i18n@4.0.7
  - @object-ui/plugin-grid@4.0.7
  - @object-ui/fields@4.0.7
  - @object-ui/plugin-form@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- 1b6dc64: fix: complete Tailwind v3→v4 migration cleanup

  - Rename deprecated `flex-shrink-0` → `shrink-0` and `flex-grow-N` →
    `grow-N` (Tailwind v4 dropped the long-form aliases). Affects
    data-table, fields/index, FileField, ChatbotEnhanced,
    FloatingChatbotPanel, ProcessDesigner, HistoryPanel, KanbanEnhanced,
    KanbanImpl, plugin-timeline index, FlowDesigner, LayoutRenderer.
  - Replace `theme(spacing.4)` inside arbitrary-value `[calc(...)]` with
    literal `1rem` in sidebar.tsx — `theme()` is deprecated in v4.
  - Remove obsolete v3-escape CSS overrides from index.css and
    sidebar-fixes.css. The component source now uses native v4 stacked
    data variants (`group-data-[state=collapsed]:group-data-[collapsible=icon]:w-(--sidebar-width-icon)`)
    which Tailwind v4 emits correctly without the manual overrides.
    Only the bespoke `.sidebar-menu-button-icon-mode*` rules are kept.

- Updated dependencies [89ae109]
- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/plugin-grid@4.0.6
  - @object-ui/plugin-form@4.0.6
  - @object-ui/fields@4.0.6
  - @object-ui/components@4.0.6
  - @object-ui/types@4.0.6
  - @object-ui/core@4.0.6
  - @object-ui/i18n@4.0.6
  - @object-ui/react@4.0.6

## 4.0.5

### Patch Changes

- 1dc6061: fix(build): inline dynamic imports in library outputs

  Library `vite build --lib` outputs were emitting separate code-split chunks
  (`rolldown-runtime-*.js`, `LookupField-*.js`, etc.) when source files used
  `React.lazy()` / dynamic `import()`. When consumer apps re-bundled these
  multi-file dists, the library's per-chunk rolldown-runtime collided with the
  consumer's own runtime, causing "TypeError: i is not a function" at runtime
  when lazy components tried to register themselves (e.g. TextField in
  `@object-ui/fields` after 4.0.4).

  Adding `output.inlineDynamicImports: true` to all `@object-ui/*` library vite
  configs forces a single `dist/index.js` per package, which lets consumer
  bundlers handle the library as an opaque ESM module without identifier
  mismatches across chunks.

  Affected packages: components, fields, layout, plugin-aggrid, plugin-ai,
  plugin-calendar, plugin-charts, plugin-chatbot, plugin-dashboard,
  plugin-designer, plugin-detail, plugin-editor, plugin-form, plugin-gantt,
  plugin-grid, plugin-kanban, plugin-list, plugin-map, plugin-markdown,
  plugin-report, plugin-timeline, plugin-view, plugin-workflow.

- Updated dependencies [1dc6061]
  - @object-ui/components@4.0.5
  - @object-ui/fields@4.0.5
  - @object-ui/plugin-form@4.0.5
  - @object-ui/plugin-grid@4.0.5
  - @object-ui/types@4.0.5
  - @object-ui/core@4.0.5
  - @object-ui/i18n@4.0.5
  - @object-ui/react@4.0.5

## 4.0.4

### Patch Changes

- d2b6ece: fix: externalize all bare imports in library builds

  Library builds (vite lib mode) now externalize every non-relative import instead of bundling third-party CJS dependencies into the published dist. This avoids inlined `require("react")` / `require("react-dom")` calls that cause `Calling \`require\` for "react" in an environment that doesn't expose the \`require\` function` runtime errors when consumer apps re-bundle the published dist.

  Specifically fixes:

  - `@object-ui/plugin-dashboard` no longer inlines `react-grid-layout` (and its transitive `react-draggable` / `react-resizable` CJS bundles). `react-grid-layout` is now declared as a peer dependency so consumers install a single ESM-friendly copy.
  - `@object-ui/components`, `@object-ui/plugin-calendar`, `@object-ui/plugin-charts`, `@object-ui/plugin-designer` no longer inline `react-i18next` / `i18next` / `use-sync-external-store` CJS shims.
  - All plugin packages now use a unified `external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname)` rule, ensuring future additions of CJS deps are automatically externalized.

- Updated dependencies [d2b6ece]
  - @object-ui/components@4.0.4
  - @object-ui/fields@4.0.4
  - @object-ui/plugin-form@4.0.4
  - @object-ui/plugin-grid@4.0.4
  - @object-ui/types@4.0.4
  - @object-ui/core@4.0.4
  - @object-ui/i18n@4.0.4
  - @object-ui/react@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3
  - @object-ui/i18n@4.0.3
  - @object-ui/react@4.0.3
  - @object-ui/components@4.0.3
  - @object-ui/fields@4.0.3
  - @object-ui/plugin-form@4.0.3
  - @object-ui/plugin-grid@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/i18n@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1
- @object-ui/fields@4.0.1
- @object-ui/plugin-form@4.0.1
- @object-ui/plugin-grid@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/fields@4.0.0
  - @object-ui/plugin-form@4.0.0
  - @object-ui/plugin-grid@4.0.0
  - @object-ui/react@4.0.0
  - @object-ui/i18n@4.0.0

## 3.4.0

### Patch Changes

- a2d7023: End-user feature batch — forms, designer history, import/export, and PWA offline sync.

  **Forms (`@object-ui/fields`, `@object-ui/providers`)**

  - `FileField`: native `<input capture="environment">` camera capture for mobile devices, plus a uploading-progress indicator driven by `UploadProvider`.
  - `ImageField`: per-image inline crop/rotate via the lazy-loaded `ImageCropperDialog` (canvas-based, zero new deps).
  - New `UploadProvider` in `@object-ui/providers` with pluggable adapters for S3 and Azure Blob (plus the default object-URL adapter for local previews). XHR-based with progress, abort, and retry.
  - `LookupField`: `lookup.dependsOn: string | string[]` to chain dependent lookups (e.g. State depends on Country); the trigger is gated until parent values are present and the OData `$filter` is built automatically.

  **Container-aware widget widths (`@object-ui/components`)**

  - New `useResizeObserver(ref)` hook exposing `{ width, height }` of any element. SSR-safe; reads the initial size via `getBoundingClientRect`.
  - `plugin-gantt` and `plugin-kanban` now react to their container size instead of `window.innerWidth`, so they behave correctly inside split panels and dashboards.

  **Designer history (`@object-ui/plugin-designer`)**

  - `useUndoRedo` (and therefore `useDesignerHistory`) gains `persistKey` + `storage` options to round-trip the undo/redo stack through `sessionStorage`, plus a `clearPersisted()` cleanup helper. Drafts now survive accidental tab refreshes.
  - New `<HistoryPanel>` component renders the timeline visually with one-click jump-to-checkpoint via the new `jumpTo(index)` API.

  **Import wizard (`@object-ui/plugin-grid`)**

  - Saved column-mapping templates: name, save, re-apply, and delete via a new template bar in the mapping step. Persisted under `objectui:import-templates:${objectName}` (override via `templateStorageKey` / `templateStorage`).
  - Inline validation correction: cells with errors in the preview step are now editable; corrections feed straight into the import without requiring a re-upload, with green-bar status indicators for fixed rows.

  **PWA offline sync (`@object-ui/mobile`)**

  - New `MemoryOfflineQueue` / `IndexedDbOfflineQueue` (`createOfflineQueue()` picks the best backend) backed by IndexedDB.
  - `createOfflineDataSource(inner, { queue })` wraps any DataSource so mutations issued while offline (or that fail with a network-style error) are queued and replayed in order on reconnect. Includes `replay()`, `drop()`, `clear()`, `pending()`, an `onChange` notifier, and an opt-in `resolveConflict` hook for stale-write conflicts.
  - New `useOfflineSync(source)` hook exposes `{ isOnline, pending, isReplaying, replay, drop, clear }` and auto-replays on the browser's `online` event.
  - `getServiceWorkerSource(opts)` emits a customisable Service Worker that pre-caches the app shell, applies network-first to API requests, and broadcasts `REPLAY_QUEUE` to clients on Background Sync. `requestBackgroundSync(tag)` registers a one-shot sync from the page.

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/fields@3.4.0
  - @object-ui/plugin-grid@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/plugin-form@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0
  - @object-ui/i18n@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/i18n@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2
- @object-ui/fields@3.3.2
- @object-ui/plugin-form@3.3.2
- @object-ui/plugin-grid@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/fields@3.3.1
  - @object-ui/plugin-form@3.3.1
  - @object-ui/plugin-grid@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/i18n@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Minor Changes

- baaad22: fix changeset

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/i18n@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0
- @object-ui/fields@3.3.0
- @object-ui/plugin-form@3.3.0
- @object-ui/plugin-grid@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/i18n@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0
- @object-ui/fields@3.2.0
- @object-ui/plugin-form@3.2.0
- @object-ui/plugin-grid@3.2.0

## 3.1.5

### Patch Changes

- Updated dependencies [cfe0596]
  - @object-ui/i18n@3.1.5
  - @object-ui/react@3.1.5
  - @object-ui/components@3.1.5
  - @object-ui/types@3.1.5
  - @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/i18n@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/i18n@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/i18n@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/react@3.1.1
  - @object-ui/i18n@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/types@3.0.1
  - @object-ui/core@3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

### Patch Changes

- Updated dependencies [87979c3]
  - @object-ui/types@3.0.0
  - @object-ui/core@3.0.0
  - @object-ui/react@3.0.0
  - @object-ui/components@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0
