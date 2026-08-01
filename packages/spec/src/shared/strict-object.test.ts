// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { lazySchema } from './lazy-schema';
import { strictObject } from './strict-object';

const WidgetSchema = lazySchema(() =>
  strictObject(
    {
      surface: 'this widget',
      history: 'Until #4001 these were dropped silently — the widget still rendered.',
      aliases: { visibleWhen: 'visible' },
      guidance: { span: '`span` was retired in vX. Use `columnSpan`.' },
    },
    {
      name: z.string(),
      visible: z.boolean().optional(),
      columnSpan: z.number().optional(),
    },
  ),
);

/** Composition fixtures — the shapes real schema files actually build. */
const Described = lazySchema(() =>
  strictObject({ surface: 'a described surface', history: 'h' }, { a: z.string() }).describe('d'),
);
const Refined = lazySchema(() =>
  strictObject({ surface: 'a refined surface', history: 'h' }, {
    a: z.string(),
    b: z.string().optional(),
  }).superRefine((v, ctx) => {
    if (!v.b) ctx.addIssue({ code: 'custom', path: ['b'], message: 'need b' });
  }),
);
const Extended = lazySchema(() =>
  strictObject({ surface: 'a base surface', history: 'h' }, { a: z.string() })
    .extend({ c: z.string().optional() }),
);

describe('strictObject', () => {
  it('rejects an unknown key, naming the surface and echoing the key', () => {
    const r = WidgetSchema.safeParse({ name: 'x', nonsense: 1 });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toContain('this widget');
    expect(r.error!.issues[0].message).toContain('`nonsense`');
  });

  it('suggests the closest key from the SHAPE — no transcribed key list', () => {
    const r = WidgetSchema.safeParse({ name: 'x', colummSpan: 2 });
    expect(r.error!.issues[0].message).toContain('`colummSpan` → `columnSpan`');
  });

  it('still honours a curated alias', () => {
    const r = WidgetSchema.safeParse({ name: 'x', visibleWhen: true });
    expect(r.error!.issues[0].message).toContain('`visibleWhen` → `visible`');
  });

  it('still honours a tombstone, and suppresses the rename for it', () => {
    const r = WidgetSchema.safeParse({ name: 'x', span: 2 });
    const msg = r.error!.issues[0].message;
    expect(msg).toContain('`span` was retired');
    expect(msg).not.toContain('→');
  });

  /**
   * The structural replacement for the "accepts every declared key" probe each
   * hand-transcribed key array needed. Asserted once, here, instead of per
   * schema: a key list read from the shape cannot disagree with it.
   */
  it('accepts every key the shape declares', () => {
    expect(WidgetSchema.safeParse({ name: 'x', visible: true, columnSpan: 1 }).success).toBe(true);
  });

  it('preserves type inference', () => {
    const v: z.infer<typeof WidgetSchema> = { name: 'x' };
    expect(v.name).toBe('x');
  });

  it('takes extraKeys as additional suggestion candidates', () => {
    const Base = lazySchema(() =>
      strictObject({ surface: 'a base', history: 'h', extraKeys: ['inherited'] }, { a: z.string() }),
    );
    // `inherited` is not declared here, so it is still rejected …
    expect(Base.safeParse({ a: '1', inherited: 2 }).success).toBe(false);
    // … but a near-miss of it resolves, which is what extraKeys is for.
    expect(Base.safeParse({ a: '1', inherted: 2 }).error!.issues[0].message)
      .toContain('`inherted` → `inherited`');
  });

  describe('composition — the shapes real schema files use', () => {
    it('survives .describe()', () => {
      expect(Described.safeParse({ a: '1' }).success).toBe(true);
      expect(Described.safeParse({ a: '1', z: 2 }).success).toBe(false);
    });

    it('survives .superRefine() — both the refinement and strictness fire', () => {
      expect(Refined.safeParse({ a: '1' }).success).toBe(false);
      expect(Refined.safeParse({ a: '1', b: '2' }).success).toBe(true);
      expect(Refined.safeParse({ a: '1', b: '2', zz: 1 }).success).toBe(false);
    });

    /**
     * `.extend()` INHERITS strictness. The ledger flags this as the trap to
     * watch when batching: a response-side extension of an authoring schema
     * must `.strip()` back, or a wire shape silently goes strict and an
     * upstream field addition becomes a parse crash.
     */
    it('propagates strictness through .extend()', () => {
      expect(Extended.safeParse({ a: '1', c: '2' }).success).toBe(true);
      expect(Extended.safeParse({ a: '1', nope: 1 }).success).toBe(false);
    });

    it('can be strip()ped back for a response-side extension', () => {
      const Wire = lazySchema(() =>
        strictObject({ surface: 's', history: 'h' }, { a: z.string() })
          .extend({ serverOnly: z.string().optional() })
          .strip(),
      );
      expect(Wire.safeParse({ a: '1', addedUpstreamLater: true }).success).toBe(true);
    });
  });

  /**
   * ADR-0089 D3a hit `Cannot set properties of undefined (setting 'ref')` when
   * `.strict()` pipelines met zod's `toJSONSchema` traversal over the lazySchema
   * Proxy. The ledger names it as the hazard to watch while batching, so it is
   * pinned here rather than rediscovered per conversion.
   */
  it('converts to JSON Schema through the lazy proxy without throwing', () => {
    for (const s of [WidgetSchema, Described, Refined, Extended] as unknown as z.ZodTypeAny[]) {
      expect(() => z.toJSONSchema(s)).not.toThrow();
    }
  });

  /**
   * Recorded in the ledger during the datasource step and load-bearing for the
   * whole campaign: strictness does NOT widen or narrow the published JSON
   * Schema. `build-schemas.ts` converts with `io: 'output'`, and output mode
   * already emits `additionalProperties: false` for a `.strip()` object — so
   * these flips align the parse with a contract that was already published,
   * rather than changing it.
   */
  it('emits additionalProperties: false, which strip mode already published', () => {
    const strictJson = z.toJSONSchema(WidgetSchema as unknown as z.ZodTypeAny) as {
      additionalProperties?: unknown;
    };
    const stripJson = z.toJSONSchema(z.object({ name: z.string() })) as {
      additionalProperties?: unknown;
    };
    expect(strictJson.additionalProperties).toBe(false);
    expect(stripJson.additionalProperties).toBe(false);
  });
});

