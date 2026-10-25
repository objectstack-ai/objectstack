#!/usr/bin/env node
/**
 * Rewrites `QUICK_REFERENCE.md`'s "Current Release" rows from the manifests that
 * anchor them, so the block cannot fossilise when an anchor moves.
 *
 * ## Why this exists (objectui#5394 — the third instance of one mechanism)
 *
 * `scripts/__tests__/quick-reference-current-release-4143.test.ts` derives the
 * legal version literals from the manifests and fails on any literal in the block
 * that nothing derives. It is correct and stays exactly as it is; this script is
 * not a way to make it quieter, it is the thing that keeps the doc true so the
 * gate has nothing to report.
 *
 * The gate's own preamble states the intended workflow — "edit the anchor and that
 * test tells you to edit this block". That assumes a human is holding the anchor
 * when it moves. **At release time nobody is.** `.github/workflows/changeset-release.yml`
 * runs `pnpm changeset:version`, which rewrites every manifest in the `fixed` group,
 * and the changesets action commits the result to `changeset-release/main`. Nothing
 * in that path had ever touched this doc, so the block was guaranteed to fossilise
 * once per release:
 *
 *   - objectui#4642 — doc said 17.4.0 after the 17.5.0 release commit
 *   - objectui#4977 — the GA-pin residue of the same family
 *   - objectui#5394 — doc said 17.5.0 after the 17.6.0 release commit
 *
 * And the release PR is not a backstop, which was measured rather than assumed:
 * every `ci.yml` run on branch `changeset-release/main` carries
 * `conclusion: "action_required"` with `created_at == run_started_at` — the
 * workflow never executes there, because the PR is authored by the bot with
 * `GITHUB_TOKEN`. So the gate cannot see the release until it is already on `main`,
 * which is why `main` (not a PR) goes red once per release. A fix that only makes
 * the doc DERIVABLE changes nothing about that; the derivation has to RUN at the
 * moment the anchor moves, and the only such moment in the release path is
 * `changeset:version`. That is where `package.json` invokes this file, and
 * `scripts/__tests__/sync-quick-reference-release.test.ts` pins the wiring so the
 * next person cannot quietly unhook it.
 *
 * ## What it rewrites, and what it refuses to
 *
 * Only version LITERALS, only inside `## Current Release`, only on rows that carry
 * an anchor. The hand-written prose around them — including each row's note naming
 * its own anchor — is preserved verbatim, because those notes are the reason the
 * rows are readable and the gate's header calls them out as deliberately rewordable.
 *
 * A row is rewritten only when its literal COUNT still matches its anchor's. If a
 * row states three literals where the anchor derives two (the React row grows a
 * major, say), positional substitution would be a guess, so this refuses that row
 * and exits non-zero. Loud refusal fails the release step; the alternative — guess
 * and commit — is how a doc ends up confidently wrong. The gate stays the judge
 * either way.
 *
 * The `TypeScript` row is untouched on purpose: it has no anchor (no workspace
 * manifest declares a `typescript` range), the gate allowlists it by exact text and
 * fails the moment an anchor appears. Nothing here can derive it, so nothing here
 * pretends to.
 *
 * Run:  node scripts/sync-quick-reference-release.mjs           # rewrite in place
 *       node scripts/sync-quick-reference-release.mjs --check   # report only
 * Exit: 0 = in sync (or synced), 1 = out of sync (--check) or a row was refused
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The document this script owns a few literals inside of. */
export const DOC_REL = 'QUICK_REFERENCE.md';

/**
 * A version literal, in the spellings this block uses.
 *
 * Deliberately character-for-character the same source text as `VERSION_LITERAL`
 * in `scripts/__tests__/quick-reference-current-release-4143.test.ts`. Two copies
 * would be free to drift — one tokenizer writing and a different one judging is
 * how a "synced" doc still fails the gate — so the test file asserts the two
 * spellings are identical rather than trusting this comment.
 */
export const VERSION_LITERAL = /(?:\^|~|>=|<=|>|<|≥|≤)\s*v?\d[\w.-]*|\bv?\d+\.[A-Za-z0-9][\w.-]*/g;

/** Whitespace-insensitive comparison key, matching the gate's `normalize`. */
export const normalize = (literal) => literal.replace(/\s+/g, '');

