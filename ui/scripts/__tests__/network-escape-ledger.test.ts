/**
 * The network-escape ledger is RETIRED — and stays retired (objectui#6640, #7307).
 *
 * ## What this file used to be, and why it is not that any more
 *
 * `vitest.setup.network-escape-guard.ts` used to export `KNOWN_ESCAPES`: the
 * burn-down list of what remained of the 21 test files measured reaching a real
 * socket on `67dadd6`. This file was its shrink-only reconcile pin, and it
 * existed because the guard's docstring said the list "may only shrink" while
 * nothing made that true — an author who hit the guard's red could make it green
 * by adding a line, which is how a burn-down ledger decays into the permanent
 * quarantine it is not supposed to be.
 *
 * objectui#7307 burned the list down batch by batch (PRs #7999, #8013, #8019,
 * #8032, #8053) and its sixth and last batch emptied it. The old pin's own
 * non-vacuity floor prescribed what to do then, verbatim: "If the ledger
 * genuinely reached zero, that is the win this whole instrument was built for —
 * delete the guard's KNOWN_ESCAPES machinery and this pin together, rather than
 * leaving a pin that asserts nothing." So the set, the attributed-stderr branch
 * that kept listed files green, and the known/unknown split are all gone.
 *
 * ## Why a retirement pin rather than a deleted file
 *
 * The pressure the old pin resisted did not end with the list; it went UP. Every
 * escape is now red on its first run with no list to join, so the cheapest wrong
 * fix available to the next author who meets that red is to RE-CREATE the list —
 * a one-line, green-on-arrival change that would silently re-open a tolerated
 * path for the whole repo. That is the same failure the old pin was written for,
 * one step later, and deleting this file would leave nothing resisting it.
 *
 * So this file now pins the ABSENCE of the machinery, plus the presence of the
 * STANDING guard that was never part of the burn-down: the recording `fetch`
 * wrapper and the `afterEach` that fails ANY escape in ANY file. Re-adding a
 * list is red here; deleting the guard while deleting the list is red here too.
 *
 * "ANY file" has a registration-time condition of its own (objectui#8537): in
 * the `unit` project the hook must be registered per test file through the
 * guard's exported installer, called from `vitest.setup.base.ts`. That wiring is
 * pinned below; the export list this file used to pin as EMPTY now holds exactly
 * that installer.
 *
 * ## How it reads the guard, and why not with a regex
 *
 * The absence assertions run over the guard's source with COMMENTS BLANKED, via
 * `scripts/js-comment-mask.mjs` — the tree's one answer to "comment, or code?".
 * That is load-bearing rather than tidy: the guard's own header now explains at
 * length that there is no `KNOWN_ESCAPES` any more, so a naive text search finds
 * the name in prose and this pin could never go green. Masking makes the
 * assertion about CODE, which is what it means.
 *
 * Every negative below is paired with a positive control on the same read, so a
 * mistyped path or an empty read cannot pass as "the thing is absent".
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from '../js-comment-mask.mjs';
import * as guard from '../../vitest.setup.network-escape-guard';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD_PATH = 'vitest.setup.network-escape-guard.ts';
const guardSource = fs.readFileSync(path.join(repoRoot, GUARD_PATH), 'utf8');
/** The guard's CODE — its prose, which legitimately names the retired set, blanked. */
const guardCode = maskComments(guardSource);

