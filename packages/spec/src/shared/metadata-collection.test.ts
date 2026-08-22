// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  normalizeMetadataCollection,
  normalizeStackInput,
  normalizePluginMetadata,
  MAP_SUPPORTED_FIELDS,
  METADATA_ALIASES,
  PLURAL_TO_SINGULAR,
  SINGULAR_TO_PLURAL,
  pluralToSingular,
  singularToPlural,
} from './metadata-collection.zod';

describe('normalizeMetadataCollection', () => {
  describe('pass-through (no-op) cases', () => {
    it('should return null as-is', () => {
      expect(normalizeMetadataCollection(null)).toBeNull();
    });

    it('should return undefined as-is', () => {
      expect(normalizeMetadataCollection(undefined)).toBeUndefined();
    });

    it('should return an array as-is', () => {
      const arr = [{ name: 'task', fields: {} }];
      expect(normalizeMetadataCollection(arr)).toBe(arr); // same reference
    });

    it('should return an empty array as-is', () => {
      const arr: unknown[] = [];
      expect(normalizeMetadataCollection(arr)).toBe(arr);
    });
  });

  describe('map → array conversion', () => {
    it('should convert a map to an array with key as name', () => {
      const input = {
        account: { label: 'Account' },
        contact: { label: 'Contact' },
      };
      const result = normalizeMetadataCollection(input);
      expect(result).toEqual([
        { name: 'account', label: 'Account' },
        { name: 'contact', label: 'Contact' },
      ]);
    });

    it('should convert an empty map to an empty array', () => {
      expect(normalizeMetadataCollection({})).toEqual([]);
    });

    it('should convert a single-entry map', () => {
      const result = normalizeMetadataCollection({
        task: { fields: { title: { type: 'text' } } },
      });
      expect(result).toEqual([
        { name: 'task', fields: { title: { type: 'text' } } },
      ]);
    });
  });

  describe('name field precedence', () => {
    it('should use existing name from value (value takes precedence over key)', () => {
      const result = normalizeMetadataCollection({
        my_key: { name: 'actual_name', label: 'Test' },
      });
      expect(result).toEqual([
        { name: 'actual_name', label: 'Test' },
      ]);
    });

    it('should inject key only when name is missing', () => {
      const result = normalizeMetadataCollection({
        task: { label: 'Task' },
      });
      expect(result).toEqual([
        { name: 'task', label: 'Task' },
      ]);
    });

    it('should inject key when name is undefined', () => {
      const result = normalizeMetadataCollection({
        task: { name: undefined, label: 'Task' },
      });
      expect(result).toEqual([
        { name: 'task', label: 'Task' },
      ]);
    });

    it('should not overwrite an empty string name', () => {
      // Empty string is a "present" value — it's the user's choice (Zod will validate it)
      const result = normalizeMetadataCollection({
        task: { name: '', label: 'Task' },
      });
      expect(result).toEqual([
        { name: '', label: 'Task' },
      ]);
    });
  });

  describe('custom keyField', () => {
    it('should inject key into a custom field', () => {
      const result = normalizeMetadataCollection(
        { contact: { fields: {} } },
        'extend',
      );
      expect(result).toEqual([
        { extend: 'contact', fields: {} },
      ]);
    });

    it('should not overwrite existing custom field', () => {
      const result = normalizeMetadataCollection(
        { my_key: { extend: 'existing', fields: {} } },
        'extend',
      );
      expect(result).toEqual([
        { extend: 'existing', fields: {} },
      ]);
    });
  });

  describe('edge cases', () => {
    it('should handle non-object map values gracefully', () => {
      // Unusual case — let Zod handle the error downstream
      const result = normalizeMetadataCollection({
        bad: 'not an object',
      });
      expect(result).toEqual(['not an object']);
    });

    it('should preserve nested objects without modification', () => {
      const result = normalizeMetadataCollection({
        task: {
          label: 'Task',
          fields: {
            title: { type: 'text', label: 'Title' },
            status: { type: 'select', label: 'Status' },
          },
        },
      });
      expect(result).toEqual([
        {
          name: 'task',
          label: 'Task',
          fields: {
            title: { type: 'text', label: 'Title' },
            status: { type: 'select', label: 'Status' },
          },
        },
      ]);
    });

    it('should preserve order of map entries', () => {
      const result = normalizeMetadataCollection({
        alpha: { label: 'Alpha' },
        beta: { label: 'Beta' },
        gamma: { label: 'Gamma' },
      }) as Array<{ name: string }>;
      expect(result.map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma']);
    });
  });
});

describe('normalizeStackInput', () => {
  it('should normalize map-formatted metadata fields to arrays', () => {
    const input = {
      manifest: { id: 'test', name: 'test', version: '1.0.0', type: 'app' },
      objects: {
        task: { fields: { title: { type: 'text' } } },
      },
      apps: {
        project_manager: { label: 'PM' },
      },
    };

    const result = normalizeStackInput(input);

    expect(result.manifest).toBe(input.manifest); // non-metadata fields unchanged
    expect(result.objects).toEqual([
      { name: 'task', fields: { title: { type: 'text' } } },
    ]);
    expect(result.apps).toEqual([
      { name: 'project_manager', label: 'PM' },
    ]);
  });

  it('should leave array-formatted fields unchanged', () => {
    const input = {
      objects: [{ name: 'task', fields: {} }],
      apps: [{ name: 'sales', label: 'Sales' }],
    };

    const result = normalizeStackInput(input);
    expect(result.objects).toBe(input.objects); // same reference
    expect(result.apps).toBe(input.apps);
  });

  it('should handle mixed array and map formats', () => {
    const input = {
      objects: { task: { fields: { title: { type: 'text' } } } }, // map
      apps: [{ name: 'sales', label: 'Sales' }], // array
      views: [{ list: { type: 'grid' } }], // not in MAP_SUPPORTED_FIELDS if ViewSchema doesn't have name
    };

    const result = normalizeStackInput(input);
    expect(Array.isArray(result.objects)).toBe(true);
    expect(result.apps).toBe(input.apps);
    expect(result.views).toBe(input.views);
  });

  it('should not modify fields not in MAP_SUPPORTED_FIELDS', () => {
    const input = {
      manifest: { id: 'test' },
      i18n: { defaultLocale: 'en' },
      plugins: ['@objectstack/plugin-dev'],
      views: [{ list: { type: 'grid' } }],
    };

    const result = normalizeStackInput(input);
    expect(result.manifest).toBe(input.manifest);
    expect(result.i18n).toBe(input.i18n);
    expect(result.plugins).toBe(input.plugins);
    expect(result.views).toBe(input.views);
  });

  it('should handle an empty input', () => {
    expect(normalizeStackInput({})).toEqual({});
  });

  it('should handle undefined metadata fields', () => {
    const input = { objects: undefined, apps: undefined };
    const result = normalizeStackInput(input);
    expect(result.objects).toBeUndefined();
    expect(result.apps).toBeUndefined();
  });
});

describe('MAP_SUPPORTED_FIELDS', () => {
  it('should contain only fields that exist on ObjectStackDefinitionSchema', () => {
    // Sanity check — these are the fields we expect to support map format
    expect(MAP_SUPPORTED_FIELDS).toContain('objects');
    expect(MAP_SUPPORTED_FIELDS).toContain('apps');
    expect(MAP_SUPPORTED_FIELDS).toContain('pages');
    expect(MAP_SUPPORTED_FIELDS).toContain('dashboards');
    expect(MAP_SUPPORTED_FIELDS).toContain('reports');
    expect(MAP_SUPPORTED_FIELDS).toContain('actions');
    // 'themes' left the list at #10485 (ADR-0049 — carrier retired).
    expect(MAP_SUPPORTED_FIELDS).toContain('flows');
    expect(MAP_SUPPORTED_FIELDS).toContain('positions');
    expect(MAP_SUPPORTED_FIELDS).toContain('permissions');
    expect(MAP_SUPPORTED_FIELDS).toContain('datasources');
    expect(MAP_SUPPORTED_FIELDS).toContain('connectors');
  });

  it('should NOT contain fields without a name identifier', () => {
    expect(MAP_SUPPORTED_FIELDS).not.toContain('views');
    expect(MAP_SUPPORTED_FIELDS).not.toContain('objectExtensions');
    expect(MAP_SUPPORTED_FIELDS).not.toContain('data');
    expect(MAP_SUPPORTED_FIELDS).not.toContain('translations');
    expect(MAP_SUPPORTED_FIELDS).not.toContain('plugins');
    expect(MAP_SUPPORTED_FIELDS).not.toContain('devPlugins');
  });
});

describe('METADATA_ALIASES', () => {
  it('should map triggers to hooks', () => {
    expect(METADATA_ALIASES.triggers).toBe('hooks');
  });
});

describe('PLURAL_TO_SINGULAR / SINGULAR_TO_PLURAL', () => {
  it('should cover every entry in MAP_SUPPORTED_FIELDS', () => {
    for (const field of MAP_SUPPORTED_FIELDS) {
      expect(PLURAL_TO_SINGULAR).toHaveProperty(field);
    }
  });

  it('should map standard plural forms correctly', () => {
    expect(PLURAL_TO_SINGULAR['objects']).toBe('object');
    expect(PLURAL_TO_SINGULAR['apps']).toBe('app');
    expect(PLURAL_TO_SINGULAR['actions']).toBe('action');
    expect(PLURAL_TO_SINGULAR['flows']).toBe('flow');
    expect(PLURAL_TO_SINGULAR['agents']).toBe('agent');
    expect(PLURAL_TO_SINGULAR['dashboards']).toBe('dashboard');
  });

  it('should map irregular plural forms correctly', () => {
    expect(PLURAL_TO_SINGULAR['sharingRules']).toBe('sharing_rule');
    expect(PLURAL_TO_SINGULAR['analyticsCubes']).toBe('analytics_cube');
    expect(PLURAL_TO_SINGULAR['ragPipelines']).toBe('rag_pipeline');
  });

  it('should have a reverse map that is consistent', () => {
    for (const [plural, singular] of Object.entries(PLURAL_TO_SINGULAR)) {
      expect(SINGULAR_TO_PLURAL[singular]).toBe(plural);
    }
  });
});

describe('pluralToSingular', () => {
  it('should convert known plural to singular', () => {
    expect(pluralToSingular('apps')).toBe('app');
    expect(pluralToSingular('sharingRules')).toBe('sharing_rule');
  });

  it('should return unknown keys unchanged', () => {
    expect(pluralToSingular('unknown')).toBe('unknown');
    expect(pluralToSingular('object')).toBe('object');
  });
});

describe('singularToPlural', () => {
  it('should convert known singular to plural', () => {
    expect(singularToPlural('app')).toBe('apps');
    expect(singularToPlural('sharing_rule')).toBe('sharingRules');
  });

  it('should return unknown keys unchanged', () => {
    expect(singularToPlural('unknown')).toBe('unknown');
    expect(singularToPlural('objects')).toBe('objects');
  });
});

describe('normalizePluginMetadata', () => {
  describe('map → array conversion', () => {
    it('should convert map-formatted actions to an array', () => {
      const result = normalizePluginMetadata({
        actions: {
          lead_convert: { type: 'custom', label: 'Convert Lead' },
        },
      });
      expect(result.actions).toEqual([
        { name: 'lead_convert', type: 'custom', label: 'Convert Lead' },
      ]);
    });

    it('should convert map-formatted flows to an array', () => {
      const result = normalizePluginMetadata({
        flows: {
          auto_assign: { label: 'Auto Assign' },
        },
      });
      expect(result.flows).toEqual([
        { name: 'auto_assign', label: 'Auto Assign' },
      ]);
    });

    it('should leave array-formatted collections unchanged', () => {
      const actions = [{ name: 'convert', type: 'custom' }];
      const result = normalizePluginMetadata({ actions });
      expect(result.actions).toBe(actions);
    });

    it('should handle multiple map-formatted collections at once', () => {
      const result = normalizePluginMetadata({
        actions: { a: { label: 'A' } },
        flows: { f: { label: 'F' } },
        hooks: { h: { object: 'lead' } },
      });
      expect(result.actions).toEqual([{ name: 'a', label: 'A' }]);
      expect(result.flows).toEqual([{ name: 'f', label: 'F' }]);
      expect(result.hooks).toEqual([{ name: 'h', object: 'lead' }]);
    });
  });

  describe('alias resolution (triggers → hooks)', () => {
    it('should rename triggers to hooks', () => {
      const result = normalizePluginMetadata({
        triggers: {
          lead_scoring: { object: 'lead', event: 'afterInsert' },
        },
      });
      expect(result.hooks).toEqual([
        { name: 'lead_scoring', object: 'lead', event: 'afterInsert' },
      ]);
      expect(result.triggers).toBeUndefined();
    });

    it('should merge triggers into existing hooks (array)', () => {
      const result = normalizePluginMetadata({
        hooks: [{ name: 'existing_hook', object: 'account' }],
        triggers: {
          new_trigger: { object: 'lead', event: 'afterInsert' },
        },
      });
      expect(result.hooks).toEqual([
        { name: 'existing_hook', object: 'account' },
        { name: 'new_trigger', object: 'lead', event: 'afterInsert' },
      ]);
      expect(result.triggers).toBeUndefined();
    });

    it('should merge triggers into existing hooks (map)', () => {
      const result = normalizePluginMetadata({
        hooks: { existing_hook: { object: 'account' } },
        triggers: { new_trigger: { object: 'lead' } },
      });
      expect(result.hooks).toEqual([
        { name: 'existing_hook', object: 'account' },
        { name: 'new_trigger', object: 'lead' },
      ]);
      expect(result.triggers).toBeUndefined();
    });
  });

  describe('recursive nested plugin normalization', () => {
    it('should recursively normalize nested plugins', () => {
      const result = normalizePluginMetadata({
        actions: { a1: { label: 'Root Action' } },
        plugins: [
          {
            actions: { nested_action: { label: 'Nested' } },
            triggers: { nested_trigger: { object: 'contact' } },
          },
          'string-plugin-ref', // string refs should pass through
        ],
      });

      expect(result.actions).toEqual([{ name: 'a1', label: 'Root Action' }]);
      expect(result.plugins).toHaveLength(2);

      const nestedPlugin = result.plugins[0] as Record<string, unknown>;
      expect(nestedPlugin.actions).toEqual([{ name: 'nested_action', label: 'Nested' }]);
      expect(nestedPlugin.hooks).toEqual([{ name: 'nested_trigger', object: 'contact' }]);
      expect(nestedPlugin.triggers).toBeUndefined();

      expect(result.plugins[1]).toBe('string-plugin-ref');
    });
  });

  describe('pass-through / edge cases', () => {
    it('should not modify non-metadata fields', () => {
      const result = normalizePluginMetadata({
        manifest: { name: 'test', version: '1.0.0' },
        actions: { a: { label: 'A' } },
      });
      expect(result.manifest).toEqual({ name: 'test', version: '1.0.0' });
    });

    it('should handle empty input', () => {
      expect(normalizePluginMetadata({})).toEqual({});
    });

    it('should handle input with no metadata collections', () => {
      const input = { manifest: { name: 'test' }, i18n: { defaultLocale: 'en' } };
      const result = normalizePluginMetadata(input);
      expect(result.manifest).toBe(input.manifest);
      expect(result.i18n).toBe(input.i18n);
    });

    it('should handle undefined metadata fields', () => {
      const result = normalizePluginMetadata({ actions: undefined, hooks: undefined });
      expect(result.actions).toBeUndefined();
      expect(result.hooks).toBeUndefined();
    });
  });
});
