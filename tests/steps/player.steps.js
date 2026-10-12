const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');

Given('{listener} has started playback', async function (name) {
  const player = await this.player(name);
  await player.play();
  await expect(player.status).toHaveText('Live');
});

When('{listener} presses play', async function (name) {
  await (await this.player(name)).play();
});

When('{listener} presses pause', async function (name) {
  await (await this.player(name)).pause();
});

When('{listener} presses the mute button', async function (name) {
  await (await this.player(name)).toggleMute();
});

Given('{listener} has muted the player', async function (name) {
  const player = await this.player(name);
  await player.toggleMute();
  await player.expectMuted(true);
});

When('{listener} sets the volume to {int}%', async function (name, percent) {
  await (await this.player(name)).setVolume(percent);
});

Then('{listener} sees the artist {string}', async function (name, artist) {
  await expect((await this.player(name)).artist).toHaveText(artist);
});

Then('{listener} sees the title {string}', async function (name, title) {
  await expect((await this.player(name)).title).toHaveText(title);
});

Then('{listener} sees the album {string}', async function (name, album) {
  await expect((await this.player(name)).album).toHaveText(album);
});

Then('{listener} sees the source quality {string}', async function (name, quality) {
  await expect((await this.player(name)).sourceQuality).toHaveText(`Source quality: ${quality}`);
});

Then('{listener} sees the stream quality {string}', async function (name, quality) {
  await expect((await this.player(name)).streamQuality).toHaveText(`Stream quality: ${quality}`);
});

Then('{listener} sees the cover art', async function (name) {
  await expect((await this.player(name)).cover).toBeVisible();
});

Then('{listener} sees a track on air', async function (name) {
  const player = await this.player(name);
  await expect(player.artist).not.toHaveText('Radio Calico');
  await expect(player.title).not.toHaveText('Live stream');
});

Then('{listener} sees at least one previous track', async function (name) {
  await expect((await this.player(name)).previous.rows.first()).toBeVisible();
});

Then('the player status is {string} for {listener}', async function (status, name) {
  await expect((await this.player(name)).status).toHaveText(status);
});

Then('{listener} can press {word}', async function (name, label) {
  const player = await this.player(name);
  await expect(player.playButton).toHaveAccessibleName(new RegExp(`^${label}$`, 'i'));
  await expect(player.playButton).toBeEnabled();
});

Then('the player is muted for {listener}', async function (name) {
  await (await this.player(name)).expectMuted(true);
});

Then('the player is not muted for {listener}', async function (name) {
  await (await this.player(name)).expectMuted(false);
});

Then('the volume is {int}% for {listener}', async function (percent, name) {
  await (await this.player(name)).expectVolume(percent);
});
