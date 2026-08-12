import { request } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Ambient `process` with `env` — types/node-shim.d.ts declares the global as
// `{ cwd(): string }` only, so each module that reads env widens it locally.
// Same one-liner as the specs beside this file and objectstack.config.ts.
// Declared above the block comment below so that comment stays attached to the
// first emitted statement.
declare const process: { env: Record<string, string | undefined> };

/**
 * Auth for the showcase smoke: sign in against the backend (better-auth) and
 * persist a Playwright storageState. The console (served at :3000/_console)
 * reads a Bearer token from localStorage `auth-session-token` on the :3000
 * origin, so we inject that there; the session cookie covers the API.
 */
const API = process.env.SMOKE_API_URL || 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL || 'admin@objectos.ai';
const PASSWORD = process.env.SMOKE_PASSWORD || 'admin123';
const STATE_PATH = 'e2e/.auth/state.json';

export default async function globalSetup() {
  const ctx = await request.newContext();
  const res = await ctx.post(`${API}/api/v1/auth/sign-in/email`, {
    data: { email: EMAIL, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`sign-in failed (${res.status()}): ${await res.text()}`);
  const token = res.headers()['set-auth-token'];
  if (!token) throw new Error('no set-auth-token header from sign-in');
  const apiState = await ctx.storageState();
  await ctx.dispose();
  const state = {
    cookies: apiState.cookies,
    origins: [{ origin: API, localStorage: [{ name: 'auth-session-token', value: token }] }],
  };
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
