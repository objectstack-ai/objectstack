/**
 * Marketplace Page — browse approved, marketplace-listed packages.
 *
 * Card-grid catalog of public packages, fetched from the tenant runtime's
 * `/api/v1/marketplace/packages` proxy (which forwards to the configured
 * cloud control plane). Click-through opens the package detail page.
 *
 * The catalog is read one page at a time: the search text and the facet
 * selection travel with the read, and the server filters before it pages, so
 * the page filters nothing itself.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Input,
  Button,
  Skeleton,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@object-ui/components';
import {
  Package, Search, Store, AlertCircle, CheckCircle2, Settings, Loader2, ChevronDown, Copy, Check,
} from 'lucide-react';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { useServedAppLabel } from '../../hooks/useServedAppLabel.js';
import { useAdapter } from '@object-ui/react';
import { PackageIcon } from './PackageIcon.js';
import { MarketplaceAccessDenied } from './MarketplaceAccessDenied.js';
import { MarketplaceResolving } from './MarketplaceResolving.js';
import { MarketplaceDisabled } from './MarketplaceDisabled.js';
import { localizePackage } from './usePackageL10n.js';
import {
  listMarketplacePackages,
  listLocalInstalls,
  listOrgPackages,
  listInstalledPackages,
  installPackage,
  installLocal,
  type MarketplaceListParams,
  type MarketplacePackageSummary,
  type LocalInstallEntry,
  type OrgPackageSummary,
} from './marketplaceApi.js';
import { getCloudBase, getRuntimeConfig, isMarketplaceEnabled } from '../../runtime-config.js';
import { PageHeader } from '../../layout/PageHeader.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { appRouteSegment, filterActiveApps } from '../../utils/index.js';
import { waitForServedApp, type ServedApp } from './waitForServedApp.js';
import { splitPackageSuffix } from './middleTruncate.js';
import { useDependencyMissingText } from './dependencyMissing.js';
import { useProtocolCheckSkippedText } from './protocolCheckSkipped.js';
import { ProtocolCheckSkippedNote } from './ProtocolCheckSkippedNote.js';
import { ConnectorCredentialsStep } from './ConnectorCredentialsStep.js';
import { packagesHref } from '../../views/metadata-admin/packageSource.js';
import { MarketplaceNamespaceGate } from './MarketplaceNamespaceGate.js';
import { MarketplaceFacetFilters } from './MarketplaceFacetFilters.js';
import {
  EMPTY_FACET_SELECTION,
  NO_SERVED_FACETS,
  facetListParams,
  readListingTaxonomy,
  widenServedFacets,
  type FacetSelection,
  type ServedFacets,
} from './marketplaceTaxonomy.js';

/**
 * The card grid's track (objectui#12616): a card is never narrower than 240px,
 * and the page fits as many of them as its own width holds. A viewport
 * breakpoint (`lg:grid-cols-3`) cannot know that width: it drew three tracks
 * of a zero-minimum `1fr` (`grid-cols-3`) from a 1024px viewport up, however
 * little of that width the Setup sidebar left the page.
 */
const CARD_GRID = 'grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]';

/**
 * The identity block of a marketplace card, shared by the catalog card and the
 * "Your organization" card (objectui#12616).
 *
 * - The title takes the text column's whole width first, up to two lines with
 *   an ellipsis on the second. `line-clamp-2` is visual only: the whole title
 *   stays in the DOM text, so assistive technology reads it whole.
 * - The badge sits on its own line under the title, never beside it, so it
 *   cannot take the title's width.
 * - The id is one line of 11px monospace, drawn as two runs: the head, which
 *   shrinks and takes the ellipsis, and the package suffix, which does not
 *   (`splitPackageSuffix`). A card too narrow for the whole id therefore cuts
 *   it in the middle, before the package name; a card wide enough draws it
 *   whole. The suffix is capped at the column less 4ch, so a package name
 *   longer than the column still leaves the head's first characters and is cut
 *   at its own end. The whole id is the element's text and its `title`.
 */
function PackageCardHeader({
  iconUrl,
  displayName,
  manifestId,
  badge,
}: {
  iconUrl?: string | null;
  displayName: string;
  manifestId: string;
  badge?: ReactNode;
}) {
  const { head, suffix } = splitPackageSuffix(manifestId);
  return (
    <CardHeader className="flex flex-row items-start gap-3 pb-2">
      <PackageIcon iconUrl={iconUrl} displayName={displayName} manifestId={manifestId} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <CardTitle className="text-[13px] leading-snug line-clamp-2 break-words">{displayName}</CardTitle>
        {badge}
        <CardDescription className="text-[11px]">
          <code className="flex font-mono" title={manifestId}>
            <span className="min-w-0 truncate">{head}</span>
            {suffix ? <span className="max-w-[calc(100%_-_4ch)] shrink-0 truncate">{suffix}</span> : null}
          </code>
        </CardDescription>
      </div>
    </CardHeader>
  );
}

