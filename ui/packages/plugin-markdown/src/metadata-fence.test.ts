/**
 * parseMetadataFence (ADR-0051) — the ```metadata fence body is DATA, not
 * code: a flat `key: value` block. These tests pin that contract.
 */

import { describe, it, expect } from 'vitest';
import { parseMetadataFence } from './MarkdownImpl';

describe('parseMetadataFence', () => {
  it('parses a flat key: value block', () => {
    expect(
      parseMetadataFence('type: state_machine\nobject: showcase_task\nname: task_status_flow'),
    ).toEqual({ type: 'state_machine', object: 'showcase_task', name: 'task_status_flow' });
  });

  it('trims whitespace and strips surrounding quotes', () => {
    expect(parseMetadataFence('  type :  flow \n name: "my_flow" \n mode: \'diagram\''))
      .toEqual({ type: 'flow', name: 'my_flow', mode: 'diagram' });
  });

  it('ignores blank lines and # comments', () => {
    expect(parseMetadataFence('# a comment\n\ntype: permission\n\n# another\nname: contrib'))
      .toEqual({ type: 'permission', name: 'contrib' });
  });

  it('keeps values containing colons (only splits on the first)', () => {
    expect(parseMetadataFence('note: a:b:c')).toEqual({ note: 'a:b:c' });
  });

  it('skips malformed lines without a key', () => {
    expect(parseMetadataFence('justtext\n: noval\ntype: flow')).toEqual({ type: 'flow' });
  });

  it('returns an empty object for empty input', () => {
    expect(parseMetadataFence('')).toEqual({});
  });
});
