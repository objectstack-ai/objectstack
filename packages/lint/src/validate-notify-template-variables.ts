// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `notify` node that sends an email template without a variable the
 * template declares `required`.
 *
 * ## The gap it closes
 *
 * A `notify` node's localizable path names an `email_template` bundle
 * (`config.template`) and hands it a render context (`config.templateData`,
 * one value slot per key — `NotifyConfigSchema`). At delivery the email
 * service lays that context over the deployment's default one
 * (`email.defaultTemplateContext`, which always carries `appName` and
 * `baseUrl`) and refuses the send with `MISSING_VARIABLES` when a variable the
 * resolved locale member declares `required` resolves to nothing — on every
 * channel, because the inbox's `renderTemplate` reads the same resolver. So a
 * flow written against one set of variables, sending a template that requires
 * another, saves green and then delivers nothing, run after run. Ruling record
 * 6845318122 (letter B) orders the authoring-time check this rule is: no new
 * template syntax, the template declares what it needs, and the flow that
 * does not supply it is told at validation.
 *
 * ## Only what is determinable from the metadata
 *
 * A path resolves the way the renderer's lookup reads it: split on `.`, one
 * key per segment, from the root. A required variable is reported missing
 * only when the node's `templateData` provably does not supply it:
 *
 * - its root is no `templateData` key, and is neither `appName`, `baseUrl`
 *   nor a key of the stack's own `email.defaultTemplateContext`; or
 * - its root is a key whose value is a literal (not a CEL value envelope),
 *   and the walk through that literal reaches a missing key, a non-object or
 *   `null` — the service's check reads a `null` as absent.
 *
 * A root whose value is a CEL value envelope is computed per run, so it is
 * not judged. A dotted `templateData` KEY (`'task.title'`) is one key, not a
 * path: it never supplies `task.title`, which the renderer reads as `title`
 * under `task` — the hint names this case.
 *
 * The template is judged only when the stack declares it (`emailTemplates`,
 * by `name`): a built-in template, another package's, or one authored in
 * Studio has a declaration this pass cannot see. Each locale member is judged
 * with its own `variables`, since each recipient is sent the member of their
 * own locale.
 *
 * ## Why `warning`
 *
 * The render context has one contributor the stack does not always state: a
 * host may hand `EmailServicePlugin` a `defaultTemplateContext` in code, and
 * a variable supplied there is supplied to every send. A key the stack's own
 * `email.defaultTemplateContext` names is read; anything beyond it is not
 * visible here, so the verdict is not a certainty about the deployment and
 * this rule advises rather than refuses (the family's precedent: a gating
 * verdict is a certainty about literals,
 * `validate-notify-email-field-recipients.ts`). A refusal would also make a
 * flow that saves today fail to save, a narrowing this check does not need to
 * warn the author.
 *
 * ## Where it runs
 *
 * `os validate`, `os build` and `os lint`. Not the runtime publish door: a
 * flow write's snapshot does not carry the email templates it would resolve
 * against (`RUNTIME_NEEDS_FULL_SNAPSHOT` in `authoring-rules.ts`).
 */

import { isExpressionEnvelopeShaped } from '@objectstack/spec/automation';

import { collectionEntries } from './collection-entries.js';
import { flowNodeLabel, walkFlowNodes } from './flow-walk.js';
import { recordsOf } from './object-graph.js';

type AnyRec = Record<string, unknown>;

export const NOTIFY_TEMPLATE_VARIABLE_MISSING = 'notify-template-variable-missing';

export interface NotifyTemplateVariableFinding {
  /** Always `warning`; see the module note. */
  severity: 'warning';
  rule: typeof NOTIFY_TEMPLATE_VARIABLE_MISSING;
  /** Human-readable location, e.g. `flow "deal_won" › node "Tell the owner"`. */
  where: string;
  /** Config path, e.g. `flows[0].nodes[2].config.templateData`. */
  path: string;
  message: string;
  hint: string;
}

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** The keys every send's default context carries, whatever the deployment configures. */
const ALWAYS_IN_CONTEXT: readonly string[] = ['appName', 'baseUrl'];

/** One locale member of a declared template: its locale tag and its required variable names. */
interface TemplateMember {
  locale: string;
  required: string[];
}

/** `name -> locale members` for every email template the stack declares. */
function indexTemplates(stack: AnyRec): Map<string, TemplateMember[]> {
  const index = new Map<string, TemplateMember[]>();
  for (const { rec } of collectionEntries(stack.emailTemplates, 'emailTemplates')) {
    if (typeof rec.name !== 'string' || rec.name === '') continue;
    const required = Array.isArray(rec.variables)
      ? rec.variables.flatMap((v) =>
        isRec(v) && v.required === true && typeof v.name === 'string' && v.name !== '' ? [v.name] : [])
      : [];
    const members = index.get(rec.name) ?? [];
    members.push({ locale: typeof rec.locale === 'string' && rec.locale !== '' ? rec.locale : 'en-US', required });
    index.set(rec.name, members);
  }
  return index;
}

/** The root keys the deployment's default context supplies, as far as the stack states it. */
function contextKeysOf(stack: AnyRec): Set<string> {
  const keys = new Set(ALWAYS_IN_CONTEXT);
  const email = stack.email;
  if (isRec(email) && isRec(email.defaultTemplateContext)) {
    for (const key of Object.keys(email.defaultTemplateContext)) keys.add(key);
  }
  return keys;
}

