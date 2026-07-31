// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  ACTION_BODY_RECORD_WRITE_DISCARDED,
  ACTION_RECORD_WRITE_PATTERNS,
  extractActionRecordWrites,
  validateActionRecordWrites,
} from './validate-action-record-writes.js';

/** A stack with one top-level script action bound to `crm_deal`. */
const stackWith = (source: string, extra: Record<string, unknown> = {}) => ({
  objects: [{ name: 'crm_deal', fields: [{ name: 'stage' }, { name: 'amount' }] }],
  actions: [
    {
      name: 'close_deal',
      objectName: 'crm_deal',
      type: 'script',
      body: { language: 'js', source, capabilities: ['api.write'] },
      ...extra,
    },
  ],
});

describe('ACTION_RECORD_WRITE_PATTERNS ledger reconciliation', () => {
  // Each declared pattern is driven END-TO-END through the public validator —
  // prefilter, action walk, value-dedupe and field collection all sit between
  // the example and the finding, so any of them silently swallowing a pattern
  // turns this red. A ledger entry cannot be declared-but-unverified (#3528).
  it.each(ACTION_RECORD_WRITE_PATTERNS.map((p) => [p.id, p] as const))(
    'pattern %s extracts exactly its declared fields, end to end',
    (_id, pattern) => {
      const extracted = extractActionRecordWrites(pattern.example.source);
      expect(extracted.map((w) => w.field)).toEqual([...pattern.example.fields]);
      // Every extracted write is attributed to THIS entry — an example that
      // happens to match a neighbouring pattern would not prove this one works.
      expect([...new Set(extracted.map((w) => w.patternId))]).toEqual([pattern.id]);

      const findings = validateActionRecordWrites(stackWith(pattern.example.source));
      expect(findings).toHaveLength(1);
      expect(findings[0].rule).toBe(ACTION_BODY_RECORD_WRITE_DISCARDED);
      for (const field of pattern.example.fields) {
        expect(findings[0].message).toContain(`'${field}'`);
      }
    },
  );

  it('declares a unique, non-empty id per pattern', () => {
    const ids = ACTION_RECORD_WRITE_PATTERNS.map((p) => p.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('validateActionRecordWrites', () => {
  it('flags a write to a DECLARED field — the defect #4345 is about', () => {
    // `stage` is declared on crm_deal. It is dropped exactly like an unknown
    // column would be, so silence here would imply it persisted.
    const findings = validateActionRecordWrites(stackWith("ctx.record.stage = 'won'; return { ok: true };"));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].where).toBe('action "close_deal" › body');
    expect(findings[0].path).toBe('actions[0].body.source');
    expect(findings[0].message).toContain('READ-ONLY');
    expect(findings[0].message).toContain('whether or not the object declares');
  });

  it('flags a declared and an undeclared field identically', () => {
    const declared = validateActionRecordWrites(stackWith("ctx.record.stage = 'won';"));
    const unknown = validateActionRecordWrites(stackWith("ctx.record.stgae = 'won';"));
    expect(declared).toHaveLength(1);
    expect(unknown).toHaveLength(1);
    // No did-you-mean: the field name is not the bug, so suggesting a spelling
    // fix would aim the author at the wrong one.
    expect(unknown[0].hint).not.toContain('Did you mean');
  });

  it('names the bound object and the ctx.api remedy in the hint', () => {
    const [finding] = validateActionRecordWrites(stackWith("ctx.record.stage = 'won';"));
    expect(finding.hint).toContain("ctx.api.object('crm_deal').update(");
    expect(finding.hint).toContain('api.write');
  });

  it('reports each field once, however often it is written', () => {
    const findings = validateActionRecordWrites(
      stackWith("ctx.record.stage = 'a'; ctx.record.stage = 'b'; ctx.record.amount = 1;"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("'stage', 'amount'");
  });

  it('walks object-embedded actions too', () => {
    const findings = validateActionRecordWrites({
      objects: [
        {
          name: 'crm_deal',
          fields: [{ name: 'stage' }],
          actions: [
            {
              name: 'close_deal',
              type: 'script',
              body: { language: 'js', source: "ctx.record.stage = 'won';" },
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].actions[0].body.source');
    expect(findings[0].hint).toContain("ctx.api.object('crm_deal')");
  });

  it('reports a defineStack-merged action ONCE, at the position the author wrote it', () => {
    // `mergeObjectActions` appends a top-level action carrying `objectName`
    // into the object while keeping the top-level entry. After a Zod parse the
    // two are structurally equal but NOT reference-identical, so the fixture
    // uses independent clones — a shared reference would make identity dedupe
    // look like it works and hide the double report.
    const authored = () => ({
      name: 'close_deal',
      objectName: 'crm_deal',
      type: 'script',
      body: { language: 'js', source: "ctx.record.stage = 'won';", capabilities: [] },
    });
    const findings = validateActionRecordWrites({
      objects: [{ name: 'crm_deal', fields: [{ name: 'stage' }], actions: [authored()] }],
      actions: [authored()],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('actions[0].body.source');
  });

  it('does not confuse two different actions that write the same field', () => {
    const action = (name: string) => ({
      name,
      objectName: 'crm_deal',
      type: 'script',
      body: { language: 'js', source: "ctx.record.stage = 'won';", capabilities: [] },
    });
    const findings = validateActionRecordWrites({
      objects: [{ name: 'crm_deal', fields: [{ name: 'stage' }] }],
      actions: [action('close_deal'), action('reopen_deal')],
    });
    expect(findings.map((f) => f.where)).toEqual([
      'action "close_deal" › body',
      'action "reopen_deal" › body',
    ]);
  });

  it('accepts the name-keyed map authoring shape', () => {
    const findings = validateActionRecordWrites({
      objects: [{ name: 'crm_deal', fields: [{ name: 'stage' }] }],
      actions: {
        close_deal: {
          objectName: 'crm_deal',
          type: 'script',
          body: { language: 'js', source: "ctx.record.stage = 'won';" },
        },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('action "close_deal" › body');
  });

  describe('stays silent', () => {
    const clean = (stack: Record<string, unknown>) => expect(validateActionRecordWrites(stack)).toEqual([]);

    it('on a body that only READS the record', () => {
      clean(stackWith('var id = ctx.recordId || (ctx.record && ctx.record.id); return { id: id };'));
    });

    it('on the documented remedy — persisting through ctx.api', () => {
      clean(
        stackWith(
          "await ctx.api.object('crm_deal').update({ id: ctx.recordId, stage: 'won' }); return { ok: true };",
        ),
      );
    });

    it('on an L1 expression body, which cannot assign at all', () => {
      clean({
        objects: [{ name: 'crm_deal' }],
        actions: [
          {
            name: 'a',
            objectName: 'crm_deal',
            body: { language: 'expression', source: 'ctx.record.stage' },
          },
        ],
      });
    });

    it('on a target-bound action — a registered handler is not this sandbox seam', () => {
      clean({
        objects: [{ name: 'crm_deal' }],
        actions: [{ name: 'a', objectName: 'crm_deal', type: 'script', target: 'completeTask' }],
      });
    });

    it('on a hook body — a hook ctx carries no record', () => {
      clean({
        objects: [{ name: 'crm_deal' }],
        hooks: [{ name: 'h', object: 'crm_deal', body: { language: 'js', source: 'ctx.record.x = 1;' } }],
      });
    });

    it('on stacks with no actions at all', () => {
      clean({});
      clean({ objects: [{ name: 'crm_deal' }] });
    });

    it('on a body writing something that merely LOOKS like ctx.record', () => {
      clean(stackWith("var rec = { record: {} }; rec.record.stage = 'won'; ctx.result.record = 1;"));
    });

    // Statically opaque — skipped deliberately, and covered at run time by the
    // sandbox's write-recorder proxy instead of guessed at here.
    it('on a computed key', () => {
      clean(stackWith("var k = 'stage'; ctx.record[k] = 'won';"));
    });

    it('on an aliased reference (no data-flow analysis by design)', () => {
      clean(stackWith("var r = ctx.record; r.stage = 'won';"));
    });

    it('on a spread-only Object.assign', () => {
      clean(stackWith('Object.assign(ctx.record, patch);'));
    });
  });

  it('never throws on a syntactically broken body, and still reports what it recovered', () => {
    // The TypeScript parser recovers rather than bailing, so a body the sandbox
    // would refuse to compile still yields the writes it could see. Reporting
    // them is right — the assignment is there — and the contract that matters
    // is that a malformed body cannot take the whole validation run down.
    const findings = validateActionRecordWrites(stackWith('ctx.record.stage = ;;; function('));
    expect(findings.map((f) => f.rule)).toEqual([ACTION_BODY_RECORD_WRITE_DISCARDED]);
    expect(() => validateActionRecordWrites(stackWith('}{'))).not.toThrow();
  });
});
