#!/usr/bin/env node
// check-skill-frame-sync — isomorphism gate for the escalation decision frame,
// which exists as FOUR hand-written copies across three files (#5798).
//
// The frame ("analyze every option on N fixed axes") is binding text for both
// the PM agent and the dev agent, and it is written twice over: once for this
// repo's internal agent protocol (`.claude/**`, never published) and once for
// third-party projects (`skills/objectstack-pm-dispatch/SKILL.md`, which ships
// verbatim via `npx skills add objectstack-ai/objectstack/skills` and embeds its
// own dev-agent template). Nothing compared them.
//
// The drift is not hypothetical. #5130 (2026-08-04) widened the internal frame
// from two axes to three; the published mirror was untouched and stayed at two
// for **two days**, so every third-party PM agent that had installed the skill
// escalated on two axes while this repo ruled on three. It took a human noticing
// it, a fresh issue, and a maintainer round on wording (#5451, PR #5799) to
// re-converge. This gate is the mechanism that #5130 lacked.
//
// Same reason as `check:skill-refs` / `check:skill-docs` in lint.yml, one layer
// up: those gates keep the *generated* parts of `skills/**` in sync with
// packages/spec because "these ship to third parties via `npx skills add`, so the
// drift is served straight to consumers' agents". The SKILL.md **prose** ships
// the same way and had no gate at all — the two existing ones compare only
// frontmatter and generated indexes, never the body.
//
// WHAT IS COMPARED — structure, deliberately NOT wording:
//   • axis COUNT (per copy, and equal across all four),
//   • axis NAME SEQUENCE, mapped through the explicit AXIS_MAP below (internal
//     Chinese ⇄ published English), order significant,
//   • the BINDING SENTENCE is in place in every copy,
//   • every in-file mention of the axis count agrees with it.
// #5451 decided (route B) that the published copy is deliberately generalized:
// no "startup project" self-description, no this-repo issue numbers, the
// capability-expansion stance delegated to the installer's conventions file.
// That is NOT drift, so a byte or wording comparison would be permanently red
// and would get deleted. This gate must stay blind to prose and sharp on shape.
//
// WHY EXTRACTION FAILURE IS RED (#4690 anti-pattern): a checker that cannot find
// what it is supposed to compare must fail, never silently pass. Every anchor
// miss below is a hard failure that names the copy and the anchor.
//
// WHY THE ANCHORS DO NOT SPELL THE COUNT (#5680 lesson): an anchor containing
// the compared value stops matching the moment that value drifts, which
// downgrades "the copies disagree" into "I could not find the section" — the
// same defect class in a nicer costume. So every anchor CAPTURES the numeral
// (`%N%`) or the whole quantifier around it (`%Q%`) instead of hard-coding
// "three"/"all", and the captured value is the thing compared. The `%Q%` case is
// not theoretical — see soft() for the draft of this gate that failed it, caught
// by running the gate against the real pre-#5799 tree.
//
// Layering — why this is a root script and not `pnpm --filter @objectstack/spec`
// like its two neighbours: those are generators (`gen:skill-refs` etc.) whose
// source is packages/spec/src, which is why they live in the spec package and in
// its check:generated ledger. This gate reads no spec source and generates no
// artifact; it compares two hand-written documents, one of which (`.claude/**`)
// the spec package has no business knowing about. Repo-wide policy gates over
// prose live in root scripts/ (check:role-word, check:doc-authoring,
// check:nul-bytes all scan skills/ from here).
//
//   node scripts/check-skill-frame-sync.mjs [--self-test]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Build a wrap-tolerant anchor regex from a literal template.
 *
 * Both SKILL.md copies hard-wrap prose mid-sentence, so an anchor written with
 * plain spaces would miss whenever a reflow moves a line break. Every run of
 * spaces becomes `\s+`.
 *
 * `%N%` marks the axis-count numeral: it is CAPTURED, never spelled (#5680), so
 * an edit from three axes to four still extracts and is then reported as a
 * disagreement rather than as a missing section.
 *
 * `%Q%` is the same idea one word wider, and it is here because the first draft
 * of this gate got it wrong. English quantifies the binding sentence in a way
 * that CO-VARIES with the count — "all three axes" at three, "both axes" at two —
 * so a binding anchor spelling "all" silently re-acquires the #5680 defect:
 * checked against the real pre-#5799 published copy it reported "the binding
 * sentence is not in place" when the truth was "this copy has two axes and the
 * others have three". `%Q%` swallows the quantifier (`all N`, `both`, either
 * wrapped in `**`) and captures the count, so the count comparison is what
 * fires. Verified against 77adf297f^ — see the PR body.
 */
