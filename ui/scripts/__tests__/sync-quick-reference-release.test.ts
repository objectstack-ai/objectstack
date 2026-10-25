import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS release helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), the same arrangement
// `check-changeset-no-major.test.ts` documents — so no `@ts-expect-error` here.
import {
  assignSlots,
  derivedLiteralsByRow,
  normalize,
  readAnchors,
  syncDoc,
  VERSION_LITERAL,
} from '../sync-quick-reference-release.mjs';

/**
 * objectui#5394 — `QUICK_REFERENCE.md`'s "Current Release" block fossilised once per
 * release, three times (objectui#4642, objectui#4977, objectui#5394). The gate that
 * catches it (`quick-reference-current-release-4143.test.ts`) is correct and untouched;
 * what was missing is anything that MOVES the doc when the anchor moves.
 *
 * The anchor moves inside `changeset version`, run by `changeset-release.yml` with no
 * human present, and the release PR is not a backstop: every `ci.yml` run on branch
 * `changeset-release/main` is `conclusion: "action_required"` with
 * `created_at == run_started_at`, because a `GITHUB_TOKEN`-authored PR does not start
 * workflows. The first thing that ever reads the release is the `push` build on `main`,
 * which is why `main` — not a PR — went red every time.
 *
 * So the fix is a script wired INTO `changeset:version`, and the load-bearing assertion
 * in this file is the wiring one. A sync script nothing calls is exactly as effective as
 * the hand edit it replaces: the first two instances were both fixed by someone who knew
 * the right value and typed it in.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const SCRIPT_REL = 'scripts/sync-quick-reference-release.mjs';
const GATE_REL = 'scripts/__tests__/quick-reference-current-release-4143.test.ts';
const DOC_REL = 'QUICK_REFERENCE.md';

describe('the release path actually runs the sync', () => {
  /**
   * The whole card in one assertion. `changeset version` is the only moment the
   * workspace version moves, and nobody is watching it — if this script is not on
   * that command line, the doc goes stale again on the next release and `main` goes
   * red again, exactly as it did three times.
   */
  it('`changeset:version` invokes the sync script after bumping the manifests', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const script = pkg.scripts?.['changeset:version'];

    expect(script, 'root package.json must still declare a `changeset:version` script').toBeDefined();
    expect(
      script,
      '`changeset:version` must still run `changeset version` — it is what the release ' +
        'workflow calls to bump the manifests',
    ).toContain('changeset version');
    expect(
      script,
      `\`changeset:version\` must also run ${SCRIPT_REL}, or the release bumps every manifest ` +
        `and leaves ${DOC_REL} a version behind (objectui#5394, and objectui#4642 before it)`,
    ).toContain(SCRIPT_REL);
  });

  /**
   * The other half of the wiring: the workflow must go THROUGH the npm script rather
   * than calling `changeset version` itself. Pinning only `package.json` would leave a
   * one-word edit here able to skip the sync silently.
   */
  it('`changeset-release.yml` versions through `pnpm changeset:version`', () => {
    const workflow = read('.github/workflows/changeset-release.yml');
    const versionInput = workflow.match(/^\s*version:\s*(.+)$/m)?.[1]?.trim();

    expect(
      versionInput,
      'changeset-release.yml must still hand the changesets action a `version:` command',
    ).toBeDefined();
    expect(
      versionInput,
      'the release must version through the `changeset:version` npm script — calling ' +
        '`changeset version` directly here would bypass the sync that keeps ' +
        `${DOC_REL} in step with the manifests`,
    ).toBe('pnpm changeset:version');
  });
});

describe('the writer and the judge read the same tokens', () => {
  /**
   * The script writes literals; the gate judges them. Two tokenizers would be free to
   * drift, and the failure mode is a doc that this script calls synced and the gate
   * calls stale — a release that cannot be made green by running the tool that is
   * supposed to make it green. Compared as SOURCE TEXT so the two spellings cannot
   * diverge even in ways that happen to behave alike today.
   */
  it('the script and the gate spell `VERSION_LITERAL` identically', () => {
    const extract = (source: string): string | undefined =>
      source.match(/VERSION_LITERAL = (\/.*\/g);/)?.[1];

    const fromScript = extract(read(SCRIPT_REL));
    const fromGate = extract(read(GATE_REL));

    expect(fromScript, `${SCRIPT_REL} must still define VERSION_LITERAL as a regex literal`).toBeDefined();
    expect(fromGate, `${GATE_REL} must still define VERSION_LITERAL as a regex literal`).toBeDefined();
    expect(
      fromScript,
      'the sync script and the gate must tokenize version literals identically, or the ' +
        'script can "fix" a row the gate still reports',
    ).toBe(fromGate);
    expect(String(VERSION_LITERAL)).toBe(fromScript);
  });
});

