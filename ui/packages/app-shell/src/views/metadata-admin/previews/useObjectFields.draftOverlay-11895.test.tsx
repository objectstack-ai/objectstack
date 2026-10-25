// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `useObjectFields` reads the DRAFT-OVERLAID object (objectui#11895).
 *
 * The hook asked for the published object only. For an object that is still
 * an unpublished draft that read answers 404, so every field picker built on
 * the hook offered no fields for it, and the flow Start node's entry-condition
 * builder listed only `previous`.
 *
 * The transport here is the REAL `MetadataClient` over a stub `fetch` that
 * answers the way the framework's meta item read answers: `?preview=draft`
 * serves the pending draft when there is one and the active object otherwise
 * (objectstack's `protocol-meta.test.ts`, "falls back to active when
 * previewDrafts but no draft exists"), and the plain read serves the active
 * object or 404. So the assertions read what the hook ASKS the server, not
 * what a double of the client happens to return.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, renderHook, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MetadataClient } from '@object-ui/data-objectstack';

type FieldDefs = Record<string, { type: string; label: string; hidden?: boolean }>;

/** What the stub server holds: published objects, and pending drafts. */
interface World {
  published: Record<string, FieldDefs>;
  drafts: Record<string, FieldDefs>;
}

const WORLD: World = {
  published: {
    // A published object with no draft — the control.
    account: {
      name: { type: 'text', label: 'Name' },
      industry: { type: 'select', label: 'Industry' },
    },
    // A published object with a pending draft that adds a field.
    contact: {
      email: { type: 'email', label: 'Email' },
    },
  },
  drafts: {
    contact: {
      email: { type: 'email', label: 'Email' },
      phone: { type: 'phone', label: 'Phone' },
    },
    // Built in Studio and never published: the card's `repair_ticket`.
    repair_ticket: {
      issue_summary: { type: 'text', label: 'Issue summary' },
      severity: { type: 'select', label: 'Severity' },
    },
  },
};

const h = vi.hoisted(() => ({
  client: undefined as unknown,
  urls: [] as string[],
}));

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => h.client,
}));

import { useObjectFields } from './useObjectFields';
import { t, useMetadataLocale } from '../i18n';
import { FlowNodeConfigField } from '../inspectors/FlowNodeConfigField';
import { fieldsForNodeType, type FlowConfigField } from '../inspectors/flow-node-config';
import { resolveFlowScope, type TriggerScope } from '../inspectors/flow-scope';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The framework's `GET /meta/object/NAME` read, with and without `?preview=draft`. */
function installServer(world: World): void {
  h.urls = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    h.urls.push(url);
    const u = new URL(url);
    const item = u.pathname.match(/\/api\/v1\/meta\/object\/([^/]+)$/);
    if (item) {
      const name = decodeURIComponent(item[1]);
      const preview = u.searchParams.get('preview') === 'draft';
      const fields = (preview ? world.drafts[name] : undefined) ?? world.published[name];
      if (!fields) return json(404, { success: false, error: { code: 'not_found', message: 'Not found' } });
      return json(200, {
        type: 'object',
        name,
        item: { name, fields, ...(preview && world.drafts[name] ? { _draft: true } : {}) },
      });
    }
    // Anything else a mounted editor asks for (lists, other items): nothing.
    if (/\/api\/v1\/meta\/[^/]+$/.test(u.pathname)) return json(200, []);
    return json(404, { success: false, error: { code: 'not_found', message: 'Not found' } });
  }) as typeof fetch;
  h.client = new MetadataClient({ baseUrl: 'http://meta.test', fetch: fetchImpl });
}

/** The object item reads the hook sent for `name`. */
function objectReads(name: string): string[] {
  return h.urls.filter((u) => new URL(u).pathname.endsWith(`/meta/object/${name}`));
}

async function fieldsOf(name: string, override?: Parameters<typeof useObjectFields>[1]) {
  const hook = renderHook(() => ({ result: useObjectFields(name, override), locale: useMetadataLocale() }));
  await waitFor(() => expect(hook.result.current.result.loading).toBe(false));
  return hook.result.current;
}

