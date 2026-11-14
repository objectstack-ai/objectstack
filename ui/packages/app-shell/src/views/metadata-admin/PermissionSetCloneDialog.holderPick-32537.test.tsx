// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32537 — the clone door of a permission set whose name more than
 * one package holds (`POST /security/permission-sets/:name/clone?package=PKG`,
 * ADR-0150 D3/D5). Pinned through the dialog:
 *
 *  - CONTROL: a host that names no package sends the name alone, as before;
 *  - a host that holds the source's package names it as `?package=`, with the
 *    body still exactly `{ name, label }`;
 *  - a `409` naming the holders is shown as a pick in the server's words: one
 *    button per holder, nothing sent until the administrator chooses, and the
 *    choice sends the request again for that holder (the environment's own
 *    set by the name alone);
 *  - a refusal of any other kind is the server's sentence, with no pick.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PermissionSetCloneDialog } from './PermissionSetCloneDialog';

interface Call {
  url: string;
  body?: string;
}

const REFUSAL = 'Permission set "sales_rep" is held by more than one package; name one with ?package=.';
const CANDIDATES = [
  { kind: 'package', packageId: 'com.acme.crm' },
  { kind: 'package', packageId: 'com.acme.sales' },
  { kind: 'environment' },
];
const CLONED = { success: true, data: { permissionSet: { name: 'my_rep' }, package: null, notice: 'Saved.' } };

/** Stub `fetch` with the answers in order; returns the calls it saw. */
function stubFetch(...answers: Array<{ status: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string | undefined });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDialog(sourcePackage?: string) {
  const onCloned = vi.fn();
  render(
    <PermissionSetCloneDialog
      source="sales_rep"
      sourcePackage={sourcePackage}
      locale="en-US"
      onClose={() => {}}
      onCloned={onCloned}
    />,
  );
  fireEvent.change(screen.getByLabelText('New machine name'), { target: { value: 'my_rep' } });
  fireEvent.change(screen.getByLabelText('New label'), { target: { value: 'My rep' } });
  return { onCloned, submit: () => fireEvent.click(screen.getByRole('button', { name: /Create copy/i })) };
}

const DOOR = '/api/v1/security/permission-sets/sales_rep/clone';
const BODY = '{"name":"my_rep","label":"My rep"}';

describe('PermissionSetCloneDialog — the holder of a name more than one package holds (objectstack#32537)', () => {
  it('CONTROL: a host that names no package sends the name alone', async () => {
    const calls = stubFetch({ status: 200, body: CLONED });
    const { onCloned, submit } = renderDialog();
    submit();
    await waitFor(() => expect(onCloned).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ url: DOOR, body: BODY }]);
  });

  it("names the package the host holds as ?package=, with the body unchanged", async () => {
    const calls = stubFetch({ status: 200, body: CLONED });
    const { onCloned, submit } = renderDialog('com.acme.sales');
    submit();
    await waitFor(() => expect(onCloned).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ url: `${DOOR}?package=com.acme.sales`, body: BODY }]);
  });

  it('shows a 409 naming the holders as a pick, sends nothing until one is chosen, then sends it for that holder', async () => {
    const calls = stubFetch(
      { status: 409, body: { success: false, error: { code: 'RESOURCE_CONFLICT', message: REFUSAL, details: { candidates: CANDIDATES } } } },
      { status: 200, body: CLONED },
    );
    const { onCloned, submit } = renderDialog();
    submit();
    const pick = await screen.findByTestId('perm-holder-pick');
    expect(pick.textContent).toContain(REFUSAL);
    expect(screen.getByTestId('perm-holder-pick-com.acme.crm').textContent).toBe('Package com.acme.crm');
    expect(screen.getByTestId('perm-holder-pick-com.acme.sales').textContent).toBe('Package com.acme.sales');
    expect(screen.getByTestId('perm-holder-pick-environment')).toBeTruthy();
    // ⛔ Nothing is chosen for the administrator: one request, no retry.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(onCloned).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('perm-holder-pick-com.acme.sales'));
    await waitFor(() => expect(onCloned).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      { url: DOOR, body: BODY },
      { url: `${DOOR}?package=com.acme.sales`, body: BODY },
    ]);
  });

  it("the environment's own set is chosen by the name alone", async () => {
    const calls = stubFetch(
      { status: 409, body: { success: false, error: { code: 'RESOURCE_CONFLICT', message: REFUSAL, details: { candidates: CANDIDATES } } } },
      { status: 200, body: CLONED },
    );
    const { onCloned, submit } = renderDialog('com.gone');
    submit();
    fireEvent.click(await screen.findByTestId('perm-holder-pick-environment'));
    await waitFor(() => expect(onCloned).toHaveBeenCalledTimes(1));
    expect(calls.map((c) => c.url)).toEqual([`${DOOR}?package=com.gone`, DOOR]);
  });

  it('a refusal that names no holder is the server sentence alone, with no pick', async () => {
    const said = "Permission set 'my_rep' already exists — a clone must take a NEW machine name.";
    stubFetch({ status: 409, body: { success: false, error: { code: 'RESOURCE_CONFLICT', message: said } } });
    const { submit } = renderDialog();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe(said);
    expect(screen.queryByTestId('perm-holder-pick')).toBeNull();
  });
});
