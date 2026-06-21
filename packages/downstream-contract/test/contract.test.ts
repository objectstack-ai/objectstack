// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ActionSchema, ReportSchema, PageSchema } from '@objectstack/spec/ui';
import { LogCallAction } from '../src/log-call.action.js';
import { AccountsByStageReport } from '../src/pipeline.report.js';
import { WelcomePage } from '../src/welcome.page.js';
import { ContractStack } from '../src/stack.js';

// FROZEN — see README. A failure means a spec change dropped or narrowed a
// property a published-spec third party already uses. That is breaking: adjust
// the spec or bump major; do NOT edit the fixtures to make this pass.
describe('downstream consumer contract (#2035)', () => {
  it('bare-literal third-party metadata still parses against the current spec', () => {
    expect(() => ActionSchema.parse(LogCallAction)).not.toThrow();
    expect(() => ReportSchema.parse(AccountsByStageReport)).not.toThrow();
    expect(() => PageSchema.parse(WelcomePage)).not.toThrow();
  });

  it('assembles into a stack — schema + cross-reference validation passes', () => {
    expect(ContractStack).toBeDefined();
    expect(ContractStack.objects).toHaveLength(1);
    expect(ContractStack.actions).toHaveLength(2);
  });
});
