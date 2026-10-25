/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10530 — a timeline item's `titleField` and `descriptionField`
 * values reach the rail as display STRINGS.
 *
 * Either key names any field, and a lookup is a field like any other.
 * `ObjectTimeline`'s own object fetch expands every declared relation
 * (`buildExpandFields(objectDef?.fields)`), so a lookup-typed title or
 * description arrives as `{ id, name }`. The item mapping used to copy that raw
 * value onto the item, and the renderer puts both in JSX as React children, so
 * the whole rail threw `Objects are not valid as a React child` as soon as the
 * rows landed.
 *
 * The mapping now derives both once, through `@object-ui/core`'s
 * `recordDisplayValueAt`: the resolver `ObjectMap` uses for the same two slots
 * (objectui#10456, `ObjectMap.descriptionDisplay-10456.test.tsx`, whose shape
 * this file mirrors). An expanded lookup reads as its display name, a bare id
 * as itself, a number or a boolean as its string, and an empty value as no
 * line at all.
 *
 * The plain-string, number and bare-id arms are the controls. Each rendered as
 * text before the fix, so each must stay green when the fix is removed, while
 * the expanded arms go red.
 *
 * `./renderer` is deliberately NOT mocked: the text is read off the real
 * `TimelineRenderer` output, the surface a user sees. Harness as in
 * `ObjectTimeline.metaFieldsRetired-10222.test.tsx`, plus an error boundary so
 * the unfixed crash reads as the React error itself rather than a timeout.
 */
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectTimeline } from './ObjectTimeline';

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
  };
});

afterEach(() => cleanup());

/** Catches a render error so an arm can assert on it by name. */
class RenderErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  render() {
    return this.state.message !== null
      ? <div data-testid="render-error">{this.state.message}</div>
      : this.props.children;
  }
}

const OBJECT = 'task';

/** `account` is the lookup under test; `subject` is an ordinary text field. */
const FIELDS = {
  subject: { type: 'text' },
  starts_at: { type: 'datetime' },
  account: { type: 'lookup', reference: 'account' },
};

/** An expanded lookup, as a server `$expand` returns the related record. */
const ACME = { id: 'a1', name: 'Acme' };

/** One start date per row, ascending, so the rail's order is the rows' order. */
const DATES = ['2026-01-01T09:00:00Z', '2026-01-02T09:00:00Z', '2026-01-03T09:00:00Z'];

type Row = { subject?: unknown; account?: unknown };

function rows(values: Row[]) {
  return values.map((v, i) => ({ id: `t${i + 1}`, starts_at: DATES[i], ...v }));
}

/**
 * A server double that expands `account` only when the query asks for it, and
 * otherwise answers the bare foreign key. So the display name can reach the
 * rail only through the component's own `$expand`.
 */
function makeDataSource(values: Row[]) {
  return {
    find: vi.fn(async (_object: string, params?: { $expand?: string[] }) => {
      const expand = params?.$expand ?? [];
      return {
        data: rows(values).map((r) => {
          const account = r.account as { id?: unknown } | undefined;
          return expand.includes('account') || account == null || typeof account !== 'object'
            ? r
            : { ...r, account: account.id };
        }),
      };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS })),
  };
}

function mount(props: Record<string, unknown>) {
  render(
    <RenderErrorBoundary>
      <ObjectTimeline {...(props as unknown as React.ComponentProps<typeof ObjectTimeline>)} />
    </RenderErrorBoundary>,
  );
}

/** Wait until every row drew its date, or the rail threw. */
async function settled(count: number) {
  await waitFor(() => {
    if (screen.queryByTestId('render-error')) return;
    expect(document.querySelectorAll('[data-testid="timeline-canvas"] time')).toHaveLength(count);
  });
}

function renderError(): string | null {
  return screen.queryByTestId('render-error')?.textContent ?? null;
}

/** The title lines (`TimelineTitle` is an `h3`), in rail order. */
function titles(): Array<string | null> {
  return Array.from(document.querySelectorAll('[data-testid="timeline-canvas"] h3')).map((el) => el.textContent);
}

/** The description lines (`TimelineDescription` is a `p`), in rail order. */
function descriptions(): Array<string | null> {
  return Array.from(document.querySelectorAll('[data-testid="timeline-canvas"] p')).map((el) => el.textContent);
}

/** The `$expand` the settled query actually asked the server for. */
function lastExpand(dataSource: ReturnType<typeof makeDataSource>): string[] {
  const calls = dataSource.find.mock.calls;
  return calls[calls.length - 1]?.[1]?.$expand ?? [];
}

