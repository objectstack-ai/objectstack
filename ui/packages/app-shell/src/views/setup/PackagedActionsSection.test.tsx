// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup › Packaged automation, the packaged-ACTIONS section (ADR-0126 §8
 * item 2, amendment ruling 3) — behaviour.
 *
 * Five properties, in the order the section exercises them:
 *
 *   1. **state render** — a packaged action is ON unless the ledger says
 *      otherwise, and absence of a row is the ordinary stock-boot state rather
 *      than a missing fact. The scoping and ledger rules themselves live in
 *      `packagedActions.ts` and are measured directly in `packagedActions.test.ts`;
 *      what is checked here is that the rendered section applies them.
 *   2. **round-trip** — flipping the switch calls the L6 activation door with
 *      the requested state, at the `<object>/<action>` path, with EXACTLY the
 *      one key the body declares — and the shown state follows the SERVER's
 *      answer, not the click.
 *   3. **refusals, verbatim** — the three shapes this section must relay: the
 *      §5 operator gate (403 `PERMISSION_DENIED`), the ambiguous-name refusal
 *      (409 `RESOURCE_CONFLICT`, which NAMES the objects) and the no-ledger
 *      outage (503 `SERVICE_UNAVAILABLE`). Each is asserted as the exact
 *      server string; all three are transcribed character-for-character from
 *      the runtime's own message builders, and what is under test is that the
 *      section renders what it was sent, unedited.
 *   4. **no clone** — ruling 3 charters the switch and nothing else, so the
 *      section offers no clone control at all. The flows section beside it
 *      keeps its own; this asserts the ABSENCE here, which is the half a
 *      "make the two sections consistent" change would quietly undo.
 *   5. **no ancestry** — the withdrawn §9 shapes are absent, including when a
 *      response carries one. Pinning the rule at the RENDERER and not only at
 *      the wire is the point: a response field is the cheapest place for
 *      ancestry to reappear.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { PackagedActionsSection } from './PackagedActionsSection';

/* -------------------------------------------------------------------------- */
/* The server's own refusal strings                                            */
/* -------------------------------------------------------------------------- */

/**
 * `refuseUngrantedActivationWrite` with `ACTION_ACTIVATION_SUBJECT`
 * (`@objectstack/runtime`, `domains/activation-gate.ts`) for the `group`
 * posture. Transcribed exactly: the clause naming the posture AND the one
 * naming the sanctioned path are both load-bearing.
 *
 * ⚠️ The remedy clause is the ACTION one, and it deliberately does not say
 * "clone": the gate carries a per-door remedy sentence precisely because
 * action-clone is unchartered, and recommending one would advertise machinery
 * that does not exist. A client that reworded this would put it back.
 */
const POSTURE_REFUSAL =
  'Enabling or disabling a packaged action writes an INSTALL-WIDE activation row, and this deployment runs ' +
  "the 'group' tenancy posture, where that reaches every organization. It requires the platform operator " +
  '(ADR-0126 §5) — an organization administrator cannot flip an install-wide switch. To switch a packaged ' +
  'action off for this installation, ask your platform operator; authoring your own action alongside it ' +
  'stays open to you.';

/**
 * `refuseAmbiguousActionActivation` (`@objectstack/runtime`, `domains/actions.ts`).
 * The OBJECT NAMES are the whole value of this refusal — nothing on the client
 * can reconstruct which objects a machine name collides across.
 */
const AMBIGUITY_REFUSAL =
  "Action 'export' is declared on 2 objects ('account', 'contact'), and the activation ledger addresses an " +
  'action by its machine name (ADR-0126 §4) — one row would switch every one of them, not just the one on ' +
  "'account'. Refusing rather than changing artifacts you did not name. Give the actions distinct machine " +
  'names, or leave them armed.';

/**
 * The engine's own 503, relayed by the door's `catch` arm: the activation
 * ledger is not attached on this deployment, so nothing can be made durable.
 * An outage is not a verdict about the action, and the sentence is the
 * server's to phrase.
 */
const NO_LEDGER_REFUSAL =
  'No activation ledger is attached to this engine, so a packaged action cannot be switched off durably ' +
  '(ADR-0126 §4). Refusing rather than reporting a switch that would not survive a restart.';

