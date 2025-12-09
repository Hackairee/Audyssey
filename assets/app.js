const fileInput = document.querySelector('#file-input');
const tracksContainer = document.querySelector('#tracks');
const searchInput = document.querySelector('#search');
const startDateInput = document.querySelector('#start-date');
const endDateInput = document.querySelector('#end-date');
const thresholdToggle = document.querySelector('#thirty-threshold');
const mergeToggle = document.querySelector('#merge-duplicates');
const datasetStats = document.querySelector('#dataset-stats');
const sortMode = document.querySelector('#sort-mode');
const exportBtn = document.querySelector('#export-csv');
const resetStateBtn = document.querySelector('#reset-state');

const uploadStatus = document.querySelector('#upload-status');
const uploadProgress = document.querySelector('#upload-progress');
const uploadList = document.querySelector('#upload-list');

const detailCard = document.querySelector('#detail-card');
const detailEmpty = document.querySelector('#detail-empty');
const detailPane = document.querySelector('#detail');
const detailArtist = document.querySelector('#detail-artist');
const detailTitle = document.querySelector('#detail-title');
const detailAlbum = document.querySelector('#detail-album');
const detailAge = document.querySelector('#detail-age');
const detailStats = document.querySelector('#detail-stats');
const timelineChart = document.querySelector('#timeline-chart');
const playsContainer = document.querySelector('#plays');
const mergeSelect = document.querySelector('#merge-target');
const mergeButton = document.querySelector('#merge-button');

const DONE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30 * 4; // 4 months-ish
const FORBIDDEN_TITLES = ['intro', 'outro', 'interlude'];

let plays = [];
let aggregatedTracks = new Map();
let selectedTrackKey = null;

const persistedDone = loadDoneState();
const persistedData = loadStoredPlays();
if (persistedData.length) {
  plays = persistedData;
  refresh();
}

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  await processUploads(files);
});

resetStateBtn.addEventListener('click', () => {
  localStorage.clear();
  plays = [];
  aggregatedTracks = new Map();
  selectedTrackKey = null;
  renderTracks();
  renderDetail();
  renderDatasetStats();
  setUploadStatus('Waiting for files.', 0);
  uploadList.innerHTML = '';
});

[startDateInput, endDateInput, searchInput, thresholdToggle, mergeToggle, sortMode].forEach((el) =>
  el.addEventListener('input', () => refresh())
);

exportBtn.addEventListener('click', () => {
  const rows = buildTopList().map(({ track, stats }) => ({
    title: track.master_metadata_track_name,
    artist: track.master_metadata_album_artist_name,
    album: track.master_metadata_album_album_name,
    plays: stats.count,
    minutesPlayed: (stats.time / 60000).toFixed(2),
    firstPlay: stats.first ? new Date(stats.first).toISOString() : '',
    lastPlay: stats.last ? new Date(stats.last).toISOString() : '',
  }));
  const header = Object.keys(rows[0] || {}).join(',');
  const body = rows.map((r) => Object.values(r).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'audyssey-top-songs.csv';
  a.click();
  URL.revokeObjectURL(url);
});

mergeButton.addEventListener('click', () => {
  const target = mergeSelect.value;
  if (!selectedTrackKey || !target || target === selectedTrackKey) return;
  const selected = aggregatedTracks.get(selectedTrackKey);
  const destination = aggregatedTracks.get(target);
  if (!selected || !destination) return;
  destination.plays.push(...selected.plays);
  aggregatedTracks.delete(selectedTrackKey);
  selectedTrackKey = target;
  refresh();
});

async function processUploads(files) {
  uploadList.innerHTML = '';
  setUploadStatus('Import starting…', 0);

  let added = 0;
  let ignored = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setUploadStatus(`Reading ${file.name} (${i + 1}/${files.length})`, (i / files.length) * 100);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const entries = Array.isArray(json) ? json : [json];
      const result = ingest(entries);
      added += result.added;
      ignored += result.ignored;
      addUploadItem(file.name, result.added, result.ignored, null);
    } catch (err) {
      console.error('Failed to parse', file.name, err);
      addUploadItem(file.name, 0, 0, err);
    }
  }

  fileInput.value = '';
  refresh();
  setUploadStatus(`Finished. Added ${added} plays (${ignored} skipped as duplicates).`, 100);
}

