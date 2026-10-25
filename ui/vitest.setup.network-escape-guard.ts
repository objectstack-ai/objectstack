/**
 * ObjectUI — network-escape guard (objectui#6640)
 *
 * Makes a test that reaches a REAL socket a NAMED, RED test instead of an
 * anonymous stack on stderr.
 *
 * ## The class this closes
 *
 * happy-dom's DEFAULT document URL is `http://localhost:3000` — nothing in this
 * repo configures it. So any DOM-env test that renders a component reaching one
 * of the ~18 `apiFetch ?? fetch` / `globalThis.fetch` fallbacks in product code
 * resolves a relative `/api/v1/...` against a real TCP socket, and prints:
 *
 *     Error: connect ECONNREFUSED 127.0.0.1:3000
 *         at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1637:16)
 *
 * That stack has NO `stderr | FILE > TESTNAME` header and NO user stack frame —
 * it is an unhandled socket error raised below the layer Vitest captures per
 * test, so Vitest cannot tie it to a file. THE ANONYMITY IS THE DEFECT, not the
 * noise: it is why this class was fixed four times (objectui#5225 / #3339 /
 * #4106 / #4688, all still intact on main) and still reproduced in 12 of 16
 * green shards. Each fix closed the files someone had listed by hand, and the
 * output never said who was left. A measured sweep of every project found 21
 * emitting files across 9 packages, none of them a file those four cards fixed.
 *
 * ## Why enforcement is in `afterEach` and NOT a throwing `fetch`
 *
 * The obvious instrument — make the escaping `fetch` reject loudly — DOES NOT
 * WORK HERE, and would have shipped a guard that never fires. Every one of
 * these call sites already tolerates failure by construction:
 *
 *     const doFetch = apiFetch ?? fetch;
 *     try { ... } catch { /* best-effort: leaves the rows as the server sent *\/ }
 *
 * That tolerance is exactly why the suite is GREEN while escaping. A throw from
 * inside `fetch` lands in that same `catch` and is swallowed, leaving the test
 * green and the guard silent. So the escape is RECORDED at the call and
 * ASSERTED in `afterEach`, where no product `catch` can reach it.
 *
 * ## What it does NOT do
 *
 * It does not silence anything: the real request still goes out and the real
 * ECONNREFUSED still prints, because those stacks are the evidence that a test
 * reached for a socket (objectui#6640 ruling). It adds attribution beside them.
 * It skips and quarantines nothing — every test still runs and asserts exactly
 * what it asserted before.
 *
 * ## The burn-down list is GONE — it reached zero (objectui#7307)
 *
 * There is no `KNOWN_ESCAPES` set here any more, and adding one back is the one
 * change this file exists to make hard. It used to hold what REMAINED of the 21
 * files measured escaping on `67dadd6`; objectui#7307 burned them down batch by
 * batch (PRs #7999, #8013, #8019, #8032, #8053) and the sixth and last batch
 * emptied it — `FlowNodeInspector.specKeys.test.tsx` now serves its
 * `/api/v1/meta/object` probe from a double like the rest. A ledger that reaches
 * zero has to be RETIRED, not left as an empty list a future red can be made
 * green by joining: an empty allowlist is one line away from a populated one,
 * and its own pin said so ("delete the guard's KNOWN_ESCAPES machinery and this
 * pin together, rather than leaving a pin that asserts nothing"). So the set,
 * the attributed-stderr branch that kept listed files green, and the
 * known/unknown split all went with it, together with the reconcile pin in
 * `scripts/__tests__/network-escape-ledger.test.ts` — which now pins the
 * ABSENCE of that machinery, so re-introducing a list is red rather than
 * routine.
 *
 * What that leaves is the STANDING guard, which is the whole of objectui#6640
 * and is not part of the burn-down: the recording `fetch` wrapper below, and the
 * `afterEach` that fails ANY escape in ANY file. Every escape is now unknown,
 * every escape is red on its first run, and the remedy is the `Fix:` text at the
 * bottom of this file — serve the probe from a double.
 *
 * ## Two halves, registered at two different times (objectui#8537)
 *
 * "ANY file" was not true in the `unit` project until objectui#8537, and the way
 * it was false is worth keeping in view because it is silent by construction.
 *
 * That project runs `isolate: false`: one module graph per worker. Vitest still
 * re-executes each `setupFiles` entry for every test file — it invalidates the
 * setup file's own module node before importing it again — but a module the
 * setup file IMPORTS is not invalidated, so it is evaluated once per worker.
 * This file is imported by `vitest.setup.base.ts`; it is not a `setupFiles`
 * entry. So an `afterEach` registered in its module scope attached to the
 * FIRST test file of each worker and to no other. Measured on `1cca4415e` with
 * three byte-identical escaping files: in one worker, `1 failed | 2 passed`;
 * the same three files across three workers, `3 failed`; each alone, red. The
 * guard covered one file per worker — on a 4-shard CI run, a handful of the
 * ~1000 `unit` files — and read as covering all of them.
 *
 * The two halves of the guard therefore live at two different times:
 *
 *   - the RECORDING half — the `fetch` wrapper — is a module-scope assignment
 *     on a shared global, and once per worker is exactly right for it. Under
 *     `isolate: false` re-wrapping per file would stack a wrapper per file;
 *   - the ASSERTING half — the `afterEach` — must be registered per test file,
 *     so it is exported as `installNetworkEscapeGuard()` and CALLED from
 *     `vitest.setup.base.ts`, which Vitest does re-execute per file. Same
 *     split, same reason, as `installI18nGlobalReset()` next to it.
 *
 * `scripts/__tests__/network-escape-worker-coverage-8537.test.ts` pins the
 * repair behaviourally: a real vitest runs two escaping files in ONE worker of
 * the `unit` project and both must red, each naming itself. That is also the
 * pin against the caricature of this repair — a hook that re-registers per
 * file and no longer detects anything would cover every file and catch none.
 */
