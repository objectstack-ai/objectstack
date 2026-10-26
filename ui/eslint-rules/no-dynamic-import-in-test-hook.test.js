/**
 * Pins `no-dynamic-import-in-test-hook` against the shapes that must NOT report,
 * every one of them real code in this repo:
 *
 *  - `registerLazy('x', () => import('./x'))` inside a hook — the hook installs
 *    a loader, it never runs the import. This is how the console registers its
 *    plugin layer, so a rule that flagged it would be unusable.
 *  - `vi.resetModules(); mod = await import('./x')` — the re-import is the whole
 *    point; hoisting it would break the test rather than speed it up.
 *  - a dynamic import at module scope, or in a test body — only hook bodies
 *    carry `hookTimeout`.
 *
 * The invalid cases are the exact shapes objectui#3010/#3021 converted,
 * including the `}, 15000)` form that raising the timeout failed to fix.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import rule from './no-dynamic-import-in-test-hook.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester();

ruleTester.run('no-dynamic-import-in-test-hook', rule, {
  valid: [
    // The correct shape: module scope, no hook, no raised timeout.
    `import './index';
     describe('Plugin', () => { it('registers', () => { expect(1).toBe(1); }); });`,
    // A lazy FACTORY passed to a registrar: the import is never called here.
    `beforeAll(() => { registerLazy('object-chart', () => import('@object-ui/plugin-charts')); });`,
    // Same, one nesting level deeper.
    `beforeAll(() => { tags.forEach((t) => registerLazy(t, () => import('./' + t))); });`,
    // Deliberate re-import against per-run module state — cannot be hoisted.
    `beforeEach(async () => { vi.resetModules(); mod = await import('./thing'); });`,
    `beforeAll(async () => { vi.doMock('./dep', () => ({})); mod = await import('./thing'); });`,
    `beforeEach(async () => { vi.stubEnv('TZ', 'UTC'); mod = await import('./clock'); });`,
    // The helper may sit after the import and still exempt the hook.
    `beforeEach(async () => { mod = await import('./thing'); vi.resetModules(); });`,
    // Module scope is exactly what the rule wants.
    `const mod = await import('./thing');`,
    // A test body is not a hook body.
    `it('loads on demand', async () => { const m = await import('./thing'); expect(m).toBeTruthy(); });`,
    // Other hooks are not billed the warm-up cost this rule is about.
    `afterAll(async () => { await import('./teardown'); });`,
    // A member call that merely shares the name is somebody else's API.
    `suite.beforeAll(async () => { await import('./thing'); });`,
    // A hook with no dynamic import at all.
    `beforeAll(() => { ComponentRegistry.reset(); });`,
  ],
  invalid: [
    // The shape #3021 converted, raised timeout and all.
    {
      code: `describe('Plugin Markdown', () => {
        beforeAll(async () => { await import('./index'); }, 15000);
      });`,
      errors: [{ messageId: 'banned' }],
    },
    // The 30s `packages/components` cluster.
    {
      code: `beforeAll(async () => { await import('../../../renderers'); }, 30000);`,
      errors: [{ messageId: 'banned' }],
    },
    // Capturing into a variable is still the same cost.
    {
      code: `let mod; beforeAll(async () => { mod = await import('./index'); });`,
      errors: [{ messageId: 'banned' }],
    },
    // `beforeEach` pays it once per test, which is worse.
    {
      code: `beforeEach(async () => { await import('./index'); });`,
      errors: [{ messageId: 'banned' }],
    },
    // Two imports in one hook report twice — each is a separate move.
    {
      code: `beforeAll(async () => {
        await import('@object-ui/components');
        await import('../register-plugins');
      }, 60000);`,
      errors: [{ messageId: 'banned' }, { messageId: 'banned' }],
    },
    // Concurrent loads are still loads.
    {
      code: `beforeAll(async () => { await Promise.all([import('./a'), import('./b')]); });`,
      errors: [{ messageId: 'banned' }, { messageId: 'banned' }],
    },
    // An unrelated `vi.*` call must not buy an exemption.
    {
      code: `beforeAll(async () => { vi.useFakeTimers(); await import('./index'); });`,
      errors: [{ messageId: 'banned' }],
    },
  ],
});
