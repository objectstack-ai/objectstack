/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Card, CardHeader, CardTitle, CardContent, DataEmptyState } from '@object-ui/components';
import { Activity, Edit, PlusCircle, Trash2, MessageSquare, ArrowRightLeft } from 'lucide-react';
import type { ActivityEntry } from '@object-ui/types';
import { useDisplayLocale } from '@object-ui/i18n';
import { useDetailTranslation } from './useDetailTranslation';

export type ActivityFilterType = ActivityEntry['type'] | 'all';

export interface ActivityTimelineProps {
  activities: ActivityEntry[];
  /** Show filter controls for activity types */
  filterable?: boolean;
  /** Default filter (defaults to 'all') */
  defaultFilter?: ActivityFilterType;
  className?: string;
}

const ACTIVITY_ICONS: Record<ActivityEntry['type'], React.ElementType> = {
  field_change: Edit,
  create: PlusCircle,
  delete: Trash2,
  comment: MessageSquare,
  status_change: ArrowRightLeft,
};

const ACTIVITY_COLORS: Record<ActivityEntry['type'], string> = {
  field_change: 'bg-blue-100 text-blue-600',
  create: 'bg-green-100 text-green-600',
  delete: 'bg-red-100 text-red-600',
  comment: 'bg-purple-100 text-purple-600',
  status_change: 'bg-amber-100 text-amber-600',
};

/**
 * The `t` the module-level formatters below take.
 *
 * They are plain functions, not hooks, so the component reads the hook once and
 * passes `t` down — the same shape and the same reason as the sibling
 * `RecordActivityTimeline`, which has always done this correctly.
 */
type ActivityTranslate = (key: string, options?: Record<string, unknown>) => string;

function formatTimestamp(timestamp: string, t: ActivityTranslate, locale: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t('detail.justNow');
    if (diffMins < 60) return t('detail.minutesAgo', { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t('detail.hoursAgo', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return t('detail.daysAgo', { count: diffDays });
    // Past a week this is a DATE, not a relative phrase: `toLocaleDateString`
    // already localizes it, so there is no literal here to key. Byte-identical
    // to the sibling's own tail for the same reason. The tag is DECLARED
    // (objectui#9786): a bare call means the machine's locale, which is
    // neither the tenant's nor the user's channel.
    return date.toLocaleDateString(locale);
  } catch {
    return timestamp;
  }
}

function formatFieldChange(entry: ActivityEntry, t: ActivityTranslate): string {
  if (entry.description) return entry.description;

  // The one value repeated across three branches, resolved once.
  const emptyValue = t('detail.activityEmptyValue');

  if (entry.type === 'field_change' && entry.field) {
    // `entry.field` is a schema field NAME — runtime data, not copy — so this
    // stays a code-side transform and rides in through the `{{field}}` hole.
    const fieldLabel = entry.field.charAt(0).toUpperCase() + entry.field.slice(1).replace(/_/g, ' ');
    const oldVal = entry.oldValue != null ? String(entry.oldValue) : emptyValue;
    const newVal = entry.newValue != null ? String(entry.newValue) : emptyValue;
    // The quotes live INSIDE each pack's value, so every locale punctuates the
    // quoted span its own way (de `„“`, zh `“”`, ja `「」`, fr/ru `«»`).
    return t('detail.activityFieldChanged', { field: fieldLabel, old: oldVal, new: newVal });
  }

  if (entry.type === 'create') return t('detail.activityCreated');
  if (entry.type === 'delete') return t('detail.activityDeleted');
  if (entry.type === 'status_change' && entry.field) {
    const newVal = entry.newValue != null ? String(entry.newValue) : emptyValue;
    return t('detail.activityStatusChanged', { value: newVal });
  }

  return t('detail.activityUpdated');
}

/** Chip order — what `Object.keys(FILTER_LABELS)` used to supply. */
const FILTER_ORDER: readonly ActivityFilterType[] = [
  'all',
  'field_change',
  'create',
  'delete',
  'comment',
  'status_change',
];

/**
 * The pack key naming each chip.
 *
 * Deliberately STATIC `t()` calls rather than a `type -> key` map read as
 * `t(KEYS[type])`: a key that only ever appears as a map value has no call site
 * `check:i18n-keys` or `check-i18n-dead-keys` can resolve, so it reads as an
 * unreferenced key even while it renders. Same shape as the sibling
 * `RecordActivityTimeline`'s `getFilterOptions`.
 *
 * `field_change` and `comment` reuse keys whose `en` values are byte-identical
 * to the literals they replace, so those two are a pure lookup swap rather than
 * a new spelling of copy the packs already carry.
 */
function filterLabel(type: ActivityFilterType, t: ActivityTranslate): string {
  switch (type) {
    case 'field_change':
      return t('detail.fieldChangesFilter');
    case 'create':
      return t('detail.createsFilter');
    case 'delete':
      return t('detail.deletesFilter');
    case 'comment':
      return t('detail.comments');
    case 'status_change':
      return t('detail.statusChangesFilter');
    case 'all':
    default:
      return t('detail.allFilter');
  }
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  activities,
  filterable = false,
  defaultFilter = 'all',
  className,
}) => {
  const { t } = useDetailTranslation();
  // The BCP-47 tag the absolute-date tail formats with. Read here because
  // `formatTimestamp` is a plain function called from inside the `.map()`
  // below and a hook cannot be called from there — the same shape and the same
  // reason as `t` above (objectui#9786).
  const displayLocale = useDisplayLocale();
  const [activeFilter, setActiveFilter] = React.useState<ActivityFilterType>(defaultFilter);

  const filteredActivities = React.useMemo(() => {
    if (activeFilter === 'all') return activities;
    return activities.filter(a => a.type === activeFilter);
  }, [activities, activeFilter]);

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          {t('detail.activity')}
          <span className="text-sm font-normal text-muted-foreground">
            ({filteredActivities.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filter controls */}
        {filterable && (
          <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label={t('detail.filterActivity')}>
            {FILTER_ORDER.map(type => (
              <button
                key={type}
                type="button"
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                  activeFilter === type
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
                onClick={() => setActiveFilter(type)}
                aria-pressed={activeFilter === type}
              >
                {type !== 'all' && React.createElement(ACTIVITY_ICONS[type] || Edit, { className: 'h-3 w-3' })}
                {filterLabel(type, t)}
              </button>
            ))}
          </div>
        )}

        {filteredActivities.length === 0 ? (
          <DataEmptyState title={t('detail.noActivity')} className="py-6" />
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-2 bottom-2 w-px bg-border" />

            <div className="space-y-4">
              {filteredActivities.map((entry) => {
                const Icon = ACTIVITY_ICONS[entry.type] || Edit;
                const colorClass = ACTIVITY_COLORS[entry.type] || 'bg-gray-100 text-gray-600';

                return (
                  <div key={entry.id} className="flex gap-3 relative">
                    {/* Icon */}
                    <div
                      className={cn(
                        'shrink-0 h-8 w-8 rounded-full flex items-center justify-center z-10',
                        colorClass,
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-1">
                      <p className="text-sm">
                        <span className="font-medium">{entry.user}</span>
                        {' '}
                        <span className="text-muted-foreground">
                          {formatFieldChange(entry, t)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatTimestamp(entry.timestamp, t, displayLocale)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
