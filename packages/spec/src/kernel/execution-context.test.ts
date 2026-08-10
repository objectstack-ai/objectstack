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
// #7280 — `authGate` is DECLARED, so the ADR-0069 posture is inside every
// closure gate instead of one `as any` outside it.
//
// The field was written onto the envelope by REST's `computeExecCtx` and read
// by its `enforceAuth` while being declared nowhere, which put it outside the
// closed entry field set (#6216) by construction: a union derived from
// `keyof ExecutionContext` cannot name a key the schema does not have.
//
// Both inner keys are REQUIRED on purpose. The sole producer
// (`AuthManager.computeAuthGate`) sets both on every return branch, `code` is
// the stable machine code clients branch on, and `message` is what the blocked
// user reads — a gate whose message is absent renders a `403` body with
// `message: undefined`. The contract is stated here, at the producer's
// declaration, rather than tolerated at each consumer.
// ---------------------------------------------------------------------------
describe('ExecutionContextSchema.authGate — the ADR-0069 gate posture (#7280)', () => {
  it('accepts a well-formed gate', () => {
    const ctx = ExecutionContextSchema.parse({
      userId: 'u1',
      authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
    });
    expect(ctx.authGate).toEqual({
      code: 'PASSWORD_EXPIRED',
      message: 'Your password has expired.',
    });
  });

  it('is optional — a healthy session declares no gate at all', () => {
    const ctx = ExecutionContextSchema.parse({ userId: 'u1' });
    expect(ctx.authGate).toBeUndefined();
  });

  it('REJECTS a gate carrying a code but no message', () => {
    const res = ExecutionContextSchema.safeParse({
      userId: 'u1',
      authGate: { code: 'MFA_REQUIRED' },
    });
    expect(res.success).toBe(false);
    // Named by PATH, not by count: what must be pinned is that the missing
    // `message` is the thing rejected, not merely that something was.
    const issue = res.success
      ? undefined
      : res.error.issues.find((i) => i.path.join('.') === 'authGate.message');
    expect(issue).toBeDefined();
    expect(issue?.code).toBe('invalid_type');
  });

  it('REJECTS a non-string code', () => {
    const res = ExecutionContextSchema.safeParse({
      userId: 'u1',
      authGate: { code: 403, message: 'blocked' },
    });
    expect(res.success).toBe(false);
    const issue = res.success
      ? undefined
      : res.error.issues.find((i) => i.path.join('.') === 'authGate.code');
    expect(issue?.code).toBe('invalid_type');
  });

  // Same lesson as #6881 above, applied at the moment the row is ADDED rather
  // than after it ships blank: `gen:docs` renders `.describe()` and NEVER the
  // TSDoc, so a key declared bare lands an empty description cell in
  // `content/docs/references/kernel/execution-context.mdx`. Asserted by idiom,
  // not by sentence — a rewrite stays free, emptying it does not.
  describe('the published description', () => {
    const description = ExecutionContextSchema.shape.authGate.description ?? '';

    it('is present and non-empty, so the generated reference row is not blank', () => {
      expect(description.trim().length).toBeGreaterThan(0);
    });

    it('names the ADR and both machine codes a client branches on', () => {
      expect(description).toMatch(/ADR-0069/);
      expect(description).toMatch(/PASSWORD_EXPIRED/);
      expect(description).toMatch(/MFA_REQUIRED/);
    });

    it('states that this is authentication, not authorization', () => {
      expect(description).toMatch(/AUTHENTICATION/);
      expect(description).toMatch(/not authorization/i);
    });

    it('states the server-constructed provenance', () => {
      expect(description).toMatch(/server-constructed|never client-supplied/i);
    });
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
