// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7510] A failed `ViewMetadataSchema` reports the branch the body CLAIMS —
 * not the branch that happens to complain in the shape the shared ranking
 * rewards.
 *
 * ## The measured defect
 *
 * Filed from #7485. Saving a `viewKind: 'form'` ViewItem whose field carries an
 * unknown `publicPicker` subkey through the real write path (`saveMetaItem` →
 * this union) was correctly refused, and the author was handed the CONTAINER
 * branch's diagnostic, measured on `origin/main` @ `9051802`:
 *
 * ```
 * <root>: Invalid input;
 * <root>: Unrecognized key(s) on this view container: `viewKind`, `config`.
 *   • `viewKind` belongs to a single VIEW, not to the container. Wrap it: …
 * ```
 *
 * The word the author mistyped appears nowhere; what they get instead is a
 * confident, detailed instruction to restructure a container that was correct
 * all along — Prime Directive #12's failure mode, on the door Studio uses.
 *
 * It is not a `publicPicker` quirk. The four bodies in `MISDIRECTED` below are
 * four different ViewItem-branch failures — a picker subkey, an unknown
 * form-field key, a bad field enum, a typo'd column summary — and on `main` all
 * four surfaced that same container text, because the cause is structural: the
 * shared ranking scores a branch by `[issue count, carries unrecognized_keys]`,
 * the container branch always reports exactly ONE root `unrecognized_keys`
 * (`viewKind`/`config` are not container keys), and the ViewItem branch reports
 * exactly ONE nested `invalid_union` whose real key sits a level below where the
 * tiebreak looks.
 *
 * ## What this file pins
 *
 * 1. Each of those four now surfaces the ViewItem branch, naming the key the
 *    author actually typed, with no container text anywhere in the render.
 * 2. A GENUINE container failure still gets the #4001 guidance verbatim — the
 *    prose was never the problem, its audience was.
 * 3. ⛔ The acceptance face did not move: the muting runs after the union has
 *    already reached its verdict and can only rewrite an existing issue's
 *    `errors`. Measured over the whole corpus below plus the 42 bodies in
 *    `view-union-diagnostics.test.ts` (verdicts, parse output and top-level
 *    issue codes all byte-identical to `origin/main` @ `9051802`).
 * 4. The REVERSE VERIFICATION, executable rather than narrated: `oldSelection`
 *    reproduces the pre-#7510 branch choice from the same issue payload, and
 *    every misdirected body is asserted to have picked `container` under it.
 *    Delete the `.check()` in `view.zod.ts` and the tests in §1 go red; that
 *    assertion is what says so without needing the revert.
 */

import { describe, expect, it } from 'vitest';
import {
  ViewMetadataSchema,
  VIEW_METADATA_BRANCHES,
  VIEW_METADATA_MEMBERS,
  selectViewMetadataBranch,
  stripViewConsoleDecorations,
  type ViewMetadataBranch,
} from './view.zod';
import { formatZodError } from '../shared/error-map.zod';

/** The container branch's prescription — right for a container, wrong for a ViewItem. */
const CONTAINER_MISDIRECT = 'belongs to a single VIEW, not to the container';

/** A ViewItem-branch form carrying one declared field (#7467's fixture shape). */
const formItem = (field: unknown) => ({
  name: 'lead.contact',
  object: 'lead',
  viewKind: 'form',
  label: 'Contact us',
  config: {
    type: 'simple',
    data: { provider: 'object', object: 'lead' },
    sections: [{ label: 'About you', fields: [field] }],
  },
});

/**
 * The pre-#7510 branch choice, reconstructed from the branches themselves.
 *
 * This is `selectUnionBranches`' ranking (`shared/error-map.zod.ts`, and its
 * two verbatim copies in `metadata-protocol` and `rest`) reduced to the one
 * question this file asks: which branch did the author's message come from?
 *
 * It ranks each MEMBER's own issues rather than the union's `errors` array,
 * because that array is what the fix now focuses — reading it back would just
 * ask the fix about itself. Every member parsed independently is exactly what
 * zod put in `errors` before the `.check()` existed, so this is the pre-change
 * input to the pre-change rule.
 */
function oldSelection(body: unknown): ViewMetadataBranch | null {
  const stripped = stripViewConsoleDecorations(body);
  const ranked = VIEW_METADATA_BRANCHES
    .map((branch, index) => ({
      index,
      issues: (VIEW_METADATA_MEMBERS[branch].safeParse(stripped).error?.issues
        ?? []) as { code?: string; path?: PropertyKey[] }[],
    }))
    .filter(({ issues }) => issues.length > 0)
    .filter(({ issues }) => !issues.every(
      (i) => (i.path?.length ?? 0) === 0 && (i.code === 'invalid_type' || i.code === 'invalid_value'),
    ))
    .sort((a, b) =>
      a.issues.length - b.issues.length
      || Number(!a.issues.some((i) => i.code === 'unrecognized_keys'))
        - Number(!b.issues.some((i) => i.code === 'unrecognized_keys'))
      || a.index - b.index);

  return ranked.length > 0 ? VIEW_METADATA_BRANCHES[ranked[0]!.index]! : null;
}

