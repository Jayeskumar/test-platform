import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { loginAs, setTheme } from './helpers';

const PAGES: { role: 'recruiter' | 'candidate' | null; paths: string[] }[] = [
  { role: null, paths: ['/', '/problems', '/leaderboard', '/login', '/register'] },
  { role: 'candidate', paths: ['/dashboard', '/problems/pair-sum-count', '/problems/where-vs-having'] },
  { role: 'recruiter', paths: ['/hiring', '/hiring/1', '/hiring/attempts/1', '/hiring/1/compare?ids=1,2', '/library', '/library/1', '/hiring/new'] },
];

for (const theme of ['light', 'dark'] as const) {
  for (const group of PAGES) {
    test(`WCAG 2.1 AA — ${theme} theme, ${group.role ?? 'signed out'}`, async ({ browser }) => {
      const context = await browser.newContext();
      await setTheme(context, theme);
      if (group.role) await loginAs(context, group.role);
      const page = await context.newPage();
      for (const path of group.paths) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const summary = results.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
        expect(summary, `${theme} ${path}`).toEqual([]);
      }
      await context.close();
    });
  }
}
