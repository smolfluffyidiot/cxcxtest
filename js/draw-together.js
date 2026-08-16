/* name=js/draw-together.js
   Improved Draw Together integration with SESSION_ID-safe storage and migration.

   What this version fixes:
   - NEVER calls core.getStorageKey() while SESSION_ID is uninitialized.
   - When SESSION_ID becomes available later, attempts to migrate any drawings
     saved under the fallback key into the session-scoped key returned by getStorageKey().
   - Uses localforage when available; falls back to localStorage.
   - Defensive, self-contained UI panel (launcher + panel) and drawing engine.
   - Sends drawing messages via addMessage() if available, otherwise falls back to window.messages + renderMessages().
   - Random partner doodles remain, mobile-friendly, and drawings survive reloads.

   Install: replace js/draw-together.js with this file and include it after other scripts.
*/

(function () {
  'use strict';

  // Config
  const CANVAS_W = 800;
  const CANVAS_H = 500;
  const SAFE_SUFFIX = 'canvas_last_drawing_v1';
  const PARTNER_REPLY_PROB = 1;
  const PARTNER_MIN_OBJ = 3;
  const PARTNER_MAX_OBJ = 12;
  const SAVE_DEBOUNCE_MS = 300;
  const SESSION_POLL_INTERVAL = 500; // ms
  const SESSION_POLL_TIMEOUT = 30000; // ms

  // Simple logging helpers
  const log = (...a) => { try { console.info('[DrawTogether]', ...a); } catch (e) {} };
  const warn = (...a) => { try { console.warn('[DrawTogether]', ...a); } catch (e) {} };
  const err = (...a) => { try { console.error('[DrawTogether]', ...a); } catch (e) {} };

  // Storage helpers (localforage preferred)
  function saveItemRaw(key, value) {
    try {
      if (window.localforage) return localforage.setItem(key, value).catch(e => { warn('localforage.setItem failed', e); });
      localStorage.setItem(key, JSON.stringify(value));
      return Promise.resolve();
    } catch (e) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (ee) { warn('localStorage.setItem fallback failed', ee); }
      return Promise.resolve();
    }
  }
  function loadItemRaw(key) {
    try {
      if (window.localforage) return localforage.getItem(key).catch(e => { warn('localforage.getItem failed', e); return null; });
      const raw = localStorage.getItem(key);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch (e) {
      try { const raw2 = localStorage.getItem(key); return Promise.resolve(raw2 ? JSON.parse(raw2) : null); } catch (ee) { warn('loadItemRaw fallback failed', ee); return Promise.resolve(null); }
    }
  }
  function removeItemRaw(key) {
    try {
      if (window.localforage) return localforage.removeItem(key).catch(e => { warn('localforage.removeItem failed', e); });
      localStorage.removeItem(key);
      return Promise.resolve();
    } catch (e) { try { localStorage.removeItem(key); } catch (ee) {} return Promise.resolve(); }
  }

  // Storage key helpers (deferred)
  function fallbackStorageKey() {
    try {
      if (typeof window.APP_PREFIX === 'string' && window.APP_PREFIX.length > 0) return window.APP_PREFIX + SAFE_SUFFIX;
    } catch (e) {}
    return 'app_' + SAFE_SUFFIX;
  }

  // safe attempt to obtain session-scoped key using core.getStorageKey
  function tryGetSessionKey() {
    try {
      if (typeof SESSION_ID === 'undefined' || SESSION_ID === null) return null;
      if (typeof getStorageKey !== 'function') return null;
      try {
        return getStorageKey(SAFE_SUFFIX);
      } catch (e) {
        // core.getStorageKey may throw until SESSION_ID is fully valid; treat as not ready
        warn('getStorageKey threw while trying to compute session key:', e && e.message ? e.message : e);
        return null;
      }
    } catch (e) {
      return null;
    }
  }

  // Compute the effective key to use at call time (session-scoped if available, else fallback)
  function effectiveKey() {
    const k = tryGetSessionKey();
    if (k) return k;
    return fallbackStorageKey();
  }

  // Attempt migration from fallbackKey -> sessionKey when session becomes available
  async function migrateFallbackToSession() {
    const sessionKey = tryGetSessionKey();
    if (!sessionKey) return;
    const fallbackKeyValue = fallbackStorageKey();
    try {
      // check localforage first if available
      if (window.localforage) {
        const fallbackData = await localforage.getItem(fallbackKeyValue).catch(() => null);
        if (fallbackData) {
          // copy to session key
          await localforage.setItem(sessionKey, fallbackData).catch(e => { warn('migrate: setItem failed', e); });
          // remove fallback
          try { await localforage.removeItem(fallbackKeyValue).catch(()=>{}); } catch (_) {}
          // also try to remove from localStorage to keep things tidy
          try { localStorage.removeItem(fallbackKeyValue); } catch (_) {}
          log('Migrated DrawTogether data from fallback to session storage.');
          return;
        }
      }
      // fallback to localStorage
      const raw = localStorage.getItem(fallbackKeyValue);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          // store into localforage if available else localStorage sessionKey
          if (window.localforage) {
            await localforage.setItem(sessionKey, parsed).catch(()=>{});
            // remove fallback localStorage
            try { localStorage.removeItem(fallbackKeyValue); } catch (_) {}
            // also remove fallback localforage if any (redundant)
            try { await localforage.removeItem(fallbackKeyValue).catch(()=>{}); } catch (_) {}
            log('Migrated DrawTogether data from localStorage fallback to localforage session key.');
          } else {
            localStorage.setItem(sessionKey, raw);
            try { localStorage.removeItem(fallbackKeyValue); } catch (_) {}
            log('Migrated DrawTogether data from localStorage fallback to localStorage session key.');
          }
        } catch (e) {
          warn('migrateFallbackToSession: parse failed', e);
        }
      } else {
        // nothing to migrate
      }
    } catch (e) {
      warn('migrateFallbackToSession failed', e);
    }
  }

  // Wait for SESSION_ID/getStorageKey to become available (poll), then call migration once
  function whenSessionReadyThenMigrate() {
    return new Promise(resolve => {
      const sessionKey = tryGetSessionKey();
      if (sessionKey) {
        migrateFallbackToSession().then(()=>resolve());
        return;
      }
      let elapsed = 0;
      const t = setInterval(() => {
        const k = tryGetSessionKey();
        elapsed += SESSION_POLL_INTERVAL;
        if (k || elapsed >= SESSION_POLL_TIMEOUT) {
          clearInterval(t);
          if (k) {
            migrateFallbackToSession().then(()=>resolve());
          } else resolve(); // give up after timeout
        }
      }, SESSION_POLL_INTERVAL);
    });
  }

  // Small helpers used by drawing logic
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function randRange(a,b){ return a + Math.random()*(b-a); }
  function randInt(a,b){ return Math.floor(randRange(a,b+1)); }
  function randomHsl(){ const h=randInt(0,360), s=50+randInt(0,30), l=30+randInt(0,30); return `hsl(${h} ${s}% ${l}%)`; }
  function randomTranslucent(){ const h=randInt(0,360), s=50+randInt(0,30), l=30+randInt(0,30), a=(0.12+Math.random()*0.6).toFixed(2); return `hsla(${h}, ${s}%, ${l}%, ${a})`; }

  // UI (self-contained panel & launcher)
  const STYLE_ID = 'dt-styles';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#dt-launcher { position: fixed; right: 18px; bottom: 18px; width:54px;height:54px;border-radius:50%;background:var(--accent-color,#ff7a6b);border:none;color:#fff;z-index:13000; display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,0.18); cursor:pointer; }
