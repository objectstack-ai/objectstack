#!/usr/bin/env node
// check-agent-model-declared — asserts that every agent definition under
// .claude/agents/ declares a `model:` in its frontmatter (#6803).
//
// WHY THIS EXISTS. Claude Code resolves a subagent's model in four steps (verified
// 2026-08-09 against the subagent documentation, "Claude Code resolves the
// subagent's model in this order"): the `CLAUDE_CODE_SUBAGENT_MODEL` environment
// variable, when set → an explicit `model` argument on the dispatch call → the
// agent definition's frontmatter → **inherit from the parent session**. When the
// first three are absent the last always applies, silently. That makes "what
// model does this role run on" a property of whoever happened to dispatch it, at
// whatever moment their own session was on, rather than a property of the role —
// and it changes with no signal, mid-term, invisibly. (`CLAUDE_CODE_SUBAGENT_MODEL`
// outranks every other step, including this gate's own pin — see
// `.claude/agents/os-dev.md` for the full order and both adjacent traps.)
//
// A second, smaller nuance in that same order: a value blocked by the
// organization's `availableModels` allowlist does NOT fall back to the frontmatter
// pin below — it falls back to the INHERITED model, i.e. straight into the
// silent-inheritance failure mode this gate exists to catch.
//
// That is measured, not theoretical, and it fails in a shape worth naming:
//
//   • 2026-08-08, #6686: a PM seat dispatched four devs (#6629 #6585 #6566 #6569)
//     while its own session sat on a smaller model. All four died on the SAME
//     shared quota wall, at four different stages; three left uncommitted and
//     wholly ungated work behind in their worktrees. The failure is BATCHED — one
//     exhausted quota takes out the whole batch at once instead of degrading one
//     agent — and it is INVISIBLE to the dispatcher, whose pre-dispatch checks
//     have no reason to ask what model the batch will run on.
//   • The caller-side rule already existed and did not hold. `.claude/skills/
//     pm-dispatch/SKILL.md` §5 has carried "pass `model: \"opus\"` on every dev
//     dispatch" since before that incident. A seat that had read it still
//     dispatched twelve os-dev agents in a row without passing `model`, with no
//     signal that anything was wrong (#6803's services-lane comment). Prose in the
//     caller is not a mechanism; it is a thing to remember.
//
// PR #6688 fixed the instance by pinning `model: opus` in os-dev.md. This gate
// fixes the MECHANISM that let the slot be empty in the first place — the same
// division of labour as check:skill-compatibility (#5331) over #5245's hand-fix.
// The pin's own frontmatter comment ends "Removing this line puts it back"; until
// now nothing stopped that, and nothing at all covered the NEXT agent definition
// someone adds by copying an existing one and trimming the frontmatter.
//
// WHAT IT DOES NOT DO — deliberately. It does not assert WHICH model any agent
// declares. Which tier a role should run on is maintainer policy (#6803 puts
// changing it explicitly out of scope), and encoding "os-dev must be opus" here
// would mean a legitimate policy change has to edit a gate to land. The defect
// this gate exists for is the EMPTY slot, not the value in it. Presence is
// mechanical and objective; the tier is a decision, and decisions belong to the
// maintainer and to the file's own comment, not to a check script.
//
// `inherit` IS A LEGAL ANSWER — BUT IT MUST BE A WRITTEN ONE. Claude Code accepts
// `model: inherit`, which follows the caller deliberately. That is a legitimate
// design for some roles, and this gate must not force a false pin on them. But an
// inherit that nobody wrote a reason for is indistinguishable in effect from the
// bug above, so `inherit` is accepted only for files listed in INHERIT_JUSTIFIED
// below, each with a stated reason and a `rationale` regex that must still match
// the live file. Edit the justification away and the entry dies with it. That is
// the difference between "we thought about this file" and a silent hole — the
// same self-invalidating-exemption shape as check:skill-compatibility's EXEMPT.
//
// #4690 IS THE NAMED COUNTER-EXAMPLE: a gate that cannot find its input and exits
// 0 is worse than no gate, because it converts "nobody is looking" into "something
// is looking and it is fine". Every absence here is therefore RED, never a skip:
//   • .claude/agents/ missing entirely                        → red
//   • .claude/agents/ holding no .md file                     → red
//   • a definition with no frontmatter, or no `model:` key    → red
//   • a `model:` present but empty                            → red
//   • a value that is neither a known alias nor a model id    → red
//   • `inherit` with no entry in INHERIT_JUSTIFIED            → red
//   • an INHERIT_JUSTIFIED entry whose reason is gone, whose
//     file is unscanned, or whose file no longer inherits     → red
//
// LAYERING — why a root script and not a package filter: same reason as its
// neighbours check:skill-frame-sync and check:skill-compatibility. This gate
// generates nothing and reads no package source; it is repo-wide policy over
// hand-written frontmatter, which is what root scripts/ is for.
//
//   node scripts/check-agent-model-declared.mjs [--self-test]

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_DIR = '.claude/agents';

