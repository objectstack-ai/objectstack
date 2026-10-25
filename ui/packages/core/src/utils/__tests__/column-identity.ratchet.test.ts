/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Ratchet — the column-identity dual read (`field` ?? `name`) may only shrink.
 *
 * objectui#3104. A column's identity used to be read in two incompatible
 * precedences across the repo, and the two halves landed on different fields
 * for the same column (see `ListView.columnIdentity.test.tsx` for the repro).
 *
 * **The family is now at zero** (PR2): every column-identity read goes through
 * `columnIdentity()`. What remains in the inventory below is the residue the
 * scanner still matches — reads that share the key names but not the concept.
 * They are listed, not converged, and each says why.
 *
 * This file freezes that state: a new dual read in a new file fails, and an
 * extra one in a listed file fails.
 *
 * Shrinking also fails, deliberately — lower the number here in the same commit
 * that removes the read, so the count in the tree and the count on record never
 * drift apart.
 *
 * If this fails because you added a read: don't. Call `columnIdentity()` from
 * `@object-ui/core` — it resolves canonical-first, so it agrees with the data
 * request instead of racing it. If you genuinely need a new one, add it here
 * WITH a verdict and say why in the PR.
 *
 * The scanner is a line-level heuristic, not a parser: an alternation chain
 * (`||` / `??`) mentioning two or more distinct identity keys as property
 * accesses. That is precise enough to ratchet and loose enough to catch
 * spellings nobody has written yet; it is NOT a judgement that every hit is a
 * defect, which is what `verdict` below records.
 *
 * ## Why this is the gate, and no `no-restricted-syntax` lint rule
 *
 * objectui#3104 PR3 asked for the eslint option to be evaluated on its
 * false-positive rate before adopting it. It was, and the answer is decisive:
 * with the family at zero, **all 11 remaining scanner hits are legitimate** —
 * two-layer joins where both precedences are correct, the form cluster #3090
 * settled the other way, and display fallbacks that merely share the key names.
 * A syntactic rule matching `.field ?? .name` cannot tell any of those from a
 * real dual read, because the distinction is what the keys MEAN in that layer,
 * not how the expression is spelled. Adopting it would mean 11 inline disables
 * on correct code — which trains the next author to reach for the disable, the
 * precise reflex that lets a real one through.
 *
 * The ratchet does what the lint rule cannot: it carries a `verdict` and a
 * `why` per site, so a new hit has to be triaged rather than silenced. The
 * assertion that the family is 0 (below) is exactly the statement that every
 * hit a lint rule would fire on today is a false positive.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** packages/core/src/utils/__tests__ → packages */
const packagesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Keys whose presence in an alternation chain makes it a column-identity read.
 * Two or more DISTINCT ones must appear for a line to count.
 */
const IDENTITY_KEYS = ['field', 'name', 'fieldName'] as const;

/**
 * Keys that count as further members of a chain that already qualifies, but
 * never qualify one on their own. `accessorKey` is TanStack Table's column key
 * and `key` is a generic entry key — neither is ObjectStack metadata identity,
 * and a chain built only from them is not this family.
 */
const COMPANION_KEYS = ['key', 'accessorKey'] as const;

const ACCESS = new RegExp(
  String.raw`(?:\?\.|\.)(${[...IDENTITY_KEYS, ...COMPANION_KEYS].join('|')})\b`,
  'g',
);
const ALTERNATION = /\|\||\?\?/;

type Verdict =
  /** Same concept, two spellings — the family this battle retires (PR2). */
  | 'column-identity'
  /**
   * Two LAYERS, not two spellings: both keys are declared, mean different
   * things, and both precedences are correct. Counted so the inventory is
   * honest and so these files cannot quietly grow a real dual read, but they
   * are NOT convergence targets.
   */
  | 'two-layer'
  /** The form-field cluster — a separate battle, settled the other way (#3090). */
  | 'form-cluster'
  /** Not an identity read at all (a join, or an unrelated fallback). */
  | 'unrelated';

interface Entry {
  count: number;
  /** Which key wins, for the reads that are a column identity. */
  order?: 'field-first' | 'name-first' | 'adapter-first';
  verdict: Verdict;
  why: string;
}

/**
 * The inventory, as of objectui#3104 PR2.
 *
 * The column-identity family is EMPTY: all 22 reads now go through
 * `columnIdentity()`. What is left below matched the scanner but was never the
 * same concept — two-layer joins where both precedences are correct, the form
 * cluster that #3090 settled the other way, and generic display fallbacks that
 * merely share the key names. They stay listed so the scanner cannot quietly
 * grow a real dual read inside a file we already decided about.
 *
 * PR1 recorded 24 family members; two of those were mis-triaged and are
 * reclassified here after reading what they actually feed:
 *  - `ViewPreview.tsx` converts a ViewItem FORM section into `object-form`'s
 *    runtime shape (`field` -> `name`) — the #3090 two-layer join, not a column.
 *  - `SchemaForm.tsx` renders an arbitrary metadata ARRAY into a summary string
 *    and guesses at a display key; the entries are validations/actions/whatever
 *    the JSON schema declares, so there is no column vocabulary to converge.
 */