afterEach(cleanup);

describe('useObjectFields reads the draft-overlaid object (objectui#11895)', () => {
  it('answers a DRAFT-ONLY object with its draft fields, in one request', async () => {
    installServer(WORLD);
    const { result } = await fieldsOf('repair_ticket');
    expect(result.error).toBeNull();
    expect(result.fields.map((f) => f.name)).toEqual(['issue_summary', 'severity']);
    expect(result.fields.find((f) => f.name === 'issue_summary')?.label).toBe('Issue summary');
    const reads = objectReads('repair_ticket');
    expect(reads).toHaveLength(1);
    expect(new URL(reads[0]).searchParams.get('preview')).toBe('draft');
  });

  it('answers a published object WITH a pending draft with the draft (the overlay)', async () => {
    installServer(WORLD);
    const { result } = await fieldsOf('contact');
    expect(result.error).toBeNull();
    expect(result.fields.map((f) => f.name)).toEqual(['email', 'phone']);
  });

  it('CONTROL — a published object with no draft reads as before, in one request', async () => {
    installServer(WORLD);
    const { result } = await fieldsOf('account');
    expect(result.error).toBeNull();
    expect(result.fields.map((f) => f.name)).toEqual(['name', 'industry']);
    expect(objectReads('account')).toHaveLength(1);
  });

  it('a name with neither a draft nor a published object is still not found', async () => {
    installServer(WORLD);
    const { result, locale } = await fieldsOf('no_such_object');
    expect(result.fields).toEqual([]);
    expect(result.error).toBe(t('engine.form.objectNotFound', locale));
    expect(objectReads('no_such_object')).toHaveLength(1);
  });

  it('CONTROL — an override still short-circuits the read', async () => {
    installServer(WORLD);
    const override = [{ name: 'x', label: 'X', type: 'text', hidden: false }];
    const { result } = await fieldsOf('repair_ticket', override);
    expect(result.fields).toBe(override);
    expect(h.urls).toEqual([]);
  });
});

/* ── the surface the card measured: the flow Start node's entry condition ── */

beforeAll(() => {
  // Radix Select probes pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

/** The Start node's `Entry condition` descriptor, read from the shipped config. */
const ENTRY_CONDITION: FlowConfigField = (() => {
  const f = fieldsForNodeType('start').find((x) => x.id === 'condition');
  if (!f) throw new Error('start node has no `condition` field — the card premise moved');
  return f;
})();

/** A record-triggered flow selected at its start node, triggered on `objectName`. */
function startNodeScope(objectName: string): TriggerScope | undefined {
  const draft = {
    nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-write', objectName } }],
    edges: [],
  };
  return resolveFlowScope(draft, 'start').trigger;
}

/** Open the entry condition's SUBJECT dropdown and read every subject it offers. */
async function entrySubjects(objectName: string, expectField: string): Promise<string[]> {
  const { container } = render(
    <FlowNodeConfigField
      field={ENTRY_CONDITION}
      value="placeholder_subject == 'x'"
      onCommit={() => {}}
      triggerScope={startNodeScope(objectName)}
    />,
  );
  const trigger = container.querySelectorAll('[role="combobox"]')[0] as HTMLElement;
  await userEvent.click(trigger);
  // Waits for the catalog: the options follow the field read when it lands.
  await screen.findByRole('option', { name: expectField });
  return screen.getAllByRole('option').map((o) => o.textContent ?? '');
}

describe('the flow entry-condition builder offers a draft-only object\'s fields (objectui#11895)', () => {
  it('offers the draft object\'s fields, not only `previous`', async () => {
    installServer(WORLD);
    const opts = await entrySubjects('repair_ticket', 'issue_summary');
    expect(opts).toContain('issue_summary');
    expect(opts).toContain('severity');
    expect(opts).toContain('previous.issue_summary');
  });

  it('CONTROL — a published object\'s fields are offered as before', async () => {
    installServer(WORLD);
    const opts = await entrySubjects('account', 'industry');
    expect(opts).toContain('name');
    expect(opts).toContain('industry');
  });
});
