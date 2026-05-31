// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import stack from '../objectstack.config.js';

/**
 * Smoke test — the stack loads and registers the expected breadth of
 * metadata. This guards the metadata-loading pipeline end-to-end.
 */
describe('showcase stack', () => {
  it('registers the core objects', () => {
    const names = (stack.objects ?? []).map((o: { name: string }) => o.name);
    expect(names).toContain('showcase_project');
    expect(names).toContain('showcase_task');
    expect(names).toContain('showcase_field_zoo');
    // 6 objects: account, project, task, category, team, membership, field_zoo
    expect((stack.objects ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('registers UI, automation, security, and AI metadata', () => {
    expect((stack.views ?? []).length).toBeGreaterThan(0);
    expect((stack.dashboards ?? []).length).toBeGreaterThan(0);
    expect((stack.reports ?? []).length).toBe(4);
    expect((stack.flows ?? []).length).toBeGreaterThan(0);
    expect((stack.approvals ?? []).length).toBeGreaterThan(0);
    expect((stack.roles ?? []).length).toBe(3);
    expect((stack.agents ?? []).length).toBe(1);
  });
});
