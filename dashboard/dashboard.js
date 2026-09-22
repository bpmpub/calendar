import { supabase, configured } from "../lib/supabase-client.js";

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
  wireArtistModal();
  wireLogout();
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

// ---------- Shows ----------

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
    const group = document.createElement("div");
    group.className = "dash-artist-group";
    group.innerHTML = `<h3>${escapeHtml(artist.name)}</h3>`;
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

function openShowModal(show) {
  const overlay = el("#show-modal-overlay");
  const artistSelect = el("#show-artist");

  artistSelect.innerHTML = state.artists
    .map((a) => `<option value="${escapeHtml(a.artist_id)}">${escapeHtml(a.name)}</option>`)
    .join("");

  el("#show-modal-title").textContent = show ? "Edit show" : "Add show";
  el("#show-id").value = show ? show.show_id : "";
  artistSelect.value = show ? show.artist_id : state.artists[0]?.artist_id || "";
  el("#show-date").value = show ? show.date : "";
  el("#show-time").value = show ? show.time || "" : "";
  el("#show-venue").value = show ? show.venue : "";
  el("#show-city").value = show ? show.city : "";
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

function wireArtistModal() {
  const overlay = el("#artist-modal-overlay");
  const form = el("#artist-form");

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

function openArtistModal(artist) {
  const overlay = el("#artist-modal-overlay");
  el("#artist-modal-title").textContent = artist ? "Edit artist" : "Add artist";
  el("#artist-original-id").value = artist ? artist.artist_id : "";
  el("#artist-id").value = artist ? artist.artist_id : "";
  el("#artist-id").disabled = Boolean(artist);
  el("#artist-name").value = artist ? artist.name : "";
  el("#artist-publicist-name").value = artist ? artist.publicist_name : "";
  el("#artist-publicist-email").value = artist ? artist.publicist_email : "";
  el("#artist-genre").value = artist ? artist.genre || "" : "";
  el("#artist-active").checked = artist ? artist.active : true;
  el("#artist-form-message").innerHTML = "";
  overlay.hidden = false;
}

init().catch((err) => {
  el("#loading").textContent = "Error loading dashboard: " + err.message;
  el("#loading").hidden = false;
});
