// `undoable: true` is legal only where some runtime fulfils it.
//
// The key was accepted on every action shape, and on most of them nothing ever
// built an Undo — the declared-but-inert class (ADR-0078). The obvious repair,
// "require `operation: 'update'`", is wrong: it is not the only fulfilled
// shape. The pinned console builds the undo envelope for a `type: 'api'`
// action from `action.undoable` alone, never reading `action.operation`, and
// those readers are the whole recorded evidence for this key's `live` liveness
// verdict — so a blanket requirement would refuse the published
// `ReassignLeadAction` example at import time and every console api action
// with undo.
//
// So the accepted set is closed to exactly the two fulfilled shapes, and the
// refusal message names both. What this file pins, in both directions:
//   · every shape with no reader is refused, at the `undoable` path;
//   · both fulfilled shapes stay accepted, byte-identically;
//   · `undoable: false` / absent is never touched — the rule is about a
//     capture that was promised, not about the key existing.
import { describe, it, expect } from 'vitest';
import { ActionSchema, ActionType } from './action.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

const base = { name: 'reassign_lead', label: 'Reassign Lead', objectName: 'lead' };

/** A parseable action of each `type`, minus `undoable` — the other keys each type needs. */
const shapeByType: Record<string, Record<string, unknown>> = {
  script: { type: 'script', target: 'reassignLead' },
  url: { type: 'url', target: 'https://example.com/leads' },
  flow: { type: 'flow', target: 'lead_reassignment' },
  modal: { type: 'modal', target: 'lead_reassign_modal' },
  form: { type: 'form', target: 'lead_reassign_form' },
  api: { type: 'api', target: 'lead' },
};

/** The two shapes some runtime fulfils — the closed accepted set. */
const FULFILLED_TYPES = ['api'] as const;
const UNFULFILLED_TYPES = ActionType.options.filter((t) => !FULFILLED_TYPES.includes(t as 'api'));

describe('ActionSchema — `undoable: true` is refused where no runtime fulfils it', () => {
  describe('refusal pins — no reader, so the promise is refused at parse time', () => {
    it.each(UNFULFILLED_TYPES)('refuses `undoable: true` on type:%s without `operation: \'update\'`', (type) => {
      const r = ActionSchema.safeParse({ ...base, ...shapeByType[type], undoable: true });
      expect(r.success, `type:${type} should be refused`).toBe(false);
      expect(r.error!.issues.some((i) => i.path.join('.') === 'undoable')).toBe(true);
    });

    it('names BOTH fulfilling shapes in the remedy, and locates the issue on `undoable`', () => {
      const r = ActionSchema.safeParse({ ...base, ...shapeByType.script, undoable: true });
      expect(r.success).toBe(false);
      const issues = r.error!.issues;
      expect(issues.some((i) => i.path.join('.') === 'undoable')).toBe(true);
      const msg = issues.filter((i) => i.path.join('.') === 'undoable').map((i) => i.message).join('\n');
      // Both fulfilling shapes, by name — a remedy naming only one would push
      // every api author onto the wrong one.
      expect(msg).toContain("operation: 'update'");
      expect(msg).toContain("type: 'api'");
      // Which runtime fulfils which — the contract statement, not a leak.
      expect(msg).toMatch(/framework runtime/);
      expect(msg).toMatch(/console/);
      // The third remedy: the flag was never load-bearing, so dropping it is legal.
      expect(msg).toMatch(/drop `undoable`/);
    });

    it('is refused through the registered `action` metadata schema too (the parsing door)', () => {
      const schema = getMetadataTypeSchema('action');
      expect(schema).toBeDefined();
      const r = schema!.safeParse({ ...base, ...shapeByType.url, undoable: true });
      expect(r.success).toBe(false);
    });
  });

  describe('acceptance pins — the two fulfilled shapes, and the untouched absent case', () => {
    it("`type: 'api'` + `undoable: true` with no `operation` — the published ReassignLeadAction shape — stays accepted", () => {
      const out = ActionSchema.parse({
        ...base,
        type: 'api',
        target: 'lead',
        locations: ['record_header', 'list_item'],
        params: [{ field: 'assigned_to', required: true }],
        undoable: true,
        successMessage: 'Lead reassigned.',
      }) as Record<string, unknown>;
      expect(out.undoable).toBe(true);
      expect(out.type).toBe('api');
      expect(out.operation).toBeUndefined();
    });

    it("`operation: 'update'` + `undoable: true` (framework runtime route) stays accepted", () => {
      const out = ActionSchema.parse({
        ...base,
        operation: 'update',
        patch: { status: 'reassigned' },
        undoable: true,
      }) as Record<string, unknown>;
      expect(out.undoable).toBe(true);
      expect(out.operation).toBe('update');
      // `type` stays at the default platform route — the declarative write is
      // not a type of its own.
      expect(out.type).toBe('script');
    });

    it.each(ActionType.options)('leaves type:%s alone when `undoable` is absent', (type) => {
      const r = ActionSchema.safeParse({ ...base, ...shapeByType[type] });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it.each(UNFULFILLED_TYPES)('leaves type:%s alone when `undoable: false` — nothing was promised', (type) => {
      const r = ActionSchema.safeParse({ ...base, ...shapeByType[type], undoable: false });
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });
  });
});
