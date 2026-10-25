'use client';

import { useEffect, useState } from 'react';

type PluginName = 
  | 'editor'
  | 'charts'
  | 'dashboard'
  | 'kanban'
  | 'markdown'
  | 'timeline'
  | 'calendar'
  | 'gantt'
  | 'map'
  | 'chatbot'
  | 'form'
  | 'grid'
  | 'view';

interface PluginLoaderProps {
  plugins: PluginName[];
  children: React.ReactNode;
}

/**
 * PluginLoader component - Loads specific plugins on-demand
 * 
 * Usage in MDX files:
 * ```mdx
 * import { PluginLoader } from '@/app/components/PluginLoader';
 * 
 * <PluginLoader plugins={['grid']}>
 *   <InteractiveDemo schema={{...}} />
 * </PluginLoader>
 * ```
 */
export function PluginLoader({ plugins, children }: PluginLoaderProps) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadPlugins = async () => {
      // On server side, skip actual imports but mark as loaded to avoid hydration mismatch
      if (typeof window === 'undefined') {
        if (!cancelled) {
          setLoaded(true);
        }
        return;
      }

      try {
        // Dynamically import plugins based on the list
        const imports = plugins.map(async (plugin) => {
          switch (plugin) {
            case 'editor':
              return import('@object-ui/plugin-editor');
            case 'charts':
              return import('@object-ui/plugin-charts');
            case 'dashboard':
              return import('@object-ui/plugin-dashboard');
            case 'kanban':
              return import('@object-ui/plugin-kanban');
            case 'markdown':
              return import('@object-ui/plugin-markdown');
            case 'timeline':
              return import('@object-ui/plugin-timeline');
            case 'calendar':
              return import('@object-ui/plugin-calendar');
            case 'gantt':
              return import('@object-ui/plugin-gantt');
            case 'map':
              return import('@object-ui/plugin-map');
            case 'chatbot':
              return import('@object-ui/plugin-chatbot');
            case 'form':
              return import('@object-ui/plugin-form');
            case 'grid':
              return import('@object-ui/plugin-grid');
            case 'view':
              return import('@object-ui/plugin-view');
            default:
              console.warn(`Unknown plugin: ${plugin}`);
              return Promise.resolve();
          }
        });

        await Promise.all(imports);
        if (!cancelled) {
          setLoaded(true);
        }
      } catch (error) {
        console.error('Failed to load plugins:', error);
        if (!cancelled) {
          setLoaded(true); // Still render children even if plugin loading fails
        }
      }
    };

    loadPlugins();

    return () => {
      cancelled = true;
    };
  }, [plugins]);

  if (!loaded) {
    return <div className="p-6 text-center text-muted-foreground">Loading plugins...</div>;
  }

  return <>{children}</>;
}
