import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Live e2e for the record page's field-change display pipeline
 * (app-shell `sys_audit_log` read → `auditEntriesToFeedItems` →
 * `RecordFieldChangesContext` → the timeline stream's Changes chip).
 *
 * Regression for the gantt QA report where the record history rendered raw
 * audit payloads: ISO datetimes ("2026-08-04T12:00:00.000Z"), raw lookup id
 * arrays, raw select values, and "Unknown user" for every entry. Record page
 * v3 (objectstack#27055) removed the History tab at every width: the same
 * enriched audit entries are now the field_change lines of the ONE timeline
 * stream, under its Changes (变更) chip.
 *
 * Targets `showcase_account`, the showcase's `enable.trackHistory` object —
 * the console reads `sys_audit_log` only for an object with that flag. Its
 * audited field mix: two selects (`industry`, and `status` labelled
 * "Lifecycle"), a date (`signed_on`, "Customer Since") and the record owner, a
 * user lookup (`owner_id`). No history-tracked showcase object carries a
 * boolean or a datetime field, so booleans-as-words and datetime localization
 * are not exercised here; the unit suite `auditHistoryDisplay.test.ts` in
 * app-shell pins both ("localizes booleans through t with Yes/No fallback",
 * "localizes datetime values instead of raw ISO strings").
 */
const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const EMAIL = process.env.LIVE_EMAIL || 'admin@objectos.ai';

type SysUser = { id: string; name: string; email?: string };

/** The signed-in user (the audit actor) and one other seeded user. */
async function seededUsers(request: APIRequestContext): Promise<{ actor: SysUser; other: SysUser }> {
  const body = await (
    await request.get(`${API}/api/v1/data/sys_user?$top=20&$select=id,name,email`)
  ).json();
  const rows: SysUser[] = body.data ?? body.records ?? body;
  const actor = rows.find((r) => r.email === EMAIL);
  const other = rows.find((r) => r.id !== actor?.id);
  expect(actor?.id, 'the signed-in sys_user').toBeTruthy();
  expect(other?.id, 'a second seeded sys_user to hand the record to').toBeTruthy();
  return { actor: actor!, other: other! };
}

/**
 * The synthesized record page lays itself out by the width of the view it
 * occupies (objectstack#26678): below the two-column floor
 * (`RECORD_PAGE_TWO_COLUMN_MIN_WIDTH` in `@object-ui/plugin-detail`) it is the
 * tab strip, Details / Related / Timeline. A 1024 px window with the console
 * sidebar expanded is already two columns (objectstack#27241), so the spec
 * pins a viewport whose record view stays under that floor once the 256 px
 * sidebar takes its share — the page's tabbed tier, where the stream is the
 * Timeline tab. (In the column tiers the same stream is resident, in the
 * timeline column or, with the reader's timeline switch off, in the Activity
 * card at the related column's foot.)
 */
test.use({ viewport: { width: 1000, height: 800 } });

test('the timeline stream\'s Changes chip shows display values (localized dates, option labels, resolved lookups, real actor) instead of raw audit payloads', async ({ page, request }) => {
  const { actor, other } = await seededUsers(request);

  // 1) Seed an account and drive three audited updates through the real API —
  //    the field mix the QA report flagged: a date, selects and a lookup.
  const name = `History display e2e ${Date.now()}`;
  const createRes = await request.post(`${API}/api/v1/data/showcase_account`, {
    data: { name, industry: 'technology', status: 'prospect', signed_on: '2026-07-26' },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  const id = created.id ?? created.record?.id ?? created.data?.id;
  expect(id).toBeTruthy();

  for (const patch of [
    { signed_on: '2026-08-04' },
    { status: 'active', industry: 'finance' },
    // The creator already owns a new record, so the owner moves to someone else.
    { owner_id: other.id },
  ]) {
    const res = await request.patch(`${API}/api/v1/data/showcase_account/${id}`, { data: patch });
    expect(res.ok()).toBeTruthy();
  }

  // 2) Open the synthesized record page, its Timeline tab and the stream's
  //    Changes chip — the field changes alone (the audit entries, plus the
  //    activity stream's own `created` row).
  await page.goto(`/apps/showcase_app/showcase_account/record/${id}`);
  const timelineTab = page.getByRole('tab', { name: /^(Timeline|时间线)/ });
  await timelineTab.waitFor({ state: 'visible', timeout: 15_000 });
  await timelineTab.click();

  const panel = page.getByRole('tabpanel', { name: /Timeline|时间线/ });
  const changesChip = panel.locator('[data-stream-filter="changes"]');
  await changesChip.click();
  await expect(changesChip).toHaveAttribute('aria-pressed', 'true');
  // The three UPDATE entries render as change lines; wait for the latest one.
  await expect(panel.locator('[data-stream-change]', { hasText: 'Owner' }).first()).toBeVisible({ timeout: 15_000 });
  const text = (await panel.innerText()).replace(/\s+/g, ' ');

  // 3) Actor attribution: the audit user resolves to a display name —
  //    never the raw id, never the unknown-user fallback (`detail.unknownUser`).
  expect(text).toContain(actor.name);
  expect(text).not.toContain(actor.id);
  expect(text).not.toMatch(/\bUnknown\b|未知用户/);

  // 4) Select values render as option labels, not raw stored values.
  expect(text).toMatch(/Prospect/);
  expect(text).toMatch(/Active/);
  expect(text).toMatch(/Technology/);
  expect(text).toMatch(/Finance/);
  expect(text).not.toMatch(/\bprospect\b|\bactive\b|\btechnology\b|\bfinance\b/);

  // 5) Dates are localized — no raw ISO payloads anywhere, neither a datetime
  //    nor the stored YYYY-MM-DD of the date field. The date's diff line is
  //    there to read, so the absence below is not vacuous.
  expect(text).toMatch(/Customer Since/);
  expect(text).not.toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  expect(text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);

  // 6) The owner lookup resolves to the users' names on the diff line, never
  //    to their ids.
  expect(text).toMatch(/Owner/);
  expect(text).toContain(other.name);
  expect(text).not.toContain(other.id);
});
