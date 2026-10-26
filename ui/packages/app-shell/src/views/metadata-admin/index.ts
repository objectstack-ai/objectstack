// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Public surface for the metadata-admin engine (Phase 3c).
 *
 * Pages are registered with the ComponentRegistry in
 * `../../services/builtinComponents.ts`; consumers (and plugins) can
 * still import directly to compose custom shells.
 *
 * The Registry export lets plugin authors opt their bespoke editors
 * into the generic shell:
 *
 *   import { registerMetadataResource } from '@object-ui/app-shell';
 *   registerMetadataResource({ type: 'view', EditPage: MyViewEditor });
 */

export { MetadataDirectoryPage } from './DirectoryPage.js';
export { PackagesPage } from './PackagesPage.js';
export { MetadataResourceRouter } from './ResourceRouter.js';
export { MetadataResourceListPage } from './ResourceListPage.js';
export { MetadataResourceEditPage } from './ResourceEditPage.js';
export { RelatedPanel } from './RelatedPanel.js';
export { MetadataDetailDrawer } from './MetadataDetailDrawer.js';
export { MetadataResourceHistoryPage } from './ResourceHistoryPage.js';
export { MetadataDiagnosticsPage } from './DiagnosticsPage.js';
export { MetadataQuickFind } from './QuickFind.js';
export { PageShell as MetadataPageShell } from './PageShell.js';
export { SchemaForm } from './SchemaForm.js';
/**
 * The ONE declaration of the metadata-admin form authoring surface -- the
 * field (objectui#5040, converged by PR #5537 into the `./form-spec.js` leaf)
 * and, since objectui#5596, the two containers above it.
 *
 * Re-exported through the package root because they have an out-of-package
 * consumer: `apps/console`'s `FormPage.tsx` reads the same authored `FormView`
 * documents and, until objectui#5542 for the field and objectui#5596 for the
 * two containers, held its own hand-written descriptions of these shapes under
 * the same names. A type that cannot be imported is a type
 * that gets retyped, and retyped copies drift — which is the defect #5040
 * recorded. Reachability is what makes the convergence hold outside this
 * directory. Type-only: erased at build, so nothing is added to the bundle.
 */
export type { FormFieldSpec, FormSectionSpec, FormViewSpec } from './form-spec.js';
export { LayeredDiff } from './LayeredDiff.js';
export { PermissionMatrixEditPage } from './PermissionMatrixEditor.js';
export {
  translateMetadataType,
  translateMetadataDomain,
  t as translateMetadataAdmin,
  detectLocale,
} from './i18n.js';
export type { SupportedLocale } from './i18n.js';

export {
  registerMetadataResource,
  getMetadataResource,
  listMetadataResources,
  listAnchorsFor,
  resolveResourceConfig,
  anchorByField,
} from './registry.js';
export type {
  MetadataResourceConfig,
  MetadataDomain,
  MetadataAnchor,
} from './registry.js';

/**
 * ⛔ NO LOAD-TIME REGISTRATION BELONGS IN THIS FILE (objectui#6776).
 *
 * The five built-in registrations (`registerBuiltinAnchors`,
 * `registerDefaultMetadataSchemas`, `registerDatasourceResource`,
 * `registerBuiltinPreviews`, `registerBuiltinInspectors`) used to run here.
 * The first three now live in `./register-builtins.js`, which the PACKAGE
 * ENTRY (`packages/app-shell/src/index.ts`) bare-imports; the last two run from
 * `./register-builtin-designers.js`, which the entry loads with a dynamic
 * `import()` (objectui#11939). Those two files carry the reasoning. In one line: a module that registers at load time is named by
 * `@object-ui/app-shell`'s published `sideEffects` array, an array entry is
 * unshakeable, and the package barrel re-exports 25 runtime values from HERE —
 * so a registration in this file drags every page, preview and inspector under
 * `views/metadata-admin/` into the console's eager closure, past the six
 * `lazy()` boundaries `AppContent` declares for it.
 *
 * That also rules out the tidy-looking version of the same mistake: a bare
 * `import './register-builtins.js';` on THIS module. `bareSideEffectImport` in
 * `scripts/vite-declared-lazy-views.ts` reads that line and refuses to declare
 * this barrel pure, which puts the closure straight back.
 */

export {
  registerMetadataPreview,
  getMetadataPreview,
  listMetadataPreviewTypes,
} from './preview-registry.js';
export type {
  MetadataPreview,
  MetadataPreviewProps,
  MetadataSelection,
} from './preview-registry.js';

export {
  registerMetadataInspector,
  getMetadataInspector,
  listMetadataInspectorTypes,
} from './inspector-registry.js';
export type {
  MetadataInspector,
  MetadataInspectorProps,
} from './inspector-registry.js';

export {
  useMetadataClient,
  useMetadataTypes,
  useTypesIndex,
  useGlobalDiagnostics,
  matchesQuery,
} from './useMetadata.js';
export type {
  RichMetadataTypeEntry,
  MetadataDiagnosticsEntry,
  MetadataDiagnosticsSummary,
} from './useMetadata.js';
