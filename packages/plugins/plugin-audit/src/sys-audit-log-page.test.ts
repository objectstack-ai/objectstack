// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_audit_log`'s record page: the full page this plugin serves through its
 * manifest `pages` (`sys-audit-log.page.ts`), whose job is the list of every
 * ledger row about the same record beside the row being read.
 *
 * Four questions, each answered against the shipped artifacts:
 *
 *   1. the plugin's manifest carries the page;
 *   2. the page parses as a page, and every node's props parse against its
 *      component's own props row (the per-type door `os validate` judges);
 *   3. the body draws every field the object declares (a `full` page draws
 *      only what it authors), and the same-record list is the ledger keyed on
 *      `record_id` on both sides, with no "New" on an append-only object;
 *   4. its label is translated in every shipped locale, `en` byte-equal to
 *      the page literal.
 *
 * What the list SELECTS on a real engine and driver, the mirror's rows about
 * a settings write included, is `sys-audit-log-same-record.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { PageSchema, ComponentPropsMap } from '@objectstack/spec/ui';
import { AuditPlugin } from './audit-plugin.js';
import { SysAuditLogDetailPage } from './sys-audit-log.page.js';
import { SysAuditLog } from './objects/index.js';
import { AuditTranslations } from './translations/index.js';
import { auditPageTranslations } from './translations/pages.js';

type AnyRec = Record<string, any>;

const PAGE = SysAuditLogDetailPage as AnyRec;
const COMPONENTS = (PAGE.regions?.[0]?.components ?? []) as AnyRec[];
const nodeOf = (type: string): AnyRec => COMPONENTS.find((c) => c.type === type) ?? {};
const FIELDS = SysAuditLog.fields as AnyRec;

/** The plugin's one manifest, as `init` registers it. */
async function registeredManifest(): Promise<AnyRec> {
  const registered: AnyRec[] = [];
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: AnyRec) => registered.push(m) };
      throw new Error(`no service '${name}'`);
    },
    registerService: () => {},
    hook: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  await new AuditPlugin().init(ctx);
  expect(registered).toHaveLength(1);
  return registered[0];
}

describe('sys_audit_log record page — served through the manifest', () => {
  it('the plugin manifest carries the page in `pages`', async () => {
    expect((await registeredManifest()).pages).toEqual([SysAuditLogDetailPage]);
  });

  it('is the default full record page of sys_audit_log, and parses as a page', () => {
    expect(PAGE).toMatchObject({
      name: 'sys_audit_log_detail',
      type: 'record',
      object: 'sys_audit_log',
      kind: 'full',
      isDefault: true,
    });
    const parsed = PageSchema.safeParse(PAGE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('every node\'s props parse against its own component props row', () => {
    const map = ComponentPropsMap as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: any } }>;
    const verdicts = COMPONENTS.map((c) => {
      const row = map[c.type];
      const result = row?.safeParse(c.properties ?? {});
      return { type: c.type, known: !!row, ok: !!result?.success, issues: result?.error?.issues ?? [] };
    });
    expect(verdicts.filter((v) => !v.known || !v.ok)).toEqual([]);
    // Control: the door refuses what it should, so the green above is a verdict.
    expect(map['record:related_list'].safeParse({ objectName: 'sys_audit_log', relationshipField: 'record_id', relatedField: 'x' }).success)
      .toBe(false);
  });
});

describe('sys_audit_log record page — the body', () => {
  it('authors the header, the strip, the details, the same-record list and the discussion, in that order', () => {
    expect(COMPONENTS.map((c) => c.type)).toEqual([
      'page:header', 'record:highlights', 'record:details', 'record:related_list', 'record:discussion',
    ]);
    expect(nodeOf('page:header')).toEqual({ type: 'page:header', properties: { placedActions: true } });
  });

  it('the strip is the object\'s highlightFields minus the title field, and holds neither half of the pointer pair', () => {
    const strip = nodeOf('record:highlights').properties.fields as string[];
    expect(strip).toEqual((SysAuditLog.highlightFields ?? []).filter((f: string) => f !== SysAuditLog.nameField));
    expect(strip).not.toContain('record_id');
    expect(strip).not.toContain('object_name');
  });

  it('the details draw every field the object declares, the system id apart, in its declared groups', () => {
    const sections = nodeOf('record:details').properties.sections as AnyRec[];
    const drawn = sections.flatMap((s) => s.fields as string[]);
    const declared = Object.keys(FIELDS).filter((f) => f !== 'id');
    expect([...drawn].sort()).toEqual([...declared].sort());
    // Each section holds one declared group's fields, so the body reads as the object groups them.
    for (const section of sections) {
      const groups = new Set((section.fields as string[]).map((f) => FIELDS[f]?.group));
      expect(groups.size, String(section.label?.en)).toBe(1);
      expect([...groups][0]).toBe(section.label.en);
    }
  });

  it('the same-record list is the ledger, keyed on `record_id` on both sides, newest first, with no "New"', () => {
    const list = nodeOf('record:related_list').properties;
    expect(list).toMatchObject({
      objectName: 'sys_audit_log',
      relationshipField: 'record_id',
      relationshipValueField: 'record_id',
      sort: [{ field: 'created_at', order: 'desc' }],
      // An authored empty action list withholds "New"; the object is append-only.
      actions: [],
    });
    expect((SysAuditLog as AnyRec).enable?.apiMethods).toEqual(['get', 'list']);
    // The value it keys on is the pointer's id half, a declared column of this object.
    expect(FIELDS.record_id?.referenceVia).toBe('object_name');
    // Every column it draws is a field of the object, the two snapshots included.
    const columns = list.columns as string[];
    expect(columns.filter((c) => !(c in FIELDS))).toEqual([]);
    expect(columns).toEqual(expect.arrayContaining(['old_value', 'new_value']));
  });

  it('every inline label carries the eleven locales this plugin ships', () => {
    const locales = Object.keys(auditPageTranslations).sort();
    const labels: AnyRec[] = [
      ...(nodeOf('record:details').properties.sections as AnyRec[]).map((s) => s.label),
      nodeOf('record:related_list').properties.title,
    ];
    for (const label of labels) expect(Object.keys(label).sort(), String(label.en)).toEqual(locales);
  });
});

describe('sys_audit_log record page — its label is translated', () => {
  it('`en` mirrors the page literal byte for byte', () => {
    expect(auditPageTranslations.en.sys_audit_log_detail?.label).toBe(PAGE.label);
  });

  it('every shipped locale serves its own label, the object\'s label in that locale', () => {
    for (const [locale, bundle] of Object.entries(AuditTranslations)) {
      const served = (bundle as AnyRec).pages?.sys_audit_log_detail?.label;
      expect(served, locale).toBe((auditPageTranslations as AnyRec)[locale].sys_audit_log_detail.label);
      expect(served, locale).toBe((bundle as AnyRec).objects?.sys_audit_log?.label);
    }
  });
});
