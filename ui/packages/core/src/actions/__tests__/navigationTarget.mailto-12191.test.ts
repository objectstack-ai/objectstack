/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The runner admits `mailto:` (objectui#12191, ruling A+).
 *
 * The spec accepts a `mailto:` target on a `type: 'url'` action, and app-shell's
 * entitlement CTA already admitted one. The runner refused it at click, so a
 * mail button published cleanly and then failed with a toast. Now one
 * classifier, `classifyNavigationTarget`, answers for every caller, and the
 * admitted set is closed: `http://`, `https://`, `mailto:`, `/path`, `./path`.
 *
 * The pins, in the ruling's order:
 *
 * 1. `mailto:a@b.com` is admitted on a `url` action and on the shape an
 *    `element:button` hands the runner, and it navigates IN PLACE: never a new
 *    tab, `openIn` not consulted, never the host's router.
 * 2. `javascript:`, `data:`, `//host` and `tel:` are refused, with a message
 *    that names the admitted set.
 * 3. CONTROL: `https://…`, `/path` and `./path` reach the navigation handler
 *    exactly as they did before this card.
 *
 * The single-definition pin (resolveCtaHref and the runner share one symbol)
 * lives beside `resolveCtaHref`, in
 * `packages/app-shell/src/environment/__tests__/resolveCtaHref.sharedTarget-12191.test.tsx`.
 *
 * This project runs in a node environment, so there is no `window`. Each test
 * stubs the two members the runner touches (`location.href`, `open`) and puts
 * the global back afterwards.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ActionRunner } from '../ActionRunner';
import { classifyNavigationTarget } from '../navigationTarget';

type MaybeWindow = { window?: unknown };

let hrefSet: Mock<(url: string) => void>;
let windowOpen: Mock<(...args: unknown[]) => void>;
let hadWindow: boolean;
let previousWindow: unknown;

beforeEach(() => {
  hrefSet = vi.fn();
  windowOpen = vi.fn();
  hadWindow = 'window' in globalThis;
  previousWindow = (globalThis as MaybeWindow).window;
  (globalThis as MaybeWindow).window = {
    location: {
      origin: 'http://localhost',
      get href() { return ''; },
      set href(v: string) { hrefSet(v); },
    },
    open: windowOpen,
  };
});

afterEach(() => {
  if (hadWindow) (globalThis as MaybeWindow).window = previousWindow;
  else delete (globalThis as MaybeWindow).window;
});

function makeRunner() {
  const nav = vi.fn();
  const runner = new ActionRunner({});
  runner.setNavigationHandler(nav as never);
  runner.setToastHandler(vi.fn() as never);
  runner.registerHandler('api', async () => ({ success: true, data: { id: 'rec_1' } }));
  return { runner, nav };
}

/** The in-place reading: one full-page navigation, no router, no new tab. */
function expectInPlace(nav: Mock, target: string) {
  expect(hrefSet).toHaveBeenCalledTimes(1);
  expect(hrefSet).toHaveBeenCalledWith(target);
  expect(nav).not.toHaveBeenCalled();
  expect(windowOpen).not.toHaveBeenCalled();
}

const MAIL = 'mailto:a@b.com';

describe('classifyNavigationTarget: the closed set (objectui#12191)', () => {
  it.each([
    ['https://example.com/x', 'web'],
    ['http://example.com/x', 'web'],
    ['HTTPS://EXAMPLE.COM/x', 'web'],
    [MAIL, 'mail'],
    ['MAILTO:a@b.com', 'mail'],
    ['/path', 'path'],
    ['./path', 'path'],
  ])('admits %s as %s', (target, kind) => {
    expect(classifyNavigationTarget(target)).toBe(kind);
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['//evil.example/x'],
    ['tel:+1'],
    // The two other spellings the URL parser reads as `//evil.example/x`.
    ['/\\evil.example/x'],
    ['/\t/evil.example/x'],
    ['vbscript:x'],
    ['ftp://example.com'],
    ['http:example.com'],
    ['path'],
    [''],
  ])('refuses %j', (target) => {
    expect(classifyNavigationTarget(target)).toBeNull();
  });

  it('refuses a value that is not a string', () => {
    expect(classifyNavigationTarget(undefined)).toBeNull();
    expect(classifyNavigationTarget(42)).toBeNull();
  });
});

