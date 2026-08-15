/* js/draw-together.js
   Full-file Draw Together implementation (single-patch).
   Features:
   - Individual-only canvases (owner: 'me' by default). Partner-owned canvases may exist for simulation.
   - Tools: brush, eraser, line, rect, circle, polygon (user-controlled sides 3..12).
   - Structured actions stored and persisted (localforage or localStorage).
   - 2-day edit window (expiresAt).
   - Send to Chat: user sends snapshot with from:'me' and createdAt numeric timestamp (immutable snapshot).
   - Partner simulation:
       * partnerAgentTick: random background edits/optional share.
       * schedulePartnerDrawAfterMessage: when a partner message appears (from:'partner'), chance to trigger partner drawing shortly after and (optionally) always share followup to chat.
   - Hooks: best-effort wrap of addMessage and window.messages.push to detect partner messages created elsewhere.
   - Robust debugging flags window.__drawTogetherLoaded / window.__drawTogetherError.
*/

(function () {
  try {
    if (window.__drawTogetherLoaded) return;
    console.debug('[drawTogether] init');

    // ===== Configuration =====
    const STORAGE_KEY = (typeof getStorageKey === 'function' && typeof APP_PREFIX !== 'undefined')
      ? (function(){ try { return getStorageKey('canvases'); } catch(e){ return (APP_PREFIX + 'canvases'); } })()
      : (typeof APP_PREFIX !== 'undefined' ? (APP_PREFIX + 'canvases') : 'cxcx_canvases_v1');

    // Partner background agent (ticks periodically)
    let PARTNER_TICK_INTERVAL = 10 * 60 * 1000; // default: 10 minutes
    let PARTNER_DRAW_PROB = 0.021;              // per tick draw probability
    let PARTNER_SHARE_PROB = 1;              // per tick share probability if edited

    // Follow-up after partner message arrives
    const PARTNER_DRAW_AFTER_SEND_PROB = 1;   // chance to draw after partner message (0..1)
    const PARTNER_FORCE_SHARE_ON_FOLLOWUP = true; // if follow-up occurs, force partner to send snapshot

    const CANVAS_DEFAULT_W = 800;
    const CANVAS_DEFAULT_H = 500;
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

    // ===== Utilities =====
    const hasLocalForage = !!window.localforage;
    const notify = (t, type='info', time=3000) => { if (typeof showNotification === 'function') showNotification(t, type, time); else console.log('notify:', t); };
    const saveAllData = async () => { if (typeof saveData === 'function') return saveData(); return Promise.resolve(); };

    function uid(prefix='c') { return prefix + '-' + Math.random().toString(36).slice(2,9) + '-' + Date.now().toString(36); }

    // Storage helpers
    async function loadCanvasesLocal() {
      try {
        if (hasLocalForage && localforage.getItem) {
          const raw = await localforage.getItem(STORAGE_KEY);
          if (Array.isArray(raw)) return raw;
          return [];
        }
      } catch (e) { console.warn('[drawTogether] localforage load error', e); }
      try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { console.warn('[drawTogether] localStorage parse error', e); return []; }
    }
    async function saveCanvasesLocal(list) {
      try {
        if (hasLocalForage && localforage.setItem) { await localforage.setItem(STORAGE_KEY, list); return; }
      } catch (e) { console.warn('[drawTogether] localforage save error', e); }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch(e) { console.warn('[drawTogether] localStorage save error', e); }
    }

    // Draw/render primitives for structured actions
    function drawAction(ctx, action) {
      if (!ctx || !action) return;
      ctx.save();
      try {
        if (action.type === 'clear') { ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height); ctx.restore(); return; }
        if (action.type === 'stroke') {
          const pts = action.points || [];
          if (!pts.length) { ctx.restore(); return; }
          if (action.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
          else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = action.color || '#000'; }
          ctx.lineWidth = action.width || 3;
          ctx.lineJoin = ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
          ctx.closePath();
          ctx.restore();
          return;
        }
        if (action.type === 'shape') {
          const st = action.shapeType;
          ctx.lineWidth = action.width || 2;
          ctx.strokeStyle = action.color || '#000';
          ctx.fillStyle = action.fill || 'transparent';
          if (st === 'line') {
            const {x1,y1,x2,y2} = action;
            ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.closePath();
          } else if (st === 'rect') {
            const {x,y,w,h} = action;
            if (action.fill) ctx.fillRect(x,y,w,h);
            ctx.strokeRect(x,y,w,h);
          } else if (st === 'circle') {
            const {cx,cy,r} = action;
            ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); if (action.fill) ctx.fill(); ctx.stroke(); ctx.closePath();
          } else if (st === 'polygon' && Array.isArray(action.points) && action.points.length) {
            const pts = action.points;
            ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
            for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath(); if (action.fill) ctx.fill(); ctx.stroke();
          }
          ctx.restore();
          return;
        }
      } catch (e) {
        console.warn('[drawTogether] drawAction error', e, action);
      } finally {
        try { ctx.restore(); } catch(e){}
      }
    }

    function redrawFromActions(canvasEl, actions) {
      if (!canvasEl || !canvasEl.getContext) return;
      const ctx = canvasEl.getContext('2d');
      ctx.clearRect(0,0,canvasEl.width, canvasEl.height);
      for (const a of (actions || [])) {
        try { drawAction(ctx, a); } catch (e) { console.warn('[drawTogether] drawAction failed', e, a); }
      }
    }

    function checksumSnapshotDataURL(dataURL) {
      let h = 2166136261 >>> 0;
      for (let i=0;i<dataURL.length;i++) h = Math.imul(h ^ dataURL.charCodeAt(i), 16777619);
      return (h >>> 0).toString(16);
    }

    // ===== App glue: pushing messages =====
    function pushChatMessage(msg) {
      if (!msg) return;
      try {
        if (typeof addMessage === 'function') { addMessage(msg); return; }
      } catch (e) { console.warn('[drawTogether] addMessage threw', e); }
      if (Array.isArray(window.messages)) {
        window.messages.push(msg);
        try { if (typeof renderMessages === 'function') renderMessages(); } catch(e) { console.warn('[drawTogether] renderMessages threw', e); }
        if (typeof throttledSaveData === 'function') throttledSaveData(); else throttledSave();
      } else {
        console.warn('[drawTogether] no messages[] to push into');
      }
    }

    const throttledSave = (() => {
      if (typeof throttledSaveData === 'function') return throttledSaveData;
      let t;
      return function() { clearTimeout(t); t = setTimeout(() => { saveAllData().catch(()=>{}); }, 500); };
    })();

    // ===== Data model & state =====
    let canvasesCache = [];
    let activeCanvas = null;

    async function loadAndCache() { canvasesCache = await loadCanvasesLocal(); }

    // canvases are individual by default (owner 'me'), but can be created with owner:'partner' for simulation
    function createCanvasObject(opts={}) {
      const now = Date.now();
      const owner = opts.owner || 'me';
      const id = uid('canvas');
      const o = {
        id,
        title: opts.title || 'Untitled',
        owner,
        shared: false,
        createdAt: now,
        lastModifiedAt: now,
        expiresAt: now + TWO_DAYS_MS,
        actions: [],
        lastSentHash: null,
        partnerEdited: false,
        meta: opts.meta || {}
      };
      canvasesCache.unshift(o);
      saveCanvasesLocal(canvasesCache).catch(()=>{});
      throttledSave();
      return o;
    }
    function findCanvasById(id) { return canvasesCache.find(c => c.id === id); }

    // ===== UI: toolbar + modal wiring =====
    function buildToolbar(container) {
      if (!container) return;
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div><strong>Tools</strong></div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button data-tool="brush" class="canvas-tool-btn">Brush</button>
            <button data-tool="eraser" class="canvas-tool-btn">Eraser</button>
            <button data-tool="line" class="canvas-tool-btn">Line</button>
            <button data-tool="rect" class="canvas-tool-btn">Rect</button>
            <button data-tool="circle" class="canvas-tool-btn">Circle</button>
            <button data-tool="poly" class="canvas-tool-btn">Polygon</button>
          </div>

          <div><strong>Color</strong></div>
          <input id="canvas-color" type="color" value="#000000">

          <div style="display:flex;gap:8px;align-items:center;">
            <div><strong>Brush size</strong></div>
            <input id="canvas-size" type="range" min="1" max="60" value="4" style="flex:1;">
          </div>

          <div style="display:flex;gap:8px;align-items:center;">
            <div><strong>Polygon sides</strong></div>
            <input id="canvas-poly-sides" type="number" min="3" max="12" value="5" style="width:64px;">
          </div>

          <div style="display:flex;gap:6px;">
            <button id="canvas-undo" class="modal-btn">Undo</button>
            <button id="canvas-clear" class="modal-btn">Clear</button>
          </div>
        </div>
      `;
      container.querySelectorAll('.canvas-tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.canvas-tool-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          container.dataset.selectedTool = btn.dataset.tool;
        });
      });
      const defaultBtn = container.querySelector('button[data-tool="brush"]');
      if (defaultBtn) { defaultBtn.classList.add('active'); container.dataset.selectedTool = 'brush'; }
    }

    function makeRegularPolygonPoints(cx,cy,r,sides,rotation=0) {
      const pts = [];
      for (let i=0;i<sides;i++) {
        const a = rotation + (i / sides) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      return pts;
    }

    function openCanvasModal(canvasId) {
      const modal = document.getElementById('canvas-modal');
      const canvasEl = document.getElementById('drawing-canvas');
      const toolbar = document.getElementById('canvas-toolbar');

      if (!modal || !canvasEl || !toolbar) { console.warn('[drawTogether] modal elements missing'); notify('Canvas UI missing', 'error'); return; }

      modal.style.zIndex = '999999';
      const content = modal.querySelector('.modal-content');
      if (content) { content.style.opacity = '1'; content.style.transform = 'none'; }

      if (typeof showModal === 'function') {
        try { showModal(modal, modal.querySelector('.modal-content') || null); } catch(e) { modal.style.display = 'flex'; }
      } else {
        modal.style.display = 'flex';
      }
      try { document.body.style.overflow = 'hidden'; } catch(e){}

      if (!toolbar.dataset.built) {
        buildToolbar(toolbar);
        toolbar.dataset.built = '1';
        const undoBtn = document.getElementById('canvas-undo');
        const clearBtn = document.getElementById('canvas-clear');
        if (undoBtn) undoBtn.addEventListener('click', () => window.doUndo && window.doUndo());
        if (clearBtn) clearBtn.addEventListener('click', () => window.doClear && window.doClear());
      }

      let canvasObj = canvasId ? findCanvasById(canvasId) : null;
      if (!canvasObj) canvasObj = createCanvasObject({ title: canvasId ? 'Loaded' : 'New', owner: 'me' });

      activeCanvas = canvasObj;

      const lockCheckbox = document.getElementById('canvas-private-lock');
      if (lockCheckbox) { lockCheckbox.checked = Date.now() >= canvasObj.expiresAt; lockCheckbox.disabled = true; }

      const sendBtn = document.getElementById('canvas-send-to-chat');
      if (sendBtn) sendBtn.onclick = function(){ sendCanvasToChat(canvasObj); };
      const closeBtn = document.getElementById('canvas-save-close');
      if (closeBtn) closeBtn.onclick = function(){ closeCanvasModal(); };

      initDrawingCanvas(canvasEl, canvasObj);
      redrawFromActions(canvasEl, canvasObj.actions || []);
    }

    function closeCanvasModal() {
      const modal = document.getElementById('canvas-modal');
      if (!modal) return;
      if (typeof hideModal === 'function') {
        try { hideModal(modal); } catch(e) { modal.style.display = 'none'; }
      } else {
        modal.style.display = 'none';
        const content = modal.querySelector('.modal-content');
        if (content) { content.style.opacity = '0'; content.style.transform = 'translateY(20px) scale(0.95)'; }
      }
      try { document.body.style.overflow = ''; } catch(e){}
      activeCanvas = null;
      saveCanvasesLocal(canvasesCache).catch(()=>{});
    }

    function initDrawingCanvas(canvasEl, canvasObj) {
      if (!canvasEl) return;
      canvasEl.width = CANVAS_DEFAULT_W;
      canvasEl.height = CANVAS_DEFAULT_H;
      const toolbar = document.getElementById('canvas-toolbar');
      const colorInput = document.getElementById('canvas-color');
      const sizeInput = document.getElementById('canvas-size');
      const polySidesInput = document.getElementById('canvas-poly-sides');

      let drawing = false;
      let currentPoints = [];
      let startPoint = null;
      let lastMovePoint = null;

      function canEdit(c) {
        if (!c) return true;
        if (Date.now() >= c.expiresAt) return false;
        if (c.owner === 'me') return true;
        if (c.owner === 'partner') return false;
        return true;
      }

      const ctx = canvasEl.getContext('2d');

      function getPos(e) {
        const rect = canvasEl.getBoundingClientRect();
        if (e.touches && e.touches[0]) {
          return { x: (e.touches[0].clientX - rect.left) * (canvasEl.width/rect.width), y: (e.touches[0].clientY - rect.top) * (canvasEl.height/rect.height) };
        } else {
          return { x: (e.clientX - rect.left) * (canvasEl.width/rect.width), y: (e.clientY - rect.top) * (canvasEl.height/rect.height) };
        }
      }

      function startDraw(e) {
        if (!canEdit(canvasObj)) { notify('This canvas is locked (expired or permission denied)', 'warning'); return; }
        drawing = true; currentPoints = []; startPoint = getPos(e); lastMovePoint = startPoint; currentPoints.push(startPoint);
        try { e.preventDefault(); } catch(e){}
      }

      function moveDraw(e) {
        if (!drawing) return;
        const p = getPos(e);
        lastMovePoint = p;
        currentPoints.push(p);
        const tool = (toolbar && toolbar.dataset.selectedTool) || 'brush';

        if (tool === 'brush' || tool === 'eraser') {
          drawAction(ctx, { type: 'stroke', tool: tool === 'eraser' ? 'eraser' : 'brush', points: [ currentPoints[currentPoints.length-2], currentPoints[currentPoints.length-1] ], color: colorInput ? colorInput.value : '#000', width: sizeInput ? parseInt(sizeInput.value,10) : 4 });
        } else if (tool === 'poly') {
          redrawFromActions(canvasEl, (canvasObj.actions || []));
          const dx = p.x - startPoint.x, dy = p.y - startPoint.y;
          const r = Math.sqrt(dx*dx + dy*dy);
          let sides = 5;
          if (polySidesInput) {
            const v = parseInt(polySidesInput.value, 10);
            if (!isNaN(v)) sides = Math.max(3, Math.min(12, v));
          }
          const pts = makeRegularPolygonPoints(startPoint.x, startPoint.y, r, sides, 0);
          drawAction(ctx, { type:'shape', shapeType:'polygon', points: pts, color: colorInput ? colorInput.value : '#000', width: sizeInput ? parseInt(sizeInput.value,10) : 4, fill: null });
        } else {
          redrawFromActions(canvasEl, (canvasObj.actions || []));
          if (tool === 'line') drawAction(ctx, { type:'shape', shapeType:'line', x1:startPoint.x, y1:startPoint.y, x2:p.x, y2:p.y, color: colorInput ? colorInput.value : '#000', width: sizeInput ? parseInt(sizeInput.value,10) : 4 });
          if (tool === 'rect') drawAction(ctx, { type:'shape', shapeType:'rect', x:Math.min(startPoint.x,p.x), y:Math.min(startPoint.y,p.y), w:Math.abs(p.x-startPoint.x), h:Math.abs(p.y-startPoint.y), color: colorInput ? colorInput.value : '#000', width: sizeInput ? parseInt(sizeInput.value,10) : 4 });
          if (tool === 'circle') { const dx = p.x - startPoint.x, dy = p.y - startPoint.y, r = Math.sqrt(dx*dx + dy*dy); drawAction(ctx, { type:'shape', shapeType:'circle', cx:startPoint.x, cy:startPoint.y, r:r, color: colorInput ? colorInput.value : '#000', width: sizeInput ? parseInt(sizeInput.value,10) : 4 }); }
        }
        try { e.preventDefault(); } catch(e){}
      }

      function endDraw(e) {
        if (!drawing) return;
        drawing = false;
        const tool = (toolbar && toolbar.dataset.selectedTool) || 'brush';
        let action = null;
        if (tool === 'brush' || tool === 'eraser') {
          action = { type:'stroke', tool: tool, points: currentPoints.slice(), color: tool === 'eraser' ? '#000000' : (colorInput ? colorInput.value : '#000'), width: sizeInput ? parseInt(sizeInput.value,10) : 4 };
        } else if (tool === 'poly') {
          const p = lastMovePoint || startPoint;
          const dx = p.x - startPoint.x, dy = p.y - startPoint.y;
          const r = Math.sqrt(dx*dx + dy*dy);
          let sides = 5;
          if (polySidesInput) {
            const v = parseInt(polySidesInput.value, 10);
            if (!isNaN(v)) sides = Math.max(3, Math.min(12, v));
          }
          const pts = makeRegularPolygonPoints(startPoint.x, startPoint.y, r, sides, 0);
          action = { type:'shape', shapeType:'polygon', points: pts, color: colorInput ? colorInput.value : '#000', width: sizeInput ? parseInt(sizeInput.value,10) : 4, fill: null };
        } else {
          const p = currentPoints[currentPoints.length-1] || startPoint;
          if (tool === 'line') action = { type:'shape', shapeType:'line', x1:startPoint.x, y1:startPoint.y, x2:p.x, y2:p.y, color: colorInput ? colorInput.value : '#000', width: sizeInput ? parseInt(sizeInput.value,10) : 4 };
          if (tool === 'rect') action = { type:'shape', shapeType:'rect', x:Math.min(startPoint.x,p.x), y:Math.min(startPoint.y,p.y), w:Math.abs(p.x-startPoint.x), h:Math.abs(p.y-startPoint.y), color: colorInput ? colorInput.value : '#000', width: sizeInput ? parseInt(sizeInput.value,10) : 4 };
          if (tool === 'circle') { const dx = p.x - startPoint.x, dy = p.y - startPoint.y, r = Math.sqrt(dx*dx + dy*dy); action = { type:'shape', shapeType:'circle', cx:startPoint.x, cy:startPoint.y, r:r, color: colorInput ? colorInput.value : '#000', width: sizeInput ? parseInt(sizeInput.value,10) : 4 }; }
        }
        if (action) {
          canvasObj.actions.push(action);
          canvasObj.lastModifiedAt = Date.now();
          canvasObj.partnerEdited = false;
          saveCanvasesLocal(canvasesCache);
          throttledSave();
        }
        currentPoints = []; startPoint = null; lastMovePoint = null;
        redrawFromActions(canvasEl, canvasObj.actions || []);
        try { e.preventDefault(); } catch(e){}
      }

      canvasEl.onpointerdown = startDraw;
      canvasEl.onpointermove = moveDraw;
      window.addEventListener('pointerup', endDraw);
      canvasEl.ontouchstart = startDraw;
      canvasEl.ontouchmove = moveDraw;
      canvasEl.ontouchend = endDraw;
      canvasEl.onmousedown = startDraw;
      canvasEl.onmousemove = moveDraw;
      canvasEl.onmouseup = endDraw;

      window.doUndo = function() { if (!canvasObj || !canvasObj.actions || !canvasObj.actions.length) return; canvasObj.actions.pop(); canvasObj.lastModifiedAt = Date.now(); saveCanvasesLocal(canvasesCache).catch(()=>{}); redrawFromActions(canvasEl, canvasObj.actions || []); throttledSave(); };
      window.doClear = function() { if (!canEdit(canvasObj)) { notify('Cannot clear locked/expired canvas', 'warning'); return; } canvasObj.actions.push({ type:'clear' }); canvasObj.lastModifiedAt = Date.now(); saveCanvasesLocal(canvasesCache).catch(()=>{}); redrawFromActions(canvasEl, canvasObj.actions || []); throttledSave(); };

      canvasObj.applyAction = function(action) { canvasObj.actions.push(action); canvasObj.lastModifiedAt = Date.now(); canvasObj.partnerEdited = true; saveCanvasesLocal(canvasesCache).catch(()=>{}); if (document.getElementById('canvas-modal') && document.getElementById('canvas-modal').style.display !== 'none' && activeCanvas && activeCanvas.id === canvasObj.id) { redrawFromActions(canvasEl, canvasObj.actions || []); } throttledSave(); };
    }

    // ===== Send to chat (user) =====
    function sendCanvasToChat(canvasObj) {
      if (!canvasObj) return;
      const tmp = document.createElement('canvas'); tmp.width = CANVAS_DEFAULT_W; tmp.height = CANVAS_DEFAULT_H;
      const ctx = tmp.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,tmp.width,tmp.height);
      for (const a of canvasObj.actions) drawAction(ctx, a);
      const dataURL = tmp.toDataURL('image/png');
      const hash = checksumSnapshotDataURL(dataURL);
      if (canvasObj.lastSentHash === hash) { notify('No changes since last sent. Edit before sending again.', 'warning'); return; }

      const now = Date.now();
      const myName = (window.settings && window.settings.myName) ? window.settings.myName : (typeof window.MY_NAME !== 'undefined' ? window.MY_NAME : '我');

      const msg = {
        id: now + Math.floor(Math.random()*1000),
        from: 'me',
        sender: myName,
        createdAt: now,
        timestamp: new Date(now),
        type: 'image',
        text: '',
        image: dataURL,
        status: 'sent',
        canvasSnapshot: { canvasId: canvasObj.id, structured: JSON.parse(JSON.stringify(canvasObj.actions)), width: CANVAS_DEFAULT_W, height: CANVAS_DEFAULT_H }
      };

      pushChatMessage(msg);
      canvasObj.lastSentHash = hash;
      saveCanvasesLocal(canvasesCache);
      throttledSave();
      notify('Canvas sent to chat', 'success');
    }

    // Helper for rendering in message view (consumer can use this)
    window.renderCanvasMessageNode = function(msg) {
      const wrapper = document.createElement('div'); wrapper.className = 'canvas-msg';
      const img = document.createElement('img');
      img.src = (msg && (msg.image || (msg.content && msg.content.snapshot))) || '';
      img.style.maxWidth = '320px'; img.style.borderRadius = '8px'; img.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
      wrapper.appendChild(img);
      return wrapper;
    };

    // ===== Partner random doodles (background) =====
    function randomBetween(a,b) { return a + Math.random() * (b - a); }
    function randInt(a,b) { return Math.floor(randomBetween(a,b+1)); }
    function randomColor() { const h = Math.floor(Math.random() * 360); const s = randInt(40,95); const l = randInt(30,70); return `hsl(${h} ${s}% ${l}%)`; }

    function generateRandomStroke() {
      const n = randInt(3, 40);
      const pts = [];
      for (let i=0;i<n;i++) pts.push({ x: randInt(10, CANVAS_DEFAULT_W-10), y: randInt(10, CANVAS_DEFAULT_H-10) });
      return { type:'stroke', tool: 'brush', points: pts, color: randomColor(), width: randInt(1, 12) };
    }
    function generateRandomShape() {
      const t = ['line','rect','circle'][randInt(0,2)];
      if (t === 'line') {
        return { type:'shape', shapeType:'line', x1: randInt(0,CANVAS_DEFAULT_W), y1: randInt(0,CANVAS_DEFAULT_H), x2: randInt(0,CANVAS_DEFAULT_W), y2: randInt(0,CANVAS_DEFAULT_H), color: randomColor(), width: randInt(1,8) };
      } else if (t === 'rect'){
        const x = randInt(0,CANVAS_DEFAULT_W-40), y = randInt(0,CANVAS_DEFAULT_H-40);
        const w = randInt(10, Math.min(200, CANVAS_DEFAULT_W-x)), h = randInt(10, Math.min(200, CANVAS_DEFAULT_H-y));
        return { type:'shape', shapeType:'rect', x, y, w, h, color: randomColor(), width: randInt(1,6), fill: Math.random()>0.7 ? randomColor() : null };
      } else {
        const cx = randInt(0,CANVAS_DEFAULT_W), cy = randInt(0,CANVAS_DEFAULT_H), r = randInt(8, 150);
        return { type:'shape', shapeType:'circle', cx, cy, r, color: randomColor(), width: randInt(1,6), fill: Math.random()>0.75 ? randomColor() : null };
      }
    }

    function partnerAgentTick() {
      try {
        if (!canvasesCache.length) return;
        if (Math.random() > PARTNER_DRAW_PROB) return;
        // partner edits only canvases they own
        const candidates = canvasesCache.filter(c => {
          if (Date.now() >= (c && c.expiresAt || 0)) return false;
          if (c.owner !== 'partner') return false;
          return true;
        });
        if (!candidates.length) return;
        const canvas = candidates[randInt(0,candidates.length-1)];
        const count = randInt(1,6);
        for (let i=0;i<count;i++) {
          const action = Math.random() > 0.45 ? generateRandomStroke() : generateRandomShape();
          canvas.actions.push(action);
        }
        canvas.lastModifiedAt = Date.now();
        canvas.partnerEdited = true;
        saveCanvasesLocal(canvasesCache).catch(()=>{});
        throttledSave();

        // decide whether partner shares it to chat
        if (Math.random() < PARTNER_SHARE_PROB) {
          const tmp = document.createElement('canvas'); tmp.width = CANVAS_DEFAULT_W; tmp.height = CANVAS_DEFAULT_H;
          const ctx = tmp.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,tmp.width,tmp.height);
          for (const a of canvas.actions) drawAction(ctx, a);
          const dataURL = tmp.toDataURL('image/png');
          const hash = checksumSnapshotDataURL(dataURL);
          if (canvas.lastSentHash !== hash) {
            if (canvas.partnerEdited) {
              const now = Date.now();
              const partnerName = (window.settings && window.settings.partnerName) ? window.settings.partnerName : (typeof window.PARTNER_NAME !== 'undefined' ? window.PARTNER_NAME : '对方');
              const msg = { id: now + Math.floor(Math.random()*1000), from: 'partner', sender: partnerName, createdAt: now, timestamp: new Date(now), type: 'image', text:'', image: dataURL, status:'received', canvasSnapshot: { canvasId: canvas.id, structured: JSON.parse(JSON.stringify(canvas.actions)), width: CANVAS_DEFAULT_W, height: CANVAS_DEFAULT_H } };
              pushChatMessage(msg);
              canvas.lastSentHash = hash;
              canvas.partnerEdited = false;
              saveCanvasesLocal(canvasesCache).catch(()=>{});
              throttledSave();
              try { window._sendPartnerNotification && window._sendPartnerNotification(partnerName, '发送了画布'); } catch(e){}
            }
          }
        }
      } catch (e) { console.warn('[drawTogether] partnerAgentTick error', e); }
    }

    // ===== Follow-up: draw after partner message =====
    async function schedulePartnerDrawAfterMessage(msg) {
      try {
        // Only consider partner messages
        const isPartnerMsg = msg && (msg.from === 'partner' || (msg.sender && msg.from !== 'me' && msg.from !== 'me'));
        if (!isPartnerMsg) return;
        if (Math.random() > PARTNER_DRAW_AFTER_SEND_PROB) return;

        const delayMs = 1200 + Math.floor(Math.random()*3800);
        setTimeout(async () => {
          // find or create partner-owned canvas
          let candidates = canvasesCache.filter(c => c.owner === 'partner' && Date.now() < c.expiresAt);
          let canvas = candidates.length ? candidates[Math.floor(Math.random()*candidates.length)] : null;
          if (!canvas) canvas = createCanvasObject({ owner: 'partner', title: 'partner-auto' });

          const count = randInt(1,5);
          for (let i=0;i<count;i++) {
            const action = Math.random() > 0.45 ? generateRandomStroke() : generateRandomShape();
            canvas.actions.push(action);
          }
          canvas.lastModifiedAt = Date.now();
          canvas.partnerEdited = true;
          await saveCanvasesLocal(canvasesCache);
          throttledSave();

          if (PARTNER_FORCE_SHARE_ON_FOLLOWUP) {
            const tmp = document.createElement('canvas'); tmp.width = CANVAS_DEFAULT_W; tmp.height = CANVAS_DEFAULT_H;
            const ctx = tmp.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,tmp.width,tmp.height);
            for (const a of canvas.actions) drawAction(ctx, a);
            const dataURL = tmp.toDataURL('image/png');
            const hash = checksumSnapshotDataURL(dataURL);
            const now = Date.now();
            const partnerName = (window.settings && window.settings.partnerName) ? window.settings.partnerName : (typeof window.PARTNER_NAME !== 'undefined' ? window.PARTNER_NAME : '对方');
            const out = { id: now + Math.floor(Math.random()*1000), from:'partner', sender: partnerName, createdAt: now, timestamp: new Date(now), type:'image', text:'', image: dataURL, status:'received', canvasSnapshot: { canvasId: canvas.id, structured: JSON.parse(JSON.stringify(canvas.actions)), width: CANVAS_DEFAULT_W, height: CANVAS_DEFAULT_H } };
            pushChatMessage(out);
            canvas.lastSentHash = hash;
            canvas.partnerEdited = false;
            await saveCanvasesLocal(canvasesCache);
            throttledSave();
          }
        }, delayMs);
      } catch (e) { console.warn('[drawTogether] schedulePartnerDrawAfterMessage error', e); }
    }

    // Hook addMessage (if present) and window.messages push to detect partner messages
    if (typeof addMessage === 'function' && !addMessage.__drawTogetherWrapped) {
      const origAdd = addMessage;
      addMessage = function(msg) {
        try { origAdd.apply(this, arguments); } catch(e) { try { origAdd(msg); } catch(e2) {} }
        try { schedulePartnerDrawAfterMessage(msg); } catch(e) { console.warn(e); }
      };
      addMessage.__drawTogetherWrapped = true;
    }

    if (Array.isArray(window.messages) && !window.messages.__drawTogetherWrapped) {
      const backing = window.messages;
      const proxy = new Proxy(backing, {
        get(target, prop) {
          if (prop === 'push') {
            return function(...args) {
              const res = Array.prototype.push.apply(target, args);
              try { schedulePartnerDrawAfterMessage(args[args.length-1]); } catch(e) {}
              return res;
            };
          }
          const v = target[prop];
          return (typeof v === 'function') ? v.bind(target) : v;
        }
      });
      proxy.__drawTogetherWrapped = true;
      window.messages = proxy;
    }

    // ===== Partner agent starter =====
    let partnerAgentHandle = null;
    function startPartnerAgent() { if (partnerAgentHandle) clearInterval(partnerAgentHandle); partnerAgentHandle = setInterval(partnerAgentTick, PARTNER_TICK_INTERVAL); }

    // ===== Public API + init =====
    window.drawTogether = {
      openCanvasModalById: function(id) { try { openCanvasModal(id); } catch(e){ console.warn('[drawTogether] open error', e); } },
      newCanvas: function(opts){ try { const c = createCanvasObject(opts||{}); saveCanvasesLocal(canvasesCache); return c; } catch(e){ console.warn('[drawTogether] newCanvas error', e); return null; } },
      listCanvases: function(){ return canvasesCache.slice(); },
      load: async function() { await loadAndCache(); return canvasesCache; },
      saveAll: function(){ return saveCanvasesLocal(canvasesCache); },
      // runtime tuning helpers
      setPartnerTickInterval: function(ms) { PARTNER_TICK_INTERVAL = Math.max(1000, Number(ms)||PARTNER_TICK_INTERVAL); startPartnerAgent(); },
      setPartnerDrawProb: function(p) { PARTNER_DRAW_PROB = Math.min(1, Math.max(0, Number(p)||PARTNER_DRAW_PROB)); },
      setPartnerShareProb: function(p) { PARTNER_SHARE_PROB = Math.min(1, Math.max(0, Number(p)||PARTNER_SHARE_PROB)); }
    };

    document.addEventListener('DOMContentLoaded', async function() {
      try {
        await loadAndCache();
        startPartnerAgent();
        console.debug('[drawTogether] ready');
        const canvasBtn = document.getElementById('canvas-btn');
        if (canvasBtn) {
          canvasBtn.addEventListener('click', () => {
            const c = createCanvasObject({ title: 'My Canvas', owner: 'me' });
            openCanvasModal(c.id);
          });
        }
      } catch (e) { console.warn('[drawTogether] init failed', e); }
    });

    window.__drawTogetherLoaded = true;
    window.__drawTogetherError = null;
    console.debug('[drawTogether] loaded');
  } catch (err) {
    try { window.__drawTogetherLoaded = false; window.__drawTogetherError = (err && err.stack) ? err.stack.toString() : String(err); } catch(e){}
    console.error('[drawTogether] top-level error', err);
  }
})();
