import { type BrowserContext, type Page, expect } from '@playwright/test';

export const PASSWORD = 'crucible123';

export async function loginAs(context: BrowserContext, role: 'recruiter' | 'candidate' | 'admin') {
  const r = await context.request.post('/api/auth/login', { data: { email: `${role}@crucible.dev`, password: PASSWORD } });
  expect(r.ok()).toBeTruthy();
}

export async function setTheme(context: BrowserContext, theme: 'light' | 'dark') {
  await context.addInitScript((t) => localStorage.setItem('crucible:theme', t), theme);
}

/** Replace the editor contents (CodeMirror) with `code`. */
export async function typeCode(page: Page, code: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
}

export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/TensorFlow|getUserMedia|NotFoundError/.test(m.text())) errors.push(m.text()); });
  return errors;
}
