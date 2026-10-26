/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The derived STRICT AUTHORING FACE, and the three things objectui#8345 owes as
 * pins rather than promises (objectui#5250, maintainer 2026-09-04, decision
 * batch #25, option 2):
 *
 *   (a) a known-good document parses under the strict face;
 *   (b) a document with one invented top-level key is REFUSED, with an
 *       `unrecognized_keys` issue NAMING that key;
 *   (c) the tolerant face is behaviourally unchanged on the same inputs.
 *
 * (c) is the load-bearing one and the reason several tests below assert things
 * that read as obvious: the card publishes a SECOND face, and the whole appetite
 * rests on the first one not moving. "Unchanged" that nobody measures is a
 * promise; the tables below are the measurement.
 *
 * ## Two further properties this file pins, because the card's risk is there
 *
 * **The recursion point.** Since objectui#8344 a child slot resolves its
 * component arm to the component union rather than to the ~21 base keys. A
 * strict twin derived over the OLD recursion point would refuse every child
 * node's own declared props — the order-of-magnitude error objectui#7935 exists
 * to prevent, and the reason this card was blocked behind #8344. So a child
 * node's OWN component props being accepted is pinned as directly as the
 * invented key being refused.
 *
 * **Checks survive the clone.** The walker clones by patching a copy of the
 * def, ⛔ never by rebuilding with `z.object(shape)`. A rebuilt twin drops
 * `def.checks`, so every `.refine()` / `.superRefine()` on the way down is lost
 * and the face UNDER-reports red — the one failure direction that reads as good
 * news. Both the synthetic control and the live instance are below.
 *
 * ## Instruments, and one that is NOT one
 *
 * ⚠️ `vitest` does not typecheck. The type-level pins at the bottom are read by
 * `tsc -p tsconfig.test.json` (the third program of this package's `type-check`
 * script) and by nothing else — a green vitest run says nothing about them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AnyComponentSchema,
  deriveStrictAuthoringSchema,
  StrictAnyComponentSchema,
  StrictSchemaNodeSchema,
  type StrictAuthoringLimit,
} from '../zod/index.zod.js';
import { SchemaNodeSchema } from '../zod/base.zod.js';

/* ── Reading a refusal ───────────────────────────────────────────────────── */

type Issue = {
  code: string;
  path: PropertyKey[];
  keys?: string[];
  errors?: Issue[][];
  issues?: Issue[];
};

/**
 * Flatten a zod error tree. A refusal inside a union arrives as one
 * `invalid_union` carrying a group of issue lists per arm, and a child slot is
 * a union of six arms, so the interesting issue is never at the top level. A
 * refusal inside a `Map` or `Set` entry whose key is not a property key arrives
 * the same way one level down: one `invalid_key` / `invalid_element` carrying
 * the entry's own issues under `issues`.
 */
function flatten(issues: readonly Issue[], out: Issue[] = []): Issue[] {
  for (const issue of issues) {
    if (issue.code === 'invalid_union' && issue.errors) {
      for (const group of issue.errors) flatten(group, out);
    } else if (issue.issues) {
      flatten(issue.issues, out);
    } else {
      out.push(issue);
    }
  }
  return out;
}

/** Every key named by an `unrecognized_keys` issue anywhere in the refusal. */
function refusedKeys(result: z.ZodSafeParseResult<unknown>): string[] {
  if (result.success) return [];
  const keys = flatten(result.error.issues as unknown as Issue[])
    .filter((i) => i.code === 'unrecognized_keys')
    .flatMap((i) => i.keys ?? []);
  return [...new Set(keys)].sort();
}

/* ── Documents ───────────────────────────────────────────────────────────── */

/** Declared keys only, one level of nesting, two different component types. */
const KNOWN_GOOD = {
  type: 'card',
  title: 'Quarterly figures',
  children: [
    { type: 'button', label: 'Export', variant: 'default' },
    { type: 'text', content: 'Updated hourly' },
  ],
} as const;

