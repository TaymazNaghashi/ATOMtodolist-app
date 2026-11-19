/* ATOM web apps - shared UI helpers, Apple-style: line icons, spring sheets you can grab and throw,
 * the page scaling back behind a sheet, a translucent nav bar, inline status, GitHub connect form.
 * Used by the to-do and calendar apps. */
(function () {
  "use strict";

  // 24px line icons, drawn here so nothing is fetched (SF Symbols-like weight).
  const PATHS = {
    plus: "M12 5v14M5 12h14",
    check: "M5 12.5l4.5 4.5L19 7.5",
    x: "M6 6l12 12M18 6L6 18",
    left: "M15 5l-7 7 7 7",
    right: "M9 5l7 7-7 7",
    gear: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7.4 7.4 0 0 1-2 1.2l-.3 2H11l-.3-2a7.4 7.4 0 0 1-2-1.2l-1.9.7L5 14.7l1.6-1.2a7.6 7.6 0 0 1 0-2.4L5 9.9l1.8-3.1 1.9.7a7.4 7.4 0 0 1 2-1.2l.3-2h3.6l.3 2a7.4 7.4 0 0 1 2 1.2l1.9-.7 1.8 3.1-1.6 1.2a7.6 7.6 0 0 1 0 2.4z",
    trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12",
    refresh: "M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4",
    pin: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    repeat: "M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4",
    download: "M12 4v11M7 10l5 5 5-5M5 20h14",
    sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
    calendar: "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4",
    list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
    tray: "M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5",
    checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l3 3 5-6",
    flag: "M5 21V4M5 4h11l-2 4 2 4H5",
    agenda: "M4 5h16M4 12h16M4 19h10",
    note: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  };
  function icon(name) {
    return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name] || ""}"/></svg>`;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function fillIcons(root = document) { for (const el of $$("[data-icon]", root)) el.innerHTML = icon(el.dataset.icon); }

  // iOS only fires :active on elements when the document listens for touches.
  document.addEventListener("touchstart", () => {}, { passive: true });

  // ---- dates (local clock) -------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // ---- springs (Apple's response / damping ratio), interruptible, velocity-aware ---------------
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function spring({ from, to, velocity = 0, response = 0.35, damping = 1, onUpdate, onDone }) {
    const k = (2 * Math.PI / response) ** 2, c = 4 * Math.PI * damping / response;
    let x = from, v = velocity, last = performance.now(), raf = 0, stopped = false;
    if (reduced()) { onUpdate(to); if (onDone) onDone(); return { stop() {}, get value() { return to; }, get velocity() { return 0; } }; }
    const tick = (now) => {
      if (stopped) return;
      let dt = Math.min(0.064, (now - last) / 1000); last = now;
      const steps = Math.max(1, Math.ceil(dt * 240)); const h = dt / steps;
      for (let i = 0; i < steps; i++) { v += (-k * (x - to) - c * v) * h; x += v * h; }
      if (Math.abs(x - to) < 0.3 && Math.abs(v) < 2) { x = to; v = 0; onUpdate(x); if (onDone) onDone(); return; }
      onUpdate(x);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return { stop() { stopped = true; cancelAnimationFrame(raf); }, get value() { return x; }, get velocity() { return v; } };
  }
  // Apple's momentum projection (scroll-like deceleration)
  const project = (v, rate = 0.998) => (v / 1000) * rate / (1 - rate);

  // ---- status: subtitle under the large title; flash() for one-off confirmations ---------------
  let statusEl = null, flashTimer = null, lastSync = { state: "idle", text: "" };
  function status(s) {
    lastSync = s;
    if (!statusEl || flashTimer) return;
    statusEl.dataset.state = s.state;
    statusEl.textContent = s.text === "Synced" ? "Up to date" : s.text || "";
  }
  function flash(text, state = "flash") {
    if (!statusEl) return;
    clearTimeout(flashTimer);
    statusEl.dataset.state = state;
    statusEl.textContent = text;
    flashTimer = setTimeout(() => { flashTimer = null; status(lastSync); }, 1600);
  }
  function bindStatus(el) { statusEl = el; status(lastSync); }

  // ---- nav bar material appears once the large title has scrolled under it ----------------------
  function bindNav(nav, large) {
    const io = new IntersectionObserver(([e]) => nav.classList.toggle("scrolled", !e.isIntersecting),
                                        { rootMargin: "-44px 0px 0px 0px", threshold: 0 });
    io.observe(large);
  }

  // ---- sheet: presented on a spring, grabbed and thrown to dismiss -----------------------------
  let current = null;          // { y, anim, onClose }
  function sheetHeight() { return $("#sheet").getBoundingClientRect().height || innerHeight; }
  function applySheet(y) {
    const sheet = $("#sheet"), h = sheetHeight();
    sheet.style.transform = `translateY(${y}px)`;
    const p = Math.max(0, Math.min(1, 1 - y / h));             // 1 = fully presented
    $("#scrim").style.opacity = p;
    const page = $("#page");
    if (page && innerWidth < 760) {
      page.style.transform = `scale(${1 - 0.06 * p}) translateY(${p * 10}px)`;
      page.style.borderRadius = `${p * 12}px`;
      page.classList.toggle("behind", p > 0.01);
    }
  }
  function animateSheet(to, velocity = 0, done) {
    if (!current) return;
    if (current.anim) current.anim.stop();                      // interrupt from the live value
    current.anim = spring({ from: current.y, to, velocity, response: 0.35, damping: to === 0 && Math.abs(velocity) > 300 ? 0.86 : 1,
      onUpdate: (y) => { current.y = y; applySheet(y); }, onDone: done });
  }
  function openSheet(html, mount, onClose) {
    const sheet = $("#sheet"), scrim = $("#scrim");
    sheet.innerHTML = `<div class="grabber"></div>${html}`;
    fillIcons(sheet);
    sheet.style.visibility = "visible";
    sheet.setAttribute("aria-hidden", "false");
    scrim.classList.add("on");
    const h = sheetHeight();
    current = { y: current ? current.y : h, anim: current && current.anim, onClose };
    animateSheet(0);
    dragToDismiss(sheet);
    if (mount) mount(sheet);
    const first = $("[autofocus]", sheet);
    if (first && matchMedia("(pointer: fine)").matches) setTimeout(() => first.focus(), 120);
  }
  function closeSheet(velocity = 0) {
    if (!current) return;
    const cb = current.onClose; current.onClose = null;
    const active = document.activeElement; if (active && $("#sheet").contains(active)) active.blur();
    $("#scrim").classList.remove("on");
    animateSheet(sheetHeight(), velocity, () => {
      const sheet = $("#sheet");
      sheet.style.visibility = "hidden"; sheet.setAttribute("aria-hidden", "true");
      const page = $("#page"); if (page) { page.style.transform = ""; page.style.borderRadius = ""; page.classList.remove("behind"); }
      current = null;
    });
    if (cb) cb();
  }
  function rubber(over, dim, c = 0.55) { return (over * dim * c) / (dim + c * Math.abs(over)); }
  function dragToDismiss(sheet) {
    let startY = 0, startSheet = 0, hist = [], dragging = false;
    const zone = (e) => e.target.closest(".grabber, .s-head") && !e.target.closest("button");
    sheet.onpointerdown = (e) => {
      if (!zone(e) || !current) return;
      dragging = true; sheet.setPointerCapture(e.pointerId);
      if (current.anim) current.anim.stop();                     // catch it mid-flight
      startY = e.clientY; startSheet = current.y; hist = [[e.timeStamp, e.clientY]];
    };
    sheet.onpointermove = (e) => {
      if (!dragging) return;
      let y = startSheet + (e.clientY - startY);
      if (y < 0) y = rubber(y, innerHeight);                      // soft boundary when pulled up
      current.y = y; applySheet(y);
      hist.push([e.timeStamp, e.clientY]); if (hist.length > 6) hist.shift();
    };
    sheet.onpointerup = sheet.onpointercancel = (e) => {
      if (!dragging) return;
      dragging = false;
      const [t0, y0] = hist[0], dt = (e.timeStamp - t0) / 1000;
      const v = dt > 0 ? (e.clientY - y0) / dt : 0;                // px/s at release
      const landing = current.y + project(v);
      if (landing > sheetHeight() * 0.45) closeSheet(v); else animateSheet(0, v);
    };
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  document.addEventListener("click", (e) => { if (e.target.id === "scrim") closeSheet(); });

  // ---- settings: GitHub connection --------------------------------------------------------------
  function settingsSheet(sync, { repoHint, appName, extra = "", mountExtra }) {
    const c = sync.config, st = sync.status;
    const ago = sync.lastSync ? new Date(sync.lastSync).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never";
    openSheet(`
      <div class="s-head"><span class="left"></span><h2>Settings</h2><span class="right"><button class="nav-btn done" data-close>Done</button></span></div>
      <div class="s-body">
        <div class="section"><div class="section-head">Sync with ATOM</div>
          <div class="group">
            <div class="row"><span class="grow">Status</span><span class="value">${esc(sync.connected ? (st.text === "Synced" ? "Up to date" : st.text || "Idle") : "This device only")}</span></div>
            <div class="row"><span class="grow">Last synced</span><span class="value">${esc(ago)}</span></div>
            ${sync.connected ? `<button class="row tint" id="s-sync">Sync Now</button>` : ""}
          </div>
        </div>
        <div class="section"><div class="section-head">GitHub</div>
          <div class="group">
            <label class="row"><span style="width:64px">Repo</span><input class="inline" id="s-repo" placeholder="${esc(repoHint)}" value="${esc(c.repo || repoHint)}" autocapitalize="off" spellcheck="false"></label>
            <label class="row"><span style="width:64px">Token</span><input class="inline" id="s-token" type="password" placeholder="${sync.connected ? "Saved on this device" : "github_pat_…"}" autocapitalize="off" spellcheck="false"></label>
          </div>
          <div class="err-text" id="s-err"></div>
          <div class="help">
            <ol>
              <li>github.com → Settings → Developer settings → <b>Fine-grained tokens</b> → Generate.</li>
              <li>Repository access: <b>Only select repositories</b> → <b>${esc(repoHint.split("/")[1])}</b>. One token can cover all your ATOM apps.</li>
              <li>Permissions → Repository → <b>Contents: Read and write</b>. Nothing else.</li>
            </ol>
            The token stays on this device and can only read and edit that repo's files.
          </div>
          <div style="padding:16px 0 0"><button class="btn block press" id="s-connect">${sync.connected ? "Update Connection" : "Connect"}</button></div>
        </div>
        ${extra}
        ${sync.connected ? `<div class="section"><div class="group"><button class="row destructive" id="s-disc">Disconnect This Device</button></div>
          <div class="section-foot">Removes the token from this device. Your data stays.</div></div>` : ""}
      </div>`, (el) => {
      $("[data-close]", el).onclick = () => closeSheet();
      const sbtn = $("#s-sync", el);
      if (sbtn) sbtn.onclick = async () => { sbtn.disabled = true; sbtn.textContent = "Syncing…"; await sync.sync(); closeSheet(); };
      const dbtn = $("#s-disc", el);
      if (dbtn) dbtn.onclick = () => { sync.config = { repo: "", token: "" }; closeSheet(); status({ state: "local", text: "On this device only" }); };
      $("#s-connect", el).onclick = async () => {
        const repo = $("#s-repo", el).value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
        const token = $("#s-token", el).value.trim() || c.token;
        const err = $("#s-err", el);
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { err.textContent = "The repo should look like owner/name."; return; }
        if (!token) { err.textContent = "Paste a token to connect."; return; }
        err.textContent = "";
        const btn = $("#s-connect", el); btn.disabled = true; btn.textContent = "Connecting…";
        const prev = sync.config;
        sync.config = { repo, token };
        await sync.sync();
        if (sync.status.state === "error") {
          sync.config = prev; err.textContent = sync.status.text;
          btn.disabled = false; btn.textContent = "Connect"; return;
        }
        closeSheet(); flash("Connected");
      };
      if (mountExtra) mountExtra(el);
    });
  }

  function exportJSON(doc, name) {
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${name}-${dkey(new Date())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function registerSW() {
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  window.UI = { icon, fillIcons, $, $$, esc, pad, dkey, parseKey, addDays, today, WD, MON, MONTHS, spring, project,
                status, flash, bindStatus, bindNav, openSheet, closeSheet, settingsSheet, exportJSON, registerSW };
})();
