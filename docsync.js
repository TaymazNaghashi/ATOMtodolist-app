/* ATOM web apps - one JSON document per app, merged and synced through a private GitHub repo.
 *
 * The document lives on the `data` branch of the app's private repo and is read and written
 * through the GitHub contents API with a fine-grained token pasted into Settings on each device.
 * The token is kept only in this device's storage - it is never part of the app's code.
 *
 * Document:  { v: 1, <collection>: { <id>: { id, ..., updatedAt, deleted? } }, settings: { updatedAt, ... } }
 *
 * Merging two copies never loses a change: each item keeps the copy with the newer updatedAt
 * (ties broken by comparing JSON text, so every device ends up identical). Deleting writes a
 * { id, deleted: true, updatedAt } tombstone so the delete beats older copies elsewhere.
 * atom_sync.py on ATOM merges exactly the same way.
 */
(function () {
  "use strict";

  const BRANCH = "data";

  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
      return o;
    }
    return v;
  }

  function newer(a, b, stamp) {
    if (!a) return b;
    if (!b) return a;
    const ta = stamp(a), tb = stamp(b);
    if (ta !== tb) return ta > tb ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  function b64decode(s) {
    const bin = atob(s.replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  class SyncError extends Error {
    constructor(message, kind) { super(message); this.kind = kind; }   // auth | missing | network | conflict | other
  }

  function makeDoc(collection, settingsDefaults) {
    const emptyDoc = () => ({ v: 1, [collection]: {}, settings: Object.assign({ updatedAt: 0 }, settingsDefaults) });
    const normalize = (doc) => {
      const d = doc && typeof doc === "object" ? doc : {};
      const items = d[collection] && typeof d[collection] === "object" ? d[collection] : {};
      return { v: 1, [collection]: items, settings: Object.assign({ updatedAt: 0 }, settingsDefaults, d.settings || {}) };
    };
    const merge = (a, b) => {
      a = normalize(a); b = normalize(b);
      const out = emptyDoc();
      for (const id of new Set([...Object.keys(a[collection]), ...Object.keys(b[collection])])) {
        out[collection][id] = newer(a[collection][id], b[collection][id], (x) => x.updatedAt || 0);
      }
      out.settings = newer(a.settings, b.settings, (s) => s.updatedAt || 0);
      return out;
    };
    return { emptyDoc, normalize, merge };
  }

  class GitHubFile {
    constructor(repo, token, file, normalize) { Object.assign(this, { repo, token, file, normalize }); }

    async _req(method, body) {
      const url = `https://api.github.com/repos/${this.repo}/contents/${this.file}` +
        (method === "GET" ? `?ref=${BRANCH}&t=${Date.now()}` : "");
      let res;
      try {
        res = await fetch(url, {
          method, cache: "no-store",
          headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new SyncError("Offline - saved on this device", "network");
      }
      if (res.status === 401) throw new SyncError("Token rejected - paste a new one", "auth");
      if (res.status === 403) {
        const t = await res.text();
        if (/rate limit/i.test(t)) throw new SyncError("GitHub rate limit - retrying", "network");
        throw new SyncError("Token can't access the repo (needs Contents: read & write)", "auth");
      }
      if (res.status === 404) throw new SyncError("Repo or data branch not found", "missing");
      if (res.status === 409 || res.status === 422) throw new SyncError("conflict", "conflict");
      if (!res.ok) throw new SyncError(`GitHub error ${res.status}`, "other");
      return res.json();
    }

    async load() {
      const r = await this._req("GET");
      let text = "{}";
      if (r.content) text = b64decode(r.content);
      else if (r.git_url) {
        const raw = await fetch(r.git_url, { cache: "no-store", headers: {
          Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github.raw+json" } });
        text = await raw.text();
      }
      return { doc: this.normalize(JSON.parse(text || "{}")), sha: r.sha };
    }

    async save(doc, sha, message) {
      const r = await this._req("PUT", { message, branch: BRANCH, sha,
        content: b64encode(JSON.stringify(canon(doc), null, 1) + "\n") });
      return r.content.sha;
    }
  }

  /* Local copy (works offline) + background push/pull. onChange(doc) fires when a pull changed things. */
  class Syncer {
    constructor({ storageKey, file, collection, settings, onChange, onStatus, device }) {
      Object.assign(this, makeDoc(collection, settings || {}));
      Object.assign(this, { key: storageKey, file, collection, onChange, onStatus, device });
      const saved = this._read("doc");
      this.doc = saved ? this.normalize(saved) : this.emptyDoc();
      this.dirty = !!this._read("dirty");
      this.lastSync = this._read("lastSync") || 0;
      this.busy = null; this.again = false; this.timer = null; this.msgs = []; this.rev = 0;
      this.status = { state: "idle", text: "" };
    }

    _read(k) { try { return JSON.parse(localStorage.getItem(`${this.key}.${k}`)); } catch (e) { return null; } }
    _write(k, v) { try { localStorage.setItem(`${this.key}.${k}`, JSON.stringify(v)); } catch (e) { /* private mode */ } }

    get config() { return this._read("config") || { repo: "", token: "" }; }
    set config(c) { this._write("config", c); }
    get connected() { const c = this.config; return !!(c.repo && c.token); }

    _status(state, text) { this.status = { state, text }; if (this.onStatus) this.onStatus(this.status); }

    get items() { return Object.values(this.doc[this.collection]).filter((x) => x && !x.deleted); }
    get(id) { const x = this.doc[this.collection][id]; return x && !x.deleted ? x : null; }

    change(mutate, message) {
      mutate(this.doc);
      this.rev++;
      this.dirty = true;
      this._write("doc", this.doc);
      this._write("dirty", true);
      if (message) this.msgs.push(message);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.sync(), 600);
    }
    put(item, message) {
      item.updatedAt = Date.now();
      this.change((d) => { d[this.collection][item.id] = item; }, message);
    }
    remove(id, message) {
      this.change((d) => { d[this.collection][id] = { id, deleted: true, updatedAt: Date.now() }; }, message);
    }
    setSetting(key, value) {
      this.change((d) => { d.settings[key] = value; d.settings.updatedAt = Date.now(); }, "Settings");
    }
    replaceAll(doc) {
      this.doc = this.merge(this.doc, doc);
      this.rev++; this.dirty = true;
      this._write("doc", this.doc); this._write("dirty", true);
      return this.sync();
    }

    sync() {
      if (!this.connected) { this._status("local", "On this device only"); return Promise.resolve(); }
      if (this.busy) { this.again = true; return this.busy; }
      this.busy = this._sync().finally(() => {
        this.busy = null;
        if (this.again) { this.again = false; this.sync(); }
      });
      return this.busy;
    }

    async _sync() {
      const { repo, token } = this.config;
      const gh = new GitHubFile(repo, token, this.file, this.normalize);
      this._status("syncing", "Syncing");
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const remote = await gh.load();
          const rev = this.rev;
          const before = JSON.stringify(canon(this.doc));
          const merged = this.merge(remote.doc, this.doc);
          if (JSON.stringify(canon(merged)) !== JSON.stringify(canon(remote.doc))) {
            const msgs = this.msgs.splice(0);
            const msg = (msgs.length ? msgs.slice(0, 3).join(", ") + (msgs.length > 3 ? "…" : "") : "Sync") + ` · ${this.device}`;
            try {
              await gh.save(merged, remote.sha, msg);
            } catch (e) {
              this.msgs.unshift(...msgs);
              if (e.kind === "conflict") continue;
              throw e;
            }
          }
          const meanwhile = this.rev !== rev;
          this.doc = this.merge(this.doc, merged);
          this.dirty = meanwhile;
          this._write("doc", this.doc); this._write("dirty", this.dirty);
          this.lastSync = Date.now(); this._write("lastSync", this.lastSync);
          if (before !== JSON.stringify(canon(this.doc)) && this.onChange) this.onChange(this.doc);
          this._status("ok", "Synced");
          if (meanwhile) this.again = true;
          return;
        }
        throw new SyncError("Kept colliding with another device", "network");
      } catch (e) {
        this._status(e.kind === "auth" || e.kind === "missing" ? "error" : "offline", e.message);
      }
    }
  }

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, "0");
  }

  window.DocSync = { Syncer, SyncError, makeDoc, canon, uid };
})();
