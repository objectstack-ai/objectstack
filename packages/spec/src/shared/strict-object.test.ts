// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { execFileSync } from 'node:child_process';

import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { lazySchema } from './lazy-schema';
import { strictObject } from './strict-object';
import { keySetMatches } from './suggestions.zod';

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

  it('ONE alias entry already covers every case/separator spelling of itself (#5481)', () => {
    // The fact that makes a second spelling of the same probe not merely
    // redundant but unreachable: the table is indexed by `aliasProbe`, which
    // folds case, `_`, `-` and spaces. Three tables on `main` carried a second
    // spelling (`rollup`/`rollUp`, `object_name`/`objectName`,
    // `strokeDasharray`/`strokeDashArray`) that could never have fired — the
    // later one simply overwrote the earlier at the same index. Deleting them
    // is behaviour-preserving, and this is the assertion that says so.
    for (const spelling of ['visible_when', 'VISIBLE-WHEN', 'Visible When', 'visiblewhen']) {
      const r = WidgetSchema.safeParse({ name: 'x', [spelling]: true });
      expect(r.success, `${spelling} should be rejected`).toBe(false);
      expect(r.error!.issues[0].message, `${spelling} should still reach the alias`)
        .toContain(`\`${spelling}\` → \`visible\``);
    }
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
 * The ORDER the message emits its parts in — pinned as order, not as presence.
 *
 * Every assertion above this block is a `toContain` on one fragment, so all of
 * them stayed green while `history` sat in the MIDDLE of the message, between
 * "which key is wrong" and "here is the fix". That mattered once #5762 promoted
 * `flow-time-relative-descriptor-invalid` to **error**: several consumers render
 * a finding on ONE line (`os validate`'s `• where: message`, CI logs, and
 * `validateFlowTriggerReadiness`, which flattens the newlines out of the schema's
 * own text), and `TimeRelativeTriggerSchema`'s history sentence is 224
 * characters — so the author, often an AI, read the front of the line and found
 * a sentence about 2026 instead of the key to write (#5955).
 *
 * Direction A of that issue's ruling: move the sentence to the end. Nothing is
 * deleted and nothing is conditional — which is exactly why it needs an ORDER
 * pin rather than another presence check. A future edit that folds `history`
 * back into the front matter passes every `toContain` in this file; it fails
 * here.
 */
describe('message order — the fix comes before the history (#5955)', () => {
  const HISTORY = 'Until #4001 these were dropped silently — the widget still rendered.';

  const messageFor = (body: Record<string, unknown>) => {
    const r = WidgetSchema.safeParse({ name: 'x', ...body });
    expect(r.success).toBe(false);
    return r.error!.issues[0]!.message;
  };

  it('names the wrong key first, then the rename, then the history', () => {
    const m = messageFor({ colummSpan: 2 });
    // 1. which key is wrong — and nothing before it
    expect(m.startsWith('Unrecognized key(s) on this widget: `colummSpan`.')).toBe(true);
    // 2. the fix, immediately after it (this is the whole point of the reorder)
    expect(m).toContain('`colummSpan`. Did you mean `colummSpan` → `columnSpan`?');
    // 3. the history sentence, verbatim, last — moved, never dropped
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
    expect(m.indexOf('Did you mean')).toBeLessThan(m.indexOf(HISTORY));
  });

  it('puts a guidance prescription ahead of the history too', () => {
    // The other fix channel. A tombstone/wrong-layer prescription is as
    // actionable as a rename, so it cannot sit behind the sentence either.
    const m = messageFor({ span: 2 });
    expect(m.startsWith('Unrecognized key(s) on this widget: `span`.')).toBe(true);
    expect(m).toContain('\n  • `span` was retired in vX. Use `columnSpan`.');
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
    expect(m.indexOf('was retired in vX')).toBeLessThan(m.indexOf(HISTORY));
  });

  it('keeps BOTH fix channels ahead of the history in one message', () => {
    const m = messageFor({ span: 2, colummSpan: 3 });
    expect(m.startsWith('Unrecognized key(s) on this widget: `span`, `colummSpan`.')).toBe(true);
    expect(m.indexOf('Did you mean')).toBeLessThan(m.indexOf(HISTORY));
    expect(m.indexOf('was retired in vX')).toBeLessThan(m.indexOf(HISTORY));
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
  });

  it('emits the history exactly once, whatever the key count', () => {
    // It is a per-SURFACE sentence, not a per-key one: zod raises a single
    // `unrecognized_keys` issue naming every offending key, so the sentence is
    // appended to that one message once — the property that makes "last" a
    // well-defined position at all.
    const m = messageFor({ colummSpan: 2, alsoWrong: 3, andThis: 4 });
    expect(m.split(HISTORY)).toHaveLength(2);
  });

  it('is unchanged when there is no fix to offer', () => {
    // No rename, no prescription — the sentence follows the key statement
    // directly, exactly as it always did. Full-message pin, so any stray
    // separator or duplicated clause fails here.
    expect(messageFor({ nonsense: 1 }))
      .toBe(`Unrecognized key(s) on this widget: \`nonsense\`. ${HISTORY}`);
  });
});

/**
 * The set-keyed `guidance` form (#6619) — one prescription shared by a named
 * key family, the vocabulary the three hand-written `$ZodErrorMap`s needed
 * before they could fold into this template at all.
 *
 * A second shape on a shared template is where accidental precedence bugs
 * live, so the resolution rules are pinned here as behaviour rather than left
 * to the docblock:
 *
 *   1. an exact `guidance` entry ALWAYS wins over any set;
 *   2. among sets, declaration order wins;
 *   3. a set match suppresses the rename channel for that key;
 *   4. a set speaks once per message, at the first key that matched it.
 */
describe('strictObject guidanceSets — the set-keyed prescription channel (#6619)', () => {
  const HISTORY = 'Until #4001 these were dropped silently.';
  const SetSchema = lazySchema(() =>
    strictObject(
      {
        surface: 'this set surface',
        history: HISTORY,
        guidance: {
          // Deliberately ALSO a member of `legacySet` below: the exact entry
          // must win (rule 1), so this text — not the set's — answers `alpha`.
          alpha: '`alpha` has its own exact prescription.',
        },
        guidanceSets: [
          {
            name: 'legacySet',
            keys: ['alpha', 'beta', 'gamma'],
            prescription: 'The legacy family was retired — use `replacement`.',
          },
          {
            name: 'overlapSet',
            // `beta` is also in legacySet; declaration order (rule 2) decides.
            keys: ['beta', 'delta'],
            prescription: 'The overlap family answer.',
          },
          {
            name: 'patternSet',
            keys: /^exp(ort|erimental)/,
            examples: ['exportMode', 'experimentalFlag'],
            prescription: 'Export/experimental knobs live in `replacement`.',
          },
        ],
      },
      {
        name: z.string(),
        replacement: z.string().optional(),
      },
    ),
  );

  const messageFor = (body: Record<string, unknown>) => {
    const r = SetSchema.safeParse({ name: 'x', ...body });
    expect(r.success).toBe(false);
    return r.error!.issues[0]!.message;
  };

  it('answers a set member with the set prescription, as a bullet, ahead of the history', () => {
    const m = messageFor({ beta: 1 });
    expect(m.startsWith('Unrecognized key(s) on this set surface: `beta`.')).toBe(true);
    expect(m).toContain('\n  • The legacy family was retired — use `replacement`.');
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
  });

  it('rule 1 — an exact guidance entry always wins over a set that also claims the key', () => {
    const m = messageFor({ alpha: 1 });
    expect(m).toContain('`alpha` has its own exact prescription.');
    expect(m).not.toContain('The legacy family was retired');
  });

  it('rule 2 — among sets, declaration order decides', () => {
    // `beta` is a member of BOTH sets; the first declared set answers.
    const m = messageFor({ beta: 1 });
    expect(m).toContain('The legacy family was retired');
    expect(m).not.toContain('The overlap family answer.');
    // The second set is not dead — its unshared member still reaches it.
    expect(messageFor({ delta: 1 })).toContain('The overlap family answer.');
  });

  it('rule 3 — a set match suppresses the rename channel for that key', () => {
    // `gamma` is within edit distance of nothing declared, but make the point
    // on a key that IS: `replacment` (no set) gets a rename, while a set
    // member never does — matched means answered.
    expect(messageFor({ replacment: 'x' })).toContain('`replacment` → `replacement`');
    expect(messageFor({ gamma: 1 })).not.toContain('Did you mean');
  });

  it('rule 4 — a set speaks once per message, however many members are written', () => {
    const m = messageFor({ beta: 1, gamma: 1 });
    expect(m.split('The legacy family was retired')).toHaveLength(2);
  });

  it('rules compose in one message: exact + two sets + a rename, each exactly once', () => {
    const m = messageFor({ alpha: 1, beta: 1, delta: 1, replacment: 'x' });
    expect(m).toContain('`alpha` has its own exact prescription.');
    expect(m).toContain('The legacy family was retired');
    expect(m).toContain('The overlap family answer.');
    expect(m).toContain('`replacment` → `replacement`');
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
    // Bullets appear in KEY order (alpha, beta, delta), not set-declaration
    // order — the set's bullet sits at the first key that matched it.
    expect(m.indexOf('exact prescription')).toBeLessThan(m.indexOf('legacy family'));
    expect(m.indexOf('legacy family')).toBeLessThan(m.indexOf('overlap family'));
  });

  it('the pattern form answers spellings nobody enumerated', () => {
    for (const key of ['exportMode', 'experimentalFlag', 'exportTarget']) {
      expect(messageFor({ [key]: 1 }), key).toContain('Export/experimental knobs live in `replacement`.');
    }
    // …and does not claim keys outside itself.
    expect(messageFor({ zz: 1 })).not.toContain('Export/experimental knobs');
  });

  it('keySetMatches is stateless even on a /g pattern', () => {
    // `RegExp#test` advances `lastIndex` on a sticky/global regex, making the
    // same key alternate between matched and unmatched on repeated parses.
    // `keySetMatches` uses `String#search`, which restores `lastIndex` by
    // spec — asserted directly so a refactor back to `.test()` fails here.
    const set = { name: 's', keys: /vis/g, prescription: 'p' } as const;
    expect(keySetMatches(set, 'visibleWhenn')).toBe(true);
    expect(keySetMatches(set, 'visibleWhenn')).toBe(true);
    expect(keySetMatches(set, 'visibleWhenn')).toBe(true);
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

/**
 * The error map must be built lazily, which is what makes this helper safe
 * inside an import cycle.
 *
 * `suggestions.zod` imports `FieldType` from `data/field.zod`, so when
 * `field.zod` adopted `strictObject` the graph closed a loop
 * (field → strict-object → suggestions → field). Under `OS_EAGER_SCHEMAS=1`
 * — how `build-schemas.ts` runs — every `lazySchema` body executes at module
 * init, so whichever module the loader entered first saw a half-initialized
 * partner and threw before a single schema was built.
 *
 * The whole test suite passed through that: tests import lazily, so the cycle
 * never resolved in the order that breaks. Only the eager build caught it. The
 * gate is real (`check:generated` runs `gen:schema`), but it is a whole-package
 * build — this pins the actual property, right next to the helper, so a future
 * edit that hoists the map back to construction time fails here first.
 */
describe('strictObject — the error map is lazy, so cycles cannot break it', () => {
  it('does not build the error map until a key is actually rejected', () => {
    // `strictUnknownKeyError` normalizes the alias table via `Object.entries`,
    // so a getter on it fires exactly when the map is built — an observable
    // proxy for "has construction reached into the imported module yet?".
    let aliasesRead = 0;
    const aliases = Object.defineProperty({} as Record<string, string>, 'visibleWhen', {
      enumerable: true,
      get() {
        aliasesRead++;
        return 'visible';
      },
    });

    const Schema = strictObject({ surface: 's', history: 'h', aliases }, { a: z.string() });
    expect(aliasesRead, 'the map was built at construction — cycles will break it').toBe(0);

    // A clean parse never reaches the unknown-key path either.
    expect(Schema.safeParse({ a: 'x' }).success).toBe(true);
    expect(aliasesRead).toBe(0);

    // First rejection builds it, and the deferral costs nothing in the message.
    const result = Schema.safeParse({ a: 'x', visibleWhen: 1 });
    expect(result.success).toBe(false);
    expect(aliasesRead).toBe(1);
    expect(result.error!.issues[0].message).toContain('`visibleWhen` → `visible`');

    // Built once, then reused.
    Schema.safeParse({ a: 'x', bogus: 1 });
    expect(aliasesRead).toBe(1);
  });
});

// ============================================================================
// #5593 — this module survives being entered FIRST in its own import cycle.
//
// `strictObject` is called at MODULE SCOPE by schemas that sit inside the
// `field.zod` ↔ `suggestions.zod` ↔ `strict-object` cycle, so under
// `OS_EAGER_SCHEMAS=1` it can run while this module is still initializing.
// Everything it touches on the way in must therefore be reachable from the
// first instruction of module evaluation — which rules out a module-level
// `const` for the declaration registry, and is why `declarationStore()` is a
// hoisted `function` declaration.
//
// ⚠️ Why this needs its own subprocess rather than an ordinary assertion:
// `lazySchema` defers construction behind a Proxy, so a normal `vitest run`
// never evaluates a schema at import time and the hazard is invisible. #5593
// shipped the regression and the ordinary suite stayed green — what caught it
// was CI's `check-test-completeness` gate noticing that
// `automation/flow-region-cycle.test.ts` was counted and never reported,
// because ITS subprocess died at import with `ReferenceError: Cannot access
// 'DECLARATIONS' before initialization` and vitest could not even format the
// stack. Two guards, one hazard: that file states the cycle it protects
// (#4415), this one states the rule this module has to keep.
//
// The entry point is deliberately `data/field.zod.ts` — the module whose
// own module-scope `strictObject(…)` call is the one that lands here
// mid-initialization — reached through a module that pulls THIS file first.
// ============================================================================
describe('#5593 — eager construction with this module entered first', () => {
  it('does not throw at import time under OS_EAGER_SCHEMAS=1', () => {
    const barrel = new URL('../automation/index.ts', import.meta.url).href;
    const run = (): string =>
      execFileSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e',
          `import ${JSON.stringify(barrel)};
           console.log('ok');`],
        { env: { ...process.env, OS_EAGER_SCHEMAS: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
    expect(
      run(),
      'a module-level `const` in strict-object.ts is in its TDZ here — use a hoisted function',
    ).toBe('ok');
  }, 60_000);
});
