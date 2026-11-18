const fs = require('node:fs');
const chrome = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
module.exports = {
  testDir: 'src/tests', timeout: 240000, workers: 1, reporter: [['list']],
  use: { browserName: 'chromium', viewport: { width: 1280, height: 720 },
    launchOptions: { ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}),
      args: ['--disable-background-timer-throttling'] } },
};
