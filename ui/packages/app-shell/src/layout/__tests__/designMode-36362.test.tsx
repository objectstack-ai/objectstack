// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shell's design mode (objectstack#36362): the mode and its bar, and the
 * extension point other surfaces stage their changes through.
 *
 * - The bar holds 「Design layout」, 「Cancel」 and 「Save」 and nothing else;
 *   「Save」 is off while nothing is staged.
 * - 「Save」 commits every staged change in the order first staged, then
 *   leaves the mode; a failed commit stops there, keeps it and every later
 *   one staged, keeps the mode on and says why.
 * - 「Cancel」 drops every staged change, commits nothing, and leaves.
 * - Another app turns the mode off; so does a phone (`enabled: false`), while
 *   keeping what is staged.
 * - While something is staged, a tab close is held, and a link out of the app
 *   asks; a link to another page of the app does not.
 *
 * Real subjects: `useDesignModeController`, `DesignModeProvider`,
 * `useDesignModeChange`, `DesignModeBar`; `sonner`'s toast is spied.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { error: toastError, success: vi.fn() },
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) => String(o?.[name] ?? '')),
    language: 'en',
  }),
}));

import {
  DesignModeProvider,
  isPageOfApp,
  useDesignMode,
  useDesignModeActive,
  useDesignModeChange,
  useDesignModeController,
  useHoldDesignModeOut,
} from '../designMode';
import { DesignModeBar } from '../DesignModeBar';

/** The shell's hold on the mode, with the bar drawn while it is on, and the probes below it. */
function Shell({ app = 'crm', enabled = true, children }: { app?: string; enabled?: boolean; children?: React.ReactNode }) {
  const mode = useDesignModeController({ appName: app, appBasePath: `/apps/${app}`, enabled });
  return (
    <DesignModeProvider value={mode}>
      {mode.active && <DesignModeBar mode={mode} />}
      {children}
    </DesignModeProvider>
  );
}

function EnterButton() {
  const mode = useDesignMode();
  return (
    <button type="button" onClick={mode?.enter}>
      enter
    </button>
  );
}

/** A surface that stages one change under `name` when its button is pressed. */
function Stager({ name, commit }: { name: string; commit: (value: string) => Promise<void> }) {
  const change = useDesignModeChange<string>(name);
  return (
    <div>
      <output data-testid={`staged-${name}`}>{change.value ?? ''}</output>
      <button type="button" onClick={() => change.stage(`${name}-value`, commit)}>
        stage {name}
      </button>
    </div>
  );
}

const bar = () => screen.queryByTestId('design-mode-bar');
const save = () => screen.getByTestId('design-mode-save');
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function stubConfirm() {
  const spy = vi.fn((_message?: string): boolean => false);
  vi.stubGlobal('confirm', spy);
  return spy;
}

