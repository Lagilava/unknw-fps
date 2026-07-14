module.exports = {
  testDir: ".tools",
  timeout: 360000,
  workers: 1,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 720 },
    // No global actionTimeout: it silently overrides every explicit `{ timeout }` passed
    // to waitForFunction/waitForSelector (in both directions), which capped boot waits at
    // 15s. Boot legitimately takes ~15-60s, so specs set their own timeouts.
    navigationTimeout: 90000,
    launchOptions: {
      args: [
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=CalculateNativeWinOcclusion",
      ],
    },
  },
  webServer: {
    command: "node .tools/static-server.cjs",
    url: "http://127.0.0.1:8000/",
    reuseExistingServer: true,
    timeout: 15000,
  },
};
