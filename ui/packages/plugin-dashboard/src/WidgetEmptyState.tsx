/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * WidgetEmptyState — the DEFAULT empty state every dashboard/analytics widget
 * renders when its query succeeded and returned nothing.
 *
 * ## Why this exists (objectui#7063)
 *
 * Maintainer ruling 2026-08-31 (hotcrm#1212, following hotcrm#1203): a widget
 * that renders a bare row-placeholder on an empty result is the PLATFORM's
 * defect, not the app's. The measured scenario is a fresh flagship-demo
 * install: eleven populated tiles and one reading exactly `暂无数据行`
 * (`dashboard.noRows`, 'No rows') mid-page. Nothing on screen says whether the
 * dashboard failed or is simply young, so the tile reads as a load failure —
 * and the only app-side remedy was authoring per-widget prose, which is the
 * per-app tax objectstack#13848 rules against.
 *
 * Three widget surfaces had written that placeholder independently, in two
 * different strings — `DatasetWidget` (`dashboard.noRows`), `ObjectDataTable`
 * and `PivotTable` (both `dashboard.noDataAvailable`). There was no shared
 * seam to fix; this component IS the seam, stated once for the dashboard
 * surface so "uniformly" is a property of the code and not of three copies
 * agreeing by hand.
 *
 * ## What makes it distinguishable from a load failure — the three properties
 *
 * 1. **`role="status"`, never `role="alert"`.** The failure paths beside each
 *    call site (`DatasetWidget`'s `state.status === 'error'` box, the table's
 *    error block) are `role="alert"` on destructive colours. Before this, the
 *    empty branches carried NO role at all, so assistive tech got a bare
 *    fragment with no state either way. The two roles are now the machine
 *    check that the states are distinct, which is why no invented
 *    `data-empty-*` attribute is added: the semantics already carry it.
 * 2. **Muted treatment + an inbox glyph**, never destructive colour + a
 *    warning triangle.
 * 3. **A title AND an explanation**, where the placeholder used to be a single
 *    terse fragment. The copy says the widget LOADED SUCCESSFULLY — the one
 *    fact the reader of a blank tile cannot otherwise get.
 *
 * ## `source` names what is empty, and it is a raw identifier on purpose
 *
 * The card asks the default to name the widget's label and/or its data source
 * rather than the bare placeholder. The widget's own title is already rendered
 * by the `CardHeader` directly above every tile (`DashboardRenderer`), so
 * repeating it here says nothing new; the DATA SOURCE is the half the reader
 * cannot see. What is reachable at each render site is the authored binding —
 * `widget.dataset` for the dataset path, `schema.objectName` for the
 * object-bound table/pivot — i.e. a raw metadata name (`crm_forecast`), not a
 * localized label. It is rendered as a labelled monospace value rather than
 * folded into a sentence for exactly that reason: a truthful narrow statement
 * beats an invented friendly one, and a label/value pair translates cleanly in
 * every pack (including RTL) where a concatenated sentence would not.
 *
 * That is also why the copy carries no `{{interpolation}}`. `useSafeTranslate`
 * takes a positional fallback and no options bag, so an interpolated key would
 * have to come from a raw `useObjectTranslation` `t()` — and with no
 * `I18nProvider` mounted (the standalone-host and test configuration) that
 * renders the raw KEY unless the call site also carries an inline
 * `defaultValue`, which objectui#3517 rules out. Label + value needs neither.
 *
 * ⚠️ NOT a cross-surface abstraction. `packages/plugin-detail`'s empty SECTION
 * default (objectui#7064) is a sibling card on the same maintainer principle,
 * dispatched in parallel; this component is deliberately dashboard-local and
 * `DataEmptyState` — the presentational primitive both surfaces already use —
 * is consumed here UNCHANGED. Converging the two is its own sequenced card,
 * not a rider on either.
 */

import { cn, DataEmptyState } from '@object-ui/components';
import { useSafeTranslate } from '@object-ui/i18n';
import { Inbox } from 'lucide-react';

export interface WidgetEmptyStateProps {
  /**
   * The authored binding this widget is empty FOR — `widget.dataset` on the
   * dataset path, `schema.objectName` on the object-bound one. Omitted when the
   * render site genuinely has no source to name (an inline-data pivot), in
   * which case the title and explanation still stand on their own.
   */
  source?: string;
  /** Layout classes for the surrounding tile; the muted/centred look is fixed. */
  className?: string;
  /**
   * Test id for the root. Defaults to `widget-empty-state`; the table and pivot
   * surfaces pass the ids their existing pins already select on
   * (`table-empty-state` / `pivot-empty-state`, read by
   * `ObjectDataTable.stableEmptyRows` and app-shell's widget DOM leak sweep).
   */
  testId?: string;
}

export function WidgetEmptyState({ source, className, testId }: WidgetEmptyStateProps) {
  const tt = useSafeTranslate();
  return (
    <DataEmptyState
      role="status"
      data-testid={testId ?? 'widget-empty-state'}
      className={cn(
        'h-full w-full gap-2 p-4 [&>h3]:text-sm [&>h3]:font-medium [&>p]:text-xs',
        className,
      )}
      icon={<Inbox className="h-5 w-5 text-muted-foreground/70" />}
      iconWrapperClassName="flex size-9 items-center justify-center rounded-lg bg-muted"
      title={tt('dashboard.empty.title', 'No data yet')}
      description={tt(
        'dashboard.empty.message',
        'This widget loaded successfully and its query returned no records yet.',
      )}
    >
      {source ? (
        <p className="text-xs text-muted-foreground/80" data-testid="widget-empty-source">
          {/* The label carries its own punctuation so no separator is
              concatenated in code — `Source:` / `数据源：` / `:المصدر` each
              spell it the way their language does. */}
          <span>{tt('dashboard.empty.sourceLabel', 'Source:')}</span>{' '}
          <span className="font-mono">{source}</span>
        </p>
      ) : null}
    </DataEmptyState>
  );
}