beforeEach(() => {
  toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the bar (objectstack#36362)', () => {
  it('holds 「Design layout」, 「Cancel」 and 「Save」, and nothing else', () => {
    render(<Shell><EnterButton /></Shell>);
    expect(bar()).toBeNull();
    fireEvent.click(screen.getByText('enter'));

    const region = screen.getByRole('region', { name: 'Design layout' });
    expect(region).toHaveTextContent(/^Design layoutCancelSave$/);
    expect(within(region).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Save']);
    expect(within(region).queryAllByRole('link')).toEqual([]);
  });

  it('「Save」 is off while nothing is staged, on once something is', () => {
    render(<Shell><EnterButton /><Stager name="menu" commit={async () => {}} /></Shell>);
    fireEvent.click(screen.getByText('enter'));
    expect(save()).toBeDisabled();
    fireEvent.click(screen.getByText('stage menu'));
    expect(save()).toBeEnabled();
  });

  it('「Cancel」 leaves the mode', () => {
    render(<Shell><EnterButton /></Shell>);
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByTestId('design-mode-cancel'));
    expect(bar()).toBeNull();
  });
});

describe('saving and dropping what is staged (objectstack#36362)', () => {
  it('「Save」 commits every staged change in the order first staged, then leaves the mode', async () => {
    const order: string[] = [];
    const commit = (value: string) => {
      order.push(value);
      return Promise.resolve();
    };
    render(
      <Shell>
        <EnterButton />
        <Stager name="menu" commit={commit} />
        <Stager name="header" commit={commit} />
      </Shell>,
    );
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('stage menu'));
    fireEvent.click(screen.getByText('stage header'));
    fireEvent.click(screen.getByText('stage menu'));
    expect(screen.getByTestId('staged-menu')).toHaveTextContent('menu-value');

    fireEvent.click(save());
    await flush();

    expect(order).toEqual(['menu-value', 'header-value']);
    expect(bar()).toBeNull();
    expect(screen.getByTestId('staged-menu')).toHaveTextContent('');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a failed commit stops the save: the ones before it are saved, it and the later ones stay, the mode stays on and says why', async () => {
    const header = vi.fn(async () => {});
    render(
      <Shell>
        <EnterButton />
        <Stager name="first" commit={async () => {}} />
        <Stager name="menu" commit={async () => { throw new Error('Package is read-only'); }} />
        <Stager name="header" commit={header} />
      </Shell>,
    );
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('stage first'));
    fireEvent.click(screen.getByText('stage menu'));
    fireEvent.click(screen.getByText('stage header'));

    fireEvent.click(save());
    await flush();

    expect(bar()).not.toBeNull();
    expect(screen.getByTestId('staged-first')).toHaveTextContent('');
    expect(screen.getByTestId('staged-menu')).toHaveTextContent('menu-value');
    expect(screen.getByTestId('staged-header')).toHaveTextContent('header-value');
    expect(header).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Some changes were not saved: Package is read-only');
    expect(save()).toBeEnabled();
  });

  it('「Cancel」 drops every staged change and commits none', () => {
    const commit = vi.fn(async () => {});
    render(<Shell><EnterButton /><Stager name="menu" commit={commit} /></Shell>);
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('stage menu'));
    fireEvent.click(screen.getByTestId('design-mode-cancel'));

    expect(bar()).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('enter'));
    expect(screen.getByTestId('staged-menu')).toHaveTextContent('');
    expect(save()).toBeDisabled();
  });

  it('outside the mode nothing can be staged', () => {
    render(<Shell><Stager name="menu" commit={async () => {}} /></Shell>);
    fireEvent.click(screen.getByText('stage menu'));
    expect(screen.getByTestId('staged-menu')).toHaveTextContent('');
  });
});

describe('where the mode holds (objectstack#36362)', () => {
  it('another app turns it off and drops what it held', () => {
    const view = render(<Shell app="crm"><EnterButton /><Stager name="menu" commit={async () => {}} /></Shell>);
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('stage menu'));
    view.rerender(<Shell app="hr"><EnterButton /><Stager name="menu" commit={async () => {}} /></Shell>);
    expect(bar()).toBeNull();
    view.rerender(<Shell app="crm"><EnterButton /><Stager name="menu" commit={async () => {}} /></Shell>);
    expect(bar()).toBeNull();
    expect(screen.getByTestId('staged-menu')).toHaveTextContent('');
  });

  it('a phone turns it off and keeps what is staged until the window is wide again', () => {
    const view = render(<Shell><EnterButton /><Stager name="menu" commit={async () => {}} /></Shell>);
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('stage menu'));
    view.rerender(<Shell enabled={false}><EnterButton /><Stager name="menu" commit={async () => {}} /></Shell>);
    expect(bar()).toBeNull();
    view.rerender(<Shell><EnterButton /><Stager name="menu" commit={async () => {}} /></Shell>);
    expect(bar()).not.toBeNull();
    expect(screen.getByTestId('staged-menu')).toHaveTextContent('menu-value');
  });
});

