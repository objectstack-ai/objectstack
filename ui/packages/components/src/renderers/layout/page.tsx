/**
 * ObjectUI — Page Renderer
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The Page renderer interprets PageSchema into structured layouts.
 * It supports four page types (record, home, app, utility) and
 * renders named regions (header, sidebar, main, footer, aside) with
 * configurable widths. When no regions are defined, it falls back to the
 * node's `children` list (objectui#6771 retired the `body` spelling).
 */

import React, { useMemo } from 'react';
import type { DeclaredNode, PageNodeSchema, PageNodeRegion, SchemaNode } from '@object-ui/types';
import { nodeSlotsFor } from '@object-ui/types';
import {
  SchemaRenderer,
  toRenderableSchema,
  PageVariablesProvider,
  PageVariableActionBridge,
  PrintPageProvider,
  usePrintPage,
  resolveInlineAriaProps,
} from '@object-ui/react';
import { ComponentRegistry, toDomProps } from '@object-ui/core';
import { useDisplayLocale } from '@object-ui/i18n';
import { compile, manifestFromConfigs, type Diagnostic } from '@object-ui/sdui-parser';
import { PAGE_TEMPLATE_SLOTS, type PageTemplate } from '@objectstack/spec/ui';
import { ReactKindPage } from './react-page';
import { PRINT_PAGE_ATTRIBUTE, PRINT_RUNNING_ATTRIBUTE, buildPagePrintStylesheet, isPagePrintDeclaration } from './page-print';
import { cn } from '../../lib/utils';
import { PageBlockGrid } from './page-block-grid';
import { PageDescriptionContext } from './page-description-context';
import { PageRegionPostureProvider, PageWidthProvider, usePageWidthStore } from './page-region-posture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map region width enum values to Tailwind width classes */
function getRegionWidthClass(width?: string): string {
  switch (width) {
    case 'small':
      return 'w-64';
    case 'medium':
      return 'w-80';
    case 'large':
      return 'w-96';
    case 'full':
      return 'w-full';
    default:
      return width ? width : 'w-full';
  }
}

/** Sidebar/aside width — full-width on mobile, fixed at md+ so the rail stacks
 *  above/below the main column on phones instead of squeezing it. LITERAL
 *  responsive strings so Tailwind's JIT scanner emits them. */
function getSidebarWidthClass(width?: string): string {
  switch (width) {
    case 'small':
      return 'w-full md:w-64';
    case 'medium':
      return 'w-full md:w-80';
    case 'large':
      return 'w-full md:w-96';
    default:
      return 'w-full';
  }
}

/** Max-width constraint by page type */
function getPageMaxWidth(pageType?: string): string {
  switch (pageType) {
    case 'utility':
      return 'max-w-4xl';
    case 'home':
      return 'max-w-screen-2xl';
    case 'app':
      return 'max-w-screen-xl';
    case 'record':
    default:
      return 'max-w-7xl';
  }
}

/** Find a named region (case-insensitive) */
function findRegion(regions: PageNodeRegion[] | undefined, name: string): PageNodeRegion | undefined {
  return regions?.find((r) => r.name?.toLowerCase() === name.toLowerCase());
}

/** Get all regions that are NOT in the named set */
function getRemainingRegions(regions: PageNodeRegion[] | undefined, exclude: readonly string[]): PageNodeRegion[] {
  if (!regions) return [];
  const lowerSet = new Set(exclude.map((n) => n.toLowerCase()));
  return regions.filter((r) => !lowerSet.has(r.name?.toLowerCase() ?? ''));
}

// ---------------------------------------------------------------------------
// "One page, one h1" — who owns the page heading (objectui#3434)
// ---------------------------------------------------------------------------

/**
 * `page:header` is registered `skipFallback: true`, so this is the ONLY node
 * type that resolves to PageHeaderRenderer — no bare `header` alias to match.
 */
const PAGE_HEADER_TYPE = 'page:header';

/** Text a header title contributes once `{token}` interpolation is stripped. */
function literalTitleText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    // `interpolate()` (containers.tsx) replaces `{field}` with the record value
    // and blanks it when there is none, so only the literal remainder is text
    // we can promise will be on screen.
    return value.replace(/\{[a-zA-Z0-9_.]+\}/g, '').replace(/\s+/g, ' ').trim();
  }
  if (typeof value === 'object') {
    // Inline translation map (`pickLocalized`): any non-empty translation
    // means the header will render a heading in some language.
    return Object.values(value as Record<string, unknown>)
      .map((v) => literalTitleText(v))
      .find((s) => s !== '') ?? '';
  }
  return String(value);
}

/** Does this node render a `page:header` heading of its own? */
function isTitledPageHeader(node: any): boolean {
  if (node?.type !== PAGE_HEADER_TYPE) return false;
  // Spec bridge may inline `properties.*` onto the node or preserve the bag —
  // PageHeaderRenderer reads both, so this must too.
  return literalTitleText(node?.title ?? node?.properties?.title) !== '';
}

