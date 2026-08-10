// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  SpecifierType,
  SpecifierValueDomainSchema,
  SpecifierSchema,
  SettingsManifestSchema,
  ResolvedSettingValueSchema,
  SettingsNamespacePayloadSchema,
  SettingsActionResultSchema,
  type SettingsManifest,
  type Specifier,
} from './settings-manifest.zod';

describe('SpecifierType', () => {
  it('accepts the closed set of specifier kinds', () => {
    const kinds = [
      'group', 'child_pane', 'info_banner', 'title_value',
      'text', 'textarea', 'password', 'email', 'url', 'phone',
      'number', 'toggle', 'select', 'radio', 'multiselect',
      'slider', 'color', 'json', 'action_button',
    ];
    for (const k of kinds) {
      expect(() => SpecifierType.parse(k)).not.toThrow();
    }
  });

  it('rejects unknown specifier kinds', () => {
    expect(() => SpecifierType.parse('rich_text')).toThrow();
    expect(() => SpecifierType.parse('')).toThrow();
  });
});

describe('SpecifierSchema — value-bearing specifiers', () => {
  it('accepts a minimal text specifier', () => {
    const spec: Specifier = {
      type: 'text',
      key: 'smtp_host',
      label: 'Host',
      required: false,
    };
    const parsed = SpecifierSchema.parse(spec);
    expect(parsed.key).toBe('smtp_host');
    expect(parsed.type).toBe('text');
  });

  it('requires a key for value-bearing specifiers', () => {
    expect(() =>
      SpecifierSchema.parse({ type: 'text', label: 'No key' } as any)
    ).toThrow(/requires a 'key'/);
  });

  it('accepts a password specifier (encryption is implicit)', () => {
    const parsed = SpecifierSchema.parse({
      type: 'password',
      key: 'api_key',
      label: 'API Key',
    });
    expect(parsed.type).toBe('password');
  });

  it('enforces min ≤ max on numeric specifiers', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'number',
        key: 'retries',
        label: 'Retries',
        min: 10,
        max: 3,
      })
    ).toThrow(/'min' must be ≤ 'max'/);
  });

  it('enforces minLength ≤ maxLength on text specifiers', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'text',
        key: 'name',
        label: 'Name',
        minLength: 10,
        maxLength: 4,
      })
    ).toThrow(/'minLength' must be ≤ 'maxLength'/);
  });

  it('requires options on select specifiers', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'select',
        key: 'provider',
        label: 'Provider',
      })
    ).toThrow(/requires non-empty 'options'/);
  });

  it('accepts a select with options', () => {
    const parsed = SpecifierSchema.parse({
      type: 'select',
      key: 'provider',
      label: 'Provider',
      options: [
        { value: 'smtp', label: 'SMTP' },
        { value: 'sendgrid', label: 'SendGrid' },
      ],
    });
    expect(parsed.options).toHaveLength(2);
  });

  it('rejects deprecated without replacedBy', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'text',
        key: 'old_key',
        label: 'Old',
        deprecated: true,
      })
    ).toThrow(/replacedBy/);
  });
});

describe('SpecifierSchema — layout-only specifiers', () => {
  it('accepts a group without a key', () => {
    const parsed = SpecifierSchema.parse({
      type: 'group',
      label: 'SMTP',
    });
    expect(parsed.type).toBe('group');
    expect(parsed.key).toBeUndefined();
  });

  it('rejects a group that carries a key', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'group',
        key: 'should_not_have_key',
        label: 'Bad Group',
      })
    ).toThrow(/must not declare a 'key'/);
  });

  it('accepts an info_banner with text', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'info_banner',
        label: 'Notice',
        bannerText: 'Be careful with **prod** credentials.',
        bannerSeverity: 'warning',
      })
    ).not.toThrow();
  });

  it('rejects an info_banner without bannerText', () => {
    expect(() =>
      SpecifierSchema.parse({ type: 'info_banner', label: 'Notice' })
    ).toThrow(/requires 'bannerText'/);
  });

  it('accepts a child_pane with childNamespace', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'child_pane',
        label: 'Advanced',
        childNamespace: 'mail_advanced',
      })
    ).not.toThrow();
  });

  it('rejects a child_pane without childNamespace', () => {
    expect(() =>
      SpecifierSchema.parse({ type: 'child_pane', label: 'Advanced' })
    ).toThrow(/requires a 'childNamespace'/);
  });

  it('accepts an action_button with handler', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'action_button',
        label: 'Send Test Email',
        handler: {
          kind: 'http',
          method: 'POST',
          url: '/api/settings/mail/test',
          body: { to: '${ctx.user.email}' },
        },
      })
    ).not.toThrow();
  });

  it('rejects an action_button without handler', () => {
    expect(() =>
      SpecifierSchema.parse({ type: 'action_button', label: 'Test' })
    ).toThrow(/requires a 'handler'/);
  });
});

