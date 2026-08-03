// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { BulkActionDefSchema } from './bulk-action.zod';

/** Parse and return the flattened issue messages (empty = clean). */
const reject = (input: unknown): string[] => {
  const r = BulkActionDefSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

const ok = (input: unknown) => {
  const r = BulkActionDefSchema.safeParse(input);
  if (!r.success) throw new Error(`expected parse to succeed:\n${r.error.issues.map((i) => i.message).join('\n')}`);
  return r.data;
};

describe('BulkActionDefSchema (#4457)', () => {
  describe('— the shapes real views author today keep parsing', () => {
    // Lifted verbatim from `examples/app-showcase/src/ui/views/project.view.ts`
    // and `task.view.ts`. Typing a key that was `z.record(z.any())` is only
    // safe if the surface it governed still fits, so the specimens are the
    // regression guard, not a hand-written approximation.
    it('accepts the showcase aggregate def', () => {
      expect(ok({ name: 'showcase_recalc_selection', operation: 'custom', execution: 'aggregate' }))
        .toMatchObject({ name: 'showcase_recalc_selection', execution: 'aggregate' });
    });

    it('accepts a mass update with a select param', () => {
      const def = ok({
        name: 'set_labels',
        label: 'Set Labels',
        operation: 'update',
        confirmText: 'Set these labels on every selected project?',
        params: [{
          name: 'labels',
          label: 'Labels',
          type: 'select',
          multiple: true,
          required: true,
          options: [{ label: 'Frontend', value: 'frontend' }, { label: 'QA', value: 'qa' }],
        }],
      });
      expect(def.params?.[0]).toMatchObject({ name: 'labels', type: 'select', multiple: true });
    });

    it('accepts a lookup param with `object` / `labelField`', () => {
      // The bulk-dialog spelling of what an ActionParam calls `reference`.
      // Documented divergence — see the module header; the point of typing it
      // is that the divergence is now written down instead of implied.
      const def = ok({
        name: 'assign_team',
        operation: 'update',
        params: [{ name: 'team_members', type: 'lookup', object: 'sys_user', labelField: 'name', multiple: true }],
      });
      expect(def.params?.[0]).toMatchObject({ object: 'sys_user', labelField: 'name' });
    });

    it('forwards unknown WIDGET config on a param — the renderer declares a catch-all', () => {
      const def = ok({
        name: 'reschedule',
        operation: 'update',
        params: [{ name: 'shift_days', type: 'number', min: 1, max: 90, step: 1 }],
      });
      expect(def.params?.[0]).toMatchObject({ min: 1, max: 90, step: 1 });
    });

    // ── DELIBERATE OPENNESS — DO NOT "FIX" THIS INTO A STRICT SITE ──────────
    // This assertion exists to be found by the next strictness sweep (#4001)
    // and to stop it. `params[].options[]` is `.passthrough()` ON PURPOSE, on
    // measured evidence rather than symmetry with its parent:
    //
    //   - `bulkParamToField` SPREADS every option entry into the field
    //     metadata — `options?.map(o => ({ ...o, value: String(o.value) }))`,
    //     objectui `packages/plugin-grid/src/components/bulkParamToField.ts:131`
    //   - the vocabulary it lands in is `SelectOptionMetadata` (objectui
    //     `packages/types/src/field-types.ts:288`), which declares `color` /
    //     `icon` / `disabled` / `visibleWhen` beyond `{ label, value }` and
    //     reads them (`option?.color`, `packages/fields/src/index.tsx:1089`)
    //
    // So a strip here does not protect an author from a typo; it deletes
    // widget config the renderer would have honoured, silently — exactly the
    // failure mode the def LEVEL's strictness exists to catch. Until the
    // 2026-08-03 re-measure this level was bare strip while the ledger prose
    // already called it open (maintainer verdict A: make the code match).
    it('forwards unknown WIDGET config on an OPTION — deliberately open, not an oversight', () => {
      const def = ok({
        name: 'set_stage',
        operation: 'update',
        params: [{
          name: 'stage',
          type: 'select',
          options: [
            { label: 'In Review', value: 'in_review', color: '#8B5CF6', icon: 'eye' },
            { label: 'Done', value: 'done', disabled: true, visibleWhen: "current_user.is_admin" },
          ],
        }],
      });
      const options = def.params?.[0]?.options;
      expect(options?.[0]).toMatchObject({ label: 'In Review', value: 'in_review', color: '#8B5CF6', icon: 'eye' });
      expect(options?.[1]).toMatchObject({ disabled: true, visibleWhen: 'current_user.is_admin' });
    });

    it('an option still requires the declared pair to be well-typed', () => {
      // Open ≠ shapeless: passthrough forwards UNDECLARED keys, it does not
      // relax the two keys the executor and the widget both read.
      expect(reject({
        name: 'set_stage',
        operation: 'update',
        params: [{ name: 'stage', type: 'select', options: [{ value: 'done' }] }],
      }).join('\n')).toMatch(/params\.0\.options\.0\.label/);
    });
  });

  describe('— a mis-spelled key is an error, not a silent default', () => {
    it('names the offending key and the canonical one', () => {
      const issues = reject({ name: 'set_labels', opeartion: 'update' });
      expect(issues.join('\n')).toContain('`opeartion` → `operation`');
    });

    it('catches the aggregate typo that silently costs N requests', () => {
      // `excution: 'aggregate'` parsed before #4457, leaving the def in
      // per-record mode: the endpoint written for ONE `_selectedIds` call gets
      // N calls instead — the exact defect objectui#3139 existed to fix.
      const issues = reject({ name: 'recalc_selection', operation: 'custom', excution: 'aggregate' });
      expect(issues.join('\n')).toContain('`excution` → `execution`');
    });

    it('refuses a hand-written `actionDef` with the reason, not a spelling hint', () => {
      const issues = reject({
        name: 'recalc_selection',
        operation: 'custom',
        execution: 'aggregate',
        actionDef: { type: 'api', endpoint: '/whatever' },
      });
      expect(issues.join('\n')).toContain('attached by the renderer, not authored');
      expect(issues.join('\n')).toContain('past the action registry');
    });

    it('prescribes the view-side replacement for the retired `bulkEnabled`', () => {
      const issues = reject({ name: 'mark_done', operation: 'update', bulkEnabled: true });
      expect(issues.join('\n')).toContain('retired in spec 17');
    });
  });

  describe("— `operation: 'custom'` must say which dispatch it means", () => {
    it('rejects a custom def with no execution mode', () => {
      // Without `execution: 'aggregate'` the renderer attaches no `actionDef`,
      // and the executor's custom branch resolves to `Promise.resolve()` per
      // row: N green ticks, zero work (ADR-0078 — reports success, does
      // nothing).
      const issues = reject({ name: 'generate_qr_zip', operation: 'custom' });
      expect(issues.join('\n')).toContain('treats as a no-op');
      // Both legal forms are named, so the fix does not need the source.
      expect(issues.join('\n')).toContain("`bulkActions: ['generate_qr_zip']`");
      expect(issues.join('\n')).toContain("`execution: 'aggregate'`");
    });

    it("rejects an explicit `execution: 'perRecord'` for the same reason", () => {
      // The default spelled out loud is still the inert shape — the per-record
      // form is `bulkActions`, not a def.
      expect(reject({ name: 'generate_qr_zip', operation: 'custom', execution: 'perRecord' }).join('\n'))
        .toContain('treats as a no-op');
    });
  });

  describe('— keys the executor would never read are refused, not dropped', () => {
    it('rejects `execution` on a data-plane operation', () => {
      expect(reject({ name: 'set_labels', operation: 'update', execution: 'aggregate' }).join('\n'))
        .toContain("only applies to `operation: 'custom'`");
    });

    it('rejects `patch` outside an update', () => {
      expect(reject({ name: 'purge', operation: 'delete', patch: { archived: true } }).join('\n'))
        .toContain("only applies to `operation: 'update'`");
    });

    it('rejects `params` on a delete — a bulk delete takes ids only', () => {
      expect(reject({ name: 'purge', operation: 'delete', params: [{ name: 'why', type: 'text' }] }).join('\n'))
        .toContain('the executor never reads');
    });

    it('rejects `batchSize` on an aggregate def and points at `maxRecords`', () => {
      const issues = reject({ name: 'gen_zip', operation: 'custom', execution: 'aggregate', batchSize: 25 });
      expect(issues.join('\n')).toContain('ONE call by definition');
      expect(issues.join('\n')).toContain('`maxRecords`');
    });

    it('keeps `batchSize` legal on the data-plane operations it governs', () => {
      expect(ok({ name: 'set_labels', operation: 'update', batchSize: 25 }).batchSize).toBe(25);
      expect(ok({ name: 'purge', operation: 'delete', batchSize: 25 }).batchSize).toBe(25);
    });
  });

  describe('— floor', () => {
    it('requires `name` and `operation`', () => {
      expect(reject({}).length).toBeGreaterThan(0);
      expect(reject({ name: 'set_labels' }).join('\n')).toContain('operation');
      expect(reject({ operation: 'update' }).join('\n')).toContain('name');
    });

    it('holds `name` to the same identifier rule as an action', () => {
      // An aggregate def's `name` IS an action name — a different spelling
      // rule here would let a def name something no action could be called.
      expect(reject({ name: 'Set Labels', operation: 'update' }).length).toBeGreaterThan(0);
    });

    it('accepts a bare `visible` CEL string and the `{ dialect, source }` envelope', () => {
      expect(ok({ name: 'purge', operation: 'delete', visible: "'admin' in current_user.positions" }).visible)
        .toBeDefined();
      expect(ok({ name: 'purge', operation: 'delete', visible: { dialect: 'cel', source: 'true' } }).visible)
        .toBeDefined();
    });
  });
});