describe("type: 'url' admits mailto: and navigates in place (objectui#12191)", () => {
  it('opens a mailto: target in place, not through the router', async () => {
    const { runner, nav } = makeRunner();
    const result = await runner.execute({ type: 'url', target: MAIL });
    expect(result.success).toBe(true);
    expect(result.redirect).toBeUndefined();
    expectInPlace(nav, MAIL);
  });

  it("never opens a new tab: openIn: 'new-tab' is not consulted", async () => {
    const { runner, nav } = makeRunner();
    const result = await runner.execute({ type: 'url', target: MAIL, openIn: 'new-tab' });
    expect(result.success).toBe(true);
    expectInPlace(nav, MAIL);
  });

  it('navigates in place with no navigation handler wired', async () => {
    const runner = new ActionRunner({});
    const result = await runner.execute({ type: 'url', target: MAIL });
    expect(result.success).toBe(true);
    expect(result.redirect).toBeUndefined();
    expect(hrefSet).toHaveBeenCalledWith(MAIL);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('admits the element:button shape: the navigation alias with a flat `to`', async () => {
    const { runner, nav } = makeRunner();
    const result = await runner.execute({ type: 'navigation', to: MAIL });
    expect(result.success).toBe(true);
    expectInPlace(nav, MAIL);
  });

  it('a legacy `navigate.newTab` does not open a new tab either', async () => {
    const { runner, nav } = makeRunner();
    const result = await runner.execute({ type: 'navigation', navigate: { to: MAIL, newTab: true } });
    expect(result.success).toBe(true);
    expectInPlace(nav, MAIL);
  });

  it("onSuccess.navigate admits mailto: in place, whatever its openIn says", async () => {
    const { runner, nav } = makeRunner();
    await runner.execute({
      type: 'api', name: 'request_access', target: '/api/v1/access/request',
      onSuccess: { navigate: MAIL, openIn: 'newTab' },
    } as never);
    expectInPlace(nav, MAIL);
  });
});

describe('the refused set answers the message that names the admitted set (objectui#12191)', () => {
  const REFUSED = [
    'javascript:alert(1)',
    'data:text/html,hi',
    '//evil.example/x',
    'tel:+1',
    '/\\evil.example/x',
  ];

  it.each(REFUSED)("type: 'url' refuses %j without navigating", async (target) => {
    const { runner, nav } = makeRunner();
    const result = await runner.execute({ type: 'url', target });
    expect(result.success).toBe(false);
    expect(nav).not.toHaveBeenCalled();
    expect(hrefSet).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
    // The message names every admitted form, and not the one left out.
    for (const admitted of ['http://', 'https://', 'mailto:', '/path', './path']) {
      expect(result.error).toContain(admitted);
    }
    expect(result.error).not.toContain('tel:');
  });

  it('every refused target answers the same message', async () => {
    const errors = new Set<string | undefined>();
    for (const target of REFUSED) {
      const { runner } = makeRunner();
      errors.add((await runner.execute({ type: 'url', target })).error);
    }
    expect(errors.size).toBe(1);
  });

  it.each(REFUSED)('onSuccess.navigate refuses %j and warns with the same message', async (target) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { runner, nav } = makeRunner();
      const urlError = (await makeRunner().runner.execute({ type: 'url', target })).error;
      await runner.execute({
        type: 'api', name: 'request_access', target: '/api/v1/access/request',
        onSuccess: { navigate: target, openIn: 'self' },
      } as never);
      expect(nav).not.toHaveBeenCalled();
      expect(hrefSet).not.toHaveBeenCalled();
      const refusal = warn.mock.calls.find((c) => String(c[0]).includes('onSuccess.navigate'));
      expect(refusal).toBeDefined();
      expect(String(refusal![0])).toContain(String(urlError));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('CONTROL: http(s) and in-app paths reach the handler as before (objectui#12191)', () => {
  it.each([
    ['https://example.com/x', { external: true, newTab: true }],
    ['/path', { external: false, newTab: false }],
    ['./path', { external: false, newTab: false }],
  ])("type: 'url' hands %s to the navigation handler", async (target, options) => {
    const { runner, nav } = makeRunner();
    const result = await runner.execute({ type: 'url', target });
    expect(result.success).toBe(true);
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith(target, options);
    expect(hrefSet).not.toHaveBeenCalled();
  });
});
