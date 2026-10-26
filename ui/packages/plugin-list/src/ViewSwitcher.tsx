/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Popover, PopoverContent, PopoverTrigger } from '@object-ui/components';
import { createSafeTranslation } from '@object-ui/i18n';
import type { ListViewVisualization } from '@object-ui/core';
import {
  Grid3x3,
  LayoutGrid,
  Calendar,
  Images,    // gallery
  Activity,  // timeline
  ChartGantt, // gantt
  Map,        // map
  ChartColumn,  // chart
  ListTree,   // tree
  Check,
  ChevronDown,
} from 'lucide-react';

/**
 * The visualizations this switcher offers are `@object-ui/core`'s
 * {@link ListViewVisualization} (`ca3942729`), which derives from
 * `@objectstack/spec/ui` through `@object-ui/types`' `ViewType`.
 *
 * A nine-arm union was once written out by hand here, and that was a THIRD
 * re-declaration of one vocabulary — the card behind `ca3942729` was filed against the two in
 * `@object-ui/types`, and the maps below were described there as total over the
 * shared union when they were in fact total over this private copy. A map that
 * is total over a copy is exactly as incomplete as the copy, so the two
 * `Record<ListViewVisualization, …>` below are honest guards only because they
 * key on the derived union: the next visualization the spec adds fails the
 * build in both of them.
 *
 * Spelled by that name, not re-exported as `ViewType`. This module used to
 * publish an alias `ViewType = ListViewVisualization`, a second meaning behind
 * the name `@object-ui/types` gives the whole view-type vocabulary — the alias
 * lacked its `list` and `detail` arms (objectui#6349, batch 7). `page` is
 * deliberately NOT a visualization: the spec models it as a list view that
 * mounts a published page rather than one a user switches into, and
 * `AppearanceConfig.allowedVisualizations` excludes it for the same reason.
 *
 * The props are named `ListViewSwitcherProps`, not `ViewSwitcherProps`, for the
 * same reason. `@object-ui/plugin-view` publishes `ViewSwitcherProps` for a
 * different switcher: the `view-switcher` renderer, which takes a
 * `ViewSwitcherSchema` and the host callbacks and is keyed on the whole
 * `ViewType`. Neither package depends on the other, so the two could not share
 * one declaration. The general name stays with the schema-driven renderer, and
 * this list view's switcher has the specific one (objectui#6349, batch 8).
 */
export interface ListViewSwitcherProps {
  currentView: ListViewVisualization;
  availableViews?: ListViewVisualization[];
  onViewChange: (view: ListViewVisualization) => void;
  className?: string;
  /** Enable animated transitions between views (default: true) */
  animated?: boolean;
}

// objectui#5622 — every identifier here is a name lucide still carries in its
// runtime `icons` record, deliberately NOT one of the deprecated ALIASES it
// keeps only as a named export. These are imported COMPONENTS, so a retired
// alias goes on rendering and nothing goes red: `Grid`, `GanttChartSquare` and
// `BarChart3` all imported, all type-checked, and all three were absent from
// `icons` on the installed lucide. The reason to move them anyway is that a
// spelling that is dead for the LOOKUP must not get to look alive in a map and
// be copied into a string map next to it — which is exactly how `bar-chart-3`
// reached `plugin-view`'s producer map (objectui#5586, same three aliases in
// the sibling switcher's `DEFAULT_VIEW_ICONS`). Judged by the repo-level gate
// `scripts/check-lucide-icon-record-names.mjs` (objectui#5633), which replaced
// this package's local pin with one predicate over every such map.
//
// `gantt` is the one real glyph change of the three: `GanttChartSquare` and
// `ChartGantt` are DIFFERENT objects (the identity-preserving live spelling is
// `SquareChartGantt`). `ChartGantt` is chosen over it so the two switchers draw
// the same glyph for the same visualization — #5586 landed `ChartGantt` for
// `gantt` in `plugin-view`, and one view type showing two different icons
// depending on which switcher is on screen is the drift worth avoiding.
const VIEW_ICONS: Record<ListViewVisualization, React.ReactNode> = {
  grid: <Grid3x3 className="h-4 w-4" />,
  kanban: <LayoutGrid className="h-4 w-4" />,
  gallery: <Images className="h-4 w-4" />,
  calendar: <Calendar className="h-4 w-4" />,
  timeline: <Activity className="h-4 w-4" />,
  gantt: <ChartGantt className="h-4 w-4" />,
  map: <Map className="h-4 w-4" />,
  chart: <ChartColumn className="h-4 w-4" />,
  tree: <ListTree className="h-4 w-4" />,
};