const INVENTED_TOP_LEVEL_KEY = 'inventedTopLevelKey';
const INVENTED_CHILD_KEY = 'inventedChildKey';

const INVENTED_AT_ROOT = { ...KNOWN_GOOD, [INVENTED_TOP_LEVEL_KEY]: 1 };
const INVENTED_AT_CHILD = {
  type: 'card',
  children: [{ type: 'button', label: 'Export', [INVENTED_CHILD_KEY]: 1 }],
};

describe('the strict authoring face — positive controls', () => {
  it('the published barrel exports the derived faces and the derivation', () => {
    expect(typeof StrictAnyComponentSchema.safeParse).toBe('function');
    expect(typeof StrictSchemaNodeSchema.safeParse).toBe('function');
    expect(typeof deriveStrictAuthoringSchema).toBe('function');
  });

  it('the tolerant face admits an undeclared key — the control every table below is read against', () => {
    // If this ever goes false, the rendering face's `.passthrough()` was
    // flipped and no assertion in this file means what it says.
    expect(AnyComponentSchema.safeParse(INVENTED_AT_ROOT).success).toBe(true);
    expect(AnyComponentSchema.safeParse(INVENTED_AT_CHILD).success).toBe(true);
  });
});

describe('(a) a known-good document parses under the strict face', () => {
  it('accepts it', () => {
    expect(StrictAnyComponentSchema.safeParse(KNOWN_GOOD).success).toBe(true);
  });

  it('and the tolerant face accepts the same document — the two agree where nothing is invented', () => {
    expect(AnyComponentSchema.safeParse(KNOWN_GOOD).success).toBe(true);
  });
});

describe('(b) one invented top-level key is refused, and the key is named', () => {
  it('refuses, with an `unrecognized_keys` issue naming exactly that key', () => {
    const result = StrictAnyComponentSchema.safeParse(INVENTED_AT_ROOT);
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toEqual([INVENTED_TOP_LEVEL_KEY]);
  });

  it('the same document is accepted by the tolerant face — the difference is the whole card', () => {
    expect(AnyComponentSchema.safeParse(INVENTED_AT_ROOT).success).toBe(true);
  });
});

describe('(c) the tolerant face is behaviourally unchanged — a pin, not a promise', () => {
  /**
   * Read AFTER the strict derivation has been forced, deliberately: the walk is
   * deferred behind `z.lazy`, so a table read before it would not be evidence
   * about anything the derivation does.
   */
  it('every verdict of the tolerant face is what it was, with the strict face fully derived', () => {
    StrictAnyComponentSchema.safeParse(KNOWN_GOOD);
    StrictSchemaNodeSchema.safeParse(KNOWN_GOOD);

    const table: Array<[label: string, input: unknown, accepted: boolean]> = [
      ['a known-good document', KNOWN_GOOD, true],
      ['an invented key at the root', INVENTED_AT_ROOT, true],
      ['an invented key on a child', INVENTED_AT_CHILD, true],
      ['a node whose `type` resolves in no arm', { type: 'no-such-component' }, false],
      ['a node with no `type` at all', { label: 'x' }, false],
    ];

    expect(table.map(([label, input]) => [label, AnyComponentSchema.safeParse(input).success]))
      .toEqual(table.map(([label, , accepted]) => [label, accepted]));
  });

  it('deriving mutates nothing: the tolerant graph carries exactly the closed objects it carried before', () => {
    // `catchall: never` IS strictness. Some objects on the face are strict
    // already — the schemas imported from `@objectstack/spec` are — so the
    // reading that matters is that the count does not MOVE, not that it is zero.
    const before = census(AnyComponentSchema);
    const twin = deriveStrictAuthoringSchema(AnyComponentSchema);
    twin.safeParse(KNOWN_GOOD); // force the deferred subtrees
    const after = census(AnyComponentSchema);
    expect(after.closed).toBe(before.closed);
    expect(after.openPaths.length).toBe(before.openPaths.length);
    expect(before.closed).toBeGreaterThan(0); // non-vacuity: the census sees something
  });
});

