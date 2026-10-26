/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#4989 **defect 4 — mount-blindness — is fixed here**, by the
 * mechanism the maintainer ruled on 2026-08-17: an OPTIONAL INJECTED
 * navigation seam (`HostNavigationContext`, `@object-ui/react`).
 *
 * This file REPLACES `submitRedirect.mountBlind.test.tsx`, which pinned the
 * same defect from the other side while it was open. That file's own docblock
 * asked for exactly this: "when defect 4 is decided and implemented, this file
 * is expected to be REPLACED (not merely re-spelled) by one asserting the mount
 * is applied". Its measurement is not discarded — the origin-root resolution it
 * recorded is still the behaviour of a host that supplies no seam, and that is
 * pinned below as a supported state rather than a defect, because a host with
 * no router has no basename for a renderer to miss.
 *
 * ## What each half of the seam is worth asserting
 *
 * With a seam, the destination must reach the HOST — this package must stop
 * resolving it itself. What the host then does with the path is the host's
 * (React Router applies the basename; that leg is pinned for real, against a
 * real `<MemoryRouter basename>`, in
 * `packages/app-shell/src/console/HostNavigationBridge.test.tsx`). So the
 * assertions here are: which function receives the path, that it is the
 * RESOLVED path (interpolated + escaped, not the authored string), and that
 * every property the redirect already had — the contract verdict, the declared
 * delay, the unmount cancel — is unchanged by injecting one.
 *
 * The mount-application test below therefore uses a STUB host navigate that
 * joins a mount, and says so: it demonstrates the seam's consequence at this
 * layer (the renderer hands over a path a host can still place), not React
 * Router's behaviour, which is not this package's to prove.
 *
 * ## Reverse verification — predicted first, then measured (counts are measured)
 *
 * 1. **Ablating the seam** — `useSubmitRedirectNavigation` ignores the injected
 *    navigate and always calls `window.location.assign` (i.e. the pre-ruling
 *    body): **exactly the 5 tests that assert a host navigate RECEIVED the
 *    destination go red** (4 here on `ObjectForm`, 1 on `WizardForm`), and the
 *    other 7 stay green. The survivors are worth naming, because two of them
 *    are NOT change detectors for this mutation and pretending otherwise would
 *    overstate the file: the 2 absent-seam tests and the 2 refusal tests SHOULD
 *    survive (they describe behaviour that was already correct), while the
 *    declared-delay and unmount-cancel tests survive because they assert that
 *    NOTHING was called — true under both bodies. They are kept for the
 *    properties they pin (a seam must not shorten the pause or outlive the
 *    component), not as evidence the seam is wired.
 *
 *    Measured alongside: `ObjectForm.submitRedirect.test.tsx` and
 *    `WizardForm.submitRedirect.test.tsx` stay **entirely green** under this
 *    mutation — they mount no provider, so the seam is invisible to them. That
 *    is precisely why this file exists rather than more cases there.
 * 2. **Deleting the `HostNavigationBridge` line from `ConsoleShell`** (the
 *    supply side): nothing in this package moves — 0 red — because a renderer
 *    cannot see whether any host supplies the seam. `ConsoleShell.hostNavigation
 *    .test.tsx` in `@object-ui/app-shell` is what goes red, and it was written
 *    for this reason: measured before it existed, that deletion restored the
 *    whole mount-blind behaviour with every test in the repository still green.
 * 3. **Dropping `encodeURIComponent` from `submitRedirect.ts`**: `hands over the
 *    RESOLVED path` goes red here, on top of the counts the two component files
 *    already record — the seam carries the resolved value, so the escape is
 *    observable through it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import React from 'react';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: { ...actual.toast, success: toastSuccess, error: toastError } };
});

import { HostNavigationProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { WizardForm } from './WizardForm';

registerAllFields();

/** The mount the framework CLI configures for an embedded deployment. */
const MOUNT = '/_console';

const objectSchema = {
  name: 'o',
  fields: { name: { type: 'text', label: 'Name' } },
};

/** `create` answers the written record — the token scope, id included. */
const makeDS = (created: Record<string, unknown> = {}) => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn(async (_o: string, d: any) => ({ id: 'r1', ...d, ...created })),
  update: vi.fn(),
  findOne: vi.fn(),
});

const waitInput = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

interface SubmitOptions {
  /** The host's navigate, or `undefined` for a host that wires no seam. */
  navigate?: (to: string, options?: { replace?: boolean }) => void;
  delayMs?: number;
  typed?: string;
  wizard?: boolean;
}

/**
 * Render one form with a declared `redirect` behaviour, fill it and submit.
 *
 * The two components are driven through one helper on purpose: the seam is
 * consumed by both through the same hook, and the whole risk this file guards
 * is that one of them stops doing so.
 */
async function submitWith(url: string, ds: ReturnType<typeof makeDS>, opts: SubmitOptions = {}) {
  const { navigate, delayMs, typed = 'Alpha', wizard = false } = opts;
  const schema = {
    type: 'object-form',
    objectName: 'o',
    mode: 'create',
    ...(wizard ? { formType: 'wizard', sections: [{ label: 'A', fields: ['name'] }] } : {}),
    submitBehavior: { kind: 'redirect', url, ...(delayMs === undefined ? {} : { delayMs }) },
  } as any;
  const form = wizard
    ? <WizardForm schema={schema} dataSource={ds as any} />
    : <ObjectForm schema={schema} dataSource={ds as any} />;

  const view = render(
    // No provider at all in the absent-seam cases — the default context value is
    // what a router-less host actually sees, and mounting a provider carrying
    // `navigate: undefined` would test a different (and easier) thing.
    navigate ? <HostNavigationProvider value={{ navigate }}>{form}</HostNavigationProvider> : form,
  );
  fireEvent.change(await waitInput(view.container, 'name'), { target: { value: typed } });
  fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  return view;
}

let assign: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
  assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
});

afterEach(() => {
  assign.mockRestore();
});

