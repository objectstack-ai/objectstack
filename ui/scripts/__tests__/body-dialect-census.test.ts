/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins for `scripts/body-dialect-census.mjs` (objectui#6771, ruling step 1).
 *
 * Two things are pinned here, and they fail for different reasons:
 *
 * 1. **The instrument.** Every assertion in the first block corresponds to a
 *    bug the first draft of the census actually had, and each one failed the
 *    same way: it returned a SILENT ZERO with exit 0. A census that reads zero
 *    because it is blind is indistinguishable from a corpus that is clean —
 *    which is the exact failure mode the card's own history is made of.
 *
 * 2. **The population.** The `body`-only key list is read back off the renderer
 *    sources, so it cannot go stale the way the card body's "10" did. If
 *    someone teaches `badge` to read `children`, or adds a `sidebar-*`
 *    registration, this goes red rather than the census quietly measuring the
 *    wrong set.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  census,
  scanNodes,
  keepFencedCodeOnly,
  mayHoldWantedNode,
  resolvePopulation,
  parseKeys,
  finalVerdict,
  ALL_KEYS,
  KNOWN_LIMITS,
  EXIT_UNREADABLE,
  BODY_ONLY,
  RULED_BUT_NOT_A_READER,
  BODY_ONLY_UNRULED,
} from '../body-dialect-census.mjs';
import { scan, producersOf, unchannelledOf } from '../body-dialect-producer-scan.mjs';

const REPO_ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

/**
 * `read`, with whole-line comments removed.
 *
 * ⚠️ Measured, not hypothetical. `providers/SchemaValidator.ts` documents its
 * child-list arm by QUOTING `schema.children || schema.body` in a comment
 * directly above the line that implements it. A plain `toContain` over the raw
 * file therefore stayed green with that implementation ablated away — the
 * assertion was passing off the prose, which is the phantom-check shape this
 * file's own neighbours warn about: an assertion that cannot fail is not a pin.
 *
 * Only WHOLE-LINE comments are stripped, so a `//` inside a string survives —
 * a URL, or the preview provider's inlined webview script, both of which appear
 * in the files these blocks read.
 */
const readCode = (p: string) =>
  read(p)
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');

const keysOf = (text: string, type: string) => {
  const node = scanNodes(text).find((n: { type: string }) => n.type === type);
  return node ? [...(node.keys as Set<string>)] : null;
};

describe('the scanner sees the shapes authored metadata actually uses', () => {
  it('reads QUOTED keys — the JSON corpus is the whole point', () => {
    // REGRESSION: the first draft consumed a quoted key as a string value
    // before ever testing it as a key, because the string branch ran first.
    // JSON spells every key quoted, so the entire `.json` corpus — including
    // the four authored sidebar fixtures that turned out to hold 56 of the 56
    // `body` nodes in this repo — read as ZERO. Exit 0, no error, no hint.
    expect(keysOf('{"type": "badge", "body": []}', 'badge')).toEqual(['type', 'body']);
    expect(keysOf("{ type: 'badge', body: [] }", 'badge')).toEqual(['type', 'body']);
  });

  it('attributes a child key to the node that owns it, not to an ancestor', () => {
    // `body` two levels down belongs to the inner node. Without this, one
    // authored `body` would score against every enclosing node as well.
    const text = '{"type":"card","children":[{"type":"badge","body":[]}]}';
    expect(keysOf(text, 'card')).toEqual(['type', 'children']);
    expect(keysOf(text, 'badge')).toEqual(['type', 'body']);
  });

  it('does NOT score a key that only appears in a comment — prose is not a call site', () => {
    expect(scanNodes("// a node written { type: 'badge', body: [] }\n")).toEqual([]);
    expect(scanNodes("/* { type: 'badge', body: [] } */")).toEqual([]);
  });

  it('survives a regex literal after `=>`, which otherwise blinds the rest of the file', () => {
    // REGRESSION: `/^ {3}\S.*\(type "/` in a real test file was not recognised
    // as a regex because `>` was missing from the "value position" set. Its `{`
    // opened a phantom object frame and its lone `"` opened a runaway string,
    // so every node AFTER it vanished — the file scored 0 of its 3 nodes.
    const text = String.raw`
      const f = (l) => /^ {3}\S.*\(type "/.test(l);
      const node = { type: 'badge', body: [] };
    `;
    expect(keysOf(text, 'badge')).toEqual(['type', 'body']);
  });

  it('keeps Markdown fenced code and drops Markdown prose', () => {
    // REGRESSION: a ```json fence is THREE backticks. The scanner treats a
    // backtick as a template-literal delimiter, so the first two paired off and
    // the third swallowed the whole snippet — EVERY doc example read as zero.
    // That population is not incidental: ruling step 5 migrates the teaching
    // corpus in the same commit.
    const md = ['Prose mentioning `type: "badge"` inline.', '', '```json', '{ "type": "badge", "body": [] }', '```', ''].join('\n');
    const kept = keepFencedCodeOnly(md);
    expect(keysOf(kept, 'badge')).toEqual(['type', 'body']);
    // …and the prose mention is gone, not counted.
    expect(kept).not.toContain('Prose mentioning');
    // Line numbers survive the blanking, so reported positions stay true.
    expect(kept.split('\n').length).toBe(md.split('\n').length);
  });

  it('CONTROL — a corpus-shaped input returns hits, so a zero elsewhere is readable', () => {
    // Without this, every "0" in the census is indistinguishable from a
    // scanner that resolved nothing at all.
    //
    // ⚠️ RE-POINTED at `children` by objectui#6771. This file was the densest
    // `body` corpus in the tree — 14 nodes — and the retirement migrated it, so
    // a `body` control here now measures the migration instead of the scanner.
    // The control's job is unchanged: prove the scanner resolves NODES and
    // their child key on a real corpus file, so a zero read somewhere else is a
    // reading rather than a blind walk.
    const nodes = scanNodes(read('examples/schema-catalog/src/schemas/components-basic-sidebar/basic-sidebar.json'));
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.filter((n: { keys: Set<string> }) => n.keys.has('children')).length).toBeGreaterThan(0);
    // And the retired spelling is gone from it, which is the migration half.
    expect(nodes.filter((n: { keys: Set<string> }) => n.keys.has('body')).length).toBe(0);
  });

  it('the pre-filter admits every `type` spelling the scanner counts (objectui#13210)', () => {
    // `census()` skips `scanNodes` for a text `mayHoldWantedNode` refuses, so
    // the predicate must be a SUPERSET of the scanner: one that narrows it is
    // a silent zero with exit 0, which is this block's subject. Each text is a
    // shape the scanner counts as a population node — checked first, so the
    // predicate is tested against the scanner and not against this list.
    const keys = ['badge', 'sidebar-menu-item', 'x+y'];
    const mayHold = mayHoldWantedNode(keys);
    const fenced = ['Prose.', '', '```json', '{ "type": "badge", "children": [] }', '```', ''].join('\n');
    for (const text of [
      '{"type": "badge", "children": []}',
      "{ type: 'badge', children: [] }",
      `{ 'type' : "badge" }`,
      '{ type:\n    "badge" }',
      '{ "type": "sidebar-menu-item" }',
      // A `--keys` name with a regex metacharacter: unescaped, `x+y` would
      // match "xy" and never the literal "x+y".
      '{ "type": "x+y" }',
      keepFencedCodeOnly(fenced),
    ]) {
      expect(scanNodes(text).some((n: { type: string }) => keys.includes(n.type)), text).toBe(true);
      expect(mayHold.test(text), text).toBe(true);
    }
    // …and the skip is real: no `type` value from the population, no parse.
    expect(mayHold.test('{"type": "object", "properties": {"badge": {}}}')).toBe(false);
    expect(mayHoldWantedNode([]).test('{"type": "badge"}')).toBe(false);
  });
});

