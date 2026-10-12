const { BeforeAll, AfterAll, Before, After, Status } = require('@cucumber/cucumber');
const { chromium } = require('playwright');
const app = require('./app');
const RadioWorld = require('./world');

// The app must already run at BASE_URL (see support/app.js).
BeforeAll(async function () {
  // HEADED=1 shows the browser; SLOWMO=250 slows each action down by that many ms.
  RadioWorld.browser = await chromium.launch({
    headless: !process.env.HEADED,
    slowMo: Number(process.env.SLOWMO) || 0,
    // The page makes its client id with crypto.randomUUID(), which needs a secure
    // context. Staging uses plain HTTP on a host name that is not localhost, so
    // tell Chromium to treat the BASE_URL origin as secure. The headless shell
    // ignores this flag, so use the full Chromium in its new headless mode.
    // The flag hides a known product limit (audit N7). #6 removes the flag and the
    // channel line when it adds a fallback for the client id.
    channel: 'chromium',
    args: [`--unsafely-treat-insecure-origin-as-secure=${app.origin}`],
  });
});

AfterAll(async function () {
  await RadioWorld.browser?.close();
});

Before({ tags: 'not @live' }, function () {
  return app.expectStationStream();
});

Before({ tags: '@live' }, function () {
  this.live = true;
});

After(async function ({ result }) {
  if (result.status === Status.FAILED) {
    for (const [name, player] of this.listeners) {
      this.attach(`${name}'s page`);
      this.attach(await player.page.screenshot({ fullPage: true }), 'image/png');
    }
  }
  await this.closeListeners();
  // The real station is outside our control, so only the fake one must run clean.
  if (result.status === Status.PASSED && !this.live && this.errors.length) {
    throw new Error(`The page reported errors:\n${this.errors.join('\n')}`);
  }
});
