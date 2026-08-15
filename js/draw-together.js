/* Draw Together integration module
   - Adds canvas UI, stores canvases as structured action arrays
   - Persist canvases in localforage (or localStorage fallback)
   - Sends snapshot to chat as a message with a fixed snapshot (dataURL)
   - 2-day expiration lock: editable only while Date.now() < createdAt + 2days
   - Partner auto-doodle agent with probabilities
*/

(function () {
  if (window.__drawTogetherLoaded) return;
  window.__drawTogetherLoaded = true;

  // --- Configuration ---
  const STORAGE_KEY = (typeof getStorageKey === 'function' && typeof APP_PREFIX !== 'undefined')
    ? (getStorageKey ? getStorageKey('canvases') : (APP_PREFIX + 'canvases')) // best effort
    : (typeof APP_PREFIX !== 'undefined' ? (APP_PREFIX + 'canvases') : 'cxcx_canvases_v1');

  // partner behaviour probabilities & interval (tweak these values)
  const PARTNER_TICK_INTERVAL = 60 * 1000; // check every minute
  const PARTNER_DRAW_PROB = 0.03; // 3% chance per tick to edit a shared canvas
  const PARTNER_SHARE_PROB = 0.25; // 25% chance to share after editing
  const CANVAS_DEFAULT_W = 800;
  const CANVAS_DEFAULT_H = 500;
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

  // Use existing utilities if present
  const hasLocalForage = !!window.localforage;
  const notify = (t, type='info', time=3000) => { if (typeof showNotification === 'function') showNotification(t, type, time); else console.log('notify:', t); };
  const saveAllData = async () => { if (typeof saveData === 'function') return saveData(); return Promise.resolve(); };
  // pushChatMessage helper: preserves existing structure by trying to reuse push/add pattern, otherwise push into global messages[] and re-render
  function pushChatMessage(msg) {
    if (!msg) return;
    try {
      if (typeof addMessage === 'function') { addMessage(msg); return; } // if project has an API
    } catch(e){}
    if (Array.isArray(window.messages)) {
      window.messages.push(msg);
      try { if (typeof renderMessages === 'function') renderMessages(); } catch(e) {}
      throttledSave();
    }
  }

  // Save throttled (use existing throttledSaveData if present)
  const throttledSave = (() => {
    if (typeof throttledSaveData === 'function') return throttledSaveData;
    let t;
    return function() { clearTimeout(t); t = setTimeout(() => { saveAllData().catch(()=>{}); }, 500); };
  })();

  // --- Data model ---
  // Canvas object:
  // { id, title, owner: 'me'|'partner'|'shared', shared: bool, createdAt, lastModifiedAt, expiresAt, actions:[], lastSentHash, partnerEditedFlag }
  function uid(prefix='c') {
    return prefix + '-' + Math.random().toString(36).slice(2,9) + '-' + Date.now().toString(36);
  }

  // storage functions
  async function loadCanvases() {
    try {
      if (hasLocalForage && localforage.getItem) {
        const raw = await localforage.getItem(STORAGE_KEY);
        if (Array.isArray(raw)) return raw;
        return [];
      }
    } catch (e) { console.warn('loadCanvases error', e); }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  async function saveCanvases(list) {
    try {
      if (hasLocalForage && localforage.setItem) {
        await localforage.setItem(STORAGE_KEY, list);
        return;
      }
    } catch (e) { console.warn('saveCanvases localforage failed', e); }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch(e) {}
  }

  // --- Canvas drawing engine (structured actions) ---
  // action types: { type: 'stroke'|'shape'|'clear', tool, color, width, points, bbox, fill, shapeType }
  // drawAction: render an action on a canvas 2D context
  function drawAction(ctx, action) {
    if (!ctx || !action) return;
    ctx.save();
    if (action.type === 'clear') {
      ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
      return;
    }
    if (action.type === 'stroke') {
      const pts = action.points || [];
      if (!pts.length) { ctx.restore(); return; }
      if (action.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = action.color || '#000';
      }
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
        ctx.beginPath();
        ctx.moveTo(x1,y1);
        ctx.lineTo(x2,y2);
        ctx.stroke();
        ctx.closePath();
      } else if (st === 'rect') {
        const {x,y,w,h} = action;
        if (action.fill) ctx.fillRect(x,y,w,h);
        ctx.strokeRect(x,y,w,h);
      } else if (st === 'circle') {
        const {cx,cy,r} = action;
        ctx.beginPath();
        ctx.arc(cx,cy,r,0,Math.PI*2);
        if (action.fill) ctx.fill();
        ctx.stroke();
        ctx.closePath();
      } else if (st === 'polygon' && Array.isArray(action.points)) {
        const pts = action.points;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        if (action.fill) ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    ctx.restore();
  }

  function redrawFromActions(canvasEl, actions) {
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0,0,canvasEl.width, canvasEl.height);
    // render in order
    for (const a of actions) drawAction(ctx, a);
  }

  function checksumSnapshotDataURL(dataURL) {
    // minimal hash for snapshot uniqueness (not cryptographically strong)
    let h = 2166136261 >>> 0;
    for (let i=0;i<dataURL.length;i++) h = Math.imul(h ^ dataURL.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16);
  }

  // --- Canvas UI wiring & state ---
  let canvasesCache = [];
  let activeCanvas = null;

  async function loadAndCache() {
    canvasesCache = await loadCanvases();
  }

  // create a new canvas object
  function createCanvasObject(opts={}) {
    const now = Date.now();
    const owner = opts.owner || 'me'; // 'me'|'partner'|'shared'
    const shared = !!opts.shared;
    const id = uid('canvas');
    const o = {
      id, title: opts.title || 'Untitled', owner: shared ? 'shared' : owner,
      shared: shared,
      createdAt: now,
      lastModifiedAt: now,
      expiresAt: now + TWO_DAYS_MS,
      actions: [],
      lastSentHash: null,
      partnerEdited: false,
      meta: opts.meta || {}
    };
    canvasesCache.unshift(o);
    saveCanvases(canvasesCache).catch(()=>{});
    throttledSave();
    return o;
  }

  function findCanvasById(id) { return canvasesCache.find(c => c.id === id); }

  // UI: toolbar markup builder
  function buildToolbar(container) {
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

        <div><strong>Brush size</strong></div>
        <input id="canvas-size" type="range" min="1" max="60" value="4">

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
    // select brush by default
    const defaultBtn = container.querySelector('button[data-tool="brush"]');
    if (defaultBtn) { defaultBtn.classList.add('active'); container.dataset.selectedTool = 'brush'; }
  }

  // --- Modal & interaction state ---
  function openCanvasModal(canvasId) {
    const modal = document.getElementById('canvas-modal');
    const canvasEl = document.getElementById('drawing-canvas');
    const toolbar = document.getElementById('canvas-toolbar');

    if (!modal || !canvasEl || !toolbar) { console.warn('Canvas modal elements missing'); return; }
    modal.style.display = 'flex';

    // build toolbar UI once
    if (!toolbar.dataset.built) {
      buildToolbar(toolbar);
      toolbar.dataset.built = '1';
      // attach toolbar events
      document.getElementById('canvas-undo').addEventListener('click', () => doUndo());
      document.getElementById('canvas-clear').addEventListener('click', () => doClear());
    }

    let canvasObj;
    if (canvasId) {
      canvasObj = findCanvasById(canvasId);
      if (!canvasObj) {
        canvasObj = createCanvasObject({ title: 'Loaded', shared:false });
      }
    } else {
      canvasObj = createCanvasObject({ title: 'New', shared:false });
    }

    activeCanvas = canvasObj;

    // set permission select
    const permSelect = document.getElementById('canvas-permission-select');
    if (permSelect) {
      permSelect.value = canvasObj.shared ? 'shared' : 'individual';
      permSelect.onchange = function() {
        const val = permSelect.value;
        canvasObj.shared = val === 'shared';
        canvasObj.owner = canvasObj.shared ? 'shared' : canvasObj.owner === 'shared' ? 'me' : canvasObj.owner;
        canvasObj.lastModifiedAt = Date.now();
        saveCanvases(canvasesCache);
      };
    }

    // locked checkbox (read-only after expiresAt)
    const lockCheckbox = document.getElementById('canvas-private-lock');
    if (lockCheckbox) {
      lockCheckbox.checked = Date.now() >= canvasObj.expiresAt;
      lockCheckbox.disabled = true; // editing lock is automatic after 2 days
    }

    // wire send to chat
    document.getElementById('canvas-send-to-chat').onclick = function() {
      sendCanvasToChat(canvasObj);
    };
    document.getElementById('canvas-save-close').onclick = function() { closeCanvasModal(); };

    // init drawing interactions
    initDrawingCanvas(canvasEl, canvasObj);
    redrawFromActions(canvasEl, canvasObj.actions || []);
  }

  function closeCanvasModal() {
    const modal = document.getElementById('canvas-modal');
    if (modal) modal.style.display = 'none';
    activeCanvas = null;
    saveCanvases(canvasesCache).catch(()=>{});
  }

  // create event handling for drawing
  function initDrawingCanvas(canvasEl, canvasObj) {
    canvasEl.width = CANVAS_DEFAULT_W;
    canvasEl.height = CANVAS_DEFAULT_H;
    const toolbar = document.getElementById('canvas-toolbar');
    const colorInput = document.getElementById('canvas-color');
    const sizeInput = document.getElementById('canvas-size');

    let drawing = false;
    let currentPoints = [];
    let startPoint = null;

    function canEdit(c) {
      // cannot edit after expiresAt; owner rules:
      // if not expired:
      // - individual created by me => only me can edit (we assume current UI user is 'me')
      // - individual created by partner => partner can edit (that's fine for partner agent)
      // - shared => both can edit
      if (!c) return true;
      if (Date.now() >= c.expiresAt) return false;
      // "owner" field: 'me'|'partner'|'shared'
      if (c.owner === 'me') return true; // current user is me
      if (c.owner === 'partner') {
        // current user is me -> I can still view but not edit partner's individual canvas (spec requires partner-created individual canvas -> partner can edit; user cannot? The spec: "Individual canvas created by partner → partner can edit." So for user UI, user should not be able to edit partner individual canvas.
        return false;
      }
      if (c.owner === 'shared') return true;
      return true;
    }

    // attach mouse/touch handlers
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
      drawing = true;
      currentPoints = [];
      startPoint = getPos(e);
      currentPoints.push(startPoint);
      e.preventDefault();
    }
    function moveDraw(e) {
      if (!drawing) return;
      const p = getPos(e);
      currentPoints.push(p);
      const tool = (toolbar && toolbar.dataset.selectedTool) || 'brush';
      // For brush/eraser we render progressive path
      if (tool === 'brush' || tool === 'eraser') {
        drawAction(ctx, { type: 'stroke', tool: tool === 'eraser' ? 'eraser' : 'brush', points: [ currentPoints[currentPoints.length-2], currentPoints[currentPoints.length-1] ], color: colorInput.value, width: parseInt(sizeInput.value,10) });
      } else {
        // redraw entire set to show preview
        redrawFromActions(canvasEl, (canvasObj.actions || []));
        // preview shape from startPoint to current p
        if (tool === 'line') drawAction(ctx, { type:'shape', shapeType:'line', x1:startPoint.x, y1:startPoint.y, x2:p.x, y2:p.y, color: colorInput.value, width: parseInt(sizeInput.value,10) });
        if (tool === 'rect') drawAction(ctx, { type:'shape', shapeType:'rect', x:Math.min(startPoint.x,p.x), y:Math.min(startPoint.y,p.y), w:Math.abs(p.x-startPoint.x), h:Math.abs(p.y-startPoint.y), color: colorInput.value, width: parseInt(sizeInput.value,10) });
        if (tool === 'circle') {
          const dx = p.x - startPoint.x, dy = p.y - startPoint.y, r = Math.sqrt(dx*dx + dy*dy);
          drawAction(ctx, { type:'shape', shapeType:'circle', cx:startPoint.x, cy:startPoint.y, r:r, color: colorInput.value, width: parseInt(sizeInput.value,10) });
        }
      }
      e.preventDefault();
    }
    function endDraw(e) {
      if (!drawing) return;
      drawing = false;
      const tool = (toolbar && toolbar.dataset.selectedTool) || 'brush';
      let action = null;
      if (tool === 'brush' || tool === 'eraser') {
        action = { type:'stroke', tool: tool, points: currentPoints.slice(), color: tool === 'eraser' ? '#000000' : (colorInput.value || '#000'), width: parseInt(sizeInput.value,10) };
      } else {
        const p = currentPoints[currentPoints.length-1] || startPoint;
        if (tool === 'line') action = { type:'shape', shapeType:'line', x1:startPoint.x, y1:startPoint.y, x2:p.x, y2:p.y, color: colorInput.value, width: parseInt(sizeInput.value,10) };
        if (tool === 'rect') action = { type:'shape', shapeType:'rect', x:Math.min(startPoint.x,p.x), y:Math.min(startPoint.y,p.y), w:Math.abs(p.x-startPoint.x), h:Math.abs(p.y-startPoint.y), color: colorInput.value, width: parseInt(sizeInput.value,10) };
        if (tool === 'circle') {
          const dx = p.x - startPoint.x, dy = p.y - startPoint.y, r = Math.sqrt(dx*dx + dy*dy);
          action = { type:'shape', shapeType:'circle', cx:startPoint.x, cy:startPoint.y, r:r, color: colorInput.value, width: parseInt(sizeInput.value,10) };
        }
      }
      if (action) {
        canvasObj.actions.push(action);
        canvasObj.lastModifiedAt = Date.now();
        canvasObj.partnerEdited = false; // user edit resets partnerEdited flag (to allow partner resend rule)
        saveCanvases(canvasesCache);
        throttledSave();
      }
      currentPoints = [];
      startPoint = null;
      // redraw final
      redrawFromActions(canvasEl, canvasObj.actions || []);
      e.preventDefault();
    }

    // attach events
    canvasEl.onpointerdown = startDraw;
    canvasEl.onpointermove = moveDraw;
    window.addEventListener('pointerup', endDraw);
    canvasEl.ontouchstart = startDraw;
    canvasEl.ontouchmove = moveDraw;
    canvasEl.ontouchend = endDraw;
    // mouse support
    canvasEl.onmousedown = startDraw;
    canvasEl.onmousemove = moveDraw;
    canvasEl.onmouseup = endDraw;

    // Undo
    window.doUndo = function() {
      if (!canvasObj || !canvasObj.actions || !canvasObj.actions.length) return;
      canvasObj.actions.pop();
      canvasObj.lastModifiedAt = Date.now();
      saveCanvases(canvasesCache).catch(()=>{});
      redrawFromActions(canvasEl, canvasObj.actions || []);
      throttledSave();
    };

    // Clear
    window.doClear = function() {
      if (!canEdit(canvasObj)) { notify('Cannot clear locked/expired canvas', 'warning'); return; }
      canvasObj.actions.push({ type:'clear' });
      canvasObj.lastModifiedAt = Date.now();
      saveCanvases(canvasesCache).catch(()=>{});
      redrawFromActions(canvasEl, canvasObj.actions || []);
      throttledSave();
    };

    // Expose a function to programmatically apply an action (used for partner)
    canvasObj.applyAction = function(action) {
      canvasObj.actions.push(action);
      canvasObj.lastModifiedAt = Date.now();
      canvasObj.partnerEdited = true;
      saveCanvases(canvasesCache).catch(()=>{});
      if (document.getElementById('canvas-modal') && document.getElementById('canvas-modal').style.display !== 'none' && activeCanvas && activeCanvas.id === canvasObj.id) {
        redrawFromActions(canvasEl, canvasObj.actions || []);
      }
      throttledSave();
    };
  }

  // Send to chat: snapshot must be immutable in message (dataURL snapshot), and message stores also some metadata for search
  function sendCanvasToChat(canvasObj) {
    if (!canvasObj) return;
    // create a temporary canvas to render structured actions at snapshot size
    const tmp = document.createElement('canvas');
    tmp.width = CANVAS_DEFAULT_W;
    tmp.height = CANVAS_DEFAULT_H;
    const ctx = tmp.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,tmp.width,tmp.height);
    for (const a of canvasObj.actions) drawAction(ctx, a);
    const dataURL = tmp.toDataURL('image/png');
    const hash = checksumSnapshotDataURL(dataURL);
    // Prevent partner repeated send of unchanged canvas (also applies to partner)
    if (canvasObj.lastSentHash === hash) {
      notify('No changes since last sent. Edit before sending again.', 'warning');
      return;
    }
    const msg = {
      id: uid('msg'),
      type: 'canvas-snapshot',
      createdAt: Date.now(),
      content: {
        canvasId: canvasObj.id,
        title: canvasObj.title || '',
        snapshot: dataURL, // immutable snapshot
        structured: JSON.parse(JSON.stringify(canvasObj.actions)), // copy of structured data at send-time
        width: CANVAS_DEFAULT_W,
        height: CANVAS_DEFAULT_H
      },
      from: 'me' // or other field depending on your message model
    };
    // push to messages using existing mechanism
    pushChatMessage(msg);
    canvasObj.lastSentHash = hash;
    saveCanvases(canvasesCache);
    throttledSave();
    notify('Canvas sent to chat', 'success');
  }

  // Helper to render a canvas snapshot inside a chat message when building the DOM for messages.
  // You should call this function inside your message rendering code when message.type === 'canvas-snapshot'.
  window.renderCanvasMessageNode = function(msg) {
    // returns a DOM node (image) for the snapshot; you can adapt to your chat layout
    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-msg';
    const img = document.createElement('img');
    img.src = (msg && msg.content && msg.content.snapshot) || '';
    img.style.maxWidth = '320px';
    img.style.borderRadius = '8px';
    img.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
    wrapper.appendChild(img);
    return wrapper;
  };

  // partner random doodle generator
  function randomBetween(a,b) { return a + Math.random() * (b - a); }
  function randInt(a,b) { return Math.floor(randomBetween(a,b+1)); }
  function randomColor() {
    const h = Math.floor(Math.random() * 360);
    const s = randInt(40,95);
    const l = randInt(30,70);
    return `hsl(${h} ${s}% ${l}%)`;
  }

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

  // partner agent tick: randomly choose a canvas the partner may edit and apply random doodle
  function partnerAgentTick() {
    // pick shared canvases or partner-created individual canvases
    if (!canvasesCache.length) return;
    if (Math.random() > PARTNER_DRAW_PROB) return;
    // choose eligible canvases
    const candidates = canvasesCache.filter(c => {
      // locked -> cannot edit
      if (Date.now() >= c.expiresAt) return false;
      // if individual created by user => partner cannot edit
      if (!c.shared && c.owner === 'me') return false;
      // individual created by partner -> partner can edit
      // shared -> partner can edit
      return true;
    });
    if (!candidates.length) return;
    const canvas = candidates[randInt(0,candidates.length-1)];
    // apply between 1 and 6 random actions
    const count = randInt(1,6);
    for (let i=0;i<count;i++) {
      const action = Math.random() > 0.45 ? generateRandomStroke() : generateRandomShape();
      // push into canvas actions and mark partnerEdited
      canvas.actions.push(action);
    }
    canvas.lastModifiedAt = Date.now();
    canvas.partnerEdited = true;
    saveCanvases(canvasesCache).catch(()=>{});
    throttledSave();

    // decide whether partner shares it to chat (only if they edited)
    if (Math.random() < PARTNER_SHARE_PROB) {
      // ensure partner doesn't send same unchanged canvas repeatedly: check lastSentHash
      // snapshot
      const tmp = document.createElement('canvas');
      tmp.width = CANVAS_DEFAULT_W; tmp.height = CANVAS_DEFAULT_H;
      const ctx = tmp.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,tmp.width,tmp.height);
      for (const a of canvas.actions) drawAction(ctx, a);
      const dataURL = tmp.toDataURL('image/png');
      const hash = checksumSnapshotDataURL(dataURL);
      if (canvas.lastSentHash !== hash) {
        // only send if partner actually edited since last send (partnerEdited true)
        if (canvas.partnerEdited) {
          const msg = {
            id: uid('msg'),
            type: 'canvas-snapshot',
            createdAt: Date.now(),
            content: {
              canvasId: canvas.id,
              title: canvas.title || '',
              snapshot: dataURL,
              structured: JSON.parse(JSON.stringify(canvas.actions)),
              width: CANVAS_DEFAULT_W, height: CANVAS_DEFAULT_H
            },
            from: 'partner' // depends on your message format
          };
          pushChatMessage(msg);
          canvas.lastSentHash = hash;
          canvas.partnerEdited = false; // reset so partner must edit again before sending
          saveCanvases(canvasesCache).catch(()=>{});
          throttledSave();
          // optionally notify user
          try { window._sendPartnerNotification && window._sendPartnerNotification('对方绘制了一幅画', '点开查看'); } catch(e){}
        }
      }
    }
  }

  // Start partner agent
  let partnerAgentHandle = null;
  function startPartnerAgent() {
    if (partnerAgentHandle) clearInterval(partnerAgentHandle);
    partnerAgentHandle = setInterval(partnerAgentTick, PARTNER_TICK_INTERVAL);
  }

  // Expose API to create/open canvas from code
  window.drawTogether = {
    openCanvasModalById: function(id) { openCanvasModal(id); },
    newCanvas: function(opts){ const c = createCanvasObject(opts||{}); saveCanvases(canvasesCache); return c; },
    listCanvases: function(){ return canvasesCache.slice(); },
    load: async function() { await loadAndCache(); return canvasesCache; },
    saveAll: function(){ return saveCanvases(canvasesCache); }
  };

  // wire up button & startup
  document.addEventListener('DOMContentLoaded', async function() {
    await loadAndCache();
    startPartnerAgent();

    // attach canvas button
    const canvasBtn = document.getElementById('canvas-btn');
    if (canvasBtn) {
      canvasBtn.addEventListener('click', () => {
        // default create new canvas and open
        const c = createCanvasObject({ title: 'My Canvas', owner: 'me', shared: false });
        openCanvasModal(c.id);
      });
    }

    // If other UI wants to open existing ones, developer can call drawTogether.openCanvasModalById(id)
  });
})();