function soft(template) {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped
    .replace(/%N%/g, '(\\S+?)')
    .replace(/%Q%/g, '\\*{0,2}(?:all\\s+)?([^\\s*]+)\\*{0,2}')
    .replace(/ +/g, '\\s+');
}

/**
 * The four copies. `start` is the sentence that declares the frame, `binding` is
 * the sentence that makes it binding; the axis entries are whatever lies between
 * them. Both anchors must match exactly once per file — an ambiguous anchor is
 * reported rather than silently resolved to the first hit.
 *
 * EXPORTED for scripts/check-skill-frame-freshness.mjs (#5866), which asks the
 * OTHER invariant about the same documents — "is this working tree's copy of the
 * frame still current with origin/main?" as opposed to this gate's "are the four
 * copies in one tree isomorphic?". Two invariants, two scripts (the #5866 triage
 * ruled explicitly against merging them), but exactly ONE definition of what
 * "the frame's structure" is — forking these anchors into a second script would
 * reproduce, in the gates, the very hand-copied-text disease they police.
 */
export const COPIES = [
  {
    id: 'internal-pm',
    file: '.claude/skills/pm-dispatch/SKILL.md',
    lang: 'zh',
    what: 'internal PM dispatch skill, step 8 (Escalate)',
    start: soft('**每个方案必须沿%N%固定评估轴'),
    binding: soft('推荐意见必须基于这%N%轴给出理由'),
  },
  {
    id: 'internal-dev',
    file: '.claude/agents/os-dev.md',
    lang: 'en',
    what: 'internal dev-agent definition, "When to stop instead of code"',
    start: soft('**Analyze every option on %N% fixed axes — this framing is the core of the escalation'),
    binding: soft('recommendation must be justified on %Q% axes'),
  },
  {
    id: 'published-pm',
    file: 'skills/objectstack-pm-dispatch/SKILL.md',
    lang: 'en',
    what: 'published PM skill, the decision frame section',
    start: soft('**and analyze every option on the %N% fixed axes below.**'),
    binding: soft('recommendation must be justified on %Q% axes'),
  },
  {
    id: 'published-dev',
    file: 'skills/objectstack-pm-dispatch/SKILL.md',
    lang: 'en',
    what: 'published PM skill, the EMBEDDED dev-agent template',
    start: soft('Analyze every option on %N% fixed axes:'),
    binding: soft('Justify your recommendation on %Q% axes'),
  },
];

/**
 * The axis vocabulary map — the noun correspondence between the internal Chinese
 * copy and the English ones, written out here on purpose so that changing what
 * counts as "the same axis" is a deliberate, reviewable edit.
 *
 * Order is the canonical axis order; a copy that lists them in another order
 * fails. A copy whose axis matches no entry fails too: renaming an axis is a
 * frame change, and the map is where that change gets recorded.
 *
 * EXPORTED for the freshness gate (#5866) — see the note on COPIES above. The
 * #5866 triage named this map as the structural criterion to reuse, precisely
 * so that "the same axis" means the same thing to both gates forever.
 */
export const AXIS_MAP = [
  {
    id: 'business-need',
    zh: /实际业务需求/,
    en: /real business need/i,
  },
  {
    id: 'long-term-soundness',
    zh: /项目长远合理性/,
    en: /long-term(?: architectural)? soundness/i,
  },
  {
    id: 'ai-authoring-safety',
    zh: /防 ?AI ?写(?:代码|元数据)/,
    en: /making AI-(?:written|authored) code/i,
  },
];

