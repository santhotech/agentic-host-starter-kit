import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

// ---------------------------------------------------------------- types & constants
type Hotel = {
  hotel_name: string; address: string; city: string; average_score: number; total_reviews: number;
  price_per_night: number | null; currency: string | null;
  lat: number | null; lng: number | null; pct_business: number | null; pct_couple: number | null;
  pct_solo_traveler: number | null; pct_family_with_young_children: number | null; pct_travelers_with_friends: number | null;
};
type Filters = { min_score: number; traveler_type: string | null; business_friendly: boolean; sort_by: "score" | "popularity" | "price"; max_price?: number | null };
type SearchResult = { city: string; filters: Filters; count: number; hotels: Hotel[] };
type Profile = {
  hotel_name: string; city: string; average_score: number; total_reviews: number;
  traveler_mix: Record<string, number>; popular_rooms: { room_type: string; stays: number }[];
  score_distribution: Record<string, number>; recent_positives: string[]; recent_negatives: string[];
  business_trip_share: number | null; error?: string;
};

const TRAVELERS: [string, string | null][] = [
  ["Any traveler", null], ["Couples", "Couple"], ["Solo", "Solo traveler"],
  ["Families", "Family with young children"], ["Friends", "Travelers with friends"], ["Groups", "Group"],
];
const CENTERS: Record<string, [number, number, string]> = {
  London: [51.5080, -0.1281, "Trafalgar Sq"], Paris: [48.8566, 2.3522, "Hôtel de Ville"],
  Amsterdam: [52.3731, 4.8926, "Dam Square"], Barcelona: [41.3870, 2.1701, "Pl. Catalunya"],
  Milan: [45.4642, 9.1900, "Duomo"], Vienna: [48.2085, 16.3731, "Stephansplatz"],
};
const MIX_COLORS: Record<string, string> = {
  "Couple": "#0e7c6b", "Solo traveler": "#e8a33d", "Family with young children": "#6d5bd0",
  "Family with older children": "#a78bfa", "Group": "#d9467a", "Travelers with friends": "#3b82c4",
};

// ---------------------------------------------------------------- state
const state = {
  city: "London",
  filters: { min_score: 0, traveler_type: null, business_friendly: false, sort_by: "score" } as Filters,
  hotels: [] as Hotel[],
  open: null as string | null,
  hl: null as string | null,
  profiles: new Map<string, Profile>(),
  shortlist: new Map<string, Hotel>(),
  seq: 0,
  showAll: false,
};

