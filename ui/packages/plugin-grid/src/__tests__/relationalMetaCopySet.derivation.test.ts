/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6875 — the gate that DERIVES `ObjectGrid`'s relational copy set from
 * its consumers instead of trusting a hand-kept literal.
 * objectui#7187 — scoped that derivation to the consumer the bag actually
 * reaches, which is what makes it able to judge a COPY.
 *
 * ## What went wrong, and why a longer literal would not have fixed it
 *
 * `RELATIONAL_META_KEYS` was governed by a rule stated only in prose — *every
 * key here has to have a measured reader on this grid's own render path*. The
 * repo enforced that rule in one direction: objectui#6711 and objectui#6874
 * each removed a key that had NO reader, and each left a behavioural pin
 * behind. Nothing enforced the other direction, so five keys that DO have
 * readers on this path were never copied, and the list's own spellings had gone
 * inconsistent — `lookupFilters` (camel) sat in it while `displayField` and
 * `descriptionField` did not, though all three come off the same kind of
 * chain in the same files.
 *
 * Adding the missing spellings by hand would restore the invariant for exactly
 * as long as nobody touches a consumer. This file is the invariant itself: it
 * re-extracts the read set from the consumer sources on every run and requires
 * `RELATIONAL_META_READ_SET` to match it EXACTLY, in both directions. A new
 * spelling in any chain is unclassified → red. A key deleted from a chain is an
 * orphan in the table → red.
 *
 * ## ⛔ THE DEFECT objectui#7187 FIXED — a union cannot judge a copy
 *
 * Until objectui#7187 the extraction was collapsed into ONE set, the UNION over
 * three consumers, and a copy-set entry was licensed by membership in it. Only
 * the FIRST consumer is fed the copied bag. So membership meant "some consumer
 * reads this key" and never "this bag is how that consumer gets it" — and a
 * copy-set entry asserts the second. objectui#6875 read the first as the second
 * and shipped `descriptionField` and `lookupColumns` onto a bag their only
 * reader never consults; objectui#7166 measured that and retired three keys,
 * and this gate stayed green through both the wrong verdict and its undoing.
 *
 * ⇒ The union is gone. The reader axis is recorded PER CONSUMER on each entry
 * (`readers`), checked against that consumer's own source in both directions,
 * and the copy set is derived from `CONSUMERS_FED_THIS_BAG` alone. The three
 * retired keys can no longer be re-added under ANY verdict:
 *
 *   - as `spec` — the cell does not read them, so the
 *     derived copy set does not contain them and the copy-set assertion is red;
 *   - under the `copiedWithoutCellReader` exit — objectui#7155 retired the
 *     `legacy-alias` class that exit existed for, and the gate now asserts NO
 *     entry takes it at all.
 *
 * ## The three consumers, and how each is read
 *
 * `generateColumns()` hands `fieldMeta` to `CellRenderer` as the `field` prop.
 * `getCellRenderer` dispatches a relational column to `LookupCellRenderer`
 * (`@object-ui/fields/src/index.tsx`), which reads its keys through
 * `(field as { k?: T }).k` casts — the untyped-read shape this seam uses. The
 * inline editor renders `LookupField` (receiver `fieldMeta`) and `UserField`
 * (receiver `meta`), which use optional-chained member reads.
 *
 * ⚠️ Those two are swept, and they are NOT fed this bag — `renderCellEditor`
 * spreads the schema def into them directly (objectui#7154, measured in
 * `lookupPickerKeys-7154.test.tsx`). objectui#7187 stopped taking that on
 * trust: `CONSUMERS_FED_THIS_BAG` is checked against `ObjectGrid.tsx`'s own
 * `renderCellEditor`, which must spread the schema def and must never name
 * `fieldMeta`.
 *
 * ⚠️ `UserField` is swept even though it forwards its whole meta into
 * `LookupField` via a spread. A delegating consumer is exactly where a false
 * zero hides: a key it read and did NOT forward would be invisible in
 * `LookupField`'s own source. Its extracted set being a subset is a RESULT
 * here, not an assumption — and under the split it is asserted as one, since
 * dropping `UserField` because "it forwards anyway" is precisely the assumption
 * that would hide such a key.
 *
 * ## ⛔ The extractor is bounded, and says so
 *
 * It reads member accesses off named receivers — the receiver itself and every
 * ANNOTATED ALIAS of it, `const NAME: TYPE = receiver;`, which is the same
 * object read through a declared type (objectui#6153 introduced the first one:
 * `LookupField`'s `cascadeMeta`, the `LookupFieldMetadata` view of `fieldMeta`
 * through which `dependsOn` is read; a consumer that
 * de-casts a read this way has not stopped reading, and a scanner that could
 * not see it would have reported two real reads as orphans). Aliases are
 * derived from the consumer's own source on every run, never listed here. A key
 * that reaches a consumer some other way — destructuring, a computed
 * `meta[expr]`, a helper that takes the whole bag — is outside its reach. That
 * is the honest limit; the five spellings objectui#6875 measured were all plain
 * member reads, and so is every key the three chains use today.
 * `assertExtractorFoundKnownChains` is the positive control that keeps a
 * silently-empty extraction from reading as a clean bill of health, and the
 * alias CONTROL below keeps the alias rule from reaching further than it says.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { FieldSchema } from '@objectstack/spec/data';