describe('a nested node is judged by its own component schema (objectui#8344 is load-bearing)', () => {
  it('refuses an invented key on a CHILD node, naming it', () => {
    const result = StrictAnyComponentSchema.safeParse(INVENTED_AT_CHILD);
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toEqual([INVENTED_CHILD_KEY]);
  });

  it("accepts a child's OWN component props — a strict twin of the pre-#8344 recursion point would refuse these", () => {
    // `variant` and `size` are declared by `ButtonSchema` and by NOTHING in the
    // base key set. If the child slot were judged by a strict `BaseSchemaCore`,
    // both would come back as unrecognised — the order-of-magnitude error the
    // blocker existed to prevent, spelled as an assertion.
    const result = StrictAnyComponentSchema.safeParse({
      type: 'card',
      children: [{ type: 'button', label: 'Export', variant: 'destructive', size: 'sm' }],
    });
    expect(refusedKeys(result)).toEqual([]);
    expect(result.success).toBe(true);
  });
});

describe('checks survive the clone — a twin rebuilt with `z.object(shape)` would not', () => {
  const refined = z.object({ a: z.number() }).refine((v) => v.a > 0, 'a must be positive');

  it('the derived twin still refuses what the refinement refuses', () => {
    expect(deriveStrictAuthoringSchema(refined).safeParse({ a: -1 }).success).toBe(false);
    expect(deriveStrictAuthoringSchema(refined).safeParse({ a: 1 }).success).toBe(true);
  });

  it('the banned spelling loses it — this is why the walker patches the def', () => {
    // The caricature, kept as a control so the paragraph above is a measurement.
    expect(z.object({ a: z.number() }).safeParse({ a: -1 }).success).toBe(true);
  });

  it('the live instance: the `chatbot` body document is refused at a child slot', () => {
    // `defineNodeComponentUnion` installs a `superRefine` on the union that sits
    // in the node slot, and only there. A twin that dropped the check would
    // accept the nested form and this test would go red on the strict row.
    //
    // ⚠️ INVERTED by objectui#8572, which retired `ChatbotSchema.body` on both
    // published faces: the two ROOT legs read `toBe(true)` until that ruling, and
    // the asymmetry they recorded — accepted at the root, refused one slot down —
    // is gone because the ARM itself now refuses the key at every depth. The legs
    // are inverted rather than dropped because the root verdict is half of what
    // this case reads, and a case that stopped reading the root would stop
    // noticing if the two faces ever disagreed there.
    // ⚠️ And the honest consequence, stated rather than left for a reader to
    // discover: this input no longer DISCRIMINATES the clause, because the arm
    // refuses it with or without the wrapper. The clause's own disposition is not
    // this file's and not this ruling's; `../zod/base.zod.ts` carries it.
    const chatbot = { type: 'chatbot', messages: [], body: { foo: 'bar' } };
    const nested = { type: 'card', children: [chatbot] };

    expect(StrictAnyComponentSchema.safeParse(chatbot).success).toBe(false);
    expect(StrictAnyComponentSchema.safeParse(nested).success).toBe(false);
    // …and the same on the tolerant face, which is (c) again on this input.
    expect(AnyComponentSchema.safeParse(chatbot).success).toBe(false);
    expect(AnyComponentSchema.safeParse(nested).success).toBe(false);
  });
});

describe('the node face (child slot) twin', () => {
  it('admits the primitives a child slot admits', () => {
    expect(StrictSchemaNodeSchema.safeParse('a bare string').success).toBe(true);
    expect(StrictSchemaNodeSchema.safeParse(7).success).toBe(true);
  });

  it('closes a component in that slot', () => {
    expect(StrictSchemaNodeSchema.safeParse({ type: 'text', content: 'x' }).success).toBe(true);
    const result = StrictSchemaNodeSchema.safeParse({ type: 'text', content: 'x', nope: 1 });
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toEqual(['nope']);
  });
});

