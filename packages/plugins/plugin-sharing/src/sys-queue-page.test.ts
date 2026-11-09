// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_queue`'s record page (`sys-queue.page.ts`): an organization's queue
 * lists its members, keyed by the queue's NAME, with "New" pre-filled.
 *
 * No published page keyed a related list on `relationshipValueField: 'name'`
 * before this one, so both halves of what the console does with the key are
 * pinned here, read off the page and never retyped:
 *
 *   - the FILTER: the list reads `sys_queue_member` where
 *     `{ [relationshipField]: queue[relationshipValueField] }`;
 *   - the "New" PREFILL: the member form opens with `relationshipField` set to
 *     that same value, and "New" is not withheld (no authored `actions: []`).
 *
 * Both are measured on a REAL engine (ObjectQL + SqlDriver over in-memory
 * SQLite) carrying the shipped `sys_queue` / `sys_queue_member`, and the row
 * the prefilled form writes is the row the ownership-queue service expands as
 * a member: the list and the service agree on who is in the queue.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysOrganization } from '@objectstack/platform-objects/identity';
import { PageSchema, ComponentPropsMap } from '@objectstack/spec/ui';
import { SysQueue, SysQueueMember } from './objects/index.js';
import { SysQueueDetailPage } from './sys-queue.page.js';
import { OwnershipQueueService } from './ownership-queue-service.js';
import { SharingTranslations } from './translations/index.js';
import { sharingPageTranslations } from './translations/pages.js';

type AnyRec = Record<string, any>;

const SYS = { isSystem: true, userId: 'usr_admin' } as any;
const ORG = 'org_qa';

const PAGE = SysQueueDetailPage as AnyRec;
const COMPONENTS = (PAGE.regions?.[0]?.components ?? []) as AnyRec[];
const nodeOf = (type: string): AnyRec => COMPONENTS.find((c) => c.type === type) ?? {};
const MEMBERS = nodeOf('record:related_list').properties as AnyRec;

