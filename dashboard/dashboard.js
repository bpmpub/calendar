import { supabase, configured } from "../lib/supabase-client.js?v=10";

const state = {
  user: null,
  isAdmin: false,
  isNatalie: false,  // gates the People tab (account management) — see wirePeople*
  artists: [],   // artists this user can manage
  shows: [],
  activeTab: "shows",
  showPast: false,
  mineOnly: false,   // admin-only: hide other publicists' artists in the Shows tab
};

const selectedShowIds = new Set();

const el = (sel) => document.querySelector(sel);
const els = (sel) => Array.from(document.querySelectorAll(sel));

function toLoginPage() {
  window.location.href = new URL("../login/", window.location.href).toString();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

async function init() {
  if (!configured) {
    el("#loading").textContent = "Supabase isn't configured yet — see lib/config.js.";
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    toLoginPage();
    return;
  }
  state.user = session.user;
  el("#dash-user").textContent = state.user.email;

  supabase.auth.onAuthStateChange((_event, sess) => {
    if (!sess) toLoginPage();
  });

  const { data: adminRow } = await supabase
    .from("admin_emails")
    .select("email")
    .eq("email", state.user.email)
    .maybeSingle();
  state.isAdmin = Boolean(adminRow);
  // People (account management) is deliberately narrower than "admin" —
  // only Natalie manages who can log in and who's an admin. Enforced
  // again server-side via RLS on admin_emails inserts, not just this UI
  // check (see supabase/schema.sql).
  state.isNatalie = state.user.email === "natalie@bpmpublicity.com";

  if (state.isAdmin) {
    el("#artists-tab-btn").hidden = false;
    el("#mine-only-wrapper").hidden = false;
  }
  if (state.isNatalie) el("#people-tab-btn").hidden = false;

  await loadArtistsAndShows();
  wireTabs();
  wireShowModal();
  wireExpandCollapseAll();
  wireQuickAdd();
  wireArtistModal();
  wireLogout();
  wireAddPasskey();
  wireMineOnly();
  wireBulkActions();
  populateQuickAddArtistSelect();
  renderShows();
  if (state.isAdmin) renderArtists();
  if (state.isNatalie) {
    wirePersonModal();
    renderPeople();
  }

  el("#loading").hidden = true;
  el("#shows-panel").hidden = false;
}

async function loadArtistsAndShows() {
  let artistsQuery = supabase.from("artists").select("*").order("name");
  if (!state.isAdmin) {
    artistsQuery = artistsQuery.eq("publicist_email", state.user.email);
  }
  const { data: artists, error: artistsErr } = await artistsQuery;
  if (artistsErr) throw artistsErr;
  state.artists = artists;

  const artistIds = artists.map((a) => a.artist_id);
  if (artistIds.length === 0) {
    state.shows = [];
    return;
  }
  const { data: shows, error: showsErr } = await supabase
    .from("shows")
    .select("*")
    .in("artist_id", artistIds)
    .order("date");
  if (showsErr) throw showsErr;
  state.shows = shows;
}

function artistById(id) {
  return state.artists.find((a) => a.artist_id === id);
}

// ---------- Tabs ----------

function wireTabs() {
  els(".dash-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      els(".dash-tab").forEach((b) => b.classList.toggle("active", b === btn));
      el("#shows-panel").hidden = state.activeTab !== "shows";
      el("#artists-panel").hidden = state.activeTab !== "artists";
      el("#people-panel").hidden = state.activeTab !== "people";
    });
  });
}

function wireLogout() {
  el("#logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    toLoginPage();
  });
}

function wireMineOnly() {
  el("#mine-only-checkbox").addEventListener("change", (e) => {
    state.mineOnly = e.target.checked;
    renderShows();
  });
}

async function hasPasskey() {
  // A direct RLS-scoped table read was silently returning zero rows for
  // an account confirmed (server-side, bypassing RLS) to have two
  // passkeys registered — root cause not worth chasing further, since
  // passkey-login-options already does this exact existence check
  // correctly (service role) as part of the real login flow.
  const { hasRegisteredPasskey } = await import("../lib/webauthn.js?v=10");
  return hasRegisteredPasskey(state.user.email);
}

