/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  cn,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  resolveIcon,
} from '@object-ui/components';
import { cva } from 'class-variance-authority';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import type { ViewSwitcherSchema, ViewType } from '@object-ui/types';
import { notifyViewHandlerChannels } from './viewHandlerChannels';
import {
  Activity,
  Calendar,
  ChartColumn,
  ChartGantt,
  FileText,
  Grid3x3,
  Images,
  LayoutGrid,
  List,
  Map,
  ListTree,
  LayoutTemplate,
  Plus,
  Share2,
  Settings,
  Copy,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

type ViewSwitcherItem = ViewSwitcherSchema['views'][number];

export type ViewSwitcherProps = {
  schema: ViewSwitcherSchema;
  className?: string;
  onViewChange?: (view: ViewType) => void;
  onCreateView?: () => void;
  onViewAction?: (action: string, view: ViewType) => void;
  createViewLabel?: string;
  [key: string]: any;
};

/**
 * Totality assert for a table keyed on the WHOLE {@link ViewType}
 * (objectui#9943). `Exclude<…>` is `never` only while every member of the union
 * has a row; a member the spec ADDS makes it a live union and this alias stops
 * compiling (TS2344, measured).
 *
 * ⛔ NOT the annotation `Record<ViewType, X>` the three tables in this package
 * carried until objectui#9943, and the difference is the whole point. An
 * annotated object literal is EXACT IN BOTH DIRECTIONS: it catches the added
 * member (wanted), and it also makes a RETIRED member an excess property —
 * TS2353 — whose only repair is deleting the row. objectstack#17063 retired the
 * list-view kind `page`, so on a spec built from objectstack `main` all three
 * tables here went red, while the `@objectstack/spec` this repository RESOLVES
 * still publishes `page` and an author can still write one. `satisfies
 * Record<string, X>` keeps the value constraint, drops the exactness, and lets
 * one spelling compile against both specs; this alias puts the added-member
 * half back, because `satisfies Record<string, X>` alone would silently drop
 * the guard objectui#5321 and `ca3942729` installed.
 *
 * ⛔ NOT objectui#9880's repair either. That one derives the undrawable half of
 * a PARTITION with `Extract<ViewType, keyof typeof TABLE>`, so a retired row
 * goes inert of its own accord. These tables partition nothing — they are total
 * over the whole union — so there is no second half to derive from and the
 * exhaustiveness has to be asserted separately.
 *
 * Both directions are pinned in
 * `__tests__/ViewSwitcher.viewTypeTotalsBothLegs-9943.test.ts`.
 */
type _AssertNever<T extends never> = T;

// `page` (`ca3942729`): this switcher is keyed on the FULL `ViewType`, not on
// the visualization subset, because `schema.views` may name any view type the
// spec allows — and `@objectstack/spec@17.3.0` added `page`. Unlike the
// visualization switcher in `plugin-list`, a missing entry here is a label
// gap on a view that legitimately exists, so the map carries it.
const DEFAULT_VIEW_LABELS = {
  list: 'List',
  detail: 'Detail',
  grid: 'Grid',
  kanban: 'Kanban',
  calendar: 'Calendar',
  timeline: 'Timeline',
  map: 'Map',
  gallery: 'Gallery',
  gantt: 'Gantt',
  chart: 'Chart',
  tree: 'Tree',
  page: 'Page',
} satisfies Record<string, string>;

/** Every {@link ViewType} has a label — see {@link _AssertNever}. */
type _UncoveredViewLabel = _AssertNever<Exclude<ViewType, keyof typeof DEFAULT_VIEW_LABELS>>;

// objectui#5586 — every value here is a name lucide still carries in its
// runtime `icons` record, deliberately NOT one of the deprecated ALIASES it
// keeps only as a named export. The compiler cannot tell the two apart:
// `BarChart3`, `GanttChartSquare` and `Grid` all import and all render, and all
// three were absent from `icons` on lucide-react 1.31.0. That distinction is
// load-bearing here because the sibling producer — `ObjectView`'s `iconMap` —
// supplies the SAME glyphs as STRINGS, which `resolveIcon` below looks up in
// exactly that record: there a deprecated spelling resolves to nothing and the
// view renders with no icon at all. Keeping this map on record-live names keeps
// the two halves comparable and keeps a dead spelling from being copied back
// into the string map. This map's membership is judged by the repo-level gate
// `scripts/check-lucide-icon-record-names.mjs` (objectui#5633); the string map
// beside it is judged there too and rendered in `ViewSwitcher.test.tsx`.
const DEFAULT_VIEW_ICONS = {
  list: List,
  detail: FileText,
  grid: Grid3x3,
  kanban: LayoutGrid,
  calendar: Calendar,
  timeline: Activity,
  map: Map,
  gallery: Images,
  gantt: ChartGantt,
  chart: ChartColumn,
  tree: ListTree,
  page: LayoutTemplate,
} satisfies Record<string, LucideIcon>;

/** Every {@link ViewType} has an icon — see {@link _AssertNever}. */
type _UncoveredViewIcon = _AssertNever<Exclude<ViewType, keyof typeof DEFAULT_VIEW_ICONS>>;

const viewSwitcherLayout = cva('flex gap-4', {
  variants: {
    position: {
      top: 'flex-col',
      bottom: 'flex-col-reverse',
      left: 'flex-row',
      right: 'flex-row-reverse',
    },
  },
  defaultVariants: {
    position: 'top',
  },
});

const viewSwitcherWidth = cva('w-full', {
  variants: {
    orientation: {
      horizontal: 'w-full',
      vertical: 'w-48',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
});

const viewSwitcherList = cva('flex gap-2', {
  variants: {
    orientation: {
      horizontal: 'flex-row flex-wrap',
      vertical: 'flex-col',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
});

const viewSwitcherTabsList = cva('', {
  variants: {
    orientation: {
      horizontal: '',
      vertical: 'flex h-auto flex-col items-stretch',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
});

function getViewLabel(view: ViewSwitcherItem): string {
  if (view.label) return view.label;
  return DEFAULT_VIEW_LABELS[view.type] || view.type;
}

function getViewIcon(view: ViewSwitcherItem): LucideIcon | null {
  if (view.icon) {
    return resolveIcon(view.icon);
  }
  return DEFAULT_VIEW_ICONS[view.type] || null;
}

function getInitialView(schema: ViewSwitcherSchema): ViewType | undefined {
  if (schema.activeView) return schema.activeView;
  if (schema.defaultView) return schema.defaultView;
  return schema.views?.[0]?.type;
}

const DEFAULT_VIEW_ACTION_ICONS: Record<string, LucideIcon> = {
  share: Share2,
  settings: Settings,
  duplicate: Copy,
  delete: Trash2,
};

const DEFAULT_VIEW_ACTION_LABELS: Record<string, string> = {
  share: 'Share',
  settings: 'Settings',
  duplicate: 'Duplicate',
  delete: 'Delete',
};

export const ViewSwitcher: React.FC<ViewSwitcherProps> = ({
  schema,
  className,
  onViewChange,
  onCreateView,
  onViewAction,
  createViewLabel = 'Create view',
  ...props
}) => {
  const storageKey = React.useMemo(() => {
    if (schema.storageKey) return schema.storageKey;
    const idPart = schema.id ? `-${schema.id}` : '';
    return `view-switcher${idPart}`;
  }, [schema.id, schema.storageKey]);

  const [activeView, setActiveView] = React.useState<ViewType | undefined>(() => getInitialView(schema));

  React.useEffect(() => {
    if (schema.activeView) {
      setActiveView(schema.activeView);
      return;
    }

    if (!schema.persistPreference) return;

    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const view = schema.views.find(v => v.type === saved)?.type as ViewType | undefined;
        if (view) {
          setActiveView(view);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, [schema.activeView, schema.persistPreference, schema.views, storageKey]);

  React.useEffect(() => {
    if (!schema.persistPreference || !activeView || schema.activeView) return;
    try {
      localStorage.setItem(storageKey, activeView);
    } catch {
      // Ignore storage errors
    }
  }, [activeView, schema.activeView, schema.persistPreference, storageKey]);

  const notifyChange = React.useCallback((nextView: ViewType) => {
    // Host function, then the authored event name (objectui#6124). The helper
    // calls the prop only when it is a function: through `SchemaRenderer` the
    // prop can hold the authored string (objectui#10616).
    notifyViewHandlerChannels(onViewChange, schema.onViewChange, nextView, { view: nextView });
  }, [onViewChange, schema.onViewChange]);

  const handleViewChange = React.useCallback((nextView: ViewType) => {
    setActiveView(nextView);
    notifyChange(nextView);
  }, [notifyChange]);

  const currentView = activeView || schema.views?.[0]?.type;
  const currentViewValue = currentView || '';
  const currentViewConfig = schema.views.find(v => v.type === currentView) || schema.views?.[0];

  const variant = schema.variant || 'tabs';
  const position = schema.position || 'top';
  const isVertical = position === 'left' || position === 'right';
  const orientation = isVertical ? 'vertical' : 'horizontal';

  const viewActionButtons = schema.viewActions && schema.viewActions.length > 0 ? (
    <div className="flex items-center gap-1">
      {schema.viewActions.map((action, idx) => {
        const ActionIcon = action.icon
          ? resolveIcon(action.icon) || DEFAULT_VIEW_ACTION_ICONS[action.type]
          : DEFAULT_VIEW_ACTION_ICONS[action.type];
        return (
          <Button
            key={`action-${action.type}-${idx}`}
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onViewAction?.(action.type, currentView!)}
            title={DEFAULT_VIEW_ACTION_LABELS[action.type] || action.type}
          >
            {ActionIcon ? <ActionIcon className="h-3.5 w-3.5" /> : null}
          </Button>
        );
      })}
    </div>
  ) : null;

  const createViewButton = schema.allowCreateView ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => onCreateView?.()}
      title={createViewLabel}
    >
      <Plus className="h-3.5 w-3.5" />
    </Button>
  ) : null;

  const switcher = (
    <div className={cn(viewSwitcherWidth({ orientation }), 'flex items-center gap-1')}>
      {variant === 'dropdown' && (
        <Select value={currentViewValue} onValueChange={(value) => handleViewChange(value as ViewType)}>
          <SelectTrigger className={cn('w-full', isVertical ? 'h-10' : 'h-9')}>
            <SelectValue placeholder="Select view" />
          </SelectTrigger>
          <SelectContent>
            {schema.views.map((view, index) => (
              <SelectItem key={`${view.type}-${index}`} value={view.type}>
                {getViewLabel(view)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {variant === 'buttons' && (
        <div className={cn(viewSwitcherList({ orientation }))}>
          {schema.views.map((view, index) => {
            const isActive = view.type === currentView;
            const Icon = getViewIcon(view);

            return (
              <Button
                key={`${view.type}-${index}`}
                type="button"
                size="sm"
                variant={isActive ? 'secondary' : 'ghost'}
                className={cn('justify-start gap-2', isVertical ? 'w-full' : '')}
                onClick={() => handleViewChange(view.type)}
              >
                {Icon ? <Icon className="h-4 w-4" /> : null}
                <span>{getViewLabel(view)}</span>
              </Button>
            );
          })}
        </div>
      )}

      {variant === 'tabs' && (
        <Tabs value={currentViewValue} onValueChange={(value) => handleViewChange(value as ViewType)}>
          <TabsList className={cn(viewSwitcherTabsList({ orientation }))}>
            {schema.views.map((view, index) => {
              const Icon = getViewIcon(view);
              return (
                <TabsTrigger
                  key={`${view.type}-${index}`}
                  value={view.type}
                  className={cn('gap-2', isVertical ? 'justify-start' : '')}
                >
                  {Icon ? <Icon className="h-4 w-4" /> : null}
                  <span>{getViewLabel(view)}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      )}

      {viewActionButtons}
      {createViewButton}
    </div>
  );

  const viewContent = (() => {
    if (!currentViewConfig?.schema) return null;

    if (Array.isArray(currentViewConfig.schema)) {
      return (
        <div className="space-y-4">
          {currentViewConfig.schema.map((node, index) => (
            <SchemaRenderer key={`${currentViewConfig.type}-${index}`} schema={node} {...props} />
          ))}
        </div>
      );
    }

    return <SchemaRenderer schema={toRenderableSchema(currentViewConfig.schema)} {...props} />;
  })();

  return (
    <div
      className={cn(
        viewSwitcherLayout({ position }),
        className
      )}
    >
      <div className={cn('shrink-0', isVertical ? 'flex flex-col' : 'flex')}>{switcher}</div>
      <div className="flex-1 min-w-0">{viewContent}</div>
    </div>
  );
};
