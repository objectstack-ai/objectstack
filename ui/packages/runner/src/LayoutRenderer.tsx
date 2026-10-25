/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import type { AppComponentSchema } from '@object-ui/types';
import {
  Bell,
  Box,
  ChevronDown,
  Menu,
  Moon,
  Search,
  Sun,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  getLazyIcon,
} from '@object-ui/components';

interface LayoutRendererProps {
  app: AppComponentSchema;
  children: React.ReactNode;
  currentPath?: string;
  onNavigate?: (path: string) => void;
}

// Helper to resolve icon from string name (e.g. "bar-chart" -> "BarChart")
// Delegates to the shared lazy icon resolver so we don't ship the entire
// lucide-react namespace for the few icons rendered by user schemas.
//
// `getLazyIcon` memoises per name in a module-level cache, so the component
// this returns is a stable reference across renders — not a component created
// during render. `react-hooks/static-components` cannot see through the call,
// hence the targeted disables at the JSX sites below.
const getIcon = (name?: string) => {
  if (!name) return null;
  return getLazyIcon(name);
};

const NavItem = ({ item, currentPath, isSidebarOpen, onNavigate, level = 0 }: any) => {
  const isActive = currentPath === item.path;
  const hasActiveChild = item.children?.some((child: any) => child.path === currentPath);
  const [isOpen, setIsOpen] = React.useState(hasActiveChild);
  const Icon = getIcon(item.icon);

  // Auto-expand if child is active
  React.useEffect(() => {
    if (hasActiveChild) setIsOpen(true);
  }, [hasActiveChild]);

  if (item.children && item.children.length > 0) {
     return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
            <CollapsibleTrigger className={`flex w-full items-center justify-between py-2 text-sm font-medium rounded-md transition-colors text-muted-foreground hover:bg-muted hover:text-foreground ${isSidebarOpen ? 'px-3' : 'justify-center px-2 cursor-pointer'}`}>
                 <div className="flex items-center overflow-hidden">
                    {Icon && (
                        // eslint-disable-next-line react-hooks/static-components -- getLazyIcon returns a module-cached stable component per name, not one created during render
                        <Icon className={`h-4 w-4 shrink-0 ${isSidebarOpen ? 'mr-3' : ''}`} />
                    )}
                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0 hidden'}`}>
                        {item.label}
                    </span>
                 </div>
                 {isSidebarOpen && (
                     <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                 )}
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                 {isSidebarOpen && item.children.map((child: any, idx: number) => (
                     <NavItem 
                        key={idx} 
                        item={child} 
                        currentPath={currentPath}
                        isSidebarOpen={isSidebarOpen}
                        onNavigate={onNavigate}
                        level={level + 1}
                     />
                 ))}
            </CollapsibleContent>
        </Collapsible>
     );
  }

  return (
    <a 
      href={item.path || '#'}
      onClick={(e) => item.path && onNavigate(e, item.path)}
      title={!isSidebarOpen ? item.label : undefined}
      className={`flex items-center py-2 text-sm font-medium rounded-md transition-colors ${
        isActive 
          ? 'bg-primary text-primary-foreground' 
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      } ${isSidebarOpen ? 'px-3' : 'justify-center px-2'} ${level > 0 && isSidebarOpen ? 'pl-10' : ''}`}
    >
      {Icon && (
        // eslint-disable-next-line react-hooks/static-components -- getLazyIcon returns a module-cached stable component per name, not one created during render
        <Icon className={`h-4 w-4 shrink-0 ${isSidebarOpen ? 'mr-3' : ''} ${isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
      )}
      <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0 hidden'}`}>
        {item.label}
      </span>
    </a>
  );
};

export const LayoutRenderer = ({ app, children, currentPath, onNavigate }: LayoutRendererProps) => {
  const layout = app.layout || 'sidebar';
  const [isSidbarOpen, setSidebarOpen] = React.useState(true);
  
  // Theme management
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
      const isDark = localStorage.getItem('theme') === 'dark' || 
          (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
      setTheme(isDark ? 'dark' : 'light');
  }, []);

  React.useEffect(() => {
      if (theme === 'dark') {
          document.documentElement.classList.add('dark');
          localStorage.setItem('theme', 'dark');
      } else {
          document.documentElement.classList.remove('dark');
          localStorage.setItem('theme', 'light');
      }
  }, [theme]);

  const toggleTheme = () => {
      setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    if (onNavigate) {
      onNavigate(path);
    } else {
      window.location.href = path;
    }
  };

  if (layout === 'empty') {
    return <main className={app.className}>{children}</main>;
  }

  // The app logo is `branding.logo`, an image URL (objectui#10827), and an
  // icon NAME comes from `icon`. The retired top-level `logo` carried both,
  // told apart by sniffing for `/` or `.`; nothing reads it now.
  const logo = app.branding?.logo;
  const LogoIcon = getIcon(app.icon);

  return (
    <div className={`flex min-h-screen w-full bg-background ${app.className || ''}`}>
      {/* Sidebar - Only if configured */}
      {layout === 'sidebar' && (
        <aside 
            className={`
                shrink-0 border-r bg-background hidden md:flex flex-col h-screen sticky top-0 z-30 transition-all duration-300 ease-in-out
                ${isSidbarOpen ? 'w-64' : 'w-[70px]'}
            `}
        >
          <div className={`h-14 flex items-center border-b font-semibold text-lg tracking-tight transition-all ${isSidbarOpen ? 'px-6' : 'justify-center px-0'}`}>
            {logo ? (
              <img src={logo} alt={app.title} className="h-6 w-auto" />
            ) : LogoIcon ? (
              // eslint-disable-next-line react-hooks/static-components -- getLazyIcon returns a module-cached stable component per name, not one created during render
              <LogoIcon className="h-6 w-6" />
            ) : <Box className="h-6 w-6" />}
            
            <span className={`ml-2 whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidbarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0 hidden'}`}>
                {app.title || app.name || 'Object UI'}
            </span>
          </div>
          <nav className="flex-1 p-2 space-y-1 overflow-y-auto overflow-x-hidden">
            {app.menu?.map((item, index) => (
              <NavItem 
                key={index} 
                item={item} 
                currentPath={currentPath}
                isSidebarOpen={isSidbarOpen} 
                onNavigate={handleNavClick} 
              />
            ))}
          </nav>
        </aside>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header - Always shown in sidebar/header layouts */}
        <header className="h-14 flex items-center justify-between px-4 md:px-6 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b z-20 sticky top-0">
           <div className="flex items-center gap-4">
             {/* Toggle Sidebar Button */}
             <button type="button" 
                onClick={() => setSidebarOpen(!isSidbarOpen)}
                className="p-2 -ml-2 text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
             >
                <Menu className="h-5 w-5" />
             </button>

             {/* Breadcrumbs placeholder or Search */}
             <div className="relative hidden md:block w-96">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <input 
                  type="text" 
                  placeholder="Search..." 
                  className="w-full h-9 pl-9 pr-4 rounded-md border border-input bg-background text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
             </div>
           </div>
           <div className="flex items-center gap-2">
             {/* Theme Toggle */}
             <button type="button" 
               onClick={toggleTheme}
               className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
               title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
             >
               {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
             </button>

             {/*
               * The Bell is unconditional (objectui#7469, maintainer ruling C). It used
               * to be a fallback drawn only when the app's `actions` array authored no
               * `'button'` entry; that free-form array and its `'user'` avatar menu are
               * retired on both faces of `@object-ui/types`, so this chrome reads no
               * app metadata here any more and keeps one rule. The contract's one
               * channel for app-level actions is a `navigation` item of
               * `type: 'action'`, which the console sidebar dispatches; this runner
               * draws the legacy `menu` only and renders no `navigation` item. Pinned
               * in `__tests__/LayoutRenderer.chrome-7469.test.tsx`.
               */}
             <button type="button" className="relative p-2 text-muted-foreground hover:text-foreground transition-colors">
                <Bell className="h-5 w-5" />
                <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-red-600 rounded-full border-2 border-background"></span>
             </button>
           </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-4 md:p-8 scroll-smooth">
          <div className="mx-auto max-w-7xl animate-in fade-in slide-in-from-bottom-4 duration-500">
             {children}
          </div>
        </main>
      </div>
    </div>
  );
};