describe('SpecifierValueDomainSchema — the closed standard-domain vocabulary (#5933)', () => {
  it('accepts exactly the three domains with measured authoring pull', () => {
    for (const d of ['iana_time_zone', 'iso_4217_currency', 'iso_3166_alpha2']) {
      expect(() => SpecifierValueDomainSchema.parse(d)).not.toThrow();
    }
    expect(SpecifierValueDomainSchema.options).toEqual([
      'iana_time_zone',
      'iso_4217_currency',
      'iso_3166_alpha2',
    ]);
  });

  it('rejects `bcp47_locale` — the proposal member that was deliberately dropped', () => {
    // #5933's proposal listed a fourth member. Its only candidate key is
    // `localization.locale`, a `select` whose options ARE the shipped message
    // catalogs — a registry-backed table, so declaring a domain there would
    // LOOSEN it (options degrade to a suggestion list) and admit locales that
    // have no catalog. And BCP-47 has no membership registry to enforce
    // against: `Intl.getCanonicalLocales('xx-YY')` succeeds, so the "domain"
    // would only re-check syntax — exactly the weakness `pattern` already has
    // and this key exists to fix. It is not in the vocabulary; a manifest that
    // spells it is refused by name rather than silently stripped.
    expect(() => SpecifierValueDomainSchema.parse('bcp47_locale')).toThrow();
    expect(() => Intl.getCanonicalLocales('xx-YY')).not.toThrow();
  });

  it('rejects unknown domains', () => {
    expect(() => SpecifierValueDomainSchema.parse('iso_9999_unicorn')).toThrow();
    expect(() => SpecifierValueDomainSchema.parse('')).toThrow();
  });
});

describe('Specifier.valueDomain (#5933)', () => {
  it('SURVIVES the parse — a dropped key is the defect this closes', () => {
    // #5712's dev measured the current shape by smuggling a `format` key in:
    // Zod stripped it and `parse()` returned `undefined`, so the manifest had
    // no way to say "the boundary is a standard". This assertion is that
    // measurement inverted, and it is the one that must never regress.
    const parsed = SpecifierSchema.parse({
      type: 'select',
      key: 'timezone',
      label: 'Default timezone',
      valueDomain: 'iana_time_zone',
      options: [{ value: 'UTC', label: 'UTC' }],
    });
    expect(parsed.valueDomain).toBe('iana_time_zone');
  });

  it('is optional — an undeclared specifier keeps #5131 exhaustive-options semantics', () => {
    const parsed = SpecifierSchema.parse({
      type: 'select',
      key: 'provider',
      label: 'Provider',
      options: [{ value: 'smtp', label: 'SMTP' }],
    });
    expect(parsed.valueDomain).toBeUndefined();
  });

  it('accepts a `text` specifier alongside pattern/length constraints', () => {
    // Shape and membership are independent narrowings and a value must satisfy
    // both — `^[A-Za-z]{2}$` is what admits `ZZ` today, which is why the domain
    // is added rather than the pattern replaced.
    const parsed = SpecifierSchema.parse({
      type: 'text',
      key: 'default_country',
      label: 'Default country',
      valueDomain: 'iso_3166_alpha2',
      pattern: '^[A-Za-z]{2}$',
      minLength: 2,
      maxLength: 2,
    });
    expect(parsed.valueDomain).toBe('iso_3166_alpha2');
    expect(parsed.pattern).toBe('^[A-Za-z]{2}$');
  });

  it('still requires `options` on a select — the list degrades, it does not vanish', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'select',
        key: 'currency',
        label: 'Default currency',
        valueDomain: 'iso_4217_currency',
      })
    ).toThrow(/requires non-empty 'options'/);
  });

  it('rejects a valueDomain on a layout-only specifier', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'group',
        label: 'Region',
        valueDomain: 'iana_time_zone',
      })
    ).toThrow(/carries no value, so it must not declare a 'valueDomain'/);
  });

  it('rejects an unknown domain on an otherwise valid specifier', () => {
    expect(() =>
      SpecifierSchema.parse({
        type: 'text',
        key: 'default_country',
        label: 'Default country',
        valueDomain: 'iso_3166_alpha3',
      })
    ).toThrow();
  });
});

