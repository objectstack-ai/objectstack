// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_BODY_NOT_LONG_TEXT,
  AI_CONTEXT_FIELD_UNKNOWN,
  AI_CONTEXT_OBJECT_UNKNOWN,
  AI_CONTEXT_RELATED_LINK_UNKNOWN,
  validateAiContext,
} from './validate-ai-context.js';
import { explainRule } from './rule-explanations.js';

const objects = [
  {
    name: 'policy',
    fields: {
      title: { type: 'text' },
      status: { type: 'select' },
      content: { type: 'markdown' },
      owner: { type: 'lookup', reference: 'account' },
    },
  },
  {
    name: 'policy_revision',
    fields: { version: { type: 'text' }, policy: { type: 'lookup', reference: 'policy' } },
  },
  {
    name: 'policy_link',
    fields: {
      from_policy: { type: 'lookup', reference: 'policy' },
      to_policy: { type: 'lookup', reference: 'policy' },
    },
  },
  { name: 'account', fields: { name: { type: 'text' } } },
];

const pack = (over: Record<string, unknown> = {}) => ({
  name: 'policy_document',
  label: 'Policy document',
  object: 'policy',
  fields: ['title', 'status', 'owner'],
  related: [{ object: 'policy_revision', fields: ['version'] }],
  body: { field: 'content' },
  ...over,
});

const rulesOf = (stack: Record<string, unknown>) => validateAiContext(stack).map((f) => [f.rule, f.path]);

describe('validateAiContext — ADR-0160 D1 author defects', () => {
  it('a pack that names only what the stack defines is clean', () => {
    expect(validateAiContext({ objects, aiContexts: [pack()] })).toEqual([]);
  });

  it('reports a field the object does not define, in fields, related fields and body', () => {
    const stack = {
      objects,
      aiContexts: [pack({
        fields: ['title', 'titel'],
        related: [{ object: 'policy_revision', fields: ['versoin'] }],
        body: { field: 'contnet' },
      })],
    };
    expect(rulesOf(stack)).toEqual([
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].fields[1]'],
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].body.field'],
      [AI_CONTEXT_FIELD_UNKNOWN, 'aiContexts[0].related[0].fields[0]'],
    ]);
  });

  it('reports an object the stack does not define once, without judging its fields; a sys_ object is not judged', () => {
    expect(rulesOf({ objects, aiContexts: [pack({ object: 'polcy', related: undefined, body: undefined })] })).toEqual([
      [AI_CONTEXT_OBJECT_UNKNOWN, 'aiContexts[0].object'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'policy_revison' }] })] })).toEqual([
      [AI_CONTEXT_OBJECT_UNKNOWN, 'aiContexts[0].related[0].object'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ object: 'sys_user', fields: ['nope'], related: undefined, body: undefined })] })).toEqual([]);
  });

  it('reports a related list with no link to the root: none, a named non-link, or several unnamed', () => {
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'account' }] })] })).toEqual([
      [AI_CONTEXT_RELATED_LINK_UNKNOWN, 'aiContexts[0].related[0]'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'policy_revision', field: 'version' }] })] })).toEqual([
      [AI_CONTEXT_RELATED_LINK_UNKNOWN, 'aiContexts[0].related[0].field'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'policy_link' }] })] })).toEqual([
      [AI_CONTEXT_RELATED_LINK_UNKNOWN, 'aiContexts[0].related[0]'],
    ]);
    expect(rulesOf({ objects, aiContexts: [pack({ related: [{ object: 'policy_link', field: 'to_policy' }] })] })).toEqual([]);
  });

  it('reports a body that is not a long-text field', () => {
    expect(rulesOf({ objects, aiContexts: [pack({ body: { field: 'title' } })] })).toEqual([
      [AI_CONTEXT_BODY_NOT_LONG_TEXT, 'aiContexts[0].body.field'],
    ]);
  });

  it('every verdict is a warning, and every rule it emits has an `os explain` entry', () => {
    const findings = validateAiContext({ objects, aiContexts: [pack({ fields: ['nope'], body: { field: 'title' } })] });
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    for (const id of [AI_CONTEXT_OBJECT_UNKNOWN, AI_CONTEXT_FIELD_UNKNOWN, AI_CONTEXT_RELATED_LINK_UNKNOWN, AI_CONTEXT_BODY_NOT_LONG_TEXT]) {
      expect(explainRule(id), id).toBeTruthy();
    }
  });
});
