// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `PluginSchema` makes `(Required for type="ui")` true (#16334).
 *
 * WHY THIS FILE EXISTS. `staticPath` and `slug` were described as required for
 * `type: 'ui'` and declared `.optional()`, with nothing behind the prose. Once
 * `kernel.use()` ran the schema on the boot path (#16049) that became a promise
 * the runtime visibly did not keep. These pins read the schema DIRECTLY — this
 * file imports `./plugin.zod` from source, so no build sits between the
 * assertion and the declaration — one group per direction:
 *
 *   A refusal:     a `ui` plugin missing either key fails `safeParse`, one
 *                  issue per missing key, `path` naming the key, the stable code
 *                  at the head of `message` and on `params.code`;
 *   B calibration: the SAME `ui` fixture with both keys declared parses, and a
 *                  present-but-invalid value is still judged by its own key's
 *                  declaration, never re-judged here;
 *   C scope:       every other declared type, and a plugin declaring no type,
 *                  parses with neither key — the refinement is scoped to
 *                  `type === 'ui'` and to ABSENCE.
 *
 * NEGATIVE CONTROL. Against the schema this branch was cut from (90e7e6de1,
 * the `PluginSchema` with no `superRefine`) every case in group A fails and
 * every case in B and C passes — measured by running this file with that
 * `plugin.zod.ts` restored, recorded in the PR. That asymmetry is what makes A
 * a pin and B/C the calibration, rather than a file that would pass either way.
 *
 * The boot-path half — that `kernel.use()` SURFACES the code inside its
 * `PLUGIN_CONTRACT_VIOLATION` envelope — is `packages/core`'s
 * `plugin-contract-enforcement.test.ts`, group F.
 */

import { describe, expect, it } from 'vitest';
import {
  CORE_PLUGIN_TYPES,
  PLUGIN_UI_REQUIRED_KEY_MISSING,
  PluginSchema,
  type PluginDefinition,
} from './plugin.zod';
import { ERROR_CODE_LEDGER, ErrorCode } from '../api/error-code-ledger.zod';

/** A `ui` plugin carrying both required keys — the calibration fixture. */
const UI_COMPLETE: PluginDefinition = {
  type: 'ui',
  staticPath: '/srv/acme-console/dist',
  slug: 'console',
};

/** The two keys `type: 'ui'` owes — the whole set, pinned one case per key. */
const UI_REQUIRED_KEYS = ['staticPath', 'slug'] as const;

/** `fixture` with `key` removed — an ABSENT key, not one set to `undefined`. */
function without(fixture: PluginDefinition, key: keyof PluginDefinition): PluginDefinition {
  const copy: PluginDefinition = { ...fixture };
  delete copy[key];
  return copy;
}

/** `[code, path]` per issue — the shape core's closed-set pin reads too. */
function issueShapes(input: unknown): Array<[string, string]> {
  const result = PluginSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i): [string, string] => [i.code, i.path.join('.')]);
}

describe('A — a `ui` plugin without `staticPath` or `slug` fails PluginSchema.safeParse (#16334)', () => {
  it('missing both: refused with one issue per key, in declaration order, path naming the key', () => {
    const keyless = without(without(UI_COMPLETE, 'staticPath'), 'slug');
    expect(keyless).toEqual({ type: 'ui' });

    const result = PluginSchema.safeParse(keyless);
    expect(result.success).toBe(false);
    expect(issueShapes(keyless)).toEqual([
      ['custom', 'staticPath'],
      ['custom', 'slug'],
    ]);
  });

  it.each(UI_REQUIRED_KEYS)('missing only `%s`: exactly that key is refused', (key) => {
    expect(issueShapes(without(UI_COMPLETE, key))).toEqual([['custom', key]]);
  });

  it('the refusal carries the stable code: at the head of `message` and on `params.code`', () => {
    const result = PluginSchema.safeParse(without(UI_COMPLETE, 'staticPath'));
    expect(result.success).toBe(false);
    if (result.success) return;

    const [issue] = result.error.issues;
    // The message head is the channel the boot path surfaces today:
    // `PluginLoader.validatePluginContract` re-emits `issue.message`, and
    // `ObjectKernel.use()` keeps only the message (#16049).
    expect(issue.message.startsWith(`${PLUGIN_UI_REQUIRED_KEY_MISSING}: `)).toBe(true);
    expect(issue.message).toContain('`staticPath`');
    // The structured channel, for a reader that wants the code as a field.
    expect((issue as unknown as { params?: Record<string, unknown> }).params).toEqual({
      code: PLUGIN_UI_REQUIRED_KEY_MISSING,
      key: 'staticPath',
    });
  });

  it('an explicit `undefined` is absence: `slug: undefined` is refused like an omitted `slug`', () => {
    expect(issueShapes({ ...UI_COMPLETE, slug: undefined })).toEqual([['custom', 'slug']]);
  });
});

describe('B — CALIBRATION: the same `ui` fixture with both keys parses', () => {
  it('parses; the refinement adds nothing to a complete `ui` plugin', () => {
    expect(PluginSchema.safeParse(UI_COMPLETE).success).toBe(true);
    expect(issueShapes(UI_COMPLETE)).toEqual([]);
  });

  it('a present-but-invalid `slug` is the slug regex\'s own refusal, not this one', () => {
    // The requirement added by #16334 is about ABSENCE. A present value keeps
    // exactly the issue its own declaration produces — one issue, at `slug`,
    // and not the `custom` code this file pins.
    const shapes = issueShapes({ ...UI_COMPLETE, slug: 'Not A Slug' });
    expect(shapes).toHaveLength(1);
    expect(shapes[0][1]).toBe('slug');
    expect(shapes[0][0]).not.toBe('custom');
  });
});

describe('C — SCOPE: only `type: \'ui\'` owes the two keys', () => {
  const NON_UI = ['standard', ...CORE_PLUGIN_TYPES].filter((t) => t !== 'ui');

  it.each(NON_UI)('a `%s` plugin parses with neither key', (type) => {
    expect(issueShapes({ type })).toEqual([]);
  });

  it('a plugin declaring no `type` parses with neither key (`.default(\'standard\')`)', () => {
    expect(issueShapes({})).toEqual([]);
  });

  it('positive control on the scope loop: the complement excludes `ui` and covers every other member', () => {
    expect(NON_UI).not.toContain('ui');
    expect(CORE_PLUGIN_TYPES).toContain('ui');
    // 'standard' plus the seven `CORE_PLUGIN_TYPES`, minus 'ui'.
    expect(NON_UI).toHaveLength(CORE_PLUGIN_TYPES.length);
  });
});

describe('D — the code is a member of the closed ADR-0112 vocabulary (#16449)', () => {
  it('PLUGIN_UI_REQUIRED_KEY_MISSING parses against ErrorCode and is registered under @objectstack/spec', () => {
    // The #16404 ruling: a code that ships in `dist` is the published face,
    // door or no door. This one rides a zod issue and a boot refusal's
    // message, never `error.code` at a door — registered all the same.
    expect(ErrorCode.safeParse(PLUGIN_UI_REQUIRED_KEY_MISSING).success).toBe(true);
    expect(ERROR_CODE_LEDGER['@objectstack/spec']).toContain(PLUGIN_UI_REQUIRED_KEY_MISSING);
  });
});
