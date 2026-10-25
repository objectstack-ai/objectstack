/**
 * Dev-only harness for the lightweight list primitives (SDUI opt #1):
 * element:definition-list (compact key/value) and element:repeater (chrome-free
 * data-bound list). Bound to live showcase_category — the "simple data shouldn't
 * need a full data-grid" case. Not part of the product nav.
 */
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import type { DeclaredNode } from '@object-ui/types';

// Typed with the authoring face `SchemaRenderer` takes, never cast: a key the
// block's spec row does not declare is refused here, at the producer.
const defList: DeclaredNode = {
  type: 'element:definition-list',
  properties: {
    columns: 2,
    items: [
      { term: 'Status', description: 'Active' },
      { term: 'Owner', description: 'Ada Lovelace' },
      { term: 'Plan', description: 'Enterprise' },
      { term: 'Renewal', description: '2026-12-01' },
    ],
  },
};

// The repeater's query is the node-level `dataSource` binding, the one query
// door `@objectstack/spec` 18 keeps: its row retired the flat `object`,
// `filter`, `sort` and `limit` (objectstack#11509), and the renderer reads
// only the binding (objectui#12345).
const repeater: DeclaredNode = {
  type: 'element:repeater',
  dataSource: { object: 'showcase_category', limit: 10 },
  properties: {
    titleField: 'name',
    fields: ['color'],
    emptyText: 'No categories',
  },
};

export const DevLists: React.FC = () => (
  <div className="mx-auto max-w-2xl space-y-8 p-6">
    <div>
      <h1 className="mb-3 text-lg font-semibold">Dev · element:definition-list</h1>
      <div className="rounded-lg border p-4">
        <SchemaRenderer schema={defList} />
      </div>
    </div>
    <div>
      <h1 className="mb-3 text-lg font-semibold">Dev · element:repeater (showcase_category)</h1>
      <div className="rounded-lg border p-4">
        <SchemaRenderer schema={repeater} />
      </div>
    </div>
  </div>
);

export default DevLists;
