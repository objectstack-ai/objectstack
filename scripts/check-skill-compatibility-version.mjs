#!/usr/bin/env node
// check-skill-compatibility-version — reconciles the `compatibility:` line of every
// published SKILL.md against the workspace's real package versions (#5331).
//
// WHY THIS EXISTS. `compatibility` is a skill's only self-declared applicability
// range, and it ships to third parties verbatim via `npx skills add
// objectstack-ai/objectstack/skills`. Nothing compared it to reality, so it drifted
// a whole major: while the repo was on `@objectstack/spec@17.0.0-rc.2` — a major
// whose headline is REMOVAL (seven `App` keys, 31 `DriverCapabilities` bits,
// `restServer.openApi31`, the plugin-runtime family, all tombstones or TS2305) —
// nine of ten SKILL.md files still declared `Requires @objectstack/spec 16.x`
// (#5245). The skills taught 17 and called themselves 16, in both directions
// wrongly: a 16.x reader copies declarations that 16 hard-rejects, and a 17.x
// reader discounts the very text they should trust.
//
// The three existing skill gates were all green through that entire drift, by
// construction: `check:skill-docs` / `check:skill-refs` compare only GENERATED
// artifacts against packages/spec/src, and `check:skill-examples` only typechecks
// fenced blocks tagged `os:check`. None of them reads this line. #5245 fixed the
// values by hand; this gate fixes the MECHANISM that let them rot — that division
// of labour is exactly why #5331 was split out of #5245 rather than folded into it.
//
// THE CONTRACT IT ENFORCES IS THE ONE THAT LANDED, NOT THE ONE #5245 IMAGINED.
// #5245 offered three wordings and deliberately refused to choose: (①) rewrite to
// `17.x`, (②) an unpinned range like `>= 17`, (③) this gate. What actually landed
// on main is ① — an exact major pin, spelled `Requires @objectstack/spec 17.x
// (Zod v4 schemas)`. So this gate reconciles an exact major. Had ② landed, an
// exact-major gate would have been red on day one; if ② is ever adopted later,
// this gate goes RED rather than quietly passing (see NO_PINS_AT_ALL below), which
// forces the wording change to be a decision instead of an erosion.
//
// #4690 IS THE NAMED COUNTER-EXAMPLE: a gate that cannot find its input and exits 0
// is worse than no gate, because it converts "nobody is looking" into "something is
// looking and it is fine". Every absence here is therefore RED, never a skip:
//   • skills/ missing, or holding no skill directory                → red
//   • a skill directory with no SKILL.md                            → red
//   • a SKILL.md with no frontmatter, or no `compatibility:` key    → red
//   • a non-exempt file declaring no pinned major                   → red
//   • ZERO pinned majors found across the whole repo                → red
//   • an exemption whose written justification no longer holds      → red
// The last two are the ones that matter most: they are what stop this gate from
// decaying into a no-op the day someone reflows the wording.
//
// EXEMPTIONS ARE NAMED, JUSTIFIED, AND SELF-INVALIDATING. Two SKILL.md files
// deliberately pin no major, for two different and legitimate reasons, and both are
// written down in EXEMPT below with a `rationale` regex that must still match the
// live text. If the justification is edited away, the exemption dies with it and
// the file falls back to the normal rule. An exemption never covers a pinned claim:
// exempt files' pins, if they ever grow any, are reconciled like everyone else's.
// This is the difference between "we thought about this file" and a silent hole.
//
// LAYERING — why a root script and not `pnpm --filter @objectstack/spec`: same
// reason as its neighbour check:skill-frame-sync. The spec package's skill gates are
// GENERATORS whose source is packages/spec/src and whose output is in its
// check:generated ledger. This gate generates nothing and reads no spec source; it
// compares hand-written frontmatter against every workspace package.json, which is
// repo-wide knowledge the spec package has no business holding. Repo-wide policy
// gates over prose live in root scripts/ (check:role-word, check:doc-authoring,
// check:nul-bytes all scan skills/ from here).
//
//   node scripts/check-skill-compatibility-version.mjs [--self-test]

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = 'skills';