describe('`visible` — the settings visibility grammar (#7327)', () => {
  const withVisible = (visible: unknown) =>
    SpecifierSchema.safeParse({ type: 'text', key: 'smtp_host', label: 'Host', visible });
  const firstMessage = (visible: unknown): string => {
    const result = withVisible(visible);
    return result.success ? '' : result.error.issues[0].message;
  };

  // The shapes the ten bundled manifests are actually written in. The
  // cross-package half — that this schema and `evaluateVisibility` accept the
  // same set, measured against the real corpus — is pinned from the consumer
  // side, in `service-settings/src/settings-visibility-declaration.pin.test.ts`.
  it.each([
    "${data.provider === 'smtp'}",
    "${data.provider !== 'memory'}",
    '${data.email_password_enabled !== false}',
    '${data.mfa_required === true}',
    '${data.lockout_threshold > 0}',
    "${data.provider === 'resend' || data.provider === 'postmark'}",
    "${data.embedder_provider && data.embedder_provider !== 'none'}",
    '${!data.disabled}',
    '${data.count <= 10 && (data.a == 1 || data.b != null)}',
    '${data.ratio >= 0.5}',
  ])('accepts %s', (visible) => {
    expect(withVisible(visible).success).toBe(true);
  });

  it('accepts the unwrapped spelling and the `{ dialect, source }` envelope', () => {
    expect(withVisible("data.provider === 'smtp'").success).toBe(true);
    expect(withVisible({ dialect: 'cel', source: "${data.provider === 'smtp'}" }).success).toBe(true);
    // An `ast`-only envelope is opaque at this layer — nothing to walk.
    expect(withVisible({ dialect: 'cel', ast: { kind: 'opaque' } }).success).toBe(true);
  });

  it('normalises a bare string to the canonical envelope, unchanged by the narrowing', () => {
    const parsed = SpecifierSchema.parse({
      type: 'text', key: 'smtp_host', label: 'Host', visible: "${data.provider === 'smtp'}",
    });
    expect(parsed.visible).toEqual({ dialect: 'cel', source: "${data.provider === 'smtp'}" });
  });

  // The point of #7327: this slot never was CEL, and an author who wrote CEL
  // here used to be told so only by a failing tenant save (#7169 / PR #7310).
  it.each([
    ["${data.provider in ['smtp', 'resend']}", 'unsupported identifier "in"'],
    ['${size(data.recipients) > 0}', 'unsupported identifier "size"'],
    ["${current_user.role === 'admin'}", 'unsupported identifier "current_user.role"'],
    ['${data.nested.field === 1}', 'unsupported reference "data.nested.field"'],
    ["${data.provider.startsWith('s')}", 'unsupported reference "data.provider.startsWith"'],
  ])('refuses CEL %s', (visible, detail) => {
    expect(withVisible(visible).success).toBe(false);
    expect(firstMessage(visible)).toContain(detail);
  });

  it.each([
    ['${data.provider ===}', 'unexpected end of expression'],
    ["${data.a === 'x'} && ${data.b === 'y'}", 'unexpected character "}"'],
    ['${-5 > data.x}', 'unexpected character "-"'],
    ["${(data.a === 'x'}", 'missing closing parenthesis'],
    ["${data.a 'x'}", 'trailing tokens'],
  ])('refuses malformed %s', (visible, detail) => {
    expect(withVisible(visible).success).toBe(false);
    expect(firstMessage(visible)).toContain(detail);
  });

  it('prescribes the grammar rather than only naming the violation', () => {
    // Every part an author needs to rewrite the predicate without leaving the
    // error: the offending source, the reason, and the grammar itself.
    const message = firstMessage("${data.provider in ['smtp']}");
    expect(message).toContain("data.provider in ['smtp']");
    expect(message).toContain('unsupported identifier "in"');
    expect(message).toContain('not CEL');
    expect(message).toContain('one-level member access');
    expect(message).toContain('`===` `!==` `==` `!=` `>=` `<=` `>` `<`');
    expect(message).toContain("`${data.x === 'a' || data.x === 'b'}`");
  });

  it('applies to the manifest-level slot too', () => {
    const base = {
      namespace: 'demo',
      label: 'Demo',
      specifiers: [{ type: 'text', key: 'smtp_host', label: 'Host' }],
    };
    expect(SettingsManifestSchema.safeParse({ ...base, visible: "${data.tier === 'pro'}" }).success).toBe(true);
    const refused = SettingsManifestSchema.safeParse({ ...base, visible: "${data.tier in ['pro']}" });
    expect(refused.success).toBe(false);
    expect(refused.success ? [] : refused.error.issues[0].path).toEqual(['visible']);
  });
});