import { afterEach, expect } from 'vitest';

// No `node:*` imports, no `process` typings and no `import.meta.dirname` here,
// deliberately: `tsconfig.vitest-setup.json` — the gate that compiles this file
// — ships NO `@types/node` on purpose (it documents the measurement: adding it
// costs 12 errors inside third-party declarations). Anything below that needs a
// Node value must declare its own structural type rather than import one, so the
// gate stays green without weakening it for the other root setup files.

/**
 * This file sits at the repo root, so its own directory IS the repo root.
 *
 * Derived by STRING SURGERY on `import.meta.url`, not with `new URL('.',
 * import.meta.url)`: Vite statically rewrites that exact pattern at transform
 * time, and the value that survives into the run is `/@fs/...`, not a real path.
 * Measured — it silently turned every path relative-isation into a miss, which
 * failed all 21 known escapes at once.
 */
const REPO_ROOT = (() => {
  const withoutScheme = import.meta.url.replace(/^file:\/\//, '');
  const dir = withoutScheme.replace(/\/[^/]*$/, '/');
  try {
    return decodeURIComponent(dir);
  } catch {
    return dir;
  }
})();

/** The origin happy-dom hands every relative URL when no test owns port 3000. */
const ESCAPE_ORIGIN = /^https?:\/\/(?:127\.0\.0\.1|localhost):3000(?:\/|$)/;

type Escape = { file: string; test: string; url: string };

/** Escapes seen since the current test started. */
let pending: Escape[] = [];

function relative(p: string | undefined): string {
  if (!p) return '<unknown-test-file>';
  const normalised = p.replace(/\\/g, '/');
  return normalised.startsWith(REPO_ROOT) ? normalised.slice(REPO_ROOT.length) : normalised;
}

const realFetch = globalThis.fetch;

globalThis.fetch = function guardedFetch(input: any, init?: any) {
  let raw: string;
  try {
    raw = typeof input === 'string' ? input : (input?.url ?? String(input));
  } catch {
    raw = '<unreadable-request>';
  }
  let absolute = raw;
  try {
    absolute = new URL(raw, (globalThis as any).location?.href ?? undefined).href;
  } catch {
    /* a non-URL input cannot be an escape; leave it as-is */
  }

  if (ESCAPE_ORIGIN.test(absolute)) {
    let state: any = {};
    try {
      state = expect.getState() ?? {};
    } catch {
      /* called outside a test */
    }
    const escape: Escape = {
      file: relative(state.testPath),
      test: state.currentTestName ?? '<outside-a-test>',
      url: absolute,
    };
    pending.push(escape);
  }

  // Always pass through. The real connection attempt IS the evidence that a
  // test reached for a socket; hiding it would keep the escape and remove the
  // proof (objectui#6640 ruling).
  return realFetch.call(globalThis, input, init);
} as typeof globalThis.fetch;

/**
 * Register the asserting half for the CURRENT test file.
 *
 * Called from `vitest.setup.base.ts` on every execution of that setup file —
 * which under `isolate: false` is every test file, while this module's body
 * above runs once per worker (objectui#8537, header). Nothing else in this file
 * registers a hook, so importing it registers nothing: that is what lets
 * `scripts/__tests__/unit-registry-absence-collision.test.ts` re-execute it in a
 * private module graph without arming a stray hook there.
 */
export function installNetworkEscapeGuard(): void {
  afterEach(() => {
    const seen = pending;
    pending = [];
    // No known/unknown split: the burn-down list reached zero on objectui#7307,
    // so every escape is a defect on its first run.
    if (seen.length === 0) return;

    const byUrl = [...new Set(seen.map((e) => e.url))];
    const file = seen[0].file;
    throw new Error(
      `Network escape: this test reached a REAL socket at ${byUrl.join(', ')}.\n` +
        `  file: ${file}\n` +
        `  test: ${seen[0].test}\n` +
        `\n` +
        `happy-dom's default document URL is http://localhost:3000, so a relative\n` +
        `fetch from a component under test resolves to a live TCP connection. The\n` +
        `product call site catches the failure by design, so the test stayed green\n` +
        `while printing an unattributable ECONNREFUSED stack — that is objectui#6640.\n` +
        `\n` +
        `Fix: serve the probe from a double rather than the network. See\n` +
        `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx for the\n` +
        `shape (vi.stubGlobal('fetch', router) + vi.unstubAllGlobals()).\n` +
        `\n` +
        `WHERE that pair is torn down is part of the shape, not a detail\n` +
        `(objectui#7439). Vitest runs afterEach hooks in REVERSE registration order,\n` +
        `so a teardown written in THIS file runs FIRST — before the root setup's\n` +
        `RTL cleanup() and before this assertion. Unstubbing there restores the real\n` +
        `fetch while the tree is still mounted, so even a read that cleanup()'s\n` +
        `act-flush triggers escapes. So:\n` +
        `  - call cleanup() BEFORE vi.unstubAllGlobals(), as that\n` +
        `    DatasetReportRenderer afterEach already does; and\n` +
        `  - if the component can issue a read AFTER the test body returns — any\n` +
        `    refreshAfter, any notifyDataChanged consumer, any fire-and-forget\n` +
        `    refresh no barrier awaits — do not tear the double down at all.\n` +
        `    Install ONE at module scope and leave it up for the whole file, so no\n` +
        `    test can ever end with the real fetch back in place. Worked example:\n` +
        `    packages/app-shell/src/views/RecordDetailView.approvalDeclaredActions.test.tsx`,
    );
  });
}
