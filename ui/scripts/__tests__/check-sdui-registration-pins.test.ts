import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXIT_DROPPED,
  EXIT_NO_MEASUREMENT,
  EXIT_OK,
  NEGATIVE_CONTROL_KEY,
  RULED_CONTROLS,
  countChunksCarrying,
  derivePinnedKeys,
  main,
  sourceFirstEntries,
} from '../check-sdui-registration-pins.mjs';

/**
 * objectui#6683. This gate weighs the BUILT console for the registrations a
 * `sideEffects` array promises to keep. `"sideEffects": false` is statically
 * coherent and drops three of them to 0 chunks (measured, objectui#6535), so
 * the artifact question is not answerable from the source — and a gate about an
 * artifact is the easiest kind to make vacuous: point it at a missing `dist/`,
 * or at a matcher that matches everything, and it reports success forever.
 *
 * Both of those are tested here as FAILURES, alongside the ordinary red.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The registrar body both spellings of the fixture package carry. */
const REGISTRAR = "import { ComponentRegistry } from 'somewhere';\nComponentRegistry.register('fixture:widget', 1);\n";

/**
 * A fixture root: one array package with one registrar, plus a fake console dist.
 *
 * `built` writes the package's PUBLISHED spelling too. The array always names
 * both (that is the `check-side-effects-array` rule), but only a built tree has
 * both on disk — so this flag is how a case states which build state it means
 * instead of inheriting the runner's, which is objectui#6893's whole subject.
 */
function fixture(chunks: Record<string, string>, { built = false }: { built?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'objectui-6683-pins-'));
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  const pkg = path.join(dir, 'packages/pkg');
  fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({
      name: '@fixture/pkg',
      main: './dist/index.js',
      sideEffects: ['./dist/index.js', './src/index.ts'],
    }),
  );
  fs.writeFileSync(path.join(pkg, 'src/index.ts'), REGISTRAR);
  if (built) {
    fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'dist/index.js'), REGISTRAR);
  }
  const assets = path.join(dir, 'apps/console/dist/assets');
  fs.mkdirSync(assets, { recursive: true });
  for (const [name, code] of Object.entries(chunks)) fs.writeFileSync(path.join(assets, name), code);
  return dir;
}

describe('countChunksCarrying', () => {
  const read = (f: string) => f;

  it('counts each of the three quote spellings a minifier may pick', () => {
    expect(countChunksCarrying(["r.register('a:b',x)"], 'a:b', read)).toBe(1);
    expect(countChunksCarrying(['r.register("a:b",x)'], 'a:b', read)).toBe(1);
    expect(countChunksCarrying(['r.register(`a:b`,x)'], 'a:b', read)).toBe(1);
  });

  it('does NOT count a bare substring', () => {
    // `attachments` is a real registry key AND a word that occurs all over a
    // bundle. A matcher that counted those would report every key present
    // whatever the bundler did — the vacuity this gate cannot afford.
    expect(countChunksCarrying(['const attachmentsPanel = 1;'], 'attachments', read)).toBe(0);
    expect(countChunksCarrying(["x('attachments')"], 'attachments', read)).toBe(1);
  });

  it('counts chunks, not occurrences', () => {
    expect(countChunksCarrying(["'a:b' 'a:b' 'a:b'"], 'a:b', read)).toBe(1);
    expect(countChunksCarrying(["'a:b'", "'a:b'"], 'a:b', read)).toBe(2);
  });
});

