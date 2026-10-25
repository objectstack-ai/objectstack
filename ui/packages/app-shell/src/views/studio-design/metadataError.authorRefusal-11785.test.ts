// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11785 — a Studio refusal reads as a sentence for the author, names
 * the input it is about, and keeps the raw text behind Details.
 *
 * Measured on the card before the fix: Studio's strips printed
 * `formatMetadataError(e)` verbatim, so a Picklist with no options showed the
 * write guard's developer prose (a class name and tracker ids), and a server
 * refusal showed its raw issue paths (`nodes.2.config.title — …`).
 *
 * These pins read the view model the strips render. The strip itself, wired
 * into the pillars, is pinned in `DataPillar.authorRefusal-11785.test.tsx` and
 * `AutomationsPillar.authorRefusal-11785.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { MetadataClient, formatMetadataError } from '@object-ui/data-objectstack';
import {
  flowSaveRefusal,
  issueRefusal,
  navEntryLocator,
  objectSaveRefusal,
  plainRefusal,
} from './metadataError';
import { t, tFormat } from '../metadata-admin/i18n';

/** Text an author cannot act on: a class or package name, a tracker id, a raw path, code quotes. */
const DEVELOPER_TEXT = /MetadataClient|@objectstack|objectstack#|objectui#|`|fields\.|nodes\.\d|navigation\.\d/;

/** The write guard's refusal of `body`, through the real door, with no request issued. */
async function guardRefusal(body: Record<string, unknown>): Promise<unknown> {
  const client = new MetadataClient({
    baseUrl: 'http://test.local',
    fetch: (async () => {
      throw new Error('the guard must refuse before any request');
    }) as unknown as typeof fetch,
  });
  return client.save('object', 'showcase_task', body).then(
    () => {
      throw new Error('expected the guard to refuse this body');
    },
    (e: unknown) => e,
  );
}

/** A server refusal as the client parses it: status, code and the structured issues. */
function serverRefusal(issues: Array<{ path: string; message: string }>): Error {
  return Object.assign(new Error(`${issues.length} issue(s): ${issues.map((i) => i.path).join(', ')}`), {
    status: 422,
    code: 'INVALID_METADATA',
    issues,
  });
}

const TASK = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: { type: 'select', label: 'Status' },
  },
};

describe('the write guard, in the author\'s words (objectui#11785)', () => {
  it('a choice with no options: a sentence naming the field by its label, the guard\'s text under Details', async () => {
    const e = await guardRefusal(TASK);
    const refusal = objectSaveRefusal(e, TASK, 'en');

    expect(refusal.message).toBe(tFormat('engine.studio.refusal.choiceWithoutOptions', 'en', { field: 'Status' }));
    expect(refusal.message).not.toMatch(DEVELOPER_TEXT);
    expect(refusal.target).toEqual({ kind: 'field', id: 'status' });
    // Nothing is lost: the raw refusal is exactly what the strip printed before.
    expect(refusal.detail).toBe(formatMetadataError(e));
    expect(refusal.detail).toMatch(/`status` is a `select` with no options/);
  });

  it('a relationship with no target, in the array `fields` shape the Studio data page PUTs', async () => {
    const body = {
      name: 'showcase_task',
      fields: [
        { name: 'title', type: 'text', label: 'Title' },
        { name: 'technician', type: 'lookup', label: 'Technician' },
      ],
    };
    const refusal = objectSaveRefusal(await guardRefusal(body), body, 'en');

    expect(refusal.message).toBe(
      tFormat('engine.studio.refusal.relationshipWithoutTarget', 'en', { field: 'Technician' }),
    );
    expect(refusal.target).toEqual({ kind: 'field', id: 'technician' });
  });

  it('names the field the guard refused, not merely the first choice field', async () => {
    const body = {
      fields: {
        stage: { type: 'select', label: 'Stage', options: [{ value: 'a', label: 'A' }] },
        owner: { type: 'lookup', label: 'Owner' },
      },
    };
    const refusal = objectSaveRefusal(await guardRefusal(body), body, 'en');
    expect(refusal.target).toEqual({ kind: 'field', id: 'owner' });
  });

  it('a field with no label is named by its API name', async () => {
    const body = { fields: { status: { type: 'radio' } } };
    const refusal = objectSaveRefusal(await guardRefusal(body), body, 'en');
    expect(refusal.message).toBe(tFormat('engine.studio.refusal.choiceWithoutOptions', 'en', { field: 'status' }));
  });

  it('reads in the designer locale', async () => {
    const refusal = objectSaveRefusal(await guardRefusal(TASK), TASK, 'zh-CN');
    expect(refusal.message).toBe(tFormat('engine.studio.refusal.choiceWithoutOptions', 'zh-CN', { field: 'Status' }));
    expect(refusal.message).not.toBe(tFormat('engine.studio.refusal.choiceWithoutOptions', 'en', { field: 'Status' }));
  });

  it('CONTROL: the same words with a server status are not the guard, and stay as they were', async () => {
    const guard = (await guardRefusal(TASK)) as Error;
    const fromServer = Object.assign(new Error(guard.message), { status: 400 });
    expect(objectSaveRefusal(fromServer, TASK, 'en')).toEqual({ message: guard.message });
  });

  it('CONTROL: the guard\'s words about a body that was NOT sent are not taken for its refusal', async () => {
    const guard = (await guardRefusal(TASK)) as Error;
    const fixed = { ...TASK, fields: { ...TASK.fields, status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] } } };
    expect(objectSaveRefusal(guard, fixed, 'en')).toEqual({ message: guard.message });
  });

  it('CONTROL: a transport failure is shown as it was, with nothing behind Details', () => {
    const e = new TypeError('Failed to fetch');
    expect(objectSaveRefusal(e, TASK, 'en')).toEqual({ message: 'Failed to fetch' });
    expect(plainRefusal(e)).toEqual({ message: 'Failed to fetch' });
  });
});

