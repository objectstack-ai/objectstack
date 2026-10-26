/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit test for the local ESLint rule that bans synthetic-event triggers
 * (ADR-0054 Phase 5). Plain JS so it needs no package tsconfig.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import rule from './no-synthetic-event-trigger.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester();

ruleTester.run('no-synthetic-event-trigger', rule, {
  valid: [
    // Legitimate event-bus / history-nudge patterns are allowed.
    "document.dispatchEvent(new CustomEvent('objectui:record-changed'))",
    "window.dispatchEvent(new PopStateEvent('popstate'))",
    // Calling a real handler directly is the correct pattern.
    'openCommandPalette()',
  ],
  invalid: [
    {
      code: "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))",
      errors: [{ messageId: 'banned' }],
    },
    {
      code: "el.dispatchEvent(new MouseEvent('click', { bubbles: true }))",
      errors: [{ messageId: 'banned' }],
    },
  ],
});
