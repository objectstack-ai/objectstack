/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


import { describe, it, expect } from 'vitest';
import { kanbanComponents } from '@object-ui/plugin-kanban';
import { chartComponents } from '@object-ui/plugin-charts';
import { ComponentRegistry } from '@object-ui/core';

describe('Plugin Integration Protocol', () => {
  describe('Kanban Plugin', () => {
    it('should export components object for manual registration', () => {
      expect(kanbanComponents).toBeDefined();
      expect(kanbanComponents['object-kanban']).toBeDefined();
    });

    it('should contain valid React component', () => {
      const Component = kanbanComponents['object-kanban'];
      expect(typeof Component).toBe('function'); // React components are functions
    });

    /**
     * Control for the re-key above (objectui#8802 / objectui#8257).
     *
     * This map published a bare `kanban` key until those two cards retired the
     * `kanban`, `kanban-ui` and `kanban-enhanced` node type keys. Asserting the
     * surviving key on its own would pass just as well against a map that had
     * merely been renamed wholesale, so pin BOTH directions: the new key
     * resolves to a component, and the retired spellings resolve to nothing.
     * `kanbanComponents` is the manual-registration face a host copies keys
     * from, so a retired key silently reappearing here would re-teach it.
     */
    it('publishes only the surviving `object-kanban` key', () => {
      expect(Object.keys(kanbanComponents)).toEqual(['object-kanban']);
      const retired = kanbanComponents as Record<string, unknown>;
      expect(retired.kanban).toBeUndefined();
      expect(retired['kanban-ui']).toBeUndefined();
      expect(retired['kanban-enhanced']).toBeUndefined();
    });
  });

  describe('Charts Plugin', () => {
    it('should export component objects for manual registration', () => {
      expect(chartComponents).toBeDefined();
      expect(chartComponents['bar-chart']).toBeDefined();
      expect(chartComponents['chart']).toBeDefined();
    });

    it('should export correctly named "bar-chart" key matching schema usage', () => {
      // Critical check for the bug we fixed (type mismatch)
      expect(Object.keys(chartComponents)).toContain('bar-chart');
      expect(chartComponents['bar-chart']).toBeDefined();
    });
  });

  describe('Manual Registration Simulation', () => {
    it('should successfully register kanban via manual components', () => {
      // Clear registry to simulate clean state
      // Note: In a real app we wouldn't clear, but here we want to prove registration works
      
      // Act: Manually register
      if (kanbanComponents?.['object-kanban']) {
         ComponentRegistry.register('test-kanban-manual', kanbanComponents['object-kanban']);
      }

      // Assert
      expect(ComponentRegistry.get('test-kanban-manual')).toBeDefined();
    });
    
     it('should successfully register bar-chart via manual components', () => {
      if (chartComponents?.['bar-chart']) {
         ComponentRegistry.register('test-bar-chart-manual', chartComponents['bar-chart']);
      }

      expect(ComponentRegistry.get('test-bar-chart-manual')).toBeDefined();
    });
  });
});
