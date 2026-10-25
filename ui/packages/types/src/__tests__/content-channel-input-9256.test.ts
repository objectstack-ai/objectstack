/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9256 — the `input` slice of FAMILY D: the `input` renderer reads
 * NEITHER content channel, so both `body` and `children` are `?: never` on the
 * TypeScript face (`InputSchema` in `../form.ts`) and a by-name refusal on the
 * zod mirror (two `retirementTombstone` members fed one
 * `neitherContentChannelGuidance` string), each kept a MEMBER so
 * `zod-mirror-parity`'s key sets stay equal. Family D's own pins live in
 * `content-channel-family-d-9256.test.ts` and the E3 residual's in
 * `content-channel-e3-residual-9256.test.ts`; nothing pinned there is restated
 * here.
 *
 * ## Why `input` was held out, and what changed
 *
 * `InputShorthandSchema` (the `email` / `password` face) inherits from
 * `InputSchema`, and its TypeScript heritage used to be a plain `Omit`, which
 * collapsed into `BaseSchema`'s index signature and carried no member at all —
 * so a tombstone on `InputSchema` would have reached neither shorthand face.
 * The E3 slice re-spelled that heritage as `OmitDeclared` and narrowed the two
 * shorthand faces directly. That removed the only reason to hold `input` back.
 *
 * READERSHIP was measured, not inherited: a TypeScript compiler-API sweep over
 * one program per workspace package plus the apps and the examples, on a BUILT
 * tree, files every `.body` / `.children` read under the declared type of its
 * receiver. It files none under `InputSchema` while its lit controls
 * (`ButtonSchema`, `DivSchema`, `CardSchema`, `ContainerSchema`) fire, and the
 * same program sees `InputSchema` as the receiver of every key the renderer
 * reads, so the zero is a reading and not blindness.
 *
 * ## The shorthand keeps its own pair, and that is pinned below
 *
 * `InputShorthandSchema` now inherits this pair AND restates it. The restated
 * members change no type; they are kept because they carry the message that
 * names `email` / `password`, which the inherited `input` message does not.
 * The CONTROL block pins which message an author of each node reads.
 *
 * ## ⚠️ Half of this file is a COMPILE-TIME assertion and vitest CANNOT read it
 *
 * `?: never` is erased before a test runs. The `@ts-expect-error` lines in the
 * last block are read by `tsc -p tsconfig.test.json` (the `type-check` script),
 * NOT by this runner: under vitest alone, deleting a tombstone from the
 * TypeScript face leaves every case here GREEN. Both readers are the gate.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { InputSchema as InputMirror, InputShorthandSchema as InputShorthandMirror } from '../zod/form.zod';
import { AnyComponentSchema } from '../zod/index.zod';
import type { InputSchema, InputShorthandSchema } from '../form';

type Mirror = {
  safeParse: (v: unknown) => { success: boolean; error?: z.ZodError };
  shape: Record<string, { description?: string } | undefined>;
};

const input = InputMirror as unknown as Mirror;
const shorthand = InputShorthandMirror as unknown as Mirror;
const CHANNELS = ['body', 'children'] as const;
const CONTENT = [{ type: 'text', content: 'measured' }];
const issues = (m: Mirror, doc: unknown) => {
  const r = m.safeParse(doc);
  return r.success ? null : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
};

/* ── (a) both channels are REFUSED BY NAME, at the key's own path ─────────── */

describe('objectui#9256 input slice — both content channels are refused where the renderer reads neither', () => {
  it.each(CHANNELS)('input.%s is refused at that key\'s own path', (key) => {
    const found = issues(input, { type: 'input', [key]: CONTENT });
    expect(found, `input.${key} parsed green — the tombstone is not installed`).not.toBeNull();
    expect(found!.some((i) => i.path === key && i.code === 'invalid_type')).toBe(true);
  });

  it.each(CHANNELS)('input.%s — the message names the channel, the node, the card, and what it renders instead', (key) => {
    const issue = issues(input, { type: 'input', [key]: CONTENT })!.find((i) => i.path === key)!;
    expect(issue.message).toContain(`\`${key}\``);
    expect(issue.message).toContain('`input`');
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('NEITHER content channel');
    expect(issue.message).toContain('What it renders instead: ');
    // ⛔ Not `BaseSchema`'s generic `body` refusal, which names `children` as
    // the remedy — on `input` `children` is refused as well.
    expect(issue.message).not.toContain('Did you mean');
  });

  it.each(CHANNELS)('input.%s — ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', (key) => {
    const issue = issues(input, { type: 'input', [key]: CONTENT })!.find((i) => i.path === key)!;
    expect(input.shape[key]?.description).toBe(issue.message);
  });

  it.each(CHANNELS)('input.%s — the refusal is about the KEY, not a value domain: every value is refused', (key) => {
    for (const value of [CONTENT, 'text', 42, null, {}, []]) {
      expect(issues(input, { type: 'input', [key]: value })?.some((i) => i.path === key)).toBe(true);
    }
  });

  it.each(CHANNELS)('input.%s — the refusal reaches the node through `AnyComponentSchema`, at the root and nested', (key) => {
    expect(AnyComponentSchema.safeParse({ type: 'input', label: 'Name' }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ type: 'input', label: 'Name', [key]: CONTENT }).success).toBe(false);
    // Nested inside a container that DOES read `children` — the outer node is
    // legal, so the refusal can only be the inner `input`'s.
    expect(AnyComponentSchema.safeParse({ type: 'div', children: [{ type: 'input' }] }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ type: 'div', children: [{ type: 'input', [key]: CONTENT }] }).success).toBe(false);
  });
});

