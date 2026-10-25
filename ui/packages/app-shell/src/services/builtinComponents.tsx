// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in component registrations — Phase 3b + 3c.
 *
 * Side-effect module imported by `index.ts` to ensure the platform's
 * own admin UI is registered with the ComponentRegistry before
 * AppContent mounts the first `<Route path="component/...">`.
 *
 * Registers the generic metadata admin engine and a specialised
 * permission-matrix editor for `permission`. The previous View /
 * Dashboard / Page bespoke "designer" tabs were removed: they never
 * produced usable output and confused authors. Those types now use the
 * same JSONSchema-driven Form + Preview experience as every other
 * metadata type.
 */

import { lazy, Suspense } from 'react';
import { registerAppComponent } from './componentRegistry.js';
import { registerMetadataResource } from '../views/metadata-admin/registry.js';
import { PermissionMatrixEditPage } from '../views/metadata-admin/PermissionMatrixEditor.js';
import { PackagesPage } from '../views/metadata-admin/PackagesPage.js';
import { PositionGrantedSetsCell, PositionHolderCountCell } from '../views/metadata-admin/PositionGrantCells.js';
import { PackagedAutomationPage } from '../views/setup/PackagedAutomationPage.js';
import {
  isAggregatedViewContainer,
  viewDisplayType,
} from '../views/metadata-admin/view-item-normalize.js';
// objectui#11692 - the helper moved beside the metadata client, so the
// plugin-designer writers share it; `@object-ui/data-objectstack` is already on
// the console's eager path (its data source), so this adds no eager chunk.
import { dropServedPicklistOptions } from '@object-ui/data-objectstack';