// Roots holding workspace package.json files. The declared package name (not the
// directory name) is what a `compatibility:` line cites, so the map is keyed by
// name — `@objectstack/spec` happens to live in packages/spec, but nothing
// guarantees that for the next package someone cites.
const PACKAGE_ROOTS = ['packages', 'apps', 'examples'];

/**
 * A `compatibility:` pin, e.g. `@objectstack/spec 17.x`.
 *
 * Deliberately narrow: the major, a literal `.x`. It does NOT match a bare mention
 * (`@objectstack/cli` in prose) or a prose protocol number ("protocol 10 at the time
 * of writing"), both of which appear in the exempt files and neither of which is a
 * version claim about this workspace.
 */
const PIN_RE = /@objectstack\/([a-z0-9][a-z0-9-]*)\s+(\d+)\.x/g;

/** Any mention of a workspace-scoped package, pinned or not. */
const MENTION_RE = /@objectstack\/([a-z0-9][a-z0-9-]*)/g;

/**
 * Files allowed to declare no pinned major.
 *
 * `rationale` is not decoration — it is re-matched against the live `compatibility:`
 * text on every run. An exemption whose stated reason has been edited away stops
 * applying, so this list cannot quietly outlive the thing it describes.
 */
const EXEMPT = [
  {
    file: 'skills/objectstack-pm-dispatch/SKILL.md',
    // A process skill: it drives a GitHub backlog and imports nothing from the
    // workspace, so there is no major to be compatible WITH. Its compatibility text
    // says so in as many words, and that self-declaration is the exemption's warrant.
    why: 'process skill with no @objectstack/spec dependency — it declares so explicitly',
    rationale: /No\s+@objectstack\/spec\s+dependency/i,
  },
  {
    file: 'skills/objectstack-upgrade/SKILL.md',
    // The cross-major upgrade skill. Pinning it to the current major would be
    // actively wrong: its whole job is to carry a project ACROSS majors, so it is
    // correct at whatever the target major happens to be. Its text says "at the
    // TARGET major" for exactly this reason.
    why: 'cross-major upgrade skill — correct at the TARGET major, so a current-major pin would be wrong',
    rationale: /at\s+the\s+TARGET\s+major/i,
  },
];

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Extract the `compatibility:` value from YAML frontmatter, supporting both spellings
 * in the tree: an inline scalar (`compatibility: Requires ... 17.x`) and a folded
 * block (`compatibility: >` followed by indented continuation lines).
 *
 * Returns `{ ok: true, value }`, or `{ ok: false, reason }` — never a silent empty
 * string, so a parse miss is reportable as a parse miss rather than masquerading as
 * "declared nothing".
 */
export function extractCompatibility(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { ok: false, reason: 'no YAML frontmatter (file does not start with `---`)' };
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) {
    return { ok: false, reason: 'frontmatter is not terminated by a closing `---`' };
  }

  const body = lines.slice(1, end);
  const keyIdx = body.findIndex((l) => /^compatibility:/.test(l));
  if (keyIdx === -1) {
    return { ok: false, reason: 'frontmatter has no `compatibility:` key' };
  }

  const inline = body[keyIdx].slice('compatibility:'.length).trim();
  // Folded (`>`) or literal (`|`) block scalars, with any chomping indicator.
  if (/^[>|][+-]?$/.test(inline)) {
    const collected = [];
    for (let i = keyIdx + 1; i < body.length; i += 1) {
      const line = body[i];
      if (line.trim() === '') { collected.push(''); continue; }
      if (!/^\s/.test(line)) break; // dedented to column 0 → next key
      collected.push(line.trim());
    }
    const value = collected.join(' ').trim();
    if (value === '') {
      return { ok: false, reason: '`compatibility:` opens a block scalar but the block is empty' };
    }
    return { ok: true, value };
  }

  if (inline === '') {
    return { ok: false, reason: '`compatibility:` is present but empty' };
  }
  return { ok: true, value: inline };
}

