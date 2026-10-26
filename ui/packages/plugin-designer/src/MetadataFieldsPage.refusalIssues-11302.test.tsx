/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11302 — a save the spec refuses shows the per-field prescription,
 * through the ONE metadata-save error reader.
 *
 * ## The defect
 *
 * The `/meta` write doors answer a spec-refused save with `422
 * INVALID_METADATA`. The error's message is a HEADLINE — a count plus `path
 * [code]` locators — and the prose that tells the author what to do rides the
 * structured channel beside it, which `MetadataClient` surfaces as
 * `err.issues`. This page showed `err.message` only, so an author who typed
 * `Bad Name` read "object/probe_widget failed spec validation: 2 issues — …"
 * and never "Field names must be lowercase snake_case". The app-shell surfaces
 * already rendered the issues through `formatMetadataError`; the page could not
 * import it from there (app-shell depends on this package), so the reader moved
 * down to `@object-ui/data-objectstack`, beside the `MetadataError` it reads,
 * and the page calls it. ⛔ No second issue formatter: the cases below assert
 * the banner is byte-for-byte that reader's output.
 *
 * ## The harness
 *
 * The REAL page, the REAL `FieldDesigner` and its REAL `DrawerForm` (the author
 * types the name and presses the drawer's submit), and a REAL `MetadataClient`
 * over a fetch double. `ObjectGrid` is the designer suite's grid mock, kept for
 * its "Add" affordance only: the grid is not on the save path.
 *
 * The fetch double is a GATE: it runs the installed `@objectstack/spec`
 * `ObjectSchema` over every PUT body and refuses what the spec refuses, with the
 * envelope objectstack's `metadata-protocol` builds in `saveMetaItem` and the
 * HTTP dispatcher sends — `{ success: false, error: { code, message, details:
 * { issues } } }`, where `message` is the headline `specValidationFindings`
 * renders on the `/meta` faces and `issues` follows `zodIssuesToMetadataIssues`
 * (each zod issue, then the issues a container's `invalid_key` carries one
 * level down — which is where the snake_case rule lives). ⛔ Not a live server.
 * A valid name passes the same gate (the control), so the refusals are verdicts
 * about the name, not a double that refuses everything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';
import {
  MetadataClient,
  formatMetadataIssue,
  type MetadataValidationIssue,
} from '@object-ui/data-objectstack';

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__tests__/__mocks__/plugin-grid')),
}));

import { MetadataFieldsPage } from './MetadataFieldsPage';

// ---------------------------------------------------------------------------
// The gate double
// ---------------------------------------------------------------------------

const STORED = {
  name: 'probe_widget',
  label: 'Widget',
  fields: { name: { type: 'text', label: 'Name' } },
};

interface ZodIssueLike {
  path: Array<string | number>;
  message: string;
  code: string;
  issues?: ZodIssueLike[];
}

/** `zodIssuesToMetadataIssues`' walk, as far as these probes reach it. */
function toMetadataIssues(issues: readonly ZodIssueLike[]): MetadataValidationIssue[] {
  return issues.flatMap((i) => [
    { path: i.path.join('.'), message: i.message, code: i.code },
    ...(i.code === 'invalid_key' && Array.isArray(i.issues)
      ? i.issues.map((n) => ({ path: [...i.path, ...n.path].join('.'), message: n.message, code: n.code }))
      : []),
  ]);
}

/** The `/meta` faces' headline: count plus `path [code]` locators, no prose. */
function headline(issues: readonly MetadataValidationIssue[]): string {
  const locators = issues
    .slice(0, 3)
    .map((i) => `${i.path || '<root>'}${i.code ? ` [${i.code}]` : ''}`)
    .join('; ');
  return `${issues.length} issue${issues.length === 1 ? '' : 's'} — ${locators}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Every PUT body, parsed back from the bytes that went over the wire. */
let puts: Array<Record<string, unknown>> = [];
/** The refusal the gate sent for the last refused PUT, if any. */
let refusal: { message: string; issues: MetadataValidationIssue[] } | null = null;
/** When set, the store is down: every PUT answers this instead of being judged. */
let outage: Response | null = null;

function gatedClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        puts.push(body);
        if (outage) return outage;
        const parsed = ObjectSchema.safeParse(body);
        if (parsed.success) return json({ success: true, name: 'probe_widget' });
        const issues = toMetadataIssues(parsed.error.issues as unknown as ZodIssueLike[]);
        refusal = {
          message: `object/probe_widget failed spec validation: ${headline(issues)}`,
          issues,
        };
        return json(
          {
            success: false,
            error: {
              code: 'INVALID_METADATA',
              message: refusal.message,
              details: { code: 'INVALID_METADATA', issues },
            },
          },
          422,
        );
      }
      if (/\/meta\/object\/probe_widget(\?|$)/.test(url)) {
        return json({ type: 'object', name: 'probe_widget', item: STORED });
      }
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

// ---------------------------------------------------------------------------
// Driving the page as an author does
// ---------------------------------------------------------------------------