async function wireAddPasskey() {
  const btn = el("#add-passkey-btn");

  // Wire the click handler FIRST, unconditionally — if the "does a
  // passkey already exist" check below throws (network hiccup, RLS
  // hiccup, whatever), the button must still work rather than silently
  // ending up with no listener attached at all.
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Follow your browser's prompt…";
    try {
      const { registerPasskey } = await import("../lib/webauthn.js?v=10");
      await registerPasskey();
      btn.hidden = true;
    } catch (err) {
      alert(err.message || "Couldn't add a passkey.");
      btn.textContent = original;
      btn.disabled = false;
    }
  });

  try {
    if (await hasPasskey()) {
      btn.hidden = true;
    }
  } catch (err) {
    console.warn("hasPasskey check failed, leaving the button visible:", err);
  }
}

// ---------- Shows ----------

// Artist ids collapsed by the user — kept outside renderShows so
// re-renders (after add/edit/cancel) don't reset what's open.
const collapsedArtists = new Set();

function wireExpandCollapseAll() {
  el("#expand-all-btn").addEventListener("click", () => {
    collapsedArtists.clear();
    els(".dash-artist-group").forEach((g) => (g.open = true));
  });
  el("#collapse-all-btn").addEventListener("click", () => {
    els(".dash-artist-group").forEach((g) => {
      g.open = false;
      collapsedArtists.add(g.dataset.artistId);
    });
  });
  el("#show-past-checkbox").addEventListener("change", (e) => {
    state.showPast = e.target.checked;
    renderShows();
  });
}

function visibleArtistsForShows() {
  if (!state.mineOnly) return state.artists;
  return state.artists.filter((a) => a.publicist_email === state.user.email);
}

