import { it } from 'vitest';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { validateHookBodyWrites } from './validate-hook-body-writes.js';
import { validateActionBodyWrites } from './validate-action-body-writes.js';
import { validateEmailTemplateHoleGrammar } from './validate-email-template-hole-grammar.js';

const deal = { name: 'crm_deal', fields: { stage: { type: 'text' }, amount: { type: 'currency' }, locked_note: { type: 'text', readonlyWhen: 'stage == "won"' } } };
const hook = { name: 'normalize_deal', object: 'crm_deal', events: ['beforeInsert'], body: { language: 'js', source: "ctx.input.stagee = 'x'; await ctx.api.object('crm_deal').update('1', { locked_note: 'x' });" } };
const action = { name: 'bump', label: 'Bump', objectName: 'crm_deal', type: 'script', body: { language: 'js', source: "ctx.record.stage = 'x'; await ctx.api.object('crm_deal').update('1', { stagee: 1, locked_note: 'y' });" } };
const tpl = { name: 'stalled', subject: 'Stalled at {{ status | option:sys_userz.status }}', bodyText: 'x' };

it('measure', () => {
  const show = (label: string, r: any) => console.log(label, JSON.stringify({ rulesRun: r.rulesRun.length, adv: r.advisories.map((f: any) => f.rule), err: r.errors.map((f: any) => f.rule) }));
  console.log('direct hook', validateHookBodyWrites({ objects: [deal], hooks: [hook] }).map((f) => f.rule));
  console.log('direct action', validateActionBodyWrites({ objects: [deal], actions: [action] }).map((f) => f.rule));
  console.log('direct email', validateEmailTemplateHoleGrammar({ emailTemplates: [tpl] }).map((f) => f.severity + ':' + f.rule));
  show('gate hook', runRuntimeAuthoringRules({ type: 'hook', item: hook, context: { objects: [deal] } }));
  show('gate action', runRuntimeAuthoringRules({ type: 'action', item: action, context: { objects: [deal] } }));
  show('gate object+action', runRuntimeAuthoringRules({ type: 'object', item: { ...deal, actions: [action] }, context: { objects: [] } }));
  show('gate email', runRuntimeAuthoringRules({ type: 'email_template', item: tpl, context: { objects: [deal] } }));
});