describe('the measured population is read off the renderers, not off the card body', () => {
  const sidebarSrc = () => read('packages/components/src/renderers/navigation/sidebar.tsx');

  it('`BODY_ONLY` is 12 keys — the ruled 13 minus `sidebar-trigger`', () => {
    // The card body says 10 and the ruling's step 2 repeats it; the census pin
    // in `container-declaration-ratchet.test.tsx` says 13. Both are counts of
    // slightly different things. What the retirement actually costs is measured
    // per RENDERER READ, and that set is 12.
    expect(BODY_ONLY.length).toBe(12);
    expect(BODY_ONLY).toContain('badge');
    expect(BODY_ONLY).toContain('alert');
    // The bare family name is present. A `sidebar-[a-z-]+` pattern REQUIRES a
    // suffix and silently drops it — the original miscount, recorded on the
    // card 2026-08-29, and the census query has the same shape.
    expect(BODY_ONLY).toContain('sidebar');
    expect(BODY_ONLY.filter((k) => k.startsWith('sidebar')).length).toBe(10);
  });

  it('`badge` and `alert` read `children` and never `body` — CONVERGED by objectui#6771', () => {
    // ⚠️ INVERTED. This pin held the ground the whole census rested on: these
    // two rendered `renderChildren(schema.body)` and never touched
    // `schema.children`, which is what made `body` their ONLY door and made
    // retiring it a reject-direction change on published contract. The ruling
    // was executed; the door is `children` now, and the reading the census
    // produced is what cleared it (`badge` and `alert` carried ZERO authored
    // `body` in both populations, so the published cost measured zero).
    for (const [file, type] of [
      ['packages/components/src/renderers/data-display/badge.tsx', 'badge'],
      ['packages/components/src/renderers/data-display/alert.tsx', 'alert'],
    ] as const) {
      const src = read(file);
      expect(src, `${type} does not read schema.children`).toContain('renderChildren(schema.children)');
      expect(src, `${type} still reads the retired schema.body`).not.toContain('schema.body');
    }
  });

  it('`sidebar-trigger` is ruled but reads NO child list, so retirement costs it nothing', () => {
    expect(RULED_BUT_NOT_A_READER).toEqual(['sidebar-trigger']);
    // ⚠️ 2026-10-02: the source half of this pin read a family that no longer
    // exists. It held that `sidebar-trigger` was registered, that the file
    // carried 11 `sidebar*` registrations, and that ten of them read the child
    // list. objectui#10859 batch 8 phase 2d retired the ten `sidebar-*` part
    // keys (`sidebar-trigger` among them), so the population above stays what
    // the census LOOKS AT — past tense, see the census script — and what is
    // pinned today is the one registration left: `sidebar`, which reads
    // `children` and never `body`.
    const src = sidebarSrc();
    expect(src.match(/ComponentRegistry\.register\('sidebar/g)?.length).toBe(1);
    expect(src).toContain("ComponentRegistry.register('sidebar', ");
    expect(src).not.toContain("register('sidebar-");
    expect(src.match(/renderChildren\(schema\.children\)/g)?.length).toBe(1);
    expect(src.match(/renderChildren\(schema\.body\)/g)?.length ?? 0).toBe(0);
  });

  it('⚠️ `tooltip` was the `body`-only reader the ruled 13 omitted — and it converged with the rest', () => {
    // ⚠️ INVERTED, and this one was a SCOPE call before it was an edit. The
    // census measured `tooltip` rendering `renderChildren(schema.body)` and
    // never `schema.children` — a `body`-only reader absent from the ruling's
    // step 2 list — and, decisively, the ONE registration in the tree that
    // DECLARED `body` as an authorable input, which made it the most
    // discoverable spelling of the dialect on the whole authoring surface.
    // Seat 1 read the ruling rather than filing for it (2026-09-17) and triage
    // recorded the answer as already given: step 2's two clauses leave no third
    // class, so `tooltip` is IN. It is, and its declared input moved too — the
    // half that would otherwise have left the dialect advertised.
    expect(BODY_ONLY_UNRULED).toEqual(['tooltip']);
    const src = read('packages/components/src/renderers/overlay/tooltip.tsx');
    expect(src).toContain('renderChildren(schema.children)');
    expect(src).not.toContain('schema.body');
    expect(src).toMatch(/name:\s*'children'/);
    expect(src).not.toMatch(/name:\s*'body'/);
  });

  it('the two published keys are exactly `badge` and `alert`', () => {
    // ADR-0080's allow-list. Retiring `body` on these two is a reject-direction
    // change on PUBLISHED contract; on the 11 bare `sidebar-*` it is internal.
    // `PUBLIC_BLOCKS` carries the namespaced `page:sidebar`, a different type —
    // so grepping the list for "sidebar" would wrongly score the bare family.
    const src = read('packages/core/src/registry/public-blocks.ts');
    expect(src).toMatch(/^\s*'badge',$/m);
    expect(src).toMatch(/^\s*'alert',$/m);
    expect(src).toMatch(/^\s*'page:sidebar',$/m);
    for (const key of BODY_ONLY.filter((k) => k.startsWith('sidebar'))) {
      expect(src, `bare \`${key}\` became public — the census cost split changed`).not.toMatch(
        new RegExp(`^\\s*'${key}',$`, 'm'),
      );
    }
  });
});

describe('the census stays re-runnable', () => {
  it('is wired into the root package.json, like every other script here', () => {
    // A census that gates a multi-day retirement has to be repeatable after the
    // next corpus change, by someone who was not here. Same convention as the
    // `check:*` gates: the entry point is pinned, not just documented.
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['census:body-dialect']).toBe('node scripts/body-dialect-census.mjs');
  });
});

describe('the `body` consumers the ruling does not enumerate', () => {
  it('three generic readers outside the renderer tree read `children` ALONE — step 2 reached them', () => {
    // Recorded because ruling steps 2-5 name renderers, the published type and
    // the tier — and these three are none of those. They read `body` for ANY
    // node type, so they outlive the per-registration convergence and would
    // keep the dialect alive after step 2 lands.
    //
    // ⚠️ The three were NOT alike, and the difference decided objectui#7181.
    // Core has always been `children`-first, so it degrades gracefully. The two
    // vscode readers guarded on `schema.body` ALONE — they did not resolve
    // `children` at all — so they did not merely keep the old dialect alive,
    // they BLOCKED the producers from moving: a `children`-spelled document
    // rendered blank and had its children skipped by validation, silently.
    // objectui#7181 converged both onto the core spelling, adding the
    // `children` arm and KEEPING `body`. Nothing was retired; that is step 2.
    //
    // ⇒ all three then read the same way, and the `body` arm surviving in each
    // was the half that said step 2 was still outstanding.
    //
    // ⚠️ INVERTED — step 2 landed (objectui#6771). These three are the reason
    // the block exists: a per-registration convergence would have left them
    // resolving `body` for ANY node type and the dialect alive underneath it,
    // so the retirement is only real if all three dropped the arm. Both vscode
    // readers even deferred it to that card BY NUMBER in their own comments.
    // The lit control stays FIRST, because "does not contain `body`" holds just
    // as well over a file that was renamed, emptied or moved.
    for (const reader of [
      'packages/core/src/validation/schema-validator.ts',
      'packages/vscode-extension/src/providers/SchemaValidator.ts',
      'packages/vscode-extension/src/providers/PreviewProvider.ts',
    ]) {
      const text = readCode(reader);
      expect(text, `${reader} — lit control: this reader still resolves a child list`)
        .toMatch(/=\s*schema\.children;/);
      expect(text, `${reader} still resolves the retired \`body\``)
        .not.toContain('schema.children || schema.body');
    }
  });

  it('the platform SHIPS the dialect it is being asked to refuse', () => {
    // The sharpest census finding, and the claim is UNCHANGED for the second
    // time: ruling step 5's principle is that "the platform never refuses a
    // spelling it still ships", so step 4 (tier teaches `children` only) cannot
    // land while any PRODUCER still emits `body` into metadata a user then owns.
    //
    // What moves each round is the SUBJECT, never the claim. objectui#7181
    // migrated the six producers its table named — `objectui init`, the VS Code
    // extension's new-file templates, the three `defaultProps` registrations
    // and the runner's fallback page. objectui#9847 migrated the SEVENTH that
    // table never listed: `generatePage` in
    // `packages/cli/src/commands/generate.ts`, which scaffolded a
    // `pages/NAME.json` whose child list was spelled `body`.
    //
    // ⛔ Deliberately NOT inverted into "the producers now carry `children`".
    // That would assert the migrating branch's own diff back at itself and
    // discard the ordering rationale this block exists to carry — refused by
    // objectui#7181's repair round, and refused again by objectui#9847's.
    const migrated = [
      'packages/cli/src/commands/init.ts',
      'packages/cli/src/commands/generate.ts',
      'packages/vscode-extension/src/extension.ts',
      'packages/components/src/renderers/complex/carousel.tsx',
      'packages/components/src/renderers/complex/resizable.tsx',
      'packages/components/src/renderers/complex/scroll-area.tsx',
      // packages/runner/src/App.tsx left this list: objectui#11450 deleted the runner's fallback page, so that producer is gone.
    ];

    for (const producer of migrated) {
      const text = readCode(producer);
      // Lit control first: without a child list present at all, the absence
      // assertion beside it would hold over an empty or unreadable file.
      expect(text, producer).toContain('children:');
      expect(text, producer).not.toContain('body:');
    }

    // ⭐ What objectui#9847 established, taken from the instrument rather than
    // from its own diff: across the whole tree the census now reaches NO
    // `body`-spelled child list in its `app-metadata` bucket — the bucket that
    // holds shipped source. Asserted as a population, so a producer arriving in
    // a file nobody listed reds this without anyone extending the list above.
    const { filesScanned, hits } = census(REPO_ROOT);
    const carryingBody = hits.filter((hit: { body: boolean }) => hit.body);

    // Two lit controls, because a blind walk satisfies the zero below on its
    // own — this file's first block exists for that exact failure.
    expect(filesScanned, 'the census walked nothing').toBeGreaterThan(0);
    expect(
      carryingBody.length,
      'the census reaches no `body` node ANYWHERE — it has gone blind, or the ' +
        'teaching corpus and example apps that ruling step 5 migrates are gone'
    ).toBeGreaterThan(0);

    expect(
      carryingBody
        .filter((hit: { bucket: string }) => hit.bucket === 'app-metadata')
        .map((hit: { file: string; line: number }) => `${hit.file.split('\\').join('/')}:${hit.line}`)
    ).toEqual([]);

    // ⛔ That zero is NOT the answer to "is step 4 landable", and reading it as
    // one is the trap this half exists to close. The census states its own
    // limits and TWO of them CAN hide a producer: it scores a child list only on
    // an object that also carries a string-LITERAL `type` (a `tabs` ITEM carries
    // `label`/`value`/`body` and no `type`), and it never reads inside a string
    // or a template literal (a VS Code completion snippet is a string).
    //
    // ⚠️ PAST-TENSED where objectui#9871 wrote that both still DO. Only the
    // first still hides a live producer. The second's only subjects were the
    // `CompletionProvider` snippets, and objectui#6771 step 5 migrated them —
    // which is the B2 inversion below, measured rather than assumed. The limit
    // itself is unchanged and still structural; what emptied is its occupancy.
    //
    // ⭐ objectui#9871 REPLACED the enumeration that used to stand here. Two
    // named sites were an enumeration with the census's blind spots written
    // into it by hand — the next producer in a third blind direction would have
    // needed somebody to notice it and add a line. The subject is now DERIVED:
    // `scripts/body-dialect-producer-scan.mjs` states a CRITERION (C1 emission
    // · C2 resolution · C3 carrier) and this block reads its table.
    //
    // ⭐ When the table empties, THAT is the handoff, and the message on the
    // assertion says so in these terms. ⚠️ CORRECTED where objectui#9871 wrote
    // "the day step 4 becomes landable": step 4 lands in objectui#6771 with this
    // table NON-empty, and measurement is why. The tier refuses `body` inside
    // `Object.entries(node)` on a node whose `type` resolves to a registration;
    // every site left in the table is carried on a `tabs` ITEM, which is the
    // value of a declared `items` input and never a node in that walk. Probed
    // rather than reasoned, both legs, against the built parser: a `card` node
    // carrying `body` draws `unknown-prop: <card> has no prop "body" — the
    // child-list key is "children"`, and a `tabs` item carrying the same key
    // draws ZERO diagnostics.
    //
    // ⭐ RE-POINTED at objectui#9941, ⛔ not deleted — the assertion below
    // carried its own instruction to do exactly that, in these terms. The table
    // emptied when the three `tabs.tsx` `defaultProps` items were respelled to
    // `content`, the key `TabItemSchema` declares required while declaring no
    // `body`: ⛔ a CONFORMANCE fix, ⛔ not a dialect migration.
    //
    // ⭐ And the re-pointed claim is SCOPED: the table is empty **under
    // objectui#9871's EMISSION criterion**. ⛔ It is NOT a claim that the
    // dialect has left the tree, and ⛔ NOT objectui#9590's finish line.
    // Measured across the same change: `failedC2` held at 313 and
    // `unclassified` at 5, so 318 rows outside what that criterion scores as
    // emission did not move — and objectui#9989 is a published doc still
    // TEACHING the spelling. ⭐ Emitted and taught are different verbs, and this
    // scan reads only the first. Whether the finish line is reached is
    // objectui#9590's to judge on its own record.
    const producerScan = scan(REPO_ROOT);

    // Two lit controls, because an empty table is the assertion's own shape: a
    // scan that walked nothing, or derived no reader, would satisfy a bare
    // "non-empty" check by accident in neither direction — so both are checked
    // before the table is read at all.
    expect(producerScan.filesScanned, 'the producer scan walked nothing').toBeGreaterThan(0);
    expect(
      producerScan.readers.reads.length,
      'the producer scan derived NO reader, so C2 would fail for every site'
    ).toBeGreaterThan(0);

    const producers = producersOf(producerScan.hits, producerScan.readers);
    expect(
      producers.length,
      'a producer is BACK — shipped source emits the dialect again under objectui#9871\'s ' +
        'EMISSION criterion, and it has not since objectui#9941. ⛔ Do not relax this to a ' +
        'range: name the site and its carrier, and re-read the criterion before deciding ' +
        'what a non-zero means here.'
    ).toBe(0);

    // ⭐ The two SHAPES the census structurally cannot reach, asserted as
    // shapes rather than as paths: a producer arriving in a file nobody has
    // named joins `producers` with no list to extend — that property is what
    // this block holds, and it is unaffected by the occupancy being zero.
    //
    // ⚠️ B1's LIVE occupancy went to zero at objectui#9941; the three `tabs.tsx`
    // `defaultProps` items were its last subjects. ⭐ The SHAPE is ⛔ not
    // unreachable and this block is ⛔ not blind:
    // `scripts/__tests__/body-dialect-producer-scan.test.ts`'s DIFFERENTIAL test
    // plants `ITEM_PRODUCER` in a synthetic root and still asserts carrier
    // ['item'], line 6, channel 'default-props' — it passed in the same run that
    // first reported this red. That fixture is what makes standing down the
    // live-tree control here safe rather than blind.
    expect(
      producers.filter((hit: { carrier: string }) => hit.carrier === 'item').length,
      'an item-carried producer is BACK — the B1 shape (a `body` on an object with no `type`) ' +
        'is live in shipped source again. ⛔ Not a licence to relax this; name the site.'
    ).toBe(0);
    // ⚠️ B2 IS INVERTED BY THIS CARD, and the inversion is what the merge with
    // `main` actually found rather than a tidy-up. objectui#9871 asserted a
    // string-carried producer EXISTED, and its only subjects were the three VS
    // Code completion snippets in `CompletionProvider.ts` — which objectui#6771
    // step 5 migrated. The two changes were written without knowledge of each
    // other and landed on DISJOINT files, so the text merged clean and this
    // assertion is the one place they actually meet. ⛔ Not deleted, per
    // objectui#9871's own instruction: re-pointed, with the reason named.
    //
    // ⭐ THE ZERO NEEDS A LIT CONTROL OR IT IS A BLIND WALK, and the control is
    // in TWO parts, because `source !== 'code-key'` is a conjunction of two
    // independent capabilities and a single control would leave one untested:
    //   - B2 reads inside literals AT ALL — `scanSource`'s literal projection
    //     still resolves the key in strings and templates somewhere in the tree;
    //   - a literal-carried hit still PASSES C2 — some derived reader resolves
    //     it into a child list, so the zero below is about C1 EMISSION alone.
    // Without both, `toBe(0)` would hold just as well over a scan that had gone
    // blind to literals — the exact failure objectui#9871 built B2 to end.
    const literalCarried = producerScan.hits.filter(
      (hit: { source: string }) => hit.source !== 'code-key'
    );
    expect(
      literalCarried.length,
      'lit control — the scan resolved NO literal-carried `body` anywhere, so B2 has gone blind ' +
        'and the zero below would be measuring the instrument rather than the tree'
    ).toBeGreaterThan(0);
    expect(
      unchannelledOf(producerScan.hits, producerScan.readers).filter(
        (hit: { source: string }) => hit.source !== 'code-key'
      ).length,
      'lit control — no literal-carried hit passes C2 any more, so the zero below would be ' +
        'measuring C2 rather than the emission channel it claims to measure'
    ).toBeGreaterThan(0);

    // ⇒ AND THE READING ITSELF, with both controls lit: no literal-carried site
    // reaches an emission channel. The B2 shape is REACHABLE and UNOCCUPIED —
    // which is a different sentence from the one objectui#9871 could write, and
    // only this merge could have produced it.
    expect(
      producers.filter((hit: { source: string }) => hit.source !== 'code-key').length,
      'a string-carried producer is BACK — objectui#6771 step 5 migrated the last of them ' +
        '(the `CompletionProvider` snippets). A new one means a tool started writing the retired ' +
        'spelling into an author document again; ⛔ do not relax this to a range.'
    ).toBe(0);

    // ⭐ THE SUBJECT THAT ZERO IS ABOUT, pinned BY NAME — because a shape
    // assertion cannot say WHICH site left, and naming it is the handoff
    // objectui#9871's prose asks for. A completion snippet is the most direct
    // form a producer takes: it is inserted into the author's own document the
    // moment the completion is accepted, so the author never types the spelling.
    // The lit control stays and stays FIRST: "does not contain" is satisfied by
    // a file that was renamed, emptied or moved.
    const completion = readCode('packages/vscode-extension/src/providers/CompletionProvider.ts');
    expect(completion, 'lit control — the snippet table is being read at all').toContain(
      '"className": "$1"'
    );
    expect(completion).not.toContain('"body": {');
    expect(completion).toContain('"children": {');

    // ⭐ And the family question is RULED — it no longer stays open in the
    // instrument, and ⛔ nothing here awaits a seat. Director seat, summon #25
    // class-1 item 2, LETTER C, on objectui#9871 (2026-09-20): an item-carried
    // `body` is ⛔ not inside objectui#6771's ruled family and ⛔ not a second
    // family — it is a producer violating the ITEM'S OWN published schema
    // (`TabItemSchema` declares `content` and declares no `body`), fixed at the
    // producer (done: objectui#9941). ⚠️ What did ⛔ NOT change is the
    // arithmetic: such a site is still never folded into objectui#6771's ruled
    // total, and objectui#6771 step 4's landability is judged on the NODE FACE
    // ONLY.
    //
    // ⭐ AND THE CLAIM IN THIS TEST'S NAME, restated in the terms BOTH
    // instruments now agree on — which is the other half of what this merge
    // found. What used to ship the spelling was the `tabs` ITEM, and that is a
    // DIFFERENT KEY from the one step 4 refuses (measured above the scan call,
    // both legs). objectui#9871 reaches the same disposition from its own side
    // and files those sites `ruled:not-a-dialect/item-schema-violation` — ⛔ not
    // objectui#6771's ruled family. ⇒ the consumer-side retirement and the
    // producer-side scan do not contradict each other on the substance; they
    // disagreed on ONE liveness assertion, B2's, and that is re-pointed above
    // rather than deleted.
    // ⇒ step 4 refuses nothing the platform still ships, which is exactly what
    // step 5's ordering rule asks. The item-face sites themselves are recorded
    // on objectui#9590, ⛔ neither refused nor migrated here — ⛔ and, under the
    // ruling above, ⛔ not as a dialect. ⚠️ That card's BODY names only `list`'s
    // `items[].body`; `tabs` items and the `dashboard` widget key are recorded
    // on it by comment 5733850974, so this pointer resolves to a record that
    // actually carries the two shapes named here.
    // ⚠️ Dated note, 2026-09-25 — all three subjects have since moved, and the
    // pointer above is scoped to when it was written. objectui#9590 retired both
    // item READS (`list.tsx` and `tabs.tsx` draw `content` only) and made both
    // item faces refuse `body` by name; the `dashboard` widget key stopped being
    // taught under objectui#8290. ⇒ the live tree derives NO item reader, so an
    // item-carried `body` now fails C2 here and the item-carried assertions in
    // this block are vacuous for that second reason too; the planted
    // DIFFERENTIAL fixture is what keeps the shape reachable — objectui#9590.
    // ⚠️ VACUOUS SINCE objectui#9941 — the item-carried set is EMPTY, so this
    // loop body never runs and asserts nothing. Kept, ⛔ not deleted: it is the
    // disposition claim that fires the moment an item-carried producer returns.
    for (const hit of producers.filter((h: { carrier: string }) => h.carrier === 'item')) {
      expect(hit.disposition).toBe('ruled:not-a-dialect/item-schema-violation');
    }
    // ⏱ Explicit, because this block runs TWO tree-wide instruments and the
    // default 15s is not enough on a loaded shard: objectui#9871 measured the
    // CI runner at least 1.9x slower than a local run of this same block. A scan
    // that stops terminating still fails. ⛔ Not a global `testTimeout` bump.
    //
    // ⚠️ objectui#13210: the coverage lane timed this block out at 60s, on and
    // off, once the pinned `@objectstack` build appeared in `.objectstack-pin/`
    // and both walks read it. Fixed at the COST and ⛔ not by raising this
    // number: the walks skip that directory, and the census parses only a text
    // that can hold a counted node — the hit set outside the pin unchanged,
    // compared by digest on that card's pull request, which also carries the
    // before/after times. ⛔ They are not copied here (AGENTS.md #9): this file
    // under `pnpm exec vitest run --coverage --reporter=verbose` prints this
    // block's own ms.
  }, 60_000);
});

/**
 * The census walk does not descend into `.objectui-tmp` (objectui#9201).
 *
 * This walk starts at `--root` (default the repo root) and descends
 * dot-directories — it reports hits inside `.changeset/`, which is how the
 * reach was measured rather than assumed. `.objectui-tmp` is the CLI test's
 * LIVE scratch directory: a generated app is mkdtemp'd under it and removed in
 * a `finally`, so anything found there is tooling output that exists for the
 * span of one test, never corpus. Same class as `test-results` and
 * `playwright-report`, which this skip list already carries.
 *
 * ⚠️ Two-sided on purpose. The same bytes are planted twice, and the lit half
 * is not decoration: a census that walked NOTHING would satisfy the exclusion
 * assertion on its own, and a silent zero with exit 0 is the exact failure
 * this file's first block was written against.
 */
describe('the census skips `.objectui-tmp` (objectui#9201)', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const NODE = JSON.stringify({ type: 'page', body: [{ type: 'text', text: 'x' }] }, null, 2) + '\n';

  it('finds a planted node in a scanned directory and NOT the same bytes under `.objectui-tmp/`', () => {
    const root = mkdtempSync(join(tmpdir(), 'body-dialect-census-9201-'));
    roots.push(root);
    for (const rel of ['packages/scanned-control/page.json', '.objectui-tmp/tsc-gate-0000-AAAAAA/page.json']) {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, NODE);
    }

    const files = census(root).hits.map((hit) => hit.file.split('\\').join('/'));

    // Lit control — without this the assertion below passes on an empty walk.
    expect(files).toContain('packages/scanned-control/page.json');
    expect(files.some((file) => file.startsWith('.objectui-tmp/'))).toBe(false);
  });
});