describe('ObjectForm redirect — with an injected host navigate (defect 4)', () => {
  it('hands the destination to the host instead of navigating the browser', async () => {
    const navigate = vi.fn();
    await submitWith('/thanks', makeDS(), { navigate });

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/thanks'));
    // The whole defect: `window.location.assign('/thanks')` resolves against the
    // ORIGIN root, so under a mounted host it left the app. It must not happen
    // at all when a host offered to place the path itself.
    expect(assign).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('hands over the RESOLVED path — interpolated and escaped, not the authored string', async () => {
    const navigate = vi.fn();
    await submitWith('/t/{{record.slug}}?ref={{record.id}}', makeDS({ slug: 'a/b c' }), { navigate });

    // Same value `submitRedirect.ts` produces for the no-seam path: a token is a
    // VALUE in the path, so the slash and the space stay inside one segment.
    // Injection changes WHO travels, never WHAT to.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/t/a%2Fb%20c?ref=r1'));
    expect(assign).not.toHaveBeenCalled();
  });

  it('lets a mounted host place the destination inside its mount', async () => {
    // A STUB host navigate that joins its mount, standing in for a router with a
    // basename — this asserts the seam's consequence (the renderer hands over a
    // path that is still placeable), not React Router's behaviour, which is
    // pinned against a real router in the app-shell bridge's own test.
    const visited: string[] = [];
    const navigate = (to: string) => visited.push(new URL(`.${to}`, `https://h${MOUNT}/`).pathname);

    await submitWith('/thanks', makeDS(), { navigate });

    await waitFor(() => expect(visited).toEqual([`${MOUNT}/thanks`]));
    // The counterfactual the replaced `submitRedirect.mountBlind.test.tsx`
    // measured: the same string through a browser-level navigation resolves at
    // the origin root and leaves the app.
    expect(new URL('/thanks', `https://h${MOUNT}/`).pathname).toBe('/thanks');
  });

  it('does not let the seam launder a destination the contract refuses', async () => {
    const navigate = vi.fn();
    // A same-origin ABSOLUTE url: refused at the authoring door (objectstack#7496),
    // and an injected host navigate is not a way around that. The verdict is taken
    // before anything reaches the seam, by design.
    const ds = makeDS();
    await submitWith(`${window.location.origin}/thanks`, ds, { navigate });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(navigate).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();

    // …and the refusal still reaches the submitter (defect 2 stays fixed).
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('RELATIVE path only');
    expect(ds.create).toHaveBeenCalledTimes(1);
  });

  it("still honours the declared delay — the wait is the component's, seam or not", async () => {
    const navigate = vi.fn();
    // Real timers, for the reason `ObjectForm.submitRedirect.test.tsx` records:
    // the submit path is a chain of awaited promises, so faking timers around it
    // makes the pre-delay observation race the resolution instead of the delay.
    await submitWith('/thanks', makeDS(), { navigate, delayMs: 10_000 });
    expect(navigate).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('cancels on unmount — a host navigate must not fire into a form that is gone', async () => {
    const navigate = vi.fn();
    const view = await submitWith('/thanks', makeDS(), { navigate, delayMs: 60 });
    view.unmount();
    await new Promise((r) => setTimeout(r, 150));
    // objectui#5033's property, restated for the injected path: an SPA
    // transition yanking a submitter who has moved on is worse than a full page
    // load doing it, not better.
    expect(navigate).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('uses the LATEST injected navigate, exactly once, when the host rebuilds it', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const ds = makeDS();
    const schema = {
      type: 'object-form', objectName: 'o', mode: 'create',
      submitBehavior: { kind: 'redirect', url: '/thanks', delayMs: 40 },
    } as any;
    const tree = (navigate: (to: string) => void) => (
      <HostNavigationProvider value={{ navigate }}>
        <ObjectForm schema={schema} dataSource={ds as any} />
      </HostNavigationProvider>
    );

    const view = render(tree(first));
    fireEvent.change(await waitInput(view.container, 'name'), { target: { value: 'Alpha' } });
    fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));

    // An inline arrow in a host's JSX is a NEW function every render, which is
    // the ordinary shape. Re-rendering mid-wait must not lose the navigation and
    // must not duplicate it.
    view.rerender(tree(second));

    await waitFor(() => expect(second).toHaveBeenCalledWith('/thanks'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('ObjectForm redirect — with NO seam, behaviour is byte-for-byte what it was', () => {
  it('navigates the browser to the resolved path', async () => {
    await submitWith('/apps/x/done', makeDS());
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apps/x/done'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('resolves against the origin root — correct for a host with no router', async () => {
    await submitWith('/thanks', makeDS());
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/thanks'));
    // The measurement the replaced mount-blindness file carried, with its
    // direction flipped from defect to supported state: no router means no
    // basename, so the origin root IS the app root and this is right. What used
    // to be wrong was that a MOUNTED host got the same treatment and had no way
    // to say otherwise — which is what the seam gives it.
    expect(new URL(String(vi.mocked(assign).mock.calls[0][0]), 'https://h/').pathname)
      .toBe('/thanks');
  });
});

describe('WizardForm redirect — the same seam, through the same hook', () => {
  it('hands the destination to an injected host navigate', async () => {
    const navigate = vi.fn();
    await submitWith('/thanks?ref={{record.id}}', makeDS(), { navigate, wizard: true });

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/thanks?ref=r1'));
    expect(assign).not.toHaveBeenCalled();
  });

  it('falls back to the browser navigation with no seam', async () => {
    await submitWith('/apps/x/done', makeDS(), { wizard: true });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apps/x/done'));
  });

  it('refuses an out-of-contract destination without reaching the seam', async () => {
    const navigate = vi.fn();
    await submitWith('//example.com/thanks', makeDS(), { navigate, wizard: true });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('protocol-relative');
    expect(navigate).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
