/**
 * ActivityFeed
 *
 * Sidebar panel that displays recent activity items (create, update, delete,
 * comment). Opens as a slide-out Sheet triggered by a bell icon button.
 * Phase 17 L1 – local state only, no server integration.
 * @module
 */

import { useState } from 'react';
import {
  Button,
  Badge,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@object-ui/components';
import { Activity, Plus, Pencil, Trash2, MessageSquare, Filter, Info } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { UNMAPPED_ACTIVITY_ITEM_TYPE } from './activityItemType.js';
import type { ActivityItem, ActivityItemType } from './activityItemType.js';

/**
 * The item shape and its kind union live in `activityItemType.ts` with the
 * `sys_activity` reading that produces them (objectui#6730) — that module is
 * DOM-free, so what a row BECOMES can be asserted without mounting this Sheet.
 * Re-exported here so every existing `from './ActivityFeed.js'` import (and the
 * package barrel's `ActivityItem`) keeps resolving unchanged.
 */
export type { ActivityItem, ActivityItemType } from './activityItemType.js';

export interface ActivityFeedProps {
  activities?: ActivityItem[];
  className?: string;
}

const typeConfig: Record<
  ActivityItem['type'],
  { icon: React.ElementType; color: string }
> = {
  create: { icon: Plus, color: 'text-green-500' },
  update: { icon: Pencil, color: 'text-blue-500' },
  delete: { icon: Trash2, color: 'text-red-500' },
  comment: { icon: MessageSquare, color: 'text-amber-500' },
  // The generic bucket (objectui#6730): built-ins these four kinds have no
  // honest presentation for (`system` / `completed` / `scheduled` / `login` /
  // `logout`) plus every author-extended value. Neutral on purpose — the point
  // of the bucket is that it does not claim the row was an update.
  system: { icon: Info, color: 'text-muted-foreground' },
};

/**
 * Is this activity kind allowed through the notification filter?
 *
 * ⚠️ The question is PRESENCE, not truthiness — that distinction is the fix
 * (objectui#6816). A bare `preferences[type]` lookup answers the same falsy
 * value to two unrelated questions:
 *
 *  - the kind is IN the record and the user toggled it OFF ⇒ hide the row.
 *    That is the feature, and it still hides.
 *  - the kind is ABSENT from the record ⇒ the row used to vanish from the
 *    panel. It now fails OPEN and renders.
 *
 * The second case is unreachable inside this repo — the preferences record is
 * `Record<ActivityItemType, boolean>` and `tsc` forces every member — but
 * `ActivityFeed` is published API (the package barrel exports it), so a host
 * can mount it and pass rows whose `type` came from its own data.
 * `sys_activity.type` is author-extensible (objectstack `88b9d749a`, ruled
 * 2026-08-24) and is not validated on write, so those kinds are real. Reading
 * one as "off" made the row stored, queryable and invisible — the
 * objectui#5840 failure mode reached from the reader side, and the least
 * detectable kind of failure a feed can have.
 *
 * Asking `hasOwnProperty` rather than defaulting a bracket read is the same
 * choice `activityItemTypeOf` makes on the mapping side (layout/
 * activityItemType.ts), for the same reason: the question is about the record's
 * OWN entries. A consumer kind spelled `toString` or `constructor` is absent
 * here, but a bracket read finds a truthy `Object.prototype` member — the same
 * verdict today, reached by accident, through a value that is not a boolean.
 */
function isKindEnabled(
  preferences: Partial<Record<ActivityItemType, boolean>>,
  type: ActivityItemType,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(preferences, type)) return true;
  return preferences[type] === true;
}

/** Format an ISO timestamp as a localized relative string (e.g. "2m ago"). */
function formatRelativeTime(iso: string, t: (key: string, vars?: Record<string, unknown>) => string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 5) return t('layout.activityFeed.relativeJustNow');
  if (seconds < 60) return t('layout.activityFeed.relativeSecondsAgo', { count: Math.max(seconds, 0) });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('layout.activityFeed.relativeMinutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('layout.activityFeed.relativeHoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('layout.activityFeed.relativeDaysAgo', { count: days });
}

export function ActivityFeed({ activities = [], className }: ActivityFeedProps) {
  const { t } = useObjectTranslation();
  const [open, setOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<Record<ActivityItem['type'], boolean>>({
    create: true,
    update: true,
    delete: true,
    comment: true,
    system: true,
  });

  const togglePreference = (type: ActivityItem['type']) => {
    setNotificationPreferences(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const filteredActivities = activities.filter(a => isKindEnabled(notificationPreferences, a.type));

  /** Localized labels for activity type badges. */
  const typeLabels: Record<ActivityItem['type'], string> = {
    create: t('layout.activityFeed.typeCreate'),
    update: t('layout.activityFeed.typeUpdate'),
    delete: t('layout.activityFeed.typeDelete'),
    comment: t('layout.activityFeed.typeComment'),
    system: t('layout.activityFeed.typeSystem'),
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className ?? 'h-8 w-8'}
          aria-label={t('layout.activityFeed.ariaLabel')}
        >
          <Activity className="h-4 w-4" />
          {activities.length > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-sky-500 ring-2 ring-background"
            />
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-80 sm:w-96">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            {t('layout.activityFeed.title')}
            <Button
              variant={showFilters ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-3.5 w-3.5 mr-1" />
              {t('layout.activityFeed.filter')}
            </Button>
          </SheetTitle>
        </SheetHeader>

        {showFilters && (
          <div className="flex flex-wrap gap-1.5 mt-3 px-1">
            {(Object.keys(typeConfig) as ActivityItem['type'][]).map(type => {
              const { icon: Icon, color } = typeConfig[type];
              // Same predicate as the filter above. Behaviour-neutral today (this
              // strip iterates `typeConfig`'s own keys, all of which the record
              // carries), so it is a de-duplication rather than a second fix: one
              // reading of "is this kind on", which the badge and the list cannot
              // drift apart on later.
              const active = isKindEnabled(notificationPreferences, type);
              return (
                <Badge
                  key={type}
                  variant={active ? 'default' : 'outline'}
                  className="cursor-pointer select-none gap-1"
                  onClick={() => togglePreference(type)}
                >
                  <Icon className={`h-3 w-3 ${active ? '' : color}`} />
                  {typeLabels[type]}
                </Badge>
              );
            })}
          </div>
        )}

        {filteredActivities.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <Activity className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t('layout.activityFeed.empty')}</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-1 overflow-y-auto max-h-[calc(100vh-8rem)]">
            {filteredActivities.map((item) => {
              // Fail-open's other half. The filter now lets an unrecognised kind
              // through, so this lookup must have somewhere to land: destructuring
              // `undefined` throws and takes the whole panel down with it, which is
              // strictly worse than the row this card is here to stop losing.
              // `UNMAPPED_ACTIVITY_ITEM_TYPE` is the presentation activityItemType.ts
              // already declares for a value outside its table — neutral on purpose,
              // and in particular not `update`.
              const { icon: Icon, color } =
                typeConfig[item.type] ?? typeConfig[UNMAPPED_ACTIVITY_ITEM_TYPE];
              return (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
                >
                  <span className={`mt-0.5 shrink-0 ${color}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{item.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.user} · {formatRelativeTime(item.timestamp, t)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