describe('sys_queue record page — the page', () => {
  it('is the default full record page of sys_queue, and parses as a page', () => {
    expect(PAGE).toMatchObject({ name: 'sys_queue_detail', type: 'record', object: 'sys_queue', kind: 'full', isDefault: true });
    const parsed = PageSchema.safeParse(PAGE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('every node\'s props parse against its own component props row', () => {
    const map = ComponentPropsMap as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    const bad = COMPONENTS.filter((c) => !map[c.type]?.safeParse(c.properties ?? {}).success).map((c) => c.type);
    expect(bad).toEqual([]);
  });

  it('authors the header, the strip, the details, the members and the discussion, in that order', () => {
    expect(COMPONENTS.map((c) => c.type)).toEqual([
      'page:header', 'record:highlights', 'record:details', 'record:related_list', 'record:discussion',
    ]);
    // The strip is the object's highlightFields minus the title field.
    expect(nodeOf('record:highlights').properties.fields)
      .toEqual((SysQueue.highlightFields ?? []).filter((f: string) => f !== SysQueue.nameField));
    // The details draw every field the queue declares.
    expect([...nodeOf('record:details').properties.fields].sort()).toEqual(Object.keys(SysQueue.fields).sort());
  });

  it('the members list is sys_queue_member keyed by the queue NAME, and "New" is not withheld', () => {
    expect(MEMBERS).toMatchObject({ objectName: 'sys_queue_member', relationshipField: 'queue', relationshipValueField: 'name' });
    expect(MEMBERS.actions).toBeUndefined();
    // The two sides of the key: the member's `queue` is text holding a name,
    // and the queue's `name` is the identity every reference uses.
    expect((SysQueueMember.fields as AnyRec).queue).toMatchObject({ type: 'text', required: true });
    expect((SysQueue.indexes ?? []).some((i: AnyRec) => i.unique && i.fields?.join() === 'name')).toBe(true);
    const memberFields = Object.keys(SysQueueMember.fields);
    const columns = MEMBERS.columns as string[];
    expect(columns.filter((c) => !memberFields.includes(c) && c !== 'updated_at')).toEqual([]);
  });

  it('its label is translated in every shipped locale, `en` byte-equal to the page literal', () => {
    expect(sharingPageTranslations.en.sys_queue_detail?.label).toBe(PAGE.label);
    for (const [locale, bundle] of Object.entries(SharingTranslations)) {
      expect((bundle as AnyRec).pages?.sys_queue_detail?.label, locale)
        .toBe((sharingPageTranslations as AnyRec)[locale].sys_queue_detail.label);
    }
  });
});

describe('sys_queue record page — the members list on a real engine', () => {
  let engine: ObjectQL;
  let billing: AnyRec;

  /** The rows the page's list shows on `queue`'s page. */
  const listedOn = async (queue: AnyRec): Promise<AnyRec[]> =>
    (await engine.find('sys_queue_member', {
      where: { [MEMBERS.relationshipField]: queue[MEMBERS.relationshipValueField] },
      context: SYS,
    })) as AnyRec[];
  /** What the prefilled "New" form carries before the administrator fills in the member. */
  const prefilledNew = (queue: AnyRec): AnyRec => ({ [MEMBERS.relationshipField]: queue[MEMBERS.relationshipValueField] });

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    engine = new ObjectQL();
    engine.registerDriver(driver as never, true);
    await engine.init();
    for (const def of [SysOrganization, SysQueue, SysQueueMember]) {
      engine.registry.registerObject(def as never, 'plugin-sharing', 'sys');
    }
    await engine.syncSchemas();
    await engine.insert('sys_organization', { id: ORG, name: 'QA Org', slug: 'qa-org' }, { context: SYS });

    billing = (await engine.insert('sys_queue', { name: 'billing', label: 'Billing', organization_id: ORG }, { context: SYS })) as AnyRec;
    await engine.insert('sys_queue', { name: 'support', label: 'Support', organization_id: ORG }, { context: SYS });
    for (const [queue, type, id] of [
      ['billing', 'user', 'u_ada'],
      ['billing', 'position', 'billing_clerk'],
      ['support', 'user', 'u_bob'],
    ] as const) {
      await engine.insert('sys_queue_member', { queue, recipient_type: type, recipient_id: id, organization_id: ORG }, { context: SYS });
    }
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the FILTER: a queue\'s page lists its own members, by name, and no other queue\'s', async () => {
    // Control: keyed on the id, the default, the list would find nothing — the
    // members store the name, which is why the page names `name`.
    expect(billing.id).not.toBe(billing.name);
    expect(await engine.find('sys_queue_member', { where: { queue: billing.id }, context: SYS })).toEqual([]);

    const listed = await listedOn(billing);
    expect(listed.map((m) => `${m.recipient_type}:${m.recipient_id}`).sort()).toEqual(['position:billing_clerk', 'user:u_ada']);
  });

  it('the "New" PREFILL: the form carries the queue\'s name, and the member it saves is listed on the page', async () => {
    const draft = prefilledNew(billing);
    expect(draft).toEqual({ queue: 'billing' });
    await engine.insert(
      'sys_queue_member',
      { ...draft, recipient_type: 'user', recipient_id: 'u_cy', organization_id: ORG },
      { context: SYS },
    );
    expect((await listedOn(billing)).map((m) => m.recipient_id)).toContain('u_cy');
  });

  it('the list and the ownership-queue service agree on who is in the queue', async () => {
    const service = new OwnershipQueueService({ engine: () => engine as never });
    const resolved = await service.resolveQueue(billing.name, ORG);
    expect(resolved?.source).toBe('authored');
    const listed = (await listedOn(billing)).map((m) => `${m.recipient_type}:${m.recipient_id}`).sort();
    expect((resolved?.members ?? []).map((m) => `${m.type}:${m.value}`).sort()).toEqual(listed);
  });
});