/**
 * @typedef {object} Anchors
 * @property {string} version      the one version the `fixed` group carries
 * @property {string} spec         the `@objectstack/spec` range
 * @property {string} client       the `@objectstack/client` range
 * @property {string} nodeFloor    version floor out of root `engines.node`
 * @property {string} pnpmFloor    version floor out of root `engines.pnpm`
 * @property {string} pnpmPinned   the version half of root `packageManager`
 * @property {string[]} reactMajors the majors named by the react peer range
 */

function manifest(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

/**
 * The majors named by a peer range like `^18.0.0 || ^19.0.0`.
 *
 * Split on the `||` comparators first and take the leading number of each. One
 * global `\d+\.` sweep instead returns `[18, 0, 19, 0]` — the patch segments match
 * it too — and here that mistake is silent: an extra major only adds a literal the
 * row does not state, and the count check would then refuse the row for the wrong
 * reason. Same reasoning as the gate's copy of this function.
 */
export function peerMajors(range) {
  return range
    .split('||')
    .map((comparator) => comparator.trim().match(/^[\^~>=<\s]*(\d+)\./)?.[1])
    .filter((major) => major !== undefined);
}

/**
 * The floor an `engines`-style range states, as the WHOLE version string — not
 * just its leading integer group.
 *
 * objectui#6313: the previous derivation, `match(/(\d+)/)?.[1]`, kept only the
 * leading digits, so `>=22.11` produced a floor of `22` and this script would
 * regenerate `≥ 22`, silently discarding the `.11` the anchor actually states.
 * Stripping the comparator and keeping the remainder whole means the row this
 * script writes and the anchor it reads can no longer disagree at any segment
 * the anchor carries. Same derivation as the gate's copy of this function.
 */
export function versionFloor(range) {
  return range.match(/^[\^~>=<\s]*(.+)$/)?.[1];
}

/**
 * Reads every anchor the block quotes, from the manifests that own them.
 *
 * Throws — rather than defaulting — when an anchor is missing or when two
 * manifests a row names as its joint anchor disagree. A row that names two files
 * cannot state one value while they disagree, and the release path must stop
 * rather than pick one: the same judgement the gate makes, made before the write
 * instead of after it.
 *
 * @param {string} [root]
 * @returns {Anchors}
 */
export function readAnchors(root = repoRoot) {
  const rootManifest = manifest(root, 'package.json');
  const consoleManifest = manifest(root, 'apps/console/package.json');
  const dataObjectstack = manifest(root, 'packages/data-objectstack/package.json');
  const reactManifest = manifest(root, 'packages/react/package.json');

  const changesetConfig = JSON.parse(readFileSync(join(root, '.changeset/config.json'), 'utf8'));
  const fixedGroup = changesetConfig.fixed?.[0] ?? [];
  if (fixedGroup.length <= 1) {
    throw new Error('.changeset/config.json must still declare one `fixed` group of packages');
  }

  // The version is a fact about the WORKSPACE, not about whichever manifest we
  // happened to read: assert the group still carries one version before quoting
  // it, exactly as the gate does. A split group makes a single `**Version:**` row
  // inexpressible, and this must say so rather than pin an arbitrary member.
  const versions = new Map();
  for (const rel of ['packages', 'apps']) {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgRel = `${rel}/${entry.name}/package.json`;
      if (!existsSync(join(root, pkgRel))) continue;
      const pkg = manifest(root, pkgRel);
      if (!pkg.name || !fixedGroup.includes(pkg.name)) continue;
      versions.set(pkg.name, pkg.version ?? '<none>');
    }
  }
  const distinct = [...new Set(versions.values())];
  if (distinct.length !== 1) {
    throw new Error(
      `the changeset \`fixed\` group must carry ONE version; got ${JSON.stringify([...versions])}`,
    );
  }

  const specFromRoot = rootManifest.devDependencies?.['@objectstack/spec'];
  const specFromConsole = consoleManifest.devDependencies?.['@objectstack/spec'];
  if (!specFromRoot || !specFromConsole) throw new Error('@objectstack/spec is no longer declared where the Spec row says it is');
  if (specFromRoot !== specFromConsole) {
    throw new Error(
      `root and apps/console declare different @objectstack/spec ranges (${specFromRoot} vs ${specFromConsole}) — ` +
        `${DOC_REL}'s Spec row names both as its anchor and can no longer state one value`,
    );
  }

  const clientFromConsole = consoleManifest.devDependencies?.['@objectstack/client'];
  const clientFromAdapter = dataObjectstack.dependencies?.['@objectstack/client'];
  if (!clientFromConsole || !clientFromAdapter) throw new Error('@objectstack/client is no longer declared where the Client row says it is');
  if (clientFromConsole !== clientFromAdapter) {
    throw new Error(
      `apps/console and packages/data-objectstack declare different @objectstack/client ranges ` +
        `(${clientFromConsole} vs ${clientFromAdapter}) — ${DOC_REL}'s Client row names both as its anchor`,
    );
  }

  const nodeFloor = rootManifest.engines?.node && versionFloor(rootManifest.engines.node);
  const pnpmFloor = rootManifest.engines?.pnpm && versionFloor(rootManifest.engines.pnpm);
  const pnpmPinned = rootManifest.packageManager?.split('@').pop();
  if (!nodeFloor) throw new Error('root package.json must still declare a version-floor engines.node');
  if (!pnpmFloor) throw new Error('root package.json must still declare a version-floor engines.pnpm');
  if (!pnpmPinned) throw new Error('root package.json must still declare packageManager');

  const peer = reactManifest.peerDependencies?.react;
  if (!peer) throw new Error('packages/react must still declare a react peer range');
  const reactMajors = peerMajors(peer);
  if (reactMajors.length === 0) throw new Error(`could not read majors out of the react peer range "${peer}"`);

  return {
    version: distinct[0],
    spec: specFromRoot,
    client: clientFromConsole,
    nodeFloor,
    pnpmFloor,
    pnpmPinned,
    reactMajors,
  };
}