/* ── (b) CONTROLS — nothing that parsed before stops parsing ──────────────── */

describe('objectui#9256 input slice — CONTROLS', () => {
  it('`input` still parses with the keys its renderer reads', () => {
    expect(issues(input, { type: 'input' })).toBeNull();
    expect(issues(input, {
      type: 'input',
      name: 'email',
      label: 'Email',
      placeholder: 'you@example.com',
      inputType: 'email',
      required: true,
      description: 'We never share it',
      className: 'p-4',
      wrapperClass: 'w-full',
    })).toBeNull();
  });

  it.each(CHANNELS)('input.%s — the tombstone is a MEMBER of the mirror shape, so the parity ratchet\'s key sets stay equal', (key) => {
    expect(Object.keys(input.shape)).toContain(key);
  });

  it.each(['email', 'password'] as const)('`%s` reads the message that names ITS node — the shorthand\'s own pair overrides the inherited one', (type) => {
    // The shorthand arm is `InputSchema.omit({ type, inputType }).extend({ … })`,
    // so it inherits the `input` pair above and restates it. The restatement
    // refuses nothing new; what it changes is the subject the author is told
    // about. If it is deleted, this goes red rather than the message quietly
    // starting to talk about `input`.
    for (const key of CHANNELS) {
      const issue = issues(shorthand, { type, [key]: CONTENT })!.find((i) => i.path === key)!;
      expect(issue.code).toBe('invalid_type');
      expect(issue.message).toContain('`email` / `password`');
      expect(issue.message).not.toContain('`input` reads NEITHER');
    }
  });

  it('family C still reads a content channel — `div` takes `children`', () => {
    // The distinction this card rests on: a reader keeps its channel, a
    // non-reader loses both. Measured in the same run as the rows above.
    expect(AnyComponentSchema.safeParse({ type: 'div', children: CONTENT }).success).toBe(true);
  });
});

/* ── (c) the TypeScript face — ⚠️ READ BY `tsc`, NOT BY VITEST ────────────── */

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

describe('objectui#9256 input slice — the TypeScript face refuses both channels at the AUTHORING site', () => {
  // The refused lines spread a base that the CONTROL test below proves
  // compiles, so the ONLY difference an `@ts-expect-error` can be answering is
  // the channel written beside it.
  const base = { type: 'input', label: 'Name' } satisfies InputSchema;

  it('the `@ts-expect-error` lines in this block are the assertion; vitest only proves they are reachable', () => {
    // @ts-expect-error objectui#9256 — `input` reads neither channel
    const inputBody: InputSchema = { ...base, body: CONTENT };
    // @ts-expect-error objectui#9256 — `input` reads neither channel
    const inputChildren: InputSchema = { ...base, children: CONTENT };
    expect([inputBody, inputChildren]).toHaveLength(2);
  });

  it('the two faces agree: the shorthand\'s restated pair is the SAME type as the one it inherits', () => {
    // `tsc` is the reader. A restatement that drifted from `InputSchema`'s
    // pair would make these `false` and fail to compile.
    const body: Eq<InputShorthandSchema['body'], InputSchema['body']> = true;
    const children: Eq<InputShorthandSchema['children'], InputSchema['children']> = true;
    expect([body, children]).toEqual([true, true]);
  });

  it('CONTROL — the same node WITHOUT a content channel compiles (no `@ts-expect-error` here, and `tsc` is the reader)', () => {
    const ok = [
      base,
      { type: 'input', label: 'Email', inputType: 'email', required: true } satisfies InputSchema,
      { type: 'email', label: 'Email' } satisfies InputShorthandSchema,
    ];
    expect(ok).toHaveLength(3);
  });
});