function setUploadStatus(text, pct) {
  uploadStatus.textContent = text;
  uploadProgress.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function addUploadItem(name, added, ignored, error) {
  const li = document.createElement('li');
  li.className = 'upload-item';
  if (error) {
    li.innerHTML = `<strong>${name}</strong><div class="meta">Failed: ${error.message || error}</div>`;
  } else {
    li.innerHTML = `<strong>${name}</strong><div class="meta">${added} added · ${ignored} duplicates</div>`;
  }
  uploadList.prepend(li);
}

function ingest(items) {
  const existingKeys = new Set(plays.map((p) => p._dedupeKey));
  let added = 0;
  let ignored = 0;
  for (const entry of items) {
    const key = `${entry.ts}-${entry.spotify_track_uri || entry.master_metadata_track_name}`;
    if (existingKeys.has(key)) {
      ignored += 1;
      continue;
    }
    plays.push({ ...entry, _dedupeKey: key });
    added += 1;
    existingKeys.add(key);
  }
  setDefaultDates();
  persistPlays();
  return { added, ignored };
}

function refresh() {
  aggregatedTracks = aggregate(plays, { mergeDuplicates: mergeToggle.checked, threshold: thresholdToggle.checked });
  renderTracks();
  renderDetail();
  renderDatasetStats();
  persistPlays();
}

function aggregate(playHistory, options) {
  const map = new Map();
  const start = startDateInput.value ? new Date(startDateInput.value) : null;
  const end = endDateInput.value ? new Date(endDateInput.value) : null;

  for (const play of playHistory) {
    const date = new Date(play.ts);
    if (start && date < start) continue;
    if (end && date > end) continue;
    if (options.threshold && Number(play.ms_played || 0) < 30000) continue;

    const key = trackKey(play, options.mergeDuplicates);
    if (!map.has(key)) {
      map.set(key, { track: play, plays: [] });
    }
    map.get(key).plays.push(play);
  }

  // auto-merge near-identical tracks
  if (options.mergeDuplicates) {
    const bySignature = new Map();
    for (const [key, payload] of map.entries()) {
      const sig = signature(payload.track);
      if (!sig) continue;
      if (!bySignature.has(sig)) {
        bySignature.set(sig, key);
      } else {
        const targetKey = bySignature.get(sig);
        const target = map.get(targetKey);
        target.plays.push(...payload.plays);
        map.delete(key);
      }
    }
  }
  return map;
}

function trackKey(play, mergeDuplicates) {
  const uri = play.spotify_track_uri;
  if (!mergeDuplicates && uri) return uri;
  const artist = (play.master_metadata_album_artist_name || '').toLowerCase().trim();
  const title = normalizeTitle(play.master_metadata_track_name);
  if (!artist || !title) return uri || play.master_metadata_track_name;
  if (FORBIDDEN_TITLES.includes(title)) return uri || `${artist}-${title}-${play.master_metadata_album_album_name}`;
  return `${artist}::${title}`;
}

function signature(track) {
  const artist = (track.master_metadata_album_artist_name || '').toLowerCase().trim();
  const title = normalizeTitle(track.master_metadata_track_name);
  if (!artist || !title) return null;
  if (FORBIDDEN_TITLES.includes(title)) return null;
  return `${artist}-${title}`;
}

function normalizeTitle(title = '') {
  return title
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTopList() {
  const query = searchInput.value.toLowerCase();
  const rows = [];
  for (const [key, payload] of aggregatedTracks.entries()) {
    const stats = summarize(payload.plays);
    const track = payload.track;
    const haystack = `${track.master_metadata_track_name} ${track.master_metadata_album_artist_name} ${track.master_metadata_album_album_name}`.toLowerCase();
    if (query && !haystack.includes(query)) continue;
    rows.push({ key, track, stats });
  }

  const sort = sortMode.value;
  rows.sort((a, b) => {
    if (sort === 'time') return b.stats.time - a.stats.time;
    if (sort === 'recent') return (b.stats.last || 0) - (a.stats.last || 0);
    return b.stats.count - a.stats.count;
  });
  return rows;
}

function renderTracks() {
  const items = buildTopList();
  tracksContainer.innerHTML = '';
  items.forEach(({ key, track, stats }) => {
    const card = document.createElement('div');
    const isDone = isMarkedDone(key);
    card.className = 'track-card';
    if (isDone) card.style.opacity = 0.5;
    card.innerHTML = `
      <div class="track-header">
        <div>
          <div class="track-title">${track.master_metadata_track_name || 'Unknown'}</div>
          <div class="track-artist">${track.master_metadata_album_artist_name || '—'}</div>
        </div>
        <button class="button ghost" data-key="${key}">${isDone ? 'Marked' : 'Mark done'}</button>
      </div>
      <div class="track-meta">
        <span class="badge">${stats.count} plays</span>
        <span class="badge">${formatMinutes(stats.time)} listened</span>
        <span class="badge">First: ${stats.first ? new Date(stats.first).toLocaleDateString() : '—'}</span>
        <span class="badge">Last: ${stats.last ? new Date(stats.last).toLocaleDateString() : '—'}</span>
      </div>
    `;
    card.addEventListener('click', (event) => {
      if (event.target.matches('button')) return;
      selectedTrackKey = key;
      renderDetail();
    });
    card.querySelector('button').addEventListener('click', (event) => {
      event.stopPropagation();
      markDone(key);
      renderTracks();
    });
    tracksContainer.appendChild(card);
  });
}

function renderDatasetStats() {
  const total = aggregatedTracks.size;
  let playCount = 0;
  let time = 0;
  let platforms = new Set();
  for (const payload of aggregatedTracks.values()) {
    playCount += payload.plays.length;
    time += payload.plays.reduce((acc, p) => acc + Number(p.ms_played || 0), 0);
    payload.plays.forEach((p) => platforms.add(p.platform));
  }
  const stats = [
    { label: 'Tracks', value: total },
    { label: 'Plays in view', value: playCount },
    { label: 'Hours played', value: (time / 3600000).toFixed(2) },
    { label: 'Platforms', value: platforms.size },
  ];
  datasetStats.innerHTML = stats
    .map((s) => `<li><div class="label">${s.label}</div><div class="value">${s.value}</div></li>`)
    .join('');
}

function summarize(list) {
  if (!list.length) return { count: 0, time: 0 };
  const sorted = [...list].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return {
    count: list.length,
    time: list.reduce((acc, p) => acc + Number(p.ms_played || 0), 0),
    first: sorted[0] ? new Date(sorted[0].ts).getTime() : null,
    last: sorted[sorted.length - 1] ? new Date(sorted[sorted.length - 1].ts).getTime() : null,
    countries: tally(list, 'conn_country'),
    platforms: tally(list, 'platform'),
  };
}

function renderDetail() {
  if (!selectedTrackKey || !aggregatedTracks.has(selectedTrackKey)) {
    detailPane.classList.add('hidden');
    detailEmpty.classList.remove('hidden');
    return;
  }
  const { track, plays: list } = aggregatedTracks.get(selectedTrackKey);
  const stats = summarize(list);
  detailPane.classList.remove('hidden');
  detailEmpty.classList.add('hidden');

  detailArtist.textContent = track.master_metadata_album_artist_name || 'Unknown artist';
  detailTitle.textContent = track.master_metadata_track_name || 'Unknown track';
  detailAlbum.textContent = track.master_metadata_album_album_name || 'Unknown album';
  detailAge.textContent = `${stats.count} plays · ${formatMinutes(stats.time)} listened`;

  const cards = [
    { label: 'Most frequent platform', value: topKey(stats.platforms) || '—' },
    { label: 'Top country', value: topKey(stats.countries) || '—' },
    { label: 'First listened', value: stats.first ? new Date(stats.first).toLocaleString() : '—' },
    { label: 'Last listened', value: stats.last ? new Date(stats.last).toLocaleString() : '—' },
  ];
  detailStats.innerHTML = cards
    .map((c) => `<div class="cardlet"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`)
    .join('');

  renderTimeline(list);
  renderPlays(list);
  renderMergeOptions();
}

function renderTimeline(list) {
  const buckets = new Map();
  list.forEach((p) => {
    const d = new Date(p.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });
  const entries = Array.from(buckets.entries()).sort();
  const max = Math.max(...entries.map(([, v]) => v), 1);
  timelineChart.innerHTML = entries
    .map(([label, value]) => {
      const height = Math.max(8, (value / max) * 80);
      return `<div style="flex:1; text-align:center;">
        <div class="bar" style="height:${height}px"></div>
        <div class="bar-label">${label}</div>
      </div>`;
    })
    .join('');
}

function renderPlays(list) {
  const sorted = [...list].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  playsContainer.innerHTML = sorted
    .map(
      (p, idx) => `<div class="play-row">
        <div>${new Date(p.ts).toLocaleString()}</div>
        <div>${p.platform || '—'} · ${p.conn_country || '—'}</div>
        <div>${formatMinutes(p.ms_played || 0)} listened</div>
        <button class="button ghost" data-idx="${idx}">Delete</button>
      </div>`
    )
    .join('');
  playsContainer.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      sorted.splice(idx, 1);
      aggregatedTracks.get(selectedTrackKey).plays = sorted;
      refresh();
    });
  });
}

