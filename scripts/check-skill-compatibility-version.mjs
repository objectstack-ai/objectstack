#!/usr/bin/env node
// check-skill-compatibility-version — reconciles the `compatibility:` line and the
// `metadata.version` stamp of every published SKILL.md against the workspace's real
// package versions (#5331), and `--fix` writes both from those versions.
//
// WHY THIS EXISTS. `compatibility` is a skill's only self-declared applicability
// range, and it ships to third parties verbatim: inside the `@objectstack/skills`
// package (the catalog, published in the changeset `fixed` group at the version of
// everything it teaches) and, as the `next` channel, from the repository's `main`
// via `npx skills add objectstack-ai/objectstack/skills`. Nothing compared it to reality, so it drifted
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
// EXEMPTIONS ARE NAMED, JUSTIFIED, AND SELF-INVALIDATING. One SKILL.md file
// deliberately pins no major, for a legitimate reason, and it is written down in
// EXEMPT below with a `rationale` regex that must still match the live text (a
// second, the published PM skill, was deleted with its file on 2026-09-10). If the justification is edited away, the exemption dies with it and
// the file falls back to the normal rule. An exemption never covers a pinned claim:
// exempt files' pins, if they ever grow any, are reconciled like everyone else's.
// This is the difference between "we thought about this file" and a silent hole.
//
// DERIVED, NOT HAND-KEPT. The catalog is bound to the version line it ships in,
// so the two version-shaped lines of a SKILL.md frontmatter are no longer typed by
// an author: `--fix` rewrites every `@objectstack/<pkg> <major>.x` pin to that
// package's workspace major and `metadata.version` to CATALOG_VERSION_PACKAGE's
// workspace version, and the root `version` script runs it right after
// `changeset version`, the way `sync-protocol-version.mjs` and
// `sync-template-versions.mjs` keep their stamps current — so a Version Packages
// PR carries the restamped frontmatters and `main` never sits red here between a
// bump and a hand edit. The default mode stays a pure CHECK: it reads, compares,
// and never writes; the `--fix` leg is the only writer, and it is spelled in every
// prescription below instead of "edit the line".
//
// Why `@objectstack/spec` is the version read and not `@objectstack/skills`: every
// published skill's `compatibility:` cites the spec, and the fixed group holds the
// two at one version, so reading the anchor that is always in the checkout says the
// same thing and keeps this gate green in a tree that predates the catalog package.
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
//   node scripts/check-skill-compatibility-version.mjs              # check
//   node scripts/check-skill-compatibility-version.mjs --fix        # derive both lines, then check
//   node scripts/check-skill-compatibility-version.mjs --self-test

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
 * The half of this gate's two populations that `scripts/pm/dispatch-gates.mjs`
 * cannot see, written in the syntax that derivation CAN read. Provenance ONLY:
 * nothing in this gate reads this array, and both walks behave exactly as they
 * did without it.
 *
 * ## The defect this repairs (#10840's worklist, the #10114 / #10314 idiom)
 *
 * The dispatch derivation scans a gate's module body for path-ish string
 * literals, and "path-ish" there means "carries a separator". Both `SKILLS_DIR`
 * and every entry of `PACKAGE_ROOTS` are bare single-segment words, so
 * `extractWatchHints` drops all four BEFORE `hintCovers` is ever consulted —
 * they are not dead hints, they are nothing at all, which is why no residue line
 * ever named them. Measured on this tree, a derivation for
 * `skills/objectstack-platform/SKILL.md` named four gates and this was not one
 * of them, though a `compatibility:` pin in that file is the whole subject here.
 *
 * ## Why `skills/**` is declared and the three PACKAGE_ROOTS are NOT
 *
 * The instrument can only express a SUBTREE: `hintCovers` collapses globs, so a
 * declared hint names every tracked file beneath it and there is no way to spell
 * "the package manifests under this root". That makes the two sides of this gate
 * completely different trades, and both were measured at `f29e89717`
 * (2026-08-22):
 *
 *   skills/**       49 of 50 tracked files were skill directories this gate
 *                   reads — 98% precision over a 50-file subtree.
 *   packages/**     73 package.json files out of 4903 tracked files — 1.5%,
 *                   pasted into every packages/** dispatch prompt in the repo.
 *   apps/**         1 of 35 (2.9%) · examples/**  4 of 238 (1.7%).
 *
 * ⛔ Those four readings are deliberately pinned to that commit and NOT
 * refreshed in place. Every term moves with the tree, nothing reprints them,
 * and what decides the trade is the ORDER of magnitude between the two sides —
 * which is why a figure restored in the present tense would be a new decaying
 * claim rather than a better one. `node scripts/pm/bare-root-worklist.mjs`
 * carries this gate's rows for the three package roots, with their own dates.
 *
 * The three package roots are therefore the +139084 fabrication one level up —
 * the very measurement in `hintCovers`' docblock, which prices accepting bare
 * top-level directory words at that many fabricated (gate, file) pairs because
 * `packages`, `apps` and `examples` are path COMPONENTS in dozens of gates that
 * never read those roots. A missing lead costs one card one CI round; a
 * fabricated one is pasted into every prompt whose surface brushes it and the
 * dev cannot tell it from a real one. So the manifest side stays undeclared,
 * deliberately, and the refusal is pinned in the self-test rather than left in
 * this paragraph — a later author who adds `packages/**` meets an assertion.
 *
 * ## Provenance, never a lookup key
 *
 * `readSkillFiles` joins SKILLS_DIR and then `statSync`s each entry, so the glob
 * form appearing in that constant would throw on a directory that does not
 * exist. The self-test pins that apart too.
 */
