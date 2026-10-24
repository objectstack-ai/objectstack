import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Live e2e for server-side roll-up SUMMARY fields (ObjectQL).
 *
 * showcase_project.total_estimate = SUM(showcase_task.estimate_hours) and
 * .task_count = COUNT(showcase_task) are recomputed by the engine whenever a
 * child task is inserted / updated / deleted — here exercised end-to-end
 * against the real SQL driver via the atomic /api/v1/batch endpoint.
 */
const API = process.env.LIVE_API_URL || 'http://localhost:3000';

async function anAccountId(request: APIRequestContext): Promise<string> {
  const body = await (await request.get(`${API}/api/v1/data/showcase_account?$top=1`)).json();
  const id = (body.data ?? body.records ?? body)[0]?.id;
  expect(id, 'a seeded showcase_account').toBeTruthy();
  return id;
}

async function getProject(request: APIRequestContext, id: string) {
  const r = await (await request.get(`${API}/api/v1/data/showcase_project/${id}`)).json();
  return r.record ?? r.data ?? r;
}

test('SUM/COUNT roll-up is computed server-side on atomic create', async ({ request }) => {
  const account = await anAccountId(request);
  const res = await request.post(`${API}/api/v1/batch`, {
    data: { operations: [
      { object: 'showcase_project', action: 'create', data: { name: `Rollup ${Date.now()}`, status: 'planned', account } },
      { object: 'showcase_task', action: 'create', data: { title: 'T1', status: 'backlog', estimate_hours: 3, project: { $ref: 0 } } },
      { object: 'showcase_task', action: 'create', data: { title: 'T2', status: 'backlog', estimate_hours: 5, project: { $ref: 0 } } },
    ] },
  });
  expect(res.status()).toBe(200);
  const projectId = (await res.json()).results[0].id;

  const proj = await getProject(request, projectId);
  expect(Number(proj.total_estimate)).toBe(8);
  expect(Number(proj.task_count)).toBe(2);
});

test('roll-up recomputes when a child is added then deleted', async ({ request }) => {
  const account = await anAccountId(request);
  const created = await (await request.post(`${API}/api/v1/batch`, {
    data: { operations: [
      { object: 'showcase_project', action: 'create', data: { name: `Rollup2 ${Date.now()}`, status: 'planned', account } },
      { object: 'showcase_task', action: 'create', data: { title: 'T1', status: 'backlog', estimate_hours: 4, project: { $ref: 0 } } },
    ] },
  })).json();
  const projectId = created.results[0].id;
  const taskId = created.results[1].id;
  expect(Number((await getProject(request, projectId)).total_estimate)).toBe(4);

  // delete the only task → rollup falls back to 0
  const del = await request.delete(`${API}/api/v1/data/showcase_task/${taskId}`);
  expect(del.ok()).toBeTruthy();
  const proj = await getProject(request, projectId);
  expect(Number(proj.total_estimate)).toBe(0);
  expect(Number(proj.task_count)).toBe(0);
});