/**
 * Bundle key per visualization — objectui#4024.
 *
 * These are NOT new keys. `console.objectView.viewType*` already exists in all
 * ten packs and already carries exactly these words: the create-view picker
 * (`packages/app-shell/src/views/CreateViewDialog.tsx:88-96`) has resolved them
 * through the bundle for months. This switcher naming the same nine
 * visualizations with a private English copy was the drift, and reusing the
 * pack's key is what keeps the picker's 「画廊」 and the switcher's 「画廊」 the
 * same word in nine languages instead of two tables free to diverge.
 *
 * A plugin package reading a `console.*` key has precedent in this repo, in
 * this very namespace: `packages/plugin-view/src/ObjectView.tsx:83` resolves
 * `console.objectView.new`.
 */
const VIEW_LABEL_KEYS: Record<ListViewVisualization, string> = {
  grid: 'console.objectView.viewTypeGrid',
  kanban: 'console.objectView.viewTypeKanban',
  gallery: 'console.objectView.viewTypeGallery',
  calendar: 'console.objectView.viewTypeCalendar',
  timeline: 'console.objectView.viewTypeTimeline',
  gantt: 'console.objectView.viewTypeGantt',
  map: 'console.objectView.viewTypeMap',
  chart: 'console.objectView.viewTypeChart',
  tree: 'console.objectView.viewTypeTree',
};

/**
 * English fallbacks, used when no `I18nProvider` is mounted.
 *
 * `createSafeTranslation` rather than a bare `useObjectTranslation`: a large
 * amount of existing coverage addresses these controls by their English name
 * with no provider (`__tests__/ListView.test.tsx` among them), and a raw
 * `console.objectView.viewTypeGrid` there would break all of it. This is the
 * #4514 provider-less trap, and the table below is the pack value's stand-in on
 * that path — the same shape `ObjectGrid` and `ListView` already use.
 */
const VIEW_LABEL_DEFAULTS: Record<string, string> = {
  'console.objectView.viewTypeGrid': 'Grid',
  'console.objectView.viewTypeKanban': 'Kanban',
  'console.objectView.viewTypeGallery': 'Gallery',
  'console.objectView.viewTypeCalendar': 'Calendar',
  'console.objectView.viewTypeTimeline': 'Timeline',
  'console.objectView.viewTypeGantt': 'Gantt',
  'console.objectView.viewTypeMap': 'Map',
  'console.objectView.viewTypeChart': 'Chart',
  'console.objectView.viewTypeTree': 'Tree',
};

const useViewSwitcherTranslation = createSafeTranslation(
  VIEW_LABEL_DEFAULTS,
  'console.objectView.viewTypeGrid',
);

/**
 * Resolve every visualization's label once per render.
 *
 * Returns a total `Record<ListViewVisualization, string>` so the three call sites per button
 * (visible span, `aria-label`, `title`) stay a plain map lookup and cannot
 * drift apart — and so a visualization added to the union is a compile error
 * naming the missing key rather than a button labelled `undefined`.
 */
function useViewLabels(): Record<ListViewVisualization, string> {
  const { t } = useViewSwitcherTranslation();
  return React.useMemo(() => {
    const out = {} as Record<ListViewVisualization, string>;
    for (const [view, key] of Object.entries(VIEW_LABEL_KEYS) as [ListViewVisualization, string][]) {
      out[view] = t(key);
    }
    return out;
  }, [t]);
}

/**
 * Compact dropdown form of the visualization switcher (Airtable-style):
 * a single "List ▾" button in the toolbar's right cluster that opens a
 * menu of the available visualizations. Replaces the full button row so
 * the toolbar stays one line tall.
 */
