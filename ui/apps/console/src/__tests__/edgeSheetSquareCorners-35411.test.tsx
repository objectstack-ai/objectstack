/**
 * The console's extra-rounded dialog corners skip full-height edge drawers
 * (objectstack#35411).
 *
 * `index.css` gives every `role="dialog"` surface a 1.25rem radius. A left or
 * right Sheet is fixed against the top, side and bottom of the viewport, so the
 * radius showed as a notch at each inner corner. The rule now skips the Sheet's
 * edge variants by the `inset-y-0` class their variant carries, while centred
 * dialogs and bottom sheets keep the radius.
 *
 * The selector is read from the shipped stylesheet and matched against the DOM
 * the real primitives render, so a change to either side is seen here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetTitle,
} from '@object-ui/components';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.resolve(HERE, '../index.css'), 'utf8');

/** The selector of the one rule that sets the 1.25rem dialog radius. */
function roundingSelector(): string {
  const rules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /border-radius:\s*1\.25rem/.test(body))
    .map(([, selector]) => selector.trim());
  expect(rules).toHaveLength(1);
  return rules[0];
}

function renderSheet(side: 'left' | 'right' | 'bottom' | 'top'): HTMLElement {
  render(
    <Sheet open>
      <SheetContent side={side}>
        <SheetTitle>{`${side} sheet`}</SheetTitle>
      </SheetContent>
    </Sheet>,
  );
  return screen.getByRole('dialog');
}

describe('edge sheets are not rounded by the dialog corner rule (#35411)', () => {
  it('the rule still targets dialogs', () => {
    expect(roundingSelector()).toContain('[role="dialog"]');
  });

  it.each(['left', 'right'] as const)('a %s sheet is not matched', (side) => {
    expect(renderSheet(side).matches(roundingSelector())).toBe(false);
  });

  it.each(['bottom', 'top'] as const)('a %s sheet keeps the rounded corners', (side) => {
    expect(renderSheet(side).matches(roundingSelector())).toBe(true);
  });

  it('a centred dialog keeps the rounded corners', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>centred</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog').matches(roundingSelector())).toBe(true);
  });
});