describe('the population is closed — every reachable object on the twin, not a sample document', () => {
  /**
   * ⭐ THE PIN WHOSE ABSENCE LET A REAL DEFECT SHIP.
   *
   * Every other pin in this file reads a DOCUMENT: it invents a key at some
   * place a test author thought of, and asks what the face says. That can only
   * ever cover the places someone thought of — and the corpus cannot close the
   * gap either, because no document among the 556 the measurement script reads
   * carries an undeclared key inside the objects that were open. Base, head and
   * the prototype-agreement check all read the same number whichever way the
   * walker's type guard is written.
   *
   * This one reads the POPULATION instead: walk the derived twin and require
   * that every object in it carries `catchall: never`. It is the assertion that
   * makes the published sentence — "closes every declared object, at every
   * depth" — checkable rather than asserted.
   */
  it('every object reachable on the strict twin is closed', () => {
    const twin = deriveStrictAuthoringSchema(AnyComponentSchema);
    twin.safeParse(KNOWN_GOOD); // force every deferred subtree before counting
    const seen = census(twin);

    expect(seen.openPaths, 'an object on the strict twin still admits undeclared keys').toEqual([]);
    expect(seen.closed, 'the census found no closed objects — it is not reading the twin').toBeGreaterThan(250);
  });

  it('the census can see CALLABLE schema nodes — the control the defect turned on', () => {
    // ⚠️ Non-vacuity, and specifically for the class that was invisible. A
    // census that cannot see `typeof 'function'` nodes reports "all closed"
    // over a graph it never entered. If this ever reads 0, the assertion above
    // has quietly stopped covering ~20 subtrees and must not be trusted.
    expect(census(AnyComponentSchema).functionTyped).toBeGreaterThan(0);
  });

  it('the tolerant face is NOT closed — so "closed" is a discriminator, not a tautology', () => {
    expect(census(AnyComponentSchema).openPaths.length).toBeGreaterThan(0);
  });

  it('REPRO-A: an invented key deep inside a spec-derived subtree is refused and named', () => {
    // The document the population pin exists for. Before the walker admitted
    // callable nodes this parsed CLEAN and `inventedDeepKey` was silently
    // dropped from the output, while the root-level control below was correctly
    // refused — the asymmetry that falsified the published contract text.
    const deep = {
      type: 'page',
      interfaceConfig: { source: 'x', sort: [{ field: 'a', order: 'asc', inventedDeepKey: 1 }] },
    };
    const result = StrictAnyComponentSchema.safeParse(deep);
    expect(result.success).toBe(false);
    expect(refusedKeys(result)).toContain('inventedDeepKey');

    // The control, in the same document: the root-level key was never the problem.
    expect(refusedKeys(StrictAnyComponentSchema.safeParse({ ...deep, inventedTopKey: 1 })))
      .toContain('inventedTopKey');

    // …and (c) again on this input: the tolerant face takes both.
    expect(AnyComponentSchema.safeParse(deep).success).toBe(true);
  });
});

