/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { rewriteDocLinks } from './doc-links';

describe('rewriteDocLinks (ADR-0046)', () => {
  it('rewrites ./name.md links to /docs/name', () => {
    expect(rewriteDocLinks('See the [guide](./crm_lead_guide.md).', '/docs'))
      .toBe('See the [guide](/docs/crm_lead_guide).');
  });

  it('rewrites bare name.md links and preserves anchors', () => {
    expect(rewriteDocLinks('Back to [index](crm_index.md#setup).', '/docs'))
      .toBe('Back to [index](/docs/crm_index#setup).');
  });

  it('rewrites multiple links in one document', () => {
    const input = '[a](./crm_a.md) and [b](./crm_b.md#x)';
    expect(rewriteDocLinks(input, '/docs')).toBe('[a](/docs/crm_a) and [b](/docs/crm_b#x)');
  });

  it('leaves external and non-doc links alone', () => {
    const input = '[site](https://example.com/x.md) [pdf](./file.pdf) [abs](/docs/already)';
    expect(rewriteDocLinks(input, '/docs')).toBe(input);
  });

  it('does not touch links inside fenced code blocks', () => {
    const input = 'prose [a](./crm_a.md)\n\n```md\n[b](./crm_b.md)\n```\n\n[c](./crm_c.md)';
    expect(rewriteDocLinks(input, '/docs')).toBe(
      'prose [a](/docs/crm_a)\n\n```md\n[b](./crm_b.md)\n```\n\n[c](/docs/crm_c)',
    );
  });

  it('does not touch links inside inline code spans', () => {
    const input = 'Write `[x](./crm_x.md)` to link; see [y](./crm_y.md).';
    expect(rewriteDocLinks(input, '/docs')).toBe('Write `[x](./crm_x.md)` to link; see [y](/docs/crm_y).');
  });

  it('prefixes the docs href the caller passes, so a sub-path mount carries its basename (objectui#12686)', () => {
    expect(rewriteDocLinks('See [a](./crm_a.md) and [b](crm_b.md#x).', '/_console/docs'))
      .toBe('See [a](/_console/docs/crm_a) and [b](/_console/docs/crm_b#x).');
  });

  it('skips path-shaped targets (subdirectories are banned upstream anyway)', () => {
    const input = '[deep](./user/crm_a.md)';
    expect(rewriteDocLinks(input, '/docs')).toBe(input);
  });
});
