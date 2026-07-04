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
const README = path.resolve(SKILLS_DIR, 'README.md');
const GUIDE = path.resolve(REPO_ROOT, 'content/docs/ai/skills-reference.mdx');

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
  const file = path.resolve(SKILLS_DIR, name, 'SKILL.md');
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
    `ObjectStack ships **${skills.length} domain-specific skills**. Each is self-contained — an AI assistant loads only the ones a task needs.`,
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

  // Catalog ⇄ DISPLAY must be in lockstep.
  const onDisk = fs
    .readdirSync(SKILLS_DIR)
    .filter((d) => d.startsWith('objectstack-') && fs.existsSync(path.resolve(SKILLS_DIR, d, 'SKILL.md')));
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
