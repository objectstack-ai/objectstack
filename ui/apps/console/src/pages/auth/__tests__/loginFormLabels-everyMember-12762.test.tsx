/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12762 — both login pages pass `LoginForm` EVERY member of
 * `LoginFormLabels`, each from the `auth.login.*` key of the same name.
 *
 * `LoginForm` draws an English default for any label its host leaves unset,
 * so a member nobody passes reads English on every other language and nothing
 * fails. That happened twice: objectui#10900 (`socialButton`, `orText`) and
 * objectui#12762 (the four SSO members on both pages, and the ten phone and
 * verification-code members on `DefaultLoginPage`). This pin holds the whole
 * class rather than one label: the next member added to the interface turns it
 * red until both pages pass it and the bundles carry its key.
 *
 * ## Where the member list comes from
 *
 * The SOURCE: the TypeScript parser walks `interface LoginFormLabels` in
 * `packages/auth/src/LoginForm.tsx`, the file the `@object-ui/auth` alias
 * resolves to. A type-level list (`keyof LoginFormLabels`) is not reachable
 * here — types are erased before vitest runs and vitest does not type-check —
 * so it could fail only in a type-check, never in this run. The walk refuses
 * an interface it cannot read whole: an `extends` clause, or a member that is
 * not a plain named property, is a loud failure rather than a short list.
 *
 * ## What a host passes
 *
 * `LoginForm` is replaced by a stand-in that records its `labels` and draws
 * nothing; the rest of `@object-ui/auth` is the real module, so each page runs
 * as shipped under a real `AuthProvider` (over a stub client) and a real
 * `I18nProvider` in zh. A member passes when the page hands over the zh
 * bundle's value of `auth.login.MEMBER`, which is what both of its spellings
 * (the console's `t(key, { defaultValue })`, app-shell's bare `t(key)`)
 * resolve to once the key exists. The zh bundle is read, not copied here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { AuthProvider, type AuthClient, type LoginFormProps } from '@object-ui/auth';
import { DefaultLoginPage } from '@object-ui/app-shell';
import { LoginPage } from '../LoginPage';

const { passed } = vi.hoisted(() => ({
  passed: { labels: undefined as Record<string, unknown> | undefined },
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  return {
    ...actual,
    // Records what the host passes; draws nothing.
    LoginForm: (props: LoginFormProps) => {
      passed.labels = props.labels as Record<string, unknown> | undefined;
      return null;
    },
  };
});

afterEach(() => {
  cleanup();
  passed.labels = undefined;
});

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..', '..');
const DECLARATION = 'packages/auth/src/LoginForm.tsx';

/** The members `interface LoginFormLabels` declares, in source order. */
function labelMembers(): string[] {
  const abs = join(REPO_ROOT, DECLARATION);
  const sf = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const decl = sf.statements.find(
    (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'LoginFormLabels',
  );
  if (!decl) throw new Error(`no \`interface LoginFormLabels\` in ${DECLARATION}`);
  if (decl.heritageClauses?.length) {
    throw new Error('LoginFormLabels extends another type; this walk reads its own members only');
  }
  return decl.members.map((m) => {
    if (!ts.isPropertySignature(m) || !ts.isIdentifier(m.name)) {
      throw new Error(`LoginFormLabels member \`${m.getText(sf)}\` is not a plain named property`);
    }
    return m.name.text;
  });
}

const MEMBERS = labelMembers();
const ZH_LOGIN = builtInLocales.zh.auth.login as Record<string, unknown>;

function createMockClient(): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue({ socialProviders: [], emailPassword: { enabled: true } }),
  } as unknown as AuthClient;
}

/** Renders a page under zh and waits until it hands `LoginForm` zh labels. */
async function labelsPassedBy(page: ReactElement): Promise<Record<string, unknown>> {
  window.history.replaceState({}, '', '/login');
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <AuthProvider authUrl="/api/v1/auth" client={createMockClient()}>
        <MemoryRouter initialEntries={['/login']}>{page}</MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
  // `emailLabel` is passed by both pages and differs between en and zh, so it
  // marks the render that runs after the zh catalogue has loaded.
  await waitFor(() => expect(passed.labels?.emailLabel).toBe(ZH_LOGIN.emailLabel));
  return passed.labels!;
}

describe('LoginFormLabels — the member list is read from the declaration (objectui#12762)', () => {
  it('reads the interface, with a known member as the positive control', () => {
    expect(MEMBERS).toContain('emailLabel');
    expect(new Set(MEMBERS).size).toBe(MEMBERS.length);
  });

  it('every member has an auth.login key of the same name in the zh bundle', () => {
    const missing = MEMBERS.filter((m) => typeof ZH_LOGIN[m] !== 'string');
    expect(missing).toEqual([]);
  });
});

describe.each([
  ['console LoginPage', <LoginPage key="console" />],
  ['app-shell DefaultLoginPage', <DefaultLoginPage key="app-shell" />],
] as const)('%s passes LoginForm every LoginFormLabels member (objectui#12762)', (_host, page) => {
  it('passes exactly the declared members', async () => {
    const labels = await labelsPassedBy(page);
    expect(Object.keys(labels).sort()).toEqual([...MEMBERS].sort());
  });

  it('passes each member as the zh value of auth.login.MEMBER', async () => {
    const labels = await labelsPassedBy(page);
    // A string first: a member the page does not pass and a key the bundle
    // lacks are both `undefined`, and would otherwise compare equal.
    const wrong = MEMBERS.filter((m) => typeof labels[m] !== 'string' || labels[m] !== ZH_LOGIN[m]).map(
      (m) => `${m}: passed ${JSON.stringify(labels[m])}, bundle ${JSON.stringify(ZH_LOGIN[m])}`,
    );
    expect(wrong).toEqual([]);
  });
});