const app = new App({ name: "TravelCo Hotel Explorer", version: "1.0.0" });
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- helpers
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const pretty = (s: string) => s.replace(/\bH tel\b/g, "Hôtel").replace(/\bVend me\b/g, "Vendôme");
const pct = (x: number | null | undefined) => `${Math.round((x ?? 0) * 100)}%`;
const cap = (s: string) => { s = s.trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const money = (n: number | null | undefined, cur?: string | null) =>
  n == null ? "" : new Intl.NumberFormat("en-GB", { style: "currency", currency: cur || "EUR", maximumFractionDigits: 0 }).format(n);
const clip = (s: string, n = 130) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

function scoreLabel(s: number) {
  if (s >= 9.5) return "Exceptional"; if (s >= 9) return "Superb"; if (s >= 8.5) return "Excellent";
  if (s >= 8) return "Very good"; if (s >= 7) return "Good"; return "Okay";
}
function scoreColor(s: number) {
  if (s >= 9) return "#1f8a4c"; if (s >= 8.5) return "#0e7c6b"; if (s >= 8) return "#4c7a1f"; if (s >= 7) return "#b7791f"; return "#c2410c";
}
function street(h: Hotel) {
  const i = h.address.indexOf(` ${h.city}`);
  let s = i > 0 ? h.address.slice(0, i) : h.address;
  s = s.replace(/\s\d{4}\s?[A-Z]{2}$/, "").replace(/\s\d{4,5}$/, "");
  return pretty(s);
}
function kmFromCenter(h: Hotel) {
  const c = CENTERS[h.city];
  if (!c || h.lat == null || h.lng == null) return null;
  const R = 6371, toR = Math.PI / 180;
  const dLat = (h.lat - c[0]) * toR, dLng = (h.lng - c[1]) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(c[0] * toR) * Math.cos(h.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function travelerLabel(t: string | null) { return TRAVELERS.find(([, v]) => v === t)?.[0] ?? "Any traveler"; }

function data<T>(r: any): T {
  if (r?.isError) throw new Error(r.content?.[0]?.text ?? "Tool error");
  let sc = r?.structuredContent;
  if (sc && sc.result && !sc.hotels && !sc.hotel_name && !sc.reviews) sc = sc.result;
  if (!sc) {
    const t = r?.content?.find((c: any) => c.type === "text")?.text;
    sc = t ? JSON.parse(t) : {};
  }
  return sc as T;
}

let toastTimer: number | undefined;
function toast(msg: string) {
  let el = document.querySelector(".toast") as HTMLElement | null;
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el!.classList.remove("show"), 1800);
}

// ---------------------------------------------------------------- host theming
function applyHost(ctx: any) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  const modes: string[] = ctx.availableDisplayModes ?? [];
  const fs = $("fullscreen");
  fs.hidden = !modes.includes("fullscreen") || ctx.displayMode === "fullscreen";
}

// ---------------------------------------------------------------- filters UI
function renderFilters() {
  $("traveler").innerHTML = TRAVELERS.map(([label, v]) =>
    `<button class="chip ${state.filters.traveler_type === v ? "on" : ""}" role="radio" aria-checked="${state.filters.traveler_type === v}" data-v="${v ?? ""}">${label}</button>`).join("");
  const ms = Math.max(7, state.filters.min_score || 7);
  $<HTMLInputElement>("minScore").value = String(ms);
  $("minScoreVal").textContent = state.filters.min_score ? ms.toFixed(1) : "any";
  document.querySelectorAll<HTMLButtonElement>("#sort button").forEach((b) => b.classList.toggle("on", b.dataset.v === state.filters.sort_by));
  $<HTMLInputElement>("biz").checked = state.filters.business_friendly;
}

let refetchTimer: number | undefined;
function refilter(delay = 0) {
  clearTimeout(refetchTimer);
  refetchTimer = window.setTimeout(async () => {
    const mySeq = ++state.seq;
    $("list").classList.add("loading");
    try {
      // App -> host -> server. No model round-trip: this is instant UI navigation.
      const r = await app.callServerTool({
        name: "search_hotels",
        arguments: { city: state.city, ...state.filters, limit: 12 },
      });
      if (mySeq !== state.seq) return;
      applyResult(data<SearchResult>(r));
      syncModelContext();
    } catch (e) {
      toast("Couldn't refresh results");
      console.error(e);
    } finally {
      if (mySeq === state.seq) $("list").classList.remove("loading");
    }
  }, delay);
}

// ---------------------------------------------------------------- results
function applyResult(res: SearchResult, fromModel = false) {
  state.city = res.city ?? state.city;
  if (fromModel && res.filters) state.filters = { ...state.filters, ...res.filters };
  if (fromModel) state.showAll = false;
  state.hotels = res.hotels ?? [];
  if (state.open && !state.hotels.some((h) => h.hotel_name === state.open)) state.open = null;
  $("title").textContent = `Hotels in ${state.city}`;
  const sortTxt = { score: "top rated first", popularity: "most reviewed first", price: "lowest price first" }[state.filters.sort_by] ?? "";
  $("subtitle").textContent = `${state.hotels.length} matches · ${travelerLabel(state.filters.traveler_type).toLowerCase()} · ${sortTxt}`;
  renderFilters();
  renderList();
  renderMap();
}

function mixBar(h: Hotel) {
  const parts: [string, number | null][] = [
    ["Couple", h.pct_couple], ["Solo traveler", h.pct_solo_traveler],
    ["Family with young children", h.pct_family_with_young_children], ["Travelers with friends", h.pct_travelers_with_friends],
  ];
  return `<span class="mixbar" title="Who stays here">${parts.map(([k, v]) => `<i style="width:${pct(v)};background:${MIX_COLORS[k]}"></i>`).join("")}</span>`;
}

function renderList() {
  const list = $("list");
  if (!state.hotels.length) {
    list.innerHTML = `<li class="empty-state">No hotels match these filters.<br/>Try lowering the minimum score.</li>`;
    return;
  }
  const VISIBLE = 5;
  const openIdx = state.hotels.findIndex((h) => h.hotel_name === state.open);
  const shown = state.showAll || openIdx >= VISIBLE ? state.hotels : state.hotels.slice(0, VISIBLE);
  list.innerHTML = shown.map((h, i) => {
    const km = kmFromCenter(h);
    const saved = state.shortlist.has(h.hotel_name);
    const open = state.open === h.hotel_name;
    const t = state.filters.traveler_type;
    const highlight = t === "Solo traveler" ? `${pct(h.pct_solo_traveler)} solo`
      : t === "Family with young children" ? `${pct(h.pct_family_with_young_children)} families`
      : t === "Travelers with friends" ? `${pct(h.pct_travelers_with_friends)} friends` : `${pct(h.pct_couple)} couples`;
    return `
    <li class="card ${open ? "open" : ""} ${state.hl === h.hotel_name ? "hl" : ""}" data-name="${esc(h.hotel_name)}">
      <div class="card-main">
        <div class="rank">${i + 1}</div>
        <div style="min-width:0">
          <p class="name">${esc(pretty(h.hotel_name))}</p>
          <div class="where">${km != null ? `<b>${km.toFixed(1)} km</b> from center · ` : ""}${esc(street(h))}</div>
        </div>
        <div class="score" title="${scoreLabel(h.average_score)}"><span class="num" style="background:${scoreColor(h.average_score)}">${h.average_score.toFixed(1)}</span>
          ${h.price_per_night != null ? `<span class="price"><b>${money(h.price_per_night, h.currency)}</b> / night</span>` : `<span class="lbl">${scoreLabel(h.average_score)}</span>`}</div>
      </div>
      <div class="row2">
        <div class="meta">${mixBar(h)}<span>${highlight}</span><span>·</span><span>${h.total_reviews.toLocaleString()} reviews</span></div>
        <div class="actions">
          <button class="btn sm ${saved ? "on" : ""}" data-act="save" title="${saved ? "Remove from shortlist" : "Add to shortlist"}">${saved ? "★" : "☆"}</button>
          <button class="btn sm" data-act="toggle">${open ? "Less ▴" : "Details ▾"}</button>
          <button class="btn sm primary" data-act="pick">Choose</button>
        </div>
      </div>
      ${open ? `<div class="detail" id="detail">${detailHtml(h)}</div>` : ""}
    </li>`;
  }).join("") + (shown.length < state.hotels.length
    ? `<li><button class="btn block ghost more" id="more">Show ${state.hotels.length - shown.length} more hotels ▾</button></li>` : "");
}

// ---------------------------------------------------------------- detail panel
function detailHtml(h: Hotel) {
  const p = state.profiles.get(h.hotel_name);
  if (!p) return `<div class="full"><div class="skel" style="width:60%"></div><div class="skel" style="width:85%"></div><div class="skel" style="width:40%"></div></div>`;
  if (p.error) return `<div class="full muted">${esc(p.error)}</div>`;
  const dist = p.score_distribution ?? {};
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  const bands = ["9-10", "7-9", "5-7", "under 5"];
  const mix = Object.entries(p.traveler_mix ?? {}).sort((a, b) => b[1] - a[1]);
  const pos = (p.recent_positives ?? []).slice(0, 2), neg = (p.recent_negatives ?? []).slice(0, 2);
  const canSample = !!app.getHostCapabilities()?.sampling;
  const reviewLabel = state.filters.traveler_type ? `Read ${travelerLabel(state.filters.traveler_type).toLowerCase()} reviews` : "Read recent reviews";
  return `
    <div>
      <h4>How guests scored it</h4>
      <div class="bars">${bands.map((b) => `<div class="bar"><span>${b}</span><span class="t"><i style="width:${((dist[b] ?? 0) / total) * 100}%"></i></span><span>${Math.round(((dist[b] ?? 0) / total) * 100)}%</span></div>`).join("")}</div>
    </div>
    <div>
      <h4>Who stays here</h4>
      <div class="stack">${mix.map(([k, v]) => `<i style="width:${v * 100}%;background:${MIX_COLORS[k] ?? "#999"}"></i>`).join("")}</div>
      <div class="keys">${mix.slice(0, 4).map(([k, v]) => `<span style="--c:${MIX_COLORS[k] ?? "#999"}">${esc(k.replace("Family with young children", "Young families"))} ${pct(v)}</span>`).join("")}</div>
      <h4 style="margin-top:12px">Popular rooms</h4>
      <div class="rooms">${(p.popular_rooms ?? []).slice(0, 3).map((r) => `<span title="${esc(r.room_type)}">${esc(clip(r.room_type, 28))}</span>`).join("") || '<span class="muted">n/a</span>'}</div>
    </div>
    <div><h4>Guests loved</h4>${pos.map((q) => `<p class="quote pos">“${esc(clip(cap(q)))}”</p>`).join("") || '<p class="muted">No comments yet.</p>'}</div>
    <div><h4>Watch out for</h4>${neg.map((q) => `<p class="quote neg">“${esc(clip(cap(q)))}”</p>`).join("") || '<p class="muted">Nothing notable.</p>'}</div>
    ${canSample ? `<div class="full" id="take"><button class="btn" data-act="take">✨ Claude's take on this hotel</button></div>` : ""}
    <div class="full" id="reviews"></div>
    <div class="full detail-actions">
      <button class="btn primary" data-act="pick">Go with this hotel →</button>
      <button class="btn" data-act="reviews">${reviewLabel}</button>
      <button class="btn" data-act="ask">Ask Claude about it</button>
    </div>`;
}

async function openDetail(name: string) {
  state.open = state.open === name ? null : name;
  renderList();
  if (!state.open) { syncModelContext(); return; }
  document.querySelector(`.card[data-name="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (!state.profiles.has(name)) {
    try {
      const r = await app.callServerTool({ name: "ui_hotel_profile", arguments: { hotel_name: name } });
      state.profiles.set(name, data<Profile>(r));
    } catch (e) {
      state.profiles.set(name, { error: "Couldn't load details." } as Profile);
    }
    if (state.open === name) renderList();
  }
  syncModelContext();
}

async function loadReviews(name: string) {
  const box = $("reviews");
  box.innerHTML = `<div class="skel" style="width:70%"></div><div class="skel" style="width:50%"></div>`;
  try {
    const r = await app.callServerTool({
      name: "ui_hotel_reviews",
      arguments: { hotel_name: name, traveler_type: state.filters.traveler_type, limit: 4 },
    });
    const { reviews } = data<{ reviews: any[] }>(r);
    box.innerHTML = `<h4>Recent reviews</h4><div class="reviews">${reviews.map((v) => `
      <div class="review"><div class="rh"><span>${esc(v.traveler_type ?? "Guest")} · ${esc(v.reviewer_nationality)} · ${esc(v.review_date)}</span><b style="color:${scoreColor(v.reviewer_score)}">${v.reviewer_score}</b></div>
      ${v.positive_review ? `<div>👍 ${esc(clip(cap(v.positive_review), 200))}</div>` : ""}
      ${v.negative_review ? `<div>👎 ${esc(clip(cap(v.negative_review), 200))}</div>` : ""}</div>`).join("") || '<p class="muted">No reviews for this filter.</p>'}</div>`;
  } catch {
    box.innerHTML = `<p class="muted">Couldn't load reviews.</p>`;
  }
}

// Model intelligence *inside* the View: ask the host's model for a short take (only if the host supports sampling).
async function claudesTake(name: string) {
  const p = state.profiles.get(name);
  const box = $("take");
  if (!p || !box) return;
  box.innerHTML = `<div class="take"><div class="skel" style="width:90%"></div><div class="skel" style="width:60%"></div></div>`;
  try {
    const prompt = `Hotel: ${pretty(p.hotel_name)} (${p.city}), guest score ${p.average_score}/10 from ${p.total_reviews} reviews.
Traveler mix: ${Object.entries(p.traveler_mix).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}.
Recent praise: ${p.recent_positives.slice(0, 5).join(" | ")}
Recent complaints: ${p.recent_negatives.slice(0, 5).join(" | ")}
${state.filters.traveler_type ? `The user is traveling as: ${state.filters.traveler_type}.` : ""}
In at most two short sentences: who is this hotel best for, and the one thing to watch out for. No preamble.`;
    const res: any = await app.createSamplingMessage({
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens: 160,
    });
    const c = Array.isArray(res.content) ? res.content.find((x: any) => x.type === "text") : res.content;
    box.innerHTML = `<div class="take"><b>✨ Claude's take:</b> ${esc(c?.text ?? "")}</div>`;
  } catch (e) {
    box.innerHTML = `<p class="muted">Claude's take isn't available in this host.</p>`;
  }
}

// ---------------------------------------------------------------- talking back to the conversation
async function say(text: string, note = "Sent to chat") {
  try {
    const r = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    toast(r?.isError ? "The host declined the message" : note);
  } catch {
    toast("Couldn't reach the chat");
  }
}

function pick(name: string) {
  const h = state.hotels.find((x) => x.hotel_name === name) ?? state.shortlist.get(name);
  if (!h) return;
  const who = state.filters.traveler_type ? ` We're traveling as: ${travelerLabel(state.filters.traveler_type).toLowerCase()}.` : "";
  const cost = h.price_per_night != null ? `, ${money(h.price_per_night, h.currency)} a night` : "";
  say(`I'd like to go with ${pretty(h.hotel_name)} in ${h.city} (guest score ${h.average_score}${cost}).${who} Help me plan the stay: what should I know from the reviews, and what's worth doing nearby?`, "Great pick, sent to Claude");
}

function syncModelContext() {
  // Quietly keep the model aware of what the user is looking at. No reply is triggered.
  const lines = [
    `User is browsing the TravelCo hotel explorer: ${state.city}, filters ${JSON.stringify(state.filters)}.`,
    `Showing: ${state.hotels.slice(0, 6).map((h, i) => `${i + 1}. ${pretty(h.hotel_name)} (${h.average_score}, ${money(h.price_per_night, h.currency)}/night)`).join("; ")}.`,
    state.open ? `Currently viewing details for: ${pretty(state.open)}.` : "",
    state.shortlist.size ? `Shortlisted: ${[...state.shortlist.keys()].map(pretty).join(", ")}.` : "",
  ].filter(Boolean);
  app.updateModelContext({ content: [{ type: "text", text: lines.join("\n") }] }).catch(() => {});
}

// ---------------------------------------------------------------- shortlist
function toggleSave(name: string) {
  const h = state.hotels.find((x) => x.hotel_name === name);
  if (state.shortlist.has(name)) state.shortlist.delete(name);
  else if (h) state.shortlist.set(name, h);
  renderShortlist(); renderList(); syncModelContext();
}
function renderShortlist() {
  const ul = $("shortlist");
  $("slCount").textContent = String(state.shortlist.size);
  ul.innerHTML = state.shortlist.size
    ? [...state.shortlist.values()].map((h) => `<li><span title="${esc(pretty(h.hotel_name))}">${esc(pretty(h.hotel_name))} <b style="color:${scoreColor(h.average_score)}">${h.average_score}</b></span><button data-rm="${esc(h.hotel_name)}" aria-label="Remove">×</button></li>`).join("")
    : `<li class="muted empty">Tap ☆ on a hotel to save it here.</li>`;
  const btn = $<HTMLButtonElement>("compare");
  btn.disabled = state.shortlist.size < 2;
  btn.textContent = state.shortlist.size >= 2 ? `Compare ${state.shortlist.size} with Claude` : "Compare with Claude";
}

// ---------------------------------------------------------------- map (no tiles, just geometry)
function renderMap() {
  const svg = $("map") as unknown as SVGSVGElement;
  const W = 260, H = 200, P = 16;
  const c = CENTERS[state.city];
  const pts = state.hotels.map((h, i) => ({ h, i })).filter(({ h }) => h.lat != null && h.lng != null);
  if (!c || !pts.length) { svg.innerHTML = `<text x="130" y="100" text-anchor="middle" class="ringlbl">No locations</text>`; return; }
  const k = Math.cos((c[0] * Math.PI) / 180);
  const near = pts.filter(({ h }) => (kmFromCenter(h) ?? 0) <= 4);
  const fit = near.length >= 2 ? near : pts;
  const xs = [...fit.map(({ h }) => h.lng! * k), c[1] * k], ys = [...fit.map(({ h }) => h.lat!), c[0]];
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, (maxY - minY) * (W / H), 0.01);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const s = (W - 2 * P) / span;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const X = (lng: number) => clamp(W / 2 + (lng * k - cx) * s, 8, W - 8);
  const Y = (lat: number) => clamp(H / 2 - (lat - cy) * s, 8, H - 8);
  const pxPerKm = s / 111;
  const rings = [0.5, 1, 2, 5].filter((km) => km * pxPerKm < H * 0.48).slice(-2);
  const grid = Array.from({ length: 5 }, (_, i) => `<line x1="${(i + 1) * W / 6}" y1="0" x2="${(i + 1) * W / 6}" y2="${H}"/>`).join("")
    + Array.from({ length: 3 }, (_, i) => `<line x1="0" y1="${(i + 1) * H / 4}" x2="${W}" y2="${(i + 1) * H / 4}"/>`).join("");
  svg.innerHTML = `
    <g class="grid">${grid}</g>
    ${rings.map((km) => `<circle class="ring" cx="${X(c[1])}" cy="${Y(c[0])}" r="${km * pxPerKm}"/><text class="ringlbl" x="${X(c[1]) + km * pxPerKm * 0.71 + 2}" y="${Y(c[0]) - km * pxPerKm * 0.71}">${km} km</text>`).join("")}
    <text class="center" x="${X(c[1])}" y="${Y(c[0])}"><title>${c[2]}</title>★</text>
    ${pts.slice().reverse().map(({ h, i }) => `
      <g class="dot ${state.hl === h.hotel_name || state.open === h.hotel_name ? "hl" : ""}" data-name="${esc(h.hotel_name)}" transform="translate(${X(h.lng!).toFixed(1)},${Y(h.lat!).toFixed(1)})">
        <title>${esc(pretty(h.hotel_name))} · ${h.average_score}</title><circle r="7"/><text>${i + 1}</text></g>`).join("")}`;
}

