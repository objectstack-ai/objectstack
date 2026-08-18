// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6856, reworded #9529] Class pin: every `os migrate meta --from <N>`
 * prescription sentence in `packages/spec/src` is the house sentence, whether
 * the backing ADR-0087 conversion STRIPS the key or REWRITES the value
 * (maintainer-ruled route D, 2026-08-09; reworded by maintainer ruling
 * 2026-08-18):
 *
 *     Run `os migrate meta --from <N>` to list the mechanical edits for
 *     existing sources; apply them by hand.
 *
 * The sentence states a property of the TOOL, never the fate of the key — the
 * retired "rewrite it" spelling was misread over strip conversions because
 * "it" has two antecedents (the key vs your sources), and the key's fate is
 * the body prose's job ("Delete the key…", "Rename the key to…").
 *
 * [#9529] It must also be TRUE of the tool, which is why the wording moved off
 * "rewrite existing sources automatically": `os migrate meta` replays the chain
 * in memory and prints the attributed mechanical change list; the only file it
 * writes is the `--out` JSON snapshot. It has never written an authored source
 * file, so 90-odd shipped prescriptions promised an affordance that did not
 * exist. This pin therefore holds BOTH directions — the new sentence is
 * required where a prescription names the command, and the withdrawn claim is
 * a hard RED wherever it reappears. Full rule: `shared/retired-key.ts` module
 * docblock. (When #9591's in-place codemod lands, the claim may be restored —
 * by editing this pin in the same PR, never by exempting a site.)
 *
 * ONE allowed variant, by SHAPE and never by site (#6935's no-allowlist
 * discipline): a conversion that covers only PART of the value keeps the
 * two-clause form naming which part —
 * "… to list the mechanical edits for the <X> case; <what the tool does with
 * the rest>." (`ui/dashboard.zod.ts` `compareTo.offset` is the model; the
 * script node's `config.actionType` is the other member.)
 *
 * [#7030] Widened, not duplicated: `packages/lint/src/validate-expressions.ts`
 * carries one live occurrence of the identical sentence (the lint diagnostic
 * for a script node's retired dispatch keys — same #6856 ruling, same
 * false-antecedent risk, since that branch too can DELETE the key rather than
 * rewrite it into anything). `judgeMigrateSentences` is a plain text scan with
 * no dependency on `retiredKey()` or on anything `packages/spec`-specific, so
 * this pin's INPUT (the CORPORA it walks) widens for free — the matching
 * mechanism below is unchanged. A second, standalone pin over that one lint
 * site could only drift from this one the moment either wording changes;
 * one pin covering both corpora cannot.
 *
 * Mechanism: a SOURCE scan over string literals (this pin pins textual facts —
 * the sentences ARE text in source). Comment lines are skipped: descriptive
 * prose about the tool ("`os migrate meta` rewrites sources") is not a
 * prescription. `migrations/registry.ts` is out of scope structurally — it is
 * the migration LEDGER, whose `notes` are release prose over whole migrations,
 * not tombstone prescriptions an author meets in a parse error. That is a
 * scope bound on the spec corpus, not a per-site exemption: every
 * prescription string in every scanned file is judged, with no allowlist.
 *
 * What this pin deliberately does NOT check: a tombstone whose prescription
 * carries no `os migrate meta` sentence at all (#6914's worklist) — absence of
 * the marker means nothing is judged. The floor assertion below only guards
 * the scanner itself against going blind.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC_SRC_ROOT = path.resolve(HERE, '..');
/** #7030: `packages/lint/src`, the one other corpus carrying this sentence. */
const LINT_SRC_ROOT = path.resolve(HERE, '../../../lint/src');

/** One scanned corpus: a root directory, plus its own out-of-scope exemptions. */
interface Corpus {
  /** Short label, used as the `file` prefix on judged sites (e.g. `spec:`, `lint:`). */
  name: string;
  root: string;
  /** Paths relative to `root` that are structurally out of scope (see module doc). */
  outOfScope: Set<string>;
}

const CORPORA: Corpus[] = [
  {
    name: 'spec',
    root: SPEC_SRC_ROOT,
    // The migration ledger — release prose, not tombstone prescriptions (see module doc).
    outOfScope: new Set([path.join('migrations', 'registry.ts')]),
  },
  {
    // #7030: `validate-expressions.ts`'s script-node lint diagnostic is the only site.
    name: 'lint',
    root: LINT_SRC_ROOT,
    outOfScope: new Set(),
  },
];

const MARKER = /(?:Run )?`os migrate meta --from \d+`/g;

/**
 * House form, anchored at the marker: the sentence must be the LAST sentence
 * of its string literal (the char after the final period is the closing
 * quote), so a prescription cannot bury the command mid-prose either.
 */
const HOUSE_AT_MARKER =
  /^Run `os migrate meta --from \d+` to list the mechanical edits for existing sources; apply them by hand\.['"]/;

/**
 * MIXED two-clause shape: clause one names the part of the value the chain
 * covers mechanically, clause two says what it does with the rest. Shape, not
 * sites.
 */
const MIXED_AT_MARKER =
  /^Run `os migrate meta --from \d+` to list the mechanical edits for the [^;'"]+ case[^;'"]*; [^;'"]+\.['"]/;

/**
 * [#9529] The withdrawn claim, in every spelling the sweep found. Judged over
 * the SAME reconstructed text as the house form, but as a hard RED wherever it
 * appears — a site reverting to it fails even if it never names `--from <N>`
 * (three enum-value prescriptions spell the bare command).
 */
const WITHDRAWN_CLAIM =
  /to rewrite (?:existing sources|it) automatically|rewrites (?:it for you|existing sources|author(?:ed)? sources|your sources?|your source files?)/g;

interface JudgedSite {
  /** Corpus-prefixed path, e.g. `spec:data/object.zod.ts` or `lint:validate-expressions.ts`. */
  file: string;
  /** 1-based line of the sentence's marker (best effort across concatenation). */
  line: number;
  /** The sentence tail from the marker (for the failure message). */
  excerpt: string;
  ok: boolean;
}

/**
 * Reconstruct judgeable text from one source file: drop comment lines, then
 * merge string-concatenation seams (`'…' + '…'`, same line or across lines,
 * single or double quotes) so a sentence split across literals is judged
 * whole. `segments` maps an offset in the merged text back to a source line.
 */
function reconstruct(raw: string): { merged: string; segments: Array<{ start: number; line: number }> } {
  const kept: Array<{ text: string; line: number }> = [];
  raw.split('\n').forEach((text, i) => {
    const t = text.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
    kept.push({ text, line: i + 1 });
  });

  let merged = '';
  const segments: Array<{ start: number; line: number }> = [];
  for (const k of kept) {
    // Same-line concatenation seam: '…' + '…' (either quote on either side).
    let lineText = k.text.replace(/['"]\s*\+\s*['"]/g, '');
    // Cross-line seam: previous line ended a literal, this one reopens it.
    const reopen = /^\s*\+\s*['"]/.exec(lineText);
    if (reopen && /['"]\s*$/.test(merged)) {
      merged = merged.replace(/['"]\s*$/, '');
      lineText = lineText.slice(reopen[0].length);
    }
    segments.push({ start: merged.length, line: k.line });
    merged += `${lineText}\n`;
  }
  return { merged, segments };
}

const lineAt = (segments: Array<{ start: number; line: number }>, at: number): number => {
  let line = 0;
  for (const seg of segments) {
    if (seg.start > at) break;
    line = seg.line;
  }
  return line;
};

/** Every `os migrate meta --from <N>` prescription in one file, with its verdict. */
export function judgeMigrateSentences(raw: string, file = '<inline>'): JudgedSite[] {
  const { merged, segments } = reconstruct(raw);
  const judged: JudgedSite[] = [];
  for (const m of merged.matchAll(MARKER)) {
    const at = m.index ?? 0;
    const rest = merged.slice(at);
    const ok = HOUSE_AT_MARKER.test(rest) || MIXED_AT_MARKER.test(rest);
    judged.push({
      file, line: lineAt(segments, at), excerpt: rest.slice(0, 120).replace(/\n/g, ' '), ok,
    });
  }
  return judged;
}

/**
 * [#9529] Every occurrence of the WITHDRAWN automatic-rewrite claim in one
 * file's prescription text. Separate from `judgeMigrateSentences` on purpose:
 * the claim is red wherever it appears, not only where it closes a sentence
 * that names `--from <N>`.
 */
export function findWithdrawnClaims(raw: string, file = '<inline>'): Array<{ file: string; line: number; excerpt: string }> {
  const { merged, segments } = reconstruct(raw);
  return [...merged.matchAll(WITHDRAWN_CLAIM)].map((m) => {
    const at = m.index ?? 0;
    return {
      file,
      line: lineAt(segments, at),
      excerpt: merged.slice(Math.max(0, at - 60), at + 60).replace(/\n/g, ' '),
    };
  });
}

function* walk(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.spec.ts')) yield p;
  }
}

function judgeTree(): JudgedSite[] {
  const all: JudgedSite[] = [];
  for (const corpus of CORPORA) {
    for (const file of walk(corpus.root)) {
      const rel = path.relative(corpus.root, file);
      if (corpus.outOfScope.has(rel)) continue;
      all.push(...judgeMigrateSentences(fs.readFileSync(file, 'utf8'), `${corpus.name}:${rel}`));
    }
  }
  return all;
}

function claimTree(): Array<{ file: string; line: number; excerpt: string }> {
  const all: Array<{ file: string; line: number; excerpt: string }> = [];
  for (const corpus of CORPORA) {
    for (const file of walk(corpus.root)) {
      const rel = path.relative(corpus.root, file);
      if (corpus.outOfScope.has(rel)) continue;
      all.push(...findWithdrawnClaims(fs.readFileSync(file, 'utf8'), `${corpus.name}:${rel}`));
    }
  }
  return all;
}

describe('`os migrate meta` sentences are the house sentence, across corpora (#6856 route D, widened #7030)', () => {
  it('every prescription sentence in packages/spec/src and packages/lint/src is house-form or MIXED two-clause', () => {
    const judged = judgeTree();
    const violations = judged.filter((j) => !j.ok);
    expect(
      violations,
      violations
        .map((v) => `${v.file}:${v.line} — "${v.excerpt}"`)
        .join('\n'),
    ).toEqual([]);
  });

  it('anti-vacuity: the scanner actually judges every corpus (floor, not a census)', () => {
    // 54 prescription sentences in packages/spec/src at the time of the #6856
    // sweep; packages/lint/src contributes one more under #7030's widened
    // scan. The floor guards against a SCANNER going blind on either corpus (a
    // regex or comment-filter regression reporting an empty tree as green),
    // not against tombstones aging out — lower it deliberately, with the
    // removal that shrinks a corpus, when that day comes. #6914's 35 pending
    // sentences will only raise the count further.
    const judged = judgeTree();
    expect(judged.length).toBeGreaterThanOrEqual(50);
    expect(judged.every((j) => j.ok)).toBe(true);
  });

  it('anti-vacuity: the lint corpus specifically is reached, not just outnumbered by spec', () => {
    // The combined floor above (>=50) is already satisfied by packages/spec/src
    // alone, so a broken LINT_SRC_ROOT (wrong relative path, corpus silently
    // walking zero files) would NOT fail it — this assertion is the one thing
    // that actually exercises #7030's widening rather than merely declaring it.
    const judged = judgeTree();
    const lintSites = judged.filter((j) => j.file.startsWith('lint:'));
    expect(lintSites.length).toBeGreaterThanOrEqual(1);
    expect(lintSites.every((j) => j.ok)).toBe(true);
  });

  it('[#9529] the withdrawn automatic-rewrite claim is absent from every prescription', () => {
    // The other direction of the same ruling: requiring the new sentence where
    // `--from <N>` appears would still let the claim survive in a prescription
    // that spells the bare command (`CHATTER_POSITION_RETIRED` does) or names
    // the tool mid-prose. `os migrate meta` writes no authored source file.
    const claims = claimTree();
    expect(
      claims,
      claims.map((c) => `${c.file}:${c.line} — "${c.excerpt}"`).join('\n'),
    ).toEqual([]);
  });

  it('[#9529] the withdrawn-claim scan is not vacuous — every retired spelling trips it', () => {
    const withdrawn = [
      "const a = 'Delete the key. Run `os migrate meta --from 16` to rewrite existing sources automatically.';",
      "const b = 'Delete the key. Run `os migrate meta --from 16` to rewrite it automatically.';",
      "const c = 'Rename the key to `b`. `os migrate meta --from 16` rewrites it for you.';",
      "const d = 'The chain covers this: `os migrate meta --from 16` rewrites author sources.';",
      "const e = 'The chain covers this: `os migrate meta --from 16` rewrites authored sources.';",
      "const f = 'Run `os migrate meta`. It rewrites your source files.';",
      // Split across a concatenation seam — the reconstruction must still see it.
      "const g = 'Run `os migrate meta --from 16` to rewrite existing sources '\n  + 'automatically.';",
    ];
    for (const src of withdrawn) {
      expect(findWithdrawnClaims(src, 'withdrawn.zod.ts'), src).not.toEqual([]);
    }
    // And the house sentence itself must NOT trip it.
    expect(findWithdrawnClaims(
      "const h = 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';",
      'house.zod.ts',
    )).toEqual([]);
  });

  it('goes RED on the retired "rewrite it" spelling, naming the site', () => {
    const planted = [
      "const X = retiredKey(",
      "  '`x.y` was removed in @objectstack/spec 17.0.0 (#0000) — nothing read it. Delete the key. '",
      "  + 'Run `os migrate meta --from 16` to rewrite it automatically.',",
      ');',
    ].join('\n');
    const judged = judgeMigrateSentences(planted, 'planted.zod.ts');
    expect(judged).toHaveLength(1);
    expect(judged[0]!.ok).toBe(false);
    expect(judged[0]!.file).toBe('planted.zod.ts');
    expect(judged[0]!.line).toBeGreaterThan(0);
  });

  it('goes RED on every other retired spelling and on an emptied sentence', () => {
    const bad = [
      // The three other spellings the #6856 sweep retired.
      "'Delete the key. Run `os migrate meta --from 16` to remove it.'",
      "'Delete the key. Run `os migrate meta --from 16` to remove it automatically.'",
      "'Rename the key to `b`; the value is unchanged. `os migrate meta --from 16` rewrites it for you.'",
      // #9529: the sentence #6856 itself ruled, withdrawn as untrue of the tool.
      "'Delete the key. Run `os migrate meta --from 16` to rewrite existing sources automatically.'",
      // …and the MIXED shape's withdrawn spelling.
      "'Run `os migrate meta --from 16` to rewrite the `1y` case automatically; the rest are reported.'",
      // Emptied sentence: the command with no object at all.
      "'Delete the key. Run `os migrate meta --from 16`.'",
      // Sentence not final in its literal: prose buries the command.
      "'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand. Also do X.'",
    ];
    for (const literal of bad) {
      const judged = judgeMigrateSentences(`const s = ${literal};`, 'bad.zod.ts');
      expect(judged, literal).toHaveLength(1);
      expect(judged[0]!.ok, literal).toBe(false);
    }
  });

  it('accepts the two legal shapes, including across concatenation seams', () => {
    const good = [
      // House, single literal.
      "const a = '`k` was removed (#1). Delete the key. Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';",
      // House, sentence split across a cross-line concatenation seam.
      "const b = '`k` was removed (#1). Run `os migrate meta --from 16` to list the mechanical edits for existing sources; '\n  + 'apply them by hand.';",
      // MIXED two-clause (the dashboard model).
      "const c = 'Run `os migrate meta --from 16` to list the mechanical edits for the `1y` case; the other durations are reported for you to re-state.';",
      // MIXED two-clause (the script `actionType` member).
      "const d = 'Run `os migrate meta --from 16` to list the mechanical edits for the shorthand case into `config.function`; the stub and marker values are removed.';",
    ];
    for (const src of good) {
      const judged = judgeMigrateSentences(src, 'good.zod.ts');
      expect(judged, src).toHaveLength(1);
      expect(judged[0]!.ok, src).toBe(true);
    }
  });

  it('does not judge comment prose — only string literals carry prescriptions', () => {
    const commented = [
      '/**',
      ' * Historical note: `os migrate meta --from 16` rewrites it for you.',
      ' */',
      '// and a line comment: Run `os migrate meta --from 16` to remove it.',
      "const live = 'unrelated string';",
    ].join('\n');
    expect(judgeMigrateSentences(commented, 'comments.zod.ts')).toHaveLength(0);
  });
});
