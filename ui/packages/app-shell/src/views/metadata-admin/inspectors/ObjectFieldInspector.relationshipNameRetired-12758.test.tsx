// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12758 — a lookup-family field's inspector offers no control that
 * writes a key the spec's `FieldSchema` does not declare.
 *
 * ## The defect this file keeps fixed
 *
 * The inspector rendered a "Relationship name" text box on every
 * `lookup` / `master_detail` / `tree` field ("Inverse collection key on the
 * parent"), and each keystroke patched `relationshipName` onto the field.
 * `FieldSchema` never declared that key under any spelling, so the client
 * spec check put the field in the banner (`unrecognized_keys` at
 * `fields.NAME`) and every autosave of the object came back
 * `422 INVALID_METADATA` — including the saves of later, unrelated edits.
 * The spec has no inverse-collection key on the child's field, so the control
 * is removed rather than rebound.
 *
 * ## What is judged, and by what
 *
 * The real inspector, inside a parent that feeds each patch back into the
 * draft as the designer pages do. The sweep is KEY-AGNOSTIC on purpose: it
 * types into every text box the inspector offers on the field (the API-name
 * box excepted, because a rename moves the field to another key) instead of
 * looking the retired control up by its label, so a control that writes an
 * undeclared key under any label turns these pins red. Each draft the sweep
 * produces is judged twice:
 *
 *  - by `ObjectSchema` from `@objectstack/spec/data`, the schema the client
 *    check loads for `object`, for the issue KIND (`unrecognized_keys`);
 *  - by `validateMetadataDraft('object', …, { mode: 'edit' })`, the check the
 *    console runs on an opened object, for an unrecognized-key issue at the
 *    field's own path.
 *
 * Only unrecognized keys are asserted: the sweep types the same word into
 * every box, so a VALUE the spec refuses is not this file's subject.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';

// The lookup section reads the object catalog and the related object through
// the metadata client. ONE hoisted double: `useObjectFields` keys its read on
// the client, so a double minted per call would re-run that read every render.
const h = vi.hoisted(() => {
  const CATALOG: Array<Record<string, unknown>> = [{ name: 'qavrf_job', label: 'QA Job' }];
  const get = async (_type: string, name: string) =>
    name === 'qavrf_job' ? { name, fields: { title: { type: 'text', label: 'Title' } } } : null;
  const client = {
    get,
    withPreviewDrafts: (_on: boolean) => ({ list: async (_type: string) => CATALOG, get }),
    list: async (_type: string) => CATALOG,
    listDrafts: async () => [] as unknown[],
  };
  return { client };
});
vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { validateMetadataDraft } from '../clientValidation';

type Row = Record<string, unknown>;

afterEach(cleanup);

const LOOKUP_FAMILY = ['lookup', 'master_detail', 'tree'] as const;

/** The object the card's reproduction creates over REST, with `job` as the field under edit. */
const objectWith = (job: Row): Row => ({
  name: 'qavrf_rel',
  label: 'QA Rel',
  sharingModel: 'public_read_write',
  fields: {
    name: { type: 'text', label: 'Name' },
    job,
  },
});

const jobOf = (type: string): Row =>
  type === 'tree'
    ? { type, label: 'Job' }
    : { type, label: 'Job', reference: 'qavrf_job' };

/** Real-parent harness: every patch is applied to the draft the next render reads. */
function Designer({ initial, drafts }: { initial: Row; drafts: Row[] }) {
  const [draft, setDraft] = React.useState<Row>(initial);
  return (
    <ObjectFieldInspector
      type="object"
      name="qavrf_rel"
      draft={draft}
      selection={{ kind: 'field', id: 'job' }}
      onPatch={(patch: Row) => {
        setDraft((d) => {
          const next = { ...d, ...patch };
          drafts.push(next);
          return next;
        });
      }}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US'}
    />
  );
}

/** Every text box the inspector renders, minus the API-name box (a rename re-keys the field). */
function textBoxes(container: HTMLElement): Array<HTMLInputElement | HTMLTextAreaElement> {
  const boxes = Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'),
  ).filter((el) => {
    if (el.getAttribute('data-testid') === 'field-apiname-input') return false;
    if (el.disabled) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    const t = (el.getAttribute('type') ?? 'text').toLowerCase();
    return t === 'text' || t === 'search';
  });
  return boxes;
}

