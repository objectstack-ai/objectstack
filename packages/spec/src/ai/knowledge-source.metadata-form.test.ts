// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The knowledge source form (`knowledge_source`, ADR-0161 K4 clause 2, K5,
 * K10): registered for Studio's generic metadata editor, every field picker
 * scoped by the source's own object, the egress note beside `content`, and no
 * control for a key v1 does not carry. That the form names only keys
 * `KnowledgeSourceSchema` accepts, and offers every one, is the registry-wide
 * reconciliation in `system/metadata-form-zod-reconciliation.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { knowledgeSourceForm } from './knowledge-source.metadata-form';
import { KnowledgeSourceSchema } from './knowledge-source.zod';
import { METADATA_FORM_REGISTRY } from '../system/metadata-form-registry';

type Row = {
  field: string;
  widget?: string;
  type?: string;
  dependsOn?: string;
  required?: boolean;
  helpText?: string;
  options?: Array<{ value: string }>;
  fields?: Row[];
};

const top = (): Row[] => (knowledgeSourceForm.sections ?? []).flatMap((s) => (s.fields ?? []) as Row[]);
const row = (field: string) => top().find((r) => r.field === field);
const sourceRow = (field: string) => row('source')?.fields?.find((r) => r.field === field);

/** Every dotted path the form offers, composites walked. */
function offeredPaths(rows: Row[] = top(), prefix = ''): string[] {
  return rows.flatMap((r) => [`${prefix}${r.field}`, ...offeredPaths(r.fields ?? [], `${prefix}${r.field}.`)]);
}

describe('knowledge_source form (ADR-0161 K4 clause 2)', () => {
  it('is the registry\'s form for the type', () => {
    expect(METADATA_FORM_REGISTRY.knowledge_source).toBe(knowledgeSourceForm);
  });

  it('requires the identity rows, and offers `adapter` as optional free text', () => {
    expect(row('name')).toMatchObject({ required: true });
    expect(row('label')).toMatchObject({ required: true });
    const adapter = row('adapter');
    expect(adapter).toMatchObject({ type: 'text' });
    expect(adapter?.required).toBeUndefined();
    expect(adapter?.helpText).toMatch(/blank for the deployment's store/i);
  });

  it('picks the object from the catalog, and scopes every field picker by that object', () => {
    expect(row('source')).toMatchObject({ type: 'composite' });
    expect(sourceRow('object')).toMatchObject({ widget: 'ref:object', required: true });
    expect(sourceRow('content')).toMatchObject({ widget: 'field-multi', dependsOn: 'object', required: true });
    expect(sourceRow('metadataFields')).toMatchObject({ widget: 'field-multi', dependsOn: 'object' });
  });

  it('offers the one kind, `object`, and every split strategy the schema accepts', () => {
    expect(sourceRow('kind')?.options?.map((o) => o.value)).toEqual(['object']);
    const strategy = sourceRow('split')?.fields?.find((r) => r.field === 'strategy');
    expect(strategy?.options?.map((o) => o.value)).toEqual(['whole', 'recursive', 'markdown']);
  });

  it('edits `where` as an ObjectQL filter object (the JSON editor), not as a view rule list', () => {
    // `filter-builder` writes `[{ field, operator, value }]`; `where` is a record, which refuses a list.
    expect(sourceRow('where')).toMatchObject({ widget: 'json' });
    expect(KnowledgeSourceSchema.safeParse({
      name: 'a', label: 'A', source: { kind: 'object', object: 'task', content: ['title'], where: [{ field: 'status', operator: 'equals', value: 'open' }] },
    }).success).toBe(false);
  });

  it('says beside `content` that its fields are sent to the embedding provider on the first build, billed and kept', () => {
    const help = sourceRow('content')?.helpText ?? '';
    expect(help).toMatch(/egress/i);
    expect(help).toMatch(/first build/);
    expect(help).toMatch(/embedding provider/);
    expect(help).toMatch(/bills/);
    expect(help).toMatch(/kept in an index/);
  });

  it('offers no control for a key v1 does not carry', () => {
    const paths = offeredPaths();
    for (const retired of ['id', 'embedding', 'vectorStore', 'adapterConfig', 'refresh.cron', 'source.contentFields']) {
      expect(paths, retired).not.toContain(retired);
    }
  });

  it('every value the form can write parses with KnowledgeSourceSchema', () => {
    const written = {
      name: 'task_notes',
      label: 'Task notes',
      description: 'Open tasks',
      aiExposed: true,
      source: {
        kind: 'object',
        object: 'task',
        content: ['title', 'notes'],
        metadataFields: ['status'],
        where: { status: { $ne: 'done' } },
        split: { strategy: 'markdown', maxChars: 600, minChars: 100 },
      },
      refresh: { onRecordChange: true },
    };
    expect(KnowledgeSourceSchema.safeParse(written).success).toBe(true);
  });
});
