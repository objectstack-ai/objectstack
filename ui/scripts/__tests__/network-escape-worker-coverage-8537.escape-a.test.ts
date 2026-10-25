/**
 * objectui#8537 — deliberate network-escape fixture (a of two).
 *
 * This file is one half of the LIVE CONTROL for
 * `network-escape-worker-coverage-8537.test.ts`: that pin spawns a real vitest
 * on the `unit` project with both fixtures in ONE worker, and every file must go
 * red under the guard, naming itself. In the ordinary suite the escape below is
 * skipped — the fixture is inert unless the pin's child marker is set, so it
 * cannot red a normal run.
 *
 * The two fixtures are byte-identical apart from their tag, so a difference in
 * their outcome can only come from their POSITION in the worker.
 *
 * Evidence that the escape RAN goes to a ledger file the pin names, not to the
 * console: vitest's default reporter prints a passing test's console output
 * nowhere, so a console line would be visible exactly when the test failed —
 * a liveness control that can only fire on the outcome it is meant to be
 * independent of (measured while writing the pin: under the defect the pin
 * went red on "fixture b never ran" when b had run and passed silently).
 */
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';

const IS_CHILD = process.env.OBJECTUI_ESCAPE_PIN_CHILD === '1';
const LEDGER = process.env.OBJECTUI_ESCAPE_PIN_LEDGER;
const MARK = '__objectui_escape_pin_8537__';
const scope = globalThis as unknown as Record<string, unknown>;

it.skipIf(!IS_CHILD)('fixture a reaches a real socket, on purpose', async () => {
  // Leave a mark on the shared global object and report the other fixture's,
  // so the pin can see that both files ran in ONE worker and which came second.
  const seenOther = scope[MARK] === 'b' ? 'yes' : 'no';
  scope[MARK] = 'a';
  if (LEDGER) appendFileSync(LEDGER, `file=a saw_other=${seenOther}\n`);
  // The `unit` project is a node environment: no `location`, so only an
  // ABSOLUTE URL at the escape origin can be an escape. Outcome irrelevant.
  await fetch('http://localhost:3000/__objectui_escape_pin_8537__/a').catch(() => undefined);
});