/**
 * Whether `templateData` supplies `name` as the renderer's lookup reads it:
 * `true` when it does or when that is decided per run, `false` only when the
 * literals prove it does not.
 */
function mayBeSupplied(name: string, data: AnyRec, contextKeys: ReadonlySet<string>): boolean {
  const [root, ...rest] = name.split('.');
  if (!Object.prototype.hasOwnProperty.call(data, root)) return contextKeys.has(root);
  let cur: unknown = data[root];
  // A CEL value envelope is evaluated per run: its value is not in the metadata.
  if (isExpressionEnvelopeShaped(cur)) return true;
  for (const segment of rest) {
    if (!isRec(cur) || !Object.prototype.hasOwnProperty.call(cur, segment)) return false;
    cur = cur[segment];
  }
  return cur !== null && cur !== undefined;
}

/**
 * Flag every `notify` node whose `templateData` provably does not supply a
 * variable its template declares `required` (module note). Pure
 * `(stack) => Finding[]`; safe on pre- or post-parse stacks.
 */
export function validateNotifyTemplateVariables(stack: AnyRec): NotifyTemplateVariableFinding[] {
  const findings: NotifyTemplateVariableFinding[] = [];
  if (!isRec(stack)) return findings;
  const flows = recordsOf(stack.flows);
  if (flows.length === 0) return findings;

  // Built lazily: a stack with no template-sending notify node never pays it.
  let templates: Map<string, TemplateMember[]> | undefined;
  let contextKeys: Set<string> | undefined;

  flows.forEach((flow, flowIndex) => {
    const flowName = typeof flow.name === 'string' && flow.name ? flow.name : `#${flowIndex}`;
    // Every node, nested regions included (`walkFlowNodes`).
    walkFlowNodes(flow, `flows[${flowIndex}]`).forEach(({ node, path: nodePath, regionTrail }, walkIndex) => {
      if (node.type !== 'notify' || !isRec(node.config)) return;
      const config = node.config;
      const templateName = typeof config.template === 'string' ? config.template.trim() : '';
      if (templateName === '') return;
      // A malformed `templateData` is the schema's to refuse.
      if (config.templateData !== undefined && !isRec(config.templateData)) return;
      const data: AnyRec = isRec(config.templateData) ? config.templateData : {};

      templates ??= indexTemplates(stack);
      const members = templates.get(templateName);
      if (!members) return;
      contextKeys ??= contextKeysOf(stack);

      // Missing name -> the locales whose member requires it, in declaration order.
      const missing = new Map<string, string[]>();
      for (const member of members) {
        for (const name of member.required) {
          if (mayBeSupplied(name, data, contextKeys)) continue;
          const locales = missing.get(name) ?? [];
          if (!locales.includes(member.locale)) locales.push(member.locale);
          missing.set(name, locales);
        }
      }
      if (missing.size === 0) return;

      const nodeName = flowNodeLabel(node, walkIndex);
      const where = `flow "${flowName}" › ${regionTrail ? `${regionTrail} › ` : ''}node "${nodeName}"`;
      const allLocales = members.map((m) => m.locale);
      const list = [...missing].map(([name, locales]) => {
        const every = locales.length === allLocales.length;
        return `\`${name}\`${every ? '' : ` (required by its ${locales.join(', ')} member${locales.length > 1 ? 's' : ''})`}`;
      });
      const dottedKeys = [...missing.keys()].filter((name) => name.includes('.') && Object.prototype.hasOwnProperty.call(data, name));
      findings.push({
        severity: 'warning',
        rule: NOTIFY_TEMPLATE_VARIABLE_MISSING,
        where,
        path: `${nodePath}.config.${config.templateData !== undefined ? 'templateData' : 'template'}`,
        message:
          `notify node sends email template '${templateName}', which declares ${list.join(', ')} required, and `
          + `the node's \`templateData\` does not supply ${missing.size > 1 ? 'them' : 'it'}: each send to a recipient `
          + 'whose locale resolves to a member that requires it fails with MISSING_VARIABLES, and nothing is delivered '
          + 'to that recipient.',
        hint:
          `Pass ${[...missing.keys()].map((n) => `\`${n}\``).join(', ')} in the node's \`templateData\` — a literal, or a `
          + "CEL value envelope `{ dialect: 'cel', source }` evaluated per run — or stop declaring it `required` and "
          + "give its hole a literal default (`{{ name | default:'…' }}`). A default is literal text; to read another "
          + 'variable, compute it in the flow.'
          + (dottedKeys.length > 0
            ? ` A \`templateData\` key is one name, not a path: the key ${dottedKeys.map((k) => `'${k}'`).join(', ')} `
              + `is never read as \`${dottedKeys[0]}\`, which is \`${dottedKeys[0].split('.').slice(1).join('.')}\` `
              + `under \`${dottedKeys[0].split('.')[0]}\` — pass \`${dottedKeys[0].split('.')[0]}\` with an object value.`
            : '')
          + ' If the deployment supplies it through its email service\'s default template context, ignore this.',
      });
    });
  });

  return findings;
}
