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
// So these assertions run the DECLARED templates through the real boot path:
// the canonical schema parse, the real `mapTemplateToRow` projection into
// `sys_email_template` columns, and the real `createSysEmailTemplateLoader`.
// Nothing here inspects the source literal's strings; every verdict is a
// resolution. The composition of rungs 1-3 itself is plugin-email's own
// contract and is pinned there (`template-locale-resolution.test.ts`).

import { describe, it, expect } from 'vitest';
import { EmailTemplateDefinitionSchema } from '@objectstack/spec/system';
import {
  createSysEmailTemplateLoader,
  mapTemplateToRow,
  EMAIL_TEMPLATE_OBJECT,
  DEFAULT_TEMPLATE_LOCALE,
} from '@objectstack/plugin-email';
import { allEmails, TaskDoneEmail } from '../src/system/emails/index.js';

type Row = Record<string, unknown> & { id: string };

/** What the boot seeder writes: schema parse, then the shared column mapping. */
function materialize(templates: readonly unknown[]): Row[] {
  return templates.map((t, i) => ({
    id: `row-${i}`,
    ...mapTemplateToRow(EmailTemplateDefinitionSchema.parse(t) as never),
  }));
}

/**
 * A driver-ish engine over the materialized rows — filters by `where`, honours
 * `orderBy`, then `limit`. Mirrors the fake plugin-email's own resolution
 * suite uses, so the loader is exercised the way a real store exercises it.
 */
function engine(rows: Row[]) {
  return {
    async find(object: string, query: Record<string, unknown>) {
      expect(object).toBe(EMAIL_TEMPLATE_OBJECT);
      const where = (query.where ?? {}) as Record<string, unknown>;
      let out = rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
      const orderBy = query.orderBy as Array<{ field: string; order?: string }> | undefined;
      if (Array.isArray(orderBy)) {
        out = [...out].sort((a, b) => {
          for (const { field, order } of orderBy) {
            const av = String(a[field] ?? '');
            const bv = String(b[field] ?? '');
            if (av !== bv) return (av < bv ? -1 : 1) * (order === 'desc' ? -1 : 1);
          }
          return 0;
        });
      }
      return typeof query.limit === 'number' ? out.slice(0, query.limit) : out;
    },
  };
}

const loader = () => createSysEmailTemplateLoader(engine(materialize(allEmails)) as never);

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
