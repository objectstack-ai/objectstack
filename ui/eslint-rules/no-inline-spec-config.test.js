/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit test for the local ESLint rule that bans redefining spec-backed
 * view-config types inline. Uses the TS parser because the rule matches TS AST
 * (TSPropertySignature / TSTypeLiteral).
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-inline-spec-config.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

ruleTester.run('no-inline-spec-config', rule, {
  valid: [
    // Referencing the spec type is the sanctioned form.
    'interface V { appearance?: AppearanceConfig }',
    'interface V { selection?: SelectionConfig }',
    'interface V { pagination?: PaginationConfig }',
    // Partial<> and the transitional intersection are fine.
    'interface V { appearance?: Partial<AppearanceConfig> }',
    'interface V { userActions?: Partial<UserActionsConfig> & { editInline?: boolean } }',
    // A non-spec-backed field with an inline type is not our concern.
    'interface V { somethingElse?: { a: number } }',
    // The same field name on a value (not a type) must not trip the rule.
    'const selection = { type: "none" };',
  ],
  invalid: [
    {
      code: 'interface V { appearance?: { showDescription?: boolean; allowedVisualizations?: string[] } }',
      errors: [{ messageId: 'inline' }],
    },
    {
      code: "interface V { selection?: { type: 'none' | 'single' | 'multiple' } }",
      errors: [{ messageId: 'inline' }],
    },
    {
      code: 'interface V { userActions?: { sort?: boolean; editInline?: boolean } }',
      errors: [{ messageId: 'inline' }],
    },
  ],
});