/** Mount over the component's own object fetch. */
async function mountFetched(schema: Record<string, unknown>, values: Row[]) {
  const dataSource = makeDataSource(values);
  mount({ schema: { type: 'object-timeline', objectName: OBJECT, ...schema }, dataSource });
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  await settled(values.length);
  return dataSource;
}

/** Mount over inline rows, which never fetch. */
async function mountInline(schema: Record<string, unknown>, values: Row[]) {
  mount({ schema: { type: 'object-timeline', ...schema }, data: rows(values) });
  await settled(values.length);
}

/** The spec block: `startDateField` and `titleField` are required there. */
const TITLE_IS_SUBJECT = { timeline: { startDateField: 'starts_at', titleField: 'subject' } };
const DESCRIPTION_IS_ACCOUNT = { ...TITLE_IS_SUBJECT, descriptionField: 'account' };
const TITLE_IS_ACCOUNT = { timeline: { startDateField: 'starts_at', titleField: 'account' } };

describe('timeline titles and descriptions render as a display string (objectui#10530)', () => {
  // ── THE CARD'S DEFECT, ON ITS REACH PATH ──────────────────────────────────
  // No host rows, only `ObjectTimeline`'s own object fetch. The `$expand`
  // assertion proves the lookup really is requested expanded on this path, and
  // the double answers the bare id otherwise, so `Acme` can only arrive that way.
  it("the reach path: the timeline's own fetch expands a lookup-typed description, and the rail shows its name", async () => {
    const dataSource = await mountFetched(DESCRIPTION_IS_ACCOUNT, [{ subject: 'Ship it', account: ACME }]);

    expect(lastExpand(dataSource)).toContain('account');
    expect(renderError(), 'the rail must render, not throw').toBeNull();
    expect(titles()).toEqual(['Ship it']);
    expect(descriptions()).toEqual(['Acme']);
  });

  it("the reach path: the timeline's own fetch expands a lookup-typed title, and the rail shows its name", async () => {
    const dataSource = await mountFetched(TITLE_IS_ACCOUNT, [{ account: ACME }]);

    expect(lastExpand(dataSource)).toContain('account');
    expect(renderError(), 'the rail must render, not throw').toBeNull();
    expect(titles()).toEqual(['Acme']);
  });

  // ── THE CONTROLS ──────────────────────────────────────────────────────────
  // A plain string, a number and an unexpanded lookup (its id, a plain string)
  // each rendered as text before the fix and must render the same after it.
  it('a plain string, a number and a bare id render as text in the description', async () => {
    await mountInline(DESCRIPTION_IS_ACCOUNT, [
      { subject: 'One', account: 'Call back Tuesday' },
      { subject: 'Two', account: 42 },
      { subject: 'Three', account: 'a1' },
    ]);

    expect(renderError()).toBeNull();
    expect(titles()).toEqual(['One', 'Two', 'Three']);
    expect(descriptions()).toEqual(['Call back Tuesday', '42', 'a1']);
  });

  it('a plain string, a number and a bare id render as text in the title', async () => {
    await mountInline(TITLE_IS_ACCOUNT, [{ account: 'Ship it' }, { account: 42 }, { account: 'a1' }]);

    expect(renderError()).toBeNull();
    expect(titles()).toEqual(['Ship it', '42', 'a1']);
  });

  // ── THE RESOLVER'S DEFINITIONS ────────────────────────────────────────────
  // "No value": an expanded record none of whose keys is a display name (a bare
  // `{ id }` payload is not a name), and a whitespace-only string. Each renders
  // no line, and neither throws; the row itself still renders by its date. The
  // same trim is why a padded string renders without its surrounding spaces.
  it('an expanded record with no display name, and a blank value, render no line', async () => {
    await mountInline(DESCRIPTION_IS_ACCOUNT, [
      { subject: 'One', account: { id: 'a1' } },
      { subject: 'Two', account: '   ' },
      { subject: 'Three', account: '  Padded  ' },
    ]);

    expect(renderError()).toBeNull();
    expect(titles()).toEqual(['One', 'Two', 'Three']);
    expect(descriptions()).toEqual(['Padded']);
  });

  // A zero and a boolean are values, not blanks, so each renders as its string
  // inside its own line. The renderer's `description && …` gate used to paint a
  // bare `0` beside the description element, drop `false`, and draw an empty
  // line for `true`.
  it('a zero or a boolean renders as its string, inside its line', async () => {
    await mountInline(DESCRIPTION_IS_ACCOUNT, [
      { subject: 'One', account: 0 },
      { subject: 'Two', account: false },
      { subject: 'Three', account: true },
    ]);

    expect(renderError()).toBeNull();
    expect(descriptions()).toEqual(['0', 'false', 'true']);
  });
});