/** Numerals the count sentences are allowed to be written in. */
const NUMERALS = new Map([
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6],
  ['both', 2], // English quantifies two as "both axes", never "all two axes"
  ['一', 1], ['两', 2], ['二', 2], ['三', 3], ['四', 4], ['五', 5], ['六', 6],
]);

function toCount(word) {
  if (word == null) return null;
  const w = String(word).trim().replace(/条$/, '');
  if (/^\d+$/.test(w)) return Number(w);
  return NUMERALS.get(w.toLowerCase()) ?? NUMERALS.get(w) ?? null;
}

/**
 * An axis entry starts either at a list bullet (three of the four copies) or at
 * an `**Axis ① — …**` paragraph (the published PM copy). Both shapes are accepted
 * everywhere, so reformatting one copy into the other's shape does not blind the
 * gate. A blank line closes an entry; wrapped continuation lines belong to it.
 */
const ENTRY_START = /^(?:\s*[-*]\s+|\*\*Axis\s)/;

function axisEntries(section) {
  const entries = [];
  let current = null;
  for (const line of section.split('\n')) {
    if (line.trim() === '') { current = null; continue; }
    if (ENTRY_START.test(line)) {
      current = [line.trim()];
      entries.push(current);
    } else if (current) {
      current.push(line.trim());
    }
  }
  return entries.map((lines) => lines.join(' '));
}

/**
 * The axis's own name, not its argument: the leading bold span when there is one
 * (`- **Real business need**: …`, `**Axis ① — real business need.** …`), else the
 * head of the entry, for the published template whose bullets carry no emphasis.
 */
function axisNameCandidate(entry) {
  const t = entry.replace(/^\s*[-*]\s+/, '').trim();
  if (t.startsWith('**')) {
    const end = t.indexOf('**', 2);
    if (end > 2) return t.slice(2, end);
  }
  return t.slice(0, 200);
}

/** Count mentions of the frame elsewhere in a watched file (`the deep three-axis analysis`). */
const MENTION_PATTERNS = [
  /\b([A-Za-z]+)-axis\s+(?:analysis|decision\s+frame|frame)/g,
  /([一二三四五六七八九十两\d]+)条(?:固定)?评估轴/g,
];

/**
 * Files that must be declared in COPIES if they carry the frame at all — the
 * anti-dormancy half. A fifth copy added tomorrow (a second published skill, a
 * new agent definition) would otherwise be unwatched, which is exactly how
 * hand-kept input lists rot (#4291).
 */
const FINGERPRINTS = [
  /fixed axes/i,
  /固定评估轴/,
  /条评估轴/,
  /\b[A-Za-z]+-axis\s+(?:analysis|decision\s+frame|frame)/,
];
const SCAN_ROOTS = ['.claude', 'skills'];
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'references']);
const SCAN_EXTENSIONS = ['.md', '.mdx'];

function matchAllOf(text, source) {
  return [...text.matchAll(new RegExp(source, 'g'))];
}

/**
 * Analyze one copy. Returns null after recording a problem when the section
 * cannot be extracted — extraction failure is a red, never a skip (#4690).
 *
 * EXPORTED for the freshness gate (#5866): it runs exactly this extraction over
 * the SAME copy shapes, once against the working tree's bytes and once against
 * `origin/main`'s, and compares the two structures. Sharing the extractor is
 * what makes the two gates provably talk about the same "structure".
 */
