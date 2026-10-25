import { describe, it, expect } from 'vitest';
import { stripDiscussionNodes, hasExplicitAttachments } from '../pageSchemaIntrospect';

/**
 * Every `type` string anywhere in a (non-cyclic) tree, in document order.
 * Asserting on this rather than on a hand-written expected tree keeps the
 * cases below readings about WHICH NODES SURVIVED — a strip that flattened or
 * dropped a sibling would show up here, where a `not.toContain` on the
 * serialized tree would not.
 */
function types(tree: unknown): string[] {
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node.type === 'string') out.push(node.type);
    for (const key of ['children', 'items', 'body', 'components', 'regions']) walk(node[key]);
    if (node.properties) for (const key of ['children', 'items']) walk(node.properties[key]);
  };
  walk(tree);
  return out;
}

/**
 * objectui#7298 — `enable.feeds: false` is the OBJECT's switch and it outranks
 * whatever the page composed. `RecordDetailView` hands the composed tree
 * through this before rendering it, so a declared (or synthesized)
 * `record:discussion` never reaches a feeds-off object.
 */
describe('stripDiscussionNodes', () => {
  it('returns nullish and primitive inputs unchanged', () => {
    expect(stripDiscussionNodes(null)).toBeNull();
    expect(stripDiscussionNodes(undefined)).toBeUndefined();
    // A bare string is not a node, so it is not a discussion node either.
    expect(stripDiscussionNodes('record:discussion')).toBe('record:discussion');
    expect(stripDiscussionNodes(42)).toBe(42);
  });

  it('returns null when the ROOT itself is the discussion node', () => {
    // No container to remove it from — the total-function corner.
    expect(stripDiscussionNodes({ type: 'record:discussion' })).toBeNull();
    expect(stripDiscussionNodes({ type: 'record:chatter' })).toBeNull();
  });

  it('removes discussion nested inside children/items/body/components', () => {
    const node = (key: string) => ({
      type: 'foo',
      [key]: [{ type: 'record:details' }, { type: 'record:discussion' }],
    });
    for (const key of ['children', 'items', 'body', 'components']) {
      expect(types(stripDiscussionNodes(node(key)))).toEqual(['foo', 'record:details']);
    }
  });

  it('removes the record:chatter alias too', () => {
    const page = { type: 'foo', children: [{ type: 'record:chatter' }, { type: 'record:details' }] };
    expect(types(stripDiscussionNodes(page))).toEqual(['foo', 'record:details']);
  });

  it('removes discussion nested inside properties.children/items', () => {
    expect(
      types(
        stripDiscussionNodes({
          type: 'foo',
          properties: { children: [{ type: 'record:discussion' }, { type: 'record:details' }] },
        }),
      ),
    ).toEqual(['foo', 'record:details']);
    expect(
      types(
        stripDiscussionNodes({
          type: 'foo',
          properties: { items: [{ type: 'record:chatter' }] },
        }),
      ),
    ).toEqual(['foo']);
  });

  it('removes discussion from regions[].components[] (synth + full pages)', () => {
    // Mirrors buildDefaultPageSchema output shape.
    const synthPage = {
      type: 'record',
      pageType: 'record',
      object: 'account',
      template: 'default',
      regions: [
        {
          name: 'main',
          width: 'full',
          components: [
            { type: 'page:header' },
            { type: 'page:tabs', items: [{ type: 'page:tab', children: [] }] },
            { type: 'record:discussion' },
          ],
        },
      ],
    };
    const stripped = stripDiscussionNodes(synthPage) as any;
    expect(types(stripped)).toEqual(['record', 'page:header', 'page:tabs', 'page:tab']);
    // Everything else about the page survives, including the scalars that are
    // not nodes at all.
    expect(stripped.template).toBe('default');
    expect(stripped.regions[0].name).toBe('main');
    expect(stripped.regions[0].width).toBe('full');
  });

  it('strips deep nesting (page:tabs > page:tab > record:discussion)', () => {
    const page = {
      regions: [
        {
          components: [
            {
              type: 'page:tabs',
              items: [{ type: 'page:tab', children: [{ type: 'record:discussion' }] }],
            },
          ],
        },
      ],
    };
    expect(types(stripDiscussionNodes(page))).toEqual(['page:tabs', 'page:tab']);
  });

  it('IDENTITY-PRESERVING — a tree with no discussion node comes back BY REFERENCE', () => {
    // This is what keeps the feeds-ON path (every object that has not opted
    // out) from handing a new page identity to the renderer on every render.
    const page = {
      type: 'record',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'page:header' },
            {
              type: 'page:tabs',
              items: [
                { type: 'page:tab', children: [{ type: 'record:details' }] },
                { type: 'page:tab', children: [{ type: 'record:history' }] },
              ],
            },
          ],
        },
      ],
    };
    expect(stripDiscussionNodes(page)).toBe(page);
  });

  it('copies only the path it had to change', () => {
    const untouched = { type: 'page:header' };
    const page = {
      type: 'record',
      regions: [{ name: 'main', components: [untouched, { type: 'record:discussion' }] }],
    };
    const stripped = stripDiscussionNodes(page) as any;
    expect(stripped).not.toBe(page);
    // The sibling that had nothing removed is the SAME object, not a clone.
    expect(stripped.regions[0].components[0]).toBe(untouched);
  });

  it('prunes a SHARED subtree in every place it appears', () => {
    // The walker memoizes by node, so a second occurrence must get the pruned
    // result rather than the original it was handed on the way in.
    const shared: any = { type: 'page:section', children: [{ type: 'record:discussion' }] };
    const page = { type: 'record', regions: [{ components: [shared] }, { components: [shared] }] };
    expect(types(stripDiscussionNodes(page))).toEqual(['record', 'page:section', 'page:section']);
  });

  it('does not loop forever on cyclic schemas', () => {
    const a: any = { type: 'page:section' };
    const b: any = { type: 'page:section', children: [a] };
    a.children = [b];
    expect(() => stripDiscussionNodes(a)).not.toThrow();
  });
});

// objectstack#4358 — the synthesized default page now places
// `record:attachments` beside the discussion feed; RecordDetailView uses this
// walker to skip its legacy bottom-of-page append.
describe('hasExplicitAttachments', () => {
  it('returns false for nullish and primitive inputs', () => {
    expect(hasExplicitAttachments(null)).toBe(false);
    expect(hasExplicitAttachments(undefined)).toBe(false);
    expect(hasExplicitAttachments('record:attachments')).toBe(false);
  });

  it('detects record:attachments at the root and nested in children', () => {
    expect(hasExplicitAttachments({ type: 'record:attachments' })).toBe(true);
    expect(
      hasExplicitAttachments({
        type: 'grid',
        children: [{ type: 'record:attachments' }, { type: 'record:discussion' }],
      }),
    ).toBe(true);
  });

  it('detects attachments inside the synthesized Attachments tab (regions[].components[].items[])', () => {
    // Mirrors buildDefaultPageSchema output for an enable.files object.
    const synthPage = {
      type: 'record',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'page:header' },
            {
              type: 'page:tabs',
              items: [
                { label: 'Details', value: 'details', children: [{ type: 'record:details' }] },
                { label: 'Attachments', value: 'attachments', children: [{ type: 'record:attachments' }] },
              ],
            },
            { type: 'record:discussion' },
          ],
        },
      ],
    };
    expect(hasExplicitAttachments(synthPage)).toBe(true);
  });

  it('returns false when no attachments node exists (discussion alone)', () => {
    expect(
      hasExplicitAttachments({
        regions: [{ components: [{ type: 'record:discussion' }] }],
      }),
    ).toBe(false);
  });
});