describe('valueDomain membership definitions — the measurements service-settings must implement', () => {
  // These pin the TSDoc on `SpecifierValueDomainSchema`. `packages/spec` does
  // not enforce a domain (Prime Directive #2) — but the two halves have to agree
  // on WHAT the domain is, and the obvious oracle is the wrong one for two of
  // the three. A doc nobody re-measures rots; these go red when it does.

  const probeTimeZone = (tz: string): boolean => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
  };

  it('iana_time_zone: the Intl.DateTimeFormat probe is the definition', () => {
    // Same shape as `isValidTimeZone` in
    // packages/core/src/security/resolve-authz-context.ts.
    for (const tz of ['UTC', 'Asia/Kolkata', 'Europe/Kyiv', 'Asia/Ho_Chi_Minh', 'US/Eastern', 'GMT', 'Asia/Shanghai']) {
      expect(probeTimeZone(tz)).toBe(true);
    }
    // And it does what `pattern` cannot: a shape-valid zone that does not exist.
    expect(probeTimeZone('Mars/Olympus')).toBe(false);
  });

  it('iana_time_zone: Intl.supportedValuesOf is NOT the definition', () => {
    // Measured on the repo's Node 22 baseline: a CLDR canonical-name subset
    // that omits values this platform itself ships. If this ever goes green in
    // the other direction, ICU has changed — re-measure before relaxing the
    // TSDoc, do not just delete the assertion.
    const enumerated = Intl.supportedValuesOf('timeZone');
    for (const shipped of ['UTC', 'Asia/Kolkata']) {
      expect(probeTimeZone(shipped)).toBe(true);
      expect(enumerated).not.toContain(shipped);
    }
    // It is not merely a subset — it renames: the zones above are present under
    // legacy spellings, so even a normalising membership test is not free.
    expect(enumerated).toContain('Asia/Calcutta');
  });

  it('iso_4217_currency: Intl.supportedValuesOf IS the definition', () => {
    const currencies = Intl.supportedValuesOf('currency');
    // The nine curated localization options plus CHF, the canonical "valid but
    // not curated" value the degraded-options semantics must admit.
    for (const c of ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'AUD', 'CAD', 'BRL', 'CHF']) {
      expect(currencies).toContain(c);
    }
    expect(currencies).not.toContain('XYZ');
  });

  it('iso_3166_alpha2: Intl.DisplayNames is NOT a membership oracle', () => {
    // The tempting test is "the display name differs from the input". It admits
    // `ZZ` — the exact value #5933 cites as slipping past `^[A-Za-z]{2}$` — and
    // `UK`, which is a CLDR alias and not an ISO 3166-1 code at all. The
    // enforcing side needs an explicit code list; that list is not spec's.
    const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    expect(regionNames.of('ZZ')).not.toBe('ZZ');
    expect(regionNames.of('UK')).not.toBe('UK');
  });
});

