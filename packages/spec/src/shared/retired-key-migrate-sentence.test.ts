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
/**
 * [#10848] The population widened by EXACTLY ONE governed file (maintainer
 * ruling 2026-08-22, deliberately not all of `.claude/`): the retirement
 * playbook every new tombstone's guidance string is authored from. It sat
 * outside both corpora and prescribed the withdrawn sentence, so the skill
 * taught authors to red this very pin — and a red pin over a skill-taught
 * sentence invites weakening the PIN rather than the skill. It cannot ride
 * the corpus walk: it is markdown (the walk yields `.ts` only), its `--from`
 * operand is a placeholder like `<N-1>` (never `\d+`), its sentences end at a
 * code-span close (never at a string-literal quote), and `reconstruct()`
 * would drop every markdown line that opens with an asterisk. So it is judged
 * below as its own corpus: raw text, whitespace-normalised, with
 * placeholder-aware anchors — the withdrawn-claim direction reuses
 * `WITHDRAWN_CLAIM` verbatim.
 *
 * [#13859] ONE hard-coded path is a population of one, and the sentence does
 * not stay inside it: the withdrawn automatic-rewrite claim reached the
 * PUBLISHED skill catalog — the artifacts a customer agent actually loads, and
 * that land in codebases this repo cannot see — with nothing scanning them.
 * The corpus below is therefore DISCOVERED rather than named: this playbook
 * plus every `.md` file under `skills/`. Discovery is the input, so it is
 * itself asserted non-vacuous — a walk that silently reached zero published
 * files would leave this pin exactly as narrow as it was, while reading green.
 */
const RETIREMENT_SKILL_MD = path.resolve(HERE, '../../../../.claude/skills/spec-property-retirement/SKILL.md');
/**
 * [#13859] The published catalog root. Discovered, never listed: a checked-in
 * file list is a second population to keep in sync, and the one that rots is
 * always the list.
 */
const PUBLISHED_SKILLS_ROOT = path.resolve(HERE, '../../../../skills');

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

/**
 * [#10848] Markdown-corpus anchors (see the `RETIREMENT_SKILL_MD` docblock).
 * Same two legal shapes as `HOUSE_AT_MARKER`/`MIXED_AT_MARKER`, adapted on
 * exactly three axes: the `--from` operand may be a placeholder (`<N-1>`,
 * `<N>`) as well as a literal major; the judged text is the whole file with
 * runs of whitespace collapsed (markdown wraps sentences mid-clause); and
 * "last sentence of its literal" becomes "last sentence of its container".
 *
 * The marker requires the leading `Run` on purpose: a skill legitimately NAMES
 * the command mid-prose (`migrate meta --from <old>` in the playbook's §3
 * `retiredFromLoadPath` bullet; a dozen bare `os migrate meta …` invocations in
 * the published upgrade skill) without prescribing a sentence — only sentences
 * are judged. That property is what makes the widened population safe, so it
 * stays.
 *
 * [#13859] "Container" is TWO things once the corpus is more than the playbook,
 * and one anchor for both would be a false-positive machine. A taught TEMPLATE
 * is written as a double-backtick code span, so its sentence must close that
 * span (`.` then the span's two backticks) — prose cannot bury the command
 * mid-span, which is the property the source corpus gets from its closing
 * quote. A sentence QUOTED in prose or inside a fenced transcript has no span
 * to close: the published upgrade skill quotes the house sentence verbatim
 * inside a rendered parse error, whose next line is `expected: never`. Under a
 * span-only anchor every such occurrence is an unconditional RED — not a
 * property, since nothing but a code span could ever satisfy it, but a trap
 * that fires the moment the corpus stops being one file. So a non-span
 * occurrence is judged for its WORDING, ending at its own period. What that
 * gives up, deliberately and only in prose: burying (`… apply them by hand.
 * Also do X.`) passes there, while it stays RED inside a template and in every
 * `.ts` prescription above — the two places a reader copies text from.
 */
