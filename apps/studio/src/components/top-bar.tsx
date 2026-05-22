// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * TopBar
 *
 * Slim chrome for single-tenant Studio:
 *   [hamburger? · Brand · / · PackageSwitcher · / · breadcrumbs] [search · mode · theme · user]
 *
 * Organization / project switchers were removed when Studio dropped
 * multi-tenant routing (see ../routes/__root.tsx).
 */

import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { InstalledPackage } from '@objectstack/spec/kernel';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Boxes, Search } from 'lucide-react';

import { PackageSwitcher } from '@/components/package-switcher';
import { UserMenu } from '@/components/user-menu';
import { HmrStatusBadge } from '@/components/HmrStatusBadge';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { usePackages } from '@/hooks/usePackages';
import { CommandPalette } from '@/components/CommandPalette';

const META_TYPE_LABELS: Record<string, string> = {
  action: 'Actions',
  dashboard: 'Dashboards',
  report: 'Reports',
  flow: 'Flows',
  agent: 'Agents',
  api: 'APIs',
  ragPipeline: 'RAG Pipelines',
  profile: 'Profiles',
  sharingRule: 'Sharing Rules',
  data: 'Seed Data',
  view: 'Views',
  app: 'Apps',
  tool: 'Tools',
  workflow: 'Workflows',
  approval: 'Approvals',
  webhook: 'Webhooks',
  role: 'Roles',
  permission: 'Permissions',
  policy: 'Policies',
  connector: 'Connectors',
  object: 'Objects',
  hook: 'Hooks',
  mapping: 'Mappings',
  analyticsCube: 'Analytics Cubes',
  page: 'Pages',
  theme: 'Themes',
};

function StudioBrand() {
  return (
    <Link
      to="/"
      className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90"
    >
      <Boxes className="h-4 w-4" />
    </Link>
  );
}

function SlashDivider() {
  return <span aria-hidden className="text-muted-foreground/50 select-none">/</span>;
}

export function TopBar({ rightSlot }: { rightSlot?: React.ReactNode } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as {
    package?: string;
    name?: string;
    type?: string;
  };

  const { packages, selectedPackage } = usePackages(params.package);

  const handleSelectPackage = useCallback(
    (pkg: InstalledPackage | null) => {
      if (pkg === null) {
        navigate({ to: '/' });
        return;
      }
      const nextId = pkg.manifest?.id;
      if (!nextId) return;
      navigate({ to: '/$package', params: { package: nextId } });
    },
    [navigate],
  );

  const viewType = useMemo(() => {
    if (location.pathname === '/') return 'home';
    if (params.package && params.name && !params.type) return 'object';
    if (params.package && params.type && params.name) return 'metadata';
    if (params.package) {
      // Flat nav routes: /:pkg/objects, /:pkg/forms, /:pkg/views, …
      const seg = location.pathname
        .replace(new RegExp(`^/+${params.package}/?`), '')
        .replace(/\/.*$/, '');
      if (seg && ['objects', 'forms', 'views', 'automations', 'ai', 'security', 'apis', 'playground', 'logs'].includes(seg)) {
        return `nav:${seg}`;
      }
    }
    if (params.package && !params.name && !params.type) return 'package-overview';
    return 'default';
  }, [location.pathname, params]);

  const NAV_LABELS: Record<string, string> = {
    objects: 'Objects',
    forms: 'Forms',
    views: 'Views & Apps',
    automations: 'Automations',
    ai: 'AI',
    security: 'Security',
    apis: 'APIs',
    playground: 'Playground',
    logs: 'Logs',
  };

  const breadcrumbs = useMemo(() => {
    const items: Array<{ label: string; href?: string }> = [];
    if (viewType.startsWith('nav:')) {
      const key = viewType.slice(4);
      items.push({ label: NAV_LABELS[key] ?? key });
      return items;
    }
    switch (viewType) {
      case 'home':
        items.push({ label: 'Home' });
        break;
      case 'package-overview':
        items.push({ label: 'Overview' });
        break;
      case 'object':
        items.push({ label: 'Objects' });
        if (params.name) items.push({ label: params.name });
        break;
      case 'metadata':
        if (params.type) {
          items.push({ label: META_TYPE_LABELS[params.type] || params.type });
        }
        if (params.name) items.push({ label: params.name });
        break;
      default:
        items.push({ label: 'Studio' });
    }
    return items;
  }, [viewType, params]);

  const apiBadge = useMemo(() => {
    if (viewType === 'object' && params.name) {
      return `/api/v1/data/${params.name}`;
    }
    if (viewType === 'metadata' && params.type && params.name) {
      return `/api/v1/meta/${params.type}/${params.name}`;
    }
    return null;
  }, [viewType, params]);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-2 sm:px-4">
      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
        <div className="sm:hidden">
          <SidebarTrigger className="h-9 w-9" />
        </div>
        <StudioBrand />
        {params.package && (
          <>
            <SlashDivider />
            <div className="hidden sm:flex items-center gap-1.5">
              <PackageSwitcher
                packages={packages}
                selectedPackage={selectedPackage}
                onSelectPackage={handleSelectPackage}
              />
            </div>
          </>
        )}
        <div className="sm:hidden min-w-0 flex-1">
          {breadcrumbs.length > 0 && (
            <span className="text-sm font-medium truncate">
              {breadcrumbs[breadcrumbs.length - 1].label}
            </span>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <Separator orientation="vertical" className="mx-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((item, index) => (
                <div key={index} className="flex items-center">
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem className={index === 0 ? 'hidden md:block' : ''}>
                    {item.href ? (
                      <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="font-medium">{item.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </div>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <div
          className="relative hidden lg:flex items-center cursor-pointer"
          onClick={() => window.dispatchEvent(new CustomEvent('studio:command-palette:open'))}
        >
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search… objects, forms, views"
            className="h-8 w-[260px] pl-8 pr-10 text-sm cursor-pointer"
            readOnly
          />
          <kbd className="absolute right-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
        {apiBadge && (
          <Badge variant="outline" className="font-mono text-[10px] gap-1 hidden sm:flex">
            {apiBadge}
          </Badge>
        )}
        <HmrStatusBadge />
        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
        {rightSlot}
        <UserMenu />
      </div>
      <CommandPalette selectedPackage={selectedPackage} />
    </header>
  );
}
