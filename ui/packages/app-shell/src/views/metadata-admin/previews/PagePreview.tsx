// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PagePreview — renders a Page metadata record using the runtime
 * SchemaRenderer so authors see exactly what end-users would see.
 *
 * Reads the live draft (not the server-saved record) so edits in the
 * Form tab preview instantly. URL query params are intentionally not
 * threaded in: previews run in a sandbox with no params context.
 */

import * as React from 'react';
import { SchemaRenderer, RecordContextProvider, useObjectTranslation, useObjectLabel } from '@object-ui/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import { buildExpandFields } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import { buildDefaultPageSchema, RecordMetaFooter } from '@object-ui/plugin-detail';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { PreviewShell, PreviewErrorBoundary, PreviewMessage } from './PreviewShell.js';
import { OutlineStrip } from './OutlineStrip.js';
import { SourcePageEditor } from './SourcePageEditor.js';
import { pageKindNode } from '../../pageKindNode.js';
import { deriveStudioDetailSections } from '../../recordDetailSections.js';
import { PageBlockCanvas } from './PageBlockCanvas.js';
import { InterfaceListPage } from '../../InterfaceListPage.js';
import { t as tr, tFormat } from '../i18n.js';

interface Block { type?: string; id?: string; children?: Block[]; [k: string]: unknown }

/**
 * objectui#11865 — the sample-record picker above a record page's preview,
 * drawn with the shared `Select`, the control the rest of the designer picks
 * with. It used to be a browser-native select element. What a pick does is
 * unchanged: `onPick` receives the picked sample's id as a string, the value
 * the native control's `change` carried, and re-picking the shown sample sets
 * nothing, as it did there.
 *
 * - Items carry the sample's INDEX, not its id. An id is whatever the data
 *   endpoint answered (`id`, `_id` or `name`), so two samples can share one,
 *   and an index cannot.
 * - The trigger shows the sample the preview renders, at `at`. The caller's
 *   chosen id can be one the samples no longer carry (the page was bound to
 *   another object since), and then the preview renders the first sample.
 *   The native control showed that first sample too, so there is no outside
 *   value to show here.
 * - The picker has no accessible name, as the native control had none: the
 *   caption beside it is a `span`, not a label.
 */
