// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PageBlockCanvas — form-designer-style preview for a Page metadata
 * draft. Mirrors {@link ObjectFormCanvas}'s pattern: each block becomes
 * a clickable card with a type badge, drag handle, and inline-rename
 * affordance on its label. Regions become group sections that accept
 * drops to reassign blocks.
 *
 * Supports only the canonical Page shape (`regions[].components[]`).
 * Pages using the raw `children[]` shape fall back to the existing
 * SchemaRenderer preview (no inline editing).
 *
 * Selection emits `{ kind: 'block', id: 'regions[i].components[j]' }`
 * matching PageBlockInspector.
 */

import * as React from 'react';
import {
  Badge,
  Button,
  cn,
  isPageRailRegion,
  pageBlockSpan,
  type PageBlockSpan,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@object-ui/components';
import { GripVertical, Plus } from 'lucide-react';
import { PAGE_TEMPLATE_OPEN_GRID, PAGE_TEMPLATE_SLOTS, type PageTemplate } from '@objectstack/spec/ui';
import type { MetadataSelection } from '../preview-registry.js';
import {
  BLOCK_TYPE_META,
  TYPES_BY_CATEGORY,
  CATEGORY_LABEL_KEY,
  UnknownBlockIcon,
  resolveBlockDisplayMeta,
  resolveBlockTone,
  type BlockTypeId,
} from './block-types.js';
import { parsePath, hopsToPath, getByPath, setByPath } from '../inspectors/PageBlockInspector.js';
import { SchemaRenderer, PreviewModeProvider } from '@object-ui/react';
import { PreviewErrorBoundary } from './PreviewShell.js';
import { isOverlayFormType } from './form-preview.js';
import { t as tr, tFormat } from '../i18n.js';

/** Build the schema handed to SchemaRenderer, neutralising overlay form types so
 *  a live form block never mounts a modal over the design canvas. SchemaRenderer
 *  needs a `type` discriminator; the block always carries one. */
export function toCanvasSchema(block: Block): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    ...(block as Record<string, unknown>),
    type: String(block?.type ?? ''),
  };
  // formType lives under `properties` (canonical) but may also be hoisted to the
  // top level; neutralise whichever carries an overlay type.
  const props = schema.properties && typeof schema.properties === 'object'
    ? (schema.properties as Record<string, unknown>)
    : undefined;
  const formType = (props?.formType ?? schema.formType) as unknown;
  if (isOverlayFormType(formType)) {
    if (props) schema.properties = { ...props, formType: 'simple' };
    if ('formType' in schema) schema.formType = 'simple';
  }
  return schema;
}

/** Defer mounting until an element scrolls near the viewport. Renders immediately
 *  in non-browser / test environments (no real IntersectionObserver, or under
 *  vitest) so server rendering and tests are unaffected; lazy only in the browser.
 *  Once in view it stays mounted — re-mounting a data block would re-fetch. */
function useLazyInView<T extends Element>(rootMargin = '300px') {
  const ref = React.useRef<T | null>(null);
  const [inView, setInView] = React.useState<boolean>(() => {
    if (typeof IntersectionObserver === 'undefined') return true;
    try {
      if ((import.meta as { env?: { MODE?: string } }).env?.MODE === 'test') return true;
    } catch {
      /* import.meta unavailable — fall through to lazy */
    }
    return false;
  });
  React.useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return { ref, inView };
}

/** Render a single block via the real runtime renderer, behind a click-trap, so
 *  the design canvas mirrors the live preview. Mounting is deferred until the
 *  block scrolls near the viewport: data-bound blocks (grids, related lists,
 *  repeaters) each fetch on mount, so a tall page would otherwise fire every
 *  query at once. Capped height keeps a tall widget from dominating the canvas. */
function BlockLivePreview({
  block,
  maxHeightClass = 'max-h-72',
  locale,
}: {
  block: Block;
  maxHeightClass?: string;
  locale?: string;
}) {
  const typeStr = String(block?.type ?? '');
  const { ref, inView } = useLazyInView<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('pointer-events-none select-none overflow-hidden p-3', maxHeightClass)}>
      {inView ? (
        <PreviewErrorBoundary fallbackHint={tFormat('engine.pageBlockCanvas.renderFailed', locale, { type: typeStr })}>
          <PreviewModeProvider>
            <SchemaRenderer schema={toCanvasSchema(block) as never} />
          </PreviewModeProvider>
        </PreviewErrorBoundary>
      ) : (
        <div className="min-h-[64px] animate-pulse rounded bg-muted/40" aria-hidden="true" />
      )}
    </div>
  );
}

/** Tailwind needs static class names — map a column count to a grid class. */
const GRID_COLS_CLASS: Record<number, string> = {
  1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3',
  4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6',
};

/** Container blocks expose nested child arrays (issue #1499). Returns each
 *  group's display label, the path suffix to its children array (relative to
 *  the block), and the current children. A tab / accordion item's own `label`
 *  or `key` is author data; the fallbacks are the designer's words, read in
 *  `locale` (objectui#10862). */
