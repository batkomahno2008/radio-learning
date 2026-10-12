const { expect } = require('@playwright/test');
const RatingWidget = require('./RatingWidget');

// The "Previous tracks" list; rows are addressed by "Artist - Title".
class PreviousTracks {
  constructor(page) {
    this.page = page;
    this.section = page.getByRole('region', { name: 'Previous tracks:' });
    this.rows = this.section.getByRole('listitem');
  }

  row(track) {
    const thumb = this.page.getByRole('button', { name: `Thumbs up for ${track}`, exact: true });
    return this.rows.filter({ has: thumb });
  }

  rating(track) {
    return new RatingWidget(this.row(track).getByRole('group'));
  }

  // Row text is "Artist: Title", in the order shown.
  async expectRows(texts) {
    await expect(this.rows.locator('> span')).toHaveText(texts);
  }

  async expectNoRating(text) {
    const row = this.rows.filter({ hasText: text });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('button')).toHaveCount(0);
  }
}

module.exports = PreviousTracks;
