// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// scaffold-workspace-consistency — the two scaffold paths render a
// `pnpm-workspace.yaml` into a new user's project independently, and this file
// is the only thing that can fail when they disagree (commit 6d441e41f).
//
// ── The shape of the defect ─────────────────────────────────────────────────
//
// Two producers write that file, each stating the same pnpm build-approval rule
// in its own words:
//
//   * `renderPnpmWorkspaceYaml()` in `packages/cli/src/commands/init.ts`, for
//     `objectstack init` — a string builder, ratcheted by `test/init.test.ts`.
//   * `packages/create-objectstack/src/templates/blank/pnpm-workspace.yaml`,
//     for `npx create-objectstack` — a literal file copied into the project,
//     ratcheted by that package's `src/template-consistency.test.ts`.
//
// Both ratchets are PACKAGE-LOCAL, so neither can fail for the other file's
// regression: `allowBuilds` was added to the template when pnpm 11 turned an
// unapproved build script into a hard error, the renderer was not touched, and
// one of the two scaffold paths went on shipping the pre-fix shape for months
// — found by a first-run audit (#10405), not by a gate. The measured pnpm
// boundary was corrected in the renderer by that fix and NOT in the template,
// which is the second instance of the same class (fixed by commit 6d441e41f): a user on pnpm
// 10.28 was told by the file inside their own project that their pnpm cannot
// read the key it is in fact reading, while the sibling scaffold path said the
// opposite.
//
// ── ⚠️ The assertion this file must NOT make ────────────────────────────────
//
// "Both files mention `allowBuilds`" passes while the two contradict each
// other — it passed on `main` throughout the divergence above. An assertion
// that green-lights the live defect is worse than no gate, because it certifies
// the state the gate exists to catch. So what is compared here is the RENDERED
// OUTPUT of each producer: the packages each one actually grants a build, and
// the pnpm versions each one actually names for each key. Neither file's
// expected content is restated below — every expected value comes from the
// OTHER producer, so this file measures the two against each other rather than
// against a transcription that stops tracking either of them.
//
// ── Why this file lives in `packages/cli` ───────────────────────────────────
//
// The CLI side must be CALLED rather than text-parsed (it is a string builder;
// parsing its source would measure the source, not the render), and only this
// package can call it. The template side is a static file, so reading it IS
// reading its producer. `packages/cli` already depends on `create-objectstack`
// (`workspace:*`, for the shared `created-summary` renderer), so the read below
// introduces no dependency edge in either direction — and no shared module: the
// two producers stay independent, this file just makes their disagreement
// loud. The read escapes this package, so it is declared in
// `scripts/check-cross-package-test-inputs.mjs` and in turbo.json's
// `@objectstack/cli#test` inputs; without that declaration a template-only diff
// could not reach this suite and its cache would replay a stale green.
//
// ── `peerDependencyRules`, and why it is compared here NOW ──────────────────
//
// This limb was deliberately absent while commit afe1c4e0a's card was open: that card was the
// ruling on WHICH peer skews the scaffold should declare, and a limb written
// before it would have either duplicated the card or pre-empted its answer.
// Commit afe1c4e0a answered it (the four `@better-auth/utils` declarations landed with
// it), so the reservation is discharged and the drift risk is what remains —
// and it is the same two-producer risk the rest of this file exists for. The
// peer block is, if anything, the more fragile of the two: build approvals are
// one flat package list, while a peer rule is a `<declaring>><peer>` key whose
// value has to be RE-MEASURED per entry, so a copy that lands in one file and
// not the other is both easy to make and invisible to either package's own
// tests.
//
// What is compared is the rendered `allowedVersions` MAP — the keys each file
// widens and the version each key is widened to — for the same reason the
// build limb compares rendered grants: no expected value is restated here, so
// each producer's expectation is the other producer.
//
// ── One file, one comment line per block (#22162) ───────────────────────────
//
// The two files used to explain these settings in their own words, 57 and 66
// comment lines of measurements and version history, and the prose was not
// compared. That left a retired entry's explanation shipping in one of them
// with nothing to fail on it (#17093). The maintainer then asked for
// the file to stay minimal, with the rationale in the scaffolder source, and
// triage ruled that both scaffold paths render the same file. So two more
// limbs now hold it:
//
//   * the two producers render the SAME BYTES — comments included, which is
//     what closes the drift above: there is one text left to keep true;
//   * each file stays a settings file — at most one comment line per block,
//     directly above its key, inside 80 columns. The measurements live in the
//     docblocks of `renderPnpmWorkspaceYaml`, `SCAFFOLD_BUILT_DEPENDENCIES`
//     and `SCAFFOLD_ALLOWED_PEER_VERSIONS` in `src/commands/init.ts`.
//
// The limbs above stay as they were: when the bytes do differ, they say WHICH
// declaration or version claim differs, which a byte comparison cannot.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// `.js`, not extensionless: this package is `moduleResolution: NodeNext`, where a
// relative import without the extension does not resolve — every symbol it names
// becomes `any` (TS2835 + a TS7006 cascade). packages/cli/test is a HIDDEN
// typecheck layer (tsconfig `include` is `src` only) held by a shrink-only
// ledger in scripts/check-type-check-coverage.mjs, so an extensionless import
// here raises that count and reddens check:type-check-debt for everyone.
import { renderPnpmWorkspaceYaml } from '../src/commands/init.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