function renderShows() {
  const container = el("#shows-list");
  const artistsInView = visibleArtistsForShows();

  if (state.artists.length === 0) {
    container.innerHTML = '<div class="dash-empty">No artists assigned to your account yet.</div>';
    updateBulkBar();
    return;
  }
  if (artistsInView.length === 0) {
    container.innerHTML = '<div class="dash-empty">No artists assigned to you — uncheck "Only my artists" to see the full roster.</div>';
    updateBulkBar();
    return;
  }
  if (state.shows.length === 0) {
    container.innerHTML = '<div class="dash-empty">No shows yet. Add the first one.</div>';
    updateBulkBar();
    return;
  }

  const inViewIds = new Set(artistsInView.map((a) => a.artist_id));
  const todayIso = new Date().toISOString().slice(0, 10);
  const visibleShows = state.shows.filter((s) => {
    if (!inViewIds.has(s.artist_id)) return false;
    if (!state.showPast && s.date < todayIso) return false;
    return true;
  });
  const hiddenPastCount = state.shows.filter((s) => inViewIds.has(s.artist_id) && s.date < todayIso).length;

  if (visibleShows.length === 0) {
    container.innerHTML = `<div class="dash-empty">No upcoming shows. ${hiddenPastCount} past show${hiddenPastCount === 1 ? "" : "s"} hidden — check "Show past shows" above to see them.</div>`;
    updateBulkBar();
    return;
  }

  const byArtist = new Map();
  for (const show of visibleShows) {
    if (!byArtist.has(show.artist_id)) byArtist.set(show.artist_id, []);
    byArtist.get(show.artist_id).push(show);
  }

  container.innerHTML = "";
  for (const artist of artistsInView) {
    const shows = byArtist.get(artist.artist_id) || [];
    if (shows.length === 0) continue;

    const group = document.createElement("details");
    group.className = "dash-artist-group";
    group.dataset.artistId = artist.artist_id;
    group.open = !collapsedArtists.has(artist.artist_id);
    group.addEventListener("toggle", () => {
      if (group.open) collapsedArtists.delete(artist.artist_id);
      else collapsedArtists.add(artist.artist_id);
    });

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <input type="checkbox" class="artist-select-all" style="width:auto;margin-right:var(--space-2);">
      ${escapeHtml(artist.name)} <span class="dash-artist-count">${shows.length}</span>
    `;
    group.appendChild(summary);

    const rowEls = shows.map((show) => {
      const row = renderShowRow(show, artist);
      group.appendChild(row);
      return row;
    });

    const selectAllBox = summary.querySelector(".artist-select-all");
    const selectedCount = shows.filter((s) => selectedShowIds.has(s.show_id)).length;
    selectAllBox.checked = selectedCount > 0 && selectedCount === shows.length;
    selectAllBox.indeterminate = selectedCount > 0 && selectedCount < shows.length;
    selectAllBox.addEventListener("click", (e) => e.stopPropagation());
    selectAllBox.addEventListener("change", () => {
      shows.forEach((s) => {
        if (selectAllBox.checked) selectedShowIds.add(s.show_id);
        else selectedShowIds.delete(s.show_id);
      });
      rowEls.forEach((row) => {
        row.querySelector(".show-select").checked = selectAllBox.checked;
      });
      selectAllBox.indeterminate = false;
      updateBulkBar();
    });

    container.appendChild(group);
  }
  updateBulkBar();
}

function renderShowRow(show, artist) {
  const row = document.createElement("div");
  row.className = "dash-show-row" + (show.status === "cancelled" ? " cancelled" : "");
  row.innerHTML = `
    <input type="checkbox" class="show-select" data-show-id="${escapeHtml(show.show_id)}" ${selectedShowIds.has(show.show_id) ? "checked" : ""} style="width:auto;flex-shrink:0;">
    <div class="show-main">
      <strong>${escapeHtml(show.date)}</strong> · ${escapeHtml(show.venue)} · ${escapeHtml(show.city)}${show.state_region ? ", " + escapeHtml(show.state_region) : ""}
      — ${escapeHtml(show.status)}
    </div>
    <div class="dash-row-actions">
      <button data-action="edit">Edit</button>
      ${show.status !== "cancelled" ? '<button data-action="cancel">Cancel</button>' : ""}
    </div>
  `;
  row.querySelector('[data-action="edit"]').addEventListener("click", () => openShowModal(show));
  const cancelBtn = row.querySelector('[data-action="cancel"]');
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => cancelShow(show));
  }
  row.querySelector(".show-select").addEventListener("change", (e) => {
    if (e.target.checked) selectedShowIds.add(show.show_id);
    else selectedShowIds.delete(show.show_id);
    updateBulkBar();
  });
  return row;
}

function updateBulkBar() {
  const bar = el("#bulk-bar");
  const count = selectedShowIds.size;
  bar.hidden = count === 0;
  if (count > 0) {
    el("#bulk-count").textContent = `${count} show${count === 1 ? "" : "s"} selected`;
  }
}

function wireBulkActions() {
  el("#bulk-clear-btn").addEventListener("click", () => {
    selectedShowIds.clear();
    renderShows();
  });
  el("#bulk-apply-btn").addEventListener("click", async () => {
    const status = el("#bulk-status-select").value;
    const ids = [...selectedShowIds];
    if (ids.length === 0) return;
    if (!confirm(`Set ${ids.length} show(s) to "${status}"?`)) return;
    const { error } = await supabase.from("shows").update({ status }).in("show_id", ids);
    if (error) {
      alert(error.message);
      return;
    }
    selectedShowIds.clear();
    await loadArtistsAndShows();
    renderShows();
  });
}

async function cancelShow(show) {
  if (!confirm(`Mark this ${show.venue} show as cancelled?`)) return;
  const { error } = await supabase
    .from("shows")
    .update({ status: "cancelled" })
    .eq("show_id", show.show_id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadArtistsAndShows();
  renderShows();
}

// ---------- Quick add (text parsing) ----------
//
// Client-side only, no LLM call — regex + matching against the artist
// list you already have loaded. Fills in what it's confident about
// (artist, date, venue) and leaves the rest for you to complete in the
// normal form. Won't guess at city/state/country since getting those
// wrong silently is worse than leaving them blank.

const MONTH_NAMES = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function normalizeYear(y) {
  const n = Number(y);
  if (y.length === 4) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

function toIso(year, monthIndex, day) {
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function extractDate(text) {
  // M/D/YY or M/D/YYYY
  let m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    const [, mo, day, yr] = m;
    return { date: toIso(normalizeYear(yr), Number(mo) - 1, Number(day)), match: m[0] };
  }
  // Month D, YYYY  (e.g. "March 11 2027", "Mar. 11th, 2027")
  const monthPattern = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
  m = text.match(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"));
  if (m) {
    const monthIdx = MONTH_NAMES[m[1].toLowerCase()];
    return { date: toIso(Number(m[3]), monthIdx, Number(m[2])), match: m[0] };
  }
  // D Month YYYY (e.g. "11 March 2027")
  m = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthPattern}\\s*,?\\s+(\\d{4})\\b`, "i"));
  if (m) {
    const monthIdx = MONTH_NAMES[m[2].toLowerCase()];
    return { date: toIso(Number(m[3]), monthIdx, Number(m[1])), match: m[0] };
  }
  // Month D, no year (e.g. "Thu, Oct 1") — tour sheets often drop the year.
  // Assume the nearest occurrence that isn't more than ~6mo in the past,
  // so pasting in Dec for a Jan show still lands on next year.
  m = text.match(new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));
  if (m) {
    const monthIdx = MONTH_NAMES[m[1].toLowerCase()];
    const day = Number(m[2]);
    return { date: toIso(nearestYear(monthIdx, day), monthIdx, day), match: m[0] };
  }
  return null;
}

