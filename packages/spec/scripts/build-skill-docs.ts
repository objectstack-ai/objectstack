// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build Skill Docs
 *
 * The catalog of AI skills (names, domains, "use when / do not use") lives in
 * exactly one place: the YAML frontmatter of each skill's `SKILL.md`.
 * Hand-maintained copies of that catalog drift — they have, repeatedly. This
 * script regenerates every derived listing from the frontmatter so there is a
 * single source of truth.
 *
 * Derived listings (rewritten between `<!-- BEGIN/END GENERATED: skills -->`
 * markers; prose outside the markers is preserved):
 *   - skills/README.md                      → the Index table
 *   - content/docs/ai/skills-reference.mdx        → Quick Reference table + per-skill cards
 *
 * Usage:
 *   tsx scripts/build-skill-docs.ts            # write
 *   tsx scripts/build-skill-docs.ts --check    # verify in sync (CI); exit 1 on drift
 */

import fs from 'fs';
import path from 'path';

// ── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SKILLS_DIR = path.resolve(REPO_ROOT, 'skills');
/** The file a child of the skills root must CARRY to be a skill (`:main` admits on it). */
const ENTRYPOINT_FILE = 'SKILL.md';
const README = path.resolve(SKILLS_DIR, 'README.md');
const GUIDE = path.resolve(REPO_ROOT, 'content/docs/ai/skills-reference.mdx');

/**
 * The population this script READS, declared for `scripts/pm/dispatch-gates.mjs`
 * — spelled as a LITERAL array because the hint extractor reads source TEXT (a
 * declaration computed from `SKILLS_DIR` would build no hint at all;
 * `scripts/check-watch-hint-literal.mjs` holds that spelling for every declarer
 * in the tree).
 *
 * ## What was declared before, and why it under-matched
 *
 * The only path literal this module body spelled was the GUIDE path,
 * `content/docs/ai/skills-reference.mdx` — an OUTPUT. So `check:skill-docs`
 * declared its generated artifact and not one of its inputs: a card editing a
 * skill entrypoint — the file whose frontmatter is the entire catalog — was
 * never told that this gate reads it, and `--check` reds in CI on drift the
 * derivation could have predicted.
 *
 * The inputs were not forgotten, they were unspellable AS ONE HINT: `SKILLS_DIR`
 * is built with `path.resolve(REPO_ROOT, 'skills')`, and a single-segment
 * literal is refused by the extractor as too generic to be a path population.
 *
 * ## Why NOT the subtree spelling, which is the idiom's usual escape
 *
 * `scripts/pm/bare-root-worklist.mjs` carries the measured triage for exactly
 * this root and refuses the wholesale hint: this script's population is 12 of
 * the 50 files tracked under it (24%), so `skills/**` would name this gate for
 * 38 files it never opens. That is the REFUSE-WIDE trade, and the worklist
 * prices a false wholesale hint as the costlier error.
 *
 * What the recorded refusal turned on is that no SINGLE spelling reaches both
 * halves: `:221` readdirs the root and admits a child only if it carries a
 * SKILL.md, while the twelfth file is the root README this script WRITES, which
 * sits outside every skill directory. Two literals reach both, and reach
 * nothing else — 12 of 12, precise AND complete — which is the declaration
 * below and why the row's verdict is withdrawn rather than the declaration.
 */
const DECLARED_WATCH_HINTS = ['skills/*/SKILL.md', 'skills/README.md'];

/**
 * The declaration above, held against the constants this script really reads
 * from. A hand-written path that agreed with the read only on the day it was
 * typed is the drift this idiom replaces, so the check derives what it compares
 * against from `SKILLS_DIR` and `README` — move either and this throws here, in
 * this file, instead of going quiet in a dispatch brief.
 */
function assertWatchHintsDeclareTheReadSurface(): void {
  const rel = (abs: string) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');
  const expected = [`${rel(SKILLS_DIR)}/*/${ENTRYPOINT_FILE}`, rel(README)];
  if (DECLARED_WATCH_HINTS.join('|') !== expected.join('|')) {
    throw new Error(
      `build-skill-docs: the declared watch-hint population ${JSON.stringify(DECLARED_WATCH_HINTS)} no longer ` +
        `names what this script reads (${JSON.stringify(expected)}) — update the declaration, as a LITERAL array.`,
    );
  }
  // …and it stays NARROW. A hint that reached the bare root would be the
  // wholesale claim the worklist refused, arriving through a reword.
  if (DECLARED_WATCH_HINTS.some((h) => h.endsWith('/**'))) {
    throw new Error(
      `build-skill-docs: the declaration must stay narrower than the root: ${JSON.stringify(DECLARED_WATCH_HINTS)}`,
    );
  }
}