/**
 * Depth-bounded walk over the component shapes a page can nest.
 *
 * Takes ONE node or a LIST of them, and judges both by the same rule.
 * `children` is declared `SchemaNode | SchemaNode[]` on `PageNodeSchema` and on
 * `BaseSchema`, and `FlatContent` below has always rendered the bare-node
 * form, so a single node is a first-class authored shape — at the top level and
 * at every nested level the recursion re-enters (objectui#8923). This used to
 * open with `if (!Array.isArray(nodes)) return false`, so every bare-node
 * channel answered "no titled header here" and PageRenderer drew a second `h1`
 * next to the authored one (the outline objectui#3434 closed).
 *
 * Normalising HERE rather than at the three call sites is deliberate: one
 * normaliser at the entry beats four predicates each having to remember
 * `Array.isArray`. It spends no depth budget — the widening happens inside the
 * same invocation as the `depth > 6` check — so the bound still admits exactly
 * the levels it admitted before. Spelled the way `FlatContent` already widens
 * the same two keys.
 */
function containsTitledPageHeader(nodes: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  const list: unknown[] = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
  return list.some(
    (n: any) =>
      !!n &&
      typeof n === 'object' &&
      (isTitledPageHeader(n) ||
        containsTitledPageHeader(n.components, depth + 1) ||
        containsTitledPageHeader(n.children, depth + 1)),
  );
}

/**
 * Does the page delegate its `<h1>` to an authored `page:header`?
 *
 * A document has exactly ONE `h1`. When an author drops a `page:header` into a
 * region, THAT component is the page's title renderer — the record chip on
 * record pages, a bare `<h1>` everywhere else — so PageRenderer must not emit a
 * second one. It used to, for every non-record page type: the showcase
 * master-detail page rendered its `label` as an `h1` AND its `page:header`
 * title as another `h1` with the same name, which is a broken document outline,
 * a title a screen reader announces twice, and a visible duplicate on screen
 * (objectui#3434 — a live e2e `getByRole('heading', { name })` resolved to 2
 * elements). Record pages already delegated the whole title block; this is the
 * same rule stated for every page type.
 *
 * Deliberately conservative — only a header whose title renders literal text
 * counts. `page:header` drops an empty title (and one that interpolates to
 * nothing, e.g. `title: '{name}'` with no record in scope), so suppressing ours
 * against a header that renders no heading would leave the page with NO `h1`.
 */
function pageHeaderOwnsTitle(schema: PageNodeSchema): boolean {
  const regionNodes = (schema.regions ?? []).flatMap((r: any) => r?.components ?? []);
  return (
    containsTitledPageHeader(regionNodes) ||
    containsTitledPageHeader(schema.children)
  );
}

// ---------------------------------------------------------------------------
// RegionContent — renders all components inside a single region
// ---------------------------------------------------------------------------

/**
 * A region lays its blocks out on a 12-column grid (objectui#12624). Each
 * block's span comes from its kind (`./page-block-span`): metric tiles 3,
 * charts 6, everything else 12, folded by breakpoint, so four tiles share a
 * row on a wide screen instead of stacking as four full-width stripes. Every
 * template places its regions through this one component, so each gets the
 * grid. A `rail` region (sidebar / aside) is a narrow column, where a fold by
 * viewport width would squeeze a tile to a sliver, so its blocks, and the
 * blocks inside its containers, stay full width (`./page-block-grid`).
 *
 * Each region also tells its blocks their posture (objectui#12703): the
 * region's grid is measured against the page body `PageRenderer` publishes,
 * and a region narrower than half the page is `compact`
 * (`./page-region-posture`). A list block reads it to draw a short list
 * instead of the object list's chrome. Measured, never authored, and judged
 * on the region, not the viewport.
 */
const RegionContent: React.FC<{
  region: PageNodeRegion;
  className?: string;
  rail?: boolean;
}> = ({ region, className, rail }) => {
  const gridRef = React.useRef<HTMLDivElement>(null);
  const components = region.components || [];
  if (components.length === 0) return null;

  return (
    <PageRegionPostureProvider regionRef={gridRef}>
      <PageBlockGrid
        nodes={components}
        className={cn(region.className, className)}
        rail={rail}
        keyPrefix={region.name}
        toSchema={(node) => toRenderableSchema(node as SchemaNode)}
        attributes={{ 'data-region': region.name }}
        gridRef={gridRef}
      />
    </PageRegionPostureProvider>
  );
};

// ---------------------------------------------------------------------------
// RunningRegions — the running header and footer of a print page
// ---------------------------------------------------------------------------

/**
 * Places a layout's `header` region, its body and its `footer` region as the
 * layout's flex children, as they always were — unless the enclosing page
 * declares `print.repeatHeader` / `print.repeatFooter` (objectui#11958).
 *
 * Then the three go into a table whose `thead` / `tfoot` hold the repeated
 * region, because the browser repeats a table's header and footer on every
 * sheet it runs onto, and only a REAL `thead` / `tfoot` (measured in Chromium
 * 141: a `div` with `display: table-header-group` printed once). On screen the
 * table, its sections, rows and cells are `display: contents`, so the regions
 * are still the layout's flex children and the page looks as it always did;
 * the print stylesheet (`./page-print.ts`) makes them a table on paper only.
 * Without either flag nothing is wrapped and the DOM is unchanged.
 */
const RunningRegions: React.FC<{
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ header, footer, children }) => {
  const print = usePrintPage();
  const repeatHeader = print?.repeatHeader === true && !!header;
  const repeatFooter = print?.repeatFooter === true && !!footer;
  if (!repeatHeader && !repeatFooter) {
    return (
      <>
        {header}
        {children}
        {footer}
      </>
    );
  }
  const row = (content: React.ReactNode) => (
    <tr className="contents">
      <td className="contents">{content}</td>
    </tr>
  );
  return (
    <table className="contents" role="presentation" {...{ [PRINT_RUNNING_ATTRIBUTE]: '' }}>
      {repeatHeader && <thead className="contents">{row(header)}</thead>}
      <tbody className="contents">
        {!repeatHeader && header ? row(header) : null}
        {row(children)}
        {!repeatFooter && footer ? row(footer) : null}
      </tbody>
      {repeatFooter && <tfoot className="contents">{row(footer)}</tfoot>}
    </table>
  );
};