describe('what strict could not close is enumerated, not claimed', () => {
  /**
   * Every def type the walker treats as opaque. Over the PUBLISHED face nothing
   * else may be reported: a schema-bearing wrapper the walker has no arm for
   * is reported under its own def type (the `success` case below), so a new
   * kind arriving on the face reds the subset assertion and names itself.
   */
  const OPAQUE_KINDS = ['custom', 'function', 'transform'] as const;

  it('every limit reported over the published face is one of the recorded opaque kinds', () => {
    const limits: StrictAuthoringLimit[] = [];
    const twin = deriveStrictAuthoringSchema(AnyComponentSchema, {
      onOpaqueShape: (limit) => limits.push(limit),
    });
    // ⚠️ A census is only as complete as the subtrees that have been walked, and
    // `z.lazy` defers. Forcing one document parse resolves the node slot and,
    // through it, the rest of the graph.
    twin.safeParse(KNOWN_GOOD);

    expect(limits.length, 'a census that reports nothing is not a census').toBeGreaterThan(0);
    const unexpected = [...new Set(limits.map((l) => l.kind))]
      .filter((kind) => !(OPAQUE_KINDS as readonly string[]).includes(kind))
      .sort();
    expect(unexpected, 'the walker met a shape it could not close and this list does not name it').toEqual([]);
    expect(limits.every((l) => l.path.startsWith('#'))).toBe(true);
  });

  it('the reporter recognises all three kinds — a synthetic positive control', () => {
    // Which of the three the LIVE face exhibits moves with `@objectstack/spec`,
    // so the population is asserted as a subset above and the reporter's own
    // coverage is pinned here instead. Without this, a walker that had silently
    // stopped recognising one kind would still pass the subset assertion.
    const kinds: string[] = [];
    deriveStrictAuthoringSchema(
      z.object({
        opaqueCustom: z.custom<string>((v) => typeof v === 'string'),
        opaqueTransform: z.string().transform((v) => v.length),
        opaqueFunction: z.function(),
      }),
      { onOpaqueShape: (limit) => kinds.push(limit.kind) },
    );
    expect([...new Set(kinds)].sort()).toEqual([...OPAQUE_KINDS]);
  });

  it('a `z.preprocess` has its real schema closed — the `out` side of a pipe is walked', () => {
    // The asymmetry this guards: `X.transform(f)` keeps the schema in `in`,
    // `z.preprocess(f, X)` keeps it in `out`. A walker that read only `in`
    // closes the first and leaves the second wide open, with no symptom.
    const preprocessed = z.preprocess((v) => v, z.object({ a: z.string() }));
    expect(preprocessed.safeParse({ a: 'x', bogus: 1 }).success).toBe(true);
    expect(deriveStrictAuthoringSchema(preprocessed).safeParse({ a: 'x', bogus: 1 }).success).toBe(false);
  });

  /**
   * ⚠️ THE FOUR WRAPPER KINDS THE FIRST ROUND SWALLOWED — the director's item 3
   * on objectui#8345. `set`, `map`, `prefault` and `promise` each carry a schema,
   * and the walker's `default:` arm used to hand every one of them back as if it
   * were a leaf: the object inside stayed OPEN and nothing was reported — a hole
   * with no symptom, because none of the four is on the published face (the
   * census at the end of this block pins that absence, which is why every
   * control here is synthetic rather than a document). Each is walked now: the
   * inner object is closed, an invented key inside it is refused and NAMED, and
   * an opaque node inside is still reported — the report path passes through
   * the wrapper instead of stopping at it.
   */
  describe('the four wrapper kinds are walked, not swallowed — `set` / `map` / `prefault` / `promise`', () => {
    const inner = z.object({ a: z.string() });
    const INVENTED = 'inventedInsideWrapper';
    const withInvented = { a: 'x', [INVENTED]: 1 };

    it('`set`: an invented key inside the element is refused and named', () => {
      const wrapped = z.set(inner);
      expect(wrapped.safeParse(new Set([withInvented])).success).toBe(true); // (c) on this input
      const result = deriveStrictAuthoringSchema(wrapped).safeParse(new Set([withInvented]));
      expect(result.success).toBe(false);
      expect(refusedKeys(result)).toEqual([INVENTED]);
    });

    it('`map`: the key schema AND the value schema are closed', () => {
      const wrapped = z.map(inner, inner);
      expect(wrapped.safeParse(new Map([[withInvented, withInvented]])).success).toBe(true);
      const twin = deriveStrictAuthoringSchema(wrapped);
      expect(refusedKeys(twin.safeParse(new Map([[{ a: 'k' }, withInvented]])))).toEqual([INVENTED]);
      expect(refusedKeys(twin.safeParse(new Map([[withInvented, { a: 'v' }]])))).toEqual([INVENTED]);
      expect(twin.safeParse(new Map([[{ a: 'k' }, { a: 'v' }]])).success).toBe(true);
    });

    it('`prefault`: the inner object is closed and the prefault value still applies', () => {
      const wrapped = inner.prefault({ a: 'fallback' });
      expect(wrapped.safeParse(withInvented).success).toBe(true);
      const twin = deriveStrictAuthoringSchema(wrapped);
      expect(refusedKeys(twin.safeParse(withInvented))).toEqual([INVENTED]);
      expect(twin.safeParse(undefined)).toEqual({ success: true, data: { a: 'fallback' } });
    });

    it('`promise`: the inner object is closed (async parse — zod refuses to parse a promise synchronously)', async () => {
      const wrapped = z.promise(inner);
      expect((await wrapped.safeParseAsync(Promise.resolve(withInvented))).success).toBe(true);
      const result = await deriveStrictAuthoringSchema(wrapped).safeParseAsync(Promise.resolve(withInvented));
      expect(result.success).toBe(false);
      expect(refusedKeys(result)).toEqual([INVENTED]);
    });

    it('the report path passes THROUGH each wrapper: an opaque node inside is still reported, with its trail', () => {
      // One opaque node PER wrapper, deliberately: the walker memoises by node
      // identity and reports each distinct node once, so a single shared
      // instance would be reported at the first wrapper only and read as four
      // silent ones.
      const opaque = () => z.custom<string>((v) => typeof v === 'string');
      const reported: StrictAuthoringLimit[] = [];
      deriveStrictAuthoringSchema(
        z.object({
          inSet: z.set(opaque()),
          inMapKey: z.map(opaque(), z.string()),
          inMapValue: z.map(z.string(), opaque()),
          inPrefault: opaque().prefault('x'),
          inPromise: z.promise(opaque()),
        }),
        { onOpaqueShape: (limit) => reported.push(limit) },
      );
      expect(reported.map((l) => `${l.kind}@${l.path}`).sort()).toEqual([
        'custom@#/shape/inMapKey/keyType',
        'custom@#/shape/inMapValue/valueType',
        'custom@#/shape/inPrefault/innerType',
        'custom@#/shape/inPromise/innerType',
        'custom@#/shape/inSet/valueType',
      ]);
    });

    it('none of the four is on the published face today — the controls above are the coverage, not the corpus', () => {
      // Read on the FORCED tolerant graph, so the count is of the whole face and
      // not of whatever the eager part happened to hold.
      StrictAnyComponentSchema.safeParse(KNOWN_GOOD);
      const { kinds } = census(AnyComponentSchema);
      expect(['set', 'map', 'prefault', 'promise'].map((kind) => [kind, kinds[kind] ?? 0]))
        .toEqual([['set', 0], ['map', 0], ['prefault', 0], ['promise', 0]]);
      // Non-vacuity: the same census sees the kinds the face IS made of.
      expect(kinds.object).toBeGreaterThan(250);
      expect(kinds.union).toBeGreaterThan(0);
    });
  });

  it('a schema-bearing kind the walker has NO arm for is reported, not swallowed — `success` is the live instance', () => {
    // zod 4.4.3 leaves exactly one such kind: `z.success(X)` parses X into a
    // boolean and can never refuse, so walking it would move an OUTPUT value
    // while closing nothing. It is reported under its own def type instead —
    // the half of the reporter's contract the four wrappers above used to break.
    const reported: StrictAuthoringLimit[] = [];
    deriveStrictAuthoringSchema(
      z.object({ flag: z.success(z.object({ a: z.string() })) }),
      { onOpaqueShape: (limit) => reported.push(limit) },
    );
    expect(reported).toEqual([{ kind: 'success', path: '#/shape/flag' }]);

    // The control the other way: a leaf is a leaf, and nothing is reported.
    const leafReports: StrictAuthoringLimit[] = [];
    deriveStrictAuthoringSchema(
      z.object({ s: z.string(), n: z.number(), e: z.enum(['a', 'b']), l: z.literal(1), d: z.date() }),
      { onOpaqueShape: (limit) => leafReports.push(limit) },
    );
    expect(leafReports).toEqual([]);
  });
});

