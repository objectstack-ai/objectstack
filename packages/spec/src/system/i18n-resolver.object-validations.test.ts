// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: `translateObject` overlays each `validations[].message` from the key
 * the ObjectQL rule evaluator refuses a write with,
 * `objectValidationMessageKey(object, rule)` =
 * `objects.<object>._validations.<rule>.message` (#27135).
 *
 * Before this, the evaluator's refusal of a write was translated while the
 * served object document carried the rule's authored message, so a client
 * explaining a rule from `/meta` (the kanban's closed-lane tooltip is the
 * first) showed one sentence in the authoring language and the refusal of the
 * same move another, in the reader's.
 *
 * The bundle is PARSED by `TranslationBundleSchema`, so an address the schema
 * does not carry cannot pass here, and every entry is written at the path
 * `objectValidationMessageKey` spells: one key, no second spelling. The
 * cross-path pin (the refusal and the served rule give the same string) lives
 * beside the evaluator, in objectql's `engine-validation-locale-negotiation`.
 */

import { describe, it, expect } from 'vitest';
import {
  objectValidationMessageKey,
  translateMetadataDocument,
  translateObject,
} from './i18n-resolver';
import { TranslationBundleSchema, type TranslationBundle } from './translation.zod';
import { ValidationRuleSchema } from '../data/validation.zod';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** One rule, parsed by the schema `ObjectSchema.validations` uses. */
const rule = (raw: Record<string, unknown>): any => ValidationRuleSchema.parse(raw);

const AUTHORED = {
  closed_is_final: 'A closed ticket cannot be reopened.',
  refund_needs_reason: 'Say why the refund is issued.',
  untranslated_rule: 'This one has no translation.',
  vip_branch: 'A VIP ticket needs an owner.',
  standard_branch: 'A ticket needs a priority.',
  wrapper: 'Wrapper message, never shown.',
};

const ZH = {
  closed_is_final: '已关闭的工单不能重新打开。',
  refund_needs_reason: '请写明退款原因。',
  vip_branch: 'VIP 工单需要负责人。',
  standard_branch: '工单需要优先级。',
  wrapper: '外层消息,不会展示。',
};

const DOC: any = {
  name: 'helpdesk_ticket',
  label: 'Ticket',
  fields: {
    status: {
      name: 'status',
      type: 'select',
      label: 'Status',
      options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
    },
    owner: { name: 'owner', type: 'text', label: 'Owner' },
  },
  actions: [{ name: 'escalate', label: 'Escalate', type: 'script' }],
  validations: [
    rule({
      type: 'state_machine',
      name: 'closed_is_final',
      message: AUTHORED.closed_is_final,
      field: 'status',
      transitions: { open: ['closed'], closed: [] },
    }),
    rule({
      type: 'script',
      name: 'refund_needs_reason',
      message: AUTHORED.refund_needs_reason,
      condition: "record.status == 'refunded' && record.reason == null",
    }),
    rule({
      type: 'script',
      name: 'untranslated_rule',
      message: AUTHORED.untranslated_rule,
      condition: 'record.owner == null',
    }),
    rule({
      type: 'conditional',
      name: 'wrapper',
      message: AUTHORED.wrapper,
      when: "record.tier == 'vip'",
      then: {
        type: 'script',
        name: 'vip_branch',
        message: AUTHORED.vip_branch,
        condition: 'record.owner == null',
      },
      otherwise: {
        type: 'script',
        name: 'standard_branch',
        message: AUTHORED.standard_branch,
        condition: 'record.priority == null',
      },
    }),
  ],
};

/** Write `value` at the dotted address `objectValidationMessageKey` spells. */
function atKey(data: Record<string, any>, key: string, value: string): Record<string, any> {
  const parts = key.split('.');
  let cur = data;
  for (const part of parts.slice(0, -1)) cur = cur[part] ??= {};
  cur[parts[parts.length - 1]] = value;
  return data;
}

function localeData(messages: Record<string, string>, extra: Record<string, any> = {}) {
  const data: Record<string, any> = clone(extra);
  for (const [ruleName, message] of Object.entries(messages)) {
    atKey(data, objectValidationMessageKey('helpdesk_ticket', ruleName), message);
  }
  return data;
}

const BUNDLE: TranslationBundle = TranslationBundleSchema.parse({
  en: localeData({ closed_is_final: 'Closed is final (en catalog).' }),
  'zh-CN': localeData(ZH, {
    objects: {
      helpdesk_ticket: {
        label: '工单',
        fields: { status: { label: '状态', options: { open: '打开', closed: '已关闭' } } },
        _actions: { escalate: { label: '升级' } },
      },
    },
  }),
});

const messagesOf = (doc: any): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of doc.validations) {
    out[r.name] = r.message;
    if (r.type === 'conditional') {
      out[r.then.name] = r.then.message;
      out[r.otherwise.name] = r.otherwise.message;
    }
  }
  return out;
};

