/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12363 — the default record page `buildDefaultPageSchema` builds
 * validates whole.
 *
 * The synthesizer emits `record:attachments` (an `enable.files: true` object's
 * Attachments tab) and `record:approvals` (the Approvals tab, when the host
 * reports approval requests). Both are spec-18 page blocks, and until their
 * arms landed in `@object-ui/types/zod` the validator refused each one at
 * `type`, so the page objectui builds itself failed `safeValidateSchema`.
 *
 * The page is judged on the face `objectui validate` reads metadata through
 * (`StrictAnyComponentSchema`) and on the tolerant face (`safeValidateSchema`).
 *
 * One boundary is pinned as a refusal, not an acceptance: the record page's
 * HOST threads its live approvals read through `approvals.node`, which lands in
 * the node's `properties` bag as `approvals` / `currentUserId`. The spec row
 * declares neither and names both the host's runtime channel, so the arm
 * refuses them, exactly as it refuses `record:history`'s host `entries`.
 * Such a page is rendered through `SchemaRenderer` and never reaches the
 * validator; it is not authored metadata.
 */
import { describe, expect, it } from 'vitest';
import { StrictAnyComponentSchema, safeValidateSchema } from '@object-ui/types/zod';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';

const DEF = {
  name: 'account',
  label: 'Account',
  enable: { files: true },
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
  },
} as const;

/** Every `type` in the page, depth-first. */
function typesIn(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) typesIn(child, out);
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.type === 'string') out.push(record.type);
    for (const value of Object.values(record)) typesIn(value, out);
  }
  return out;
}

describe('`buildDefaultPageSchema` — the default record page validates whole (objectui#12363)', () => {
  const page = buildDefaultPageSchema(DEF as never, { approvals: { count: 2 } });

  it('carries both panels (non-vacuity)', () => {
    const types = typesIn(page);
    expect(types).toContain('record:approvals');
    expect(types).toContain('record:attachments');
  });

  it('passes the tolerant face', () => {
    const result = safeValidateSchema(page);
    expect(result.success ? [] : result.error.issues.map((i) => [i.code, i.path.join('.')])).toEqual([]);
  });

  it('passes the strict face `objectui validate` reads metadata through', () => {
    const result = StrictAnyComponentSchema.safeParse(page);
    expect(result.success ? [] : result.error.issues.map((i) => [i.code, i.path.join('.')])).toEqual([]);
  });

  it('passes without the Approvals tab too — Attachments alone', () => {
    const plain = buildDefaultPageSchema(DEF as never, {});
    expect(typesIn(plain)).toContain('record:attachments');
    expect(typesIn(plain)).not.toContain('record:approvals');
    expect(safeValidateSchema(plain).success).toBe(true);
  });
});

describe('`buildDefaultPageSchema` — the host payload is not authored metadata (objectui#12363)', () => {
  it('refuses the host-threaded `approvals` / `currentUserId` at the panel bag, and nowhere else', () => {
    const hosted = buildDefaultPageSchema(DEF as never, {
      approvals: {
        count: 1,
        node: { approvals: { available: true, requests: [], pendingRequest: null }, currentUserId: 'usr_1' },
      },
    });
    const result = safeValidateSchema(hosted);
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('unrecognized_keys');
    expect(issues[0].path.slice(-3)).toEqual(['children', 0, 'properties']);
    expect((issues[0] as { keys?: string[] }).keys?.slice().sort()).toEqual(['approvals', 'currentUserId']);
  });
});
