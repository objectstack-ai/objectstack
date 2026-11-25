// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's "All metadata" area (objectstack ADR-0146 D1, #28561): the type
 * directory, the lists, the generic item page, history and diagnostics, per
 * package beside the four pillars and across packages for the environment
 * catalog.
 *
 * The pages are the metadata-admin pages Setup mounts today, MOUNTED here, not
 * copied, under the same route shapes (`metadataArea.ts` names the two legs):
 *
 *   <root>                     the type directory
 *   <root>/_diagnostics        diagnostics
 *   <root>/:type               a type's list
 *   <root>/:type/new           create (a writable package only)
 *   <root>/:type/:name         the generic item page, the item's pillar, the
 *                              flow designer full-screen (#36903), or the
 *                              form editor of an email template or a
 *                              translation (`StudioBundleItemEditor`, #28569),
 *                              and of a read-only package's dataset (#30064),
 *                              or a permission set's full-screen matrix
 *                              (`StudioPermissionSetPage`, #36905)
 *   <root>/:type/:name/history the item's history: its History tab
 *                              (`?tab=history`), the old address redirected;
 *                              the history page for a type with an editor of
 *                              its own
 *
 * Mirroring Setup's shapes keeps every relative link the pages emit pointing
 * where it points there. What the area adds, it hands the pages through
 * {@link MetadataAreaHostContext}: the package, its read-only state and the
 * root. "No new write path": a writable package's pages save exactly as Setup's
 * do with `?package=`, through the same components and doors.
 *
 * Assignments are Setup's (D7): the pages read the host and link the Setup
 * assignment pages instead of drawing them. The datasource is Setup's runtime
 * configuration: its URLs here open Setup's Datasources page.
 */

import * as React from 'react';
import { Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  MetadataAreaHostContext,
  SETUP_DATASOURCES_PATH,
  useMetadataAreaHost,
  type MetadataAreaHost,
} from '../metadata-admin/metadataAreaHost.js';
import { t, useMetadataLocale } from '../metadata-admin/i18n.js';
import { fetchListedPackageManifests } from './packages-io.js';
import {
  STUDIO_ALL_PACKAGES_SEGMENT,
  areaItemAsksGenericPage,
  areaItemOpensDesignerPage,
  areaItemOpensFormEditor,
  areaItemPillarPath,
  areaLocationRedirect,
  studioMetadataAreaPath,
} from './metadataArea.js';
import { STUDIO_ORG_SCOPE_SEGMENT } from './studioScope.js';
import { STUDIO_ORG_SCOPE_TYPE } from './studioAddress.js';
import { StudioBundleItemEditor } from './StudioBundleItemEditor.js';
import { AutomationsPillar } from './AutomationsPillar.js';
import { StudioPermissionSetPage } from './StudioPermissionSetPage.js';
import { BUNDLE_MEMBER_PARAM, getMetadataResource } from '../metadata-admin/registry.js';
import { ITEM_TOOL_TAB_PARAM } from '../item-tools/ItemToolTabs.js';
import type { StudioBaseCustomization } from './StudioDesignSurface.js';
import type { StudioRefusal } from './metadataError.js';
import type { StudioSurfaceLabel } from './StudioAiCopilot.js';

/*
 * The pages load with the area, through the specifier `AppContent` loads them
 * by (`../metadata-admin/index.js`), so Studio and Setup share their one chunk
 * and the Studio builder's own chunk does not grow by them.
 */
const MetadataDirectoryPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataDirectoryPage })),
);
const MetadataDiagnosticsPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataDiagnosticsPage })),
);
const MetadataResourceListPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataResourceListPage })),
);
const MetadataResourceEditPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataResourceEditPage })),
);
const MetadataResourceHistoryPage = React.lazy(() =>
  import('../metadata-admin/index.js').then((m) => ({ default: m.MetadataResourceHistoryPage })),
);