export function analyzeCopy(copy, axisMap, problems) {
  const label = `${copy.id} (${copy.file} — ${copy.what})`;

  const starts = matchAllOf(copy.text, copy.start);
  if (starts.length !== 1) {
    problems.push(
      `${label}\n` +
      `    could not extract the decision frame: the declaring sentence anchor matched ` +
      `${starts.length} time(s), expected exactly 1.\n` +
      `    anchor: /${copy.start}/\n` +
      `    Either the frame moved or its declaring sentence was reworded. Fix the copy, ` +
      `or update this copy's \`start\` anchor in scripts/check-skill-frame-sync.mjs — ` +
      `do NOT let the gate skip the copy.`,
    );
    return null;
  }

  const bindings = matchAllOf(copy.text, copy.binding);
  if (bindings.length !== 1) {
    problems.push(
      `${label}\n` +
      `    the BINDING sentence is not in place: its anchor matched ${bindings.length} ` +
      `time(s), expected exactly 1.\n` +
      `    anchor: /${copy.binding}/\n` +
      `    The frame is binding text; a copy that declares axes without binding the ` +
      `recommendation to them is not the same frame.`,
    );
    return null;
  }

  const start = starts[0];
  const binding = bindings[0];
  const sectionStart = start.index + start[0].length;
  const sectionEnd = binding.index;
  if (sectionEnd <= sectionStart) {
    problems.push(
      `${label}\n` +
      `    the binding sentence (offset ${binding.index}) precedes the declaring ` +
      `sentence (offset ${start.index}); the two anchors are matching different ` +
      `frames. Re-check the anchors for this copy.`,
    );
    return null;
  }

  const declaredAtStart = toCount(start[1]);
  const declaredAtBinding = toCount(binding[1]);
  for (const [where, raw, parsed] of [
    ['declaring sentence', start[1], declaredAtStart],
    ['binding sentence', binding[1], declaredAtBinding],
  ]) {
    if (parsed == null) {
      problems.push(
        `${label}\n` +
        `    the axis count in the ${where} reads "${raw}", which is not a numeral this ` +
        `gate knows. Extend NUMERALS in scripts/check-skill-frame-sync.mjs deliberately.`,
      );
      return null;
    }
  }
  if (declaredAtStart !== declaredAtBinding) {
    problems.push(
      `${label}\n` +
      `    this copy contradicts itself: the declaring sentence says ${declaredAtStart} ` +
      `axes, the binding sentence says ${declaredAtBinding}. A half-finished axis edit.`,
    );
    return null;
  }

  const section = copy.text.slice(sectionStart, sectionEnd);
  const entries = axisEntries(section);
  if (entries.length === 0) {
    problems.push(
      `${label}\n` +
      `    the frame section was located but contains no axis entries. Expected list ` +
      `bullets or \`**Axis … **\` paragraphs between the declaring and binding ` +
      `sentences.`,
    );
    return null;
  }

  if (entries.length !== declaredAtStart) {
    problems.push(
      `${label}\n` +
      `    the prose declares ${declaredAtStart} axes but ${entries.length} axis ` +
      `entr${entries.length === 1 ? 'y is' : 'ies are'} written out:\n` +
      entries.map((e, i) => `      ${i + 1}. ${axisNameCandidate(e).slice(0, 90)}`).join('\n'),
    );
    return null;
  }

  const ids = [];
  let mappingFailed = false;
  for (const [i, entry] of entries.entries()) {
    const name = axisNameCandidate(entry);
    const hits = axisMap.filter((axis) => axis[copy.lang]?.test(name));
    if (hits.length !== 1) {
      mappingFailed = true;
      const how = hits.length === 0 ? 'matches no entry' : `matches ${hits.length} entries`;
      problems.push(
        `${label}\n` +
        `    axis entry #${i + 1} ${how} in AXIS_MAP (expected exactly 1):\n` +
        `      "${name.slice(0, 120)}"\n` +
        (hits.length === 0
          ? `    An axis was renamed, or a new axis was added. If the rename is intended, ` +
            `record it in AXIS_MAP (scripts/check-skill-frame-sync.mjs) in the same PR ` +
            `that renames it in ALL ${COPIES.length} copies.`
          : `    Ambiguous map: ${hits.map((h) => h.id).join(', ')}. Tighten the patterns.`),
      );
      continue;
    }
    ids.push(hits[0].id);
  }
  if (mappingFailed) return null;

  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    problems.push(
      `${label}\n` +
      `    the same axis is listed twice (${[...new Set(dupes)].join(', ')}): ${ids.join(' → ')}`,
    );
    return null;
  }

  return { copy, label, declared: declaredAtStart, ids, sectionStart, sectionEnd };
}