describe('the network-escape burn-down list stays retired (objectui#7307)', () => {
  it('is reading the real guard file, not an empty or wrong one', () => {
    // The floor under every negative below. A negative over a bad read is the
    // classic pin that reports green after the thing it pins stopped existing.
    expect(guardSource.length).toBeGreaterThan(1000);
    expect(guardCode, 'comment masking blanked the code as well as the prose').toContain(
      'ESCAPE_ORIGIN',
    );
    // The control for the MASK itself: a phrase that exists only in the guard's
    // header prose. Present in the raw source, absent from the masked code — if
    // masking silently stopped working, this is what goes red, rather than the
    // absence assertions below quietly passing over unmasked prose.
    const PROSE_ONLY = 'THE ANONYMITY IS THE DEFECT';
    expect(guardSource).toContain(PROSE_ONLY);
    expect(guardCode, 'comment masking is not blanking comments').not.toContain(PROSE_ONLY);
  });

  it('exports exactly the installer, and no ledger', () => {
    // Runtime, not source: this is the SAME module instance the run is guarded
    // by (`vitest.setup.base.ts` imports it for every project), so a re-exported
    // list shows up here whatever the source looks like.
    //
    // This used to pin an EMPTY export list — the ledger was the only export
    // the guard ever had. objectui#8537 added one on purpose: the `afterEach`
    // has to be registered per test file, and under the `unit` project's
    // `isolate: false` only a function CALLED from the setup file can do that
    // (an imported module's body runs once per worker). Exactly that name, so a
    // list coming back as a second export is still red here.
    expect(Object.keys(guard as Record<string, unknown>).sort()).toEqual(['installNetworkEscapeGuard']);
    expect(typeof guard.installNetworkEscapeGuard).toBe('function');
  });

  it('declares no allowlist of tolerated escapes in its code', () => {
    // Catches the list coming back UNEXPORTED too, which the namespace read
    // above cannot see — and that is the likelier re-introduction, since a
    // private set needs no export to make a red green.
    expect(
      guardCode.includes('KNOWN_ESCAPES'),
      [
        'The network-escape burn-down list is back in vitest.setup.network-escape-guard.ts.',
        '',
        'It reached zero on objectui#7307 and was retired deliberately. A test that',
        'reaches a real socket is a defect to fix, not a line to add to a list.',
        'If the guard went red on your file, serve its probe from a double instead.',
        'The remedy in full — the shape AND where its teardown has to go — is the',
        "guard's own Fix: text in vitest.setup.network-escape-guard.ts. It is",
        'deliberately NOT restated here: this line drifting out of step with that',
        'one is objectui#7765, and one ruling written twice is how it rotted.',
      ].join('\n'),
    ).toBe(false);

    // The general shape, not just the old name: a re-introduction under a new
    // spelling is the same defect. `new Set([...])` of test paths is what one
    // looks like, and the guard's code holds no `Set` literal at all now.
    const setLiterals = guardCode.match(/new Set\(\[/g) ?? [];
    expect(
      setLiterals,
      'A set literal appeared in the guard. If it is a tolerated-escape list under a ' +
        'new name, it is the retired ledger: fix the escape instead. If it is something ' +
        'else entirely, this pin is what needs the deliberate edit.',
    ).toEqual([]);
  });
});

describe('the STANDING guard survived the retirement (objectui#6640)', () => {
  it('still wraps the global fetch to record escapes', () => {
    // Behavioural, on the live global: the setup file has run for this project,
    // so the wrapper installed below is the one every test in the run uses.
    expect(globalThis.fetch.name).toBe('guardedFetch');
    expect(guardCode).toContain('globalThis.fetch = function guardedFetch');
  });

  it('still registers the afterEach that fails an escape in any file', () => {
    // The half the burn-down never owned, and the half that must outlive it: an
    // escape anywhere is red on its first run.
    expect(guardCode).toContain('afterEach(');
    expect(guardCode).toContain('Network escape: this test reached a REAL socket');
    expect(guardCode, 'the remedy the red points at').toContain(
      'Fix: serve the probe from a double rather than the network',
    );
  });

  it('registers that afterEach from the installer, and the setup file calls it (objectui#8537)', () => {
    // "ANY file" is only true if the hook is registered per test file. In the
    // `unit` project (`isolate: false`) this module's body runs once per worker,
    // so a module-scope `afterEach(` here would cover the first file of each
    // worker and no other — which is what it did until objectui#8537. So: the
    // one `afterEach(` in the guard's CODE sits inside the exported installer,
    // and `vitest.setup.base.ts` — a setup file Vitest re-executes per test
    // file — calls it. The behavioural half (two escaping files in one worker,
    // both red) is `network-escape-worker-coverage-8537.test.ts`.
    const hooks = guardCode.match(/\bafterEach\(/g) ?? [];
    expect(hooks, 'exactly one afterEach registration in the guard').toHaveLength(1);
    const installerAt = guardCode.indexOf('export function installNetworkEscapeGuard(');
    expect(installerAt, 'the installer is exported').toBeGreaterThan(-1);
    expect(
      guardCode.indexOf('afterEach('),
      'the afterEach must be registered inside installNetworkEscapeGuard(), not at module scope',
    ).toBeGreaterThan(installerAt);

    const baseCode = maskComments(fs.readFileSync(path.join(repoRoot, 'vitest.setup.base.ts'), 'utf8'));
    expect(baseCode, 'vitest.setup.base.ts must call the installer').toContain('installNetworkEscapeGuard();');
    expect(
      baseCode.includes("import './vitest.setup.network-escape-guard'"),
      'a bare side-effect import of the guard registers no hook any more — call the installer',
    ).toBe(false);
  });
});
