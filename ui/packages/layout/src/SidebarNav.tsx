import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  Badge,
  Input,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@object-ui/components';
import { ChevronRight, Search } from 'lucide-react';

/**
 * The classes this file's sidebar group label carries so that, once the
 * sidebar collapses to icons, the hidden label is nothing a screen reader
 * announces and no keyboard focus stop (objectui#12795). The
 * `SidebarGroupLabel` primitive draws it at `opacity-0` there, which leaves it
 * in the accessibility tree; `invisible` takes it out, under the primitive's
 * own hiding condition, so the expanded sidebar is unchanged. `visibility`
 * joins the primitive's transition list under the same condition, so the label
 * still fades out before it is hidden. `NavigationRenderer` documents the pair
 * in full, and a pin enumerates every `SidebarGroupLabel` call site.
 * The primitive is Shadcn-synced and never edited (AGENTS.md #7), so the pair
 * rides on the call site's `className`. Module-local on purpose: `index.ts`
 * re-exports this file whole.
 */
const HIDDEN_ICON_LABEL_NOT_FOCUSABLE =
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:invisible ' +
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:transition-[margin,opacity,visibility]';

export interface NavItem {
  title: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeVariant?: 'default' | 'destructive' | 'outline';
  children?: NavItem[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface SidebarNavProps {
    items: NavItem[] | NavGroup[];
    title?: string;
    className?: string;
    collapsible?: "offcanvas" | "icon" | "none";
    searchEnabled?: boolean;
    searchPlaceholder?: string;
}

function isNavGroup(item: NavItem | NavGroup): item is NavGroup {
  return 'items' in item && !('href' in item);
}

function NavItemRenderer({ item, pathname }: { item: NavItem; pathname: string }) {
  if (item.children && item.children.length > 0) {
    return (
      <Collapsible asChild defaultOpen className="group/collapsible">
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              tooltip={item.title}
              className="motion-safe:transition-colors motion-safe:duration-150"
            >
              {item.icon && <item.icon />}
              <span>{item.title}</span>
              {item.badge != null && (
                <Badge variant={item.badgeVariant || 'default'} className="ml-auto mr-1 h-5 min-w-5 px-1 text-xs">
                  {item.badge}
                </Badge>
              )}
              <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent className="motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:slide-out-to-top-1 motion-safe:data-[state=open]:slide-in-from-top-1 motion-safe:duration-150">
            <SidebarMenuSub>
              {item.children.map((child) => (
                <SidebarMenuSubItem key={child.href}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={pathname === child.href}
                    className="motion-safe:transition-colors motion-safe:duration-150"
                  >
                    <NavLink to={child.href}>
                      {child.icon && <child.icon />}
                      <span>{child.title}</span>
                      {child.badge != null && (
                        <Badge variant={child.badgeVariant || 'default'} className="ml-auto h-5 min-w-5 px-1 text-xs">
                          {child.badge}
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={pathname === item.href}
        tooltip={item.title}
        // Smooth the active-state colour swap so navigating between rows
        // feels gliding rather than instant. Tailwind core duration tokens.
        className="motion-safe:transition-colors motion-safe:duration-150"
      >
        <NavLink to={item.href}>
          {item.icon && <item.icon />}
          <span>{item.title}</span>
          {item.badge != null && (
            <Badge variant={item.badgeVariant || 'default'} className="ml-auto h-5 min-w-5 px-1 text-xs">
              {item.badge}
            </Badge>
          )}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SidebarNav({ items, title = "Application", className, collapsible = "icon", searchEnabled = false, searchPlaceholder = "Search…" }: SidebarNavProps) {
  const location = useLocation();
  const [search, setSearch] = React.useState('');

  const flatItems: Array<{ groupLabel?: string; items: NavItem[] }> = React.useMemo(() => {
    if (items.length === 0) return [];
    if (isNavGroup(items[0])) {
      return (items as NavGroup[]).map(g => ({ groupLabel: g.label, items: g.items }));
    }
    return [{ items: items as NavItem[] }];
  }, [items]);

  const filteredGroups = React.useMemo(() => {
    if (!search) return flatItems;
    const lowerSearch = search.toLowerCase();
    return flatItems.map(group => ({
      ...group,
      items: group.items.filter(item =>
        item.title.toLowerCase().includes(lowerSearch) ||
        item.children?.some(child => child.title.toLowerCase().includes(lowerSearch))
      ),
    })).filter(group => group.items.length > 0);
  }, [flatItems, search]);

  return (
    <Sidebar className={className} collapsible={collapsible}>
      <SidebarContent>
        {searchEnabled && (
          <div className="px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
        )}
        {filteredGroups.map((group, gIdx) => (
          <SidebarGroup key={group.groupLabel || gIdx}>
            {gIdx > 0 && (
              <div className="mx-3 mb-1 h-px bg-sidebar-border/60" aria-hidden />
            )}
            <SidebarGroupLabel className={`text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 ${HIDDEN_ICON_LABEL_NOT_FOCUSABLE}`}>
              {group.groupLabel || title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavItemRenderer key={item.href} item={item} pathname={location.pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
