/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6938 — `CheckboxSchema.wrapperClass`, the residue of that card.
 *
 * ## The defect
 *
 * `packages/components/src/renderers/form/checkbox.tsx:36` reads
 * `cn("flex items-center space-x-2", schema.wrapperClass)` — classes on the
 * wrapper `div` around the box and its label — and neither face of the shipped
 * contract declared the key: not the TypeScript interface in `../form.ts`, not
 * the zod mirror in `../zod/form.zod.ts`. The read compiled through
 * `BaseSchema`'s index signature (objectui#5155) and the value parsed through
 * `.passthrough()`, admitted unexamined. The same key, on the same class of
 * read, IS declared on `FileUploadSchema` and `FilterBuilderSchema`
 * (objectui#6150); the checkbox was left out only because its doc page's
 * schema block is a six-line summary — the asymmetry is the docs', not the
 * renderer's.
 *
 * The card's other half (`ContextMenuSchema`'s three read keys and its dead
 * required `children`) landed with objectui#6939 group 1 and is not pinned
 * here.
 *
 * ## What this file pins, and the shape it borrows
 *
 * The form is `undeclared-but-consumed-keys-6150.test.ts`, unchanged:
 * membership is asserted on the mirror's OWN `.shape`, never on parse
 * acceptance — under `.passthrough()` acceptance cannot tell "declared" from
 * "admitted unexamined". The type-level pin uses invariant equality, so an
 * undeclared key (which resolved to `any` through the index signature until
 * objectui#8347, and fails to compile at an indexed access now) reads as a
 * failure rather than as a match.
 *
 * The CONTROL is a key the renderer does NOT read — derived from the renderer
 * source, not asserted from memory — and it must stay undeclared on both
 * faces. That is the half that keeps this from being a widening: the change
 * declares the one key the renderer honours and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CheckboxSchema } from '../zod/form.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { CheckboxSchema as TsCheckboxSchema } from '../form';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const READER = 'packages/components/src/renderers/form/checkbox.tsx';
const READ_TEXT = 'cn("flex items-center space-x-2", schema.wrapperClass)';

const KEY = 'wrapperClass';
/**
 * A plausible-looking class key the renderer never reads: the label's classes
 * are hard-coded at `checkbox.tsx:52`. It stays undeclared on both faces.
 */
const CONTROL_KEY = 'labelClass';
/** A declared-keys-only document; every assertion below is a delta on it. */
const CONTROL = { type: 'checkbox', label: 'Accept' };

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends (1 & T) ? true : false;

// Declared as `string`. Were the member removed, the read would not compile
// (objectui#8347 took away the index signature it used to fall back to as `any`).
export type _WrapperClassIsString = Expect<Equal<NonNullable<TsCheckboxSchema['wrapperClass']>, string>>;
export type _WrapperClassIsNotAny = Expect<Equal<IsAny<TsCheckboxSchema['wrapperClass']>, false>>;
// Lit control for the detector: `IsAny` does answer `true`, so the line above is a reading.
export type _IsAnyCanAnswerTrue = Expect<IsAny<any>>;
// The control key is NOT declared: it resolved to `any` through the index
// signature, exactly as `wrapperClass` did before this card, until objectui#8347
// removed the signature. It is no member now. Declaring it turns this red.
export type _ControlKeyIsNoMember = Expect<Equal<'labelClass' extends keyof TsCheckboxSchema ? true : false, false>>;

// The TS face accepts the key on a literal. Since objectui#8347 this is no
// longer the weak half: without the index signature an undeclared key is
// refused on a fresh literal, so the acceptance reads the declaration.
const literal: TsCheckboxSchema = { type: 'checkbox', label: 'Accept', wrapperClass: 'gap-4' };

/** Every `schema.KEY` read in the renderer, off disk. */
function rendererReads(): Set<string> {
  const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
  return new Set([...src.matchAll(/\bschema\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
}

function shapeKeys(): string[] {
  return Object.keys((CheckboxSchema as unknown as { shape: Record<string, unknown> }).shape);
}

describe('objectui#6938 — the renderer reads `wrapperClass`, which is the fact the declaration records', () => {
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

describe('objectui#6938 — the zod mirror declares it', () => {
  it('is a member of the mirror shape (membership cannot be read off acceptance under passthrough)', () => {
    expect(shapeKeys()).toContain(KEY);
  });

  it('accepts the declared value and the value SURVIVES the parse', () => {
    const r = CheckboxSchema.safeParse({ ...CONTROL, [KEY]: 'gap-4' });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>)[KEY]).toBe('gap-4');
  });

  it('…and through the published union entry point, so the `checkbox` arm is the one reached', () => {
    const r = safeValidateSchema({ ...CONTROL, [KEY]: 'gap-4' });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>)[KEY]).toBe('gap-4');
  });

  it('refuses a wrong-typed value AT the key — the enforcement mirroring adds', () => {
    // Before this card `wrapperClass: 42` parsed green under `.passthrough()`.
    // This is the only verdict that moves, and it moves toward refusal.
    const r = CheckboxSchema.safeParse({ ...CONTROL, [KEY]: 42 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain(KEY);
  });

  it('control: the declared-keys-only document parses green, before and after', () => {
    expect(CheckboxSchema.safeParse(CONTROL).success).toBe(true);
  });
});

describe('objectui#6938 — the control key stays undeclared, so nothing outside the one key moved', () => {
  it('is ABSENT from the mirror shape', () => {
    expect(shapeKeys()).not.toContain(CONTROL_KEY);
  });

  it('the SAME wrong-typed value under the control key is still admitted unexamined', () => {
    // The before-state of `wrapperClass`, kept on purpose on a key that is not
    // read: `.passthrough()` admits it, of any type, and it survives. This is
    // the proof the mirror's unknown-key policy is byte-for-byte what it was.
    const r = CheckboxSchema.safeParse({ ...CONTROL, [CONTROL_KEY]: 42 });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>)[CONTROL_KEY]).toBe(42);
  });

  it('the type-level bindings above are referenced, so lint keeps them', () => {
    expect(literal.wrapperClass).toBe('gap-4');
  });
});