// One line on purpose: `check:cross-package-test-inputs` reconstructs this read
// by SOURCE SCAN, and a `resolve(HERE, …)` split across lines is a spelling it
// does not recognise — which would leave the glob declared and held by nothing.
const TEMPLATE_WORKSPACE_YAML = resolve(HERE, '../../create-objectstack/src/templates/blank/pnpm-workspace.yaml');

/** The rendered output of each scaffold path, keyed by the command a user runs. */
const RENDERED = {
  'objectstack init': renderPnpmWorkspaceYaml(),
  'npx create-objectstack': readFileSync(TEMPLATE_WORKSPACE_YAML, 'utf8'),
} as const;

type Producer = keyof typeof RENDERED;
const [CLI, TEMPLATE] = Object.keys(RENDERED) as [Producer, Producer];

/** The two keys that grant a dependency's build script permission to run. */
const APPROVAL_KEYS = ['allowBuilds', 'onlyBuiltDependencies'] as const;

/**
 * The peer skews each file declares, as `<declaring package>><peer>` → version.
 *
 * Read out of the settings with the prose stripped first, exactly as the build
 * grants are: the comments above the block NAME these packages and versions,
 * and must never be what satisfies an assertion about the declarations.
 */
function declaredPeerSkews(yaml: string): Record<string, string> {
  const settings = yaml.replace(/^\s*#.*$/gm, '');
  const block = /^peerDependencyRules:\n[ \t]+allowedVersions:\n((?:[ \t]+.*\n?)*)/m.exec(settings)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^[ \t]+'([^']+)':[ \t]*'([^']*)'[ \t]*$/gm)) out[m[1]] = m[2];
  return out;
}

/**
 * The packages each key actually grants a build to, read out of the settings
 * with the prose stripped first — the comments below each key NAME these
 * packages, and must never be what satisfies an assertion about the grant.
 */
