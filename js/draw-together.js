/**
 * js/draw-together.js
 * Robust Draw Together integration for cxcxtest
 *
 * - Defensive: waits for DOM ready, handles missing elements by creating them,
 *   avoids referencing unavailable globals, catches and logs errors.
 * - Uses localforage when available, falls back to localStorage.
 * - Stores drawing as structured actions (strokes/shapes) so drawings survive reloads.
 * - Adds a canvas launcher button near the attachment button.
 * - "Send to Chat" attaches a PNG snapshot and the structured drawing data to a message
 *   and uses addMessage() when available, otherwise pushes to global messages and calls renderMessages().
 * - Generates partner doodles randomly (no templates), only primitives.
 * - Works with mouse/touch/pointer; responsive layout; fixed internal resolution (800x500).
 *
 * Installation: add <script src="js/draw-together.js"></script> after your other scripts.
 *
 * If you still see an error, copy the first console error line here and I'll debug it directly.
 */
(function () {
  'use strict';

  // -----------------------
  // Config
  // -----------------------
  var CANVAS_W = 800;
  var CANVAS_H = 500;
  var STORAGE_SUFFIX = 'canvas_last_drawing_v1';
  var PARTNER_REPLY_PROB = 1;
  var PARTNER_MIN_OBJ = 3;
  var PARTNER_MAX_OBJ = 12;
  var SAVE_DEBOUNCE = 300;

  // -----------------------
  // Small helpers
  // -----------------------
  function log() { try { console.info.apply(console, ['[DrawTogether]'].concat(Array.prototype.slice.call(arguments))); } catch (e) {} }
  function warn() { try { console.warn.apply(console, ['[DrawTogether]'].concat(Array.prototype.slice.call(arguments))); } catch (e) {} }
  function errlog() { try { console.error.apply(console, ['[DrawTogether]'].concat(Array.prototype.slice.call(arguments))); } catch (e) {} }

  function safe(fn) { try { return fn(); } catch (e) { errlog('safe wrapper caught', e && e.stack ? e.stack : e); return null; } }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function randRange(a,b){ return a + Math.random()*(b-a); }
  function randInt(a,b){ return Math.floor(randRange(a,b+1)); }

  function randomHsl() {
    var h = randInt(0,360);
    var s = randInt(45,80);
    var l = randInt(30,60);
    return 'hsl(' + h + ' ' + s + '% ' + l + '%)';
  }
  function randomTranslucent() {
    var h = randInt(0,360), s=randInt(45,80), l=randInt(30,70), a=(0.12 + Math.random()*0.6).toFixed(2);
    return 'hsla(' + h + ',' + s + '%,' + l + '%,' + a + ')';
  }

  // -----------------------
  // Storage helpers (localforage preferred)
  // -----------------------
  function storageKey() {
    try {
      if (typeof getStorageKey === 'function') return getStorageKey(STORAGE_SUFFIX);
    } catch (e) {}
    try {
      if (typeof window.APP_PREFIX === 'string') return window.APP_PREFIX + STORAGE_SUFFIX;
    } catch (e) {}
    return 'app_' + STORAGE_SUFFIX;
  }

  function saveItem(key, value) {
    try {
      if (window.localforage) return localforage.setItem(key, value).catch(function(e){ warn('localforage.setItem failed', e); });
      localStorage.setItem(key, JSON.stringify(value));
      return Promise.resolve();
    } catch (e) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch(e2){ warn('localStorage save failed', e2); }
      return Promise.resolve();
    }
  }
  function loadItem(key) {
    try {
      if (window.localforage) return localforage.getItem(key).catch(function(e){ warn('localforage.getItem failed', e); return null; });
      var raw = localStorage.getItem(key);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch (e) {
      try { var raw2 = localStorage.getItem(key); return Promise.resolve(raw2 ? JSON.parse(raw2) : null); } catch(e2){ warn('localStorage load failed', e2); return Promise.resolve(null); }
    }
  }

  // -----------------------
  // DOM: ensure modal + canvas exist (create fallback if not)
  // -----------------------
  function ensureDom() {
    var modal = document.getElementById('canvas-modal');
    var canvas = document.getElementById('drawing-canvas');
    var toolbar = document.getElementById('canvas-toolbar');
    var sendBtn = document.getElementById('canvas-send-to-chat');
    var closeBtn = document.getElementById('canvas-save-close');
    var newBtn = document.getElementById('canvas-new');
    var undoBtn = document.getElementById('canvas-undo');
    var clearBtn = document.getElementById('canvas-clear');
    var lockInput = document.getElementById('canvas-private-lock');

    if (modal && canvas && toolbar) {
      return { modal: modal, canvas: canvas, toolbar: toolbar, sendBtn: sendBtn, closeBtn: closeBtn, newBtn: newBtn, undoBtn: undoBtn, clearBtn: clearBtn, lockInput: lockInput };
    }

    // Build a minimal compatible modal; keep class names to reuse CSS as much as possible.
    modal = document.createElement('div');
    modal.id = 'canvas-modal';
    modal.className = 'modal';
    modal.style.zIndex = '2200';
    modal.style.display = 'none';

    modal.innerHTML = ''
      + '<div class="modal-content" style="max-width:920px;width:calc(100% - 40px);padding:0;background:transparent;">'
      + '  <div style="background:var(--secondary-bg);border-radius:12px;overflow:hidden;">'
      + '    <div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid var(--border-color);">'
      + '      <div style="font-weight:600;">Draw Together · 画布</div>'
      + '      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">'
      + '        <button id="canvas-send-to-chat" class="modal-btn modal-btn-primary">Send to Chat</button>'
      + '        <button id="canvas-save-close" class="modal-btn modal-btn-secondary">Close</button>'
      + '      </div>'
      + '    </div>'
      + '    <div style="display:flex;gap:12px;padding:12px;flex-wrap:wrap;">'
      + '      <div id="canvas-toolbar" style="width:260px;flex-shrink:0;"></div>'
      + '      <div style="flex:1;display:flex;flex-direction:column;gap:8px;">'
      + '        <div style="background:var(--primary-bg);border-radius:8px;padding:8px;display:flex;justify-content:center;align-items:center;">'
      + '          <canvas id="drawing-canvas" width="' + CANVAS_W + '" height="' + CANVAS_H + '" style="max-width:100%;height:auto;background:#fff;border-radius:6px;box-shadow:0 8px 20px rgba(0,0,0,0.06);"></canvas>'
      + '        </div>'
      + '        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;">'
      + '          <button id="canvas-new" class="modal-btn">New</button>'
      + '          <button id="canvas-undo" class="modal-btn">Undo</button>'
      + '          <button id="canvas-clear" class="modal-btn">Clear</button>'
      + '          <label style="display:flex;align-items:center;gap:8px;margin-left:12px;font-size:13px;color:var(--text-secondary);">'
      + '            <input type="checkbox" id="canvas-private-lock" style="pointer-events:none;"> 已锁定（到期后不可编辑）'
      + '          </label>'
      + '        </div>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '</div>';

    try { document.body.appendChild(modal); } catch (e) { warn('append modal failed', e); }

    // re-select
    modal = document.getElementById('canvas-modal');
    canvas = document.getElementById('drawing-canvas');
    toolbar = document.getElementById('canvas-toolbar');
    sendBtn = document.getElementById('canvas-send-to-chat');
    closeBtn = document.getElementById('canvas-save-close');
    newBtn = document.getElementById('canvas-new');
    undoBtn = document.getElementById('canvas-undo');
    clearBtn = document.getElementById('canvas-clear');
    lockInput = document.getElementById('canvas-private-lock');

    return { modal: modal, canvas: canvas, toolbar: toolbar, sendBtn: sendBtn, closeBtn: closeBtn, newBtn: newBtn, undoBtn: undoBtn, clearBtn: clearBtn, lockInput: lockInput };
  }

  // -----------------------
  // Draw module factory
  // -----------------------
  function createDrawModule(dom) {
    var modal = dom.modal;
    var canvas = dom.canvas;
    var toolbar = dom.toolbar;
    var sendBtn = dom.sendBtn;
    var closeBtn = dom.closeBtn;
    var newBtn = dom.newBtn;
    var undoBtn = dom.undoBtn;
    var clearBtn = dom.clearBtn;
    var lockInput = dom.lockInput;

    var ctx = null;
    var actions = [];
    var undone = [];
    var tempShape = null;
    var drawing = false;
    var startPos = null;
    var currentTool = 'brush'; // brush, eraser, line, polygon, circle, rect
    var color = '#111111';
    var size = 4;
    var polygonSides = 5;
    var saveTimer = null;

    function setResolution() {
      try {
        var dpr = window.devicePixelRatio || 1;
        canvas.width = CANVAS_W * dpr;
        canvas.height = CANVAS_H * dpr;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        ctx = canvas.getContext('2d', { alpha: true });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      } catch (e) { errlog('setResolution', e); }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function() {
        try {
          var payload = { version:1, actions: actions, savedAt: Date.now() };
          saveItem(storageKey(), payload).catch(function(e){ warn('saveItem failed', e); });
        } catch (e) { warn('scheduleSave error', e); }
      }, SAVE_DEBOUNCE);
    }

    function clearRender() {
      try {
        if (!ctx) return;
        ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
        ctx.restore();
        for (var i=0;i<actions.length;i++) drawAction(ctx, actions[i]);
        if (tempShape) drawAction(ctx, tempShape, { preview:true });
      } catch (e) { errlog('clearRender', e); }
    }

    function drawAction(c, a, opts) {
      opts = opts || {};
      if (!c || !a) return;
      var preview = !!opts.preview;
      try {
        if (a.type === 'stroke') {
          c.save();
          if (a.mode === 'eraser') c.globalCompositeOperation = 'destination-out';
          else c.globalCompositeOperation = 'source-over';
          c.lineWidth = a.width || 2;
          c.lineCap = 'round';
          c.lineJoin = 'round';
          if (a.mode !== 'eraser') c.strokeStyle = a.color || '#000';
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.beginPath();
          var pts = a.points || [];
          for (var i=0;i<pts.length;i++){
            var p = pts[i];
            if (i===0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
          }
          c.stroke();
          c.restore();
        } else if (a.type === 'line') {
          c.save();
          c.lineWidth = a.width || 2;
          c.strokeStyle = a.color || '#000';
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.beginPath();
          c.moveTo(a.x1, a.y1);
          c.lineTo(a.x2, a.y2);
          c.stroke();
          c.restore();
        } else if (a.type === 'rect') {
          c.save();
          c.lineWidth = a.width || 2;
          if (a.fill) { c.fillStyle = a.fill; c.fillRect(a.x, a.y, a.w, a.h); }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.strokeStyle = a.color || '#000';
          c.strokeRect(a.x, a.y, a.w, a.h);
          c.restore();
        } else if (a.type === 'circle') {
          c.save();
          c.lineWidth = a.width || 2;
          c.beginPath();
          c.arc(a.cx, a.cy, a.r, 0, Math.PI*2);
          if (a.fill) { c.fillStyle = a.fill; c.fill(); }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.strokeStyle = a.color || '#000';
          c.stroke();
          c.restore();
        } else if (a.type === 'polygon') {
          c.save();
          c.lineWidth = a.width || 2;
          var sides = Math.max(3, Math.floor(a.sides || 3));
          c.beginPath();
          for (var j=0;j<sides;j++){
            var ang = (a.rotation || 0) + (j / sides) * Math.PI * 2;
            var x = a.cx + Math.cos(ang) * a.r;
            var y = a.cy + Math.sin(ang) * a.r;
            if (j===0) c.moveTo(x,y); else c.lineTo(x,y);
          }
          c.closePath();
          if (a.fill) { c.fillStyle = a.fill; c.fill(); }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.strokeStyle = a.color || '#000';
          c.stroke();
          c.restore();
        }
      } catch (e) { errlog('drawAction', e, a); }
    }

    // Convert client coordinates to canvas logical coords
    function getPos(ev) {
      try {
        var rect = canvas.getBoundingClientRect();
        var p = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
        var x = (p.clientX - rect.left) * (CANVAS_W / rect.width);
        var y = (p.clientY - rect.top) * (CANVAS_H / rect.height);
        return { x: x, y: y };
      } catch (e) { errlog('getPos', e); return { x:0, y:0 }; }
    }

    // Pointer handling
    var currentStroke = null;
    function handleDown(ev) {
      try {
        ev.preventDefault && ev.preventDefault();
      } catch (e) {}
      var p = getPos(ev);
      drawing = true;
      startPos = p;
      tempShape = null;

      if (currentTool === 'brush' || currentTool === 'eraser') {
        currentStroke = { type:'stroke', mode: currentTool === 'eraser' ? 'eraser' : 'brush', color: color, width: size, points: [p] };
        actions.push(currentStroke);
        scheduleSave();
        clearRender();
      } else {
        tempShape = null;
      }
    }
    function handleMove(ev) {
      if (!drawing) return;
      var p = getPos(ev);
      if (currentTool === 'brush' || currentTool === 'eraser') {
        if (!currentStroke) return;
        currentStroke.points.push(p);
        clearRender();
      } else if (currentTool === 'line') {
        tempShape = { type:'line', x1: startPos.x, y1: startPos.y, x2: p.x, y2: p.y, color: color, width: size };
        clearRender();
      } else if (currentTool === 'circle') {
        var dx = p.x - startPos.x, dy = p.y - startPos.y;
        var r = Math.sqrt(dx*dx + dy*dy);
        tempShape = { type:'circle', cx: startPos.x, cy: startPos.y, r: r, color: color, width: size };
        clearRender();
      } else if (currentTool === 'rect') {
        var x = Math.min(startPos.x, p.x), y = Math.min(startPos.y, p.y);
        var w = Math.abs(p.x - startPos.x), h = Math.abs(p.y - startPos.y);
        tempShape = { type: 'rect', x: x, y: y, w: w, h: h, color: color, width: size };
        clearRender();
      } else if (currentTool === 'polygon') {
        var dx2 = p.x - startPos.x, dy2 = p.y - startPos.y;
        var r2 = Math.sqrt(dx2*dx2 + dy2*dy2);
        tempShape = { type: 'polygon', cx: startPos.x, cy: startPos.y, r: r2, sides: polygonSides, rotation:0, color: color, width: size };
        clearRender();
      }
    }
    function handleUp(ev) {
      if (!drawing) return;
      drawing = false;
      var p = getPos(ev);
      if (currentTool === 'brush' || currentTool === 'eraser') {
        currentStroke = null;
        scheduleSave();
      } else if (currentTool === 'line') {
        actions.push({ type:'line', x1:startPos.x, y1:startPos.y, x2:p.x, y2:p.y, color: color, width: size });
        scheduleSave();
      } else if (currentTool === 'circle') {
        var dx = p.x - startPos.x, dy = p.y - startPos.y; var r = Math.sqrt(dx*dx + dy*dy);
        actions.push({ type:'circle', cx:startPos.x, cy:startPos.y, r: r, color: color, width: size });
        scheduleSave();
      } else if (currentTool === 'rect') {
        var x = Math.min(startPos.x, p.x), y = Math.min(startPos.y, p.y);
        var w = Math.abs(p.x - startPos.x), h = Math.abs(p.y - startPos.y);
        actions.push({ type:'rect', x:x, y:y, w:w, h:h, color: color, width: size });
        scheduleSave();
      } else if (currentTool === 'polygon') {
        var dx3 = p.x - startPos.x, dy3 = p.y - startPos.y; var r3 = Math.sqrt(dx3*dx3 + dy3*dy3);
        actions.push({ type:'polygon', cx:startPos.x, cy:startPos.y, r: r3, sides: polygonSides, rotation:0, color: color, width: size });
        scheduleSave();
      }
      tempShape = null;
      startPos = null;
      clearRender();
    }

    function attachPointerEvents() {
      try {
        if (window.PointerEvent) {
          canvas.addEventListener('pointerdown', handleDown);
          canvas.addEventListener('pointermove', handleMove);
          window.addEventListener('pointerup', handleUp);
        } else {
          canvas.addEventListener('mousedown', handleDown);
          canvas.addEventListener('mousemove', handleMove);
          window.addEventListener('mouseup', handleUp);
          canvas.addEventListener('touchstart', handleDown, { passive:false });
          canvas.addEventListener('touchmove', handleMove, { passive:false });
          window.addEventListener('touchend', handleUp);
        }
        canvas.addEventListener('touchstart', function(e){ e.preventDefault && e.preventDefault(); }, { passive:false });
      } catch (e) { errlog('attachPointerEvents', e); }
    }

    // Toolbar UI
    function buildToolbar() {
      try {
        if (!toolbar) return;
        toolbar.innerHTML = '';
        var toolList = [
          { id:'brush', icon:'fas fa-pencil-alt', title:'Brush' },
          { id:'eraser', icon:'fas fa-eraser', title:'Eraser' },
          { id:'line', icon:'fas fa-slash', title:'Line' },
          { id:'polygon', icon:'fas fa-draw-polygon', title:'Polygon' },
          { id:'circle', icon:'fas fa-circle', title:'Circle' },
          { id:'rect', icon:'far fa-square', title:'Rect' }
        ];

        var wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexWrap = 'wrap';
        wrap.style.gap = '8px';

        toolList.forEach(function(t) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'modal-btn';
          b.dataset.tool = t.id;
          b.title = t.title;
          b.style.flex = '1 0 46%';
          try { b.innerHTML = '<i class="' + t.icon + '"></i>'; } catch (e) { b.textContent = t.title; }
          b.addEventListener('click', function() {
            currentTool = t.id;
            var buttons = wrap.querySelectorAll('button');
            for (var i=0;i<buttons.length;i++) buttons[i].classList.remove('active');
            b.classList.add('active');
          });
          wrap.appendChild(b);
        });

        var colorRow = document.createElement('div');
        colorRow.style.marginTop = '10px';
        colorRow.style.display = 'flex';
        colorRow.style.flexDirection = 'column';
        colorRow.style.gap = '8px';

        var colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = color;
        colorInput.style.width = '44px';
        colorInput.addEventListener('input', function(e){ color = e.target.value; });

        var sizeLabel = document.createElement('div');
        sizeLabel.style.fontSize = '12px';
        sizeLabel.style.color = 'var(--text-secondary)';
        sizeLabel.textContent = 'Size: ' + size + 'px';

        var sizeInput = document.createElement('input');
        sizeInput.type = 'range'; sizeInput.min = 1; sizeInput.max = 64; sizeInput.value = size;
        sizeInput.addEventListener('input', function(e){ size = parseInt(e.target.value,10) || 4; sizeLabel.textContent = 'Size: ' + size + 'px'; });

        var polyRow = document.createElement('div');
        polyRow.style.display = 'flex'; polyRow.style.gap = '8px'; polyRow.style.alignItems = 'center';
        var polyLabel = document.createElement('div'); polyLabel.style.fontSize = '12px'; polyLabel.style.color = 'var(--text-secondary)'; polyLabel.textContent = 'Polygon sides:';
        var polyInput = document.createElement('input'); polyInput.type = 'number'; polyInput.min = 3; polyInput.max = 12; polyInput.value = polygonSides; polyInput.style.width = '64px';
        polyInput.addEventListener('change', function(e){ polygonSides = clamp(parseInt(e.target.value,10)||5,3,12); polyInput.value = polygonSides; });

        polyRow.appendChild(polyLabel); polyRow.appendChild(polyInput);

        colorRow.appendChild(colorInput);
        colorRow.appendChild(sizeInput);
        colorRow.appendChild(sizeLabel);
        colorRow.appendChild(polyRow);

        toolbar.appendChild(wrap);
        toolbar.appendChild(colorRow);

        // set brush active visually
        setTimeout(function(){
          var btn = wrap.querySelector('button[data-tool="brush"]');
          if (btn) btn.classList.add('active');
        }, 10);

      } catch (e) { errlog('buildToolbar', e); }
    }

    // Undo / redo / clear / new
    function doUndo() { if (!actions.length) return; undone.push(actions.pop()); scheduleSave(); clearRender(); }
    function doRedo() { if (!undone.length) return; actions.push(undone.pop()); scheduleSave(); clearRender(); }
    function doClear() { if (!confirm('Clear canvas?')) return; actions = []; undone = []; scheduleSave(); clearRender(); }
    function doNew() { if (!confirm('New canvas (clears current)?')) return; actions = []; undone = []; scheduleSave(); clearRender(); }

    // Wire UI buttons if present
    function wireUi() {
      try {
        if (undoBtn) undoBtn.addEventListener('click', doUndo);
        if (clearBtn) clearBtn.addEventListener('click', doClear);
        if (newBtn) newBtn.addEventListener('click', doNew);
        if (closeBtn) closeBtn.addEventListener('click', function() {
          try { if (typeof hideModal === 'function') hideModal(modal); else modal.style.display = 'none'; } catch (e) { modal.style.display = 'none'; }
          scheduleSave();
        });
      } catch (e) { errlog('wireUi', e); }
    }

    // Send to chat: create PNG snapshot + structured data message
    function sendToChat() {
      try {
        // render to offscreen canvas
        var off = document.createElement('canvas');
        off.width = CANVAS_W; off.height = CANVAS_H;
        var c = off.getContext('2d');
        c.fillStyle = '#ffffff'; c.fillRect(0,0,off.width,off.height);
        for (var i=0;i<actions.length;i++) drawAction(c, actions[i]);
        var dataUrl = off.toDataURL('image/png');

        var messageObj = {
          id: Date.now(),
          sender: 'user',
          text: '',
          timestamp: new Date(),
          image: dataUrl,
          drawingData: JSON.parse(JSON.stringify(actions || [])),
          status: 'sent',
          type: 'drawing'
        };

        if (typeof addMessage === 'function') {
          try { addMessage(messageObj); } catch (e) { warn('addMessage failed, falling back', e); fallbackPush(messageObj); }
        } else {
          fallbackPush(messageObj);
        }

        // Persist last canvas
        scheduleSave();

        // Close modal
        try { if (typeof hideModal === 'function') hideModal(modal); else modal.style.display = 'none'; } catch (e) { modal.style.display = 'none'; }

        // Partner reply maybe
        maybePartnerReply();

      } catch (e) { errlog('sendToChat', e); }
    }

    function fallbackPush(msg) {
      try {
        if (!Array.isArray(window.messages)) window.messages = [];
        window.messages.push(msg);
        if (typeof renderMessages === 'function') renderMessages();
        else log('message pushed; renderMessages not available');
      } catch (e) { warn('fallbackPush failed', e); }
    }

    // Partner doodle generation
    function weightedChoice(items, weights) {
      var total = weights.reduce(function(s,w){ return s+w; },0);
      var r = Math.random() * total;
      for (var i=0;i<items.length;i++){
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[items.length-1];
    }

    function generateRandomActions() {
      var count = PARTNER_MIN_OBJ + Math.floor(Math.random() * (PARTNER_MAX_OBJ - PARTNER_MIN_OBJ + 1));
      var acts = [];
      for (var i=0;i<count;i++){
        var kind = weightedChoice(['stroke','line','circle','rect','polygon'], [40,20,15,15,10]);
        if (kind === 'stroke') {
          var pts = [];
          var x = randRange(40, CANVAS_W-40), y = randRange(40, CANVAS_H-40);
          var n = 4 + Math.floor(Math.random()*20);
          for (var p=0;p<n;p++){
            x += randRange(-40,40);
            y += randRange(-40,40);
            x = clamp(x, 10, CANVAS_W-10);
            y = clamp(y, 10, CANVAS_H-10);
            pts.push({ x:x, y:y });
          }
          acts.push({ type:'stroke', mode:'brush', color: randomHsl(), width: 1 + Math.floor(Math.random()*8), points: pts });
        } else if (kind === 'line') {
          acts.push({ type:'line', x1: randRange(10,CANVAS_W-10), y1: randRange(10,CANVAS_H-10), x2: randRange(10,CANVAS_W-10), y2: randRange(10,CANVAS_H-10), color: randomHsl(), width: 1 + Math.floor(Math.random()*6) });
        } else if (kind === 'circle') {
          var cx = randRange(40, CANVAS_W-40), cy = randRange(40,CANVAS_H-40), r = randRange(8, Math.min(140, CANVAS_W/3));
          acts.push({ type:'circle', cx:cx, cy:cy, r:r, color: randomHsl(), width: 1 + Math.floor(Math.random()*6), fill: Math.random() < 0.35 ? randomTranslucent() : null });
        } else if (kind === 'rect') {
          var rx = randRange(10, CANVAS_W-140), ry = randRange(10, CANVAS_H-140), rw = randRange(20,180), rh = randRange(20,180);
          acts.push({ type:'rect', x:rx, y:ry, w:rw, h:rh, color: randomHsl(), width: 1 + Math.floor(Math.random()*6), fill: Math.random() < 0.35 ? randomTranslucent() : null });
        } else if (kind === 'polygon') {
          var pcx = randRange(40, CANVAS_W-40), pcy = randRange(40,CANVAS_H-40), pr = randRange(12,120), sides = 3 + Math.floor(Math.random()*6);
          acts.push({ type:'polygon', cx:pcx, cy:pcy, r:pr, sides:sides, rotation: Math.random()*Math.PI*2, color: randomHsl(), width: 1 + Math.floor(Math.random()*6), fill: Math.random() < 0.35 ? randomTranslucent() : null });
        }
      }
      return acts;
    }

    function maybePartnerReply() {
      try {
        if (Math.random() > PARTNER_REPLY_PROB) return;
        var d = 800 + Math.random()*2000;
        setTimeout(function(){
          var acts = generateRandomActions();
          var off = document.createElement('canvas'); off.width = CANVAS_W; off.height = CANVAS_H;
          var c = off.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0,0,off.width,off.height);
          for (var i=0;i<acts.length;i++) drawAction(c, acts[i]);
          var url = off.toDataURL('image/png');
          var msg = { id: Date.now()+1, sender:'partner', text:'', timestamp: new Date(), image: url, drawingData: acts, status:'sent', type:'drawing' };
          if (typeof addMessage === 'function') {
            try { addMessage(msg); } catch (e) { warn('addMessage partner failed', e); fallbackPush(msg); }
          } else { fallbackPush(msg); }
        }, d);
      } catch (e) { warn('maybePartnerReply', e); }
    }

    // Load previous saved actions
    function loadSaved() {
      try {
        loadItem(storageKey()).then(function(payload){
          if (!payload || !Array.isArray(payload.actions)) return;
          actions = payload.actions.slice();
          undone = [];
          clearRender();
        }).catch(function(e){ warn('loadSaved failed', e); });
      } catch (e) { warn('loadSaved', e); }
    }

    // UI launcher near attachment
    function createLauncher() {
      try {
        if (document.getElementById('canvas-launcher-btn')) return;
        var attach = document.getElementById('attachment-btn');
        var btn = document.createElement('button');
        btn.id = 'canvas-launcher-btn';
        btn.className = 'attachment-btn input-btn collapse-hideable';
        btn.title = '画布';
        btn.type = 'button';
        btn.style.marginRight = '6px';
        btn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
        btn.addEventListener('click', function(){
          try { if (typeof showModal === 'function') showModal(modal); else modal.style.display = 'flex'; } catch (e) { modal.style.display = 'flex'; }
          setTimeout(function(){ setResolution(); clearRender(); loadSaved(); }, 50);
        });
        if (attach && attach.parentNode) attach.parentNode.insertBefore(btn, attach);
        else {
          var inputs = document.querySelector('.input-buttons');
          if (inputs) inputs.insertBefore(btn, inputs.firstChild || null);
          else document.body.appendChild(btn);
        }
      } catch (e) { warn('createLauncher', e); }
    }

    function wireUiButtons() {
      try {
        if (sendBtn) sendBtn.addEventListener('click', sendToChat);
        if (undoBtn) undoBtn.addEventListener('click', doUndo);
        if (clearBtn) clearBtn.addEventListener('click', doClear);
        if (newBtn) newBtn.addEventListener('click', doNew);
        if (closeBtn) closeBtn.addEventListener('click', function(){ try { if (typeof hideModal === 'function') hideModal(modal); else modal.style.display = 'none'; } catch(e){ modal.style.display='none'; } scheduleSave(); });
      } catch (e) { warn('wireUiButtons', e); }
    }

    // Public init
    function init() {
      try {
        setResolution();
        buildToolbar();
        attachPointerEvents();
        wireUi();
        createLauncher();
        wireUiButtons();
        loadSaved();
        // small initial render
        setTimeout(function(){ clearRender(); }, 60);
        window.addEventListener('resize', function(){ setResolution(); clearRender(); });
      } catch (e) { errlog('draw init error', e); }
    }

    return { init: init, getActions: function(){ return actions; } };
  }

  // -----------------------
  // Bootstrap (DOM ready)
  // -----------------------
  function bootstrap() {
    try {
      var dom = ensureDom();
      var module = createDrawModule(dom);
      module.init();
      window.__drawTogether = window.__drawTogether || {};
      window.__drawTogether.module = module;
      log('Draw Together initialized');
    } catch (e) {
      errlog('bootstrap error', e && e.stack ? e.stack : e);
    }
  }

  // run on DOM ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(bootstrap, 20);
  } else {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  }

  // global error hooks to help debugging
  window.addEventListener('error', function(ev){
    try {
      if (ev && ev.filename && ev.filename.indexOf('draw-together') !== -1) {
        errlog('Script error:', ev.message, 'at', ev.filename + ':' + ev.lineno + ':' + ev.colno);
      }
    } catch (e) {}
  });
  window.addEventListener('unhandledrejection', function(ev){
    try { errlog('Unhandled promise rejection in DrawTogether context', ev); } catch (e) {}
  });

})();