/**
 * Every check, over an explicit copy set — the shape the self-test drives.
 *
 * EXPORTED so the freshness gate's self-test (#5866) can assert the claim its
 * whole existence rests on: on a tree that is CONSISTENTLY the old two-axis
 * frame, THIS gate is green (the copies really are isomorphic) while the
 * freshness gate is red. That independence is what makes them two scripts; it is
 * pinned there rather than merely written down here.
 */
export function runAllChecks(copies, axisMap = AXIS_MAP, scanFiles = null) {
  const problems = [];
  const results = [];
  for (const copy of copies) {
    const r = analyzeCopy(copy, axisMap, problems);
    if (r) results.push(r);
  }

  // Two copies share the published file; sections must not overlap, or an anchor
  // is reading the wrong instance and the comparison is vacuous.
  for (const a of results) {
    for (const b of results) {
      if (a === b || a.copy.file !== b.copy.file) continue;
      if (a.sectionStart < b.sectionEnd && b.sectionStart < a.sectionEnd) {
        if (a.copy.id < b.copy.id) {
          problems.push(
            `${a.copy.file}\n` +
            `    the sections extracted for ${a.copy.id} and ${b.copy.id} OVERLAP ` +
            `(${a.sectionStart}..${a.sectionEnd} vs ${b.sectionStart}..${b.sectionEnd}); ` +
            `both anchors are matching the same frame, so their comparison proves nothing.`,
          );
        }
      }
    }
  }

  // The isomorphism itself.
  const counts = new Set(results.map((r) => r.declared));
  if (counts.size > 1) {
    problems.push(
      `the four copies do not agree on the NUMBER of axes — this is the #5130 drift:\n` +
      results.map((r) => `      ${r.declared} axes  ${r.copy.id}  (${r.copy.file})`).join('\n') +
      `\n    Every copy of the frame must be updated in the same PR, including the ` +
      `published mirror in skills/ that ships to third parties.`,
    );
  }
  const sequences = new Map();
  for (const r of results) {
    const key = r.ids.join(' → ');
    if (!sequences.has(key)) sequences.set(key, []);
    sequences.get(key).push(r.copy.id);
  }
  if (sequences.size > 1) {
    problems.push(
      `the copies do not agree on the axis NAME SEQUENCE:\n` +
      [...sequences].map(([seq, ids]) => `      ${seq}\n        in: ${ids.join(', ')}`).join('\n') +
      `\n    Axis identity comes from AXIS_MAP; order is significant (the business-need ` +
      `axis is asked FIRST on purpose — it can retire the question instead of ` +
      `answering it).`,
    );
  }

  // Count mentions elsewhere in the watched files must agree with the frame.
  // #5130 had to fix one of these too ("the deep two-axis analysis"), and it is
  // the kind of line a count edit forgets.
  let mentionCount = 0;
  if (counts.size === 1 && results.length > 0) {
    const expected = [...counts][0];
    const seen = new Set();
    for (const r of results) {
      if (seen.has(r.copy.file)) continue;
      seen.add(r.copy.file);
      for (const pattern of MENTION_PATTERNS) {
        for (const m of r.copy.text.matchAll(pattern)) {
          const got = toCount(m[1]);
          if (got == null) continue; // "react-chart-axis", "across-axis header" — not counts
          mentionCount += 1;
          if (got !== expected) {
            problems.push(
              `${r.copy.file}\n` +
              `    a mention of the frame states ${got} axes while the frame itself has ` +
              `${expected}: "${m[0].replace(/\s+/g, ' ')}"\n` +
              `    Update the mention with the frame, or reword it so it does not state a count.`,
            );
          }
        }
      }
    }
  }

  // Anti-dormancy: no undeclared copy of the frame.
  const declaredFiles = new Set(copies.map((c) => c.file));
  for (const f of scanFiles ?? []) {
    if (declaredFiles.has(f.file)) continue;
    const hit = FINGERPRINTS.find((rx) => rx.test(f.text));
    if (hit) {
      problems.push(
        `${f.file}\n` +
        `    looks like ANOTHER copy of the decision frame (matched /${hit.source}/) but is ` +
        `not declared in COPIES, so nothing keeps it in sync.\n` +
        `    Add it to COPIES in scripts/check-skill-frame-sync.mjs, or derive it by ` +
        `reference instead of forking the text.`,
      );
    }
  }

  return { problems, results, mentionCount };
}

