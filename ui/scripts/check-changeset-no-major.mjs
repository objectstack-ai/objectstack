#!/usr/bin/env node
/**
 * Fails when a pending changeset declares a `major` bump, except the one
 * `major` the version-alignment rule admits: the synchronized bump that carries
 * the fixed group exactly onto the `@objectstack/spec` major it depends on.
 *
 * Why this is a gate and not a review note: every publishable package in this
 * repo sits in ONE `fixed` group (`.changeset/config.json`, 39 packages), and
 * changesets applies the highest bump in the group to all of it. So a single
 * `"@object-ui/layout": major` does not release one package as a major — it
 * carries the whole family to the next major and off `@objectstack`'s line.
 *
 * That matters because objectui's major is not its own count of breaking
 * changes: it is pinned to the `@objectstack` (spec/client/formula) major, so
 * that "same major ⇒ compatible" holds across the two repos (AGENTS.md
 * §版本号策略). objectui's own breaking changes ship as `minor` with the break
 * spelled out in the changeset body. The major moves exactly once per
 * objectstack major, deliberately.
 *
 * This ran for the first time against four pending changesets scoring `major`
 * (17 package entries between them) during the 17.x line — enough to publish
 * 39 packages as 18.0.0 against an `@objectstack` still on 17. The rule was
 * already written down; nothing executed it, and no workflow even looked at
 * `.changeset/**` (at the time `ci.yml` and `lint.yml` both listed it under
 * `paths-ignore` on their `pull_request` trigger, so a changeset-only PR started
 * nothing at all).
 *
 * That parenthetical is history, not today's shape: objectui#3523 step 2 deleted
 * `paths-ignore` from those two `pull_request` triggers and it remains ONLY on
 * `push`, so such a PR now starts both workflows and produces their contexts.
 * What skips is the expensive work inside them — the `Decide whether this change
 * needs a full run` step excludes markdown and `.changeset/**` and skips every
 * step below itself. So no gate in either workflow reads the changeset either
 * way, and this one, run by `.github/workflows/changeset-guard.yml` outside that
 * in-job switch, is still the only thing that judges such a PR. The conclusion
 * outlived its premise; objectui#3857 pinned the correction.
 *
 * ## The one admitted `major` — computed, never switched on (objectui#12334)
 *
 * The maintainer's ruling on objectui#12030 (comment 6149296149) took the
 * narrowest form: a `major` passes only when it takes objectui exactly onto the
 * major its `@objectstack/spec` dependency names; every other `major` is still
 * refused. This gate computes that from the checkout, entry by entry:
 *
 *   1. the package is named in a `fixed` group of `.changeset/config.json` — a
 *      `major` on anything else is not the group's synchronized bump;
 *   2. the group's CURRENT major is the major of the `version` its members'
 *      manifests declare (they move as one; members that disagree are refused,
 *      because no single answer exists);
 *   3. the group's SPEC major is the major of the `@objectstack/spec` range its
 *      members declare in a consumer-facing field — `dependencies`,
 *      `peerDependencies`, `optionalDependencies`, the list
 *      `check-phantom-dependencies.mjs` calls RUNTIME_FIELDS. A
 *      `devDependencies` range is installed for nobody and names nothing;
 *   4. the entry is admitted when CURRENT + 1 equals SPEC, and refused otherwise.
 *
 * The range reader is deliberately narrow: `^`, `~`, `=` or a bare `X.Y.Z`,
 * optionally with a prerelease (`^18.0.0-next.1`). A union, an open lower bound,
 * an x-range or a protocol spelling names no single major, so it is refused
 * rather than guessed — the failure direction that matters is a `major`
 * admitted on a guess. The same holds for a group whose members disagree, a
 * member with no manifest, and a group none of whose members declares the spec.
 *
 * The switch this replaces, the `OBJECTUI_ALLOW_MAJOR` environment variable, is
 * retired: no workflow set it, and an admission a person had to remember to
 * switch on for one release was a bypass for every `major`, not only the
 * synchronized one. Nothing here reads the environment.
 *
 * ## `.changeset/pre/` holds consumed changesets, and is not read
 *
 * In Changesets pre mode (`.changeset/pre.json`), `changeset version` does not
 * delete the changesets it consumes: `@changesets/apply-release-plan` MOVES each
 * one to `.changeset/pre/`, and `@changesets/assemble-release-plan` leaves
 * `pre/` out of the release plan while `pre.json` says `"mode": "pre"`. Those
 * files are records of a version that has already been produced — the
 * manifests carry it — and this gate judged each of them while it was still
 * pending at the top level. So this gate reads `.changeset/*.md` only:
 *
 *   - reading `pre/` would refuse the consumed synchronized `major` against the
 *     group it has already moved (`18.0.0-next.N` has major 18, and 18 + 1 is
 *     not 18);
 *   - a NEW `major` after that point is pending at the top level and is refused
 *     for the same arithmetic, which is "every other `major` is refused";
 *   - on `changeset pre exit` the planner reads `pre/` again, but it increments
 *     the group's prerelease, and a pre-major `X.0.0-TAG.N` increments to
 *     `X.0.0` for every bump type, so a consumed `major` cannot move the group
 *     off its major there either.
 *
 * Run:  node scripts/check-changeset-no-major.mjs
 * Exit: 0 = no `major` declared, or every `major` is the synchronized one
 *       1 = at least one `major` is refused
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `.changeset/README.md` is documentation, not a changeset. */
const NOT_A_CHANGESET = new Set(['README.md']);