function highlight(name: string | null) {
  state.hl = name;
  document.querySelectorAll(".card").forEach((el) => el.classList.toggle("hl", (el as HTMLElement).dataset.name === name));
  document.querySelectorAll("#map .dot").forEach((el) => el.classList.toggle("hl", (el as HTMLElement).dataset.name === name || (el as HTMLElement).dataset.name === state.open));
}

// ---------------------------------------------------------------- events
function wire() {
  $("traveler").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button"); if (!b) return;
    state.filters.traveler_type = b.dataset.v || null; renderFilters(); refilter();
  });
  $("minScore").addEventListener("input", (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    state.filters.min_score = v <= 7 ? 0 : v; $("minScoreVal").textContent = v <= 7 ? "any" : v.toFixed(1); refilter(250);
  });
  $("sort").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button"); if (!b) return;
    state.filters.sort_by = b.dataset.v as Filters["sort_by"]; renderFilters(); refilter();
  });
  $("biz").addEventListener("change", (e) => { state.filters.business_friendly = (e.target as HTMLInputElement).checked; refilter(); });

  $("list").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.id === "more") { state.showAll = true; renderList(); return; }
    const card = t.closest(".card") as HTMLElement | null; if (!card) return;
    const name = card.dataset.name!;
    const act = (t.closest("button") as HTMLElement | null)?.dataset.act;
    if (act === "toggle") openDetail(name);
    else if (act === "save") toggleSave(name);
    else if (act === "pick") pick(name);
    else if (act === "reviews") loadReviews(name);
    else if (act === "take") claudesTake(name);
    else if (act === "ask") say(`Tell me more about ${pretty(name)} in ${state.city}. Anything in the reviews I should worry about?`);
    else if (!act && !t.closest(".detail")) openDetail(name);
  });
  $("list").addEventListener("mouseover", (e) => {
    const card = (e.target as HTMLElement).closest(".card") as HTMLElement | null;
    if (card && card.dataset.name !== state.hl) highlight(card.dataset.name!);
  });
  $("list").addEventListener("mouseleave", () => highlight(null));
  $("map").addEventListener("click", (e) => {
    const dot = (e.target as Element).closest(".dot") as HTMLElement | null;
    if (dot) openDetail(dot.dataset.name!);
  });
  $("map").addEventListener("mouseover", (e) => {
    const dot = (e.target as Element).closest(".dot") as HTMLElement | null;
    if (dot) highlight(dot.dataset.name!);
  });
  $("shortlist").addEventListener("click", (e) => {
    const rm = (e.target as HTMLElement).dataset.rm; if (rm) toggleSave(rm);
  });
  $("compare").addEventListener("click", () => {
    const names = [...state.shortlist.values()].map((h) => `${pretty(h.hotel_name)} (${h.average_score}, ${money(h.price_per_night, h.currency)}/night)`);
    const who = state.filters.traveler_type ? ` We're traveling as: ${travelerLabel(state.filters.traveler_type).toLowerCase()}.` : "";
    say(`Compare the hotels I shortlisted in ${state.city}: ${names.join(", ")}.${who} Which would you pick, and why?`, "Comparison sent to Claude");
  });
  $("fullscreen").addEventListener("click", () => app.requestDisplayMode({ mode: "fullscreen" }).catch(() => {}));
}

// ---------------------------------------------------------------- lifecycle
// Register handlers BEFORE connect() so the initial input/result isn't missed.
app.ontoolinput = (p: any) => {
  const a = p?.arguments ?? {};
  if (a.city) state.city = a.city;
  state.filters = {
    min_score: a.min_score ?? 0, traveler_type: a.traveler_type ?? null,
    business_friendly: !!a.business_friendly, sort_by: a.sort_by ?? "score", max_price: a.max_price ?? null,
  };
  $("title").textContent = `Hotels in ${state.city}`;
  $("subtitle").textContent = "Searching…";
  renderFilters();
  $("list").innerHTML = Array.from({ length: 4 }, () => `<li class="card"><div class="skel" style="width:55%"></div><div class="skel" style="width:80%"></div></li>`).join("");
};
app.ontoolresult = (r: any) => {
  try { applyResult(data<SearchResult>(r), true); syncModelContext(); }
  catch (e) { $("subtitle").textContent = "Something went wrong loading results."; console.error(e); }
};
app.onhostcontextchanged = (ctx: any) => applyHost({ ...app.getHostContext(), ...ctx });

wire();
renderFilters();
renderShortlist();
app.connect().then(() => applyHost(app.getHostContext())).catch((e) => console.error("connect failed", e));