describe('leaving with something staged (objectstack#36362)', () => {
  function unloadHeld(): boolean {
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    return unload.defaultPrevented;
  }

  it('a tab close is held only while something is staged', () => {
    render(<Shell><EnterButton /><Stager name="menu" commit={async () => {}} /></Shell>);
    fireEvent.click(screen.getByText('enter'));
    expect(unloadHeld()).toBe(false);
    fireEvent.click(screen.getByText('stage menu'));
    expect(unloadHeld()).toBe(true);
    fireEvent.click(screen.getByTestId('design-mode-cancel'));
    expect(unloadHeld()).toBe(false);
  });

  it('a link to another page of the app asks nothing; a link out of it asks', () => {
    const confirmSpy = stubConfirm();
    window.history.replaceState(null, '', '/_console/apps/crm/crm_lead');
    render(<Shell><EnterButton /><Stager name="menu" commit={async () => {}} /></Shell>);
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('stage menu'));

    const inApp = document.createElement('a');
    inApp.href = '/_console/apps/crm/dashboard/sales';
    const home = document.createElement('a');
    home.href = '/_console/home';
    document.body.append(inApp, home);
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener('click', stop);
    try {
      inApp.click();
      expect(confirmSpy).not.toHaveBeenCalled();
      home.click();
      expect(confirmSpy).toHaveBeenCalledWith('Leave Design layout? Your unsaved changes will be lost.');
    } finally {
      window.removeEventListener('click', stop);
      inApp.remove();
      home.remove();
    }
  });
});

describe('isPageOfApp (objectstack#36362)', () => {
  const at = (path: string) => new URL(path, 'http://localhost');
  it('reads the app prefix off the address on screen, basename included', () => {
    expect(isPageOfApp(at('/_console/apps/crm/x'), '/apps/crm', '/_console/apps/crm/y')).toBe(true);
    expect(isPageOfApp(at('/_console/apps/crm'), '/apps/crm', '/_console/apps/crm/y')).toBe(true);
    expect(isPageOfApp(at('/_console/apps/crm_other/x'), '/apps/crm', '/_console/apps/crm/y')).toBe(false);
    expect(isPageOfApp(at('/_console/apps/hr/x'), '/apps/crm', '/_console/apps/crm/y')).toBe(false);
    expect(isPageOfApp(at('/apps/crm/x'), '/apps/crm', '/home')).toBe(true);
  });
});

/** objectstack#36364 — a surface that stages `value` under `name` and saves at once. */
function SaverWith({ name, value, commit }: { name: string; value: string; commit: (value: string) => Promise<void> }) {
  const change = useDesignModeChange<string>(name);
  const [result, setResult] = React.useState('');
  return (
    <div>
      <button type="button" onClick={() => void change.saveWith(value, commit).then((ok) => setResult(String(ok)))}>
        save {name} with {value}
      </button>
      <output data-testid={`saved-with-${name}`}>{result}</output>
    </div>
  );
}

