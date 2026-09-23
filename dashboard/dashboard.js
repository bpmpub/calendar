import { supabase, configured } from "../lib/supabase-client.js?v=10";

const state = {
  user: null,
  isAdmin: false,
  artists: [],   // artists this user can manage
  shows: [],
  activeTab: "shows",
};

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

  if (state.isAdmin) el("#artists-tab-btn").hidden = false;

  await loadArtistsAndShows();
  wireTabs();
  wireShowModal();
  wireExpandCollapseAll();
  wireQuickAdd();
  wireArtistModal();
  wireLogout();
  wireAddPasskey();
  renderShows();
  if (state.isAdmin) renderArtists();

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
    });
  });
}

function wireLogout() {
  el("#logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    toLoginPage();
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
}

function renderShows() {
  const container = el("#shows-list");
  if (state.artists.length === 0) {
    container.innerHTML = '<div class="dash-empty">No artists assigned to your account yet.</div>';
    return;
  }
  if (state.shows.length === 0) {
    container.innerHTML = '<div class="dash-empty">No shows yet. Add the first one.</div>';
    return;
  }

  const byArtist = new Map();
  for (const show of state.shows) {
    if (!byArtist.has(show.artist_id)) byArtist.set(show.artist_id, []);
    byArtist.get(show.artist_id).push(show);
  }

  container.innerHTML = "";
  for (const artist of state.artists) {
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
    summary.innerHTML = `${escapeHtml(artist.name)} <span class="dash-artist-count">${shows.length}</span>`;
    group.appendChild(summary);

    shows.forEach((show) => group.appendChild(renderShowRow(show, artist)));
    container.appendChild(group);
  }
}

function renderShowRow(show, artist) {
  const row = document.createElement("div");
  row.className = "dash-show-row" + (show.status === "cancelled" ? " cancelled" : "");
  row.innerHTML = `
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
  return row;
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
  return null;
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

function extractVenue(text, dateMatch, artistMatch) {
  const atMatch = text.match(/\bat\s+(.+)/i);
  if (!atMatch) return null;
  let venue = atMatch[1];
  if (dateMatch) venue = venue.split(dateMatch)[0];
  venue = venue.replace(/\b(on|for|tickets?)\b.*$/i, "");
  venue = venue.replace(/[,\s]+$/, "").trim();
  return venue || null;
}

function parseShowText(text) {
  const dateResult = extractDate(text);
  const artistResult = extractArtist(text);
  const venue = extractVenue(text, dateResult?.match, artistResult);

  return {
    artist_id: artistResult?.artist.artist_id || "",
    artistName: artistResult?.artist.name || "",
    date: dateResult?.date || "",
    venue: venue || "",
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

function wireQuickAdd() {
  const textarea = el("#quick-add-input");
  const btn = el("#quick-add-btn");

  btn.addEventListener("click", () => {
    const lines = textarea.value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    const newRows = lines.map((line) => {
      const parsed = parseShowText(line);
      quickAddRowSeq += 1;
      return {
        id: quickAddRowSeq,
        raw: line,
        artist_id: parsed.artist_id,
        date: parsed.date,
        venue: parsed.venue,
        city: "",
        state_region: "",
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
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => openArtistModal(artist));
    container.appendChild(row);
  });
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

init().catch((err) => {
  el("#loading").textContent = "Error loading dashboard: " + err.message;
  el("#loading").hidden = false;
});
