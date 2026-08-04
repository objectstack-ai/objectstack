import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  objectStackErrorMap,
  formatZodError,
  formatZodIssue,
  safeParsePretty,
} from './error-map.zod';
import { FieldType } from '../data/field.zod';

describe('objectStackErrorMap', () => {
  describe('FieldType enum errors', () => {
    it('should suggest corrections for field type typos', () => {
      const result = FieldType.safeParse('dropdown', { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Invalid field type');
        expect(result.error.issues[0].message).toContain("'select'");
      }
    });

    it('should suggest corrections for common alternative names', () => {
      const result = FieldType.safeParse('string', { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("'text'");
      }
    });

    it('should handle completely unknown field types', () => {
      const result = FieldType.safeParse('xyzzy', { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Invalid field type');
      }
    });
  });

  describe('generic enum errors', () => {
    const SmallEnum = z.enum(['active', 'inactive', 'pending']);

    it('should suggest corrections for small enum typos', () => {
      const result = SmallEnum.safeParse('actve', { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("'active'");
      }
    });

    it('should list options when no close match', () => {
      const result = SmallEnum.safeParse('xyz', { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Expected one of');
      }
    });
  });

  describe('string validation errors', () => {
    it('should format too-short errors', () => {
      const schema = z.string().min(3);
      const result = schema.safeParse('ab', { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least 3 characters');
      }
    });

    it('should format too-long errors', () => {
      const schema = z.string().max(5);
      const result = schema.safeParse('toolong', { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at most 5 characters');
      }
    });
  });

  describe('missing required fields', () => {
    it('should report missing required property', () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const result = schema.safeParse({}, { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("Required property"))).toBe(true);
      }
    });
  });

  describe('type mismatch', () => {
    it('should report type mismatch', () => {
      const schema = z.number();
      const result = schema.safeParse('not a number', { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Expected number');
        expect(result.error.issues[0].message).toContain('received string');
      }
    });
  });

  describe('unrecognized keys', () => {
    it('should report unrecognized keys', () => {
      const schema = z.object({ name: z.string() }).strict();
      const result = schema.safeParse({ name: 'ok', extra: true }, { error: objectStackErrorMap });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Unrecognized key');
        expect(result.error.issues[0].message).toContain('extra');
      }
    });
  });
});

describe('formatZodIssue', () => {
  it('should format issue with path', () => {
    const issue = {
      code: 'custom' as const,
      path: ['objects', 0, 'name'] as (string | number)[],
      message: 'Something went wrong',
    };
    const result = formatZodIssue(issue);
    expect(result).toBe('  ✗ objects.0.name: Something went wrong');
  });

  it('should format issue without path as (root)', () => {
    const issue = {
      code: 'custom' as const,
      path: [] as (string | number)[],
      message: 'Root error',
    };
    const result = formatZodIssue(issue);
    expect(result).toBe('  ✗ (root): Root error');
  });
});

describe('formatZodError', () => {
  it('should format error with label', () => {
    const schema = z.object({ name: z.string(), type: z.string() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error, 'Validation failed');
      expect(formatted).toContain('Validation failed');
      expect(formatted).toContain('issue');
      expect(formatted).toContain('✗');
    }
  });

  it('should format error without label', () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('Validation failed');
    }
  });

  it('should handle single issue (singular)', () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('1 issue');
    }
  });
});

// ─── [#4971] union branches ─────────────────────────────────────────────────
//
// Zod raises ONE `invalid_union` issue whose own `message` is the literal
// string `"Invalid input"`; every branch's real rejection sits one level down
// in `issue.errors[]`. Structural consumers (the REST error body,
// `ZodError.message`) carry that payload through — a flatten-to-one-line
// consumer does not, and `formatZodError` is exactly such a consumer: it is
// documented for CLI output and is what `defineStack` throws through, so every
// author loading a stack config reads it. Until #4971 the curated prose the
// #4001 campaign wrote for every strict shape behind a union was cut off
// before it reached them. (`os validate` / `os build` print through the CLI's
// OWN `formatZodErrors`, which still flattens the same way — #5341.)
//
// The whole risk of fixing it is the opposite failure: N branches × the same
// mistake = the same key reported N times, which is why `view.zod.ts`'s
// `submitBehavior` reached for `discriminatedUnion` in the first place. Both
// directions are pinned below.
describe('[#4971] formatZodError expands invalid_union branches', () => {
  // The campaign's shape: a string form OR a strict object form.
  const ACTION_REF = z.union([
    z.string(),
    z.strictObject({ type: z.string(), params: z.record(z.string(), z.unknown()).optional() }),
  ]);

  it('renders the failing branch prose under the union line', () => {
    const result = ACTION_REF.safeParse({ type: 'log', args: { a: 1 } });
    expect(result.success).toBe(false);

    const formatted = formatZodError(result.error!);
    // The union's own line is preserved — it is what says "no branch matched".
    expect(formatted).toContain('✗ (root): Invalid input');
    // …and the branch's prescription now arrives with it, indented one level.
    expect(formatted).toContain('    ✗ (root): Unrecognized key: "args"');
  });

  it('drops the kind-mismatch branch that carries no prescription', () => {
    const formatted = formatZodError(ACTION_REF.safeParse({ type: 'log', args: 1 }).error!);
    // `expected string, received object` is the string branch complaining that
    // the author did not write a string. They never meant to.
    expect(formatted).not.toContain('expected string');
  });

  it('resolves nested paths against the union, not relative to it', () => {
    const schema = z.object({ actions: z.array(ACTION_REF) });
    const formatted = formatZodError(
      schema.safeParse({ actions: [{ type: 'log', args: { a: 1 } }] }).error!,
    );
    expect(formatted).toContain('✗ actions.0: Invalid input');
    expect(formatted).toContain('✗ actions.0: Unrecognized key: "args"');
    // Never the bare relative path a naive splice would print.
    expect(formatted).not.toContain('✗ (root): Unrecognized key');
  });

  it('expands a union nested inside a union', () => {
    const schema = z.object({ on: z.union([z.string(), z.object({ actions: z.array(ACTION_REF) })]) });
    const formatted = formatZodError(
      schema.safeParse({ on: { actions: [{ type: 'log', args: { a: 1 } }] } }).error!,
    );
    expect(formatted).toContain('  ✗ on: Invalid input');
    expect(formatted).toContain('    ✗ on.actions.0: Invalid input');
    expect(formatted).toContain('      ✗ on.actions.0: Unrecognized key: "args"');
  });

  // ⚠️ THE anti-regression. #4001 批 6c measured a plain `z.union` of four
  // strict members reporting one bad key once per member; `submitBehavior`
  // switched to `discriminatedUnion` because of it. Selecting the branch that
  // complains LEAST is what keeps the expansion from reintroducing it: the
  // member the author was aiming at reports only the stray key, while the
  // others also report a wrong discriminator and their own missing requireds.
  it('reports one unknown key ONCE, not once per branch', () => {
    const union = z.union([
      z.strictObject({ kind: z.literal('a'), x: z.string() }),
      z.strictObject({ kind: z.literal('b'), y: z.string() }),
      z.strictObject({ kind: z.literal('c'), z: z.string() }),
    ]);
    const formatted = formatZodError(union.safeParse({ kind: 'a', x: 'ok', bogus: 1 }).error!);

    expect(formatted.match(/bogus/g)?.length).toBe(1);
    // The two shapes the author was not writing stay out of the output.
    expect(formatted).not.toContain('expected "b"');
    expect(formatted).not.toContain('expected "c"');
  });

  it('de-duplicates a verdict every tied branch reaches', () => {
    // Disjoint shapes, so no branch is "closer": each reports the same stray
    // key plus its own missing required. Both are rendered — neither shape is
    // more expected than the other — but the shared line is said once.
    const union = z.union([
      z.strictObject({ a: z.string() }),
      z.strictObject({ b: z.string() }),
    ]);
    const formatted = formatZodError(union.safeParse({ bogus: 1 }).error!);

    expect(formatted.match(/bogus/g)?.length).toBe(1);
    expect(formatted).toContain('✗ a:');
    expect(formatted).toContain('✗ b:');
  });

  it('caps a wide tie and says how many branches it did not print', () => {
    // Five disjoint shapes, none closer than the others: every branch reports
    // the same stray key plus its own missing required. Three are rendered and
    // the remainder is stated rather than dropped in silence.
    const union = z.union([
      z.strictObject({ a: z.string() }),
      z.strictObject({ b: z.string() }),
      z.strictObject({ c: z.string() }),
      z.strictObject({ d: z.string() }),
      z.strictObject({ e: z.string() }),
    ]);
    const formatted = formatZodError(union.safeParse({ bogus: 1 }).error!);

    expect(formatted).toContain('… and 2 more branches rejected this value');
    expect(formatted.match(/bogus/g)?.length).toBe(1);
    expect(formatted).toContain('✗ c:');
    expect(formatted).not.toContain('✗ d:');
  });

  // The conservative half of the contract: when NO branch has anything to say
  // beyond "that is the wrong kind of value", the expansion adds N lines of
  // noise for zero prescription. Primitive unions are the commonest union in
  // the repo, so their output is deliberately left byte-identical to what it
  // was before #4971.
  it('leaves an all-kind-mismatch union exactly as it was', () => {
    const formatted = formatZodError(z.union([z.string(), z.number()]).safeParse({}).error!);
    expect(formatted).toBe('Validation failed (1 issue):\n\n  ✗ (root): Invalid input');
  });

  it('counts the union as the one issue zod raised', () => {
    // The header must keep agreeing with `error.issues` / the REST body, or
    // the CLI and the API would disagree about how many things are wrong.
    const result = ACTION_REF.safeParse({ type: 'log', args: { a: 1 } });
    expect(result.error!.issues).toHaveLength(1);
    expect(formatZodError(result.error!)).toContain('(1 issue)');
  });

  it('stops expanding after three levels of nesting', () => {
    // Bounded output: unions nest arbitrarily, the terminal does not.
    const leaf = z.strictObject({ ok: z.string() });
    const l1 = z.union([z.string(), leaf]);
    const l2 = z.union([z.string(), z.object({ n: l1 })]);
    const l3 = z.union([z.string(), z.object({ n: l2 })]);
    const l4 = z.union([z.string(), z.object({ n: l3 })]);

    const formatted = formatZodError(
      l4.safeParse({ n: { n: { n: { ok: 'x', bogus: 1 } } } }).error!,
    );
    const depths = formatted
      .split('\n')
      .filter((line) => line.includes('✗'))
      .map((line) => line.length - line.trimStart().length);
    // Three expansions below the top-level line, two spaces each: 2, 4, 6, 8.
    expect(Math.max(...depths)).toBe(8);
    // The deepest union is printed, but not expanded — so the innermost
    // prescription is the one thing that does NOT reach the author here.
    expect(formatted).not.toContain('bogus');
  });
});

describe('safeParsePretty', () => {
  it('should return success with data for valid input', () => {
    const schema = z.object({ name: z.string() });
    const result = safeParsePretty(schema, { name: 'valid' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('valid');
    }
  });

  it('should return formatted error for invalid input', () => {
    const schema = z.object({ name: z.string() });
    const result = safeParsePretty(schema, {}, 'Config error');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.formatted).toContain('Config error');
      expect(result.formatted).toContain('✗');
    }
  });

  it('should use objectStackErrorMap for enhanced messages', () => {
    const schema = z.object({ type: FieldType });
    const result = safeParsePretty(schema, { type: 'dropdown' }, 'Field validation');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.formatted).toContain("'select'");
    }
  });
});
