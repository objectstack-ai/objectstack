// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A permission set's full-screen page in Studio (objectstack#36905, Studio
 * redesign epic #36890): the matrix (`PermissionMatrixEditPage`, its Studio
 * presentation) at the set's metadata address,
 * `/studio/<package>/metadata/permission/<name>`, in the right-hand content
 * area beside the left menu. It replaces the Access pillar's rail and
 * workbench: a set is chosen from its type's list, and × goes back there.
 *
 *  - The header is the full-screen detail's (`ResourceDetailHeader`, #36892):
 *    × to the list, ‹ › through it, the set's label (its machine name on the
 *    title's tooltip, objectstack#34795), type and package, and a ⋯ menu.
 *  - The tab row is the five sections of the matrix, then the item tools of
 *    every item page (`ItemToolTabs`, #36901): References, History (with the
 *    audit log, for a caller the trail door admits) and Source. A tool tab
 *    keeps the matrix mounted and hidden, so an edit survives the visit, and
 *    is addressable (`?tab=`); History replaces the matrix's History sheet.
 *  - What the pillar drew around the matrix comes along: the draft discard,
 *    Explain access, the suggested audiences strip, and on a read-only base
 *    "New similar" (now in ⋯) with the strip the copy lands with.
 *  - Save is the Studio top bar's (objectstack#36511): the matrix registers
 *    its unsaved edits with the shell's leave guard and the top bar's Save,
 *    so ×, ‹ ›, the left menu, a reload and a tab close all ask first
 *    (epic decision 12). The browser's Back is not guarded.
 *
 *  - An AI-written pending draft (copilot or MCP) is the version on screen and
 *    gets the designers' notice (`StudioAiDraftNotice`): Save makes it live
 *    with the page's own edits, and 「放弃 AI 的改动」 drops that one set's
 *    draft at its package, asking first only when the matrix holds unsaved
 *    edits — the rule the generic item page follows (epic decision 1,
 *    objectstack#36660). A person's own leftover draft keeps Discard draft
 *    (decision 14).
 */

import * as React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, Shield, ShieldQuestion, Undo2 } from 'lucide-react';
import { DropdownMenuItem } from '@object-ui/components';
import { formatMetadataError, type DraftChange } from '@object-ui/data-objectstack';
import { toast } from 'sonner';
import {
  PermissionMatrixEditPage,
  type PermissionStudioHeaderParts,
  type PermissionStudioTab,
} from '../metadata-admin/PermissionMatrixEditor.js';
import { ResourceDetailHeader, detailListHref } from '../metadata-admin/ResourceDetailHeader.js';
import { ItemToolTabPanel, ItemToolTabStrip, offeredItemToolTabs, useItemToolTab } from '../item-tools/ItemToolTabs.js';
import { useCanAuthorMetadata, useCanReadAuthoringTrail } from '../../hooks/useCanAuthorMetadata.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { useWalledCatalogReadOnly } from '../metadata-admin/catalog-scope.js';
import { t, tFormat, translateMetadataType, useMetadataLocale } from '../metadata-admin/i18n.js';
import { AccessExplainPanel } from '../metadata-admin/AccessExplainPanel.js';
import { PermissionSetCloneDialog } from '../metadata-admin/PermissionSetCloneDialog.js';
import type { PermissionSetCloned } from '../metadata-admin/permission-set-clone.js';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits.js';
import { SuggestedBindingsPanel } from '../../components/SuggestedBindingsPanel.js';
import { suggestedSetLabel } from '../../components/suggestedSetLabel.js';
import { StudioReadOnlyLink } from './StudioPillarKit.js';
import { StudioAiDraftNotice } from './StudioAiDraftNotice.js';
import { isAgentDraftSurface } from './StudioDraftMark.js';
import type { StudioItemStatus } from './StudioItemHeader.js';
import type { StudioSurfaceLabel } from './StudioAiCopilot.js';
import { customizationPairBaseOf } from './StudioRailCustomizations.js';
import { fetchListedPackageManifests } from './packages-io.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import { accessSuggestionStrings } from './accessSuggestionStrings.js';
import {
  NewSimilarStripNotice,
  newSimilarOutcome,
  readNewSimilarArrival,
  type NewSimilarStrip,
} from './permissionNewSimilar.js';
import { studioOwdOverviewPath } from './studioAddress.js';

