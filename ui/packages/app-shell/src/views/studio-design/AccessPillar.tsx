// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Access pillar — the permission-set rail and the embedded permission
 * workbench — with its "New similar" arrival reader and the list-row name
 * label only it draws, moved out of `StudioDesignSurface.tsx` unchanged by
 * objectstack#36893 (the move-only split's pillar slice; the surface
 * re-exports it).
 */

import * as React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { formatMetadataError } from '@object-ui/data-objectstack';
import { type I18nLabel } from '@objectstack/spec/ui';
import { type StudioSurfaceLabel } from './StudioAiCopilot.js';
import { StudioItemHeader, StudioStatusChip, type StudioItemStatus } from './StudioItemHeader.js';
import { StudioRail, StudioRailRow } from './StudioRail.js';
import { StudioEmptyState, StudioEmptyStateAction } from './StudioEmptyState.js';
import { pairIdOf } from './AutomationsFlowRail.js';
import {
  confirmDropUnsavedWork,
  CreateTakenNotice,
  findTakenIdentifier,
  type StudioBaseCustomization,
  StudioReadOnlyLink,
} from './StudioPillarKit.js';
import { useIsMobile } from '@object-ui/components';
import { Copy, Shield, ShieldCheck, ShieldQuestion, Menu, Undo2 } from 'lucide-react';
import { PermissionMatrixEditPage, type PermissionStudioTab } from '../metadata-admin/PermissionMatrixEditor.js';
import { AccessExplainPanel } from '../metadata-admin/AccessExplainPanel.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { publishSavedItem } from './studioSaveBar.js';
import { studioPillarItemPath } from './metadataArea.js';
import { PermissionSetCloneDialog } from '../metadata-admin/PermissionSetCloneDialog.js';
import { type PermissionSetCloned } from '../metadata-admin/permission-set-clone.js';
import {
  NEW_SIMILAR_ARRIVAL_STATE,
  NewSimilarStripNotice,
  readNewSimilarArrival,
  type NewSimilarStrip,
} from './permissionNewSimilar.js';
import { useWalledCatalogReadOnly } from '../metadata-admin/catalog-scope.js';
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import { useSurfaceDeepLink, resolveSurfaceDeepLink } from './useSurfaceDeepLink.js';
import { buildPermissionSkeleton } from './skeletons.js';
import { t, tFormat, translateMetadataType, useMetadataLocale } from '../metadata-admin/i18n.js';
import { SuggestedBindingsPanel } from '../../components/SuggestedBindingsPanel.js';
import { accessSuggestionStrings } from './accessSuggestionStrings.js';
import type { SuggestedBinding } from '../../services/suggestedBindingsApi.js';
import { suggestedSetLabel as suggestedSetLabelOf } from '../../components/suggestedSetLabel.js';
import {
  navItemLabelText,
} from '../metadata-admin/previews/navItemLabel.js';
import { errorCodeIs } from '@object-ui/types';
import { CreateItemDialog } from './CreateItemDialog.js';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel.js';
import {
  RailCustomizationFilter,
  RailCustomizationMark,
  StudioPairItemChip,
  railCustomizationsOf,
  useDeepLinkFallback,
  useRailCustomizationsOnly,
} from './StudioRailCustomizations.js';
import { toast } from 'sonner';

/**
 * A Studio list row's name (objectui#11862, on the maintainer's word
 * 「所有地方以标签为主，机器名只作为次要信息」): the label as the primary text, and
 * the machine name beneath it as secondary text — smaller and monospace — when
 * it differs from the label. With no label the name alone is the text.
 *
 * Display only: it reads what the row already holds and writes nothing. The
 * secondary name is `aria-hidden`, so a row's accessible name stays the label
 * it was; the nav rail carries the machine name for assistive tech on the
 * row's `title` (`type · name`), as it did before.
 */
