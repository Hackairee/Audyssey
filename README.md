# Audyssey – Spotify History Lab

A lightweight in-browser explorer for your Spotify history exports. Drop your JSON files, explore top songs by date range, mark what you have already curated, merge duplicates, and inspect detailed listening stats with zero backend.

## Quick start
1. Open `index.html` in your browser (no build step required).
2. Click **Upload history JSON** and select one or more Spotify history files (arrays of play objects).
3. Choose a date range, adjust thresholds, and browse the "Top songs" grid.
4. Mark songs as done (remains highlighted for ~4 months), inspect timelines, delete individual listens, or merge near-duplicate tracks.
5. Export your current leaderboard to CSV for playlist building.

## Features
- Modern dark UI with responsive grid layout.
- Local-only processing: data, marks, and play history stay in your browser via `localStorage`.
- Automatic deduplication and smart merging of tracks with matching artist/title (skips generic titles like intro/outro/interlude).
- Filtering by date window and 30s play threshold to count meaningful listens.
- Per-song insights: platforms, countries, first/last listen, monthly timeline, and play-by-play edits.
- Manual merge controls and inline delete for cleaning noisy history.
- CSV export of the current top list.

## Notes
- Auto-merge is best-effort; you can always override via the manual merge selector in the detail pane.
- Marked songs fade for four months from the time you mark them, helping avoid re-processing the same favorites.
- The app is a static page—no credentials or network access needed for the current iteration.
