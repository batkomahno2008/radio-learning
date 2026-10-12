const { World, setWorldConstructor, setDefaultTimeout, defineParameterType } = require('@cucumber/cucumber');
const app = require('./app');
const Station = require('./station');
const PlayerPage = require('../pages/PlayerPage');

setDefaultTimeout(30000);

// Listeners are named in the steps: "Alice", "Bob", ...
defineParameterType({ name: 'listener', regexp: /[A-Z][a-z]+/, transformer: (name) => name });
defineParameterType({ name: 'direction', regexp: /up|down/, transformer: (word) => (word === 'up' ? 1 : -1) });
// Either the now-playing track (null) or a row of the previous tracks list.
defineParameterType({
  name: 'track',
  regexp: /the current track|"([^"]+)" in the history/,
  transformer: (name) => name ?? null,
});

class RadioWorld extends World {
  constructor(options) {
    super(options);
    this.app = app;
    this.station = new Station();
    this.listeners = new Map();
    this.errors = [];
    // Set by the @live hook: use the real station and the real clock.
    this.live = false;
  }

  // Each listener gets a separate browser context, which means a separate client id.
  // The player is opened the first time a step mentions the listener.
  async player(name) {
    if (this.listeners.has(name)) return this.listeners.get(name);
    const context = await RadioWorld.browser.newContext({ viewport: { width: 1280, height: 1000 } });
    if (!this.live) {
      await this.station.attach(context);
      // Lets steps skip the page's 10 second metadata poll instead of waiting for it.
      await context.clock.install();
    }
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') this.errors.push(`${name} console: ${m.text()}`); });
    page.on('pageerror', (e) => this.errors.push(`${name} page error: ${e.message}`));
    page.on('response', (r) => {
      if (r.url().startsWith(app.url) && !r.ok()) this.errors.push(`${name} ${r.status()} ${r.url()}`);
    });
    const player = new PlayerPage(page, app.url);
    this.listeners.set(name, player);
    await player.open();
    return player;
  }

  // The rating widget a step refers to, on one listener's page.
  async rating(name, track) {
    const player = await this.player(name);
    return track ? player.previous.rating(track) : player.rating;
  }

  async closeListeners() {
    for (const player of this.listeners.values()) await player.page.context().close();
    this.listeners.clear();
  }
}

setWorldConstructor(RadioWorld);

module.exports = RadioWorld;