// ---------------------------------------------------------------------------
// Layout refusals — a template shape the spec refuses (objectui#12476)
// ---------------------------------------------------------------------------

/** A template that places named slots only: every one but `dashboard`'s open grid. */
type SlottedTemplate = Exclude<PageTemplate, 'dashboard'>;

const TEMPLATE_NAMES = Object.keys(PAGE_TEMPLATE_SLOTS).map((name) => `'${name}'`).join(', ');

/** A visible refusal in place of what the page asked for, styled like the html tier's compile error. */
const PageLayoutRefusal: React.FC<{ kind: string; title: string; items: string[] }> = ({ kind, title, items }) => (
  <div
    className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
    data-page-refusal={kind}
  >
    <div className="font-semibold">{title}</div>
    <ul className="mt-1 list-disc space-y-0.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  </div>
);

/**
 * The regions a slotted template does not place (`PAGE_TEMPLATE_SLOTS`).
 *
 * They are not drawn, and not moved into another slot: the page says so where
 * they used to be stacked, under `main` (objectui#12476). The spec refuses such
 * a region at `os validate` and at save (`checkPageRegionPlacement`); a row
 * stored before that refusal is served unchanged, so this is what it shows
 * until its region is renamed.
 */
const UnplacedRegionsRefusal: React.FC<{ regions: PageNodeRegion[]; template: SlottedTemplate }> = ({
  regions,
  template,
}) => {
  if (regions.length === 0) return null;
  const slots = PAGE_TEMPLATE_SLOTS[template].join(', ');
  return (
    <PageLayoutRefusal
      kind="unplaced-region"
      title={`Not drawn: the '${template}' template does not place ${regions.length === 1 ? 'this region' : `these ${regions.length} regions`}`}
      items={regions.map(
        (region, idx) =>
          `Region '${region.name ?? `#${idx}`}': '${template}' places only ${slots}. Rename it to one of those slots, `
          + `or choose the 'dashboard' template, which lays every other region out as a grid cell.`,
      )}
    />
  );
};

/** A template name the registry does not hold: the page is not laid out by another layout instead. */
const UnregisteredTemplateRefusal: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => (
  <PageLayoutRefusal
    kind="unregistered-template"
    title="Not drawn: this page's template is not registered"
    items={[
      `Template '${String(schema.template)}' is not one of ${TEMPLATE_NAMES}. `
      + `'full-width' was a second name for 'default'.`,
    ]}
  />
);

// ---------------------------------------------------------------------------
// RegionLayout — structured layout with named slots
// ---------------------------------------------------------------------------

/**
 * The `default` template's body, and the `pageType` layouts' body.
 *
 * Under `template` (the `default` template) a region the template does not
 * place is refused on screen, never stacked (objectui#12476): the spec refuses
 * it at `os validate` and at save (`checkPageRegionPlacement`). A `kind: 'full'`
 * page that names no template is judged as `default` too, as the spec judges
 * it (objectui#12902): the `pageType` layouts pass `template` through
 * `templateLessJudgement`. Only a page of another kind, which the spec's
 * placement check does not judge, reaches here without `template`, and such a
 * region is then still stacked under `main`.
 */