function grantedBuilds(yaml: string): Record<(typeof APPROVAL_KEYS)[number], string[]> {
  const settings = yaml.replace(/^\s*#.*$/gm, '');
  const mapping = /^allowBuilds:\n((?:[ \t]+.*\n?)*)/m.exec(settings)?.[1] ?? '';
  const list = /^onlyBuiltDependencies:\n((?:[ \t]*-.*\n?)*)/m.exec(settings)?.[1] ?? '';
  return {
    allowBuilds: [...mapping.matchAll(/^[ \t]+([^\s:]+):[ \t]*true[ \t]*$/gm)]
      .map((m) => m[1])
      .sort(),
    onlyBuiltDependencies: [...list.matchAll(/^[ \t]*-[ \t]*(\S+)[ \t]*$/gm)]
      .map((m) => m[1])
      .sort(),
  };
}

/**
 * The prose each file attaches to each approval key, as one string per key.
 *
 * Each file writes it as the one comment line directly above the key (the
 * budget the last limb below holds). Only the VERSION CLAIMS inside it are
 * compared, so the limb still says which boundary differs when the bytes do.
 */
function keyProse(yaml: string): Map<string, string> {
  const prose = new Map<string, string>();
  const lines = yaml.split('\n');
  lines.forEach((line, i) => {
    const key = /^(allowBuilds|onlyBuiltDependencies):/.exec(line)?.[1];
    const above = i > 0 ? /^#[ \t]*(\S.*)$/.exec(lines[i - 1]) : null;
    if (key && above) prose.set(key, above[1].trim());
  });
  return prose;
}

/** The widest comment line the rendered file may carry. */
const MAX_COMMENT_COLUMNS = 80;

/**
 * Every way a file breaks its comment budget, one entry per offending line.
 *
 * The budget is at most one comment line per top-level block: a full-line
 * comment, directly above its key, inside {@link MAX_COMMENT_COLUMNS}. A line
 * count alone would let one block take every line the others save, and a line
 * rule without a width would let one line hold a paragraph; this is the
 * smallest rule that bounds both, and it adds up to a few hundred bytes of
 * comment however the file grows. No value in this file can contain `#` (they
 * are package names, versions and `true`), so any `#` is a comment.
 */
function commentBudgetBreaches(yaml: string): string[] {
  const lines = yaml.split('\n');
  const breaches: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes('#')) return;
    const where = `line ${i + 1} ${JSON.stringify(line)}`;
    if (!line.startsWith('#')) {
      breaches.push(`${where} puts a comment inside or after a setting`);
    } else if (!/^[A-Za-z][\w-]*:/.test(lines[i + 1] ?? '')) {
      breaches.push(`${where} is not the one comment line directly above a top-level key`);
    }
    const columns = [...line].length;
    if (columns > MAX_COMMENT_COLUMNS) {
      breaches.push(`${where} is ${columns} columns wide, over ${MAX_COMMENT_COLUMNS}`);
    }
  });
  return breaches;
}

/**
 * Every pnpm version a piece of prose names, in the order it names them.
 *
 * Dotted only: `10.26`, `10.0`, `11.22.0` are boundary CLAIMS, while the bare
 * majors both files use in passing ("pnpm 11 reads ONLY this one") are prose,
 * and so is the `1` in "exits 1".
 */