const INVENTORY: Record<string, Entry> = {
  // ── the column-identity family: EMPTY (was 24 in PR1; 22 after re-triage) ──

  // ── two layers, not two spellings (6) ────────────────────────────────────
  // Moved from `app-shell/src/utils/` by objectui#12105 so the bulk dialog
  // reads the same resolver; its two named readers are unchanged.
  'fields/src/resolveActionParams.ts': {
    count: 2,
    verdict: 'two-layer',
    why: 'BOTH orders appear here and both are right: `field ?? name` picks the key to read off the ROW (row data is keyed by object field), `name ?? field` names the PARAM in the action payload, defaulting to the field it binds. Two concepts, not two spellings. Lowered 3 -> 2 in objectui#3174: each order is now exactly ONE named reader (`rowValueKey` / `paramName`) that every call site in the file goes through, so the count is the number of CONCEPTS here rather than the number of times they were open-coded. Deliberately NOT converged onto `columnIdentity()`: that reader is canonical-first because a column IS the object field it shows, whereas a param merely BINDS one, so borrowing it would invert the param-name precedence and rename every field-backed param that also names itself.',
  },
  'core/src/utils/dashboard-filters.ts': {
    count: 1,
    verdict: 'two-layer',
    why: '`DashboardFilterDef` declares both: `name` is the filter variable\'s handle, `field` is the object field it targets. `name || field` defaults an unnamed filter\'s handle to its field — a derivation, not a dual read.',
  },
  'app-shell/src/views/metadata-admin/previews/ActionPreview.tsx': {
    count: 1,
    verdict: 'two-layer',
    why: 'Action param name, same layering as resolveActionParams.',
  },
  'core/src/utils/predicate-fields.ts': {
    count: 2,
    verdict: 'two-layer',
    why: 'BOTH halves of resolveActionParams\' pair, each mirrored on purpose. `defaultFromRowKey` (objectui#10277) names the row key a `defaultFromRow` param seeds from, so the `$select` harvest can ask for it: `field ?? name`, because row data is keyed by object field, the precedence `rowValueKey` reads. `undoableWrittenKeys` (objectui#10404) names the key a param\'s collected value is WRITTEN under, whose prior value the Undo capture then looks up on the row: `name ?? field`, the precedence `paramName` reads. Two concepts, as in the file they mirror. Deliberately NOT `columnIdentity()`: that reader also accepts `fieldName` and treats an empty string as absent, so it would harvest keys the runtime never looks up.',
  },

  // ── the form cluster — settled the other way (#3090) (2) ─────────────────
  // `plugin-form/src/ObjectForm.tsx` left this list in objectui#10475: its one
  // read was `SimpleObjectForm`'s own section-entry join (`field ?? name`),
  // deleted when that arm moved onto `buildSectionFields`, so the scanner no
  // longer matches the file and it is no longer residue.
  'plugin-form/src/sectionFields.ts': {
    count: 1,
    verdict: 'form-cluster',
    why: 'The #3090 hub itself. #3090 established that spec FormField (`field`) and runtime FormField (`name`) are two LAYERS, and since objectui#10475 this file is the only place every `object-form` arm joins them (`sectionEntryName`, `normalizeSectionField`), the default arm included. Those spell the join as separate `typeof` tests, which the scanner does not match; the one line it does match is `warnOnMixedVocabulary`\'s guard, which compares the two keys to warn when an authored entry carries both.',
  },
  'app-shell/src/views/metadata-admin/previews/ViewPreview.tsx': {
    count: 1,
    verdict: 'form-cluster',
    why: 'Re-triaged in PR2: `toFormFieldEntry` adapts a ViewItem FORM section to what `object-form` selects by (`name`), which is the #3090 join — not a list column. Converging it onto `columnIdentity` would be a category error.',
  },

  // ── not identity reads (3) ───────────────────────────────────────────────
  'app-shell/src/views/metadata-admin/widgets.tsx': {
    count: 1,
    verdict: 'unrelated',
    why: '`fields.find(f => f.name === r.field)` — a join between a field list and a rule\'s field reference, matched only because both keys share a line.',
  },
  'plugin-chatbot/src/ChatbotEnhanced.tsx': {
    count: 1,
    verdict: 'unrelated',
    why: '`c.object ?? c.name` — a citation label fallback that happens to sit on a line mentioning `c.field`.',
  },
  'app-shell/src/views/metadata-admin/SchemaForm.tsx': {
    count: 1,
    verdict: 'unrelated',
    why: 'Re-triaged in PR2: `summariseComposite` renders ANY composite/array metadata value into a popover summary and guesses at a display key. The array items are whatever the JSON schema declares, so this is a display fallback over arbitrary objects, not a column read.',
  },
};

function collectSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec|d)\.tsx?$/.test(name)) out.push(full);
    }
  };
  for (const pkg of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const src = path.join(packagesRoot, pkg.name, 'src');
    try {
      walk(src);
    } catch {
      // A package without a `src` directory — nothing to scan.
    }
  }
  return out;
}