/** Open the designer's create drawer, type a field, and press submit. */
async function addFieldThroughDrawer(name: string): Promise<void> {
  render(<MetadataFieldsPage objectName="probe_widget" client={gatedClient()} />);
  fireEvent.click(await screen.findByTestId('grid-add-btn'));
  const input = (field: string) => document.body.querySelector(`[data-field="${field}"] input`) as HTMLInputElement | null;
  await waitFor(() => expect(input('name'), 'the drawer rendered no `name` input: the harness is dead').not.toBeNull());
  fireEvent.change(input('name')!, { target: { value: name } });
  fireEvent.change(input('label')!, { target: { value: 'Probe' } });
  fireEvent.click(document.body.querySelector('button[type="submit"]') as HTMLButtonElement);
  await waitFor(() => expect(puts).toHaveLength(1));
}

/** The banner text once the save has failed. */
async function banner(): Promise<string> {
  return (await screen.findByTestId('metadata-fields-page-error')).textContent ?? '';
}

/** The issues of a spec reading, flattened the way the gate flattens them. */
function specIssuesFor(name: string): MetadataValidationIssue[] {
  const fields: Record<string, unknown> = { name: { type: 'text', label: 'Name' } };
  Object.defineProperty(fields, name, {
    value: { type: 'text', label: 'Probe' },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const parsed = ObjectSchema.safeParse({ ...STORED, fields });
  expect(parsed.success, `the spec accepted \`${name}\`: the probe measures nothing`).toBe(false);
  return toMetadataIssues((parsed.success ? [] : parsed.error.issues) as unknown as ZodIssueLike[]);
}

beforeEach(() => {
  puts = [];
  refusal = null;
  outage = null;
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------

describe('the instrument — what the installed spec says about each probe name', () => {
  it('`Bad Name`: refused at its key, and the prescription rides one level down', () => {
    const issues = specIssuesFor('Bad Name');
    expect(issues.map((i) => `${i.code} @ ${i.path}`)).toEqual([
      'invalid_key @ fields.Bad Name',
      'invalid_format @ fields.Bad Name',
    ]);
    expect(issues[1].message).toMatch(/lowercase snake_case/);
  });

  it('`__proto__`: refused by name, and the message says what to do', () => {
    const issues = specIssuesFor('__proto__');
    expect(issues.map((i) => `${i.code} @ ${i.path}`)).toEqual(['custom @ fields.__proto__']);
    expect(issues[0].message).toMatch(/Rename the key/);
  });

  it('`constructor`: refused at its key since objectstack#20997', () => {
    // The upstream pair: through 17.5.0 the reserved-name refusal was raised on
    // the map, not on the key (`custom @ fields`). objectstack#20997 names the
    // key, and `@objectstack/spec` 17.6.0 carries it, so this reading moved at
    // that bump (objectui#11438). The page renders whatever path it is given.
    const issues = specIssuesFor('constructor');
    expect(issues.map((i) => `${i.code} @ ${i.path}`)).toEqual(['custom @ fields.constructor']);
  });
});

describe('objectui#11302 · a spec-refused save shows the per-field prescription', () => {
  it('`Bad Name`: the banner lists every issue the gate sent, prescription included', async () => {
    await addFieldThroughDrawer('Bad Name');
    const shown = await banner();

    expect(refusal, 'the gate accepted `Bad Name`: nothing was refused').not.toBeNull();
    // Through the ONE reader: byte-for-byte its grammar, one issue per line.
    expect(shown).toBe(refusal!.issues.map(formatMetadataIssue).join('\n'));
    expect(shown).toMatch(/fields\.Bad Name — Field names must be lowercase snake_case/);
    // The headline alone is what the page used to show.
    expect(shown).not.toBe(refusal!.message);
  });

  it('`__proto__`: the banner names the key and says to rename it', async () => {
    await addFieldThroughDrawer('__proto__');
    const shown = await banner();

    expect(refusal).not.toBeNull();
    expect(shown).toBe(refusal!.issues.map(formatMetadataIssue).join('\n'));
    expect(shown).toMatch(/^• fields\.__proto__ — .*Rename the key\.$/);
  });

  it('`constructor`: the banner names the key, with its prescription', async () => {
    await addFieldThroughDrawer('constructor');
    const shown = await banner();

    expect(refusal).not.toBeNull();
    expect(shown).toBe(refusal!.issues.map(formatMetadataIssue).join('\n'));
    expect(shown).toMatch(/^• fields\.constructor — .*constructor/);
  });

  it('the multi-line list keeps its newlines on screen', async () => {
    await addFieldThroughDrawer('Bad Name');
    const el = await screen.findByTestId('metadata-fields-page-error');
    expect((el.textContent ?? '').split('\n')).toHaveLength(2);
    // A `pre` with `whitespace-pre-wrap` renders each `\n` as a line break.
    expect(el.tagName).toBe('PRE');
    expect(el.className).toContain('whitespace-pre-wrap');
  });
});

describe('objectui#11302 · controls', () => {
  it('a valid name passes the same gate and saves, with no banner', async () => {
    await addFieldThroughDrawer('good_name');

    expect(refusal).toBeNull();
    expect(Object.keys(puts[0].fields as Record<string, unknown>)).toEqual(['name', 'good_name']);
    expect(screen.queryByTestId('metadata-fields-page-error')).toBeNull();
  });

  it('a failure that carries no issues still shows its own message', async () => {
    outage = json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The metadata store could not be read, so whether this item exists is unknown.',
        },
      },
      503,
    );
    await addFieldThroughDrawer('good_name');

    expect(await banner()).toBe('The metadata store could not be read, so whether this item exists is unknown.');
  });
});