function childGroups(block: Block, locale?: string): Array<{ label: string; pathSuffix: string; children: Block[] }> {
  const props = (block?.properties as any) || {};
  switch (block?.type) {
    case 'page:tabs':
    case 'page:accordion': {
      const items = Array.isArray(props.items) ? props.items : [];
      return items.map((it: any, i: number) => ({
        label: it?.label || it?.key || tFormat('engine.pageBlockCanvas.itemN', locale, { n: i + 1 }),
        pathSuffix: `properties.items[${i}].children`,
        children: Array.isArray(it?.children) ? it.children : [],
      }));
    }
    case 'page:card': {
      // Seeded cards nest under `properties.children`; older specs used
      // `properties.body`. Prefer children, fall back to body so neither
      // shape leaves the card's content unreachable on the canvas.
      //
      // ⚠️ KEPT through objectui#6771's retirement of the `body` dialect: this
      // is the designer half of `page:card`'s stored-document read
      // (`renderers/layout/containers.tsx`). ⛔ Removing it makes a stored
      // card's content unreachable on the canvas — the same silent loss the
      // renderer-side read exists to prevent.
      //
      // ⛔ NOT "until the conversion lands": that precondition is stale.
      // `pageCardBodyToChildren` carries `toMajor: 17` and
      // `retiredFromLoadPath: true`, and this repo installs spec 17.4.0, so what
      // holds the read is stored rows that have not been replayed through it —
      // a database question, not a release one.
      //
      // ⚠️ And the three thin `page:*` containers DO share this ground (the
      // spec says so on `PageContainerProps`); they kept their renderer arms
      // too. What they lack is a CONVERSION — the registry has one for
      // `page:card` and none for them. ⭐ This file does NOT extend the same
      // courtesy to `page:section` below, which returns `properties.children`
      // alone: runtime and canvas therefore disagree about a stored `body`
      // under that block. Recorded on objectui#9916 (comment 5733844778), ⛔ not
      // repaired here — widening the canvas is that card's call, not this one's.
      if (Array.isArray(props.body) && !Array.isArray(props.children)) {
        return [{ label: tr('engine.pageBlockCanvas.body', locale), pathSuffix: 'properties.body', children: props.body }];
      }
      return [{ label: tr('engine.pageBlockCanvas.body', locale), pathSuffix: 'properties.children', children: Array.isArray(props.children) ? props.children : [] }];
    }
    case 'page:section':
    case 'grid':
      return [{ label: tr('engine.pageBlockCanvas.content', locale), pathSuffix: 'properties.children', children: Array.isArray(props.children) ? props.children : [] }];
    default:
      // Future-proof: any block carrying a `properties.children` array (e.g.
      // `container`) exposes those children for selection/editing.
      if (Array.isArray(props.children)) {
        return [{ label: tr('engine.pageBlockCanvas.content', locale), pathSuffix: 'properties.children', children: props.children }];
      }
      return [];
  }
}

interface Block {
  type?: string;
  id?: string;
  label?: string;
  title?: string;
  children?: Block[];
  [k: string]: unknown;
}

interface Region {
  name?: string;
  width?: string;
  components?: Block[];
}

export interface PageBlockCanvasProps {
  draft: Record<string, unknown>;
  onPatch?: (patch: Record<string, unknown>) => void;
  selection?: MetadataSelection | null;
  onSelectionChange?: (next: MetadataSelection | null) => void;
  /** The designer locale the canvas's own words read in — `PagePreview` passes the one it receives (objectui#10862). */
  locale?: string;
}

/** Canonical record-page slots, in render order. A `kind:'slotted'` page
 *  overrides individual slots; unoverridden ones are filled by the synthesizer.
 *  We surface all of them so an author can override an inherited slot too. */
export const SLOT_ORDER = ['header', 'actions', 'alerts', 'highlights', 'details', 'tabs', 'discussion'] as const;

/** slots object → one region per slot (single component normalised to array). */
export function slotsToRegions(slots: Record<string, unknown> | undefined): Region[] {
  const s = slots || {};
  return SLOT_ORDER.map((name) => {
    const v = (s as any)[name];
    const components = Array.isArray(v) ? (v as Block[]) : v != null ? [v as Block] : [];
    return { name, components };
  });
}

/** regions (one per slot) → slots object; empty slots are omitted (= inherited). */
export function regionsToSlots(regions: Region[]): Record<string, unknown> {
  const slots: Record<string, unknown> = {};
  for (const r of regions) {
    const comps = Array.isArray(r.components) ? r.components : [];
    if (comps.length === 0 || !r.name) continue; // omit empty → inherit the default
    slots[r.name] = comps;
  }
  return slots;
}

function readRegions(
  draft: Record<string, unknown>,
): { regions: Region[]; shape: 'regions' | 'children' | 'slots' } {
  // Slotted record page — edit the named slots (must win over an empty
  // `regions: []`, which slotted pages carry).
  const slots = (draft as any).slots;
  if ((draft as any).kind === 'slotted' && slots && typeof slots === 'object' && !Array.isArray(slots)) {
    return { regions: slotsToRegions(slots), shape: 'slots' };
  }
  const raw = (draft as any).regions;
  if (Array.isArray(raw)) return { regions: raw as Region[], shape: 'regions' };
  const kids = (draft as any).children;
  if (Array.isArray(kids)) {
    // Virtualise children[] as a single anonymous region.
    return { regions: [{ name: 'children', components: kids as Block[] }], shape: 'children' };
  }
  return { regions: [], shape: 'regions' };
}

