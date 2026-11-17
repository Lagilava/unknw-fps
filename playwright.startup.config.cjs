module.exports = {
  testDir: 'src/tests/startup',
  testMatch: 'boot.spec.cjs',
  timeout: 300000,
  workers: 1,
  use: {
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: [
    { command: 'node src/server.js 8011', url: 'http://127.0.0.1:8011/health', reuseExistingServer: false },
    { command: 'node src/tests/startup/built-server.cjs', url: 'http://127.0.0.1:8012/', reuseExistingServer: false },
  ],
};