/**
 * Never suggest a key the schema cannot accept.
 *
 * `retiredKey` declares a removed key as `z.never().optional()` so the removal
 * is audible in both channels an upgrading author hits — `tsc` and the parse.
 * That is deliberate and stronger than a `guidance` entry. But it also leaves
 * the dead key in `Object.keys(shape)`, and the suggester offered it: on
 * `skill`, a `triggerPhrase` typo was answered with
 * "Did you mean `triggerPhrases`?" — a key that had been REMOVED. An author who
 * complied got a second rejection telling them to delete what they had just
 * been told to write.
 *
 * Ledger finding 7, third occurrence: this campaign's own fix signposting the
 * way into the failure mode it exists to kill. Pinned here because the two
 * helpers are each correct alone and only wrong in combination — which is the
 * kind of defect no per-schema test goes looking for.
 */
describe('strictObject × retiredKey — suggestions never point at a dead key', () => {
  const Tombstoned = lazySchema(() =>
    strictObject(
      {
        surface: 'this thing',
        history: 'Until #4001 these were dropped silently.',
      },
      {
        label: z.string(),
        // Shaped exactly as `retiredKey()` builds it.
        triggerPhrases: z
          .never({ error: () => '`triggerPhrases` was removed in vX. Delete it.' })
          .optional(),
      },
    ),
  );

  const messageFor = (body: Record<string, unknown>) => {
    const r = Tombstoned.safeParse({ label: 'x', ...body });
    expect(r.success).toBe(false);
    return r.error!.issues.map((i) => i.message).join(' | ');
  };

  it('does not offer a removed key as the fix for a near-miss of it', () => {
    expect(messageFor({ triggerPhrase: ['hi'] })).not.toContain('triggerPhrases');
  });

  it('still offers a LIVE key for a near-miss of it', () => {
    // The narrowing must not cost the suggester its actual job.
    expect(messageFor({ lable: 'x' })).toContain('`lable` → `label`');
  });

  it('still raises the tombstone prescription when the dead key is written', () => {
    // Excluded from the CANDIDATE list, not from the shape — writing it must
    // still produce the upgrade instruction, not a generic unknown-key error.
    expect(messageFor({ triggerPhrases: ['hi'] })).toContain('was removed in vX');
  });
});
