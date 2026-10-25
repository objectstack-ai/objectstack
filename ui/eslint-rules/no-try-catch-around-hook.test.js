/**
 * Pins `no-try-catch-around-hook` against the two false positives that the
 * first draft of the rule produced when it was run across the repo:
 *
 *  - `vi.useRealTimers()` / `jest.useFakeTimers()` — test helpers that match
 *    the `use*` spelling by coincidence and are not React hooks.
 *  - `renderHook(() => useThing())` inside a try — the hook runs during
 *    React's render of the harness component, not in the try's synchronous
 *    flow, so hook order is unaffected.
 *
 * Both were real code in this repo (packages/auth/.../createAuthClient.test.ts
 * and packages/react/.../useExpression.test.ts), which is why they are pinned
 * rather than left to judgement.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import rule from './no-try-catch-around-hook.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester();

ruleTester.run('no-try-catch-around-hook', rule, {
  valid: [
    // The correct shape: hook first, probe its return value.
    `function useThing() {
       const r = useObjectTranslation();
       return r.t('k') === 'k' ? FALLBACK : r.t;
     }`,
    // Namespaced test helpers are not hooks.
    `function t() { try { vi.useRealTimers(); } finally { done(); } }`,
    `function t() { try { jest.useFakeTimers(); } catch { /* noop */ } }`,
    // Hook inside a nested callback: runs under React's render, not the try.
    `function t() {
       try { renderHook(() => useCondition(SRC)); } finally { cleanup(); }
     }`,
    // try/catch with no hook at all.
    `function t() { try { JSON.parse(s); } catch { return null; } }`,
    // Lowercase `user*` must not be mistaken for a hook.
    `function t() { try { username(); } catch { return null; } }`,
  ],
  invalid: [
    {
      code: `function useBad() {
        try { const r = useObjectTranslation(); return { t: r.t }; }
        catch { return { t: (k) => k }; }
      }`,
      errors: [{ messageId: 'banned' }],
    },
    {
      code: `function useBad() { try { return useObjectLabel(); } catch { return null; } }`,
      errors: [{ messageId: 'banned' }],
    },
    // `React.useX` member form is still a hook.
    {
      code: `function useBad() { try { return React.useMemo(f, []); } catch { return null; } }`,
      errors: [{ messageId: 'banned' }],
    },
    // A hook in the catch body is equally order-desyncing.
    {
      code: `function useBad() { try { f(); } catch { return useObjectTranslation(); } }`,
      errors: [{ messageId: 'banned' }],
    },
  ],
});