function nearestYear(monthIdx, day) {
  const now = new Date();
  let year = now.getFullYear();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 6);
  if (new Date(year, monthIdx, day) < cutoff) year += 1;
  return year;
}

function extractArtist(text) {
  const lower = text.toLowerCase();
  let best = null;
  for (const artist of state.artists) {
    const name = artist.name.toLowerCase();
    const idx = lower.indexOf(name);
    if (idx === -1) continue;
    // whole-word-ish check: not preceded/followed by a letter
    const before = idx === 0 ? " " : lower[idx - 1];
    const after = lower[idx + name.length] || " ";
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
    if (!best || name.length > best.name.length) {
      best = { artist, name, index: idx };
    }
  }
  return best;
}

const US_STATE_ABBR = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
]);

function extractCityState(text) {
  // "City, ST" — a capitalized word (or a few) followed by a comma and a
  // real two-letter state code. Checked against a real abbreviation list
  // so we don't mistake "Thrice, TX" false positives from random caps.
  const re = /\b([A-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*){0,2}),\s*([A-Z]{2})\b/g;
  for (const m of text.matchAll(re)) {
    if (US_STATE_ABBR.has(m[2])) {
      return { city: m[1].trim(), state: m[2], match: m[0] };
    }
  }
  return null;
}

function extractVenue(text, dateMatch, cityStateMatch, artistMatch) {
  let working = text;
  if (artistMatch) working = working.slice(artistMatch.index + artistMatch.name.length);
  if (dateMatch) working = working.split(dateMatch).join(" ");
  if (cityStateMatch) working = working.split(cityStateMatch).join(" ");
  working = working.replace(/\(\s*\)/g, " ").trim();

  // Prefer explicit "at <venue>" or "@ <venue>" phrasing.
  const atMatch = working.match(/(?:\bat\b|@)\s+([^,–—-]+)/i);
  if (atMatch) {
    const venue = atMatch[1].replace(/\b(on|for|tickets?)\b.*$/i, "").trim().replace(/[.,]+$/, "");
    if (venue) return venue;
  }

  // Fall back to dash-separated listings, e.g. "Artist - Venue - City, ST - Date".
  const parts = working.split(/[-–—]/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const cleaned = part
      .replace(/^@\s*/, "")
      .replace(/\b(show|tour|tickets?|doors?|on sale)\b/gi, "")
      .replace(/[()]/g, "")
      .replace(/^[.,\s]+|[.,\s]+$/g, "")
      .trim();
    if (cleaned.length > 2) return cleaned;
  }
  return null;
}

function parseTabColumns(text) {
  // Spreadsheet-style paste: date / venue / city / state as their own
  // tab-separated columns, in any order. Find each by content rather than
  // position so column order doesn't matter.
  const cols = text.split("\t").map((s) => s.trim()).filter(Boolean);
  if (cols.length < 3) return null;

  let dateIdx = -1;
  let dateResult = null;
  for (let i = 0; i < cols.length; i++) {
    const d = extractDate(cols[i]);
    if (d) {
      dateIdx = i;
      dateResult = d;
      break;
    }
  }

  let stateIdx = -1;
  for (let i = cols.length - 1; i >= 0; i--) {
    if (i === dateIdx) continue;
    if (/^[A-Z]{2}$/.test(cols[i]) && US_STATE_ABBR.has(cols[i])) {
      stateIdx = i;
      break;
    }
  }

  let cityIdx = -1;
  for (let i = stateIdx - 1; i >= 0; i--) {
    if (i === dateIdx) continue;
    cityIdx = i;
    break;
  }

  const artistResult = extractArtist(text);
  let artistIdx = -1;
  if (artistResult) {
    cols.forEach((c, i) => {
      if (c.toLowerCase() === artistResult.name) artistIdx = i;
    });
  }

  const usedIdx = new Set([dateIdx, stateIdx, cityIdx, artistIdx].filter((i) => i >= 0));
  const venue = cols.filter((_, i) => !usedIdx.has(i)).join(" ").trim();

  return {
    artist_id: artistResult?.artist.artist_id || "",
    artistName: artistResult?.artist.name || "",
    date: dateResult?.date || "",
    venue: venue || "",
    city: cityIdx >= 0 ? cols[cityIdx] : "",
    state_region: stateIdx >= 0 ? cols[stateIdx] : "",
  };
}

