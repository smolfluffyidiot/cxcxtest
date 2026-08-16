/* name=js/draw-together.js
   Draw Together canvas integration for cxcxtest
   - Integrates with existing UI and addMessage/messages system
   - Persists structured drawing data (actions) with localforage/localStorage
   - Random partner doodles generated when user sends
*/

(function() {
  // Configuration
  const CANVAS_W = 800;
  const CANVAS_H = 500;
  const STORAGE_KEY_SUFFIX = 'canvas_last_drawing';
  const PARTNER_DRAW_PROBABILITY = 0.55; // chance partner sends a doodle reply
  const PARTNER_DRAW_MIN_OBJECTS = 3;
  const PARTNER_DRAW_MAX_OBJECTS = 12;

  // Helpers for storage key (respect existing APP_PREFIX/getStorageKey if present)
  function getCanvasStorageKey() {
    try {
      if (typeof getStorageKey === 'function') {
        return getStorageKey(STORAGE_KEY_SUFFIX);
      }
      const prefix = (typeof window.APP_PREFIX === 'string') ? window.APP_PREFIX : 'app_';
      return prefix + STORAGE_KEY_SUFFIX;
    } catch (e) {
      return 'app_' + STORAGE_KEY_SUFFIX;
    }
  }

  function saveToStorage(key, value) {
    try {
      if (window.localforage) return localforage.setItem(key, value).catch(()=>{});
      localStorage.setItem(key, JSON.stringify(value));
      return Promise.resolve();
    } catch(e) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch(_) {}
      return Promise.resolve();
    }
  }
  function loadFromStorage(key) {
    try {
      if (window.localforage) return localforage.getItem(key).catch(()=>null);
      const raw = localStorage.getItem(key);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch(e) {
      try { const raw = localStorage.getItem(key); return Promise.resolve(raw ? JSON.parse(raw) : null); } catch(_) { return Promise.resolve(null); }
    }
  }

  // DOM references (modal is present in config.html)
  const attachBtn = document.getElementById('attachment-btn');
  const canvasModal = document.getElementById('canvas-modal');
  const canvasEl = document.getElementById('drawing-canvas');
  const toolbarWrap = document.getElementById('canvas-toolbar');
  const sendBtn = document.getElementById('canvas-send-to-chat');
  const closeBtn = document.getElementById('canvas-save-close');
  const newBtn = document.getElementById('canvas-new');
  const undoBtn = document.getElementById('canvas-undo');
  const clearBtn = document.getElementById('canvas-clear');
  const privateLock = document.getElementById('canvas-private-lock');

  if (!canvasModal || !canvasEl || !toolbarWrap) {
    // if expected markup missing, nothing to do
    console.warn('[draw-together] Required canvas modal elements missing; script loaded but disabled.');
    return;
  }

  // Dynamically add a Canvas button near the attachment button
  function createCanvasLauncher() {
    try {
      if (document.getElementById('canvas-btn')) return;
      const btn = document.createElement('button');
      btn.id = 'canvas-btn';
      btn.className = 'attachment-btn input-btn collapse-hideable';
      btn.title = '画布 (Draw Together)';
      btn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      btn.style.width = getComputedStyle(attachBtn).width || '40px';
      // Insert before attachment button if possible
      if (attachBtn && attachBtn.parentNode) {
        attachBtn.parentNode.insertBefore(btn, attachBtn);
      } else {
        // fallback to append to input-buttons
        const inputButtons = document.querySelector('.input-buttons');
        if (inputButtons) inputButtons.insertBefore(btn, inputButtons.firstChild);
      }
      btn.addEventListener('click', openCanvasModal);
    } catch(e) { console.warn('[draw-together] createCanvasLauncher error', e); }
  }

  // Canvas state
  let ctx, pixelRatio = 1;
  let drawing = false;
  let currentTool = 'brush'; // brush, eraser, line, polygon, circle, rect
  let currentColor = '#000000';
  let brushSize = 4;
  let polygonSides = 5;
  let actions = []; // structured actions list
  let undone = [];
  let pointerStart = null; // for line/shape start
  let tempShape = null; // temporary shape during drag
  let saveDebounceTimer = null;

  // Initialize canvas (set backing store for high DPI)
  function initCanvas() {
    ctx = canvasEl.getContext('2d', { alpha: true });
    resizeCanvas();
    redraw();
    bindCanvasEvents();
  }

  function resizeCanvas() {
    // Keep internal resolution fixed (CANVAS_W x CANVAS_H), but scale for DPR
    pixelRatio = window.devicePixelRatio || 1;
    // We want the canvas element to be responsive in layout; the markup already sets max-width:100% and height:auto.
    // Keep backing store at fixed resolution for consistent drawing.
    canvasEl.width = CANVAS_W * pixelRatio;
    canvasEl.height = CANVAS_H * pixelRatio;
    canvasEl.style.width = '100%';
    canvasEl.style.height = 'auto';
    ctx = canvasEl.getContext('2d', { alpha: true });
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  // Convert client coordinates to canvas coordinate system
  function getCanvasPos(evt) {
    const rect = canvasEl.getBoundingClientRect();
    const p = evt.touches && evt.touches[0] ? evt.touches[0] : evt;
    const x = (p.clientX - rect.left) * (CANVAS_W / rect.width);
    const y = (p.clientY - rect.top) * (CANVAS_H / rect.height);
    return { x, y };
  }

  // Structured drawing data format examples:
  // { type:'stroke', mode:'brush'|'eraser', color:'#000', width:4, points:[{x,y}, ...] }
  // { type:'line', x1,y1,x2,y2, color, width }
  // { type:'rect', x,y,w,h, color, width, fill }
  // { type:'circle', cx,cy,r, color, width, fill }
  // { type:'polygon', cx,cy,r,sides,rotation,color,width,fill }

  function pushAction(act, { save = true } = {}) {
    actions.push(act);
    undone = [];
    if (save) scheduleSave();
    redraw();
  }

  function undo() {
    if (!actions.length) return;
    const last = actions.pop();
    undone.push(last);
    scheduleSave();
    redraw();
  }
  function redo() {
    if (!undone.length) return;
    const act = undone.pop();
    actions.push(act);
    scheduleSave();
    redraw();
  }
  function clearCanvasData() {
    actions = [];
    undone = [];
    scheduleSave();
    redraw();
  }

  function redraw() {
    // clear
    ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
    // white background
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
    ctx.restore();

    // render every action
    for (const a of actions) drawAction(ctx, a);
    // render temp shape if exists
    if (tempShape) drawAction(ctx, tempShape, { isTemp: true });
  }

  function drawAction(context, a, opts = {}) {
    // opts.isTemp => e.g. dashed preview
    if (!a || !context) return;
    if (a.type === 'stroke') {
      context.save();
      if (a.mode === 'eraser') {
        // simulate eraser by composite operation
        context.globalCompositeOperation = 'destination-out';
        context.lineWidth = a.width;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        for (let i=0;i<a.points.length;i++){
          const p = a.points[i];
          if (i===0) context.moveTo(p.x, p.y);
          else context.lineTo(p.x, p.y);
        }
        context.stroke();
      } else {
        context.globalCompositeOperation = 'source-over';
        context.strokeStyle = a.color || '#000';
        context.lineWidth = a.width || 2;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        for (let i=0;i<a.points.length;i++){
          const p = a.points[i];
          if (i===0) context.moveTo(p.x, p.y);
          else context.lineTo(p.x, p.y);
        }
        context.stroke();
      }
      context.restore();
    } else if (a.type === 'line') {
      context.save();
      context.strokeStyle = a.color || '#000';
      context.lineWidth = a.width || 2;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(a.x1, a.y1);
      context.lineTo(a.x2, a.y2);
      if (opts.isTemp) {
        context.setLineDash([6,6]);
      }
      context.stroke();
      context.restore();
    } else if (a.type === 'rect') {
      context.save();
      context.lineWidth = a.width || 2;
      context.strokeStyle = a.color || '#000';
      if (a.fill) {
        context.fillStyle = a.fill;
        context.fillRect(a.x, a.y, a.w, a.h);
      }
      if (opts.isTemp) context.setLineDash([6,6]);
      context.strokeRect(a.x, a.y, a.w, a.h);
      context.restore();
    } else if (a.type === 'circle') {
      context.save();
      context.lineWidth = a.width || 2;
      context.strokeStyle = a.color || '#000';
      context.beginPath();
      context.arc(a.cx, a.cy, a.r, 0, Math.PI*2);
      if (a.fill) {
        context.fillStyle = a.fill;
        context.fill();
      }
      if (opts.isTemp) context.setLineDash([6,6]);
      context.stroke();
      context.restore();
    } else if (a.type === 'polygon') {
      context.save();
      context.lineWidth = a.width || 2;
      context.strokeStyle = a.color || '#000';
      const n = Math.max(3, Math.floor(a.sides || 3));
      const rot = a.rotation || 0;
      context.beginPath();
      for (let i=0;i<n;i++){
        const ang = rot + (i / n) * Math.PI * 2;
        const x = a.cx + Math.cos(ang) * a.r;
        const y = a.cy + Math.sin(ang) * a.r;
        if (i===0) context.moveTo(x,y);
        else context.lineTo(x,y);
      }
      context.closePath();
      if (a.fill) {
        context.fillStyle = a.fill;
        context.fill();
      }
      if (opts.isTemp) context.setLineDash([6,6]);
      context.stroke();
      context.restore();
    }
  }

  // Event binding for canvas pointer input
  function bindCanvasEvents() {
    let currentStroke = null;

    function onPointerDown(e) {
      e.preventDefault();
      const pos = getCanvasPos(e);
      drawing = true;
      pointerStart = pos;
      tempShape = null;

      if (currentTool === 'brush' || currentTool === 'eraser') {
        currentStroke = {
          type: 'stroke',
          mode: currentTool === 'eraser' ? 'eraser' : 'brush',
          color: currentColor,
          width: brushSize,
          points: [{ x: pos.x, y: pos.y }]
        };
        pushAction(currentStroke, { save: false });
      } else if (currentTool === 'line' || currentTool === 'circle' || currentTool === 'rect' || currentTool === 'polygon') {
        // start tracking temp shape
        // temp shape will be drawn dynamically and pushed on pointer up
        tempShape = null;
      }
    }

    function onPointerMove(e) {
      if (!drawing) {
        // on hover update nothing
        return;
      }
      const pos = getCanvasPos(e);
      if (currentTool === 'brush' || currentTool === 'eraser') {
        if (!currentStroke) return;
        currentStroke.points.push({ x: pos.x, y: pos.y });
        // redraw last stroke (we added it to actions earlier)
        // fastest: redraw whole
        redraw();
      } else if (currentTool === 'line') {
        tempShape = {
          type: 'line',
          x1: pointerStart.x, y1: pointerStart.y,
          x2: pos.x, y2: pos.y,
          color: currentColor, width: brushSize
        };
        redraw();
      } else if (currentTool === 'circle') {
        const dx = pos.x - pointerStart.x;
        const dy = pos.y - pointerStart.y;
        const r = Math.sqrt(dx*dx + dy*dy);
        tempShape = { type: 'circle', cx: pointerStart.x, cy: pointerStart.y, r, color: currentColor, width: brushSize };
        redraw();
      } else if (currentTool === 'rect') {
        const x = Math.min(pointerStart.x, pos.x);
        const y = Math.min(pointerStart.y, pos.y);
        const w = Math.abs(pos.x - pointerStart.x);
        const h = Math.abs(pos.y - pointerStart.y);
        tempShape = { type: 'rect', x, y, w, h, color: currentColor, width: brushSize };
        redraw();
      } else if (currentTool === 'polygon') {
        const dx = pos.x - pointerStart.x;
        const dy = pos.y - pointerStart.y;
        const r = Math.sqrt(dx*dx + dy*dy);
        tempShape = { type: 'polygon', cx: pointerStart.x, cy: pointerStart.y, r, sides: polygonSides, rotation: 0, color: currentColor, width: brushSize };
        redraw();
      }
    }

    function onPointerUp(e) {
      if (!drawing) return;
      drawing = false;
      const pos = getCanvasPos(e);
      if (currentTool === 'brush' || currentTool === 'eraser') {
        // already added and mutated currentStroke in actions
        currentStroke = null;
        scheduleSave();
      } else if (currentTool === 'line') {
        const act = {
          type: 'line',
          x1: pointerStart.x, y1: pointerStart.y,
          x2: pos.x, y2: pos.y,
          color: currentColor, width: brushSize
        };
        pushAction(act);
        tempShape = null;
      } else if (currentTool === 'circle') {
        const dx = pos.x - pointerStart.x;
        const dy = pos.y - pointerStart.y;
        const r = Math.sqrt(dx*dx + dy*dy);
        const act = { type: 'circle', cx: pointerStart.x, cy: pointerStart.y, r, color: currentColor, width: brushSize };
        pushAction(act);
        tempShape = null;
      } else if (currentTool === 'rect') {
        const x = Math.min(pointerStart.x, pos.x);
        const y = Math.min(pointerStart.y, pos.y);
        const w = Math.abs(pos.x - pointerStart.x);
        const h = Math.abs(pos.y - pointerStart.y);
        const act = { type: 'rect', x, y, w, h, color: currentColor, width: brushSize };
        pushAction(act);
        tempShape = null;
      } else if (currentTool === 'polygon') {
        const dx = pos.x - pointerStart.x;
        const dy = pos.y - pointerStart.y;
        const r = Math.sqrt(dx*dx + dy*dy);
        const act = { type: 'polygon', cx: pointerStart.x, cy: pointerStart.y, r, sides: polygonSides, rotation: 0, color: currentColor, width: brushSize };
        pushAction(act);
        tempShape = null;
      }
      pointerStart = null;
      redraw();
    }

    // pointer events (handle touch and mouse)
    canvasEl.addEventListener('mousedown', onPointerDown);
    canvasEl.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    canvasEl.addEventListener('touchstart', function(e){ onPointerDown(e); }, { passive:false });
    canvasEl.addEventListener('touchmove', function(e){ onPointerMove(e); }, { passive:false });
    window.addEventListener('touchend', function(e){ onPointerUp(e); });

    // prevent scroll when touching canvas on mobile
    canvasEl.addEventListener('touchstart', function(e){ e.preventDefault(); }, { passive:false });
  }

  // Save/load canvas structured data
  function scheduleSave() {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      const payload = {
        version: 1,
        actions,
        updatedAt: Date.now()
      };
      saveToStorage(getCanvasStorageKey(), payload).then(()=> {
        try { if (typeof throttledSaveData === 'function') throttledSaveData(); } catch(_) {}
      });
    }, 300);
  }

  function loadSavedCanvas() {
    loadFromStorage(getCanvasStorageKey()).then(data => {
      if (!data || !data.actions) return;
      actions = data.actions || [];
      undone = [];
      redraw();
    }).catch(()=>{});
  }

  // UI toolbar creation
  function buildToolbar() {
    toolbarWrap.innerHTML = ''; // clear
    // Tools row
    const toolsRow = document.createElement('div');
    toolsRow.style.display = 'grid';
    toolsRow.style.gridTemplateColumns = 'repeat(2, 1fr)';
    toolsRow.style.gap = '8px';
    toolsRow.style.marginBottom = '10px';

    const tools = [
      { id: 'brush', icon: 'fas fa-pencil-alt', title:'Brush' },
      { id: 'eraser', icon: 'fas fa-eraser', title:'Eraser' },
      { id: 'line', icon: 'fas fa-slash', title:'Line' },
      { id: 'polygon', icon: 'fas fa-draw-polygon', title:'Polygon' },
      { id: 'circle', icon: 'fas fa-circle', title:'Circle' },
      { id: 'rect', icon: 'far fa-square', title:'Rectangle' }
    ];
    const toolButtonsRow = document.createElement('div');
    toolButtonsRow.style.display = 'flex';
    toolButtonsRow.style.flexWrap = 'wrap';
    toolButtonsRow.style.gap = '8px';
    tools.forEach(t => {
      const b = document.createElement('button');
      b.className = 'modal-btn';
      b.title = t.title;
      b.dataset.tool = t.id;
      b.innerHTML = `<i class="${t.icon}"></i>`;
      b.style.flex = '1 0 46%';
      b.addEventListener('click', () => {
        currentTool = t.id;
        // update UI highlight
        toolButtonsRow.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
      });
      toolButtonsRow.appendChild(b);
    });
    toolsRow.appendChild(toolButtonsRow);

    // Color and size
    const colorRow = document.createElement('div');
    colorRow.style.display = 'flex';
    colorRow.style.gap = '8px';
    colorRow.style.alignItems = 'center';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = currentColor;
    colorInput.title = 'Color';
    colorInput.style.width = '44px';
    colorInput.addEventListener('input', (e) => { currentColor = e.target.value; });

    const sizeLabel = document.createElement('div');
    sizeLabel.style.fontSize = '12px';
    sizeLabel.style.color = 'var(--text-secondary)';
    sizeLabel.textContent = `Size: ${brushSize}px`;

    const sizeInput = document.createElement('input');
    sizeInput.type = 'range';
    sizeInput.min = 1;
    sizeInput.max = 60;
    sizeInput.value = brushSize;
    sizeInput.addEventListener('input', (e) => {
      brushSize = parseInt(e.target.value,10);
      sizeLabel.textContent = `Size: ${brushSize}px`;
    });

    colorRow.appendChild(colorInput);
    colorRow.appendChild(sizeInput);
    colorRow.appendChild(sizeLabel);

    // Polygon sides control
    const polygonRow = document.createElement('div');
    polygonRow.style.display = 'flex';
    polygonRow.style.gap = '8px';
    polygonRow.style.alignItems = 'center';
    polygonRow.style.marginTop = '8px';

    const polyLabel = document.createElement('div');
    polyLabel.style.fontSize = '12px';
    polyLabel.style.color = 'var(--text-secondary)';
    polyLabel.textContent = 'Polygon sides:';

    const polyInput = document.createElement('input');
    polyInput.type = 'number';
    polyInput.min = 3;
    polyInput.max = 12;
    polyInput.value = polygonSides;
    polyInput.style.width = '64px';
    polyInput.addEventListener('change', (e)=> {
      polygonSides = Math.max(3, Math.min(12, parseInt(e.target.value,10) || 5));
      polyInput.value = polygonSides;
    });

    polygonRow.appendChild(polyLabel);
    polygonRow.appendChild(polyInput);

    // Utility buttons (New/Undo/Clear) are already present in modal, but hook them anyway
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        if (!confirm('Create new canvas? Current drawing will be cleared.')) return;
        clearCanvasData();
      });
    }
    if (undoBtn) {
      undoBtn.addEventListener('click', undo);
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!confirm('Clear the canvas?')) return;
        clearCanvasData();
      });
    }

    // Export (Send to Chat)
    if (sendBtn) {
      sendBtn.addEventListener('click', sendToChat);
    }

    // Close behavior: save then close modal
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        scheduleSave();
        hideModal();
      });
    }

    // Private lock toggling: allow user to toggle (doesn't enforce server-side behavior, just UI flag)
    if (privateLock) {
      // enable toggling the checkbox by clicking its label region
      privateLock.parentNode && privateLock.parentNode.addEventListener('click', () => {
        privateLock.checked = !privateLock.checked;
      });
    }

    // Assemble toolbar
    toolbarWrap.appendChild(toolsRow);
    toolbarWrap.appendChild(colorRow);
    toolbarWrap.appendChild(polygonRow);

    // Set default active tool (brush)
    setTimeout(() => {
      const firstToolBtn = toolButtonsRow.querySelector('button[data-tool="brush"]');
      if (firstToolBtn) firstToolBtn.classList.add('active');
    }, 40);
  }

  // Modal show/hide helpers
  function openCanvasModal() {
    // show the modal (modal class expected to be used)
    try {
      if (typeof showModal === 'function') {
        showModal(canvasModal);
      } else {
        canvasModal.style.display = 'flex';
        canvasModal.classList.remove('hidden');
      }
    } catch(e) {
      canvasModal.style.display = 'flex';
      canvasModal.classList.remove('hidden');
    }
    // resize and load saved
    setTimeout(() => {
      resizeCanvas();
      loadSavedCanvas();
      redraw();
    }, 50);
  }
  function hideModal() {
    try {
      if (typeof hideModal === 'function') hideModal(canvasModal);
      else {
        canvasModal.style.display = 'none';
        canvasModal.classList.add('hidden');
      }
    } catch(e) {
      canvasModal.style.display = 'none';
      canvasModal.classList.add('hidden');
    }
  }

  // Convert current canvas to dataURL and send as a chat message
  function sendToChat() {
    // Build an image snapshot (use offscreen canvas to render same actions at known resolution)
    const off = document.createElement('canvas');
    off.width = CANVAS_W;
    off.height = CANVAS_H;
    const octx = off.getContext('2d');
    // white background
    octx.fillStyle = '#ffffff';
    octx.fillRect(0,0,off.width,off.height);
    // draw actions
    for (const a of actions) drawAction(octx, a);
    const dataUrl = off.toDataURL('image/png');
    const drawingPayload = {
      id: Date.now(),
      sender: 'user',
      text: '',
      timestamp: new Date(),
      image: dataUrl, // snapshot
      drawingData: JSON.parse(JSON.stringify(actions)), // structured copy
      status: 'sent',
      type: 'drawing'
    };
    // Use addMessage to insert as user's message
    try {
      if (typeof addMessage === 'function') {
        addMessage(drawingPayload);
      } else {
        // fallback: push to messages array and render
        if (Array.isArray(messages)) {
          messages.push(drawingPayload);
          if (typeof renderMessages === 'function') renderMessages();
        }
      }
    } catch (e) {
      console.warn('[draw-together] sendToChat addMessage failed:', e);
    }

    // Play send sound if available
    try { if (typeof playSound === 'function') playSound('send'); } catch(_) {}

    // Persist (optionally keep last canvas saved)
    scheduleSave();

    // After sending user drawing, possibly generate partner drawing
    maybeGeneratePartnerDoodle();

    // Close modal
    hideModal();
  }

  // Partner random doodle generator (no templates, only primitives)
  function maybeGeneratePartnerDoodle() {
    try {
      const r = Math.random();
      if (r > PARTNER_DRAW_PROBABILITY) return;
      // schedule reply after a short random delay
      const delay = 800 + Math.random() * 2000;
      setTimeout(() => {
        generateRandomDoodle().then(({dataUrl, actions: partnerActions}) => {
          const msg = {
            id: Date.now() + 1,
            sender: 'partner',
            text: '',
            timestamp: new Date(),
            image: dataUrl,
            drawingData: partnerActions,
            status: 'sent',
            type: 'drawing'
          };
          try {
            if (typeof addMessage === 'function') addMessage(msg);
            else { messages.push(msg); if (typeof renderMessages === 'function') renderMessages(); }
            // maybe mark partner typing visual before adding (simulate)
          } catch(e) {
            console.warn('[draw-together] partner addMessage failed', e);
          }
        }).catch(e => console.warn('partner doodle gen error', e));
      }, delay);
    } catch(e) { console.warn('maybeGeneratePartnerDoodle error', e); }
  }

  // Generate a random doodle actions array and snapshot
  function generateRandomDoodle() {
    return new Promise((resolve) => {
      const count = PARTNER_DRAW_MIN_OBJECTS + Math.floor(Math.random() * (PARTNER_DRAW_MAX_OBJECTS - PARTNER_DRAW_MIN_OBJECTS + 1));
      const acts = [];
      for (let i=0;i<count;i++){
        const kind = weightedChoice(['stroke', 'line', 'circle', 'rect', 'polygon'], [40,20,15,15,10]);
        if (kind === 'stroke') {
          const pts = [];
          const numPts = 4 + Math.floor(Math.random() * 18);
          // start at random pos
          let x = randRange(40, CANVAS_W - 40), y = randRange(40, CANVAS_H - 40);
          for (let p=0;p<numPts;p++){
            x += randRange(-40,40);
            y += randRange(-40,40);
            x = clamp(x, 10, CANVAS_W-10);
            y = clamp(y, 10, CANVAS_H-10);
            pts.push({ x, y });
          }
          acts.push({
            type: 'stroke',
            mode: 'brush',
            color: randomColor(),
            width: 1 + Math.floor(Math.random()*8),
            points: pts
          });
        } else if (kind === 'line') {
          acts.push({
            type: 'line',
            x1: randRange(20, CANVAS_W-20),
            y1: randRange(20, CANVAS_H-20),
            x2: randRange(20, CANVAS_W-20),
            y2: randRange(20, CANVAS_H-20),
            color: randomColor(),
            width: 1 + Math.floor(Math.random()*6)
          });
        } else if (kind === 'circle') {
          const cx = randRange(40, CANVAS_W-40), cy = randRange(40, CANVAS_H-40), r = randRange(10, Math.min(120, CANVAS_W/3));
          acts.push({ type: 'circle', cx, cy, r, color: randomColor(), width: 1 + Math.floor(Math.random()*6), fill: Math.random() < 0.35 ? randomTranslucentColor() : null });
        } else if (kind === 'rect') {
          const x1 = randRange(10, CANVAS_W-100), y1 = randRange(10, CANVAS_H-100);
          const w = randRange(20, 180), h = randRange(20, 180);
          acts.push({ type: 'rect', x: x1, y: y1, w, h, color: randomColor(), width: 1 + Math.floor(Math.random()*6), fill: Math.random() < 0.35 ? randomTranslucentColor() : null });
        } else if (kind === 'polygon') {
          const cx = randRange(40, CANVAS_W-40), cy = randRange(40, CANVAS_H-40), r = randRange(12, 120), sides = 3 + Math.floor(Math.random()*6);
          acts.push({ type: 'polygon', cx, cy, r, sides, rotation: Math.random()*Math.PI*2, color: randomColor(), width: 1 + Math.floor(Math.random()*6), fill: Math.random() < 0.35 ? randomTranslucentColor() : null });
        }
      }

      // render to offscreen canvas
      const off = document.createElement('canvas');
      off.width = CANVAS_W;
      off.height = CANVAS_H;
      const c = off.getContext('2d');
      c.fillStyle = '#ffffff'; c.fillRect(0,0,off.width,off.height);
      for (const a of acts) drawAction(c, a);
      const url = off.toDataURL('image/png');
      resolve({ dataUrl: url, actions: acts });
    });
  }

  // Utility functions
  function randRange(a,b){ return a + Math.random()*(b-a); }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function randomColor() {
    // choose nice hue
    const h = Math.floor(Math.random()*360);
    const s = 55 + Math.floor(Math.random()*40);
    const l = 30 + Math.floor(Math.random()*40);
    return `hsl(${h} ${s}% ${l}%)`;
  }
  function randomTranslucentColor() {
    const h = Math.floor(Math.random()*360);
    const s = 50 + Math.floor(Math.random()*40);
    const l = 40 + Math.floor(Math.random()*20);
    const a = 0.15 + Math.random()*0.5;
    return `hsla(${h}, ${s}%, ${l}%, ${a})`;
  }
  function weightedChoice(items, weights) {
    const total = weights.reduce((s,w)=>s+w,0);
    let r = Math.random()*total;
    for (let i=0;i<items.length;i++){
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length-1];
  }

  // Initialize toolbar, launcher, canvas etc once DOM ready
  function bootstrap() {
    createCanvasLauncher();
    buildToolbar();
    initCanvas();
    loadSavedCanvas();
    // keep canvas resized on window resize
    window.addEventListener('resize', () => {
      resizeCanvas();
      redraw();
    });
  }

  // Expose some dev helpers (optional)
  window.__drawTogether = {
    open: openCanvasModal,
    close: hideModal,
    getActions: ()=>actions,
    load: loadSavedCanvas,
    clear: clearCanvasData
  };

  // Launch when DOM ready (if not already)
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(bootstrap, 50);
  } else {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  }

})();
