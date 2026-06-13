import { chromium } from '@playwright/test';

const profile = process.env.PROFILE;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto('http://127.0.0.1:5050/counter', { waitUntil: 'domcontentloaded' });
const button = page.getByRole('button', { name: 'Click me' });
const updatedCount = page.getByText('Current count: 1');
for (let attempt = 0; attempt < 20 && !await updatedCount.isVisible(); attempt++) {
  if (errors.length) break;
  await button.click();
  await page.waitForTimeout(500);
}
if (errors.length) throw new Error(`${profile} emitted browser errors:\n${errors.join('\n')}`);
await updatedCount.waitFor();
console.log(`${profile}: Blazor Server counter became interactive.`);
await browser.close();