/**
 * Tier aliases Claude Code accepts in agent frontmatter. `inherit` is in the set
 * because it is a real, documented value — it is gated separately below, not by
 * being spelled illegal.
 */
const ALIASES = new Set(['opus', 'sonnet', 'haiku', 'inherit']);

/**
 * A fully-qualified model id, the other legal spelling (e.g. `claude-opus-4-5`).
 * Deliberately permissive about the tail: this gate has no business knowing which
 * model ids exist this month, and a gate that guesses at a vendor's id scheme goes
 * wrong on exactly the day someone ships a new one. It rejects typos of the
 * ALIASES ("opsu", "opus-5") without pretending to validate a catalogue.
 */
const MODEL_ID_RE = /^claude-[a-z0-9][a-z0-9.-]*$/;

/**
 * Files allowed to declare `model: inherit`, each with the reason it is correct for
 * that role and a regex that must still match the file's live text. An entry whose
 * justification has been edited out of the file stops applying, and the file falls
 * back to the normal rule.
 *
 * Empty today: `.claude/agents/os-dev.md` pins `opus` (#6686 / PR #6688) and is the
 * only agent definition in the tree. The list exists so that the FIRST role which
 * genuinely wants to follow its caller has a way to say so in writing, instead of
 * either lying with a pin or reopening the silent-inheritance hole.
 *
 * @type {{ file: string, why: string, rationale: RegExp }[]}
 */
export const INHERIT_JUSTIFIED = [];

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Extract the `model:` value from YAML frontmatter.
 *
 * Returns `{ ok: true, value }`, or `{ ok: false, reason }` — never a silent empty
 * string, so a parse miss is reportable as a parse miss rather than masquerading as
 * "declared nothing". Accepts the quoted spellings (`model: "opus"`, `model:
 * 'opus'`) because both are valid YAML and both appear in the wild; a model value
 * is always a plain scalar, so block scalars are not a case worth inventing.
 */