// ---------------------------------------------------------------------------
// Checks (pure — the self-test drives these with in-memory inputs)
// ---------------------------------------------------------------------------

function majorOf(version) {
  const m = /^(\d+)\./.exec(String(version));
  return m ? Number(m[1]) : null;
}

/**
 * @param files   [{ file, text }]           — every discovered SKILL.md
 * @param pkgs    Map<name, {version, file}> — workspace packages by declared name
 * @param exempt  same shape as EXEMPT
 */
export function runAllChecks(files, pkgs, exempt = EXEMPT) {
  const problems = [];
  const results = [];
  let pinCount = 0;

  // ---- input assertions (#4690): an empty scan is a failure, not a pass. -----
  if (files.length === 0) {
    problems.push(
      `no SKILL.md files found under ${SKILLS_DIR}/.\n` +
      `    This gate reconciles skill version declarations; with no input it would ` +
      `otherwise exit 0 and\n    report success while checking nothing (#4690).\n` +
      `    fix: run from the repo root, or fix the ${SKILLS_DIR}/ layout.`,
    );
    return { problems, results, pinCount };
  }
  if (pkgs.size === 0) {
    problems.push(
      `no workspace package.json files found under ${PACKAGE_ROOTS.join('/, ')}/.\n` +
      `    Without them there is nothing to reconcile against (#4690).`,
    );
    return { problems, results, pinCount };
  }

  const exemptByFile = new Map(exempt.map((e) => [e.file, e]));

  // ---- stale-exemption sweep: an exemption for a file that is not scanned is ----
  // dormant config that will silently outlive its subject.
  const scanned = new Set(files.map((f) => f.file));
  for (const e of exempt) {
    if (!scanned.has(e.file)) {
      problems.push(
        `stale exemption: ${e.file} is on the exemption list but was not found.\n` +
        `    reason on file: ${e.why}\n` +
        `    fix: delete the entry from EXEMPT in scripts/check-skill-compatibility-version.mjs, ` +
        `or restore the file.`,
      );
    }
  }

  for (const { file, text } of files) {
    const got = extractCompatibility(text);
    if (!got.ok) {
      problems.push(
        `${file}\n` +
        `    cannot read a compatibility declaration: ${got.reason}\n` +
        `    Every published skill must declare the majors it applies to — that line is ` +
        `a skill's only\n    self-described applicability range (#5245).\n` +
        `    fix: add a frontmatter line such as ` +
        '`compatibility: Requires @objectstack/spec <major>.x (Zod v4 schemas)`.',
      );
      continue;
    }

    const value = got.value;
    const pins = [...value.matchAll(PIN_RE)].map((m) => ({ pkg: `@objectstack/${m[1]}`, major: Number(m[2]) }));
    const mentions = [...value.matchAll(MENTION_RE)].map((m) => `@objectstack/${m[1]}`);
    const exemption = exemptByFile.get(file);
    pinCount += pins.length;

    // ---- pins are ALWAYS reconciled, exempt or not. An exemption covers the
    // absence of a pin, never the correctness of one that exists.
    for (const pin of pins) {
      const actual = pkgs.get(pin.pkg);
      if (!actual) {
        problems.push(
          `${file}\n` +
          `    declares ${pin.pkg} ${pin.major}.x, but no workspace package is named ${pin.pkg}\n` +
          `    fix: correct the package name, or drop the claim if the package no longer exists.`,
        );
        continue;
      }
      const actualMajor = majorOf(actual.version);
      if (actualMajor === null) {
        problems.push(
          `${file}\n` +
          `    declares ${pin.pkg} ${pin.major}.x, but ${actual.file} has an unparseable ` +
          `version "${actual.version}"`,
        );
        continue;
      }
      if (actualMajor !== pin.major) {
        problems.push(
          `${file}\n` +
          `    declared: ${pin.pkg} ${pin.major}.x   (frontmatter \`compatibility:\`)\n` +
          `    actual:   ${pin.pkg} ${actual.version}  → major ${actualMajor}   (${actual.file})\n` +
          `    fix: edit the \`compatibility:\` line to read "${pin.pkg} ${actualMajor}.x".\n` +
          `    This is the drift #5245 found by hand: skills taught ${actualMajor} while ` +
          `declaring ${pin.major}.`,
        );
      }
    }

    if (exemption) {
      // The exemption must still be true of the live text, or it stops applying.
      if (!exemption.rationale.test(value)) {
        problems.push(
          `${file}\n` +
          `    is exempt from the "must pin a major" rule because: ${exemption.why}\n` +
          `    but its compatibility text no longer matches that justification ` +
          `(/${exemption.rationale.source}/).\n` +
          `    declared: ${value}\n` +
          `    fix: restore the justification in the text, or remove the file's entry from ` +
          `EXEMPT and\n         declare a real major pin.`,
        );
      }
      if (pins.length > 0) {
        problems.push(
          `${file}\n` +
          `    is on the EXEMPT list (no-pin allowed) yet now declares a pinned major ` +
          `(${pins.map((p) => `${p.pkg} ${p.major}.x`).join(', ')}).\n` +
          `    The exemption is doing no work and would hide the next unpinned mention.\n` +
          `    fix: delete this file's entry from EXEMPT in ` +
          `scripts/check-skill-compatibility-version.mjs.`,
        );
      }
      results.push({ file, value, pins, exempt: true });
      continue;
    }

    if (pins.length === 0) {
      problems.push(
        `${file}\n` +
        `    declares no pinned major. declared: ${value}\n` +
        `    Expected a pin of the form "@objectstack/<pkg> <major>.x" — the wording that ` +
        `landed for #5245.\n` +
        `    fix: write e.g. "Requires @objectstack/spec ` +
        `${majorOf(pkgs.get('@objectstack/spec')?.version) ?? '<major>'}.x (Zod v4 schemas)", ` +
        `or add a\n         justified entry to EXEMPT if this skill genuinely has no ` +
        `version dependency.`,
      );
      results.push({ file, value, pins, exempt: false });
      continue;
    }

    // A half-pinned line is the quiet hole: one pin satisfies "has a pin" while a
    // second package rides along unchecked.
    const unpinned = mentions.filter((name) => !pins.some((p) => p.pkg === name));
    for (const name of [...new Set(unpinned)]) {
      problems.push(
        `${file}\n` +
        `    mentions ${name} without a "<major>.x" pin. declared: ${value}\n` +
        `    An unpinned mention is unreconcilable, so it would drift silently beside its ` +
        `pinned neighbours.\n` +
        `    fix: write "${name} ${majorOf(pkgs.get(name)?.version) ?? '<major>'}.x", or drop ` +
        `the mention.`,
      );
    }

    results.push({ file, value, pins, exempt: false });
  }

  // ---- the anti-no-op assertion. If the wording is ever changed wholesale (e.g.
  // to #5245's option ②, an unpinned range like ">= 17"), every file stops matching
  // PIN_RE and this gate would have nothing to compare — the exact shape of a gate
  // rotting into a green no-op. Fail loudly and make it a decision.
  if (pinCount === 0 && problems.length === 0) {
    problems.push(
      `not one "@objectstack/<pkg> <major>.x" pin was found in any of ${files.length} ` +
      `SKILL.md file(s).\n` +
      `    This gate compares pinned majors; with zero pins it is a no-op reporting ` +
      `success (#4690).\n` +
      `    If the compatibility wording was deliberately changed to an unpinned range ` +
      `(#5245 option ②),\n    then this gate's contract changed with it — update PIN_RE ` +
      `and this assertion together,\n    rather than leaving a green gate that checks nothing.`,
    );
  }

  return { problems, results, pinCount };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function readSkillFiles(root = REPO_ROOT) {
  const dir = join(root, SKILLS_DIR);
  if (!existsSync(dir)) return { files: [], problems: [`${SKILLS_DIR}/ does not exist`] };

  const problems = [];
  const files = [];
  const entries = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort();
  for (const name of entries) {
    const rel = `${SKILLS_DIR}/${name}/SKILL.md`;
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      // A skill directory without a SKILL.md is either a broken skill or a layout
      // change this gate must not scan past in silence.
      problems.push(
        `${SKILLS_DIR}/${name}/ has no SKILL.md.\n` +
        `    fix: add one, or remove the directory.`,
      );
      continue;
    }
    files.push({ file: rel, text: readFileSync(abs, 'utf8') });
  }
  return { files, problems };
}