// Marker comments delimit the generated region. MDX does not support HTML
// comments (`<!-- -->`) — it needs `{/* */}` — so the syntax is per file type.
type CommentStyle = 'html' | 'mdx';
function marks(style: CommentStyle): { begin: string; end: string } {
  const id = 'skills (packages/spec/scripts/build-skill-docs.ts) — DO NOT EDIT';
  return style === 'mdx'
    ? { begin: `{/* BEGIN GENERATED: ${id} */}`, end: `{/* END GENERATED: skills */}` }
    : { begin: `<!-- BEGIN GENERATED: ${id} -->`, end: `<!-- END GENERATED: skills -->` };
}

// ── Display config ───────────────────────────────────────────────────────────
// Presentation only (order + human label). The catalog itself is read from the
// SKILL.md frontmatter — adding a skill here without a SKILL.md, or vice-versa,
// is reported as an error so the two cannot silently diverge.

const DISPLAY: Array<{ name: string; label: string }> = [
  { name: 'objectstack-platform', label: 'Platform' },
  { name: 'objectstack-data', label: 'Data' },
  { name: 'objectstack-query', label: 'Query' },
  { name: 'objectstack-ui', label: 'UI' },
  { name: 'objectstack-automation', label: 'Automation' },
  { name: 'objectstack-ai', label: 'AI' },
  { name: 'objectstack-api', label: 'API' },
  { name: 'objectstack-i18n', label: 'i18n' },
  { name: 'objectstack-formula', label: 'Formula' },
  { name: 'objectstack-pm-dispatch', label: 'PM Dispatch' },
  { name: 'objectstack-upgrade', label: 'Upgrade' },
];

// ── Frontmatter parser ───────────────────────────────────────────────────────
// Narrow parser for the controlled SKILL.md frontmatter shape (folded `>`
// description + nested `metadata:` map). Avoids a YAML dependency, matching the
// sibling build-skill-references.ts.

interface Skill {
  name: string;
  label: string;
  anchor: string;
  domain: string;
  tags: string[];
  /** Prose before "Use when …". */
  summary: string;
  /** The "Use when …" clause (kept verbatim, leading words included). */
  useWhen: string;
  /** The "Do not use …" clause (kept verbatim, leading words included). */
  notFor: string;
}

function parseFrontmatter(name: string, label: string): Skill {
  const file = path.resolve(SKILLS_DIR, name, ENTRYPOINT_FILE);
  const raw = fs.readFileSync(file, 'utf-8');
  const parts = raw.split(/^---\s*$/m);
  if (parts.length < 3) throw new Error(`${name}: no YAML frontmatter`);
  const lines = parts[1].split('\n');

  let description = '';
  let domain = '';
  let tags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (/^description:\s*>/.test(lines[i])) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        buf.push(lines[i].trim());
        i++;
      }
      i--;
      description = buf.join(' ').replace(/\s+/g, ' ').trim();
    } else if (/^metadata:\s*$/.test(lines[i])) {
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        const m = lines[i].match(/^\s+(\w+):\s*(.*)$/);
        if (m && m[1] === 'domain') domain = m[2].replace(/['"]/g, '').trim();
        if (m && m[1] === 'tags') tags = m[2].split(',').map((t) => t.trim()).filter(Boolean);
        i++;
      }
      i--;
    }
  }

  if (!description) throw new Error(`${name}: missing description`);
  if (!domain) throw new Error(`${name}: missing metadata.domain`);

  // Split the description into summary / use-when / do-not-use, keeping each
  // clause verbatim (no paraphrasing — the frontmatter is the source).
  const useIdx = description.search(/\bUse when\b/);
  const notIdx = description.search(/\bDo not use\b/);
  const summary = (useIdx >= 0 ? description.slice(0, useIdx) : description).trim();
  const useWhen =
    useIdx >= 0 ? description.slice(useIdx, notIdx >= 0 ? notIdx : undefined).trim() : '';
  const notFor = notIdx >= 0 ? description.slice(notIdx).trim() : '';

  return {
    name,
    label,
    anchor: name.replace(/^objectstack-/, ''),
    domain,
    tags,
    summary,
    useWhen,
    notFor,
  };
}

// ── Renderers ────────────────────────────────────────────────────────────────