describe('the barrel is the sole entry into the module cycle', () => {
  /**
   * `zod/index.zod.ts` re-exports from `../strict-authoring-face.ts`, which
   * imports `AnyComponentSchema` back from it. The cycle is fine when the
   * BARREL is entered first, and the reason usually given for that — "the deep
   * module reads the binding only inside its lazy getters" — is true of the
   * shipped source and NOT sufficient on its own. Measured: rollup 4.62.2,
   * entered at the deep module first with a namespace import used as a value,
   * throws `ReferenceError: Cannot access 'StrictAnyComponentSchema' before
   * initialization` from the synthesized namespace object it places ahead of
   * the deep module's body. Node, Vite/rolldown and Next Turbopack are green in
   * both orders; rollup in that one order is not.
   *
   * ⇒ The load-bearing invariant is not "reads are deferred", it is **the
   * barrel is the only way in**. That is what these two assertions hold, and
   * between them they cover both routes a caller has: the published `exports`
   * map for anything outside the package, and a relative or aliased specifier
   * for anything inside this repository.
   *
   * ⚠️ The manifest half reads `package.json`; it does not write it. If the
   * package's build layout changes the shape of `exports`, restate the
   * invariant for the new shape rather than deleting the assertion.
   */
  const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const DEEP_MODULE = 'strict-authoring-face';

  it('the published exports map has no wildcard and no entry reaching the deep module', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const subpaths = Object.keys(manifest.exports);
    expect(subpaths.length, 'the exports map is empty — this assertion is reading the wrong file').toBeGreaterThan(5);
    expect(subpaths.filter((key) => key.includes('*')), 'a wildcard subpath opens every internal module').toEqual([]);
    expect(
      subpaths.filter((key) => JSON.stringify(manifest.exports[key]).includes(DEEP_MODULE)),
      'an exports entry now reaches the deep module directly, so the barrel is no longer the sole entry',
    ).toEqual([]);
  });

  it('no module in this repository imports the deep module except the barrel', () => {
    // A specifier, not a mention: `scripts/measure-strict-authoring-face.mjs`
    // shares the words in its own name and must not read as an importer.
    const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
    const SKIP = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', '.next', 'build', 'test-results']);
    const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
    const SPECIFIER = /(?:from|import|require)\s*\(?\s*['"][^'"]*strict-authoring-face[^'"]*['"]/;
    const importers: string[] = [];
    let scanned = 0;
    const walk = (dir: string): void => {
      let entries: import('node:fs').Dirent[];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!SOURCE.test(entry.name)) continue;
        scanned += 1;
        if (SPECIFIER.test(readFileSync(full, 'utf8'))) importers.push(full.slice(REPO_ROOT.length + 1));
      }
    };
    for (const root of ['packages', 'apps', 'examples', 'scripts', 'e2e']) walk(join(REPO_ROOT, root));

    expect(scanned, 'the scan found almost no source files — it is pointed at the wrong tree').toBeGreaterThan(1000);
    expect(importers.sort(), 'something other than the barrel now enters the cycle at the deep module')
      .toEqual(['packages/types/src/zod/index.zod.ts']);
  });
});

