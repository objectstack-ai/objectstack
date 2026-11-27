// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Performance Benchmark Suite for @objectstack/spec
 *
 * Measures schema parse/validate performance across all protocol domains.
 * Run with: npx vitest bench
 */

import { bench, describe } from 'vitest';
// Benchmark uses `as any` for schema access since schemas use Object.assign
// patterns that complicate direct typing. This is acceptable for benchmarks.
import * as Data from './data';
import * as UI from './ui';
import * as Kernel from './kernel';
import * as API from './api';
import * as AI from './ai';

// ─── Data Domain Benchmarks ─────────────────────────────────────────

describe('Data Domain — Schema Parse Performance', () => {
  const validObject = {
    name: 'benchmark_object',
    label: 'Benchmark Object',
    fields: {
      name: { type: 'text', label: 'Name', required: true, maxLength: 255 },
      description: { type: 'textarea', label: 'Description' },
      status: { type: 'select', label: 'Status', options: [{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }] },
      priority: { type: 'number', label: 'Priority', defaultValue: 0 },
      is_active: { type: 'boolean', label: 'Active', defaultValue: true },
    },
  };

  const validField = {
    type: 'text',
    label: 'Benchmark Field',
    required: true,
    maxLength: 255,
  };

  const validQuery = {
    object: 'benchmark_object',
    fields: ['name', 'status', 'priority'],
    filters: [['status', '=', 'active'], 'and', ['priority', '>', 0]],
    orderBy: [{ field: 'priority', order: 'desc' }],
    top: 25,
    skip: 0,
  };

  bench('ObjectSchema.parse()', () => {
    (Data as any).ObjectSchema.parse(validObject);
  });

  bench('FieldSchema.parse()', () => {
    (Data as any).FieldSchema.parse(validField);
  });

  bench('QuerySchema.parse()', () => {
    (Data as any).QuerySchema.parse(validQuery);
  });

  bench('ObjectSchema.safeParse()', () => {
    (Data as any).ObjectSchema.safeParse(validObject);
  });

  bench('ObjectSchema.safeParse() — invalid input', () => {
    (Data as any).ObjectSchema.safeParse({ invalid: true });
  });
});

// ─── UI Domain Benchmarks ───────────────────────────────────────────

describe('UI Domain — Schema Parse Performance', () => {
  const validView = {
    name: 'benchmark_list',
    label: 'Benchmark List',
    type: 'list',
    objectName: 'benchmark_object',
    list: {
      type: 'grid',
      columns: [
        { field: 'name', width: 200 },
        { field: 'status', width: 100 },
      ],
      sort: [{ field: 'name', order: 'asc' }],
      pageSize: 25,
    },
  };

  const validApp = {
    name: 'benchmark_app',
    label: 'Benchmark App',
    navigation: {
      type: 'sidebar',
      items: [
        { type: 'object', label: 'Tasks', objectName: 'task' },
      ],
    },
  };

  bench('ViewSchema.parse()', () => {
    (UI as any).ViewSchema.parse(validView);
  });

  bench('AppSchema.parse()', () => {
    (UI as any).AppSchema.parse(validApp);
  });
});

// ─── Kernel Domain Benchmarks ───────────────────────────────────────

describe('Kernel Domain — Schema Parse Performance', () => {
  const validPlugin = {
    name: 'benchmark_plugin',
    version: '1.0.0',
    description: 'A benchmark plugin',
  };

  bench('PluginDefinitionSchema.parse()', () => {
    (Kernel as any).PluginDefinitionSchema.parse(validPlugin);
  });
});

// ─── API Domain Benchmarks ──────────────────────────────────────────

describe('API Domain — Schema Parse Performance', () => {
  const validEndpoint = {
    name: 'get_benchmark',
    path: '/api/benchmark',
    method: 'GET',
    type: 'object_operation',
    target: 'benchmark_object',
  };

  bench('ApiEndpointSchema.parse()', () => {
    (API as any).ApiEndpointSchema.parse(validEndpoint);
  });
});

// ─── AI Domain Benchmarks ───────────────────────────────────────────

describe('AI Domain — Schema Parse Performance', () => {
  const validAgent = {
    name: 'benchmark_agent',
    label: 'Benchmark Agent',
    role: 'assistant',
    instructions: 'You are a helpful assistant.',
    model: {
      model: 'gpt-4o',
    },
    tools: [],
  };

  bench('AgentSchema.parse()', () => {
    (AI as any).AgentSchema.parse(validAgent);
  });
});

// ─── Cross-Domain: Batch Validation ─────────────────────────────────

describe('Cross-Domain — Batch Validation Performance', () => {
  const objects = Array.from({ length: 100 }, (_, i) => ({
    name: `object_${i}`,
    label: `Object ${i}`,
    fields: {
      name: { type: 'text', label: 'Name', required: true },
    },
  }));

  bench('100x ObjectSchema.parse()', () => {
    for (const obj of objects) {
      (Data as any).ObjectSchema.parse(obj);
    }
  });

  bench('100x ObjectSchema.safeParse()', () => {
    for (const obj of objects) {
      (Data as any).ObjectSchema.safeParse(obj);
    }
  });
});