/**
 * What "Add region" may write on this page (objectui#12902).
 *
 * The spec's `checkPageRegionPlacement` judges a `kind: 'full'` page under
 * `page.template ?? 'default'`: a region must fill a slot of that template
 * (`PAGE_TEMPLATE_SLOTS`, matched case-insensitively, one region per slot),
 * except on an open-grid template (`PAGE_TEMPLATE_OPEN_GRID`, `dashboard`),
 * where every other name is a grid cell. So the canvas offers exactly the
 * template's slots no region fills yet and, on an open grid, one fresh cell
 * name: never a name the save door refuses. A template the spec does not
 * declare places nothing, so nothing is offered.
 */
export interface RegionOffer {
  /** The template the page is judged under: its own, else the spec's default. */
  template: string;
  /** False when `template` is not one `PAGE_TEMPLATE_SLOTS` declares. */
  known: boolean;
  /** The template's slots no region fills yet, in the spec's order. */
  slots: string[];
  /** On an open-grid template, a grid cell name no region uses; else null. */
  gridCell: string | null;
}

export function regionOffer(draft: Record<string, unknown>, regions: Region[]): RegionOffer {
  const raw = (draft as { template?: unknown }).template ?? 'default';
  if (typeof raw !== 'string' || !Object.prototype.hasOwnProperty.call(PAGE_TEMPLATE_SLOTS, raw)) {
    return { template: String(raw), known: false, slots: [], gridCell: null };
  }
  const template = raw as PageTemplate;
  const allSlots: readonly string[] = PAGE_TEMPLATE_SLOTS[template];
  const used = new Set(
    regions
      .map((r) => (typeof r?.name === 'string' ? r.name.toLowerCase() : undefined))
      .filter((n): n is string => n !== undefined),
  );
  const slots = allSlots.filter((slot) => !used.has(slot));
  let gridCell: string | null = null;
  if (PAGE_TEMPLATE_OPEN_GRID.includes(template)) {
    let n = regions.length + 1;
    while (used.has(`region_${n}`) || allSlots.includes(`region_${n}`)) n += 1;
    gridCell = `region_${n}`;
  }
  return { template, known: true, slots, gridCell };
}

/** The names a {@link RegionOffer} lets "Add region" write, slots first. */
function offeredRegionNames(offer: RegionOffer): string[] {
  return offer.gridCell ? [...offer.slots, offer.gridCell] : offer.slots;
}

/** Build a selection ID matching PageBlockInspector's parsePath regex.
 *  - regions shape:  regions[i].components[j]
 *  - children shape: children[j]  (flat, no nesting)
 */
function selectionId(
  shape: 'regions' | 'children' | 'slots',
  regionIdx: number,
  compIdx: number,
  slotName?: string,
): string {
  if (shape === 'children') return `children[${compIdx}]`;
  if (shape === 'slots') return `slot:${slotName}:${compIdx}`;
  return `regions[${regionIdx}].components[${compIdx}]`;
}

function blockLabel(b: Block): string {
  return (
    (typeof b.label === 'string' && b.label) ||
    (typeof b.title === 'string' && b.title) ||
    (typeof b.id === 'string' && b.id) ||
    String(b.type ?? 'block')
  );
}

const DT_MIME = 'text/x-objectui-pageblock';

