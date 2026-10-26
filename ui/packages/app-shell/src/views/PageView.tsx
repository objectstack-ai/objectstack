/**
 * Page View Component
 *
 * Renders a custom page based on the pageName parameter. Page *authoring*
 * happens in the metadata studio (canvas + inspector), not here — runtime is
 * pure rendering. For parity with the view/report/dashboard runtime editors,
 * metadata authors get a lightweight "Edit in studio" affordance that
 * deep-links to the page's design surface in Studio's Interfaces pillar
 * (`/studio/PACKAGE/interfaces?surface=page:NAME`) rather than embedding the
 * heavyweight page canvas in the runtime. It is the path the app bar's pencil,
 * the app switcher's Studio row and the sidebar's Design open for the same
 * page, built by the same `appStudioRoutePath` (objectui#12540).
 */

import { lazy, Suspense, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation, useHref } from 'react-router-dom';
import {
  ElementDataSourceGate,
  SchemaRenderer,
  classifyLoadError,
  noDataSourceMessage,
  notifyDataChanged,
  useAdapter,
  useDataInvalidation,
  useFilterScope,
  useResolvedFilter,
  type ElementDataSourceMapping,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import { isElementDataSourceConfig } from '@object-ui/core';
import type { DataSource, QueryParams } from '@object-ui/types';
import { Button, Empty, EmptyTitle, EmptyDescription, Spinner } from '@object-ui/components';
import { AlertTriangle, FileText, Pencil, RotateCw } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { MetadataPanel, useMetadataInspector } from './MetadataInspector.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { PageRecordScope, useExpressionContext } from '../providers/ExpressionProvider.js';
import { preferLocal } from '../utils/preferLocal.js';
import { appStudioRoutePath } from '../utils/appRoute.js';
import { ConsoleActionRuntimeProvider } from '../hooks/useConsoleActionRuntime.js';
import { useStudioDesignGate } from '../hooks/useStudioDesignGate.js';
import { pageRecordActionsValue } from './pageRecordActions.js';
import { RelatedRecordActionsBridge } from './RelatedRecordActionsBridge.js';
import { pageKindNode } from './pageKindNode.js';
import { readPageObjectScope } from '../console/appObjectScope.js';

/**
 * Only an interface page (ADR-0047, `interfaceConfig.source`) draws
 * `InterfaceListPage`, so it loads when such a page renders (objectui#12187).
 * Imported statically, its chunk loaded with every page route, before the
 * content of pages that never draw a list. The chunk is shared with the
 * Studio's page preview and the object data page, so it is its own chunk and
 * this edge is what decided whether a plain page fetched it.
 */
const InterfaceListPage = lazy(() =>
  import('./InterfaceListPage.js').then((m) => ({ default: m.InterfaceListPage })),
);

/**
 * After a successful page-level action, declare the change on the
 * data-invalidation bus so every embedded block that reads it refetches IN
 * PLACE (AGENTS.md #8's corollary: refresh data, don't rebuild UI). A page
 * binds no object and the runtime's refresh carries none, so the scope is the
 * bus's documented unknown-scope value.
 *
 * This host used to bump a counter into the `key` of both render branches
 * below, which remounted the whole page on every page action: scroll, collapsed
 * sections and in-progress edits in every block went with it, and every block
 * refetched from scratch (objectui#10519). Both branches are now keyed on
 * identity; `no-refresh-key-remount.ratchet` holds this file in scope.
 * Module-level so its identity is stable across renders (the runtime names it
 * in dependency lists).
 */
function declarePageDataChanged(): void {
  notifyDataChanged({ objectName: '*' });
}

/**
 * The page's `record` binding (`@objectstack/spec` `PageSchema.record`,
 * objectstack#24265) when this page declares one the reader below can run: on
 * an `app` page only, as the spec places it, and only a binding that names its
 * object. Anything else is "no binding": the page renders exactly as before,
 * with `record` unbound (objectui#12931).
 */
function appPageRecordBinding(page: Record<string, unknown>): Record<string, unknown> | undefined {
  if (page.type !== 'app') return undefined;
  return isElementDataSourceConfig(page.record) ? (page.record as unknown as Record<string, unknown>) : undefined;
}

/**
 * What the gate lands for the page row: the bound object on `objectName`, the
 * named view's filter AND-combined with the binding's, and the sort. There is
 * no `limit`: one row is read, whatever the set holds.
 */
const PAGE_RECORD_MAPPING: ElementDataSourceMapping = { filter: true, sort: true };
const PAGE_RECORD_TEST_ID = 'page-record';

type PageRow = Record<string, unknown>;

/** One settled read of the page row, tagged with the query it answered. */
type PageRowRead =
  | { key: string; status: 'loaded'; row: PageRow | null }
  | { key: string; status: 'failed' };

/** The first row of a `find` answer: `QueryResult.data`, or a bare array. */
const firstRow = (result: unknown): PageRow | null => {
  const rows = (result as { data?: unknown } | null | undefined)?.data ?? result;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row && typeof row === 'object' && !Array.isArray(row) ? (row as PageRow) : null;
};

const sameRow = (a: PageRow | null, b: PageRow | null): boolean =>
  a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/**
 * Read an `app` page's bound row and give the page's predicates `record`
 * (objectui#12931).
 *
 * The binding is resolved by `ElementDataSourceGate`, as a block's one-record
 * binding is (`ParentRecordBinding` in `@object-ui/plugin-detail`): the named
 * view, the AND-combined filter, the sort, and the family's panels for a view
 * that does not resolve, a refused filter, or no adapter. Each of those panels
 * stands where the page body would be.
 */
function AppPageRecord({
  binding,
  dataSource,
  children,
}: {
  binding: Record<string, unknown> | undefined;
  dataSource: unknown;
  children: ReactNode;
}): ReactElement {
  // No binding: the children as they are — no gate, no read, no scope.
  if (!binding) return <>{children}</>;
  return (
    <AppPageRecordGate binding={binding} dataSource={dataSource}>
      {children}
    </AppPageRecordGate>
  );
}

function AppPageRecordGate({
  binding,
  dataSource,
  children,
}: {
  binding: Record<string, unknown>;
  dataSource: unknown;
  children: ReactNode;
}): ReactElement {
  // Memoised for cost only (AGENTS.md #10): the read below keys on the strings
  // the gate lands, never on this object.
  const gateSchema = useMemo(() => ({ dataSource: binding }), [binding]);
  return (
    <ElementDataSourceGate
      schema={gateSchema}
      mapping={PAGE_RECORD_MAPPING}
      dataSource={dataSource}
      testId={PAGE_RECORD_TEST_ID}
      requiresDataSource
      noDataSourceMessage={noDataSourceMessage('page record', binding.object)}
    >
      {(landed) => {
        // A composed binding always names its object (`isElementDataSourceConfig`).
        const { objectName, filter, sort } = landed as { objectName?: unknown; filter?: unknown; sort?: unknown };
        return (
          <AppPageRecordRead
            object={typeof objectName === 'string' ? objectName : ''}
            filter={filter}
            sort={sort}
            dataSource={dataSource as DataSource}
          >
            {children}
          </AppPageRecordRead>
        );
      }}
    </ElementDataSourceGate>
  );
}

/**
 * The one-row read itself, and the three states a predicate can see.
 *
 * - **Pending.** Until the read settles, the page body is not drawn: no
 *   `visibleWhen` reading `record` is evaluated, so none can show and then
 *   vanish, or the reverse. This is the record blocks' convention for their
 *   one-record binding (`BoundRecordProvider`: nothing under the row until it
 *   lands), drawn as this page's own loading state.
 * - **No row.** The set is empty, or the server refused the read
 *   (`classifyLoadError` → `forbidden`): `record` is bound as `null`, so "absent"
 *   and "not yours to read" read the same.
 * - **Failed.** Any other rejection: the page body is not drawn, so every
 *   predicate on it is closed, and the record page's failed-read state stands
 *   in its place, with the same copy and a Retry that re-runs this read.
 *
 * Read once per page open, under the caller's identity with the adapter the
 * page already uses, as `$top: 1` — the first row of the set under `sort`. The
 * filter's placeholder tokens resolve the way every bound block's do
 * (`useResolvedFilter` over `useFilterScope`). A write to the bound object (the
 * data-invalidation bus) re-reads in place, keeping the row on screen; an equal
 * answer keeps the row object it replaces (AGENTS.md #10).
 */
function AppPageRecordRead({
  object,
  filter,
  sort,
  dataSource,
  children,
}: {
  object: string;
  filter: unknown;
  sort: unknown;
  dataSource: DataSource;
  children: ReactNode;
}): ReactElement {
  const { t } = useObjectTranslation();
  const queryFilter = useResolvedFilter(filter, useFilterScope());
  const filterKey = queryFilter === undefined ? '' : JSON.stringify(queryFilter);
  const sortKey = sort === undefined ? '' : JSON.stringify(sort);
  const readKey = JSON.stringify([object, filterKey, sortKey]);
  const invalidationNonce = useDataInvalidation(object);
  // Retry's own counter: a click re-runs this effect, so the retry is the same
  // read, never a second path.
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<PageRowRead | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params: QueryParams = { $top: 1 };
    if (filterKey) params.$filter = JSON.parse(filterKey);
    if (sortKey) params.$orderby = JSON.parse(sortKey);
    Promise.resolve()
      .then(() => dataSource.find(object, params))
      .then(
        (result) => {
          if (cancelled) return;
          const row = firstRow(result);
          setRead((prev) =>
            prev && prev.key === readKey && prev.status === 'loaded' && sameRow(prev.row, row)
              ? prev
              : { key: readKey, status: 'loaded', row },
          );
        },
        (err: unknown) => {
          if (cancelled) return;
          setRead(
            classifyLoadError(err) === 'forbidden'
              ? { key: readKey, status: 'loaded', row: null }
              : { key: readKey, status: 'failed' },
          );
        },
      );
    return () => {
      cancelled = true;
    };
    // Keyed on the query's DATA, never on the objects it was read from.
  }, [dataSource, object, readKey, filterKey, sortKey, invalidationNonce, attempt]);

  const current = read?.key === readKey ? read : null;
  if (!current) {
    return (
      <div className="h-full flex items-center justify-center p-8" data-testid="page-record-loading" aria-busy="true">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }
  if (current.status === 'failed') {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Empty data-testid="page-record-load-failed">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <AlertTriangle className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>
            {t('empty.recordLoadFailed', { defaultValue: 'Couldn’t load this record' })}
          </EmptyTitle>
          <EmptyDescription>
            {t('empty.recordLoadFailedDescription', {
              defaultValue: 'Something went wrong while loading it. Check your connection and try again.',
            })}
          </EmptyDescription>
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              data-testid="page-record-load-failed-retry"
              onClick={() => setAttempt((n) => n + 1)}
            >
              <RotateCw className="mr-1.5 h-4 w-4" />
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        </Empty>
      </div>
    );
  }
  return <PageRecordScope record={current.row}>{children}</PageRecordScope>;
}

