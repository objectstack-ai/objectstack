// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  APPROVAL_EMAIL_CHANNELS,
  APPROVAL_EMAIL_LINK_LINES,
  APPROVAL_EMAIL_TEMPLATES,
  EMAILED_APPROVAL_TOPICS,
} from './approval-email-templates.js';
import { approvalMessages } from './translations/messages.js';

/**
 * [#30509] The approval e-mail's templates: every emailed topic in every
 * language the approval catalog carries, each the notice's own title and
 * body plus one line linking to the request.
 */
describe('approval e-mail templates', () => {
  it('the four lifecycle topics request the inbox and e-mail', () => {
    expect([...EMAILED_APPROVAL_TOPICS].sort()).toEqual(['approval.approved', 'approval.rejected', 'approval.reminder', 'approval.requested']);
    expect(APPROVAL_EMAIL_CHANNELS).toEqual(['inbox', 'email']);
  });

  it('carries a link line in exactly the locales the approval catalog carries', () => {
    expect(Object.keys(APPROVAL_EMAIL_LINK_LINES).sort()).toEqual(Object.keys(approvalMessages).sort());
  });

  it('declares one e-mail template per topic and locale: the title, the body, then the link', () => {
    const keys = APPROVAL_EMAIL_TEMPLATES.map((t) => `${t.topic}|${t.channel}|${t.locale}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(EMAILED_APPROVAL_TOPICS.size * Object.keys(APPROVAL_EMAIL_LINK_LINES).length);
    for (const t of APPROVAL_EMAIL_TEMPLATES) {
      expect(t.channel).toBe('email');
      expect(t.format).toBe('text');
      expect(t.subject).toBe('{{title}}');
      expect(t.body).toBe(`{{body}}\n\n${APPROVAL_EMAIL_LINK_LINES[t.locale as keyof typeof APPROVAL_EMAIL_LINK_LINES]}`);
      expect([...t.body!.matchAll(/\{\{\s*([\w.$]+)\s*\}\}/g)].map((m) => m[1])).toEqual(['body', 'approvalUrl']);
    }
  });
});
