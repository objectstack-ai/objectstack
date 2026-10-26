// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3913 — every curated page-block label is a translation key that
 * BOTH locales define, and the key is the one its POSITION implies.
 *
 * ## What was broken
 *
 * `PageBlockInspector`'s chrome went through `t('engine.inspector.pageBlock.*')`
 * from the start; the panel's CONTENTS — the 152 field/option labels and 5
 * `addLabel`s of `block-config.ts` — were English literals handed straight to
 * the field components. A zh-CN admin opening any page block therefore read
 * 「属性」 over a stack of English field names: two languages in one panel, no
 * special data needed to reproduce.
 *
 * ## Why the assertions are two, not one
 *
 * "Does the key exist in both tables?" is the obvious check and it is not
 * enough. The keys are near-identical strings differing by one segment
 * (`…field.object-grid.columns` vs `…field.object-form.columns`), so the
 * realistic mistake when adding a block is not a typo — it is copy-pasting a
 * neighbouring block's key, which EXISTS in both locales and renders a plausible
 * label belonging to a different property. An existence-only check is green for
 * that, and the author reads a correct-looking panel that edits the wrong-named
 * field.
 *
 * So the key is DERIVED here from the label's position in `BLOCK_CONFIG` and
 * compared with what the table stores. Derivation is what makes the mistake
 * mechanically visible, and it is the reason the key shape is positional in the
 * first place rather than semantic.
 *
 *   field label          engine.inspector.pageBlock.field.<blockType>.<name>
 *   nested item label    engine.inspector.pageBlock.field.<blockType>.<array>.<name>
 *   array add button     engine.inspector.pageBlock.add.<blockType>.<name>
 *   select/color option  engine.inspector.pageBlock.option.<fieldName>.<value>
 *   placeholder prose    engine.inspector.pageBlock.placeholder.<blockType>.<name>
 *
 * Option keys omit the block type on purpose (so `format`'s number/currency/
 * percent are translated once and shared by `object-metric` and
 * `element:number`); field keys carry it on purpose, because the same English
 * word needs different Chinese per block — `element:button.label` is a button
 * caption 「按钮文字」 while `page:tabs.items.label` is a tab title 「标签」.
 *
 * Completeness is asserted through `t()` rather than by importing the tables:
 * `t()` returns the key unchanged on a miss, so `t(key, locale) === key` is
 * exactly "this locale has no translation" — measured through the same accessor
 * the component uses, not a private table this test would have to be given.
 *
 * ## objectui#3979 — the `placeholder` column, and why it is only PARTLY keyed
 *
 * #3913 stopped at labels, so the hints under them stayed English: 「图标」 over
 * a box reading `lucide icon name`. The column joins the walk above as a fifth
 * family, with the SAME positional derivation — but only for the 7 placeholders
 * that are prose. The other 10 are example VALUES (`20`, `https://…`, a JSON
 * sample) and are `{ literal: … }` in `block-config.ts`, never keys: translating
 * them would corrupt the thing the author is being told to type.
 *
 * Which kind a placeholder is, is declared in the TYPE (`PlaceholderSpec`), not
 * inferred here — a bare `placeholder: 'lucide icon name'` no longer compiles.
 * What this file adds on top is the part a type cannot state: that the key side
 * is complete in both locales (with the rest of the walk), and that the literal
 * side is an inventory somebody has to argue with before "helpfully" translating
 * a JSON sample. The third describe holds that inventory.
 *
 * ## objectui#8368 — the other direction, and why it is the LAST describe
 *
 * Every assertion above answers "did the key ARRIVE?". None of them can answer
 * "did the retired key LEAVE?" — a leftover key resolves in both locales, so it
 * is green everywhere here by construction. Four renames in a row closed that
 * half with a hand-written pin naming the one key they retired; the last
 * describe replaces the convention with an instrument, scoped to exactly the
 * subset where deadness is mechanically decidable. Its own header states the
 * reader set it measured and, at equal length, what it deliberately does not
 * cover.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { BLOCK_CONFIG, type BlockPropField, type PlaceholderSpec } from '../block-config';
import { t } from '../../i18n';
import { uiRoot } from '../../../../../../../scripts/ui-root.mjs';

const PREFIX = 'engine.inspector.pageBlock';

/** One translatable label site: where it lives, what key that implies, what is stored. */
interface LabelSite {
  /** `field` | `add` | `option` | `placeholder` — which key family. */
  family: 'field' | 'add' | 'option' | 'placeholder';
  /** The key the site's position implies. */
  derived: string;
  /** The key `block-config.ts` actually stores there. */
  stored: string;
  /** Human-readable position, for assertion messages. */
  where: string;
}

