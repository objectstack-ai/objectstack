/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#8072 — `InputSchema.wrapperClass`, the last `schema.wrapperClass`
 * reader whose value was admitted unexamined.
 *
 * ## The defect
 *
 * `packages/components/src/renderers/form/input.tsx` reads
 * `cn("grid w-full items-center gap-1.5", schema.wrapperClass)` — classes on
 * the wrapper `div` around the input and its label. The TypeScript face
 * declared the key (`../form.ts`, docblock "Input wrapper CSS class"); the zod
 * mirror never did, so the value parsed through `.passthrough()` and
 * `{ type: 'input', wrapperClass: 42 }` validated GREEN. The same document on
 * any of the eight sibling readers — `checkbox`, `file-upload`,
 * `filter-builder` (objectui#6150 / #6938), `switch`, `textarea`,
 * `date-picker`, `select`, `list` (objectui#7722) — was already refused at the
 * key. That asymmetry, not the missing declaration, is what this file pins.
 *
 * The gap was a RECORDED row of the parity ledger
 * (`UnmirroredDeclared['form.zod.ts#InputSchema']` in
 * `zod-mirror-parity.test.ts`), so closing it moves that file's census figures
 * and retires the self-expiring exemption
 * `wrapper-class-declared-7722.test.ts` carried for this one reader.
 *
 * ## The assertion that matters, and its three controls
 *
 * ⭐ The verdict under test is NOT "the key is declared" — under
 * `.passthrough()` a parse that accepts proves nothing about membership. It is
 * that `{ type: 'input', wrapperClass: 42 }` moved from ACCEPTED to REFUSED,
 * and each control keeps that reading from being something else:
 *
 *   - **The authored string still parses**, on both faces and through the
 *     published union entry point — otherwise the measurement would be of a
 *     broken schema rather than of a closed gap.
 *   - **A SIBLING refuses the same wrong-typed document**, and refused it
 *     before this change too: this diff touches no mirror but `InputSchema`,
 *     so the `checkbox` leg reads the same on either side of it. That is what
 *     makes `input` the outlier rather than this file the instrument.
 *   - **An UNDECLARED key still admits any value unexamined**, so the mirror's
 *     unknown-key policy is byte-for-byte what it was and exactly one key
 *     moved.
 *
 * ## The strict authoring twin moves in the OPPOSITE direction, deliberately
 *
 * `StrictAnyComponentSchema` (objectui#8345) is DERIVED from these mirrors and
 * closes unknown keys, so before this change it refused an authored
 * `wrapperClass` on `input` outright — a key the published TypeScript face
 * invites. Declaring it narrows the tolerant face and, in the same move, lets
 * the strict face accept what the TS declaration always promised. Both legs
 * are pinned below because the two faces move apart, not together.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CheckboxSchema, InputSchema, InputShorthandSchema } from '../zod/form.zod';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod';
import type { InputSchema as TsInputSchema } from '../form';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const READER = 'packages/components/src/renderers/form/input.tsx';
const READ_TEXT = 'cn("grid w-full items-center gap-1.5", schema.wrapperClass)';

const KEY = 'wrapperClass';
/**
 * A plausible-looking class key the renderer never reads: the label's classes
 * are hard-coded beside `schema.required`. It stays undeclared on both faces.
 */
const CONTROL_KEY = 'labelClass';
/** An undeclared key carried alongside the control, so the before-state stays visible. */
const SENTINEL = 'undeclaredControlKey8072';
/** A declared-keys-only document; every assertion below is a delta on it. */
const CONTROL = { type: 'input', label: 'Name' };
/** The same delta on a sibling that declared the key before this card. */
const SIBLING_CONTROL = { type: 'checkbox', label: 'Accept' };

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends (1 & T) ? true : false;

// The TS face already declared this key; these guard it against being removed
// on the way past, in which case the read stops compiling (it fell back to
// `BaseSchema`'s index signature as `any` until objectui#8347 removed it).
export type _WrapperClassIsString = Expect<Equal<NonNullable<TsInputSchema['wrapperClass']>, string>>;
export type _WrapperClassIsNotAny = Expect<Equal<IsAny<TsInputSchema['wrapperClass']>, false>>;
// Lit control for the detector: `IsAny` does answer `true`, so the line above is a reading.
export type _IsAnyCanAnswerTrue = Expect<IsAny<any>>;
// The control key is NOT declared: it resolved to `any` through the index
// signature, exactly as `wrapperClass` did on the MIRROR before this card,
// until objectui#8347 removed the signature. It is no member now.
export type _ControlKeyIsNoMember = Expect<Equal<'labelClass' extends keyof TsInputSchema ? true : false, false>>;

// The TS face accepts the key on a literal. Since objectui#8347 this is no
// longer the weak half: without the index signature an undeclared key is
// refused on a fresh literal, so the acceptance reads the declaration.
const literal: TsInputSchema = { type: 'input', label: 'Name', wrapperClass: 'gap-4' };

interface Mirror {
  shape: Record<string, unknown>;
  safeParse: (v: unknown) => {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { issues: { path: (string | number)[] }[] };
  };
}

const input = InputSchema as unknown as Mirror;
const checkbox = CheckboxSchema as unknown as Mirror;
const shorthand = InputShorthandSchema as unknown as Mirror;

/** Every `schema.KEY` read in the renderer, off disk. */
function rendererReads(): Set<string> {
  const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
  return new Set([...src.matchAll(/\bschema\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
}

describe('objectui#8072 — the renderer reads `wrapperClass`, which is the fact the mirror now records', () => {
  it('the read is still there, as the exact text the docblocks cite', () => {
    const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
    expect(src, `${READER} no longer reads \`schema.${KEY}\` as \`${READ_TEXT}\``).toContain(READ_TEXT);
  });

  it('the read set, derived from the renderer, contains the key and NOT the control key', () => {
    // Non-vacuity for the control: if the renderer ever starts reading
    // `labelClass`, this turns red and the control must be re-chosen, not
    // declared on the way past.
    const reads = rendererReads();
    expect(reads.has(KEY)).toBe(true);
    expect(reads.has(CONTROL_KEY)).toBe(false);
  });
});

describe('objectui#8072 — ACCEPTED to REFUSED, which is the verdict this card moves', () => {
  it('refuses a wrong-typed value AT the key', () => {
    // `{ type: 'input', wrapperClass: 42 }` parsed GREEN before this card: the
    // key was undeclared and `.passthrough()` admitted it unexamined. This is
    // the only verdict that moves, and it moves toward refusal.
    const r = input.safeParse({ ...CONTROL, [KEY]: 42 });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.'))).toContain(KEY);
  });

  it('…and refuses it through the published union entry point, so the `input` arm is the one reached', () => {
    const r = safeValidateSchema({ ...CONTROL, [KEY]: 42 });
    expect(r.success).toBe(false);
  });

  it('is a member of the mirror shape (membership cannot be read off acceptance under passthrough)', () => {
    expect(Object.keys(input.shape)).toContain(KEY);
  });
});

describe('objectui#8072 — control: the authored STRING still parses green on both faces', () => {
  it('the mirror accepts the declared value and the value SURVIVES the parse', () => {
    const r = input.safeParse({ ...CONTROL, [KEY]: 'gap-4' });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(r.data![KEY]).toBe('gap-4');
  });

  it('…and through the published union entry point', () => {
    const r = safeValidateSchema({ ...CONTROL, [KEY]: 'gap-4' });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>)[KEY]).toBe('gap-4');
  });

  it('the declared-keys-only document parses green, before and after', () => {
    expect(input.safeParse(CONTROL).success).toBe(true);
  });

  it('the type-level bindings above are referenced, so lint keeps them', () => {
    expect(literal.wrapperClass).toBe('gap-4');
  });
});

describe('objectui#8072 — control: a SIBLING refuses the same document, before this change too', () => {
  it('`checkbox` refuses the wrong-typed value at the key', () => {
    // This diff touches no mirror but `InputSchema`, so this leg reads the
    // same on either side of it — which is what makes `input` the outlier
    // rather than this file the instrument. (objectui#6938 declared it here.)
    const r = checkbox.safeParse({ ...SIBLING_CONTROL, [KEY]: 42 });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.'))).toContain(KEY);
  });

  it('`checkbox` accepts the authored string, so the sibling leg is not uniformly red', () => {
    expect(checkbox.safeParse({ ...SIBLING_CONTROL, [KEY]: 'gap-4' }).success).toBe(true);
  });
});

describe('objectui#8072 — control: the unknown-key policy did not move', () => {
  it('the control key is ABSENT from the mirror shape', () => {
    expect(Object.keys(input.shape)).not.toContain(CONTROL_KEY);
  });

  it('the SAME wrong-typed value under an UNDECLARED key is still admitted unexamined', () => {
    // The before-state of `wrapperClass`, kept on purpose on keys that are not
    // read: `.passthrough()` admits them, of any type, and they survive.
    for (const undeclared of [CONTROL_KEY, SENTINEL]) {
      const r = input.safeParse({ ...CONTROL, [undeclared]: 42 });
      expect(r.success).toBe(true);
      expect(r.data![undeclared]).toBe(42);
    }
  });
});

describe('objectui#8072 — the shorthand arm carries the key from `InputSchema`', () => {
  it('`InputShorthandSchema` declares it and refuses the wrong-typed value', () => {
    // The shorthand is `InputSchema.omit({ type, inputType }).extend({ … })`, so
    // it used to re-declare `wrapperClass` LOCALLY to stand in for the gap this
    // card closes. With the key on `InputSchema` the restatement is gone and the
    // arm inherits it — this leg is what proves that removal changed nothing.
    expect(Object.keys(shorthand.shape)).toContain(KEY);
    const r = shorthand.safeParse({ type: 'password', label: 'Secret', [KEY]: 42 });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.'))).toContain(KEY);
    expect(shorthand.safeParse({ type: 'password', label: 'Secret', [KEY]: 'gap-4' }).success).toBe(true);
  });
});

describe('objectui#8072 — the derived STRICT authoring face moves the other way', () => {
  it('accepts the authored string it used to refuse as an unknown key, and still refuses the wrong-typed one', () => {
    // `StrictAnyComponentSchema` is derived from the mirrors and closes unknown
    // keys (objectui#8345), so before this card it refused a `wrapperClass` the
    // published TypeScript face invites an author to write. Both faces are
    // pinned because they move APART: the tolerant one narrows, the strict one
    // stops refusing a declared key.
    const strict = StrictAnyComponentSchema as unknown as Mirror;
    expect(strict.safeParse({ ...CONTROL, [KEY]: 'gap-4' }).success).toBe(true);
    expect(strict.safeParse({ ...CONTROL, [KEY]: 42 }).success).toBe(false);
  });
});
