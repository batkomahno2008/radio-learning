const crypto = require('node:crypto');
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
    // A new random value for each scenario. See onAir().
    this.token = crypto.randomBytes(3).toString('hex');
    this.station = new Station(this.token);
    this.listeners = new Map();
    this.errors = [];
    // Set by the @live hook: use the real station and the real clock.
    this.live = false;
  }

  // Maps a track name from a step to the name on air. The station adds the token
  // to each title, so "Chic - Le Freak" is "Chic - Le Freak ~a1b2c3" on the page.
  // The same rule applies to a history row ("Chic: Le Freak") and to a title with
  // its year ("Le Freak (1978)"); the token goes before the year.
  onAir(name) {
    const [, text, year = ''] = name.match(/^(.*?)( \(\d{4}\))?$/);
    return `${this.station.withToken(text)}${year}`;
  }

  // Each listener gets a separate browser context, which means a separate client id.
  // The player is opened the first time a step mentions the listener.
  async player(name) {
    if (this.listeners.has(name)) return this.listeners.get(name);
    const context = await RadioWorld.browser.newContext({ viewport: { width: 1280, height: 1000 } });
    if (!this.live) {
      await this.station.attach(context, app.origin);
      // Lets steps skip the page's 10 second metadata poll instead of waiting for it.
      await context.clock.install();
    } else {
      // Play the real stream, whatever the stream list of the app under test is.
      const url = app.liveStreamUrl;
      await context.route(new URL('api/streams', app.url).href, (route) =>
        route.fulfill({ json: [{ name: new URL(url).hostname, url }] })
      );
    }
    const page = await context.newPage();
    // The clean-console rule (see the After hook). Chromium shows a CSP violation as a
    // console error, so a CSP violation also fails the scenario.
    page.on('console', (m) => { if (m.type() === 'error') this.errors.push(`${name} console: ${m.text()}`); });
    page.on('pageerror', (e) => this.errors.push(`${name} page error: ${e.message}`));
    // Only answers from the app under test (the BASE_URL origin) count.
    page.on('response', (r) => {
      if (new URL(r.url()).origin === app.origin && !r.ok()) this.errors.push(`${name} ${r.status()} ${r.url()}`);
    });
    const player = new PlayerPage(page, app.url);
    this.listeners.set(name, player);
    await player.open();
    return player;
  }

  // The rating widget a step refers to, on one listener's page.
  async rating(name, track) {
    const player = await this.player(name);
    return track ? player.previous.rating(this.onAir(track)) : player.rating;
  }

  async closeListeners() {
    for (const player of this.listeners.values()) await player.page.context().close();
    this.listeners.clear();
  }
}

setWorldConstructor(RadioWorld);

module.exports = RadioWorld;
