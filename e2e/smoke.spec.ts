import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { collectErrors, loginAs, typeCode } from './helpers';

test('landing page: one-click demo into the hiring dashboard', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Technical hiring on/ })).toBeVisible();
  await page.getByRole('button', { name: /Try as a hiring manager/ }).first().click();
  await expect(page).toHaveURL(/\/hiring$/);
  await expect(page.getByText('Needs your review')).toBeVisible();
  expect(errors).toEqual([]);
});

test('practice: run, submit, and see measured complexity', async ({ context, page }) => {
  const errors = collectErrors(page);
  await loginAs(context, 'candidate');
  await page.goto('/problems/pair-sum-count');
  await typeCode(page, 'import sys\nfrom collections import Counter\nd = sys.stdin.buffer.read().split()\nn, t = int(d[0]), int(d[1])\nc = Counter()\nans = 0\nfor x in map(int, d[2:2 + n]):\n    ans += c[t - x]\n    c[x] += 1\nprint(ans)\n');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('2/2 tests passed')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(/8\/8 tests passed/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Measured growth')).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('hiring: filter, compare, decide', async ({ context, page }) => {
  const errors = collectErrors(page);
  await loginAs(context, 'recruiter');
  await page.goto('/hiring/1');
  await page.getByRole('tab', { name: /Flagged/ }).click();
  await expect(page.getByRole('link', { name: 'Grace Hopper' })).toBeVisible();
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.getByRole('checkbox', { name: 'Select Ada Lovelace' }).check();
  await page.getByRole('checkbox', { name: 'Select Grace Hopper' }).check();
  await page.getByRole('button', { name: /Compare side by side/ }).click();
  await expect(page.getByRole('heading', { name: 'Compare candidates' })).toBeVisible();
  await page.getByRole('link', { name: /Full report/ }).first().click();
  await page.getByRole('radio', { name: 'Advance' }).click();
  await expect(page.getByText(/Marked as/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('candidate takes a test from an invite link', async ({ browser, context, page }) => {
  await loginAs(context, 'recruiter');
  const inv = await (await context.request.post('/api/assessments/1/invites', { data: { candidates: [{ email: 'e2e@example.com', name: 'E2E Candidate' }] } })).json();
  const token = inv.invites[0].token;
  const cand = await browser.newContext();
  const p = await cand.newPage();
  const errors = collectErrors(p);
  await p.goto(`/t/${token}`);
  await expect(p.getByText('What this test records')).toBeVisible();
  await p.getByRole('checkbox', { name: /I understand/ }).check();
  await p.getByRole('button', { name: 'Start the test' }).click();
  await expect(p.getByRole('timer')).toBeVisible();
  await p.getByRole('navigation', { name: 'Questions' }).getByRole('button', { name: '4' }).click();
  await p.getByRole('radio', { name: /^WHERE filters rows before grouping/ }).click();
  await p.getByRole('button', { name: 'Finish' }).click();
  await p.getByRole('button', { name: 'Submit test' }).click();
  await expect(p.getByText(/Submitted — thank you/)).toBeVisible({ timeout: 60_000 });
  const report = await (await context.request.get(`/api/attempts/${inv.invites[0].id}`)).json();
  expect(report.attempt.status).toBe('submitted');
  expect(report.attempt.score).toBe(20);
  expect(errors).toEqual([]);
  await cand.close();
});

test('command palette and theme persist', async ({ page }) => {
  await page.goto('/problems');
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search' }).fill('islands');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/count-islands/);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Light' }).first().click();
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('learning: progressive hints, locked editorial', async ({ context, page }) => {
  const errors = collectErrors(page);
  const r = await context.request.post('/api/auth/register', { data: { email: `learner${Date.now()}@example.com`, name: 'Lee Learner', password: 'password123' } });
  expect(r.ok()).toBeTruthy();
  await page.goto('/problems/count-islands');
  await page.getByRole('tab', { name: /Hints · 0\/3/ }).click();
  await page.getByRole('button', { name: 'Reveal hint 1' }).click();
  await expect(page.getByText('Each island is a connected component')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Hints · 1\/3/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Editorial' }).click();
  await expect(page.getByText('The editorial is locked')).toBeVisible();
  await expect(page.getByText(/after 3 more submissions/)).toBeVisible();
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(ax.violations.map((v) => v.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test('contests: live standings and a problem inside the contest', async ({ context, page }) => {
  const errors = collectErrors(page);
  await loginAs(context, 'candidate');
  await page.goto('/contests');
  await page.getByRole('link', { name: /Weekly Sprint #42/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Weekly Sprint #42' })).toBeVisible();
  await page.getByRole('tab', { name: 'Standings' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.goto('/contests/weekly-sprint-42/A');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Hints/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