describe('the block is in step with its anchors right now', () => {
  /**
   * The same fact the gate asserts, from the writing side: running the sync against the
   * committed tree must be a no-op. A green gate plus a sync that still wants to edit
   * the file would mean the two disagree about what the anchors say.
   */
  it('syncing the committed tree changes nothing and refuses nothing', () => {
    const result = syncDoc(read(DOC_REL), derivedLiteralsByRow(readAnchors(repoRoot)));

    expect(result.refusals, 'the sync must be able to read every anchored row').toEqual([]);
    expect(
      result.changes,
      `${DOC_REL} has drifted from its anchors — run \`pnpm quick-reference:sync\``,
    ).toEqual([]);
    expect(result.doc).toBe(read(DOC_REL));
  });
});

describe('a release bump carries the doc with it', () => {
  const anchors = readAnchors(repoRoot);
  const doc = read(DOC_REL);

  /**
   * The recurrence, simulated at the unit level: move the one anchor `changeset
   * version` moves, and the row must follow without anyone touching the file.
   */
  it('rewrites the Version row when the fixed group moves', () => {
    const bumped = { ...anchors, version: '99.9.9' };
    const result = syncDoc(doc, derivedLiteralsByRow(bumped));

    expect(result.refusals).toEqual([]);
    expect(result.changes).toEqual([{ label: 'Version', from: anchors.version, to: '99.9.9' }]);
    expect(result.doc).toContain(`- **Version:** 99.9.9 (the version every`);
    // Whole literals, never a raw substring, as the gate compares them. The
    // group's version can be a prefix of another row's literal (the group at
    // `18.0.0` beside a `^18.0.0-next.N` spec range), and a substring check then
    // reddened the release lane's validation on a correct rewrite (objectui#13108).
    const literals = [...result.doc.matchAll(VERSION_LITERAL)].map((match) => normalize(match[0]));
    expect(literals).not.toContain(anchors.version);
  });

  /**
   * The prose is the reason these rows are readable — each one names its own anchor in
   * hand-written text, and the gate's header calls that out as deliberately rewordable.
   * A sync that reflowed or regenerated the block would take that away and would make
   * the gate assert generated text against the manifests it was generated from. Only
   * the literal moves.
   */
  it('touches nothing but the literal', () => {
    const { doc: after } = syncDoc(doc, derivedLiteralsByRow({ ...anchors, version: '99.9.9' }));

    const before = doc.split('\n');
    const lines = after.split('\n');
    expect(lines.length).toBe(before.length);

    const differing = lines.map((line, i) => [i, line, before[i]] as const).filter(([, a, b]) => a !== b);
    expect(differing).toHaveLength(1);
    expect(differing[0][1]).toBe(differing[0][2].replace(anchors.version, '99.9.9'));
  });

  /**
   * Two literals on one row, one of them moving: the pnpm row bumps its
   * `packageManager` pin while `engines.pnpm` holds. Identity-first assignment is what
   * keeps the floor in the floor's slot; naive positional filling would write the
   * pinned version into it.
   */
  it('moves only the pnpm literal that changed', () => {
    const { doc: after, changes, refusals } = syncDoc(
      doc,
      derivedLiteralsByRow({ ...anchors, pnpmPinned: '11.0.0' }),
    );

    expect(refusals).toEqual([]);
    expect(changes).toEqual([{ label: 'pnpm', from: anchors.pnpmPinned, to: '11.0.0' }]);
    expect(after).toContain(`≥ ${anchors.pnpmFloor} (the workspace pins \`pnpm@11.0.0\``);
  });

  /**
   * A row whose literal count no longer matches its anchor's. Which slot gets which
   * value is a guess at that point, and a doc that is confidently wrong is worse than
   * one that is visibly stale — so the script refuses the row, exits non-zero, and the
   * release stops instead of committing the guess.
   */
  it('refuses a row whose shape no longer matches its anchor', () => {
    const grown = { ...anchors, reactMajors: [...anchors.reactMajors, '20'] };
    const { doc: after, changes, refusals } = syncDoc(doc, derivedLiteralsByRow(grown));

    expect(changes).toEqual([]);
    expect(after).toBe(doc);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].label).toBe('React');
    expect(refusals[0].reason).toMatch(/would be a guess/);
  });

  /**
   * The unanchored TypeScript row derives from nothing, so the sync must leave it
   * alone rather than invent a value for it. The gate allowlists it by exact text and
   * fails the day an anchor for it appears; that is where the row's fate is decided.
   */
  it('leaves the unanchored TypeScript row alone', () => {
    expect([...derivedLiteralsByRow(anchors).keys()]).not.toContain('TypeScript');
    const { doc: after } = syncDoc(doc, derivedLiteralsByRow({ ...anchors, version: '99.9.9' }));
    expect(after).toContain('- **TypeScript:** ≥ 5.0 (strict mode)');
  });
});

describe('assignSlots', () => {
  it('keeps the literals that are already right where they are', () => {
    expect(assignSlots(['≥9', '10.31.0'], ['≥ 9', '11.0.0'])).toEqual([null, '11.0.0']);
  });

  it('fills leftover slots in row order when everything moved', () => {
    expect(assignSlots(['≥9', '10.31.0'], ['≥ 10', '11.0.0'])).toEqual(['≥ 10', '11.0.0']);
  });

  it('is a no-op when the row already states its anchor', () => {
    expect(assignSlots(['17.6.0'], ['17.6.0'])).toEqual([null]);
  });
});
