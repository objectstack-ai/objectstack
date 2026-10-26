// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flow-node palette has no untranslated entry left — objectui#5416.
 *
 * The card's walk found the palette fully Chinese except for ONE row:
 * `Revise Window`, rendered with the framework descriptor's English name and
 * its three-line English paragraph, in a list where every other node is a
 * Chinese name and a short Chinese phrase. The cause was a missing row, not a
 * missing mechanism — this console has carried `engine.flowNode.<type>.label`
 * / `.hint` for 21 node types all along, resolved through
 * `translateNodeLabel` / `translateNodeHint` so the server descriptor stays
 * the source of truth in English.
 *
 * The suite pins both halves of that contract, because the second is what
 * keeps this table a translation rather than a fork: zh resolves to Chinese,
 * and en resolves to whatever the framework descriptor passed in.
 */

import { describe, it, expect } from 'vitest';
import { translateNodeLabel, translateNodeHint } from './i18n';

/**
 * The framework's own strings for this node type, copied here ONLY as the
 * fallback argument a caller supplies — `flow-canvas-parts` / `FlowNodeInspector`
 * pass the live descriptor. Their exact wording is not asserted; that they
 * survive untouched in en is.
 */
const DESCRIPTOR_NAME = 'Revise Window';
const DESCRIPTOR_DESCRIPTION =
  'Durable pause an approval send-back parks the run on while the submitter reworks the record.';

describe('flow-node palette i18n (objectui#5416)', () => {
  it('translates the approval_revise node in a zh console', () => {
    expect(translateNodeLabel('approval_revise', 'zh-CN', DESCRIPTOR_NAME)).toBe('修订窗口');
    expect(translateNodeHint('approval_revise', 'zh-CN', DESCRIPTOR_DESCRIPTION)).toBe(
      '审批退回后暂停,等待提交人重新提交',
    );
  });

  it('leaves the framework descriptor as the English source of truth', () => {
    expect(translateNodeLabel('approval_revise', 'en-US', DESCRIPTOR_NAME)).toBe(DESCRIPTOR_NAME);
    expect(translateNodeHint('approval_revise', 'en-US', DESCRIPTOR_DESCRIPTION)).toBe(
      DESCRIPTOR_DESCRIPTION,
    );
  });

  it('leaves the approval_revise row shaped like its 21 siblings', () => {
    // A label-only row would put a Chinese name over an English paragraph —
    // half the defect, and the shape a hand-added row most easily lands in.
    for (const type of ['approval', 'approval_revise', 'wait', 'end']) {
      expect(translateNodeLabel(type, 'zh-CN', 'FALLBACK')).not.toBe('FALLBACK');
      expect(translateNodeHint(type, 'zh-CN', 'FALLBACK')).not.toBe('FALLBACK');
    }
  });
});