function renderReadmeBlock(skills: Skill[]): string {
  const { begin, end } = marks('html');
  const rows = skills.map(
    (s) => `| [${s.label}](./${s.name}/SKILL.md) | \`${s.domain}\` | ${s.summary} |`,
  );
  return [
    begin,
    '',
    `| Skill | Domain | What it covers |`,
    `|:------|:-------|:---------------|`,
    ...rows,
    '',
    end,
  ].join('\n');
}

function renderGuideBlock(skills: Skill[]): string {
  const { begin, end } = marks('mdx');
  const tableRows = skills.map(
    (s, i) =>
      `| ${i + 1} | [${s.label}](#${s.anchor}) | \`${s.domain}\` | \`skills/${s.name}/\` | ${s.summary} |`,
  );

  const cards = skills.flatMap((s) => {
    // No explicit `{#id}` — MDX would parse it as a JS expression. The heading
    // text auto-slugs (rehype-slug) to `s.anchor`, which the table links to.
    const lines = [
      `### ${s.label}`,
      '',
      `**Domain** \`${s.domain}\` · **Path** \`skills/${s.name}/\``,
      '',
      s.summary,
      '',
    ];
    if (s.useWhen) lines.push(s.useWhen, '');
    if (s.notFor) lines.push(s.notFor, '');
    if (s.tags.length) lines.push(`**Tags:** ${s.tags.map((t) => `\`${t}\``).join(', ')}`, '');
    lines.push('---', '');
    return lines;
  });

  return [
    begin,
    '',
    `ObjectStack ships **${skills.length} skills** — one per authoring domain, plus process skills for how a project is delivered. Each is self-contained: an AI assistant loads only the ones a task needs.`,
    '',
    '## Quick Reference',
    '',
    `| # | Skill | Domain | Path | What it covers |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
    ...tableRows,
    '',
    '---',
    '',
    ...cards,
    end,
  ].join('\n');
}

// ── Marker splice ────────────────────────────────────────────────────────────

function spliceBlock(file: string, block: string, style: CommentStyle): string {
  const { begin, end } = marks(style);
  const content = fs.readFileSync(file, 'utf-8');
  const b = content.indexOf(begin);
  const e = content.indexOf(end);
  if (b === -1 || e === -1 || e < b) {
    throw new Error(
      `${path.relative(REPO_ROOT, file)}: missing or malformed generated markers.\n` +
        `Add a "${begin}" / "${end}" pair where the generated listing should go.`,
    );
  }
  return content.slice(0, b) + block + content.slice(e + end.length);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const check = process.argv.includes('--check');

  assertWatchHintsDeclareTheReadSurface();

  // Catalog ⇄ DISPLAY must be in lockstep.
  const onDisk = fs
    .readdirSync(SKILLS_DIR)
    .filter((d) => d.startsWith('objectstack-') && fs.existsSync(path.resolve(SKILLS_DIR, d, ENTRYPOINT_FILE)));
  const configured = new Set(DISPLAY.map((d) => d.name));
  const missing = onDisk.filter((d) => !configured.has(d));
  const extra = DISPLAY.filter((d) => !onDisk.includes(d.name)).map((d) => d.name);
  if (missing.length || extra.length) {
    if (missing.length) console.error(`✗ SKILL.md without DISPLAY entry: ${missing.join(', ')}`);
    if (extra.length) console.error(`✗ DISPLAY entry without SKILL.md: ${extra.join(', ')}`);
    process.exit(1);
  }

  const skills = DISPLAY.map((d) => parseFrontmatter(d.name, d.label));

  const targets: Array<{ file: string; style: CommentStyle; render: (s: Skill[]) => string }> = [
    { file: README, style: 'html', render: renderReadmeBlock },
    { file: GUIDE, style: 'mdx', render: renderGuideBlock },
  ];

  let drift = false;
  for (const { file, style, render } of targets) {
    const next = spliceBlock(file, render(skills), style);
    const rel = path.relative(REPO_ROOT, file);
    if (check) {
      if (fs.readFileSync(file, 'utf-8') !== next) {
        console.error(`✗ ${rel} is out of date — run \`pnpm --filter @objectstack/spec gen:skill-docs\``);
        drift = true;
      } else {
        console.log(`✓ ${rel}`);
      }
    } else {
      fs.writeFileSync(file, next);
      console.log(`✅ ${rel}`);
    }
  }

  if (check && drift) process.exit(1);
  console.log(check ? '\n✅ Skill docs in sync' : `\n✅ Generated from ${skills.length} SKILL.md files`);
}

main();