describe('SettingsManifestSchema', () => {
  const minimalManifest: SettingsManifest = {
    namespace: 'mail',
    version: 1,
    label: 'Mail Delivery',
    scope: 'tenant',
    readPermission: 'setup.access',
    writePermission: 'setup.write',
    specifiers: [
      { type: 'group', label: 'Provider', required: false },
      {
        type: 'select',
        key: 'provider',
        label: 'Provider',
        required: false,
        options: [
          { value: 'smtp', label: 'SMTP' },
          { value: 'sendgrid', label: 'SendGrid' },
        ],
      },
    ],
  };

  it('accepts a minimal manifest', () => {
    const parsed = SettingsManifestSchema.parse(minimalManifest);
    expect(parsed.namespace).toBe('mail');
    expect(parsed.specifiers).toHaveLength(2);
  });

  it('applies defaults: version=1, scope=tenant, perms=setup.*', () => {
    const parsed = SettingsManifestSchema.parse({
      namespace: 'branding',
      label: 'Branding',
      specifiers: [
        { type: 'text', key: 'product_name', label: 'Product Name', required: false },
      ],
    });
    expect(parsed.version).toBe(1);
    expect(parsed.scope).toBe('tenant');
    expect(parsed.readPermission).toBe('setup.access');
    expect(parsed.writePermission).toBe('setup.write');
  });

  it('requires at least one specifier', () => {
    expect(() =>
      SettingsManifestSchema.parse({
        namespace: 'empty',
        label: 'Empty',
        specifiers: [],
      })
    ).toThrow();
  });

  it('rejects duplicate specifier keys', () => {
    expect(() =>
      SettingsManifestSchema.parse({
        namespace: 'dup',
        label: 'Dup',
        specifiers: [
          { type: 'text', key: 'foo', label: 'Foo 1', required: false },
          { type: 'text', key: 'foo', label: 'Foo 2', required: false },
        ],
      })
    ).toThrow(/Duplicate specifier key 'foo'/);
  });

  it('rejects child_pane that points at its own namespace', () => {
    expect(() =>
      SettingsManifestSchema.parse({
        namespace: 'mail',
        label: 'Mail',
        specifiers: [
          {
            type: 'child_pane',
            label: 'Recursive',
            childNamespace: 'mail',
            required: false,
          },
        ],
      })
    ).toThrow(/cannot reference its own namespace/);
  });

  it('rejects namespace with invalid characters', () => {
    expect(() =>
      SettingsManifestSchema.parse({ ...minimalManifest, namespace: 'Mail-Delivery' })
    ).toThrow();
  });

  it('accepts the Mail manifest from the ADR example', () => {
    expect(() =>
      SettingsManifestSchema.parse({
        namespace: 'mail',
        label: 'Mail Delivery',
        icon: 'mail',
        description: 'Configure outbound email transport.',
        category: 'Communication',
        specifiers: [
          { type: 'group', label: 'Provider', required: false },
          {
            type: 'select',
            key: 'provider',
            label: 'Provider',
            default: 'smtp',
            required: true,
            options: [
              { value: 'smtp', label: 'SMTP' },
              { value: 'sendgrid', label: 'SendGrid' },
              { value: 'ses', label: 'Amazon SES' },
              { value: 'resend', label: 'Resend' },
            ],
          },
          { type: 'group', label: 'SMTP', visible: "${data.provider === 'smtp'}", required: false },
          {
            type: 'text', key: 'smtp_host', label: 'Host', required: true,
            visible: "${data.provider === 'smtp'}",
          },
          {
            type: 'number', key: 'smtp_port', label: 'Port', default: 587, required: false,
            visible: "${data.provider === 'smtp'}",
            min: 1, max: 65535,
          },
          {
            type: 'password', key: 'smtp_password', label: 'Password', required: false,
            visible: "${data.provider === 'smtp'}",
          },
          { type: 'group', label: 'Identity', required: false },
          { type: 'email', key: 'from_email', label: 'From Address', required: true },
          { type: 'text',  key: 'from_name',  label: 'From Name', required: false },
          {
            type: 'action_button',
            label: 'Send Test Email',
            icon: 'send',
            required: false,
            handler: {
              kind: 'http',
              method: 'POST',
              url: '/api/settings/mail/test',
              body: { to: '${ctx.user.email}' },
            },
          },
        ],
      })
    ).not.toThrow();
  });
});

describe('ResolvedSettingValueSchema', () => {
  it('accepts each source', () => {
    for (const source of ['env', 'tenant', 'user', 'default'] as const) {
      const parsed = ResolvedSettingValueSchema.parse({
        value: 'x',
        source,
        locked: source === 'env',
      });
      expect(parsed.source).toBe(source);
    }
  });

  it('rejects unknown source', () => {
    expect(() =>
      ResolvedSettingValueSchema.parse({ value: 'x', source: 'magic', locked: false })
    ).toThrow();
  });
});

describe('SettingsNamespacePayloadSchema', () => {
  it('accepts a manifest + values bundle', () => {
    const parsed = SettingsNamespacePayloadSchema.parse({
      manifest: {
        namespace: 'mail',
        label: 'Mail',
        specifiers: [
          { type: 'text', key: 'smtp_host', label: 'Host', required: false },
        ],
      },
      values: {
        smtp_host: { value: 'smtp.example.com', source: 'tenant', locked: false },
      },
    });
    expect(parsed.values.smtp_host.value).toBe('smtp.example.com');
  });
});

describe('SettingsActionResultSchema', () => {
  it('accepts ok/message', () => {
    expect(() =>
      SettingsActionResultSchema.parse({
        ok: true,
        message: 'Test email queued',
        severity: 'success',
      })
    ).not.toThrow();
  });

  it('accepts a failure with details', () => {
    const parsed = SettingsActionResultSchema.parse({
      ok: false,
      message: 'Connection refused',
      severity: 'error',
      details: { code: 'ECONNREFUSED', host: 'smtp.example.com' },
    });
    expect(parsed.ok).toBe(false);
  });
});