/* ── Type-level pins — read by `tsc -p tsconfig.test.json`, NOT by vitest ──── */

/** The derivation returns the type it was given: strictness is a runtime property. */
const assertionDerivationPreservesTheType: typeof AnyComponentSchema =
  deriveStrictAuthoringSchema(AnyComponentSchema);

/** Both faces inhabit one type — the twin invites exactly what the tolerant face invites. */
const assertionTolerantFaceFitsTheCommonType: z.ZodType<
  z.output<typeof AnyComponentSchema>,
  z.input<typeof AnyComponentSchema>
> = AnyComponentSchema;
const assertionStrictFaceFitsTheCommonType: z.ZodType<
  z.output<typeof AnyComponentSchema>,
  z.input<typeof AnyComponentSchema>
> = StrictAnyComponentSchema;

/** The node-slot twin carries `SchemaNodeSchema`'s declaration on both sides. */
const assertionNodeTwinCarriesTheNodeDeclaration: typeof SchemaNodeSchema = StrictSchemaNodeSchema;

describe('the type-level pins are reachable (vitest cannot read them)', () => {
  it('names them so an unused-binding rule cannot delete the pins', () => {
    expect([
      assertionDerivationPreservesTheType,
      assertionTolerantFaceFitsTheCommonType,
      assertionStrictFaceFitsTheCommonType,
      assertionNodeTwinCarriesTheNodeDeclaration,
    ].every((s) => typeof s.safeParse === 'function')).toBe(true);
  });
});

