// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ruling B+ on #24966, #24994] Every meta read door withholds a webhook's
// declared credentials — `secret` (a credential value) and `headers` (a
// credential map, as a whole) — in BOTH compositions: without
// `@objectstack/plugin-webhooks`, and with it mounted.
//
// The rule under test: `WebhookSchema` marks the two fields with
// `.meta({ credential: … })`, and `getMetadataTypeRedactor('webhook')`
// resolves a redactor DERIVED from those markers (`@objectstack/spec/kernel`),
// present from module load whatever the composition mounts. A webhook's items
// reach the meta read doors identically with and without the plugin (declared
// ones through manifest decomposition, saved ones through the meta save door),
// so a plugin registration would protect only one of the two compositions;
// this file boots both.
//
// Doors pinned, per composition: the meta list (both spellings), the item read,
// the layered view, the published read, the metadata protocol's list and item
// reads, and the stored-row data door with its history twin. Each door read
// carries a positive control (the response names the webhook), so a refusal or
// an empty answer cannot pass for a withheld credential.
//
// Also pinned: the stored record is never mutated (redaction is a serving
// act); a save of the served form keeps the stored values (the metadata
// protocol's carry-forward); and, with the plugin mounted, the dispatcher's
// declared-webhook source still carries both credentials, so delivery signing
// is unaffected.
//
// Disclosure: every credential below is an obviously-fake placeholder, and
// every assertion is absence by rule, never a served value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { WebhookOutboxPlugin } from '@objectstack/plugin-webhooks';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { defineWebhook } from '@objectstack/spec/automation';

const SYSTEM = { isSystem: true, positions: [], permissions: [] };

/** Obviously-fake placeholders: absence of these strings is the whole assertion. */
const DECLARED_SECRET = 'TEST_SECRET_DECLARED_24994';
const DECLARED_HEADER = 'TEST_HEADER_DECLARED_24994';
const SAVED_SECRET = 'TEST_SECRET_SAVED_24994';
const SAVED_HEADER = 'TEST_HEADER_SAVED_24994';
const PLACEHOLDERS = [DECLARED_SECRET, DECLARED_HEADER, SAVED_SECRET, SAVED_HEADER] as const;

const DECLARED = 'wcr_declared';
const SAVED = 'wcr_saved';

