/**
 * AppCard
 *
 * Display card for an application with icon, name, description, and favorite toggle.
 *
 * @module
 */

import { Star, StarOff, ArrowUpRight } from 'lucide-react';
import { Card, CardContent, Button, Badge } from '@object-ui/components';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { resolveKeyedI18nLabel, appRouteSegment } from '../../utils/index.js';
import { useFavorites } from '../../hooks/useFavorites.js';
import { getIcon } from '../../utils/getIcon.js';
import { cn } from '@object-ui/components';

interface AppCardProps {
  app: any;
  onClick: () => void;
  isFavorite: boolean;
  index?: number;
}

// Deterministic accent palette for apps that don't declare a brand color.
const ACCENTS: { from: string; to: string; text: string; ring: string; solid: string }[] = [
  { from: 'from-blue-500/15',    to: 'to-indigo-500/10',  text: 'text-blue-600 dark:text-blue-400',     ring: 'group-hover:border-blue-500/40',    solid: 'bg-blue-500' },
  { from: 'from-emerald-500/15', to: 'to-teal-500/10',    text: 'text-emerald-600 dark:text-emerald-400', ring: 'group-hover:border-emerald-500/40', solid: 'bg-emerald-500' },
  { from: 'from-fuchsia-500/15', to: 'to-pink-500/10',    text: 'text-fuchsia-600 dark:text-fuchsia-400', ring: 'group-hover:border-fuchsia-500/40', solid: 'bg-fuchsia-500' },
  { from: 'from-amber-500/15',   to: 'to-orange-500/10',  text: 'text-amber-600 dark:text-amber-400',     ring: 'group-hover:border-amber-500/40',   solid: 'bg-amber-500' },
  { from: 'from-sky-500/15',     to: 'to-cyan-500/10',    text: 'text-sky-600 dark:text-sky-400',         ring: 'group-hover:border-sky-500/40',     solid: 'bg-sky-500' },
  { from: 'from-violet-500/15',  to: 'to-purple-500/10',  text: 'text-violet-600 dark:text-violet-400',   ring: 'group-hover:border-violet-500/40',  solid: 'bg-violet-500' },
  { from: 'from-rose-500/15',    to: 'to-red-500/10',     text: 'text-rose-600 dark:text-rose-400',       ring: 'group-hover:border-rose-500/40',    solid: 'bg-rose-500' },
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function AppCard({ app, onClick, isFavorite, index = 0 }: AppCardProps) {
  const { t } = useObjectTranslation();
  const { appLabel, appDescription } = useObjectLabel();
  const { toggleFavorite } = useFavorites();

  const Icon = getIcon(app.icon);
  const label = appLabel({ name: app.name, label: resolveKeyedI18nLabel(app.label, t) });
  const description = appDescription({ name: app.name, description: resolveKeyedI18nLabel(app.description, t) });
  const accent = ACCENTS[(hashStr(app.name) + index) % ACCENTS.length];

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite({
      id: `app:${app.name}`,
      label,
      // ADR-0048 — link to the canonical package-id route segment, not the
      // app name, so the favorite opens `/apps/<packageId>` like the nav does.
      href: `/apps/${appRouteSegment(app) ?? app.name}`,
      type: 'object',
    });
  };

  return (
    <Card
      className={cn(
        'group relative overflow-hidden border border-border/70 bg-card/80 backdrop-blur-sm',
        'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.985] active:-translate-y-0',
        'motion-reduce:transition-none motion-reduce:hover:transform-none',
        accent.ring,
      )}
      data-testid={`app-card-${app.name}`}
    >
      <button
        type="button"
        aria-label={label}
        className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={onClick}
        data-testid={`app-card-open-${app.name}`}
      />

      <div
        aria-hidden
        className={cn(
          'absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-100',
          accent.from,
          accent.to,
        )}
      />

      <CardContent className="relative flex h-full flex-col p-5">
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 z-20 h-8 w-8 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={handleToggleFavorite}
          aria-label={isFavorite
            ? t('common.removeFromFavorites', { defaultValue: 'Remove from favorites' }) + ` — ${label}`
            : t('common.addToFavorites', { defaultValue: 'Add to favorites' }) + ` — ${label}`}
          aria-pressed={isFavorite}
          data-testid={`favorite-btn-${app.name}`}
        >
          {isFavorite ? (
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          ) : (
            <StarOff className="h-4 w-4" />
          )}
        </Button>

        <div
          className={cn(
            'inline-flex h-14 w-14 items-center justify-center rounded-2xl mb-4 ring-1 ring-inset',
            'bg-gradient-to-br ring-border/40',
            accent.from,
            accent.to,
          )}
        >
          {/* eslint-disable-next-line react-hooks/static-components -- getIcon returns a stable icon component from a static registry, not one created during render */}
          <Icon
            className={cn('h-7 w-7', accent.text)}
          />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base sm:text-lg leading-tight truncate">{label}</h3>
            {app.isDefault && (
              <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
                {t('home.appCard.default', { defaultValue: 'Default' })}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2 min-h-[2.5rem]">
            {description || t('home.appCard.noDescription', { defaultValue: 'No description' })}
          </p>
        </div>

        <div className="mt-auto pt-4 flex items-center justify-between text-xs font-medium">
          <span className="inline-flex items-center gap-1 text-muted-foreground transition-colors group-hover:text-foreground">
            {t('home.open', { defaultValue: 'Open' })}
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
