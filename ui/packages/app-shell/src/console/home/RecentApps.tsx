/**
 * RecentApps
 *
 * Display section for recently accessed items (objects, dashboards, pages).
 *
 * @module
 */

import { useNavigate } from 'react-router-dom';
import { useObjectTranslation } from '@object-ui/i18n';
import { Card, CardContent, cn } from '@object-ui/components';
import { Clock, ArrowUpRight, Database, FileText, LayoutDashboard, File } from 'lucide-react';
import { recentItemTypeLabel } from './recentItemTypeLabel.js';
import type { RecentItem } from '../../hooks/useRecentItems.js';
import { useRecentItemLabel } from '../../hooks/useRecentItemLabel.js';

interface RecentAppsProps {
  items: RecentItem[];
}

const TYPE_TONES: Record<string, string> = {
  object: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20',
  dashboard: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-violet-500/20',
  page: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20',
  record: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20',
};

// Per-type icon so the four kinds are visually distinguishable — see
// StarredApps.tsx for the rationale.
const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  object: Database,
  record: FileText,
  dashboard: LayoutDashboard,
  page: File,
};

export function RecentApps({ items }: RecentAppsProps) {
  const navigate = useNavigate();
  const { t } = useObjectTranslation();
  // The entry stores identity, not text: its label is the item's own, read in
  // the current language on this render (objectui#11678).
  const recentLabel = useRecentItemLabel();

  if (items.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 ring-1 ring-sky-500/20 text-sky-600 dark:text-sky-400">
          <Clock className="h-4 w-4" />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('home.recentApps.title', { defaultValue: 'Recently Accessed' })}
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {items.map((item) => {
          const Icon = TYPE_ICONS[item.type] || Database;
          const typeLabel = recentItemTypeLabel(t, item.type);
          const tone = TYPE_TONES[item.type] || TYPE_TONES.object;
          return (
            <Card
              key={item.id}
              className="group cursor-pointer border border-border/70 bg-card/80 backdrop-blur-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-foreground/20 active:scale-[0.985] active:-translate-y-0 motion-reduce:transition-none motion-reduce:hover:transform-none"
              onClick={() => navigate(item.href)}
              data-testid={`recent-item-${item.id}`}
              role="link"
              tabIndex={0}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(item.href);
                }
              }}
            >
              <CardContent className="p-3.5">
                <div className="flex items-center gap-3">
                  <div className={cn('inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 shrink-0', tone)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">{recentLabel(item)}</h3>
                    <p className="text-xs text-muted-foreground">{typeLabel}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-1 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-hover:translate-x-0" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