/**
 * Neither instrument walks `.objectstack-pin` (objectui#13210).
 *
 * `.objectstack-pin/NAME/` is where `scripts/objectstack-pin.mjs build` links
 * the pinned `@objectstack/*` build beside the committed manifest: git-ignored,
 * present only after a build, and another repository's packed output. Walking
 * it summed objectstack's population into this one and pushed the in-tree pin
 * above to its 60s budget under coverage. Two-sided for the same reason as the
 * block above, once per instrument.
 */
describe('the census and the producer scan skip `.objectstack-pin` (objectui#13210)', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it('finds planted nodes under `packages/` and NOT the same bytes under `.objectstack-pin/`', () => {
    const root = mkdtempSync(join(tmpdir(), 'body-dialect-census-13210-'));
    roots.push(root);
    const NODE_JSON = JSON.stringify({ type: 'page', body: [{ type: 'text', text: 'x' }] }, null, 2) + '\n';
    const NODE_TS = "export const node = { type: 'page', body: [{ type: 'text', text: 'x' }] };\n";
    for (const dir of ['packages/scanned-control', '.objectstack-pin/spec/src']) {
      for (const [name, bytes] of [['page.json', NODE_JSON], ['node.ts', NODE_TS]]) {
        const full = join(root, dir, name);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, bytes);
      }
    }
    const posix = (file: string) => file.split('\\').join('/');
    const censusFiles = census(root).hits.map((hit) => posix(hit.file));
    const scanFiles = scan(root).hits.map((hit: { file: string }) => posix(hit.file));

    // Lit controls — an empty walk satisfies each exclusion on its own.
    expect(censusFiles).toContain('packages/scanned-control/page.json');
    expect(scanFiles).toContain('packages/scanned-control/node.ts');
    expect(censusFiles.some((file) => file.startsWith('.objectstack-pin/'))).toBe(false);
    expect(scanFiles.some((file) => file.startsWith('.objectstack-pin/'))).toBe(false);
  });
});