/* -------------------------------------------------------------------------- */
/* Fake server                                                                 */
/* -------------------------------------------------------------------------- */

interface Fixture {
  /** `GET /meta/object` items. */
  objects: Array<Record<string, unknown>>;
  /** `GET /meta/action` items. */
  standalone: Array<Record<string, unknown>>;
  /** `sys_metadata_activation` rows. */
  ledger: Array<Record<string, unknown>>;
  /** Extra keys spliced into the ledger list response (e.g. `hasMore`). */
  ledgerExtra: Record<string, unknown>;
  /** Queued answers for `POST /actions/_activation/…`, in call order. */
  flip: Array<{ status: number; body: unknown }>;
}

let fixture: Fixture;
let calls: Array<{ url: string; method: string; body?: unknown }>;

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** ADR-0112 error envelope, as the runtime's `deps.error` puts it on the wire. */
function errorEnvelope(code: string, message: string) {
  return { success: false, error: { code, message } };
}

/** A packaged object with embedded action declarations. */
function packagedObject(name: string, actions: Array<Record<string, unknown>>) {
  return { name, label: name, actions, _packageId: 'com.objectstack.crm', _provenance: 'package' };
}

/** One install-level `sys_metadata_activation` row. */
function ledgerRow(name: string, active: boolean) {
  return {
    metadata_type: 'action',
    name,
    package_id: 'com.objectstack.crm',
    organization_id: null,
    active,
  };
}

