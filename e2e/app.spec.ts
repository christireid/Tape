import { test, expect } from '@playwright/test';

// End-to-end: connect, receive, sort, filter, place an order through the
// consequence gates, receive a fill, and survive a disconnect.

test('connects and receives synthetic ticks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();
  await page.waitForTimeout(1500);
  const maxSeq = await page.evaluate(() =>
    Math.max(0, ...(window.__tape?.rows.map((r) => r.seq) ?? [0])),
  );
  expect(maxSeq).toBeGreaterThan(0);
});

test('filter narrows the blotter', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();
  await page.getByLabel('Filter blotter').fill('EURUSD');
  await page.waitForTimeout(400);
  await expect(page.getByText('EURUSD', { exact: false }).first()).toBeVisible();
});

test('sorting the blotter does not error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();
  await page.getByRole('columnheader', { name: 'Last' }).click();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('order ticket enforces lot size and tick size', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();

  // Default selected instrument is EURUSD (lot size 1000, tick 0.00001).
  await page.getByLabel('Quantity').fill('1500');
  await expect(page.getByRole('alert').filter({ hasText: 'multiple of the lot size' })).toBeVisible();

  await page.getByLabel('Quantity').fill('1000');
  await page.getByLabel('Limit price').fill('1.123456789');
  await expect(page.getByRole('alert').filter({ hasText: 'tick grid' })).toBeVisible();
});

test('fat-finger gate and optimistic order lifecycle', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();

  await page.getByLabel('Quantity').fill('1000');
  // EURUSD notional ~ 1.1M → confirm gate arms.
  const confirm = page.getByLabel('Type CONFIRM to arm submit');
  await expect(confirm).toBeVisible();
  await confirm.fill('CONFIRM');

  await page.getByRole('button', { name: /BUY EURUSD/ }).click();

  // Order appears optimistically and is confirmed by the worker.
  await expect(page.getByRole('cell', { name: 'EURUSD' }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  const filled = await page.evaluate(
    () => window.__tape?.orders.some((o) => o.status === 'FILLED' || o.status === 'PARTIAL' || o.status === 'WORKING'),
  );
  expect(filled).toBeTruthy();
});

test('disconnect is detected and recovers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();
  await page.waitForTimeout(500);

  await page.keyboard.press('x'); // inject disconnect (4s)
  await page.waitForTimeout(2500);
  const down = await page.evaluate(() => window.__tape?.getTelemetry().health);
  expect(down === 'down' || down === 'stale').toBeTruthy();

  await page.waitForTimeout(4000);
  const back = await page.evaluate(() => window.__tape?.getTelemetry());
  expect(back?.connected).toBeTruthy();
  expect(back?.gapsRecovered).toBe(0); // resync avoids false gaps
});
