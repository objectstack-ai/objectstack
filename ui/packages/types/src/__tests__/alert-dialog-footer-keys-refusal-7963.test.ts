/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `cancelLabel`, `confirmLabel` and `confirmVariant` are REFUSED on the
 * `alert-dialog` node, on both faces (objectui#7963, ADR-0049 enforce-or-remove;
 * maintainer ruling 2026-09-10). `cancelText` / `actionText` are the surviving
 * spellings — and `confirmVariant` has NO survivor at all.
 *
 * ## What this is, and what it deliberately is NOT
 *
 * objectui#7104 declared the keys the renderer READS (`content`, `cancelText`,
 * `actionText`, `onAction`) and, in the same breath, LEFT this trio declared and
 * unread on purpose — its pin says so out loud ("the pins below record today's
 * state so that the PR which retires them re-derives these lines deliberately
 * rather than passing unnoticed"). This file is that retirement; that pin is
 * RE-POINTED, not deleted, so the closure stays asserted rather than becoming a
 * silent absence. The same discipline objectui#8871 applied to objectui#7926's
 * deliberately-left `breadcrumbs`.
 *
 * ## Why a REFUSAL and not a bare deletion
 *
 * `BaseSchemaCore` ends `.passthrough()` (and the TS `BaseSchema` closed with
 * `[key: string]: any` until objectui#8347), so a dropped MEMBER key is KEPT,
 * not refused, on the zod face. Deleting
 * the three declarations would have left the silent accept exactly as it was and
 * thrown the diagnostic away with it. `retirementTombstone()` keeps the key
 * DECLARED and unwritable — that is what makes the refusal loud, and it is why
 * the membership legs below are assertions rather than leftovers.
 *
 * ## What was measured — the frame is BASE `72bcd7783`, stated out loud
 *
 * ZERO readers, ⛔ measured with a POINT-ACCESS probe rather than a bare word.
 * Tree-wide on the base, `schema.cancelLabel` / `schema.confirmLabel` /
 * `schema.confirmVariant` each score **0**, against the FIRING CONTROLS on the
 * very renderer under test — `schema.cancelText` = **15** (read at
 * `packages/components/src/renderers/overlay/alert-dialog.tsx:37`) and
 * `schema.actionText` = **5** (read at `:38`). The three zeros are readings of
 * the same instrument on the same file the controls light up.
 *
 * ⛔ A BARE-WORD probe would have lied, and towards "live": these spellings are
 * overloaded across this tree and every OTHER owner is a LIVE key on a
 * DIFFERENT declaration — `FormSchema.cancelLabel`, `objectql.ts`'s
 * `confirmLabel`, `plugin-designer`'s `ConfirmDialog` React props,
 * `plugin-grid`'s `def.confirmLabel`, and `plugin-form`'s `ModalForm` /
 * `DrawerForm`, which BUILD a local `cancelLabel` FROM `schema.cancelText` — the
 * opposite direction. A bare grep reports dozens of readers, none of them on an
 * `alert-dialog` node. `the neighbouring owners are untouched` below is that
 * ruling-out kept as a live assertion rather than as prose.
 *
 * ## The rest-spread near-miss, closed by MEASUREMENT
 *
 * The three keys DO reach the primitive — they are not on `SchemaRenderer`'s
 * strip list, so they ride `componentProps` into the renderer's `...props` and
 * onto `<AlertDialog {...props}>`, the same channel that made
 * `CollapsibleSchema.open` live (objectui#8236). What settles it is a DOM
 * reading, and it lives where a DOM exists:
 * `packages/components/src/__tests__/alert-dialog-footer-keys-liveness-7963.test.tsx`.
 * That file is KEPT and re-pointed, ⛔ not retired with the keys — a retirement
 * does not retire the measurement that justified it. This package cannot see a
 * renderer, so the render-side half is deliberately not duplicated here; what is
 * asserted here is the reading this package CAN take, the renderer's source
 * text.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AlertDialogSchema } from '../overlay';
import { AlertDialogSchema as AlertDialogZod } from '../zod/overlay.zod.js';
import { FormSchema as FormZod } from '../zod/form.zod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

const RENDERER = 'packages/components/src/renderers/overlay/alert-dialog.tsx';

/** The three keys this card retires. */
const RETIRED = ['cancelLabel', 'confirmLabel', 'confirmVariant'] as const;
/** The two keys that survive — the renderer's own dialect. */
const SURVIVING = ['cancelText', 'actionText'] as const;

/** The footer an author used to write against the declared keys, verbatim in shape. */
const RETIRED_DOC = {
  type: 'alert-dialog',
  title: 'Delete this account?',
  trigger: { type: 'button', label: 'Delete account' },
  cancelLabel: 'Keep it',
  confirmLabel: 'Delete',
  confirmVariant: 'destructive',
} as const;

/** The same footer in the dialect the renderer reads. */
const REMEDY_DOC = {
  type: 'alert-dialog',
  title: 'Delete this account?',
  trigger: { type: 'button', label: 'Delete account' },
  cancelText: 'Keep it',
  actionText: 'Delete',
} as const;

const issueFor = (doc: unknown, key: string) => {
  const result = AlertDialogZod.safeParse(doc);
  return (result.success ? [] : result.error.issues).find((issue) => issue.path.join('.') === key);
};

/* ────────────────────────────────────────────────────────────────────────────
 * The contract
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#7963 — the `alert-dialog` node REFUSES its three footer keys', () => {
  it.each(RETIRED)('`%s` is still DECLARED, which is what makes the refusal loud rather than a strip', (key) => {
    // Under `.passthrough()` an UNDECLARED key is kept in silence. A refusal has
    // to be declared, which is why a bare deletion was never the shape here.
    expect(Object.keys(AlertDialogZod.shape)).toContain(key);
  });

  it('refuses the retired document at parse — one issue per key, each at its own path', () => {
    const result = AlertDialogZod.safeParse(RETIRED_DOC);
    expect(result.success).toBe(false);
    const paths = (result.success ? [] : result.error.issues).map((issue) => issue.path.join('.'));
    for (const key of RETIRED) expect(paths, key).toContain(key);
  });

  it.each(RETIRED)('`%s` reports `invalid_type` — the tombstone code, not a custom arm', (key) => {
    // `retirementTombstone` is a `z.never` arm: CODE and PATH are what a bare
    // `z.never()` reports and only the MESSAGE is customised. Its sibling
    // `handlerKeyRefusal` reports `custom` instead — and this very schema carries
    // three of those (`onAction` / `onConfirm` / `onCancel`), so the two really
    // are adjacent here and asserting the code is what keeps them apart.
    expect(issueFor(RETIRED_DOC, key)?.code).toBe('invalid_type');
  });

  it.each([
    ['cancelLabel', 'cancelText'],
    ['confirmLabel', 'actionText'],
  ])('`%s`\'s message names the key, the card and the surviving spelling `%s`', (key, remedy) => {
    // The named subject and the remedy, NOT the whole sentence: pinning prose
    // byte-for-byte turns every wording fix red for no gain.
    const message = issueFor(RETIRED_DOC, key)?.message ?? '';
    expect(message).toContain(key);
    expect(message).toContain('objectui#7963');
    expect(message).toContain('RETIRED');
    expect(message).toContain(remedy);
    // Zod's own default for a `never` arm says none of this.
    expect(message).not.toBe('Invalid input: expected never, received string');
  });

  it('`confirmVariant`\'s message names the remedy objectui#8978 declared — and still rules the two LABEL keys out', () => {
    // ⚠️ RE-DERIVED, ⛔ not deleted. The pre-#8978 form of this leg asserted
    // `NO surviving spelling` and `its own card`, because at the time there was
    // no key that did this job and the retirement said so plainly. objectui#8978
    // IS that card, and it answered: `actionVariant`. So the leg flips to the
    // other side of the same question — the message must now NAME the remedy —
    // while the asymmetry the original turned on is untouched and still asserted:
    // `cancelText` / `actionText` are the footer's two LABELS, neither does a
    // variant's job, and the message still rules them out by name.
    //
    // ⛔ What did NOT change is the key's own verdict: `confirmVariant` still
    // REDS, with the same `invalid_type` code as its two siblings (asserted
    // above). A published spelling that refuses an author today must not accept
    // one tomorrow — objectui#8978 took a new spelling precisely so that this
    // stays true.
    const message = issueFor(RETIRED_DOC, 'confirmVariant')?.message ?? '';
    expect(message).toContain('confirmVariant');
    expect(message).toContain('RETIRED');
    expect(message).toContain('objectui#7963');
    expect(message).toContain('actionVariant');
    expect(message).toContain('objectui#8978');
    expect(message).toMatch(/`cancelText` \/ `actionText` are NOT/);
    expect(message).not.toBe('Invalid input: expected never, received string');
  });

  it('the remedy THAT message names actually parses — and the confirm button it styles is a real reading elsewhere', () => {
    // The other half of the leg above: a message is only a remedy if the key it
    // names works. ⛔ This asserts the AUTHORING face only; that the value moves
    // the confirm button's class is a DOM reading and lives where a DOM exists
    // (`packages/components/src/__tests__/alert-dialog-action-variant-8978.test.tsx`).
    const result = AlertDialogZod.safeParse({ ...REMEDY_DOC, actionVariant: 'destructive' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.actionVariant).toBe('destructive');
  });

  it('CONTROL — the remedy key is a NARROW enum, so the leg above is not just passthrough admitting anything', () => {
    // Without this, the leg above passes identically against a mirror that never
    // declared `actionVariant` at all: `BaseSchemaCore` is `.passthrough()`, so
    // an UNDECLARED key survives a parse with its value intact. Membership plus a
    // refused value is the reading `.success` cannot give.
    expect(Object.keys(AlertDialogZod.shape)).toContain('actionVariant');
    expect(AlertDialogZod.safeParse({ ...REMEDY_DOC, actionVariant: 'ghost' }).success).toBe(false);
  });

  it('POSITIVE CONTROL — the same document with the three keys dropped parses green', () => {
    // Without this leg, a schema that refused EVERY alert-dialog document would
    // satisfy every assertion above.
    const { cancelLabel, confirmLabel, confirmVariant, ...rest } = RETIRED_DOC;
    expect([cancelLabel, confirmLabel, confirmVariant].every(Boolean)).toBe(true);
    expect(AlertDialogZod.safeParse(rest).success).toBe(true);
  });

  it('the remedy the two label messages name actually parses — and survives the parse', () => {
    const result = AlertDialogZod.safeParse(REMEDY_DOC);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cancelText).toBe('Keep it');
    expect(result.data.actionText).toBe('Delete');
  });

  it.each(SURVIVING)('`%s` is untouched — still declared, still a string member', (key) => {
    expect(Object.keys(AlertDialogZod.shape)).toContain(key);
    expect(AlertDialogZod.safeParse({ ...REMEDY_DOC, [key]: 42 }).success).toBe(false);
  });

  it('the refusal is TARGETED, not a strict node', () => {
    // The cheap way to refuse three keys is `.strict()`. It is the wrong shape:
    // this node's `BaseSchema` is `.passthrough()` by design and other pins read
    // that openness. Three keys, by name.
    const result = AlertDialogZod.safeParse({ ...REMEDY_DOC, someRendererProp: 42 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.someRendererProp).toBe(42);
  });
});

describe('objectui#7963 — the TypeScript twins refuse them too', () => {
  it('`?: never` on all three — the `@ts-expect-error` IS the assertion', () => {
    // Compiled by `tsc -p packages/types/tsconfig.test.json`: each line fails to
    // compile if the key ever becomes assignable again. The pair with the zod
    // arms is what `zod-mirror-parity.test.ts` compares.
    const authored: AlertDialogSchema = {
      type: 'alert-dialog',
      title: 'Delete this account?',
      // @ts-expect-error `cancelLabel` is refused by name on the alert-dialog node (objectui#7963)
      cancelLabel: 'Keep it',
      // @ts-expect-error `confirmLabel` is refused by name on the alert-dialog node (objectui#7963)
      confirmLabel: 'Delete',
      // @ts-expect-error `confirmVariant` is refused by name on the alert-dialog node (objectui#7963)
      confirmVariant: 'destructive',
    };
    expect(authored.type).toBe('alert-dialog');
  });

  it('CONTROL — the surviving spellings still compile at the same site', () => {
    // Without this, the three legs above would pass just as well against an
    // interface that refused the whole footer.
    const authored: AlertDialogSchema = {
      type: 'alert-dialog',
      cancelText: 'Keep it',
      actionText: 'Delete',
    };
    expect(authored.cancelText).toBe('Keep it');
  });
});

describe('objectui#7963 — the neighbouring owners of these spellings are UNTOUCHED', () => {
  it('`FormSchema.cancelLabel` still accepts a string — a live key on a different declaration', () => {
    // ⛔ The retirement is scoped to `AlertDialogSchema`. `FormSchema.cancelLabel`
    // is read at `renderers/form/form.tsx:1063,3266`; if this ever reds, the
    // refusal has escaped its node.
    const result = FormZod.safeParse({
      type: 'form',
      // `fields` is REQUIRED on this mirror — without it the leg would red for a
      // reason that has nothing to do with `cancelLabel`, and read as an escape.
      fields: [{ name: 'notes', label: 'Notes', type: 'text' }],
      showCancel: true,
      cancelLabel: 'Discard',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cancelLabel).toBe('Discard');
  });
});

describe('objectui#7963 — the renderer is UNCHANGED, and the measurement stays standing', () => {
  it('still reads the surviving dialect, and its `inputs` / `defaultProps` still ship it', () => {
    const renderer = read(RENDERER);
    for (const key of SURVIVING) expect(renderer, key).toContain(`schema.${key}`);
    expect(renderer).toMatch(/^\s*cancelText:\s*'Cancel',/m);
    expect(renderer).toMatch(/^\s*actionText:\s*'Continue',/m);
  });

  it('still reads none of the three, and never learned one of them as a substitute', () => {
    // ⛔ The ruling was RETIRE, not "teach the renderer the other dialect".
    // Teaching it `cancelLabel` would have blanked the footer of every document
    // that works today (the objectui#7104 producer census).
    const renderer = read(RENDERER);
    for (const key of RETIRED) expect(renderer, key).not.toContain(key);
  });

  it('control: the scan can find things — this IS the alert-dialog registration', () => {
    expect(read(RENDERER)).toContain("ComponentRegistry.register('alert-dialog'");
  });
});

describe('objectui#7963 — no reader anywhere in the tree, kept as a standing probe', () => {
  /**
   * ⭐ TREE-SCOPED, never file-scoped: a file-scoped absence check only sees the
   * files its author thought of, and what escapes is exactly the reader he did
   * not know about — including one written AFTER the retirement. The scan runs
   * over every tracked file and subtracts only what cannot be a read site:
   *
   *  - `CHANGELOG.md` / `.changeset/` — the historical record of this very
   *    retirement, which must keep naming the keys;
   *  - this pin and the two it re-points, which SPELL the keys in order to trip
   *    the refusal and to measure the DOM;
   *  - the two DECLARATION files, `zod/overlay.zod.ts` and `overlay.ts`: the
   *    tombstones and their `?: never` twins ARE the refusal, so a scan that
   *    reddened on them would be asserting the retirement had not landed. That
   *    they refuse rather than read is not taken on trust — the parse legs and
   *    the `@ts-expect-error` leg above fail if either face accepts again.
   *
   * ⛔ No allow-list FILE: a list on disk outlives the reason for each of its
   * rows. The exclusions are spelled here, beside the reason.
   */
  const EXCLUDED = [
    ':!*CHANGELOG.md',
    ':!.changeset/',
    ':!packages/types/src/__tests__/alert-dialog-footer-keys-refusal-7963.test.ts',
    ':!packages/types/src/__tests__/alert-dialog-read-dialect-7104.test.ts',
    ':!packages/components/src/__tests__/alert-dialog-footer-keys-liveness-7963.test.tsx',
    ':!packages/types/src/zod/overlay.zod.ts',
    ':!packages/types/src/overlay.ts',
  ];

  /** `git grep -nE <pattern>`, exit 1 (no match) normalised to an empty list. */
  const grepTree = (pattern: string): string[] => {
    try {
      const out = execFileSync('git', ['grep', '-nE', pattern, '--', '.', ...EXCLUDED], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      return out.split('\n').filter(Boolean);
    } catch (e) {
      // `git grep` exits 1 for "no matches" — the PASS case here, distinguished
      // from a real failure (exit > 1) rather than swallowed.
      const status = (e as { status?: number }).status;
      if (status === 1) return [];
      throw e;
    }
  };

  it.each(RETIRED)('nothing reads `schema.%s` — the POINT-ACCESS probe, tree-wide', (key) => {
    // ⛔ Not a bare-word probe: every other owner of these spellings is live, and
    // a bare grep reports dozens of readers that are not on this node.
    expect(grepTree(`schema\\.${key}`)).toEqual([]);
  });

  it('LIT CONTROL — the same probe on the SURVIVING spellings still fires, hard', () => {
    // Without this, the three legs above pass on a broken `git grep` invocation,
    // a wrong cwd, or an exclusion list that swallowed the tree. These are the
    // controls the ruling was taken on, re-derived as a standing assertion.
    expect(grepTree('schema\\.cancelText').length).toBeGreaterThan(3);
    expect(grepTree('schema\\.actionText').length).toBeGreaterThan(0);
  });
});
