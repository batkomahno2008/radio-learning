const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');

async function vote(name, track, value) {
  await (await this.rating(name, track)).vote(value);
}

Given('{listener} has given {track} a thumbs {direction}', vote);
When('{listener} gives {track} a thumbs {direction}', vote);
When('{listener} presses the thumbs {direction} for {track} again', function (name, value, track) {
  return vote.call(this, name, track, value);
});

Then('{listener} sees {int} up and {int} down for {track}', async function (name, up, down, track) {
  await (await this.rating(name, track)).expectTotals(up, down);
});

Then("{listener}'s thumbs {direction} is selected for {track}", async function (name, value, track) {
  await (await this.rating(name, track)).expectSelection(value);
});

Then('{listener} has no thumb selected for {track}', async function (name, track) {
  await (await this.rating(name, track)).expectSelection(0);
});

Then('the ratings API reports {int} up and {int} down for {string}', async function (up, down, name) {
  const track = this.onAir(name);
  const params = new URLSearchParams({ client: 'api-check', track });
  const res = await fetch(new URL(`api/ratings?${params}`, this.app.url));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ [track]: { up, down, mine: 0 } });
});