/**
 * The literals each anchored row must state, **in the order the row states them**.
 *
 * Order matters here and nowhere else: when more than one literal on a row changes
 * at once, `syncDoc` fills the leftover slots left-to-right, so this array is what
 * decides which value lands in which slot. The pnpm row reads "floor, then pinned",
 * and so does this.
 *
 * @param {Anchors} anchors
 * @returns {Map<string, string[]>}
 */
export function derivedLiteralsByRow(anchors) {
  return new Map([
    ['Version', [anchors.version]],
    ['Spec', [anchors.spec]],
    ['Client', [anchors.client]],
    ['Node.js', [`≥ ${anchors.nodeFloor}`]],
    ['pnpm', [`≥ ${anchors.pnpmFloor}`, anchors.pnpmPinned]],
    ['React', anchors.reactMajors.map((major) => `${major}.x`)],
  ]);
}

const SECTION_HEADING = '## Current Release';

/**
 * Line spans of the anchored rows inside `## Current Release`.
 *
 * A row runs from its `- **Label:**` line up to the next bullet, blank line or
 * block quote — the same extent the gate reads, so a literal that a future editor
 * pushes onto a continuation line is inside both or outside both.
 *
 * @returns {{ label: string, start: number, end: number }[]}
 */
function rowSpans(lines) {
  const start = lines.findIndex((line) => line.trim() === SECTION_HEADING);
  if (start === -1) throw new Error(`${DOC_REL} must still have a "${SECTION_HEADING}" heading`);

  const after = lines.slice(start + 1);
  const relEnd = after.findIndex((line) => /^## /.test(line));
  const sectionEnd = relEnd === -1 ? lines.length : start + 1 + relEnd;

  const spans = [];
  for (let i = start + 1; i < sectionEnd; i += 1) {
    const head = lines[i].match(/^- \*\*(.+?):\*\*/);
    if (!head) continue;
    let end = i + 1;
    while (end < sectionEnd) {
      const next = lines[end];
      if (next.trim() === '' || /^- \*\*/.test(next) || /^>/.test(next)) break;
      end += 1;
    }
    spans.push({ label: head[1], start: i, end });
  }
  return spans;
}

/**
 * Assigns each derived literal to a slot in the row, identity first.
 *
 * Literals already correct keep their own slot, so a row where only one of two
 * values moved (pnpm's `packageManager` bumping while the floor holds) is edited
 * in exactly one place. Only what is left over is filled positionally, which is
 * the single spot where the order of `derivedLiteralsByRow` is load-bearing.
 *
 * @param {string[]} stated normalized literals, in order of appearance
 * @param {string[]} derived literals to end up with, in row order
 * @returns {(string | null)[]} per slot: the replacement text, or null to keep
 */
export function assignSlots(stated, derived) {
  const remaining = [...derived];
  const plan = stated.map((value) => {
    const hit = remaining.findIndex((candidate) => normalize(candidate) === value);
    if (hit === -1) return undefined;
    remaining.splice(hit, 1);
    return null; // already correct — leave the row's own spelling alone
  });
  return plan.map((slot) => (slot === null ? null : remaining.shift() ?? null));
}

/**
 * @typedef {object} SyncResult
 * @property {string} doc      the document, rewritten where it was safe to
 * @property {{ label: string, from: string, to: string }[]} changes
 * @property {{ label: string, stated: string[], derived: string[], reason: string }[]} refusals
 */

/**
 * Rewrites the anchored rows of `doc` to state `derived`.
 *
 * @param {string} doc
 * @param {Map<string, string[]>} derived
 * @returns {SyncResult}
 */
export function syncDoc(doc, derived) {
  const lines = doc.split('\n');
  const changes = [];
  const refusals = [];

  for (const { label, start, end } of rowSpans(lines)) {
    const want = derived.get(label);
    if (!want) continue; // unanchored (the TypeScript row) — not ours to touch

    const rowLines = lines.slice(start, end);

    // Per-line scanning is what makes the rewrite safe (a replacement never has
    // to be split across a newline), but the gate reads the row JOINED. The two
    // views can disagree in one place: `≥\n  22` is one literal joined and none
    // per line, because the regex's `\s*` matches a newline. Counting both ways
    // and refusing on disagreement means this never edits a row it is reading
    // differently from the gate that will judge it.
    const perLine = rowLines.flatMap((line) => [...line.matchAll(VERSION_LITERAL)].map((m) => m[0]));
    const joined = [...rowLines.join(' ').matchAll(VERSION_LITERAL)].map((m) => m[0]);
    if (perLine.length !== joined.length) {
      refusals.push({
        label,
        stated: joined.map(normalize),
        derived: want,
        reason: 'a version literal spans a line break, so this row reads differently line-by-line than the gate reads it joined',
      });
      continue;
    }

    const stated = perLine.map(normalize);
    const wantKeys = want.map(normalize);
    const same =
      stated.length === wantKeys.length && [...stated].sort().join('|') === [...wantKeys].sort().join('|');
    if (same) continue;

    if (stated.length !== want.length) {
      refusals.push({
        label,
        stated,
        derived: want,
        reason: `the row states ${stated.length} version literal(s) and its anchor derives ${want.length}; ` +
          'which slot gets which value would be a guess',
      });
      continue;
    }

    const plan = assignSlots(stated, want);
    let slot = 0;
    for (let i = 0; i < rowLines.length; i += 1) {
      rowLines[i] = rowLines[i].replace(VERSION_LITERAL, (match) => {
        const replacement = plan[slot];
        const current = match;
        slot += 1;
        if (replacement === null) return current;
        changes.push({ label, from: current, to: replacement });
        return replacement;
      });
    }
    lines.splice(start, end - start, ...rowLines);
  }

  return { doc: lines.join('\n'), changes, refusals };
}

export function main(argv = process.argv.slice(2), root = repoRoot) {
  const checkOnly = argv.includes('--check');
  const docPath = join(root, DOC_REL);
  const before = readFileSync(docPath, 'utf8');

  let result;
  try {
    result = syncDoc(before, derivedLiteralsByRow(readAnchors(root)));
  } catch (error) {
    console.error(`❌  Cannot sync ${DOC_REL}'s "Current Release" block:\n\n    ${error.message}\n`);
    return 1;
  }

  for (const refusal of result.refusals) {
    console.error(
      `❌  Refusing to rewrite the "${refusal.label}" row of ${DOC_REL}:\n` +
        `    ${refusal.reason}\n` +
        `    the row states ${JSON.stringify(refusal.stated)}; its anchor derives ${JSON.stringify(refusal.derived)}\n` +
        '    Edit the row by hand, then re-run this script.\n',
    );
  }

  if (result.doc === before) {
    if (result.refusals.length > 0) return 1;
    console.log(`✅  ${DOC_REL}'s "Current Release" block already states every anchor.`);
    return 0;
  }

  for (const change of result.changes) {
    console.log(`    ${change.label}: ${change.from} → ${change.to}`);
  }

  if (checkOnly) {
    console.error(
      `\n❌  ${DOC_REL}'s "Current Release" block has drifted from its anchors.\n` +
        '    Run:  node scripts/sync-quick-reference-release.mjs\n',
    );
    return 1;
  }

  writeFileSync(docPath, result.doc);
  console.log(`\n✅  Rewrote ${DOC_REL}'s "Current Release" block from its anchors.`);
  return result.refusals.length > 0 ? 1 : 0;
}

// Only run when invoked as a script — the tests import the functions above.
if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