function versionsNamed(prose: string): string[] {
  return [...prose.matchAll(/\d+\.\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

describe('the two scaffold paths render the same pnpm build approvals (#10499)', () => {
  it('grants exactly the same packages a build, under both keys', () => {
    const cli = grantedBuilds(RENDERED[CLI]);
    const template = grantedBuilds(RENDERED[TEMPLATE]);

    // Non-vacuity: an empty grant on both sides would compare equal while
    // approving nothing, which is the shape that fails a user's first install.
    for (const [producer, granted] of [[CLI, cli], [TEMPLATE, template]] as const) {
      for (const key of APPROVAL_KEYS) {
        expect(
          granted[key].length,
          `${producer} renders no package under \`${key}\` — a scaffolded project's ` +
            'first `pnpm install` fails on pnpm 11 with ERR_PNPM_IGNORED_BUILDS',
        ).toBeGreaterThan(0);
      }
    }

    for (const key of APPROVAL_KEYS) {
      expect(
        cli[key],
        `\`${key}\` grants a different build set in the two scaffold paths: ` +
          `${CLI} approves [${cli[key].join(', ')}] and ${TEMPLATE} approves ` +
          `[${template[key].join(', ')}]. Both write a pnpm-workspace.yaml into a new ` +
          'user\'s project and neither package\'s own tests can see the other, so a ' +
          'divergence here ships to whichever half of users took the other path.',
      ).toEqual(template[key]);
    }
  });

  it('states the same pnpm version boundary for each key', () => {
    const cli = keyProse(RENDERED[CLI]);
    const template = keyProse(RENDERED[TEMPLATE]);

    expect(
      [...cli.keys()].sort(),
      'the two scaffold paths explain a different set of build-approval keys',
    ).toEqual([...template.keys()].sort());

    for (const key of APPROVAL_KEYS) {
      const claimed = {
        [CLI]: versionsNamed(cli.get(key) ?? ''),
        [TEMPLATE]: versionsNamed(template.get(key) ?? ''),
      };

      // Non-vacuity again: prose naming no version at all would compare equal
      // between the two files while telling the reader nothing, and this whole
      // block would pass over a boundary nobody states.
      for (const producer of [CLI, TEMPLATE] as const) {
        expect(
          claimed[producer].length,
          `${producer} states no pnpm version for \`${key}\` — the boundary is what the ` +
            'reader of a scaffolded project needs, and an unstated one cannot be kept ' +
            'in step with the other scaffold path',
        ).toBeGreaterThan(0);
      }

      expect(
        claimed[CLI],
        `the two scaffold paths tell a user different things about which pnpm reads ` +
          `\`${key}\`: ${CLI} names [${claimed[CLI].join(', ')}] and ${TEMPLATE} names ` +
          `[${claimed[TEMPLATE].join(', ')}]. Both files ship into a user's own project, ` +
          'so one of them is telling that user their pnpm cannot read a key it is ' +
          'reading. The measured boundary is the one to move TO — never move a correct ' +
          'file to match a wrong one.',
      ).toEqual(claimed[TEMPLATE]);
    }
  });

  it('declares the same peer skews, widened to the same versions', () => {
    const cli = declaredPeerSkews(RENDERED[CLI]);
    const template = declaredPeerSkews(RENDERED[TEMPLATE]);

    // Non-vacuity: two empty maps compare equal while declaring nothing, which
    // is the state that puts an unmet-peer report on a newcomer's first screen.
    for (const [producer, skews] of [[CLI, cli], [TEMPLATE, template]] as const) {
      expect(
        Object.keys(skews).length,
        `${producer} declares no peer skew at all — a scaffolded project's first ` +
          '`pnpm install` then opens with an unmet-peer report the user did not cause',
      ).toBeGreaterThan(0);
    }

    expect(
      cli,
      'the two scaffold paths declare different peer skews: ' +
        `${CLI} widens {${Object.entries(cli).map(([k, v]) => `${k}=${v}`).join(', ')}} and ` +
        `${TEMPLATE} widens {${Object.entries(template).map(([k, v]) => `${k}=${v}`).join(', ')}}. ` +
        'Each entry is a per-declaration judgement backed by its own measurement, so a ' +
        'key present in one file and missing from the other means half of users see a ' +
        'report the other half does not — and a key widened to DIFFERENT versions means ' +
        'one of the two is silencing a skew nobody measured. Re-measure before moving ' +
        'either file; never copy a value across just to make this pass.',
    ).toEqual(template);
  });
});

describe('the two scaffold paths render one minimal file (#22162)', () => {
  it('renders the same bytes in both scaffold paths', () => {
    expect(
      RENDERED[CLI],
      `${CLI} and ${TEMPLATE} write different pnpm-workspace.yaml files. Both scaffold ` +
        'paths ship ONE file: make the same edit to renderPnpmWorkspaceYaml() and to the ' +
        "template, and put any new reasoning in init.ts's docblocks rather than the file.",
    ).toBe(RENDERED[TEMPLATE]);
  });

  it.each(Object.keys(RENDERED) as Producer[])(
    '%s carries at most one short comment line per block',
    (producer) => {
      const yaml = RENDERED[producer];
      // Non-vacuity: a file with no top-level key has no block to comment, and
      // an empty breach list over it would read as a file within budget.
      expect(yaml).toMatch(/^[A-Za-z][\w-]*:/m);
      expect(
        commentBudgetBreaches(yaml),
        `${producer} writes more comment than its settings need. A scaffolded project ` +
          'opens with this file, and the measurements behind each block belong in the ' +
          "docblocks of renderPnpmWorkspaceYaml, SCAFFOLD_BUILT_DEPENDENCIES and " +
          'SCAFFOLD_ALLOWED_PEER_VERSIONS in src/commands/init.ts: one comment line per ' +
          `block, directly above its key, at most ${MAX_COMMENT_COLUMNS} columns.`,
      ).toEqual([]);
    },
  );
});
