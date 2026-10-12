const { expect } = require('@playwright/test');
const RatingWidget = require('./RatingWidget');
const PreviousTracks = require('./PreviousTracks');

const METADATA_INTERVAL_MS = 10000;

// The whole Radio Calico page as one listener sees it.
class PlayerPage {
  constructor(page, url) {
    this.page = page;
    this.url = url;

    this.nowPlaying = page.getByRole('region', { name: 'Now playing' });
    this.artist = this.nowPlaying.getByRole('heading', { level: 1 });
    this.title = this.nowPlaying.getByRole('heading', { level: 2 });
    this.album = this.nowPlaying.getByRole('heading', { level: 3 });
    this.cover = this.nowPlaying.locator('.art img');
    this.sourceQuality = this.nowPlaying.getByText(/^Source quality:/);
    this.streamQuality = this.nowPlaying.getByText(/^Stream quality:/);
    this.error = this.nowPlaying.getByRole('status');
    this.rating = new RatingWidget(page.getByRole('group', { name: 'Rate this track:' }));

    this.controls = page.getByRole('group', { name: 'Radio player' });
    this.playButton = this.controls.getByRole('button', { name: /^(Play|Pause)$/ });
    this.muteButton = this.controls.getByRole('button', { name: /^(Mute|Unmute)$/ });
    this.volume = this.controls.getByRole('slider', { name: 'Volume' });
    this.status = this.controls.locator('#status');
    this.audio = page.locator('audio');

    this.previous = new PreviousTracks(page);
  }

  // Ready once the first metadata poll has rendered and the totals have arrived.
  async open() {
    await this.page.goto(this.url);
    await this.rating.expectLoaded();
  }

  async reload() {
    await this.page.reload();
    await this.rating.expectLoaded();
  }

  // Jumps the page's clock to its next metadata poll and waits for the fresh totals.
  async pollStation() {
    const totals = this.page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/ratings' && r.request().method() === 'GET'
    );
    await this.page.clock.fastForward(METADATA_INTERVAL_MS);
    await (await totals).finished();
  }

  // title is the on-air title (see World.onAir); the page adds the year after it.
  async expectNowPlaying({ artist, title }) {
    await expect(this.artist).toHaveText(artist);
    await expect(this.title).toContainText(title);
  }

  async play() {
    await this.controls.getByRole('button', { name: 'Play', exact: true }).click();
  }

  async pause() {
    await this.controls.getByRole('button', { name: 'Pause', exact: true }).click();
  }

  async toggleMute() {
    await this.muteButton.click();
  }

  async setVolume(percent) {
    await this.volume.fill(String(percent / 100));
  }

  async expectVolume(percent) {
    await expect.poll(() => this.audio.evaluate((el) => Math.round(el.volume * 100))).toBe(percent);
  }

  async expectMuted(muted) {
    await expect(this.muteButton).toHaveAccessibleName(muted ? 'Unmute' : 'Mute');
    await expect.poll(() => this.audio.evaluate((el) => el.muted)).toBe(muted);
  }
}

module.exports = PlayerPage;