export function PageView() {
  const { t } = useObjectTranslation();
  const { pageName } = useParams<{ pageName: string }>();
  const [searchParams] = useSearchParams();
  const { showDebug } = useMetadataInspector();
  const navigate = useNavigate();
  // The router's root href, basename included: the page's record navigator
  // publishes document hrefs from it (objectui#12233).
  const routerRootHref = useHref('/');
  const location = useLocation();
  // ⛔ `objects` is not destructured: reading it loads the whole registry. A
  // page reads the objects it binds (objectui#12980), below.
  const metadata = useMetadata();
  const { pages, getTypeStatus, readObjectScope } = metadata;
  // The objects a block asked for by name that the page does not bind. One
  // set for the page's life, added to while a block renders: never state that
  // re-renders, since the answer landing is what re-renders the page.
  const [requestedObjects] = useState(() => new Set<string>());
  // ADR-0048 Phase 2 — prefer the page owned by the current app's package so
  // two packages shipping `page/<same-name>` each resolve within their own
  // container instead of by load order.
  const { app: activeApp } = useExpressionContext();
  const dataSource = useAdapter();
  const page = preferLocal(pages as any[], pageName, (activeApp as any)?._packageId);

  // Where "Edit in studio" goes: the page's surface in Studio's Interfaces
  // pillar, through the one derivation the app bar's pencil, the app
  // switcher's Studio row and the sidebar's Design share (objectui#12540, the
  // rule objectui#12520 applied to the sidebar), behind the one gate they read
  // (`useStudioDesignGate`, objectui#12615). `null` answers "does the app have
  // an owning package Studio can open", "may this caller author metadata"
  // (a workspace admin holding the server-reported `manage_metadata`: an
  // organization owner is a workspace admin while `organization_admin`
  // withholds it, objectui#10899) and "is that package writable" (a read-only
  // package, or the console's own system apps, would open in Studio
  // browse-only). With any answer no, or no answer yet, the button is not
  // drawn. Asked before the not-found return below, as a hook must be; a page
  // that does not resolve asks nothing.
  // ⛔ No fallback to the metadata-admin page: one intent, one destination.
  const studioPath = useStudioDesignGate(
    page ? appStudioRoutePath(activeApp, true, { type: 'page', name: pageName }) : null,
  );

  if (!page) {
    // `page` metadata is lazy-loaded: on the very first access `pages` is an
    // empty array while the fetch is in flight, which would flash a false
    // "page not found" (or a blank body) — exactly the post-signup landing
    // race where the app's home page is the first thing rendered. Show a
    // loading state until the `page` type is actually resolved, then trust the
    // not-found. (getTypeStatus absent = hand-rolled context = always ready.)
    const pageStatus = getTypeStatus?.('page');
    if (pageStatus === 'idle' || pageStatus === 'loading') {
      return (
        <div className="h-full flex items-center justify-center p-8" data-testid="page-loading">
          <Spinner className="h-5 w-5 text-muted-foreground" />
        </div>
      );
    }
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Empty>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t('empty.pageNotFound')}</EmptyTitle>
          <EmptyDescription>
            {t('empty.pageNotFoundDescription', { name: pageName })}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  const params = Object.fromEntries(searchParams.entries());

  // objectui#12980 — the objects this page reads: the ones its definition
  // binds, read by name (`readPageObjectScope`), never the whole registry. A
  // block that names an object outside them (a lookup target, a list a block
  // links to) has it read by name when it asks, and the page re-renders when
  // it lands. A hand-rolled metadata context has no scope to offer, and its
  // `objects` is what it holds.
  const readPageObjects = () =>
    readPageObjectScope(readObjectScope!, activeApp as Record<string, any> | undefined, page, [
      ...requestedObjects,
    ]).scope;
  const objects: any[] = readObjectScope ? readPageObjects().objects : metadata.objects ?? [];
  const knownObjects = new Set(objects.map((o: any) => o?.name));
  const requestObject = (name: string) => {
    if (!readObjectScope || !name || knownObjects.has(name) || requestedObjects.has(name)) return;
    requestedObjects.add(name);
    readPageObjects();
  };

  // Resolve the app slug from the path (`/apps/:app/page/:name`) so the record
  // navigator's links survive whatever Router basename the host mounts under.
  const appName = location.pathname.match(/\/apps\/([^/]+)/)?.[1];
  const canEditInStudio = studioPath !== null;
  const openInStudio = () => {
    if (studioPath === null) return;
    navigate(studioPath);
  };
  // The record navigator the page's blocks open a record through
  // (objectui#11293), served with the record page's related-list executor for
  // the lists that bound a parent (objectui#12870). Not memoised: the schema
  // below is rebuilt on every render too, and nothing may rest on this
  // object's identity (AGENTS.md #10).
  //
  // objectui#12980 — an object outside the page's objects is asked for by
  // name when a block asks the navigator about it: an href answers `null`
  // until it lands, and an open goes once the per-object read answers.
  const servePageRecordActions = (bridge: RelatedRecordActionsValue): RelatedRecordActionsValue => {
    const value = pageRecordActionsValue(appName, objects as unknown[], navigate, routerRootHref, bridge);
    if (!readObjectScope) return value;
    const whenKnown = (objectName: string, go: (known: RelatedRecordActionsValue) => void) => {
      if (knownObjects.has(objectName)) return go(value);
      requestObject(objectName);
      void metadata.getItem('object', objectName).then((item: unknown) => {
        if (item) go(pageRecordActionsValue(appName, [item], navigate, routerRootHref, bridge));
      });
    };
    return {
      ...value,
      recordHref: (objectName, recordId) => {
        requestObject(objectName);
        return value.recordHref!(objectName, recordId);
      },
      listHref: (objectName, viewName) => {
        requestObject(objectName);
        return value.listHref!(objectName, viewName);
      },
      openRecord: (objectName, recordId) => whenKnown(objectName, (known) => known.openRecord!(objectName, recordId)),
      openList: (objectName, viewName) => whenKnown(objectName, (known) => known.openList!(objectName, viewName)),
    };
  };

  return (
    // Mount the shared console action runtime so page-level `action:button`s can
    // collect params, call authenticated APIs, show confirm/result dialogs, run
    // screen flows, navigate the SPA, and refresh embedded data — the same
    // runtime ObjectView uses (#1605). Pages run global / action-scoped actions,
    // so no `objectName` is bound.
    <ConsoleActionRuntimeProvider
      dataSource={dataSource}
      objects={objects}
      onRefresh={declarePageDataChanged}
      // A `type: 'form'` action on the page opens its form in this app's shell
      // (objectui#13433).
      routeAppSegment={appName}
    >
      <div className="flex flex-row h-full w-full overflow-hidden relative">
        <div className="flex-1 overflow-auto h-full relative">
          {canEditInStudio && (
            <button
              type="button"
              onClick={openInStudio}
              className="absolute right-3 top-3 z-30 inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background/90 text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground"
              data-testid="page-edit-in-studio-button"
              title={t('common.editInStudio', { defaultValue: 'Edit in studio' })}
              aria-label={t('common.editInStudio', { defaultValue: 'Edit in studio' })}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {(page as any).interfaceConfig?.source ? (
            // ADR-0047 interface mode: the page binds a source view into a
            // curated list surface — rendered directly, not via regions.
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center p-8" data-testid="interface-page-loading">
                  <Spinner className="h-5 w-5 text-muted-foreground" />
                </div>
              }
            >
              <InterfaceListPage page={page} reserveEditAffordance={canEditInStudio} />
            </Suspense>
          ) : (
            // The record page's bridge, mounted inside this page's action
            // runtime so its executor dispatches through the page's runner;
            // `serve` publishes the page's own value over it (objectui#12870).
            <RelatedRecordActionsBridge
              appName={appName}
              objects={objects}
              dataSource={dataSource}
              serve={servePageRecordActions}
              parentFromList
            >
              <AppPageRecord binding={appPageRecordBinding(page as Record<string, unknown>)} dataSource={dataSource}>
                <SchemaRenderer
                  schema={{
                    ...page,
                    // `type` stays the SchemaNode discriminator ComponentRegistry
                    // dispatches on. The spec's page KIND (`record|home|app|utility|
                    // list`) rides `pageType`, which PageRenderer reads — without
                    // this mapping every page fell back to `pageType: 'record'`,
                    // so non-record pages got the record max-width, a wrong
                    // `data-page-type` and a suppressed header (framework#1878 §3
                    // naming-drift recheck).
                    //
                    // ⭐ This is the WRITING end of the page-kind to node-type
                    // channel, and a comment here was not enough: two cards audited
                    // the READING end and concluded the registrations it feeds were
                    // undeclared (objectui#9263, re-ruled letter E "⛔ not a
                    // defect", and objectui#9576). The channel is now declared at
                    // both reading ends — `@object-ui/types`' `SchemaRegistry` map
                    // at its `'page'` entry, and the `PageRenderer` registrations in
                    // `@object-ui/components`. Each END is pinned by a DIFFERENT
                    // file, because no one package can import both.
                    //
                    // ⛔ Change this mapping and `page-kind-writing-end-9718`, in
                    // this package's `views/__tests__`, goes red by design and names
                    // the kind that stopped being written (objectui#9718): it is the
                    // declaration, not an incidental assertion.
                    //
                    // ⚠️ The reading end's pin — `page-kind-node-type-channel-9642`
                    // (objectui#9642) — does NOT answer for this line. It lives in
                    // `@object-ui/components`, which does not depend on this
                    // package, so its module graph cannot reach this file: gutting
                    // this mapping leaves it green, and deleting a registration
                    // turns it red. Both directions were measured on objectui#9718.
                    //
                    // The pair is built by `pageKindNode`, the ONE builder this
                    // writer shares with Studio's page previews (objectui#11933):
                    // they used to write `type` alone, so they drew an app or
                    // home page as a record page.
                    ...pageKindNode(page),
                    // `context` is built here, never read off the page: `PageSchema`
                    // refuses a page-level `context` key, so no parsed page can
                    // carry one (objectui#9673). Written after `...page`, it also
                    // overrides whatever an unparsed document smuggled in.
                    context: { params },
                  }}
                />
              </AppPageRecord>
            </RelatedRecordActionsBridge>
          )}
        </div>
        <MetadataPanel
          open={showDebug}
          sections={[{ title: 'Page Configuration', data: page }]}
        />
      </div>
    </ConsoleActionRuntimeProvider>
  );
}