/* -------------------------------------------------------------------------- */
/* 1) Top-level admin pages — bound to `metadata:directory` + `metadata:resource` */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ TRAP — read this before "just making something here lazy" (objectui#6776).
 *
 * The two registrations below hold their pages behind `lazy()` + `Suspense`, and
 * that is ONE HALF of a two-part change. The other half is that
 * `packages/app-shell/src/index.ts` re-exports the metadata-admin names from
 * their LEAF modules rather than from `views/metadata-admin/index.ts`, and that
 * the five load-time registrations moved to
 * `views/metadata-admin/register-builtins.ts`. Doing the `lazy()` here WITHOUT
 * the other half is the smallest, most in-fence-looking version of this change,
 * and it is worth almost nothing:
 *
 * Measured on `fab4802e3` — a full console build of that commit with ONLY this
 * file's two registrations turned into `lazy()` values, against the same
 * commit unmodified:
 *
 *   eager closure         3,254,230 -> 3,254,441 B gzipped   (+211 B)
 *   `metadata-admin` chunk  172,945 ->   173,341 B gzipped   (+396 B)
 *   eager chunk count            45 ->        45 of 513      (UNCHANGED)
 *   the chunk itself                        still EAGER
 *
 * So it does not merely fail to pay — it costs bytes in both places, and it is
 * the `lazy()`/`Suspense` scaffolding itself that it spends them on. And every
 * gate stays GREEN while it does: that build exits 0, the
 * `ineffective-dynamic-import` ledger prints its usual 43 pinned entries with no
 * 44th, and `declared-lazy-views` prints "2 eager, all pinned". The ledger
 * cannot see this because the static edge that defeats the `import()` does not
 * live in this module at all — it lives in the package barrel's re-export. That
 * is the objectui#5486 shape: code that CLAIMS a code split it does not have,
 * with a loading fallback no user can ever reach.
 *
 * (The ruling that ordered this comment predicted −30 B and +189 B. The
 * direction of the chunk growth and the green gates reproduced; the closure
 * figure did not, and it came back POSITIVE. The measured numbers are the ones
 * above.)
 *
 * ⚠️ And a second, INDEPENDENT rebuild of the same variant disagreed with that
 * closure figure on its SIGN: −7 B where the run above measured +211 B. Both
 * stand as what their run measured; together they say only that this delta is
 * small and sensitive to the exact byte-form of the edit, so the sign is not a
 * finding and neither is the "it costs bytes" reading of it. What both
 * rebuilds reproduced identically IS the finding: the chunk stays EAGER and the
 * eager chunk count stays 45 of 513 (build exit 0, every gate green). Cite
 * those two, never a signed byte delta.
 *
 * So: a `lazy()` in this file is only ever true when nothing in the package's
 * EAGER graph still names the same module statically. Check the barrel first,
 * and measure from `apps/console/dist/eager-closure.json` and the emitted
 * chunk's own module list — never from a source-level search, which cannot see
 * chunk co-tenancy (objectui#6680, objectui#6681).
 */
const MetadataDirectoryPage = lazy(() =>
  import('../views/metadata-admin/index.js').then((m) => ({ default: m.MetadataDirectoryPage })),
);
const MetadataResourceRouter = lazy(() =>
  import('../views/metadata-admin/index.js').then((m) => ({ default: m.MetadataResourceRouter })),
);

function MetadataAdminFallback({ label }: { label: string }) {
  return <div className="p-6 text-sm text-muted-foreground">Loading {label}…</div>;
}

/**
 * The Suspense boundary lives INSIDE the registration value, which is the shape
 * every other lazy `registerAppComponent` entry already uses
 * (`apps/console/src/registerAccountComponents.tsx`,
 * `registerDeveloperComponents.tsx`, `registerApprovalsComponents.tsx`). It
 * keeps `registerAppComponent`'s published signature unchanged — a component
 * VALUE, as before — and it means no render site has to learn about pending.
 */
registerAppComponent({
  ref: 'metadata:directory',
  label: 'All Metadata Types',
  source: '@object-ui/app-shell',
  component: (props: any) => (
    <Suspense fallback={<MetadataAdminFallback label="metadata types" />}>
      <MetadataDirectoryPage {...props} />
    </Suspense>
  ),
});

registerAppComponent({
  ref: 'metadata:resource',
  label: 'Metadata Resource',
  source: '@object-ui/app-shell',
  component: (props: any) => (
    <Suspense fallback={<MetadataAdminFallback label="metadata resource" />}>
      <MetadataResourceRouter {...props} />
    </Suspense>
  ),
});

registerAppComponent({
  ref: 'developer:packages',
  label: 'Packages',
  source: '@object-ui/app-shell',
  component: PackagesPage,
});

/**
 * ADR-0126 §7.4 — the Setup page for the flows installed packages ship:
 * on/off for this scope, and clone. Contributed the way every other
 * framework-owned Setup surface is, by ref rather than by route, so the Setup
 * app's navigation names `automation:packaged` and `ComponentNavView` resolves
 * it. Automation AUTHORING stays in Studio; this page is operational state.
 */
registerAppComponent({
  ref: 'automation:packaged',
  label: 'Packaged Automation',
  source: '@object-ui/app-shell',
  component: PackagedAutomationPage,
});

/* -------------------------------------------------------------------------- */
/* 2) Generic resources — list + JSONSchema-driven form for every type.       */
/* -------------------------------------------------------------------------- */

registerMetadataResource({
  type: 'object',
  label: 'Objects',
  description: 'Domain entities — tables in the data model. Each object owns its fields, relationships, validations, and lifecycle hooks.',
  domain: 'data',
  searchableFields: ['name', 'label', 'description'],
  listColumns: [
    { key: 'name', label: 'Name', width: '25%' },
    { key: 'label', label: 'Label', width: '25%' },
    { key: 'description', label: 'Description' },
  ],
  // objectui#10202 — the editor is seeded from the SERVED object, where a
  // picklist-bound field carries `picklist` plus the options resolved from the
  // list; the authoring door refuses the two together. The saved body drops
  // those resolved `options` from every picklist-bound field and touches
  // nothing else. The draft is not changed, so the canvas keeps showing the
  // list's options. See `dropServedPicklistOptions`.
  fromDraft: dropServedPicklistOptions,
});

registerMetadataResource({
  type: 'field',
  label: 'Fields',
  description: 'Columns attached to objects — name, type, validation, and storage settings.',
  domain: 'data',
  searchableFields: ['name', 'label', 'object', 'type'],
  listColumns: [
    { key: 'name', label: 'Name', width: '25%' },
    { key: 'object', label: 'Object', width: '20%' },
    { key: 'type', label: 'Type', width: '15%' },
    { key: 'label', label: 'Label' },
  ],
});

/* -------------------------------------------------------------------------- */
/* 3) Permission matrix editor — replaces the generic AutoForm for           */
/*    `type=permission` with a Salesforce-style grid (Phase 3e).             */
/* -------------------------------------------------------------------------- */

registerMetadataResource({
  type: 'permission',
  label: 'Permission sets',
  description: 'Object-level CRUD + VAMA + lifecycle permissions, and field-level R/W. The only capability container (ADR-0090); distributed to users via positions.',
  domain: 'security',
  EditPage: PermissionMatrixEditPage,
  searchableFields: ['name', 'label'],
  // objectui#7611 — no `managedBy` column: the registry serves no such key on a
  // permission set (measured on objectstack main), so it read "Custom" for every
  // set, the platform's own included. Provenance is the list's own Source badge,
  // read from the served `_packageId` / `_provenance`.
  listColumns: [
    { key: 'name', label: 'Name', width: '30%' },
    { key: 'label', label: 'Label', width: '30%' },
    { key: 'description', label: 'Description' },
  ],
});

// objectstack#25333 — the position list says who holds each position and which
// permission sets it grants, both served by the server (`?include=grants`) from
// the reader the authorization resolver enforces with.
registerMetadataResource({
  type: 'position',
  domain: 'security',
  listInclude: 'grants',
  listColumns: [
    { key: 'name', label: 'Name', width: '20%' },
    { key: 'label', label: 'Label', width: '20%' },
    {
      key: '_holderCount',
      label: 'Holders',
      width: '10%',
      render: (v) => <PositionHolderCountCell value={v} />,
    },
    {
      key: '_grantedPermissionSets',
      label: 'Permission sets',
      render: (v) => <PositionGrantedSetsCell value={v} />,
    },
  ],
});

/* -------------------------------------------------------------------------- */
/* 4) UI metadata types — list + form. No bespoke visual designers: views,   */
/*    dashboards and pages are authored as JSON metadata; the Preview tab    */
/*    renders them live for verification.                                    */
/* -------------------------------------------------------------------------- */

registerMetadataResource({
  type: 'view',
  label: 'Views',
  description: 'Saved list / kanban / calendar / gantt configurations on top of an object.',
  domain: 'ui',
  listColumns: [
    { key: 'name', label: 'Name', width: '30%' },
    { key: 'object', label: 'Object', width: '20%' },
    {
      key: 'type',
      label: 'Type',
      width: '15%',
      // Expanded ViewItems keep their display type under `config.type`
      // and only the list/form family at the top level — derive it so the
      // column shows "calendar" / "grid" / "form" instead of "—".
      render: (_v, item) => viewDisplayType(item) ?? '—',
    },
    { key: 'label', label: 'Label' },
  ],
  // ADR-0017 — the framework exposes each view as a canonical first-class
  // ViewItem ({ name, object, viewKind, label, config }). The inspector and
  // preview read that shape directly (`draft.config`), so NO toDraft/fromDraft
  // adapter is wired here — the canonical shape round-trips untouched.
  // Hide the bare aggregated container the framework keeps for runtime
  // dual-read — its views are already listed as expanded ViewItems.
  listFilter: (item) => !isAggregatedViewContainer(item),
});

registerMetadataResource({
  type: 'dashboard',
  label: 'Dashboards',
  description: 'Composed dashboards with charts, KPIs, and tables.',
  domain: 'ui',
  listColumns: [
    { key: 'name', label: 'Name', width: '30%' },
    { key: 'label', label: 'Label', width: '30%' },
    { key: 'description', label: 'Description' },
  ],
});

/**
 * The body the page editor saves: the draft without `requires` (objectui#11357).
 *
 * An html page's `requires` is the server's stamp, not something the author
 * writes: the save door compiles the `source` and stamps the namespaces it uses
 * (ADR-0080 §5). The editor's draft is seeded from the served document, so it
 * holds the last stamp; sent back, that stamp reads as a hand-written list, and
 * once the source gains a plugin component the publish refuses it
 * (`page-requires-disagrees-with-source`). Leaving the key out lets the server
 * stamp it fresh on every save.
 *
 * ⛔ Never recompute `requires` here: the server owns the stamp, and it still
 * refuses a hand-written list that disagrees with the source. The draft itself
 * is not touched, so the editor keeps showing the stamp it last read.
 */
function pageSaveBody(draft: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(draft, 'requires')) return draft;
  const body = { ...draft };
  delete body.requires;
  return body;
}

registerMetadataResource({
  type: 'page',
  label: 'Pages',
  description: 'Visual page layouts authored as JSON metadata.',
  domain: 'ui',
  listColumns: [
    { key: 'name', label: 'Name', width: '30%' },
    { key: 'label', label: 'Label', width: '30%' },
    { key: 'route', label: 'Route' },
  ],
  fromDraft: pageSaveBody,
});

/* -------------------------------------------------------------------------- */
/* 5) Documentation — the `book` navigation spine (ADR-0046 §6). A book is an  */
/*    ordered set of groups whose membership over docs is DERIVED from each    */
/*    group's include rule; the Preview tab renders that spine for authoring.  */
/* -------------------------------------------------------------------------- */

registerMetadataResource({
  type: 'book',
  label: 'Documentation Books',
  description: 'Documentation navigation spine — ordered groups with membership derived over docs (glob/tag rules), plus an explicit pages override for curated order.',
  domain: 'system',
  searchableFields: ['name', 'label', 'description', 'slug'],
  listColumns: [
    { key: 'name', label: 'Name', width: '25%' },
    { key: 'label', label: 'Label', width: '25%' },
    {
      key: 'audience',
      label: 'Audience',
      width: '12%',
      render: (v) =>
        v == null
          ? 'org'
          : typeof v === 'object' && v && 'permissionSet' in (v as Record<string, unknown>)
            ? `permission set: ${(v as { permissionSet: string }).permissionSet}`
            : String(v),
    },
    {
      key: 'groups',
      label: 'Groups',
      width: '10%',
      render: (v) => (Array.isArray(v) ? String(v.length) : '0'),
    },
    { key: 'description', label: 'Description' },
  ],
});
