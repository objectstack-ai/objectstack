/**
 * The console's extra-rounded corners skip full-height edge drawers
 * (objectstack#35411) and, since objectstack#35980, every modal dialog.
 *
 * `index.css` used to give every `role="dialog"` surface a 1.25rem radius. A
 * left or right Sheet is fixed against the top, side and bottom of the
 * viewport, so the radius showed as a notch at each inner corner; #35411 made
 * the rule skip the Sheet's edge variants. #35980 moved the dialog's look onto
 * the dialog itself (`dialog-surface`, a 12px card), so the rule no longer
 * names every `role="dialog"`: it keeps the rounded corners for the floating
 * popover and the bottom drawer only, by their own containers. A top or
 * bottom Sheet meets the viewport on three edges like a side one, and is no
 * longer matched either.
 *
 * The record drawer is the exception: it is a floating card (objectstack#35854)
 * that sets its own radius, so the global rule must not override it either.
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
  NavigationOverlay,
  Sheet,
  SheetContent,
  SheetTitle,
} from '@object-ui/components';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.resolve(HERE, '../index.css'), 'utf8');

const DECLARATION = 'border-radius: 1.25rem !important;';

/**
 * The selector of the one rule that sets the 1.25rem dialog radius: the text
 * between the end of whatever precedes the rule (a closing brace or the
 * comment above it) and the rule's opening brace.
 */
function roundingSelector(): string {
  const at = CSS.indexOf(DECLARATION);
  expect(at).toBeGreaterThan(-1);
  expect(CSS.indexOf(DECLARATION, at + 1)).toBe(-1);
  const open = CSS.lastIndexOf('{', at);
  const start = Math.max(CSS.lastIndexOf('}', open), CSS.lastIndexOf('*/', open) + 1) + 1;
  return CSS.slice(start, open).trim();
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

describe('edge sheets and dialogs are not rounded by the corner rule (#35411, #35980)', () => {
  it('the rule names popovers and the bottom drawer, never every dialog', () => {
    const selector = roundingSelector();
    expect(selector).toContain('[data-radix-popper-content-wrapper] > [role="dialog"]');
    expect(selector).toContain('[data-vaul-drawer]');
    for (const part of selector.split(',')) {
      expect(part.trim().startsWith('[role="dialog"]')).toBe(false);
    }
  });

  it.each(['left', 'right', 'bottom', 'top'] as const)('a %s sheet is not matched', (side) => {
    expect(renderSheet(side).matches(roundingSelector())).toBe(false);
  });

  it('a centred dialog is not matched: it carries its own corner', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>centred</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.matches(roundingSelector())).toBe(false);
    expect(dialog.className.split(/\s+/)).toContain('sm:rounded-[12px]');
  });
});

describe('the record drawer keeps its own floating-card radius (#35411, #35854)', () => {
  // Renders the real NavigationOverlay drawer. Its own radius is asserted on
  // the className it ships: the test DOM has no compiled Tailwind, so the
  // utility's computed value is not readable here.
  function renderRecordDrawer(): HTMLElement {
    render(
      <NavigationOverlay
        isOpen
        isOverlay
        selectedRecord={{ id: 'r1' }}
        mode="drawer"
        close={() => {}}
        setIsOpen={() => {}}
        title="Lead"
        width="720px"
        mainContent={<div />}
      >
        {() => <div>record body</div>}
      </NavigationOverlay>,
    );
    return screen.getByRole('dialog', { name: 'Lead' });
  }

  it('is not matched by the global rounding rule', () => {
    const card = renderRecordDrawer();
    expect(card.hasAttribute('data-record-drawer-card')).toBe(true);
    expect(card.matches(roundingSelector())).toBe(false);
  });

  it('carries its own radius class', () => {
    expect(renderRecordDrawer().className.split(/\s+/)).toContain('sm:rounded-xl');
  });
});
