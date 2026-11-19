// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35628 — step 2, the inline register as PATH PREFIXES (the page
 * half is pinned in `ResourceEditPage.defaultInspectorIssues-35628.test.tsx`):
 *
 *   - `issuePathDrawnBy` matches a registered prefix segment-wise, and over a
 *     whole-draft form's one-segment keys it is the head test it replaces;
 *   - a form mounted over a slice reports its rows under the slice's path, so
 *     it never claims a sibling key's issue;
 *   - a curated row (`IssuePrefixLines`) draws its prefix's issues the way a
 *     form row does and registers the prefix only while mounted.
 */

import '@testing-library/jest-dom/vitest';
// The source loads these lazily; pay that load at collection, not inside a
// case's clocked window.
import '@objectstack/formula';
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SchemaForm, type SchemaFormIssue } from './SchemaForm';
import {
  IssuePrefixLines,
  issuePathDrawnBy,
  issuePathHead,
  issuesUnderPrefix,
  useIssuePrefixRegister,
  useSliceFormIssueRows,
} from './issuePath';

afterEach(() => cleanup());

describe('issuePathDrawnBy — a registered prefix draws its path and every path below it', () => {
  it('matches segment-wise, never by string prefix', () => {
    const drawn = new Set(['config.columns', 'label']);
    expect(issuePathDrawnBy(drawn, 'config.columns')).toBe(true);
    expect(issuePathDrawnBy(drawn, 'config.columns.0.field')).toBe(true);
    expect(issuePathDrawnBy(drawn, 'config.columnsX.0')).toBe(false);
    expect(issuePathDrawnBy(drawn, 'config')).toBe(false);
    expect(issuePathDrawnBy(drawn, 'config.zz_unknown')).toBe(false);
    expect(issuePathDrawnBy(drawn, '')).toBe(false);
  });

  it('over a whole-draft form’s row keys it answers as the head test did', () => {
    const rows = new Set(['label', 'options', 'columns']);
    for (const path of ['label', 'label.not_a_locale', 'options.dialect', 'columns.0.field', 'zz.deeper', '', 'labels']) {
      expect(issuePathDrawnBy(rows, path)).toBe(rows.has(issuePathHead(path)));
    }
  });

  it('issuesUnderPrefix hands a slice form its issues, trimmed, and none of the slice’s siblings', () => {
    const issues = [
      { path: 'config.filter.0', message: 'a' },
      { path: 'config', message: 'b' },
      { path: 'configX.y', message: 'c' },
      { path: 'label', message: 'd' },
    ];
    expect(issuesUnderPrefix(issues, 'config')).toEqual([{ path: 'filter.0', message: 'a' }]);
  });
});

const SLICE_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string', title: 'Description' },
    filter: { type: 'string', title: 'Filter' },
  },
};

/** A curated inspector in miniature: one bespoke row and a form over `draft.config`. */
function SliceHost({
  issues,
  onDrawn,
}: {
  issues: SchemaFormIssue[];
  onDrawn: (prefixes: ReadonlySet<string>) => void;
}) {
  const register = useIssuePrefixRegister(onDrawn);
  const setFormRows = useSliceFormIssueRows(register, 'config');
  const draft = { label: { not_a_locale: 'Tasks' }, config: { description: 'd', filter: 'f', columns: [{ name: 'title' }] } };
  return (
    <div>
      <IssuePrefixLines issues={issues} prefix="label" label="Label" value={draft.label} register={register} />
      <IssuePrefixLines
        issues={issues}
        prefix="config.columns"
        label="Columns"
        value={draft.config.columns}
        register={register}
      />
      <SchemaForm
        schema={SLICE_SCHEMA as never}
        value={draft.config}
        onChange={() => {}}
        issues={issuesUnderPrefix(issues, 'config')}
        onInlineIssueFieldsChange={setFormRows}
      />
    </div>
  );
}

describe('a slice form and curated rows report what they draw, under the draft’s paths', () => {
  const ISSUES: SchemaFormIssue[] = [
    { path: 'label.not_a_locale', message: 'Unrecognized locale key' },
    { path: 'config.columns.0', message: 'Unknown column key' },
    { path: 'config.filter', message: 'Bad filter' },
    { path: 'config.zz_unknown', message: 'Not a view key' },
  ];

  it('registers `config.filter`, never `config`, so a sibling key no row renders stays undrawn', () => {
    let drawn: ReadonlySet<string> = new Set();
    const { unmount } = render(<SliceHost issues={ISSUES} onDrawn={(p) => (drawn = p)} />);
    expect([...drawn].sort()).toEqual(['config.columns', 'config.description', 'config.filter', 'label']);
    expect(ISSUES.map((i) => issuePathDrawnBy(drawn, i.path))).toEqual([true, true, true, false]);
    unmount();
    expect([...drawn]).toEqual([]);
  });

  it('draws an exact cause as its message and a deeper one led by its trail', () => {
    render(<SliceHost issues={ISSUES} onDrawn={() => {}} />);
    expect(screen.getAllByTestId('inspector-row-issue').map((el) => el.textContent)).toEqual([
      'Label → not_a_locale: Unrecognized locale key',
      'Columns → title: Unknown column key',
    ]);
    expect(screen.getAllByTestId('schema-form-issue').map((el) => el.textContent)).toEqual(['Bad filter']);
    expect(screen.queryByText('Not a view key', { exact: false })).toBeNull();
  });
});
