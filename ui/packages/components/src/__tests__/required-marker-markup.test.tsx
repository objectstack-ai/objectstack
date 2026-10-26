/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The required asterisk on a labelled control is a REAL `aria-hidden` element,
 * never CSS generated content (objectui#10368).
 *
 * ## The defect
 *
 * Six sites in this package drew the marker as a Tailwind `::after` content
 * utility on the control's label. The accessible-name computation includes CSS
 * generated content, so in Chromium a required field labelled "Title" was
 * NAMED "Title*". A pseudo-element cannot carry `aria-hidden`, so there was no
 * way to keep that paint out of the name short of making it an element.
 *
 * ## Why these cases read MARKUP, not a name
 *
 * happy-dom does not compute generated content. A name computed here was
 * "Title" on the defective build too — two pins in this package said so, and
 * were green for exactly that reason. So a happy-dom name is never the evidence
 * in this file. Each case reads the markup instead, which fails on the defect
 * in any DOM:
 *
 *  1. nothing in the label draws generated content: no Tailwind `content-[…]`
 *     / `content-(…)` utility, bare or behind a variant;
 *  2. the visible `*` is ONE real element carrying `aria-hidden="true"`
 *     (located by `data-required-marker`, the form renderer's locator);
 *  3. the label's text outside `aria-hidden` subtrees is exactly the label;
 *  4. the control still carries the required STATE it carried before — this
 *     change moves paint, never validation.
 *
 * The before/after Chromium accessibility-tree reading on the compiled sheet is
 * a one-off measurement recorded on the pull request; nothing in this repo
 * re-derives it (this package has no browser test harness), said here rather
 * than left to read as live (AGENTS.md #9).
 *
 * The last block is a SOURCE guard over this package's `src`: no generated-
 * content asterisk utility anywhere, so a seventh site cannot bring the defect
 * back where no per-site case is looking.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldContainer } from '../custom/field';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';
import type { CheckboxSchema, ElementTextInputNode, InputSchema, SelectSchema, TextareaSchema } from '@object-ui/types';

/**
 * Types a literal below as the node it is rather than as the `BaseSchema`
 * `renderComponent` accepts (objectui#11347): since objectui#8347 removed
 * `BaseSchema`'s index signature, a literal checked against `BaseSchema`
 * may author only `BaseSchema`'s own keys.
 */
const inputNode = (schema: InputSchema): InputSchema => schema;
const textareaNode = (schema: TextareaSchema): TextareaSchema => schema;
const checkboxNode = (schema: CheckboxSchema): CheckboxSchema => schema;
const selectNode = (schema: SelectSchema): SelectSchema => schema;
// objectui#11364: the spec's `element:text_input` node, its row as the `properties` bag.
const textInputNode = (schema: ElementTextInputNode): ElementTextInputNode => schema;

afterEach(cleanup);

/** Every class token on `root` or below it that draws CSS generated content. */
function generatedContentClasses(root: Element): string[] {
  return [root, ...Array.from(root.querySelectorAll('*'))]
    .flatMap((el) => Array.from(el.classList))
    .filter((c) => /(^|:)content-[[(]/.test(c));
}

/** The label's text with every `aria-hidden="true"` subtree removed. */
function textOutsideAriaHidden(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
  return Array.from(node.childNodes).map(textOutsideAriaHidden).join('');
}

interface Site {
  site: string;
  render: (required: boolean) => void;
  /** The label that carries the marker. */
  label: () => HTMLElement | null;
  /** The control, and the required STATE it must carry. */
  expectRequiredState: () => void;
}

const SITES: Site[] = [
  {
    site: 'FieldContainer (custom/field.tsx)',
    render: (required) =>
      render(
        <FieldContainer label="Title" required={required} htmlFor="fc-ctl">
          <input />
        </FieldContainer>,
      ),
    label: () => document.querySelector('label[for="fc-ctl"]'),
    expectRequiredState: () => {
      const ctl = document.getElementById('fc-ctl') as HTMLInputElement;
      expect(ctl).toHaveAttribute('aria-required', 'true');
      // Unchanged by objectui#10368: still no native `required` (#3290).
      expect(ctl).not.toHaveAttribute('required');
    },
  },
  {
    site: 'element:text_input (renderers/basic/text-input.tsx)',
    render: (required) =>
      renderComponent(textInputNode({ type: 'element:text_input', id: 'ti-ctl', properties: { label: 'Title', required } })),
    label: () => document.querySelector('label[for="ti-ctl"]'),
    expectRequiredState: () => expect(document.getElementById('ti-ctl')).toHaveAttribute('required'),
  },
  {
    site: 'input (renderers/form/input.tsx)',
    render: (required) => renderComponent(inputNode({ type: 'input', id: 'in-ctl', label: 'Title', required })),
    label: () => document.querySelector('label[for="in-ctl"]'),
    expectRequiredState: () => expect(document.getElementById('in-ctl')).toHaveAttribute('required'),
  },
  {
    site: 'textarea (renderers/form/textarea.tsx)',
    render: (required) => renderComponent(textareaNode({ type: 'textarea', id: 'ta-ctl', label: 'Title', required })),
    label: () => document.querySelector('label[for="ta-ctl"]'),
    expectRequiredState: () => expect(document.getElementById('ta-ctl')).toHaveAttribute('required'),
  },
  {
    site: 'checkbox (renderers/form/checkbox.tsx)',
    render: (required) => renderComponent(checkboxNode({ type: 'checkbox', id: 'cb-ctl', label: 'Title', required })),
    label: () => document.querySelector('label[for="cb-ctl"]'),
    // Radix writes `aria-required` on the role=checkbox button from `required`.
    expectRequiredState: () => expect(screen.getByRole('checkbox')).toHaveAttribute('aria-required', 'true'),
  },
  {
    site: 'select (renderers/form/select.tsx)',
    render: (required) =>
      renderComponent(selectNode({
        type: 'select',
        id: 'sel-ctl',
        label: 'Title',
        required,
        options: [{ label: 'A', value: 'a' }],
      })),
    // The label names the trigger through `for` since objectui#10435, whose
    // own pin (`select-label-association.test.tsx`) reads the resulting name.
    label: () => document.querySelector('label[for="sel-ctl"]'),
    // Radix writes `aria-required` on the combobox trigger from `required`.
    expectRequiredState: () => expect(screen.getByRole('combobox')).toHaveAttribute('aria-required', 'true'),
  },
];

describe('required marker is a real aria-hidden element, never CSS generated content (objectui#10368)', () => {
  describe.each(SITES)('$site', ({ render: renderSite, label, expectRequiredState }) => {
    it('required: draws the asterisk as one aria-hidden element and no generated content', () => {
      renderSite(true);
      const el = label();
      expect(el).not.toBeNull();

      expect(generatedContentClasses(el!)).toEqual([]);

      const markers = el!.querySelectorAll('[data-required-marker]');
      expect(markers).toHaveLength(1);
      expect(markers[0]).toHaveAttribute('aria-hidden', 'true');
      expect(markers[0].textContent).toBe('*');

      expect(textOutsideAriaHidden(el!)).toBe('Title');

      expectRequiredState();
    });

    it('optional: draws no marker at all', () => {
      renderSite(false);
      const el = label();
      expect(el).not.toBeNull();

      expect(generatedContentClasses(el!)).toEqual([]);
      expect(el!.querySelector('[data-required-marker]')).toBeNull();
      expect(el!.textContent).toBe('Title');
    });
  });
});

describe('source guard: no generated-content asterisk anywhere in this package (objectui#10368)', () => {
  // Rooted on this file, never on `process.cwd()` (AGENTS.md, objectui#7791).
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  // A Tailwind content utility whose value starts with an asterisk, quoted or
  // not, with `_` / spaces allowed before it: every spelling the six sites
  // used, and the obvious respellings of it.
  const ASTERISK_CONTENT = /content-\[\s*['"]?[_ ]*\*/;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = join(dir, d.name);
      if (d.isDirectory()) return d.name === '__tests__' || d.name === 'node_modules' ? [] : sourceFiles(p);
      return /\.(ts|tsx)$/.test(d.name) && !/\.test\.(ts|tsx)$/.test(d.name) ? [p] : [];
    });
  }

  it('scans a real population', () => {
    // The control that makes the zero below a reading: the files that held
    // the six sites are in the scanned set.
    const files = sourceFiles(SRC).map((f) => relative(SRC, f).split('\\').join('/'));
    for (const f of [
      'custom/field.tsx',
      'renderers/basic/text-input.tsx',
      'renderers/form/input.tsx',
      'renderers/form/textarea.tsx',
      'renderers/form/checkbox.tsx',
      'renderers/form/select.tsx',
    ]) {
      expect(files).toContain(f);
    }
  });

  it('the pattern matches every spelling it guards', () => {
    for (const hit of [`after:content-['*']`, `before:content-["*"]`, `after:content-['_*']`, `after:content-[*]`]) {
      expect(ASTERISK_CONTENT.test(hit)).toBe(true);
    }
    expect(ASTERISK_CONTENT.test('prose-code:after:content-none')).toBe(false);
  });

  it('finds no generated-content asterisk in any non-test source file', () => {
    const offenders = sourceFiles(SRC).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => ASTERISK_CONTENT.test(line))
        .map(({ line, i }) => `${relative(SRC, f)}:${i + 1}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