const ROOT_DIR_WATCH_HINTS = ['skills/**'];

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
 * The workspace package whose version every `metadata.version` stamp is derived
 * from: the fixed group's anchor, cited by every published skill's
 * `compatibility:` line. `@objectstack/skills`, the package the catalog ships
 * in, carries the identical version by the changeset `fixed` group
 * (`scripts/check-changeset-fixed.mjs` holds the membership), so the stamp IS the
 * catalog package's version — read off the one manifest every checkout has.
 */
const CATALOG_VERSION_PACKAGE = '@objectstack/spec';

/** The one writer of the derived lines, spelled once for every prescription. */
const FIX_COMMAND = 'node scripts/check-skill-compatibility-version.mjs --fix';

/**
 * Files allowed to declare no pinned major.
 *
 * `rationale` is not decoration — it is re-matched against the live `compatibility:`
 * text on every run. An exemption whose stated reason has been edited away stops
 * applying, so this list cannot quietly outlive the thing it describes.
 */
const EXEMPT = [
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

/**
 * Extract `metadata.version` from YAML frontmatter: the `version:` scalar nested
 * under the `metadata:` map, quoted or bare. Same contract as above — a miss is
 * reported as a miss, never as an empty value.
 */
export function extractMetadataVersion(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { ok: false, reason: 'no YAML frontmatter (file does not start with `---`)' };
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) {
    return { ok: false, reason: 'frontmatter is not terminated by a closing `---`' };
  }
  const body = lines.slice(1, end);
  const metaIdx = body.findIndex((l) => /^metadata:\s*$/.test(l));
  if (metaIdx === -1) {
    return { ok: false, reason: 'frontmatter has no `metadata:` map' };
  }
  for (let i = metaIdx + 1; i < body.length; i += 1) {
    const line = body[i];
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) break; // dedented to column 0 → next top-level key
    const m = /^\s+version:\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value === '') return { ok: false, reason: '`metadata.version` is present but empty' };
    return { ok: true, value };
  }
  return { ok: false, reason: 'frontmatter `metadata:` map has no `version:` key' };
}

/**
 * The `--fix` derivation, pure: rewrite the frontmatter's version-shaped lines
 * from the workspace manifests and leave every other byte alone.
 *
 *   - every `@objectstack/<pkg> <major>.x` pin in `compatibility:` (inline or
 *     block scalar) becomes that package's CURRENT workspace major; a pin naming
 *     a package the workspace does not have is left for the check to refuse;
 *   - `metadata.version` becomes CATALOG_VERSION_PACKAGE's workspace version,
 *     double-quoted (the catalog's own spelling).
 *
 * Structure is never invented: a file with no `metadata.version` or no
 * `compatibility:` line comes back unchanged, and the check names it.
 *
 * @returns {{ text: string, changes: string[] }}
 */