const RegionLayout: React.FC<{
  regions: PageNodeRegion[];
  pageType?: string;
  className?: string;
  template?: SlottedTemplate;
}> = ({ regions, pageType, className, template }) => {
  const header = findRegion(regions, 'header');
  const sidebar = findRegion(regions, 'sidebar');
  const main = findRegion(regions, 'main');
  const aside = findRegion(regions, 'aside');
  const footer = findRegion(regions, 'footer');

  const remaining = getRemainingRegions(regions, ['header', 'sidebar', 'main', 'aside', 'footer']);
  // Remaining regions that don't match named slots → append below main,
  // only on a page the spec's placement check does not judge (not `kind: 'full'`).
  const extras = template ? [] : remaining;
  const unplaced = template ? remaining : [];

  const hasStructure = header || sidebar || main || aside || footer;
  if (!hasStructure) {
    // If there's no named layout structure, just stack everything — unless a
    // template lays the page out, which places none of these regions.
    return (
      <div className={cn('space-y-6', className)} data-page-layout={pageType}>
        {template ? (
          <UnplacedRegionsRefusal regions={unplaced} template={template} />
        ) : (
          regions.map((region, idx) => (
            <RegionContent key={region.name || idx} region={region} />
          ))
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} data-page-layout={pageType}>
      <RunningRegions
        header={header && (
          <RegionContent
            region={header}
            className={cn(getRegionWidthClass(header.width as string))}
          />
        )}
        footer={footer && (
          <RegionContent
            region={footer}
            className={cn(getRegionWidthClass(footer.width as string))}
          />
        )}
      >
        {/* Body: sidebar + main + aside */}
        <div className="flex flex-col md:flex-row flex-1 gap-6">
          {sidebar && (
            <aside className={cn('md:shrink-0', getSidebarWidthClass(sidebar.width as string || 'small'))}>
              <RegionContent region={sidebar} rail />
            </aside>
          )}

          <div className="flex-1 min-w-0 space-y-6">
            {main && <RegionContent region={main} />}
            {extras.map((region, idx) => (
              <RegionContent key={region.name || `extra-${idx}`} region={region} />
            ))}
            {template && <UnplacedRegionsRefusal regions={unplaced} template={template} />}
          </div>

          {aside && (
            <aside className={cn('md:shrink-0', getSidebarWidthClass(aside.width as string || 'small'), aside.className)}>
              <RegionContent region={aside} rail />
            </aside>
          )}
        </div>
      </RunningRegions>
    </div>
  );
};

// ---------------------------------------------------------------------------
// FlatContent — the `children` fallback when a page declares no regions
// ---------------------------------------------------------------------------

const FlatContent: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => {
  const content = schema.children;
  const nodes: SchemaNode[] = Array.isArray(content)
    ? content
    : content
      ? [content]
      : [];

  if (nodes.length === 0) return null;

  return (
    <div className="space-y-6">
      {nodes.map((node: any, index: number) => (
        <SchemaRenderer key={node?.id || index} schema={node} />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Template layouts — predefined layout templates
// ---------------------------------------------------------------------------

/** Template: default — header and footer spanning, sidebar + main + aside between */
const DefaultTemplate: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => {
  if (schema.regions && schema.regions.length > 0) {
    return <RegionLayout regions={schema.regions} pageType={schema.pageType} template="default" />;
  }
  return <FlatContent schema={schema} />;
};

/** Template: header-sidebar-main — header spanning full width, sidebar + main below */
const HeaderSidebarMainTemplate: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => {
  const regions = schema.regions || [];
  if (regions.length === 0) return <FlatContent schema={schema} />;

  const header = findRegion(regions, 'header');
  const sidebar = findRegion(regions, 'sidebar');
  const main = findRegion(regions, 'main');
  const unplaced = getRemainingRegions(regions, PAGE_TEMPLATE_SLOTS['header-sidebar-main']);

  return (
    <div className="flex flex-col gap-6" data-template="header-sidebar-main">
      <RunningRegions header={header && <RegionContent region={header} />}>
        <div className="flex flex-col md:flex-row flex-1 gap-6">
          {sidebar && (
            <aside className={cn('md:shrink-0', getSidebarWidthClass(sidebar.width as string || 'medium'))}>
              <RegionContent region={sidebar} rail />
            </aside>
          )}
          <div className="flex-1 min-w-0 space-y-6">
            {main && <RegionContent region={main} />}
            <UnplacedRegionsRefusal regions={unplaced} template="header-sidebar-main" />
          </div>
        </div>
      </RunningRegions>
    </div>
  );
};

/** Template: three-column — sidebar + main + aside */
const ThreeColumnTemplate: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => {
  const regions = schema.regions || [];
  if (regions.length === 0) return <FlatContent schema={schema} />;

  const header = findRegion(regions, 'header');
  const sidebar = findRegion(regions, 'sidebar');
  const main = findRegion(regions, 'main');
  const aside = findRegion(regions, 'aside');
  const footer = findRegion(regions, 'footer');
  const unplaced = getRemainingRegions(regions, PAGE_TEMPLATE_SLOTS['three-column']);

  return (
    <div className="flex flex-col gap-6" data-template="three-column">
      <RunningRegions
        header={header && <RegionContent region={header} />}
        footer={footer && <RegionContent region={footer} />}
      >
        <div className="flex flex-col md:flex-row flex-1 gap-6">
          {sidebar && (
            <aside className={cn('md:shrink-0', getSidebarWidthClass(sidebar.width as string || 'small'))}>
              <RegionContent region={sidebar} rail />
            </aside>
          )}
          <div className="flex-1 min-w-0 space-y-6">
            {main && <RegionContent region={main} />}
            <UnplacedRegionsRefusal regions={unplaced} template="three-column" />
          </div>
          {aside && (
            <aside className={cn('md:shrink-0', getSidebarWidthClass(aside.width as string || 'small'), aside.className)}>
              <RegionContent region={aside} rail />
            </aside>
          )}
        </div>
      </RunningRegions>
    </div>
  );
};

/** Template: dashboard — 2x2 grid of regions */
const DashboardTemplate: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => {
  const regions = schema.regions || [];
  if (regions.length === 0) return <FlatContent schema={schema} />;

  const header = findRegion(regions, 'header');
  const footer = findRegion(regions, 'footer');
  // The open grid (`PAGE_TEMPLATE_OPEN_GRID`): every other region is a cell.
  const contentRegions = getRemainingRegions(regions, PAGE_TEMPLATE_SLOTS.dashboard);

  return (
    <div className="flex flex-col gap-6" data-template="dashboard">
      <RunningRegions
        header={header && <RegionContent region={header} />}
        footer={footer && <RegionContent region={footer} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {contentRegions.map((region, idx) => (
            <RegionContent key={region.name || `region-${idx}`} region={region} />
          ))}
        </div>
      </RunningRegions>
    </div>
  );
};

/**
 * Template registry — maps template names to layout components. Keyed by the
 * spec's closed template set (`PAGE_TEMPLATE_SLOTS`), so a template the spec
 * adds or retires fails to compile here. `full-width` retired with spec 18
 * (objectui#12476): it was a second name for `default`, the same component.
 */
const TEMPLATE_REGISTRY: Record<PageTemplate, React.FC<{ schema: PageNodeSchema }>> = {
  'default': DefaultTemplate,
  'header-sidebar-main': HeaderSidebarMainTemplate,
  'three-column': ThreeColumnTemplate,
  'dashboard': DashboardTemplate,
};

/**
 * Resolve template: the layout for the schema's template name; `null` when it
 * names none, and the page takes the `pageType` dispatch. A name the registry
 * does not hold (`full-width`, or any other) resolves to a refusal, not to the
 * `pageType` layout: the spec refuses it at the parse.
 */
function resolveTemplate(schema: PageNodeSchema): React.FC<{ schema: PageNodeSchema }> | null {
  if (!schema.template) return null;
  // Typed as the closed set, but a raw served row can carry any string.
  const template: string = schema.template;
  if (Object.prototype.hasOwnProperty.call(TEMPLATE_REGISTRY, template)) {
    return TEMPLATE_REGISTRY[template as PageTemplate];
  }
  return UnregisteredTemplateRefusal;
}

// ---------------------------------------------------------------------------
// Page type variant layouts
// ---------------------------------------------------------------------------

/**
 * The template a page that names none is laid out under (objectui#12902).
 *
 * The spec's `checkPageRegionPlacement` reads `page.template ?? 'default'` and
 * judges only a `kind: 'full'` page (`kind` itself defaults to `'full'`), so a
 * template-less full page refuses a region `default` does not place, exactly
 * as a `template: 'default'` page does. The `pageType` layouts below draw it
 * the same way: through `UnplacedRegionsRefusal`, never stacked under `main`.
 * A page of another kind is not judged by that check and keeps the stacking.
 */
function templateLessJudgement(schema: PageNodeSchema): SlottedTemplate | undefined {
  return (schema.kind ?? 'full') === 'full' ? 'default' : undefined;
}

/** Record page — detail-oriented, narrower max-width */
const RecordPageLayout: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => {
  if (schema.regions && schema.regions.length > 0) {
    return <RegionLayout regions={schema.regions} pageType="record" template={templateLessJudgement(schema)} />;
  }
  return <FlatContent schema={schema} />;
};

/** Home page — dashboard-style, wider layout */
const HomePageLayout: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => {
  if (schema.regions && schema.regions.length > 0) {
    return <RegionLayout regions={schema.regions} pageType="home" template={templateLessJudgement(schema)} />;
  }
  return <FlatContent schema={schema} />;
};

/** App page — application shell, full-width capable */
const AppPageLayout: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => {
  if (schema.regions && schema.regions.length > 0) {
    return <RegionLayout regions={schema.regions} pageType="app" template={templateLessJudgement(schema)} />;
  }
  return <FlatContent schema={schema} />;
};

/** Utility page — compact, focused, narrower */
const UtilityPageLayout: React.FC<{ schema: PageNodeSchema }> = ({ schema }) => {
  if (schema.regions && schema.regions.length > 0) {
    return <RegionLayout regions={schema.regions} pageType="utility" template={templateLessJudgement(schema)} />;
  }
  return <FlatContent schema={schema} />;
};

// ---------------------------------------------------------------------------
// ADR-0080: a `kind:'html'` page carries a constrained JSX `source`. We compile
// it (parse, never execute) into a SchemaNode tree and render it. The whitelist
// / contract is the live registry. Cached; rebuilt when the registry grows.
let _jsxManifestSig = -1;
let _jsxManifest: ReturnType<typeof manifestFromConfigs> | null = null;
function getJsxManifest() {
  // Key the whitelist by the registry's tag keys (bare AND namespaced) — a
  // config's `.type` is always the namespaced form (Registry stores the bare
  // alias pointing at the namespaced type), so getAllConfigs() alone would
  // never admit the bare `<flex>` tag authors write.
  //
  // KNOWN types, not loaded ones. A lazily-registered block is a real member of
  // this app's vocabulary; leaving it out of the whitelist rejected
  // `<object-kanban>` as "not an allowed component" and — because a compile
  // error fails the WHOLE page, not just that node — took the entire page down
  // with it, load-order dependently (objectui#2953, html tier).
  //
  // A stub has no `inputs` yet, so its props come back as `unknown-prop`
  // WARNINGS rather than errors: the page compiles and renders, and the inner
  // SchemaRenderer triggers the loader and swaps in the real block. Authoring
  // time still gets full prop validation — `sdui.manifest.json` is generated
  // with every plugin eagerly loaded, and asserts as much.
  //
  // A type whose registration declares it DEPRECATED ON THE HTML SURFACE is
  // left out (objectui#10757). The tier refuses such a tag at compile time,
  // which is the answer the published gate gives for the same page (the
  // manifest does not declare it), and `nameHtmlTierReplacement` below turns
  // the refusal into one that says what to author instead. The registration's
  // `deprecated` declaration is the one authority here, so no list of tag
  // names lives in this file.
  const version = ComponentRegistry.getVersion();
  if (_jsxManifest === null || _jsxManifestSig !== version) {
    const configs = ComponentRegistry.getKnownTypes()
      .filter((t) => !ComponentRegistry.deprecationFor(t, 'html'))
      .map((t) => {
        const meta = ComponentRegistry.getMeta(t);
        return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
      });
    // `slotsFor` (objectui#11170): each entry carries the node slots its
    // renderer reads besides `children`, from the one declaration in
    // `@object-ui/types`, so the tier judges a node authored under a dialog's
    // `content` or a tab item's `content` exactly as one under `children`.
    _jsxManifest = manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0], {
      slotsFor: nodeSlotsFor,
    });
    _jsxManifestSig = version;
  }
  return _jsxManifest;
}

/**
 * A `forbidden-tag` refusal for a tag its registration declares deprecated on
 * the html surface, extended to say so and to name what to author instead
 * (objectui#10757). The replacement is the declaration's own `replacement`
 * line, not a second copy of the guidance. The parser's sentence stays first,
 * so the refusal reads the same as the one the published gate gives. Any other
 * diagnostic passes through untouched.
 */
function nameHtmlTierReplacement(d: Diagnostic): Diagnostic {
  if (d.code !== 'forbidden-tag' || !d.tag) return d;
  const deprecation = ComponentRegistry.deprecationFor(d.tag, 'html');
  if (!deprecation) return d;
  const why = `${d.message}: it is deprecated on kind:'html' pages`;
  return { ...d, message: deprecation.replacement ? `${why}. Instead, ${deprecation.replacement}` : why };
}

// Main PageRenderer
// ---------------------------------------------------------------------------

export const PageRenderer: React.FC<{
  schema: PageNodeSchema;
  className?: string;
  [key: string]: any;
}> = ({ schema, className, ...props }) => {
  const pageType = schema.pageType || 'record';
  // A `kind:'html'` page compiles its source against the registry, and a
  // compile error fails the whole page. Without this the failure is permanent
  // for the session: `layoutElement` is memoised, so a page that compiled
  // before the block it needs was registered kept rendering the cached error
  // panel even after the plugin landed. Mirrors SchemaRenderer's subscription.
  const [registryTick, bumpRegistryTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => ComponentRegistry.subscribe(bumpRegistryTick), []);
  // Spec PageSchema declares `label` (required); `title` is the objectui
  // spelling. Dual-read so a spec-authored page still renders its header
  // (framework#1878 §3 naming-drift recheck).
  const pageTitle = schema.title ?? (schema as any).label;

  // What may become an attribute on the wrapper <div>, and nothing else.
  //
  // This used to be a hand-maintained destructure list of every PageSchema
  // descriptor, plus a `_`-prefix filter as a safety net, with the standing
  // instruction to "keep this list aligned with PageSchema". Keeping it
  // aligned is the part that failed: an authored key the list did not name was
  // not dropped, it was SPREAD — and React forwards an unknown lowercase
  // attribute in complete silence, stringifying object values. An authored
  // `actions: [{…}, {…}]` reached the DOM as `actions="[object Object],[object
  // Object]"` (objectui#7933), neither read by this renderer nor dropped.
  //
  // A deny-list bounded by enumeration cannot be finished, because the set of
  // keys an author may put on a node is unbounded; a whitelist bounded by
  // declaration can. That is the objectui#4425 ruling, and `toDomProps` is the
  // one mechanism it promoted to `@object-ui/core` for exactly this — the same
  // executor every converged SDUI widget already calls. This renderer was one
  // of the last faces still closing the leak with an enumeration of its own.
  //
  // `style` stays forwarded BY NAME: it is a deliberate DOM pass-through that
  // is not on the element-agnostic whitelist, which is how every other call
  // site handles it (objectui#4435 — declare it and forward it, never reopen
  // the spread). `data-obj-id` / `data-obj-type` are read by name here and
  // also ride the open `data-*` family, so they arrive either way.
  const {
    'data-obj-id': dataObjId,
    'data-obj-type': dataObjType,
    style,
  } = props;
  const pageProps = toDomProps(props);

  // The page's own `aria` bag (objectui#11083). The spec's `PageSchema`
  // declares it as `AriaPropsSchema`, and `PageNodeSchema` mirrors it, so it is
  // the NESTED vocabulary: `ariaLabel` is a plain string or an inline locale
  // map. `toDomProps` above drops the `aria` prop, because it is an object and
  // not a DOM attribute, so a declared accessible name used to reach no element.
  // It is read through `resolveInlineAriaProps`, the one reader of that bag, and
  // this renderer keeps no mapping of its own. The page supplies no default role.
  // It is spread AFTER `pageProps`, so when a flat key and the nested bag name
  // the same attribute, the page's own declared slot wins.
  const locale = useDisplayLocale();
  const pageAria = resolveInlineAriaProps(schema.aria, locale);

  // A page that declares `print` is a print page (objectui#11958, card ② of
  // the objectstack#8346 ruling). It renders on screen exactly as any other
  // page: the declaration only adds a print stylesheet (`./page-print.ts`),
  // scoped to the root below by `PRINT_PAGE_ATTRIBUTE`, and publishes itself
  // to the page's blocks through `PrintPageProvider`, so a block that draws a
  // window of its data on screen can stop doing so in silence on paper.
  const print = isPagePrintDeclaration(schema.print) ? schema.print : null;
  const printStylesheet = print ? buildPagePrintStylesheet(print) : null;

  // The element the regions are laid out in, whose width each region's
  // posture is judged against (objectui#12703): the max-width body, not the
  // padded outer wrapper, so a centred body on a very wide screen is "the
  // page" and its `main` is not mistaken for a narrow column.
  const pageBodyRef = React.useRef<HTMLDivElement>(null);
  const pageWidthStore = usePageWidthStore(pageBodyRef);

  // Select the layout variant based on template or page type
  const layoutElement = useMemo(() => {
    // `PageNodeSchema['kind']` is the spec's own page-kind vocabulary, so this
    // reads the authoring type: no cast, no widening. @objectstack/spec 18
    // retired the tier's first name, `jsx` (objectui#12486): the spec refuses
    // it at parse, a stored `jsx` row is rehydrated to `html` before it is
    // served, and `COMPILED_PAGE_KINDS` is `html` alone. So nothing here reads
    // `jsx`; a raw node that still carries it is a kind this renderer does not
    // name, and takes the template / page-type path below like any other.
    const kind = schema.kind;
    // `kind:'react'` — TRUSTED execution tier: real React, run (not parsed) by
    // @object-ui/react-runtime, gated behind the host CAP_REACT_PAGES flag.
    if (kind === 'react') {
      return <ReactKindPage schema={schema} />;
    }
    // `kind:'html'` — author-written constrained JSX compiled (parsed, never
    // executed) to a SchemaNode tree and rendered.
    // Styling on this tier is the blocks' own structured props
    // (`<flex direction gap>`, `<grid columns>`) plus a JSON `style` object —
    // NOT Tailwind utility classes. `source` is runtime metadata, so the build's
    // Tailwind scan never sees it and an authored class produces no CSS and no
    // error anywhere; `os validate` reports `page-source-className-tailwind`.
    // (ADR-0065; ADR-0080's 2026-06-30 amendment.)
    if (kind === 'html') {
      const src = (schema as { source?: string }).source ?? '';
      const { tree, diagnostics } = compile(src, getJsxManifest());
      const errors = diagnostics
        .filter((d) => d.severity === 'error')
        .map(nameHtmlTierReplacement);
      if (errors.length) {
        return (
          <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="font-semibold">HTML page failed to compile ({errors.length})</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {errors.slice(0, 8).map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          </div>
        );
      }
      if (!tree) return null;
      /**
       * ⭐ THE ONE BOUNDARY CAST (objectui#11466). `tree` is author source
       * parsed at runtime (`@object-ui/sdui-parser`'s `SchemaElement`: a
       * `type: string` plus unknown props), so the compiler cannot know which
       * declared node type each element is. Its validator is what judges it:
       * `compile` runs `validateTree` against the registry manifest (an
       * unknown component, an unknown or missing prop, a wrong coarse type, an
       * illegal enum value), and this line is reached only when that reported
       * no error (the `errors` early return above). So the tree crosses into
       * `DeclaredNode` here, once, on that validator's word, which is shallower
       * than the declarations. ⛔ No second cast of this kind: a node built in
       * code names its declared type instead.
       */
      const validatedTree = tree as unknown as DeclaredNode;
      return <SchemaRenderer schema={validatedTree} />;
    }
    const TemplateLayout = resolveTemplate(schema);
    if (TemplateLayout) {
      // Template takes priority over page type
      // eslint-disable-next-line react-hooks/static-components -- TemplateLayout is resolved from a stable template registry
      return <TemplateLayout schema={schema} />;
    }
    switch (pageType) {
      case 'home':
        return <HomePageLayout schema={schema} />;
      case 'app':
        return <AppPageLayout schema={schema} />;
      case 'utility':
        return <UtilityPageLayout schema={schema} />;
      case 'record':
      default:
        return <RecordPageLayout schema={schema} />;
    }
    // `registryTick` only matters to the kind:'html' branch above, which
    // recompiles against the (now larger) whitelist. Every other branch just
    // rebuilds the same element type with the same props, which React
    // reconciles in place — no remount, no state loss (pinned by
    // react-page-state.test.tsx).
  }, [schema, pageType, registryTick]);

  // Full-bleed: a page whose `main` region is declared `width: 'full'` fills
  // the viewport with NO centered max-width cap — for dashboards / 大屏 /
  // kiosk screens that should use the whole width. Falls back to the
  // page-type max-width otherwise.
  const fullBleed = (schema.regions ?? []).some(
    (r) => r.name?.toLowerCase() === 'main' && (r.width as string) === 'full',
  );
  const maxWidthClass = fullBleed ? 'max-w-none' : getPageMaxWidth(pageType);

  // Who renders the page's single `<h1>` (objectui#3434). Record pages always
  // delegate to `page:header`; every other page type delegates too as soon as
  // the author put a titled `page:header` in a region.
  const headerOwnsTitle = React.useMemo(
    () => pageType === 'record' || pageHeaderOwnsTitle(schema),
    [schema, pageType],
  );
  const showPageTitle = !!pageTitle && !headerOwnsTitle;
  // The description is the page's own prose, not a duplicate of the header's
  // `subtitle`, so delegating the heading does not delete it.
  const showPageDescription = !!schema.description && pageType !== 'record';
  // When the header owns the title, it draws the description too, under the
  // title (objectui#12624). Drawn here it sat above the regions, so above the
  // title the header draws inside them.
  const headerDrawsDescription = showPageDescription && headerOwnsTitle;
  const drawDescriptionHere = showPageDescription && !headerDrawsDescription;

  const pageContent = (
    <div
      className={cn(
        'min-h-full w-full bg-background p-3 md:p-4 lg:p-6',
        className,
      )}
      data-page-type={pageType}
      data-obj-id={dataObjId}
      data-obj-type={dataObjType}
      style={style}
      {...pageProps}
      {...pageAria}
      {...(print ? { [PRINT_PAGE_ATTRIBUTE]: '' } : {})}
    >
      {printStylesheet && (
        <style data-print-stylesheet="" dangerouslySetInnerHTML={{ __html: printStylesheet }} />
      )}
      <div ref={pageBodyRef} className={cn(fullBleed ? 'space-y-6' : 'mx-auto space-y-6', maxWidthClass)}>
        {/* Implicit page title — the fallback heading for a page that does NOT
            author its own `page:header`. Suppressed whenever that component
            owns the h1 (always on record pages, and on any page carrying a
            titled `page:header`), so the document never has two `h1`.
            `title` is the objectui spelling; the spec's PageNodeSchema declares
            `label` (required), so dual-read it — mirrors the fallback
            DashboardRenderer already uses (framework#1878 §3 recheck). */}
        {(showPageTitle || drawDescriptionHere) && (
          <div className="space-y-2">
            {showPageTitle && (
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                {pageTitle}
              </h1>
            )}
            {drawDescriptionHere && (
              <p className="text-muted-foreground">{schema.description}</p>
            )}
          </div>
        )}

        {/* Page body — type-specific layout */}
        <PageDescriptionContext.Provider value={headerDrawsDescription ? schema.description : null}>
          <PageWidthProvider store={pageWidthStore}>{layoutElement}</PageWidthProvider>
        </PageDescriptionContext.Provider>
      </div>
    </div>
  );

  const content = print ? <PrintPageProvider value={print}>{pageContent}</PrintPageProvider> : pageContent;

  // Wrap with PageVariablesProvider when variables are defined
  if (schema.variables && schema.variables.length > 0) {
    return (
      <PageVariablesProvider definitions={schema.variables}>
        {/* Publish the live page-variable snapshot into the action runtime so a
            submit button can post `{{page.<var>}}` values (SDUI form data-entry). */}
        <PageVariableActionBridge />
        {content}
      </PageVariablesProvider>
    );
  }

  return content;
};

// ---------------------------------------------------------------------------
// ComponentRegistry registration
// ---------------------------------------------------------------------------

const pageMeta: any = {
  namespace: 'ui',
  label: 'Page',
  icon: 'panels-top-left',
  category: 'layout',
  inputs: [
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'pageType', type: 'string' },
    { name: 'object', type: 'string' },
    { name: 'template', type: 'string' },
    {
      name: 'regions',
      type: 'array',
      itemType: 'object',
    },
    {
      name: 'variables',
      type: 'array',
      itemType: 'object',
    },
    {
      // The flat content list `FlatContent` renders when a page declares no
      // regions. Published as `body` until objectui#6771 retired that
      // spelling; `pageMeta` backs five registrations, so this one line is
      // the authoring face of `page` / `app` / `utility` / `home` / `record`.
      name: 'children',
      type: 'array',
      itemType: 'component',
    },
  ],
};

/**
 * ⭐ THESE KEYS ARE PAGE KINDS, NOT A COMPONENT FAMILY — read this before
 * auditing them (objectui#9642).
 *
 * A stored page document's `type` field is the spec's page KIND, enumerated by
 * `PageTypeSchema` in `@objectstack/spec/ui`. `PageView` (`@object-ui/app-shell`)
 * hands that document to `SchemaRenderer` with the kind written VERBATIM into
 * `type` — the SchemaNode discriminator `ComponentRegistry` dispatches on —
 * plus a copy on `pageType`. ⇒ The registrations below exist BECAUSE of that
 * line. They are the renderer half of `PageTypeSchema`, which is why they carry
 * "… Page" labels rather than component names, and `'page'` is the fallback the
 * same mapping writes for a document carrying no `type` at all.
 *
 * ⛔ **They are therefore NOT the "registered but never declared" defect** this
 * repository files elsewhere. They ARE declared — upstream, in a different
 * vocabulary, by an enum this package cannot edit. `@object-ui/types`'
 * `SchemaRegistry` map has no key for them on purpose, because `keyof` that map
 * is the published `ComponentType` union and widening it is a ruling; that map
 * carries the other half of this note at its `'page'` entry.
 *
 * ⚠️ Removing one of these registrations stops every stored page of that kind
 * rendering — OBJUI-001 in place of the page. objectui#9263 reached a draft PR
 * doing exactly that and was re-ruled letter E, "⛔ not a defect"; objectui#9576
 * proposed the same for the remaining kinds.
 *
 * ⭐ **`app` is one token carrying two vocabularies.** `AppComponentSchema`
 * (`@object-ui/types`) declares the type literal `'app'` for the APP-LEVEL
 * DOCUMENT (`app.json`: tabs, navigation, areas), which the runner / layout path
 * reads STRUCTURALLY and never resolves through this registry. The key below
 * answers only for the spec PAGE KIND `app` — a stored page document with
 * regions, reached through `PageView`'s passthrough. ⛔ Neither is a collision
 * to be resolved by removing the other.
 *
 * ⚠️ Not every page kind appears below, and the absence is not an omission: an
 * INTERFACE-MODE kind is short-circuited before this registry, because `PageView`
 * branches on `interfaceConfig?.source` and renders `InterfaceListPage`
 * directly. The live split — which kind is served here, which is short-circuited
 * — is re-derived by `page-kind-node-type-channel-9642` in this package's
 * `__tests__`, ⛔ not by this comment.
 */
ComponentRegistry.register('page', PageRenderer, pageMeta);
ComponentRegistry.register('app', PageRenderer, { ...pageMeta, label: 'App Page' });
ComponentRegistry.register('utility', PageRenderer, { ...pageMeta, label: 'Utility Page' });
ComponentRegistry.register('home', PageRenderer, { ...pageMeta, label: 'Home Page' });
ComponentRegistry.register('record', PageRenderer, { ...pageMeta, label: 'Record Page' });

