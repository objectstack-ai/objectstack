// #11992 — `ActionParamSchema.carryOver`, the #11753 ruling's spec half
// (maintainer 2026-08-25, recommendation A): a declared carry-over param is
// seeded from the row, rendered as a NON-EDITABLE summary, and submitted
// VERBATIM. These pins hold the ruled shape: the accept set (key + parsed
// output), the parse-time `defaultFromRow` co-requirement, the alias
// prescriptions for the words authors will actually try (`readonly` /
// `disabled`), and the describe() contract the renderer leg and the docs are
// generated from.
//
// Measured constraint restated from the parent card, because it is the reason
// the key exists at all: `visible: false` is NOT this contract — it omits the
// param from the dialog AND from the submission, which is the #11703
// silent-drop shape. `carryOver` must keep the param in the submission.
import { describe, it, expect } from 'vitest';
import { ActionParamSchema } from './action.zod';

describe('ActionParamSchema.carryOver (#11992, #11753 ruling)', () => {
  describe('accept pins', () => {
    it('accepts carryOver on a field-backed defaultFromRow param and carries it in the parse output', () => {
      const r = ActionParamSchema.safeParse({
        field: 'row_level_security',
        defaultFromRow: true,
        carryOver: true,
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
      // The renderer leg reads this member off the parsed shape; nothing may
      // strip or rename it on the way through (contrast `requiresFeature`,
      // which IS lowered away — this key is not sugar, it is the contract).
      expect((r.data as { carryOver?: boolean }).carryOver).toBe(true);
    });

    it('accepts carryOver: false as an explicit no-op', () => {
      const r = ActionParamSchema.safeParse({
        field: 'description',
        defaultFromRow: true,
        carryOver: false,
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it('accepts carryOver on an inline param when the row seed is declared', () => {
      const r = ActionParamSchema.safeParse({
        name: 'tab_permissions',
        type: 'textarea',
        defaultFromRow: true,
        carryOver: true,
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });
  });

  describe('co-requirement pin — carryOver without its row seed is an authoring error', () => {
    it('refuses carryOver: true without defaultFromRow, on the carryOver path, naming the missing seed', () => {
      const r = ActionParamSchema.safeParse({
        field: 'row_level_security',
        carryOver: true,
      });
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path.join('.') === 'carryOver');
      expect(issue, JSON.stringify(r.error.issues)).toBeDefined();
      // The message must carry the repair (`defaultFromRow: true`) and the
      // fixed-value alternative (`bodyExtra`) — the refusal is the docs at the
      // moment of the mistake.
      expect(issue!.message).toContain('defaultFromRow: true');
      expect(issue!.message).toContain('bodyExtra');
    });

    it('refuses carryOver: true with defaultFromRow explicitly false', () => {
      const r = ActionParamSchema.safeParse({
        field: 'row_level_security',
        defaultFromRow: false,
        carryOver: true,
      });
      expect(r.success).toBe(false);
    });

    it('a carryOver: false param does NOT require the seed (no phantom check on the disabled spelling)', () => {
      const r = ActionParamSchema.safeParse({
        name: 'note',
        type: 'text',
        carryOver: false,
      });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });
  });

  describe('alias pins — the borrowed words point at the declared key', () => {
    // The parent card's option A was literally titled "a readonly / carryOver
    // flag", and `FieldSchema.readonly` / widget `disabled` are the spellings
    // an author will reach for first. Both must land on the strict-unknown-key
    // path with a suggestion naming `carryOver` — never parse clean (this
    // schema is strict) and never dead-end without a pointer.
    it.each(['readonly', 'disabled'] as const)('rejects %s with a suggestion naming carryOver', (word) => {
      const r = ActionParamSchema.safeParse({
        field: 'row_level_security',
        defaultFromRow: true,
        [word]: true,
      });
      expect(r.success).toBe(false);
      if (r.success) return;
      const text = JSON.stringify(r.error.issues);
      expect(text).toContain(word);
      expect(text).toContain('carryOver');
    });
  });

  describe('describe pin — the three ruled semantics are stated on the key', () => {
    it('the .describe() text states seed-from-row, non-editable render, and verbatim submission', () => {
      // The describe string is what the generated reference docs and the
      // authorable-surface baseline carry — an author (or an AI writing
      // metadata in bulk) reads THIS, so all three halves of the ruled
      // contract must be in it, including the contrast with `visible: false`
      // (the measured non-answer).
      const shape = (ActionParamSchema as unknown as {
        def: { getter?: () => unknown };
      });
      // `lazySchema` wraps the pipeline; walk to the inner object's shape via
      // a parse-independent probe: JSON-schema-free, so just read the
      // description off a parsed-known-good source — the schema graph.
      const description = findCarryOverDescription(shape);
      expect(description).toBeTruthy();
      expect(description).toContain('seed the value from the current row');
      expect(description).toContain('non-editable summary');
      expect(description).toContain('submit it verbatim');
      expect(description).toContain('visible: false');
    });
  });
});

/**
 * Walk the (lazy, refined, transformed) schema graph down to the strict object
 * and read `carryOver`'s description. Kept structural rather than importing
 * zod internals: every wrapper layer exposes its inner schema on `def`
 * (`innerType` / `schema` / `getter()`), and the object layer exposes `shape`.
 */
function findCarryOverDescription(node: unknown, depth = 0): string | undefined {
  // `lazySchema` returns a Proxy over a FUNCTION target (structurally a
  // ZodType, `typeof` says 'function'), so both object and function nodes are
  // walkable — an object-only guard silently skips the schema root.
  if (!node || (typeof node !== 'object' && typeof node !== 'function') || depth > 12) return undefined;
  const n = node as Record<string, any>;
  const shape = typeof n.shape === 'object' ? n.shape : n.def?.shape;
  if (shape?.carryOver) {
    const co = shape.carryOver as Record<string, any>;
    return co.description ?? co.def?.description ?? co.meta?.()?.description;
  }
  const d = n.def ?? {};
  for (const next of [
    typeof d.getter === 'function' ? d.getter() : undefined,
    d.innerType,
    d.schema,
    d.in,
    n.innerType,
  ]) {
    const found = findCarryOverDescription(next, depth + 1);
    if (found) return found;
  }
  return undefined;
}