export function deriveFrontmatter(text, pkgs) {
  const lines = text.split('\n');
  const changes = [];
  if (lines[0]?.trim() !== '---') return { text, changes };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { text, changes };

  const repin = (line) =>
    line.replace(PIN_RE, (whole, pkg, major) => {
      const actual = pkgs.get(`@objectstack/${pkg}`);
      const actualMajor = actual ? majorOf(actual.version) : null;
      if (actualMajor === null || actualMajor === Number(major)) return whole;
      changes.push(`@objectstack/${pkg} ${major}.x → ${actualMajor}.x`);
      return `@objectstack/${pkg} ${actualMajor}.x`;
    });

  const compatIdx = lines.findIndex((l, i) => i > 0 && i < end && /^compatibility:/.test(l));
  if (compatIdx !== -1) {
    lines[compatIdx] = repin(lines[compatIdx]);
    if (/^compatibility:\s*[>|][+-]?\s*$/.test(lines[compatIdx])) {
      for (let i = compatIdx + 1; i < end; i += 1) {
        if (lines[i].trim() === '') continue;
        if (!/^\s/.test(lines[i])) break;
        lines[i] = repin(lines[i]);
      }
    }
  }

  const anchor = pkgs.get(CATALOG_VERSION_PACKAGE);
  const metaIdx = lines.findIndex((l, i) => i > 0 && i < end && /^metadata:\s*$/.test(l));
  if (anchor && metaIdx !== -1) {
    for (let i = metaIdx + 1; i < end; i += 1) {
      if (lines[i].trim() === '') continue;
      if (!/^\s/.test(lines[i])) break;
      const m = /^(\s+version:\s*)(.*)$/.exec(lines[i]);
      if (!m) continue;
      const current = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      const next = `${m[1]}"${anchor.version}"`;
      if (lines[i] !== next) {
        changes.push(`metadata.version ${JSON.stringify(current)} → ${JSON.stringify(anchor.version)}`);
        lines[i] = next;
      }
      break;
    }
  }
  return { text: lines.join('\n'), changes };
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

  const anchor = pkgs.get(CATALOG_VERSION_PACKAGE);
  if (!anchor) {
    problems.push(
      `no workspace package is named ${CATALOG_VERSION_PACKAGE}.\n` +
      `    Every skill's \`metadata.version\` is derived from its version (the fixed group's), so ` +
      `without it there is\n    nothing to derive from and nothing to reconcile against (#4690).`,
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
    // ---- the derived stamp: metadata.version IS the catalog version. Checked
    // first and independently of the compatibility line, so a file failing one
    // still reports the other.
    const stamp = extractMetadataVersion(text);
    if (!stamp.ok) {
      problems.push(
        `${file}\n` +
        `    cannot read \`metadata.version\`: ${stamp.reason}\n` +
        `    Every published skill carries the catalog's version there — it is derived from ` +
        `${CATALOG_VERSION_PACKAGE}'s\n    workspace version (the fixed group's), never typed.\n` +
        `    fix: add a \`version:\` line under \`metadata:\`, then run \`${FIX_COMMAND}\` to stamp it.`,
      );
    } else if (stamp.value !== anchor.version) {
      problems.push(
        `${file}\n` +
        `    declared: metadata.version "${stamp.value}"\n` +
        `    actual:   ${CATALOG_VERSION_PACKAGE} ${anchor.version}   (${anchor.file})\n` +
        `    fix: run \`${FIX_COMMAND}\` — the stamp is derived from the workspace version, never hand-edited ` +
        `(the root\n         \`version\` script re-stamps it after every \`changeset version\`).`,
      );
    }

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
          `    fix: run \`${FIX_COMMAND}\` — it rewrites the pin to "${pin.pkg} ${actualMajor}.x"; ` +
          `the line is derived\n         from the workspace version, never hand-edited.\n` +
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
    `and it ships\n  verbatim to third parties inside \`@objectstack/skills\` (and from \`main\` as the ` +
    `\`next\` channel). Both it and\n  \`metadata.version\` are derived: \`${FIX_COMMAND}\` writes them. ` +
    `See #5331 / #5245.\n`,
  );
}

// ---------------------------------------------------------------------------
// Self-test — pins the RED paths so the gate cannot rot into a no-op.
// ---------------------------------------------------------------------------

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// A zero failure count used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// PR #13487 way: what is pinned is the registered NAMES, not a number.
//
// This self-test is TABLE-DRIVEN — one literal `cases` table, one loop over it,
// and a sink (`failed += 1`) that writes only when a case FAILS. Routing THAT
// sink through `registerCase()` would register a case only when it fails: a
// fully green run would register 0 and every battery would read DID NOT RUN, the
// floor inverted rather than installed. So the roster is the table's own rows.
// Each row's own `label` is a declared battery, verbatim, with a floor of 1, and
// `registerCase()` is the FIRST statement of the driving loop body — so the case
// is attributed to the row actually being run, whatever that row asserts
// afterwards. It stays first even where the body carries `continue`: the floor
// asserts REACH, and placing it after a guard reintroduces the very inversion
// this shape exists to avoid. There is no `battery()` opener: for a table-driven
// self-test the ROW is the battery, so attribution is the loop variable rather
// than a most-recently-opened section.
//
// ⛔ A pinned TOTAL is not the repair, and neither is a roster DERIVED from the
// table: `cases.length` moves with the table, so a deleted row would delete its
// own floor. The roster below is a LITERAL the table is checked against, which
// is what lets a deleted or renamed row name ITSELF in the refusal.
//
// The counts are a FLOOR, not an equality — a row that grows into several
// registrations must not red. 1 is the honest floor for a table row: the loop
// reaches it exactly once per run.
const SELF_TEST_BATTERIES = Object.freeze({
  'the landed wording (exact 17.x pin) → GREEN': 1,
  'R1 — a stale major (17.x → 16.x, the #5245 drift) → RED naming file/declared/actual/fix': 1,
  'R3 — no `compatibility:` key at all → RED (absence is never a skip, #4690)': 1,
  'an empty `compatibility:` value → RED': 1,
  'no frontmatter at all → RED': 1,
  'R4 — wording switched to an unpinned range (#5245 option ②) → RED, not a silent no-op': 1,
  'R4b — zero pins repo-wide with every file exempt → RED via the anti-no-op assertion': 1,
  'R5 — an exemption naming a file that is not scanned → RED (anti-dormancy)': 1,
  'R7 — an exempt file whose written justification is gone → RED (exemption self-invalidates)': 1,
  'an exempt file that grows a pin → RED (the exemption is now dead config)': 1,
  'an exempt file whose pin is ALSO wrong → RED on the pin (exemptions never cover a claim)': 1,
  'R8 — a half-pinned line (one pinned, one bare mention) → RED on the bare one': 1,
  'a pin naming a package the workspace does not have → RED': 1,
  'R6 — an empty scan → RED, never a green skip (#4690, the whole point)': 1,
  'no workspace packages discovered → RED': 1,
  'multi-package line, both pinned correctly → GREEN': 1,
  'wording reflowed around a correct pin → stays GREEN': 1,
  'a prerelease major still reconciles by major (17.0.0-rc.5 ↔ 17.x) → GREEN': 1,
  'R9 — a stale metadata.version (17.0.0-rc.4 beside spec 17.0.0-rc.5) → RED naming file/declared/actual/fix': 1,
  'R10 — no metadata.version at all → RED (the stamp is required, never skipped)': 1,
  'R11 — the exempt file is stamped too: an unpinned skill with a stale metadata.version → RED': 1,
  'R12 — the catalog version package absent from the workspace → RED, never a silent "nothing to derive"': 1,
  '--fix derives both lines: a stale pin and a stale stamp rewritten, every other byte kept': 1,
  '--fix on a derived file is a no-op (byte-identical, zero changes)': 1,
  '--fix rewrites a pin inside a folded `compatibility: >` block too': 1,
  '--fix invents no structure: a file with no metadata.version comes back unchanged, and the check names it': 1,
  '--fix leaves a pin naming a package the workspace lacks alone, for the check to refuse': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in the floor block is the other half, and names WHICH label
// collided.
const SELF_TEST_BATTERY_FLOOR = 27;

function selfTest() {
  console.log('check-skill-compatibility-version self-test\n');

  const PKGS = new Map([
    ['@objectstack/spec', { version: '17.0.0-rc.5', file: 'packages/spec/package.json' }],
    ['@objectstack/core', { version: '17.0.0-rc.5', file: 'packages/core/package.json' }],
    ['@objectstack/formula', { version: '17.0.0-rc.5', file: 'packages/formula/package.json' }],
  ]);

  const fm = (compat, version = '17.0.0-rc.5') =>
    `---\nname: x\nlicense: Apache-2.0\n${compat}\nmetadata:\n  author: objectstack-ai\n  version: "${version}"\n---\n\n# body\n`;
  const ok = (n = 'skills/objectstack-ai/SKILL.md') => ({
    file: n, text: fm('compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)'),
  });
  const exemptUpgrade = {
    file: 'skills/objectstack-upgrade/SKILL.md',
    text: fm('compatibility: >\n  Needs `@objectstack/spec` and `@objectstack/cli` at the TARGET major\n  (protocol 10 at the time of writing).'),
  };

  const cases = [
    {
      label: 'the landed wording (exact 17.x pin) → GREEN',
      files: [ok(), exemptUpgrade],
      expect: 'green',
    },
    {
      label: 'R1 — a stale major (17.x → 16.x, the #5245 drift) → RED naming file/declared/actual/fix',
      files: [{ file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/spec 16.x (Zod v4 schemas)') }, exemptUpgrade],
      expect: 'red',
      wants: [
        /skills\/objectstack-ai\/SKILL\.md/,
        /declared: @objectstack\/spec 16\.x/,
        /actual:\s+@objectstack\/spec 17\.0\.0-rc\.5/,
        /fix: run `node scripts\/check-skill-compatibility-version\.mjs --fix` — it rewrites the pin to "@objectstack\/spec 17\.x"/,
      ],
    },
    {
      label: 'R3 — no `compatibility:` key at all → RED (absence is never a skip, #4690)',
      files: [{ file: 'skills/objectstack-ai/SKILL.md', text: '---\nname: x\n---\n\n# body\n' }, exemptUpgrade],
      expect: 'red',
      wants: [/no `compatibility:` key/],
    },
    {
      label: 'an empty `compatibility:` value → RED',
      files: [{ file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility:') }, exemptUpgrade],
      expect: 'red',
      wants: [/present but empty/],
    },
    {
      label: 'no frontmatter at all → RED',
      files: [{ file: 'skills/objectstack-ai/SKILL.md', text: '# just a heading\n' }, exemptUpgrade],
      expect: 'red',
      wants: [/no YAML frontmatter/],
    },
    {
      label: 'R4 — wording switched to an unpinned range (#5245 option ②) → RED, not a silent no-op',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/spec >= 17') },
        exemptUpgrade,
      ],
      expect: 'red',
      // The per-file "no pinned major" fires first; both are the same refusal to
      // pass on zero comparable input.
      wants: [/declares no pinned major/],
    },
    {
      label: 'R4b — zero pins repo-wide with every file exempt → RED via the anti-no-op assertion',
      files: [exemptUpgrade],
      expect: 'red',
      wants: [/not one "@objectstack\/<pkg> <major>\.x" pin was found/],
    },
    {
      label: 'R5 — an exemption naming a file that is not scanned → RED (anti-dormancy)',
      files: [ok()],
      expect: 'red',
      wants: [/stale exemption: skills\/objectstack-upgrade\/SKILL\.md/],
    },
    {
      label: 'R7 — an exempt file whose written justification is gone → RED (exemption self-invalidates)',
      files: [
        ok(),
        { file: 'skills/objectstack-upgrade/SKILL.md', text: fm('compatibility: >\n  Cross-major upgrade skill — correct at whatever major the project moves to.') },
      ],
      expect: 'red',
      wants: [/no longer matches that justification/],
    },
    {
      label: 'an exempt file that grows a pin → RED (the exemption is now dead config)',
      files: [
        ok(),
        { file: 'skills/objectstack-upgrade/SKILL.md', text: fm('compatibility: >\n  Correct at the TARGET major, but @objectstack/core 17.x.') },
      ],
      expect: 'red',
      wants: [/is on the EXEMPT list \(no-pin allowed\) yet now declares a pinned major/],
    },
    {
      label: 'an exempt file whose pin is ALSO wrong → RED on the pin (exemptions never cover a claim)',
      files: [
        ok(),
        { file: 'skills/objectstack-upgrade/SKILL.md', text: fm('compatibility: >\n  Correct at the TARGET major, but @objectstack/core 16.x.') },
      ],
      expect: 'red',
      wants: [/declared: @objectstack\/core 16\.x/],
    },
    {
      label: 'R8 — a half-pinned line (one pinned, one bare mention) → RED on the bare one',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/spec 17.x and @objectstack/core') },
        exemptUpgrade,
      ],
      expect: 'red',
      wants: [/mentions @objectstack\/core without a "<major>\.x" pin/],
    },
    {
      label: 'a pin naming a package the workspace does not have → RED',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/nonesuch 17.x') },
        exemptUpgrade,
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
      files: [ok(), exemptUpgrade],
      pkgs: new Map(),
      expect: 'red',
      wants: [/no workspace package\.json files found/],
    },
    {
      label: 'multi-package line, both pinned correctly → GREEN',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/spec 17.x and @objectstack/core 17.x (Zod v4 schemas), Node 22+') },
        exemptUpgrade,
      ],
      expect: 'green',
    },
    {
      // The anti-false-positive direction: prose around the pin is free to change.
      label: 'wording reflowed around a correct pin → stays GREEN',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Works with @objectstack/spec 17.x — Zod v4 schemas throughout') },
        exemptUpgrade,
      ],
      expect: 'green',
    },
    {
      label: 'a prerelease major still reconciles by major (17.0.0-rc.5 ↔ 17.x) → GREEN',
      files: [ok(), exemptUpgrade],
      expect: 'green',
    },
    {
      label: 'R9 — a stale metadata.version (17.0.0-rc.4 beside spec 17.0.0-rc.5) → RED naming file/declared/actual/fix',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: fm('compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)', '17.0.0-rc.4') },
        exemptUpgrade,
      ],
      expect: 'red',
      wants: [
        /skills\/objectstack-ai\/SKILL\.md/,
        /declared: metadata\.version "17\.0\.0-rc\.4"/,
        /actual:\s+@objectstack\/spec 17\.0\.0-rc\.5/,
        /fix: run `node scripts\/check-skill-compatibility-version\.mjs --fix`/,
      ],
    },
    {
      label: 'R10 — no metadata.version at all → RED (the stamp is required, never skipped)',
      files: [
        { file: 'skills/objectstack-ai/SKILL.md', text: '---\nname: x\ncompatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)\nmetadata:\n  author: objectstack-ai\n---\n\n# body\n' },
        exemptUpgrade,
      ],
      expect: 'red',
      wants: [/cannot read `metadata\.version`: frontmatter `metadata:` map has no `version:` key/],
    },
    {
      label: 'R11 — the exempt file is stamped too: an unpinned skill with a stale metadata.version → RED',
      files: [
        ok(),
        { file: 'skills/objectstack-upgrade/SKILL.md', text: fm('compatibility: >\n  Needs `@objectstack/spec` and `@objectstack/cli` at the TARGET major\n  (protocol 10 at the time of writing).', '16.0.0') },
      ],
      expect: 'red',
      wants: [/skills\/objectstack-upgrade\/SKILL\.md\n    declared: metadata\.version "16\.0\.0"/],
    },
    {
      label: 'R12 — the catalog version package absent from the workspace → RED, never a silent "nothing to derive"',
      files: [ok(), exemptUpgrade],
      pkgs: new Map([['@objectstack/core', { version: '17.0.0-rc.5', file: 'packages/core/package.json' }]]),
      expect: 'red',
      wants: [/no workspace package is named @objectstack\/spec/],
    },
  ];

  // The ledger this self-test's floor is evaluated against (#13489).
  const batterySeen = new Map();
  const registerCase = (name) => {
    batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  };

  let failed = 0;
  for (const c of cases) {
    registerCase(c.label);
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

  // ── The --fix derivation, pure (#5331 → ruling A on the catalog's binding) ──
  //
  // Driven through `deriveFrontmatter` with the same fixture packages; each row
  // registers before it asserts, like the table above.
  const derivationCases = [
    {
      label: '--fix derives both lines: a stale pin and a stale stamp rewritten, every other byte kept',
      run: () => {
        const before = fm('compatibility: Requires @objectstack/spec 16.x and @objectstack/core 16.x (Zod v4 schemas), Node 22+', '16.2.0');
        const { text, changes } = deriveFrontmatter(before, PKGS);
        const expected = fm('compatibility: Requires @objectstack/spec 17.x and @objectstack/core 17.x (Zod v4 schemas), Node 22+');
        if (text !== expected) throw new Error(`derived text differs:\n${text}`);
        if (changes.length !== 3) throw new Error(`expected 3 changes, got ${JSON.stringify(changes)}`);
        if (runAllChecks([{ file: 'skills/objectstack-ai/SKILL.md', text }, exemptUpgrade], PKGS, EXEMPT).problems.length !== 0) {
          throw new Error('the derived file does not pass the check it was derived for');
        }
      },
    },
    {
      label: '--fix on a derived file is a no-op (byte-identical, zero changes)',
      run: () => {
        const { text, changes } = deriveFrontmatter(ok().text, PKGS);
        if (text !== ok().text || changes.length !== 0) throw new Error(`moved: ${JSON.stringify(changes)}`);
      },
    },
    {
      label: '--fix rewrites a pin inside a folded `compatibility: >` block too',
      run: () => {
        const before = fm('compatibility: >\n  Requires @objectstack/spec 16.x\n  (Zod v4 schemas)');
        const { text, changes } = deriveFrontmatter(before, PKGS);
        if (!text.includes('  Requires @objectstack/spec 17.x\n')) throw new Error(`block pin not rewritten:\n${text}`);
        if (changes.length !== 1) throw new Error(`expected 1 change, got ${JSON.stringify(changes)}`);
      },
    },
    {
      label: '--fix invents no structure: a file with no metadata.version comes back unchanged, and the check names it',
      run: () => {
        const before = '---\nname: x\ncompatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)\nmetadata:\n  author: objectstack-ai\n---\n\n# body\n';
        const { text, changes } = deriveFrontmatter(before, PKGS);
        if (text !== before || changes.length !== 0) throw new Error('structure was invented');
        const { problems } = runAllChecks([{ file: 'skills/objectstack-ai/SKILL.md', text }, exemptUpgrade], PKGS, EXEMPT);
        if (!problems.some((p) => /has no `version:` key/.test(p))) throw new Error('the check did not name the missing stamp');
      },
    },
    {
      label: '--fix leaves a pin naming a package the workspace lacks alone, for the check to refuse',
      run: () => {
        const before = fm('compatibility: Requires @objectstack/nonesuch 16.x');
        const { text, changes } = deriveFrontmatter(before, PKGS);
        if (text !== before || changes.length !== 0) throw new Error('an unknown package was rewritten');
      },
    },
  ];
  for (const c of derivationCases) {
    registerCase(c.label);
    try {
      c.run();
      console.log(`  ✓ ${c.label}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${c.label}\n      ${err.message}`);
    }
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

  // ── The dispatch-gates declaration (#10840) ───────────────────────────────
  //
  // Enforcement cannot hold any of these: the declaration is read by another
  // tool entirely, so a wrong or stale one runs green here forever and pays
  // itself out as a dev dispatched on a skills card with this gate missing from
  // the brief. Both halves are DERIVED from the population constants rather than
  // re-spelled, so renaming or re-scoping a root cannot leave the declaration
  // describing the old population.
  //
  // The predicate is `hintCovers`' own refusal (dispatch-gates.mjs: a hint with
  // no `/` and no leading `.` is rejected as too generic), spelled here rather
  // than imported because this gate must not take a dependency on the PM tool to
  // state what it reads. If that refusal ever changes, this line moves with it.
  const unseeable = (r) => !r.includes('/') && !r.startsWith('.');
  const declFailures = [];
  let declCases = 0;
  const decl = (label, ok) => { declCases += 1; if (!ok) declFailures.push(label); };
  decl('SKILLS_DIR is invisible to the derivation, which is why it needs a declaration at all',
    unseeable(SKILLS_DIR));
  decl('and it declares exactly that root, in the subtree spelling',
    ROOT_DIR_WATCH_HINTS.includes(`${SKILLS_DIR}/**`));
  decl('and declares no root this gate does not read (a declaration that can drift from the scan '
    + 'is worse than none — it replaces a silent gate with a lying one)',
    ROOT_DIR_WATCH_HINTS.every((h) => h.replace(/\/\*+$/, '') === SKILLS_DIR));
  // The REFUSAL, pinned. The manifest walk really does read all three roots, so
  // this is not an oversight to be tidied up later — it is a priced decision:
  // 73 of 4903 files under packages/ (1.5%), 1 of 35 under apps/, 4 of 238 under
  // examples/. A subtree hint cannot say "the manifests"; it can only say "all
  // of it", and all of it is false here.
  decl('the three PACKAGE_ROOTS are deliberately NOT declared — a subtree hint would name this '
    + 'gate for every file under them to reach the package.json files, which is the fabricated '
    + 'lead hintCovers is measured against',
    PACKAGE_ROOTS.every((r) => !ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)));
  decl('the non-vacuity half of that refusal: those roots really are invisible, so the refusal is '
    + 'a live choice rather than a description of something the extractor already handles',
    PACKAGE_ROOTS.every(unseeable));
  // Provenance, never a lookup key: readSkillFiles joins SKILLS_DIR and statSyncs
  // each entry, so the glob form appearing there would throw on a missing dir.
  decl('the declared form is NOT the SKILLS_DIR value itself',
    !ROOT_DIR_WATCH_HINTS.includes(SKILLS_DIR));
  for (const f of declFailures) console.error(`  ✗ dispatch-gates declaration: ${f}`);
  failed += declFailures.length;

  // ── The floor: every declared row RAN, and ran its case (#13489) ───────
  //
  // Evaluated after every row has had its chance and BEFORE the verdict, so the
  // success line below can only be printed by a run in which the set of rows
  // that registered EQUALS the set declared. A set difference names WHICH row
  // stopped; a count says only that something did.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  const rowLabels = [...cases, ...derivationCases].map((c) => c.label);
  const duplicated = [...new Set(rowLabels.filter((name, i) => rowLabels.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    floorBreached = true;
    floorFailure(
      `the cases table uses ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more than once — ` +
        'two rows sharing a label are ONE battery, so the second can stop running while the first keeps the floor met.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer ' +
        'reaches it) and restore it.',
    );
  }

  if (failed > 0) {
    console.error(`\n✗ check-skill-compatibility-version self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ check-skill-compatibility-version self-test: ${cases.length} check cases and ${derivationCases.length} --fix derivation cases pass, plus ${declCases} dispatch-gates declaration cases.`);
  selfTestReachedVerdict = true;
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) {
      const selfTestCode = selfTest();
      if (!selfTestReachedVerdict) {
          console.error(
              '\n✗ check-skill-compatibility-version self-test: selfTest() returned without reaching its verdict,\n'
                  + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                  + 'that never finished as a self-test that passed.\n',
          );
          process.exit(1);
      }
      return selfTestCode;
  }

  const { files: scanned, problems: layout } = readSkillFiles();
  const pkgs = readWorkspacePackages();

  // --fix: derive the two version-shaped lines from the workspace manifests,
  // write only the files that moved, then CHECK the result like any other run —
  // a derivation that leaves a file red (no stamp to rewrite, a pin naming no
  // package) is reported, never papered over.
  const files = process.argv.includes('--fix')
    ? scanned.map(({ file, text }) => {
        const { text: next, changes } = deriveFrontmatter(text, pkgs);
        if (next !== text) {
          writeFileSync(join(REPO_ROOT, file), next);
          console.log(`✎ ${file}: ${changes.join('; ')}`);
        }
        return { file, text: next };
      })
    : scanned;
  if (process.argv.includes('--fix')) {
    const moved = files.filter((f, i) => f.text !== scanned[i].text).length;
    console.log(`check-skill-compatibility-version --fix: ${moved} of ${files.length} SKILL.md file(s) rewritten.\n`);
  }

  const { problems, results, pinCount } = runAllChecks(files, pkgs, EXEMPT);

  const all = [...layout, ...problems];
  if (all.length > 0) {
    report(all);
    process.exit(1);
  }

  const exemptCount = results.filter((r) => r.exempt).length;
  const anchor = pkgs.get(CATALOG_VERSION_PACKAGE);
  console.log(
    `✓ check-skill-compatibility-version: ${results.length} SKILL.md file(s) reconciled against ` +
    `${pkgs.size} workspace packages\n` +
    `  ${pinCount} pinned major(s) all match the workspace (${CATALOG_VERSION_PACKAGE} is ${majorOf(anchor.version)}.x)\n` +
    `  ${files.length} metadata.version stamp(s) all equal ${CATALOG_VERSION_PACKAGE} ${anchor.version} ` +
    `(derived; \`${FIX_COMMAND}\` writes them)\n` +
    `  ${exemptCount} justified exemption(s), each with its stated reason still true of the file.`,
  );
}

if (isEntrypoint(import.meta.url)) {
  main();
}