function StudioNameLabel({ label, name }: { label: string; name?: string }): React.ReactElement {
  const primary = label.trim() ? label : (name ?? '');
  const secondary = name && name !== primary ? name : '';
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate">{primary}</span>
      {secondary ? (
        <span aria-hidden="true" className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
          {secondary}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Access pillar — the permission workbench (builder-ui §7, ADR-0084's fourth
 * content pillar). Left rail: the environment's permission sets / profiles;
 * main: the Salesforce-style PermissionMatrixEditPage (objects × CRUD/VAMA +
 * field-level R/W).
 *
 * Scope note (ADR-0086 P0/P1/P2): the pillar is scoped to the current package.
 * The left rail lists only permission sets this package owns — the metadata API
 * filters `permission` by the record-level `package_id` provenance server-side
 * (P1), so environment-owned platform defaults (`admin_full_access`,
 * `member_default`, …) are excluded by the backend. The object MATRIX lists only
 * the objects this package declares, and Save merges just that slice back,
 * leaving other packages' contributed rows untouched (P0). Save writes a package
 * DRAFT and publishes with the whole package via the top-bar Publish (P2, D6).
 */
// Exported for tests — routed only through StudioDesignSurface in production.
export function AccessPillar({
  packageId: railPackageId,
  publishNonce,
  onDraftSaved,
  readOnly: packageReadOnly = false,
  customization = null,
  onDirtyChange,
  onSurfaceLabelChange,
}: {
  packageId: string;
  publishNonce?: number;
  onDraftSaved?: () => void;
  /** Courtesy gate: hide/disable permission-authoring affordances. */
  readOnly?: boolean;
  /** objectstack#28572 — on a read-only base, its pair: the rail lists the pair's sets too, and New lands there. */
  customization?: StudioBaseCustomization | null;
  /** objectui#2600 — mirrors the pillar's unsaved-edit state (permission
   * matrix or OWD overview rows) up to the Studio header, whose
   * pillar/Home/package navigation unmounts this whole pillar (SPA nav, so no
   * beforeunload). Reports `false` when the pillar unmounts, same contract as
   * PermissionMatrixEditPage's own onDirtyChange. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * objectstack#35018 — the open set's label (or the record-visibility
   * overview's title) for the copilot's chip: 「正在看：权限 · 组织成员」,
   * never the type word and machine name. Same seam as the Data and
   * Interfaces pillars' reports.
   */
  onSurfaceLabelChange?: (surface: StudioSurfaceLabel | null) => void;
}): React.ReactElement {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  // See DataPillar's rail — same mobile-overlay treatment for the permission-set list.
  const isMobile = useIsMobile();
  const [railOpen, setRailOpen] = React.useState(false);
  // objectui#7255 — same live-pulse subscription as the sibling rails; this
  // one only replaces the permission-set LIST, so no edit-buffer hold.
  const metadataRefreshNonce = useMetadataRefreshNonce();
  const [perms, setPerms] = React.useState<
    Array<{ name: string; label: string; isDefault?: boolean; addedIn?: string }>
  >([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState<string | null>(null);
  // objectstack#28572 (ADR-0146 D3) — the rail is the base's; on a read-only
  // base it lists the sets its pair adds too, and New lands in the pair. A set
  // the pair adds opens writable, read and saved at the pair: the open set's
  // matrix names `packageId` and asks `readOnly`, the open set's own. The
  // package-wide surfaces (the OWD overview, suggested bindings, Explain)
  // stay the base's.
  const railPairId = packageReadOnly && customization ? customization.pairId : null;
  const railMarks = railCustomizationsOf(customization?.marks, railPackageId);
  const [onlyCustomized, toggleOnlyCustomized] = useRailCustomizationsOnly();
  const newInPair = packageReadOnly && customization !== null && !customization.walled;
  const currentAddedIn = perms.find((p) => p.name === current)?.addedIn;
  const packageId = currentAddedIn ?? railPackageId;
  const readOnly = packageReadOnly && !currentAddedIn;
  // The Record Sharing Baseline (OWD) overview is a sibling surface to the
  // permission-set matrix (objectui#2505) — same package-author ownership
  // boundary, no principal dimension. `owdOpen` swaps the main panel to it;
  // `owdHighlight` carries the object a permission-matrix badge deep-linked to.
  const [owdOpen, setOwdOpen] = React.useState(false);
  const [owdHighlight, setOwdHighlight] = React.useState<string | null>(null);
  const appliedOwdDeepLink = React.useRef(false);
  // `?surface=permission:<name>` / `?surface=owd:overview` capture + mirror —
  // shared plumbing (see useSurfaceDeepLink). This rail keys `current` by name,
  // so wrap the open surface in the identity the param carries.
  const currentSurface = React.useMemo(
    () =>
      owdOpen
        ? { type: 'owd', name: 'overview' }
        : current
          ? { type: 'permission', name: current }
          : null,
    [owdOpen, current],
  );
  const initialSurface = useSurfaceDeepLink(currentSurface);
  // objectstack#28572 — see `useDeepLinkFallback`.
  const deepLinkUpgrade = useDeepLinkFallback();
  // objectstack#35018 — lift the open set's label to the copilot's chip, the
  // pillar's word first: 「正在看：权限 · 组织成员」. Keyed on primitives, the
  // callback read through a ref (the Data pillar's report).
  const onSurfaceLabelChangeRef = React.useRef(onSurfaceLabelChange);
  React.useEffect(() => {
    onSurfaceLabelChangeRef.current = onSurfaceLabelChange;
  });
  const accessSubject = t('engine.studio.copilot.subject.access', locale);
  const currentSetLabel = current ? perms.find((p) => p.name === current)?.label : undefined;
  const surfaceReportLabel = owdOpen
    ? `${accessSubject} · ${t('engine.studio.owd.title', locale)}`
    : current && currentSetLabel
      ? `${accessSubject} · ${currentSetLabel}`
      : undefined;
  const surfaceReportType = currentSurface?.type;
  const surfaceReportName = currentSurface?.name;
  React.useEffect(() => {
    onSurfaceLabelChangeRef.current?.(
      surfaceReportType && surfaceReportName && surfaceReportLabel
        ? { type: surfaceReportType, name: surfaceReportName, label: surfaceReportLabel }
        : null,
    );
  }, [surfaceReportType, surfaceReportName, surfaceReportLabel]);
  React.useEffect(
    () => () => {
      onSurfaceLabelChangeRef.current?.(null);
    },
    [],
  );
  const currentRef = React.useRef(current);
  React.useLayoutEffect(() => {
    currentRef.current = current;
  });
  const [query, setQuery] = React.useState('');
  // inline creator (same rail pattern as the Data pillar's object creator)
  const [creating, setCreating] = React.useState(false);
  const [createErr, setCreateErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // objectstack#26836 — a create refused because the name is taken: which set
  // holds it, and whether it is this package's, so the dialog can open it.
  const [createTaken, setCreateTaken] = React.useState<{ name: string; label: string; here: boolean } | null>(null);
  // Which of the rail's sets are published, and which hold a pending draft:
  // the draft discard's two inputs, read by `load` with the rail.
  const [publishedNames, setPublishedNames] = React.useState<ReadonlySet<string>>(() => new Set());
  const [draftNames, setDraftNames] = React.useState<ReadonlySet<string>>(() => new Set());
  const [discarding, setDiscarding] = React.useState(false);
  // Bumped by a discard: the open matrix re-reads as it does after a publish,
  // since in both its draft is gone (added to `publishNonce` below).
  const [draftGoneNonce, setDraftGoneNonce] = React.useState(0);
  // [ADR-0090 D6] "why can this user access?" — right-side explain sheet.
  const [explainOpen, setExplainOpen] = React.useState(false);
  // objectstack#28573 (ADR-0146 D6) — "New similar" on a read-only base's set:
  // whether its dialog is open, and what the strip above the matrix says. A
  // `landed` strip is the copy the clone door saved, shown on that copy; a
  // `noPackage` / `noName` strip is an answer this pillar cannot open, shown
  // on the base. The copy usually opens in ANOTHER package, which remounts
  // this pillar (keyed by package), so the strip rides the navigation's state
  // and is read once here.
  const navigate = useNavigate();
  const location = useLocation();
  const [newSimilarOpen, setNewSimilarOpen] = React.useState(false);
  // objectstack#32774 — the package "New similar" clones the open set from,
  // as the matrix read it: named only where the set's name has more than one
  // holder (`onCloneSourceRead`), so a name with one holder is cloned by name.
  const [newSimilarSource, setNewSimilarSource] = React.useState<{ name: string; sourcePackage: string | undefined } | null>(
    null,
  );
  const onCloneSourceRead = React.useCallback((name: string, sourcePackage: string | undefined) => {
    setNewSimilarSource((prev) =>
      prev && prev.name === name && prev.sourcePackage === sourcePackage ? prev : { name, sourcePackage },
    );
  }, []);
  const [newSimilarStrip, setNewSimilarStrip] = React.useState<NewSimilarStrip | null>(() => {
    // objectstack#28572 — a copy that landed in the base's pair arrives on
    // the base's surface; matched by the spec's pairing rule (a read).
    const pair = pairIdOf(railPackageId);
    return readNewSimilarArrival(location.state, railPackageId) ?? (pair ? readNewSimilarArrival(location.state, pair) : null);
  });
  // Who may press it: the clone door asks the metadata door's verdict
  // (`manage_metadata`), and under a wall the catalog is the platform
  // operator's (ADR-0131 D3), refused whatever the capability. Either way the
  // action draws disabled, with the console's own sentence for why.
  const canAuthorSets = useCanAuthorMetadata();
  const walledSets = useWalledCatalogReadOnly('permission');
  // objectui#12456 — the open set's tab (epic objectui#12446, decision C):
  // Objects, System capabilities, Row-level security, Tab visibility,
  // Delegated admin. Objects is the landing; the choice holds across sets.
  const [accessTab, setAccessTab] = React.useState<PermissionStudioTab>('objects');
  // Both main-panel surfaces hold unsaved edits and unmount on a rail-driven
  // swap: the matrix page is keyed by `current` (and unmounts entirely when
  // the OWD overview swaps in), and the OWD overview batch-editor unmounts
  // when a set swaps back in. Each editor reports its dirty state up
  // (`onDirtyChange` — the two never coexist, so at most one bit is set), and
  // every swap is gated on this confirm — same native prompt as the metadata
  // editor's leave guard. Each editor resets its report on unmount, so a
  // confirmed discard clears its bit by itself.
  const [matrixDirty, setMatrixDirty] = React.useState(false);
  const [owdDirty, setOwdDirty] = React.useState(false);
  const pillarDirty = matrixDirty || owdDirty;
  // The combined bit also gates the Studio header's pillar/Home/package
  // navigation, which unmounts this whole pillar (objectui#2600) — mirror it
  // up alongside the local rail guard. Ref-stabilized like the editors' own
  // reports; the unmount cleanup reports `false` so a discarded pillar clears
  // the surface's guard state.
  const onDirtyChangeRef = React.useRef(onDirtyChange);
  React.useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  React.useEffect(() => {
    onDirtyChangeRef.current?.(pillarDirty);
  }, [pillarDirty]);
  React.useEffect(
    () => () => {
      onDirtyChangeRef.current?.(false);
    },
    [],
  );
  const confirmDiscardEdits = React.useCallback(
    () => confirmDropUnsavedWork(pillarDirty, locale),
    [pillarDirty, locale],
  );

  // objectstack#28572 — the latest rail read wins: a read the pair's arrival
  // re-ran can finish before or after one a New in the pair asked for.
  const loadSeqRef = React.useRef(0);
  const load = React.useCallback(async (pairOverride?: string) => {
    const seq = ++loadSeqRef.current;
    const railPair = pairOverride ?? railPairId;
    try {
      // Scope the rail to this package server-side (ADR-0086 P1): the metadata
      // API filters `permission` by the record-level `package_id` provenance, so
      // it returns only the sets this package owns — environment-owned platform
      // defaults (`admin_full_access`, `member_default`, …) are excluded by the
      // backend, not the client. (The `?package=` list rows don't echo the
      // provenance columns, so a client-side filter can't do this.)
      //
      // ADR-0086 P2 (D6): a package permission set is draft/published metadata,
      // so the rail shows published ∪ pending-draft sets — a set created (or
      // renamed) as a draft but not yet published must still appear, just like
      // the Data/Interfaces pillars merge their drafts. Draft headers are
      // already package-scoped by `listDrafts({ packageId })`.
      const packageId = railPackageId;
      // objectstack#28572 — and, on a read-only base with a pair, the pair's
      // published and draft sets: those the base's list does not hold are the
      // sets the pair adds. A failed pair read lists none of them.
      const readPair = async () =>
        railPair === null
          ? null
          : Promise.all([
              client.list('permission', { packageId: railPair }) as Promise<Array<Record<string, unknown>>>,
              client.listDrafts({ packageId: railPair, type: 'permission' }).catch(() => []),
            ]);
      const [list, drafts, pair] = await Promise.all([
        client.list('permission', { packageId }) as Promise<Array<Record<string, unknown>>>,
        client.listDrafts({ packageId, type: 'permission' }).catch(() => []),
        readPair().catch(() => null),
      ]);
      if (seq !== loadSeqRef.current) return;
      const byName = new Map<string, { name: string; label: string; isDefault?: boolean; addedIn?: string }>();
      for (const p of list || []) {
        const name = String(p.name ?? (p as Record<string, unknown>).id ?? '');
        if (!name) continue;
        byName.set(name, {
          name,
          label: String(p.label ?? p.name ?? ''),
          isDefault: !!(p as Record<string, unknown>).isDefault,
        });
      }
      // objectui#11862 — a draft-only set reads as the label its `_drafts` row
      // carries (objectstack-ai/objectstack#22200), in the designer locale; the
      // set is not read for it (ruling `6053526025`, question 1). A row with
      // no label leaves `label` empty, and the rail shows the name alone.
      for (const d of (drafts as Array<{ name?: string; label?: I18nLabel | null }>) || []) {
        const name = String(d?.name ?? '');
        if (!name || byName.has(name)) continue;
        byName.set(name, { name, label: navItemLabelText(d?.label ?? undefined, locale).trim() });
      }
      const [pairList, pairDrafts] = pair ?? [[], []];
      if (railPair !== null) {
        for (const p of pairList || []) {
          const name = String(p.name ?? (p as Record<string, unknown>).id ?? '');
          if (!name || byName.has(name)) continue;
          byName.set(name, { name, label: String(p.label ?? p.name ?? ''), addedIn: railPair });
        }
        for (const d of (pairDrafts as Array<{ name?: string; label?: I18nLabel | null }>) || []) {
          const name = String(d?.name ?? '');
          if (!name || byName.has(name)) continue;
          byName.set(name, { name, label: navItemLabelText(d?.label ?? undefined, locale).trim(), addedIn: railPair });
        }
      }
      const scoped = [...byName.values()];
      setPerms(scoped);
      const nameOf = (p: Record<string, unknown>) => String(p.name ?? p.id ?? '');
      setPublishedNames(new Set([...(list || []), ...(pairList || [])].map(nameOf)));
      setDraftNames(
        new Set(
          [...((drafts as Array<{ name?: string }>) || []), ...((pairDrafts as Array<{ name?: string }>) || [])]
            .map((d) => String(d?.name ?? ''))
            .filter(Boolean),
        ),
      );
      // A `?surface=owd:overview` deep-link opens the OWD overview instead of a
      // permission set; `current` still defaults to the first set so switching
      // back to the matrix has a target. Applied once — a later publish re-runs
      // `load`, and we must not yank the user back to OWD then.
      if (!appliedOwdDeepLink.current && initialSurface?.type === 'owd') {
        appliedOwdDeepLink.current = true;
        setOwdOpen(true);
      }
      const deepLinked = resolveSurfaceDeepLink(scoped, initialSurface, 'permission');
      // objectstack#28572 — a set the pair adds is listed once the pair is
      // known (`useDeepLinkFallback`).
      if (deepLinked && deepLinkUpgrade.take(currentRef.current, deepLinked.name)) {
        setCurrent(deepLinked.name);
      } else {
        if (!deepLinked && initialSurface?.type === 'permission' && currentRef.current === null) {
          deepLinkUpgrade.note(scoped[0]?.name ?? null);
        }
        setCurrent((c) => c ?? deepLinked?.name ?? scoped[0]?.name ?? null);
      }
    } catch (e) {
      if (seq === loadSeqRef.current) setError(formatMetadataError(e));
    } finally {
      if (seq === loadSeqRef.current) setLoaded(true);
    }
  }, [client, railPackageId, railPairId, locale]);

  React.useEffect(() => {
    void load();
    // Re-read after a package publish so drafts that went live collapse into
    // the published rail (ADR-0086 P2), and on the live-metadata pulse so a
    // copilot turn's permission set appears without a page reload (#7255).
  }, [load, publishNonce, metadataRefreshNonce]);

  const doCreate = React.useCallback(
    async (label: string, name: string) => {
      setBusy(true);
      setCreateErr(null);
      setCreateTaken(null);
      try {
        // A name a permission set already holds, published or as a draft, in
        // this package or any other, is refused here and nothing is written:
        // over a published set the first-write pin below would write this
        // blank skeleton as its pending draft (`findTakenIdentifier`).
        const taken = await findTakenIdentifier(client, 'permission', name, locale);
        if (taken) {
          setCreateTaken({ ...taken, here: perms.some((p) => p.name === name) });
          return;
        }
        // objectstack#28572 (ADR-0146 D3) — on a read-only base the set is
        // created in its pair, which the ensure door answers (creating it on
        // first use, without a prompt).
        const target =
          packageReadOnly && customization ? (await customization.ensurePackage()).packageId : railPackageId;
        // Package door → a DRAFT stamped with this package (D6/D7).
        // objectui#11773 — and the door refuses a draft row too (the
        // first-write pin), for one that lands between the check above and
        // this save. A set published in that window is not refused by it.
        await client.save('permission', name, buildPermissionSkeleton(name, label), {
          mode: 'draft',
          packageId: target,
          ifNoneMatch: '*',
          surface: 'studio',
        });
        // objectstack#36511 — then that one set is published, so it is live at
        // once like every Save in Studio. A refused publish takes back the
        // draft it wrote, so nothing is created, and says why.
        const live = await publishSavedItem(client, { type: 'permission', name, packageId: target }, false);
        if (!live.ok) {
          setCreateErr(formatMetadataError(live.error));
          return;
        }
        toast.success(tFormat('engine.studio.access.created', locale, { label }));
        setCreating(false);
        // A set made in the pair is read back from the pair the door named.
        await load(target === railPackageId ? undefined : target);
        // Land on the new set's matrix — also from the OWD overview, whose
        // discard the "+ New" gate already confirmed up front.
        setOwdOpen(false);
        setCurrent(name);
      } catch (e) {
        // objectstack#26846 — the first-write pin's refusal, for a draft that
        // landed after the check above, read by its code: this create sent
        // the pin, so a conflict means the identifier holds a draft. The
        // door's sentence speaks of the pin itself and is not shown.
        setCreateErr(
          errorCodeIs(e, 'METADATA_CONFLICT')
            ? tFormat('engine.studio.access.createDraftTaken', locale, { name })
            : formatMetadataError(e),
        );
      } finally {
        setBusy(false);
      }
    },
    [client, load, railPackageId, packageReadOnly, customization, locale, perms],
  );

  // The refusal's way out: the taken set is this package's, so it opens in
  // the matrix instead of a second one being made. The "+ New" gate already
  // confirmed any discard of unsaved edits.
  const openTakenSet = React.useCallback((name: string) => {
    setCreating(false);
    setCreateTaken(null);
    setOwdOpen(false);
    setCurrent(name);
  }, []);

  // objectstack#28573 — the clone door saved a copy of the open set. It opens
  // only where the answer says it landed: that package's Access pillar with
  // the copy selected. An answer that names no copy, or no package, is said
  // so and opens nothing; the landing is never derived from the base.
  const onNewSimilarSaved = React.useCallback(
    (copy: PermissionSetCloned) => {
      setNewSimilarOpen(false);
      if (!copy.name) {
        setNewSimilarStrip({ kind: 'noName', notice: copy.notice, noticeCode: copy.noticeCode });
        return;
      }
      if (typeof copy.package !== 'string') {
        setNewSimilarStrip({ kind: 'noPackage', name: copy.name, notice: copy.notice, noticeCode: copy.noticeCode });
        return;
      }
      const landed: NewSimilarStrip = {
        kind: 'landed',
        name: copy.name,
        package: copy.package,
        notice: copy.notice,
        noticeCode: copy.noticeCode,
      };
      // objectstack#28572 — the pair's sets are this surface's too.
      if (copy.package === railPackageId || (railPairId !== null && copy.package === railPairId)) {
        setNewSimilarStrip(landed);
        setOwdOpen(false);
        setCurrent(copy.name);
        void load();
        return;
      }
      navigate(studioPillarItemPath(copy.package, 'access', { type: 'permission', name: copy.name }), {
        state: { [NEW_SIMILAR_ARRIVAL_STATE]: landed },
      });
    },
    [railPackageId, railPairId, navigate, load],
  );

  // Discard the open set's pending draft (`DELETE ?state=draft` at this
  // package's address, the door the metadata editor's "Discard draft" uses).
  // A published set goes back to its live body; a set that was never
  // published has nothing left, so it leaves the rail.
  const discardDraft = React.useCallback(
    async (name: string) => {
      const row = perms.find((p) => p.name === name);
      const item = row?.label || name;
      const neverPublished = !publishedNames.has(name);
      // One confirm: an unsaved edit on the open matrix is an unpublished
      // change of this same set, and the discard removes it with the rest.
      if (
        !window.confirm(
          tFormat(
            neverPublished ? 'engine.studio.access.discardConfirmUnpublished' : 'engine.studio.access.discardConfirm',
            locale,
            { item },
          ),
        )
      ) {
        return;
      }
      setDiscarding(true);
      try {
        await client.reset('permission', name, { state: 'draft', packageId });
        toast.success(tFormat('engine.edit.draftDiscarded', locale, { item }));
        if (neverPublished) setCurrent((c) => (c === name ? null : c));
        // The open matrix holds the discarded draft and the pin it was read
        // with: read it again, as after a publish (its draft is gone).
        setDraftGoneNonce((n) => n + 1);
        onDraftSaved?.();
        await load();
      } catch (e) {
        toast.error(t('engine.studio.access.discardFailed', locale), {
          description: formatMetadataError(e),
          classNames: { description: 'whitespace-pre-line' },
        });
      } finally {
        setDiscarding(false);
      }
    },
    [perms, publishedNames, locale, client, packageId, onDraftSaved, load],
  );

  const filtered = perms.filter(
    (p) =>
      (!query.trim() ||
        p.label.toLowerCase().includes(query.trim().toLowerCase()) ||
        p.name.toLowerCase().includes(query.trim().toLowerCase())) &&
      // objectstack#28572 — "only customizations" keeps the marked rows.
      (!onlyCustomized || railMarks?.markOf({ type: 'permission', ...p }) != null),
  );
  const markedSets = railMarks ? perms.filter((p) => railMarks.markOf({ type: 'permission', ...p }) !== null).length : 0;

  // objectui#12459 — the item header inside the content column. The
  // "Permission matrix" band above the rail retires. objectui#12456 — an
  // open set's header is the matrix page's own (its label, api name, Package
  // chip, granted / override counts, History, the tab row), fed the three
  // pieces below; this pillar draws the header for the OWD overview and for
  // the empty states.
  const accessRailToggleEl = (
    <button
      type="button"
      onClick={() => setRailOpen((v) => !v)}
      aria-label={t('engine.studio.toggleRail', locale)}
      className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
    >
      <Menu className="h-4 w-4" />
    </button>
  );
  // objectui#11781 — "saved as draft" is what an editable package does. A
  // read-only one saves nothing: objectui#12453 puts the read-only link where
  // the note was, and the link's title carries the note's sentence. An open
  // set's header draws it at the tab row's right end (objectui#12456: the
  // title row truncated the set's label at the 1280 px design width).
  // objectui#12524 — the writable note is this pillar's draft status: the
  // header draws it in the status place every pillar shares. The read-only
  // link is an action, so it stays in the actions slot.
  // The note speaks for what the main panel shows: the open set, or the
  // package-wide OWD overview and empty header, which are the base's.
  const noteReadOnly = owdOpen || current === null ? packageReadOnly : readOnly;
  // objectstack#29674 — an open set the pair adds lists its base's objects
  // too (`permissionObjectScopePackages`), so its note names the base instead
  // of claiming "this package's objects" only.
  const notePairBase = !owdOpen && current !== null && currentAddedIn ? (customization?.baseLabel ?? railPackageId) : null;
  const accessStatus: StudioItemStatus | undefined = noteReadOnly
    ? undefined
    : notePairBase !== null
      ? {
          label: tFormat('engine.studio.access.bannerPair', locale, { package: notePairBase }),
          title: tFormat('engine.studio.access.bannerTitlePair', locale, { package: notePairBase }),
        }
      : { label: t('engine.studio.access.banner', locale), title: t('engine.studio.access.bannerTitle', locale) };
  const accessNoteEl = accessStatus ? (
    <StudioStatusChip {...accessStatus} />
  ) : (
    <StudioReadOnlyLink
      item={current !== null && !owdOpen ? { type: 'permission', name: current } : null}
      title={t('engine.studio.access.bannerTitleReadOnly', locale)}
      locale={locale}
    />
  );
  const accessExplainEl = (
    <button
      type="button"
      onClick={() => setExplainOpen(true)}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ShieldQuestion className="h-3.5 w-3.5" />
      {t('engine.studio.access.explain.open', locale)}
    </button>
  );
  // The rail's "+" — and the empty block's button, which runs this same
  // handler (objectui#12514). Creating a set lands on the new set's matrix — a
  // remount of the open matrix, or a swap out of the OWD overview — so gate
  // the flow up front.
  const openCreateSet = packageReadOnly && !newInPair
    ? undefined
    : () => {
        if (!confirmDiscardEdits()) return;
        setCreateErr(null);
        setCreateTaken(null);
        setCreating(true);
      };
  // objectstack#26836 — the open set's pending draft can be discarded where
  // the set is edited; nothing in Studio offered it, so a blank draft over a
  // live set could only be published.
  const accessDiscardEl =
    !readOnly && current && !owdOpen && draftNames.has(current) ? (
      <button
        type="button"
        data-testid="access-discard-draft"
        onClick={() => void discardDraft(current)}
        disabled={discarding}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <Undo2 className="h-3.5 w-3.5" />
        {t('engine.edit.discardDraft', locale)}
      </button>
    ) : null;
  // objectstack#28573 (ADR-0146 D6) — a read-only base's set offers "New
  // similar", never an override: the copy is a NEW set, in the package the
  // clone door chooses. Disabled, it says why in the console's words.
  const newSimilarBlocked = walledSets
    ? tFormat('engine.catalog.readOnly.walled', locale, { type: translateMetadataType('permission', locale) })
    : canAuthorSets
      ? null
      : t('engine.edit.capabilityReadOnly', locale);
  const accessNewSimilarEl =
    readOnly && current && !owdOpen ? (
      <span title={newSimilarBlocked ?? t('perm.clone.hint', locale)} className="inline-flex">
        <button
          type="button"
          data-testid="access-new-similar"
          onClick={() => {
            setNewSimilarStrip(null);
            setNewSimilarOpen(true);
          }}
          disabled={newSimilarBlocked !== null || newSimilarOpen}
          aria-describedby={newSimilarBlocked !== null ? 'access-new-similar-blocked' : undefined}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" />
          {t('perm.clone.action', locale)}
        </button>
        {newSimilarBlocked !== null && (
          <span id="access-new-similar-blocked" className="sr-only">
            {newSimilarBlocked}
          </span>
        )}
      </span>
    ) : null;
  const newSimilarStripEl =
    newSimilarStrip && !owdOpen && (newSimilarStrip.kind !== 'landed' || newSimilarStrip.name === current) ? (
      <NewSimilarStripNotice strip={newSimilarStrip} locale={locale} onDismiss={() => setNewSimilarStrip(null)} />
    ) : null;
  const accessHeaderEl = (
    <StudioItemHeader
      testId="access-item-header"
      leading={accessRailToggleEl}
      icon={owdOpen ? ShieldCheck : Shield}
      title={owdOpen ? t('engine.studio.owd.title', locale) : t('engine.studio.access.title', locale)}
      meta={owdOpen ? t('engine.studio.owd.subtitle', locale) : t('engine.studio.access.subtitle', locale)}
      status={accessStatus}
      actions={
        <>
          {noteReadOnly && accessNoteEl}
          {accessExplainEl}
        </>
      }
    />
  );

  // A suggestion names its set by machine name only; the banner, its toasts
  // and its state lines name it by the label the rail shows for that set
  // (`ux-conventions.labels-over-machine-names`). The suggestions listed here
  // are this package's own sets, which the rail read; a set the rail does not
  // hold, or one with no label, is named by its machine name.
  const suggestedSetLabel = (s: SuggestedBinding): string => suggestedSetLabelOf(s, perms);

  return (
    <div className="flex h-full flex-col">
      {/* ADR-0090 D5/D9 — this package's suggested audience bindings
          (isDefault sets shipped by the package) and the deployment's
          decision on each. Renders nothing when there are none or for a
          caller without manage_metadata (the list answers 403); accept and
          revoke are enforced server-side by the anchor gates. Drawn on a
          read-only package too: accepting or dismissing a suggestion is a
          deployment decision about the package, not an edit of it, and a
          marketplace-installed package — read-only here — is the one that
          ships an isDefault set. Only this strip ignores `packageReadOnly`;
          every affordance that edits the package keeps its gate. */}
      <SuggestedBindingsPanel
        packageId={railPackageId}
        className="mx-3 mt-2"
        strings={accessSuggestionStrings(locale, suggestedSetLabel)}
      />

      <div className="relative flex min-h-0 flex-1">
        {isMobile && railOpen && (
          <div
            className="absolute inset-0 z-10 bg-black/30"
            onClick={() => setRailOpen(false)}
            aria-hidden="true"
          />
        )}
        <StudioRail
          testId="studio-rail-access"
          heading={t('engine.studio.access.heading', locale)}
          count={perms.length}
          onAdd={openCreateSet}
          addLabel={t('engine.studio.access.new', locale)}
          addTestId="studio-rail-add"
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t('engine.studio.access.search', locale),
            matchCount: filtered.length,
          }}
          filters={
            <RailCustomizationFilter
              marks={railMarks}
              marked={markedSets}
              on={onlyCustomized}
              onToggle={toggleOnlyCustomized}
              locale={locale}
            />
          }
          pinned={
            // Pinned sibling surface: the package-wide Record Sharing Baseline
            // (OWD) overview (objectui#2505). Same package-author ownership as
            // the sets below, but a distinct surface — not a permission set.
            <div className="border-b px-2 pb-2 pt-2">
              <StudioRailRow
                active={owdOpen}
                onClick={() => {
                  // Re-clicking the open overview is a no-op — nothing
                  // remounts, so no confirm (mirrors the set re-click below).
                  if (owdOpen) {
                    setOwdHighlight(null);
                    if (isMobile) setRailOpen(false);
                    return;
                  }
                  if (!confirmDiscardEdits()) return;
                  setOwdOpen(true);
                  setOwdHighlight(null);
                  if (isMobile) setRailOpen(false);
                }}
                icon={<ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />}
                className="font-medium"
              >
                {t('engine.studio.owd.railLabel', locale)}
              </StudioRailRow>
            </div>
          }
          isMobile={isMobile}
          open={railOpen}
        >
          {/* objectui#12514 — the empty sentence names the "+" it points at;
              without one, the content column's block speaks alone. */}
          {perms.length === 0 && (error || !loaded || openCreateSet) && (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">
              {error ? t('engine.studio.loadFailed', locale) : loaded ? t('engine.studio.access.none', locale) : t('engine.studio.loading', locale)}
            </p>
          )}
          {filtered.map((p) => (
            <StudioRailRow
              key={p.name}
              active={!owdOpen && current === p.name}
              onClick={() => {
                if (!owdOpen && current === p.name) {
                  if (isMobile) setRailOpen(false);
                  return;
                }
                if (!confirmDiscardEdits()) return;
                setOwdOpen(false);
                setCurrent(p.name);
                if (isMobile) setRailOpen(false);
              }}
              icon={<Shield className="h-4 w-4 shrink-0 text-muted-foreground" />}
              name={p.label.trim() ? p.label : p.name}
              trailing={
                <>
                  <RailCustomizationMark row={{ type: 'permission', ...p }} marks={railMarks} locale={locale} />
                  {p.isDefault ? (
                    <span className="text-[10px] text-muted-foreground/70">{t('perm.badge.default', locale)}</span>
                  ) : null}
                </>
              }
            >
              {/* objectui#11862 — the set's label. objectstack#34795: the
                  machine name is no longer drawn as secondary text; it is the
                  row's tooltip. A set listed from its draft header alone has
                  no label in hand (the header carries none), so its name is
                  the text, as before. */}
              <span
                className="flex min-w-0 flex-1"
                title={p.label.trim() && p.label !== p.name ? p.name : undefined}
                data-testid={`access-rail-set-${p.name}`}
              >
                <StudioNameLabel label={p.label.trim() ? p.label : p.name} />
              </span>
            </StudioRailRow>
          ))}
        </StudioRail>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {(owdOpen || !current) && accessHeaderEl}
          {newSimilarStripEl}
          <main className="min-h-0 flex-1 overflow-auto">
          {owdOpen ? (
            /* Sibling surface: the package-wide OWD baseline overview
             * (objectui#2505) — object × sharingModel,
             * batch-edited as per-object drafts. */
            <PackageOwdOverviewPanel
              client={client}
              packageId={railPackageId}
              publishNonce={publishNonce}
              readOnly={packageReadOnly}
              locale={locale}
              highlightObject={owdHighlight}
              onDirtyChange={setOwdDirty}
            />
          ) : current ? (
            /* The existing Salesforce-style matrix page in its Studio
             * presentation (objectui#12456): the item header and five tabs
             * are the page's own, its autosave + destructive-change guard
             * included. The OWD chip deep-links to the overview above. */
            <PermissionMatrixEditPage
              key={current}
              type="permission"
              name={current}
              packageId={packageId}
              publishNonce={(publishNonce ?? 0) + draftGoneNonce}
              onDraftSaved={() => {
                // The set now holds a pending draft, so its discard shows.
                setDraftNames((names) => (names.has(current) ? names : new Set(names).add(current)));
                onDraftSaved?.();
                // objectstack#26846 — and the rail reads the sets again, so a
                // label this save changed shows there without a publish or a
                // reload.
                void load();
              }}
              onSaved={() => {
                // objectstack#36511 — the top bar's Save published the set: no
                // draft of it is left, and the rail reads its label again.
                setDraftNames((names) => {
                  if (!names.has(current)) return names;
                  const next = new Set(names);
                  next.delete(current);
                  return next;
                });
                void load();
              }}
              readOnly={readOnly}
              onDirtyChange={setMatrixDirty}
              embedded
              // objectstack#29809 — the header's provenance chip reads the
              // mark this set's rail row draws, so the two tell one story.
              customizationMark={railMarks?.markOf({ type: 'permission', name: current, addedIn: currentAddedIn }) ?? null}
              studio={{
                tab: accessTab,
                onTabChange: setAccessTab,
                onCloneSourceRead,
                leading: accessRailToggleEl,
                chips: currentAddedIn ? (
                  <>
                    <StudioPairItemChip pairId={currentAddedIn} locale={locale} />
                    {accessNoteEl}
                  </>
                ) : (
                  accessNoteEl
                ),
                actions: (
                  <>
                    {accessNewSimilarEl}
                    {accessDiscardEl}
                    {accessExplainEl}
                  </>
                ),
              }}
              onOpenOwd={(objectName) => {
                // The badge deep-link swaps this page out for the OWD
                // overview — same remount, same guard.
                if (!confirmDiscardEdits()) return;
                setOwdHighlight(objectName || null);
                setOwdOpen(true);
              }}
            />
          ) : loaded && !error && perms.length === 0 ? (
            // objectui#12514 — one centered block whose button runs the rail's "+".
            <div className="flex h-full">
              <StudioEmptyState
                testId="access-empty"
                icon={Shield}
                sentence={t('engine.studio.access.emptyMain', locale)}
                action={
                  openCreateSet && (
                    <StudioEmptyStateAction
                      data-testid="access-empty-new"
                      label={t('engine.studio.access.new', locale)}
                      onClick={openCreateSet}
                    />
                  )
                }
              />
            </div>
          ) : null}
          </main>
        </div>
      </div>

      <AccessExplainPanel open={explainOpen} onOpenChange={setExplainOpen} packageId={railPackageId} />

      {/* objectstack#28573 — the clone door's dialog, shared with Setup's
          catalog: a name and a label, nothing else, refusals verbatim. */}
      {newSimilarOpen && current && (
        <PermissionSetCloneDialog
          source={current}
          sourcePackage={newSimilarSource?.name === current ? newSimilarSource.sourcePackage : undefined}
          locale={locale}
          onClose={() => setNewSimilarOpen(false)}
          onCloned={onNewSimilarSaved}
        />
      )}

      <CreateItemDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('engine.studio.access.new', locale)}
        labelFieldLabel={t('engine.studio.access.nameLabel', locale)}
        labelPlaceholder={t('engine.studio.access.labelPlaceholder', locale)}
        idFieldLabel={t('engine.studio.access.idLabel', locale)}
        idPlaceholder={t('engine.studio.access.idPlaceholder', locale)}
        // objectstack#36511 — a permission set is created live (written, then
        // published at its package), so its dialog says Create; a create that
        // still writes a draft says Save as draft (objectui#11787).
        submitLabel={t('engine.studio.createLive', locale)}
        submittingLabel={t('engine.studio.creating', locale)}
        busy={busy}
        error={createErr}
        locale={locale}
        extra={
          createTaken && (
            <CreateTakenNotice
              scope="access"
              sentence={tFormat(
                createTaken.here ? 'engine.studio.access.createTaken' : 'engine.studio.access.createTakenElsewhere',
                locale,
                { label: createTaken.label, name: createTaken.name },
              )}
              openLabel={tFormat('engine.studio.create.openExisting', locale, { label: createTaken.label })}
              onOpen={createTaken.here ? () => openTakenSet(createTaken.name) : undefined}
            />
          )
        }
        onSubmit={({ label, name }) => void doCreate(label, name)}
      />
    </div>
  );
}