/** The `unrecognized_keys` issues the spec's own schema reports for `draft`. */
function unrecognizedKeys(draft: Row): Array<{ path: string; keys: string[] }> {
  const res = ObjectSchema.safeParse(draft);
  if (res.success) return [];
  return res.error.issues
    .filter((i) => i.code === 'unrecognized_keys')
    .map((i) => ({ path: i.path.join('.'), keys: [...((i as { keys?: string[] }).keys ?? [])] }));
}

/** The unrecognized-key messages the console's live check reports at the field's own path. */
async function unrecognizedAtField(draft: Row): Promise<string[]> {
  const res = await validateMetadataDraft('object', draft, undefined, { mode: 'edit' });
  return res.issues
    .filter((i) => i.path === 'fields.job' && /Unrecognized key/.test(i.message))
    .map((i) => i.message);
}

const jobIn = (draft: Row) => (draft.fields as Record<string, Row>).job;

describe('ObjectFieldInspector — no control writes an undeclared key on a lookup-family field (objectui#12758)', () => {
  for (const type of LOOKUP_FAMILY) {
    it(`PIN 1 (${type}): no text box the inspector offers writes \`relationshipName\``, () => {
      const drafts: Row[] = [];
      const { container } = render(<Designer initial={objectWith(jobOf(type))} drafts={drafts} />);
      // Positive control: the lookup section rendered — this is a targeted
      // retirement, not a section that failed to draw.
      expect(screen.getByText('Related object')).toBeInTheDocument();
      expect(screen.getByText('Display field')).toBeInTheDocument();

      const boxes = textBoxes(container);
      for (const box of boxes) {
        fireEvent.change(box, { target: { value: 'jobs' } });
        fireEvent.blur(box);
      }
      // The sweep drove the controls: the label box committed its word.
      expect(drafts.length).toBeGreaterThan(0);
      expect(jobIn(drafts.at(-1)!).label).toBe('jobs');
      for (const draft of drafts) {
        expect(jobIn(draft)).not.toHaveProperty('relationshipName');
      }
    });
  }

  it('PIN 1 (stored value): a field already carrying the key does not bring the control back', () => {
    render(
      <Designer
        initial={objectWith({ type: 'lookup', label: 'Job', reference: 'qavrf_job', relationshipName: 'jobs' })}
        drafts={[]}
      />,
    );
    expect(screen.getByText('Related object')).toBeInTheDocument();
    expect(screen.queryByText('Relationship name')).toBeNull();
    expect(screen.queryByPlaceholderText('Inverse collection key on the parent')).toBeNull();
  });

  for (const type of LOOKUP_FAMILY) {
    it(`PIN 2 (${type}): every draft the sweep produces judges with zero unrecognized keys`, async () => {
      const initial = objectWith(jobOf(type));
      // Control: the stored body is clean under both judges before anything is typed.
      expect(unrecognizedKeys(initial)).toEqual([]);
      expect(await unrecognizedAtField(initial)).toEqual([]);

      const drafts: Row[] = [];
      const { container } = render(<Designer initial={initial} drafts={drafts} />);
      for (const box of textBoxes(container)) {
        fireEvent.change(box, { target: { value: 'jobs' } });
        fireEvent.blur(box);
      }
      expect(drafts.length).toBeGreaterThan(0);
      for (const draft of drafts) {
        expect(unrecognizedKeys(draft)).toEqual([]);
        expect(await unrecognizedAtField(draft)).toEqual([]);
      }
    });
  }

  it('PIN 2 control: the same judges DO report an undeclared key on this field', async () => {
    // Without this, a judge that never reports anything would pass PIN 2.
    const poisoned = objectWith({ type: 'lookup', label: 'Job', reference: 'qavrf_job', relationshipName: 'jobs' });
    expect(unrecognizedKeys(poisoned)).toEqual([{ path: 'fields.job', keys: ['relationshipName'] }]);
    expect(await unrecognizedAtField(poisoned)).toHaveLength(1);
  });
});
