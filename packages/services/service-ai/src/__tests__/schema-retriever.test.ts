// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SchemaRetriever, type ObjectShape } from '../schema-retriever.js';
import type { IMetadataService } from '@objectstack/spec/contracts';

const taskObject: ObjectShape = {
  name: 'task',
  label: 'Project Task',
  pluralLabel: 'Project Tasks',
  description: 'Work item with status and assignee',
  fields: {
    id: { type: 'text' },
    title: { type: 'text', label: 'Title' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'done', label: 'Done' },
      ],
    },
    assignee_id: { type: 'lookup', reference: 'user', label: 'Assignee' },
    due_date: { type: 'date', label: 'Due Date' },
  },
};

const accountObject: ObjectShape = {
  name: 'account',
  label: 'Account',
  pluralLabel: 'Accounts',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    revenue: { type: 'currency' },
  },
};

const unrelatedObject: ObjectShape = {
  name: 'invoice',
  label: 'Invoice',
  fields: { id: { type: 'text' }, total: { type: 'currency' } },
};

function mockMetadata(objects: ObjectShape[]): IMetadataService {
  return {
    listObjects: vi.fn().mockResolvedValue(objects),
  } as unknown as IMetadataService;
}

describe('SchemaRetriever', () => {
  it('scores name matches highest', async () => {
    const r = new SchemaRetriever(mockMetadata([taskObject, accountObject, unrelatedObject]));
    const hits = await r.retrieve('show me all tasks');
    expect(hits[0].object.name).toBe('task');
  });

  it('matches by field name and label', async () => {
    const r = new SchemaRetriever(mockMetadata([taskObject, accountObject]));
    const hits = await r.retrieve('which accounts have revenue over 1m?');
    expect(hits[0].object.name).toBe('account');
  });

  it('returns empty when nothing matches', async () => {
    const r = new SchemaRetriever(mockMetadata([taskObject]));
    const hits = await r.retrieve('what is the meaning of life?');
    expect(hits).toEqual([]);
  });

  it('tokenises CJK queries so a Chinese label still matches', async () => {
    const cjkTask: ObjectShape = {
      name: 'showcase_task',
      label: '任务',
      pluralLabel: '任务',
      fields: { id: { type: 'text' }, 标题: { type: 'text', label: '标题' } },
    };
    const r = new SchemaRetriever(mockMetadata([cjkTask, accountObject]));
    const hits = await r.retrieve('帮我分析任务对象');
    expect(hits[0]?.object.name).toBe('showcase_task');
  });

  it('respects limit option', async () => {
    const r = new SchemaRetriever(
      mockMetadata([taskObject, accountObject, unrelatedObject]),
      { limit: 1, minScore: 0 },
    );
    // Generic query — all could match weakly via stop-words removal etc.
    const hits = await r.retrieve('task account invoice');
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('renders snippet with object/field types', () => {
    const snippet = SchemaRetriever.renderSnippet([
      { object: taskObject, score: 10 },
    ]);
    expect(snippet).toContain('## Schema context');
    expect(snippet).toContain('### task — Project Task');
    expect(snippet).toContain('title: text');
    expect(snippet).toContain('status: select(open|in_progress|done)');
    expect(snippet).toContain('assignee_id: lookup → user');
  });

  it('renders an empty string for empty hits', () => {
    expect(SchemaRetriever.renderSnippet([])).toBe('');
  });
});