#dt-panel { position: fixed; right: 14px; bottom: 86px; width: 92%; max-width: 920px; z-index: 12500; display:none; }
#dt-panel .dt-container { background:var(--secondary-bg,#fff); border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.24); padding:12px; display:flex; gap:12px; align-items:flex-start; }
#dt-toolbar { width:260px; flex-shrink:0; display:flex; flex-direction:column; gap:8px; }
#dt-canvas-wrap { flex:1; display:flex; flex-direction:column; gap:8px; }
#dt-canvas { width:100%; height:auto; background:#fff; border-radius:6px; box-shadow:0 8px 20px rgba(0,0,0,0.06); touch-action:none; display:block; }
.dt-btn { padding:8px 10px; border-radius:10px; border:none; background:var(--primary-bg,#f3f3f3); cursor:pointer; color:var(--text-primary,#111); }
.dt-btn.primary { background:var(--accent-color,#ff7a6b); color:#fff; }
.dt-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.dt-tools button { width:48%; }
@media (max-width:640px){ #dt-panel { left:8px; right:8px; } #dt-toolbar { width:44%; } }
    `;
    const s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = css; document.head.appendChild(s);
  }

  function buildUI() {
    if (document.getElementById('dt-launcher')) return getUI();
    ensureStyles();
    const launcher = document.createElement('button');
    launcher.id = 'dt-launcher';
    launcher.title = 'Draw Together';
    launcher.innerHTML = '<i class="fas fa-paint-brush" aria-hidden></i>';
    document.body.appendChild(launcher);

    const panel = document.createElement('div');
    panel.id = 'dt-panel';
    panel.innerHTML = `
      <div class="dt-container" role="dialog" aria-label="Draw Together" style="display:flex;">
        <div id="dt-toolbar">
          <div style="font-weight:700;padding:6px 2px;">Draw Together</div>
          <div class="dt-row dt-tools">
            <button class="dt-btn" data-tool="brush">Brush</button>
            <button class="dt-btn" data-tool="eraser">Eraser</button>
            <button class="dt-btn" data-tool="line">Line</button>
            <button class="dt-btn" data-tool="polygon">Polygon</button>
            <button class="dt-btn" data-tool="circle">Circle</button>
            <button class="dt-btn" data-tool="rect">Rect</button>
          </div>
          <div class="dt-row">
            <input id="dt-color" type="color" value="#111111" style="width:46px;height:36px;border:none;">
            <input id="dt-size" type="range" min="1" max="64" value="4" style="flex:1;">
          </div>
          <div class="dt-row">
            <label style="font-size:13px;color:var(--text-secondary,#666)">Polygon sides</label>
            <input id="dt-poly-sides" type="number" min="3" max="12" value="5" style="width:64px;">
          </div>
          <div class="dt-row">
            <button class="dt-btn" id="dt-undo">Undo</button>
            <button class="dt-btn" id="dt-clear">Clear</button>
          </div>
          <div style="margin-top:auto;" class="dt-row">
            <button class="dt-btn primary" id="dt-send">Send to Chat</button>
            <button class="dt-btn" id="dt-close">Close</button>
          </div>
        </div>
        <div id="dt-canvas-wrap">
          <div style="background:var(--primary-bg,#fff);padding:8px;border-radius:8px;">
            <canvas id="dt-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button class="dt-btn" id="dt-new">New</button>
            <div style="align-self:center;font-size:12px;color:var(--text-secondary,#666)">Saved locally</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    return getUI();
  }
  function getUI() {
    return {
      launcher: document.getElementById('dt-launcher'),
      panel: document.getElementById('dt-panel'),
      canvas: document.getElementById('dt-canvas'),
      toolButtons: Array.from(document.querySelectorAll('#dt-toolbar [data-tool]')),
      colorInput: document.getElementById('dt-color'),
      sizeInput: document.getElementById('dt-size'),
      polyInput: document.getElementById('dt-poly-sides'),
      undoBtn: document.getElementById('dt-undo'),
      clearBtn: document.getElementById('dt-clear'),
      sendBtn: document.getElementById('dt-send'),
      closeBtn: document.getElementById('dt-close'),
      newBtn: document.getElementById('dt-new'),
      panelContainer: document.querySelector('#dt-panel .dt-container')
    };
  }

  // Engine factory with safe storage usage
  function createEngine(ui) {
    const canvas = ui.canvas;
    let ctx = null;
    let dpr = Math.max(1, window.devicePixelRatio || 1);

    function setResolution() {
      canvas.width = CANVAS_W * dpr;
      canvas.height = CANVAS_H * dpr;
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      ctx = canvas.getContext('2d', { alpha: true });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // data structures
    let actions = [];
    let undone = [];
    let tempShape = null;
    let isDrawing = false;
    let startPos = null;
    let currentTool = 'brush';
    let currentColor = ui.colorInput ? ui.colorInput.value : '#111111';
    let currentSize = ui.sizeInput ? parseInt(ui.sizeInput.value,10)||4 : 4;
    let polySides = ui.polyInput ? parseInt(ui.polyInput.value,10)||5 : 5;
    let currentStroke = null;
    let saveTimer = null;

    // schedule save using effectiveKey() computed at call time
    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const key = effectiveKey();
          await saveItemRaw(key, { actions, t: Date.now() });
        } catch (e) { warn('scheduleSave failed', e); }
      }, SAVE_DEBOUNCE_MS);
    }

    function pushAction(a) { actions.push(a); undone = []; scheduleSave(); redraw(); }
    function clearAll() { actions = []; undone = []; scheduleSave(); redraw(); }
    function undo() { if (!actions.length) return; undone.push(actions.pop()); scheduleSave(); redraw(); }

    function clientToCanvas(evt) {
      const rect = canvas.getBoundingClientRect();
      const p = evt.touches && evt.touches[0] ? evt.touches[0] : evt;
      const x = (p.clientX - rect.left) * (CANVAS_W / rect.width);
      const y = (p.clientY - rect.top) * (CANVAS_H / rect.height);
      return { x, y };
    }

    function renderAction(c, a, opts) {
      opts = opts || {};
      const preview = !!opts.preview;
      try {
        if (a.type === 'stroke') {
          c.save();
          c.lineCap = 'round'; c.lineJoin = 'round';
          c.lineWidth = a.width || 2;
          if (a.mode === 'eraser') c.globalCompositeOperation = 'destination-out';
          else { c.globalCompositeOperation = 'source-over'; c.strokeStyle = a.color || '#000'; }
          c.beginPath();
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          const pts = a.points || [];
          for (let i=0;i<pts.length;i++){
            const p = pts[i];
            if (i===0) c.moveTo(p.x,p.y); else c.lineTo(p.x,p.y);
          }
          c.stroke();
          c.restore();
        } else if (a.type === 'line') {
          c.save(); c.lineWidth = a.width || 2; c.strokeStyle = a.color || '#000';
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.beginPath(); c.moveTo(a.x1,a.y1); c.lineTo(a.x2,a.y2); c.stroke(); c.restore();
        } else if (a.type === 'rect') {
          c.save(); c.lineWidth = a.width || 2;
          if (a.fill) { c.fillStyle = a.fill; c.fillRect(a.x,a.y,a.w,a.h); }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.strokeStyle = a.color || '#000'; c.strokeRect(a.x,a.y,a.w,a.h); c.restore();
        } else if (a.type === 'circle') {
          c.save(); c.lineWidth = a.width || 2; c.beginPath(); c.arc(a.cx,a.cy,a.r,0,Math.PI*2);
          if (a.fill) { c.fillStyle = a.fill; c.fill(); }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.strokeStyle = a.color || '#000'; c.stroke(); c.restore();
        } else if (a.type === 'polygon') {
          c.save(); c.lineWidth = a.width || 2; c.beginPath();
          const n = Math.max(3, Math.floor(a.sides || 3));
          for (let i=0;i<n;i++){
            const ang = (a.rotation || 0) + (i/n)*Math.PI*2;
            const x = a.cx + Math.cos(ang)*a.r;
            const y = a.cy + Math.sin(ang)*a.r;
            if (i===0) c.moveTo(x,y); else c.lineTo(x,y);
          }
          c.closePath();
          if (a.fill) { c.fillStyle = a.fill; c.fill(); }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.strokeStyle = a.color || '#000'; c.stroke(); c.restore();
        }
      } catch (e) { warn('renderAction error', e, a); }
    }

    function redraw() {
      try {
        ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
        ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,CANVAS_W,CANVAS_H); ctx.restore();
        for (let i=0;i<actions.length;i++) renderAction(ctx, actions[i]);
        if (tempShape) renderAction(ctx, tempShape, { preview:true });
      } catch (e) { warn('redraw error', e); }
    }

    function onDown(e) {
      try { e.preventDefault && e.preventDefault(); } catch (_) {}
      const p = clientToCanvas(e);
      isDrawing = true; startPos = p; tempShape = null;
      if (currentTool === 'brush' || currentTool === 'eraser') {
        currentStroke = { type:'stroke', mode: currentTool === 'eraser' ? 'eraser' : 'brush', color: currentColor, width: currentSize, points: [p] };
        actions.push(currentStroke); scheduleSave(); redraw();
      }
    }
    function onMove(e) {
      if (!isDrawing) return;
      const p = clientToCanvas(e);
      if (currentTool === 'brush' || currentTool === 'eraser') {
        if (!currentStroke) return; currentStroke.points.push(p); redraw();
      } else if (currentTool === 'line') {
        tempShape = { type:'line', x1:startPos.x, y1:startPos.y, x2:p.x, y2:p.y, color: currentColor, width: currentSize }; redraw();
      } else if (currentTool === 'circle') {
        const dx = p.x - startPos.x, dy = p.y - startPos.y; const r = Math.sqrt(dx*dx + dy*dy);
        tempShape = { type:'circle', cx:startPos.x, cy:startPos.y, r, color: currentColor, width: currentSize }; redraw();
      } else if (currentTool === 'rect') {
        const x = Math.min(startPos.x, p.x), y = Math.min(startPos.y, p.y), w = Math.abs(p.x - startPos.x), h = Math.abs(p.y - startPos.y);
        tempShape = { type:'rect', x, y, w, h, color: currentColor, width: currentSize }; redraw();
      } else if (currentTool === 'polygon') {
        const dx = p.x - startPos.x, dy = p.y - startPos.y; const r = Math.sqrt(dx*dx + dy*dy);
        tempShape = { type:'polygon', cx:startPos.x, cy:startPos.y, r, sides: polySides, rotation:0, color: currentColor, width: currentSize }; redraw();
      }
    }
    function onUp(e) {
      if (!isDrawing) return;
      isDrawing = false;
      const p = clientToCanvas(e);
      if (currentTool === 'brush' || currentTool === 'eraser') { currentStroke = null; scheduleSave(); }
      else if (currentTool === 'line') pushAction({ type:'line', x1:startPos.x, y1:startPos.y, x2:p.x, y2:p.y, color: currentColor, width: currentSize });
      else if (currentTool === 'circle') { const dx = p.x - startPos.x, dy = p.y - startPos.y, r = Math.sqrt(dx*dx + dy*dy); pushAction({ type:'circle', cx:startPos.x, cy:startPos.y, r, color: currentColor, width: currentSize }); }
      else if (currentTool === 'rect') { const x = Math.min(startPos.x, p.x), y = Math.min(startPos.y, p.y), w = Math.abs(p.x - startPos.x), h = Math.abs(p.y - startPos.y); pushAction({ type:'rect', x, y, w, h, color: currentColor, width: currentSize }); }
      else if (currentTool === 'polygon') { const dx = p.x - startPos.x, dy = p.y - startPos.y, r = Math.sqrt(dx*dx + dy*dy); pushAction({ type:'polygon', cx:startPos.x, cy:startPos.y, r, sides: polySides, rotation:0, color: currentColor, width: currentSize }); }
      tempShape = null; startPos = null; redraw();
    }

    function attachEvents() {
      try {
        if (window.PointerEvent) {
          canvas.addEventListener('pointerdown', onDown);
          canvas.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        } else {
          canvas.addEventListener('mousedown', onDown);
          canvas.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
          canvas.addEventListener('touchstart', onDown, { passive:false });
          canvas.addEventListener('touchmove', onMove, { passive:false });
          window.addEventListener('touchend', onUp);
        }
      } catch (e) { warn('attachEvents failed', e); }
    }

    async function loadSaved() {
      try {
        // attempt session key first (if available), else fallback
        const sessionKey = tryGetSessionKey();
        if (sessionKey) {
          // try localforage then localStorage
          if (window.localforage) {
            const v = await localforage.getItem(sessionKey).catch(()=>null);
            if (v && Array.isArray(v.actions)) { actions = v.actions.slice(); undone = []; redraw(); return; }
          }
          // fallback to localStorage
          try {
            const raw = localStorage.getItem(sessionKey);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && Array.isArray(parsed.actions)) { actions = parsed.actions.slice(); undone = []; redraw(); return; }
            }
          } catch (e) {}
        }
        // session not ready or session key had nothing — try fallback key
        const fallbackKey = fallbackStorageKey();
        if (window.localforage) {
          const v2 = await localforage.getItem(fallbackKey).catch(()=>null);
          if (v2 && Array.isArray(v2.actions) || (v2 && v2.actions)) { actions = Array.isArray(v2.actions) ? v2.actions.slice() : v2.actions; undone = []; redraw(); return; }
        }
        try {
          const raw2 = localStorage.getItem(fallbackKey);
          if (raw2) {
            const parsed2 = JSON.parse(raw2);
            if (parsed2 && Array.isArray(parsed2.actions)) { actions = parsed2.actions.slice(); undone = []; redraw(); return; }
          }
        } catch (e) {}
        // nothing loaded
        actions = [];
        undone = [];
        redraw();
      } catch (e) {
        warn('loadSaved error', e);
        actions = [];
        undone = [];
        redraw();
      }
    }

    // send snapshot + structured data into chat
    function sendToChat() {
      try {
        const off = document.createElement('canvas'); off.width = CANVAS_W; off.height = CANVAS_H;
        const oc = off.getContext('2d'); oc.fillStyle = '#ffffff'; oc.fillRect(0,0,off.width,off.height);
        for (let i=0;i<actions.length;i++) renderAction(oc, actions[i]);
        const dataUrl = off.toDataURL('image/png');

        const message = { id: Date.now(), sender: 'user', text: '', timestamp: new Date(), image: dataUrl, drawingData: JSON.parse(JSON.stringify(actions||[])), status: 'sent', type: 'drawing' };
        if (typeof addMessage === 'function') {
          try { addMessage(message); } catch (e) { warn('addMessage threw', e); fallbackPush(message); }
        } else {
          fallbackPush(message);
        }
        scheduleSave();
        maybePartnerReply();
      } catch (e) { err('sendToChat failed', e); }
    }

    function fallbackPush(msg) {
      try { window.messages = window.messages || []; window.messages.push(msg); if (typeof renderMessages === 'function') renderMessages(); else log('fallback pushed message; renderMessages missing'); } catch (e) { warn('fallbackPush failed', e); }
    }

    function weightedChoice(items, weights) {
      const total = weights.reduce((s,w)=>s+w,0);
      let r = Math.random()*total;
      for (let i=0;i<items.length;i++){ r -= weights[i]; if (r <= 0) return items[i]; }
      return items[items.length-1];
    }
    function randomDoodleActions() {
      const count = PARTNER_MIN_OBJ + Math.floor(Math.random() * (PARTNER_MAX_OBJ - PARTNER_MIN_OBJ + 1));
      const acts = [];
      for (let i=0;i<count;i++){
        const kind = weightedChoice(['stroke','line','circle','rect','polygon'], [40,20,15,15,10]);
        if (kind === 'stroke') {
          let x = randRange(40, CANVAS_W-40), y = randRange(40, CANVAS_H-40);
          const pts = []; const n = 4 + Math.floor(Math.random()*18);
          for (let j=0;j<n;j++){ x += randRange(-40,40); y += randRange(-40,40); x = clamp(x,10,CANVAS_W-10); y = clamp(y,10,CANVAS_H-10); pts.push({x,y}); }
          acts.push({ type:'stroke', mode:'brush', color: randomHsl(), width: 1 + Math.floor(Math.random()*8), points: pts });
        } else if (kind === 'line') {
          acts.push({ type:'line', x1:randRange(10,CANVAS_W-10), y1:randRange(10,CANVAS_H-10), x2:randRange(10,CANVAS_W-10), y2:randRange(10,CANVAS_H-10), color: randomHsl(), width:1 + Math.floor(Math.random()*6) });
        } else if (kind === 'circle') {
          const cx=randRange(40,CANVAS_W-40), cy=randRange(40,CANVAS_H-40), r=randRange(8, Math.min(140, CANVAS_W/3));
          acts.push({ type:'circle', cx,cy,r, color: randomHsl(), width:1 + Math.floor(Math.random()*6), fill: Math.random()<0.35 ? randomTranslucent() : null });
        } else if (kind === 'rect') {
          const x=randRange(10,CANVAS_W-140), y=randRange(10,CANVAS_H-140), w=randRange(20,180), h=randRange(20,180);
          acts.push({ type:'rect', x,y,w,h, color: randomHsl(), width:1 + Math.floor(Math.random()*6), fill: Math.random()<0.35 ? randomTranslucent() : null });
        } else if (kind === 'polygon') {
          const cx=randRange(40,CANVAS_W-40), cy=randRange(40,CANVAS_H-40), r=randRange(12,120), sides = 3 + Math.floor(Math.random()*6);
          acts.push({ type:'polygon', cx,cy,r,sides, rotation: Math.random()*Math.PI*2, color: randomHsl(), width:1 + Math.floor(Math.random()*6), fill: Math.random()<0.35 ? randomTranslucent() : null });
        }
      }
      return acts;
    }

    function maybePartnerReply() {
      if (Math.random() > PARTNER_REPLY_PROB) return;
      const delay = 800 + Math.random()*2200;
      setTimeout(() => {
        const acts = randomDoodleActions();
        const off = document.createElement('canvas'); off.width = CANVAS_W; off.height = CANVAS_H;
        const oc = off.getContext('2d'); oc.fillStyle = '#fff'; oc.fillRect(0,0,off.width,off.height);
        for (let i=0;i<acts.length;i++) renderAction(oc, acts[i]);
        const url = off.toDataURL('image/png');
        const msg = { id: Date.now()+1, sender:'partner', text:'', timestamp: new Date(), image: url, drawingData: acts, status: 'sent', type: 'drawing' };
        if (typeof addMessage === 'function') {
          try { addMessage(msg); } catch (e) { warn('addMessage partner failed', e); fallbackPush(msg); }
        } else fallbackPush(msg);
      }, delay);
    }

    function wireUI(ui) {
      try {
        ui.toolButtons.forEach(btn => btn.addEventListener('click', ()=> {
          ui.toolButtons.forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentTool = btn.dataset.tool || 'brush';
        }));
        ui.colorInput && ui.colorInput.addEventListener('input', (e)=> { currentColor = e.target.value; });
        ui.sizeInput && ui.sizeInput.addEventListener('input', (e)=> { currentSize = parseInt(e.target.value,10) || 4; });
        ui.polyInput && ui.polyInput.addEventListener('change', (e)=> { polySides = Math.max(3, Math.min(12, parseInt(e.target.value,10)||5)); });
        ui.undoBtn && ui.undoBtn.addEventListener('click', ()=> undo());
        ui.clearBtn && ui.clearBtn.addEventListener('click', ()=> { if (confirm('Clear canvas?')) clearAll(); });
        ui.newBtn && ui.newBtn.addEventListener('click', ()=> { if (confirm('New canvas?')) clearAll(); });
        ui.sendBtn && ui.sendBtn.addEventListener('click', ()=> sendToChat());
        ui.closeBtn && ui.closeBtn.addEventListener('click', ()=> { ui.panel.style.display = 'none'; scheduleSave(); });
      } catch (e) { warn('wireUI failed', e); }
    }

    // public API
    return {
      init: function() { setResolution(); attachEvents(); wireUI(ui); return loadSaved(); },
      redraw: redraw,
      undo,
      clearAll,
      sendToChat
    };
  }

  // Expose fallback push for engine use
  function fallbackPush(msg) {
    try { window.messages = window.messages || []; window.messages.push(msg); if (typeof renderMessages === 'function') renderMessages(); else log('fallback pushed message; renderMessages missing'); } catch (e) { warn('fallbackPush failed', e); }
  }

  // Startup orchestration: build UI, create engine, migrate when session ready
  function ready(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(fn, 20);
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  ready(async () => {
    try {
      const ui = buildUI();
      if (!ui || !ui.canvas) { warn('UI build failed'); return; }
      ui.launcher.addEventListener('click', ()=> { ui.panel.style.display = (ui.panel.style.display === 'block') ? 'none' : 'block'; });

      // Attempt migration when SESSION_ID becomes ready (non-blocking)
      whenSessionReadyThenMigrate().then(()=> {
        // after migration attempt, continue (engine will load saved from effective key)
      }).catch(e=> warn('session migration error', e));

      // Create engine with the UI object closure variable available (engine uses effectiveKey() each save)
      const engine = createEngine(ui);
      if (engine && typeof engine.init === 'function') {
        engine.init().then(()=> {
          log('Draw Together initialized and canvas loaded.');
        }).catch(e => { warn('engine.init failed', e); });
      }

      window.__drawTogether = window.__drawTogether || {};
      window.__drawTogether.engine = engine;

      log('Draw Together ready (will migrate fallback storage when SESSION_ID becomes available).');
    } catch (e) {
      err('Draw Together startup error', e && e.stack ? e.stack : e);
    }
  });

  // Manual init for debugging
  window.drawTogetherInit = function(){ try { const ui = buildUI(); const engine = createEngine(ui); engine && engine.init(); } catch(e){ err('manual init failed', e); } };

})();