import {
  RELATIONAL_META_READ_SET,
  RELATIONAL_META_KEYS,
  CONSUMERS_FED_THIS_BAG,
  type RelationalMetaConsumer,
} from '../relationalMetaKeys';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIELDS_SRC = path.resolve(HERE, '../../../fields/src');
const GRID_SRC = path.resolve(HERE, '..');

function read(rel: string): string {
  return readFileSync(path.join(FIELDS_SRC, rel), 'utf8');
}

/** The source file each consumer id is extracted from, for failure messages. */
const CONSUMER_SOURCE: Readonly<Record<RelationalMetaConsumer, string>> = {
  cell: 'fields/src/index.tsx#LookupCellRenderer',
  'lookup-editor': 'fields/src/widgets/LookupField.tsx',
  'user-editor': 'fields/src/widgets/UserField.tsx',
};

const CONSUMERS = Object.keys(CONSUMER_SOURCE) as RelationalMetaConsumer[];

/**
 * The body of `LookupCellRenderer`, bounded by its declaration and the first
 * column-0 `}` after it. Bounding matters: `fields/src/index.tsx` holds every
 * cell renderer, and the unrelated ones read `field.min`, `field.pattern`,
 * `field.required_message` and friends off the same identifier.
 */
function lookupCellRendererBody(): string {
  const src = read('index.tsx');
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith('export function LookupCellRenderer('));
  if (start < 0) throw new Error('LookupCellRenderer declaration not found — extractor is stale');
  const end = lines.findIndex((l, i) => i > start && l === '}');
  if (end < 0) throw new Error('LookupCellRenderer end brace not found — extractor is stale');
  return lines.slice(start, end + 1).join('\n');
}

/**
 * The `renderCellEditor` property of the `DataTable` props `ObjectGrid` builds,
 * bounded by its own line and the next property at the same indentation. This
 * is the seam the whole cell/editor split rests on, so it is measured here
 * rather than asserted in a docblock.
 */