/** What an author reads: the union's rejection, rendered by the shared formatter. */
function rendered(body: unknown): string {
  const error = ViewMetadataSchema.safeParse(body).error;
  expect(error, 'expected this body to be refused').toBeDefined();
  return formatZodError(error!);
}

/**
 * The general case the card asked to confirm before sizing: four unrelated
 * ViewItem-branch failures, each expected to name its OWN key.
 */
const MISDIRECTED: Array<[string, unknown, string]> = [
  [
    'the card\'s repro — an unknown `publicPicker` subkey',
    formItem({ field: 'owner', publicPicker: { displayFields: ['name'], sort: [{ field: 'email', order: 'desc' }] } }),
    'sort',
  ],
  [
    '#7467\'s `offset` case, through the union door this time',
    formItem({ field: 'owner', publicPicker: { displayFields: ['name'], offset: 10 } }),
    'offset',
  ],
  [
    'an unknown key on the form FIELD itself',
    formItem({ field: 'owner', widthh: 6 }),
    'widthh',
  ],
  [
    'a typo\'d column summary inside a LIST item',
    {
      name: 'lead.list',
      object: 'lead',
      viewKind: 'list',
      label: 'Leads',
      config: { type: 'grid', columns: [{ field: 'title', summary: { type: 'sum', fieldd: 'amount' } }] },
    },
    'fieldd',
  ],
];

describe('[#7510] a ViewItem-branch failure surfaces the ViewItem branch', () => {
  for (const [label, body, key] of MISDIRECTED) {
    it(`names \`${key}\` — ${label}`, () => {
      const text = rendered(body);
      expect(text).toContain(key);
      expect(text).not.toContain(CONTAINER_MISDIRECT);
    });

    // ⛔ REVERSE VERIFICATION. The same body, ranked the way it was ranked
    // before this change: the container branch wins, which is exactly the
    // wrong prescription the card measured. If this ever stops holding the
    // fix is no longer load-bearing and the tests above prove nothing.
    it(`…and the pre-#7510 ranking picked \`container\` for it — ${label}`, () => {
      expect(oldSelection(body)).toBe('container');
    });
  }

  it('every one of them claims the viewItem branch, which is why the fix reaches them', () => {
    for (const [, body] of MISDIRECTED) {
      expect(selectViewMetadataBranch(body)).toBe('viewItem');
    }
  });

  it('the byte-identical body minus the bad subkey still saves', () => {
    // The card's own control: this is what makes the rejection a diagnostic
    // problem rather than an acceptance one.
    const r = ViewMetadataSchema.safeParse(formItem({ field: 'owner', publicPicker: { displayFields: ['name'] } }));
    expect(r.success, JSON.stringify((r as any).error?.issues)).toBe(true);
  });
});

describe('[#7510] the container diagnostic still belongs to containers', () => {
  // (c) of the card's constraints: the :2328 guidance text is GOOD. A body that
  // really is a container with a wrong-layer key must keep reading it.
  const BAD_CONTAINER = {
    name: 'lead',
    object: 'lead',
    list: { type: 'grid', columns: [{ field: 'title' }] },
    type: 'grid',
    columns: [{ field: 'title' }],
  };

  it('a container with wrong-layer keys keeps the #4001 wrap prescription', () => {
    expect(selectViewMetadataBranch(BAD_CONTAINER)).toBe('container');
    const text = rendered(BAD_CONTAINER);
    expect(text).toContain(CONTAINER_MISDIRECT);
    expect(text).toContain('`type`');
    expect(text).toContain('`columns`');
  });

  it('a container whose SLOT is bad reports the slot, without the ViewItem branch\'s noise', () => {
    const text = rendered({ list: { type: 'nope', columns: [{ field: 'a' }] } });
    expect(text).toContain('list.type');
    // Before #7510 this render also carried the ViewItem branch's
    // "Invalid discriminator value" — a second, unrelated prescription for a
    // body that was never a ViewItem.
    expect(text).not.toContain('Invalid discriminator value');
  });
});

