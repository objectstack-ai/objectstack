/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Safe wrapper for useObjectTranslation that falls back to English defaults
 * when I18nProvider is not available (e.g., standalone usage outside console).
 */

import { createSafeTranslation } from '@object-ui/i18n';

/**
 * Default English translations for fallback when no I18nProvider is mounted.
 *
 * Every row whose key the `en` pack also defines must stay byte-identical to it,
 * or the same control is labelled one way here and another in the console.
 * Enforced since objectui#4401 by
 * `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx`.
 *
 * Exported for that gate — the same reason
 * `DETAIL_DEFAULT_TRANSLATIONS` and `COLLAB_DEFAULT_TRANSLATIONS` are exported
 * from their packages. The gate cannot live in `@object-ui/i18n` (that would
 * invert the dependency, see `gantt-count-interpolation-4157.test.ts`), so it
 * reads this map from downstream instead of parsing this file's text.
 */
export const DESIGNER_DEFAULT_TRANSLATIONS: Record<string, string> = {
  // Step labels & descriptions
  'appDesigner.basicInfo': 'Basic Info',
  'appDesigner.objects': 'Objects',
  'appDesigner.navigation': 'Navigation',
  'appDesigner.branding': 'Branding',
  'appDesigner.stepBasicDesc': 'Name, title, and icon',
  'appDesigner.stepObjectsDesc': 'Select business objects',
  'appDesigner.stepNavigationDesc': 'Build navigation tree',
  'appDesigner.stepBrandingDesc': 'Logo, colors, and favicon',
  // Step 1
  'appDesigner.appName': 'App Name',
  'appDesigner.appTitle': 'Title',
  'appDesigner.appDescription': 'Description',
  'appDesigner.appIcon': 'Icon',
  'appDesigner.template': 'Template',
  'appDesigner.snakeCaseHint': 'Must be snake_case (e.g. my_app)',
  // Step 2
  'appDesigner.searchObjects': 'Search objects…',
  'appDesigner.selectAll': 'Select All',
  'appDesigner.deselectAll': 'Deselect All',
  'appDesigner.noObjectsFound': 'No objects found.',
  // Step 3
  'appDesigner.addGroup': 'Add Group',
  'appDesigner.addUrl': 'Add URL',
  'appDesigner.addSeparator': 'Add Separator',
  'appDesigner.noNavItemsHint': 'No navigation items yet. Select objects in the previous step or add items manually.',
  'appDesigner.separatorLabel': '— Separator —',
  'appDesigner.newGroup': 'New Group',
  'appDesigner.newLink': 'New Link',
  // Step 4
  'appDesigner.logoUrl': 'Logo URL',
  'appDesigner.primaryColor': 'Primary Color',
  'appDesigner.faviconUrl': 'Favicon URL',
  'appDesigner.preview': 'Preview',
  // Buttons
  'common.cancel': 'Cancel',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.close': 'Close',
  'appDesigner.complete': 'Complete',
  'appDesigner.saveDraft': 'Save Draft',
  // Cancel confirmation
  'appDesigner.cancelConfirmTitle': 'Discard changes?',
  'appDesigner.cancelConfirmMessage': 'You have unsaved changes. Are you sure you want to cancel?',
  'appDesigner.confirmDiscard': 'Discard',
  'appDesigner.keepEditing': 'Keep Editing',
  // Navigation Designer
  'appDesigner.navNoItems': 'No navigation items. Click buttons above to add items.',
  'appDesigner.navNoPreviewItems': 'No items',
  'appDesigner.navLivePreview': 'Live Preview',
  'appDesigner.navCollapseGroup': 'Collapse group',
  'appDesigner.navExpandGroup': 'Expand group',
  'appDesigner.navAddChild': 'Add child',
  'appDesigner.navMoveUp': 'Move up',
  'appDesigner.navMoveDown': 'Move down',
  'appDesigner.navRemove': 'Remove',
  'appDesigner.navObjectPage': 'Object Page',
  'appDesigner.navDashboard': 'Dashboard',
  'appDesigner.navPage': 'Page',
  'appDesigner.navReport': 'Report',
  'appDesigner.navGroup': 'Group',
  'appDesigner.navUrl': 'URL',
  'appDesigner.navSeparator': 'Separator',
  'appDesigner.navTypeObject': 'Object',
  'appDesigner.navTypeDashboard': 'Dashboard',
  'appDesigner.navTypePage': 'Page',
  'appDesigner.navTypeReport': 'Report',
  'appDesigner.navTypeUrl': 'URL',
  'appDesigner.navTypeGroup': 'Group',
  'appDesigner.navTypeSeparator': 'Separator',
  'appDesigner.navTypeAction': 'Action',
  'appDesigner.navTypeComponent': 'Component',
  'appDesigner.navTypeDoc': 'Doc',
  'appDesigner.navEditIcon': 'Edit icon',
  'appDesigner.navToggleVisible': 'Toggle visibility',
  'appDesigner.navHidden': 'Hidden',
  'appDesigner.navExportSchema': 'Export JSON',
  'appDesigner.navImportSchema': 'Import JSON',
  'appDesigner.navExportSuccess': 'Navigation schema exported',
  'appDesigner.navImportSuccess': 'Navigation schema imported',
  'appDesigner.navImportError': 'Invalid navigation JSON',
  'appDesigner.navIconPlaceholder': 'Icon name (e.g. Users)',
  // Dashboard Editor
  'appDesigner.dashboardEditor': 'Dashboard Editor',
  'appDesigner.noWidgets': 'No widgets. Click a button above to add one.',
  'appDesigner.widgetLayoutSize': 'Layout Size',
  'appDesigner.widgetWidth': 'Width',
  'appDesigner.widgetHeight': 'Height',
  'appDesigner.dashboardPreview': 'Dashboard Preview',
  'appDesigner.noWidgetsPreview': 'No widgets to preview',
  // objectui#4396 — DashboardEditor's inspector heading, its add-widget picker
  // label, and the edit half of its preview/edit toggle. All three are read
  // bare (no inline `defaultValue`), so before these rows a provider-less host
  // rendered the raw keys into a heading, a label and an `aria-label`.
  'appDesigner.widgetProperties': 'Widget Properties',
  'appDesigner.addWidget': 'Add Widget',
  'appDesigner.modeEdit': 'Edit',
  // Page Canvas Editor
  'appDesigner.pageCanvasEditor': 'Page Canvas Editor',
  'appDesigner.emptyPage': 'Empty page. Click a button above to add a component.',
  'appDesigner.pagePreview': 'Page Preview',
  'appDesigner.noComponentsPreview': 'No components to preview',
  'appDesigner.modePage': 'Page',
  'appDesigner.modeDashboard': 'Dashboard',
  // Shared editor actions
  'appDesigner.undo': 'Undo',
  'appDesigner.redo': 'Redo',
  // Branding Editor
  'appDesigner.brandingEditor': 'Branding Editor',
  'appDesigner.brandingExport': 'Export JSON',
  'appDesigner.brandingImport': 'Import JSON',
  'appDesigner.brandingPreview': 'Preview',
  'appDesigner.brandingSampleButton': 'Sample Button',
  'appDesigner.brandingSampleText': 'This is how your brand theme will look.',
  'appDesigner.colorPalette': 'Color Palette',
  'appDesigner.fontFamily': 'Font Family',
  'appDesigner.fontDefault': 'Default (System)',
  'appDesigner.modeLight': 'Light',
  'appDesigner.modeDark': 'Dark',
  'appDesigner.mobilePreview': 'Mobile Preview',
  // Object Manager
  'appDesigner.objectManager.title': 'Object Manager',
  'appDesigner.objectManager.addObject': 'New Object',
  'appDesigner.objectManager.searchPlaceholder': 'Search objects…',
  'appDesigner.objectManager.noObjects': 'No objects found.',
  'appDesigner.objectManager.objectName': 'API Name',
  'appDesigner.objectManager.objectLabel': 'Label',
  'appDesigner.objectManager.pluralLabel': 'Plural Label',
  'appDesigner.objectManager.icon': 'Icon',
  'appDesigner.objectManager.selectIcon': 'Select icon…',
  'appDesigner.objectManager.group': 'Group',
  'appDesigner.objectManager.noGroup': 'No Group',
  'appDesigner.objectManager.sortOrder': 'Sort Order',
  'appDesigner.objectManager.relationships': 'Relationships',
  'appDesigner.objectManager.systemBadge': 'System',
  'appDesigner.objectManager.fieldCount': '{{count}} fields',
  'appDesigner.objectManager.ungrouped': 'Ungrouped',
  'appDesigner.objectManager.deleteConfirmTitle': 'Delete Object?',
  'appDesigner.objectManager.deleteConfirmMessage': 'This will permanently delete the object and all its fields. This action cannot be undone.',
  // Field Designer
  'appDesigner.fieldDesigner.title': 'Field Designer',
  'appDesigner.fieldDesigner.addField': 'New Field',
  'appDesigner.fieldDesigner.searchPlaceholder': 'Search fields…',
  'appDesigner.fieldDesigner.allTypes': 'All Types',
  'appDesigner.fieldDesigner.noFields': 'No fields found.',
  'appDesigner.fieldDesigner.fieldName': 'API Name',
  'appDesigner.fieldDesigner.fieldLabel': 'Label',
  'appDesigner.fieldDesigner.fieldType': 'Type',
  'appDesigner.fieldDesigner.fieldGroup': 'Group',
  'appDesigner.fieldDesigner.description': 'Description',
  'appDesigner.fieldDesigner.required': 'Required',
  'appDesigner.fieldDesigner.unique': 'Unique',
  'appDesigner.fieldDesigner.readOnly': 'Read Only',
  'appDesigner.fieldDesigner.hidden': 'Hidden',
  'appDesigner.fieldDesigner.externalId': 'External ID',
  'appDesigner.fieldDesigner.trackHistory': 'Track History',
  'appDesigner.fieldDesigner.defaultValue': 'Default Value',
  'appDesigner.fieldDesigner.placeholder': 'Placeholder',
  'appDesigner.fieldDesigner.referenceTo': 'Reference To',
  'appDesigner.fieldDesigner.options': 'Options',
  'appDesigner.fieldDesigner.addOption': 'Add Option',
  'appDesigner.fieldDesigner.systemBadge': 'System',
  'appDesigner.fieldDesigner.ungrouped': 'General',
  'appDesigner.fieldDesigner.deleteConfirmTitle': 'Delete Field?',
  'appDesigner.fieldDesigner.deleteConfirmMessage': 'This will permanently delete the field. Existing data in this field will be lost.',
  // Field Designer — sections (Drawer)
  'appDesigner.fieldDesigner.basicSection': 'Basic',
  'appDesigner.fieldDesigner.typeSpecificSection': 'Type Settings',
  'appDesigner.fieldDesigner.advancedSection': 'Advanced',
  // Field Designer — type categories (Airtable-style grouping)
  'appDesigner.fieldDesigner.typeCategory.text': 'Text',
  'appDesigner.fieldDesigner.typeCategory.number': 'Number',
  'appDesigner.fieldDesigner.typeCategory.date': 'Date & Time',
  'appDesigner.fieldDesigner.typeCategory.choice': 'Choice',
  'appDesigner.fieldDesigner.typeCategory.relation': 'Relation',
  'appDesigner.fieldDesigner.typeCategory.advanced': 'Advanced',
  // Common
  'common.edit': 'Edit',
  // objectui#4396 — the confirm label on FieldDesigner's and ObjectManager's
  // delete dialogs (`confirmLabel={t('common.delete')}`, read bare). The census
  // in PR #4372 recorded this key as "outside table, no default" without naming
  // its consumer; both call sites resolve through THIS hook, so the row belongs
  // here beside the other borrowed `common.*` entries — not in `packages/components`.
  'common.delete': 'Delete',
  // objectui#12145 — accessible names: `HistoryPanel`'s undo / redo buttons,
  // `Minimap`'s image, `VersionHistory`'s region, and `DashboardDesignPage`'s
  // back button. The back button borrows `detail.goBack` rather than adding a
  // second key for the same name.
  'designer.undo': 'Undo',
  'designer.redo': 'Redo',
  'designer.canvasMinimap': 'Canvas minimap',
  'designer.versionHistory': 'Version history',
  'detail.goBack': 'Go back',
};

/**
 * Delegates to `@object-ui/i18n`'s `createSafeTranslation`; the local copy this
 * replaced wrapped the hook in try/catch (rules-of-hooks, objectui#2879).
 */
export const useDesignerTranslation = createSafeTranslation(
  DESIGNER_DEFAULT_TRANSLATIONS,
  'appDesigner.basicInfo',
);
