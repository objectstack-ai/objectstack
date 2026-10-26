/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #2458 / ADR-0057 Amendment A1.a — the package a build conversation is bound to,
 * shown as the header chip. Explicit `?package=` (Edit-with-AI) wins; otherwise
 * the most recent package a build/draft in the thread produced; undefined = the
 * not-yet-bound "New app" draft (the magic flow's start state).
 */
import { describe, it, expect } from 'vitest';
import { deriveBoundPackageId, isPlatformBuiltinApp } from '../AiChatPage';

/**
 * DERIVED from the function under test, not restated: `deriveBoundPackageId`
 * declares a structural minimum (messages whose `toolInvocations` may carry
 * `draftReview` / `builderHandoff`), never `ChatMessage`. This file used to
 * author a `ChatMessage` and cast to it — and the legacy `ChatMessage` the
 * chatbot barrel exports has NO properties in common with that minimum, so the
 * cast was asserting between unrelated shapes and the fixtures could have
 * drifted arbitrarily far from what the function reads (objectui#4040).
 */
type PackageBearingMessage = Parameters<typeof deriveBoundPackageId>[0][number];
type PackageBearingTool = NonNullable<PackageBearingMessage['toolInvocations']>[number];

const msg = (toolInvocations: readonly PackageBearingTool[]): PackageBearingMessage => ({ toolInvocations });

describe('deriveBoundPackageId', () => {
  it('prefers the explicit editPackageId (Edit-with-AI) over anything in messages', () => {
    const messages = [msg([{ draftReview: { packageId: 'app.drafted' } }])];
    expect(deriveBoundPackageId(messages, 'app.edit')).toBe('app.edit');
  });

  it('unbound while nothing has been built → undefined ("New app")', () => {
    expect(deriveBoundPackageId([], undefined)).toBeUndefined();
    // A tool invocation carrying NEITHER binding key — the case this covers.
    // (It used to spell that as `{ someOther: true }`; the derivation reads only
    // `draftReview` / `builderHandoff`, so the two are the same path.)
    expect(deriveBoundPackageId([msg([{}])], undefined)).toBeUndefined();
  });

  it('binds to the package a build/draft produced (draftReview or builderHandoff)', () => {
    expect(deriveBoundPackageId([msg([{ draftReview: { packageId: 'app.inventory' } }])], undefined)).toBe(
      'app.inventory',
    );
    expect(deriveBoundPackageId([msg([{ builderHandoff: { packageId: 'app.crm' } }])], undefined)).toBe(
      'app.crm',
    );
  });

  it('takes the MOST RECENT package when several appear (newest wins)', () => {
    const messages = [
      msg([{ draftReview: { packageId: 'app.first' } }]),
      msg([{ draftReview: { packageId: 'app.second' } }]),
    ];
    expect(deriveBoundPackageId(messages, undefined)).toBe('app.second');
  });
});

// #2466 / ADR-0057 A1.b — the switcher lists authorable packages only. Platform
// built-ins reserve the `com.objectstack.*` package namespace; user- and
// AI-built packages use other ids. `_packageId` is the reliable signal on the
// LIST response (managedBy/source aren't grafted onto list items).
describe('isPlatformBuiltinApp', () => {
  it('is true for a platform built-in (com.objectstack.setup / account)', () => {
    expect(isPlatformBuiltinApp({ _packageId: 'com.objectstack.setup' })).toBe(true);
    expect(isPlatformBuiltinApp({ _packageId: 'com.objectstack.account' })).toBe(true);
  });

  it('is false for an AI-built / user package (e.g. app.xadv)', () => {
    expect(isPlatformBuiltinApp({ _packageId: 'app.xadv' })).toBe(false);
    expect(isPlatformBuiltinApp({ _packageId: 'my.company.crm' })).toBe(false);
  });

  it('is false when there is no package id, or it is not a string', () => {
    expect(isPlatformBuiltinApp({})).toBe(false);
    expect(isPlatformBuiltinApp({ _packageId: undefined })).toBe(false);
    expect(isPlatformBuiltinApp({ _packageId: 123 as unknown as string })).toBe(false);
  });

  it('does not match a package that merely contains the prefix mid-string', () => {
    expect(isPlatformBuiltinApp({ _packageId: 'acme.com.objectstack.fake' })).toBe(false);
  });
});