/** The dependency whose major the fixed group follows. */
export const SPEC_PACKAGE = '@objectstack/spec';

/**
 * Where the fixed group's manifests live. The same roots as
 * `check-phantom-dependencies.mjs`'s PACKAGE_ROOTS, restated rather than
 * imported because that module imports `typescript`, and this gate runs in a
 * bare checkout with no install (`check:pre-install-import-graph` holds that).
 * The test file pins the two lists equal.
 */
export const GROUP_ROOTS = ['packages', 'apps'];

/**
 * The fields a consumer's install honours: `check-phantom-dependencies.mjs`'s
 * RUNTIME_FIELDS, restated for the same reason and pinned equal by the test.
 */
export const CONSUMER_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * Package/bump pairs from a changeset's YAML frontmatter — the block between
 * the leading `---` and the next `---`.
 *
 * Hand-parsed on purpose: this check runs in CI on a bare checkout with no
 * `pnpm install` (the job is a checkout plus a `node` invocation), so it may
 * not import a YAML parser or `@changesets/*`. The frontmatter dialect is
 * tiny and fully covered here — one `name: bump` per line, name optionally
 * quoted, `#` comments and blank lines ignored.
 *
 * @param {string} source raw file contents
 * @returns {{ pkg: string, bump: string, line: number }[]}
 */
export function parseFrontmatterBumps(source) {
  const lines = source.split(/\r?\n/);
  const open = lines.findIndex((line) => line.trim() === '---');
  if (open === -1) return [];

  const bumps = [];
  for (let i = open + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '---') break; // end of frontmatter
    const text = raw.trim();
    if (text === '' || text.startsWith('#')) continue;

    const match = text.match(
      /^(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(major|minor|patch)\s*$/
    );
    if (!match) continue;

    bumps.push({
      pkg: match[1] ?? match[2] ?? match[3],
      bump: match[4],
      line: i + 1, // 1-based, for a clickable `file:line`
    });
  }
  return bumps;
}

/**
 * @param {{ file: string, source: string }[]} changesets
 * @returns {{ file: string, pkg: string, line: number }[]} every `major` entry
 */
export function findMajorBumps(changesets) {
  return changesets.flatMap(({ file, source }) =>
    parseFrontmatterBumps(source)
      .filter(({ bump }) => bump === 'major')
      .map(({ pkg, line }) => ({ file, pkg, line }))
  );
}