export function extractModel(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { ok: false, reason: 'no YAML frontmatter (file does not start with `---`)' };
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) {
    return { ok: false, reason: 'frontmatter is not terminated by a closing `---`' };
  }

  const body = lines.slice(1, end);
  // Top-level key only: `^model:` at column 0. An indented `model:` is a member of
  // some other key's mapping (or prose inside a folded `description:`) and is not
  // this file's model declaration.
  const keyIdx = body.findIndex((l) => /^model:/.test(l));
  if (keyIdx === -1) {
    return { ok: false, reason: 'frontmatter has no `model:` key' };
  }

  let inline = body[keyIdx].slice('model:'.length).trim();
  // Strip a trailing `# comment`, then matched quotes.
  inline = inline.replace(/\s+#.*$/, '').trim();
  const quoted = /^(['"])(.*)\1$/.exec(inline);
  if (quoted) inline = quoted[2].trim();

  if (inline === '') {
    return { ok: false, reason: '`model:` is present but empty' };
  }
  return { ok: true, value: inline };
}

// ---------------------------------------------------------------------------
// Checks (pure — the self-test drives these with in-memory inputs)
// ---------------------------------------------------------------------------

/**
 * @param files      [{ file, text }] — every discovered agent definition
 * @param justified  same shape as INHERIT_JUSTIFIED
 */
export function runAllChecks(files, justified = INHERIT_JUSTIFIED) {
  const problems = [];
  const results = [];

  // ---- input assertion (#4690): an empty scan is a failure, not a pass. ------
  if (files.length === 0) {
    problems.push(
      `no agent definitions found under ${AGENTS_DIR}/.\n` +
      `    This gate asserts that every agent definition declares a model; with no input\n` +
      `    it would otherwise exit 0 and report success while checking nothing (#4690).\n` +
      `    fix: run from the repo root, or fix the ${AGENTS_DIR}/ layout.`,
    );
    return { problems, results };
  }

  // ---- stale-entry sweep: a justification for a file that is not scanned is ---
  // dormant config that will silently outlive its subject.
  const scanned = new Set(files.map((f) => f.file));
  for (const j of justified) {
    if (!scanned.has(j.file)) {
      problems.push(
        `stale inherit justification: ${j.file} is on the INHERIT_JUSTIFIED list but was not found.\n` +
        `    reason on file: ${j.why}\n` +
        `    fix: delete the entry from INHERIT_JUSTIFIED in ` +
        `scripts/check-agent-model-declared.mjs, or restore the file.`,
      );
    }
  }

  const justifiedByFile = new Map(justified.map((j) => [j.file, j]));

  for (const { file, text } of files) {
    const got = extractModel(text);
    if (!got.ok) {
      problems.push(
        `${file}\n` +
        `    declares no model: ${got.reason}\n` +
        `    An agent definition with no \`model:\` INHERITS the dispatching session's model,\n` +
        `    so the role's tier becomes a property of whoever dispatched it and when (#6803).\n` +
        `    That failure is batched and invisible: four devs dispatched from one\n` +
        `    smaller-model session died together on a shared quota wall, three of them\n` +
        `    leaving ungated work behind (#6686).\n` +
        '    fix: add a frontmatter line such as `model: opus`. If this role is genuinely\n' +
        '         meant to follow its caller, write `model: inherit` AND add an entry to\n' +
        '         INHERIT_JUSTIFIED in scripts/check-agent-model-declared.mjs saying why.',
      );
      continue;
    }

    const value = got.value;
    const isAlias = ALIASES.has(value);
    if (!isAlias && !MODEL_ID_RE.test(value)) {
      problems.push(
        `${file}\n` +
        `    declares \`model: ${value}\`, which is neither a tier alias ` +
        `(${[...ALIASES].join(', ')})\n` +
        `    nor a fully-qualified model id (\`claude-…\`).\n` +
        `    A value the loader cannot resolve is the empty slot wearing a declaration:\n` +
        `    it reads as decided and behaves as undeclared.\n` +
        `    fix: correct the spelling to one of the aliases, or use a full model id.`,
      );
      continue;
    }

    const entry = justifiedByFile.get(file);
    if (value === 'inherit') {
      if (!entry) {
        problems.push(
          `${file}\n` +
          `    declares \`model: inherit\`, which follows the dispatching session's model —\n` +
          `    the exact behaviour #6803 exists to stop being silent. \`inherit\` is a legal\n` +
          `    answer for a role that genuinely should follow its caller, but it has to be a\n` +
          `    WRITTEN answer: an unexplained inherit is indistinguishable from the bug.\n` +
          `    fix: add an entry for this file to INHERIT_JUSTIFIED in\n` +
          `         scripts/check-agent-model-declared.mjs, with the reason and a rationale\n` +
          `         regex matching where that reason is written in the file. Or pin a tier.`,
        );
      } else if (!entry.rationale.test(text)) {
        problems.push(
          `${file}\n` +
          `    is allowed to declare \`model: inherit\` because: ${entry.why}\n` +
          `    but the file's text no longer states that justification ` +
          `(/${entry.rationale.source}/).\n` +
          `    fix: restore the written reason in the file, or remove the entry from\n` +
          `         INHERIT_JUSTIFIED and pin a tier instead.`,
        );
      }
    } else if (entry) {
      problems.push(
        `${file}\n` +
        `    is on the INHERIT_JUSTIFIED list yet declares \`model: ${value}\`, not \`inherit\`.\n` +
        `    The entry is doing no work and would silently permit the next unexplained\n` +
        `    inherit in this file.\n` +
        `    fix: delete this file's entry from INHERIT_JUSTIFIED in\n` +
        `         scripts/check-agent-model-declared.mjs.`,
      );
    }

    results.push({ file, value, inherit: value === 'inherit' });
  }

  return { problems, results };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Every `*.md` directly under .claude/agents/. Flat by design: that is the layout
 * the agent loader reads, so a nested file would not be loaded as an agent and
 * inventing a recursive walk here would assert over files nothing dispatches.
 */
export function readAgentFiles(root = REPO_ROOT) {
  const dir = join(root, AGENTS_DIR);
  if (!existsSync(dir)) {
    return {
      files: [],
      problems: [
        `${AGENTS_DIR}/ does not exist.\n` +
        `    fix: run from the repo root. If the agent definitions have genuinely moved,\n` +
        `         point AGENTS_DIR in scripts/check-agent-model-declared.mjs at the new\n` +
        `         location — do not delete the gate, or the next definition lands unchecked.`,
      ],
    };
  }

  const files = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue;
    files.push({ file: `${AGENTS_DIR}/${name}`, text: readFileSync(join(dir, name), 'utf8') });
  }
  return { files, problems: [] };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(problems) {
  console.error(
    `\n✗ check-agent-model-declared: ${problems.length} problem(s).\n\n` +
    problems.map((p) => `  • ${p}`).join('\n\n') +
    `\n\n  An agent definition that declares no \`model:\` inherits the dispatching\n` +
    `  session's model, so the role's tier is decided by whoever dispatched it rather\n` +
    `  than by the role. See #6803 (the declaration) and #6686 / PR #6688 (the\n` +
    `  incident: one quota wall, four devs, three ungated worktrees).\n`,
  );
}

// ---------------------------------------------------------------------------
// Self-test — pins the RED paths so the gate cannot rot into a no-op.
// ---------------------------------------------------------------------------

function selfTest() {
  const fm = (modelLine) =>
    `---\nname: demo\ndescription: >\n  A demo agent.\n${modelLine ? `${modelLine}\n` : ''}---\n\nBody.\n`;

  const okFile = (model = 'model: opus') => ({ file: `${AGENTS_DIR}/os-dev.md`, text: fm(model) });

  const inheritEntry = {
    file: `${AGENTS_DIR}/os-scout.md`,
    why: 'read-only reconnaissance role — deliberately mirrors the caller',
    rationale: /deliberately mirrors the caller/i,
  };
  const inheritFile = (justifyText = 'This role deliberately mirrors the caller.') => ({
    file: `${AGENTS_DIR}/os-scout.md`,
    text: `${fm('model: inherit')}\n${justifyText}\n`,
  });

  const cases = [
    {
      label: 'a definition pinning a tier alias → GREEN',
      files: [okFile()],
      expect: 'green',
    },
    {
      label: 'a definition pinning a fully-qualified model id → GREEN',
      files: [okFile('model: claude-opus-4-5')],
      expect: 'green',
    },
    {
      label: 'a quoted value → GREEN (both YAML spellings are legal)',
      files: [okFile('model: "opus"')],
      expect: 'green',
    },
    {
      label: 'a value with a trailing comment → GREEN',
      files: [okFile('model: opus  # maintainer policy')],
      expect: 'green',
    },
    {
      // THE REGRESSION THIS GATE EXISTS FOR: os-dev.md's own pre-#6688 state.
      label: 'R1 — frontmatter with name+description and NO model: → RED',
      files: [{ file: `${AGENTS_DIR}/os-dev.md`, text: fm('') }],
      expect: 'red',
      wants: [/frontmatter has no `model:` key/, /INHERITS the dispatching session/],
    },
    {
      label: 'R2 — `model:` present but empty → RED',
      files: [okFile('model:')],
      expect: 'red',
      wants: [/present but empty/],
    },
    {
      label: 'R3 — no frontmatter at all → RED',
      files: [{ file: `${AGENTS_DIR}/os-dev.md`, text: '# just a heading\n' }],
      expect: 'red',
      wants: [/no YAML frontmatter/],
    },
    {
      label: 'R4 — unterminated frontmatter → RED',
      files: [{ file: `${AGENTS_DIR}/os-dev.md`, text: '---\nname: demo\nmodel: opus\n' }],
      expect: 'red',
      wants: [/not terminated by a closing/],
    },
    {
      label: 'R5 — a typo of a tier alias → RED (declared-looking, undeclared in effect)',
      files: [okFile('model: opsu')],
      expect: 'red',
      wants: [/neither a tier alias/],
    },
    {
      label: 'R5b — an alias with a version suffix is not an alias → RED',
      files: [okFile('model: opus-5')],
      expect: 'red',
      wants: [/neither a tier alias/],
    },
    {
      label: 'R6 — `model: inherit` with nothing justifying it → RED',
      files: [inheritFile()],
      expect: 'red',
      wants: [/has to be a\n {4}WRITTEN answer/],
    },
    {
      label: 'R6b — `model: inherit` WITH a justification entry whose reason is in the file → GREEN',
      files: [inheritFile()],
      justified: [inheritEntry],
      expect: 'green',
    },
    {
      label: 'R7 — a justified inherit whose written reason was edited away → RED (self-invalidating)',
      files: [inheritFile('This role does whatever it likes.')],
      justified: [inheritEntry],
      expect: 'red',
      wants: [/no longer states that justification/],
    },
    {
      label: 'R8 — a justification entry naming an unscanned file → RED (anti-dormancy)',
      files: [okFile()],
      justified: [inheritEntry],
      expect: 'red',
      wants: [/stale inherit justification/],
    },
    {
      label: 'R9 — a justification entry on a file that now pins a tier → RED (dead config)',
      files: [{ file: inheritEntry.file, text: fm('model: opus') }],
      justified: [inheritEntry],
      expect: 'red',
      wants: [/is on the INHERIT_JUSTIFIED list yet declares/],
    },
    {
      label: 'R10 — an empty scan → RED, never a green skip (#4690, the whole point)',
      files: [],
      expect: 'red',
      wants: [/no agent definitions found/],
    },
    {
      label: 'one bad definition among several → RED, naming the bad one only',
      files: [okFile(), { file: `${AGENTS_DIR}/os-other.md`, text: fm('') }],
      expect: 'red',
      wants: [/os-other\.md/],
    },
    {
      // Anti-false-positive: an indented `model:` inside a folded description is
      // prose, not this file's declaration, and must not satisfy the rule.
      label: 'an indented `model:` inside description prose does NOT satisfy the rule → RED',
      files: [{
        file: `${AGENTS_DIR}/os-dev.md`,
        text: '---\nname: demo\ndescription: >\n  Talks about the model: opus thing.\n---\n\nBody.\n',
      }],
      expect: 'red',
      wants: [/frontmatter has no `model:` key/],
    },
  ];

  let failed = 0;
  for (const c of cases) {
    let problems;
    try {
      ({ problems } = runAllChecks(c.files, c.justified ?? []));
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
    console.log(`  ✓ ${c.label}`);
  }

  // Discovery-level assertions. These are about the filesystem walk itself, so they
  // get a fixture tree and then the real tree.
  const fixture = mkdtempSync(join(tmpdir(), 'agent-model-'));
  try {
    mkdirSync(join(fixture, AGENTS_DIR), { recursive: true });
    writeFileSync(join(fixture, AGENTS_DIR, 'os-dev.md'), fm('model: opus'));
    writeFileSync(join(fixture, AGENTS_DIR, 'notes.txt'), 'not an agent definition');
    const d = readAgentFiles(fixture);
    if (d.files.length !== 1 || d.files[0].file !== `${AGENTS_DIR}/os-dev.md`) {
      failed += 1;
      console.error(`  ✗ discovery picks up .md only\n      got ${JSON.stringify(d.files.map((f) => f.file))}`);
    } else {
      console.log('  ✓ discovery picks up *.md only (a stray .txt is not an agent definition)');
    }

    const missingDir = readAgentFiles(mkdtempSync(join(tmpdir(), 'agent-model-empty-')));
    if (missingDir.files.length !== 0 || !missingDir.problems.some((p) => /does not exist/.test(p))) {
      failed += 1;
      console.error('  ✗ a tree with no .claude/agents/ must report a layout problem, not an empty pass');
    } else {
      console.log('  ✓ a tree with no .claude/agents/ → RED at discovery (#4690)');
    }

    const emptyDir = mkdtempSync(join(tmpdir(), 'agent-model-nofiles-'));
    mkdirSync(join(emptyDir, AGENTS_DIR), { recursive: true });
    const none = readAgentFiles(emptyDir);
    if (none.files.length !== 0 || runAllChecks(none.files, []).problems.length === 0) {
      failed += 1;
      console.error('  ✗ an .claude/agents/ holding no .md must turn RED through runAllChecks');
    } else {
      console.log('  ✓ .claude/agents/ present but holding no .md → RED via the empty-scan assertion');
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  const disc = readAgentFiles();
  if (disc.files.length === 0) {
    failed += 1;
    console.error('  ✗ real-tree discovery found no agent definition — the gate would be scanning nothing');
  } else {
    console.log(`  ✓ real-tree discovery: ${disc.files.length} agent definition(s), ${disc.problems.length} layout problem(s)`);
  }

  if (failed > 0) {
    console.error(`\n✗ check-agent-model-declared self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`\n✓ check-agent-model-declared self-test: ${cases.length} cases pass.`);
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const { files, problems: layout } = readAgentFiles();
  const { problems, results } = runAllChecks(files, INHERIT_JUSTIFIED);

  const all = [...layout, ...problems];
  if (all.length > 0) {
    report(all);
    process.exit(1);
  }

  const inheriting = results.filter((r) => r.inherit).length;
  console.log(
    `✓ check-agent-model-declared: ${results.length} agent definition(s) under ${AGENTS_DIR}/ ` +
    `all declare a model\n` +
    `  ${results.map((r) => `${r.file.replace(`${AGENTS_DIR}/`, '')} → ${r.value}`).join(', ')}\n` +
    `  ${inheriting} justified inherit(s); no definition leaves its tier to the dispatching session.`,
  );
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  main();
}
