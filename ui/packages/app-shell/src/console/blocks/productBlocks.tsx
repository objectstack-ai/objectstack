/**
 * Product-page blocks (objectui#12197)
 *
 * Five generic SDUI blocks for the pages a product composes as metadata —
 * a product's welcome page, a CRM's sales home — named for what they draw
 * (ADR-0060 rule 2), never for the product that asked for them:
 *
 *   - `hero`      — the page-top card: a heading, a line, a copyable value,
 *                   a status chip and up to two actions.
 *   - `stat`      — one labelled figure.
 *   - `usage-bar` — how much of a limit is used, as a bar.
 *   - `checklist` — steps that tick as they are done.
 *   - `tile-grid` — the console home's launcher tiles, as a block.
 *
 * ## Props, and bound data
 *
 * Every block reads its props from the node's `properties` bag, as evaluated by
 * `SchemaRenderer`. A block placed with the spec's API binding
 * (`dataSource: { provider: 'api', read: { url }, path? }`) gets the selected
 * value as `data` in its holes — `value: '${data.members.count}'` — which
 * `SchemaRenderer` resolves before the block renders, and draws the binding's
 * loading and error states itself. So no block fetches anything: the read is
 * the renderer's (`useElementApiDataSource`, `@object-ui/react`).
 *
 * `checklist` items are evaluated here, one member at a time, through
 * `useConfigBagEvaluator` — the same rule and the same scope `SchemaRenderer`
 * evaluates the node with — because the node's own evaluation is shallow and
 * an item's `done` is one level down.
 *
 * ## Copy is the page's
 *
 * Every authored string is a plain string or an inline translation map,
 * resolved with `pickLocalized`, as `element:text` / `element:button` do.
 * objectui's bundles carry only chrome: the copy button's accessible name and
 * its "copied" state reuse `detail.copyToClipboard` / `detail.copied`.
 *
 * ## What each block reuses
 *
 *   - `hero`'s actions are `element:button` / `action:button` NODES, drawn
 *     through `SchemaRenderer`: the console's button shapes and its action
 *     runner, not a second action shape. The copy affordance is the
 *     `navigator.clipboard` pattern of `ConnectAgentWidget`'s `CopyButton`.
 *   - `usage-bar` draws the `Progress` primitive (`@object-ui/components`).
 *   - `tile-grid` draws the apps strip's tile (`../home/launcherTile.ts`, moved
 *     out of `HomeAppsStrip` string for string), and leads with a router
 *     `Link`, as the strip does.
 *
 * Types and arms: `@object-ui/types` `product-blocks.ts` /
 * `zod/product-blocks.zod.ts`.
 *
 * @module
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCircle2, Circle, Copy, Plus } from 'lucide-react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, useConfigBagEvaluator } from '@object-ui/react';
import { Badge, Button, Card, CardContent, Progress, cn } from '@object-ui/components';
import { formatDisplayNumber, pickLocalized, useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import type { DeclaredNode } from '@object-ui/types';
import { getIcon } from '../../utils/getIcon.js';
import { ICON_BOX_CLASSES, TILE_CLASSES, launcherIconGradient } from '../home/launcherTile.js';

/** The renderer props every block receives from `SchemaRenderer`. */
interface BlockRendererProps {
  schema?: { properties?: unknown; className?: string };
  className?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The node's evaluated `properties` bag. */
function propsOf(schema: BlockRendererProps['schema']): Record<string, unknown> {
  return isRecord(schema?.properties) ? schema.properties : {};
}

/** A child node slot: rendered when it holds a node, nothing otherwise. */
function NodeSlot({ node }: { node: unknown }) {
  if (!isRecord(node) || typeof node.type !== 'string') return null;
  return <SchemaRenderer schema={node as unknown as DeclaredNode} />;
}

/** A finite number, or `undefined` for anything else (a bound value may be absent). */
const finite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

// ---------------------------------------------------------------------------
// hero
// ---------------------------------------------------------------------------

const STATUS_TONE_CLASSES: Record<string, string> = {
  neutral: 'border-transparent bg-muted text-muted-foreground',
  success: 'border-transparent bg-success/15 text-success',
  warning: 'border-transparent bg-warning/15 text-warning',
  danger: 'border-transparent bg-destructive/15 text-destructive',
};

/** The copy-to-clipboard affordance, `ConnectAgentWidget`'s `CopyButton` pattern. */
function CopyValueButton({ text }: { text: string }) {
  const { t } = useObjectTranslation();
  const [copied, setCopied] = React.useState(false);
  const label = copied
    ? t('detail.copied', { defaultValue: 'Copied!' })
    : t('detail.copyToClipboard', { defaultValue: 'Copy to clipboard' });
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0"
      aria-label={label}
      title={label}
      data-testid="hero-meta-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable (non-secure context) — the value stays selectable */
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </Button>
  );
}

