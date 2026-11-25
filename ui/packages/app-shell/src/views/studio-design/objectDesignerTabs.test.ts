// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36904 — the object designer's tabs and their address.
 *
 * #36513 section 一, verbatim: 「记录、字段布局（或表单）、验证、操作、设置、钩子、API」,
 * and the two technical tabs fold first. The item tools follow (epic
 * decision 8). The address value is the tab's own word, Records writes none,
 * and a tool tab writes the value every item page reads (`ItemToolTabs`).
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
import '@object-ui/plugin-editor';
import { describe, expect, it } from 'vitest';
import {
  OBJECT_DESIGNER_ALWAYS_FLAT,
  OBJECT_DESIGNER_FOLD_FIRST,
  OBJECT_DESIGNER_TOOL_TABS,
  OBJECT_DESIGNER_VIEWS,
  objectDesignerTabAddress,
  readObjectDesignerTab,
} from './objectDesignerTabs';
import { t } from '../metadata-admin/i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

// The studio namespace's zh catalogue is fetched on demand: loaded here, at
// collection, so the order pin reads Chinese whatever ran before it in this
// worker (unloaded, `t` answers from `en`).
await loadStudioCatalogue('zh');

const TOOLS = OBJECT_DESIGNER_TOOL_TABS;

describe('the object designer’s tabs (objectstack#36904)', () => {
  it('are in #36513’s order, word for word', () => {
    expect(OBJECT_DESIGNER_VIEWS.map((v) => t(v.label, 'zh-CN')).join('、')).toBe('记录、字段布局、验证、操作、设置、钩子、API');
    expect(OBJECT_DESIGNER_FOLD_FIRST).toEqual(['hooks', 'api']);
    expect(OBJECT_DESIGNER_ALWAYS_FLAT).toEqual(['grid', 'form']);
    expect(TOOLS).toEqual(['references', 'history', 'source']);
  });

  it('every view round-trips through its address; Records is the default and writes none', () => {
    for (const { view, address } of OBJECT_DESIGNER_VIEWS) {
      const location = readObjectDesignerTab(address, TOOLS);
      expect(location, address).toEqual({ view, tool: null });
      expect(objectDesignerTabAddress(location), address).toBe(view === 'grid' ? null : address);
    }
  });

  it('a tool tab reads the item pages’ values, its second view included', () => {
    expect(readObjectDesignerTab('history', TOOLS).tool).toEqual({ tab: 'history' });
    expect(readObjectDesignerTab('audit', TOOLS).tool).toEqual({ tab: 'history', view: 'audit' });
    expect(readObjectDesignerTab('layers', TOOLS).tool).toEqual({ tab: 'source', view: 'layers' });
    expect(objectDesignerTabAddress(readObjectDesignerTab('audit', TOOLS))).toBe('audit');
  });

  it('a value that opens nothing here opens Records: unknown, absent, or a tool not offered', () => {
    for (const raw of [null, '', 'grid', 'details', 'preview', 'bogus']) {
      expect(readObjectDesignerTab(raw, TOOLS), String(raw)).toEqual({ view: 'grid', tool: null });
    }
    // History without the authoring-trail capabilities.
    expect(readObjectDesignerTab('history', ['references', 'source'])).toEqual({ view: 'grid', tool: null });
    // CONTROL: offered, it opens.
    expect(readObjectDesignerTab('history', TOOLS).tool).toEqual({ tab: 'history' });
  });
});
