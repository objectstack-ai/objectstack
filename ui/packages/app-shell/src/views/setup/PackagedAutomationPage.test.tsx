// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup › Packaged automation (ADR-0126 §7.4) — behaviour.
 *
 * The properties, in the order the page exercises them:
 *
 *   1. **scope** — the list is packaged flows only. The rule itself lives in
 *      `packagedFlows.ts` and is measured directly in `packagedFlows.test.ts`;
 *      what is checked here is that the rendered page applies it.
 *   2. **round-trip** — flipping the switch calls the toggle route with the
 *      requested state and the shown state follows the SERVER's answer.
 *   3. **refusals, verbatim** — the three shapes this page must relay: the
 *      §5 posture gate (403 `PERMISSION_DENIED`), the §7.3 subflow guard
 *      (409 `DELETE_RESTRICTED`, which NAMES the callers) and the §7.1 clone
 *      name conflict (409). Each is asserted as the exact server string. Two
 *      of the three are transcribed character-for-character from the runtime's
 *      own message builders; what is under test either way is that the page
 *      renders what it was sent, unedited.
 *   4. **clone** — completes with the new name, and puts EXACTLY
 *      `{ name, label }` on the wire. The carried-over definition is not an
 *      editable form field (the #11753 discipline).
 *   5. **no ancestry** — the withdrawn §9 shapes are absent. The sharpest case
 *      is last: even when a response carries a `clonedFrom` key, the page must
 *      not display it. Pinning the rule at the RENDERER and not only at the
 *      wire is the point — a response field is the cheapest place for ancestry
 *      to reappear.
 *   6. **the unbound reason** (objectui#9217) — a runtime row's `reason` is the
 *      platform's sentence for why the flow is not armed. It is shown VERBATIM
 *      and muted, never as an alert, whether it names the deployment policy or
 *      a real binding failure; a row without one renders exactly as before.
 *      Since objectui#12609 the sentence is not in the row at all: it opens
 *      from a neutral chip on the name's line, the same chip whatever the
 *      sentence says, so the row keeps the table's height.
 *   7. **the effective state** (objectui#13159) — the switch holds the
 *      activation FLAG, and the badge beside it says whether the flow RUNS: a
 *      row the engine reports enabled but unarmed (it carries an
 *      `unboundCause`) keeps its switch on and reads "Not running here", never
 *      "On". Bound flows and flows with no trigger read "On" exactly as
 *      before, and a toggle re-reads what the engine armed.
 *   8. **the clone result's next steps** (objectui#13270) — a clone runs
 *      beside its source, so the result offers to switch the source off
 *      through the SAME toggle as its row, and links the clone's Studio scope.
 *      An off source is offered nothing to switch; a refusal is the server's
 *      sentence and the offer stays.
 *   9. **the clone prefill** (objectui#13344) — the dialog opens on
 *      `<source>_copy` and "<source label> (copy)", submittable as it stands
 *      and editable; a flow with no label falls back to its machine name, and
 *      a taken default still answers the server's 409 verbatim.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PackagedAutomationPage } from './PackagedAutomationPage';

/* -------------------------------------------------------------------------- */
/* The server's own refusal strings                                            */
/* -------------------------------------------------------------------------- */

/**
 * `refuseUngrantedActivationWrite` (runtime `domains/automation.ts`), for the
 * `group` posture. Transcribed exactly: the sentence naming the posture AND the
 * one naming the sanctioned path are both load-bearing, and a client that
 * shortened it would drop the half that says what to do instead.
 */
const POSTURE_REFUSAL =
  "Enabling or disabling a packaged flow writes an INSTALL-WIDE activation row, and this deployment runs the " +
  "'group' tenancy posture, where that reaches every organization. It requires the platform operator " +
  '(ADR-0126 §5) — an organization administrator cannot flip an install-wide switch. To customize this flow ' +
  'for your organization, clone it under a new name instead.';

/**
 * The §7.3 subflow guard from the automation engine's `toggleFlow`, two
 * callers. The NAMES are the whole value of this refusal — nothing on the
 * client can reconstruct which packaged flows call this one as a subflow.
 */
const SUBFLOW_REFUSAL =
  "Flow 'pkg_notify' cannot be disabled while 2 packaged flows still call it as a subflow: " +
  "'pkg_escalate', 'pkg_onboard'. Disabling it would break those callers mid-run at their subflow node " +
  'with a late, inexplicable failure (ADR-0126 §7.3). Disable the calling flows first, or leave this one armed.';

/**
 * `flowCloneNameTakenMessage`. The trailing suggestion is the server's to
 * choose (`suggestCloneName`); what this file pins is that whatever it sends
 * arrives unedited, so the suggestion is fixture text here, not a contract.
 */
const CLONE_CONFLICT_REFUSAL =
  "Flow 'pkg_notify_copy' already exists — a clone must take a NEW machine name. Same-name clones are " +
  'refused on purpose: the automation engine keys flows by bare name, so a second definition under one ' +
  'name silently shadows the other and which of the two actually dispatches depends on registration ' +
  "order (ADR-0126 §7.1). Retry with a machine name no flow uses (for example 'pkg_notify_copy_2').";

/** `FLOW_CLONE_NOTICE` — returned on every successful clone. */
const CLONE_NOTICE =
  'References are not re-pointed: this clone calls exactly what the original called (subflows, actions ' +
  'and objects are unchanged). It is created with status `draft`, which is a lifecycle label and NOT an ' +
  'off-switch — a cloned record-change or schedule flow is bound to its trigger and will run alongside ' +
  'the flow it was copied from.';

/**
 * `SCHEDULED_WORK_DISABLED_REASON` (`@objectstack/types` 17.5.0), the sentence
 * the automation engine puts in `FlowRuntimeState.reason` for a time-triggered
 * flow the deployment's scheduled-work switch left unarmed. Transcribed here as
 * FIXTURE text only: `@object-ui/app-shell` does not depend on that package,
 * and the page keeps no copy of it — what is pinned is that whatever sentence
 * arrives is rendered unedited.
 */
const POLICY_REASON =
  'disabled by deployment policy — package-authored scheduled work is off on this deployment ' +
  '(OS_AUTOMATION_SCHEDULED_WORK_ENABLED is unset or not truthy), so no time trigger arms and no ' +
  'packaged `defineJob` is scheduled. This is not a binding failure and nothing about the flow ' +
  'needs fixing: set OS_AUTOMATION_SCHEDULED_WORK_ENABLED=true to run package-authored scheduled ' +
  "work on this deployment. It is OFF by default in every posture — a clock-driven workload's " +
  'cost is a fact about the deployment, not about the flow.';

/**
 * The automation engine's `describeUnboundReason` sentence for a trigger that
 * is registered but failed to bind. Fixture text, like the one above.
 */
const BINDING_FAILED_REASON = "trigger 'record_change' is registered but binding failed — see earlier warnings";

/* -------------------------------------------------------------------------- */
/* Fake server                                                                 */
/* -------------------------------------------------------------------------- */

interface Fixture {
  runtime: Array<Record<string, unknown>>;
  meta: Array<Record<string, unknown>>;
  /** Queued answers for `POST …/toggle`, in call order. */
  toggle: Array<{ status: number; body: unknown }>;
  /** Queued answers for `POST …/clone`, in call order. */
  clone: Array<{ status: number; body: unknown }>;
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

/** A packaged flow metadata item — loader-introduced, real package id. */
function packagedItem(name: string, label: string) {
  return { name, label, _packageId: 'com.objectstack.crm', _provenance: 'package' };
}

beforeEach(() => {
  calls = [];
  fixture = {
    runtime: [
      { name: 'pkg_notify', enabled: true, bound: true },
      { name: 'pkg_escalate', enabled: false, bound: false },
    ],
    meta: [packagedItem('pkg_notify', 'Notify owner'), packagedItem('pkg_escalate', 'Escalate case')],
    toggle: [],
    clone: [],
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (url.endsWith('/automation/_status')) {
        return response(200, { success: true, data: { flows: fixture.runtime } });
      }
      if (url.endsWith('/meta/flow')) {
        return response(200, { items: fixture.meta });
      }
      if (url.includes('/toggle')) {
        const next = fixture.toggle.shift();
        if (next) return response(next.status, next.body);
        const enabled = (body as { enabled?: boolean } | undefined)?.enabled ?? true;
        const name = decodeURIComponent(url.split('/automation/')[1].replace('/toggle', ''));
        // The engine is the authority on what the state became — mirror it.
        const row = fixture.runtime.find((r) => r.name === name);
        if (row) row.enabled = enabled;
        return response(200, { success: true, data: { name, enabled } });
      }
      // The packaged-ACTIONS section (ADR-0126 §8 item 2) shares this page and
      // issues its own three reads. Answered EMPTY here on purpose: this file
      // owns the flows half, and its assertions must keep measuring that half
      // and not the sibling section — whose own behaviour, refusals and §9
      // absences are pinned in `PackagedActionsSection.test.tsx`. Leaving them
      // unanswered would not be neutral: the stub below throws, so every test
      // in this file would render a section-level load error.
      if (url.includes('/meta/object')) {
        return response(200, { items: [] });
      }
      if (url.includes('/meta/action')) {
        return response(200, { items: [] });
      }
      if (url.includes('/data/sys_metadata_activation')) {
        return response(200, {
          success: true,
          data: { object: 'sys_metadata_activation', records: [] },
        });
      }
      if (url.includes('/clone')) {
        const next = fixture.clone.shift();
        if (next) return response(next.status, next.body);
        const payload = body as { name: string; label: string };
        return response(200, {
          success: true,
          data: { flow: { name: payload.name, label: payload.label }, notice: CLONE_NOTICE },
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
async function renderPage() {
  // A router because the clone result links the clone's Studio scope
  // (objectui#13270); the console mounts this page inside its own.
  render(
    <MemoryRouter>
      <PackagedAutomationPage />
    </MemoryRouter>,
  );
  await screen.findByText('Notify owner');
}

const toggleCalls = () => calls.filter((c) => c.url.includes('/toggle'));
const cloneCalls = () => calls.filter((c) => c.url.includes('/clone'));

/**
 * The Clone button of ONE named row. Rows are sorted by label, so an index
 * into `getAllByRole` names whichever flow happens to sort first — which is
 * how the first draft of this file clicked `pkg_escalate` while asserting
 * against `pkg_notify`.
 */
function cloneButtonFor(flowName: string) {
  return within(screen.getByTestId(`packaged-flow-${flowName}`)).getByRole('button', {
    name: 'Clone',
  });
}

/* -------------------------------------------------------------------------- */
/* 1) Scope                                                                    */
/* -------------------------------------------------------------------------- */

describe('scoping to packaged flows', () => {
  it('renders the packaged flows and leaves a tenant-authored one off the page', async () => {
    fixture.runtime = [...fixture.runtime, { name: 'my_own_flow', enabled: true, bound: true }];
    fixture.meta = [
      ...fixture.meta,
      // A tenant overlay BOUND to a package: it carries a real package id, so
      // only the provenance clause keeps it off this page (cloud#970).
      { name: 'my_own_flow', label: 'My own flow', _packageId: 'app.crm', _provenance: 'org' },
    ];

    await renderPage();

    expect(screen.getByText('Notify owner')).toBeInTheDocument();
    expect(screen.getByText('Escalate case')).toBeInTheDocument();
    expect(screen.queryByText('My own flow')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 2) Activation round-trip                                                    */
/* -------------------------------------------------------------------------- */

describe('activation round-trip', () => {
  it('disables and re-enables a packaged flow, showing what the server reports', async () => {
    await renderPage();

    const notify = screen.getByRole('switch', { name: 'Activation for Notify owner' });
    expect(notify).toBeChecked();

    fireEvent.click(notify);
    await waitFor(() => expect(toggleCalls()).toHaveLength(1));
    expect(toggleCalls()[0].method).toBe('POST');
    expect(toggleCalls()[0].url).toContain('/automation/pkg_notify/toggle');
    expect(toggleCalls()[0].body).toEqual({ enabled: false });
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Activation for Notify owner' })).not.toBeChecked(),
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Notify owner' }));
    await waitFor(() => expect(toggleCalls()).toHaveLength(2));
    expect(toggleCalls()[1].body).toEqual({ enabled: true });
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Activation for Notify owner' })).toBeChecked(),
    );
  });

  it('shows a disabled packaged flow as off without any further ceremony', async () => {
    await renderPage();
    expect(screen.getByRole('switch', { name: 'Activation for Escalate case' })).not.toBeChecked();
  });
});

/* -------------------------------------------------------------------------- */
/* 3) Refusals, verbatim                                                       */
/* -------------------------------------------------------------------------- */

describe('server refusals reach the operator verbatim', () => {
  it('renders the §5 posture gate refusal (403 PERMISSION_DENIED) unedited', async () => {
    fixture.toggle = [{ status: 403, body: errorEnvelope('PERMISSION_DENIED', POSTURE_REFUSAL) }];
    await renderPage();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Notify owner' }));

    expect(await screen.findByText(POSTURE_REFUSAL)).toBeInTheDocument();
    // The refused flip did not move the shown state.
    expect(screen.getByRole('switch', { name: 'Activation for Notify owner' })).toBeChecked();
  });

  it('renders the §7.3 subflow guard refusal (409 DELETE_RESTRICTED) with its named callers', async () => {
    fixture.toggle = [{ status: 409, body: errorEnvelope('DELETE_RESTRICTED', SUBFLOW_REFUSAL) }];
    await renderPage();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Notify owner' }));

    const shown = await screen.findByText(SUBFLOW_REFUSAL);
    expect(shown).toBeInTheDocument();
    // The caller names survive — the half a summarising client would drop.
    expect(shown.textContent).toContain("'pkg_escalate', 'pkg_onboard'");
  });

  it('renders the §7.1 clone name conflict (409) unedited, keeping the dialog open', async () => {
    fixture.clone = [{ status: 409, body: errorEnvelope('RESOURCE_CONFLICT', CLONE_CONFLICT_REFUSAL) }];
    await renderPage();

    fireEvent.click(cloneButtonFor('pkg_notify'));
    fireEvent.change(await screen.findByLabelText('New machine name'), {
      target: { value: 'pkg_notify_copy' },
    });
    fireEvent.change(screen.getByLabelText('New label'), { target: { value: 'Notify owner (copy)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create clone' }));

    expect(await screen.findByText(CLONE_CONFLICT_REFUSAL)).toBeInTheDocument();
    // The refusal stays beside the input that caused it.
    expect(screen.getByLabelText('New machine name')).toHaveValue('pkg_notify_copy');
  });
});

/* -------------------------------------------------------------------------- */
/* 4) Clone                                                                    */
/* -------------------------------------------------------------------------- */

describe('clone', () => {
  it('completes with the new name and sends exactly { name, label }', async () => {
    await renderPage();

    fireEvent.click(cloneButtonFor('pkg_notify'));
    fireEvent.change(await screen.findByLabelText('New machine name'), {
      target: { value: 'crm_notify_owner' },
    });
    fireEvent.change(screen.getByLabelText('New label'), { target: { value: 'Notify owner (ours)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create clone' }));

    await waitFor(() => expect(cloneCalls()).toHaveLength(1));
    expect(cloneCalls()[0].url).toContain('/automation/pkg_notify/clone');
    // ⛔ No definition blob on the wire: a clone copies the whole definition
    // server-side, and this page never offers it as editable form fields.
    expect(cloneCalls()[0].body).toEqual({ name: 'crm_notify_owner', label: 'Notify owner (ours)' });

    expect(await screen.findByText(/Created flow "crm_notify_owner"\./)).toBeInTheDocument();
    // The server's post-clone notice, verbatim.
    expect(screen.getByText(CLONE_NOTICE)).toBeInTheDocument();
  });

  it('will not submit until both the new machine name and the new label are given', async () => {
    await renderPage();

    fireEvent.click(cloneButtonFor('pkg_notify'));
    const confirm = await screen.findByRole('button', { name: 'Create clone' });
    // The dialog opens prefilled (objectui#13344), so empty both first.
    fireEvent.change(screen.getByLabelText('New machine name'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('New label'), { target: { value: ' ' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('New machine name'), { target: { value: 'crm_notify' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('New label'), { target: { value: 'Ours' } });
    expect(confirm).toBeEnabled();
  });
});

/* -------------------------------------------------------------------------- */
/* 5) No ancestry or drift surface (ADR-0126 §9)                               */
/* -------------------------------------------------------------------------- */

describe('no ancestry or drift surface', () => {
  /**
   * The §9 shapes, as UI vocabulary.
   *
   * ⛔ `/copied from/` is deliberately NOT in this list, and its absence is the
   * distinction the rule actually draws. The server's own post-clone notice
   * ends "…will run alongside the flow it was copied from", and that notice
   * must be relayed VERBATIM. What §9 withdraws is a lineage SURFACE this page
   * would have to invent and maintain — a badge, a diff, a base-moved banner,
   * a link back to a source. It does not censor the server's sentences. The
   * first draft of this file scanned for the phrase and failed on the
   * platform's own words, which is the wrong end of the rule.
   */
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

  it('shows a packaged flow with no drift badge, no diff-vs-base and no base-moved notice', async () => {
    await renderPage();
    for (const shape of WITHDRAWN) {
      expect(screen.queryByText(shape)).toBeNull();
    }
    // The withdrawn shape by name — a "based on v3" style provenance line.
    expect(screen.queryByText(/based on v\d/i)).toBeNull();
    // Nor the flat spelling of it anywhere in the list.
    expect(screen.queryByText(/cloned from/i)).toBeNull();
  });

  it('does not display ancestry even when a response carries it', async () => {
    // The clone route deliberately returns no `clonedFrom`. Feeding one anyway
    // proves the ABSENCE is enforced by this page and not merely by the wire.
    fixture.clone = [
      {
        status: 200,
        body: {
          success: true,
          data: {
            flow: { name: 'crm_notify_owner', label: 'Ours' },
            notice: CLONE_NOTICE,
            clonedFrom: 'pkg_notify',
            baseVersion: 'v3',
          },
        },
      },
    ];
    await renderPage();

    fireEvent.click(cloneButtonFor('pkg_notify'));
    fireEvent.change(await screen.findByLabelText('New machine name'), {
      target: { value: 'crm_notify_owner' },
    });
    fireEvent.change(screen.getByLabelText('New label'), { target: { value: 'Ours' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create clone' }));

    await screen.findByText(/Created flow "crm_notify_owner"\./);
    for (const shape of WITHDRAWN) {
      expect(screen.queryByText(shape)).toBeNull();
    }

    // The two ancestry keys the response smuggled in reach the DOM nowhere.
    // Scoped to the clone result: `pkg_notify` legitimately appears in the
    // table as a row of its own, and a document-wide scan for it would pass
    // for the wrong reason.
    const result = screen.getByRole('status');
    expect(result.textContent).not.toContain('pkg_notify');
    expect(result.textContent).not.toContain('v3');
    expect(screen.queryByText(/v3/)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 6) The unbound reason, verbatim (objectui#9217)                             */
/* -------------------------------------------------------------------------- */

describe('the platform reason for an unbound flow', () => {
  /** The flow cell of ONE named row — where the name, and any reason, render. */
  function flowCell(flowName: string): HTMLElement {
    const cell = screen.getByTestId(`packaged-flow-${flowName}`).querySelector('td');
    if (!cell) throw new Error(`no flow cell for ${flowName}`);
    return cell;
  }

  /** The neutral reason chip of ONE named row, or `null` when it has none. */
  function chipIn(flowName: string): HTMLElement | null {
    return within(screen.getByTestId(`packaged-flow-${flowName}`)).queryByRole('button', {
      name: 'Details',
    });
  }

  /** Open a row's chip and return the disclosure it opened. */
  async function openReason(flowName: string): Promise<HTMLElement> {
    const chip = chipIn(flowName);
    if (!chip) throw new Error(`no reason chip on ${flowName}`);
    fireEvent.click(chip);
    return screen.findByRole('dialog', { name: 'Details' });
  }

  /** Add one unarmed packaged flow, carrying `reason`, to the fixture. */
  function withReasonRow(name: string, label: string, triggerType: string, reason: string) {
    fixture.runtime = [...fixture.runtime, { name, enabled: true, bound: false, triggerType, reason }];
    fixture.meta = [...fixture.meta, packagedItem(name, label)];
  }

  /**
   * What every reason row owes (objectui#9217, objectui#12609). The ROW holds
   * no paragraph and none of the sentence, so it keeps the table's height. Its
   * chip opens a disclosure holding the platform's sentence and nothing else:
   * whole, unedited and muted. Nothing in the row or the disclosure is an
   * alert or destructive-styled.
   */
  async function expectBehindChipVerbatim(flowName: string, sentence: string) {
    const row = screen.getByTestId(`packaged-flow-${flowName}`);
    expect(row.querySelectorAll('p')).toHaveLength(0);
    expect(row.textContent).not.toContain(sentence);
    expect(within(row).queryAllByRole('alert')).toHaveLength(0);
    expect(row.querySelectorAll('.text-destructive')).toHaveLength(0);

    const disclosure = await openReason(flowName);
    expect(disclosure.textContent).toBe(sentence);
    const shown = within(disclosure).getByText(sentence);
    expect(shown.textContent).toBe(sentence);
    expect(shown).toHaveClass('text-muted-foreground');
    expect(shown).not.toHaveClass('text-destructive');
    expect(within(disclosure).queryAllByRole('alert')).toHaveLength(0);
  }

  it('keeps a deployment-policy row to its name line; the sentence opens from the chip, whole and muted', async () => {
    withReasonRow('pkg_digest', 'Daily digest', 'schedule', POLICY_REASON);
    await renderPage();

    await expectBehindChipVerbatim('pkg_digest', POLICY_REASON);
    // The page adds no failure wording of its own around the policy sentence.
    expect(screen.getByTestId('packaged-flow-pkg_digest').textContent).not.toMatch(/binding failed/i);
    // The flow's activation is still shown as the engine reports it.
    expect(screen.getByRole('switch', { name: 'Activation for Daily digest' })).toBeChecked();
  });

  it('puts a real binding failure behind the same chip, in the platform words too (acceptance ②)', async () => {
    withReasonRow('pkg_sync', 'Sync accounts', 'record_change', BINDING_FAILED_REASON);
    await renderPage();

    await expectBehindChipVerbatim('pkg_sync', BINDING_FAILED_REASON);
  });

  it('draws one chip that does not classify: a policy row and a binding failure show the same one', async () => {
    withReasonRow('pkg_digest', 'Daily digest', 'schedule', POLICY_REASON);
    withReasonRow('pkg_sync', 'Sync accounts', 'record_change', BINDING_FAILED_REASON);
    await renderPage();

    const policy = chipIn('pkg_digest');
    const failure = chipIn('pkg_sync');
    expect(policy).not.toBeNull();
    expect(failure).not.toBeNull();
    // The chip's words and look follow "this row has a reason", never what the
    // reason says: the two rows' chips are indistinguishable.
    expect(policy!.textContent).toBe('Details');
    expect(failure!.textContent).toBe(policy!.textContent);
    expect(failure!.className).toBe(policy!.className);
  });

  it('renders a row without a reason exactly as before, with no chip, older backends included', async () => {
    // `pkg_notify` (bound) and `pkg_escalate` (disabled) come from the default
    // fixture and carry no reason; `pkg_legacy` is an older backend's bare row.
    fixture.runtime = [...fixture.runtime, { name: 'pkg_legacy' }];
    fixture.meta = [...fixture.meta, packagedItem('pkg_legacy', 'Legacy flow')];
    await renderPage();

    expect(flowCell('pkg_notify').textContent).toBe('Notify ownerpkg_notify');
    expect(flowCell('pkg_escalate').textContent).toBe('Escalate casepkg_escalate');
    expect(flowCell('pkg_legacy').textContent).toBe('Legacy flowpkg_legacy');
    for (const name of ['pkg_notify', 'pkg_escalate', 'pkg_legacy']) {
      expect(chipIn(name)).toBeNull();
    }
  });

  it('ignores a reason that is not a string', async () => {
    fixture.runtime = [
      ...fixture.runtime,
      { name: 'pkg_numeric', enabled: true, bound: false, reason: 42 },
      { name: 'pkg_object', enabled: true, bound: false, reason: { code: 'policy' } },
    ];
    fixture.meta = [
      ...fixture.meta,
      packagedItem('pkg_numeric', 'Numeric reason'),
      packagedItem('pkg_object', 'Object reason'),
    ];
    await renderPage();

    expect(flowCell('pkg_numeric').textContent).toBe('Numeric reasonpkg_numeric');
    expect(flowCell('pkg_object').textContent).toBe('Object reasonpkg_object');
    expect(chipIn('pkg_numeric')).toBeNull();
    expect(chipIn('pkg_object')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 7) The Activation cell says whether the flow runs (objectui#13159)          */
/* -------------------------------------------------------------------------- */

describe('the Activation cell says whether the flow runs', () => {
  /** The Activation cell of ONE named row: the switch and its badge. */
  function activationCell(flowName: string): HTMLElement {
    const cell = screen.getByTestId(`packaged-flow-${flowName}`).querySelectorAll('td')[1];
    if (!cell) throw new Error(`no activation cell for ${flowName}`);
    return cell as HTMLElement;
  }

  /** A packaged schedule flow the deployment's policy left unarmed, flag on. */
  function withPolicyRow() {
    fixture.runtime = [
      ...fixture.runtime,
      {
        name: 'pkg_digest',
        enabled: true,
        bound: false,
        triggerType: 'schedule',
        reason: POLICY_REASON,
        unboundCause: 'deployment_policy',
      },
    ];
    fixture.meta = [...fixture.meta, packagedItem('pkg_digest', 'Daily digest')];
  }

  it('does not present an unbound schedule flow with its flag on as running (acceptance)', async () => {
    withPolicyRow();
    await renderPage();

    const cell = activationCell('pkg_digest');
    // The switch keeps the author's flag: on, and still a live control.
    const toggle = within(cell).getByRole('switch', { name: 'Activation for Daily digest' });
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    // The badge says the flow does not run, and nothing in the cell says "On".
    expect(within(cell).getByText('Not running here')).toBeInTheDocument();
    expect(within(cell).queryByText('On')).toBeNull();
    expect(cell.textContent).toBe('Not running here');
  });

  it('keeps a bound flow, a flow with no trigger and a disabled flow exactly as before (controls)', async () => {
    fixture.runtime = [...fixture.runtime, { name: 'pkg_manual', enabled: true, bound: false }];
    fixture.meta = [...fixture.meta, packagedItem('pkg_manual', 'Run by hand')];
    withPolicyRow();
    await renderPage();

    // Bound to its trigger: "On".
    expect(activationCell('pkg_notify').textContent).toBe('On');
    // No declared trigger, so `bound: false` and no cause: it runs when
    // invoked, and is never called "not running".
    expect(activationCell('pkg_manual').textContent).toBe('On');
    // Switched off: "Off".
    expect(activationCell('pkg_escalate').textContent).toBe('Off');
    // The policy row beside them is the only one that reads otherwise.
    expect(activationCell('pkg_digest').textContent).toBe('Not running here');
  });

  it('reads every unbound cause the same way, and styles none of them as an error', async () => {
    withPolicyRow();
    fixture.runtime = [
      ...fixture.runtime,
      {
        name: 'pkg_sync',
        enabled: true,
        bound: false,
        triggerType: 'record_change',
        reason: BINDING_FAILED_REASON,
        unboundCause: 'binding_failure',
      },
    ];
    fixture.meta = [...fixture.meta, packagedItem('pkg_sync', 'Sync accounts')];
    await renderPage();

    const policy = within(activationCell('pkg_digest')).getByText('Not running here');
    const failure = within(activationCell('pkg_sync')).getByText('Not running here');
    // The badge names no cause: the Details chip carries the platform's words.
    expect(failure.className).toBe(policy.className);
    for (const badge of [policy, failure]) {
      expect(badge.className).not.toMatch(/destructive/);
      expect(badge).not.toHaveAttribute('role', 'alert');
    }
  });

  it('still writes the flag from a row that is not running', async () => {
    withPolicyRow();
    await renderPage();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Daily digest' }));
    await waitFor(() => expect(toggleCalls()).toHaveLength(1));
    expect(toggleCalls()[0].url).toContain('/automation/pkg_digest/toggle');
    expect(toggleCalls()[0].body).toEqual({ enabled: false });
    await waitFor(() => expect(activationCell('pkg_digest').textContent).toBe('Off'));
    expect(screen.getByRole('switch', { name: 'Activation for Daily digest' })).not.toBeChecked();
  });

  it('re-reads what the engine armed after a toggle, so switching an unarmed flow on does not read "On"', async () => {
    // Off at load: a disabled row carries no unbound cause.
    fixture.runtime = [
      ...fixture.runtime,
      { name: 'pkg_digest', enabled: false, bound: false, triggerType: 'schedule' },
    ];
    fixture.meta = [...fixture.meta, packagedItem('pkg_digest', 'Daily digest')];
    await renderPage();
    expect(activationCell('pkg_digest').textContent).toBe('Off');
    const statusReads = () => calls.filter((c) => c.url.endsWith('/automation/_status')).length;
    const readsBefore = statusReads();

    // What the engine will report once the flag is on: the deployment's policy
    // keeps the schedule trigger unarmed. The toggle's own answer carries only
    // `{ name, enabled }`.
    const row = fixture.runtime.find((r) => r.name === 'pkg_digest')!;
    Object.assign(row, { reason: POLICY_REASON, unboundCause: 'deployment_policy' });

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Daily digest' }));
    await waitFor(() => expect(toggleCalls()).toHaveLength(1));
    expect(toggleCalls()[0].body).toEqual({ enabled: true });

    await waitFor(() => expect(activationCell('pkg_digest').textContent).toBe('Not running here'));
    expect(statusReads()).toBe(readsBefore + 1);
    expect(screen.getByRole('switch', { name: 'Activation for Daily digest' })).toBeChecked();
  });

  it('does not re-read after a refused toggle', async () => {
    fixture.toggle = [{ status: 403, body: errorEnvelope('PERMISSION_DENIED', POSTURE_REFUSAL) }];
    await renderPage();
    const statusReads = () => calls.filter((c) => c.url.endsWith('/automation/_status')).length;
    const readsBefore = statusReads();

    fireEvent.click(screen.getByRole('switch', { name: 'Activation for Notify owner' }));
    expect(await screen.findByText(POSTURE_REFUSAL)).toBeInTheDocument();
    expect(statusReads()).toBe(readsBefore);
    expect(activationCell('pkg_notify').textContent).toBe('On');
  });
});

/* -------------------------------------------------------------------------- */
/* 8) The clone result's next steps (objectui#13270)                           */
/* -------------------------------------------------------------------------- */

describe('the clone result offers the next steps', () => {
  /** Clone ONE named row under a new name and wait for the result. */
  async function cloneRow(flowName: string, newName: string) {
    fireEvent.click(cloneButtonFor(flowName));
    fireEvent.change(await screen.findByLabelText('New machine name'), { target: { value: newName } });
    fireEvent.change(screen.getByLabelText('New label'), { target: { value: 'Ours' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create clone' }));
    await screen.findByText(`Created flow "${newName}".`);
  }

  const switchOffOffer = () => screen.queryByTestId('packaged-clone-switch-source-off');
  const rowSwitch = (label: string) => screen.getByRole('switch', { name: `Activation for ${label}` });

  it('keeps the notice, and switches the source off through the row\'s own toggle (pin a)', async () => {
    await renderPage();
    await cloneRow('pkg_notify', 'crm_notify_owner');

    // The server's notice stays, verbatim.
    expect(screen.getByText(CLONE_NOTICE)).toBeInTheDocument();
    const offer = switchOffOffer();
    expect(offer).not.toBeNull();
    expect(offer!.textContent).toBe('Switch "Notify owner" off');
    expect(rowSwitch('Notify owner')).toBeChecked();

    fireEvent.click(offer!);
    await waitFor(() => expect(toggleCalls()).toHaveLength(1));
    // The SAME door the row's switch calls, for the SOURCE, switching it off.
    expect(toggleCalls()[0].url).toContain('/automation/pkg_notify/toggle');
    expect(toggleCalls()[0].method).toBe('POST');
    expect(toggleCalls()[0].body).toEqual({ enabled: false });

    // The source row reads off, and the result reads the offer as done.
    await waitFor(() => expect(rowSwitch('Notify owner')).not.toBeChecked());
    expect(switchOffOffer()).toBeNull();
    expect(screen.getByTestId('packaged-clone-source-off').textContent).toBe(
      'The packaged flow "Notify owner" is switched off.',
    );
    // The result itself stays: the switch-off is a step after the clone, not
    // a reason to forget it.
    expect(screen.getByText('Created flow "crm_notify_owner".')).toBeInTheDocument();
  });

  it('links the clone in the package-less Studio scope (pin b)', async () => {
    await renderPage();
    await cloneRow('pkg_notify', 'crm_notify_owner');

    const open = screen.getByTestId('packaged-clone-open');
    expect(open.textContent).toBe('Open the clone in Studio');
    const href = open.getAttribute('href') ?? '';
    expect(href.startsWith('/studio/~org/automations')).toBe(true);
    expect(decodeURIComponent(href)).toContain('crm_notify_owner');
  });

  it('shows a refused switch-off verbatim and keeps the offer (pin c)', async () => {
    fixture.toggle = [{ status: 403, body: errorEnvelope('PERMISSION_DENIED', POSTURE_REFUSAL) }];
    await renderPage();
    await cloneRow('pkg_notify', 'crm_notify_owner');

    fireEvent.click(switchOffOffer()!);
    const alert = await screen.findByText(POSTURE_REFUSAL);
    expect(alert).toHaveAttribute('role', 'alert');
    expect(within(screen.getByTestId('packaged-clone-next-steps')).getByText(POSTURE_REFUSAL)).toBe(alert);
    // The offer stays, usable, and the source is still on.
    expect(switchOffOffer()).not.toBeNull();
    expect(switchOffOffer()).toBeEnabled();
    expect(rowSwitch('Notify owner')).toBeChecked();
    expect(screen.getByText(CLONE_NOTICE)).toBeInTheDocument();
  });

  it('offers no switch-off when the source is already off (pin d, control)', async () => {
    await renderPage();
    expect(rowSwitch('Escalate case')).not.toBeChecked();
    await cloneRow('pkg_escalate', 'crm_escalate');

    expect(screen.getByText(CLONE_NOTICE)).toBeInTheDocument();
    expect(switchOffOffer()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Switch .* off$/ })).toBeNull();
    expect(screen.getByTestId('packaged-clone-source-off').textContent).toBe(
      'The packaged flow "Escalate case" is switched off.',
    );
    expect(toggleCalls()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 9) The clone prefill (objectui#13344)                                       */
/* -------------------------------------------------------------------------- */

describe('the clone dialog opens on a usable default name', () => {
  /**
   * The rule `FlowSchema.name` holds a flow's machine name to. Transcribed as
   * fixture text (`@object-ui/app-shell` does not read the spec's zod faces):
   * the default this page proposes must be one the server can accept.
   */
  const FLOW_NAME_SHAPE = /^[a-z_][a-z0-9_]*$/;

  it('prefills <source>_copy and "<label> (copy)", and submits them as they stand', async () => {
    await renderPage();

    fireEvent.click(cloneButtonFor('pkg_notify'));
    const name = await screen.findByLabelText('New machine name');
    expect(name).toHaveValue('pkg_notify_copy');
    expect((name as HTMLInputElement).value).toMatch(FLOW_NAME_SHAPE);
    expect(screen.getByLabelText('New label')).toHaveValue('Notify owner (copy)');

    const confirm = screen.getByRole('button', { name: 'Create clone' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(cloneCalls()).toHaveLength(1));
    expect(cloneCalls()[0].url).toContain('/automation/pkg_notify/clone');
    expect(cloneCalls()[0].body).toEqual({ name: 'pkg_notify_copy', label: 'Notify owner (copy)' });
    expect(await screen.findByText('Created flow "pkg_notify_copy".')).toBeInTheDocument();
  });

  it('prefills from the row that was clicked, not from the first row', async () => {
    await renderPage();

    fireEvent.click(cloneButtonFor('pkg_escalate'));
    expect(await screen.findByLabelText('New machine name')).toHaveValue('pkg_escalate_copy');
    expect(screen.getByLabelText('New label')).toHaveValue('Escalate case (copy)');
  });

  it('falls back to the machine name when the source flow declares no label', async () => {
    fixture.runtime.push({ name: 'pkg_unlabelled', enabled: true, bound: true });
    fixture.meta.push({ name: 'pkg_unlabelled', _packageId: 'com.objectstack.crm', _provenance: 'package' });
    await renderPage();

    fireEvent.click(cloneButtonFor('pkg_unlabelled'));
    expect(await screen.findByLabelText('New machine name')).toHaveValue('pkg_unlabelled_copy');
    expect(screen.getByLabelText('New label')).toHaveValue('pkg_unlabelled (copy)');
  });

  it('keeps both prefilled fields editable, and sends what was typed', async () => {
    await renderPage();

    fireEvent.click(cloneButtonFor('pkg_notify'));
    fireEvent.change(await screen.findByLabelText('New machine name'), {
      target: { value: 'pkg_notify_copy_2' },
    });
    fireEvent.change(screen.getByLabelText('New label'), { target: { value: 'Notify owner (second copy)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create clone' }));

    await waitFor(() => expect(cloneCalls()).toHaveLength(1));
    expect(cloneCalls()[0].body).toEqual({ name: 'pkg_notify_copy_2', label: 'Notify owner (second copy)' });
  });

  it('answers a taken default with the server\'s 409 verbatim, keeping the default in place', async () => {
    fixture.clone = [{ status: 409, body: errorEnvelope('RESOURCE_CONFLICT', CLONE_CONFLICT_REFUSAL) }];
    await renderPage();

    fireEvent.click(cloneButtonFor('pkg_notify'));
    fireEvent.click(await screen.findByRole('button', { name: 'Create clone' }));

    expect(await screen.findByText(CLONE_CONFLICT_REFUSAL)).toBeInTheDocument();
    expect(cloneCalls()[0].body).toEqual({ name: 'pkg_notify_copy', label: 'Notify owner (copy)' });
    expect(screen.getByLabelText('New machine name')).toHaveValue('pkg_notify_copy');
    expect(screen.getByLabelText('New label')).toHaveValue('Notify owner (copy)');
  });
});