const ACTION_BUTTON =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50';

export interface StudioPermissionSetPageProps {
  /** The package the set is read and saved at: the area's leg. */
  packageId: string;
  /** The set's machine name. */
  name: string;
  /** The package is read-only (the area's courtesy gate). */
  readOnly?: boolean;
  /** Bumped by the top bar's Publish: the matrix re-reads what is served. */
  publishNonce?: number;
  /** Told when a save left a draft, so the top bar's pending count follows it. */
  onDraftSaved?: () => void;
  /** objectstack#35018 — the set's label for the copilot's chip: 「正在看：权限 · 组织成员」. */
  onSurfaceLabelChange?: (surface: StudioSurfaceLabel | null) => void;
}

/** What the page reads of the package's sets: their labels, which are published, which hold a draft. */
interface SetsRead {
  sets: Array<{ name: string; label: string }>;
  published: ReadonlySet<string>;
  drafts: ReadonlySet<string>;
}

export function StudioPermissionSetPage({
  packageId,
  name,
  readOnly = false,
  publishNonce = 0,
  onDraftSaved,
  onSurfaceLabelChange,
}: StudioPermissionSetPageProps): React.ReactElement {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const metadataRefreshNonce = useMetadataRefreshNonce();

  // The section the matrix shows (Objects is the landing), and the item tool
  // open over it, which the address carries.
  const [section, setSection] = React.useState<PermissionStudioTab>('objects');
  const canReadTrail = useCanReadAuthoringTrail();
  const canAuthor = useCanAuthorMetadata();
  const offeredTabs = React.useMemo(() => offeredItemToolTabs({ trail: canReadTrail }), [canReadTrail]);
  const itemTab = useItemToolTab(offeredTabs);
  const toolTab = itemTab.location.tab;
  const toolOpen = toolTab !== 'details';

  // The package's sets: the discard's two inputs and the suggestions' labels.
  const [readNonce, setReadNonce] = React.useState(0);
  const [read, setRead] = React.useState<SetsRead | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.list('permission', { packageId }) as Promise<Array<Record<string, unknown>>>,
      client.listDrafts({ packageId, type: 'permission' }).catch(() => []),
    ]).then(
      ([list, drafts]) => {
        if (cancelled) return;
        const nameOf = (p: Record<string, unknown> | null | undefined) => String(p?.name ?? p?.id ?? '');
        setRead({
          sets: (list || []).map((p) => ({ name: nameOf(p), label: String(p.label ?? p.name ?? '') })),
          published: new Set((list || []).map(nameOf).filter(Boolean)),
          drafts: new Set(((drafts as Array<{ name?: string }>) || []).map((d) => String(d?.name ?? '')).filter(Boolean)),
        });
      },
      () => {
        if (!cancelled) setRead(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, packageId, publishNonce, metadataRefreshNonce, readNonce]);

  // objectstack#35018 — the copilot's chip reads the pillar's word and the
  // set's label, never the type word or the machine name. Keyed on primitives,
  // the callback read through a ref; cleared on unmount.
  const reportLabelRef = React.useRef(onSurfaceLabelChange);
  React.useEffect(() => {
    reportLabelRef.current = onSurfaceLabelChange;
  });
  const setLabel = read?.sets.find((p) => p.name === name)?.label;
  const chipLabel = setLabel ? `${t('engine.studio.copilot.subject.access', locale)} · ${setLabel}` : null;
  React.useEffect(() => {
    reportLabelRef.current?.(chipLabel ? { type: 'permission', name, label: chipLabel } : null);
  }, [name, chipLabel]);
  React.useEffect(
    () => () => {
      reportLabelRef.current?.(null);
    },
    [],
  );

  // Bumped by a discard and a rollback: the matrix re-reads as it does after a
  // publish, since in each what it holds is gone.
  const [rereadNonce, setRereadNonce] = React.useState(0);
  // The set's label as the matrix last drew it, for the discard's question.
  const titleRef = React.useRef(name);

  const hasDraft = !readOnly && !!read?.drafts.has(name);
  // Who wrote the pending draft, as the matrix's load read it.
  const [draftChanges, setDraftChanges] = React.useState<DraftChange[] | null>(null);
  const aiDraft = (draftChanges ?? []).some((change) => isAgentDraftSurface(change.by));
  const [matrixDirty, setMatrixDirty] = React.useState(false);
  const [discarding, setDiscarding] = React.useState(false);
  /** Drop this set's draft at its package (`DELETE ?state=draft`), once `ask` agreed. */
  const dropDraft = React.useCallback(
    async (ask: (item: string, neverPublished: boolean) => boolean, failed: (e: unknown) => void) => {
      const item = titleRef.current || name;
      // Never published only when the package's sets were read and this one is
      // not among them: an unanswered read says nothing, so the page stays and
      // re-reads, and never sends a published set's page to the list.
      const neverPublished = read !== null && !read.published.has(name);
      if (!ask(item, neverPublished)) return;
      setDiscarding(true);
      try {
        await client.reset('permission', name, { state: 'draft', packageId });
        toast.success(tFormat('engine.edit.draftDiscarded', locale, { item }));
        setDraftChanges(null);
        onDraftSaved?.();
        // A set that was never published has nothing left: back to its list.
        if (neverPublished) {
          navigate(detailListHref(location.pathname, searchParams));
          return;
        }
        setRereadNonce((n) => n + 1);
        setReadNonce((n) => n + 1);
      } catch (e) {
        failed(e);
      } finally {
        setDiscarding(false);
      }
    },
    [read, name, locale, client, packageId, onDraftSaved, navigate, location.pathname, searchParams],
  );
  // A person's own draft: one confirm, since an unsaved edit on the matrix is
  // an unpublished change of this same set and goes with the rest.
  const discardDraft = () =>
    dropDraft(
      (item, neverPublished) =>
        window.confirm(
          tFormat(
            neverPublished ? 'engine.studio.access.discardConfirmUnpublished' : 'engine.studio.access.discardConfirm',
            locale,
            { item },
          ),
        ),
      (e) =>
        toast.error(t('engine.studio.access.discardFailed', locale), {
          description: formatMetadataError(e),
          classNames: { description: 'whitespace-pre-line' },
        }),
    );
  // The AI's draft: asked first only when the matrix holds unsaved edits.
  const discardAiDraft = () =>
    dropDraft(
      () => !matrixDirty || window.confirm(t('engine.studio.aiDraft.discardConfirmUnsaved', locale)),
      (e) =>
        toast.error(tFormat('engine.studio.aiDraft.discardFailed', locale, { reason: formatMetadataError(e) }), {
          classNames: { description: 'whitespace-pre-line' },
        }),
    );

  // "New similar" on a read-only base's set (objectstack#28573): the copy
  // opens where the clone door says it landed, with the strip riding the
  // navigation; an answer that names no copy or no package is said here.
  const [newSimilarOpen, setNewSimilarOpen] = React.useState(false);
  const [cloneSource, setCloneSource] = React.useState<{ name: string; sourcePackage: string | undefined } | null>(null);
  const onCloneSourceRead = React.useCallback((setName: string, sourcePackage: string | undefined) => {
    setCloneSource((prev) =>
      prev && prev.name === setName && prev.sourcePackage === sourcePackage ? prev : { name: setName, sourcePackage },
    );
  }, []);
  const [strip, setStrip] = React.useState<NewSimilarStrip | null>(() => readNewSimilarArrival(location.state, packageId));
  const shownStrip = strip && (strip.kind !== 'landed' || strip.name === name) ? strip : null;
  const onNewSimilarSaved = React.useCallback(
    (copy: PermissionSetCloned) => {
      setNewSimilarOpen(false);
      const outcome = newSimilarOutcome(copy);
      if ('strip' in outcome) setStrip(outcome.strip);
      else navigate(outcome.open.to, { state: outcome.open.state });
    },
    [navigate],
  );
  const walled = useWalledCatalogReadOnly('permission');
  const newSimilarBlocked = walled
    ? tFormat('engine.catalog.readOnly.walled', locale, { type: translateMetadataType('permission', locale) })
    : canAuthor
      ? null
      : t('engine.edit.capabilityReadOnly', locale);

  const [explainOpen, setExplainOpen] = React.useState(false);

  // The status place: what a save does here, or, read-only, the link that
  // says why nothing is saved. A set of a base's pair lists the base's objects
  // too (objectstack#29674), so its note names the base, by its label once the
  // package list (one shared read, `packages-io.ts`) has said it.
  const pairBase = customizationPairBaseOf(packageId);
  const [pairBaseLabel, setPairBaseLabel] = React.useState<{ id: string; label: string } | null>(null);
  React.useEffect(() => {
    if (pairBase === null) return undefined;
    let cancelled = false;
    fetchListedPackageManifests().then(
      (manifests) => {
        const label = manifests.get(pairBase)?.name;
        if (!cancelled && label) setPairBaseLabel({ id: pairBase, label });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [pairBase]);
  const baseShown = pairBase === null ? '' : pairBaseLabel?.id === pairBase ? pairBaseLabel.label : pairBase;
  const status: StudioItemStatus | undefined = readOnly
    ? undefined
    : pairBase !== null
      ? {
          label: tFormat('engine.studio.access.bannerPair', locale, { package: baseShown }),
          title: tFormat('engine.studio.access.bannerTitlePair', locale, { package: baseShown }),
        }
      : { label: t('engine.studio.access.banner', locale), title: t('engine.studio.access.bannerTitle', locale) };

  const renderHeader = (parts: PermissionStudioHeaderParts): React.ReactNode => {
    titleRef.current = parts.title;
    return (
      <ResourceDetailHeader
        testId="permission-detail-header"
        type="permission"
        name={name}
        tabAddress={itemTab.address}
        locale={locale}
        icon={Shield}
        // objectstack#34795 / #35018 — the set's label is the title, whole; its
        // machine name is the title's tooltip, never page text, so the header
        // draws no api-name chip here.
        label={
          <span title={name} data-testid="perm-studio-title">
            {parts.title}
          </span>
        }
        typeLabel={translateMetadataType('permission', locale)}
        packageLabel={packageId}
        status={status}
        meta={parts.meta}
        note={parts.note}
        primaryAction={
          <div className="flex shrink-0 items-center gap-2">
            {parts.actions}
            {readOnly && (
              <StudioReadOnlyLink
                item={{ type: 'permission', name }}
                title={t('engine.studio.access.bannerTitleReadOnly', locale)}
                locale={locale}
              />
            )}
            {hasDraft && !aiDraft && (
              <button
                type="button"
                data-testid="access-discard-draft"
                onClick={() => void discardDraft()}
                disabled={discarding}
                className={ACTION_BUTTON}
              >
                <Undo2 className="h-3.5 w-3.5" />
                {t('engine.edit.discardDraft', locale)}
              </button>
            )}
            <button type="button" data-testid="access-explain" onClick={() => setExplainOpen(true)} className={ACTION_BUTTON}>
              <ShieldQuestion className="h-3.5 w-3.5" />
              {t('engine.studio.access.explain.open', locale)}
            </button>
          </div>
        }
        menu={
          <>
            {readOnly && (
              <DropdownMenuItem
                data-testid="access-new-similar"
                disabled={newSimilarBlocked !== null || newSimilarOpen}
                title={newSimilarBlocked ?? t('perm.clone.hint', locale)}
                onSelect={() => {
                  setStrip(null);
                  setNewSimilarOpen(true);
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" />
                {t('perm.clone.action', locale)}
              </DropdownMenuItem>
            )}
            {parts.menuItems}
          </>
        }
        tabs={
          <>
            {parts.sectionTabs}
            <span aria-hidden="true" className="mx-1 h-4 w-px self-center bg-border" />
            <ItemToolTabStrip
              tabs={offeredTabs.filter((tab) => tab !== 'details')}
              active={toolTab}
              onSelect={(tab) => itemTab.select(tab)}
              locale={locale}
            />
          </>
        }
      />
    );
  };

  const toolPanel = toolOpen ? (
    <ItemToolTabPanel
      tab={toolTab === 'history' ? 'history' : toolTab === 'source' ? 'source' : 'references'}
      view={itemTab.location.view}
      onViewChange={(view) => itemTab.select(toolTab, view)}
      type="permission"
      name={name}
      packageId={packageId}
      // A rollback writes the package's own row: not on a read-only package.
      onRolledBack={!readOnly && canAuthor ? () => setRereadNonce((n) => n + 1) : undefined}
      locale={locale}
    />
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="studio-permission-set-page">
      {/* ADR-0090 D5/D9 — this package's suggested audience bindings and the
          deployment's decision on each, as the Access pillar drew them (drawn
          on a read-only package too: deciding one is not an edit of it). */}
      <SuggestedBindingsPanel
        packageId={packageId}
        className="mx-3 mt-2"
        strings={accessSuggestionStrings(locale, (s) => suggestedSetLabel(s, read?.sets ?? []))}
      />
      {shownStrip && <NewSimilarStripNotice strip={shownStrip} locale={locale} onDismiss={() => setStrip(null)} />}
      {aiDraft && (
        <StudioAiDraftNotice
          locale={locale}
          onDiscard={readOnly ? undefined : () => void discardAiDraft()}
          busy={discarding}
          className="mx-3 mt-2"
        />
      )}
      <div className="min-h-0 flex-1">
        <PermissionMatrixEditPage
          type="permission"
          name={name}
          packageId={packageId}
          readOnly={readOnly}
          publishNonce={publishNonce + rereadNonce}
          onDraftSaved={() => {
            onDraftSaved?.();
            setReadNonce((n) => n + 1);
          }}
          onSaved={() => {
            // Published: no draft of the set is left, the AI's included.
            setDraftChanges(null);
            setReadNonce((n) => n + 1);
          }}
          onDirtyChange={setMatrixDirty}
          embedded
          // objectstack#29809 — a set a base's pair holds is one the pair adds
          // (a permission set takes no override, ADR-0005): it reads Custom,
          // as the list's mark says Added.
          customizationMark={pairBase !== null ? 'added' : null}
          onOpenOwd={(objectName) =>
            confirmUnsavedLeave(() => navigate(studioOwdOverviewPath(packageId, { object: objectName || null })))
          }
          studio={{
            tab: section,
            onTabChange: (tab) => {
              setSection(tab);
              itemTab.select('details');
            },
            onCloneSourceRead,
            frame: { renderHeader, toolOpen, toolPanel, onDraftChangesRead: setDraftChanges },
          }}
        />
      </div>

      <AccessExplainPanel open={explainOpen} onOpenChange={setExplainOpen} packageId={packageId} />

      {newSimilarOpen && (
        <PermissionSetCloneDialog
          source={name}
          sourcePackage={cloneSource?.name === name ? cloneSource.sourcePackage : undefined}
          locale={locale}
          onClose={() => setNewSimilarOpen(false)}
          onCloned={onNewSimilarSaved}
        />
      )}
    </div>
  );
}