function parseShowText(text) {
  if (text.includes("\t")) {
    const tabParsed = parseTabColumns(text);
    if (tabParsed) return tabParsed;
  }

  const dateResult = extractDate(text);
  const artistResult = extractArtist(text);
  const cityStateResult = extractCityState(text);
  const venue = extractVenue(text, dateResult?.match, cityStateResult?.match, artistResult);

  return {
    artist_id: artistResult?.artist.artist_id || "",
    artistName: artistResult?.artist.name || "",
    date: dateResult?.date || "",
    venue: venue || "",
    city: cityStateResult?.city || "",
    state_region: cityStateResult?.state || "",
  };
}

let quickAddRows = [];
let quickAddRowSeq = 0;

function quickAddRowReady(row) {
  return Boolean(row.artist_id && row.date && row.venue.trim() && row.city.trim());
}

function renderQuickAddPreview() {
  const container = el("#quick-add-preview");
  if (quickAddRows.length === 0) {
    container.innerHTML = "";
    return;
  }

  const readyCount = quickAddRows.filter(quickAddRowReady).length;

  const rowsHtml = quickAddRows
    .map((row) => {
      const artistOptions = state.artists
        .map(
          (a) =>
            `<option value="${escapeHtml(a.artist_id)}" ${a.artist_id === row.artist_id ? "selected" : ""}>${escapeHtml(a.name)}</option>`
        )
        .join("");
      return `
        <div class="quick-add-preview-row" data-row-id="${row.id}" title="${escapeHtml(row.raw)}">
          <select data-field="artist_id" class="${row.artist_id ? "" : "missing"}">
            <option value="">— pick artist —</option>
            ${artistOptions}
          </select>
          <input type="date" data-field="date" value="${escapeHtml(row.date)}" class="${row.date ? "" : "missing"}">
          <input type="text" data-field="venue" placeholder="Venue" value="${escapeHtml(row.venue)}" class="${row.venue.trim() ? "" : "missing"}">
          <input type="text" data-field="city" placeholder="City" value="${escapeHtml(row.city)}" class="${row.city.trim() ? "" : "missing"}">
          <input type="text" data-field="state_region" placeholder="State">
          <button type="button" class="quick-add-remove-row qa-remove" title="Remove">✕</button>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="quick-add-preview-head">
      <span>Artist</span><span>Date</span><span>Venue</span><span>City</span><span>State</span><span></span>
    </div>
    ${rowsHtml}
    <div class="quick-add-actions">
      <button class="btn btn-primary" id="quick-add-submit" type="button" ${readyCount === 0 ? "disabled" : ""}>
        Add ${readyCount} show${readyCount === 1 ? "" : "s"}
      </button>
      <p class="field-hint">${quickAddRows.length - readyCount} row(s) still need artist / date / venue / city filled in.</p>
    </div>
  `;

  container.querySelectorAll(".quick-add-preview-row").forEach((rowEl) => {
    const rowId = Number(rowEl.dataset.rowId);
    rowEl.querySelectorAll("[data-field]").forEach((fieldEl) => {
      fieldEl.addEventListener("change", () => {
        const row = quickAddRows.find((r) => r.id === rowId);
        if (row) row[fieldEl.dataset.field] = fieldEl.value;
        renderQuickAddPreview();
      });
    });
    rowEl.querySelector(".quick-add-remove-row").addEventListener("click", () => {
      quickAddRows = quickAddRows.filter((r) => r.id !== rowId);
      renderQuickAddPreview();
    });
  });

  const submitBtn = el("#quick-add-submit");
  if (submitBtn) submitBtn.addEventListener("click", submitQuickAddRows);
}

async function submitQuickAddRows() {
  const ready = quickAddRows.filter(quickAddRowReady);
  if (ready.length === 0) return;

  const submitBtn = el("#quick-add-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Adding…";

  const payload = ready.map((row) => ({
    artist_id: row.artist_id,
    date: row.date,
    venue: row.venue.trim(),
    city: row.city.trim(),
    state_region: row.state_region.trim() || null,
    country: "USA",
    status: "confirmed",
  }));

  const { error } = await supabase.from("shows").insert(payload);
  if (error) {
    alert(error.message);
    submitBtn.disabled = false;
    submitBtn.textContent = `Add ${ready.length} shows`;
    return;
  }

  const readyIds = new Set(ready.map((r) => r.id));
  quickAddRows = quickAddRows.filter((r) => !readyIds.has(r.id));
  await loadArtistsAndShows();
  renderShows();
  renderQuickAddPreview();
}

function populateQuickAddArtistSelect() {
  const select = el("#quick-add-artist");
  if (!select) return;
  const current = select.value;
  select.innerHTML =
    '<option value="">— detect per line / pick per row —</option>' +
    state.artists
      .map((a) => `<option value="${escapeHtml(a.artist_id)}">${escapeHtml(a.name)}</option>`)
      .join("");
  select.value = current;
}

function wireQuickAdd() {
  const textarea = el("#quick-add-input");
  const btn = el("#quick-add-btn");
  const artistSelect = el("#quick-add-artist");

  btn.addEventListener("click", () => {
    const lines = textarea.value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    const forcedArtistId = artistSelect.value;

    const newRows = lines.map((line) => {
      const parsed = parseShowText(line);
      quickAddRowSeq += 1;
      return {
        id: quickAddRowSeq,
        raw: line,
        artist_id: parsed.artist_id || forcedArtistId || "",
        date: parsed.date,
        venue: parsed.venue,
        city: parsed.city,
        state_region: parsed.state_region,
      };
    });
    quickAddRows = quickAddRows.concat(newRows);
    textarea.value = "";
    renderQuickAddPreview();
  });
}

function wireShowModal() {
  const overlay = el("#show-modal-overlay");
  const form = el("#show-form");
  const artistSelect = el("#show-artist");

  el("#add-show-btn").addEventListener("click", () => openShowModal(null));
  el("#show-cancel-btn").addEventListener("click", () => (overlay.hidden = true));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageEl = el("#show-form-message");
    messageEl.innerHTML = "";

    const payload = {
      artist_id: artistSelect.value,
      date: el("#show-date").value,
      time: el("#show-time").value || null,
      venue: el("#show-venue").value,
      city: el("#show-city").value,
      state_region: el("#show-state").value || null,
      country: el("#show-country").value || "USA",
      status: el("#show-status").value,
      tour_name: el("#show-tour").value || null,
      ticket_link: el("#show-ticket").value || null,
      notes: el("#show-notes").value || null,
    };

    const showId = el("#show-id").value;
    const saveBtn = el("#show-save-btn");
    saveBtn.disabled = true;
    try {
      const { error } = showId
        ? await supabase.from("shows").update(payload).eq("show_id", showId)
        : await supabase.from("shows").insert(payload);
      if (error) throw error;
      overlay.hidden = true;
      await loadArtistsAndShows();
      renderShows();
    } catch (err) {
      messageEl.innerHTML = `<p class="field-error">${escapeHtml(err.message)}</p>`;
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function openShowModal(show, prefill) {
  const overlay = el("#show-modal-overlay");
  const artistSelect = el("#show-artist");
  const p = prefill || {};

  artistSelect.innerHTML = state.artists
    .map((a) => `<option value="${escapeHtml(a.artist_id)}">${escapeHtml(a.name)}</option>`)
    .join("");

  el("#show-modal-title").textContent = show ? "Edit show" : "Add show";
  el("#show-id").value = show ? show.show_id : "";
  artistSelect.value = show ? show.artist_id : p.artist_id || state.artists[0]?.artist_id || "";
  el("#show-date").value = show ? show.date : p.date || "";
  el("#show-time").value = show ? show.time || "" : "";
  el("#show-venue").value = show ? show.venue : p.venue || "";
  el("#show-city").value = show ? show.city : p.city || "";
  el("#show-state").value = show ? show.state_region || "" : "";
  el("#show-country").value = show ? show.country || "USA" : "USA";
  el("#show-status").value = show ? show.status : "confirmed";
  el("#show-tour").value = show ? show.tour_name || "" : "";
  el("#show-ticket").value = show ? show.ticket_link || "" : "";
  el("#show-notes").value = show ? show.notes || "" : "";
  el("#show-form-message").innerHTML = "";

  overlay.hidden = false;
}

// ---------- Artists (admin only) ----------

function renderArtists() {
  const container = el("#artists-list");
  if (state.artists.length === 0) {
    container.innerHTML = '<div class="dash-empty">No artists yet.</div>';
    return;
  }
  container.innerHTML = "";
  state.artists.forEach((artist) => {
    const row = document.createElement("div");
    row.className = "dash-show-row";
    row.innerHTML = `
      <div class="show-main">
        <strong>${escapeHtml(artist.name)}</strong> · ${escapeHtml(artist.publicist_name)} (${escapeHtml(artist.publicist_email)})
        ${artist.active ? "" : " · inactive"}
      </div>
      <div class="dash-row-actions">
        <button data-action="edit">Edit</button>
        <button data-action="delete">Delete</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => openArtistModal(artist));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteArtist(artist));
    container.appendChild(row);
  });
}

async function deleteArtist(artist) {
  const showCount = state.shows.filter((s) => s.artist_id === artist.artist_id).length;
  const warning = showCount
    ? `Delete ${artist.name} and their ${showCount} show${showCount === 1 ? "" : "s"}? This can't be undone.`
    : `Delete ${artist.name}? This can't be undone.`;
  if (!confirm(warning)) return;

  const { error: showsError } = await supabase.from("shows").delete().eq("artist_id", artist.artist_id);
  if (showsError) {
    alert(showsError.message);
    return;
  }
  const { error } = await supabase.from("artists").delete().eq("artist_id", artist.artist_id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadArtistsAndShows();
  renderArtists();
  renderShows();
  populateQuickAddArtistSelect();
}

async function getDistinctPublicists() {
  // Reads the standalone publicists table, not just whoever already
  // owns an artist — so a publicist can be picked here before they
  // have any artists assigned.
  const { data } = await supabase.from("publicists").select("*").order("name");
  return data || [];
}

function applyPublicistSelection() {
  const select = el("#artist-publicist-select");
  const newFields = el("#artist-publicist-new-fields");
  const nameInput = el("#artist-publicist-name");
  const emailInput = el("#artist-publicist-email");

  if (select.value === "__new__") {
    newFields.hidden = false;
    nameInput.value = "";
    emailInput.value = "";
    return;
  }
  newFields.hidden = true;
  const [email, name] = select.value.split("::");
  nameInput.value = name;
  emailInput.value = email;
}

function wireArtistModal() {
  const overlay = el("#artist-modal-overlay");
  const form = el("#artist-form");
  const publicistSelect = el("#artist-publicist-select");

  publicistSelect.addEventListener("change", applyPublicistSelection);

  el("#add-artist-btn").addEventListener("click", () => openArtistModal(null));
  el("#artist-cancel-btn").addEventListener("click", () => (overlay.hidden = true));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageEl = el("#artist-form-message");
    messageEl.innerHTML = "";

    const originalId = el("#artist-original-id").value;
    const payload = {
      artist_id: el("#artist-id").value.trim(),
      name: el("#artist-name").value.trim(),
      publicist_name: el("#artist-publicist-name").value.trim(),
      publicist_email: el("#artist-publicist-email").value.trim(),
      genre: el("#artist-genre").value.trim() || null,
      active: el("#artist-active").checked,
    };

    try {
      // Keep the standalone publicists table in sync so a brand-new
      // publicist typed here (rather than picked from the dropdown)
      // shows up as a known publicist everywhere else too.
      await supabase
        .from("publicists")
        .upsert({ email: payload.publicist_email, name: payload.publicist_name }, { onConflict: "email" });

      const { error } = originalId
        ? await supabase.from("artists").update(payload).eq("artist_id", originalId)
        : await supabase.from("artists").insert(payload);
      if (error) throw error;
      overlay.hidden = true;
      await loadArtistsAndShows();
      renderArtists();
      renderShows();
      populateQuickAddArtistSelect();
    } catch (err) {
      messageEl.innerHTML = `<p class="field-error">${escapeHtml(err.message)}</p>`;
    }
  });
}

async function openArtistModal(artist) {
  const overlay = el("#artist-modal-overlay");
  const select = el("#artist-publicist-select");

  const publicists = await getDistinctPublicists();
  select.innerHTML =
    publicists
      .map((p) => `<option value="${escapeHtml(p.email)}::${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`)
      .join("") + `<option value="__new__">+ New publicist…</option>`;

  el("#artist-modal-title").textContent = artist ? "Edit artist" : "Add artist";
  el("#artist-original-id").value = artist ? artist.artist_id : "";
  el("#artist-id").value = artist ? artist.artist_id : "";
  el("#artist-id").disabled = Boolean(artist);
  el("#artist-name").value = artist ? artist.name : "";
  el("#artist-genre").value = artist ? artist.genre || "" : "";
  el("#artist-active").checked = artist ? artist.active : true;
  el("#artist-form-message").innerHTML = "";

  const existingMatch = artist
    ? publicists.find((p) => p.email === artist.publicist_email)
    : null;
  if (existingMatch) {
    select.value = `${existingMatch.email}::${existingMatch.name}`;
  } else {
    select.value = "__new__";
  }
  applyPublicistSelection();
  if (!existingMatch && artist) {
    // Editing an artist whose publicist isn't in the distinct list for
    // some reason (shouldn't normally happen) — keep their real values.
    el("#artist-publicist-name").value = artist.publicist_name;
    el("#artist-publicist-email").value = artist.publicist_email;
  }

  overlay.hidden = false;
}

// ---------- People (Natalie only) ----------

async function renderPeople() {
  const container = el("#people-list");
  const [{ data: publicists }, { data: admins }] = await Promise.all([
    supabase.from("publicists").select("*").order("name"),
    supabase.from("admin_emails").select("email"),
  ]);
  const adminEmails = new Set((admins || []).map((a) => a.email));

  if (!publicists || publicists.length === 0) {
    container.innerHTML = '<div class="dash-empty">No one added yet.</div>';
    return;
  }

  container.innerHTML = "";
  publicists.forEach((p) => {
    const isAdminPerson = adminEmails.has(p.email);
    const row = document.createElement("div");
    row.className = "dash-show-row";
    row.innerHTML = `
      <div class="show-main">
        <strong>${escapeHtml(p.name)}</strong> · ${escapeHtml(p.email)}
        ${isAdminPerson ? ' · <span class="status-tag confirmed" style="padding:2px 8px;font-size:9px;">ADMIN</span>' : ""}
      </div>
      <div class="dash-row-actions">
        <button data-action="toggle-admin">${isAdminPerson ? "Remove admin" : "Make admin"}</button>
      </div>
    `;
    row.querySelector('[data-action="toggle-admin"]').addEventListener("click", async () => {
      if (p.email === state.user.email) {
        alert("You can't change your own admin status here.");
        return;
      }
      const { error } = isAdminPerson
        ? await supabase.from("admin_emails").delete().eq("email", p.email)
        : await supabase.from("admin_emails").insert({ email: p.email });
      if (error) {
        alert(error.message);
        return;
      }
      renderPeople();
    });
    container.appendChild(row);
  });
}

function wirePersonModal() {
  const overlay = el("#person-modal-overlay");
  const form = el("#person-form");

  el("#add-person-btn").addEventListener("click", () => {
    form.reset();
    el("#person-form-message").innerHTML = "";
    overlay.hidden = false;
  });
  el("#person-cancel-btn").addEventListener("click", () => (overlay.hidden = true));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageEl = el("#person-form-message");
    messageEl.innerHTML = "";

    const name = el("#person-name").value.trim();
    const email = el("#person-email").value.trim();
    const makeAdmin = el("#person-admin").checked;

    try {
      const { error: pErr } = await supabase
        .from("publicists")
        .upsert({ email, name }, { onConflict: "email" });
      if (pErr) throw pErr;

      if (makeAdmin) {
        const { error: aErr } = await supabase.from("admin_emails").insert({ email });
        if (aErr) throw aErr;
      }

      overlay.hidden = true;
      renderPeople();
    } catch (err) {
      messageEl.innerHTML = `<p class="field-error">${escapeHtml(err.message)}</p>`;
    }
  });
}

init().catch((err) => {
  el("#loading").textContent = "Error loading dashboard: " + err.message;
  el("#loading").hidden = false;
});
