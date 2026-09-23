const { test, expect } = require('@playwright/test');
test('all nine weapon readouts, ammo states, upgrades and compact layout', async ({ page }) => {
  await page.goto('http://127.0.0.1:8000/');
  await page.setContent(`<style>body{margin:0;background:#142333;color:white;font-family:Arial}#bottom-hud{display:flex;justify-content:flex-end;padding:24px}.hud-block{display:flex;flex-direction:column;align-items:flex-end}#reload-bar-wrap{opacity:0}</style><div id="bottom-hud"><div class="hud-block end"><div id="weapon-val"></div><div class="hud-label">Ammunition</div><div id="ammo-val"><span id="ammo-mag"></span><span class="ammo-reserve"> / <span id="ammo-reserve"></span></span></div><div id="reload-bar-wrap"><div id="reload-bar"></div></div></div></div>`);
  await page.evaluate(async () => {
    const { createWeaponHud } = await import('/modules/weapon_hud');
    const { GUNS, createGunState } = await import('/modules/gun_config');
    window.renderWeapon = (type, values = {}, unlimited = false, level = 0) => {
      const gun = Object.assign(createGunState(type), values);
      document.querySelector('#weapon-val').textContent = gun.displayName;
      document.querySelector('#ammo-mag').textContent = unlimited ? 'INF' : gun.mag;
      document.querySelector('#ammo-reserve').textContent = unlimited ? 'INF' : gun.ammo;
      window.updateReadout(type, gun, unlimited, level);
    };
    window.updateReadout = createWeaponHud();
    window.gunTypes = Object.values(GUNS);
  });
  const types = await page.evaluate(() => window.gunTypes);
  expect(types).toHaveLength(9);
  for (const type of types) {
    await page.evaluate(type => window.renderWeapon(type), type);
    await expect(page.locator('.weapon-readout')).toHaveAttribute('data-weapon', type);
    await expect(page.locator('.weapon-status')).not.toBeEmpty();
    expect(await page.locator('.weapon-meter i.filled:visible').count()).toBeGreaterThan(0);
    await page.evaluate(type => window.renderWeapon(type, { mag: 1 }), type);
    await expect(page.locator('.weapon-readout')).toHaveAttribute('data-ammo-state', 'low');
    await page.evaluate(type => window.renderWeapon(type, { mag: 0, ammo: 0 }), type);
    await expect(page.locator('.weapon-status')).toHaveText('OUT OF AMMO · SWITCH WEAPON');
    await page.evaluate(type => window.renderWeapon(type, { mag: 0, reloadTimer: .5 }), type);
    await expect(page.locator('.weapon-status')).toHaveText('RELOADING · 0.5s');
    await page.evaluate(type => window.renderWeapon(type, {}, true, 2), type);
    await expect(page.locator('.weapon-status')).toHaveText('UNLIMITED AMMO');
    await expect(page.locator('#ammo-mag')).toHaveText('\u221e');
    await expect(page.locator('.ammo-reserve')).toBeHidden();
    await expect(page.locator('.weapon-meter')).toBeHidden();
    await expect(page.locator('.weapon-heading')).toContainText('MK 3');
  }
  await page.evaluate(() => window.renderWeapon('flak', { mag: 2 }));
  await page.screenshot({ path: 'test-artifacts/weapon-hud-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-artifacts/weapon-hud-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
