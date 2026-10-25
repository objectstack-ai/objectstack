// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11660 — the SLA escalation switch never writes the bare
 * `{ enabled: false }` block `ApprovalNodeConfigSchema` refuses, and switching
 * it off keeps every value the author entered.
 *
 * The governing text is the spec's own: `ApprovalEscalationSchema.enabled` is
 * described as "an escalation block carrying timeoutHours is live unless this
 * is explicitly false — the feature-level switch is whether the escalation
 * block exists at all", and the block's `timeoutHours` is required whatever
 * `enabled` says. So `{ enabled: false, timeoutHours: N }` and no block are both
 * a conforming OFF; the bare stub is not. Triage's amended direction (comment
 * 6003792818 on the card, replacing 6000059097 under objectui#6499 Option C):
 *
 *  1. no block reads OFF, and rendering writes nothing;
 *  2. switching off with no entered value writes no block;
 *  3. switching off a block that holds values writes `enabled: false` and keeps
 *     every value — the "inactive values retained" display carries them;
 *  4. clearing the last retained value removes the block;
 *  5. a block with values but no `timeoutHours` keeps its values on switch-off:
 *     nothing filled in, nothing deleted, and its refusal is neither created
 *     nor hidden by the switch.
 *
 * A block that omits `enabled` reads ON (the objectui#6620 pin), and a stored
 * `enabled: false` reads OFF.
 *
 * Every case runs twice, once per DESCRIPTOR SOURCE, because the inspector
 * renders `serverFields ?? fieldsForNodeType(...)`:
 *
 *  - `offline` — the hand-written table in `flow-node-config.ts`;
 *  - `engine`  — `getApprovalNodeConfigJsonSchema()` from the installed
 *    `@objectstack/spec/automation`, fed as the approval node's published
 *    `configSchema`. That function is what objectstack's `plugin-approvals`
 *    hands its approval node descriptor as `configSchema` (`approval-node.ts`,
 *    read at objectstack `6afb1b55`), so this is the shape a live backend
 *    publishes, not a hand-written imitation of it. It labels the fields from
 *    the schema (`Escalation`, `Timeout Hours`, …), which is why the labels
 *    below are per source.
 *
 * Round-trips are judged by `ApprovalNodeConfigSchema` imported from the
 * `@objectstack/spec/automation` SUBPATH — `ApprovalEscalationSchema` is not on
 * the package root.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const stubs = vi.hoisted(() => ({ configSchemas: {} as Record<string, unknown> }));

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => stubs.configSchemas,
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';
import { ApprovalNodeConfigSchema, getApprovalNodeConfigJsonSchema } from '@objectstack/spec/automation';

/* ── The `meta/*` double (objectui#7307), as the sibling inspector files
 * serve it: an empty registry in the `{ type, items: [] }` envelope, and an
 * `afterEach` that fails on any URL outside the metadata routes. ── */
const META_PREFIX = '/api/v1/meta/';
let calls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  stubs.configSchemas = {};
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      calls.push(url);
      const route = routeOf(url);
      if (!route.startsWith(META_PREFIX)) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ type: route.slice(META_PREFIX.length), items: [] }),
      };
    }),
  );
});

