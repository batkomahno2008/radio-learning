const { Given, When } = require('@cucumber/cucumber');

Given('the station is playing {string}', function (track) {
  this.station.play(track);
});

Given('the previous tracks are:', function (table) {
  this.station.setPrevious(table.raw().map(([track]) => track));
});

Given('{listener} has opened the player', async function (name) {
  await this.player(name);
});

When('{listener} opens the player', async function (name) {
  await this.player(name);
});

When('{listener} reloads the page', async function (name) {
  await (await this.player(name)).reload();
});

When('the station starts playing {string}', async function (track) {
  this.station.play(track);
  // Every open player picks the new song up on its next poll.
  for (const player of this.listeners.values()) {
    await player.pollStation();
    await player.expectNowPlaying(this.station.current);
  }
});

When("{listener}'s player checks the station again", async function (name) {
  await (await this.player(name)).pollStation();
});
