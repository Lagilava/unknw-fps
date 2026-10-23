module.exports = {
  testDir: '../src/tests/weapons',
  testMatch: 'weapon-handling.spec.cjs',
  timeout:600000, workers:1,
  use:{headless:true, viewport:{width:1600,height:900},
    launchOptions:{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
  webServer:{command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:3000',timeout:60000},
};