function walkMarkdown(root, out) {
  let entries;
  try {
    entries = readdirSync(join(REPO_ROOT, root));
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SCAN_SKIP_DIRS.has(name)) continue;
    const rel = join(root, name);
    const abs = join(REPO_ROOT, rel);
    if (statSync(abs).isDirectory()) walkMarkdown(rel, out);
    else if (SCAN_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      out.push({ file: rel, text: readFileSync(abs, 'utf8') });
    }
  }
  return out;
}

function readCopies() {
  const cache = new Map();
  return COPIES.map((copy) => {
    if (!cache.has(copy.file)) {
      cache.set(copy.file, readFileSync(join(REPO_ROOT, copy.file), 'utf8'));
    }
    return { ...copy, text: cache.get(copy.file) };
  });
}

function report(problems) {
  console.error(`\n✗ check-skill-frame-sync: ${problems.length} problem(s).\n`);
  for (const p of problems) console.error(`  • ${p}\n`);
  console.error(
    `  The escalation decision frame is written out ${COPIES.length} times ` +
    `(#5798). Structure — axis count, axis order, the binding sentence — must ` +
    `match across all of them; wording deliberately need not (#5451 generalized ` +
    `the published copy on purpose).\n`,
  );
}

// ---------------------------------------------------------------------------
// self-test
// ---------------------------------------------------------------------------

/**
 * Fixtures are the REAL documents, mutated in memory — a synthetic fixture would
 * only prove the gate can read synthetic fixtures. Every mutation asserts it
 * actually applied, so a fixture that drifts fails loudly instead of turning a
 * red-expecting case green for the wrong reason.
 */
function mutate(copies, id, from, to) {
  return copies.map((c) => {
    if (c.id !== id) return c;
    const text = c.text.replace(from, to);
    if (text === c.text) {
      throw new Error(
        `self-test fixture drifted: mutation target not found in ${c.id} (${c.file}): ${from}`,
      );
    }
    // Both published copies share one file; keep the sibling's text in step.
    return { ...c, text };
  }).map((c, _i, all) => {
    const mutated = all.find((x) => x.id === id);
    if (c.id !== id && c.file === mutated.file) return { ...c, text: mutated.text };
    return c;
  });
}