afterEach(() => {
  expect(calls.filter((url) => !routeOf(url).startsWith(META_PREFIX))).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

type Config = Record<string, unknown>;
type Draft = { nodes: Array<Record<string, unknown>>; edges: unknown[] };

const APPROVERS = [{ type: 'user', value: 'usr_approver' }];

function draftWith(config: Config): Draft {
  return { nodes: [{ id: 'gate', type: 'approval', label: 'Gate', config }], edges: [] };
}

const configOf = (draft: Draft): Config | undefined => draft.nodes[0].config as Config | undefined;

/**
 * The editor loop: every patch is applied to the draft the inspector renders
 * next, as the host does. `latest()` is the draft a save would send.
 */
function mount(initial: Draft) {
  let current = initial;
  const patches: unknown[] = [];
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    return (
      <FlowNodeInspector
        type="flow"
        name="renewal"
        draft={draft}
        selection={{ kind: 'node', id: 'gate' } as MetadataSelection}
        onPatch={(patch) => {
          patches.push(patch);
          setDraft((d) => {
            current = { ...d, ...(patch as Partial<Draft>) };
            return current;
          });
        }}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="en-US"
      />
    );
  }
  const utils = render(<Host />);
  return { ...utils, patches, latest: () => current };
}

interface Labels {
  gate: string;
  timeout: string;
  action: string;
  escalateTo: string;
  notify: string;
  reassign: string;
}

const SOURCES: Array<{ name: 'offline' | 'engine'; labels: Labels; install: () => void }> = [
  {
    name: 'offline',
    labels: {
      gate: 'SLA escalation',
      timeout: 'Timeout (hours)',
      action: 'On timeout',
      escalateTo: 'Escalate to',
      notify: 'Notify submitter',
      reassign: 'Reassign',
    },
    install: () => {
      stubs.configSchemas = {};
    },
  },
  {
    name: 'engine',
    labels: {
      gate: 'Escalation',
      timeout: 'Timeout Hours',
      action: 'Action',
      escalateTo: 'Escalate To',
      notify: 'Notify Submitter',
      reassign: 'Reassign',
    },
    install: () => {
      stubs.configSchemas = { approval: getApprovalNodeConfigJsonSchema() };
    },
  },
];

const gateBox = (l: Labels) => screen.queryByLabelText(l.gate) as HTMLInputElement | null;
/**
 * A sub-field's control by its label, read the way `getByText` reads a label —
 * its own text, without the required marker (`SchemaForm`'s `*`). Since
 * `@objectstack/spec` 17.7.0 judges an approval node's config against
 * `ApprovalNodeConfigSchema` (objectstack#21893), the inspector marks the
 * escalation block's required `timeoutHours`, and a whole-label match on the
 * plain text stopped resolving (objectui#11717).
 */
const controlLabelled = (text: string) =>
  screen.getByLabelText(new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?$`));
const subLabels = (l: Labels) => [l.timeout, l.action, l.escalateTo, l.notify];
const shownSubFields = (l: Labels) => subLabels(l).filter((label) => screen.queryByText(label) !== null);
const retainedNotices = () => screen.queryAllByTestId('inactive-retained');

/** The free-text input of the `Escalate to` reference field (no data adapter is mounted, so it is a plain input). */
function escalateToInput(l: Labels): HTMLInputElement {
  const label = screen.getByText(l.escalateTo);
  const input = label.parentElement?.querySelector('input');
  if (!input) throw new Error(`no input beside '${l.escalateTo}'`);
  return input as HTMLInputElement;
}

for (const source of SOURCES) {
  const l = source.labels;

  describe(`${source.name} descriptors: a node with no escalation block reads OFF (objectui#11660)`, () => {
    beforeEach(source.install);

    it('the toggle draws unchecked and no escalation field is revealed', () => {
      const draft = draftWith({ approvers: APPROVERS });
      const before = JSON.stringify(draft);
      const { patches } = mount(draft);
      const box = gateBox(l);
      expect(box, 'the switch is on screen').not.toBeNull();
      expect(box!.checked, 'no block is OFF — the spec calls the block itself the switch').toBe(false);
      expect(shownSubFields(l), 'none of the four escalation fields is revealed over no block').toEqual([]);
      // A read: rendering the corrected toggle writes nothing.
      expect(patches, 'rendering patches the draft zero times').toEqual([]);
      expect(JSON.stringify(draft), 'and the draft is unchanged byte for byte').toBe(before);
    });

    it('lit control: a block that omits `enabled` still reads ON and reveals its fields (objectui#6620)', () => {
      mount(draftWith({ approvers: APPROVERS, escalation: { timeoutHours: 24 } }));
      expect(gateBox(l)!.checked, 'inside a block, the spec default `true` applies').toBe(true);
      expect(shownSubFields(l)).toEqual(subLabels(l));
    });

    it('a stored `enabled: false` reads OFF', () => {
      mount(draftWith({ approvers: APPROVERS, escalation: { enabled: false } }));
      expect(gateBox(l)!.checked).toBe(false);
      expect(shownSubFields(l)).toEqual([]);
    });
  });

  describe(`${source.name} descriptors: switching escalation off (objectui#11660, triage 6003792818)`, () => {
    beforeEach(source.install);

    it('rule 3: a block holding every value gains `enabled: false`, every value and every sibling key byte-identical', () => {
      const siblings: Config = {
        approvers: APPROVERS,
        behavior: 'quorum',
        minApprovals: 1,
        onEmptyApprovers: 'fail',
        lockRecord: false,
        maxRevisions: 2,
        // An Advanced (JSON) extra — a key no form field owns.
        custom_note: { kept: ['as', 'is'] },
      };
      const config: Config = {
        ...siblings,
        escalation: { enabled: true, timeoutHours: 24, action: 'reassign', escalateTo: 'sre_lead', notifySubmitter: false },
      };
      const { latest } = mount(draftWith(config));
      expect(gateBox(l)!.checked, 'premise: escalation is on').toBe(true);

      gateBox(l)!.click();

      const { escalation, ...rest } = configOf(latest())!;
      // Byte-identical, key order included: the switch is the one key that moved.
      expect(JSON.stringify(escalation)).toBe(
        JSON.stringify({ enabled: false, timeoutHours: 24, action: 'reassign', escalateTo: 'sre_lead', notifySubmitter: false }),
      );
      expect(JSON.stringify(rest), 'the sibling config keys are untouched').toBe(JSON.stringify(siblings));
      const parsed = ApprovalNodeConfigSchema.safeParse({ approvers: APPROVERS, escalation });
      expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);

      // What the author sees next: the switch off, and the four values on screen
      // as retained, not in effect (objectui#6499 Option C).
      expect(gateBox(l)!.checked, 'the stored false reads off').toBe(false);
      expect(shownSubFields(l)).toEqual(subLabels(l));
      expect(retainedNotices()).toHaveLength(4);
    });

    it('rule 3: a block that omits `enabled` keeps its value and gains `enabled: false`', () => {
      const { latest } = mount(draftWith({ approvers: APPROVERS, escalation: { timeoutHours: 8 } }));
      gateBox(l)!.click();
      expect(configOf(latest())).toEqual({ approvers: APPROVERS, escalation: { timeoutHours: 8, enabled: false } });
    });

    it('rule 2: switching on writes only the switch, and switching off with nothing entered leaves no `escalation` key', () => {
      const { latest } = mount(draftWith({ approvers: APPROVERS }));
      gateBox(l)!.click();
      // Nothing the author did not enter is written by switching on: no
      // `action`, no `notifySubmitter` default (shown, never written).
      expect(configOf(latest())!.escalation, 'switching on writes the switch alone').toEqual({ enabled: true });
      gateBox(l)!.click();
      expect(configOf(latest()), 'no `{ enabled: false }` stub is written').toEqual({ approvers: APPROVERS });
      expect(gateBox(l)!.checked).toBe(false);
    });

    it('rule 2: an emptied `config` is pruned with the block', () => {
      const { latest } = mount(draftWith({ escalation: { enabled: true } }));
      gateBox(l)!.click();
      expect(latest().nodes[0], 'removing the only config key leaves no empty `config` object').not.toHaveProperty('config');
    });

    it('rule 5: a block with values but no `timeoutHours` keeps them, gains no `timeoutHours`, and stays refused where it was', () => {
      const before: Config = { approvers: APPROVERS, escalation: { enabled: true, action: 'reassign' } };
      const refusedAt = (cfg: Config) => {
        const r = ApprovalNodeConfigSchema.safeParse(cfg);
        return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
      };
      expect(refusedAt(before), 'premise: refused at the missing hours before the switch').toEqual(['escalation.timeoutHours']);
      const { latest } = mount(draftWith(before));
      gateBox(l)!.click();
      const after = configOf(latest())!;
      expect(after.escalation, 'the value stays; nothing is filled in').toEqual({ enabled: false, action: 'reassign' });
      expect(refusedAt(after), 'the switch neither creates nor hides that refusal').toEqual(['escalation.timeoutHours']);
    });

    it('rule 4 on a block rule 3 wrote: clearing its last retained value leaves no block', () => {
      const { latest } = mount(draftWith({ approvers: APPROVERS, escalation: { enabled: true, timeoutHours: 24 } }));
      gateBox(l)!.click();
      expect(configOf(latest())!.escalation, 'premise: rule 3 kept the hours').toEqual({ enabled: false, timeoutHours: 24 });
      fireEvent.click(within(retainedNotices()[0]).getByRole('button', { name: /clear value/i }));
      expect(configOf(latest())).toEqual({ approvers: APPROVERS });
    });
  });

  describe(`${source.name} descriptors: an inspector-authored node round-trips through ApprovalNodeConfigSchema (objectui#11660)`, () => {
    beforeEach(source.install);

    it('escalation ON with every value parses and keeps every value; OFF keeps every value beside `enabled: false` and parses', async () => {
      const { latest } = mount(draftWith({ approvers: APPROVERS }));
      expect(gateBox(l)!.checked, 'premise: a fresh node starts off').toBe(false);

      // ON, authored control by control through the inspector.
      gateBox(l)!.click();
      expect(gateBox(l)!.checked, 'switching on draws the switch on').toBe(true);
      fireEvent.change(controlLabelled(l.timeout), { target: { value: '24' } });
      await userEvent.click(screen.getByRole('combobox', { name: l.action }));
      await userEvent.click(await screen.findByRole('option', { name: l.reassign }));
      fireEvent.change(escalateToInput(l), { target: { value: 'sre_lead' } });
      (controlLabelled(l.notify) as HTMLInputElement).click();

      const onConfig = configOf(latest())!;
      const authored = { enabled: true, timeoutHours: 24, action: 'reassign', escalateTo: 'sre_lead', notifySubmitter: false };
      expect(onConfig.escalation, 'the inspector stored exactly what the author entered').toEqual(authored);
      const on = ApprovalNodeConfigSchema.safeParse(onConfig);
      expect(on.success, on.success ? '' : JSON.stringify(on.error.issues)).toBe(true);
      expect((on.data as { escalation?: unknown }).escalation, 'and the contract keeps every value').toEqual(authored);

      // OFF, values retained.
      gateBox(l)!.click();
      const offConfig = configOf(latest())!;
      const retained = { ...authored, enabled: false };
      expect(JSON.stringify(offConfig.escalation), 'every value identical, the switch false').toBe(JSON.stringify(retained));
      const off = ApprovalNodeConfigSchema.safeParse(offConfig);
      expect(off.success, off.success ? '' : JSON.stringify(off.error.issues)).toBe(true);
      expect((off.data as { escalation?: unknown }).escalation, 'and the contract keeps them, switched off').toEqual(retained);
    });
  });

  describe(`${source.name} descriptors: a stored switched-off block (objectui#11660)`, () => {
    beforeEach(source.install);

    it('`{ enabled: false, timeoutHours: 24 }` reads OFF, shows the retained value, and writes nothing on render', () => {
      // A shape the spec ACCEPTS, and the one rule 3 writes. It is read, never
      // rewritten on sight.
      expect(ApprovalNodeConfigSchema.safeParse({ approvers: APPROVERS, escalation: { enabled: false, timeoutHours: 24 } }).success).toBe(true);
      const draft = draftWith({ approvers: APPROVERS, escalation: { enabled: false, timeoutHours: 24 } });
      const before = JSON.stringify(draft);
      const { patches } = mount(draft);
      expect(gateBox(l)!.checked).toBe(false);
      expect(shownSubFields(l), 'the stored value is re-shown (objectui#6499)').toEqual([l.timeout]);
      expect(retainedNotices(), 'and flagged as kept, not in effect').toHaveLength(1);
      expect(patches).toEqual([]);
      expect(JSON.stringify(draft)).toBe(before);
    });

    it('clearing its last retained value leaves no `{ enabled: false }` stub behind', () => {
      const { latest } = mount(draftWith({ approvers: APPROVERS, escalation: { enabled: false, timeoutHours: 24 } }));
      fireEvent.click(within(retainedNotices()[0]).getByRole('button', { name: /clear value/i }));
      const after = configOf(latest())!;
      expect('escalation' in after, 'the bare stub the spec refuses is not written').toBe(false);
      expect(ApprovalNodeConfigSchema.safeParse(after).success).toBe(true);
    });

    it('clearing ONE of two retained values keeps the other — only the bare stub is removed', () => {
      // The boundary of the stub rule: it removes a block holding nothing but
      // the switch, never a value the author did not clear.
      const { latest } = mount(
        draftWith({ approvers: APPROVERS, escalation: { enabled: false, timeoutHours: 24, escalateTo: 'sre_lead' } }),
      );
      expect(retainedNotices(), 'premise: both stored values are retained').toHaveLength(2);
      fireEvent.change(escalateToInput(l), { target: { value: '' } });
      expect(configOf(latest())!.escalation).toEqual({ enabled: false, timeoutHours: 24 });
    });
  });
}
