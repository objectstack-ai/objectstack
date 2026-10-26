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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  resolveIcon,
} from '@object-ui/components';
import { ChevronDown } from 'lucide-react';
import { useObjectTranslation, pickLocalized } from '@object-ui/i18n';
import type { ViewTabSchema } from '@objectstack/spec/ui';

/**
 * One tab in a multi-tab list view — derived from the spec's `ViewTabSchema`
 * (objectui#3160, objectstack#4115 ledger batch 6).
 *
 * Until then this was a hand copy wearing the spec's own name, drifted in three
 * places: `label` was REQUIRED (the spec makes it optional — `name` is the
 * identifier), `filter` was `any` (the spec models `ViewFilterRule[]`, so a
 * mistyped operator was unreportable), and `visible` accepted `string | boolean`
 * — a renderer-side tolerance for a shape the spec never emits, which is the
 * lenient fallback AGENTS.md #12 bans. `@object-ui/types` has re-exported the
 * spec's `ViewTab` under that name all along, so the fork and the real thing
 * were already importable side by side.
 *
 * Bound to the AUTHORING (`input`) side, not `z.infer`: `pinned` / `isDefault` /
 * `visible` all carry `.default()`s, so the PARSED type makes three keys
 * required and a host handing this component stored view metadata
 * (`{ name: 'open' }`) could not express it. The rule recorded on
 * objectstack#4115 — writing this metadata → input, reading what has already
 * been parsed → `z.infer`. Reached through the schema's own `_zod` carrier
 * rather than `z.input` so this package takes no zod dependency; same technique
 * and fuller rationale in `packages/react/src/spec-input.ts`.
 */
export type ViewTab = (typeof ViewTabSchema)['_zod']['input'];

export interface TabBarProps {
  tabs: ViewTab[];
  activeTab?: string;
  onTabChange?: (tab: ViewTab) => void;
  className?: string;
}

/**
 * Filter visible tabs: exclude tabs where `visible` is false.
 * Pinned tabs are always included regardless of other filtering.
 *
 * The `!== 'false'` half of this predicate went with the hand-copied `ViewTab`
 * above (objectui#3160): the spec types `visible` as a boolean and nothing in
 * the platform emits the STRING `'false'`, so the extra comparison was a
 * renderer-side accommodation for a shape no producer writes — and with the
 * derived type it is a compile error rather than dead code.
 */