function selfTest() {
  const base = readCopies();
  const scanOf = (copies) => {
    const seen = new Map();
    for (const c of copies) if (!seen.has(c.file)) seen.set(c.file, { file: c.file, text: c.text });
    return [...seen.values()];
  };

  const cases = [
    {
      label: 'baseline: the four real copies are isomorphic',
      copies: () => base,
      expect: 'green',
    },
    {
      // The #5130 shape, incoherent half: bullets changed, prose count not.
      label: 'one copy loses an axis, its declared count unchanged → red (count vs entries)',
      copies: () => mutate(
        base, 'internal-dev',
        '- **Long-term soundness for THIS project**',
        '  **Long-term soundness for THIS project**',
      ),
      expect: 'red',
      wants: [/internal-dev/, /declares 3 axes but 2 axis entries/],
    },
    {
      // The #5130 shape, coherent: one side becomes a consistent two-axis frame.
      label: 'one copy coherently rewritten to two axes → red (cross-copy count)',
      copies: () => {
        let c = mutate(
          base, 'internal-dev',
          '- **Long-term soundness for THIS project**',
          '  **Long-term soundness for THIS project**',
        );
        c = mutate(c, 'internal-dev', 'on three fixed axes', 'on two fixed axes');
        return mutate(c, 'internal-dev', 'on all three axes', 'on all two axes');
      },
      expect: 'red',
      wants: [/do not agree on the NUMBER of axes/, /#5130/, /2 axes {2}internal-dev/],
    },
    {
      // Regression pin for the draft defect described in soft(): the two-axis form
      // of the binding sentence is "both axes", not "all two axes". The count
      // disagreement must be what fires — NOT "the binding sentence is missing".
      label: 'two-axis copy phrased "both axes" → red on the COUNT, not on extraction',
      copies: () => {
        let c = mutate(
          base, 'published-dev',
          '- Making AI-authored code — especially AI-authored metadata — structurally hard',
          '  Making AI-authored code — especially AI-authored metadata — structurally hard',
        );
        c = mutate(c, 'published-dev', 'Analyze every option on three fixed axes:', 'Analyze every option on two fixed axes:');
        return mutate(c, 'published-dev', 'Justify your recommendation on all three axes', 'Justify your recommendation on both axes');
      },
      expect: 'red',
      wants: [/do not agree on the NUMBER of axes/, /2 axes {2}published-dev/],
      unwanted: [/BINDING sentence is not in place/, /could not extract/],
    },
    {
      label: 'an axis is renamed in one copy → red (unmapped axis name)',
      copies: () => mutate(base, 'internal-pm', '**项目长远合理性**', '**长期架构取向**'),
      expect: 'red',
      wants: [/internal-pm/, /matches no entry in AXIS_MAP/, /长期架构取向/],
    },
    {
      label: 'axes reordered in one copy → red (name sequence)',
      copies: () => {
        let c = mutate(
          base, 'published-pm',
          '**Axis ① — real business need.**',
          '**Axis ① — PLACEHOLDER.**',
        );
        c = mutate(
          c, 'published-pm',
          '**Axis ② — long-term architectural soundness for *this* project.**',
          '**Axis ② — real business need.**',
        );
        return mutate(
          c, 'published-pm',
          '**Axis ① — PLACEHOLDER.**',
          '**Axis ① — long-term architectural soundness for *this* project.**',
        );
      },
      expect: 'red',
      wants: [/do not agree on the axis NAME SEQUENCE/, /long-term-soundness → business-need/],
    },
    {
      label: 'the binding sentence is removed → red (extraction failure, not a skip)',
      copies: () => mutate(
        base, 'published-pm',
        'Your recommendation must be justified on **all three** axes.',
        'Your recommendation should be sensible.',
      ),
      expect: 'red',
      wants: [/published-pm/, /BINDING sentence is not in place/],
    },
    {
      label: 'the declaring sentence is removed → red (extraction failure, not a skip)',
      copies: () => mutate(
        base, 'internal-dev',
        '**Analyze every option on three fixed axes',
        '**Weigh the options sensibly',
      ),
      expect: 'red',
      wants: [/internal-dev/, /could not extract the decision frame/],
    },
    {
      label: 'a frame count mention drifts from the frame → red',
      copies: () => mutate(
        base, 'published-pm',
        '#### The three-axis decision frame (binding)',
        '#### The two-axis decision frame (binding)',
      ),
      expect: 'red',
      wants: [/a mention of the frame states 2 axes while the frame itself has 3/],
    },
    {
      label: 'AXIS_MAP misaligned (zh patterns swapped) → red, proving the map is load-bearing',
      copies: () => base,
      axisMap: [
        { id: 'business-need', zh: AXIS_MAP[1].zh, en: AXIS_MAP[0].en },
        { id: 'long-term-soundness', zh: AXIS_MAP[0].zh, en: AXIS_MAP[1].en },
        AXIS_MAP[2],
      ],
      expect: 'red',
      wants: [/do not agree on the axis NAME SEQUENCE/],
    },
    {
      label: 'an undeclared fifth copy appears → red (anti-dormancy)',
      copies: () => base,
      extraScan: [{
        file: 'skills/objectstack-somethingelse/SKILL.md',
        text: 'Analyze every option on three fixed axes:\n- Real business need — ...\n',
      }],
      expect: 'red',
      wants: [/looks like ANOTHER copy of the decision frame/],
    },
    {
      // The anti-false-positive direction. #5451 route B generalized the published
      // copy on purpose: no startup self-description, no this-repo issue numbers.
      // (Since the 2026-08-12 principles-only rewrite the internal copy carries no
      // issue numbers either — check-skill-id-lint enforces that — so this fixture
      // mutates wording only.) A gate that reads wording as drift would be
      // reverted, so prove it does not.
      label: 'wording-only divergence (the #5451 generalization) → stays GREEN',
      copies: () => {
        let c = mutate(base, 'internal-pm', '长期代价', '长远代价');
        c = mutate(c, 'internal-pm', '创业项目', '项目');
        return mutate(c, 'internal-pm', '不作数', '不算证据');
      },
      expect: 'green',
    },
  ];

  let failed = 0;
  for (const c of cases) {
    let problems;
    try {
      const copies = c.copies();
      const scan = [...scanOf(copies), ...(c.extraScan ?? [])];
      problems = runAllChecks(copies, c.axisMap ?? AXIS_MAP, scan).problems;
    } catch (err) {
      console.error(`  ✗ ${c.label}\n      threw: ${err.message}`);
      failed += 1;
      continue;
    }
    const isRed = problems.length > 0;
    if (isRed !== (c.expect === 'red')) {
      failed += 1;
      console.error(
        `  ✗ ${c.label}\n      expected ${c.expect}, got ${isRed ? 'red' : 'green'}` +
        (isRed ? `\n      ${problems.join('\n      ')}` : ''),
      );
      continue;
    }
    const blob = problems.join('\n');
    const missing = (c.wants ?? []).filter((rx) => !rx.test(blob));
    if (missing.length > 0) {
      failed += 1;
      console.error(
        `  ✗ ${c.label}\n      red as expected, but the message does not name ` +
        `${missing.map((m) => `/${m.source}/`).join(', ')}\n      ${blob}`,
      );
      continue;
    }
    // A red for the WRONG reason is a failure too: it is how a diagnosis
    // regresses into "I could not find the section" (#5680).
    const wrongly = (c.unwanted ?? []).filter((rx) => rx.test(blob));
    if (wrongly.length > 0) {
      failed += 1;
      console.error(
        `  ✗ ${c.label}\n      red, but for the wrong reason — the message should NOT ` +
        `contain ${wrongly.map((m) => `/${m.source}/`).join(', ')}\n      ${blob}`,
      );
      continue;
    }
    console.log(`  ✓ ${c.label}`);
  }

  if (failed > 0) {
    console.error(`\n✗ check-skill-frame-sync self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ check-skill-frame-sync self-test: ${cases.length} cases pass.`);
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const copies = readCopies();
  const scanFiles = SCAN_ROOTS.flatMap((root) => walkMarkdown(root, []));
  const { problems, results, mentionCount } = runAllChecks(copies, AXIS_MAP, scanFiles);

  if (problems.length > 0) {
    report(problems);
    process.exit(1);
  }

  const axes = results[0].ids.join(' → ');
  const files = new Set(results.map((r) => r.copy.file)).size;
  console.log(
    `✓ check-skill-frame-sync: ${results.length} copies of the decision frame are ` +
    `structurally isomorphic across ${files} files\n` +
    `  ${results[0].declared} axes: ${axes}\n` +
    `  binding sentence present in all ${results.length}; ${mentionCount} count mention(s) agree; ` +
    `${scanFiles.length} markdown files scanned for undeclared copies.`,
  );
}

// Run the gate only when this file IS the entry point. Without the guard, the
// freshness gate's `import { COPIES, AXIS_MAP, analyzeCopy }` (#5866) would run
// this whole gate — and its `process.exit(1)` — as an import side effect. Same
// idiom as scripts/objectui-changeset-digest.mjs, which is imported the same way
// by scripts/check-objectui-pin-fresh.mjs.
if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  main();
}
