const { test, expect } = require("@playwright/test");

test.use({ channel: "chrome" });
test.setTimeout(120000);

test("angel siege drone startup", async ({ page }) => {
  const messages = [];
  const errors = [];
  const blockedWarnings = [];
  const blockedWarningPatterns = [
    /Maya\|base map is not supported/i,
    /unknown material type/i,
    /more than 4 skinning weights/i,
  ];

  page.on("console", message => {
    const text = message.text();
    messages.push(`${message.type()}: ${text}`);
    if (message.type() === "error") errors.push(text);
    if (message.type() === "warning" && blockedWarningPatterns.some(pattern => pattern.test(text))) {
      blockedWarnings.push(text);
    }
  });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await expect(page.locator("#kills-val")).toHaveText("0 / 1", { timeout: 5000 });
  await page.locator("#startBtn").click();
  await expect(page.locator("#overlay")).toHaveClass(/hidden/, { timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-artifacts/angel-drone-startup.png", fullPage: false });

  const fatalErrors = errors.filter(text =>
    !/favicon|Failed to load resource.*404/i.test(text)
  );
  expect(fatalErrors, messages.join("\n")).toEqual([]);
  expect(blockedWarnings, messages.join("\n")).toEqual([]);
});
