// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The context pack form (`ai_context`, ADR-0160 D1 clause 2): registered for
 * Studio's generic metadata editor, and every field picker scoped by the
 * pack's root object (card #37143). That the form names only keys
 * `AiContextSchema` accepts, and offers every one, is the registry-wide
 * reconciliation in `system/metadata-form-zod-reconciliation.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { aiContextForm } from './ai-context.form';
import { METADATA_FORM_REGISTRY } from '../system/metadata-form-registry';

type Row = { field?: string; widget?: string; dependsOn?: string; required?: boolean; fields?: Row[] };

function rows(): Row[] {
  return (aiContextForm.sections ?? []).flatMap((s) => (s.fields ?? []) as Row[]);
}
const row = (field: string) => rows().find((r) => r.field === field);

describe('ai_context form (ADR-0160 D1, #37143)', () => {
  it('is the registry\'s form for the type', () => {
    expect(METADATA_FORM_REGISTRY.ai_context).toBe(aiContextForm);
  });

  it('picks the root from the object catalog and requires the identity rows', () => {
    expect(row('object')).toMatchObject({ widget: 'ref:object', required: true });
    expect(row('name')?.required).toBe(true);
    expect(row('label')?.required).toBe(true);
  });

  it('scopes every field picker by the root object', () => {
    expect(row('fields')).toMatchObject({ widget: 'field-multi', dependsOn: 'object' });
    expect(row('related')).toMatchObject({ widget: 'related-list-entries', dependsOn: 'object' });
    const body = row('body');
    expect(body?.fields?.find((r) => r.field === 'field')).toMatchObject({ widget: 'field-ref', dependsOn: 'object' });
  });
});