describe('#27135 translateObject overlays validations[].message', () => {
  it('serves each rule message from objectValidationMessageKey in the requested locale', () => {
    const out = translateObject(clone(DOC), BUNDLE, { locale: 'zh-CN' }) as any;
    expect(messagesOf(out)).toEqual({
      closed_is_final: ZH.closed_is_final,
      refund_needs_reason: ZH.refund_needs_reason,
      untranslated_rule: AUTHORED.untranslated_rule,
      wrapper: AUTHORED.wrapper,
      vip_branch: ZH.vip_branch,
      standard_branch: ZH.standard_branch,
    });
  });

  it('negotiates the locale like every other overlay (bare zh reaches zh-CN)', () => {
    const out = translateObject(clone(DOC), BUNDLE, { locale: 'zh' }) as any;
    expect(out.validations[0].message).toBe(ZH.closed_is_final);
  });

  it('walks the declared fallback chain, then the authored message', () => {
    const out = translateObject(clone(DOC), BUNDLE, { locale: 'de', fallbackChain: ['en'] }) as any;
    expect(messagesOf(out)).toEqual({
      closed_is_final: 'Closed is final (en catalog).',
      refund_needs_reason: AUTHORED.refund_needs_reason,
      untranslated_rule: AUTHORED.untranslated_rule,
      wrapper: AUTHORED.wrapper,
      vip_branch: AUTHORED.vip_branch,
      standard_branch: AUTHORED.standard_branch,
    });
  });

  it('is reached through the /meta door, translateMetadataDocument("object")', () => {
    const out = translateMetadataDocument('object', clone(DOC), BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.validations[1].message).toBe(ZH.refund_needs_reason);
  });

  it('does not mutate the input document', () => {
    const input = clone(DOC);
    translateObject(input, BUNDLE, { locale: 'zh-CN' });
    expect(input).toEqual(clone(DOC));
  });
});

describe('#27135 the fallbacks are the rule evaluator\'s', () => {
  it('keeps the authored message for a locale with no entry and no fallback', () => {
    const doc = clone(DOC);
    const out = translateObject(doc, BUNDLE, { locale: 'de' }) as any;
    expect(messagesOf(out)).toEqual(messagesOf(doc));
    // Nothing matched: the authored array goes out by reference.
    expect(out.validations).toBe(doc.validations);
  });

  it('keeps the authored message with no bundle at all', () => {
    const doc = clone(DOC);
    const out = translateObject(doc, undefined, { locale: 'zh-CN' }) as any;
    expect(out.validations).toBe(doc.validations);
  });

  it('keeps the authored message of a rule with no name', () => {
    const doc = clone(DOC);
    delete doc.validations[0].name;
    const out = translateObject(doc, BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.validations[0].message).toBe(AUTHORED.closed_is_final);
    expect(out.validations[1].message).toBe(ZH.refund_needs_reason);
  });

  it('keeps the authored message when the entry is empty', () => {
    const bundle = TranslationBundleSchema.parse({
      'zh-CN': localeData({ closed_is_final: '' }),
    });
    const doc = clone(DOC);
    const out = translateObject(doc, bundle, { locale: 'zh-CN' }) as any;
    expect(out.validations[0].message).toBe(AUTHORED.closed_is_final);
  });

  it('reads no other spelling of the address', () => {
    // The retired top-level `validationMessages` shape and a bare rule key
    // under the object: neither is the evaluator's key, so neither applies.
    const bundle: any = {
      'zh-CN': {
        validationMessages: { closed_is_final: '错误的地址一' },
        objects: { helpdesk_ticket: { closed_is_final: { message: '错误的地址二' } } },
      },
    };
    const out = translateObject(clone(DOC), bundle, { locale: 'zh-CN' }) as any;
    expect(out.validations[0].message).toBe(AUTHORED.closed_is_final);
  });
});