function readWorkspacePackages(root = REPO_ROOT) {
  const pkgs = new Map();
  const walk = (abs, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const child = join(abs, e.name);
      if (e.isDirectory()) {
        const manifest = join(child, 'package.json');
        if (existsSync(manifest)) {
          try {
            const json = JSON.parse(readFileSync(manifest, 'utf8'));
            if (json.name && json.version && !pkgs.has(json.name)) {
              pkgs.set(json.name, { version: json.version, file: relative(root, manifest) });
            }
          } catch { /* an unparseable manifest is another gate's problem */ }
        }
        walk(child, depth + 1);
      }
    }
  };
  for (const r of PACKAGE_ROOTS) {
    const abs = join(root, r);
    if (existsSync(abs)) walk(abs, 1);
  }
  return pkgs;
}

function report(problems) {
  console.error(
    `\n✗ check-skill-compatibility-version: ${problems.length} problem(s).\n\n` +
    problems.map((p) => `  • ${p}`).join('\n\n') +
    `\n\n  The \`compatibility:\` line is a skill's only self-declared applicability range, ` +
    `and it ships\n  verbatim to third parties via \`npx skills add ` +
    `objectstack-ai/objectstack/skills\`. See #5331 / #5245.\n`,
  );
}

// ---------------------------------------------------------------------------
// Self-test — pins the RED paths so the gate cannot rot into a no-op.
// ---------------------------------------------------------------------------