/** Every placeholder in the table, with its position — both kinds (#3979). */
interface PlaceholderSite {
  /** Human-readable position: `<blockType>.<dotted field path>`. */
  where: string;
  /** The key a keyed placeholder's position implies. */
  derived: string;
  /** What `block-config.ts` declares there. */
  spec: PlaceholderSpec;
}

/** Walk BLOCK_CONFIG and derive a key for every label / addLabel / option label
 *  / prose placeholder, and collect every placeholder spec of either kind. */
function labelSites(): { sites: LabelSite[]; placeholders: PlaceholderSite[] } {
  const sites: LabelSite[] = [];
  const placeholders: PlaceholderSite[] = [];

  const walk = (f: BlockPropField, blockType: string, path: string[]) => {
    const dotted = [...path, f.name].join('.');
    sites.push({
      family: 'field',
      derived: `${PREFIX}.field.${blockType}.${dotted}`,
      stored: f.label,
      where: `${blockType}.${dotted} (label)`,
    });

    // A placeholder is either prose (a key — same positional derivation as the
    // label it sits under) or a locale-invariant value literal. Only the first
    // kind is a translation site; the second is inventoried further down.
    const ph = (f as { placeholder?: PlaceholderSpec }).placeholder;
    if (ph !== undefined) {
      const derived = `${PREFIX}.placeholder.${blockType}.${dotted}`;
      placeholders.push({ where: `${blockType}.${dotted}`, derived, spec: ph });
      if (ph.key !== undefined) {
        sites.push({
          family: 'placeholder',
          derived,
          stored: ph.key,
          where: `${blockType}.${dotted} (placeholder)`,
        });
      }
    }

    if (f.kind === 'array') {
      sites.push({
        family: 'add',
        derived: `${PREFIX}.add.${blockType}.${dotted}`,
        stored: f.addLabel,
        where: `${blockType}.${dotted} (addLabel)`,
      });
      for (const itf of f.itemFields) walk(itf, blockType, [...path, f.name]);
    }

    // `select` always has options; `color` may. Both render their labels.
    const options = (f as { options?: Array<{ value: string; label: string }> }).options;
    if (Array.isArray(options)) {
      for (const o of options) {
        sites.push({
          family: 'option',
          derived: `${PREFIX}.option.${f.name}.${o.value}`,
          stored: o.label,
          where: `${blockType}.${dotted} option=${o.value}`,
        });
      }
    }
  };

  for (const [blockType, fields] of Object.entries(BLOCK_CONFIG)) {
    for (const f of fields) walk(f, blockType, []);
  }
  return { sites, placeholders };
}

const { sites: SITES, placeholders: PLACEHOLDERS } = labelSites();

/**
 * Keys whose two locales are deliberately identical (an acronym, a symbol —
 * nothing to translate). EMPTY today, and it is a ledger rather than a rule: a
 * genuinely locale-invariant label is added here with its reason, so "the zh
 * column is a copy of the en column" stays a red build everywhere else.
 */
const LOCALE_INVARIANT = new Set<string>();