describe('[#7510] the union\'s error payload is focused, never reshaped', () => {
  const CLAIMED = formItem({ field: 'owner', publicPicker: { displayFields: ['name'], sort: [] } });

  it('keeps four branches, in position — a positional consumer still finds its member', () => {
    const issue = ViewMetadataSchema.safeParse(CLAIMED).error!.issues[0] as unknown as {
      code: string;
      errors: unknown[][];
    };
    expect(issue.code).toBe('invalid_union');
    expect(issue.errors).toHaveLength(4);
    // Branch 0 is the claimed one and keeps its own issues; the rest are muted
    // in place rather than filtered out (objectui#3624's canary read errors[2]).
    expect(issue.errors[0]).toMatchObject([{ path: ['config', 'sections', 0, 'fields', 0] }]);
    for (const index of [1, 2, 3]) {
      expect(issue.errors[index]).toHaveLength(1);
      expect(issue.errors[index]![0]).toMatchObject({ code: 'invalid_type', path: [] });
    }
  });

  it('leaves an unclaimed body\'s branches alone — the ranking still owns that case', () => {
    // `selectViewMetadataBranch` → null: no discriminant settles it, so there is
    // no claim to focus on and every branch competes exactly as before.
    const body = { isPinned: true, columns: 'nope' };
    expect(selectViewMetadataBranch(body)).toBeNull();

    const issue = ViewMetadataSchema.safeParse(body).error!.issues[0] as unknown as {
      code: string;
      errors: { code?: string }[][];
    };
    expect(issue.code).toBe('invalid_union');
    expect(issue.errors).toHaveLength(4);
    expect(issue.errors.some((branch) => branch.some((i) => i.code === 'unrecognized_keys'))).toBe(true);
  });

  it('adds nothing to a body that parses', () => {
    const r = ViewMetadataSchema.safeParse({ object: 'crm_lead', list: { type: 'grid', columns: ['name'] } });
    expect(r.success).toBe(true);
  });
});

describe('[#7510] ⛔ the acceptance face did not move', () => {
  // Verdict-identical to `origin/main` @ `9051802`, measured body by body
  // through the same door. The refusals' top-level issue CODES are pinned with
  // them: focusing happens inside `errors`, so the envelope other consumers key
  // on is untouched.
  //
  // [#7741] One deliberate, RULED move since that measurement (2026-08-12,
  // direction B): the flattened overlay arms require the `object` + `viewKind`
  // binding, so the three formerly-unbound overlay/PUT entries here carry it
  // now, and their unbound originals are pinned as REFUSED below. #7510's own
  // claim — focusing never changes a verdict — is unaffected and still pinned
  // by the rest of this corpus.
  const ACCEPTED: unknown[] = [
    formItem({ field: 'owner', publicPicker: { displayFields: ['name'] } }),
    { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list', config: { type: 'grid', columns: ['name'] } },
    { object: 'crm_lead', list: { type: 'grid', columns: ['name'] } },
    { object: 'crm_lead', formViews: { my: { type: 'simple' } } },
    { type: 'grid', columns: ['name'], isDefault: true, order: 2, object: 'crm_lead', viewKind: 'list' },
    { type: 'simple', object: 'crm_lead', viewKind: 'form' },
    { isPinned: true, object: 'crm_lead', viewKind: 'list' },
  ];

  const REFUSED: Array<[unknown, string[]]> = [
    // [#7741] the unbound originals of the last three ACCEPTED entries.
    [{ type: 'grid', columns: ['name'], isDefault: true, order: 2 }, ['invalid_union']],
    [{ type: 'simple' }, ['invalid_union']],
    [{ isPinned: true }, ['invalid_union']],
    [MISDIRECTED[0]![1], ['invalid_union']],
    [MISDIRECTED[3]![1], ['invalid_union']],
    [{ name: 'a.b', object: 'a', viewKind: 'chart', config: { type: 'grid', columns: ['name'] } }, ['invalid_union']],
    [{ object: 'crm_lead', listViews: {} }, ['custom']],
    [{ object: 'crm_lead', list: { type: 'grid', columns: ['name'] }, isPinned: true }, ['invalid_union']],
    [{ type: 'grid' }, ['invalid_union']],
    [{ type: 'sideways' }, ['invalid_union']],
    [{ nope: 1 }, ['custom']],
    [{}, ['custom']],
    ['nope', ['invalid_union']],
    [42, ['invalid_union']],
    [null, ['invalid_union']],
    [[{ type: 'grid', columns: ['name'] }], ['invalid_union']],
  ];

  for (const [index, body] of ACCEPTED.entries()) {
    it(`still ACCEPTS #${index}`, () => {
      expect(ViewMetadataSchema.safeParse(body).success).toBe(true);
    });
  }

  for (const [index, [body, codes]] of REFUSED.entries()) {
    it(`still REFUSES #${index}, with its issue codes intact`, () => {
      const r = ViewMetadataSchema.safeParse(body);
      expect(r.success).toBe(false);
      expect([...new Set(r.error!.issues.map((i) => i.code))].sort()).toEqual(codes);
    });
  }
});