const WcrTask = ObjectSchema.create({
  name: 'wcr_task',
  sharingModel: 'public_read_write',
  label: 'WCR Task',
  pluralLabel: 'WCR Tasks',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

/**
 * Built with `strict: false`, on purpose — DECLARED, not an oversight. This
 * stack declares a webhook and no `requires`, so `defineStack`'s default
 * judgement refuses it (`STACK_WEBHOOK_CAPABILITY_REQUIRED`: a declared webhook
 * owes `requires: ['webhooks', 'realtime']`, ruling A on #24910). The pins
 * below need a composition that judgement cannot reach: a hand-wired host
 * WITHOUT `@objectstack/plugin-webhooks`, where the redactor must still hold
 * because it is derived from the schema rather than registered by the plugin.
 * Declaring the pair instead would have `bootStack` mount the webhook plugin
 * the way `serve` does, and the "without plugin-webhooks" composition would
 * silently stop existing. Everything else about the stack is an ordinary
 * authored package.
 */
const fixture = defineStack({
  manifest: {
    id: 'com.dogfood.webhook-credential-redaction',
    namespace: 'wcr',
    version: '0.0.0',
    type: 'app',
    name: 'Webhook Credential Redaction Fixture',
    description: 'One object and one declared webhook carrying both declared credential fields, for the meta read-door pins of ruling B+ on #24966.',
  },
  objects: [WcrTask],
  webhooks: [
    defineWebhook({
      name: DECLARED,
      label: 'WCR Declared',
      object: 'wcr_task',
      triggers: ['create'],
      url: 'https://hooks.example/wcr-declared',
      headers: { 'X-Placeholder': DECLARED_HEADER },
      secret: DECLARED_SECRET,
      isActive: false,
    }),
  ],
}, { strict: false });

const savedBody = () => ({
  name: SAVED,
  label: 'WCR Saved',
  object: 'wcr_task',
  triggers: ['update'],
  url: 'https://hooks.example/wcr-saved',
  headers: { 'X-Placeholder': SAVED_HEADER },
  secret: SAVED_SECRET,
  isActive: false,
});

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const holdsAPlaceholder = (v: unknown): boolean => {
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return PLACEHOLDERS.some((p) => text.includes(p));
};
const bodyOf = (row: any): Record<string, unknown> =>
  typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata ?? {});

const COMPOSITIONS = [
  { label: 'without plugin-webhooks', plugins: () => [] as unknown[] },
  { label: 'with plugin-webhooks mounted', plugins: () => [new MessagingServicePlugin(), new WebhookOutboxPlugin()] },
] as const;

for (const composition of COMPOSITIONS) {
  describe(`[ruling B+] every meta read door withholds a webhook's declared credentials — ${composition.label}`, () => {
    let stack: VerifyStack;
    let admin: string;
    let member: string;
    let ql: any;
    let protocol: any;

    const stored = async (object: 'sys_metadata' | 'sys_metadata_history', name: string) =>
      rowsOf(await ql.find(object, { where: { type: 'webhook', name }, context: SYSTEM }));

    /** One door read: 200, names the webhook (positive control), and holds no credential. */
    const expectWithheld = async (token: string, path: string, names: readonly string[]) => {
      const res = await stack.apiAs(token, 'GET', path);
      const text = await res.text();
      expect(res.status, `${path}: ${text.slice(0, 200)}`).toBe(200);
      for (const name of names) expect(text.includes(name), `${path} names ${name}`).toBe(true);
      expect(holdsAPlaceholder(text), `${path} withholds the declared credential fields`).toBe(false);
    };

    beforeAll(async () => {
      stack = await bootStack(fixture as never, { extraPlugins: composition.plugins() as never });
      ql = await stack.kernel.getServiceAsync('objectql');
      protocol = await stack.kernel.getServiceAsync('protocol');
      admin = await stack.signIn();
      member = await stack.signUp(`wcr-member-${composition.plugins().length}@redaction.test`);
      const put = await stack.apiAs(admin, 'PUT', `/meta/webhook/${SAVED}`, savedBody());
      expect(put.status, await put.clone().text()).toBe(200);
    }, 180_000);

    afterAll(async () => {
      await stack?.stop?.();
    });

    it('guard the guard: the saved webhook is stored with both credential fields, and the plugin is mounted exactly when this composition says so', async () => {
      const [row] = await stored('sys_metadata', SAVED);
      expect(bodyOf(row).secret).toBe(SAVED_SECRET);
      expect(bodyOf(row).headers).toEqual({ 'X-Placeholder': SAVED_HEADER });
      let declaredService: unknown;
      try {
        declaredService = stack.kernel.getService('declaredWebhooks');
      } catch {
        declaredService = undefined;
      }
      expect(Boolean(declaredService)).toBe(composition.plugins().length > 0);
    });

    it('the meta list, both spellings, withholds both fields of the declared and the saved webhook', async () => {
      for (const token of [admin, member]) {
        await expectWithheld(token, '/meta/webhook', [DECLARED, SAVED]);
        await expectWithheld(token, '/meta/webhooks', [DECLARED, SAVED]);
      }
    });

    it('the item read and the layered view withhold both fields', async () => {
      for (const token of [admin, member]) {
        for (const name of [DECLARED, SAVED]) {
          await expectWithheld(token, `/meta/webhook/${name}`, [name]);
          await expectWithheld(token, `/meta/webhook/${name}/layers`, [name]);
        }
      }
    });

    it('the published read withholds both fields', async () => {
      for (const token of [admin, member]) await expectWithheld(token, `/meta/webhook/${SAVED}/published`, [SAVED]);
    });

    it('the metadata protocol\'s list and item reads withhold both fields', async () => {
      const listed = await protocol.getMetaItems({ type: 'webhook' });
      expect(JSON.stringify(listed).includes(SAVED)).toBe(true);
      expect(holdsAPlaceholder(listed)).toBe(false);
      for (const name of [DECLARED, SAVED]) {
        const item = await protocol.getMetaItem({ type: 'webhook', name });
        expect(JSON.stringify(item).includes(name), name).toBe(true);
        expect(holdsAPlaceholder(item), name).toBe(false);
      }
    });

    it('the stored-row data door and its history twin withhold both fields', async () => {
      const filter = encodeURIComponent(JSON.stringify({ type: 'webhook', name: SAVED }));
      await expectWithheld(admin, `/data/sys_metadata?filter=${filter}`, [SAVED]);
      await expectWithheld(admin, `/data/sys_metadata_history?filter=${filter}`, [SAVED]);
    });

    it('a save of the served form keeps the stored values (the carry-forward), and the store is never redacted', async () => {
      const read = await stack.apiAs(admin, 'GET', `/meta/webhook/${SAVED}`);
      expect(read.status).toBe(200);
      const json = (await read.json()) as any;
      const served = (json?.item ?? json?.data?.item ?? json?.data ?? json) as Record<string, unknown>;
      expect(served?.name).toBe(SAVED);
      const body = Object.fromEntries(Object.entries(served).filter(([k]) => !k.startsWith('_')));
      expect(Object.keys(body)).not.toContain('secret');
      expect(Object.keys(body)).not.toContain('headers');

      const put = await stack.apiAs(admin, 'PUT', `/meta/webhook/${SAVED}`, { ...body, label: 'WCR Saved (edited)' });
      expect(put.status, await put.clone().text()).toBe(200);

      const [row] = await stored('sys_metadata', SAVED);
      expect(bodyOf(row).label).toBe('WCR Saved (edited)');
      expect(bodyOf(row).secret).toBe(SAVED_SECRET);
      expect(bodyOf(row).headers).toEqual({ 'X-Placeholder': SAVED_HEADER });
    });

    if (composition.plugins().length > 0) {
      it('the dispatcher\'s declared-webhook source still carries both credentials: delivery signing is unaffected', async () => {
        const declaredWebhooks = (await stack.kernel.getServiceAsync('declaredWebhooks')) as any;
        const declared = await declaredWebhooks.declaredWebhookNamed(DECLARED);
        expect(declared?.webhook?.secret).toBe(DECLARED_SECRET);
        expect(declared?.webhook?.headers).toEqual({ 'X-Placeholder': DECLARED_HEADER });
      });
    }
  });
}
