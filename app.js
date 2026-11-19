/* To-do - synced with ATOM (atom_todos.py) through todos.json on the private repo's data branch. */
(function () {
  "use strict";
  const { icon, fillIcons, $, $$, esc, dkey, parseKey, addDays, today, WD, MON, MONTHS, flash, openSheet, closeSheet } = UI;

  const DEMO = new URLSearchParams(location.search).has("demo");
  const sync = new DocSync.Syncer({
    storageKey: DEMO ? "todo-demo" : "todo", file: "todos.json", collection: "tasks", device: "phone",
    onChange: render, onStatus: UI.status,
  });
  let view = localStorage.getItem("todo.view") || "today";
  const TITLES = { today: "Today", upcoming: "Upcoming", all: "All", done: "Completed" };

  // ---- quick-add parsing (mirrors atom_todos.parse_quick) -------------------------------------
  const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  function dateWord(word, t = today()) {
    const w = word.toLowerCase().replace(/[,.]$/, "");
    if (w === "today" || w === "tonight") return t;
    if (["tomorrow", "tmrw", "tmr"].includes(w)) return addDays(t, 1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(w)) { const d = parseKey(w); if (dkey(d) === w) return d; }
    if (w.length >= 3) {
      const i = WEEKDAYS.findIndex((n) => n.startsWith(w));
      if (i >= 0) { const wd = (t.getDay() + 6) % 7; return addDays(t, ((i - wd + 7) % 7) || 7); }
    }
    return null;
  }
  function parseQuick(text, t = today()) {
    let words = text.trim().split(/\s+/).filter(Boolean);
    let priority = false, due = "";
    if (words.at(-1) === "!") { priority = true; words = words.slice(0, -1); }
    else if (words[0] === "!") { priority = true; words = words.slice(1); }
    if (words.length > 1) {
      if (words.length > 2 && ["on", "by", "due"].includes(words.at(-2).toLowerCase()) && dateWord(words.at(-1), t)) {
        due = dkey(dateWord(words.at(-1), t)); words = words.slice(0, -2);
      } else if (dateWord(words.at(-1), t)) {
        due = dkey(dateWord(words.at(-1), t)); words = words.slice(0, -1);
      } else if (dateWord(words[0], t)) {
        due = dkey(dateWord(words[0], t)); words = words.slice(1);
      }
    }
    return { title: words.join(" "), due, priority };
  }

  // ---- model -------------------------------------------------------------------------------------
  const tasks = () => sync.items;
  function sortKey(a, b) {
    return (a.done - b.done) || (b.priority - a.priority) || (a.due || "9999").localeCompare(b.due || "9999") ||
           ((a.order || 0) - (b.order || 0)) || ((a.createdAt || 0) - (b.createdAt || 0));
  }
  function dueLabel(t) {
    if (!t.due) return "";
    const d = parseKey(t.due), n = today();
    const diff = Math.round((d - n) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    if (diff > 1 && diff < 7) return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
    return d.toLocaleDateString([], { day: "numeric", month: "short", ...(d.getFullYear() !== n.getFullYear() ? { year: "numeric" } : {}) });
  }
  const isLate = (t) => t.due && !t.done && t.due < dkey(today());

  function addTask(text) {
    const { title, due, priority } = parseQuick(text);
    const now = Date.now();
    const order = Math.max(0, ...tasks().map((t) => t.order || 0)) + 1;
    sync.put({ id: DocSync.uid("t"), title: (title || text.trim()).slice(0, 200), notes: "", done: false, doneAt: 0,
               due, priority, order, createdAt: now }, `Add ${(title || text).slice(0, 40)}`);
  }
  function toggle(id) {
    const t = { ...sync.get(id) };
    t.done = !t.done; t.doneAt = t.done ? Date.now() : 0;
    sync.put(t, `${t.done ? "Complete" : "Reopen"} ${t.title.slice(0, 40)}`);
    if (navigator.vibrate) navigator.vibrate(t.done ? 10 : 5);
  }

  // ---- render --------------------------------------------------------------------------------
  function groups() {
    const all = tasks().slice().sort(sortKey), tk = dkey(today());
    const open = all.filter((t) => !t.done);
    if (view === "done") {
      const done = all.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      return { count: done.length, groups: done.length ? [["", done]] : [] };
    }
    const late = open.filter((t) => t.due && t.due < tk);
    const tod = open.filter((t) => t.due === tk);
    if (view === "today") {
      const flagged = open.filter((t) => !t.due && t.priority);
      return { count: late.length + tod.length + flagged.length,
               groups: [["Overdue", late, true], ["Today", tod], ["Priority", flagged]].filter((x) => x[1].length) };
    }
    if (view === "upcoming") {
      const by = new Map();
      for (const t of open.filter((t) => t.due && t.due > tk)) { if (!by.has(t.due)) by.set(t.due, []); by.get(t.due).push(t); }
      const g = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
        const d = parseKey(k), lbl = dueLabel({ due: k });
        return [/\d/.test(lbl) ? lbl : `${lbl}, ${d.getDate()} ${MON[d.getMonth()]}`, v];
      });
      return { count: g.reduce((n, x) => n + x[1].length, 0), groups: g };
    }
    return { count: open.length, groups: [["Overdue", late, true], ["Today", tod], ["Later", open.filter((t) => t.due && t.due > tk)],
             ["No Date", open.filter((t) => !t.due)]].filter((x) => x[1].length) };
  }

  function row(t) {
    const meta = [];
    if (t.due && (view !== "upcoming" || t.done)) meta.push(`<span class="${isLate(t) ? "late" : ""}">${esc(dueLabel(t))}</span>`);
    if (t.notes) meta.push(`<span class="note">${esc(t.notes.split("\n")[0])}</span>`);
    return `<div class="task ${t.done ? "done" : ""}" data-id="${t.id}">
      <button class="box" data-toggle aria-label="${t.done ? "Mark as not completed" : "Complete"}: ${esc(t.title)}">${icon("check")}</button>
      <div class="body" data-edit>
        <div class="t">${t.priority ? `<span class="prio">!</span>` : ""}${esc(t.title)}</div>
        ${meta.length ? `<div class="meta">${meta.join("<span>·</span>")}</div>` : ""}
      </div>
    </div>`;
  }

  const EMPTY = {
    today: ["sun", "Nothing due today", "Add a task, or tell ATOM “add todo …”."],
    upcoming: ["calendar", "Nothing scheduled", "Add a day like “fri” when you type a task."],
    all: ["tray", "No reminders", "Type above to add your first one."],
    done: ["checkCircle", "Nothing completed yet", "Finished tasks land here."],
  };

  function render() {
    const { count, groups: gs } = groups();
    $("#title").textContent = $("#small-title").textContent = TITLES[view];
    $("#count-line").textContent = view === "done" ? `${count} completed` : `${count} ${count === 1 ? "reminder" : "reminders"}`;
    $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    const quick = view === "done" ? "" : `<div class="section"><div class="group">
        <form class="quick" id="quick" autocomplete="off"><span class="plus">${icon("plus")}</span>
          <input id="quick-input" placeholder="New Reminder" aria-label="New reminder" enterkeyhint="done" value="${esc(draft)}"></form>
      </div><div class="quick-hint" id="quick-hint">${hintFor(draft)}</div></div>`;
    let body;
    if (!gs.length) {
      const [ic, h, p] = EMPTY[view];
      body = `<div class="empty"><div class="glyph">${icon(ic)}</div><h2>${h}</h2><p>${esc(p)}</p></div>`;
    } else {
      body = gs.map(([name, items, red]) => `<div class="section">
          ${name ? `<div class="section-head big ${red ? "red" : ""}"><span>${esc(name)}</span><span class="count">${items.length}</span></div>` : ""}
          <div class="group">${items.map(row).join("")}</div></div>`).join("") +
        (view === "done" ? `<div class="section clear-row"><div class="group"><button class="row destructive" id="clear-done">Clear Completed</button></div></div>` : "");
    }
    const focused = document.activeElement && document.activeElement.id === "quick-input";
    $("#list").innerHTML = quick + body;
    if (focused) { const i = $("#quick-input"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    bindQuick();
  }

  // ---- quick add -------------------------------------------------------------------------------
  let draft = "";
  function hintFor(text) {
    if (!text.trim()) return "Try “pay rent fri !” — a day sets the date, ! marks it important.";
    const p = parseQuick(text);
    const bits = [p.due ? `Due <b>${esc(dueLabel({ due: p.due }))}</b>` : "No date", p.priority && "<b>Important</b>"].filter(Boolean);
    return bits.join(" · ");
  }
  function bindQuick() {
    const form = $("#quick"); if (!form) return;
    const input = $("#quick-input"), hint = $("#quick-hint");
    input.oninput = () => { draft = input.value; hint.innerHTML = hintFor(draft); };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      addTask(input.value); draft = "";
      render(); $("#quick-input").focus(); flash("Added");
    };
  }

  // ---- edit sheet ------------------------------------------------------------------------------
  function edit(id) {
    const t = { ...sync.get(id) };
    if (!t.id) return;
    const chips = [["Today", 0], ["Tomorrow", 1], ["Next Week", 7], ["No Date", null]];
    openSheet(`
      <div class="s-head"><span class="left"><button class="nav-btn" data-close>Cancel</button></span><h2>Details</h2>
        <span class="right"><button class="nav-btn done" id="e-save">Done</button></span></div>
      <div class="s-body">
        <div class="section"><div class="group">
          <div class="row"><input class="inline" id="e-title" value="${esc(t.title)}" maxlength="200" placeholder="Title"></div>
          <div class="row"><textarea class="inline" id="e-notes" maxlength="2000" placeholder="Notes">${esc(t.notes || "")}</textarea></div>
        </div></div>
        <div class="section"><div class="group">
          <label class="row"><span class="icon-tile" style="background:var(--red)">${icon("calendar")}</span><span class="grow">Date</span>
            <input class="inline" type="date" id="e-due" value="${esc(t.due || "")}"></label>
          <div class="row tap" id="e-prio" style="--inset:58px"><span class="icon-tile" style="background:var(--orange)">${icon("flag")}</span><span class="grow">Important</span><span class="switch ${t.priority ? "on" : ""}"></span></div>
          <div class="row tap" id="e-done" style="--inset:58px"><span class="icon-tile" style="background:var(--blue)">${icon("check")}</span><span class="grow">Completed</span><span class="switch ${t.done ? "on" : ""}"></span></div>
        </div>
        <div class="dates">${chips.map(([n, d]) => `<button class="chip" data-days="${d}">${n}</button>`).join("")}</div></div>
        <div class="section"><div class="group"><button class="row destructive" id="e-del">Delete Reminder</button></div></div>
      </div>`, (el) => {
      $("[data-close]", el).onclick = () => closeSheet();
      $(".dates", el).onclick = (e) => {
        const c = e.target.closest("[data-days]"); if (!c) return;
        $("#e-due", el).value = c.dataset.days === "null" ? "" : dkey(addDays(today(), +c.dataset.days));
      };
      $("#e-prio", el).onclick = () => { t.priority = !t.priority; $("#e-prio .switch", el).classList.toggle("on", t.priority); };
      $("#e-done", el).onclick = () => { t.done = !t.done; $("#e-done .switch", el).classList.toggle("on", t.done); };
      $("#e-del", el).onclick = (e) => {
        const b = e.currentTarget;
        if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap Again to Delete"; return; }
        sync.remove(t.id, `Delete ${t.title.slice(0, 40)}`); closeSheet(); render(); flash("Deleted");
      };
      $("#e-save", el).onclick = () => {
        const title = $("#e-title", el).value.trim();
        if (!title) { $("#e-title", el).placeholder = "A title is required"; $("#e-title", el).focus(); return; }
        const before = sync.get(t.id);
        t.title = title; t.notes = $("#e-notes", el).value.trim(); t.due = $("#e-due", el).value || "";
        t.doneAt = t.done ? (before && before.done ? before.doneAt : Date.now()) : 0;
        sync.put(t, `Edit ${title.slice(0, 40)}`); closeSheet(); render();
      };
    });
  }

  // ---- wiring ---------------------------------------------------------------------------------
  function bind() {
    fillIcons();
    $("#btn-settings").innerHTML = icon("gear");
    UI.bindStatus($("#status"));
    UI.bindNav($("#nav"), $("#large"));
    $("#tabs").onclick = (e) => {
      const b = e.target.closest("[data-view]"); if (!b) return;
      view = b.dataset.view; localStorage.setItem("todo.view", view); render(); window.scrollTo({ top: 0 });
    };
    $("#list").addEventListener("click", (e) => {
      const clear = e.target.closest("#clear-done");
      if (clear) {
        if (!clear.dataset.armed) { clear.dataset.armed = "1"; clear.textContent = "Tap Again to Clear"; return; }
        const done = tasks().filter((t) => t.done);
        sync.change((d) => { const now = Date.now(); for (const t of done) d.tasks[t.id] = { id: t.id, deleted: true, updatedAt: now }; }, `Clear ${done.length} done`);
        render(); flash("Cleared"); return;
      }
      const task = e.target.closest(".task"); if (!task) return;
      if (e.target.closest("[data-toggle]")) {
        const id = task.dataset.id;
        task.classList.toggle("done");                       // instant feedback, the list re-sorts a beat later
        toggle(id);
        clearTimeout(bind.t); bind.t = setTimeout(render, 650);
      } else if (e.target.closest("[data-edit]")) edit(task.dataset.id);
    });
    $("#btn-settings").onclick = () => UI.settingsSheet(sync, {
      repoHint: "TaymazNaghashi/ATOMtodolist", appName: "To-do",
      extra: `<div class="section"><div class="section-head">Data</div><div class="group">
        <button class="row tint" id="s-export">Export Backup</button></div></div>`,
      mountExtra: (el) => { $("#s-export", el).onclick = () => UI.exportJSON(sync.doc, "todos"); },
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) sync.sync(); });
    setInterval(() => { if (!document.hidden) sync.sync(); }, 60000);
  }

  function demo() {
    if (sync.items.length) return;
    const t = today(), k = (n) => dkey(addDays(t, n)), now = Date.now();
    [["Pay rent", k(0), true], ["Call the dentist", k(-1), false], ["Renew passport", k(4), false],
     ["Groceries", k(0), false, "Oats, coffee, eggs"], ["Read chapter 7", "", false], ["Ship habit tracker", k(1), true]]
      .forEach(([title, due, priority, notes], i) => sync.doc.tasks["d" + i] = { id: "d" + i, title, due, priority, notes: notes || "",
        done: false, doneAt: 0, order: i, createdAt: now, updatedAt: now });
    sync.doc.tasks.d9 = { id: "d9", title: "Back up photos", due: "", priority: false, notes: "", done: true, doneAt: now, order: 9, createdAt: now, updatedAt: now };
  }

  bind();
  if (DEMO) demo();
  render();
  UI.registerSW();
  if (!DEMO) { if (sync.connected) sync.sync(); else UI.status({ state: "local", text: "On this device only" }); }
  window.__todo = { parseQuick };
})();
