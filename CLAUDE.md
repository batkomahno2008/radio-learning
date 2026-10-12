# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Writing standard

Always use ASD-STE100 Simplified Technical English for all text that you write in this
project. This includes replies, documentation, code comments, commit messages and
pull request descriptions.

- Use approved words only, and use each word with one meaning.
- Use the active voice and the simple tenses.
- Write a maximum of 20 words in an instruction and 25 words in a description.
- Give one instruction in each sentence, and use the imperative form.
- Write a maximum of six sentences in a paragraph.
- Do not use noun clusters of more than three words.
- Do not change code identifiers, commands, file names or quoted text.

## Commands

Node version is pinned in `.nvmrc`. There is no build step and no linter.

```bash
npm start                 # node server.js on http://localhost:3000 (PORT overrides)
npm run dev               # same, restarting on file changes

npm run test:e2e          # full Cucumber suite against a fake station (~5 s)
npm run test:e2e:smoke    # only @smoke scenarios
npm run test:e2e:live     # only @live scenarios, against the real station feed

npx cucumber-js tests/features/ratings.feature:20        # one scenario, by line
npx cucumber-js --name "Giving a thumbs up"              # one scenario, by name
HEADED=1 SLOWMO=250 npm run test:e2e                     # watch it in a browser
```

The e2e suite needs Playwright's Chromium once per machine:
`sudo npx playwright install --with-deps chromium`.

A failed run writes `reports/cucumber.html` with a full-page screenshot per listener.

## Architecture

A single-page internet radio player: an Express 5 server, a SQLite database and one
static HTML file. CommonJS throughout.

- `server.js` — serves `public/`, exposes hls.js from `node_modules` at `/vendor/hls`,
  and the JSON API (`/api/streams`, `/api/ratings`, `/api/health`). Binds to 127.0.0.1 only.
- `db.js` — opens the database with better-sqlite3 and executes `schema.sql` on every
  start, so every statement in `schema.sql` must stay idempotent.
- `public/index.html` — markup and client script in one file, no bundler.
- `public/styles.css` — all CSS, linked from `index.html`.

Environment overrides: `PORT`, `DB_PATH` (default `data/dev.db`), `STREAMS_FILE`
(default `stream_URL.txt`, re-read on every `/api/streams` request).

### How the page gets its data

The server only knows the stream URL. Track metadata and cover art are fetched by the
browser directly from the root of the stream's host (`metadatav2.json`, `cover.jpg`),
polled every 10 seconds. The previous-tracks list comes from the `prev_artist_N` /
`prev_title_N` fields of that same feed.

Playback uses hls.js and pins the lossless (FLAC) rendition whenever the manifest offers
one, rather than leaving the choice to bitrate-based switching.

### Ratings

- A track is identified by the string `"Artist - Title"`; there is no track table. The
  now-playing widget and a history row for the same song share one key, which is how a
  rating follows a track into the history.
- A listener is an anonymous UUID kept in `localStorage` under `client`.
- One row per (track, client) with value 1 or -1; clearing a rating deletes the row.
- `GET /api/ratings` takes one or more `track` params (max 20) and returns a map of
  `{ up, down, mine }` per track. The page makes one batched request per metadata poll.
- Votes are optimistic in the client. While a vote is being saved, further clicks on
  that track are ignored, and a poll response that overlapped a vote is discarded.

### Design references

`RadioCalico_Style_Guide.txt` (palette, typography, component rules) and
`RadioCalico_Layout.md` / `RadioCalicoLayout.png` (target layout) are the source of
truth for visual changes. The CSS custom properties in `styles.css` mirror the palette.

## E2E tests (`tests/`)

Cucumber scenarios in `features/`, step definitions in `steps/`, Playwright page objects
in `pages/`, and the harness in `support/`.

- **Isolation:** `support/app.js` spawns `server.js` on a free port with a temporary
  `DB_PATH` and `STREAMS_FILE`; a `Before` hook empties the `ratings` table. The suite
  never touches `data/dev.db` or `stream_URL.txt`.
- **Fake station:** `support/station.js` intercepts `https://station.test/**` and serves
  metadata, cover art and a short silent FLAC stream from `fixtures/station/`. Steps such
  as `the station is playing "Artist - Title"` and `the station starts playing "..."`
  control what is on air. Other off-site requests (web fonts) are stubbed.
- **No waiting for polls:** each browser context has Playwright's clock installed;
  `PlayerPage.pollStation()` fast-forwards 10 seconds to trigger the next metadata poll.
- **Listeners:** steps name an actor ("Alice", "Bob"). `World.player(name)` lazily opens
  a separate browser context per name, which gives each one its own client id.
- **Track references in steps:** the `{track}` parameter is either `the current track`
  or `"Artist - Title" in the history`.
- **Locators** use roles and accessible names (for example
  `Thumbs up for Artist - Title`), so renaming an `aria-label` in `index.html` breaks
  the page objects.
- **Clean-console rule:** a passing scenario is failed in the `After` hook if the page
  logged a console error, threw, or got a non-2xx answer from the app. `@live` scenarios
  are exempt and use the real stream and the real clock.
- `RatingWidget.vote()` waits for the POST to finish before returning; keep that when
  adding steps that click thumbs back to back, because of the click-ignoring rule above.
- Tags: `@smoke`, `@live` (excluded from the default profile), `@wip` (always excluded).
