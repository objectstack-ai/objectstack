// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The showcase's declared email templates have to be REACHABLE, and the only
// way to know that is to resolve them.
//
// The bug this pins: `showcase_task_done_email` declared `locale: 'en'`.
// `sendTemplate`'s ladder is exact match → `en-US` → (no-locale calls only) the
// bundle's lowest tag, with deliberately no language-prefix matching, so `en`
// never satisfies `en-US`. Measured against the old declaration, through the
// same loader used below: `load(name, 'en-US')` answered `null`, and a
// `sendTemplate({ locale: 'en-US' })` threw
// `TEMPLATE_NOT_FOUND: showcase_task_done_email (locale=en-US)`. A no-locale
// send still worked — by falling through to rung 3, the arbitrary-looking
// "lowest tag in the bundle" — which is exactly why the defect was latent.
//
// So these assertions run the DECLARED templates through the real read path:
// the registry loader plugin-email resolves every send through
// (`createRegistryEmailTemplateLoader`, ADR-0131 D6/D10), over the templates
// as the manifest decomposition registers them — the declared documents
// themselves — with the canonical schema parse it applies. Nothing here
// inspects the source literal's strings; every verdict is a resolution. The
// composition of rungs 1-3 itself is plugin-email's own contract and is
// pinned there (`template-locale-resolution.test.ts`).

import { describe, it, expect } from 'vitest';
import { EmailTemplateDefinitionSchema } from '@objectstack/spec/system';
import {
  createRegistryEmailTemplateLoader,
  DEFAULT_TEMPLATE_LOCALE,
} from '@objectstack/plugin-email';
import { allEmails, TaskDoneEmail } from '../src/system/emails/index.js';

/**
 * The registry as the manifest decomposition leaves it: each declared
 * `emailTemplates:` entry registered as-is under the `email_template` type.
 * The loader reads nothing else for an app's own declarations.
 */
const loader = () => createRegistryEmailTemplateLoader({
  registry: {
    listItems: (type: string) => {
      expect(type).toBe('email_template');
      return allEmails.map((t) => ({ ...t, _packageId: 'com.example.showcase' }));
    },
  },
});

describe('showcase email templates — declared tags the send ladder can actually reach', () => {
  it('resolves `showcase_task_done_email` for an explicit en-US send', async () => {
    const found = await loader().load('showcase_task_done_email', DEFAULT_TEMPLATE_LOCALE);

    // The regression, stated as the send that used to fail. For an explicit
    // `en-US` the loader IS the whole ladder: rung 1 and rung 2 name the same
    // tag, so a null here is a `TEMPLATE_NOT_FOUND` throw at the service.
    expect(found).not.toBeNull();
    expect(found?.locale).toBe('en-US');
  });

  it('resolves THIS template, not some other row of the bundle', async () => {
    const found = await loader().load('showcase_task_done_email', DEFAULT_TEMPLATE_LOCALE);

    // A resolution that answers the wrong row is the failure mode a bare
    // "not null" assertion cannot see, so pin the identity of what came back.
    expect(found?.name).toBe('showcase_task_done_email');
    expect(found?.subject).toBe(TaskDoneEmail.subject);
    expect(found?.body_html).toBe(TaskDoneEmail.bodyHtml);
  });

  it('answers a no-locale send from the default rung, not from the lowest-tag rung', async () => {
    // Rung 3 ("no en-US row at all ⇒ the bundle's lowest tag") is a
    // keep-the-tenant-working fallback, not a place an authored corpus should
    // be living. With the row at en-US this send is answered by rung 2.
    const found = await loader().load('showcase_task_done_email', undefined);
    expect(found?.locale).toBe(DEFAULT_TEMPLATE_LOCALE);
  });

  it('does NOT answer the language-only tag `en` — and does not need to', async () => {
    // Pinned in the true direction: there is no prefix matching in either
    // direction, so an `en` lookup misses rung 1 by design. It still delivers,
    // because rung 2 of the service ladder is `en-US` — which is precisely why
    // `en-US` is the tag reachable from every call shape and `en` is not.
    expect(await loader().load('showcase_task_done_email', 'en')).toBeNull();
  });

  it('every declared template in the corpus is reachable at the default locale', async () => {
    // The class guard: a template added later cannot reintroduce the defect
    // by picking a tag the ladder's default rung does not name.
    for (const template of allEmails) {
      const name = EmailTemplateDefinitionSchema.parse(template).name;
      const found = await loader().load(name, DEFAULT_TEMPLATE_LOCALE);
      expect(found, `${name} is unreachable at ${DEFAULT_TEMPLATE_LOCALE}`).not.toBeNull();
    }
  });

  it('every declared template went through `defineEmailTemplateDefinition`', async () => {
    // The second half of the card: the literal used to be exported bare, so
    // `EmailTemplateDefinitionSchema.parse()` never ran at authoring time. A
    // definition that has been through the factory is a FIXED POINT of the
    // parse (every default already applied); a bare literal is not.
    for (const template of allEmails) {
      expect(EmailTemplateDefinitionSchema.parse(template)).toEqual(template);
    }
  });
});