function renderCellEditorProperty(): string {
  const lines = readFileSync(path.join(GRID_SRC, 'ObjectGrid.tsx'), 'utf8').split('\n');
  const starts = lines
    .map((l, i) => (l.startsWith('    renderCellEditor:') ? i : -1))
    .filter((i) => i >= 0);
  if (starts.length !== 1) {
    throw new Error(`expected exactly 1 renderCellEditor property, found ${starts.length} — extractor is stale`);
  }
  const start = starts[0];
  const end = lines.findIndex((l, i) => i > start && /^ {4}[A-Za-z_$][\w$]*[:(]/.test(l));
  if (end < 0) throw new Error('renderCellEditor end not found — extractor is stale');
  return lines.slice(start, end).join('\n');
}

/**
 * The receiver plus every annotated alias of it declared in `src` —
 * `const NAME: TYPE = receiver;` (the annotation is optional to the regex, so a
 * bare `const NAME = receiver;` counts too). An alias is the SAME object read
 * through a declared type (objectui#6153: `cascadeMeta` is `fieldMeta` typed as
 * `LookupFieldMetadata`), so its member reads are the receiver's member reads.
 * Only whole-object aliases qualify: `const x = receiver.key;` is a read of
 * `key`, not a new receiver, and the trailing `;` anchor is what excludes it.
 */
function receiverAliases(src: string, receiver: string): string[] {
  const names = [receiver];
  const re = new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=;]+)?=\\s*${receiver}\\s*;`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

/** `recv?.key` / `recv.key` member reads off one named receiver and its annotated aliases. */
function memberReads(src: string, receiver: string): Set<string> {
  const out = new Set<string>();
  for (const recv of receiverAliases(src, receiver)) {
    const re = new RegExp(`\\b${recv}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.add(m[1]);
  }
  return out;
}

