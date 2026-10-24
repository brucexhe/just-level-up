const { chromium } = require('/Users/artefact/.nvm/versions/node/v22.17.1/lib/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 790 },
    deviceScaleFactor: 2,
  });
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForSelector('#app canvas');
  await page.waitForTimeout(2200);

  const info = await page.evaluate(() => {
    const c = document.querySelector('#app canvas');
    const r = c.getBoundingClientRect();
    const d = window.__demo;
    // 找一个在视野里的怪，取它的屏幕坐标（worldView 已含 zoom）
    const monsters = d ? d.monsters() : [];
    const p = d ? d.pos() : null;
    const labels = [];
    for (const o of window.__demo ? [] : []) labels.push(o);
    return {
      view: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      canvasCss: [r.width, r.height],
      canvasBuffer: [c.width, c.height],
      player: p,
      monsters: monsters.slice(0, 4),
      texFonts: labels,
    };
  });

  // 玩家 + 最近怪所在区域的 1:1 物理像素裁剪（DPR2 → 坐标×2）
  const box = await page.evaluate(() => {
    const d = window.__demo;
    const p = d.pos();
    return { x: p.x, y: p.y };
  });
  const screen = await page.evaluate(
    ([x, y]) => window.__demo.screenOf(x, y),
    [box.x, box.y],
  );
  // screenOf 是逻辑像素，转 CSS 需要除以 dpr？Phaser 逻辑像素 = CSS 像素
  const clip = {
    x: Math.max(0, Math.round(screen.sx) - 120),
    y: Math.max(0, Math.round(screen.sy) - 90),
    width: 240,
    height: 180,
  };
  await page.screenshot({ path: '/tmp/mac-full.png' });
  await page.screenshot({ path: '/tmp/mac-zoom.png', clip });

  console.log(JSON.stringify({ info, screen, clip }, null, 2));
  await browser.close();
})();
