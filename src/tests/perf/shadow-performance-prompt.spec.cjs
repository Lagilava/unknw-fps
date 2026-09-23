const { test, expect } = require('@playwright/test');
test('shadow prompt requires an explicit choice, Escape keeps shadows', async ({page}) => {
 await page.goto('http://127.0.0.1:8000/');
 await page.setContent('<main>Game</main>');
 const open = () => page.evaluate(async () => {
  const {showShadowPerformancePrompt} = await import('/modules/shadow_performance_prompt');
  window.decision = null;
  showShadowPerformancePrompt(value => window.decision = value);
 });
 await open();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('button', {name:'Keep shadows'})).toBeFocused();
 expect(await page.evaluate(() => window.decision)).toBeNull();
 await page.screenshot({path:'test-artifacts/shadow-performance-prompt.png'});
 await page.keyboard.press('Escape');
 expect(await page.evaluate(() => window.decision)).toBe(false);
 await open(); await page.getByRole('button', {name:'Disable shadows'}).click();
 expect(await page.evaluate(() => window.decision)).toBe(true);
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