function selfTest() {
  console.log('check-skill-compatibility-version self-test\n');

  const PKGS = new Map([
    ['@objectstack/spec', { version: '17.0.0-rc.5', file: 'packages/spec/package.json' }],
    ['@objectstack/core', { version: '17.0.0-rc.5', file: 'packages/core/package.json' }],
    ['@objectstack/formula', { version: '17.0.0-rc.5', file: 'packages/formula/package.json' }],
  ]);

  const fm = (compat) => `---\nname: x\nlicense: Apache-2.0\n${compat}\nmetadata:\n  author: objectstack-ai\n---\n\n# body\n`;
  const ok = (n = 'skills/objectstack-ai/SKILL.md') => ({
    file: n, text: fm('compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)'),
  });
  const exemptDispatch = {
    file: 'skills/objectstack-pm-dispatch/SKILL.md',
    text: fm('compatibility: >\n  No @objectstack/spec dependency — process skill. Needs a GitHub repository\n  with issues enabled.'),
  };
  const exemptUpgrade = {
    file: 'skills/objectstack-upgrade/SKILL.md',
    text: fm('compatibility: >\n  Needs `@objectstack/spec` and `@objectstack/cli` at the TARGET major\n  (protocol 10 at the time of writing).'),
  };

  const cases = [
    {
      label: 'the landed wording (exact 17.x pin) → GREEN',
      files: [ok(), exemptDispatch, exemptUpgrade],
      expect: 'green',
    },
    {
      label: 'R1 — a stale major (17.x → 16.x, the #5245 drift) → RED naming file/declared/actual/fix',
      files: [{ file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/spec 16.x (Zod v4 schemas)') }, exemptDispatch, exemptUpgrade],
      expect: 'red',
      wants: [
        /skills\/objectstack-ai\/SKILL\.md/,
        /declared: @objectstack\/spec 16\.x/,
        /actual:\s+@objectstack\/spec 17\.0\.0-rc\.5/,
        /fix: edit the `compatibility:` line to read "@objectstack\/spec 17\.x"/,
      ],
    },
    {
      label: 'R3 — no `compatibility:` key at all → RED (absence is never a skip, #4690)',
      files: [{ file: 'skills/objectstack-ai/SKILL.md', text: '---\nname: x\n---\n\n# body\n' }, exemptDispatch, exemptUpgrade],
      expect: 'red',
      wants: [/no `compatibility:` key/],
    },
    {
      label: 'an empty `compatibility:` value → RED',
      files: [{ file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility:') }, exemptDispatch, exemptUpgrade],
      expect: 'red',
      wants: [/present but empty/],
    },
    {
      label: 'no frontmatter at all → RED',
      files: [{ file: 'skills/objectstack-ai/SKILL.md', text: '# just a heading\n' }, exemptDispatch, exemptUpgrade],
      expect: 'red',
      wants: [/no YAML frontmatter/],
    },
    {
      label: 'R4 — wording switched to an unpinned range (#5245 option ②) → RED, not a silent no-op',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/spec >= 17') },
        exemptDispatch, exemptUpgrade,
      ],
      expect: 'red',
      // The per-file "no pinned major" fires first; both are the same refusal to
      // pass on zero comparable input.
      wants: [/declares no pinned major/],
    },
    {
      label: 'R4b — zero pins repo-wide with every file exempt → RED via the anti-no-op assertion',
      files: [exemptDispatch, exemptUpgrade],
      expect: 'red',
      wants: [/not one "@objectstack\/<pkg> <major>\.x" pin was found/],
    },
    {
      label: 'R5 — an exemption naming a file that is not scanned → RED (anti-dormancy)',
      files: [ok(), exemptDispatch],
      expect: 'red',
      wants: [/stale exemption: skills\/objectstack-upgrade\/SKILL\.md/],
    },
    {
      label: 'R7 — an exempt file whose written justification is gone → RED (exemption self-invalidates)',
      files: [
        ok(),
        { file: 'skills/objectstack-pm-dispatch/SKILL.md', text: fm('compatibility: >\n  Needs a GitHub repository with issues enabled.') },
        exemptUpgrade,
      ],
      expect: 'red',
      wants: [/no longer matches that justification/],
    },
    {
      label: 'an exempt file that grows a pin → RED (the exemption is now dead config)',
      files: [
        ok(),
        { file: 'skills/objectstack-pm-dispatch/SKILL.md', text: fm('compatibility: >\n  No @objectstack/spec dependency — process skill, but @objectstack/core 17.x.') },
        exemptUpgrade,
      ],
      expect: 'red',
      wants: [/is on the EXEMPT list \(no-pin allowed\) yet now declares a pinned major/],
    },
    {
      label: 'an exempt file whose pin is ALSO wrong → RED on the pin (exemptions never cover a claim)',
      files: [
        ok(),
        { file: 'skills/objectstack-pm-dispatch/SKILL.md', text: fm('compatibility: >\n  No @objectstack/spec dependency — process skill, but @objectstack/core 16.x.') },
        exemptUpgrade,
      ],
      expect: 'red',
      wants: [/declared: @objectstack\/core 16\.x/],
    },
    {
      label: 'R8 — a half-pinned line (one pinned, one bare mention) → RED on the bare one',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/spec 17.x and @objectstack/core') },
        exemptDispatch, exemptUpgrade,
      ],
      expect: 'red',
      wants: [/mentions @objectstack\/core without a "<major>\.x" pin/],
    },
    {
      label: 'a pin naming a package the workspace does not have → RED',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/nonesuch 17.x') },
        exemptDispatch, exemptUpgrade,
      ],
      expect: 'red',
      wants: [/no workspace package is named @objectstack\/nonesuch/],
    },
    {
      label: 'R6 — an empty scan → RED, never a green skip (#4690, the whole point)',
      files: [],
      expect: 'red',
      wants: [/no SKILL\.md files found/],
    },
    {
      label: 'no workspace packages discovered → RED',
      files: [ok(), exemptDispatch, exemptUpgrade],
      pkgs: new Map(),
      expect: 'red',
      wants: [/no workspace package\.json files found/],
    },
    {
      label: 'multi-package line, both pinned correctly → GREEN',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/spec 17.x and @objectstack/core 17.x (Zod v4 schemas), Node 22+') },
        exemptDispatch, exemptUpgrade,
      ],
      expect: 'green',
    },
    {
      // The anti-false-positive direction: prose around the pin is free to change.
      label: 'wording reflowed around a correct pin → stays GREEN',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Works with @objectstack/spec 17.x — Zod v4 schemas throughout') },
        exemptDispatch, exemptUpgrade,
      ],
      expect: 'green',
    },
    {
      label: 'a prerelease major still reconciles by major (17.0.0-rc.5 ↔ 17.x) → GREEN',
      files: [ok(), exemptDispatch, exemptUpgrade],
      expect: 'green',
    },
  ];

  let failed = 0;
  for (const c of cases) {
    let problems;
    try {
      ({ problems } = runAllChecks(c.files, c.pkgs ?? PKGS, EXEMPT));
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

  // Discovery-level assertions. These cannot be driven through runAllChecks (they
  // are about the filesystem walk itself), so they get a fixture tree and the real
  // tree, in that order.
  const fixture = mkdtempSync(join(tmpdir(), 'skill-compat-'));
  try {
    mkdirSync(join(fixture, SKILLS_DIR, 'has-one'), { recursive: true });
    mkdirSync(join(fixture, SKILLS_DIR, 'missing-its-skill-md'), { recursive: true });
    writeFileSync(join(fixture, SKILLS_DIR, 'has-one', 'SKILL.md'), ok().text);
    const d = readSkillFiles(fixture);
    if (d.files.length !== 1 || !d.problems.some((p) => /missing-its-skill-md\/ has no SKILL\.md/.test(p))) {
      failed += 1;
      console.error(
        '  ✗ a skill directory with no SKILL.md → RED\n' +
        `      got ${d.files.length} file(s), problems: ${JSON.stringify(d.problems)}`,
      );
    } else {
      console.log('  ✓ a skill directory with no SKILL.md → RED (discovery walk)');
    }

    const empty = readSkillFiles(mkdtempSync(join(tmpdir(), 'skill-compat-empty-')));
    if (empty.files.length !== 0) {
      failed += 1;
      console.error('  ✗ a tree with no skills/ should yield no files');
    } else {
      console.log('  ✓ a tree with no skills/ yields an empty scan, which runAllChecks turns RED');
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  const disc = readSkillFiles();
  if (disc.files.length === 0) {
    failed += 1;
    console.error('  ✗ real-tree discovery found no SKILL.md — the gate would be scanning nothing');
  } else {
    console.log(`  ✓ real-tree discovery: ${disc.files.length} SKILL.md file(s), ${disc.problems.length} layout problem(s)`);
  }

  if (failed > 0) {
    console.error(`\n✗ check-skill-compatibility-version self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`\n✓ check-skill-compatibility-version self-test: ${cases.length} cases pass.`);
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const { files, problems: layout } = readSkillFiles();
  const pkgs = readWorkspacePackages();
  const { problems, results, pinCount } = runAllChecks(files, pkgs, EXEMPT);

  const all = [...layout, ...problems];
  if (all.length > 0) {
    report(all);
    process.exit(1);
  }

  const exemptCount = results.filter((r) => r.exempt).length;
  const specMajor = majorOf(pkgs.get('@objectstack/spec')?.version);
  console.log(
    `✓ check-skill-compatibility-version: ${results.length} SKILL.md file(s) reconciled against ` +
    `${pkgs.size} workspace packages\n` +
    `  ${pinCount} pinned major(s) all match the workspace (@objectstack/spec is ${specMajor}.x)\n` +
    `  ${exemptCount} justified exemption(s), each with its stated reason still true of the file.`,
  );
}

if (isEntrypoint(import.meta.url)) {
  main();
}