describe('block-config labels are translation keys (#3913)', () => {
  it('collects every label site — the walk itself is not empty', () => {
    // Guards the derivation: a refactor that stops finding labels would make
    // every per-site assertion below vacuous by iterating nothing.
    expect(SITES.length).toBeGreaterThan(150);
    const families = SITES.reduce<Record<string, number>>((acc, s) => {
      acc[s.family] = (acc[s.family] ?? 0) + 1;
      return acc;
    }, {});
    // 152 `label:` + 5 `addLabel:` literals at the time of the fix; option sites
    // are counted per USE, so shared option lists (`format`, `ALIGN_OPTS`) are
    // visited once per referencing field.
    expect(families.field).toBeGreaterThan(80);
    expect(families.add).toBe(5);
    expect(families.option).toBeGreaterThan(50);
    // Exact, like `add`: the keyed half of the placeholder column is 6
    // (#3979; 8 until objectui#3829 retired the canonical `page:header.icon`
    // field, then 7 until objectui#8280 removed the unofferable `ai:input`
    // panel). A 7th prose placeholder should fail here and be translated; a
    // 7th VALUE placeholder does not reach this family at all and is caught by
    // the literal inventory instead. Either way the new one gets classified
    // rather than defaulting to English-on-screen.
    expect(families.placeholder).toBe(6);
  });

  it('stores exactly the key its position implies', () => {
    // The copy-paste guard. A neighbouring block's key exists in both locales,
    // so nothing else in this file would notice it.
    const wrong = SITES.filter((s) => s.stored !== s.derived).map(
      (s) => `${s.where}: stored '${s.stored}' but position implies '${s.derived}'`,
    );
    expect(wrong).toEqual([]);
  });

  it('no label is left as display text', () => {
    // Belt to the braces above: an English literal cannot even look like a key.
    const literals = SITES.filter((s) => !s.stored.startsWith(`${PREFIX}.`)).map(
      (s) => `${s.where}: '${s.stored}'`,
    );
    expect(literals).toEqual([]);
  });

  it('every key resolves in en-US', () => {
    const missing = SITES.filter((s) => t(s.derived, 'en-US') === s.derived).map((s) => s.derived);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every key resolves in zh-CN', () => {
    // The defect this issue filed, as a structural assertion: a field added to
    // BLOCK_CONFIG without a zh translation is red here rather than shipping as
    // an English box in a Chinese panel.
    const missing = SITES.filter((s) => t(s.derived, 'zh-CN') === s.derived).map((s) => s.derived);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('zh-CN is actually translated, not a copy of en-US', () => {
    const untranslated = SITES.filter(
      (s) => !LOCALE_INVARIANT.has(s.derived) && t(s.derived, 'zh-CN') === t(s.derived, 'en-US'),
    ).map((s) => `${s.derived} = '${t(s.derived, 'en-US')}'`);
    // If a label really is locale-invariant, add it to LOCALE_INVARIANT above
    // with the reason — do not weaken this assertion.
    expect([...new Set(untranslated)]).toEqual([]);
  });

  it('one key never carries two different meanings', () => {
    // Option keys drop the block type, so the same key is reached from several
    // positions by design — but only ever for the same concept. Two positions
    // sharing a key while meaning different things would translate one of them
    // wrongly, and `t()` cannot tell.
    const byKey = new Map<string, Set<string>>();
    for (const s of SITES) {
      if (!byKey.has(s.derived)) byKey.set(s.derived, new Set());
      byKey.get(s.derived)!.add(s.family);
    }
    const crossFamily = [...byKey.entries()]
      .filter(([, families]) => families.size > 1)
      .map(([key, families]) => `${key}: ${[...families].join('+')}`);
    expect(crossFamily).toEqual([]);

    // A `field`/`add`/`placeholder` key is positional and must therefore be
    // unique outright; only `option` keys may legitimately repeat. Note the four
    // `lucide icon name` placeholders are four DISTINCT keys with equal English
    // text — same reason field keys carry the block type: the blocks may want
    // different wording later, and one key cannot say two things.
    const positional = SITES.filter((s) => s.family !== 'option').map((s) => s.derived);
    expect(positional.length).toBe(new Set(positional).size);
  });
});

/**
 * The English side must not have moved. `en-US` is this repo's baseline
 * language and the table is what the drift discipline protects, so the fix is
 * only correct if it changed WHERE the English text comes from and not the text
 * itself. Sampled across every field kind plus all five add buttons — the
 * remaining keys were substituted mechanically from the pre-change literals
 * (see the PR), which is why a sample is a regression pin here rather than the
 * proof of the migration.
 */
describe('en-US labels are unchanged by the key migration (#3913)', () => {
  const EXPECTED: Record<string, string> = {
    // object-picker / field-list / number / boolean
    'engine.inspector.pageBlock.field.object-grid.objectName': 'Object',
    'engine.inspector.pageBlock.field.object-grid.columns': 'Columns',
    'engine.inspector.pageBlock.field.object-grid.pageSize': 'Page size',
    // The `boolean` sample used to be `object-grid.striped`; objectui#4649
    // removed that field (objectstack#7176 retired the key it wrote, and no
    // renderer read it). `page:card.bordered` takes the slot — same field kind,
    // and its prop is one `containers.tsx` actually applies.
    'engine.inspector.pageBlock.field.page:card.bordered': 'Bordered',
    // the same field NAME in another block, with different text — the case that
    // makes the key positional
    'engine.inspector.pageBlock.field.object-form.columns': 'Field columns (1–4)',
    'engine.inspector.pageBlock.field.element:definition-list.columns': 'Columns (1 or 2)',
    'engine.inspector.pageBlock.field.grid.columns': 'Columns',
    // text / json / color / field-picker
    'engine.inspector.pageBlock.field.element:image.src': 'Source URL',
    'engine.inspector.pageBlock.field.element:button.action': 'Action',
    'engine.inspector.pageBlock.field.object-metric.colorVariant': 'Color',
    'engine.inspector.pageBlock.field.object-kanban.groupBy': 'Group by field',
    // string-list / array container
    'engine.inspector.pageBlock.field.record:quick_actions.actionNames': 'Action names',
    'engine.inspector.pageBlock.field.record:details.sections': 'Sections',
    // the #3819 label, whose wording is itself load-bearing
    'engine.inspector.pageBlock.field.record:details.sections.name': 'Name (i18n key)',
    // all five add buttons
    'engine.inspector.pageBlock.add.element:definition-list.items': 'Add item',
    'engine.inspector.pageBlock.add.page:tabs.items': 'Add tab',
    'engine.inspector.pageBlock.add.page:accordion.items': 'Add section',
    'engine.inspector.pageBlock.add.record:details.sections': 'Add section',
    'engine.inspector.pageBlock.add.record:path.stages': 'Add stage',
    // options, incl. the shared `format` list and the shared ALIGN_OPTS
    'engine.inspector.pageBlock.option.format.currency': 'Currency',
    'engine.inspector.pageBlock.option.align.center': 'Center',
    'engine.inspector.pageBlock.option.location.record_more': 'Record more menu',
    'engine.inspector.pageBlock.option.severity.warning': 'Warning',
    // ── the placeholder family (#3979) ───────────────────────────────────────
    // ALL SIX, not a sample: this column was migrated by hand rather than
    // mechanically, and the en side is the only thing standing between "the key
    // resolves" and "the key resolves to what the box used to say". Each value
    // below is byte-identical to the literal `block-config.ts` held at
    // `origin/main` 6bd6a4d76 — including the U+2026 ellipsis in `Text…`, which
    // a re-typed `...` would silently replace.
    //
    // It was EIGHT until objectui#3829: `…placeholder.page:header.icon` went
    // with the canonical `page:header` icon field, retired upstream by
    // objectstack#6946 / PR objectstack#7115. Dropping the sample row is the
    // right move rather than keeping it as a "still translated" check — the key
    // is gone from both locale tables, so `t()` now returns it unchanged and an
    // assertion here would be pinning the passthrough against itself. The
    // deliberate absence is pinned in `block-config.test.ts` instead, where the
    // field's absence is pinned beside it.
    //
    // Then SEVEN until objectui#8280: `…placeholder.ai:input.agentName` went
    // with the `ai:input` panel, removed because the palette never offered the
    // block. Same move, same reason — the key left both locale tables with it.
    'engine.inspector.pageBlock.placeholder.object-metric.icon': 'lucide icon name',
    'engine.inspector.pageBlock.placeholder.element:text.content': 'Text…',
    'engine.inspector.pageBlock.placeholder.element:button.icon': 'lucide icon name',
    'engine.inspector.pageBlock.placeholder.record:details.sections.name': 'snake_case, e.g. contact_info',
    'engine.inspector.pageBlock.placeholder.record:alert.icon': 'lucide icon name',
    'engine.inspector.pageBlock.placeholder.record:quick_actions.actionNames': 'action name',
  };

  it('renders the pre-change English text for every sampled key', () => {
    for (const [key, text] of Object.entries(EXPECTED)) {
      expect(t(key, 'en-US'), key).toBe(text);
    }
  });

  it('every sampled key is one the table really reaches', () => {
    // Without this, a renamed key would leave the sample above asserting
    // `t()`'s key-passthrough against itself and passing.
    const derived = new Set(SITES.map((s) => s.derived));
    const orphans = Object.keys(EXPECTED).filter((k) => !derived.has(k));
    expect(orphans).toEqual([]);
  });
});

/**
 * The OTHER half of the placeholder column: the ones that must stay literal
 * (#3979).
 *
 * Everything above pins the keys. This describe pins the decision NOT to key the
 * rest, because that is the half a future reader is most likely to "finish": the
 * column is half translated, ten English-looking strings remain, and translating
 * `{ "type": "url", … }` or `https://…` looks like completing somebody's
 * unfinished work. It is not — those characters are the value the author is being
 * shown, and a localized JSON sample produces metadata the spec rejects.
 *
 * So the literal side is an inventory with a stated reason per entry, and adding
 * to it is a deliberate act. The prose tripwire below is the cheaper half of the
 * same guard: it can catch `{ literal: 'lucide icon name' }` (two adjacent words)
 * but not a single-word hint, which is exactly why the inventory is exhaustive
 * rather than a heuristic.
 */
describe('placeholders that must NOT be translated (#3979)', () => {
  /** Position → the literal it declares, and why that is not a translation gap. */
  const INVARIANT: Record<string, { literal: string; because: string }> = {
    'object-grid.pageSize': { literal: '20', because: 'a default row count' },
    'object-form.columns': { literal: '2', because: 'a grid column count' },
    'grid.columns': { literal: '3', because: 'a grid column count' },
    'grid.gap': { literal: '4', because: 'a spacing step' },
    'element:image.src': { literal: 'https://…', because: 'a URL scheme — the value starts this way in every locale' },
    'element:definition-list.columns': { literal: '1', because: 'a column count' },
    'element:repeater.limit': { literal: '10', because: 'a row limit' },
    'element:button.action': {
      literal: '{ "type": "url", "target": "/environments" }',
      because: 'a JSON sample the author copies — translated keys would fail InlineActionSchema',
    },
    'record:related_list.limit': { literal: '10', because: 'a row limit' },
    'object-kanban.limit': {
      literal: '100',
      because: "a row limit — DEFAULT_KANBAN_FETCH_BATCH_SIZE, the board's fetch batch when the box is empty",
    },
    'record:details.sections.columns': { literal: '2', because: 'a column count' },
  };

  it('collects all 17 placeholders — 6 keyed, 11 literal', () => {
    // Guards the walk: if placeholder collection silently found nothing, every
    // assertion here would pass over an empty list.
    //
    // 18 / 8 / 10 until objectui#3829: the canonical `page:header` icon box was
    // a KEYED placeholder, and it went with the field when objectstack#6946 /
    // PR objectstack#7115 retired `PageHeaderProps.icon`. Then 17 / 7 / 10
    // until objectui#7772 gave `object-kanban` the `limit` control its schema
    // has declared since objectui#7322 — a VALUE placeholder (`100`,
    // `DEFAULT_KANBAN_FETCH_BATCH_SIZE`), so it lands on the literal side and the keyed
    // half is what stays untouched this time. Then 18 / 7 / 11 until
    // objectui#8280 removed the `ai:input` panel, whose `agentName` box was a
    // KEYED placeholder — the palette never offered that block.
    expect(PLACEHOLDERS.length).toBe(17);
    expect(PLACEHOLDERS.filter((p) => p.spec.key !== undefined).length).toBe(6);
    expect(PLACEHOLDERS.filter((p) => p.spec.literal !== undefined).length).toBe(11);
  });

  it('every placeholder declares exactly one of key / literal', () => {
    // `PlaceholderSpec`'s mutual `never`s make this a type error already. Pinned
    // at runtime too, because the table is also reached from JS-shaped places
    // (JSON fixtures, tests) where the type is not consulted.
    const bad = PLACEHOLDERS.filter(
      (p) => (p.spec.key === undefined) === (p.spec.literal === undefined),
    ).map((p) => `${p.where}: ${JSON.stringify(p.spec)}`);
    expect(bad).toEqual([]);
  });

  it('the literal inventory is exactly the declared one', () => {
    const actual = Object.fromEntries(
      PLACEHOLDERS.filter((p) => p.spec.literal !== undefined).map((p) => [p.where, p.spec.literal]),
    );
    const expected = Object.fromEntries(
      Object.entries(INVARIANT).map(([where, v]) => [where, v.literal]),
    );
    // If this fails, one of three things happened, and they need different fixes:
    //   - a new placeholder was added as a literal → is it a VALUE? add it here
    //     with its reason. Is it prose? make it a `{ key }` instead.
    //   - a literal changed → the en baseline moved; say so in a changeset.
    //   - a literal became a key → drop it here and add the key to the
    //     `en-US labels are unchanged` sample above.
    expect(actual).toEqual(expected);
  });

  it('no invariant literal is prose — that would be a missed translation', () => {
    // Two adjacent alphabetic words is the signature of a sentence, and every
    // value in the inventory is a number, a URL scheme or JSON — none of which
    // can match. `lucide icon name` parked here as a literal would.
    const prose = Object.entries(INVARIANT)
      .filter(([, v]) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(v.literal))
      .map(([where, v]) => `${where}: '${v.literal}'`);
    expect(prose).toEqual([]);
  });

  it('every inventory entry carries a reason', () => {
    // The ledger is only worth anything if each line says why. A bare list
    // becomes a place to append to without thinking.
    for (const [where, v] of Object.entries(INVARIANT)) {
      expect(v.because.length, `${where} needs a reason`).toBeGreaterThan(10);
    }
  });

  it('no literal placeholder accidentally holds a translation key', () => {
    // The mirror of "no label is left as display text": a key parked on the
    // literal side renders `engine.inspector.pageBlock.…` into the box.
    const keys = PLACEHOLDERS.filter((p) => p.spec.literal?.startsWith(`${PREFIX}.`)).map(
      (p) => `${p.where}: '${p.spec.literal}'`,
    );
    expect(keys).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#8368 — the RETIREMENT direction.
 *
 * Everything above is the ARRIVAL half: a key BLOCK_CONFIG implies must exist
 * in both locale tables. A designer rename owes a second half — the retired key
 * must LEAVE both tables — and until this describe nothing measured it. The two
 * repo-wide i18n gates cannot: `check:i18n-keys` and `check:i18n-dead-keys`
 * both read `packages/i18n/src/locales/`, and `engine.inspector.pageBlock.*`
 * lives only in `metadata-admin/i18n.ts` (which says so in its own header). So
 * each of the four renames so far (objectui#3829, objectui#5212, objectui#8279,
 * objectui#8278) shipped with a HAND-WRITTEN pin naming the one key it retired
 * — a convention, not an instrument, and the fifth rename is one forgotten pin
 * away from leaving dead vocabulary the next author reads as a live surface.
 *
 * ## What "retired" means here, operationally
 *
 * A key is retired when NOTHING CAN REACH IT — not when it merely looks unused.
 * The reader set for this namespace was measured rather than assumed, and it
 * has exactly two members:
 *
 *   1. BLOCK_CONFIG, through the positional derivation this file already
 *      performs. Four families — `field.`, `add.`, `option.`, `placeholder.` —
 *      are produced by nothing else: `SITES` above is the complete enumeration
 *      of what the table can ask for, and the sibling assertions "stores
 *      exactly the key its position implies" and "no label is left as display
 *      text" are what make that enumeration exhaustive rather than a sample.
 *   2. Literal `engine.inspector.pageBlock.…` strings in shipped source —
 *      `PageBlockInspector.tsx`'s panel chrome and `PagePreview.tsx`'s outline
 *      title. These have no position to derive from, so they are read back OUT
 *      of the source, the same way `PageBlockInspector.i18n.test.tsx` reads its
 *      own chrome key list rather than hand-copying it.
 *
 * Measured on this checkout: every one of the 171 `engine.inspector.pageBlock.*`
 * keys in each table is covered by one of those two, and no key is constructed
 * dynamically anywhere (`grep` for a template head under this prefix returns
 * only prose in CHANGELOG.md and comments). That is what makes the namespace a
 * CLOSED WORLD and therefore mechanically decidable.
 *
 * ## What this deliberately does NOT cover — say it loudly (objectui#8068)
 *
 * ONLY `engine.inspector.pageBlock.*`. The tables hold 1660 keys across three
 * top-level namespaces (`engine.` 1371, `designer.` 178, `perm.` 111), and the
 * rest of them are NOT a closed world: they are reached through dynamic
 * construction (`engine.fieldType.<type>`, `engine.flowNode.<type>.label` via
 * `translateNodeLabel`, `engine.diagnostics.severity.<level>`, …). Measured
 * before scoping: a literal-footprint sweep over the whole `ENGINE_STRINGS_EN`
 * table finds 226 of 1660 keys (13.6%) with no literal spelling in any non-test
 * source — overwhelmingly LIVE keys the sweep cannot see. A gate over that
 * corpus would cry wolf 226 times on a clean tree and be deleted rather than
 * trusted, which is objectui#4658's own ruling for the pack-side sweep and
 * objectui#8068's argument against instruments that claim more than they check.
 * The honest scope is the subset that is exactly decidable, and it is stated
 * here rather than implied by the assertion names.
 *
 * ## Why test files are excluded from the literal scan — load-bearing
 *
 * `block-config.test.ts` SPELLS the retired keys (`page:header.icon`,
 * `page:accordion.title`, `object-kanban.groupField`) in its own negative pins.
 * Counting test files as readers would make every key this gate exists to catch
 * permanently reachable — the gate would be green by construction. A key read
 * only by a test is not a key a user can see; the same argument
 * `check-i18n-dead-keys.mjs` makes about test-only pack importers.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The four key families derived from a BLOCK_CONFIG POSITION, and therefore
 *  judged against `SITES` alone — a literal spelling elsewhere (a comment, a
 *  doc line) must not resurrect one. */
const POSITIONAL_FAMILIES = new Set(['field', 'add', 'option', 'placeholder']);

const ROOT = uiRoot();
const I18N_SOURCE_PATH = path.join(
  ROOT,
  'packages/app-shell/src/views/metadata-admin/i18n.ts',
);

interface EngineStringTable {
  /** The `const` name, for assertion messages. */
  name: string;
  /** Every key the table declares, in file order. */
  keys: string[];
  /** 1-based line range of the object literal, for the disjointness guard. */
  from: number;
  to: number;
}

/**
 * The KEYS of one `ENGINE_STRINGS_*` table, read out of the source by LINE
 * RANGE rather than by scanning the whole file.
 *
 * Table membership is the whole question here: a key that MOVED from one locale
 * table to the other reads as unchanged to a whole-file grep, which is exactly
 * the mistake this direction has to be able to see. The range is bounded by the
 * declaration line and the first column-0 `};` after it; keys are the entries at
 * exactly two-space indent, so a multi-line VALUE (indented four) can never be
 * mistaken for one.
 */
function engineStringTable(source: string, name: string): EngineStringTable {
  const lines = source.split('\n');
  const open = lines.findIndex((l) => l.startsWith(`const ${name}: Record<string, string> = {`));
  if (open === -1) throw new Error(`${name}: declaration not found in i18n.ts — the extractor is stale`);
  const close = lines.findIndex((l, i) => i > open && l === '};');
  if (close === -1) throw new Error(`${name}: no column-0 '};' closes the table — the extractor is stale`);
  const keys: string[] = [];
  for (let i = open + 1; i < close; i += 1) {
    const m = /^ {2}'((?:[^'\\]|\\.)*)':/.exec(lines[i]);
    if (m) keys.push(m[1]);
  }
  return { name, keys, from: open + 1, to: close + 1 };
}

/**
 * Every `engine.inspector.pageBlock.…` key spelled as a STRING LITERAL in
 * shipped (non-test) source under `packages/` and `apps/`, mapped to the files
 * that spell it.
 *
 * Scope is the whole workspace on purpose, not just `metadata-admin/`: `t()` is
 * imported from `views/studio-design/**` and `views/*.tsx` today, so a chrome
 * key could legitimately appear outside this directory tomorrow. Reading a key
 * that no longer exists is not this gate's business (the sibling
 * `every key resolves in …` assertions own that direction) — over-collecting
 * here only ever costs a candidate, never a false red.
 */
function shippedLiteralKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;
      if (/\.(test|spec)\.[tj]sx?$/.test(entry.name)) continue;
      if (full === I18N_SOURCE_PATH) continue; // the DEFINITION site, not a reader
      const content = readFileSync(full, 'utf8');
      if (!content.includes(PREFIX)) continue;
      for (const m of content.matchAll(/['"`](engine\.inspector\.pageBlock\.[A-Za-z0-9_.:$-]+)['"`]/g)) {
        const rel = path.relative(ROOT, full).split('\\').join('/');
        const files = found.get(m[1]) ?? [];
        if (!files.includes(rel)) files.push(rel);
        found.set(m[1], files);
      }
    }
  };
  for (const top of ['packages', 'apps']) walk(path.join(ROOT, top));
  return found;
}

const I18N_SOURCE = readFileSync(I18N_SOURCE_PATH, 'utf8');
const EN_TABLE = engineStringTable(I18N_SOURCE, 'ENGINE_STRINGS_EN');
const ZH_TABLE = engineStringTable(I18N_SOURCE, 'ENGINE_STRINGS_ZH');

/** The keys `SITES` implies — the complete BLOCK_CONFIG-derived vocabulary. */
const DERIVED = new Set(SITES.map((s) => s.derived));

/** Literal chrome keys: spelled in shipped source AND not in a positional
 *  family, so a stray mention of a positional key can never resurrect it. */
const SHIPPED_LITERALS = shippedLiteralKeys();
const CHROME = new Map(
  [...SHIPPED_LITERALS].filter(
    ([key]) => !POSITIONAL_FAMILIES.has(key.slice(PREFIX.length + 1).split('.')[0]),
  ),
);

/** A table key nothing in the measured reader set can ask for. */
function unreachable(table: EngineStringTable): string[] {
  return table.keys.filter(
    (key) => key.startsWith(`${PREFIX}.`) && !DERIVED.has(key) && !CHROME.has(key),
  );
}

function pageBlockKeys(table: EngineStringTable): string[] {
  return table.keys.filter((key) => key.startsWith(`${PREFIX}.`));
}

describe('a retired key leaves BOTH locale tables (objectui#8368)', () => {
  it('reads two disjoint, non-empty tables out of i18n.ts', () => {
    // The extractor is a source parser, so its silent failure mode is finding
    // FEWER keys — which would make every assertion below vacuously green over
    // an empty corpus. Ranges first: overlapping ones would mean the `};`
    // scan ran past a table and both sets became the same set.
    expect(EN_TABLE.to).toBeLessThan(ZH_TABLE.from);
    expect(EN_TABLE.keys.length).toBeGreaterThan(1500);
    expect(ZH_TABLE.keys.length).toBeGreaterThan(1500);
    // No duplicates: a key declared twice would be a silent overwrite, and the
    // set arithmetic below would hide it.
    expect(EN_TABLE.keys.length).toBe(new Set(EN_TABLE.keys).size);
    expect(ZH_TABLE.keys.length).toBe(new Set(ZH_TABLE.keys).size);
  });

  it('the extractor really sees the keys the derivation implies', () => {
    // The strongest non-vacuity available: two INDEPENDENT channels for the
    // same fact. `SITES` comes from walking BLOCK_CONFIG; these sets come from
    // parsing the source text. A parser that silently stopped matching (a
    // reformat, a changed indent) fails here by name, not by going quiet.
    const enSet = new Set(EN_TABLE.keys);
    const zhSet = new Set(ZH_TABLE.keys);
    expect([...DERIVED].filter((k) => !enSet.has(k))).toEqual([]);
    expect([...DERIVED].filter((k) => !zhSet.has(k))).toEqual([]);
    expect(DERIVED.size).toBeGreaterThan(150);
  });

  it('the literal scan really finds the chrome call sites', () => {
    // Same guard for the second reader. Named explicitly so a regex that stops
    // matching fails here rather than quietly emptying the reachable set — an
    // empty CHROME would report all 15 chrome keys as retired.
    for (const key of [
      `${PREFIX}.kind`,
      `${PREFIX}.close`,
      `${PREFIX}.list.add`,
      `${PREFIX}.objectPlaceholder`,
      `${PREFIX}.outlineLabel`,
    ]) {
      expect([...CHROME.keys()], `${key} is a live chrome call site`).toContain(key);
    }
    expect(CHROME.size).toBeGreaterThan(12);
  });

  it('en-US carries no pageBlock key nothing can reach', () => {
    // The gate. A key here is one BLOCK_CONFIG no longer implies and no source
    // file asks for — dead vocabulary the next author reads as a live surface.
    // If a NEW reader shape appears (a dynamically built key), this reddens by
    // name and the fix is to teach the reader set about it, not to delete the
    // key. Loud is the correct direction to be wrong in.
    expect(
      unreachable(EN_TABLE),
      'ENGINE_STRINGS_EN keys under this prefix that BLOCK_CONFIG no longer implies and no ' +
        'shipped source asks for — delete them, or teach the reader set about the new reader',
    ).toEqual([]);
  });

  it('zh-CN carries no pageBlock key nothing can reach', () => {
    // The half a rename actually forgets: `en` edited, `zh` left behind. The
    // sibling `every key resolves in zh-CN` cannot see it — a LEFTOVER key
    // resolves perfectly well.
    expect(
      unreachable(ZH_TABLE),
      'ENGINE_STRINGS_ZH keys under this prefix that BLOCK_CONFIG no longer implies and no ' +
        'shipped source asks for — the half a rename forgets',
    ).toEqual([]);
  });

  it('both tables hold the same pageBlock key set', () => {
    // "Left BOTH tables", stated directly. Asymmetry here is the signature of a
    // half-applied retirement, and the message names which side kept the key.
    const en = new Set(pageBlockKeys(EN_TABLE));
    const zh = new Set(pageBlockKeys(ZH_TABLE));
    expect([...en].filter((k) => !zh.has(k)), 'in ENGINE_STRINGS_EN but not ZH').toEqual([]);
    expect([...zh].filter((k) => !en.has(k)), 'in ENGINE_STRINGS_ZH but not EN').toEqual([]);
    expect(en.size).toBeGreaterThan(150);
  });
});
