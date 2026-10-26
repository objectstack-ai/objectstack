// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import tsParser from '@typescript-eslint/parser';
import { type ESLint, Linter, RuleTester } from 'eslint';
import { describe, it } from 'vitest';

// RuleTester drives vitest's own blocks, so each case is a named test.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** The parser and options every TypeScript block in the root config uses. */
const languageOptions = {
  parser: tsParser,
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
} satisfies Linter.Config['languageOptions'];

export const ruleTester = new RuleTester({ languageOptions });

/**
 * Lints `code` with one plugin rule configured as `ruleConfig`, the way the
 * root config registers it. Used for the configuration-level assertions that
 * RuleTester cases cannot express.
 */
export function lintWith(
  namespace: string,
  plugin: ESLint.Plugin,
  ruleConfig: Linter.RuleEntry,
  code: string,
): Linter.LintMessage[] {
  const [ruleName] = Object.keys(plugin.rules ?? {});
  return new Linter({ configType: 'flat' }).verify(code, [{
    files: ['**/*.ts'],
    languageOptions,
    plugins: { [namespace]: plugin },
    rules: { [`${namespace}/${ruleName}`]: ruleConfig },
  }], 'subject.ts');
}
