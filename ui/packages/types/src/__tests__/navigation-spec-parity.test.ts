/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Navigation ↔ `@objectstack/spec` drift guard (objectstack#4115).
 *
 * `NavigationItemSchema` is the only navigation schema with a *runtime*
 * consumer: `@object-ui/cli`'s published `objectui validate` command parses
 * metadata through the strict twin of `AnyComponentSchema`, which reaches it
 * via `AppSchema`.
 * Renderers read plain objects and never parse, so every gap below was a CLI
 * defect — and a strip-mode schema fails silently, which is why they survived.
 *
 * The gaps this pins, all measured against spec 17.0.0-rc.0:
 *
 *  - `requiresObject` / `requiresService` — capability gates that
 *    `NavigationItem` has always declared and `NavigationRenderer` has always
 *    honoured. Only the schema lagged, so `objectui validate` dropped them.
 *  - `actionDef` — an action item's entire payload. Stripped, so an item that
 *    could never invoke anything validated clean.
 *  - `expanded` — the spec's spelling of group expansion. The renderer already
 *    read it (behind an `as any`, because the type did not declare it).
 *  - `badgeVariant: 'secondary'` — spec-valid, hard-rejected here.
 *  - `{ type: 'separator' }` — spec-valid, rejected for missing id/label.
 *
 * Deliberately NOT modelled: the spec expresses navigation as a discriminated
 * union of `.strict()` variants, each with its target field required. objectui keeps
 * one flat, all-optional shape, so it accepts items the spec would reject (e.g.
 * `type: 'object'` with no `objectName`). Converging on the union is a breaking
 * change for every consumer that reads fields off `NavigationItem` without
 * narrowing — tracked separately, not smuggled in here.
 *
 * ⚠️ The object arm's `superRefine` exclusivity rule is the one part of that
 * paragraph that no longer holds: objectui#8563 CHAINS the spec's exported
 * `objectNavTargetExclusivity` on `type: 'object'`, so `filters` combined with
 * `recordId` / `viewName`, and `runAction` combined with `recordId`, are refused
 * here as well. That narrowing and the neighbours it deliberately leaves alone
 * are pinned in `./nav-target-exclusivity-8563.test.ts`, not here — this file
 * still measures the vocabulary gaps only.
 */

import { describe, it, expect } from 'vitest';
import { NavigationItemSchema, NavigationAreaSchema, NavigationItemTypeSchema } from '../zod/app.zod.js';
import type { NavigationItem, NavigationItemType } from '../app.js';
import {
  NavigationItemSchema as SpecNavigationItemSchema,
  DocNavItemSchema as SpecDocNavItemSchema,
} from '@objectstack/spec/ui';

/** Parse and return the surviving object, so "accepted" cannot hide a strip. */
function keep(input: unknown): Record<string, unknown> | null {
  const r = NavigationItemSchema.safeParse(input);
  return r.success ? (r.data as Record<string, unknown>) : null;
}

describe('NavigationItemSchema keeps the spec vocabulary it used to drop', () => {
  it('keeps the capability gates the renderer actually reads', () => {
    const kept = keep({ id: 'apps', type: 'object', label: 'Apps', objectName: 'sys_app', requiresObject: 'sys_app' });
    expect(kept).not.toBeNull();
    expect(kept!.requiresObject).toBe('sys_app');

    const svc = keep({ id: 'ai', type: 'url', label: 'AI', url: '/ai', requiresService: 'ai' });
    expect(svc!.requiresService).toBe('ai');
  });

  it('keeps an action item\'s payload instead of validating an empty shell', () => {
    const kept = keep({ id: 'run', type: 'action', label: 'Run', actionDef: { actionName: 'sync_now' } });
    expect(kept).not.toBeNull();
    expect(kept!.actionDef).toEqual({ actionName: 'sync_now' });
  });

  it('keeps the spec spelling of group expansion', () => {
    const kept = keep({ id: 'grp', type: 'group', label: 'Group', children: [], expanded: true });
    expect(kept!.expanded).toBe(true);
  });

  it('still accepts the legacy defaultOpen spelling', () => {
    const kept = keep({ id: 'grp', type: 'group', label: 'Group', children: [], defaultOpen: true });
    expect(kept!.defaultOpen).toBe(true);
  });

  it('accepts every spec badge variant, including secondary', () => {
    for (const variant of ['default', 'secondary', 'destructive', 'outline']) {
      const kept = keep({ id: 'x', type: 'url', label: 'X', url: '/x', badgeVariant: variant });
      expect(kept, `badgeVariant '${variant}' was rejected`).not.toBeNull();
      expect(kept!.badgeVariant).toBe(variant);
    }
  });

  it('accepts a bare separator, which carries no identity or text by definition', () => {
    expect(keep({ type: 'separator' })).not.toBeNull();
  });

  it('exempts ONLY the separator from needing an id — and no entry needs a label since objectui#9868', () => {
    // The separator exemption is implemented by declaring `id`/`label`
    // optional, so without the refinement that re-imposes `id` this would
    // also wave through an unidentifiable destination.
    expect(keep({ type: 'object', label: 'No id', objectName: 'contact' })).toBeNull();
    // INVERTED by objectui#9868 (was `toBeNull()`): `@objectstack/spec` 17.5.0
    // made `label` optional on every entry — absent ⇒ inherit the target's
    // label at render time — so a label-less entry is valid here too, and it
    // parses with NO `label` key (nothing is filled in at parse time).
    const unlabelled = keep({ id: 'no_label', type: 'object', objectName: 'contact' });
    expect(unlabelled).not.toBeNull();
    expect(unlabelled).not.toHaveProperty('label');
    expect(SpecNavigationItemSchema.safeParse({ id: 'no_label', type: 'object', objectName: 'contact' }).success).toBe(true);
    expect(keep({ id: 'ok', type: 'object', label: 'Ok', objectName: 'contact' })).not.toBeNull();
  });

  it('still rejects an unknown item type', () => {
    // The permissiveness above is scoped to spec vocabulary — it must not
    // become "anything goes".
    expect(keep({ id: 'x', type: 'wormhole', label: 'X' })).toBeNull();
  });
});

describe('NavigationAreaSchema keeps the spec fields it used to drop', () => {
  it('keeps description', () => {
    // `order` was asserted here too until spec 17.0.0 retired it at AREA level
    // (with `visible` and `requiredPermissions`); `description` is the one of
    // the pair from objectui#3088 that is still a spec key.
    const r = NavigationAreaSchema.safeParse({
      id: 'sales',
      label: 'Sales',
      description: 'Pipeline and accounts',
      navigation: [],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.description).toBe('Pipeline and accounts');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Why this schema is NOT the spec's, stated as a measurement (objectui#3162)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The objectstack#4115 ledger filed `NavigationItemSchema` as "erased to `any`
 * upstream — flow the spec's shape in by reference once objectstack#4171 lands".
 * #4171 landed, and the spec's schema is precise now (pinned in
 * `spec-derived-unions.test.ts`). That makes the ledger's stated reason spent —
 * and it is exactly the moment the burn-down becomes DANGEROUS, because the
 * remaining reason lives at runtime where no type-level probe can see it.
 *
 * The header above says it in prose: objectui keeps one flat, all-optional shape
 * and the spec is a discriminated union of `.strict()` variants. Prose does not
 * fail. This does: every case below is metadata `objectui validate` accepts today
 * and the spec's schema rejects, so referencing the spec's schema would silently
 * narrow the published CLI's accepted surface.
 *
 * The day the two are reconciled these flip and this block is the instruction to
 * re-run the triage — not to delete the assertions until the divergence is
 * actually gone.
 */
describe('referencing the spec NavigationItemSchema would reject metadata objectui accepts (objectui#3162)', () => {
  /** Guards every rejection below from passing because the spec schema rejects everything. */
  it('accepts a fully spec-shaped item and a bare separator (positive controls)', () => {
    expect(SpecNavigationItemSchema.safeParse({
      id: 'apps', type: 'object', label: 'Apps', objectName: 'sys_app',
    }).success).toBe(true);
    expect(SpecNavigationItemSchema.safeParse({ type: 'separator' }).success).toBe(true);
  });

  it.each([
    ['pinned', { id: 'apps', type: 'object', label: 'Apps', objectName: 'sys_app', pinned: true },
      'backs useNavPins + FavoritesProvider'],
    ['defaultOpen', { id: 'grp', type: 'group', label: 'G', children: [], defaultOpen: true },
      'the legacy spelling this file keeps accepting for published metadata'],
    ['visible: boolean', { id: 'ai', type: 'url', label: 'AI', url: '/ai', visible: true },
      'menuItemToNavigationItem MANUFACTURES one when it inverts AppMenuItem.hidden'],
    ['single-character id', { id: 'a', type: 'url', label: 'A', url: '/a' },
      'objectui requires only a non-empty id; the spec requires two characters'],
  ])('the spec rejects %s (%s)', (_name, input, _why) => {
    // objectui accepts it...
    expect(NavigationItemSchema.safeParse(input).success).toBe(true);
    // ...and the spec does not, which is the whole reason for the local schema.
    expect(SpecNavigationItemSchema.safeParse(input).success).toBe(false);
  });

  // A separator carrying `label` was a row above until objectui#10867: the flat
  // mirror admitted it, the spec refused it. The mirror now refuses it too, so
  // it is no longer a divergence and is asserted as an agreement instead.
  it('a separator `label` is no longer a divergence: both refuse it (objectui#10867)', () => {
    const input = { type: 'separator', label: 'Section' };
    expect(NavigationItemSchema.safeParse(input).success).toBe(false);
    expect(SpecNavigationItemSchema.safeParse(input).success).toBe(false);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// `visible`: the spec's expression input, both ways (objectui#13075)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The spec types every nav branch's `visible` as `EvaluatedExpressionInputSchema`:
 * a non-blank predicate string, or the `{ dialect, source }` envelope its own
 * parse produces. The mirror's slot was `boolean | string`, so it refused the
 * envelope and accepted a blank string — a divergence both ways that no row
 * above recorded. The mirror now takes the spec's schema by reference beside
 * its boolean arm, so the boolean (the `visible: boolean` row above) is the one
 * divergence left on this key.
 *
 * Each verdict is read off BOTH schemas, on an ordinary entry and on a `doc`
 * entry (which the spec's `doc` arm judges), so an agreement cannot pass
 * because one side refuses everything.
 */
describe('objectui#13075 — `visible` takes the spec\'s expression input', () => {
  const ENTRIES: Array<[string, Record<string, unknown>]> = [
    ['a url entry', { id: 'nav_ai', type: 'url', label: 'AI', url: '/ai' }],
    ['a doc entry', { id: 'nav_help', type: 'doc', book: 'crm_manual' }],
  ];
  /** An envelope that reads no `data`, so the spec's data-source rule does not apply. */
  const ENVELOPE = { dialect: 'cel', source: "'org_admin' in current_user.positions" };

  it.each(ENTRIES)('the `{ dialect, source }` envelope parses on both (%s), and the mirror keeps it as written', (_name, entry) => {
    const input = { ...entry, visible: ENVELOPE };
    expect(SpecNavigationItemSchema.safeParse(input).success).toBe(true);
    expect(keep(input)).toEqual(input);
  });

  it.each(ENTRIES.flatMap(([name, entry]) => [
    [name, '\'\'', { ...entry, visible: '' }],
    [name, 'whitespace', { ...entry, visible: '   ' }],
  ] as Array<[string, string, Record<string, unknown>]>))(
    'a blank string is refused by both (%s, %s), with the spec\'s code and sentence',
    (_name, _blank, input) => {
      const spec = SpecNavigationItemSchema.safeParse(input);
      const mirror = NavigationItemSchema.safeParse(input);
      expect(refusal(spec)).toEqual(['invalid_union @ visible']);
      expect(refusal(mirror)).toEqual(['invalid_union @ visible']);
      expect(!mirror.success && mirror.error.issues[0].message).toBe(!spec.success && spec.error.issues[0].message);
    },
  );

  it('a blank `source` inside the envelope is refused by both, once, at `source`', () => {
    const input = { id: 'nav_ai', type: 'url', label: 'AI', url: '/ai', visible: { dialect: 'cel', source: ' ' } };
    expect(refusal(SpecNavigationItemSchema.safeParse(input))).toEqual(['custom @ visible.source']);
    expect(refusal(NavigationItemSchema.safeParse(input))).toEqual(['custom @ visible.source']);
  });

  it('CONTROL — a bare non-blank string parses on both, and the mirror does not rewrite it into an envelope', () => {
    const input = { id: 'nav_ai', type: 'url', label: 'AI', url: '/ai', visible: "'org_admin' in current_user.positions" };
    expect(SpecNavigationItemSchema.safeParse(input).success).toBe(true);
    expect(keep(input)).toEqual(input);
  });

  it('CONTROL — a boolean still parses on the mirror and stays the one divergence (the `visible: boolean` row)', () => {
    for (const visible of [true, false]) {
      const input = { id: 'nav_ai', type: 'url', label: 'AI', url: '/ai', visible };
      expect(keep(input)).toEqual(input);
      expect(SpecNavigationItemSchema.safeParse(input).success).toBe(false);
    }
  });

  it('the TypeScript face admits the envelope (compile-time)', () => {
    const entry: NavigationItem = { id: 'nav_ai', type: 'url', label: 'AI', url: '/ai', visible: { dialect: 'cel', source: 'true' } };
    expect(keep(entry)).toEqual(entry);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// The type vocabulary and the `doc` entry (objectui#11197)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `NavigationItemTypeSchema` was a hand list of nine. `@objectstack/spec` 17.5.0
 * added a tenth arm, `doc` (ADR-0046), and `objectui validate` went on refusing
 * `{ type: 'doc', book }` — an entry the spec's own docblock example spells —
 * while the TypeScript twin, spec-derived, already carried it. The enum is now
 * read off the spec's discriminator, and the `doc` arm is judged by the spec's
 * own `DocNavItemSchema`.
 *
 * The spec's discriminator is read here through the spec's EXPORTED
 * `NavigationItemSchema` (lazy → union → each arm's `type` literal) — not the
 * `AppSchema` walk the mirror itself takes — so a derivation that lost its way
 * cannot agree with itself here.
 */
function specDiscriminator(): string[] {
  type Arm = { shape?: { type?: { value?: unknown } } };
  const union = (SpecNavigationItemSchema as unknown as { unwrap: () => { options?: readonly Arm[] } }).unwrap();
  const values = (union.options ?? []).map((arm) => arm.shape?.type?.value);
  if (values.length === 0 || values.some((v) => typeof v !== 'string')) {
    throw new Error("could not read the `type` literal of every arm of @objectstack/spec's NavigationItemSchema");
  }
  return values as string[];
}

/**
 * ⚠️ THE TRIPWIRE. The nav types this renderer has been triaged for: each one
 * has a `resolveHref` branch in `@object-ui/layout`, an entry in
 * `plugin-designer`'s `NAV_TYPE_META`, and an unlabelled fixture in
 * `./nav-label-optional-9868.test.ts`. Because the enum is DERIVED, a type the
 * spec adds is accepted by `objectui validate` the moment the pin moves — so
 * this list is what turns red then, and the fix is to triage the new type's
 * renderer path (objectui#11197's 「声明即强制」 check), not to append a member.
 */
const TRIAGED_NAV_TYPES = [
  'object', 'dashboard', 'page', 'url', 'report', 'action', 'component', 'doc', 'separator', 'group',
];

/** The issues a verdict carries, as `code @ path`, so a refusal names its reason. */
function refusal(result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[] }> } }): string[] {
  return result.success ? [] : result.error!.issues.map((i) => `${i.code} @ ${i.path.join('.')}`);
}

describe('objectui#11197 — the type vocabulary is the spec discriminator', () => {
  it('NavigationItemTypeSchema carries exactly the spec discriminator, in the spec\'s order', () => {
    expect([...NavigationItemTypeSchema.options]).toEqual(specDiscriminator());
  });

  it('the spec discriminator is still the triaged set — a NEW spec type turns this red', () => {
    expect(specDiscriminator()).toEqual(TRIAGED_NAV_TYPES);
  });

  it('`doc` is a member of both faces\' vocabulary', () => {
    expect(NavigationItemTypeSchema.options).toContain('doc');
    // The TypeScript face: this line does not compile if `NavigationItemType` loses `doc`.
    const docType: NavigationItemType = 'doc';
    expect(docType).toBe('doc');
  });
});

describe('objectui#11197 — a `doc` entry parses on both faces', () => {
  const ACCEPTED: Array<[string, Record<string, unknown>]> = [
    // The spec's own docblock example.
    ['a book (the help-centre entry)', { id: 'nav_help', type: 'doc', label: 'Help Centre', icon: 'book-open', book: 'crm_manual' }],
    ['one page', { id: 'nav_lead_guide', type: 'doc', doc: 'crm_lead_guide' }],
    ['a page in a book\'s context', { id: 'nav_lead_guide', type: 'doc', book: 'crm_manual', doc: 'crm_lead_guide' }],
    ['the package\'s implicit book', { id: 'nav_docs', type: 'doc', book: 'com.example.crm' }],
    ['the base gating keys its siblings carry', {
      id: 'nav_admin_guide', type: 'doc', book: 'crm_admin_guide', visible: "${user.role == 'admin'}",
      requiredPermissions: ['crm_admin'], requiresObject: 'crm_lead', requiresService: 'docs', badge: 'new',
      badgeVariant: 'secondary', order: 3,
    }],
  ];

  it.each(ACCEPTED)('%s — the spec accepts it, and so does the mirror, keeping every key as written', (_name, entry) => {
    expect(SpecNavigationItemSchema.safeParse(entry).success).toBe(true);
    // The mirror parses it WHOLE: nothing stripped, and nothing rewritten — the
    // spec's parse turns a `visible` string into an expression envelope, and
    // this validator does not write values into an author's document.
    expect(keep(entry)).toEqual(entry);
  });

  it('the TypeScript face admits it with its targets (compile-time)', () => {
    const entry: NavigationItem = { id: 'nav_help', type: 'doc', label: 'Help Centre', book: 'crm_manual', doc: 'crm_lead_guide' };
    expect(keep(entry)).toEqual(entry);
  });
});

describe('objectui#11197 — the `doc` arm accepts nothing the spec refuses', () => {
  const REFUSED: Array<[string, Record<string, unknown>, string[]]> = [
    ['a target-less `doc` entry', { id: 'nav_help', type: 'doc', label: 'Help' }, ['custom @ ']],
    ['a filename as the doc target', { id: 'nav_g', type: 'doc', doc: 'crm_lead_guide.md' }, ['invalid_format @ doc']],
    ['a path as the doc target', { id: 'nav_g', type: 'doc', doc: 'docs/crm_lead_guide' }, ['invalid_format @ doc']],
    ['a PascalCase doc target', { id: 'nav_g', type: 'doc', doc: 'CrmLeadGuide' }, ['invalid_format @ doc']],
    ['an empty book', { id: 'nav_g', type: 'doc', book: '' }, ['too_small @ book']],
    ['a sibling\'s target key', { id: 'nav_g', type: 'doc', book: 'crm_manual', objectName: 'crm_lead' }, ['unrecognized_keys @ ']],
    ['an unknown key', { id: 'nav_g', type: 'doc', book: 'crm_manual', bookName: 'crm_manual' }, ['unrecognized_keys @ ']],
    ['objectui-only `pinned`', { id: 'nav_g', type: 'doc', book: 'crm_manual', pinned: true }, ['unrecognized_keys @ ']],
    ['group-only `children`', { id: 'nav_g', type: 'doc', book: 'crm_manual', children: [] }, ['unrecognized_keys @ ']],
    ['a boolean `visible`', { id: 'nav_g', type: 'doc', book: 'crm_manual', visible: true }, ['invalid_union @ visible']],
    ['a one-character id', { id: 'g', type: 'doc', book: 'crm_manual' }, ['too_small @ id']],
    ['no id', { type: 'doc', book: 'crm_manual' }, ['invalid_type @ id']],
  ];

  it.each(REFUSED)('%s — refused by the spec and by the mirror, for the spec\'s reason', (_name, entry, expected) => {
    expect(refusal(SpecNavigationItemSchema.safeParse(entry))).toEqual(expected);
    expect(refusal(NavigationItemSchema.safeParse(entry))).toEqual(expected);
  });

  it('the refusal carries the spec\'s remedy text, not a restatement', () => {
    const r = NavigationItemSchema.safeParse({ id: 'nav_help', type: 'doc' });
    expect(!r.success && r.error.issues[0].message).toMatch(/^A `doc` navigation item needs a target: set `book`/);
  });

  it('an EMPTY label is refused, as on every sibling — the one stated divergence, narrower than the spec', () => {
    const entry = { id: 'nav_help', type: 'doc', book: 'crm_manual', label: '' };
    expect(SpecNavigationItemSchema.safeParse(entry).success).toBe(true);
    expect(refusal(NavigationItemSchema.safeParse(entry))).toEqual(['custom @ label']);
  });

  it('the `doc` arm declares exactly the spec `doc` arm\'s keys', () => {
    type Arm = { shape?: Record<string, { value?: unknown }> };
    const arms = (NavigationItemSchema as unknown as { unwrap: () => { options: readonly Arm[] } }).unwrap().options;
    const docArm = arms.find((arm) => arm.shape?.type?.value === 'doc');
    expect(Object.keys(docArm?.shape ?? {}).sort()).toEqual(Object.keys(SpecDocNavItemSchema.shape).sort());
  });
});

describe('objectui#11197 — an unknown type is still refused on both faces (control)', () => {
  it('refuses `type: \'bogus\'` at `type`, with the same code the spec answers', () => {
    const entry = { id: 'nav_x', type: 'bogus', label: 'X' };
    expect(refusal(SpecNavigationItemSchema.safeParse(entry))).toEqual(['invalid_union @ type']);
    expect(refusal(NavigationItemSchema.safeParse(entry))).toEqual(['invalid_union @ type']);
  });

  it('a `doc` entry nested under a group is judged by the same arm', () => {
    const group = (child: Record<string, unknown>) => ({ id: 'nav_help_grp', type: 'group', label: 'Help', children: [child] });
    expect(keep(group({ id: 'nav_help', type: 'doc', book: 'crm_manual' }))).not.toBeNull();
    expect(refusal(NavigationItemSchema.safeParse(group({ id: 'nav_help', type: 'doc' })))).toEqual(['custom @ children.0']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A `visible` that reads `data` needs a `dataSource` (objectui#13076)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The spec mounts its exported `navItemVisibleDataNeedsDataSource` on its whole
 * navigation union (objectstack#24534): an entry whose `visible` reads `data`,
 * with no `dataSource` to bind it, is refused at `visible`. The mirror chains
 * that very function on every arm, so each refusal below is read off BOTH
 * schemas and compared issue for issue — the issue text is the spec's, compared
 * rather than pinned.
 */
describe('objectui#13076 — a `visible` that reads `data` needs a `dataSource`, on both faces', () => {
  const DATA_SOURCE = { provider: 'api', read: { url: '/api/v1/environments' } };
  /** The spec card's own entry. */
  const NAV_ENVS = { id: 'nav_envs', type: 'object', objectName: 'sys_environment', visible: 'data.total == 1' };

  /** Code, path and message of every issue, so "the same issue" is the whole issue. */
  function issues(result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }) {
    return result.success ? [] : result.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
  }

  const REFUSED: Array<[string, Record<string, unknown>, string]> = [
    ['the card\'s `object` entry', NAV_ENVS, 'visible'],
    ['a `url` entry (a non-`object` branch)', { id: 'nav_ai', type: 'url', url: '/ai', visible: 'data.enabled' }, 'visible'],
    ['a `doc` entry (judged by its own arm)', { id: 'nav_help', type: 'doc', book: 'crm_manual', visible: 'data.enabled' }, 'visible'],
    ['a `url` entry nested under a group', { id: 'nav_grp', type: 'group', label: 'G', children: [{ id: 'nav_ai', type: 'url', url: '/ai', visible: 'data.enabled' }] }, 'children.0.visible'],
  ];

  it.each(REFUSED)('%s — refused by the spec and by the mirror, with the same issue', (_name, entry, at) => {
    const spec = issues(SpecNavigationItemSchema.safeParse(entry));
    const mirror = issues(NavigationItemSchema.safeParse(entry));
    expect(spec.map((i) => `${i.code} @ ${i.path}`)).toEqual([`custom @ ${at}`]);
    expect(mirror).toEqual(spec);
  });

  it('CONTROL — the card\'s entry WITH a `dataSource` is accepted by both, and the mirror keeps it', () => {
    const entry = { ...NAV_ENVS, dataSource: DATA_SOURCE };
    expect(SpecNavigationItemSchema.safeParse(entry).success).toBe(true);
    expect(keep(entry)).toEqual(entry);
  });

  it('CONTROL — an absent `visible` passes both; a boolean `visible` passes the mirror (the `visible: boolean` row)', () => {
    const { visible: _drop, ...absent } = NAV_ENVS;
    expect(SpecNavigationItemSchema.safeParse(absent).success).toBe(true);
    expect(keep(absent)).toEqual(absent);
    for (const visible of [true, false]) {
      const entry = { ...NAV_ENVS, visible };
      expect(keep(entry)).toEqual(entry);
    }
  });
});
