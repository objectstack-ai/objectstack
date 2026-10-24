// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PageBlockCanvas, toCanvasSchema } from './PageBlockCanvas';

afterEach(cleanup);

/**
 * Empty-canvas messaging. Region-composed pages with no regions yet invite
 * the author to add one. (ADR-0047 interface pages never reach this canvas —
 * PagePreview renders them as a live InterfaceListPage in both modes — so
 * there is no interface-specific empty state here.)
 */
describe('PageBlockCanvas — empty state', () => {
  it('a region-composed page shows the "No regions yet / Add region" empty state', () => {
    render(<PageBlockCanvas draft={{ name: 'home', type: 'home', regions: [] }} onPatch={() => {}} />);
    expect(screen.getByText(/No regions yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Add region/i)).toBeInTheDocument();
    expect(screen.queryByText(/configured in Properties/i)).not.toBeInTheDocument();
  });
});


/**
 * Overlay form-type guard. A live `object-form` block with `formType: 'drawer'`
 * (or `'modal'`) would mount a portalled, focus-trapping modal over the design
 * canvas and lock the whole editor ("the UI freezes"). toCanvasSchema coerces
 * those overlay types to an inline `simple` form so the canvas shows the field
 * layout in place — mirroring ViewPreview. Regression guard for that freeze.
 */
describe('toCanvasSchema — overlay form coercion', () => {
  it('coerces a drawer object-form to an inline simple form (no modal on the canvas)', () => {
    const schema = toCanvasSchema({
      type: 'object-form',
      properties: { objectName: 'showcase_project', mode: 'create', formType: 'drawer' },
    }) as any;
    expect(schema.type).toBe('object-form');
    expect(schema.properties.formType).toBe('simple');
    expect(schema.properties.objectName).toBe('showcase_project'); // siblings preserved
  });

  it('coerces a modal form type too', () => {
    const schema = toCanvasSchema({ type: 'object-form', properties: { formType: 'modal' } }) as any;
    expect(schema.properties.formType).toBe('simple');
  });

  it('also neutralises a top-level (hoisted) overlay formType', () => {
    const schema = toCanvasSchema({ type: 'object-form', formType: 'drawer' } as any) as any;
    expect(schema.formType).toBe('simple');
  });

  it('leaves inline form types untouched', () => {
    for (const ft of ['simple', 'tabbed', 'wizard', 'split']) {
      const schema = toCanvasSchema({ type: 'object-form', properties: { formType: ft } }) as any;
      expect(schema.properties.formType).toBe(ft);
    }
  });

  it('does not mutate the input block', () => {
    const block: any = { type: 'object-form', properties: { formType: 'drawer' } };
    toCanvasSchema(block);
    expect(block.properties.formType).toBe('drawer');
  });

  it('leaves non-form blocks unchanged', () => {
    const schema = toCanvasSchema({ type: 'element:text', properties: { content: 'hi' } }) as any;
    expect(schema.type).toBe('element:text');
    expect(schema.properties.content).toBe('hi');
  });
});
