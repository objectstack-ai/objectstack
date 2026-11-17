// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_approval_request`'s record-detail page — the full page this plugin
 * serves through its manifest `pages` (maintainer ruling 乙 on objectui#12045,
 * `6079807016`: the page is metadata in plugin-approvals; objectui registers
 * renderers and mounts `RecordDetailView`).
 *
 * Four questions, each answered against the shipped artifacts and never a
 * copy of them:
 *
 *   1. the plugin's manifest carries the page, so the registry — and the
 *      metadata API reading it — has it;
 *   2. the page body: a header, a highlights strip that leaves `record_id`
 *      out and names nothing by a machine name, and ONE
 *      `record:approval_decision` node that draws the rest of the page, the
 *      business record as submitted and the rail of progress, attachments and
 *      activity (objectstack#34588); no tabs and no discussion thread;
 *   3. the page passes what `os validate` judges a page by — the parse, the
 *      component-type vocabulary, the props rows and the build rules — with a
 *      control for each half that can go red;
 *   4. its label is translated in every shipped locale, `en` byte-equal to
 *      the page literal, and served as the translation (not the fallback).
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import { PageSchema } from '@objectstack/spec/ui';
import {
  COMPONENT_PROPS_UNKNOWN_KEY,
  COMPONENT_TYPE_UNKNOWN,
  runAuthoringRules,
  splitBySeverity,
  validateComponentProps,
  validateComponentTypes,
} from '@objectstack/lint';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequestDetailPage } from './sys-approval-request.page.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { ApprovalsTranslations } from './translations/index.js';
import { approvalsPageTranslations } from './translations/pages.js';

type AnyRec = Record<string, any>;

const PAGE = SysApprovalRequestDetailPage as AnyRec;
const COMPONENTS = (PAGE.regions?.[0]?.components ?? []) as AnyRec[];
const nodeOf = (type: string): AnyRec | undefined => COMPONENTS.find((c) => c.type === type);
const HIGHLIGHTS = (nodeOf('record:highlights') ?? {}) as AnyRec;
/** Where the decision panel sits in the region: after the header and the highlights, last. */
const DECISION_AT = COMPONENTS.findIndex((c) => c.type === 'record:approval_decision');

/** The plugin's one manifest, as `init` registers it. */
async function registeredManifest(): Promise<AnyRec> {
  const registered: AnyRec[] = [];
  const ctx: any = {
    getService: (name: string) =>
      name === 'manifest' ? { register: (m: AnyRec) => registered.push(m) } : undefined,
    logger: { info: () => {}, warn: () => {} },
  };
  await new ApprovalsServicePlugin({ disableService: true }).init(ctx);
  expect(registered).toHaveLength(1);
  return registered[0];
}

/** Every component node under the page, tab children included. */
function nodesOf(value: unknown, out: AnyRec[] = []): AnyRec[] {
  if (Array.isArray(value)) {
    for (const v of value) nodesOf(v, out);
  } else if (value && typeof value === 'object') {
    const rec = value as AnyRec;
    if (typeof rec.type === 'string') out.push(rec);
    for (const v of Object.values(rec)) nodesOf(v, out);
  }
  return out;
}

const MANIFEST = {
  id: 'com.objectstack.test.approval-request-page',
  name: 'approval_request_page',
  version: '1.0.0',
  type: 'app',
} as const;