beforeEach(() => {
  calls = [];
  fixture = {
    objects: [
      packagedObject('account', [
        { name: 'send_invoice', label: 'Send invoice' },
        { name: 'archive_account', label: 'Archive account' },
      ]),
    ],
    standalone: [],
    ledger: [],
    ledgerExtra: {},
    flip: [],
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (url.includes('/actions/_activation/')) {
        const next = fixture.flip.shift();
        if (next) return response(next.status, next.body);
        const enabled = (body as { enabled?: boolean } | undefined)?.enabled ?? true;
        const [objectName, name] = url.split('/actions/_activation/')[1].split('/').map(decodeURIComponent);
        // The server is the authority on what the state became — mirror it.
        return response(200, { success: true, data: { name, objectName, enabled } });
      }
      if (url.includes('/meta/object')) {
        return response(200, { items: fixture.objects });
      }
      if (url.includes('/meta/action')) {
        return response(200, { items: fixture.standalone });
      }
      if (url.includes('/data/sys_metadata_activation')) {
        return response(200, {
          success: true,
          data: {
            object: 'sys_metadata_activation',
            records: fixture.ledger,
            ...fixture.ledgerExtra,
          },
        });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render and wait for the first list paint. */
async function renderSection() {
  render(<PackagedActionsSection />);
  await screen.findByText('Send invoice');
}

const flipCalls = () => calls.filter((c) => c.url.includes('/actions/_activation/'));

/* -------------------------------------------------------------------------- */
/* 1) State render                                                             */
/* -------------------------------------------------------------------------- */

describe('activation state as the ledger reports it', () => {
  it('shows a packaged action as ON when the ledger holds no row for it', async () => {
    await renderSection();
    expect(screen.getByRole('switch', { name: 'Activation for Send invoice on account' })).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Activation for Archive account on account' }),
    ).toBeChecked();
  });

  it('shows an action the ledger disabled as OFF, without any further ceremony', async () => {
    fixture.ledger = [ledgerRow('send_invoice', false)];
    await renderSection();

    expect(
      screen.getByRole('switch', { name: 'Activation for Send invoice on account' }),
    ).not.toBeChecked();
    // Its sibling, which has no row, is unaffected.
    expect(
      screen.getByRole('switch', { name: 'Activation for Archive account on account' }),
    ).toBeChecked();
  });

  it('leaves a TENANT-authored action off the section', async () => {
    // A tenant overlay bound to a package carries a real package id, so only
    // the provenance clause keeps it out (the cloud#970 counterexample).
    fixture.objects = [
      ...fixture.objects,
      {
        name: 'my_object',
        label: 'Mine',
        _packageId: 'app.crm',
        _provenance: 'org',
        actions: [{ name: 'my_action', label: 'My action' }],
      },
    ];
    await renderSection();
    expect(screen.queryByText('My action')).toBeNull();
  });

  it('refuses to render a TRUNCATED ledger page rather than show a stale ON', async () => {
    // A dropped row reads as "active", so a partial ledger would show a
    // switched-off action as armed — the one direction this section must not
    // fail in.
    fixture.ledger = [ledgerRow('send_invoice', false)];
    fixture.ledgerExtra = { hasMore: true };
    render(<PackagedActionsSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/refusing to show a partial ledger/i);
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 2) Activation round-trip                                                    */
/* -------------------------------------------------------------------------- */

describe('activation round-trip', () => {
  it('disables and re-enables a packaged action, showing what the server reports', async () => {
    await renderSection();

    const invoice = screen.getByRole('switch', { name: 'Activation for Send invoice on account' });
    expect(invoice).toBeChecked();

    fireEvent.click(invoice);
    await waitFor(() => expect(flipCalls()).toHaveLength(1));
    expect(flipCalls()[0].method).toBe('POST');
    expect(flipCalls()[0].url).toContain('/actions/_activation/account/send_invoice');
    // ⛔ EXACTLY the one key the activation body declares — the door refuses
    // unknown keys by name, and `{"enable": false}` (one letter off) is the
    // #3899 shape that ENABLED an artifact and answered 200.
    expect(flipCalls()[0].body).toEqual({ enabled: false });
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Activation for Send invoice on account' }),
      ).not.toBeChecked(),
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Send invoice on account' }));
    await waitFor(() => expect(flipCalls()).toHaveLength(2));
    expect(flipCalls()[1].body).toEqual({ enabled: true });
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Activation for Send invoice on account' }),
      ).toBeChecked(),
    );
  });

  it('moves only the flipped row, even when a sibling shares the object', async () => {
    await renderSection();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Send invoice on account' }));
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Activation for Send invoice on account' }),
      ).not.toBeChecked(),
    );
    expect(
      screen.getByRole('switch', { name: 'Activation for Archive account on account' }),
    ).toBeChecked();
  });

  it('addresses an object-less action through the `global` segment', async () => {
    fixture.objects = [];
    fixture.standalone = [
      { name: 'nightly_sync', label: 'Nightly sync', _packageId: 'com.objectstack.crm', _provenance: 'package' },
    ];
    render(<PackagedActionsSection />);
    await screen.findByText('Nightly sync');

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Nightly sync on global' }));
    await waitFor(() => expect(flipCalls()).toHaveLength(1));
    expect(flipCalls()[0].url).toContain('/actions/_activation/global/nightly_sync');
  });
});

/* -------------------------------------------------------------------------- */
/* 3) Refusals, verbatim                                                       */
/* -------------------------------------------------------------------------- */

describe('server refusals reach the operator verbatim', () => {
  it('renders the §5 posture gate refusal (403 PERMISSION_DENIED) unedited', async () => {
    fixture.flip = [{ status: 403, body: errorEnvelope('PERMISSION_DENIED', POSTURE_REFUSAL) }];
    await renderSection();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Send invoice on account' }));

    const shown = await screen.findByText(POSTURE_REFUSAL);
    expect(shown).toBeInTheDocument();
    // The half a summarising client would drop: what the refused admin can do.
    expect(shown.textContent).toContain('ask your platform operator');
    // The refused flip did not move the shown state.
    expect(screen.getByRole('switch', { name: 'Activation for Send invoice on account' })).toBeChecked();
    // ⛔ And it was not retried.
    expect(flipCalls()).toHaveLength(1);
  });

  it('renders the ambiguous-name refusal (409 RESOURCE_CONFLICT) with its named objects', async () => {
    fixture.objects = [
      packagedObject('account', [{ name: 'export', label: 'Export' }]),
      packagedObject('contact', [{ name: 'export', label: 'Export' }]),
    ];
    fixture.flip = [{ status: 409, body: errorEnvelope('RESOURCE_CONFLICT', AMBIGUITY_REFUSAL) }];
    render(<PackagedActionsSection />);
    await screen.findByRole('switch', { name: 'Activation for Export on account' });

    // Both rows are listed — the section does not pre-empt the server's
    // conflict with a client-side guess about which one is "real".
    expect(screen.getByRole('switch', { name: 'Activation for Export on contact' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Export on account' }));

    const shown = await screen.findByText(AMBIGUITY_REFUSAL);
    expect(shown).toBeInTheDocument();
    // The object names survive — nothing on the client could reconstruct them.
    expect(shown.textContent).toContain("('account', 'contact')");
  });

  it('renders the no-ledger outage (503 SERVICE_UNAVAILABLE) unedited', async () => {
    fixture.flip = [{ status: 503, body: errorEnvelope('SERVICE_UNAVAILABLE', NO_LEDGER_REFUSAL) }];
    await renderSection();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Send invoice on account' }));

    expect(await screen.findByText(NO_LEDGER_REFUSAL)).toBeInTheDocument();
    // An outage is not a verdict, and it is not a hiccup to paper over either:
    // one attempt, no retry loop, and the state stays where the server left it.
    expect(flipCalls()).toHaveLength(1);
    expect(screen.getByRole('switch', { name: 'Activation for Send invoice on account' })).toBeChecked();
  });

  it('keeps each row\'s refusal on its own row', async () => {
    fixture.flip = [{ status: 403, body: errorEnvelope('PERMISSION_DENIED', POSTURE_REFUSAL) }];
    await renderSection();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Send invoice on account' }));
    await screen.findByText(POSTURE_REFUSAL);

    const invoiceRow = screen.getByTestId('packaged-action-account-send_invoice');
    const archiveRow = screen.getByTestId('packaged-action-account-archive_account');
    expect(within(invoiceRow).getByRole('alert')).toHaveTextContent('platform operator');
    expect(within(archiveRow).queryByRole('alert')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 4) No clone (ADR-0126 §8 item 2 — not chartered)                            */
/* -------------------------------------------------------------------------- */

describe('no clone for actions', () => {
  it('offers the switch and nothing else — no clone control anywhere', async () => {
    await renderSection();

    const section = screen.getByTestId('packaged-actions-section');
    expect(within(section).queryByRole('button', { name: /clone/i })).toBeNull();
    expect(within(section).queryByText(/clone/i)).toBeNull();
    expect(within(section).queryByText(/duplicate/i)).toBeNull();
    expect(within(section).queryByText(/copy/i)).toBeNull();
    // The switches ARE there — this asserts an absence beside a presence, so a
    // section that failed to render could not pass it by rendering nothing.
    expect(within(section).getAllByRole('switch')).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* 5) No ancestry or drift surface (ADR-0126 §9)                               */
/* -------------------------------------------------------------------------- */

describe('no ancestry or drift surface', () => {
  const WITHDRAWN = [
    /based on/i,
    /customized/i,
    /diff/i,
    /compare/i,
    /ancestry/i,
    /lineage/i,
    /out of date/i,
    /base (has )?moved/i,
    /upstream chang/i,
  ];

  it('shows a packaged action with no drift badge, no diff-vs-base and no base-moved notice', async () => {
    await renderSection();
    for (const shape of WITHDRAWN) {
      expect(screen.queryByText(shape)).toBeNull();
    }
    expect(screen.queryByText(/based on v\d/i)).toBeNull();
    expect(screen.queryByText(/cloned from/i)).toBeNull();
  });

  it('does not display ancestry even when the metadata and the flip response carry it', async () => {
    // The platform tracks no such lineage, so these fields cannot arrive from
    // a real server — feeding them anyway proves the ABSENCE is enforced by
    // this section and not merely by the wire.
    fixture.objects = [
      packagedObject('account', [
        { name: 'send_invoice', label: 'Send invoice', clonedFrom: 'base_send_invoice', baseVersion: 'v3' },
      ]),
    ];
    fixture.flip = [
      {
        status: 200,
        body: {
          success: true,
          data: {
            name: 'send_invoice',
            objectName: 'account',
            enabled: false,
            clonedFrom: 'base_send_invoice',
            baseVersion: 'v3',
          },
        },
      },
    ];
    await renderSection();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Send invoice on account' }));
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Activation for Send invoice on account' }),
      ).not.toBeChecked(),
    );

    for (const shape of WITHDRAWN) {
      expect(screen.queryByText(shape)).toBeNull();
    }
    const section = screen.getByTestId('packaged-actions-section');
    expect(section.textContent).not.toContain('base_send_invoice');
    expect(section.textContent).not.toContain('v3');
  });
});