/** `(recv as { key?: T }).key` cast reads — how `LookupCellRenderer` reads. */
function castReads(src: string, receiver: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`\\(\\s*${receiver}\\s+as\\s+\\{\\s*([A-Za-z_$][\\w$]*)\\s*\\??:`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

type Extraction = Readonly<Record<RelationalMetaConsumer, Set<string>>>;

function extractReadSet(): Extraction {
  return {
    cell: castReads(lookupCellRendererBody(), 'field'),
    'lookup-editor': memberReads(read('widgets/LookupField.tsx'), 'fieldMeta'),
    'user-editor': memberReads(read('widgets/UserField.tsx'), 'meta'),
  };
}

/** The keys the table declares for one consumer, sorted. */
function declaredReaders(consumer: RelationalMetaConsumer): string[] {
  return Object.entries(RELATIONAL_META_READ_SET)
    .filter(([, e]) => e.readers.includes(consumer))
    .map(([k]) => k)
    .sort();
}

/**
 * Positive control. An extractor that silently matched nothing would make every
 * "no unclassified key" assertion below pass vacuously — the classic shape of a
 * green gate over an empty measurement. These five spellings are quoted from
 * the three consumers by hand; if the extractor stops finding them it is broken,
 * whatever the copy set says.
 */
function assertExtractorFoundKnownChains(x: Extraction): void {
  // ⭐ objectui#7155 retired the snake_case lookup dialect, so the cell's own
  // chain is no longer a two-spelling pair. The control keeps its SHAPE — a
  // consumer whose reads include both a camel and a snake spelling — by moving
  // to `lookup-editor`. ⛔ Never weaken this to camel-only: the extractor's job
  // is to see every spelling a consumer reads, and a control that only ever
  // looks for the surviving dialect cannot detect an extractor that stopped
  // seeing the other one.
  //
  // ⭐ objectui#12157 retired the `lookup_columns` leg the pair used to stand
  // on, so the pair moved to `avatar_field` / `avatarField`, which that card
  // did NOT touch. A move, not a weakening: both spellings are still required.
  expect(x.cell).toContain('displayField');
  // objectui#11070 round 4: the cell reads the target as `reference` alone.
  expect(x.cell).toContain('reference');
  expect(x['lookup-editor']).toContain('avatar_field');
  expect(x['lookup-editor']).toContain('avatarField');
  // The declared spelling of the retired pair is still read — the half of the
  // old control that did not move.
  expect(x['lookup-editor']).toContain('lookupColumns');
  // objectui#6153: this one is read through the ANNOTATED ALIAS `cascadeMeta`
  // (`const cascadeMeta: LookupFieldMetadata | undefined = fieldMeta;`), not off
  // `fieldMeta` directly. An extractor that stopped following aliases would drop
  // it, and the orphan assertion below would then call a real read stale.
  // ⭐ objectui#7357 removed the `depends_on` line that stood beside it. That
  // was a DELETION, not a weakening: the snake arm it controlled for is gone
  // from `LookupField`, so keeping the line would have pinned a read that no
  // longer happens. The two-spelling SHAPE this control needs is unaffected —
  // it lives on the pair above (`avatar_field` / `avatarField` since
  // objectui#12157).
  expect(x['lookup-editor']).toContain('dependsOn');
  expect(x['user-editor']).toContain('reference_field');
}

const specProps = new Set(Object.keys((FieldSchema as any).shape));

describe('objectui#6875 — the copy set is derived from the consumers, not restated', () => {
  it('the extractor follows an annotated alias of the receiver, and nothing else (CONTROL)', () => {
    const fixture = [
      'const view: SomeType | undefined = fieldMeta;',
      'const bare = fieldMeta;',
      'const notAnAlias = fieldMeta.picked;',
      'const other: SomeType = someoneElse;',
      'view?.viaAnnotated; bare.viaBare; other?.notOurs; someoneElse.notOurs2;',
      'fieldMeta?.direct;',
    ].join('\n');
    expect(receiverAliases(fixture, 'fieldMeta')).toEqual(['fieldMeta', 'view', 'bare']);
    const reads = memberReads(fixture, 'fieldMeta');
    // Reached: the direct read, the reads through both alias forms, and the
    // member the non-alias line reads off the receiver itself.
    expect([...reads].sort()).toEqual(['direct', 'picked', 'viaAnnotated', 'viaBare']);
    // Not reached: a different receiver, and a name that only LOOKS like an
    // alias because it was initialised from a member read.
    expect(reads.has('notOurs')).toBe(false);
    expect(reads.has('notOurs2')).toBe(false);
    // The real consumer declares exactly two aliases today; a third one is a
    // new fact about the seam, not a silent widening of this sweep.
    // objectui#12242 added `pickerConfig`, the `Pick<FormField, …>` view of
    // `fieldMeta` through which `idField` / `picker` / `subtitle` are read
    // since the field metadata types stopped declaring them.
    expect(receiverAliases(read('widgets/LookupField.tsx'), 'fieldMeta')).toEqual(['fieldMeta', 'pickerConfig', 'cascadeMeta']);
    expect(receiverAliases(read('widgets/UserField.tsx'), 'meta')).toEqual(['meta']);
  });

  it('the extractor reaches all three consumers (CONTROL)', () => {
    const x = extractReadSet();
    assertExtractorFoundKnownChains(x);
    // Every consumer contributes; a zero from any one of them is a broken sweep,
    // not a consumer that reads nothing.
    for (const consumer of CONSUMERS) {
      expect(x[consumer].size, `${CONSUMER_SOURCE[consumer]} contributed no reads`).toBeGreaterThan(0);
    }
  });

  it('classifies every key each consumer reads — no unclassified spelling', () => {
    const x = extractReadSet();
    for (const consumer of CONSUMERS) {
      const unclassified = [...x[consumer]].filter(
        (k) => !(k in RELATIONAL_META_READ_SET) || !RELATIONAL_META_READ_SET[k].readers.includes(consumer),
      ).sort();
      expect(
        unclassified,
        `${CONSUMER_SOURCE[consumer]} reads these off the field meta and the table does not record `
          + `it as a reader of them. Add each to RELATIONAL_META_READ_SET with a verdict, or add `
          + `'${consumer}' to its \`readers\` — that decision is the fix objectui#6875 exists to `
          + 'make unforgettable, and objectui#7187 the reason it has to be made per consumer.',
      ).toEqual([]);
    }
  });

  it('carries no orphan — every declared reader is still a real read', () => {
    const x = extractReadSet();
    for (const consumer of CONSUMERS) {
      const orphans = declaredReaders(consumer).filter((k) => !x[consumer].has(k));
      expect(
        orphans,
        `The table says ${CONSUMER_SOURCE[consumer]} reads these and it does not any more. A key `
          + 'written from the schema def on every column build and read by nothing is what '
          + 'objectui#6711 and objectui#6874 retired — and a stale reader entry is how a key '
          + 'keeps a copy licence it has stopped earning.',
      ).toEqual([]);
    }
  });

  it('⭐ objectui#7187 — only the CELL is fed this bag, measured on ObjectGrid.tsx', () => {
    expect(CONSUMERS_FED_THIS_BAG).toEqual(['cell']);
    const body = renderCellEditorProperty();
    // Controls first: these three prove the bounded region is the real editor
    // seam. Without them the zero below could come from an empty slice.
    expect(body).toContain('...fieldDef');
    expect(body).toContain('objectSchema');
    expect(body).toContain('FieldEditWidget');
    // LIT CONTROL for the zero: the identifier IS all over this file, so the
    // instrument can see it. Only the editor seam is free of it.
    const wholeFile = readFileSync(path.join(GRID_SRC, 'ObjectGrid.tsx'), 'utf8');
    expect(wholeFile.split('fieldMeta').length - 1).toBeGreaterThan(10);
    expect(
      body.split('fieldMeta').length - 1,
      '`renderCellEditor` now names `fieldMeta`. If the inline editor is fed the copied bag after '
        + 'all, then the editor widgets ARE fed it, CONSUMERS_FED_THIS_BAG is wrong, and every '
        + 'copy verdict resting on "the editor gets it off the schema def" needs re-measuring.',
    ).toBe(0);
  });

  it('⭐ objectui#7187 — `UserField` forwards, and that is a RESULT, not an assumption', () => {
    const x = extractReadSet();
    // Control: both sides are populated, so the subset claim is a reading.
    expect(x['user-editor'].size).toBeGreaterThan(0);
    expect(x['lookup-editor'].size).toBeGreaterThan(0);
    const notForwarded = [...x['user-editor']].filter((k) => !x['lookup-editor'].has(k)).sort();
    expect(
      notForwarded,
      '`UserField` reads these off its meta and `LookupField` does not — so its whole-meta spread '
        + 'is no longer the reason it can be treated as a subset. Each needs classifying on its '
        + 'own; this is the false zero the sweep keeps `UserField` in scope to catch.',
    ).toEqual([]);
    // ⚠️ Subset or not, `UserField` is an EDITOR: it licenses no copy either way.
    expect(CONSUMERS_FED_THIS_BAG).not.toContain('user-editor');
    expect(CONSUMERS_FED_THIS_BAG).not.toContain('lookup-editor');
  });

  it('proves each `no-producer` verdict against the installed spec, not against prose', () => {
    const claimed = Object.entries(RELATIONAL_META_READ_SET)
      .filter(([, e]) => e.verdict === 'no-producer')
      .map(([k]) => k);
    expect(claimed.length).toBeGreaterThan(0);
    // Control first: the assertion below is "absent from a 71-prop strict
    // schema", and an empty/misresolved shape would satisfy it for every key.
    expect(specProps.size).toBeGreaterThan(60);
    expect(specProps.has('displayField')).toBe(true);
    for (const key of claimed) {
      expect(specProps.has(key), `${key} is classified no-producer but FieldSchema declares it`).toBe(false);
    }
  });

  it('proves each `spec` verdict against the installed spec', () => {
    for (const [key, e] of Object.entries(RELATIONAL_META_READ_SET)) {
      if (e.verdict !== 'spec') continue;
      expect(specProps.has(key), `${key} is classified spec but FieldSchema does not declare it`).toBe(true);
    }
  });

  it('proves the `widget-contract` verdict is exactly that — read, produced in-repo, and absent from the spec', () => {
    const claimed = Object.entries(RELATIONAL_META_READ_SET)
      .filter(([, e]) => e.verdict === 'widget-contract')
      .map(([k]) => k);
    // Control: the bucket is populated (objectui#7155 put `idField` in it), so
    // the assertions below are readings and not an empty loop.
    expect(claimed).toEqual(['idField']);
    expect(specProps.size).toBeGreaterThan(60);
    expect(specProps.has('displayField')).toBe(true);
    for (const key of claimed) {
      // If a future spec version declares one of these, it is no longer a
      // widget-contract key — reclassify it as `spec` rather than keeping a
      // second home for a spelling the object contract now owns.
      expect(
        specProps.has(key),
        `${key} is now declared on FieldSchema — reclassify it as 'spec'`,
      ).toBe(false);
    }
  });

  it('⭐ objectui#7187 — the copy set is exactly: producer-licensed AND read by a consumer fed this bag', () => {
    const cellRead = extractReadSet().cell;
    // Control: the sweep found the cell's chain, so "not read by the cell" below
    // is a measurement and not an empty extraction.
    expect(cellRead.has('displayField')).toBe(true);
    expect(cellRead.size).toBeGreaterThan(3);
    // ⭐ Derived from the EXTRACTED cell set, not from the table's own `readers`
    // — so this and `RELATIONAL_META_KEYS` reach the same list by two
    // independent routes, and a hand-edited `readers` cannot carry both.
    const expected = Object.entries(RELATIONAL_META_READ_SET)
      .filter(([key, e]) =>
        (e.verdict === 'spec' || e.verdict === 'widget-contract')
        && (cellRead.has(key) || e.copiedWithoutCellReader !== undefined))
      .map(([k]) => k);
    expect([...RELATIONAL_META_KEYS].sort()).toEqual(expected.sort());
    // objectui#6875 shipped three keys; ONE of them is genuinely delivered on
    // this bag, and it is the one that arrived with a rendering test.
    // `lookupDisplayFieldSpelling-6875.test.tsx` renders the difference it makes.
    expect(RELATIONAL_META_KEYS).toContain('displayField');
    // The two named keys that are NOT reachable stay out — copying them would
    // write a member no producer can fill (objectui#6711's reasoning).
    for (const key of ['reference_field', 'lookup_columns']) {
      expect(RELATIONAL_META_KEYS).not.toContain(key);
    }
  });

  it('⭐ objectui#7155 — the cell-reader rule has NO exit any more: the class it served is retired', () => {
    // objectui#7187 gave the exit to the `legacy-alias` keys, which were kept
    // on an UNANSWERED producer question. objectui#7155 answered it — the host
    // feeding snake_case was this repo's own widget contract and docs — and
    // converged both dialects on the spec spelling. So the exit is now unused.
    //
    // ⚠️ Control FIRST: the table is populated and the field is still
    // reachable, so "no entry takes the exit" is a measurement and not an
    // assertion over an empty or misresolved object.
    const entries = Object.entries(RELATIONAL_META_READ_SET);
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.some(([, e]) => 'copiedWithoutCellReader' in e || e.copiedWithoutCellReader === undefined)).toBe(true);

    const exits = entries.filter(([, e]) => e.copiedWithoutCellReader !== undefined).map(([k]) => k);
    expect(
      exits,
      'A key is copied onto this bag although no consumer fed it reads the key. That exit existed '
        + 'ONLY for the snake_case dialect objectui#7155 retired. Re-opening it needs a new ruling and '
        + 'a restatement of this gate — not a new flag.',
    ).toEqual([]);
  });

  it('⛔ objectui#7155 — the retired snake_case dialect reaches no consumer and no verdict', () => {
    const retiredDialect = ['display_field', 'description_field', 'lookup_filters', 'id_field'];
    const x = extractReadSet();
    // ⚠️ Control FIRST — this whole test is a set of ABSENCE claims, and an
    // extractor that found nothing would satisfy every one of them. These are
    // the surviving spellings of the very same four concepts.
    assertExtractorFoundKnownChains(x);
    for (const survivor of ['displayField', 'descriptionField', 'lookupFilters', 'idField']) {
      expect(
        survivor in RELATIONAL_META_READ_SET,
        `${survivor} is missing from the table — the control for this test is dark, so its absence `
          + 'claims below prove nothing.',
      ).toBe(true);
    }
    // The camel survivors ARE read: `displayField` by the cell, the other three
    // by the editor widgets that the schema spread feeds.
    expect(x.cell).toContain('displayField');
    expect(x['lookup-editor']).toContain('idField');

    for (const key of retiredDialect) {
      expect(key in RELATIONAL_META_READ_SET, `${key} is back on the table — the dialect is retired`).toBe(false);
      expect(RELATIONAL_META_KEYS, `${key} is back in the copy set`).not.toContain(key);
      for (const consumer of CONSUMERS) {
        expect(
          x[consumer].has(key),
          `${CONSUMER_SOURCE[consumer]} reads \`${key}\` again. objectui#7155 converged the widget `
            + 'contract on the spec spelling; re-adding the snake leg would restore the two-dialect seam '
            + 'and make an UNDECLARED key outrank a declared one.',
        ).toBe(false);
      }
    }
    // ⛔ And the verdict that licensed them is unrepresentable, not merely unused.
    expect(Object.values(RELATIONAL_META_READ_SET).map((e) => e.verdict)).not.toContain('legacy-alias');
  });

  it('⛔ objectui#7166 — the three retired keys stay OUT of the copy set, and objectui#7187 makes that DERIVED', () => {
    const retired = ['descriptionField', 'lookupColumns', 'lookupFilters'];
    // Control: the copy set is populated, so "not contained" is a reading.
    // objectui#7155 shrank it from 7 to 3 by retiring the snake_case dialect,
    // and objectui#11070 round 4 to 2 by retiring `reference_to`.
    expect(RELATIONAL_META_KEYS.length).toBeGreaterThan(1);
    expect(RELATIONAL_META_KEYS).toContain('reference');
    expect(RELATIONAL_META_KEYS).toContain('displayField');
    for (const key of retired) {
      expect(
        RELATIONAL_META_KEYS,
        `${key} is back on the copy set. objectui#7166 measured it having NO reader on this bag: `
          + 'its only reader is an editor widget, which `renderCellEditor` feeds from the schema '
          + 'def. Put it back and you write a member nothing on the cell path reads.',
      ).not.toContain(key);
    }

    // ⭐ WHAT CHANGED IN objectui#7187, and why this test is no longer the hold.
    // These three used to be absent from the copy set only because a verdict
    // said so, while every DERIVED assertion in this file passed whichever
    // verdict they carried — the union they sit in is read by the editor
    // widgets, and read-set membership never meant "this bag delivers it".
    // Now the fact that licenses a copy is the CELL's read set, and it does not
    // contain them. This test survives to name them in a regression, not to
    // carry the retirement alone.
    const cellRead = extractReadSet().cell;
    expect(cellRead.has('displayField')).toBe(true); // control: the cell sweep is lit
    for (const key of retired) {
      expect(
        cellRead.has(key),
        `${key} is now read by the CELL. Then it is a copy candidate again and objectui#7166's `
          + 'reader-side measurement is stale — re-measure before changing the verdict.',
      ).toBe(false);
      expect(
        RELATIONAL_META_READ_SET[key].readers,
        `${key} left the editor read set — then this pin is stale, not load-bearing`,
      ).not.toEqual([]);
    }
  });

  it('every entry carries a note — a verdict with no reason is not a decision', () => {
    for (const [key, e] of Object.entries(RELATIONAL_META_READ_SET)) {
      expect(e.note.length, `${key} has no note`).toBeGreaterThan(20);
    }
  });
});
