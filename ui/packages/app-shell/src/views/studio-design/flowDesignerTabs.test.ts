// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36903 — the flow designer's tab address: its own sections, then
 * the item tools, in `?tab=`; Canvas writes nothing.
 */

import { describe, it, expect } from 'vitest';
import { FLOW_DESIGNER_TOOL_TABS, flowDesignerTabAddress, readFlowDesignerTab } from './flowDesignerTabs';
// The source under test reaches these dynamic imports (the command palette's
// record preview, the drafts panel's lint, the code editor): their first load
// is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@object-ui/plugin-editor';

describe('the flow designer\'s tab address', () => {
  it('reads each section and writes it back; Canvas is the default and writes nothing', () => {
    for (const section of ['variables', 'runs', 'problems', 'debug'] as const) {
      const location = readFlowDesignerTab(section, FLOW_DESIGNER_TOOL_TABS);
      expect(location).toEqual({ section, tool: null });
      expect(flowDesignerTabAddress(location)).toBe(section);
    }
    expect(readFlowDesignerTab(null, FLOW_DESIGNER_TOOL_TABS)).toEqual({ section: 'canvas', tool: null });
    expect(flowDesignerTabAddress({ section: 'canvas', tool: null })).toBeNull();
  });

  it('reads the item tools and their second views, the retired sheets\' values included', () => {
    expect(readFlowDesignerTab('history', FLOW_DESIGNER_TOOL_TABS)).toEqual({ section: 'canvas', tool: { tab: 'history' } });
    expect(readFlowDesignerTab('audit', FLOW_DESIGNER_TOOL_TABS)).toEqual({ section: 'canvas', tool: { tab: 'history', view: 'audit' } });
    expect(readFlowDesignerTab('layers', FLOW_DESIGNER_TOOL_TABS)).toEqual({ section: 'canvas', tool: { tab: 'source', view: 'layers' } });
    expect(flowDesignerTabAddress({ section: 'canvas', tool: { tab: 'source', view: 'layers' } })).toBe('layers');
  });

  it('a tool not offered to this caller, or an unknown value, opens Canvas', () => {
    const noTrail = FLOW_DESIGNER_TOOL_TABS.filter((tab) => tab !== 'history');
    expect(readFlowDesignerTab('history', noTrail)).toEqual({ section: 'canvas', tool: null });
    expect(readFlowDesignerTab('details', FLOW_DESIGNER_TOOL_TABS)).toEqual({ section: 'canvas', tool: null });
    expect(readFlowDesignerTab('nonsense', FLOW_DESIGNER_TOOL_TABS)).toEqual({ section: 'canvas', tool: null });
  });
});