export function HeroBlock({ schema, className }: BlockRendererProps) {
  const props = propsOf(schema);
  const { language } = useObjectTranslation();
  const title = pickLocalized(props.title, language);
  const subtitle = pickLocalized(props.subtitle, language);
  const status = pickLocalized(props.status, language);
  const meta = typeof props.meta === 'string' || typeof props.meta === 'number' ? String(props.meta) : '';
  const tone = typeof props.statusTone === 'string' && props.statusTone in STATUS_TONE_CLASSES
    ? props.statusTone
    : 'neutral';
  const hasActions = isRecord(props.primary) || isRecord(props.secondary);
  return (
    <Card className={cn('w-full border-border/70', className)} data-testid="hero-block">
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight">{title}</h2>
            {status && (
              <Badge className={STATUS_TONE_CLASSES[tone]} data-testid="hero-status">
                {status}
              </Badge>
            )}
          </div>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          {meta && (
            <div className="flex items-center gap-1">
              <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs" data-testid="hero-meta">
                {meta}
              </code>
              <CopyValueButton text={meta} />
            </div>
          )}
        </div>
        {hasActions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2" data-testid="hero-actions">
            <NodeSlot node={props.primary} />
            <NodeSlot node={props.secondary} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// stat
// ---------------------------------------------------------------------------

export function StatBlock({ schema, className }: BlockRendererProps) {
  const props = propsOf(schema);
  const { language } = useObjectTranslation();
  const locale = useDisplayLocale();
  const value = finite(props.value);
  const shown = value !== undefined
    ? formatDisplayNumber(value, { locale })
    : typeof props.value === 'string' && props.value !== ''
      ? props.value
      : '—';
  const hint = pickLocalized(props.hint, language);
  return (
    <Card className={cn('border-border/70', className)} data-testid="stat-block">
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium text-muted-foreground">{pickLocalized(props.label, language)}</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight" data-testid="stat-value">{shown}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// usage-bar
// ---------------------------------------------------------------------------

/**
 * The bar's fill, in percent, computed by the block — never authored.
 *
 *   - `limit` absent or `0`: unlimited, so there is no bar (`undefined`).
 *   - `used` absent (a bound value not reported yet): an empty bar, `0`.
 *   - otherwise `used / limit`, clamped to 0–100; past the limit the bar is full.
 */
export function usageBarPercent(used: number | undefined, limit: number | undefined): number | undefined {
  if (limit === undefined || limit === 0) return undefined;
  if (used === undefined) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

export function UsageBarBlock({ schema, className }: BlockRendererProps) {
  const props = propsOf(schema);
  const { language } = useObjectTranslation();
  const locale = useDisplayLocale();
  const used = finite(props.used);
  const limit = finite(props.limit);
  const unit = pickLocalized(props.unit, language);
  const percent = usageBarPercent(used, limit);
  const amount = (n: number | undefined) =>
    n === undefined ? '—' : `${formatDisplayNumber(n, { locale })}${unit ? ` ${unit}` : ''}`;
  const over = used !== undefined && limit !== undefined && limit > 0 && used > limit;
  const label = pickLocalized(props.label, language);
  return (
    <div className={cn('w-full space-y-1.5', className)} data-testid="usage-bar-block">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className={cn('tabular-nums text-muted-foreground', over && 'text-destructive')} data-testid="usage-bar-amount">
          {percent === undefined ? amount(used) : `${amount(used)} / ${amount(limit)}`}
        </span>
      </div>
      {percent !== undefined && (
        <Progress
          value={percent}
          // The primitive keeps `value` for its indicator and does not hand it
          // to the root, so the bar states its own reading.
          aria-valuenow={Math.round(percent)}
          aria-label={label}
          className={cn('h-2', over && '[&>div]:bg-destructive')}
          data-testid="usage-bar-progress"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// checklist
// ---------------------------------------------------------------------------

export function ChecklistBlock({ schema, className }: BlockRendererProps) {
  const props = propsOf(schema);
  const { language } = useObjectTranslation();
  const evaluateMember = useConfigBagEvaluator();
  const items = (Array.isArray(props.items) ? props.items : [])
    .filter(isRecord)
    .map((item) => evaluateMember(item) as Record<string, unknown>);
  const allDone = items.length > 0 && items.every((item) => item.done === true);
  if (allDone && props.collapsedWhenDone === true) return null;
  return (
    <ol className={cn('w-full space-y-2', className)} data-testid="checklist-block">
      {items.map((item, index) => {
        const done = item.done === true;
        return (
          <li
            key={index}
            className="flex items-center gap-3 text-sm"
            data-testid={`checklist-item-${index}`}
            data-done={done ? 'true' : 'false'}
          >
            {done ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
            ) : (
              <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className={cn('flex-1', done && 'text-muted-foreground line-through')}>
              {pickLocalized(item.label, language)}
            </span>
            {!done && <NodeSlot node={item.action} />}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// tile-grid
// ---------------------------------------------------------------------------

export function TileGridBlock({ schema, className }: BlockRendererProps) {
  const props = propsOf(schema);
  const { language } = useObjectTranslation();
  const items = (Array.isArray(props.items) ? props.items : []).filter(isRecord);
  const addTile = isRecord(props.addTile) ? props.addTile : undefined;
  return (
    <div className={cn('-ml-2 flex flex-wrap gap-1', className)} data-testid="tile-grid-block">
      {items.map((item, index) => {
        const href = typeof item.href === 'string' ? item.href : '';
        const label = pickLocalized(item.label, language);
        const caption = pickLocalized(item.caption, language);
        const Icon = getIcon(typeof item.icon === 'string' ? item.icon : undefined);
        return (
          <Link key={`${href}-${index}`} to={href} className={TILE_CLASSES} data-testid={`tile-grid-tile-${index}`}>
            <span
              className={cn(
                ICON_BOX_CLASSES,
                'bg-gradient-to-br text-white shadow-sm transition-transform group-hover:scale-105',
                launcherIconGradient(href || label),
              )}
            >
              <Icon className="size-[26px]" />
            </span>
            <span className="w-full truncate text-[13px] font-medium">{label}</span>
            {caption && <span className="-mt-1 w-full truncate text-[11px] text-muted-foreground">{caption}</span>}
          </Link>
        );
      })}
      {addTile && typeof addTile.href === 'string' && (
        <Link to={addTile.href} className={cn(TILE_CLASSES, 'text-muted-foreground')} data-testid="tile-grid-add">
          <span
            className={cn(
              ICON_BOX_CLASSES,
              'border-[1.5px] border-dashed border-border transition-colors group-hover:border-foreground/30 group-hover:text-foreground',
            )}
          >
            <Plus className="size-[22px]" aria-hidden />
          </span>
          <span className="w-full truncate text-[13px] font-medium">{pickLocalized(addTile.label, language)}</span>
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

/**
 * The API binding every product block reads as `dataSource`, declared by each
 * registration itself: these blocks do not wrap `ElementDataSourceGate`, so the
 * object-binding input the gate's marker injects is not theirs.
 */
const API_BINDING_INPUT = {
  name: 'dataSource',
  type: 'object',
  description:
    'Optional API binding: { provider: "api", read: { url: "/api/v1/…" }, path?: "data" } — one same-origin '
    + 'endpoint, read with the console\'s signed-in fetch. The value `path` selects (the whole response when '
    + 'omitted) is `data` in this block\'s ${…} holes and its visibleWhen; the block draws a loading line '
    + 'while it is read and an error panel when it cannot be.',
} as const;

ComponentRegistry.register('hero', HeroBlock, {
  namespace: 'app-shell',
  label: 'Hero',
  category: 'content',
  inputs: [
    { name: 'title', type: ['string', 'object'], required: true, description: 'The heading: a string or an inline translation map ({ en, "zh-CN", … }).' },
    { name: 'subtitle', type: ['string', 'object'], description: 'One line under the heading. None when omitted.' },
    { name: 'meta', type: 'string', description: 'A value drawn in monospace with a copy-to-clipboard button, e.g. a hostname. None when omitted.' },
    { name: 'status', type: ['string', 'object'], description: 'A status chip beside the heading. None when omitted.' },
    { name: 'statusTone', type: 'enum', enum: ['neutral', 'success', 'warning', 'danger'], description: 'The status chip\'s colour; neutral when omitted.' },
    { name: 'primary', type: 'slot', description: 'The primary action: an element:button or action:button node. None when omitted.' },
    { name: 'secondary', type: 'slot', description: 'The secondary action, drawn after the primary one. None when omitted.' },
    API_BINDING_INPUT,
  ],
});

ComponentRegistry.register('stat', StatBlock, {
  namespace: 'app-shell',
  label: 'Stat',
  category: 'content',
  inputs: [
    { name: 'label', type: ['string', 'object'], required: true, description: 'What the figure counts: a string or an inline translation map.' },
    { name: 'value', type: ['number', 'string'], required: true, description: 'The figure. A number is formatted in the viewer\'s locale; text is drawn as written; a hole that resolves to nothing draws "—".' },
    { name: 'hint', type: ['string', 'object'], description: 'One muted line under the figure. None when omitted.' },
    API_BINDING_INPUT,
  ],
});

ComponentRegistry.register('usage-bar', UsageBarBlock, {
  namespace: 'app-shell',
  label: 'Usage bar',
  category: 'content',
  inputs: [
    { name: 'label', type: ['string', 'object'], required: true, description: 'What is being used: a string or an inline translation map.' },
    { name: 'used', type: ['number', 'string'], required: true, description: 'How much is used: a number, or a ${…} hole that resolves to one. A hole that resolves to nothing draws "—" and an empty bar.' },
    { name: 'limit', type: ['number', 'string'], description: 'The limit. Absent or 0 means unlimited: the block draws the amount used and no bar. The bar\'s width is used / limit, clamped to 0–100; past the limit it is full and red.' },
    { name: 'unit', type: ['string', 'object'], description: 'The unit drawn after each amount, e.g. MB. None when omitted.' },
    API_BINDING_INPUT,
  ],
});

ComponentRegistry.register('checklist', ChecklistBlock, {
  namespace: 'app-shell',
  label: 'Checklist',
  category: 'content',
  inputs: [
    { name: 'items', type: 'array', of: 'object', required: true, description: 'The steps, in order: { label, done, action? }. label is a string or an inline translation map; done is a boolean or a ${…} hole that resolves to one; action is an element:button or action:button node drawn beside an open step.' },
    { name: 'collapsedWhenDone', type: 'boolean', description: 'Draw nothing once every step is done; false when omitted.' },
    API_BINDING_INPUT,
  ],
});

ComponentRegistry.register('tile-grid', TileGridBlock, {
  namespace: 'app-shell',
  label: 'Tile grid',
  category: 'content',
  inputs: [
    { name: 'items', type: ['array', 'string'], of: 'object', required: true, description: 'The tiles: { label, href, icon?, caption? }, or a ${…} hole naming a list of them in the bound data. href is a console route or an absolute URL; icon is a Lucide icon name (a generic icon when omitted). The tiles wrap to the container\'s width.' },
    { name: 'addTile', type: 'object', description: 'A dashed "add" tile after the others: { label, href }. None when omitted.' },
    API_BINDING_INPUT,
  ],
});
