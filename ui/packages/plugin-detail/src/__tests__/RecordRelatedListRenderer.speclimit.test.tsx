/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Spec-default `limit` on `record:related_list` (objectui#2711).
 *
 * `@objectstack/spec` declares `RecordRelatedListProps.limit` with
 * `.default(5)` ("Number of records to display initially"), but zod defaults
 * only materialize through a spec parse — the synthesized default record page
 * hands the renderer raw nodes. The renderer must therefore apply the
 * contract's default itself; without it `pageSize` stayed undefined and
 * related lists rendered EVERY child row unpaged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';

// Capture what the renderer passes down to RelatedList.
const h = vi.hoisted(() => ({ captured: null as any }));
vi.mock('../RelatedList', () => ({
  RelatedList: (props: any) => {
    h.captured = props;
    return <div data-testid="related-list" />;
  },
}));

const ds = { find: vi.fn(async () => []) };

function renderRelated(schema: Record<string, any>) {
  return render(
    <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={ds as any}>
      <RecordRelatedListRenderer
        schema={{ objectName: 'contact', relationshipField: 'account_id', ...schema }}
      />
    </RecordContextProvider>,
  );
}

beforeEach(() => {
  h.captured = null;
});

describe('RecordRelatedListRenderer — spec default limit (#2711)', () => {
  it('applies the spec default (5) when limit is omitted', () => {
    renderRelated({});
    expect(h.captured).toBeTruthy();
    expect(h.captured.pageSize).toBe(5);
  });

  it('honors an explicit authored limit', () => {
    renderRelated({ limit: 20 });
    expect(h.captured.pageSize).toBe(20);
  });

  it('falls back to the spec default for a non-positive limit', () => {
    // Spec: z.number().int().positive() — 0/negative never validates, so the
    // renderer treats it as absent rather than fossilizing "0 = show all".
    renderRelated({ limit: 0 });
    expect(h.captured.pageSize).toBe(5);
  });

  it('passes the schema sort through as defaultSort', () => {
    const sort = [{ field: 'due_date', order: 'desc' as const }];
    renderRelated({ sort });
    expect(h.captured.defaultSort).toEqual(sort);
  });
});