export function PageBlockCanvas({
  draft,
  onPatch,
  selection,
  onSelectionChange,
  locale,
}: PageBlockCanvasProps) {
  const readOnly = !onPatch;
  const { regions, shape } = React.useMemo(() => readRegions(draft), [draft]);
  const offer = React.useMemo(() => regionOffer(draft, regions), [draft, regions]);

  const selectedId = selection?.kind === 'block' ? String(selection.id) : null;

  const writeRegions = React.useCallback(
    (next: Region[]) => {
      if (shape === 'children') {
        const comps = next.flatMap((r) => (Array.isArray(r.components) ? r.components : []));
        onPatch?.({ children: comps });
      } else if (shape === 'slots') {
        onPatch?.({ slots: regionsToSlots(next) });
      } else {
        onPatch?.({ regions: next });
      }
    },
    [onPatch, shape],
  );

  /** Move a block from src path → dst region (append) or before/after target block. */
  const moveBlock = React.useCallback(
    (
      src: { region: number; comp: number },
      dst:
        | { region: number; before?: number; after?: number }
        | { region: number; appendEnd: true },
    ) => {
      if (!onPatch) return;
      // Defensive copies — never mutate inputs.
      const next: Region[] = regions.map((r) => ({
        ...r,
        components: Array.isArray(r.components) ? [...r.components] : [],
      }));
      const srcComps = next[src.region]?.components;
      if (!srcComps) return;
      const [moved] = srcComps.splice(src.comp, 1);
      if (!moved) return;
      const dstComps = next[dst.region]?.components;
      if (!dstComps) return;
      let insertAt = dstComps.length;
      if ('appendEnd' in dst) insertAt = dstComps.length;
      else if (dst.before != null) {
        // Adjust if moving within same region above the original
        let idx = dst.before;
        if (src.region === dst.region && src.comp < idx) idx -= 1;
        insertAt = idx;
      } else if (dst.after != null) {
        let idx = dst.after + 1;
        if (src.region === dst.region && src.comp < dst.after + 1) idx -= 1;
        insertAt = idx;
      }
      dstComps.splice(insertAt, 0, moved);
      writeRegions(next);
      // Re-issue selection so inspector follows the move.
      const newId = selectionId(shape, dst.region, insertAt, next[dst.region]?.name);
      onSelectionChange?.({ kind: 'block', id: newId, label: blockLabel(moved) });
    },
    [onPatch, onSelectionChange, regions, writeRegions, shape],
  );

  const addBlock = React.useCallback(
    (regionIdx: number, type: BlockTypeId) => {
      if (!onPatch) return;
      const next: Region[] = regions.map((r) => ({
        ...r,
        components: Array.isArray(r.components) ? [...r.components] : [],
      }));
      if (!next[regionIdx]) {
        // A slot fill names the slot it fills (objectui#12902), never a
        // positional `region_N` the template does not place.
        const name = offeredRegionNames(offer)[0];
        if (name === undefined) return;
        next[regionIdx] = { name, components: [] };
      }
      const newBlock: Block = { type };
      next[regionIdx].components!.push(newBlock);
      writeRegions(next);
      const idx = next[regionIdx].components!.length - 1;
      onSelectionChange?.({
        kind: 'block',
        id: selectionId(shape, regionIdx, idx, next[regionIdx]?.name),
        label: blockLabel(newBlock),
      });
    },
    [onPatch, onSelectionChange, regions, writeRegions, shape, offer],
  );

  const renameLabel = React.useCallback(
    (regionIdx: number, compIdx: number, nextLabel: string) => {
      if (!onPatch) return;
      const next: Region[] = regions.map((r) => ({
        ...r,
        components: Array.isArray(r.components) ? [...r.components] : [],
      }));
      const target = next[regionIdx]?.components?.[compIdx];
      if (!target) return;
      next[regionIdx].components![compIdx] = { ...target, label: nextLabel || undefined };
      writeRegions(next);
    },
    [onPatch, regions, writeRegions],
  );

  // Adds a region under a name the page's template places (objectui#12902):
  // only a name `regionOffer` offers is written.
  const addRegion = React.useCallback(
    (name: string) => {
      if (!onPatch || !offeredRegionNames(offer).includes(name)) return;
      writeRegions([...regions, { name, components: [] }]);
    },
    [onPatch, offer, regions, writeRegions],
  );

  // Append a block into a container's nested child array (issue #1499).
  // `baseId` is the container's selection id (`regions[r].components[c]` or
  // `slot:<name>:<idx>`); `pathSuffix` locates the children array within it.
  const addNestedBlock = React.useCallback(
    (baseId: string, pathSuffix: string, type: BlockTypeId) => {
      if (!onPatch) return;
      const slot = /^slot:([a-zA-Z_]+):(\d+)$/.exec(baseId);
      const subHops = parsePath(pathSuffix);
      if (!subHops) return;
      const subPath = hopsToPath(subHops);
      if (slot) {
        const name = slot[1];
        const idx = Number(slot[2]);
        const slots = ((draft as any).slots || {}) as Record<string, any>;
        const v = slots[name];
        const arr = Array.isArray(v) ? [...v] : v != null ? [v] : [];
        const base = arr[idx];
        if (!base) return;
        const cur = getByPath(base, subPath) || [];
        arr[idx] = setByPath(base, subPath, [...cur, { type }]);
        onPatch({ slots: { ...slots, [name]: arr } });
        onSelectionChange?.({ kind: 'block', id: `${baseId}.${pathSuffix}[${cur.length}]`, label: type });
      } else {
        const fullHops = parsePath(`${baseId}.${pathSuffix}`);
        if (!fullHops) return;
        const fullPath = hopsToPath(fullHops);
        const cur = getByPath(draft, fullPath) || [];
        const next = setByPath(draft, fullPath, [...cur, { type }]);
        onPatch({ [fullPath[0] as string]: next[fullPath[0]] });
        onSelectionChange?.({ kind: 'block', id: `${baseId}.${pathSuffix}[${cur.length}]`, label: type });
      }
    },
    [onPatch, draft, onSelectionChange],
  );

  const handleBgClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && selectedId) onSelectionChange?.(null);
    },
    [onSelectionChange, selectedId],
  );

  // Empty draft → empty canvas with hint. (ADR-0047 interface pages never
  // reach this canvas — PagePreview renders them as a live InterfaceListPage
  // in both design and preview modes — so no interface-specific hint here.)
  if (regions.length === 0) {
    return (
      <div className="h-full overflow-auto bg-muted/20" onClick={handleBgClick}>
        <div className="mx-auto max-w-3xl px-6 py-8">
          <div className="rounded-lg border-2 border-dashed bg-background py-16 px-6 text-center space-y-3">
            <div className="text-sm font-medium">{tr('engine.pageBlockCanvas.noRegions', locale)}</div>
            <div className="text-xs text-muted-foreground">
              {tr('engine.pageBlockCanvas.noRegionsHint', locale)}
            </div>
            {!readOnly && (
              <div className="pt-2 flex justify-center">
                <AddRegionControl
                  offer={offer}
                  onAdd={addRegion}
                  variant="outline"
                  className="border-dashed"
                  locale={locale}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-muted/20" onClick={handleBgClick}>
      <div className="mx-auto max-w-3xl px-6 py-6 space-y-5" onClick={handleBgClick}>
        {regions.map((region, regionIdx) => (
          <RegionSection
            key={regionIdx}
            region={region}
            regionIdx={regionIdx}
            shape={shape}
            selectedId={selectedId}
            readOnly={readOnly}
            onSelectBlock={(compIdx, blk) =>
              onSelectionChange?.({
                kind: 'block',
                id: selectionId(shape, regionIdx, compIdx, region.name),
                label: blockLabel(blk),
              })
            }
            onMoveBlock={moveBlock}
            onAddBlock={addBlock}
            onRenameLabel={renameLabel}
            baseIdOf={(compIdx) => selectionId(shape, regionIdx, compIdx, region.name)}
            onSelectId={(sid, lbl) => onSelectionChange?.({ kind: 'block', id: sid, label: lbl })}
            onAddNested={addNestedBlock}
            template={(draft as { template?: unknown }).template}
            locale={locale}
          />
        ))}
        {!readOnly && shape === 'regions' && (
          <div className="pt-1">
            <AddRegionControl
              offer={offer}
              onAdd={addRegion}
              variant="ghost"
              className="text-muted-foreground"
              locale={locale}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Add region ─────────────── */

/**
 * "Add region" offers the names {@link regionOffer} allows and nothing else
 * (objectui#12902). With none left it is disabled, and says why beside it.
 */
function AddRegionControl({
  offer,
  onAdd,
  variant,
  className,
  locale,
}: {
  offer: RegionOffer;
  onAdd: (name: string) => void;
  variant: 'outline' | 'ghost';
  className?: string;
  locale?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const reasonId = React.useId();
  const reason = !offer.known
    ? tFormat('engine.pageBlockCanvas.addRegionUnknownTemplate', locale, { template: offer.template })
    : offeredRegionNames(offer).length === 0
      ? tFormat('engine.pageBlockCanvas.addRegionAllFilled', locale, {
          template: offer.template,
          slots: PAGE_TEMPLATE_SLOTS[offer.template as PageTemplate].join(', '),
        })
      : null;
  const label = (
    <>
      <Plus className="h-3.5 w-3.5" />
      {tr('engine.pageBlockCanvas.addRegion', locale)}
    </>
  );
  if (reason !== null) {
    return (
      <div className="inline-flex flex-wrap items-center gap-2">
        <Button
          variant={variant}
          size="sm"
          className={cn('gap-1.5', className)}
          disabled
          aria-describedby={reasonId}
        >
          {label}
        </Button>
        <span id={reasonId} className="text-xs text-muted-foreground" data-add-region-reason="">
          {reason}
        </span>
      </div>
    );
  }
  const gridCell = offer.gridCell;
  const pick = (name: string) => {
    setOpen(false);
    onAdd(name);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size="sm" className={cn('gap-1.5', className)}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div className="flex flex-col">
          {offer.slots.map((slot) => (
            <Button
              key={slot}
              variant="ghost"
              size="sm"
              className="justify-start font-mono text-xs"
              data-add-region={slot}
              onClick={() => pick(slot)}
            >
              {slot}
            </Button>
          ))}
          {gridCell !== null && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start gap-2 text-xs"
              data-add-region={gridCell}
              onClick={() => pick(gridCell)}
            >
              {tr('engine.pageBlockCanvas.gridCell', locale)}
              <span className="font-mono text-muted-foreground">{gridCell}</span>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─────────────── Region section ─────────────── */

function RegionSection({
  region,
  regionIdx,
  shape,
  selectedId,
  readOnly,
  onSelectBlock,
  onMoveBlock,
  onAddBlock,
  onRenameLabel,
  onSelectId,
  onAddNested,
  template,
  locale,
}: {
  region: Region;
  regionIdx: number;
  shape: 'regions' | 'children' | 'slots';
  selectedId: string | null;
  readOnly: boolean;
  onSelectBlock: (compIdx: number, blk: Block) => void;
  onMoveBlock: (
    src: { region: number; comp: number },
    dst:
      | { region: number; before?: number; after?: number }
      | { region: number; appendEnd: true },
  ) => void;
  onAddBlock: (regionIdx: number, type: BlockTypeId) => void;
  onRenameLabel: (regionIdx: number, compIdx: number, nextLabel: string) => void;
  baseIdOf: (compIdx: number) => string;
  onSelectId: (id: string, label: string) => void;
  onAddNested: (baseId: string, pathSuffix: string, type: BlockTypeId) => void;
  /** The page's `template`, which decides whether this region is a rail. */
  template?: unknown;
  locale?: string;
}) {
  const comps = Array.isArray(region.components) ? region.components : [];
  // The span each block takes in the page's region grid (objectui#12624), read
  // from the page renderer's own table so the card cannot disagree with the
  // page. Only a `regions` page lays its blocks on that grid: a `children` page
  // stacks them, so its cards show no span.
  const rail = isPageRailRegion(region.name, template);
  const [active, setActive] = React.useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    if (readOnly) return;
    const types = e.dataTransfer.types;
    if (!types || !Array.from(types).includes(DT_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setActive(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (readOnly) return;
    setActive(false);
    if (e.defaultPrevented) return;
    e.preventDefault();
    const raw = e.dataTransfer.getData(DT_MIME);
    if (!raw) return;
    try {
      const src = JSON.parse(raw) as { region: number; comp: number };
      if (typeof src.region !== 'number' || typeof src.comp !== 'number') return;
      onMoveBlock(src, { region: regionIdx, appendEnd: true });
    } catch {/* ignore */}
  };

  return (
    <section
      className={cn(
        'rounded-md transition-colors',
        active && 'bg-primary/5 ring-1 ring-primary/30 -mx-1 px-1 py-1',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pl-1 mb-2 flex items-center gap-2">
        <span>{region.name || tFormat('engine.pageBlockCanvas.regionN', locale, { n: regionIdx + 1 })}</span>
        {region.width && (
          <span className="normal-case text-[10px] text-muted-foreground/60">· {region.width}</span>
        )}
        {active && <span className="text-primary normal-case text-[10px]">{tr('engine.pageBlockCanvas.dropHere', locale)}</span>}
      </div>
      <div className="space-y-2.5">
        {comps.length === 0 ? (
          <div className="rounded border border-dashed bg-background/50 py-6 px-4 text-center text-xs text-muted-foreground">
            {tr(shape === 'slots' ? 'engine.pageBlockCanvas.slotInherited' : 'engine.pageBlockCanvas.regionEmpty', locale)}
          </div>
        ) : (
          comps.map((blk, compIdx) => {
            const id = selectionId(shape, regionIdx, compIdx, region.name);
            return (
              <React.Fragment key={`${regionIdx}:${compIdx}`}>
                <BlockRow
                  block={blk}
                  regionIdx={regionIdx}
                  compIdx={compIdx}
                  selected={id === selectedId}
                  readOnly={readOnly}
                  onClick={() => onSelectBlock(compIdx, blk)}
                  onMoveBlock={onMoveBlock}
                  onRenameLabel={(v) => onRenameLabel(regionIdx, compIdx, v)}
                  span={shape === 'regions' ? pageBlockSpan(blk.type, rail) : undefined}
                  locale={locale}
                />
                <NestedChildren
                  block={blk}
                  baseId={id}
                  selectedId={selectedId}
                  readOnly={readOnly}
                  onSelectId={onSelectId}
                  onAddNested={onAddNested}
                  rail={rail}
                  locale={locale}
                />
              </React.Fragment>
            );
          })
        )}
        {!readOnly && (
          <div className="pt-1">
            <AddBlockButton onPick={(type) => onAddBlock(regionIdx, type)} locale={locale} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ─────────────── Block row ─────────────── */

/** A block's derived span in the page block grid, read-only (objectui#12624). */
function SpanBadge({ span, locale }: { span: PageBlockSpan; locale?: string }) {
  return (
    <Badge
      variant="outline"
      className="text-[10px] shrink-0 font-mono bg-background/90"
      data-block-span={span}
      title={tFormat('engine.pageBlockCanvas.span', locale, { span })}
    >
      {span}/12
    </Badge>
  );
}

function BlockRow({
  block,
  regionIdx,
  compIdx,
  selected,
  readOnly,
  onClick,
  onMoveBlock,
  onRenameLabel,
  span,
  locale,
}: {
  block: Block;
  regionIdx: number;
  compIdx: number;
  selected: boolean;
  readOnly: boolean;
  onClick: () => void;
  onMoveBlock: (
    src: { region: number; comp: number },
    dst:
      | { region: number; before?: number; after?: number }
      | { region: number; appendEnd: true },
  ) => void;
  onRenameLabel: (nextLabel: string) => void;
  /** The block's derived span in the region grid; read-only, nothing edits it. */
  span?: PageBlockSpan;
  locale?: string;
}) {
  const typeStr = String(block.type ?? '');
  const spanBadge = span !== undefined && <SpanBadge span={span} locale={locale} />;
  // DISPLAY meta, not the palette catalogue. `BLOCK_TYPE_META` answers "what may
  // an author drag in"; a node already in the page may be a spelling the palette
  // does not offer yet the app renders fine — the `record:discussion` /
  // `record:chatter` alias pair. See BLOCK_RENDERER_ALIAS_GROUPS in
  // block-types.ts; nothing here makes a type offerable.
  const meta = resolveBlockDisplayMeta(typeStr);
  const Icon = meta?.Icon ?? UnknownBlockIcon;
  const tone = resolveBlockTone(typeStr);
  const label = blockLabel(block);
  const draggable = !readOnly;
  const [dropZone, setDropZone] = React.useState<'before' | 'after' | null>(null);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DT_MIME, JSON.stringify({ region: regionIdx, comp: compIdx }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!draggable) return;
    const types = e.dataTransfer.types;
    if (!types || !Array.from(types).includes(DT_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    setDropZone(e.clientY - rect.top < rect.height / 2 ? 'before' : 'after');
  };
  const handleDragLeave = () => setDropZone(null);
  const handleDrop = (e: React.DragEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = dropZone ?? 'before';
    setDropZone(null);
    const raw = e.dataTransfer.getData(DT_MIME);
    if (!raw) return;
    try {
      const src = JSON.parse(raw) as { region: number; comp: number };
      if (src.region === regionIdx && src.comp === compIdx) return;
      const dst = pos === 'before'
        ? { region: regionIdx, before: compIdx }
        : { region: regionIdx, after: compIdx };
      onMoveBlock(src, dst);
    } catch {/* ignore */}
  };

  // Inline label rename
  const [editingLabel, setEditingLabel] = React.useState(false);
  const [draft, setDraft] = React.useState(label);
  React.useEffect(() => { setDraft(label); }, [label]);
  const beginEdit = (e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setDraft(label);
    setEditingLabel(true);
  };
  const commitEdit = () => {
    if (readOnly) { setEditingLabel(false); return; }
    const next = draft.trim();
    if (next && next !== label) onRenameLabel(next);
    setEditingLabel(false);
  };
  const cancelEdit = () => { setDraft(label); setEditingLabel(false); };

  // Container blocks (grid / card / tabs / section) render a slim title bar —
  // their real content is the nested child cards shown below by NestedChildren.
  // Leaf blocks render their REAL component so the canvas mirrors the preview.
  const isContainer = childGroups(block).length > 0;

  return (
    <div
      className={cn('relative', dropZone === 'before' && 'pt-1.5')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropZone === 'before' && (
        <div className="absolute left-0 right-0 -top-0.5 h-0.5 bg-primary rounded-full" />
      )}
      <div
        className={cn(
          'group relative rounded-md border bg-card transition-colors hover:border-primary/40',
          selected ? 'border-primary ring-2 ring-primary/30 shadow-sm' : 'border-border',
        )}
      >
        {isContainer ? (
          <button
            type="button"
            onClick={onClick}
            draggable={draggable}
            onDragStart={handleDragStart}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md px-3.5 py-2.5 text-left',
              readOnly && 'cursor-default',
              draggable && 'cursor-grab active:cursor-grabbing',
            )}
            aria-pressed={selected}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {draggable && (
                <GripVertical
                  className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground/80"
                  aria-hidden="true"
                />
              )}
              <Icon className={cn('h-3.5 w-3.5 shrink-0', tone.icon)} />
              {editingLabel ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                  }}
                  onBlur={commitEdit}
                  className="text-sm font-medium px-1 py-0.5 -mx-1 -my-0.5 rounded border border-primary bg-background outline-none min-w-0 flex-1"
                />
              ) : (
                <span
                  className={cn('text-sm font-medium truncate', !readOnly && 'cursor-text')}
                  onDoubleClick={beginEdit}
                  title={!readOnly ? tr('designer.canvas.renameHint', locale) : undefined}
                >
                  {label}
                </span>
              )}
              {block.id && block.id !== label && (
                <code className="text-[10px] text-muted-foreground/70 font-mono truncate">#{block.id}</code>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {spanBadge}
              <Badge variant="outline" className={cn('text-[10px] shrink-0 font-mono', tone.badge)}>
                {typeStr}
              </Badge>
            </div>
          </button>
        ) : (
          <>
            <BlockLivePreview block={block} locale={locale} />
            <button
              type="button"
              onClick={onClick}
              draggable={draggable}
              onDragStart={handleDragStart}
              aria-label={tFormat('engine.pageBlockCanvas.select', locale, { label })}
              aria-pressed={selected}
              className={cn(
                'absolute inset-0 z-10 rounded-md',
                readOnly && 'cursor-default',
                draggable && 'cursor-grab active:cursor-grabbing',
              )}
            />
            <div
              className={cn(
                'pointer-events-none absolute right-1.5 top-1.5 z-20 flex items-center gap-1 transition-opacity',
                selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              {draggable && <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />}
              {spanBadge}
              <Badge variant="outline" className={cn('text-[10px] font-mono shadow-sm bg-background/90 backdrop-blur', tone.badge)}>
                {typeStr}
              </Badge>
            </div>
          </>
        )}
      </div>
      {dropZone === 'after' && (
        <div className="absolute left-0 right-0 -bottom-1 h-0.5 bg-primary rounded-full" />
      )}
    </div>
  );
}

/* ─────────────── Nested container children (issue #1499) ─────────────── */

function NestedChildren({
  block,
  baseId,
  selectedId,
  readOnly,
  onSelectId,
  onAddNested,
  rail = false,
  locale,
}: {
  block: Block;
  baseId: string;
  selectedId: string | null;
  readOnly: boolean;
  onSelectId: (id: string, label: string) => void;
  onAddNested: (baseId: string, pathSuffix: string, type: BlockTypeId) => void;
  /** The block sits in a rail region, where every block spans 12. */
  rail?: boolean;
  locale?: string;
}) {
  const groups = childGroups(block, locale);
  if (groups.length === 0) return null;
  // `page:card` and `page:section` lay their children on the page block grid
  // at runtime (objectui#12624), so their child cards show the span too.
  const showsSpan = block?.type === 'page:card' || block?.type === 'page:section';
  // A grid lays its children in N columns at runtime — mirror that here so the
  // design canvas matches the preview (other containers stack in one column).
  const gridCols =
    block?.type === 'grid'
      ? Math.min(6, Math.max(1, Number((block.properties as Record<string, unknown> | undefined)?.columns) || 1))
      : 1;
  const colsClass = GRID_COLS_CLASS[gridCols] ?? 'grid-cols-1';
  return (
    <div className="ml-5 mt-1.5 space-y-2.5 border-l border-dashed border-border pl-3">
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{g.label}</div>
          {g.children.length === 0 ? (
            <div className="rounded border border-dashed bg-background/40 py-2 px-3 text-[11px] text-muted-foreground">
              {tr('engine.pageBlockCanvas.groupEmpty', locale)}
            </div>
          ) : (
            <div className={cn('grid gap-2', colsClass)}>
              {g.children.map((child, ci) => {
                const cid = `${baseId}.${g.pathSuffix}[${ci}]`;
                const typeStr = String(child?.type ?? '');
                const childSelected = cid === selectedId;
                return (
                  <div
                    key={ci}
                    className={cn(
                      'group relative rounded-md border bg-card transition-colors hover:border-primary/40',
                      childSelected ? 'border-primary ring-2 ring-primary/30 shadow-sm' : 'border-border',
                    )}
                  >
                    <BlockLivePreview block={child} maxHeightClass="max-h-56" locale={locale} />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelectId(cid, blockLabel(child)); }}
                      aria-label={tFormat('engine.pageBlockCanvas.select', locale, { label: blockLabel(child) })}
                      aria-pressed={childSelected}
                      className="absolute inset-0 z-10 rounded-md cursor-pointer"
                    />
                    <div
                      className={cn(
                        'pointer-events-none absolute right-1.5 top-1.5 z-20 flex items-center gap-1 transition-opacity',
                        childSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      {showsSpan && <SpanBadge span={pageBlockSpan(child?.type, rail)} locale={locale} />}
                      <Badge variant="outline" className={cn('text-[10px] font-mono shadow-sm bg-background/90 backdrop-blur', resolveBlockTone(typeStr).badge)}>
                        {typeStr}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!readOnly && <AddBlockButton onPick={(type) => onAddNested(baseId, g.pathSuffix, type)} locale={locale} />}
        </div>
      ))}
    </div>
  );
}

/* ─────────────── Add block picker ─────────────── */

/**
 * The add-block picker. A type's DISPLAYED name is its `labelKey` row, read in
 * `locale`, and the search matches that name or the type id (objectui#10862,
 * the add-widget picker's shape from objectui#10804).
 */
function AddBlockButton({ onPick, locale }: { onPick: (type: BlockTypeId) => void; locale?: string }) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const q = filter.trim().toLowerCase();

  const groups = React.useMemo(() => {
    if (!q) return TYPES_BY_CATEGORY;
    return TYPES_BY_CATEGORY
      .map((g) => ({
        category: g.category,
        types: g.types.filter((id) => {
          const m = BLOCK_TYPE_META[id];
          return id.includes(q) || tr(m.labelKey, locale).toLowerCase().includes(q);
        }),
      }))
      .filter((g) => g.types.length > 0);
  }, [q, locale]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFilter(''); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 border-dashed">
          <Plus className="h-3.5 w-3.5" />
          {tr('engine.inspector.add.block', locale)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0 max-h-[480px] overflow-hidden flex flex-col">
        <div className="p-2 border-b">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={tr('engine.pageBlockCanvas.searchTypes', locale)}
            className="h-7 w-full px-2 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex-1 overflow-auto p-1">
          {groups.length === 0 ? (
            <div className="text-xs text-muted-foreground p-4 text-center">{tr('engine.pageBlockCanvas.noMatch', locale)}</div>
          ) : (
            groups.map((g) => (
              <div key={g.category} className="mb-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
                  {tr(CATEGORY_LABEL_KEY[g.category], locale)}
                </div>
                {g.types.map((id) => {
                  const m = BLOCK_TYPE_META[id];
                  const Icon = m.Icon;
                  const tone = resolveBlockTone(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => { onPick(id); setOpen(false); setFilter(''); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent text-left"
                    >
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', tone.icon)} />
                      <span className="truncate">{tr(m.labelKey, locale)}</span>
                      <code className="ml-auto text-[10px] text-muted-foreground/70 font-mono truncate">{id}</code>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