/* ── The census both population pins read ────────────────────────────────── */

/**
 * Walk a schema graph and count what is there.
 *
 * ⚠️ `isSchemaNode` admits CALLABLE nodes, and that is the whole reason this
 * helper is worth reading. Its first version began `typeof node !== 'object'`
 * and therefore could not see the 20 `$ZodObjectJIT` instances on this face —
 * the identical blind spot the walker itself had. Two instruments sharing a
 * defect with the thing they measure is not a control: the count read "clean"
 * while six objects underneath those nodes were wide open. `functionTyped` is
 * asserted non-zero below so the lesson cannot silently regress.
 *
 * Reads `_zod.def` for the same reason the walker does — zod publishes no other
 * way to ask. Lazies are resolved so the census is not truncated at the node
 * boundary.
 */
type CensusDef = Record<string, unknown> & { type: string };

interface Census {
  /** Distinct schema nodes reached. */
  nodes: number;
  /** Distinct schema nodes reached, by def type — what the face is made of. */
  kinds: Record<string, number>;
  /** How many of those answered `typeof 'function'` (JIT instances). */
  functionTyped: number;
  /** Nodes whose def type is `object`. */
  objects: number;
  /** Of those, how many carry `catchall: never` — i.e. are closed. */
  closed: number;
  /** Of those, the ones that do not, with the trail that reached them. */
  openPaths: string[];
}

const isSchemaNode = (value: unknown): boolean =>
  value !== null && (typeof value === 'object' || typeof value === 'function') && '_zod' in value;

function census(schema: unknown): Census {
  const seen = new Set<unknown>();
  const out: Census = { nodes: 0, kinds: {}, functionTyped: 0, objects: 0, closed: 0, openPaths: [] };
  const visit = (node: unknown, path: string): void => {
    if (!isSchemaNode(node) || seen.has(node)) return;
    seen.add(node);
    out.nodes += 1;
    if (typeof node === 'function') out.functionTyped += 1;
    const def = (node as { _zod: { def: CensusDef } })._zod.def;
    out.kinds[def.type] = (out.kinds[def.type] ?? 0) + 1;
    if (def.type === 'object') {
      out.objects += 1;
      const catchall = def.catchall as { _zod?: { def?: { type?: string } } } | undefined;
      if (catchall?._zod?.def?.type === 'never') out.closed += 1;
      else out.openPaths.push(`${path} [${catchall?._zod?.def?.type ?? 'strip'}]`);
    }
    if (def.type === 'lazy') {
      const getter = def.getter as (() => unknown) | undefined;
      if (getter) visit(getter(), `${path}/lazy`);
      return;
    }
    if (def.shape) {
      for (const [key, value] of Object.entries(def.shape as Record<string, unknown>)) visit(value, `${path}/${key}`);
    }
    if (Array.isArray(def.options)) def.options.forEach((o, i) => visit(o, `${path}/opt${i}`));
    if (Array.isArray(def.items)) def.items.forEach((o, i) => visit(o, `${path}/item${i}`));
    for (const key of ['element', 'rest', 'valueType', 'keyType', 'left', 'right', 'in', 'out', 'innerType', 'catchall']) {
      if (def[key]) visit(def[key], `${path}/${key}`);
    }
  };
  visit(schema, '#');
  return out;
}
