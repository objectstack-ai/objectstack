// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.object-hook-lifecycle` (#26573): the clauses
// the showcase's own seeded hooks answer, driven through the REST data door of
// the booted showcase, as shipped, with the server log read off the process's
// stdout/stderr (the `log` capability writes through the kernel logger).
//
//   acceptance[0] — beforeInsert stamps: a /data POST of an inquiry omitting
//     source reads back source 'web' (the field has no default, so the hook is
//     its sole producer) and status 'new'.
//   acceptance[1] — one multi-event hook trims on BOTH write kinds: a padded
//     title reads back trimmed after the POST and after the PATCH.
//   acceptance[2], negative[2] — the completing PATCH (done false → true)
//     logs 'task completed: <title>' once the async body settles.
//   acceptance[3], negative[3] — a priority-only PATCH of the already-done
//     task logs no new 'task completed' line (the two-root transition).
//   acceptance[4], acceptance[5] — a spent-only PATCH above budget (within the
//     120% the spent_within_budget rule permits) logs 'project over budget:
//     <name> (<spent> / <budget>)', budget read from the stored row; an
//     under-budget PATCH logs no warn.
//
// The scratch variants (acceptance[6]–[9], negative[0], [1], [4]) are pinned by
// `object-hook-lifecycle-scratch.dogfood.test.ts`.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const TASK = 'showcase_task';
const PROJECT = 'showcase_project';

function captureLog() {
  const lines: string[] = [];
  const sink = (chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  };
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(sink as never);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(sink as never);
  return {
    lines,
    matching: (needle: string) => lines.filter((l) => l.includes(needle)),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

/** The async after* bodies are fire-and-forget: wait for a line, bounded. */
async function settle(log: ReturnType<typeof captureLog>, needle: string, ms = 5_000): Promise<string[]> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = log.matching(needle);
    if (hit.length > 0) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return log.matching(needle);
}

type Answer = { status: number; json: any };

describe('records-forms.object-hook-lifecycle — the seeded showcase hooks over REST', () => {
  let stack: VerifyStack;
  let token = '';
  let projectId = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const readOne = async (object: string, id: string) => {
    const res = await call('GET', `/data/${object}/${id}`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.record ?? res.json;
  };
  const createTask = async (title: string): Promise<string> => {
    const res = await call('POST', `/data/${TASK}`, { title, project: projectId });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return String((res.json.record ?? res.json).id ?? (await stack.rows(TASK, { title: title.trim() }))[0].id);
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const [project] = await stack.rows(PROJECT, {});
    projectId = String(project.id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[0]: an inquiry POSTed through /data with no source reads back source web and status new', async () => {
    const name = uniq('ohl-inquiry');
    const res = await call('POST', '/data/showcase_inquiry', { name, email: `${name}@verify.test`, message: 'hello' });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const [row] = await stack.rows('showcase_inquiry', { name });
    expect(await readOne('showcase_inquiry', String(row.id))).toMatchObject({ source: 'web', status: 'new' });
  });

  it('acceptance[1]: one multi-event hook trims the title on the create and again on the update', async () => {
    const title = uniq('ohl-trim');
    const id = await createTask(`   ${title}   `);
    expect((await readOne(TASK, id)).title).toBe(title);
    const patched = await call('PATCH', `/data/${TASK}/${id}`, { title: `  ${title}-2  ` });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    expect((await readOne(TASK, id)).title).toBe(`${title}-2`);
  });

  it('acceptance[2], acceptance[3], negative[2], negative[3]: the completing update logs the audit; a later non-transition edit does not', async () => {
    const title = uniq('ohl-done');
    const id = await createTask(title);
    const log = captureLog();
    try {
      const done = await call('PATCH', `/data/${TASK}/${id}`, { done: true });
      expect(done.status, JSON.stringify(done.json)).toBe(200);
      const fired = await settle(log, `task completed: ${title}`);
      expect(fired, 'the async audit line names the task just completed').toHaveLength(1);

      const edit = await call('PATCH', `/data/${TASK}/${id}`, { priority: 'high' });
      expect(edit.status, JSON.stringify(edit.json)).toBe(200);
      await new Promise((r) => setTimeout(r, 1_500));
      expect(log.matching('task completed: '), 'no second audit for a non-transition edit').toHaveLength(1);
    } finally {
      log.restore();
    }
  });

  it('acceptance[4], acceptance[5]: a spent-only PATCH above budget logs the warn from the stored budget; under budget logs nothing', async () => {
    const name = uniq('ohl-budget');
    const [account] = await stack.rows('showcase_account', { status: 'active' });
    const created = await call('POST', `/data/${PROJECT}`, { name, status: 'planned', account: account.id, budget: 1000, spent: 100 });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const [project] = await stack.rows(PROJECT, { name });
    const log = captureLog();
    try {
      const under = await call('PATCH', `/data/${PROJECT}/${project.id}`, { spent: 900 });
      expect(under.status, JSON.stringify(under.json)).toBe(200);
      await new Promise((r) => setTimeout(r, 1_500));
      expect(log.matching(`project over budget: ${name}`), 'under budget: no warn').toHaveLength(0);

      const over = await call('PATCH', `/data/${PROJECT}/${project.id}`, { spent: 1100 });
      expect(over.status, JSON.stringify(over.json)).toBe(200);
      const warned = await settle(log, `project over budget: ${name}`);
      expect(warned, log.lines.slice(-20).join('')).toHaveLength(1);
      expect(warned[0]).toContain('(1100 / 1000)');
    } finally {
      log.restore();
    }
  });
});
