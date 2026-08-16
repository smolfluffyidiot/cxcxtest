/**
 * draw-together.js
 * Robust, defensive Draw Together integration for cxcxtest
 *
 * - Makes few assumptions about existing globals; works if functions like addMessage/renderMessages/showModal/hideModal exist,
 *   but will gracefully fallback if they don't.
 * - If the expected modal/canvas DOM is missing, creates a compatible modal dynamically.
 * - Uses localforage when available, falls back to localStorage.
 * - Uses pointer events with touch/mouse fallbacks; mobile friendly.
 * - Stores structured drawing actions and persists them so canvases survive reloads.
 * - Produces user-sent drawing messages via addMessage when available; otherwise updates `messages` and calls renderMessages.
 * - Random partner doodles created with primitives; no templates.
 *
 * Install: add <script src="js/draw-together.js"></script> after other scripts or include it at the end of config.html.
 *
 * If you still see "module load failed" in console, open DevTools Console and copy the first error here; I'll debug.
 */
(function () {
  'use strict';

  // -----------------------
  // Configuration
  // -----------------------
  const CANVAS_W = 800;
  const CANVAS_H = 500;
  const STORAGE_KEY_SUFFIX = 'canvas_last_drawing_v1';
  const PARTNER_DRAW_PROBABILITY = 1; // chance partner replies after user sends
  const PARTNER_MIN_OBJECTS = 3;
  const PARTNER_MAX_OBJECTS = 12;
  const SAVE_DEBOUNCE_MS = 300;

  // -----------------------
  // Utilities & safe wrappers
  // -----------------------
  function log(...args) { try { console.info('[DrawTogether]', ...args); } catch (e) {} }
  function warn(...args) { try { console.warn('[DrawTogether]', ...args); } catch (e) {} }
  function error(...args) { try { console.error('[DrawTogether]', ...args); } catch (e) {} }

  function safeCall(fn, ...args) {
    try {
      if (typeof fn === 'function') return fn(...args);
    } catch (e) {
      error('safeCall error', e);
    }
    return null;
  }

  function whenDOMReady(cb) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(cb, 20);
    } else {
      document.addEventListener('DOMContentLoaded', cb, { once: true });
    }
  }

  // Storage helpers: prefer localforage if available
  function storageKey() {
    try {
      if (typeof getStorageKey === 'function') return getStorageKey(STORAGE_KEY_SUFFIX);
    } catch (e) {}
    try {
      if (typeof window.APP_PREFIX === 'string') return window.APP_PREFIX + STORAGE_KEY_SUFFIX;
    } catch (e) {}
    return 'app_' + STORAGE_KEY_SUFFIX;
  }

  function saveData(key, value) {
    try {
      if (window.localforage) return localforage.setItem(key, value).catch(e => { warn('localforage.setItem failed', e); });
      localStorage.setItem(key, JSON.stringify(value));
      return Promise.resolve();
    } catch (e) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (ee) { warn('fallback save failed', ee); }
      return Promise.resolve();
    }
  }
  function loadData(key) {
    try {
      if (window.localforage) return localforage.getItem(key).catch(e => { warn('localforage.getItem failed', e); return null; });
      const raw = localStorage.getItem(key);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch (e) {
      try { const raw = localStorage.getItem(key); return Promise.resolve(raw ? JSON.parse(raw) : null); } catch (ee) { warn('fallback load failed', ee); return Promise.resolve(null); }
    }
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function randRange(a,b) { return a + Math.random() * (b-a); }
  function randInt(a,b) { return Math.floor(randRange(a,b+1)); }
  function randomColorHsl() {
    const h = randInt(0, 360);
    const s = randInt(45, 80);
    const l = randInt(30, 60);
    return `hsl(${h} ${s}% ${l}%)`;
  }
  function randomTranslucent() {
    const h = randInt(0,360), s=randInt(45,80), l=randInt(30,70), a = (0.12 + Math.random()*0.5).toFixed(2);
    return `hsla(${h}, ${s}%, ${l}%, ${a})`;
  }

  // -----------------------
  // DOM: create or get modal & canvas
  // -----------------------
  function ensureModalElements() {
    // Try to reuse existing elements by ID first
    let modal = document.getElementById('canvas-modal');
    let canvas = document.getElementById('drawing-canvas');
    let toolbar = document.getElementById('canvas-toolbar');
    let sendBtn = document.getElementById('canvas-send-to-chat');
    let newBtn = document.getElementById('canvas-new');
    let undoBtn = document.getElementById('canvas-undo');
    let clearBtn = document.getElementById('canvas-clear');
    let closeBtn = document.getElementById('canvas-save-close');
    let lockInput = document.getElementById('canvas-private-lock');

    if (modal && canvas && toolbar) {
      return { modal, canvas, toolbar, sendBtn, newBtn, undoBtn, clearBtn, closeBtn, lockInput };
    }

    // If not present, create a lightweight modal and insert near end of body
    modal = modal || document.createElement('div');
    modal.id = 'canvas-modal';
    modal.className = 'modal';
    modal.style.zIndex = 2200;
    modal.style.display = 'none';

    // Build inner structure similar to expected markup but compact
    modal.innerHTML = `
      <div class="modal-content" style="max-width:920px;width:calc(100% - 40px);padding:0;background:transparent;">
        <div style="background:var(--secondary-bg);border-radius:12px;overflow:hidden;">
          <div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid var(--border-color);">
            <div style="font-weight:600;">Draw Together · 画布</div>
            <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
              <button id="canvas-send-to-chat" class="modal-btn modal-btn-primary">Send to Chat</button>
              <button id="canvas-save-close" class="modal-btn modal-btn-secondary">Close</button>
            </div>
          </div>

          <div style="display:flex;gap:12px;padding:12px;flex-wrap:wrap;">
            <div id="canvas-toolbar" style="width:260px;flex-shrink:0;"></div>

            <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
              <div style="background:var(--primary-bg);border-radius:8px;padding:8px;display:flex;justify-content:center;align-items:center;">
                <canvas id="drawing-canvas" width="${CANVAS_W}" height="${CANVAS_H}" style="max-width:100%;height:auto;background:#fff;border-radius:6px;box-shadow:0 8px 20px rgba(0,0,0,0.06);"></canvas>
              </div>
              <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;">
                <button id="canvas-new" class="modal-btn">New</button>
                <button id="canvas-undo" class="modal-btn">Undo</button>
                <button id="canvas-clear" class="modal-btn">Clear</button>
                <label style="display:flex;align-items:center;gap:8px;margin-left:12px;font-size:13px;color:var(--text-secondary);">
                  <input type="checkbox" id="canvas-private-lock" style="pointer-events:none;"> 已锁定（到期后不可编辑）
                </label>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;

    // append to body
    try {
      document.body.appendChild(modal);
    } catch (e) {
      warn('failed to append modal to body', e);
    }

    // reselect created elements
    modal = document.getElementById('canvas-modal');
    canvas = document.getElementById('drawing-canvas');
    toolbar = document.getElementById('canvas-toolbar');
    sendBtn = document.getElementById('canvas-send-to-chat');
    newBtn = document.getElementById('canvas-new');
    undoBtn = document.getElementById('canvas-undo');
    clearBtn = document.getElementById('canvas-clear');
    closeBtn = document.getElementById('canvas-save-close');
    lockInput = document.getElementById('canvas-private-lock');

    return { modal, canvas, toolbar, sendBtn, newBtn, undoBtn, clearBtn, closeBtn, lockInput };
  }

  // -----------------------
  // Core canvas logic
  // -----------------------
  function makeDrawModule(elements) {
    const modal = elements.modal;
    const canvasEl = elements.canvas;
    const toolbarWrap = elements.toolbar;
    const sendBtn = elements.sendBtn;
    const newBtn = elements.newBtn;
    const undoBtn = elements.undoBtn;
    const clearBtn = elements.clearBtn;
    const closeBtn = elements.closeBtn;
    const lockInput = elements.lockInput;

    let ctx = null;
    let actions = []; // structured actions
    let undone = [];
    let tempShape = null;
    let pointerDown = false;
    let pointerStart = null;
    let currentTool = 'brush';
    let color = '#111111';
    let size = 4;
    let polygonSides = 5;
    let saveTimer = null;

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const payload = { version: 1, actions, updatedAt: Date.now() };
        saveData(storageKey(), payload).then(() => {
          try { if (typeof throttledSaveData === 'function') throttledSaveData(); } catch (_) {}
        });
      }, SAVE_DEBOUNCE_MS);
    }

    function setCanvasResolution() {
      // Keep internal backing store constant; element uses CSS to be responsive
      const dpr = window.devicePixelRatio || 1;
      canvasEl.width = CANVAS_W * dpr;
      canvasEl.height = CANVAS_H * dpr;
      canvasEl.style.width = '100%';
      canvasEl.style.height = 'auto';
      ctx = canvasEl.getContext('2d', { alpha: true });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function clearAndRender() {
      if (!ctx) return;
      ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
      // white background
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
      ctx.restore();

      for (const a of actions) drawAction(ctx, a);
      if (tempShape) drawAction(ctx, tempShape, { preview: true });
    }

    function drawAction(c, a, opts = {}) {
      if (!c || !a) return;
      const preview = !!opts.preview;
      if (a.type === 'stroke') {
        c.save();
        if (a.mode === 'eraser') {
          c.globalCompositeOperation = 'destination-out';
        } else {
          c.globalCompositeOperation = 'source-over';
          c.strokeStyle = a.color || '#000';
        }
        c.lineWidth = a.width || 2;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        for (let i=0;i<a.points.length;i++){
          const p = a.points[i];
          if (i===0) c.moveTo(p.x, p.y);
          else c.lineTo(p.x, p.y);
        }
        if (preview) c.setLineDash([6,6]);
        c.stroke();
        c.restore();
      } else if (a.type === 'line') {
        c.save();
        c.strokeStyle = a.color || '#000';
        c.lineWidth = a.width || 2;
        c.beginPath();
        c.moveTo(a.x1, a.y1);
        c.lineTo(a.x2, a.y2);
        if (preview) c.setLineDash([6,6]);
        c.stroke();
        c.restore();
      } else if (a.type === 'rect') {
        c.save();
        c.lineWidth = a.width || 2;
        if (a.fill) { c.fillStyle = a.fill; c.fillRect(a.x, a.y, a.w, a.h); }
        if (preview) c.setLineDash([6,6]);
        c.strokeStyle = a.color || '#000';
        c.strokeRect(a.x, a.y, a.w, a.h);
        c.restore();
      } else if (a.type === 'circle') {
        c.save();
        c.lineWidth = a.width || 2;
        c.beginPath();
        c.arc(a.cx, a.cy, a.r, 0, Math.PI*2);
        if (a.fill) { c.fillStyle = a.fill; c.fill(); }
        if (preview) c.setLineDash([6,6]);
        c.strokeStyle = a.color || '#000';
        c.stroke();
        c.restore();
      } else if (a.type === 'polygon') {
        c.save();
        c.lineWidth = a.width || 2;
        const n = Math.max(3, Math.floor(a.sides||3));
        c.beginPath();
        for (let i=0;i<n;i++){
          const ang = (a.rotation || 0) + (i / n) * Math.PI * 2;
          const x = a.cx + Math.cos(ang) * a.r;
          const y = a.cy + Math.sin(ang) * a.r;
          if (i===0) c.moveTo(x,y); else c.lineTo(x,y);
        }
        c.closePath();
        if (a.fill) { c.fillStyle = a.fill; c.fill(); }
        if (preview) c.setLineDash([6,6]);
        c.strokeStyle = a.color || '#000';
        c.stroke();
        c.restore();
      }
    }

    // Coordinate conversion: convert pointer client coords to canvas logical coords
    function getPosFromEvent(ev) {
      const rect = canvasEl.getBoundingClientRect();
      const p = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      const x = (p.clientX - rect.left) * (CANVAS_W / rect.width);
      const y = (p.clientY - rect.top) * (CANVAS_H / rect.height);
      return { x, y };
    }

    // Pointer handlers (use pointer events if available)
    let currentStroke = null;

    function pointerDownHandler(ev) {
      try {
        ev.preventDefault();
      } catch (e) {}
      const pos = getPosFromEvent(ev);
      pointerDown = true;
      pointerStart = pos;
      tempShape = null;

      if (currentTool === 'brush' || currentTool === 'eraser') {
        currentStroke = {
          type: 'stroke',
          mode: currentTool === 'eraser' ? 'eraser' : 'brush',
          color: color,
          width: size,
          points: [pos]
        };
        actions.push(currentStroke);
        scheduleSave();
        clearAndRender();
      } else {
        // shapes: we'll preview with tempShape and add on pointerup
        tempShape = null;
      }
    }

    function pointerMoveHandler(ev) {
      if (!pointerDown) return;
      ev.preventDefault && ev.preventDefault();
      const pos = getPosFromEvent(ev);

      if (currentTool === 'brush' || currentTool === 'eraser') {
        if (!currentStroke) return;
        currentStroke.points.push(pos);
        // incremental render: redraw
        clearAndRender();
      } else if (currentTool === 'line') {
        tempShape = { type: 'line', x1: pointerStart.x, y1: pointerStart.y, x2: pos.x, y2: pos.y, color, width: size };
        clearAndRender();
      } else if (currentTool === 'circle') {
        const dx = pos.x - pointerStart.x;
        const dy = pos.y - pointerStart.y;
        const r = Math.sqrt(dx*dx + dy*dy);
        tempShape = { type: 'circle', cx: pointerStart.x, cy: pointerStart.y, r, color, width: size };
        clearAndRender();
      } else if (currentTool === 'rect') {
        const x = Math.min(pointerStart.x, pos.x);
        const y = Math.min(pointerStart.y, pos.y);
        const w = Math.abs(pos.x - pointerStart.x);
        const h = Math.abs(pos.y - pointerStart.y);
        tempShape = { type: 'rect', x, y, w, h, color, width: size };
        clearAndRender();
      } else if (currentTool === 'polygon') {
        const dx = pos.x - pointerStart.x;
        const dy = pos.y - pointerStart.y;
        const r = Math.sqrt(dx*dx + dy*dy);
        tempShape = { type: 'polygon', cx: pointerStart.x, cy: pointerStart.y, r, sides: polygonSides, rotation: 0, color, width: size };
        clearAndRender();
      }
    }

    function pointerUpHandler(ev) {
      if (!pointerDown) return;
      pointerDown = false;
      const pos = getPosFromEvent(ev);

      if (currentTool === 'brush' || currentTool === 'eraser') {
        // already pushed points to currentStroke
        currentStroke = null;
        scheduleSave();
      } else if (currentTool === 'line') {
        const act = { type: 'line', x1: pointerStart.x, y1: pointerStart.y, x2: pos.x, y2: pos.y, color, width: size };
        actions.push(act); scheduleSave();
      } else if (currentTool === 'circle') {
        const dx = pos.x - pointerStart.x; const dy = pos.y - pointerStart.y;
        const r = Math.sqrt(dx*dx + dy*dy);
        const act = { type: 'circle', cx: pointerStart.x, cy: pointerStart.y, r, color, width: size };
        actions.push(act); scheduleSave();
      } else if (currentTool === 'rect') {
        const x = Math.min(pointerStart.x, pos.x);
        const y = Math.min(pointerStart.y, pos.y);
        const w = Math.abs(pos.x - pointerStart.x);
        const h = Math.abs(pos.y - pointerStart.y);
        const act = { type: 'rect', x, y, w, h, color, width: size };
        actions.push(act); scheduleSave();
      } else if (currentTool === 'polygon') {
        const dx = pos.x - pointerStart.x; const dy = pos.y - pointerStart.y;
        const r = Math.sqrt(dx*dx + dy*dy);
        const act = { type: 'polygon', cx: pointerStart.x, cy: pointerStart.y, r, sides: polygonSides, rotation: 0, color, width: size };
        actions.push(act); scheduleSave();
      }
      tempShape = null;
      pointerStart = null;
      clearAndRender();
    }

    function attachPointerListeners() {
      // Use pointer events when available for unified handling
      if (window.PointerEvent) {
        canvasEl.addEventListener('pointerdown', pointerDownHandler);
        canvasEl.addEventListener('pointermove', pointerMoveHandler);
        window.addEventListener('pointerup', pointerUpHandler);
      } else {
        // fallback to mouse & touch
        canvasEl.addEventListener('mousedown', pointerDownHandler);
        canvasEl.addEventListener('mousemove', pointerMoveHandler);
        window.addEventListener('mouseup', pointerUpHandler);

        canvasEl.addEventListener('touchstart', pointerDownHandler, { passive: false });
        canvasEl.addEventListener('touchmove', pointerMoveHandler, { passive: false });
        window.addEventListener('touchend', pointerUpHandler);
      }

      // Prevent page scrolling when interacting with the canvas on touch devices
      canvasEl.addEventListener('touchstart', function (e) { e.preventDefault && e.preventDefault(); }, { passive: false });
    }

    // Toolbar creation (keeps simple, uses existing modal-btn classes if present)
    function buildToolbarUI() {
      if (!toolbarWrap) return;
      toolbarWrap.innerHTML = '';

      // Tools grid
      const tools = [
        { id: 'brush', label: 'Brush', icon: 'fas fa-pencil-alt' },
        { id: 'eraser', label: 'Eraser', icon: 'fas fa-eraser' },
        { id: 'line', label: 'Line', icon: 'fas fa-slash' },
        { id: 'polygon', label: 'Polygon', icon: 'fas fa-draw-polygon' },
        { id: 'circle', label: 'Circle', icon: 'fas fa-circle' },
        { id: 'rect', label: 'Rect', icon: 'far fa-square' }
      ];

      const toolContainer = document.createElement('div');
      toolContainer.style.display = 'flex';
      toolContainer.style.flexWrap = 'wrap';
      toolContainer.style.gap = '8px';

      tools.forEach(t => {
        const b = document.createElement('button');
        b.className = 'modal-btn';
        b.type = 'button';
        b.dataset.tool = t.id;
        b.title = t.label;
        b.style.flex = '1 0 46%';
        b.style.display = 'flex';
        b.style.alignItems = 'center';
        b.style.justifyContent = 'center';
        try { b.innerHTML = `<i class="${t.icon}"></i>`; } catch(e) { b.textContent = t.label; }
        b.addEventListener('click', () => {
          currentTool = t.id;
          // UI highlight
          toolContainer.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
          b.classList.add('active');
        });
        toolContainer.appendChild(b);
      });

      // color + size
      const colorRow = document.createElement('div');
      colorRow.style.marginTop = '10px';
      colorRow.style.display = 'flex';
      colorRow.style.flexDirection = 'column';
      colorRow.style.gap = '8px';

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = color;
      colorInput.title = 'Color';
      colorInput.style.width = '44px';
      colorInput.addEventListener('input', (e)=> { color = e.target.value; });

      const sizeLabel = document.createElement('div');
      sizeLabel.style.fontSize = '12px';
      sizeLabel.style.color = 'var(--text-secondary)';
      sizeLabel.textContent = `Size: ${size}px`;

      const sizeInput = document.createElement('input');
      sizeInput.type = 'range';
      sizeInput.min = 1; sizeInput.max = 64;
      sizeInput.value = size;
      sizeInput.addEventListener('input', (e) => { size = parseInt(e.target.value,10); sizeLabel.textContent = `Size: ${size}px`; });

      // polygon sides
      const polyRow = document.createElement('div');
      polyRow.style.display = 'flex'; polyRow.style.gap = '8px'; polyRow.style.alignItems = 'center';
      const polyLabel = document.createElement('div'); polyLabel.style.fontSize = '12px'; polyLabel.style.color = 'var(--text-secondary)'; polyLabel.textContent = 'Polygon sides:';
      const polyInput = document.createElement('input'); polyInput.type='number'; polyInput.min=3; polyInput.max=12; polyInput.value=polygonSides; polyInput.style.width='64px';
      polyInput.addEventListener('change', (e)=>{ polygonSides = clamp(parseInt(e.target.value,10)||5,3,12); polyInput.value = polygonSides; });

      polyRow.appendChild(polyLabel); polyRow.appendChild(polyInput);

      colorRow.appendChild(colorInput);
      colorRow.appendChild(sizeInput);
      colorRow.appendChild(sizeLabel);
      colorRow.appendChild(polyRow);

      toolbarWrap.appendChild(toolContainer);
      toolbarWrap.appendChild(colorRow);

      // activate brush as default
      setTimeout(() => {
        const b = toolContainer.querySelector('button[data-tool="brush"]');
        if (b) b.classList.add('active');
      }, 20);
    }

    // Undo / Redo / Clear operations
    function undo() {
      if (!actions.length) return;
      const a = actions.pop();
      undone.push(a);
      scheduleSave();
      clearAndRender();
    }
    function redo() {
      if (!undone.length) return;
      const a = undone.pop();
      actions.push(a);
      scheduleSave();
      clearAndRender();
    }
    function clear() {
      if (!confirm('Clear canvas?')) return;
      actions = []; undone = [];
      scheduleSave();
      clearAndRender();
    }
    function newCanvas() {
      if (!confirm('Create new canvas? Current drawing will be cleared.')) return;
      actions = []; undone = [];
      scheduleSave();
      clearAndRender();
    }
    // wire UI buttons if present
    function wireButtons() {
      if (undoBtn) undoBtn.addEventListener('click', undo);
      if (clearBtn) clearBtn.addEventListener('click', clear);
      if (newBtn) newBtn.addEventListener('click', newCanvas);
      if (closeBtn) closeBtn.addEventListener('click', () => {
        try { if (typeof hideModal === 'function') hideModal(modal); else modal.style.display = 'none'; } catch (e) { modal.style.display = 'none'; }
        scheduleSave();
      });
    }

    // Send to chat: snapshot + structured data
    function sendToChat() {
      try {
        // Render actions into a fresh offscreen canvas of CANVAS_W x CANVAS_H
        const off = document.createElement('canvas');
        off.width = CANVAS_W; off.height = CANVAS_H;
        const c = off.getContext('2d');
        c.fillStyle = '#ffffff'; c.fillRect(0,0,off.width,off.height);
        for (const a of actions) drawAction(c, a);
        const dataUrl = off.toDataURL('image/png');

        const message = {
          id: Date.now(),
          sender: 'user',
          text: '',
          timestamp: new Date(),
          image: dataUrl,
          drawingData: JSON.parse(JSON.stringify(actions || [])),
          status: 'sent',
          type: 'drawing'
        };

        // Prefer addMessage global if exists
        if (typeof addMessage === 'function') {
          try { addMessage(message); } catch (e) { warn('addMessage error', e); fallbackPush(message); }
        } else {
          fallbackPush(message);
        }

        // Save current canvas to storage
        scheduleSave();

        // Close modal
        try { if (typeof hideModal === 'function') hideModal(modal); else modal.style.display = 'none'; } catch (e) { modal.style.display = 'none'; }

        // Possibly generate partner doodle in response
        maybePartnerReply();

      } catch (e) { error('sendToChat error', e); }
    }

    function fallbackPush(msg) {
      try {
        if (!Array.isArray(window.messages)) window.messages = [];
        window.messages.push(msg);
        if (typeof renderMessages === 'function') renderMessages();
        else log('message pushed (renderMessages not available)');
      } catch (e) { warn('fallbackPush failed', e); }
    }

    // Partner doodle generator (random primitives)
    function weightedChoice(items, weights) {
      const total = weights.reduce((s,w)=>s+w,0);
      let r = Math.random()*total;
      for (let i=0;i<items.length;i++){
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[items.length-1];
    }

    function randomDoodleActions() {
      const count = PARTNER_MIN_OBJECTS + Math.floor(Math.random() * (PARTNER_MAX_OBJECTS - PARTNER_MIN_OBJECTS + 1));
      const acts = [];
      for (let i=0;i<count;i++){
        const kind = weightedChoice(['stroke','line','circle','rect','polygon'], [40,20,15,15,10]);
        if (kind === 'stroke') {
          const pts = [];
          let x = randRange(40, CANVAS_W-40), y = randRange(40, CANVAS_H-40);
          const n = 4 + Math.floor(Math.random()*20);
          for (let j=0;j<n;j++){
            x += randRange(-40,40);
            y += randRange(-40,40);
            x = clamp(x, 10, CANVAS_W-10);
            y = clamp(y, 10, CANVAS_H-10);
            pts.push({ x, y });
          }
          acts.push({ type: 'stroke', mode: 'brush', color: randomColorHsl(), width: 1 + Math.floor(Math.random()*8), points: pts });
        } else if (kind === 'line') {
          acts.push({ type: 'line', x1: randRange(10, CANVAS_W-10), y1: randRange(10, CANVAS_H-10), x2: randRange(10, CANVAS_W-10), y2: randRange(10, CANVAS_H-10), color: randomColorHsl(), width: 1 + Math.floor(Math.random()*6) });
        } else if (kind === 'circle') {
          const cx = randRange(40, CANVAS_W-40), cy = randRange(40, CANVAS_H-40), r = randRange(8, Math.min(140, CANVAS_W/3));
          acts.push({ type: 'circle', cx, cy, r, color: randomColorHsl(), width: 1 + Math.floor(Math.random()*6), fill: Math.random() < 0.35 ? randomTranslucent() : null });
        } else if (kind === 'rect') {
          const x = randRange(10, CANVAS_W-140), y = randRange(10, CANVAS_H-140), w = randRange(20, 180), h = randRange(20, 180);
          acts.push({ type: 'rect', x, y, w, h, color: randomColorHsl(), width: 1 + Math.floor(Math.random()*6), fill: Math.random() < 0.35 ? randomTranslucent() : null });
        } else if (kind === 'polygon') {
          const cx = randRange(40, CANVAS_W-40), cy = randRange(40, CANVAS_H-40), r = randRange(12, 120), sides = 3 + Math.floor(Math.random()*6);
          acts.push({ type: 'polygon', cx, cy, r, sides, rotation: Math.random()*Math.PI*2, color: randomColorHsl(), width: 1 + Math.floor(Math.random()*6), fill: Math.random() < 0.35 ? randomTranslucent() : null });
        }
      }
      return acts;
    }

    function maybePartnerReply() {
      try {
        if (Math.random() > PARTNER_DRAW_PROBABILITY) return;
        const delay = 800 + Math.random()*2200;
        setTimeout(() => {
          const acts = randomDoodleActions();
          // render to dataURL
          const off = document.createElement('canvas'); off.width = CANVAS_W; off.height = CANVAS_H;
          const c = off.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0,0,off.width,off.height);
          for (const a of acts) drawAction(c, a);
          const url = off.toDataURL('image/png');

          const msg = { id: Date.now()+1, sender: 'partner', text: '', timestamp: new Date(), image: url, drawingData: acts, status: 'sent', type: 'drawing' };
          if (typeof addMessage === 'function') {
            try { addMessage(msg); } catch (e) { warn('addMessage partner error', e); fallbackPush(msg); }
          } else { fallbackPush(msg); }
        }, delay);
      } catch (e) { warn('maybePartnerReply error', e); }
    }

    // load saved actions
    function loadSaved() {
      loadData(storageKey()).then(payload => {
        if (!payload || !Array.isArray(payload.actions)) return;
        actions = payload.actions.slice();
        undone = [];
        clearAndRender();
      }).catch(e => warn('loadSaved failed', e));
    }

    function attachUiHandlers() {
      // open/close modal logic: use showModal/hideModal if available
      // We'll attach a launcher button near attachment button if possible
      try {
        if (!document.getElementById('canvas-btn-launcher')) {
          const attachBtn = document.getElementById('attachment-btn');
          const launcher = document.createElement('button');
          launcher.id = 'canvas-btn-launcher';
          launcher.className = 'attachment-btn input-btn collapse-hideable';
          launcher.title = '画布 (Draw)';
          launcher.style.marginRight = '6px';
          launcher.innerHTML = '<i class="fas fa-pencil-alt"></i>';
          launcher.addEventListener('click', () => {
            try { if (typeof showModal === 'function') showModal(modal); else modal.style.display = 'flex'; } catch (e) { modal.style.display = 'flex'; }
            setTimeout(() => { setCanvasResolution(); clearAndRender(); loadSaved(); }, 50);
          });
          if (attachBtn && attachBtn.parentNode) attachBtn.parentNode.insertBefore(launcher, attachBtn);
          else {
            const inputButtons = document.querySelector('.input-buttons');
            if (inputButtons) inputButtons.insertBefore(launcher, inputButtons.firstChild || null);
            else document.body.appendChild(launcher);
          }
        }
      } catch (e) { warn('attachUiHandlers launcher error', e); }

      // wire send / close
      if (sendBtn) sendBtn.addEventListener('click', sendToChat);
      if (closeBtn) closeBtn.addEventListener('click', () => { try { if (typeof hideModal === 'function') hideModal(modal); else modal.style.display = 'none'; } catch(e){ modal.style.display = 'none'; } scheduleSave(); });

      // keyboard shortcuts for convenience
      window.addEventListener('keydown', (ev) => {
        if (!modal || (modal && modal.style.display === 'none')) return;
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); }
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); }
      });

      // wire undo/clear/new if not wired above
      if (undoBtn) undoBtn.addEventListener('click', undo);
      if (clearBtn) clearBtn.addEventListener('click', clear);
      if (newBtn) newBtn.addEventListener('click', newCanvas);
    }

    // init module
    function init() {
      try {
        setCanvasResolution();
        buildToolbarUI();
        attachPointerListeners();
        wireButtons();
        attachUiHandlers();
        loadSaved();
        // initial render after small delay to ensure CSS applied
        setTimeout(() => clearAndRender(), 80);
        window.addEventListener('resize', () => { setCanvasResolution(); clearAndRender(); });
      } catch (e) { error('draw module init failed', e); }
    }

    // expose a few helpers for debugging
    return { init, getActions: () => actions, setTool: (t) => { currentTool = t; }, getCanvasElement: () => canvasEl };
  }

  // -----------------------
  // Bootstrap sequence (defensive)
  // -----------------------
  function boot() {
    try {
      const elements = ensureModalElements();
      const module = makeDrawModule(elements);
      module.init();
      log('Draw Together loaded successfully');
      // attach to window for manual debugging/usage
      window.__drawTogether = window.__drawTogether || {};
      window.__drawTogether.module = module;
    } catch (e) {
      error('Draw Together bootstrap failed', e);
    }
  }

  // Run when DOM ready
  whenDOMReady(() => {
    try {
      boot();
    } catch (e) {
      error('Draw Together top-level error', e);
    }
  });

  // Global error hint: catch errors thrown asynchronously and log clearer message
  window.addEventListener('error', function(evt) {
    try {
      // If error mentions draw-together.js or this module, surface a hint
      if (evt && evt.filename && evt.filename.indexOf('draw-together') !== -1) {
        error('Draw Together runtime error:', evt.message, 'at', evt.filename + ':' + evt.lineno + ':' + evt.colno);
      }
    } catch (e) {}
  });

  // Provide a manual init entry in case scripts load order prevented constructor
  window.drawTogetherInit = function() {
    try {
      boot();
    } catch (e) { error('manual drawTogetherInit failed', e); }
  };

})();
