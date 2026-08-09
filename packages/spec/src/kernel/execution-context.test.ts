import { describe, it, expect } from 'vitest';
import { ExecutionContextSchema } from './execution-context.zod';

describe('ExecutionContextSchema', () => {
  it('should accept empty context (all optional)', () => {
    const ctx = ExecutionContextSchema.parse({});
    expect(ctx.positions).toEqual([]);
    expect(ctx.permissions).toEqual([]);
    expect(ctx.isSystem).toBe(false);
  });

  it('should accept full context', () => {
    const ctx = ExecutionContextSchema.parse({
      userId: 'user_123',
      tenantId: 'org_456',
      positions: ['admin', 'editor'],
      permissions: ['read:account', 'write:account'],
      isSystem: false,
      accessToken: 'Bearer abc',
      traceId: 'trace-789',
    });

    expect(ctx.userId).toBe('user_123');
    expect(ctx.tenantId).toBe('org_456');
    expect(ctx.positions).toEqual(['admin', 'editor']);
    expect(ctx.permissions).toEqual(['read:account', 'write:account']);
    expect(ctx.isSystem).toBe(false);
    expect(ctx.accessToken).toBe('Bearer abc');
    expect(ctx.traceId).toBe('trace-789');
  });

  it('should default roles and permissions to empty arrays', () => {
    const ctx = ExecutionContextSchema.parse({ userId: 'u1' });
    expect(ctx.positions).toEqual([]);
    expect(ctx.permissions).toEqual([]);
  });

  it('should default isSystem to false', () => {
    const ctx = ExecutionContextSchema.parse({});
    expect(ctx.isSystem).toBe(false);
  });

  it('should accept system context', () => {
    const ctx = ExecutionContextSchema.parse({ isSystem: true });
    expect(ctx.isSystem).toBe(true);
  });

  it('should accept transaction handle', () => {
    const mockTx = { id: 'tx1', commit: () => {} };
    const ctx = ExecutionContextSchema.parse({ transaction: mockTx });
    expect(ctx.transaction).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// #6881 — `preserveAudit` must carry its contract in the `.describe()`, not
// only in the block comment above the key.
//
// Why the block comment is not enough: `gen:docs` renders a property's
// `.describe()` (and the module docblock) and NEVER its TSDoc, so with the key
// declared bare the generated row in
// `content/docs/references/kernel/execution-context.mdx` rendered an EMPTY
// description cell while the sibling `DriverOptions.preserveAudit`
// (`data/driver.zod.ts`) rendered fine.
//
// The wording is held to the post-#6640 NARROWED contract, whose two already
// landed statements this description is aligned with (PR #6823):
//   - `packages/spec/src/data/field.zod.ts` — `FieldSchema.readonly`
//   - `content/docs/protocol/objectql/security.mdx` — the UPDATE-only callout
//
// Asserted by IDIOM, not by sentence: a rewrite stays free, dropping the
// substance does not. The first case is the anti-vacuity arm — every other
// assertion here would pass vacuously against `.describe('')` if the string
// were emptied, so the non-empty check is what makes this pin fail on a blank
// cell rather than only on changed wording.
// ---------------------------------------------------------------------------
describe('ExecutionContextSchema.preserveAudit — the published description (#6881)', () => {
  const description = ExecutionContextSchema.shape.preserveAudit.description ?? '';

  it('is present and non-empty, so the generated reference row is not blank', () => {
    expect(description).not.toBe('');
    expect(description.trim().length).toBeGreaterThan(0);
  });

  it('names both write paths, so the exemption cannot read as unconditional', () => {
    expect(description).toMatch(/\bUPDATE\b/);
    expect(description).toMatch(/\bINSERT\b/);
  });

  it('states that the exemption does NOT reach INSERT, anchored to #6640', () => {
    expect(description).toMatch(/#6640/);
    expect(description).toMatch(/\bnot\b/i);
  });

  it('names `context.isSystem` as the create-side exemption', () => {
    expect(description).toMatch(/isSystem/);
  });

  it('states that a non-system create is warned rather than silently obeyed', () => {
    expect(description).toMatch(/warn/i);
  });

  it('states the opt-in, server-constructed provenance', () => {
    expect(description).toMatch(/opt-in/i);
    expect(description).toMatch(/server-constructed|never client-supplied/i);
  });

  it('names the whitelist it admits on the UPDATE path', () => {
    expect(description).toMatch(/readonly/i);
    expect(description).toMatch(/audit|updated_at/i);
  });
});