const SKILL_FROM_OPERAND = /(?:\d+|<[^>`]+>)/.source;
const SKILL_MARKER = new RegExp(
  `Run \`os migrate meta --from ${SKILL_FROM_OPERAND}\``,
  'g',
);
/** The two legal wordings, from the marker up to the sentence's final period. */
const SKILL_HOUSE_BODY = `^Run \`os migrate meta --from ${SKILL_FROM_OPERAND}\` to list the mechanical edits for existing sources; apply them by hand\\.`;
const SKILL_MIXED_BODY = `^Run \`os migrate meta --from ${SKILL_FROM_OPERAND}\` to list the mechanical edits for the [^;]+ case[^;]*; [^;]+?\\.`;
/** Container-final anchors: a code span closes; a quoted sentence just ends. */
const SKILL_TEMPLATE_END = '``';
const SKILL_PROSE_END = '(?:\\s|$)';
const SKILL_HOUSE_TEMPLATE = new RegExp(`${SKILL_HOUSE_BODY}${SKILL_TEMPLATE_END}`);
const SKILL_MIXED_TEMPLATE = new RegExp(`${SKILL_MIXED_BODY}${SKILL_TEMPLATE_END}`);
const SKILL_HOUSE_PROSE = new RegExp(`${SKILL_HOUSE_BODY}${SKILL_PROSE_END}`);
const SKILL_MIXED_PROSE = new RegExp(`${SKILL_MIXED_BODY}${SKILL_PROSE_END}`);

/** Label prefix for the internal playbook, mirroring the `spec:`/`lint:` convention. */
const PLAYBOOK_LABEL = 'internal:spec-property-retirement/SKILL.md';

interface MarkdownFile {
  /** Corpus-prefixed path, e.g. `skills:objectstack-upgrade/SKILL.md`. */
  file: string;
  /** Whole file, runs of whitespace collapsed. */
  flat: string;
}

/**
 * [#13859] Deterministic markdown discovery. `readdirSync(…).sort()` so the
 * corpus order — and therefore every failure message — is identical on every
 * machine and every run. `lstatSync` so a symlink is SKIPPED rather than
 * followed: a link pointing outside the repo would make the corpus depend on
 * the checkout around it, and following one back inside would judge a file
 * twice. Nothing else is skipped, and nothing is skipped silently — the
 * discovery anti-vacuity assertion below is what notices when it is.
 */
function* walkMarkdown(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* walkMarkdown(p);
    else if (st.isFile() && p.endsWith('.md')) yield p;
  }
}

/** The internal retirement playbook, then the published catalog in sorted order. */
function markdownCorpus(): MarkdownFile[] {
  const files: Array<{ file: string; abs: string }> = [{ file: PLAYBOOK_LABEL, abs: RETIREMENT_SKILL_MD }];
  for (const abs of walkMarkdown(PUBLISHED_SKILLS_ROOT)) {
    files.push({ file: `skills:${path.relative(PUBLISHED_SKILLS_ROOT, abs)}`, abs });
  }
  return files.map(({ file, abs }) => ({ file, flat: fs.readFileSync(abs, 'utf8').replace(/\s+/g, ' ') }));
}

interface MarkdownSite {
  file: string;
  /** True when the marker opens a double-backtick code span — a taught template. */
  template: boolean;
  excerpt: string;
  ok: boolean;
}

/** Every `os migrate meta` prescription sentence in one markdown file, with its verdict. */
function judgeMarkdownSentences({ file, flat }: MarkdownFile): MarkdownSite[] {
  return [...flat.matchAll(SKILL_MARKER)].map((m) => {
    const at = m.index ?? 0;
    const rest = flat.slice(at);
    const template = flat.slice(0, at).endsWith('``');
    const ok = template
      ? SKILL_HOUSE_TEMPLATE.test(rest) || SKILL_MIXED_TEMPLATE.test(rest)
      : SKILL_HOUSE_PROSE.test(rest) || SKILL_MIXED_PROSE.test(rest);
    return { file, template, excerpt: rest.slice(0, 120), ok };
  });
}