describe('#27135 the fields and actions overlays are unchanged', () => {
  it('translates fields and actions exactly as it does for a document without validations', () => {
    const { validations: _dropped, ...withoutRules } = clone(DOC);
    const withRules = translateObject(clone(DOC), BUNDLE, { locale: 'zh-CN' }) as any;
    const without = translateObject(withoutRules, BUNDLE, { locale: 'zh-CN' }) as any;
    expect(withRules.fields).toEqual(without.fields);
    expect(withRules.actions).toEqual(without.actions);
    expect(withRules.label).toBe('工单');
    expect(withRules.fields.status.label).toBe('状态');
    expect(withRules.fields.status.options.map((o: any) => o.label)).toEqual(['打开', '已关闭']);
    expect(withRules.actions[0].label).toBe('升级');
  });

  it('adds no validations key to a document that declares none', () => {
    const { validations: _dropped, ...withoutRules } = clone(DOC);
    const out = translateObject(withoutRules, BUNDLE, { locale: 'zh-CN' }) as any;
    expect('validations' in out).toBe(false);
  });
});

/**
 * ADR-0029 D9.2a — the catalog LOSES to a tenant's rewrite of a rule message.
 *
 * The catalog translates the PACKAGED rule, so a served message that diverged
 * from the packaged rule of the same name is the tenant's own sentence and is
 * served as written, in every locale. The comparison is the one every other
 * string on the object is judged by (`valueOverridesPackagedBase`), against
 * the packaged object the serving layer hands over as `packagedBase`. The
 * refusal of the same write applies the same rule beside the evaluator, in
 * objectql's `engine-validation-tenant-rewrite`.
 */
describe('ADR-0029 D9.2a a tenant-rewritten rule message beats the packaged translation', () => {
  const REWRITE = {
    closed_is_final: 'Closed tickets stay closed — open a new one instead.',
    vip_branch: 'Every VIP ticket needs a named owner.',
  };

  /** The tenant's overlay: two messages rewritten, one rule of its own. */
  const tenantDoc = () => {
    const doc = clone(DOC);
    doc.validations[0].message = REWRITE.closed_is_final;
    doc.validations[3].then.message = REWRITE.vip_branch;
    doc.validations.push(rule({
      type: 'script',
      name: 'tenant_only_rule',
      message: 'Our own rule, in our own words.',
      condition: 'record.owner == null',
    }));
    return doc;
  };

  /** A catalog entry for the tenant's own rule too: it still must not apply. */
  const bundle = TranslationBundleSchema.parse({
    'zh-CN': localeData({ ...ZH, tenant_only_rule: '不该出现的译文。' }),
  });

  it('serves the rewrite as written, and still translates every rule the tenant left alone', () => {
    const out = translateObject(tenantDoc(), bundle, { locale: 'zh-CN', packagedBase: clone(DOC) }) as any;
    expect(messagesOf(out)).toEqual({
      closed_is_final: REWRITE.closed_is_final,
      refund_needs_reason: ZH.refund_needs_reason,
      untranslated_rule: AUTHORED.untranslated_rule,
      wrapper: AUTHORED.wrapper,
      vip_branch: REWRITE.vip_branch,
      standard_branch: ZH.standard_branch,
    });
    // A rule the packaged object does not declare was authored after the fact.
    expect(out.validations[4].message).toBe('Our own rule, in our own words.');
  });

  it('counts every named rule as authored when the packaged object declares none', () => {
    const { validations: _dropped, ...bare } = clone(DOC);
    const doc = tenantDoc();
    const out = translateObject(doc, bundle, { locale: 'zh-CN', packagedBase: bare }) as any;
    expect(out.validations).toBe(doc.validations);
  });

  it('infers nothing without a packaged base: the catalog applies, as before', () => {
    const out = translateObject(tenantDoc(), bundle, { locale: 'zh-CN' }) as any;
    expect(out.validations[0].message).toBe(ZH.closed_is_final);
    expect(out.validations[3].then.message).toBe(ZH.vip_branch);
  });

  it('is reached through the /meta door with the base the serving layer supplies', () => {
    const out = translateMetadataDocument('object', tenantDoc(), bundle, {
      locale: 'zh-CN',
      packagedBase: clone(DOC),
    }) as any;
    expect(out.validations[0].message).toBe(REWRITE.closed_is_final);
    expect(out.validations[1].message).toBe(ZH.refund_needs_reason);
  });
});
