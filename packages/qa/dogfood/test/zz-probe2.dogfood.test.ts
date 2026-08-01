import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, statSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack } from '@objectstack/verify';
import { durableSuspendStack } from './fixtures/flow-durable-suspend-fixture.js';

const OUT = '/tmp/claude-0/-home-user/74049b9a-bd02-54d0-a5c5-c545cef3d7b6/scratchpad/probe2-out.txt';
const LOG = (...a: any[]) => appendFileSync(OUT, a.map(String).join(' ') + '\n');

describe('probe2 — does ORDINARY data survive a harness restart?', () => {
  it('probe2', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-probe2-'));
    const dbFile = join(dir, 'v.sqlite');

    const a = await bootStack(durableSuspendStack, { automation: true, databaseFile: dbFile });
    const ta = await a.signIn();
    const c = await a.apiAs(ta, 'POST', '/data/suspend_note', { name: 'persisted-me', status: 'new' });
    LOG('probe2 create status', c.status);
    LOG('probe2 size before stop', statSync(dbFile).size);
    await a.stop();
    LOG('probe2 size after stop', statSync(dbFile).size);

    const b = await bootStack(durableSuspendStack, { automation: true, databaseFile: dbFile });
    const tb = await b.signIn();
    const list = await b.apiAs(tb, 'GET', '/data/suspend_note?limit=10');
    LOG('probe2 cold notes', (await list.text()).slice(0, 400));
    await b.stop();

    rmSync(dir, { recursive: true, force: true });
    expect(true).toBe(true);
  }, 180_000);
});
