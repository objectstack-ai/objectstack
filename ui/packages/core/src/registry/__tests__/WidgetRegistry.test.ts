/**
 * Tests for WidgetRegistry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WidgetRegistry } from '../WidgetRegistry';
import { Registry } from '../Registry';
import type { RuntimeWidgetManifest, WidgetRegistryEvent } from '@object-ui/types';

function createManifest(overrides: Partial<RuntimeWidgetManifest> = {}): RuntimeWidgetManifest {
  return {
    name: 'test-widget',
    version: '1.0.0',
    type: 'test',
    label: 'Test Widget',
    source: { type: 'inline', component: () => null },
    ...overrides,
  };
}

describe('WidgetRegistry', () => {
  let widgetRegistry: WidgetRegistry;

  beforeEach(() => {
    widgetRegistry = new WidgetRegistry();
  });

  describe('register / unregister', () => {
    it('registers a widget manifest', () => {
      const manifest = createManifest();
      widgetRegistry.register(manifest);
      expect(widgetRegistry.has('test-widget')).toBe(true);
      expect(widgetRegistry.getManifest('test-widget')).toBe(manifest);
    });

    it('registers multiple manifests at once', () => {
      widgetRegistry.registerAll([
        createManifest({ name: 'a', type: 'a' }),
        createManifest({ name: 'b', type: 'b' }),
      ]);
      expect(widgetRegistry.has('a')).toBe(true);
      expect(widgetRegistry.has('b')).toBe(true);
    });

    it('unregisters a widget', () => {
      widgetRegistry.register(createManifest());
      expect(widgetRegistry.unregister('test-widget')).toBe(true);
      expect(widgetRegistry.has('test-widget')).toBe(false);
    });

    it('returns false when unregistering a non-existent widget', () => {
      expect(widgetRegistry.unregister('nope')).toBe(false);
    });
  });

  describe('getAllManifests / getByCategory', () => {
    it('returns all manifests', () => {
      widgetRegistry.registerAll([
        createManifest({ name: 'a', type: 'a' }),
        createManifest({ name: 'b', type: 'b' }),
      ]);
      expect(widgetRegistry.getAllManifests()).toHaveLength(2);
    });

    it('filters by category', () => {
      widgetRegistry.registerAll([
        createManifest({ name: 'chart-1', type: 'c1', category: 'charts' }),
        createManifest({ name: 'form-1', type: 'f1', category: 'forms' }),
        createManifest({ name: 'chart-2', type: 'c2', category: 'charts' }),
      ]);
      expect(widgetRegistry.getByCategory('charts')).toHaveLength(2);
      expect(widgetRegistry.getByCategory('forms')).toHaveLength(1);
      expect(widgetRegistry.getByCategory('unknown')).toHaveLength(0);
    });
  });

  describe('load', () => {
    it('loads an inline widget', async () => {
      const component = () => null;
      widgetRegistry.register(
        createManifest({ source: { type: 'inline', component } }),
      );

      const resolved = await widgetRegistry.load('test-widget');
      expect(resolved.component).toBe(component);
      expect(resolved.manifest.name).toBe('test-widget');
      expect(resolved.loadedAt).toBeGreaterThan(0);
      expect(widgetRegistry.isLoaded('test-widget')).toBe(true);
    });

    it('returns cached resolved widget on subsequent loads', async () => {
      widgetRegistry.register(createManifest());
      const first = await widgetRegistry.load('test-widget');
      const second = await widgetRegistry.load('test-widget');
      expect(first).toBe(second);
    });

    it('throws when loading an unregistered widget', async () => {
      await expect(widgetRegistry.load('nope')).rejects.toThrow(
        'Widget "nope" is not registered',
      );
    });

    it('loads a widget from the component registry', async () => {
      const componentRegistry = new Registry();
      const component = () => null;
      componentRegistry.register('existing-type', component);

      const reg = new WidgetRegistry({ componentRegistry });
      reg.register(
        createManifest({
          source: { type: 'registry', registryKey: 'existing-type' },
        }),
      );

      const resolved = await reg.load('test-widget');
      expect(resolved.component).toBe(component);
    });

    it('throws when registry key is not found', async () => {
      const componentRegistry = new Registry();
      const reg = new WidgetRegistry({ componentRegistry });
      reg.register(
        createManifest({
          source: { type: 'registry', registryKey: 'missing-key' },
        }),
      );

      await expect(reg.load('test-widget')).rejects.toThrow(
        'references registry key "missing-key"',
      );
    });

    it('throws when no component registry is configured for registry source', async () => {
      widgetRegistry.register(
        createManifest({
          source: { type: 'registry', registryKey: 'something' },
        }),
      );

      await expect(widgetRegistry.load('test-widget')).rejects.toThrow(
        'no component registry is configured',
      );
    });

    it('resolves dependencies before loading', async () => {
      const loadOrder: string[] = [];

      widgetRegistry.register(
        createManifest({
          name: 'dep-a',
          type: 'dep-a',
          source: {
            type: 'inline',
            component: () => {
              loadOrder.push('dep-a');
              return null;
            },
          },
        }),
      );

      widgetRegistry.register(
        createManifest({
          name: 'main',
          type: 'main',
          dependencies: ['dep-a'],
          source: {
            type: 'inline',
            component: () => {
              loadOrder.push('main');
              return null;
            },
          },
        }),
      );

      await widgetRegistry.load('main');
      expect(widgetRegistry.isLoaded('dep-a')).toBe(true);
      expect(widgetRegistry.isLoaded('main')).toBe(true);
    });

    it('syncs loaded widget to component registry', async () => {
      const componentRegistry = new Registry();
      const reg = new WidgetRegistry({ componentRegistry });
      const component = () => null;

      reg.register(
        createManifest({
          name: 'sync-test',
          type: 'custom-type',
          label: 'Sync Test',
          category: 'testing',
          source: { type: 'inline', component },
        }),
      );

      await reg.load('sync-test');

      const synced = componentRegistry.get('custom-type');
      expect(synced).toBe(component);
    });
  });

  describe('loadAll', () => {
    it('loads all registered widgets', async () => {
      widgetRegistry.registerAll([
        createManifest({ name: 'a', type: 'a' }),
        createManifest({ name: 'b', type: 'b' }),
      ]);

      const results = await widgetRegistry.loadAll();
      expect(results).toHaveLength(2);
      expect(results.every((r) => !(r.result instanceof Error))).toBe(true);
    });

    it('captures errors for failed widgets', async () => {
      widgetRegistry.register(createManifest({ name: 'good', type: 'good' }));
      widgetRegistry.register(
        createManifest({
          name: 'bad',
          type: 'bad',
          source: { type: 'registry', registryKey: 'missing' },
        }),
      );

      const results = await widgetRegistry.loadAll();
      const bad = results.find((r) => r.name === 'bad');
      expect(bad?.result).toBeInstanceOf(Error);
    });
  });

  describe('events', () => {
    it('emits widget:registered event', () => {
      const events: WidgetRegistryEvent[] = [];
      widgetRegistry.on((e) => events.push(e));

      widgetRegistry.register(createManifest());

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('widget:registered');
    });

    it('emits widget:unregistered event', () => {
      widgetRegistry.register(createManifest());

      const events: WidgetRegistryEvent[] = [];
      widgetRegistry.on((e) => events.push(e));

      widgetRegistry.unregister('test-widget');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('widget:unregistered');
    });

    it('emits widget:loaded event', async () => {
      widgetRegistry.register(createManifest());

      const events: WidgetRegistryEvent[] = [];
      widgetRegistry.on((e) => events.push(e));

      await widgetRegistry.load('test-widget');

      expect(events.some((e) => e.type === 'widget:loaded')).toBe(true);
    });

    it('emits widget:error event on load failure', async () => {
      widgetRegistry.register(
        createManifest({
          source: { type: 'registry', registryKey: 'missing' },
        }),
      );

      const events: WidgetRegistryEvent[] = [];
      widgetRegistry.on((e) => events.push(e));

      await widgetRegistry.load('test-widget').catch(() => {});

      expect(events.some((e) => e.type === 'widget:error')).toBe(true);
    });

    it('supports unsubscribing from events', () => {
      const handler = vi.fn();
      const unsub = widgetRegistry.on(handler);

      widgetRegistry.register(createManifest({ name: 'a', type: 'a' }));
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      widgetRegistry.register(createManifest({ name: 'b', type: 'b' }));
      expect(handler).toHaveBeenCalledTimes(1); // No new calls
    });
  });

  describe('clear / getStats', () => {
    it('clears all widgets', async () => {
      widgetRegistry.register(createManifest());
      await widgetRegistry.load('test-widget');

      widgetRegistry.clear();

      expect(widgetRegistry.has('test-widget')).toBe(false);
      expect(widgetRegistry.isLoaded('test-widget')).toBe(false);
    });

    it('returns correct stats', () => {
      widgetRegistry.registerAll([
        createManifest({ name: 'a', type: 'a', category: 'charts' }),
        createManifest({ name: 'b', type: 'b', category: 'forms' }),
        createManifest({ name: 'c', type: 'c', category: 'charts' }),
      ]);

      const stats = widgetRegistry.getStats();
      expect(stats.registered).toBe(3);
      expect(stats.loaded).toBe(0);
      expect(stats.categories).toContain('charts');
      expect(stats.categories).toContain('forms');
      expect(stats.categories).toHaveLength(2);
    });
  });
});
