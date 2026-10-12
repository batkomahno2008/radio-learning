const { expect } = require('@playwright/test');

// One thumbs up / thumbs down pair with its totals, for the current track or a history row.
class RatingWidget {
  constructor(root) {
    this.root = root;
    this.up = root.getByRole('button', { name: /^Thumbs up/ });
    this.down = root.getByRole('button', { name: /^Thumbs down/ });
    this.upCount = root.locator('.count').nth(0);
    this.downCount = root.locator('.count').nth(1);
  }

  // value is 1 (thumbs up) or -1 (thumbs down).
  async vote(value) {
    const page = this.root.page();
    const saved = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/ratings' && r.request().method() === 'POST'
    );
    await (value === 1 ? this.up : this.down).click();
    // The page ignores clicks on a track while its previous vote is still being saved.
    await (await saved).finished();
    await page.evaluate(() => {});
  }

  async expectTotals(up, down) {
    await expect(this.upCount).toHaveText(String(up));
    await expect(this.downCount).toHaveText(String(down));
  }

  // value is 1, -1, or 0 for no thumb selected.
  async expectSelection(value) {
    await expect(this.up).toHaveAttribute('aria-pressed', String(value === 1));
    await expect(this.down).toHaveAttribute('aria-pressed', String(value === -1));
  }

  async expectEnabled() {
    await expect(this.up).toBeEnabled();
    await expect(this.down).toBeEnabled();
  }

  // Totals stay blank until the server has answered for this track.
  async expectLoaded() {
    await expect(this.upCount).toHaveText(/^\d+$/);
  }
}

module.exports = RatingWidget;
