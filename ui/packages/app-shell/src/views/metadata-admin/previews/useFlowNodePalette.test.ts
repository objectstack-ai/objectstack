// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { mergePalette } from './useFlowNodePalette';
import { NODE_PALETTE } from './flow-canvas-parts';

describe('mergePalette', () => {
  it('returns the base palette unchanged when no descriptors are given', () => {
    expect(mergePalette(NODE_PALETTE, [])).toEqual(NODE_PALETTE);
  });

  it('offers `notify` as a first-class Integration palette entry (#1895)', () => {
    const notify = NODE_PALETTE.find((i) => i.type === 'notify');
    expect(notify).toBeDefined();
    expect(notify!.category).toBe('Integration');
    // Authorable offline (static entry), not only when the engine publishes a
    // descriptor — mergePalette keeps it when no descriptors are present.
    expect(mergePalette(NODE_PALETTE, []).some((i) => i.type === 'notify')).toBe(true);
  });

  it('overlays the engine label/description onto a matching base entry, keeping its position', () => {
    const base = [
      { type: 'decision', label: 'Decision', hint: 'Branch on a condition' },
      { type: 'approval', label: 'Approval', hint: 'Pause for a human decision' },
    ];
    const merged = mergePalette(base, [
      { type: 'approval', name: 'Approval (engine)', description: 'Route a record for human approval' },
    ]);
    // Same length + order — approval is overlaid in place, not appended.
    expect(merged.map((i) => i.type)).toEqual(['decision', 'approval']);
    expect(merged[1]).toEqual({
      type: 'approval',
      label: 'Approval (engine)',
      hint: 'Route a record for human approval',
      // Section inferred from the type (base entry carried none here).
      category: 'Human',
    });
  });

  it('appends engine-only node types after the base', () => {
    const base = [{ type: 'decision', label: 'Decision' }];
    const merged = mergePalette(base, [
      { type: 'decision', name: 'Decision' },
      { type: 'assignment', name: 'Assignment', description: 'Set flow variables' },
    ]);
    expect(merged.map((i) => i.type)).toEqual(['decision', 'assignment']);
    expect(merged[1]).toEqual({ type: 'assignment', label: 'Assignment', hint: 'Set flow variables', category: 'Logic' });
  });

  it('skips deprecated descriptors (the base entry, if any, is preserved)', () => {
    const base = [{ type: 'screen', label: 'Screen' }];
    const merged = mergePalette(base, [
      { type: 'old_node', name: 'Old', deprecated: true },
      { type: 'screen', name: 'Screen', deprecated: true },
    ]);
    expect(merged.map((i) => i.type)).toEqual(['screen']);
    expect(merged[0]).toEqual({ type: 'screen', label: 'Screen' });
  });

  it('skips non-flow descriptors but keeps flow + paradigm-less ones', () => {
    const merged = mergePalette([], [
      { type: 'flow_node', name: 'Flow node', paradigms: ['flow'] },
      { type: 'action_only', name: 'Action only', paradigms: ['action'] },
      { type: 'no_paradigm', name: 'No paradigm' },
    ]);
    expect(merged.map((i) => i.type)).toEqual(['flow_node', 'no_paradigm']);
  });

  it('falls back to the descriptor type when no name is provided', () => {
    const merged = mergePalette([], [{ type: 'custom_node' }]);
    expect(merged[0]).toEqual({ type: 'custom_node', label: 'custom_node', hint: undefined, category: 'Flow' });
  });
});