/**
 * Is this package writable, as `GET /api/v1/packages` says? `undefined` while
 * asking, `null` when the list could not say (the read failed, or it lists no
 * such id).
 *
 * Read from the listed manifests, which keep the kernel packages the
 * switcher's entries hide: the surface's own courtesy gate reads the switcher's
 * entries, so a kernel package reads as "unknown" there, and the generic item
 * page would then offer its overlay save on a package nobody may write. The
 * verdict rule is the one `parsePackages` applies. One request either way: the
 * readers of that endpoint share it (`packages-io.ts`).
 */
function useListedPackageWritable(packageId: string | null): { writable: boolean | null | undefined; kernel: boolean } {
  const [answer, setAnswer] = React.useState<{ id: string; writable: boolean | null; kernel: boolean } | null>(null);
  React.useEffect(() => {
    if (packageId === null) return;
    let cancelled = false;
    fetchListedPackageManifests().then(
      (manifests) => {
        if (cancelled) return;
        const listed = manifests.get(packageId);
        // objectstack#36897 — a kernel package (manifest scope `system` or
        // `cloud`) has no pair: the ensure door refuses it (ADR-0146 D3).
        const scope = listed?.manifest?.scope;
        setAnswer({ id: packageId, writable: listed?.writable ?? null, kernel: scope === 'system' || scope === 'cloud' });
      },
      () => {
        // The surface reports the failure once (its package-list toast).
        if (!cancelled) setAnswer({ id: packageId, writable: null, kernel: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [packageId]);
  if (packageId === null) return { writable: null, kernel: false };
  return answer?.id === packageId ? { writable: answer.writable, kernel: answer.kernel } : { writable: undefined, kernel: false };
}

function AreaLoading({ locale }: { locale: string }): React.ReactElement {
  return (
    <div role="status" className="p-6 text-sm text-muted-foreground">
      {t('engine.studio.loading', locale)}
    </div>
  );
}

/** What the Studio surface hands the area's editors (`StudioBundleItemEditor`, the flow designer). */
interface AreaEditorProps {
  customization: StudioBaseCustomization | null;
  publishNonce: number;
  onDraftSaved?: (saved?: { type: string; name: string }) => void;
  publishRefusalFor?: (type: string, name: string) => StudioRefusal | null;
  /** objectstack#36903 — the area is the package-less scope's: its flows open writable, with no package. */
  orgScope?: boolean;
  /** objectstack#36903 — the flow designer's report to the surface: its held edit. */
  onHeldEditChange?: (clause: string | null) => void;
  /** objectstack#36905, objectstack#36903 — a designer page's open item label, for the copilot's chip. */
  onSurfaceLabelChange?: (surface: StudioSurfaceLabel | null) => void;
}

/**
 * `<root>/:type/:name`: a pillar type opens its pillar, a flow its designer
 * full-screen (`areaItemOpensDesignerPage`), an email template or a
 * translation the form editor (`areaItemOpensFormEditor`), every other type
 * the generic item page (`areaItemPillarPath` lists when).
 *
 * Decided once per item, when it opens (the item is the key below): the item
 * page itself rewrites the query it opened with (it drops `?review=1` once the
 * review sheet is open), and that must not send an open review on to the
 * pillar.
 */
function AreaItem({ editor }: { editor: AreaEditorProps }): React.ReactElement {
  const { type = '', name = '' } = useParams<{ type: string; name: string }>();
  const [search] = useSearchParams();
  // One editor buffer per member: two locales of one template are two items.
  const member = search.get(BUNDLE_MEMBER_PARAM) ?? '';
  // A type never holds a `/`, so this names one item.
  return <AreaItemOpen key={`${type}/${name}/${member}`} type={type} name={name} editor={editor} />;
}

function AreaItemOpen({
  type,
  name,
  editor,
}: {
  type: string;
  name: string;
  editor: AreaEditorProps;
}): React.ReactElement {
  const [search] = useSearchParams();
  const host = useMetadataAreaHost();
  const [opens] = React.useState(() => {
    const at = { packageId: host?.packageId ?? null, type, search };
    // objectstack#36903 — the package-less scope's area holds its flows
    // alone, and a flow there opens the flow designer as on a package's leg.
    const designer =
      (areaItemOpensDesignerPage(at) || (editor.orgScope === true && type === STUDIO_ORG_SCOPE_TYPE)) &&
      !areaItemAsksGenericPage(search);
    if (designer) return { designer: true, formEditor: false, pillarPath: null };
    if (areaItemOpensFormEditor({ ...at, readOnly: host?.readOnly === true })) return { designer: false, formEditor: true, pillarPath: null };
    return { designer: false, formEditor: false, pillarPath: areaItemPillarPath({ ...at, name }) };
  });
  if (opens.pillarPath) return <Navigate to={opens.pillarPath} replace />;
  if (opens.designer && type === 'flow') {
    // objectstack#36903 — the flow designer, full-screen on the flow's
    // address. The package-less scope's flows are the organization's own and
    // open writable (its area is read-only to the list's create alone).
    return (
      <div className="h-full min-h-0" data-testid="studio-flow-designer">
        <AutomationsPillar
          packageId={host?.packageId ?? null}
          flowName={name}
          readOnly={editor.orgScope ? false : host?.readOnly === true}
          customization={editor.orgScope ? null : editor.customization}
          publishNonce={editor.publishNonce}
          onDraftSaved={editor.onDraftSaved}
          onHeldEditChange={editor.onHeldEditChange}
          onSurfaceLabelChange={editor.onSurfaceLabelChange}
        />
      </div>
    );
  }
  // objectstack#36905 — a permission set opens its matrix full-screen here.
  if (opens.designer && host?.packageId) {
    return (
      <StudioPermissionSetPage
        packageId={host.packageId}
        name={name}
        readOnly={host.readOnly}
        publishNonce={editor.publishNonce}
        onDraftSaved={editor.onDraftSaved ? () => editor.onDraftSaved?.({ type, name }) : undefined}
        onSurfaceLabelChange={editor.onSurfaceLabelChange}
      />
    );
  }
  if (opens.formEditor && host?.packageId) {
    return (
      <StudioBundleItemEditor
        packageId={host.packageId}
        type={type}
        name={name}
        member={search.get(BUNDLE_MEMBER_PARAM) || undefined}
        readOnly={host.readOnly}
        customization={editor.customization}
        publishNonce={editor.publishNonce}
        onDraftSaved={editor.onDraftSaved}
        publishRefusal={editor.publishRefusalFor?.(type, name) ?? null}
        basePath={host.basePath}
      />
    );
  }
  return <MetadataResourceEditPage />;
}

/**
 * `<root>/:type/:name/history`: the item's history is its page's History tab
 * (objectstack#36901, decision 8), so the standalone address opens the item
 * on that tab, its query kept (`?package=`, `?member=`, the list context).
 * Cut from the path as it is spelled, so an encoded name stays encoded.
 *
 * A type whose item page is an editor of its own (`registerMetadataResource`'s
 * `EditPage`: the permission set's matrix) has no tabs on the cross-package
 * leg, and its History button opens this address there: it keeps the
 * standalone history page. So does an item whose address opens a pillar's
 * designer, until the designer mounts the tabs. objectstack#36905 — on a
 * package's leg the permission set's full-screen page has them.
 * objectstack#36903 — so does the flow designer, on its address with History
 * as a tab: a flow's `/history` opens that tab like every item's.
 */
function AreaHistoryRedirect(): React.ReactElement {
  const { type = '', name = '' } = useParams<{ type: string; name: string }>();
  const { pathname, search } = useLocation();
  const host = useMetadataAreaHost();
  const params = new URLSearchParams(search);
  const designerPage = areaItemOpensDesignerPage({ packageId: host?.packageId ?? null, type });
  const ownEditor = !designerPage && !!getMetadataResource(type)?.EditPage;
  // An item a pillar's designer opens has no tab row yet (its tabs are the
  // designers' cards): its history keeps the standalone page too.
  const pillarItem = areaItemPillarPath({ packageId: host?.packageId ?? null, type, name, search: params }) !== null;
  if (ownEditor || pillarItem) return <MetadataResourceHistoryPage />;
  params.set(ITEM_TOOL_TAB_PARAM, 'history');
  return <Navigate to={{ pathname: pathname.replace(/\/history\/?$/, ''), search: `?${params}` }} replace />;
}

/**
 * `<root>/:type/new`. A read-only package takes no new item of its own:
 * objectstack#36897 — on a read-only base the create is its `.custom` pair's
 * (ADR-0146 D3), asked of the ensure door and opened there; where the door
 * refuses this caller (`customization.walled`), the package is a kernel
 * package (which has no pair), or there is no base to pair,
 * the create URL lands on the list, as before.
 */
function AreaCreate({ customization }: { customization: StudioBaseCustomization | null }): React.ReactElement {
  const { type = '' } = useParams<{ type: string }>();
  const { search } = useLocation();
  const host = useMetadataAreaHost();
  if (host?.readOnly) {
    if (customization && host.pairCreate) {
      return <AreaPairedCreate type={type} search={search} customization={customization} />;
    }
    return <Navigate to={`${host.basePath}/${encodeURIComponent(type)}${search}`} replace />;
  }
  return <MetadataResourceEditPage createMode />;
}

/** The create of a read-only base's pair: the ensure door names the pair (creating it on first use), then its create opens. */
function AreaPairedCreate({
  type,
  search,
  customization,
}: {
  type: string;
  search: string;
  customization: StudioBaseCustomization;
}): React.ReactElement {
  const locale = useMetadataLocale();
  const [answer, setAnswer] = React.useState<{ to: string } | { error: string } | null>(null);
  // Asked once per create: the surface may hand a new `customization` on any render.
  const ensureRef = React.useRef(customization.ensurePackage);
  ensureRef.current = customization.ensurePackage;
  React.useEffect(() => {
    let cancelled = false;
    ensureRef.current().then(
      (pair) => {
        if (cancelled) return;
        const query = new URLSearchParams(search);
        query.set('package', pair.packageId);
        setAnswer({ to: `${studioMetadataAreaPath(pair.packageId)}/${encodeURIComponent(type)}/new?${query.toString()}` });
      },
      (e: unknown) => {
        if (!cancelled) setAnswer({ error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [type, search]);
  if (answer && 'to' in answer) return <Navigate to={answer.to} replace />;
  if (answer) {
    return (
      <div role="alert" className="p-6 text-sm text-destructive" data-testid="studio-area-pair-create-refused">
        {answer.error}
      </div>
    );
  }
  return <AreaLoading locale={locale} />;
}

export interface StudioMetadataAreaProps {
  /** The package the area is open on, or `null` for the cross-package leg. */
  packageId: string | null;
  /**
   * objectstack#28569 — on a read-only base, what the surface customizes it
   * with (the Interfaces pillar's `StudioBaseCustomization`): the form editor
   * offers Customize from it. `null` otherwise.
   */
  customization?: StudioBaseCustomization | null;
  /** Bumped by the header's Publish: the form editor re-reads what is served. */
  publishNonce?: number;
  /** Told when the form editor saves a draft, so the header's pending count follows it. */
  onDraftSaved?: (saved?: { type: string; name: string }) => void;
  /**
   * objectstack#30064 — what the header's last Publish refused for an item,
   * kept until it is resolved (objectstack#26730): the form editor shows it
   * at the item it refused.
   */
  publishRefusalFor?: (type: string, name: string) => StudioRefusal | null;
  /**
   * objectstack#36903 — the area of the package-less scope (`~org`, with no
   * `packageId`): its flows, listed and opened full-screen. It creates nothing
   * (`studioScope.ts`), so its host is read-only to the list's create.
   */
  orgScope?: boolean;
  /** objectstack#36903 — handed to the flow designer (`AreaEditorProps`). */
  onHeldEditChange?: (clause: string | null) => void;
  /**
   * objectstack#36905, objectstack#36903 — told the open designer page's item
   * label (the permission set's, the flow's), for the copilot's chip, as a
   * pillar tells it.
   */
  onSurfaceLabelChange?: (surface: StudioSurfaceLabel | null) => void;
}

export function StudioMetadataArea({
  packageId,
  customization = null,
  publishNonce = 0,
  onDraftSaved,
  publishRefusalFor,
  orgScope = false,
  onHeldEditChange,
  onSurfaceLabelChange,
}: StudioMetadataAreaProps): React.ReactElement {
  const { pathname, search } = useLocation();
  const locale = useMetadataLocale();
  const segment = packageId ?? (orgScope ? STUDIO_ORG_SCOPE_SEGMENT : STUDIO_ALL_PACKAGES_SEGMENT);
  const basePath = studioMetadataAreaPath(segment);
  // The courtesy gate the pillars apply, read for the area from the listed
  // manifests (see the hook). Unknown stays ungated, as on the pillars: the
  // server's write gate is the authority, and a failed probe must not lock an
  // author out of a writable package.
  const { writable, kernel } = useListedPackageWritable(packageId);
  // objectstack#36903 — the package-less scope creates nothing: read-only to
  // the list's create (its designer opens writable, `AreaItemOpen`).
  const readOnly = orgScope || (packageId !== null && writable === false);
  // objectstack#36897 — the list offers a create exactly where `AreaCreate`
  // opens one in the pair; never on a kernel package, which has none.
  const pairCreate = readOnly && !kernel && !!customization && !customization.walled;
  // objectstack#36903 — the scope's empty flow list keeps the guidance its
  // pillar's empty state gave: a packaged flow is changed in its package, with
  // New similar (ADR-0146 D11).
  const emptyListHint = orgScope ? t('engine.studio.org.none', locale) : undefined;
  const host = React.useMemo<MetadataAreaHost>(
    () => ({
      packageId,
      readOnly,
      basePath,
      ...(pairCreate ? { pairCreate } : {}),
      ...(emptyListHint ? { emptyListHint } : {}),
    }),
    [packageId, readOnly, basePath, pairCreate, emptyListHint],
  );
  const editor: AreaEditorProps = {
    customization,
    publishNonce,
    onDraftSaved,
    publishRefusalFor,
    orgScope,
    onHeldEditChange,
    onSurfaceLabelChange,
  };

  // The query names the leg (`areaLocationRedirect`). Settled before any page
  // mounts, so no page reads a scope the URL is about to change.
  const rest = pathname.startsWith(basePath) ? pathname.slice(basePath.length).replace(/^\/+/, '') : '';
  const redirect = areaLocationRedirect(segment, rest, search);
  if (redirect) return <Navigate to={redirect} replace />;
  // A page must not offer a write before the package's state is known.
  if (packageId !== null && writable === undefined) return <AreaLoading locale={locale} />;

  return (
    <MetadataAreaHostContext.Provider value={host}>
      <div className="h-full overflow-hidden" data-testid="studio-metadata-area">
        <React.Suspense fallback={<AreaLoading locale={locale} />}>
          <Routes>
            <Route index element={<MetadataDirectoryPage />} />
            <Route path="_diagnostics" element={<MetadataDiagnosticsPage />} />
            <Route path="datasource/*" element={<Navigate to={SETUP_DATASOURCES_PATH} replace />} />
            <Route path=":type" element={<MetadataResourceListPage />} />
            <Route path=":type/new" element={<AreaCreate customization={customization} />} />
            <Route path=":type/:name" element={<AreaItem editor={editor} />} />
            <Route path=":type/:name/history" element={<AreaHistoryRedirect />} />
          </Routes>
        </React.Suspense>
      </div>
    </MetadataAreaHostContext.Provider>
  );
}