export const ViewSwitcherDropdown: React.FC<ListViewSwitcherProps> = ({
  currentView,
  availableViews = ['grid', 'kanban'],
  onViewChange,
  className,
  animated = true,
}) => {
  const [open, setOpen] = React.useState(false);
  const VIEW_LABELS = useViewLabels();

  const handleViewChange = React.useCallback(
    (view: ListViewVisualization) => {
      setOpen(false);
      if (view === currentView) return;
      if (animated && typeof document !== 'undefined' && 'startViewTransition' in document) {
        (document as Document & {
          startViewTransition: (cb: () => void) => { finished: Promise<void> };
        }).startViewTransition(() => onViewChange(view));
      } else {
        onViewChange(view);
      }
    },
    [animated, currentView, onViewChange],
  );

  // Few visualizations (2–4): render an iOS/Linear-style segmented control
  // inline — a unified rounded track where the active segment lifts onto a
  // white thumb. Clearer and more tactile than a dropdown for a short set.
  // Many (5+) fall through to the compact dropdown below to keep the toolbar
  // one line.
  if (availableViews.length >= 2 && availableViews.length <= 4) {
    return (
      <div
        role="tablist"
        data-testid="view-switcher-segmented"
        className={cn(
          'inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5 oui-view-switcher',
          className,
        )}
      >
        {availableViews.map((view) => {
          const active = view === currentView;
          return (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={VIEW_LABELS[view]}
              title={VIEW_LABELS[view]}
              data-state={active ? 'on' : 'off'}
              onClick={() => handleViewChange(view)}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] text-xs font-medium transition-all duration-150',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {VIEW_ICONS[view]}
              <span className="hidden sm:inline-block">{VIEW_LABELS[view]}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="view-switcher-dropdown"
          aria-label={VIEW_LABELS[currentView]}
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium transition-colors oui-view-switcher',
            open ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground',
            className,
          )}
        >
          {VIEW_ICONS[currentView]}
          <span className="hidden sm:inline-block">{VIEW_LABELS[currentView]}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        {availableViews.map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => handleViewChange(view)}
            data-state={view === currentView ? 'on' : 'off'}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-muted',
              view === currentView ? 'text-foreground font-medium' : 'text-muted-foreground',
            )}
          >
            {VIEW_ICONS[view]}
            <span className="flex-1 text-left">{VIEW_LABELS[view]}</span>
            {view === currentView && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

export const ViewSwitcher: React.FC<ListViewSwitcherProps> = ({
  currentView,
  availableViews = ['grid', 'kanban'],
  onViewChange,
  className,
  animated = true,
}) => {
  const VIEW_LABELS = useViewLabels();

  const handleViewChange = React.useCallback(
    (view: ListViewVisualization) => {
      if (!animated || view === currentView) {
        onViewChange(view);
        return;
      }

      if (typeof document !== 'undefined' && 'startViewTransition' in document) {
        (document as Document & {
          startViewTransition: (cb: () => void) => { finished: Promise<void> };
        }).startViewTransition(() => onViewChange(view));
      } else {
        onViewChange(view);
      }
    },
    [animated, currentView, onViewChange],
  );

  return (
    <div className={cn("flex items-center gap-1 bg-transparent oui-view-switcher", className)}>
      {availableViews.map((view) => {
        const isActive = currentView === view;
        return (
          <button
            key={view}
            type="button"
            onClick={() => handleViewChange(view)}
            aria-label={VIEW_LABELS[view]}
            title={VIEW_LABELS[view]}
            aria-pressed={isActive}
            data-state={isActive ? 'on' : 'off'}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
              "hover:bg-muted hover:text-muted-foreground",
              "gap-2 px-3 py-2",
              "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm border-transparent border data-[state=on]:border-border/50",
            )}
          >
            {VIEW_ICONS[view]}
            <span className="hidden sm:inline-block text-xs font-medium">
              {VIEW_LABELS[view]}
            </span>
          </button>
        );
      })}
    </div>
  );
};
