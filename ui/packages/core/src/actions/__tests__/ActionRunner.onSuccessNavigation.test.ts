/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ActionSchema.onSuccess` — post-success navigation, the console half
 * (objectui#5221; spec half objectstack#9566/#9474).
 *
 * The pinned `@objectstack/spec` declares the key as a CLOSED STRICT object
 * `{ navigate: string, openIn: 'self' | 'newTab' }`, refine-scoped to
 * `type: 'api'` and `type: 'script'` — the two types that have a success event
 * carrying a server response for `${result.*}` to read. `openIn` is a
 * materialised `.default('self')`, so parse output ALWAYS carries a resolved
 * member and this runner writes no default of its own.
 *
 * Three facts under test, and they are different facts:
 *
 * 1. **The hop happens, through the app's own router.** `navigationHandler` is
 *    the SPA seam every other navigator in this file already uses (the console
 *    wires it to react-router's `navigate`). A post-success hop that reached
 *    for `window.location` would leave the SPA, and `openIn: 'self'` exists
 *    precisely to be popup-blocker immune.
 * 2. **`${result.*}` resolves against the HANDLER's return value**, one level
 *    below the action envelope — the same level `readActionPayload` hands the
 *    `redirectUrl` convention. Reading the envelope instead is the objectui#2904
 *    "one level too shallow" bug in a new place.
 * 3. **The two `openIn` spellings never cross.** `onSuccess.openIn` is
 *    `'self' | 'newTab'`; the top-level `type: 'url'` switch is
 *    `'self' | 'new-tab'`. Spec refuses each crossover with a keyed error, so
 *    this runner must not quietly accept one for the other.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionRunner } from '../ActionRunner';

type NavCall = [string, { external?: boolean; newTab?: boolean; replace?: boolean } | undefined];

/**
 * A runner with an `api` handler standing in for the console's `apiHandler`,
 * and a navigation spy standing in for react-router. Returns the spy so every
 * assertion reads the REAL argument list, never a boolean the test computed.
 */
function makeRunner(payload: unknown = { id: 'rec_42' }) {
  const nav = vi.fn();
  const runner = new ActionRunner({});
  runner.setNavigationHandler(nav as never);
  runner.setToastHandler(vi.fn() as never);
  runner.registerHandler('api', async () => ({ success: true, data: payload }));
  runner.registerHandler('script', async () => ({ success: true, data: payload }));
  const calls = () => nav.mock.calls as unknown as NavCall[];
  return { runner, nav, calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ActionSchema.onSuccess — the SPA route hop', () => {
  it('lands on the ${result.*}-interpolated route, in the same tab', async () => {
    const { runner, calls } = makeRunner({ id: 'rec_42' });

    const result = await runner.execute({
      type: 'api',
      name: 'clone_record',
      target: '/api/v1/records/clone',
      // The customer shape (titanwind-ehr#1172): clone, then jump to the CLONE.
      onSuccess: { navigate: '/app/crm/contacts/${result.id}', openIn: 'self' },
    } as never);

    expect(result.success).toBe(true);
    expect(calls()).toHaveLength(1);
    const [url, options] = calls()[0];
    expect(url).toBe('/app/crm/contacts/rec_42');
    expect(options?.newTab).toBe(false);
  });

  it("openIn: 'newTab' takes the other branch — same route, new tab", async () => {
    const { runner, calls } = makeRunner({ id: 'rec_42' });

    await runner.execute({
      type: 'api',
      name: 'clone_record',
      target: '/api/v1/records/clone',
      onSuccess: { navigate: '/app/crm/contacts/${result.id}', openIn: 'newTab' },
    } as never);

    expect(calls()).toHaveLength(1);
    const [url, options] = calls()[0];
    // Discriminating against the 'self' case above on the SAME route: only the
    // tab choice may differ, so a branch that ignored `openIn` fails here.
    expect(url).toBe('/app/crm/contacts/rec_42');
    expect(options?.newTab).toBe(true);
  });

  it("runs for type: 'script' too — the other type the refine admits", async () => {
    const { runner, calls } = makeRunner({ id: 'rec_9' });

    await runner.execute({
      type: 'script',
      name: 'provision',
      target: 'provision',
      onSuccess: { navigate: '/app/ops/jobs/${result.id}', openIn: 'self' },
    } as never);

    expect(calls()).toHaveLength(1);
    expect(calls()[0][0]).toBe('/app/ops/jobs/rec_9');
  });

  it('reads ${result.*} from the handler payload, not the action envelope', async () => {
    // The pre-#3962 legacy envelope: `{ success, data }` wrapping the handler's
    // own value. `${result.id}` must see `rec_inner`, never the envelope.
    const { runner, calls } = makeRunner({ success: true, data: { id: 'rec_inner' } });

    await runner.execute({
      type: 'api',
      name: 'clone_record',
      target: '/api/v1/records/clone',
      onSuccess: { navigate: '/app/crm/contacts/${result.id}', openIn: 'self' },
    } as never);

    expect(calls()[0][0]).toBe('/app/crm/contacts/rec_inner');
  });

  it('interpolates ${param.*} and ${ctx.*} in the same template', async () => {
    const nav = vi.fn();
    const runner = new ActionRunner({ ctx: { tenant: 'acme' } } as never);
    runner.setNavigationHandler(nav as never);
    runner.setToastHandler(vi.fn() as never);
    runner.registerHandler('api', async () => ({ success: true, data: { id: 'rec_7' } }));

    await runner.execute({
      type: 'api',
      name: 'clone_record',
      target: '/api/v1/records/clone',
      params: { view: 'compact' },
      onSuccess: {
        navigate: '/app/${ctx.tenant}/contacts/${result.id}?view=${param.view}',
        openIn: 'self',
      },
    } as never);

    expect((nav.mock.calls as unknown as NavCall[])[0][0])
      .toBe('/app/acme/contacts/rec_7?view=compact');
  });

  it('percent-encodes every interpolated value (spec: renderers MUST encode)', async () => {
    const { runner, calls } = makeRunner({ id: 'a/b c' });

    await runner.execute({
      type: 'api',
      name: 'clone_record',
      target: '/api/v1/records/clone',
      onSuccess: { navigate: '/app/crm/contacts/${result.id}', openIn: 'self' },
    } as never);

    expect(calls()[0][0]).toBe('/app/crm/contacts/a%2Fb%20c');
  });
});

describe('ActionSchema.onSuccess — controls', () => {
  it('an action with NO onSuccess navigates nowhere (positive control included)', async () => {
    const { runner, calls } = makeRunner({ id: 'rec_42' });

    await runner.execute({
      type: 'api', name: 'plain', target: '/api/v1/records/touch',
    } as never);
    expect(calls()).toHaveLength(0);

    // POSITIVE CONTROL — the same runner, same harness, one key added. Without
    // this the assertion above passes just as well when the harness is dead
    // (no dispatch, no handler, a spy nobody could ever call).
    await runner.execute({
      type: 'api', name: 'hops', target: '/api/v1/records/touch',
      onSuccess: { navigate: '/app/x/${result.id}', openIn: 'self' },
    } as never);
    expect(calls()).toHaveLength(1);
    expect(calls()[0][0]).toBe('/app/x/rec_42');
  });

  it('does not navigate when the action FAILED — onSuccess is post-SUCCESS', async () => {
    const nav = vi.fn();
    const runner = new ActionRunner({});
    runner.setNavigationHandler(nav as never);
    runner.setToastHandler(vi.fn() as never);
    runner.registerHandler('api', async () => ({ success: false, error: 'nope' }));

    await runner.execute({
      type: 'api', name: 'clone_record', target: '/api/v1/records/clone',
      onSuccess: { navigate: '/app/crm/contacts/${result.id}', openIn: 'self' },
    } as never);

    expect(nav).not.toHaveBeenCalled();
  });

  it('an absent scope member interpolates to empty — the impl contract, measured', async () => {
    // NOT invented: `interpolateTarget` has always substituted `''` for a
    // nullish path (`if (value == null) return ''`). `${result.*}` joins that
    // rule rather than inventing a second one, so a template naming a member
    // the response did not carry produces a shortened route, not a literal
    // `${result.missing}` in the URL bar.
    const { runner, calls } = makeRunner({ id: 'rec_42' });

    await runner.execute({
      type: 'api', name: 'clone_record', target: '/api/v1/records/clone',
      onSuccess: { navigate: '/app/crm/contacts/${result.missing}', openIn: 'self' },
    } as never);

    expect(calls()[0][0]).toBe('/app/crm/contacts/');
  });

  it('refuses a javascript: destination (author metadata reaches this URL)', async () => {
    const { runner, nav } = makeRunner({ id: 'rec_42' });

    await runner.execute({
      type: 'api', name: 'evil', target: '/api/v1/records/clone',
      onSuccess: { navigate: 'javascript:alert(1)', openIn: 'self' },
    } as never);

    expect(nav).not.toHaveBeenCalled();
  });
});

describe('ActionSchema.onSuccess — the two openIn spellings stay apart', () => {
  it("does not accept the type:'url' kebab spelling as a new-tab request", async () => {
    // Spec refuses `onSuccess.openIn: 'new-tab'` at parse with a keyed error.
    // If this runner treated it as new-tab anyway, the renderer would become a
    // second, more lenient contract than the one authors are validated against.
    const { runner, calls } = makeRunner({ id: 'rec_42' });

    await runner.execute({
      type: 'api', name: 'clone_record', target: '/api/v1/records/clone',
      onSuccess: { navigate: '/app/crm/contacts/${result.id}', openIn: 'new-tab' },
    } as never);

    expect(calls()).toHaveLength(1);
    expect(calls()[0][1]?.newTab).toBe(false);
  });

  it("a top-level openIn: 'new-tab' does not steer the onSuccess hop", async () => {
    const { runner, calls } = makeRunner({ id: 'rec_42' });

    await runner.execute({
      type: 'api', name: 'clone_record', target: '/api/v1/records/clone',
      openIn: 'new-tab',
      onSuccess: { navigate: '/app/crm/contacts/${result.id}', openIn: 'self' },
    } as never);

    expect(calls()[0][1]?.newTab).toBe(false);
  });
});

describe('ActionSchema.onSuccess — the retired chained-callback channel gets no reading', () => {
  it('neither dispatches a callback-shaped onSuccess nor treats it as navigation', async () => {
    // `ActionDef.onSuccess?: ActionDef | ActionDef[]` predated the spec key as
    // the runner's own chained-callback channel. objectui#5934 (maintainer
    // ruling 2026-08-31) retired it: the spec strict-refuses `{ type: … }`
    // inside `onSuccess` at parse, so no validated metadata could ever reach
    // it, and the census found zero producers outside the channel's own pins.
    // Stored rows rehydrate UNPARSED (#3903), so this pins the RUNTIME half of
    // the retirement — the shape still reaches the runner as data, and gets NO
    // reading: no handler dispatch, no navigation, and the action's own result
    // is untouched. (`as never` is the test reaching around the compile-time
    // half: the declared type now derives the spec block and refuses this
    // shape at the authoring site.)
    const { runner, nav } = makeRunner({ id: 'rec_42' });
    const cb = vi.fn(async () => ({ success: true }));
    runner.registerHandler('notify', cb as never);

    const result = await runner.execute({
      type: 'api', name: 'clone_record', target: '/api/v1/records/clone',
      onSuccess: { type: 'notify', name: 'ping' },
    } as never);

    expect(result.success).toBe(true);
    expect(cb).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });
});
