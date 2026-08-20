// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineEmailTemplateDefinition } from '@objectstack/spec';

/**
 * Email template declared for the Task Completed flow.
 *
 * ## Why `locale` is `en-US`, and why it is spelled out
 *
 * `sendTemplate`'s ladder is **exact match → `en-US` → (no-locale calls only)
 * the bundle's lowest tag**, with deliberately no language-prefix matching:
 * `en` does not satisfy `en-US`. Because `en-US` is the ladder's own second
 * rung, a row authored at `en-US` is reachable from *every* call shape — an
 * explicit `en-US`, this app's `defaultLocale: 'en'` (which the notify path
 * passes as the recipient locale), and a call naming no locale at all. Any
 * other tag is reachable from strictly fewer: this row used to say `en`, which
 * made `sendTemplate({ locale: 'en-US' })` fail with `TEMPLATE_NOT_FOUND`.
 *
 * The key is written out rather than left to the schema default because the
 * example corpus is what gets copied: the tag is the bundle key a second
 * language row has to match, and `content/docs/automation/email-templates.mdx`
 * teaches authoring the tags your callers actually pass.
 *
 * ## Not wired to the flow yet
 *
 * `showcase_task_completed`'s notify node demonstrates the inline
 * `title`/`message` path, which the node schema makes mutually exclusive with
 * `template` — so referencing this template there is a substitution, not an
 * addition: it would cost the script node's `{summary}` its only consumer, and
 * that consumption is what the flow exists to demonstrate. Tracked as its own
 * decision in #10394 rather than smuggled in here.
 */
export const TaskDoneEmail = defineEmailTemplateDefinition({
  name: 'showcase_task_done_email',
  label: 'Task Done Notification',
  category: 'workflow',
  locale: 'en-US',
  subject: '✅ Task done: {{title}}',
  bodyHtml: '<p>The task <strong>{{title}}</strong> on project {{project}} was marked done.</p>',
  bodyText: 'The task {{title}} on project {{project}} was marked done.',
  variables: [
    { name: 'title', type: 'string', required: true, description: 'Task title' },
    { name: 'project', type: 'string', required: false, description: 'Project name' },
  ],
  active: true,
  isSystem: false,
});

export const allEmails = [TaskDoneEmail];
