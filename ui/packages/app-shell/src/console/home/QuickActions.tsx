/**
 * QuickActions
 *
 * Quick action cards for common tasks like creating apps, importing data,
 * accessing system settings, etc.
 *
 * @module
 */

import { useNavigate } from 'react-router-dom';
import { useObjectTranslation } from '@object-ui/i18n';
import { Card, CardContent } from '@object-ui/components';
import { Settings, Database, ArrowUpRight } from 'lucide-react';
import { cn } from '@object-ui/components';

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  href: string;
  iconBg: string;
  iconText: string;
  hoverBorder: string;
}

export function QuickActions() {
  const navigate = useNavigate();
  const { t } = useObjectTranslation();

  // Manual "Create App" deprecated — the AI-first builder (Build with AI on
  // /home) is the path to a new application.
  const actions: QuickAction[] = [
    {
      id: 'manage-objects',
      label: t('home.quickActions.manageObjects', { defaultValue: 'Manage Objects' }),
      description: t('home.quickActions.manageObjectsDesc', { defaultValue: 'Configure data models' }),
      icon: Database,
      // #3739 — the metadata-admin engine's CANONICAL route, not the legacy
      // `…/system/metadata/object` alias this card used to carry. That alias is
      // not a page: `apps/console`'s host fragment serves it with
      // `MetadataRedirect`, a bare `<Navigate>` onto the URL below, so every
      // click paid a redundant hop plus a re-render. Same defect and same
      // remedy as #3660's `sys-datasources` entry in both sidebars. The alias
      // routes stay for bookmarks and external links.
      href: '/apps/setup/metadata/object',
      iconBg: 'bg-gradient-to-br from-violet-500/15 to-purple-500/10 ring-violet-500/20',
      iconText: 'text-violet-600 dark:text-violet-400',
      hoverBorder: 'hover:border-violet-500/40',
    },
    {
      id: 'system-settings',
      label: t('home.quickActions.systemSettings', { defaultValue: 'System Settings' }),
      description: t('home.quickActions.systemSettingsDesc', { defaultValue: 'Configure your system' }),
      icon: Settings,
      // #3611 — the system hub, not the bare `/apps/setup` (which is the
      // "No Apps Configured" empty state's own URL on a zero-app deployment).
      href: '/apps/setup/system',
      iconBg: 'bg-gradient-to-br from-emerald-500/15 to-teal-500/10 ring-emerald-500/20',
      iconText: 'text-emerald-600 dark:text-emerald-400',
      hoverBorder: 'hover:border-emerald-500/40',
    },
  ];

  return (
    <section>
      <h2 className="text-2xl font-semibold tracking-tight mb-5">
        {t('home.quickActions.title', { defaultValue: 'Quick Actions' })}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Card
              key={action.id}
              className={cn(
                'group cursor-pointer border border-border/70 bg-card/80 backdrop-blur-sm',
                'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:transform-none',
                action.hoverBorder,
              )}
              onClick={() => navigate(action.href)}
              data-testid={`quick-action-${action.id}`}
              role="link"
              tabIndex={0}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(action.href);
                }
              }}
              aria-label={action.label}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={cn('inline-flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset shrink-0', action.iconBg)}>
                    <Icon className={cn('h-5 w-5', action.iconText)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-base leading-tight">{action.label}</h3>
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-1 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-hover:translate-x-0" />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{action.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