/**
 * Reads the PENDING changesets: `.changeset/*.md`, minus the README.
 *
 * `.changeset/pre/` is not read — those are consumed changesets; the header's
 * last section says why reading them would be wrong in both directions.
 */
export function readPendingChangesets(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // no `.changeset/` — nothing to police
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !NOT_A_CHANGESET.has(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      file: join('.changeset', name),
      source: readFileSync(join(dir, name), 'utf8'),
    }));
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** The major of an `X.Y.Z` version, prerelease allowed. Throws on anything else. */
export function majorOfVersion(version) {
  const match = VERSION.exec(String(version ?? '').trim());
  if (!match) throw new Error(`"${version}" is not an X.Y.Z version`);
  return Number(match[1]);
}

const ONE_MAJOR_RANGE = /^(?:\^|~|=)?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * The one major a range names. Narrow on purpose — see the header: anything
 * that does not name exactly one major throws, and a throw refuses the `major`.
 */
export function majorOfRange(range) {
  const match = ONE_MAJOR_RANGE.exec(String(range ?? '').trim());
  if (!match) {
    throw new Error(
      `"${range}" names no single major this gate reads (\`^\`, \`~\`, \`=\` or a bare X.Y.Z, optionally a prerelease)`
    );
  }
  return Number(match[1]);
}

/** The `fixed` groups of `.changeset/config.json`, as arrays of package names. */
export function readFixedGroups(repoRoot) {
  const config = JSON.parse(readFileSync(join(repoRoot, '.changeset', 'config.json'), 'utf8'));
  return Array.isArray(config.fixed) ? config.fixed.filter(Array.isArray) : [];
}

/** Every workspace manifest under GROUP_ROOTS, by package name. */
export function readWorkspaceManifests(repoRoot) {
  const manifests = new Map();
  for (const parent of GROUP_ROOTS) {
    let entries;
    try {
      entries = readdirSync(join(repoRoot, parent));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const file = join(repoRoot, parent, entry, 'package.json');
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      if (manifest.name) manifests.set(manifest.name, manifest);
    }
  }
  return manifests;
}

/**
 * The fixed group's current major and the `@objectstack/spec` major it
 * declares — or the reason neither can be named.
 *
 * @param {string[]} group
 * @param {Map<string, object>} manifests
 * @returns {{ current: number, spec: number } | { problem: string }}
 */
export function describeGroup(group, manifests) {
  const versionMajors = new Map();
  const specMajors = new Map();
  for (const name of group) {
    const manifest = manifests.get(name);
    if (!manifest) {
      return { problem: `the group names ${name}, which no manifest under ${GROUP_ROOTS.join('/ or ')}/ declares` };
    }
    try {
      const major = majorOfVersion(manifest.version);
      if (!versionMajors.has(major)) versionMajors.set(major, name);
    } catch (error) {
      return { problem: `${name}'s version: ${error.message}` };
    }
    for (const field of CONSUMER_FIELDS) {
      const range = manifest[field]?.[SPEC_PACKAGE];
      if (typeof range !== 'string') continue;
      try {
        const major = majorOfRange(range);
        if (!specMajors.has(major)) specMajors.set(major, `${name} ${field}`);
      } catch (error) {
        return { problem: `${name} ${field}["${SPEC_PACKAGE}"]: ${error.message}` };
      }
    }
  }
  if (versionMajors.size !== 1) {
    const seen = [...versionMajors].map(([major, name]) => `${major} (${name})`).join(', ');
    return { problem: `the group's members are on different majors: ${seen}` };
  }
  if (specMajors.size === 0) {
    return { problem: `no member of the group declares ${SPEC_PACKAGE} in ${CONSUMER_FIELDS.join(', ')}` };
  }
  if (specMajors.size !== 1) {
    const seen = [...specMajors].map(([major, where]) => `${major} (${where})`).join(', ');
    return { problem: `the group's members declare ${SPEC_PACKAGE} on different majors: ${seen}` };
  }
  return { current: [...versionMajors.keys()][0], spec: [...specMajors.keys()][0] };
}

