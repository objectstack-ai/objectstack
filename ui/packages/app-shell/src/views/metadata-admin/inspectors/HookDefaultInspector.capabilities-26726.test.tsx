// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26726 — the Hook inspector authors `body.capabilities`.
 *
 * The sandbox throws on a `ctx` call the body was not granted, and the grant
 * list was reachable from no control: `body` is a curated key as a whole, so
 * the "More fields" form never drew its members either. A Studio-authored hook
 * that read data could only be fixed through the API.
 *
 * FIXTURE DISCIPLINE (the #3218 method): every draft is the authored hook fed
 * through `HookSchema.parse`, and every written body is parsed back through the
 * same schema, so a case cannot pass on a shape the spec refuses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { HookSchema, HookBodyCapability } from '@objectstack/spec/data';

// The object picker fetches on mount; every fixture uses `object: '*'`, so
// stub the shared client and keep that fetch off the network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { t } from '../i18n';
import { HookDefaultInspector } from './HookDefaultInspector';
// `engine.inspector.*` rows live in the lazy `studio` namespace (objectstack#25922).
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

afterEach(cleanup);

function hookDraft(body: Record<string, unknown>): Record<string, unknown> {
  return HookSchema.parse({
    name: 'reads_accounts',
    object: '*',
    events: ['beforeInsert'],
    body,
  }) as unknown as Record<string, unknown>;
}

const JS_BODY = { language: 'js', source: 'await ctx.api.object("account").find({});' };

function renderInspector(
  draft: Record<string, unknown>,
  { serverSchema, locale = 'en-US' }: { serverSchema?: Record<string, unknown>; locale?: string } = {},
) {
  const onPatch = vi.fn();
  render(
    <HookDefaultInspector
      type="hook"
      name={String(draft.name)}
      draft={draft}
      onPatch={onPatch}
      readOnly={false}
      locale={locale as never}
      serverSchema={serverSchema}
    />,
  );
  return onPatch;
}

/** The body the last patch wrote. */
function writtenBody(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(onPatch).toHaveBeenCalled();
  const patch = onPatch.mock.calls.at(-1)![0] as Record<string, unknown>;
  return patch.body as Record<string, unknown>;
}

/** The saved hook — the draft with the patch applied — through the spec. */
function savedHook(draft: Record<string, unknown>, body: Record<string, unknown>) {
  return HookSchema.parse({ ...draft, body });
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('HookDefaultInspector — body capabilities (objectstack#26726)', () => {
  it('offers one checkbox per spec token on a js body, read from the enum', () => {
    renderInspector(hookDraft(JS_BODY));
    const control = screen.getByTestId('hook-body-capabilities');
    const names = within(control)
      .getAllByRole('checkbox')
      .map((el) => el.closest('label')!.textContent);
    expect(names).toEqual([...HookBodyCapability.options]);
    // Each token names the ctx call it unlocks.
    expect(within(control).getByText('ctx.api.object(…).find / findOne / count / aggregate')).toBeInTheDocument();
  });

  it('picking api.read writes body.capabilities ["api.read"], and the saved hook parses', () => {
    const draft = hookDraft(JS_BODY);
    const onPatch = renderInspector(draft);

    fireEvent.click(box('api.read'));

    const body = writtenBody(onPatch);
    expect(body).toEqual({ ...draft.body as object, capabilities: ['api.read'] });
    expect(savedHook(draft, body).body).toMatchObject({ language: 'js', capabilities: ['api.read'] });
  });

  it('an existing grant round-trips: shown ticked, and a new grant is written in spec order beside it', () => {
    const draft = hookDraft({ ...JS_BODY, capabilities: ['log', 'api.read'] });
    const onPatch = renderInspector(draft);

    expect(box('api.read').checked).toBe(true);
    expect(box('log').checked).toBe(true);
    expect(box('api.write').checked).toBe(false);

    fireEvent.click(box('api.write'));

    const body = writtenBody(onPatch);
    expect(body.capabilities).toEqual(['api.read', 'api.write', 'log']);
    expect(body.source).toBe(JS_BODY.source);
    expect(savedHook(draft, body).body).toMatchObject({ capabilities: ['api.read', 'api.write', 'log'] });
  });

  it('clearing the last grant writes [], the spec default', () => {
    const draft = hookDraft({ ...JS_BODY, capabilities: ['api.read'] });
    const onPatch = renderInspector(draft);

    fireEvent.click(box('api.read'));

    const body = writtenBody(onPatch);
    expect(body.capabilities).toEqual([]);
    expect(savedHook(draft, body).body).toEqual(hookDraft(JS_BODY).body);
  });

  it('an expression body shows no control and its edits never write the key', () => {
    const draft = hookDraft({ language: 'expression', source: 'record.amount >= 0' });
    const onPatch = renderInspector(draft);

    expect(screen.queryByTestId('hook-body-capabilities')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'api.read' })).toBeNull();

    fireEvent.change(screen.getByTestId('hook-body-source'), { target: { value: 'record.amount > 0' } });
    const body = writtenBody(onPatch);
    expect(body).not.toHaveProperty('capabilities');
    expect(savedHook(draft, body).body).toEqual({ language: 'expression', source: 'record.amount > 0' });
  });

  it('switching a granted js body to expression drops the grant, so the save still parses', async () => {
    const draft = hookDraft({ language: 'js', source: 'true', capabilities: ['api.read'] });
    const onPatch = renderInspector(draft);

    // The language select is a Radix combobox button; pick through its listbox.
    const language = screen.getAllByRole('combobox').find((el) => el.tagName === 'BUTTON')!;
    fireEvent.click(language);
    fireEvent.click(await screen.findByRole('option', { name: t('engine.inspector.hook.bodyLang.expression', 'en-US') }));

    const body = writtenBody(onPatch);
    expect(body).toEqual({ language: 'expression', source: 'true' });
    expect(() => savedHook(draft, body)).not.toThrow();
  });

  it('a stored token the spec does not list stays visible, flagged, and is kept on the next write', () => {
    // Not parsed: the spec refuses this token, which is why it must not vanish unseen.
    const draft = {
      name: 'reads_accounts',
      object: '*',
      events: ['beforeInsert'],
      body: { ...JS_BODY, capabilities: ['api.read', 'crypto.hash'] },
    };
    const onPatch = renderInspector(draft);

    const flagged = box(`crypto.hash ${t('engine.inspector.hook.capabilityUnknown', 'en-US')}`);
    expect(flagged.checked).toBe(true);

    fireEvent.click(box('log'));
    expect(writtenBody(onPatch).capabilities).toEqual(['api.read', 'log', 'crypto.hash']);

    fireEvent.click(flagged);
    expect(writtenBody(onPatch).capabilities).toEqual(['api.read']);
  });

  it('"More fields" does not draw the key a second time', () => {
    const serverSchema = {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          properties: {
            language: { type: 'string', enum: ['js', 'expression'] },
            capabilities: { type: 'array', items: { type: 'string', enum: [...HookBodyCapability.options] } },
          },
        },
        timeout: { type: 'number', title: 'Timeout' },
      },
    };
    renderInspector(hookDraft(JS_BODY), { serverSchema });

    expect(screen.getAllByRole('checkbox', { name: 'api.read' })).toHaveLength(1);
    const moreFields = screen.getByText(t('engine.inspector.moreFields', 'en-US')).closest('.border-t') as HTMLElement;
    // Positive control: the form is drawn, with the uncurated key in it.
    expect(within(moreFields).getAllByText(/timeout/i).length).toBeGreaterThan(0);
    expect(within(moreFields).queryByText(/capabilit/i)).toBeNull();
    expect(within(moreFields).queryByRole('checkbox', { name: 'api.read' })).toBeNull();
  });

  it('reads its words in the designer locale', () => {
    renderInspector(hookDraft(JS_BODY), { locale: 'zh-CN' });
    const control = screen.getByTestId('hook-body-capabilities');
    const zh = t('engine.inspector.hook.capabilities', 'zh-CN');
    expect(zh).not.toBe(t('engine.inspector.hook.capabilities', 'en-US'));
    expect(within(control).getByText(zh)).toBeInTheDocument();
    expect(within(control).getByText(t('engine.inspector.hook.capabilitiesHint', 'zh-CN'))).toBeInTheDocument();
  });
});
