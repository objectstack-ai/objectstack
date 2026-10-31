// Screenshots of record page v4's top bar on HotCRM, against the v4 boards.
// Usage: node shoot.cjs <consoleBaseUrl> <outDir>
// HotCRM runs on this branch's own server (`packages/cli/bin/run.js dev`):
// the published 18.2.0 server has no `POST /data/:object/:id/page`.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5199';
const OUT = process.argv[3] || __dirname;
const APP = 'app.objectstack.hotcrm';
const facts = {};

// A direct open: a fresh history entry, so no list's state rides along.
async function direct(page, url) {
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function shot(page, name, { fullPage = false } = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  const bar = await page.$$eval('[data-record-top-bar]', (els) =>
    els.map((el) => ({
      leading: el.querySelector('[data-record-top-bar-leading]')?.textContent ?? null,
      position: el.querySelector('[data-record-top-bar-position]')?.textContent ?? null,
      positionTitle: el.querySelector('[data-record-top-bar-position]')?.getAttribute('title') ?? null,
      controls: Array.from(el.querySelectorAll('[data-record-top-bar-controls] button')).map(
        (b) => b.getAttribute('aria-label') ?? b.getAttribute('title'),
      ),
      height: Math.round(el.getBoundingClientRect().height),
      width: Math.round(el.getBoundingClientRect().width),
    })),
  );
  const crumbRow = await page.$('[data-record-crumb-row]');
  const tabs = await page.$$eval('[role="tab"][data-record-tab]', (els) =>
    els.map((el) => `${el.getAttribute('data-record-tab')}=${el.textContent}${el.getAttribute('aria-selected') === 'true' ? ' (active)' : ''}`),
  );
  const toolbar = await page.$$eval('[data-related-enlarged-toolbar]', (els) =>
    els.map((el) => ({
      chips: Array.from(el.querySelectorAll('[data-related-chip]')).map((c) => `${c.getAttribute('data-related-chip')}=${c.textContent}`),
      text: el.textContent,
    })),
  );
  const status = await page.$$eval('[data-related-enlarged-status]', (els) => els.map((el) => el.textContent));
  facts[name] = { bar, crumbRow: !!crumbRow, tabs, toolbar, status, url: page.url().replace(BASE, '') };
  console.log(name, JSON.stringify(facts[name]));
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const login = await page.request.post(`${BASE}/api/v1/auth/sign-in/email`, {
    data: { email: 'admin@objectos.ai', password: 'admin123' },
  });
  facts.login = login.status();
  await page.evaluate(() => {
    try { localStorage.setItem('i18nextLng', 'zh'); } catch {}
  });

  const rows = async (object) => {
    const res = await page.request.get(`${BASE}/api/v1/data/${object}?$top=100`);
    const body = await res.json().catch(() => ({}));
    return body?.records ?? body?.data ?? [];
  };
  const leads = await rows('crm_lead');
  const contacts = await rows('crm_contact');
  const products = await rows('crm_product');
  const lead = leads.find((r) => /Mira Costa/.test(r.full_name || r.display_title || ''));
  const contact = contacts.find((r) => /John Smith/.test(r.full_name || ''));
  const product = products.find((r) => /Analytics/.test(r.name || r.display_title || ''));
  facts.ids = { lead: lead?.id, contact: contact?.id, product: product?.id, leadCount: leads.length };

  // The seed's seven tasks name no contact: give John Smith two, so his 任务
  // tab has rows (a local rig database, started --fresh).
  const tasks = await rows('crm_task');
  if (!tasks.some((t) => t.related_to_contact === contact.id)) {
    for (const [subject, due, priority] of [['Send the renewal quote', '2026-10-28', 'high'], ['Book the Q1 review', '2026-11-12', 'medium']]) {
      const res = await page.request.post(`${BASE}/api/v1/data/crm_task`, {
        data: { subject, due_date: due, priority, status: 'not_started', related_to_type: 'crm_contact', related_to_contact: contact.id },
      });
      facts[`task:${subject}`] = res.status();
    }
  }
  console.log('setup', JSON.stringify(facts));

  // 1. Lead at 1440, opened from the list (HotCRM's lead list opens its rows
  //    as pages): the list trail, the counter, ↓ ↑.
  await page.goto(`${BASE}/apps/${APP}/crm_lead`, { waitUntil: 'domcontentloaded' });
  await settle(page, 2500);
  await page.getByRole('link', { name: 'Mira Costa', exact: true }).first().click();
  await settle(page, 2500);
  await shot(page, '01-lead-1440-from-list');
  await page.click('[data-record-top-bar-step="next"]');
  await settle(page, 2000);
  await shot(page, '02-lead-1440-after-step-down');
  await page.keyboard.press('k');
  await settle(page, 1500);
  facts.afterK = page.url().replace(BASE, '');

  // 3. Lead at 1200, opened directly.
  await page.setViewportSize({ width: 1200, height: 900 });
  await direct(page, `${BASE}/apps/${APP}/crm_lead/record/${lead.id}`);
  await settle(page, 2500);
  await shot(page, '03-lead-1200-direct');

  // 4–7. Contact in the split pane (720) at 1440.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/apps/${APP}/crm_contact?recordId=${contact.id}`, { waitUntil: 'domcontentloaded' });
  await settle(page, 3000);
  await shot(page, '04-contact-split-720');

  const max = await page.$('[data-testid="record-pane-maximize"]');
  if (max) {
    await max.click();
    await settle(page, 1500);
    await shot(page, '05-contact-maximized');
    await page.click('[data-testid="record-pane-maximize"]');
    await settle(page, 1500);
  }

  // The 任务 tab in the pane: at 720 it folds into 「+N ▾」.
  const taskInRow = await page.$('[role="tab"][data-record-tab^="crm_task."]');
  if (taskInRow) {
    await taskInRow.click();
  } else {
    await page.click('[data-record-tab-more]');
    await page.waitForTimeout(500);
    await page.click('[data-record-tab-menu-item^="crm_task."]');
  }
  await settle(page, 2500);
  await shot(page, '06-contact-split-task-tab');
  const taskTabId = new URL(page.url()).searchParams.get('related');
  facts.taskTabId = taskTabId;

  // 7. Contact page, 任务 tab by deep link: the enlarged toolbar, and 动态's count.
  await direct(page, `${BASE}/apps/${APP}/crm_contact/record/${contact.id}?related=${encodeURIComponent(taskTabId || 'crm_task.related_to_contact')}`);
  await settle(page, 3000);
  await shot(page, '07-contact-page-task-tab-deep-link');
  const mine = await page.$('[data-related-chip="mine"]');
  if (mine) {
    await mine.click();
    await settle(page, 1500);
    await shot(page, '07b-contact-page-task-tab-mine');
  }

  // 8. Product page at 1440, opened directly (no list trail).
  await direct(page, `${BASE}/apps/${APP}/crm_product/record/${product.id}`);
  await settle(page, 2500);
  await shot(page, '08-product-1440');

  // 9. A 390 phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await direct(page, `${BASE}/apps/${APP}/crm_lead/record/${lead.id}`);
  await settle(page, 2500);
  await shot(page, '09-lead-phone-390');
  await direct(page, `${BASE}/apps/${APP}/crm_contact/record/${contact.id}`);
  await settle(page, 2500);
  await shot(page, '09b-contact-phone-390');

  // 10. The pane's counter over an ungrouped list that opens rows in the pane.
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const object of ['crm_account', 'crm_opportunity', 'crm_product']) {
    await page.goto(`${BASE}/apps/${APP}/${object}`, { waitUntil: 'domcontentloaded' });
    await settle(page, 2500);
    const links = await page.$$(`a[data-testid="link-cell"][href*="/${object}/record/"]`);
    if (links.length < 3) continue;
    await links[2].click();
    await settle(page, 2500);
    const pos = await page.$('[data-record-top-bar-position]');
    if (!pos || !page.url().includes('recordId=')) continue;
    await shot(page, `10-${object}-split-pane-counter`);
    await page.click('[data-record-top-bar-step="next"]');
    await settle(page, 2000);
    await shot(page, `11-${object}-split-pane-after-step`);
    // The row's ↗ → the page, with ⤡.
    const opener = await page.$('[data-testid="record-open-as-page"]');
    facts.paneObject = object;
    if (opener) {
      await opener.click({ force: true });
      await settle(page, 2500);
      await shot(page, `12-${object}-page-from-arrow`);
    }
    break;
  }

  fs.writeFileSync(path.join(OUT, 'facts.json'), JSON.stringify(facts, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err);
  fs.writeFileSync(path.join(OUT, 'facts.json'), JSON.stringify(facts, null, 2));
  process.exit(1);
});