/**
 * Format a published-at timestamp as a localized relative string.
 *
 * Uses `Intl.RelativeTimeFormat` for proper plural/grammatical rules in
 * the display locale (e.g. "il y a 3 jours", "3 天前"). Falls back to
 * translation keys for environments without RTF support.
 *
 * The locale is `useDisplayLocale()`, never the UI language: a regional
 * display locale (`de-CH` under an English UI) must reach this face, and the
 * hook already owns the last-resort tag, so no literal `'en'` belongs here
 * (objectui#10331).
 */
function useRelativeFormatter() {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  return (iso?: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days < 1) return t('marketplace.relativeTime.today');
    try {
      const rtf = new Intl.RelativeTimeFormat(displayLocale, { numeric: 'auto' });
      if (days < 30) return rtf.format(-days, 'day');
      if (days < 365) return rtf.format(-Math.floor(days / 30), 'month');
      return rtf.format(-Math.floor(days / 365), 'year');
    } catch {
      if (days < 30) return t('marketplace.relativeTime.daysAgo', { count: days });
      if (days < 365) return t('marketplace.relativeTime.monthsAgo', { count: Math.floor(days / 30) });
      return t('marketplace.relativeTime.yearsAgo', { count: Math.floor(days / 365) });
    }
  };
}

/**
 * A failed catalog load as the page tells it (objectui#11688): the server's
 * own words, and whether "check that it is online" is the real cause.
 *
 * Both hints end in that question, so they are shown only when it is the
 * cause: no server answered at all (`call()` stamps `status` on every failure
 * a server answered, so a failure without one never reached a server), or the
 * server that answered said it could not reach the one behind it or is not
 * serving. Any other answer is a refusal whose cause is the server's text, and
 * an "is it online" line under a 403 sends the reader after the wrong fault.
 */
interface LoadFailure {
  message: string;
  showOnlineHint: boolean;
  /** The answered status, or `undefined` when no server answered (objectui#12710). */
  status: number | undefined;
  /** The answered error code `call()` stamps from the envelope, if any. */
  code: string | undefined;
  /**
   * The failure's class on the page (objectui#12710, #25891): "could not be
   * reached" against "answered with an error (HTTP n)". Unreachable is a
   * transport failure (a network error, a CORS refusal, an abort: no status),
   * or the runtime proxy's own `MARKETPLACE_PROXY_FAILED`, which it answers
   * only when its own fetch to the catalog threw: that 502 is the runtime
   * saying it reached nothing, not the catalog answering. A 502 / 503 / 504 the
   * upstream itself answered is relayed with the upstream's own code, and stays
   * an answer. The unreachable class's message is the raw transport text
   * ("fetch failed"), so the page keeps it behind More; an answer's message is
   * the server's own words and stays in full view (objectui#11688).
   */
  unreachable: boolean;
}

/**
 * The answered statuses whose cause IS reachability: 502 and 504 are a gateway
 * that got no (timely) answer upstream, the runtime proxy's own
 * `MARKETPLACE_PROXY_FAILED` among them, and 503 is a service that is not up.
 */
const UNREACHABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** The code the runtime's marketplace proxy answers when its upstream fetch throws. */
const PROXY_UNREACHABLE_CODE = 'MARKETPLACE_PROXY_FAILED';

function toLoadFailure(e: unknown): LoadFailure {
  const err = e as { message?: unknown; status?: unknown; code?: unknown } | null | undefined;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const code = typeof err?.code === 'string' ? err.code : undefined;
  return {
    message: typeof err?.message === 'string' ? err.message : String(e),
    showOnlineHint: status === undefined || UNREACHABLE_STATUSES.has(status),
    status,
    code,
    unreachable: status === undefined || code === PROXY_UNREACHABLE_CODE,
  };
}

/**
 * The load failure's class line and its cause (#25891). An answer shows the
 * server's own words under its class line. An unreachable failure says so in
 * one plain line, and the raw transport text, written for a developer, sits
 * behind More, selectable and copyable, as `RefusalMessage` keeps a refusal's
 * detail (the same `refusalDetails` keys).
 */