function SampleRecordPicker({
  at,
  options,
  onPick,
}: {
  at: number;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
}) {
  return (
    <Select
      value={String(at)}
      onValueChange={(token) => {
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger className="h-7 w-auto max-w-[260px] gap-1 px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o, i) => (
          <SelectItem key={i} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PagePreview({ draft, editing, selection, onSelectionChange, onPatch, locale }: MetadataPreviewProps) {
  const schema = React.useMemo(
    // SchemaRenderer needs a `type` discriminator (`'page'` when the draft
    // declares no kind), and PageRenderer reads the page's KIND off
    // `pageType` for its width and title heading — both written by the one
    // builder the running app's PageView uses. Writing `type` alone drew an
    // app or home page as a record page in the Run-mode canvas
    // (objectui#11933).
    () => ({ ...(draft as Record<string, unknown>), ...pageKindNode(draft as { type?: string }) }),
    [draft],
  );

  const designMode = !!(editing && onSelectionChange);
  const canEdit = designMode && !!onPatch;
  const selectedId = selection && selection.kind === 'block' ? selection.id : null;

  // Permissions context, read here rather than inside the record-binding
  // effect below: an effect's DEPENDENCY ARRAY is evaluated during render, so
  // `perms` has to be a binding that already exists by the time this
  // component's render reaches that effect (objectui#7429, same structural
  // note PR #7229 / PR #7428 recorded for `ListView`'s memo and
  // `ObjectCalendar`'s effect). This studio route is mounted inside
  // `MePermissionsProvider` (`apps/console/src/AppContent.tsx` wraps
  // `DefaultAppContent`, which the `/studio/*` routes render under), so the
  // hook is live here — it is not a no-provider default.
  const perms = usePermissions();

  // ADR-0047 interface pages are config-driven, not region-composed. The
  // runtime (PageView) renders them via InterfaceListPage; the generic
  // SchemaRenderer fallback would only produce a bare list shell with no
  // source binding or user filters. Computed here, consumed after all hooks
  // (the early return must not sit above later hooks — Rules of Hooks).
  const isInterfacePage = !!(draft as { interfaceConfig?: { source?: string } })?.interfaceConfig?.source;

  // Pages may use either of two canonical shapes:
  //   1. `regions: [{ name, components: [...] }]`  (ObjectStack spec, used by seeded pages)
  //   2. `children: [...]`                         (raw SDUI tree shape)
  // Detect which one is in use and surface chips/IDs accordingly.
  const shape: 'regions' | 'children' = React.useMemo(() => {
    if (Array.isArray((draft as any).regions)) return 'regions';
    return 'children';
  }, [draft]);

  const blockEntries = React.useMemo(() => {
    if (shape === 'regions') {
      const regions = (draft as any).regions as Array<{ name?: string; components?: Block[] }>;
      const out: { id: string; label: string }[] = [];
      regions.forEach((r, i) => {
        const comps = Array.isArray(r.components) ? r.components : [];
        comps.forEach((c, j) => {
          out.push({
            id: `regions[${i}].components[${j}]`,
            label: c.id || c.type || `${r.name ?? `region ${i + 1}`} · ${j + 1}`,
          });
        });
      });
      return out;
    }
    const children = Array.isArray((draft as any).children) ? (draft as any).children as Block[] : [];
    return children.map((b, i) => ({
      id: `children[${i}]`,
      label: b.id || b.type || tFormat('engine.pagePreview.blockN', locale, { n: i + 1 }),
    }));
  }, [draft, shape, locale]);

  const handleAddBlock = React.useCallback(() => {
    if (!canEdit) return;
    // `container` is a safe default that renders an empty box and
    // accepts further nested children — the user picks the real type
    // from the inspector immediately after.
    const newBlock: Block = { type: 'container' };
    if (shape === 'regions') {
      const regions = Array.isArray((draft as any).regions) ? [...((draft as any).regions as Array<{ name?: string; components?: Block[] }>)] : [];
      // Append to the last region; create a default region if none exist.
      let targetIdx = regions.length - 1;
      if (targetIdx < 0) {
        regions.push({ name: 'main', components: [] });
        targetIdx = 0;
      }
      const region = { ...regions[targetIdx] };
      const comps = Array.isArray(region.components) ? [...region.components] : [];
      comps.push(newBlock);
      region.components = comps;
      regions[targetIdx] = region;
      onPatch!({ regions });
      onSelectionChange?.({ kind: 'block', id: `regions[${targetIdx}].components[${comps.length - 1}]`, label: newBlock.type });
      return;
    }
    const children = Array.isArray((draft as any).children) ? (draft as any).children as Block[] : [];
    const next = [...children, newBlock];
    onPatch!({ children: next });
    onSelectionChange?.({ kind: 'block', id: `children[${next.length - 1}]`, label: newBlock.type });
  }, [canEdit, draft, onPatch, onSelectionChange, shape]);

  // ── Record binding ──────────────────────────────────────────────────────
  // A `type: 'record'` page's `record:*` blocks (details / highlights / path /
  // alert) read their data from <RecordContextProvider>. The metadata editor
  // has no record route, so without binding a sample they render the
  // "bind a record to preview" placeholder — i.e. the author designs blind.
  // Fetch a handful of real records of the bound object + its schema and let
  // the author pick which one to preview against (mirrors the runtime
  // RecordDetailView's RecordContextProvider).
  // A record page is keyed by `type: 'record'` — the one discriminator
  // `PageSchema` declares, and the only one the runtime resolver
  // (usePageAssignment) reads (objectui#9674).
  // The preview reads `type` alone, as the runtime does: `pageType` is an
  // alias `PageSchema` refuses (objectui#10482).
  const isRecordPage = (draft as { type?: string })?.type === 'record';
  const recordObject = isRecordPage ? (draft as { object?: string })?.object : undefined;
  const [recordSamples, setRecordSamples] = React.useState<any[]>([]);
  const [recordSchema, setRecordSchema] = React.useState<any>(null);
  const [selectedRecordId, setSelectedRecordId] = React.useState<string | number | null>(null);
  React.useEffect(() => {
    if (!recordObject) { setRecordSamples([]); setRecordSchema(null); setSelectedRecordId(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const opts = { headers: { accept: 'application/json' }, credentials: 'include' as const };
        // Schema first: it tells us which fields are lookup/master_detail so we
        // can `$expand` them. Without expansion record:details/highlights would
        // show raw foreign-key IDs (e.g. "O4VKrNesnsj2JYMa") instead of display
        // names — the runtime RecordDetailView $expands for exactly this reason.
        const schemaRes = await fetch(`/api/v1/meta/object/${encodeURIComponent(recordObject)}`, opts);
        const schemaJson = await schemaRes.json().catch(() => null);
        const schema = schemaJson?.item ?? schemaJson?.data ?? schemaJson;
        // [objectui#7429] FIELD-LEVEL SECURITY ON `$expand` — the same gate
        // objectui#7215 / PR #7229 put on the two projection sites in its
        // scope, and objectui#7230 / PR #7428 applied unchanged at four more.
        // `$select` on a denied lookup asks the server for a bare foreign key;
        // `$expand` asks it to RESOLVE the relation and return the related
        // record, the larger of the two requests.
        //
        // THIS SITE PASSES NO COLUMN LIST, which makes it the sharp one:
        // `buildExpandFields` reads an absent column list as "no column
        // restriction" and falls back to EVERY declared relation on the
        // object, denied ones included. This preview therefore asks for the
        // maximum possible set by default, not by configuration.
        //
        // ⚠️ THE PRINCIPAL JUDGED HERE IS THE STUDIO REVIEWER, NOT THE PAGE'S
        // EVENTUAL AUDIENCE (objectui#7429's own flag on this site — "a reason
        // to look, not a claim"). This request runs with `credentials:
        // 'include'`, i.e. under the browser session that is ALREADY loading
        // this preview, so gating by `perms` (which reads that SAME session's
        // `/me/permissions`) is the correct principal to gate on: it is
        // exactly the request this browser is about to make, on its own
        // credentials, regardless of who eventually opens the published page.
        // A reviewer who holds broader grants than the audience sees a wider
        // (still-correct) expansion here; the gate never disclosed anything
        // this session could not itself read.
        //
        // Graded as objectui#7215 graded it, by measurement rather than
        // assumption: against ObjectStack this is defence-in-depth, because
        // `plugin-security`'s `FieldMasker.maskRecord` does
        // `delete result[field]` on every unreadable key and objectql's
        // expand path writes the resolved record back under THAT SAME KEY, so
        // one statement removes the expanded object and the bare id alike;
        // the expansion sub-read itself takes the referenced object's full
        // CRUD + RLS + FLS treatment (objectstack#7626). It is load-bearing
        // for a backend that does not strip.
        //
        // THE GATE IS ON THE HELPER'S OUTPUT, and on this site the
        // alternative is not merely unsound but unreachable: the call passes
        // `undefined`, so there is no input to gate. Gating the output also
        // gives the required ordering structurally: `buildExpandFields`
        // returns a subset of the object's DECLARED reference-bearing fields,
        // so every name judged here is declared by construction and the
        // "`checkField` answers false for an undeclared key" trap cannot be
        // reached. Pinned in `PagePreview.expandFls-7429.test.tsx`.
        //
        // Deferral matches every other gate on this path: an unanswered
        // policy filters nothing, and `perms` is in this effect's dependency
        // list, so the sample records are re-read the moment the answer
        // arrives.
        const expandable = buildExpandFields(schema?.fields);
        const expand = !perms?.isLoaded
          ? expandable
          : expandable.filter((f) => perms.checkField(recordObject, f, 'read'));
        const query = expand.length > 0
          ? `?$top=50&$expand=${encodeURIComponent(expand.join(','))}`
          : `?$top=50`;
        const recsRes = await fetch(`/api/v1/data/${encodeURIComponent(recordObject)}${query}`, opts);
        const recsJson = await recsRes.json().catch(() => null);
        // The REST data endpoint returns `{ object, records, total, hasMore }`;
        // tolerate the other common envelopes too.
        const recs = Array.isArray(recsJson?.records) ? recsJson.records
          : Array.isArray(recsJson?.items) ? recsJson.items
          : Array.isArray(recsJson?.data) ? recsJson.data
          : Array.isArray(recsJson) ? recsJson : [];
        if (cancelled) return;
        setRecordSamples(recs);
        setRecordSchema(schema);
        // Same id-resolution order as recordIdOf so the initial selection's
        // value matches a picker item's id even for objects keyed only by `name`.
        setSelectedRecordId((prev) => prev ?? (recs[0]?.id ?? recs[0]?._id ?? recs[0]?.name ?? null));
      } catch { if (!cancelled) { setRecordSamples([]); setRecordSchema(null); } }
    })();
    return () => { cancelled = true; };
  }, [recordObject, perms]);
  const recordIdOf = (r: any) => r?.id ?? r?._id ?? r?.name;
  const recordLabelOf = (r: any) =>
    String(r?.name ?? r?.title ?? r?.label ?? r?.subject ?? recordIdOf(r) ?? tr('engine.pagePreview.recordFallback', locale));
  const selectedRecord = React.useMemo(() => {
    if (!recordSamples.length) return null;
    return recordSamples.find((r) => String(recordIdOf(r)) === String(selectedRecordId)) ?? recordSamples[0];
  }, [recordSamples, selectedRecordId]);

  // ── Slotted record page synthesis ────────────────────────────────────────
  // A `kind: 'slotted'` page carries an empty `regions: []` plus a `slots` map
  // of overrides, so the raw draft renders blank through SchemaRenderer (there
  // are no regions to walk). Mirror the runtime RecordDetailView: synthesize the
  // canonical default page from the bound object's schema and apply the slot
  // overrides via the SAME `buildDefaultPageSchema(objectDef, { slots })` path,
  // so omitted slots fall through to the synthesized header/details/discussion
  // while authored slots (highlights/tabs/…) override in place. Non-slotted
  // pages render their authored schema unchanged.
  const isSlotted = (draft as { kind?: string })?.kind === 'slotted';
  // The "More details" heading, resolved exactly as the running app resolves it
  // (`RecordDetailView`): the object's `_sections.details` label, else the
  // shell's `detail.sectionMoreDetails` text.
  const { t } = useObjectTranslation();
  const { sectionLabel } = useObjectLabel();
  const moreDetailsLabel = sectionLabel(
    String(recordSchema?.name ?? ''),
    'details',
    t('detail.sectionMoreDetails', 'More details'),
  );
  const renderSchema = React.useMemo(() => {
    if (!isSlotted) return schema;
    try {
      const slots = (draft as { slots?: Record<string, unknown> })?.slots ?? {};
      // `recordSchema` arrives async; until then synthesize with no objectDef
      // (structure renders immediately, field-level detail fills in on load).
      // The running app's detail sections, from the one derivation it uses
      // and with the heading it translates (objectui#12442) — without them an
      // object with no `fieldGroups` previewed a bare `record:details`.
      const sections = deriveStudioDetailSections(recordSchema, { moreDetails: moreDetailsLabel });
      return buildDefaultPageSchema(recordSchema ?? undefined, sections ? { slots, sections: sections as any } : { slots }) as Record<string, unknown>;
    } catch {
      return schema;
    }
  }, [isSlotted, schema, draft, recordSchema, moreDetailsLabel]);
  // Wrap record-page content in the record context (+ a sample-record picker)
  // so detail/highlights/path/alert blocks render real data. No-op for
  // non-record pages and for record pages with no rows yet (renders the node
  // unchanged so the existing placeholder still shows).
  const withRecordBinding = (node: React.ReactNode): React.ReactNode => {
    if (!recordObject || !selectedRecord) return node;
    return (
      <RecordContextProvider
        objectName={recordObject}
        recordId={recordIdOf(selectedRecord)}
        data={selectedRecord}
        objectSchema={recordSchema ?? undefined}
        embedded
      >
        {recordSamples.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 text-xs">
            <span className="text-muted-foreground shrink-0">{tr('engine.pagePreview.previewRecord', locale)}</span>
            <SampleRecordPicker
              at={recordSamples.indexOf(selectedRecord)}
              options={recordSamples.map((r) => ({ value: String(recordIdOf(r)), label: recordLabelOf(r) }))}
              onPick={setSelectedRecordId}
            />
            <span className="text-muted-foreground/70 shrink-0">
              {tFormat(
                recordSamples.length === 1 ? 'engine.pagePreview.sampleOne' : 'engine.pagePreview.sampleOther',
                locale,
                { count: recordSamples.length },
              )}
            </span>
          </div>
        )}
        {node}
      </RecordContextProvider>
    );
  };

  // Interface page → always mirror the runtime (InterfaceListPage), in BOTH
  // design and preview modes. These pages are config-driven, not region-
  // composed, so there is nothing to drag on a canvas: the author edits the
  // Properties panel on the right and sees the real list (source view + user
  // filters + data) update live on the left — no tab switch, no placeholder.
  if (isInterfacePage) {
    return (
      <PreviewShell hint="page · interface">
        <PreviewErrorBoundary fallbackHint={tr('engine.pagePreview.interfaceFailed', locale)}>
          <InterfaceListPage
            page={draft as Record<string, unknown>}
            onConfigChange={canEdit ? (patch) => onPatch!({ interfaceConfig: { ...(((draft as any).interfaceConfig) || {}), ...patch } }) : undefined}
          />
        </PreviewErrorBoundary>
      </PreviewShell>
    );
  }

  // Source page (ADR-0080/0081) → `kind:'html'`/`'react'` pages are a `source`
  // string, not a region tree. The design canvas does not apply (and would
  // choke on the absent regions/children), so edit the source directly with a
  // live preview. This is the fix for the editor crashing on these pages.
  const pageKind = (draft as { kind?: string }).kind;
  if (pageKind === 'react' || pageKind === 'html') {
    return (
      <SourcePageEditor
        draft={draft as Record<string, unknown>}
        onPatch={canEdit ? onPatch : undefined}
        readOnly={!canEdit}
        locale={locale}
      />
    );
  }

  // Empty draft → no preview; but if we're in design mode show the
  // canvas so users can author from scratch. "Empty" is the DRAFT's own
  // keys, a `type` aside: the keys `schema` adds for the renderer are not
  // content (objectui#11933).
  if (!schema || Object.keys(draft as Record<string, unknown>).every((k) => k === 'type')) {
    return (
      <PreviewShell hint={`page${designMode ? ' · design' : ''}`}>
        {designMode && shape === 'regions' ? (
          <PageBlockCanvas
            draft={draft}
            onPatch={canEdit ? onPatch : undefined}
            selection={selection ?? null}
            onSelectionChange={onSelectionChange}
            locale={locale}
          />
        ) : designMode ? (
          <OutlineStrip
            title={tr('engine.inspector.pageBlock.outlineLabel', locale)}
            entries={blockEntries}
            selectedId={selectedId}
            onSelect={(e) => onSelectionChange?.({ kind: 'block', id: e.id, label: e.label })}
            onAdd={canEdit ? handleAddBlock : undefined}
            addLabel={tr('engine.inspector.add.block', locale)}
          />
        ) : null}
        {!designMode && <PreviewMessage>{tr('engine.pagePreview.addComponents', locale)}</PreviewMessage>}
      </PreviewShell>
    );
  }

  // Design mode with regions shape — show the form-canvas style
  // designer instead of the runtime renderer so authors can drag,
  // rename, and add blocks inline. The outline strip becomes
  // redundant in this view.
  if (designMode && shape === 'regions') {
    return (
      <PreviewShell hint={`page · design`}>
        {withRecordBinding(
          <PageBlockCanvas
            draft={draft}
            onPatch={canEdit ? onPatch : undefined}
            selection={selection ?? null}
            onSelectionChange={onSelectionChange}
            locale={locale}
          />
        )}
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint={`page${designMode ? ' · design' : ''}`}>
      <PreviewErrorBoundary fallbackHint={tr('engine.pagePreview.schemaFailed', locale)}>
        {designMode && (
          <OutlineStrip
            title={tr('engine.inspector.pageBlock.outlineLabel', locale)}
            entries={blockEntries}
            selectedId={selectedId}
            onSelect={(e) => onSelectionChange?.({ kind: 'block', id: e.id, label: e.label })}
            onAdd={canEdit ? handleAddBlock : undefined}
            addLabel={tr('engine.inspector.add.block', locale)}
          />
        )}
        {withRecordBinding(
          <div className="min-h-[200px] max-h-[70vh] overflow-auto p-4">
            <SchemaRenderer schema={renderSchema as any} />
            {/* The record's provenance footer, once for the page, at its foot —
                as the runtime `RecordDetailView` draws it (objectui#12307): a
                `record:details` node reading the page's record no longer draws
                its own. Only where a sample record is bound, which is exactly
                when `withRecordBinding` mounts the record context. */}
            {recordObject && selectedRecord && (
              <RecordMetaFooter
                data={selectedRecord}
                objectSchema={recordSchema ?? undefined}
                objectName={recordObject}
              />
            )}
          </div>
        )}
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}