function renderMergeOptions() {
  mergeSelect.innerHTML = Array.from(aggregatedTracks.entries())
    .map(([key, payload]) => `<option value="${key}" ${key === selectedTrackKey ? 'disabled' : ''}>${payload.track.master_metadata_track_name} — ${payload.track.master_metadata_album_artist_name}</option>`)
    .join('');
  mergeButton.disabled = mergeSelect.value === selectedTrackKey;
}

function tally(list, key) {
  const res = new Map();
  list.forEach((item) => {
    const value = item[key];
    if (!value) return;
    res.set(value, (res.get(value) || 0) + 1);
  });
  return res;
}

function topKey(map) {
  let best = null;
  let bestCount = 0;
  map.forEach((count, key) => {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  });
  return best;
}

function formatMinutes(ms) {
  const min = Number(ms) / 60000;
  if (min < 1) return `${(ms / 1000).toFixed(0)}s`;
  return `${min.toFixed(1)} min`;
}

function markDone(key) {
  persistedDone[key] = Date.now();
  localStorage.setItem('audyssey-done', JSON.stringify(persistedDone));
}

function isMarkedDone(key) {
  const timestamp = persistedDone[key];
  if (!timestamp) return false;
  return Date.now() - timestamp < DONE_WINDOW_MS;
}

function loadDoneState() {
  try {
    return JSON.parse(localStorage.getItem('audyssey-done') || '{}');
  } catch (e) {
    return {};
  }
}

function persistPlays() {
  localStorage.setItem('audyssey-plays', JSON.stringify(plays));
}

function loadStoredPlays() {
  try {
    return JSON.parse(localStorage.getItem('audyssey-plays') || '[]');
  } catch (e) {
    return [];
  }
}

// ask for date range defaults based on data
function setDefaultDates() {
  if (!plays.length) return;
  const sorted = [...plays].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  startDateInput.value = sorted[0].ts.slice(0, 10);
  endDateInput.value = sorted[sorted.length - 1].ts.slice(0, 10);
}

// initialize date defaults after load
setDefaultDates();
