import { supabase, configured } from "./lib/supabase-client.js?v=10";

(function () {
  "use strict";

  const state = {
    artists: [],
    shows: [],
    view: "month",
    time: "upcoming",
    filters: { publicist: new Set(), artist: new Set(), city: new Set() },
    monthCursor: startOfMonth(new Date()),
  };

  const el = (sel) => document.querySelector(sel);
  const els = (sel) => Array.from(document.querySelectorAll(sel));

  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  async function loadData() {
    if (configured) {
      const [artistsRes, showsRes] = await Promise.all([
        supabase.from("artists").select("*").eq("active", true),
        supabase.from("shows").select("*").order("date"),
      ]);
      if (artistsRes.error) throw artistsRes.error;
      if (showsRes.error) throw showsRes.error;
      state.artists = artistsRes.data.map((a) => ({ ...a, publicist: a.publicist_name }));
      state.shows = showsRes.data;
      return;
    }
    // Fallback while Supabase isn't configured yet (see lib/config.js).
    const [artistsRes, showsRes] = await Promise.all([
      fetch("data/artists.json"),
      fetch("data/shows.json"),
    ]);
    state.artists = await artistsRes.json();
    state.shows = await showsRes.json();
  }

  function artistById(id) { return state.artists.find((a) => a.artist_id === id); }

  function enrichedShows() {
    return state.shows.map((s) => {
      const artist = artistById(s.artist_id);
      return { ...s, artistName: artist ? artist.name : "Unknown Artist", publicist: artist ? artist.publicist : "" };
    });
  }

  function applyFilters(shows) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return shows.filter((s) => {
      const d = fmtDate(s.date);
      if (state.time === "upcoming" && d < today) return false;
      if (state.time === "past" && d >= today) return false;
      if (state.filters.publicist.size && !state.filters.publicist.has(s.publicist)) return false;
      if (state.filters.artist.size && !state.filters.artist.has(s.artist_id)) return false;
      if (state.filters.city.size && !state.filters.city.has(s.city)) return false;
      return true;
    });
  }

  function uniqueSorted(arr) { return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b)); }

  // ---------- Filter panels ----------

  function buildFilterOptions() {
    const publicists = uniqueSorted(state.artists.map((a) => a.publicist).filter(Boolean));
    const cities = uniqueSorted(state.shows.map((s) => s.city).filter(Boolean));
    const artists = state.artists.slice().sort((a, b) => a.name.localeCompare(b.name));

    renderOptionList("publicist", publicists.map((p) => ({ value: p, label: p })));
    renderOptionList("city", cities.map((c) => ({ value: c, label: c })));
    renderArtistOptions(artists);
  }

  function renderOptionList(key, items) {
    const panel = el(`[data-panel="${key}"]`);
    panel.innerHTML = "";
    if (!items.length) {
      panel.innerHTML = '<p style="font-size:13px;color:#999;margin:4px;">None available</p>';
      return;
    }
    items.forEach((item) => {
      const label = document.createElement("label");
      label.className = "filter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = item.value;
      checkbox.checked = state.filters[key].has(item.value);
      checkbox.addEventListener("change", () => {
        toggleFilter(key, item.value, checkbox.checked);
      });
      const span = document.createElement("span");
      span.textContent = item.label;
      label.appendChild(checkbox);
      label.appendChild(span);
      panel.appendChild(label);
    });
  }

  function renderArtistOptions(artists, query) {
    const container = el('[data-options="artist"]');
    container.innerHTML = "";
    const q = (query || "").toLowerCase();
    const filtered = artists.filter((a) => a.name.toLowerCase().includes(q));
    if (!filtered.length) {
      container.innerHTML = '<p style="font-size:13px;color:#999;margin:4px;">No matches</p>';
      return;
    }
    filtered.forEach((a) => {
      const label = document.createElement("label");
      label.className = "filter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = a.artist_id;
      checkbox.checked = state.filters.artist.has(a.artist_id);
      checkbox.addEventListener("change", () => {
        toggleFilter("artist", a.artist_id, checkbox.checked);
      });
      const span = document.createElement("span");
      span.textContent = a.name;
      label.appendChild(checkbox);
      label.appendChild(span);
      container.appendChild(label);
    });
  }

  function toggleFilter(key, value, on) {
    if (on) state.filters[key].add(value);
    else state.filters[key].delete(value);
    if (key === "artist" && !state.filters.artist.size && state.view === "month" && !anyFilterActive()) {
      // no-op placeholder for readability
    }
    updateFilterUI();
    autoSwitchViewOnFilter();
    render();
  }

  function anyFilterActive() {
    return state.filters.publicist.size || state.filters.artist.size || state.filters.city.size;
  }

  function autoSwitchViewOnFilter() {
    if (anyFilterActive() && state.view === "month" && !state._userPickedView) {
      state.view = "list";
      els(".view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === "list"));
    }
  }

  function updateFilterUI() {
    ["publicist", "artist", "city"].forEach((key) => {
      const count = state.filters[key].size;
      const badge = el(`[data-count="${key}"]`);
      const toggleBtn = el(`.filter-toggle[data-filter="${key}"]`);
      badge.hidden = count === 0;
      badge.textContent = String(count);
      toggleBtn.classList.toggle("has-active", count > 0);
    });
    el("#clear-filters").hidden = !anyFilterActive();
    renderActiveChips();
  }

  function renderActiveChips() {
    const wrap = el("#active-chips");
    wrap.innerHTML = "";
    const chips = [];
    state.filters.publicist.forEach((v) => chips.push({ key: "publicist", value: v, label: `Publicist: ${v}` }));
    state.filters.artist.forEach((v) => {
      const a = artistById(v);
      chips.push({ key: "artist", value: v, label: `Artist: ${a ? a.name : v}` });
    });
    state.filters.city.forEach((v) => chips.push({ key: "city", value: v, label: `City: ${v}` }));

    wrap.hidden = chips.length === 0;
    chips.forEach((c) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `${escapeHtml(c.label)} <button aria-label="Remove filter">&times;</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        state.filters[c.key].delete(c.value);
        updateFilterUI();
        rebuildCheckboxes();
        render();
      });
      wrap.appendChild(chip);
    });
  }

  function rebuildCheckboxes() {
    buildFilterOptions();
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ---------- Rendering ----------

  function render() {
    const filtered = applyFilters(enrichedShows()).sort((a, b) => a.date.localeCompare(b.date));
    const root = el("#view-root");
    const empty = el("#empty-state");
    const monthNav = el("#month-nav");

    if (state.view === "month") {
      monthNav.hidden = false;
      renderMonth(filtered, root);
      empty.hidden = true;
    } else {
      monthNav.hidden = true;
      if (!filtered.length) {
        root.innerHTML = "";
        empty.hidden = false;
      } else {
        empty.hidden = true;
        renderList(filtered, root);
      }
    }
  }

  function renderMonth(shows, root) {
    const cursor = state.monthCursor;
    el("#month-label").textContent = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = firstDay.getDay();
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - startOffset);

    const today = new Date();

    const grid = document.createElement("div");
    grid.className = "month-grid";
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => {
      const dow = document.createElement("div");
      dow.className = "dow";
      dow.textContent = d;
      grid.appendChild(dow);
    });

    const showsByDate = {};
    shows.forEach((s) => {
      showsByDate[s.date] = showsByDate[s.date] || [];
      showsByDate[s.date].push(s);
    });

    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);
      const cell = document.createElement("div");
      cell.className = "day-cell";
      if (cellDate.getMonth() !== cursor.getMonth()) cell.classList.add("other-month");
      if (isSameDay(cellDate, today)) cell.classList.add("today");

      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = String(cellDate.getDate());
      cell.appendChild(num);

      const iso = toIso(cellDate);
      (showsByDate[iso] || []).forEach((s) => {
        const pill = document.createElement("div");
        pill.className = `show-pill status-${s.status}`;
        pill.textContent = `${s.artistName} · ${s.city}`;
        pill.title = `${s.artistName} — ${s.venue}, ${s.city}`;
        pill.addEventListener("click", () => openDetail(s));
        cell.appendChild(pill);
      });

      grid.appendChild(cell);
    }

    root.innerHTML = "";
    root.appendChild(grid);
  }

  function toIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function renderList(shows, root) {
    const list = document.createElement("div");
    list.className = "show-list";
    shows.forEach((s) => {
      const d = fmtDate(s.date);
      const row = document.createElement("div");
      row.className = `list-row status-${s.status}`;
      row.innerHTML = `
        <div class="list-date">
          <span class="dow-label">${d.toLocaleDateString(undefined, { weekday: "short" })}</span>
          ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </div>
        <div class="list-main">
          <div class="list-artist">${escapeHtml(s.artistName)}</div>
          <div class="list-venue">${escapeHtml(s.venue)} · ${escapeHtml(s.city)}${s.state_region ? ", " + escapeHtml(s.state_region) : ""}</div>
        </div>
        <span class="status-tag ${s.status}">${s.status}</span>
      `;
      row.addEventListener("click", () => openDetail(s));
      list.appendChild(row);
    });
    root.innerHTML = "";
    root.appendChild(list);
  }

  function openDetail(s) {
    const d = fmtDate(s.date);
    const content = el("#detail-content");
    content.innerHTML = `
      <h3 id="detail-title">${escapeHtml(s.artistName)}</h3>
      <div class="detail-sub">${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${s.time ? " · " + escapeHtml(s.time) : ""}</div>
      <div class="detail-row"><strong>Venue</strong>${escapeHtml(s.venue)}</div>
      <div class="detail-row"><strong>City</strong>${escapeHtml(s.city)}${s.state_region ? ", " + escapeHtml(s.state_region) : ""} · ${escapeHtml(s.country)}</div>
      <div class="detail-row"><strong>Status</strong>${escapeHtml(s.status)}</div>
      ${s.tour_name ? `<div class="detail-row"><strong>Tour</strong>${escapeHtml(s.tour_name)}</div>` : ""}
      ${s.ticket_link ? `<div class="detail-row"><strong>Tickets</strong><a href="${escapeHtml(s.ticket_link)}" target="_blank" rel="noopener">${escapeHtml(s.ticket_link)}</a></div>` : ""}
      ${s.notes ? `<div class="detail-row"><strong>Notes</strong>${escapeHtml(s.notes)}</div>` : ""}
      <div class="detail-row"><strong>Publicist</strong>${escapeHtml(s.publicist || "—")}</div>
    `;
    el("#detail-overlay").hidden = false;
  }

  // ---------- Event wiring ----------

  function wireFilterToggles() {
    els(".filter-toggle").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = btn.dataset.filter;
        const panel = el(`[data-panel="${key}"]`);
        const isOpen = !panel.hidden;
        closeAllPanels();
        if (!isOpen) {
          panel.hidden = false;
          btn.setAttribute("aria-expanded", "true");
        }
      });
    });
    document.addEventListener("click", closeAllPanels);
    el(".filter-panel[data-panel='artist']").addEventListener("click", (e) => e.stopPropagation());
    els(".filter-panel").forEach((p) => p.addEventListener("click", (e) => e.stopPropagation()));
  }

  function closeAllPanels() {
    els(".filter-panel").forEach((p) => (p.hidden = true));
    els(".filter-toggle").forEach((b) => b.setAttribute("aria-expanded", "false"));
  }

  function wireArtistSearch() {
    const input = el(".artist-search");
    input.addEventListener("input", () => {
      const artists = state.artists.slice().sort((a, b) => a.name.localeCompare(b.name));
      renderArtistOptions(artists, input.value);
    });
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  function wireClearFilters() {
    el("#clear-filters").addEventListener("click", () => {
      state.filters.publicist.clear();
      state.filters.artist.clear();
      state.filters.city.clear();
      updateFilterUI();
      rebuildCheckboxes();
      render();
    });
  }

  function wireViewToggle() {
    els(".view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.view = btn.dataset.view;
        state._userPickedView = true;
        els(".view-btn").forEach((b) => b.classList.toggle("active", b === btn));
        render();
      });
    });
    els(".time-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.time = btn.dataset.time;
        els(".time-btn").forEach((b) => b.classList.toggle("active", b === btn));
        render();
      });
    });
  }

  function wireMonthNav() {
    el("#prev-month").addEventListener("click", () => {
      state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() - 1, 1);
      render();
    });
    el("#next-month").addEventListener("click", () => {
      state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() + 1, 1);
      render();
    });
  }

  function wireDetailOverlay() {
    el("#detail-close").addEventListener("click", () => (el("#detail-overlay").hidden = true));
    el("#detail-overlay").addEventListener("click", (e) => {
      if (e.target.id === "detail-overlay") el("#detail-overlay").hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") el("#detail-overlay").hidden = true;
    });
  }

  async function updateLoginLink() {
    const link = el("#publicist-login-link");
    if (!link || !configured) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      link.textContent = "Dashboard";
      link.href = "dashboard/";
    }
  }

  async function init() {
    await loadData();
    buildFilterOptions();
    wireFilterToggles();
    wireArtistSearch();
    wireClearFilters();
    wireViewToggle();
    wireMonthNav();
    wireDetailOverlay();
    render();
    updateLoginLink();
  }

  init();
})();
