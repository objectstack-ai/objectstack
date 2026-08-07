// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3095 — `ViewMetadataSchema` is the canonical schema the `view` metadata type
 * registers (save-time 422 validation + read-time diagnostics). It MUST validate
 * all three runtime `view` shapes GENUINELY, where the bare container
 * {@link ViewSchema} was a no-op (Zod strip-parsed ViewItem/personalization
 * bodies to `{}`, so a broken `config` sailed through "valid").
 *
 *   1. defineView aggregate container  (non-empty)
 *   2. standalone ViewItem record       ({ name, object, viewKind, config })
 *   3. flattened personalization overlay (raw config + inherited identity, #2555)
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ViewMetadataSchema } from './view.zod';

const PLACEHOLDER_DATA = { provider: 'object', object: 'crm_lead' } as const;

describe('ViewMetadataSchema — genuine validation across the three runtime shapes (#3095)', () => {
  // ── shape 2: standalone ViewItem record ───────────────────────────────────
  describe('ViewItem record form', () => {
    it('accepts a well-formed list ViewItem', () => {
      const r = ViewMetadataSchema.safeParse({
        name: 'crm_lead.all',
        object: 'crm_lead',
        viewKind: 'list',
        label: 'All Leads',
        config: { type: 'grid', columns: ['name'], data: PLACEHOLDER_DATA },
      });
      expect(r.success).toBe(true);
    });

    it('REJECTS a ViewItem whose kanban config is missing groupByField (was a no-op under ViewSchema)', () => {
      const r = ViewMetadataSchema.safeParse({
        name: 'crm_lead.pipeline',
        object: 'crm_lead',
        viewKind: 'list',
        config: {
          type: 'kanban',
          columns: ['name'],
          // groupByField is required by KanbanConfigSchema — omit it.
          kanban: { summarizeField: 'amount', columns: ['name'] },
        },
      });
      expect(r.success).toBe(false);
    });

    it('accepts a well-formed form ViewItem', () => {
      const r = ViewMetadataSchema.safeParse({
        name: 'crm_lead.edit',
        object: 'crm_lead',
        viewKind: 'form',
        config: { type: 'simple', sections: [{ label: 'Details', fields: ['name'] }] },
      });
      expect(r.success).toBe(true);
    });

    it('REJECTS a form ViewItem carrying an invalid form `type` (config validated, not stripped)', () => {
      const r = ViewMetadataSchema.safeParse({
        name: 'crm_lead.edit',
        object: 'crm_lead',
        viewKind: 'form',
        config: { type: 'not_a_real_form_type' },
      });
      expect(r.success).toBe(false);
    });
  });

  // ── shape 1: defineView container ─────────────────────────────────────────
  describe('defineView container form', () => {
    it('accepts a non-empty container', () => {
      const r = ViewMetadataSchema.safeParse({
        list: { type: 'grid', data: PLACEHOLDER_DATA, columns: [{ field: 'name' }] },
      });
      expect(r.success).toBe(true);
    });

    it('REJECTS a container whose nested list is missing required columns', () => {
      const r = ViewMetadataSchema.safeParse({
        list: { type: 'grid', data: PLACEHOLDER_DATA },
      });
      expect(r.success).toBe(false);
    });

    it('REJECTS an explicitly-empty container (zero views — mirrors defineView)', () => {
      // A body that names container slots but fills none of them registers no
      // view; the container member's non-empty refine rejects it, and the
      // flattened members reject it via their container-key guards.
      expect(ViewMetadataSchema.safeParse({ listViews: {}, formViews: {} }).success).toBe(false);
      expect(ViewMetadataSchema.safeParse({ listViews: {} }).success).toBe(false);
    });

    it('REJECTS a bare `{}` — the pin this line used to make, reversed by #5599', () => {
      // This assertion previously read `.toBe(true)`, justified as "legacy-
      // compatible … a truly empty body carries no viewKind/object, so every
      // consumer that filters on identity drops it". #5599 measured what that
      // reasoning missed: `saveMetaItem` does NOT drop it — it persists the
      // ORIGINAL body and reports success, so `{}` (and `{ nope: 1 }`, which
      // reached the same lenient member) landed as an ACTIVE view overlay that
      // renders nothing, badged `valid: true` on read. The lenient branch was
      // intentional; accepting bodies that are not views was the accident.
      expect(ViewMetadataSchema.safeParse({}).success).toBe(false);
    });
  });

  // ── shape 3: flattened personalization overlay (#2555) ────────────────────
  describe('flattened personalization overlay form', () => {
    it('accepts a raw list config with identity inherited from the shadowed entry', () => {
      // The exact shape normalizeViewMetadata persists on a console column-sort PUT.
      const r = ViewMetadataSchema.safeParse({
        type: 'grid',
        data: { provider: 'object', object: 'showcase_task' },
        columns: ['title'],
        sort: [{ id: '29200fa8-c416-471e-9ca3-913f9308ad89', field: 'estimate_hours', order: 'desc' }],
        name: 'showcase_task.default',
        viewKind: 'list',
        object: 'showcase_task',
        label: 'All Tasks',
      });
      expect(r.success).toBe(true);
    });

    it('accepts a raw list config with NO identity (adhoc PUT, no registry entry to inherit from)', () => {
      const r = ViewMetadataSchema.safeParse({
        type: 'grid',
        data: { provider: 'object', object: 'showcase_task' },
        columns: ['title'],
        sort: [{ field: 'estimate_hours', order: 'desc' }],
        name: 'adhoc.view',
      });
      expect(r.success).toBe(true);
    });

    it('accepts a raw form config overlay', () => {
      const r = ViewMetadataSchema.safeParse({
        type: 'simple',
        sections: [{ label: 'Details', fields: ['name'] }],
        name: 'crm_lead.edit',
        viewKind: 'form',
        object: 'crm_lead',
      });
      expect(r.success).toBe(true);
    });

    it('REJECTS a flattened list overlay whose kanban binding is broken (genuine, not stripped)', () => {
      const r = ViewMetadataSchema.safeParse({
        type: 'kanban',
        columns: ['name'],
        kanban: { summarizeField: 'amount', columns: ['name'] }, // no groupByField
        name: 'crm_lead.pipeline',
        viewKind: 'list',
        object: 'crm_lead',
      });
      expect(r.success).toBe(false);
    });

    it('preserves auxiliary Studio round-trip keys without a strict-mode 422', () => {
      // isPinned/sortOrder ride along on the overlay; the schema validates but
      // must not reject unknown top-level aux keys (saveMetaItem persists verbatim).
      const r = ViewMetadataSchema.safeParse({
        type: 'grid',
        data: PLACEHOLDER_DATA,
        columns: ['name'],
        name: 'crm_lead.all',
        viewKind: 'list',
        object: 'crm_lead',
        isPinned: true,
        sortOrder: 3,
      });
      expect(r.success).toBe(true);
    });
  });

  // ── mutual exclusion: a broken record/container is never rescued ──────────
  describe('member exclusivity', () => {
    it('does not rescue a broken record via the flattened branch (config guard)', () => {
      // A record body carries a nested `config`; the flattened members pin
      // `config` to undefined, so a broken config cannot be silently stripped.
      const r = ViewMetadataSchema.safeParse({
        name: 'crm_lead.pipeline',
        object: 'crm_lead',
        viewKind: 'list',
        config: { type: 'grid', columns: 'not-an-array' },
      });
      expect(r.success).toBe(false);
    });

    it('does not rescue a broken container via the flattened branch (list guard)', () => {
      const r = ViewMetadataSchema.safeParse({
        list: { type: 'grid', data: PLACEHOLDER_DATA }, // missing columns
        name: 'crm_lead.default',
      });
      expect(r.success).toBe(false);
    });
  });

  // ── #5599: the identity precondition, ahead of all four arms ──────────────
  describe('identity precondition (#5599)', () => {
    // The reproduction from the issue, verbatim. On `origin/main` every input
    // in this block was ACCEPTED and reduced to `{ type: 'simple' }` — member 4
    // (`FormViewSchema.extend(…).strip()`) both strips unknown keys and requires
    // none, so it matched any object at all and handed the union a wildcard.
    it('REJECTS `{ nope: 1 }` — the issue\'s headline input', () => {
      expect(ViewMetadataSchema.safeParse({ nope: 1 }).success).toBe(false);
    });

    it('REJECTS a body of purely unrecognized keys, however many', () => {
      expect(ViewMetadataSchema.safeParse({ nope: 1, alsoNope: 'x', deeply: { wrong: true } }).success).toBe(false);
    });

    it('REJECTS a body whose keys are ALL misspellings of real ones', () => {
      // The AI-authored / hand-typo case the issue calls out: a whole body
      // written in the wrong dialect used to land silently as an empty view.
      expect(ViewMetadataSchema.safeParse({ colums: ['name'], viewType: 'grid' }).success).toBe(false);
    });

    it('REJECTS a top-level `id` — never declared on any member (批 18 Q1)', () => {
      expect(ViewMetadataSchema.safeParse({ id: 'abc' }).success).toBe(false);
    });

    it('names the failure instead of reporting a rootless `invalid_union`', () => {
      const r = ViewMetadataSchema.safeParse({ nope: 1 });
      expect(r.success).toBe(false);
      if (r.success) return;
      // ONE issue, not one + four union branches: `z.NEVER` aborts the pipe.
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0]!.code).toBe('custom');
      expect(r.error.issues[0]!.message).toContain('no recognized `view` key');
      // The prescription travels with the rejection (AGENTS.md post-task §3).
      expect(r.error.issues[0]!.message).toContain('listViews');
      expect(r.error.issues[0]!.message).toContain('`nope`');
    });

    it('fails CLOSED, not open — it does not reject everything', () => {
      // Guards against the mirror-image defect: a precondition that rejects the
      // platform's own writes is strictly worse than the hole it closed.
      expect(ViewMetadataSchema.safeParse({ type: 'simple' }).success).toBe(true);
    });

    // Every shape the platform itself writes carries a declared key, so the
    // precondition is inert on all of them. These are the acceptance inputs the
    // #5074 trace established for `updateView`'s `{ ...current, ...partial }`.
    it.each([
      ['a pin PUT with no stored item to merge', { isPinned: true }],
      ['a switcher-reorder PUT', { sortOrder: 3 }],
      ['a column-only overlay', { columns: ['name'] }],
      ['a filter-only overlay', { filter: [{ field: 'name', operator: 'contains', value: 'x' }] }],
      ['a hide PUT', { hidden: true }],
      ['an order-only overlay', { order: 2 }],
      ['a renamed view that still carries its config', { label: 'New name', columns: ['name'] }],
    ])('leaves %s alone', (_label, body) => {
      expect(ViewMetadataSchema.safeParse(body).success).toBe(true);
    });

    // ── identity is not shape ────────────────────────────────────────────────
    // The subtraction that makes the precondition bite on the WRITE path.
    // `saveMetaItem` normalizes before it validates: `normalizeViewMetadata`
    // stamps `name` onto every view body, and `viewIdentityPatch` inherits
    // `viewKind`/`object`/`label` from the shadowed registry entry (#2555). So
    // `{ nope: 1 }` reaches this schema as `{ nope: 1, name: 'garbage_view' }`
    // — the exact body #5599 reports as PERSISTED. Counting those keys as
    // evidence would have made the whole precondition a no-op where it matters.
    it.each([
      ['the stamped name alone', { name: 'garbage_view' }],
      ['garbage plus the stamped name (the write path\'s real input)', { nope: 1, name: 'garbage_view' }],
      ['garbage plus FULL inherited identity (baseline present)', {
        nope: 1, name: 'showcase_task.default', viewKind: 'list', object: 'showcase_task', label: 'All Tasks',
      }],
      ['identity with no content at all', { viewKind: 'list', object: 'crm_lead', label: 'Leads' }],
    ])('REJECTS %s', (_label, body) => {
      expect(ViewMetadataSchema.safeParse(body).success).toBe(false);
    });

    it('says WHY an identity-only body is rejected, in its own words', () => {
      const r = ViewMetadataSchema.safeParse({ name: 'v', object: 'o', label: 'L' });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues[0]!.message).toContain('only identity fields');
      expect(r.error.issues[0]!.message).toContain('the write path stamps them itself');
    });

    it('reports the two halves separately — `name` is discounted, not "unrecognized"', () => {
      // The write path's real input. Calling `name` unrecognized would send an
      // author to fix a key that is perfectly valid and merely not evidence.
      const r = ViewMetadataSchema.safeParse({ nope: 1, name: 'garbage_view' });
      expect(r.success).toBe(false);
      if (r.success) return;
      const message = r.error.issues[0]!.message;
      expect(message).toContain('unrecognized key `nope`');
      expect(message).toContain('only identity fields (`name`)');
    });

    it('…but identity PLUS any real view key is fine — leanness is not the bar', () => {
      expect(ViewMetadataSchema.safeParse({ name: 'v', object: 'o', hidden: true }).success).toBe(true);
      expect(ViewMetadataSchema.safeParse({ name: 'v', viewKind: 'list', isPinned: true }).success).toBe(true);
    });

    it('leaves non-objects to the union — it judges objects only', () => {
      // Unchanged from origin/main: these were already rejected, as invalid_union.
      for (const body of ['a string', 42, null, undefined, []]) {
        const r = ViewMetadataSchema.safeParse(body);
        expect(r.success).toBe(false);
        if (!r.success) expect(r.error.issues[0]!.code).toBe('invalid_union');
      }
    });

    it('derives its vocabulary from the members, so a new arm key is admitted automatically', () => {
      // Not a hand-written list: every top-level key any member declares counts.
      // `splitSize` is a FormView key nobody would think to allow-list by hand.
      expect(ViewMetadataSchema.safeParse({ splitSize: 30 }).success).toBe(true);
      // …and a key that exists only NESTED (inside `config`) is not top-level
      // vocabulary, so it cannot smuggle a garbage body through.
      expect(ViewMetadataSchema.safeParse({ groupByField: 'stage' }).success).toBe(false);
    });

    it('does NOT close the arms — `.strip()` round-tripping is untouched (#5074)', () => {
      // The ruling on #5599 kept every arm's `.strip()`: a body that speaks the
      // vocabulary still carries undeclared aux keys through without a 422.
      // This is the deliberate residue of the minimal fix, pinned so a later
      // batch cannot mistake it for an oversight.
      const r = ViewMetadataSchema.safeParse({ isPinned: true, someFutureStudioKey: 'x' });
      expect(r.success).toBe(true);
    });
  });

  // ── JSON Schema emission (/api/v1/meta/types/view) ────────────────────────
  it('converts to a JSON Schema anyOf (union → anyOf) without throwing', () => {
    const json = z.toJSONSchema(ViewMetadataSchema, { unrepresentable: 'any' }) as Record<string, unknown>;
    expect(Array.isArray(json.anyOf)).toBe(true);
    expect((json.anyOf as unknown[]).length).toBe(4);
  });
});
