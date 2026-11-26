// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37455 — the surface's page controls (Cancel and Save, the AI
 * assistant) are drawn by the page's first title row, once:
 *
 *  - an item header ends its action slot with Save, then the assistant behind
 *    a hairline, after the pillar's own actions;
 *  - a header nested under the page's own, or a list row further down, draws
 *    neither: one page, one Save;
 *  - when the first row goes, the next one takes them;
 *  - outside the surface's provider nothing is drawn, so Setup's pages are
 *    unchanged.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { StudioItemHeader } from './StudioItemHeader';
import { StudioTitleRowAssistant, StudioTitleRowProvider } from './studioTitleRow';

afterEach(cleanup);

const SAVE = (
  <button type="button" data-testid="studio-save">
    Save
  </button>
);
const ASSISTANT = (
  <button type="button" data-testid="topbar-ai-assistant">
    AI
  </button>
);

function Surface({ children, save = SAVE }: { children: React.ReactNode; save?: React.ReactNode }) {
  return (
    <StudioTitleRowProvider save={save} assistant={ASSISTANT}>
      {children}
    </StudioTitleRowProvider>
  );
}

const pillarAction = (
  <button type="button" data-testid="pillar-action">
    More
  </button>
);

describe('the page controls end the page\'s first title row (objectstack#37455)', () => {
  it('an item header: the pillar\'s actions, then Save, then the hairline and the assistant', () => {
    render(
      <Surface>
        <StudioItemHeader testId="item" title="Task" actions={pillarAction} />
      </Surface>,
    );
    const header = screen.getByTestId('item');
    const save = within(header).getByTestId('studio-save');
    const slot = save.parentElement as HTMLElement;
    const order = Array.from(slot.children).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['pillar-action', 'studio-save', 'studio-title-row-divider', 'topbar-ai-assistant']);
  });

  it('with nothing unsaved, the assistant alone; with no pillar actions, no hairline before it', () => {
    render(
      <Surface save={null}>
        <StudioItemHeader testId="item" title="Task" />
      </Surface>,
    );
    const header = screen.getByTestId('item');
    expect(within(header).queryByTestId('studio-save')).toBeNull();
    expect(within(header).queryByTestId('studio-title-row-divider')).toBeNull();
    expect(within(header).getByTestId('topbar-ai-assistant')).toBeInTheDocument();
  });

  it('a header nested under the page\'s own and a list row below it draw nothing: one Save, one assistant', () => {
    render(
      <Surface>
        <StudioItemHeader testId="outer" title="Outer" actions={pillarAction} />
        <section>
          <StudioItemHeader testId="inner" title="Inner" actions={<StudioItemHeader testId="nested" title="Nested" />} />
          <div data-testid="list-row">
            <StudioTitleRowAssistant />
          </div>
        </section>
      </Surface>,
    );
    expect(screen.getAllByTestId('studio-save')).toHaveLength(1);
    expect(screen.getAllByTestId('topbar-ai-assistant')).toHaveLength(1);
    expect(within(screen.getByTestId('outer')).getByTestId('studio-save')).toBeInTheDocument();
    expect(within(screen.getByTestId('list-row')).queryByTestId('topbar-ai-assistant')).toBeNull();
  });

  it('the outer header of a nested pair is the page\'s, whichever mounts first', () => {
    render(
      <Surface>
        <StudioItemHeader testId="outer" title="Outer" actions={<StudioItemHeader testId="nested" title="Nested" />} />
      </Surface>,
    );
    expect(screen.getAllByTestId('studio-save')).toHaveLength(1);
    const save = screen.getByTestId('studio-save');
    expect(within(screen.getByTestId('nested')).queryByTestId('studio-save')).toBeNull();
    expect(screen.getByTestId('outer').contains(save)).toBe(true);
  });

  it('when the first row goes, the next one takes the controls', () => {
    function Page({ withHeader }: { withHeader: boolean }) {
      return (
        <Surface>
          {withHeader && <StudioItemHeader testId="item" title="Task" />}
          <div data-testid="list-row" className="flex">
            <StudioTitleRowAssistant />
          </div>
        </Surface>
      );
    }
    const { rerender } = render(<Page withHeader />);
    expect(within(screen.getByTestId('list-row')).queryByTestId('topbar-ai-assistant')).toBeNull();
    rerender(<Page withHeader={false} />);
    const row = screen.getByTestId('list-row');
    expect(within(row).getByTestId('topbar-ai-assistant')).toBeInTheDocument();
    // The list row draws the assistant alone, behind its hairline.
    expect(within(row).getByTestId('studio-title-row-divider')).toBeInTheDocument();
    expect(within(row).queryByTestId('studio-save')).toBeNull();
  });

  it('CONTROL: outside the surface a title row draws its own actions only', () => {
    render(
      <>
        <StudioItemHeader testId="item" title="Task" actions={pillarAction} />
        <div data-testid="list-row">
          <StudioTitleRowAssistant />
        </div>
      </>,
    );
    expect(screen.queryByTestId('studio-save')).toBeNull();
    expect(screen.queryByTestId('topbar-ai-assistant')).toBeNull();
    expect(screen.queryByTestId('studio-title-row-divider')).toBeNull();
    expect(screen.getByTestId('list-row')).toBeEmptyDOMElement();
  });
});
