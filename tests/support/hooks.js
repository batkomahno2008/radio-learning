const { BeforeAll, AfterAll, Before, After, Status } = require('@cucumber/cucumber');
const { chromium } = require('playwright');
const app = require('./app');
const Station = require('./station');
const RadioWorld = require('./world');

BeforeAll(async function () {
  await app.start();
  // HEADED=1 shows the browser; SLOWMO=250 slows each action down by that many ms.
  RadioWorld.browser = await chromium.launch({
    headless: !process.env.HEADED,
    slowMo: Number(process.env.SLOWMO) || 0,
  });
});

AfterAll(async function () {
  await RadioWorld.browser?.close();
  await app.stop();
});

Before(function () {
  app.clearRatings();
  app.useStream(Station.STREAM_URL);
});

Before({ tags: '@live' }, function () {
  this.live = true;
  app.useRealStream();
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