describe('a server refusal, placed on the input it names (objectui#11785)', () => {
  const FLOW = {
    name: 'approval',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'route', type: 'decision', label: 'Route' },
      { id: 'tell', type: 'notify', label: 'Notify approver' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'route' }],
  };
  const MISSING = 'Invalid input: expected string, received undefined';

  it('`nodes.2.config.title` names node 2 and its Title, and opens that node', () => {
    const e = serverRefusal([{ path: 'nodes.2.config.title', message: MISSING }]);
    const refusal = flowSaveRefusal(e, FLOW, 'en');

    expect(refusal.message).toBe(
      tFormat('engine.studio.refusal.issue', 'en', {
        where: tFormat('engine.studio.refusal.stepInput', 'en', { input: 'Title', step: 'Notify approver' }),
        problem: t('engine.validation.expectedStringUndefined', 'en'),
      }),
    );
    expect(refusal.message).not.toMatch(DEVELOPER_TEXT);
    expect(refusal.target).toEqual({ kind: 'node', id: 'tell' });
    expect(refusal.detail).toBe(formatMetadataError(e));
    expect(refusal.detail).toContain('nodes.2.config.title');
  });

  it('a node key with no inspector input names the step alone', () => {
    const e = serverRefusal([{ path: 'nodes.1.config.nowhere', message: 'Unrecognized key' }]);
    const refusal = flowSaveRefusal(e, FLOW, 'en');
    expect(refusal.message).toContain(tFormat('engine.studio.refusal.step', 'en', { step: 'Route' }));
    expect(refusal.target).toEqual({ kind: 'node', id: 'route' });
  });

  it('an unmapped path stays reachable under Details, and the sentence says the draft was refused', () => {
    const e = serverRefusal([{ path: 'edges.0.source', message: 'Unknown node' }]);
    const refusal = flowSaveRefusal(e, FLOW, 'en');
    expect(refusal.message).toBe(t('engine.studio.refusal.unlocated', 'en'));
    expect(refusal.target).toBeUndefined();
    expect(refusal.detail).toBe('• edges.0.source — Unknown node');
  });

  it('several issues: the first it can place leads, the rest are counted, all stay under Details', () => {
    const e = serverRefusal([
      { path: 'edges.0.source', message: 'Unknown node' },
      { path: 'nodes.2.config.title', message: MISSING },
      { path: 'nodes.0.label', message: 'Too long' },
    ]);
    const refusal = flowSaveRefusal(e, FLOW, 'en');
    expect(refusal.target).toEqual({ kind: 'node', id: 'tell' });
    expect(refusal.message).toMatch(new RegExp(`${tFormat('engine.studio.refusal.more', 'en', { count: 2 }).replace(/[()]/g, '\\$&')}$`));
    expect(refusal.detail?.split('\n')).toHaveLength(3);
  });

  it('`fields.NAME…` on an object names the field by its label', () => {
    const e = serverRefusal([{ path: 'fields.status.options', message: 'Invalid input' }]);
    const refusal = objectSaveRefusal(e, TASK, 'en');
    expect(refusal.message).toContain(tFormat('engine.studio.refusal.field', 'en', { field: 'Status' }));
    expect(refusal.target).toEqual({ kind: 'field', id: 'status' });
  });

  it('a nav path indexes the navigation that was SENT, and opens the editor\'s own entry', () => {
    // The editor holds an unbound entry the save leaves out (objectui#11776),
    // so the server's `navigation.1` is the editor's third entry.
    const editor = [
      { id: 'home', type: 'page', pageName: 'home', label: 'Home' },
      { id: 'nav_item_2', type: 'object' },
      { id: 'accounts', type: 'object', objectName: 'BAD NAME', label: 'Accounts' },
    ];
    const sent = [editor[0], editor[2]];
    const e = serverRefusal([{ path: 'navigation.1.objectName', message: 'Invalid input' }]);
    const refusal = issueRefusal(e, 'en', navEntryLocator({ sent, editor, locale: 'en' }));

    expect(refusal.target).toEqual({ kind: 'nav', id: 'navigation[2]' });
    expect(refusal.message).toContain(
      tFormat('engine.studio.refusal.navItemInput', 'en', { input: t('engine.studio.nav.linkObject', 'en'), item: 'Accounts' }),
    );
    expect(refusal.message).not.toMatch(DEVELOPER_TEXT);
  });

  it('a nested nav entry is not one the Studio nav inspector edits: it stays under Details', () => {
    const editor = [{ id: 'grp', type: 'group', label: 'Group', children: [{ id: 'c', type: 'object', objectName: 'x' }] }];
    const e = serverRefusal([{ path: 'navigation.0.children.0.objectName', message: 'Invalid input' }]);
    const refusal = issueRefusal(e, 'en', navEntryLocator({ sent: editor, editor, locale: 'en' }));
    expect(refusal.message).toBe(t('engine.studio.refusal.unlocated', 'en'));
    expect(refusal.detail).toContain('navigation.0.children.0.objectName');
  });

  it('CONTROL: `formatMetadataError` — what every other caller prints — is unchanged', () => {
    const e = serverRefusal([{ path: 'nodes.2.config.title', message: MISSING }]);
    expect(formatMetadataError(e)).toBe(`• nodes.2.config.title — ${MISSING}`);
  });
});