function getVisibleTabs(tabs: ViewTab[]): ViewTab[] {
  return tabs
    .filter(tab => tab.pinned || tab.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Resolve a tab's display text for the active UI language.
 *
 * `ViewTab.label` is the spec's `I18nLabel`, which `@objectstack/spec`
 * 17.0.0-rc.6 widened from `string` to `string | Record<string, string>`: an
 * author may now write `label: { en: 'All Active', 'zh-CN': '全部活跃' }` on a
 * view tab. Rendered straight into a text node the map form reaches React as an
 * object — `[object Object]` — so every read goes through `pickLocalized`,
 * objectui's render-side resolver for that vocabulary, paired with the live UI
 * language exactly as `@object-ui/components` and `@object-ui/plugin-detail`
 * pair them. (`@objectstack/spec`'s own `resolveI18nLabel` implements the same
 * six-limb rule; `pickLocalized` is the spelling for components that sit inside
 * objectui's i18n tree and can read the language, and it answers `''` rather
 * than `undefined` on a miss, which is what a text node wants. That the two
 * agree limb for limb is not assumed — it is pinned by
 * `src/__tests__/i18nLabel-resolver-parity.test.ts`, which is what keeps this
 * package's choice from drifting away from the sites that call the spec's
 * resolver directly.)
 *
 * A label-less tab still resolves to `''` — `pickLocalized`'s miss spelling —
 * which renders exactly what `{tab.label}` rendered for `undefined` before.
 * Deliberately NOT given a `|| tab.name` fallback here: that would be a
 * behaviour change this card did not ask for.
 */
function useTabLabel(): (tab: ViewTab | undefined) => string {
  // Provider-safe: react-i18next falls back to its global instance and never
  // throws, so a standalone TabBar (tests, embeds) degrades to the runtime
  // default language rather than crashing.
  const { language } = useObjectTranslation();
  return React.useCallback(
    (tab: ViewTab | undefined) => (tab ? pickLocalized(tab.label, language) : ''),
    [language],
  );
}

/**
 * TabBar renders a row of view tabs above the ListView toolbar.
 * Supports icons (resolved via Lucide), pinned tabs, isDefault selection,
 * and emits tab changes with filter/sort configuration.
 */
export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab: controlledActiveTab,
  onTabChange,
  className,
}) => {
  const visibleTabs = React.useMemo(() => getVisibleTabs(tabs), [tabs]);
  const tabLabel = useTabLabel();

  // Determine the default tab: first isDefault tab, or first tab
  const defaultTab = React.useMemo(() => {
    const def = visibleTabs.find(t => t.isDefault);
    return def?.name ?? visibleTabs[0]?.name;
  }, [visibleTabs]);

  const [internalActiveTab, setInternalActiveTab] = React.useState<string | undefined>(defaultTab);

  const activeTabName = controlledActiveTab ?? internalActiveTab;

  const handleTabClick = React.useCallback(
    (tab: ViewTab) => {
      setInternalActiveTab(tab.name);
      onTabChange?.(tab);
    },
    [onTabChange],
  );

  if (visibleTabs.length === 0) return null;

  return (
    <div
      className={cn('px-2 sm:px-4 py-1 flex items-center gap-0.5 bg-background', className)}
      data-testid="view-tabs"
      role="tablist"
    >
      {visibleTabs.map(tab => {
        const TabIcon = resolveIcon(tab.icon);
        const isActive = activeTabName === tab.name;
        return (
          <Button
            key={tab.name}
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2.5 py-1 text-xs rounded-md transition-colors duration-150",
              isActive
                ? "font-medium text-foreground bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-transparent"
            )}
            data-testid={`view-tab-${tab.name}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => handleTabClick(tab)}
          >
            {TabIcon && <TabIcon className="h-3 w-3 mr-1.5" />}
            {tabLabel(tab)}
          </Button>
        );
      })}
    </div>
  );
};

/**
 * Mobile-friendly variant of TabBar: a single dropdown button showing the
 * current view name + chevron. Tap → DropdownMenu listing every view.
 *
 * Pair with TabBar via `hidden sm:flex` / `sm:hidden` wrappers so phones get
 * the compact dropdown and wider screens get the inline pill row.
 */
export const TabBarSelect: React.FC<TabBarProps> = ({
  tabs,
  activeTab: controlledActiveTab,
  onTabChange,
  className,
}) => {
  const visibleTabs = React.useMemo(() => getVisibleTabs(tabs), [tabs]);
  const tabLabel = useTabLabel();
  // objectui#12145 — the trigger's accessible name. The same key the app
  // header's view switcher reads for the same name.
  const { t } = useObjectTranslation();

  const defaultTab = React.useMemo(() => {
    const def = visibleTabs.find(tab => tab.isDefault);
    return def?.name ?? visibleTabs[0]?.name;
  }, [visibleTabs]);

  const [internalActiveTab, setInternalActiveTab] = React.useState<string | undefined>(defaultTab);
  const activeTabName = controlledActiveTab ?? internalActiveTab;

  const activeTab = React.useMemo(
    () => visibleTabs.find(tab => tab.name === activeTabName) ?? visibleTabs[0],
    [visibleTabs, activeTabName],
  );

  const handlePick = React.useCallback(
    (tab: ViewTab) => {
      setInternalActiveTab(tab.name);
      onTabChange?.(tab);
    },
    [onTabChange],
  );

  if (visibleTabs.length === 0) return null;

  const ActiveIcon = resolveIcon(activeTab?.icon);

  return (
    <div className={cn('px-2 py-1', className)} data-testid="view-tabs-select">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-medium text-foreground gap-1.5 max-w-[60vw] truncate"
            aria-label={t('topbar.switchView', { defaultValue: 'Switch view' })}
          >
            {/* eslint-disable-next-line react-hooks/static-components -- resolveIcon returns a stable lucide icon component from a static registry, not a component created during render */}
            {ActiveIcon && <ActiveIcon className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{tabLabel(activeTab)}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
          {visibleTabs.map(tab => {
            const TabIcon = resolveIcon(tab.icon);
            const isActive = activeTabName === tab.name;
            return (
              <DropdownMenuItem
                key={tab.name}
                onClick={() => handlePick(tab)}
                className={cn('text-sm', isActive && 'font-medium bg-muted')}
                data-testid={`view-tab-select-${tab.name}`}
              >
                {TabIcon && <TabIcon className="h-3.5 w-3.5 mr-2 shrink-0" />}
                <span className="truncate">{tabLabel(tab)}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