/**
 * Split `major` entries into the synchronized ones and the refused ones.
 *
 * @param {{ file: string, pkg: string, line: number }[]} offenders
 * @param {{ groups: string[][], manifests: Map<string, object> }} state
 */
export function judgeMajorBumps(offenders, { groups, manifests }) {
  const admitted = [];
  const refused = [];
  const described = new Map();
  for (const entry of offenders) {
    const group = groups.find((members) => members.includes(entry.pkg));
    if (!group) {
      refused.push({ ...entry, reason: 'not in a `fixed` group, so it cannot be the group\'s synchronized major' });
      continue;
    }
    if (!described.has(group)) described.set(group, describeGroup(group, manifests));
    const state = described.get(group);
    if ('problem' in state) {
      refused.push({ ...entry, reason: `${state.problem}, so no synchronized major can be named` });
    } else if (state.current + 1 !== state.spec) {
      refused.push({
        ...entry,
        reason:
          `carries the group from ${state.current} to ${state.current + 1}, but its ${SPEC_PACKAGE} ` +
          `range names ${state.spec}`,
      });
    } else {
      admitted.push({ ...entry, from: state.current, to: state.spec });
    }
  }
  return { admitted, refused };
}

/**
 * The whole verdict for one checkout. The group's manifests are read only when
 * a `major` is pending, so the common case reads exactly what it always read.
 */
export function analyze(repoRoot) {
  const offenders = findMajorBumps(readPendingChangesets(join(repoRoot, '.changeset')));
  if (offenders.length === 0) return { offenders, admitted: [], refused: [] };
  let state;
  try {
    state = { groups: readFixedGroups(repoRoot), manifests: readWorkspaceManifests(repoRoot) };
  } catch (error) {
    const reason = `the release group could not be read (${error.message}), so no synchronized major can be named`;
    return { offenders, admitted: [], refused: offenders.map((entry) => ({ ...entry, reason })) };
  }
  return { offenders, ...judgeMajorBumps(offenders, state) };
}

function main() {
  const { offenders, admitted, refused } = analyze(root);

  if (offenders.length === 0) {
    console.log('✅  No changeset declares a `major` bump.');
    return 0;
  }

  if (refused.length === 0) {
    console.log(
      `✅  Every \`major\` is the synchronized one: it carries its fixed group onto the major of the ` +
        `${SPEC_PACKAGE} range the group declares.`
    );
    const byFile = new Map();
    for (const { file, from, to } of admitted) {
      const key = `${file}: ${from} → ${to}`;
      byFile.set(key, (byFile.get(key) ?? 0) + 1);
    }
    for (const [key, count] of byFile) {
      console.log(`    • ${key}, ${count} \`major\` entr${count === 1 ? 'y' : 'ies'}`);
    }
    return 0;
  }

  console.error('❌  A changeset declares a `major` bump this repository refuses:\n');
  for (const { file, pkg, line, reason } of refused) {
    console.error(`    • ${pkg}  (${file}:${line}) — ${reason}`);
  }
  console.error(`
Every publishable package is in one \`fixed\` group, so ONE \`major\` publishes
all of them as the next major — objectui would leave the \`@objectstack\` major
it is pinned to, and "same major ⇒ compatible" would stop holding.

Fix: score it \`minor\` and describe the break in the changeset body (that is
the convention, not an oversight — see AGENTS.md §版本号策略).

The one \`major\` admitted is the synchronized bump that follows \`@objectstack\`
across its own major: a fixed-group package whose group's current major plus one
equals the major of the ${SPEC_PACKAGE} range the group's manifests declare.
`);
  return 1;
}

// Only run when invoked as a script — the tests import the functions above.
if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