describe('the fixture console', () => {
  it('passes when the registration is in a chunk', () => {
    const dir = fixture({ 'index-abc.js': "R.register('fixture:widget',()=>1)" });
    try {
      expect(main([], dir, ['fixture:widget'])).toBe(EXIT_OK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when the same build no longer carries it', () => {
    // The partner of the case above: identical package, identical derivation,
    // one chunk's content changed. This is the shape `"sideEffects": false`
    // produces — a green build with the registration simply absent.
    const dir = fixture({ 'index-abc.js': 'console.log(1)' });
    try {
      expect(main([], dir, ['fixture:widget'])).toBe(EXIT_DROPPED);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 — never 0 — when there is no build to weigh', () => {
    const dir = fixture({});
    fs.rmSync(path.join(dir, 'apps/console/dist'), { recursive: true, force: true });
    try {
      expect(main([], dir, ['fixture:widget'])).toBe(EXIT_NO_MEASUREMENT);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 when a pinned control is no longer in the DERIVED set', () => {
    // The floor's own discrimination. `RULED_CONTROLS` is checked against the
    // derivation, so a `sideEffects` array that stopped naming the registering
    // module must not read as "0 keys, all present". Same fixture, a control
    // that nothing registers.
    const dir = fixture({ 'index-abc.js': "R.register('fixture:widget',1)" });
    try {
      expect(main([], dir, ['fixture:widget', 'never:registered'])).toBe(EXIT_NO_MEASUREMENT);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 when a chunk carries the negative control, because then the matcher cannot miss', () => {
    const dir = fixture({
      'index-abc.js': `R.register('fixture:widget',1);const s='${NEGATIVE_CONTROL_KEY}';`,
    });
    try {
      expect(main([], dir, ['fixture:widget'])).toBe(EXIT_NO_MEASUREMENT);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the source spelling wins, whatever the tree has been built to', () => {
  // objectui#6893. A `sideEffects` array names every registrar TWICE — once as
  // `src/x.tsx`, once as `dist/x.js` — and `derivePinnedKeys` attributes a key
  // to the FIRST module it read it from. With no order of its own, the winner
  // was decided by the array's literal order in `package.json` AND by whether
  // `dist/` happened to be on disk. `packages/app-shell/dist` is gitignored, so
  // the SAME COMMIT answered the source spelling on an unbuilt checkout and the
  // published one on a built checkout — a verdict that is a function of hidden
  // local state, which is the family this repo keeps paying for.
  //
  // The two cases below are ONE assertion run over the two build states, which
  // is the property itself. They use a fixture rather than the workspace on
  // purpose: a fixture owns its own build state, so these cases keep asserting
  // the preference on a machine where nothing has been built — exactly the
  // machines a conditional skip would have stopped running on.
  const chunk = { 'index-abc.js': "R.register('fixture:widget',1)" };

  it('attributes the key to the SOURCE spelling when BOTH spellings are on disk', () => {
    const dir = fixture(chunk, { built: true });
    try {
      const { keys, sources, modulesRead } = derivePinnedKeys(dir);
      // Both spellings were still READ: this is a reordering, not a filter, so
      // the derived population — the only input to the gate's verdict — cannot
      // move. If this drops to 1 the fix has started hiding modules instead.
      expect(modulesRead).toBe(2);
      expect(keys).toEqual(['fixture:widget']);
      expect(sources.get('fixture:widget')).toBe('packages/pkg/src/index.ts');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives that same answer when only the source spelling is on disk', () => {
    const dir = fixture(chunk);
    try {
      const { keys, sources, modulesRead } = derivePinnedKeys(dir);
      expect(modulesRead).toBe(1);
      expect(keys).toEqual(['fixture:widget']);
      expect(sources.get('fixture:widget')).toBe('packages/pkg/src/index.ts');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('THROWS rather than falling back to array order when the two spellings cannot be told apart', () => {
    // The ordering is derived from the package's own spelling map. When that map
    // cannot be derived there is no source-first answer, and quietly reverting
    // to array order would restore the build-state-dependent attribution above
    // — silently, which is the failure this gate exists to refuse. Loud instead;
    // `scripts/check-side-effects-array.mjs` owns this condition and already
    // reports it as exit 2, so such a workspace is red there too.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'objectui-6893-nomap-'));
    try {
      fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      const pkg = path.join(dir, 'packages/pkg');
      fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
      // `main` names the SOURCE barrel, so the manifest publishes no
      // `index.js`-shaped entry and the map has nothing to anchor on.
      fs.writeFileSync(
        path.join(pkg, 'package.json'),
        JSON.stringify({ name: '@fixture/pkg', main: './src/index.ts', sideEffects: ['./src/index.ts'] }),
      );
      fs.writeFileSync(path.join(pkg, 'src/index.ts'), REGISTRAR);
      expect(() => derivePinnedKeys(dir)).toThrow(/source spelling from its published one/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps every declared entry — it reorders the read, it does not filter it', () => {
    // The population guard for the reordering itself: a partition that dropped
    // an entry would shrink the derived key set without any assertion noticing.
    const declared = ['dist/index.js', 'src/index.ts', 'src/styles.css', 'dist/a/b.js', 'src/a/b.tsx'];
    const dir = fixture(chunk, { built: true });
    try {
      const pkg = { name: '@fixture/pkg', dir: 'packages/pkg', declared, manifest: { main: './dist/index.js' } };
      const ordered = sourceFirstEntries(pkg, dir);
      expect([...ordered].sort()).toEqual([...declared].sort());
      expect(ordered.slice(0, 3).every((e) => e.startsWith('src/'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the real workspace', () => {
  it('derives the keys from the arrays, and the ruled controls are among them', () => {
    const { keys, sources, unreadable, modulesRead } = derivePinnedKeys(repoRoot);
    expect(unreadable).toEqual([]);
    expect(modulesRead).toBeGreaterThan(0);
    expect(keys.length, 'an empty key set makes every assertion in this gate vacuous').toBeGreaterThan(0);
    for (const control of RULED_CONTROLS) {
      expect(keys, `${control} is one of the registrations the 2026-08-29 ruling pins`).toContain(control);
    }
    // The derivation must point at the module it read the key from, or a drop
    // would be reported without saying which array entry promised it — and it
    // must point at the SOURCE module, the one an author can go and fix, not at
    // the gitignored build artifact beside it. Before objectui#6893 this line
    // was the workspace's build state in disguise: green on an unbuilt checkout,
    // red on a built one, same commit. The preference itself is pinned above on
    // a fixture that owns its build state; this line is the real workspace's
    // half, and it now holds in every build state.
    expect(sources.get('mcp:connect-agent')).toBe(
      'packages/app-shell/src/console/connect/ConnectAgentWidget.tsx',
    );
  });

  it('keeps RULED_CONTROLS a floor rather than the population', () => {
    // If the two ever coincide, the "derived" set has quietly become the hand
    // list the ruling forbids.
    const { keys } = derivePinnedKeys(repoRoot);
    expect(keys.length).toBeGreaterThan(RULED_CONTROLS.length);
  });

  it('nothing registers the negative control', () => {
    const { keys } = derivePinnedKeys(repoRoot);
    expect(keys).not.toContain(NEGATIVE_CONTROL_KEY);
  });
});
