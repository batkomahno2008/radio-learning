const { Then } = require('@cucumber/cucumber');

// Rows are written as the page shows them: "Artist: Title".
Then('{listener} sees these previous tracks:', async function (name, table) {
  const player = await this.player(name);
  await player.previous.expectRows(table.raw().map(([row]) => row));
});

Then('{listener} can rate every previous track', async function (name) {
  const player = await this.player(name);
  for (const { artist, title } of this.station.previous) {
    const rating = player.previous.rating(`${artist} - ${title}`);
    await rating.expectEnabled();
    await rating.expectLoaded();
  }
});

Then('{listener} cannot rate {string}', async function (name, row) {
  await (await this.player(name)).previous.expectNoRating(row);
});
