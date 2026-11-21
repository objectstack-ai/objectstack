import { test, expect, type Page } from '@playwright/test';

/**
 * Live e2e: one way to open a record from an object's list
 * (objectstack-ai/objectstack#35854).
 *
 * The record's name opens the full page; the icon shown beside the name while
 * the row is hovered (「在侧边打开」) opens the side drawer over the list, which
 * stays. The page remembers the list it came from (its view, its order, the
 * loaded window) in the history entry, so ↑ / ↓ walk that list, the counter
 * names the view, and a reload keeps all of it. On a phone (a coarse pointer,
 * no hover) there is no icon: the name opens the page.
 *
 * The unit pins of each path are beside the code
 * (`ObjectView.recordOpenPath-35854.test.tsx`, `recordDrawerStack-26679`); this
 * file drives the real Console against the real showcase backend, with real
 * pointer hover and a real reload, which keeps `history.state`.
 */

const APP = 'com.example.showcase';
const OBJECT = 'showcase_account';
const LIST = `/apps/${APP}/${OBJECT}`;
const NAME = '[data-testid="primary-field-link"]';
const ICON = '[data-testid="record-open-in-panel"]';
const CARD = '[data-record-drawer-card]';
const POSITION = '[data-record-top-bar-position]';
const TITLE = '[data-record-top-bar] h1';

async function openList(page: Page) {
  await page.goto(LIST);
  await expect(page.locator(NAME).nth(2)).toBeVisible();
}

const recordPath = new RegExp(`/apps/${APP.replace(/\./g, '\\.')}/${OBJECT}/record/[^/?#]+$`);

test.describe('record open path at 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the name opens the full page, which names the list it came from and keeps it across a reload', async ({ page }) => {
    await openList(page);
    const total = await page.locator(NAME).count();
    const name = (await page.locator(NAME).nth(1).textContent())!.trim();

    await page.locator(NAME).nth(1).click();

    await expect(page).toHaveURL(recordPath);
    await expect(page.locator(CARD)).toHaveCount(0);
    await expect(page.locator(TITLE)).toContainText(name);
    await expect(page.locator(POSITION)).toHaveText(`2 / ${total}`);
    await expect(page.locator(POSITION)).toHaveAttribute('aria-label', `2 of ${total} in All Records`);

    // The provenance lives in the history entry: a reload keeps it.
    await page.reload();
    await expect(page.locator(TITLE)).toContainText(name);
    await expect(page.locator(POSITION)).toHaveText(`2 / ${total}`);
    await expect(page.locator(POSITION)).toHaveAttribute('aria-label', `2 of ${total} in All Records`);

    // ↓ walks the list in its order.
    await page.locator('[data-record-top-bar-step="next"]').click();
    await expect(page.locator(POSITION)).toHaveText(`3 / ${total}`);
    await expect(page.locator(TITLE)).not.toContainText(name);

    // The object crumb goes back to the list.
    await page.getByTestId('record-page-crumb').click();
    await expect(page).toHaveURL(new RegExp(`${LIST.replace(/\./g, '\\.')}(/view/[^/?#]+)?([?#].*)?$`));
    await expect(page.locator(NAME).nth(2)).toBeVisible();
  });

  test('the hover icon beside the name opens the side drawer over the list, a floating card', async ({ page }) => {
    await openList(page);
    const row = page.locator(NAME).nth(1);
    const name = (await row.textContent())!.trim();
    const icon = page.locator(ICON).nth(1);

    // At rest the icon is drawn but not shown; hovering the row shows it.
    await expect(icon).toHaveCSS('opacity', '0');
    await row.hover();
    await expect(icon).toHaveCSS('opacity', '1');
    await expect(icon).toHaveAccessibleName(/side panel|在侧边打开/i);

    await icon.click();

    await expect(page).toHaveURL(/[?&]recordId=/);
    const card = page.locator(CARD);
    await expect(card).toBeVisible();
    await expect(card.locator(TITLE)).toContainText(name);
    // The list stays under it.
    await expect(page.locator(NAME).first()).toBeVisible();

    // A floating card: 8 px off the top, right and bottom edges, rounded.
    const box = (await card.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(Math.round(box.y)).toBe(8);
    expect(Math.round(vp.width - (box.x + box.width))).toBe(8);
    expect(Math.round(vp.height - (box.y + box.height))).toBe(8);
    expect(parseFloat(await card.evaluate((e) => getComputedStyle(e).borderTopLeftRadius))).toBeGreaterThanOrEqual(8);

    // No full-width state: 「整页打开」 and close, no maximize toggle.
    await expect(card.getByTestId('record-pane-open-page')).toBeVisible();
    await expect(card.getByRole('button', { name: /full width|maximi[sz]e|restore/i })).toHaveCount(0);

    // 「整页打开」 leaves for the page, which still knows its list.
    await card.getByTestId('record-pane-open-page').click();
    await expect(page).toHaveURL(recordPath);
    await expect(page.locator(POSITION)).toHaveAttribute('aria-label', /in All Records$/);
  });

  test('a page opened with no list behind it has no stepper; its object crumb goes to the object list', async ({ page }) => {
    await openList(page);
    const href = await page.locator(NAME).nth(1).getAttribute('href');
    expect(href).toBeTruthy();

    // A direct visit: a pasted link, a notification, a search hit.
    await page.goto(href!);

    await expect(page.locator(TITLE)).toBeVisible();
    await expect(page.locator('[data-record-top-bar-step]')).toHaveCount(0);
    await expect(page.locator(POSITION)).toHaveCount(0);
    await expect(page.getByTestId('record-page-crumb')).toBeVisible();

    await page.getByTestId('record-page-crumb').click();
    await expect(page.locator(NAME).nth(2)).toBeVisible();
  });
});

test.describe('record open path at 390 px (touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('there is no side-panel icon; a tap on the record opens the page, which still knows its list', async ({ page }) => {
    await page.goto(LIST);
    const card = page.getByTestId('grid-mobile-card').nth(1);
    await expect(card).toBeVisible();
    await expect(page.locator(ICON)).toHaveCount(0);

    await card.getByTestId('grid-card-title').tap();

    await expect(page).toHaveURL(recordPath);
    await expect(page.locator(CARD)).toHaveCount(0);
    await expect(page.locator(POSITION)).toHaveText(/^2 \/ \d+$/);
    await page.reload();
    await expect(page.locator(POSITION)).toHaveText(/^2 \/ \d+$/);
  });
});