/** `{ 'pkg/src/File.tsx': ['pkg/src/File.tsx:12 :: <line>'] }` */
function scan(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of collectSourceFiles()) {
    const rel = path.relative(packagesRoot, file).split(path.sep).join('/');
    const src = readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!ALTERNATION.test(line)) return;
      const keys = [...line.matchAll(ACCESS)].map((m) => m[1] as string);
      const distinct = new Set(keys.filter((k) => (IDENTITY_KEYS as readonly string[]).includes(k)));
      if (distinct.size < 2) return;
      const list = found.get(rel) ?? [];
      list.push(`${rel}:${i + 1} :: ${line.trim().slice(0, 120)}`);
      found.set(rel, list);
    });
  }
  return found;
}

const sum = (pick: (e: Entry) => boolean) =>
  Object.values(INVENTORY).filter(pick).reduce((n, e) => n + e.count, 0);

describe('column identity dual-read ratchet (#3104)', () => {
  it('scans a plausible number of package source files (guards a broken scan path)', () => {
    expect(collectSourceFiles().length).toBeGreaterThan(500);
  });

  it('finds no dual read in a file the inventory does not list', () => {
    const unlisted = [...scan().entries()]
      .filter(([file]) => !(file in INVENTORY))
      .flatMap(([, lines]) => lines);
    // If this fails: read `columnIdentity()` from `@object-ui/core` instead of
    // spelling out another `field ?? name`. That is the whole point of #3104.
    expect(unlisted).toEqual([]);
  });

  it('matches the recorded count in every listed file', () => {
    const found = scan();
    const drift: string[] = [];
    for (const [file, entry] of Object.entries(INVENTORY)) {
      const actual = found.get(file)?.length ?? 0;
      if (actual === entry.count) continue;
      drift.push(
        actual > entry.count
          ? `${file}: ${actual} dual reads, inventory says ${entry.count} — converge it onto columnIdentity() instead of adding another.`
          : `${file}: ${actual} dual reads, inventory says ${entry.count} — good news; lower the count in this file to match.`,
      );
    }
    expect(drift).toEqual([]);
  });

  it('holds the family at zero', () => {
    // This is the number the battle was about, and it is done. The remaining
    // verdicts are inventory, not worklist: `two-layer` and `form-cluster` are
    // settled decisions, and `unrelated` is scanner residue recorded so it
    // cannot hide a real one.
    expect(sum((e) => e.verdict === 'column-identity')).toBe(0);
    // 12 at #3104 PR2; 11 since objectui#3174 routed `resolveActionParams`'
    // two orders through one named reader each; 12 again since objectui#10277
    // mirrored that file's row-key reader into the `$select` harvest; 13 since
    // objectui#10404 mirrored its param-name reader there too; 12 since
    // objectui#10475 deleted `ObjectForm.tsx`'s section-entry join; 11 since
    // objectui#12105 retired plugin-grid's hand-mapped `toBulkParam`, whose
    // param-name read now comes from the shared resolver's `paramName`.
    expect(sum(() => true)).toBe(11);
  });

  it('records a precedence for every read left in the family', () => {
    const missing = Object.entries(INVENTORY)
      .filter(([, e]) => e.verdict === 'column-identity' && !e.order)
      .map(([file]) => file);
    expect(missing).toEqual([]);
  });

  it('routes every converged surface through the one reader', () => {
    // The counterpart to "the family is zero": the reads did not vanish, they
    // moved onto `columnIdentity`. If a surface silently dropped its identity
    // resolution instead of converging it, this goes red.
    const CONVERGED = [
      'core/src/utils/expand-fields.ts',
      'plugin-list/src/ListView.tsx',
      'plugin-grid/src/ObjectGrid.tsx',
      'plugin-detail/src/RelatedList.tsx',
      'plugin-detail/src/renderers/record-details.tsx',
      'plugin-detail/src/renderers/record-related-list.tsx',
      'plugin-tree/src/ObjectTree.tsx',
    ];
    const missing = CONVERGED.filter((rel) => {
      const src = readFileSync(path.join(packagesRoot, rel), 'utf8');
      return !/\bcolumnIdentity\s*\(/.test(src);
    });
    expect(missing).toEqual([]);
  });

  it('keeps the table-adapter key ahead of metadata identity in RelatedList', () => {
    // A source-level pin, and labelled as one: RelatedList's columns can arrive
    // in TanStack's shape (`accessorKey`) or ObjectStack's (`field`). The
    // convergence replaced only the `field || name` tail — if `accessorKey`
    // ever loses its precedence here, imported TanStack columns stop resolving
    // and every cell in them goes blank.
    const src = readFileSync(
      path.join(packagesRoot, 'plugin-detail/src/RelatedList.tsx'),
      'utf8',
    );
    const identityReads = [...src.matchAll(/\bcolumnIdentity\s*\(/g)].length;
    const adapterFirst = [...src.matchAll(/accessorKey\s*\|\|\s*columnIdentity\s*\(/g)].length;
    expect(identityReads).toBeGreaterThan(0);
    expect(adapterFirst).toBe(identityReads);
  });
});