describe('the retirement playbook and the published skill catalog agree with this pin (#10848, corpus widened #13859)', () => {
  const corpus = markdownCorpus();

  it('[#13859] anti-vacuity for the DISCOVERY: the playbook and at least one published skill', () => {
    // The corpus is this suite's input, so a walk that reached zero published
    // files would restore the exact one-file blindness #13859 is about — and
    // every assertion below would stay green while it did. Assert the shape of
    // the population itself, not a count that ages out with the catalog.
    expect(corpus.length).toBeGreaterThan(0);
    const labels = corpus.map((c) => c.file);
    expect(labels).toContain(PLAYBOOK_LABEL);
    const published = labels.filter((l) => l.startsWith('skills:'));
    expect(published.length).toBeGreaterThanOrEqual(1);
    // Deterministic ordering: the published tail is sorted, so a failure names
    // its sites in a stable order rather than in readdir order.
    expect(published).toEqual([...published].sort());
  });

  it('every prescription sentence in the markdown corpus is house-form or MIXED two-clause', () => {
    const bad = corpus.flatMap(judgeMarkdownSentences).filter((s) => !s.ok);
    expect(
      bad,
      bad.map((s) => `${s.file} [${s.template ? 'template' : 'prose'}] — "${s.excerpt}"`).join('\n'),
    ).toEqual([]);
  });

  it('anti-vacuity: the PLAYBOOK teaches BOTH shapes, so the scan judges at least two sites', () => {
    // Pinned to the one file that OWNS both templates — never a whole-corpus
    // claim. Convention 5 carries the house template and its one allowed
    // variant (the partial-conversion two-clause shape); zero or one marker
    // means the playbook stopped teaching a shape, or this scan went blind on
    // it. A published skill that names the command once is not a regression,
    // so widening this floor to the corpus would assert nothing and fail on
    // the catalog's own editorial choices.
    const playbook = corpus.find((c) => c.file === PLAYBOOK_LABEL);
    expect(playbook, PLAYBOOK_LABEL).toBeDefined();
    const rests = [...playbook!.flat.matchAll(SKILL_MARKER)].map((m) => playbook!.flat.slice(m.index ?? 0));
    expect(rests.length).toBeGreaterThanOrEqual(2);
    expect(rests.some((r) => SKILL_HOUSE_TEMPLATE.test(r))).toBe(true);
    expect(rests.some((r) => SKILL_MIXED_TEMPLATE.test(r))).toBe(true);
  });

  it('[#9529] the withdrawn automatic-rewrite claim is absent from the corpus, in every spelling', () => {
    // Judged over the raw text rather than reconstruct(): a markdown line
    // opening with an asterisk would be dropped as a comment line, hiding a
    // claim. WITHDRAWN_CLAIM is English-only BY DESIGN — the playbook's
    // Chinese prose (and any that follows it into the catalog) cannot
    // fabricate a match, so a hit is a real regression of the ruling. This is
    // the direction #13859 widened for: the claim is red wherever it appears,
    // and "wherever" now includes the published catalog.
    const claims = corpus.flatMap(({ file, flat }) =>
      [...flat.matchAll(WITHDRAWN_CLAIM)].map(
        (m) => `${file} — "${flat.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 60)}"`,
      ),
    );
    expect(claims, claims.join('\n')).toEqual([]);
  });

  it('[#13859] the markdown judge is not vacuous — template and prose anchors each hold', () => {
    const judge = (flat: string): MarkdownSite[] => judgeMarkdownSentences({ file: 'synthetic.md', flat });
    const house = 'Run `os migrate meta --from <N-1>` to list the mechanical edits for existing sources; apply them by hand.';
    const mixed = 'Run `os migrate meta --from 16` to list the mechanical edits for the `1y` case; the rest are reported.';
    // A taught template must close its code span, in both legal shapes.
    expect(judge(`5. \`\`${house}\`\``).map((s) => [s.template, s.ok])).toEqual([[true, true]]);
    expect(judge(`\`\`${mixed}\`\``).map((s) => [s.template, s.ok])).toEqual([[true, true]]);
    // …and a template that buries the command mid-span stays RED.
    expect(judge(`\`\`${house} Also do X.\`\``).map((s) => s.ok)).toEqual([false]);
    // A sentence quoted in prose or a transcript is judged on wording alone.
    expect(judge(`error text … ${house} expected: never`).map((s) => [s.template, s.ok])).toEqual([[false, true]]);
    expect(judge('Run `os migrate meta --from 16` to rewrite it automatically.').map((s) => s.ok)).toEqual([false]);
    expect(judge('Run `os migrate meta --from 16` to remove it.').map((s) => s.ok)).toEqual([false]);
    // Naming the command mid-prose without the leading `Run` is not a sentence.
    expect(judge('Stored flows convert with `os migrate meta --from 16`.')).toEqual([]);
    // The withdrawn claim trips wherever it appears, fence or prose.
    expect([...'``os migrate meta --from 16` rewrites your source files.``'.matchAll(WITHDRAWN_CLAIM)]).not.toEqual([]);
  });
});
