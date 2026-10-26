/**
 * ObjectUI — restore react-i18next's GLOBAL default instance between tests.
 *
 * objectui#4514. Mounting an `I18nProvider` in a test file silently changed
 * what every LATER provider-less render in that file resolved. This file is the
 * mechanism that makes that impossible; `installI18nGlobalReset()` is called
 * from `vitest.setup.base.ts`, which every project's setup leads back to.
 *
 * ## What actually leaks — measured, and it is NOT "the language"
 *
 * `createI18n()` (packages/i18n/src/i18n.ts) builds a FRESH instance and calls
 * `instance.use(initReactI18next).init(...)`. react-i18next's `initReactI18next`
 * is a `3rdParty` module whose `init` runs `setI18n(instance)` — it overwrites
 * react-i18next's module-level default-instance POINTER. So every mounted
 * provider does not mutate one shared instance's language; it REPLACES the
 * global with its own instance, carrying that instance's language, resources,
 * namespaces, `dir()` and missing-key handler.
 *
 * Measured on this tree, in one file, in order:
 *
 *   before any provider     getI18n() === undefined      t('common.save') -> 'common.save'
 *   mount zh provider       pointer swapped: true        t('common.save') -> '保存'
 *   provider-less render    language 'zh'                t('common.save') -> '保存'   <- the bug
 *   changeLanguage('en')    language 'en'                t('common.save') -> 'Save'
 *
 * That fourth line is why a language-only reset is not the fix. It does not
 * restore the pristine state — it leaves the test's instance installed as the
 * global, so a provider-less render that used to return the raw key now returns
 * an en pack value. Measured with a provider carrying custom resources: after
 * `changeLanguage('en')` the provider's own `probe.custom` key was STILL
 * reachable through the global. Language is one field of the leak, not the leak.
 *
 * ## What this does instead
 *
 * Snapshot the pointer before the test file runs, and put that exact pointer
 * back after every test. In this repo the snapshot is `undefined` (nothing
 * installs a global at setup time), so a provider-less render resolves the same
 * way on line 1 and line 600 of a file: through no global at all, which is
 * `useObjectTranslation()`'s `|| 'en'` last resort plus i18next's key/
 * defaultValue behaviour. The provider-safe fallback is untouched — it is
 * exactly the behaviour the FIRST test in every file already got.
 *
 * `I18nProvider`'s runtime behaviour is deliberately NOT changed (that was the
 * card's direction 2, and the global fallback is what makes
 * `useObjectTranslation()` provider-safe at all). This is harness state only.
 *
 * ## Why a function, and not top-level code
 *
 * Vitest executes setup FILES once per test file, but an `import` inside one is
 * module-cached — under `isolate: false` (the `unit` project) a cached module's
 * top-level `afterEach` would register once per worker and cover only the first
 * file. Same reason `vitest.setup.dom-light.tsx` registers RTL's `cleanup()`
 * itself instead of relying on RTL's import-time registration. Callers invoke
 * this function so both the snapshot and the hook are per test file.
 */

import { afterEach } from 'vitest';
import { getI18n, setI18n } from 'react-i18next';

/**
 * react-i18next types both accessors as total (`getI18n(): i18n`,
 * `setI18n(instance: i18n)`), but the runtime is
 * `let i18nInstance; setI18n = (i) => { i18nInstance = i; }` — a plain
 * assignment over an initially `undefined` binding. `undefined` is therefore
 * both a value `getI18n()` really returns (measured above) and one `setI18n`
 * really accepts; the casts below are about that gap and nothing else.
 *
 * The instance type is derived from `getI18n` rather than imported from
 * `i18next`, so this file needs ONE root devDependency instead of two and the
 * type tracks whatever react-i18next itself declares.
 */
type MaybeInstance = ReturnType<typeof getI18n> | undefined;

export function installI18nGlobalReset(): void {
  // Runs while the setup file executes — i.e. before the test file's own module
  // scope, so this is what the file INHERITED, not anything it installed.
  const pristine = (getI18n as () => MaybeInstance)();

  afterEach(() => {
    if ((getI18n as () => MaybeInstance)() !== pristine) {
      (setI18n as (instance: MaybeInstance) => void)(pristine);
    }
  });
}