function LoadFailureCause({ failure }: { failure: LoadFailure }) {
  const { t } = useObjectTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  // The server's own text, as a text child: it is server-supplied data, so it
  // never reaches `dangerouslySetInnerHTML`.
  if (!failure.unreachable) {
    return (
      <>
        <div className="mt-1" data-testid="marketplace-load-class">
          {t('marketplace.load.answeredError', { status: failure.status })}
        </div>
        <div className="text-muted-foreground mt-1" data-testid="marketplace-load-cause">{failure.message}</div>
      </>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(failure.message);
      setCopied(true);
    } catch {
      // Denied or unavailable: the text is on screen and selectable.
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1 min-w-0">
      <span data-testid="marketplace-load-class">{t('marketplace.load.unreachable')}</span>{' '}
      <CollapsibleTrigger
        className="group inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100"
        data-testid="marketplace-load-more"
      >
        {open ? t('refusalDetails.less') : t('refusalDetails.more')}
        <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex items-start gap-1 rounded border border-destructive/30 bg-background/60 p-2">
          <pre
            data-testid="marketplace-load-cause"
            className="min-w-0 flex-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs select-text"
          >
            {failure.message}
          </pre>
          <button
            type="button"
            onClick={() => { void copy(); }}
            aria-label={copied ? t('refusalDetails.copied') : t('refusalDetails.copy')}
            title={copied ? t('refusalDetails.copied') : t('refusalDetails.copy')}
            className="shrink-0 rounded p-1 opacity-80 hover:bg-destructive/10 hover:opacity-100"
            data-testid="marketplace-load-copy"
          >
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * How long a catalog read may be pending before the page says so
 * (objectui#12710). The catalog is a remote read that can take seconds, and a
 * network that drops it leaves the request pending with no answer at all, so
 * six skeleton cards were the whole page for as long as it took — forever on
 * such a network. The skeleton now stands for at most `SKELETON_MS`; after it
 * one line under the search box says what is loading, and after `SLOW_MS` that
 * line says the catalog is slow to answer and offers Retry. A read that settles
 * inside `SKELETON_MS` never draws the line.
 */
const SKELETON_MS = 2_000;
const SLOW_MS = 10_000;

/** Where a pending catalog read is in the timeline above. */
type LoadPhase = 'skeleton' | 'line' | 'slow';

/**
 * Listings per catalog page. The list door caps a page at 100; a page is a
 * whole number of rows of the card grid at two, three, four and six columns.
 */
export const CATALOG_PAGE_SIZE = 24;

/** How long the search box waits after the last keystroke before it reads. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * objectui#12097 — an org install on a cloud-managed environment, from the
 * install answering until the runtime serves the package's app, or the wait
 * expires: the three states the package page draws for the same install
 * (objectui#12087), in the same words. The strip lists several packages and
 * this status sits above them all, so it names its package (`name`, the row's
 * display name). `served` carries the first app of the package a user can open,
 * or `null` when every one is inactive or hidden. `version` is the one the
 * install answer names, which the wait matches too (objectui#12098).
 */
type OrgDeployState =
  | { phase: 'waiting'; manifestId: string; version: string | undefined; name: string }
  | { phase: 'served'; manifestId: string; version: string | undefined; name: string; app: ServedApp | null }
  | { phase: 'timeout'; manifestId: string; version: string | undefined; name: string };

/**
 * The page under the frame that fetches its strings first — the
 * `marketplace` namespace (`MarketplaceNamespaceGate.tsx` says why).
 */
export function MarketplacePage() {
  return (
    <MarketplaceNamespaceGate>
      <MarketplacePageBody />
    </MarketplaceNamespaceGate>
  );
}

function MarketplacePageBody() {
  const navigate = useNavigate();
  const { appName } = useParams();
  const { isAdmin, isResolved } = useWorkspaceAdminStatus();
  const { t, language } = useObjectTranslation();
  const dependencyMissingText = useDependencyMissingText();
  const protocolCheckSkippedText = useProtocolCheckSkippedText();
  const { appLabel } = useServedAppLabel();
  // The adapter `MetadataProvider` reads through: the deploy wait asks the
  // same `GET /meta/app` the cache would, without the cache persisting it.
  const adapter = useAdapter();
  const formatRelative = useRelativeFormatter();
  const basePath = appName ? `/apps/${appName}` : '';
  // The runtime's own answer, read once per render. `false` means this
  // runtime mounts no marketplace browse surface at all — there is nothing
  // to fetch, so nothing here fetches (objectui#5504).
  const marketplaceEnabled = isMarketplaceEnabled();
  // Empty string means "requests stay on this origin", not "unknown", and not
  // "this runtime IS the catalog host" either: a runtime that proxies a
  // control plane answers `''` too (objectui#11726) — see
  // `AppShellRuntimeConfig.cloudUrl`.
  const cloudBase = getCloudBase();
  const [items, setItems] = useState<MarketplacePackageSummary[]>([]);
  // Seeded from the flag rather than settled by the effect: a runtime with
  // no catalog is not "loading", it is done. Writing that from inside the
  // effect would be a second `react-hooks/set-state-in-effect` site.
  const [loading, setLoading] = useState(marketplaceEnabled);
  const [error, setError] = useState<LoadFailure | null>(null);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>('skeleton');
  // objectui#12710 — which read is the page's current one, and the timers that
  // move its phase. Retry (or Refresh, or an install's reload) starts a new
  // read while an older one may still be pending; only the newest may settle
  // the page, and an older one that answers late changes nothing. Unmount
  // retires every read and clears the timers.
  const loadSeq = useRef(0);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearPhaseTimers = () => {
    for (const id of phaseTimers.current) clearTimeout(id);
    phaseTimers.current = [];
  };
  const [query, setQuery] = useState('');
  // The search text the catalog read sends: the box's text once typing pauses
  // for `SEARCH_DEBOUNCE_MS`, trimmed.
  const [searchText, setSearchText] = useState('');
  const [facets, setFacets] = useState<FacetSelection>(EMPTY_FACET_SELECTION);
  // The first listing of the page on screen; a new search or selection reads
  // from the first page again.
  const [offset, setOffset] = useState(0);
  // The listings the catalog holds under the current search and selection.
  const [total, setTotal] = useState(0);
  // The facets some answered listing carried (`ServedFacets`).
  const [servedFacets, setServedFacets] = useState<ServedFacets>(NO_SERVED_FACETS);
  // Whether a read has settled the side loads (installs, org packages); a
  // read for another page or selection then reads the catalog alone.
  const sideLoaded = useRef(false);
  const [installed, setInstalled] = useState<LocalInstallEntry[]>([]);
  // ADR-0007 step ②: the org's own packages (visibility org/private), shown in
  // a "Your organization" section and installable inline (no public listing).
  const [orgItems, setOrgItems] = useState<OrgPackageSummary[]>([]);
  const [orgInstalling, setOrgInstalling] = useState<string | null>(null);
  // `credentials` is set on an install the running kernel loaded: the
  // package's connector credentials step reads it (ruling A on objectstack#27230).
  const [orgMsg, setOrgMsg] = useState<{
    ok: boolean;
    text: string;
    credentials?: { packageId: string; note?: string };
    // objectstack#30326 — the answer's `protocolCheckSkipped`, drawn.
    protocolNote?: string;
  } | null>(null);
  const [orgDeploy, setOrgDeploy] = useState<OrgDeployState | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  // Packages the control plane lists as uninstalled (a soft disable that keeps
  // the row): not installed, and the org card offers Reinstall for them.
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set());

  const installedByManifestId = useMemo(() => {
    const m = new Map<string, LocalInstallEntry>();
    for (const e of installed) m.set(e.manifestId, e);
    return m;
  }, [installed]);

  // The catalog read the page is showing: search, selection and page window.
  // `catalogRequestKey` is its spelling, and the read effect's dependency.
  const facetParams = facetListParams(facets);
  const catalogRequest: MarketplaceListParams = {
    ...(searchText ? { q: searchText } : {}),
    ...facetParams,
    limit: CATALOG_PAGE_SIZE,
    offset,
  };
  const catalogRequestKey = JSON.stringify(catalogRequest);
  // Whether the read narrows the catalog: an empty answer then means "nothing
  // matches", not "nothing is listed".
  const filtering = searchText !== '' || Object.keys(facetParams).length > 0;

  /**
   * Read the catalog page `request` names. `withSideLoads` reads the installs
   * and the org's packages with it — the first read, Refresh, Retry and the
   * read after an install; turning a page or changing the selection reads the
   * catalog alone.
   */
  const load = async (request: MarketplaceListParams = catalogRequest, withSideLoads = true) => {
    const seq = ++loadSeq.current;
    const current = () => loadSeq.current === seq;
    clearPhaseTimers();
    setLoadPhase('skeleton');
    phaseTimers.current = [
      setTimeout(() => { if (current()) setLoadPhase('line'); }, SKELETON_MS),
      setTimeout(() => { if (current()) setLoadPhase('slow'); }, SLOW_MS),
    ];
    setLoading(true);
    setError(null);
    try {
      const [catalog, sides] = await Promise.all([
        // Settled here rather than left to reject the batch. The three side
        // loads each answer "nothing" on their own failure, so the catalog is
        // the only one that can fail, and its failure must not discard what
        // they loaded: the org section and the installed count (objectui#11688).
        listMarketplacePackages(request).then(
          (resp) => ({ resp, failure: null }),
          (e: unknown) => ({ resp: null, failure: toLoadFailure(e) }),
        ),
        withSideLoads
          ? Promise.all([listLocalInstalls(), listOrgPackages(), listInstalledPackages()])
          : null,
      ]);
      if (!current()) return;
      if (sides !== null) {
        const [installs, org, cloudInstalled] = sides;
        setInstalled(installs);
        setOrgItems(org.items ?? []);
        const ids = new Set<string>();
        const disabled = new Set<string>();
        for (const e of installs) ids.add(e.manifestId);
        for (const e of cloudInstalled.items) (e.disabled ? disabled : ids).add(e.manifestId);
        setInstalledIds(ids);
        setDisabledIds(disabled);
        sideLoaded.current = true;
      }
      if (catalog.failure !== null) {
        setError(catalog.failure);
        setItems([]);
        setTotal(0);
      } else {
        const page = catalog.resp.items ?? [];
        setItems(page);
        setTotal(typeof catalog.resp.total === 'number' ? catalog.resp.total : page.length);
        setServedFacets((served) => widenServedFacets(served, page.map(readListingTaxonomy)));
      }
    } catch (e: unknown) {
      if (!current()) return;
      setError(toLoadFailure(e));
      setItems([]);
    } finally {
      if (current()) {
        clearPhaseTimers();
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    // No catalog on this runtime → no request. Firing it anyway would put
    // a guaranteed 404 in the network log and leave the page spinning
    // before it settled on the disabled state.
    if (!marketplaceEnabled) return;
    void load(catalogRequest, !sideLoaded.current);
    // Unmount, or a new search, selection or page, retires whatever read is
    // pending and its phase timers (objectui#12710): only the newest read
    // settles the page.
    return () => {
      loadSeq.current += 1;
      clearPhaseTimers();
    };
  }, [marketplaceEnabled, catalogRequestKey]);

  // The search box reads once typing pauses, from the first page.
  useEffect(() => {
    const id = setTimeout(() => {
      const next = query.trim();
      if (next === searchText) return;
      setSearchText(next);
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // A new selection reads from the first page.
  const selectFacets = (next: FacetSelection) => {
    setFacets(next);
    setOffset(0);
  };

  /**
   * objectui#12097 — wait until this environment serves the installed org
   * package's app, and only then pulse the metadata refresh.
   *
   * The pulse makes every mounted `MetadataProvider` re-read its loaded types
   * and persist what it reads (the tab's sessionStorage seed). A pulse that
   * lands while the runtime still serves the pre-install kernel fixes the
   * pre-install `app` list in place: the install "succeeded" and the app never
   * appeared. `waitForServedApp` (objectui#12087) reads `GET /meta/app` past
   * the cache instead, and the pulse waits for it. On expiry nothing is
   * refreshed, and the strip says the app has not appeared rather than that
   * the install succeeded.
   *
   * One status for the whole strip: a later install's status replaces an
   * earlier one's, and an earlier wait that settles late never overwrites it.
   * Its pulse still goes out, because its app IS served.
   */
  const awaitServedOrgInstall = async (manifestId: string, version: string | undefined, name: string) => {
    const settle = (next: OrgDeployState) =>
      setOrgDeploy((cur) => (cur?.manifestId === manifestId ? next : cur));
    setOrgDeploy({ phase: 'waiting', manifestId, version, name });
    const wait = await waitForServedApp({
      manifestId,
      version,
      // The SDK's declared list answer (`GetMetaItemsResponse`: `{ type,
      // items }`), read the way the package page reads it.
      readApps: async () => {
        if (!adapter) throw new Error('No data adapter to read the app list through');
        return (await adapter.getClient().meta.getItems('app')).items;
      },
    });
    if (!wait.served) {
      settle({ phase: 'timeout', manifestId, version, name });
      return;
    }
    emitMetadataRefresh();
    settle({ phase: 'served', manifestId, version, name, app: filterActiveApps(wait.apps)[0] ?? null });
  };

  // Install an org package into the current environment (ADR-0007 step ②).
  //
  // Two deployment shapes, two semantically-correct routes:
  //   - install-local runtimes (single-env / self-hosted, runtime-config
  //     features.installLocal=true): the runtime OWNS its desired state —
  //     install merges into ITS kernel via /marketplace/install-local; the
  //     bound oscc_ credential lets it fetch the org manifest (ADR-0008).
  //     The control-plane /cloud-connection/install path would 401 here
  //     (no env→cloud service key) and is the wrong semantics anyway.
  //   - cloud-managed environments: desired state lives in the control
  //     plane — /cloud-connection/install resolves the env by hostname.
  const doOrgInstall = async (pkg: OrgPackageSummary) => {
    setOrgInstalling(pkg.id);
    setOrgMsg(null);
    try {
      if (getRuntimeConfig().features.installLocal) {
        const result = await installLocal({ packageId: pkg.manifest_id || pkg.id, versionId: 'latest' });
        // objectstack#30326 — installed, its platform protocol range unchecked.
        const protocolNote = protocolCheckSkippedText(result);
        // objectui#12098 — `hotLoaded: false` is the runtime's lenient path
        // (objectstack#22695): installed, loaded at its next restart. Nothing
        // of it is served until then, so the strip says so and nothing is
        // refreshed, as on the package page.
        setOrgMsg({
          ok: true,
          text: result.hotLoaded
            ? t('marketplace.org.installed', { defaultValue: `Installed ${pkg.display_name}`, name: pkg.display_name })
            : t('marketplace.install.localLoadsAtRestart', { version: result.version, name: pkg.display_name }),
          ...(result.hotLoaded ? { credentials: { packageId: result.manifestId, note: result.credentialNote } } : {}),
          ...(protocolNote ? { protocolNote } : {}),
        });
        await load();
        // On `hotLoaded` the runtime registered the package before it answered,
        // so the live registry already holds it. Pulse every mounted MetadataProvider
        // so the new app appears in the nav (and its objects/views resolve)
        // without a manual browser refresh.
        if (result.hotLoaded) emitMetadataRefresh();
      } else {
        const installResp = await installPackage({ packageId: pkg.id, environmentId: '', seedSampleData: true });
        // objectui#12097 — this answer lands while the runtime still serves the
        // PRE-install kernel, so nothing is refreshed here: the wait refreshes
        // once the package's app is served. Not awaited, and not cancelled on
        // unmount, as on the package page: an operator who leaves this page
        // while the app deploys still gets the refreshed cache when it lands.
        // It waits for the version the answer names (objectui#12098).
        void awaitServedOrgInstall(pkg.manifest_id, installResp?.installation?.version, pkg.display_name);
        await load();
      }
    } catch (e: any) {
      // ADR-0141 D2 — a `DEPENDENCY_MISSING` refusal reads one line per unmet
      // dependency, from its own facts; anything else keeps its message.
      setOrgMsg({ ok: false, text: dependencyMissingText(e) ?? e?.message ?? String(e) });
    } finally {
      setOrgInstalling(null);
    }
  };

  // The page the server answered, already searched, filtered and paged.
  const shown = useMemo(() => items.map((it) => ({ it, taxonomy: readListingTaxonomy(it) })), [items]);
  const pageCount = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  const pageNumber = Math.floor(offset / CATALOG_PAGE_SIZE) + 1;

  // Ahead of the `!isAdmin` guard below deliberately (objectui#5557): on a
  // runtime that mounts no marketplace, "there is no marketplace here" is true
  // of every viewer, and `features.marketplace` is public runtime config every
  // client already reads -- so the retired ordering withheld nothing, it only
  // misdirected. Telling an unprivileged member they lack PERMISSION for a
  // surface that exists for nobody sends them to ask an administrator for a
  // grant that would not help them. This is the ordering
  // `MarketplacePackagePage` landed in `2573ff434`; the sibling pages now
  // answer one runtime the same way.
  if (!marketplaceEnabled) return <MarketplaceDisabled />;

  // On a runtime that DOES have a marketplace, admin-first stays correct: the
  // catalog is an install surface, and a member who cannot install has nothing
  // to do with it. objectui#5557 did not claim otherwise.
  // objectui#5619 — a refusal is not a repaint: `MarketplaceAccessDenied` tells
  // a real administrator they lack a grant they hold, and it is the frame they
  // read. The verdict has a third state ("not resolved yet") and this guard is
  // the reason it exists. Ordered AFTER `!marketplaceEnabled` deliberately —
  // that answer is true of every viewer on this runtime and needs no verdict,
  // so the ordering objectui#5557 and `2573ff434` established is untouched — and BEFORE
  // `!isAdmin`, which is the branch that must not fire on a guess.
  //
  // This is NOT the incidental skeleton objectui#5621 removed: that one hid the
  // window behind an unrelated package fetch, for as long as the network
  // happened to take. This waits on the verdict itself and on nothing else, and
  // `isResolved` is already true for any admin the session identifies.
  if (!isResolved) return <MarketplaceResolving />;

  if (!isAdmin) return <MarketplaceAccessDenied />;

  // objectui#12097 — the org install's deploy status, drawn as the package
  // page draws it (objectui#12087), under the package's name.
  const orgDeployApp = orgDeploy?.phase === 'served' ? orgDeploy.app : null;
  const orgDeployNote = orgDeploy && (
    <div
      role="status"
      data-testid="org-deploy-status"
      className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
        orgDeploy.phase === 'served'
          ? 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400'
          : orgDeploy.phase === 'timeout'
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
            : 'border-border bg-muted/40 text-foreground'
      }`}
    >
      {orgDeploy.phase === 'waiting'
        ? <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
        : orgDeploy.phase === 'served'
          ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />}
      <div className="flex-1 space-y-2">
        <div>
          <div className="font-medium">{orgDeploy.name}</div>
          <div>
            {orgDeploy.phase === 'waiting'
              ? t('marketplace.install.deploying')
              : orgDeploy.phase === 'served'
                ? t('marketplace.install.deployed')
                : t('marketplace.install.deployTimeout')}
          </div>
        </div>
        {orgDeployApp && appRouteSegment(orgDeployApp) ? (
          <Button size="sm" onClick={() => navigate(`/apps/${appRouteSegment(orgDeployApp)}`)}>
            {t('marketplace.install.openApp', {
              name: appLabel({
                ...orgDeployApp,
                name: String(orgDeployApp.name ?? appRouteSegment(orgDeployApp)),
              }),
            })}
          </Button>
        ) : null}
        {orgDeploy.phase === 'timeout' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void awaitServedOrgInstall(orgDeploy.manifestId, orgDeploy.version, orgDeploy.name)}
          >
            {t('marketplace.install.checkAgain')}
          </Button>
        ) : null}
        {/* Once served, the package's connectors exist in this runtime: the
            credentials they still need, from its credential listing. */}
        {orgDeploy.phase === 'served' ? <ConnectorCredentialsStep packageId={orgDeploy.manifestId} /> : null}
      </div>
    </div>
  );

  return (
    <div>
      {/* The console's one page header (objectui#12606): only this row is
          this card's; the cards below are not. Refresh is the header's icon
          button. */}
      <PageHeader
        title={t('marketplace.title')}
        subtitle={t('marketplace.subtitle')}
        icon={<Store className="h-4 w-4" aria-hidden="true" />}
        refresh={{ onRefresh: () => void load(), label: t('marketplace.refresh'), busy: loading }}
        actions={
          // Setup → Packages is the one list of what is installed
          // (objectui#12675); its marketplace rows carry the actions. Packages
          // is a Setup page, so with no app segment to keep it opens under the
          // Setup app's own (objectui#12733).
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(packagesHref(basePath || '/apps/setup', 'marketplace'))}
          >
            <Settings className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {installed.length > 0
              ? t('marketplace.installedCount', { count: installed.length })
              : t('marketplace.installed')}
          </Button>
        }
      />
    <div className="flex flex-col gap-6 p-4 sm:p-6">

      <div className="flex flex-col gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('marketplace.searchPlaceholder')}
            className="pl-9"
            aria-label={t('marketplace.searchAria')}
          />
        </div>
        <MarketplaceFacetFilters served={servedFacets} selection={facets} onChange={selectFacets} />
      </div>

      {/* objectui#12710 — a catalog read still pending once the skeleton's
          window has passed: one line under the search box says what is
          loading, and past `SLOW_MS` that it is slow to answer, with Retry.
          Retry is `load()`, the read Refresh makes. */}
      {loading && loadPhase !== 'skeleton' && (
        <div
          role="status"
          data-testid="marketplace-load-line"
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <span>{loadPhase === 'slow' ? t('marketplace.load.slow') : t('marketplace.load.loading')}</span>
          {loadPhase === 'slow' && (
            <Button size="sm" variant="outline" onClick={() => void load()} data-testid="marketplace-load-slow-retry">
              {t('marketplace.load.retry')}
            </Button>
          )}
        </div>
      )}

      {orgItems.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">
              {t('marketplace.org.heading', { defaultValue: 'Your organization' })}
            </h2>
            <Badge variant="secondary" className="text-xs">{orgItems.length}</Badge>
          </div>
          {orgDeployNote}
          {orgMsg && (
            <div className={`whitespace-pre-wrap rounded-md border p-3 text-sm ${orgMsg.ok ? 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>
              {orgMsg.text}
              {orgMsg.protocolNote ? <ProtocolCheckSkippedNote text={orgMsg.protocolNote} /> : null}
              {orgMsg.ok && orgMsg.credentials ? (
                <ConnectorCredentialsStep
                  packageId={orgMsg.credentials.packageId}
                  fallbackNote={orgMsg.credentials.note}
                  className="mt-2"
                />
              ) : null}
            </div>
          )}
          <div className={CARD_GRID}>
            {orgItems.map((pkg) => {
              const isInstalled = installedIds.has(pkg.manifest_id);
              // Uninstalled on the control plane, which keeps the row: the
              // install door re-enables that row, so the action reads Reinstall.
              const isDisabled = !isInstalled && disabledIds.has(pkg.manifest_id);
              // objectui#11760 — the same page's other "Installed": an org
              // package installed into this runtime that it refused to load at
              // startup reads "Not loaded", from the local listing's marker.
              const notLoaded = !!installedByManifestId.get(pkg.manifest_id)?.notLoaded;
              return (
                <Card key={pkg.id} className="flex flex-col" data-testid={`org-card-${pkg.manifest_id}`}>
                  <PackageCardHeader
                    iconUrl={pkg.icon_url}
                    displayName={pkg.display_name}
                    manifestId={pkg.manifest_id}
                    badge={pkg.visibility && (
                      <Badge variant="outline" className="self-start text-xs">{pkg.visibility}</Badge>
                    )}
                  />
                  <CardContent className="flex-1 flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {pkg.description || t('marketplace.noDescription')}
                    </p>
                    <div className="flex items-center gap-2 mt-auto pt-2 flex-wrap">
                      {pkg.latest_version && (
                        <Badge variant="outline" className="text-xs">
                          <Package className="h-3 w-3 mr-1" aria-hidden="true" />
                          {t('marketplace.versionBadge', { version: pkg.latest_version })}
                        </Badge>
                      )}
                      <div className="ml-auto">
                        {notLoaded ? (
                          <Badge variant="destructive" className="text-xs">
                            {t('marketplace.notLoaded.badge')}
                          </Badge>
                        ) : isInstalled ? (
                          <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" />
                            {t('marketplace.org.installedBadge', { defaultValue: 'Installed' })}
                          </Badge>
                        ) : (
                          <Button size="sm" onClick={() => void doOrgInstall(pkg)} disabled={orgInstalling === pkg.id}>
                            {orgInstalling === pkg.id
                              ? t('marketplace.org.installing', { defaultValue: 'Installing…' })
                              : isDisabled
                                ? t('marketplace.action.reinstall')
                                : t('marketplace.org.install', { defaultValue: 'Install' })}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="border-b pt-2" />
        </section>
      )}

      {loading && items.length === 0 ? (
        // The skeleton stands for the first `SKELETON_MS` of a read only
        // (objectui#12710); after that the loading line above stands alone.
        loadPhase !== 'skeleton' ? null : (
          <div className={CARD_GRID} data-testid="marketplace-skeleton">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-10 w-10 rounded-lg mb-2" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2 mt-1" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-12 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : error ? (
        // The catalog's failure is its empty state (objectui#12710): what
        // failed, its class, the server's own words, the online hint when
        // being online is the cause (objectui#11688), and Retry. Not "no apps
        // have been approved yet": that is a claim about a catalog this page
        // failed to read. The org section above and the header's Installed
        // button stay usable.
        <div
          role="alert"
          data-testid="marketplace-load-failed"
          className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="flex-1">
            <div className="font-medium text-destructive">{t('marketplace.load.failed')}</div>
            <LoadFailureCause failure={error} />
            {/* The hint names the control plane the SERVER said it uses, so it
                can never claim a default the operator overrode (objectui#5504).
                Under `''` it names none and says only that the catalog is
                reached through this runtime, which is true whether the runtime
                serves the catalog or proxies a plane: no failure the proxy
                returns carries the upstream host in a field or a header, and
                the server's prose is never parsed for one (objectui#11726).
                Plain text, not `dangerouslySetInnerHTML`: `cloudBase` is
                server-supplied data and interpolating it into innerHTML would
                be an injection sink for no gain. Shown only when being online
                is the cause (`toLoadFailure`, objectui#11688). */}
            {error.showOnlineHint && (
              <div className="text-xs text-muted-foreground mt-2" data-testid="marketplace-load-hint">
                {cloudBase
                  ? t('marketplace.load.failedHintConfigured', { url: cloudBase })
                  : t('marketplace.load.failedHintSameOrigin')}
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => void load()}
              data-testid="marketplace-load-retry"
            >
              {t('marketplace.load.retry')}
            </Button>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground" data-testid="marketplace-empty">
          {filtering ? t('marketplace.noMatchFilters') : t('marketplace.noApprovedYet')}
        </div>
      ) : (
        <>
        <div className={CARD_GRID}>
          {shown.map(({ it: pkg, taxonomy }) => {
            const primaryFunction = taxonomy.businessFunctions[0];
            const localEntry = installedByManifestId.get(pkg.manifest_id);
            const loc = localizePackage(pkg, language);
            return (
              <Card
                key={pkg.id}
                className="cursor-pointer transition-colors hover:bg-accent/50 flex flex-col"
                onClick={() => navigate(`${basePath}/system/marketplace/${pkg.id}`)}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`${basePath}/system/marketplace/${pkg.id}`);
                  }
                }}
                data-testid={`marketplace-card-${pkg.manifest_id}`}
              >
                <PackageCardHeader
                  iconUrl={pkg.icon_url}
                  displayName={loc.displayName}
                  manifestId={pkg.manifest_id}
                  badge={pkg.publisher && pkg.publisher !== 'private' && (
                    <Badge variant={pkg.publisher === 'objectstack' ? 'default' : 'secondary'} className="self-start">
                      {pkg.publisher}
                    </Badge>
                  )}
                />
                <CardContent className="flex-1 flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {loc.description || t('marketplace.noDescription')}
                  </p>
                  <div className="flex items-center gap-2 mt-auto pt-2 flex-wrap">
                    {/* objectui#11760 — a local install this runtime refused to
                        load at startup (the listing's `notLoaded` marker) is not
                        drawn as "Installed": its version and the destructive
                        "Not loaded" badge, as Installed Apps draws the same
                        entry (objectui#11645). Details carries the reason. */}
                    {localEntry && (localEntry.notLoaded ? (
                      <>
                        <Badge variant="outline" className="text-xs">
                          {t('marketplace.versionBadge', { version: localEntry.version })}
                        </Badge>
                        <Badge variant="destructive" className="text-xs">
                          {t('marketplace.notLoaded.badge')}
                        </Badge>
                      </>
                    ) : (
                      <Badge
                        variant="default"
                        className="text-xs bg-green-600 hover:bg-green-600"
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" />
                        {t('marketplace.installedBadge', { version: localEntry.version })}
                      </Badge>
                    ))}
                    {pkg.latest_version?.version && (
                      <Badge variant="outline" className="text-xs">
                        <Package className="h-3 w-3 mr-1" aria-hidden="true" />
                        {t('marketplace.versionBadge', { version: pkg.latest_version.version })}
                      </Badge>
                    )}
                    {/* The primary business function — the first the
                        listing names — and Beta for a beta package. */}
                    {primaryFunction && (
                      <Badge variant="outline" className="text-xs" data-testid="marketplace-card-function">
                        {t(`marketplace.businessFunction.${primaryFunction}`)}
                      </Badge>
                    )}
                    {taxonomy.beta && (
                      <Badge variant="secondary" className="text-xs" data-testid="marketplace-card-beta">
                        {t('marketplace.maturity.beta')}
                      </Badge>
                    )}
                    {pkg.latest_version?.published_at && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {formatRelative(pkg.latest_version.published_at)}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {pageCount > 1 && (
          <nav
            aria-label={t('table.pageInfo', { current: pageNumber, total: pageCount })}
            className="flex items-center justify-center gap-3 text-sm"
            data-testid="marketplace-pager"
          >
            <Button
              size="sm"
              variant="outline"
              disabled={pageNumber <= 1 || loading}
              onClick={() => setOffset(Math.max(0, offset - CATALOG_PAGE_SIZE))}
              data-testid="marketplace-pager-previous"
            >
              {t('common.previous')}
            </Button>
            <span className="tabular-nums text-muted-foreground" data-testid="marketplace-pager-info">
              {t('table.pageInfo', { current: pageNumber, total: pageCount })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pageNumber >= pageCount || loading}
              onClick={() => setOffset(offset + CATALOG_PAGE_SIZE)}
              data-testid="marketplace-pager-next"
            >
              {t('common.next')}
            </Button>
          </nav>
        )}
        </>
      )}
    </div>
    </div>
  );
}