/**
 * A zero names the population it was taken over (objectui#9545).
 *
 * The defect: the scan filtered every node against a hard-coded name set and
 * threw the set away before printing, so `hits: 0` for a name OUTSIDE it was
 * indistinguishable from a real zero. It was hit for real — a
 * breaking-change census over six narrowed names read zero from this tool, and
 * the only way to take the real reading was to patch the name list in a
 * scratchpad copy of the script.
 *
 * ⚠️ Every assertion below is two-sided, for the same reason the first
 * block of this file is: an instrument that resolved NOTHING satisfies a bare
 * "reads 0" assertion on its own. The lit half is not decoration.
 */
describe('the population travels with the reading (objectui#9545)', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  /** A corpus with one IN-population node and one OUT-of-population node. */
  const plantedRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'body-dialect-census-9545-'));
    roots.push(root);
    const full = join(root, 'packages/planted/page.json');
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(
      full,
      JSON.stringify({ type: 'page', body: [{ type: 'text', body: [] }] }, null, 2) + '\n',
    );
    return root;
  };

  it('DIFFERENTIAL — the same bytes read 0 or non-zero depending only on the population', () => {
    const root = plantedRoot();

    const dflt = census(root);
    const inPopulation = dflt.hits.filter((h: { type: string }) => h.type === 'page');
    const outOfPopulation = dflt.hits.filter((h: { type: string }) => h.type === 'text');
    // Lit control: the walk resolved something, so the zero below is about the
    // population and not about a blind instrument.
    expect(inPopulation.length).toBeGreaterThan(0);
    expect(outOfPopulation.length).toBe(0);

    // Same root, same bytes, population named explicitly — the "zero" was an artifact.
    const asked = census(root, { keys: ['text', 'page'] });
    expect(asked.hits.filter((h: { type: string }) => h.type === 'text').length).toBeGreaterThan(0);
    expect(asked.hits.filter((h: { type: string }) => h.type === 'page').length).toBe(inPopulation.length);
  });

  it('the reading CARRIES the key set it was taken over, so the zero is readable', () => {
    const root = plantedRoot();
    const dflt = census(root);
    expect(dflt.population.keySource).toBe('default');
    expect(dflt.population.keys).toEqual([...ALL_KEYS].sort());
    // The fact a reader of the zero above needs, present in the payload itself.
    expect(dflt.population.keys).not.toContain('text');
    expect(dflt.population.keys).toContain('page');

    const asked = census(root, { keys: ['text', 'page'] });
    expect(asked.population.keySource).toBe('--keys');
    expect(asked.population.keys).toEqual(['page', 'text']);
  });

  it('names keys with no renderer evidence rather than REFUSING them', () => {
    // The card offered "exit non-zero on a name outside the list" as an option.
    // Refusing would delete the measurement this card was filed over: the six
    // narrowed names are deliberately NOT reader keys and asking about them is
    // the legitimate question. So an unknown key is NAMED, not refused.
    const p = resolvePopulation(['text', 'badge']);
    expect(p.unknownKeys).toEqual(['text']);
    expect(finalVerdict({ population: p, filesScanned: 1 }).exit).toBe(0);
    // Lit control — a key with renderer evidence is not named as unknown.
    expect(resolvePopulation(['badge']).unknownKeys).toEqual([]);
  });

  it('`--keys` with a missing value REFUSES rather than silently using the default set', () => {
    // The defect one level up: answering a question about one key set with a
    // count taken over a different one. `undefined` (flag absent) and `[]`
    // (flag present, value missing) must not collapse.
    expect(parseKeys(['--root', '.'])).toBeUndefined();
    expect(parseKeys(['--keys', '--json'])).toEqual([]);
    expect(parseKeys(['--keys', 'text,image', '--keys', 'icon'])).toEqual(['text', 'image', 'icon']);
    expect(parseKeys(['--keys', ' text , image '])).toEqual(['text', 'image']);
  });

  it('refuses the two zeros that naming the population cannot make readable', () => {
    const empty = finalVerdict({ population: resolvePopulation([]), filesScanned: 99 });
    expect(empty.exit).toBe(EXIT_UNREADABLE);
    expect(empty.refusal?.join(' ')).toContain('Empty key population');

    const blind = finalVerdict({ population: resolvePopulation(undefined), filesScanned: 0 });
    expect(blind.exit).toBe(EXIT_UNREADABLE);
    expect(blind.refusal?.join(' ')).toContain('Zero files scanned');

    // Lit control, and the point of the whole card: a REAL zero over a real
    // population on a real corpus is a legitimate reading and is NOT refused.
    const honest = finalVerdict({ population: resolvePopulation(['text']), filesScanned: 99 });
    expect(honest.exit).toBe(0);
    expect(honest.refusal).toBeNull();
  });

  it('the header\'s "stated so a zero is readable" promise is EMITTED, not just written', () => {
    // The limits are one declaration, emitted by the run. A prose list beside a
    // machine-maintained one is how the key-population limit came to be missing
    // from the header in the first place.
    const ids = KNOWN_LIMITS.map((l: { id: string }) => l.id);
    expect(ids).toContain('key-population');
    expect(new Set(ids).size).toBe(ids.length);
    for (const limit of KNOWN_LIMITS) expect(limit.what.length).toBeGreaterThan(0);
    expect(resolvePopulation(undefined).notScanned).toBe(KNOWN_LIMITS);

    // The old prose bullets named a `--group` flag this script has never had.
    const src = read('scripts/body-dialect-census.mjs');
    expect(src, 'the header names a flag that does not exist').not.toContain('--group');
  });

  it('CLI — the payload always carries the population, and a refusal reaches the exit code', () => {
    const script = join(REPO_ROOT, 'scripts', 'body-dialect-census.mjs');
    const run = (args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

    // Lit control: a real run exits 0 and its payload names the population.
    const ok = run(['--root', plantedRoot(), '--json']);
    expect(ok.status).toBe(0);
    const payload = JSON.parse(ok.stdout) as {
      population: { keys: string[]; notScanned: Array<{ id: string }> };
      hits: unknown[];
    };
    expect(payload.population.keys.length).toBeGreaterThan(0);
    expect(payload.population.notScanned.map((l) => l.id)).toContain('key-population');

    // ⭐ There is no spelling of this payload that reports `hits` without
    // reporting what `hits` was counted over: no flag suppresses it.
    expect(Object.keys(payload)).toContain('population');

    // A blind walk exits non-zero with nothing on stdout, where it used to
    // print a full table of confident zeros and exit 0.
    const blind = run(['--root', join(REPO_ROOT, 'no-such-directory-9545'), '--json']);
    expect(blind.status).toBe(EXIT_UNREADABLE);
    expect(blind.stdout).toBe('');
    expect(blind.stderr).toContain('Zero files scanned');
  });
});