/** The page in a stack beside the two objects it binds, parsed as `os validate` parses it. */
function judgedStack(page: AnyRec) {
  const normalized = normalizeStackInput({
    manifest: MANIFEST,
    objects: [SysApprovalRequest, SysApprovalAction],
    pages: [page],
  }) as AnyRec;
  const result = ObjectStackDefinitionSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(
      'stack is not spec-valid: '
        + result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return { normalized, parsed: result.data as AnyRec };
}

/** The build rules' findings located on the page (the objects' own are not this file's question). */
function pageBuildFindings(page: AnyRec) {
  const { normalized, parsed } = judgedStack(page);
  return runAuthoringRules('build', { normalized, parsed }).filter((f) => f.path.startsWith('pages'));
}

/** The page with its decision node replaced. */
const withDecisionNode = (node: AnyRec): AnyRec => ({
  ...PAGE,
  regions: [{ ...PAGE.regions[0], components: COMPONENTS.map((c, i) => (i === DECISION_AT ? node : c)) }],
});

describe('sys_approval_request detail page — served through the manifest', () => {
  it('the plugin manifest carries the page in `pages`', async () => {
    const manifest = await registeredManifest();
    expect(manifest.pages).toEqual([SysApprovalRequestDetailPage]);
  });

  it('is the default full record page of sys_approval_request', () => {
    expect(PAGE).toMatchObject({
      name: 'sys_approval_request_detail',
      type: 'record',
      object: 'sys_approval_request',
      kind: 'full',
      isDefault: true,
    });
    const parsed = PageSchema.safeParse(PAGE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });
});

describe('sys_approval_request detail page — the page body', () => {
  it('authors exactly the header, the highlights and the decision panel, the panel last (objectstack#34588)', () => {
    // The panel draws the rest of the page: the business record as submitted,
    // whole, and the rail of progress, attachments and activity, the activity
    // last (maintainer 2026-11-17). The header reads the object's placed
    // header actions live: a bare `page:header` drew none, so an action
    // another package places on the object at `record_header` was dropped
    // (#29951).
    expect(COMPONENTS.map((c) => c.type)).toEqual(['page:header', 'record:highlights', 'record:approval_decision']);
    expect(DECISION_AT).toBe(COMPONENTS.length - 1);
    expect(nodeOf('page:header')).toEqual({ type: 'page:header', properties: { placedActions: true } });
  });

  it('holds ONE record:approval_decision node, with no properties (its props row is empty and strict)', () => {
    const decision = nodesOf(COMPONENTS).filter((n) => n.type === 'record:approval_decision');
    expect(decision).toHaveLength(1);
    expect(COMPONENTS[DECISION_AT]).toEqual({ type: 'record:approval_decision' });
  });

  it('highlights the object\'s highlightFields minus record_id, which the object itself keeps', () => {
    // The page reaches the record the `record_id` / `object_name` pointer pair
    // names through the decision panel, which draws that record whole and
    // links to it, so the strip leaves the pair out; the object's
    // `highlightFields` keeps `record_id` for the other surfaces that read it.
    const declared = SysApprovalRequest.highlightFields ?? [];
    expect(declared).toContain('record_id');
    expect(HIGHLIGHTS.type).toBe('record:highlights');
    expect(HIGHLIGHTS.properties.fields).toEqual(declared.filter((f: string) => f !== 'record_id'));
    expect((SysApprovalRequest.fields as AnyRec).record_id?.referenceVia).toBe('object_name');
  });

  it('names the flow by its label, process_label, in the strip and in the object\'s list alike', () => {
    // `process_name` is the machine source (`flow:NAME`); `process_label` is the
    // flow's label, served under that name by the approvals get. The object's
    // list moves with the strip, never the strip alone.
    const strip = HIGHLIGHTS.properties.fields as string[];
    const declared = SysApprovalRequest.highlightFields ?? [];
    expect(strip[0]).toBe('process_label');
    expect(declared[0]).toBe('process_label');
    expect({ strip: strip.includes('process_name'), declared: declared.includes('process_name') })
      .toEqual({ strip: false, declared: false });
    expect(declared.filter((f: string) => !strip.includes(f))).toEqual(['record_id']);
  });

  it('names the step by its label, current_step_label, in the strip and in the object\'s list alike', () => {
    // `current_step` is the Approval node's machine id (`approve_step`);
    // `current_step_label` is the step's label, a declared field the approvals
    // get serves under that name (`approval-service.test.ts` pins the get). The
    // object's list moves with the strip for the reason the flow chip's does.
    const strip = HIGHLIGHTS.properties.fields as string[];
    const declared = SysApprovalRequest.highlightFields ?? [];
    const fields = SysApprovalRequest.fields as AnyRec;
    expect({ strip: strip.includes('current_step_label'), declared: declared.includes('current_step_label') })
      .toEqual({ strip: true, declared: true });
    expect({ strip: strip.includes('current_step'), declared: declared.includes('current_step') })
      .toEqual({ strip: false, declared: false });
    expect(fields.current_step_label).toMatchObject({ type: 'text', label: 'Approval Step' });
    // Control: the machine id stays a declared field. It is dropped from the
    // two lists, not from the object.
    expect(fields.current_step).toMatchObject({ type: 'text' });
  });

  it('draws no Object chip: object_name, the target\'s API name, is in neither list', () => {
    // `object_name` holds the target object's API name (`showcase_announcement`)
    // and the object declares no field holding that object's label. The
    // decision panel names the target object beside the submitted record's
    // heading, read from the object's definition.
    const strip = HIGHLIGHTS.properties.fields as string[];
    const declared = SysApprovalRequest.highlightFields ?? [];
    const fields = SysApprovalRequest.fields as AnyRec;
    expect({ strip: strip.includes('object_name'), declared: declared.includes('object_name') })
      .toEqual({ strip: false, declared: false });
    expect(declared.filter((f: string) => !strip.includes(f))).toEqual(['record_id']);
    expect(fields.record_id?.referenceVia).toBe('object_name');
    // Control: the type half stays a declared, required field. It is dropped
    // from the two lists, not from the object.
    expect(fields.object_name).toMatchObject({ type: 'text', required: true });
  });

  it('has no tabs: the panel draws the record and, last in its rail, the request\'s thread (objectstack#34588)', () => {
    // The page had two tabs, Details (the pointer pair's card) and Timeline
    // (`sys_approval_action` as a related list). Neither is a node any more.
    const types = nodesOf(COMPONENTS).map((n) => n.type);
    expect(types.filter((t) => t === 'page:tabs' || t === 'record:details' || t === 'record:related_list')).toEqual([]);
    // The thread the panel reads really points back at this object.
    expect((SysApprovalAction.fields as AnyRec).request_id).toMatchObject({ type: 'lookup', reference: 'sys_approval_request' });
  });

  it('every field the page names exists on its object', () => {
    const requestFields = Object.keys(SysApprovalRequest.fields);
    const missing = (HIGHLIGHTS.properties.fields as string[]).filter((f) => !requestFields.includes(f)).map((f) => `request.${f}`);
    expect(missing).toEqual([]);
  });

  it('has no discussion thread anywhere — the reply is the declared approval_comment action', () => {
    expect(nodesOf(PAGE).map((n) => n.type).filter((t) => t === 'record:discussion' || t === 'record:chatter')).toEqual([]);
    const actions = (SysApprovalRequest.actions ?? []) as AnyRec[];
    expect(actions.find((a) => a.name === 'approval_comment')?.locations).toEqual(['record_section']);
  });
});

describe('sys_approval_request detail page — what `os validate` judges a page by', () => {
  it('the component-type vocabulary knows every node, record:approval_decision included', () => {
    expect(validateComponentTypes({ pages: [PAGE] })).toEqual([]);
  });

  it('control: a misspelled decision-panel type is refused by the same call', () => {
    const findings = validateComponentTypes({ pages: [withDecisionNode({ type: 'record:approval_decison' })] });
    expect(findings.map((f) => [f.rule, f.path])).toEqual([[COMPONENT_TYPE_UNKNOWN, `pages[0].regions[0].components[${DECISION_AT}].type`]]);
  });

  it('every node\'s props are inside its declared props row', () => {
    expect(validateComponentProps({ pages: [PAGE] })).toEqual([]);
  });

  it('control: a property on the decision node is refused by the same call', () => {
    const findings = validateComponentProps({ pages: [withDecisionNode({ type: 'record:approval_decision', properties: { showProgress: true } })] });
    expect(findings.map((f) => f.rule)).toEqual([COMPONENT_PROPS_UNKNOWN_KEY]);
  });

  it('the build rules raise no error on the page, in a stack beside the two objects it binds', () => {
    const { errors } = splitBySeverity(pageBuildFindings(PAGE));
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
  });

  it('control: the build rules see the page — the misspelled type is an error there too', () => {
    const { errors } = splitBySeverity(pageBuildFindings(withDecisionNode({ type: 'record:approval_decison' })));
    expect(errors.map((f) => f.rule)).toContain(COMPONENT_TYPE_UNKNOWN);
  });
});

describe('sys_approval_request detail page — its label in the translation bundles', () => {
  const NAME = 'sys_approval_request_detail';

  it('the `en` entry is byte-equal to the page literal', () => {
    // `translatePage` applies the bundle in `en` too, so a drifted `en` entry
    // would override the page's own label rather than fall back to it.
    expect(approvalsPageTranslations.en[NAME]?.label).toBe(PAGE.label);
  });

  it('every served locale carries the label, and a translated locale serves its translation', () => {
    const locales = Object.keys(ApprovalsTranslations).sort();
    expect(locales).toEqual(['ar', 'de', 'en', 'es-ES', 'fr', 'ja-JP', 'ko', 'pt-BR', 'ru', 'zh-CN', 'zh-Hant']);
    for (const locale of locales) {
      const served = (ApprovalsTranslations as AnyRec)[locale]?.pages?.[NAME]?.label;
      const authored = (approvalsPageTranslations as AnyRec)[locale]?.[NAME]?.label;
      expect({ locale, served }).toEqual({ locale, served: authored });
      // Served AS the translation: the recorded source digest is current, so
      // the staleness fallback did not put the English source in its place.
      if (locale !== 'en') expect({ locale, english: served === PAGE.label }).toEqual({ locale, english: false });
    }
  });
});