describe('staging a change and saving at once (objectstack#36364)', () => {
  it('commits every staged change with the new one in its key’s place, in the order first staged, then leaves the mode', async () => {
    const order: string[] = [];
    const commit = (value: string) => {
      order.push(value);
      return Promise.resolve();
    };
    render(
      <Shell>
        <EnterButton />
        <Stager name="menu" commit={commit} />
        <Stager name="header" commit={commit} />
        <SaverWith name="menu" value="menu-with-dashboard" commit={commit} />
      </Shell>,
    );
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('stage menu'));
    fireEvent.click(screen.getByText('stage header'));
    fireEvent.click(screen.getByText('save menu with menu-with-dashboard'));
    await flush();
    expect(order).toEqual(['menu-with-dashboard', 'header-value']);
    expect(screen.getByTestId('saved-with-menu')).toHaveTextContent('true');
    expect(bar()).toBeNull();
  });

  it('a failed commit of the new change leaves what its key held before staged, and the new change gone', async () => {
    const order: string[] = [];
    render(
      <Shell>
        <EnterButton />
        <Stager name="menu" commit={async (value) => void order.push(value)} />
        <SaverWith name="menu" value="menu-with-dashboard" commit={async () => Promise.reject(new Error('menu refused'))} />
      </Shell>,
    );
    fireEvent.click(screen.getByText('enter'));
    fireEvent.click(screen.getByText('stage menu'));
    fireEvent.click(screen.getByText('save menu with menu-with-dashboard'));
    await flush();
    expect(screen.getByTestId('saved-with-menu')).toHaveTextContent('false');
    expect(toastError).toHaveBeenCalledWith('Some changes were not saved: menu refused');
    expect(bar()).not.toBeNull();
    expect(screen.getByTestId('staged-menu')).toHaveTextContent('menu-value');
    // 「Save」 now commits what was staged before, never the refused change.
    fireEvent.click(save());
    await flush();
    expect(order).toEqual(['menu-value']);
  });

  it('outside a shell that holds the mode, nothing is written', async () => {
    const commit = vi.fn(async () => {});
    render(<SaverWith name="menu" value="x" commit={commit} />);
    fireEvent.click(screen.getByText('save menu with x'));
    await flush();
    expect(screen.getByTestId('saved-with-menu')).toHaveTextContent('false');
    expect(commit).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#36692 — a dashboard's or a report's own editor and the mode
 * exclude each other through one hold: an open editor holds the mode out, so
 * `enter` refuses and says why; the mode on, `useDesignModeActive` is what an
 * editor reads to not offer its Edit.
 */
describe('an editor of its own holds the mode out (objectstack#36692)', () => {
  /** An editor that holds the mode out while it is open, and says whether it may be offered. */
  function Editor({ name }: { name: string }) {
    const [open, setOpen] = React.useState(false);
    useHoldDesignModeOut(open);
    const offered = !useDesignModeActive();
    return (
      <div>
        <output data-testid={`offered-${name}`}>{offered ? 'yes' : 'no'}</output>
        <button type="button" onClick={() => setOpen((o) => !o)}>
          toggle {name}
        </button>
      </div>
    );
  }

  /** The door, with what `enter` answered. */
  function Door() {
    const mode = useDesignMode();
    const [answer, setAnswer] = React.useState('');
    return (
      <button type="button" onClick={() => setAnswer(String(mode?.enter()))}>
        door {answer}
      </button>
    );
  }

  const PROMPT = 'Save or cancel your dashboard or report changes before designing the layout.';

  it('while an editor is open, entering refuses with the prompt and the mode stays off', () => {
    render(<Shell><Door /><Editor name="dashboard" /></Shell>);
    fireEvent.click(screen.getByText('toggle dashboard'));
    fireEvent.click(screen.getByText(/^door/));
    expect(screen.getByText(/^door/)).toHaveTextContent('door false');
    expect(bar()).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(PROMPT);
  });

  it('the hold is let go when the editor closes: entering works again', () => {
    render(<Shell><Door /><Editor name="dashboard" /></Shell>);
    fireEvent.click(screen.getByText('toggle dashboard'));
    fireEvent.click(screen.getByText('toggle dashboard'));
    fireEvent.click(screen.getByText(/^door/));
    expect(screen.getByText(/^door/)).toHaveTextContent('door true');
    expect(bar()).not.toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('two editors hold it out until both close', () => {
    render(<Shell><Door /><Editor name="dashboard" /><Editor name="report" /></Shell>);
    fireEvent.click(screen.getByText('toggle dashboard'));
    fireEvent.click(screen.getByText('toggle report'));
    fireEvent.click(screen.getByText('toggle dashboard'));
    fireEvent.click(screen.getByText(/^door/));
    expect(bar()).toBeNull();
    fireEvent.click(screen.getByText('toggle report'));
    fireEvent.click(screen.getByText(/^door/));
    expect(bar()).not.toBeNull();
  });

  it('an editor unmounted while open lets go too', () => {
    function Page() {
      const [shown, setShown] = React.useState(true);
      return (
        <>
          {shown && <Editor name="report" />}
          <button type="button" onClick={() => setShown(false)}>leave page</button>
        </>
      );
    }
    render(<Shell><Door /><Page /></Shell>);
    fireEvent.click(screen.getByText('toggle report'));
    fireEvent.click(screen.getByText('leave page'));
    fireEvent.click(screen.getByText(/^door/));
    expect(bar()).not.toBeNull();
  });

  it('while the mode is on, an editor reads that it is not offered; outside a shell it always is', () => {
    render(<Shell><Door /><Editor name="dashboard" /></Shell>);
    expect(screen.getByTestId('offered-dashboard')).toHaveTextContent('yes');
    fireEvent.click(screen.getByText(/^door/));
    expect(screen.getByTestId('offered-dashboard')).toHaveTextContent('no');
    fireEvent.click(screen.getByTestId('design-mode-cancel'));
    expect(screen.getByTestId('offered-dashboard')).toHaveTextContent('yes');
    cleanup();
    render(<Editor name="bare" />);
    fireEvent.click(screen.getByText('toggle bare'));
    expect(screen.getByTestId('offered-bare')).toHaveTextContent('yes');
  });
});
