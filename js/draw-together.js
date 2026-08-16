/* name=js/draw-together.js
   Safer integration: injects a self-contained, collapsible Draw Together panel
   that does not rely on the modal or other fragile DOM. Defensive, persistent,
   mobile-friendly and integrates with existing addMessage / messages / renderMessages.
*/
(function(){
  'use strict';

  // CONFIG
  const CANVAS_W = 800;
  const CANVAS_H = 500;
  const STORAGE_KEY = (function(){
    try { if (typeof window.APP_PREFIX === 'string') return window.APP_PREFIX + 'draw_together_v1'; } catch(e){}
    return 'draw_together_v1';
  })();
  const PARTNER_REPLY_CHANCE = 1;
  const PARTNER_MIN_OBJ = 3;
  const PARTNER_MAX_OBJ = 10;
  const SAVE_DEBOUNCE_MS = 300;

  // SAFETY WRAPPERS
  const log = (...args) => { try { console.info('[DrawTogether]', ...args); } catch(e){} };
  const warn = (...args) => { try { console.warn('[DrawTogether]', ...args); } catch(e){} };
  const err = (...args) => { try { console.error('[DrawTogether]', ...args); } catch(e){} };

  // Storage helpers (localforage if available)
  function save(key, value){
    try {
      if (window.localforage) return localforage.setItem(key, value).catch(e => { warn('localforage.setItem failed',e); });
      localStorage.setItem(key, JSON.stringify(value));
      return Promise.resolve();
    } catch(e){
      try { localStorage.setItem(key, JSON.stringify(value)); } catch(_) {}
      return Promise.resolve();
    }
  }
  function load(key){
    try {
      if (window.localforage) return localforage.getItem(key).catch(e => { warn('localforage.getItem failed',e); return null; });
      const raw = localStorage.getItem(key);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch(e){
      try { const raw2 = localStorage.getItem(key); return Promise.resolve(raw2 ? JSON.parse(raw2) : null); } catch(_) { return Promise.resolve(null); }
    }
  }

  // Minimal CSS for panel (scoped)
  const STYLE_ID = 'draw-together-styles';
  function injectStyles(){
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#dt-panel { position: fixed; right: 14px; bottom: 86px; width: 92%; max-width: 920px; z-index: 12000; font-family: system-ui, -apple-system, "Noto Sans", "Noto Serif", sans-serif; }
#dt-launcher { position: fixed; right: 18px; bottom: 18px; z-index:13000; width:54px;height:54px;border-radius:50%;background:var(--accent-color, #ff8b6a);border:none;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;font-size:18px; }
#dt-container { background: var(--secondary-bg, #fff); border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.25); overflow:hidden; display:flex; gap:12px; padding:12px; align-items:flex-start; }
#dt-toolbar { width:260px; flex-shrink:0; display:flex; flex-direction:column; gap:8px; }
#dt-canvas-wrap { flex:1; display:flex; flex-direction:column; gap:8px; }
#dt-canvas { width:100%; height:auto; background:#fff; border-radius:6px; display:block; touch-action:none; }
.dt-btn { padding:8px 10px; border-radius:10px; border:none; background:var(--primary-bg, #f5f5f5); cursor:pointer; color:var(--text-primary, #111); }
.dt-btn.primary { background:var(--accent-color, #ff8b6a); color:white; }
.dt-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.dt-tools button { width:48%; }
@media (max-width:640px){ #dt-panel { left:8px; right:8px; bottom:78px; } #dt-toolbar{width:44%;} }
    `;
    const s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = css; document.head.appendChild(s);
  }

  // Build DOM: launcher button + panel
  function buildUI(){
    if (document.getElementById('dt-launcher')) return getUI();
    injectStyles();

    const launcher = document.createElement('button');
    launcher.id = 'dt-launcher';
    launcher.title = 'Draw Together';
    launcher.innerHTML = '<i class="fas fa-paint-brush"></i>';
    document.body.appendChild(launcher);

    const panel = document.createElement('div');
    panel.id = 'dt-panel';
    panel.style.display = 'none';

    panel.innerHTML = `
      <div id="dt-container" role="dialog" aria-label="Draw Together">
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
            <input id="dt-color" type="color" value="#111111" style="width:46px;height:36px;border:none;padding:0;background:none;">
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
  function getUI(){
    return {
      launcher: document.getElementById('dt-launcher'),
      panel: document.getElementById('dt-panel'),
      container: document.getElementById('dt-container'),
      canvas: document.getElementById('dt-canvas'),
      toolbar: document.getElementById('dt-toolbar'),
      sendBtn: document.getElementById('dt-send'),
      closeBtn: document.getElementById('dt-close'),
      newBtn: document.getElementById('dt-new'),
      undoBtn: document.getElementById('dt-undo'),
      clearBtn: document.getElementById('dt-clear'),
      colorInput: document.getElementById('dt-color'),
      sizeInput: document.getElementById('dt-size'),
      polyInput: document.getElementById('dt-poly-sides'),
      toolButtons: Array.from(document.querySelectorAll('#dt-toolbar [data-tool]'))
    };
  }

  // Drawing engine
  function makeEngine(ui){
    const canvas = ui.canvas;
    let ctx = canvas.getContext('2d', { alpha: true });
    let dpr = Math.max(1, window.devicePixelRatio || 1);
    let logicalW = CANVAS_W, logicalH = CANVAS_H;

    function setup() {
      canvas.width = logicalW * dpr;
      canvas.height = logicalH * dpr;
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      ctx = canvas.getContext('2d', { alpha: true });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // structured actions
    // stroke: { type:'stroke', mode:'brush'|'eraser', color, width, points: [{x,y},...] }
    // line: { type:'line', x1,y1,x2,y2, color, width }
    // rect: { type:'rect', x,y,w,h, color, width }
    // circle: { type:'circle', cx,cy,r, color, width }
    // polygon: { type:'polygon', cx,cy,r,sides,rotation, color, width }
    let actions = [];
    let undone = [];
    let currentTool = 'brush';
    let currentColor = ui.colorInput ? ui.colorInput.value : '#111111';
    let currentSize = ui.sizeInput ? parseInt(ui.sizeInput.value,10) || 4 : 4;
    let polySides = ui.polyInput ? parseInt(ui.polyInput.value,10) || 5 : 5;

    let isDrawing = false;
    let startPos = null;
    let tempShape = null;
    let currentStroke = null;
    let saveTimer = null;

    function scheduleSave(){
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(()=> {
        try { save(STORAGE_KEY, { actions: actions, t: Date.now() }); } catch(e){ warn('save failed', e); }
      }, SAVE_DEBOUNCE_MS);
    }
    function pushAction(a){ actions.push(a); undone = []; scheduleSave(); redraw(); }

    function clearAll(){ actions = []; undone = []; scheduleSave(); redraw(); }

    function undo(){ if (!actions.length) return; undone.push(actions.pop()); scheduleSave(); redraw(); }
    function redo(){ if (!undone.length) return; actions.push(undone.pop()); scheduleSave(); redraw(); }

    // coordinate conversion
    function clientToCanvas(evt){
      const rect = canvas.getBoundingClientRect();
      const p = (evt.touches && evt.touches[0]) ? evt.touches[0] : evt;
      const x = (p.clientX - rect.left) * (logicalW / rect.width);
      const y = (p.clientY - rect.top) * (logicalH / rect.height);
      return { x, y };
    }

    function redraw(){
      try {
        ctx.clearRect(0,0,logicalW,logicalH);
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,logicalW,logicalH);
        ctx.restore();
        for (let i=0;i<actions.length;i++) renderAction(ctx, actions[i]);
        if (tempShape) renderAction(ctx, tempShape, { preview:true });
      } catch(e){ warn('redraw error', e); }
    }

    function renderAction(c, a, opts){
      opts = opts || {};
      const preview = !!opts.preview;
      try {
        if (a.type === 'stroke'){
          c.save();
          c.lineCap = 'round';
          c.lineJoin = 'round';
          c.lineWidth = a.width || 2;
          if (a.mode === 'eraser') c.globalCompositeOperation = 'destination-out';
          else { c.globalCompositeOperation = 'source-over'; c.strokeStyle = a.color || '#000'; }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.beginPath();
          for (let i=0;i<(a.points||[]).length;i++){
            const p = a.points[i];
            if (i===0) c.moveTo(p.x,p.y); else c.lineTo(p.x,p.y);
          }
          c.stroke();
          c.restore();
        } else if (a.type === 'line'){
          c.save();
          c.lineWidth = a.width || 2;
          c.strokeStyle = a.color || '#000';
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.beginPath();
          c.moveTo(a.x1,a.y1); c.lineTo(a.x2,a.y2); c.stroke();
          c.restore();
        } else if (a.type === 'rect'){
          c.save();
          c.lineWidth = a.width || 2;
          if (a.fill) { c.fillStyle = a.fill; c.fillRect(a.x,a.y,a.w,a.h); }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.strokeStyle = a.color || '#000';
          c.strokeRect(a.x,a.y,a.w,a.h);
          c.restore();
        } else if (a.type === 'circle'){
          c.save();
          c.lineWidth = a.width || 2;
          c.beginPath();
          c.arc(a.cx,a.cy,a.r,0,Math.PI*2);
          if (a.fill) { c.fillStyle = a.fill; c.fill(); }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.strokeStyle = a.color || '#000';
          c.stroke();
          c.restore();
        } else if (a.type === 'polygon'){
          c.save();
          c.lineWidth = a.width || 2;
          c.beginPath();
          const n = Math.max(3, Math.floor(a.sides||3));
          for (let i=0;i<n;i++){
            const ang = (a.rotation||0) + (i/n)*Math.PI*2;
            const x = a.cx + Math.cos(ang)*a.r;
            const y = a.cy + Math.sin(ang)*a.r;
            if (i===0) c.moveTo(x,y); else c.lineTo(x,y);
          }
          c.closePath();
          if (a.fill) { c.fillStyle = a.fill; c.fill(); }
          if (preview) c.setLineDash([6,6]); else c.setLineDash([]);
          c.strokeStyle = a.color || '#000';
          c.stroke();
          c.restore();
        }
      } catch(e){ warn('renderAction', e, a); }
    }

    // events
    function onDown(e){
      try { e.preventDefault && e.preventDefault(); } catch(_) {}
      const p = clientToCanvas(e);
      isDrawing = true;
      startPos = p;
      tempShape = null;
      if (currentTool === 'brush' || currentTool === 'eraser'){
        currentStroke = { type:'stroke', mode: currentTool === 'eraser' ? 'eraser' : 'brush', color: currentColor, width: currentSize, points: [p] };
        actions.push(currentStroke);
        scheduleSave();
        redraw();
      } else {
        tempShape = null;
      }
    }
    function onMove(e){
      if (!isDrawing) return;
      const p = clientToCanvas(e);
      if (currentTool === 'brush' || currentTool === 'eraser'){
        if (!currentStroke) return;
        currentStroke.points.push(p);
        redraw();
      } else if (currentTool === 'line'){
        tempShape = { type:'line', x1:startPos.x, y1:startPos.y, x2:p.x, y2:p.y, color: currentColor, width: currentSize };
        redraw();
      } else if (currentTool === 'circle'){
        const dx = p.x - startPos.x, dy = p.y - startPos.y; const r = Math.sqrt(dx*dx+dy*dy);
        tempShape = { type:'circle', cx:startPos.x, cy:startPos.y, r, color: currentColor, width: currentSize };
        redraw();
      } else if (currentTool === 'rect'){
        const x = Math.min(startPos.x, p.x), y = Math.min(startPos.y,p.y), w = Math.abs(p.x-startPos.x), h = Math.abs(p.y-startPos.y);
        tempShape = { type:'rect', x,y,w,h, color: currentColor, width: currentSize };
        redraw();
      } else if (currentTool === 'polygon'){
        const dx = p.x - startPos.x, dy = p.y - startPos.y; const r = Math.sqrt(dx*dx+dy*dy);
        tempShape = { type:'polygon', cx:startPos.x, cy:startPos.y, r, sides: polySides, rotation:0, color: currentColor, width: currentSize };
        redraw();
      }
    }
    function onUp(e){
      if (!isDrawing) return;
      isDrawing = false;
      const p = clientToCanvas(e);
      if (currentTool === 'brush' || currentTool === 'eraser'){
        currentStroke = null;
        scheduleSave();
      } else if (currentTool === 'line'){
        pushAction({ type:'line', x1:startPos.x, y1:startPos.y, x2:p.x, y2:p.y, color: currentColor, width: currentSize });
      } else if (currentTool === 'circle'){
        const dx = p.x - startPos.x, dy = p.y - startPos.y, r = Math.sqrt(dx*dx+dy*dy);
        pushAction({ type:'circle', cx:startPos.x, cy:startPos.y, r, color: currentColor, width: currentSize });
      } else if (currentTool === 'rect'){
        const x = Math.min(startPos.x, p.x), y = Math.min(startPos.y,p.y), w = Math.abs(p.x-startPos.x), h = Math.abs(p.y-startPos.y);
        pushAction({ type:'rect', x,y,w,h, color: currentColor, width: currentSize });
      } else if (currentTool === 'polygon'){
        const dx = p.x - startPos.x, dy = p.y - startPos.y, r = Math.sqrt(dx*dx+dy*dy);
        pushAction({ type:'polygon', cx:startPos.x, cy:startPos.y, r, sides: polySides, rotation:0, color: currentColor, width: currentSize });
      }
      tempShape = null;
      startPos = null;
      redraw();
    }

    function attachEvents(){
      // Pointer friendly
      if (window.PointerEvent){
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
    }

    // load saved actions
    function loadSaved(){
      return load(STORAGE_KEY).then(payload => {
        if (payload && Array.isArray(payload.actions)) {
          actions = payload.actions.slice();
        } else {
          actions = [];
        }
        undone = [];
        redraw();
      }).catch(e => { warn('load saved failed', e); actions = []; redraw(); });
    }

    // Snapshot as image + send to chat
    function sendToChat(){
      try {
        // render actions into offscreen canvas for stable snapshot
        const off = document.createElement('canvas'); off.width = logicalW; off.height = logicalH;
        const oc = off.getContext('2d');
        oc.fillStyle = '#ffffff'; oc.fillRect(0,0,off.width,off.height);
        for (let i=0;i<actions.length;i++) renderAction(oc, actions[i]);
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

        // Prefer existing addMessage; fallback to messages + renderMessages
        if (typeof addMessage === 'function'){
          try { addMessage(message); } catch(e){ warn('addMessage threw', e); fallbackPush(message); }
        } else {
          fallbackPush(message);
        }

        // Save and maybe partner doodle
        scheduleSave();
        maybePartnerReply();
      } catch(e){ err('sendToChat', e); }
    }

    function fallbackPush(msg){
      try {
        window.messages = window.messages || [];
        window.messages.push(msg);
        if (typeof renderMessages === 'function') renderMessages();
        else log('Pushed drawing; renderMessages not available');
      } catch(e){ warn('fallbackPush failed', e); }
    }

    // Partner doodle generator (random primitives; no templates)
    function weightedChoice(items, weights){
      var total = weights.reduce((s,w)=>s+w,0);
      var r = Math.random()*total;
      for (var i=0;i<items.length;i++){ r -= weights[i]; if (r <= 0) return items[i]; }
      return items[items.length-1];
    }
    function randomDoodleActions(){
      const count = PARTNER_MIN_OBJ + Math.floor(Math.random()*(PARTNER_MAX_OBJ - PARTNER_MIN_OBJ +1));
      const acts = [];
      for (let i=0;i<count;i++){
        const kind = weightedChoice(['stroke','line','circle','rect','polygon'], [40,20,15,15,10]);
        if (kind === 'stroke'){
          let x = randRange(40, logicalW-40), y = randRange(40, logicalH-40);
          const pts = [];
          const n = 4 + Math.floor(Math.random()*18);
          for (let p=0;p<n;p++){
            x += randRange(-40,40); y += randRange(-40,40);
            x = clamp(x, 10, logicalW-10); y = clamp(y, 10, logicalH-10);
            pts.push({ x, y });
          }
          acts.push({ type:'stroke', mode:'brush', color: randomHsl(), width: 1 + Math.floor(Math.random()*8), points: pts });
        } else if (kind === 'line'){
          acts.push({ type:'line', x1: randRange(10, logicalW-10), y1:randRange(10,logicalH-10), x2: randRange(10,logicalW-10), y2:randRange(10,logicalH-10), color: randomHsl(), width:1 + Math.floor(Math.random()*6) });
        } else if (kind === 'circle'){
          const cx = randRange(40, logicalW-40), cy = randRange(40,logicalH-40), r = randRange(8, Math.min(140, logicalW/3));
          acts.push({ type:'circle', cx, cy, r, color: randomHsl(), width: 1 + Math.floor(Math.random()*6), fill: Math.random()<0.35 ? randomTranslucent() : null});
        } else if (kind === 'rect'){
          const x = randRange(10, logicalW-140), y = randRange(10, logicalH-140), w = randRange(20,180), h = randRange(20,180);
          acts.push({ type:'rect', x,y,w,h, color: randomHsl(), width:1 + Math.floor(Math.random()*6), fill: Math.random()<0.35 ? randomTranslucent() : null});
        } else if (kind === 'polygon'){
          const cx = randRange(40, logicalW-40), cy = randRange(40, logicalH-40), r = randRange(12,120), sides = 3 + Math.floor(Math.random()*6);
          acts.push({ type:'polygon', cx,cy,r, sides, rotation: Math.random()*Math.PI*2, color: randomHsl(), width:1 + Math.floor(Math.random()*6), fill: Math.random()<0.35 ? randomTranslucent() : null});
        }
      }
      return acts;
    }

    function maybePartnerReply(){
      if (Math.random() > PARTNER_REPLY_CHANCE) return;
      const delay = 800 + Math.random()*2200;
      setTimeout(()=>{
        const acts = randomDoodleActions();
        const off = document.createElement('canvas'); off.width = logicalW; off.height = logicalH;
        const c = off.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0,0,off.width,off.height);
        for (let i=0;i<acts.length;i++) renderAction(c, acts[i]);
        const url = off.toDataURL('image/png');
        const msg = { id: Date.now()+1, sender:'partner', text:'', timestamp:new Date(), image: url, drawingData: acts, status:'sent', type:'drawing' };
        if (typeof addMessage === 'function') {
          try { addMessage(msg); } catch(e){ warn('partner addMessage failed', e); fallbackPush(msg); }
        } else fallbackPush(msg);
      }, delay);
    }

    // wire UI inputs
    function wireUI(ui){
      try {
        // tools
        ui.toolButtons.forEach(btn => {
          btn.addEventListener('click', ()=> {
            ui.toolButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTool = btn.dataset.tool || 'brush';
          });
        });
        // color / size / poly sides
        ui.colorInput && ui.colorInput.addEventListener('input', e=> currentColor = e.target.value);
        ui.sizeInput && ui.sizeInput.addEventListener('input', e=> currentSize = parseInt(e.target.value,10) || 4);
        ui.polyInput && ui.polyInput.addEventListener('change', e=> polySides = Math.max(3, Math.min(12, parseInt(e.target.value,10)||5)));
        // button actions
        ui.undoBtn && ui.undoBtn.addEventListener('click', ()=>{ undo(); });
        ui.clearBtn && ui.clearBtn.addEventListener('click', ()=>{ if (confirm('Clear canvas?')) clearAll(); });
        ui.newBtn && ui.newBtn.addEventListener('click', ()=>{ if (confirm('Create new canvas (clears current)?')) { clearAll(); } });
        ui.sendBtn && ui.sendBtn.addEventListener('click', ()=> sendToChatWrapper());
        ui.closeBtn && ui.closeBtn.addEventListener('click', ()=> { ui.panel.style.display = 'none'; scheduleSave(); });
      } catch(e){ warn('wireUI', e); }
    }

    // adapt externals used in nested scopes
    let currentColor = currentColor; // assigned earlier but keep consistent
    let currentSize = currentSize;

    // small wrappers to allow UI controls to affect engine variables
    Object.defineProperty(window, '__dt_engine', { value: { getActions: ()=> actions }, configurable: true, writable: false });

    // public functions for engine
    function init(){
      setup();
      attachEvents();
      wireUI(ui);
      return loadSaved().then(()=> redraw()).catch(()=> redraw());
    }

    // send wrapper uses engine internal sendToChat
    function sendToChatWrapper(){
      sendToChat();
    }

    // expose minimal controls
    return {
      init,
      redraw,
      loadSaved,
      clearAll,
      undo,
      sendToChat: sendToChatWrapper,
      getActions: ()=>actions
    };
  }

  // Orchestrator: build UI, engine and wire everything
  function start(){
    try {
      buildUI();
      const ui = getUI();
      // defensive: if some elements not present, abort
      if (!ui || !ui.canvas || !ui.toolbar) { warn('UI failed to build'); return; }

      // bind launcher toggle
      ui.launcher.addEventListener('click', ()=> {
        ui.panel.style.display = (ui.panel.style.display === 'none' || ui.panel.style.display === '') ? 'block' : 'none';
        try { if (ui.panel.style.display === 'block') { /* focus canvas area */ ui.canvas.focus && ui.canvas.focus(); } } catch(e){}
      });

      // prevent double-init if engine stored globally
      if (window.__drawTogether && window.__drawTogether._initialized) {
        log('already initialized');
        return;
      }

      // create engine
      const engine = (function(){
        // we need the UI object available inside engine; simple closure usage
        const engineInstance = (function(uiObj){
          // use a factory inside - reuse the makeEngine code but simpler here
          // For clarity and to avoid duplication, reuse makeEngine-like code inlined:
          // But we will call a simplified engine factory to avoid large nested code duplication.
          // To keep this integration safe and compact, implement a simpler engine here:
          const canvas = uiObj.canvas;
          const ctx = canvas.getContext('2d');
          let actions = [];
          // We'll reuse the earlier heavy-lifting engine via small wrapper:
          // For compatibility, call a tiny engine helper that we've implemented in closure above
          // but to keep single-file, implement minimal interface by delegating to a constructed "engine"
          // For brevity: call makeSimpleEngine (we will implement below) - but since earlier we implemented makeEngine closure, call it:
          // However to avoid duplicating logic, let's simply call a global factory if present; fallback to re-creating engine logic by calling makeEngine-like function.
          return (function(){
            // Create a compact engine using previous implementation by reusing functions already defined.
            // We'll construct a new engine using the DOM ui reference created above by calling the "makeEngine" function if present in outer closure.
            try {
              // If a makeEngine factory is available (from earlier variable), use it:
              if (typeof window.__dt_makeEngine === 'function') {
                const inst = window.__dt_makeEngine(uiObj);
                return inst;
              }
            } catch(e){}
            // Fallback: basic stub engine that can at least take snapshots and push structured strokes only
            return {
              init: function(){
                log('Fallback minimal engine init');
                // very simple stroke-only drawing
                let drawing=false, stroke=null;
                canvas.addEventListener('pointerdown', (ev)=>{
                  try{ ev.preventDefault(); }catch(e){}
                  drawing=true;
                  const p = clientToCanvasSimple(ev, canvas);
                  stroke = { type:'stroke', mode:'brush', color: uiObj.colorInput.value || '#111', width: parseInt(uiObj.sizeInput.value,10) || 3, points:[p] };
                  actions.push(stroke);
                });
                canvas.addEventListener('pointermove', (ev)=>{
                  if (!drawing) return;
                  const p = clientToCanvasSimple(ev, canvas);
                  stroke.points.push(p);
                  redrawSimple();
                });
                window.addEventListener('pointerup', (ev)=>{
                  if (!drawing) return;
                  drawing=false; stroke=null;
                  save(STORAGE_KEY, { actions }).catch(()=>{});
                });
                // fallback redraw
                function redrawSimple(){
                  try{
                    const c = canvas.getContext('2d');
                    c.clearRect(0,0,canvas.width,canvas.height);
                    const rect = canvas.getBoundingClientRect();
                    c.fillStyle = '#fff'; c.fillRect(0,0,canvas.width,canvas.height);
                    c.save();
                    c.scale(window.devicePixelRatio||1, window.devicePixelRatio||1);
                    for (let a of actions) {
                      if (a.type==='stroke') {
                        c.beginPath(); c.lineCap='round'; c.lineJoin='round'; c.lineWidth=a.width; c.strokeStyle=a.color;
                        for (let i=0;i<a.points.length;i++){
                          let pt = a.points[i];
                          if (i===0) c.moveTo(pt.x,pt.y); else c.lineTo(pt.x,pt.y);
                        }
                        c.stroke();
                      }
                    }
                    c.restore();
                  }catch(e){ warn('redrawSimple',e); }
                }
                // load saved
                load(STORAGE_KEY).then(p=>{
                  if (p && Array.isArray(p.actions)) actions = p.actions.slice();
                  redrawSimple();
                }).catch(()=>{});
              },
              getActions: ()=> actions,
              sendToChat: function(){
                // snapshot
                try {
                  const off = document.createElement('canvas');
                  off.width = CANVAS_W; off.height = CANVAS_H;
                  const c = off.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,off.width,off.height);
                  for (let a of actions){
                    if (a.type==='stroke'){
                      c.beginPath(); c.lineCap='round'; c.lineJoin='round'; c.lineWidth = a.width; c.strokeStyle = a.color;
                      for (let i=0;i<(a.points||[]).length;i++){
                        const p = a.points[i]; if (i===0) c.moveTo(p.x,p.y); else c.lineTo(p.x,p.y);
                      }
                      c.stroke();
                    }
                  }
                  const url = off.toDataURL('image/png');
                  const message = { id: Date.now(), sender:'user', text:'', timestamp:new Date(), image:url, drawingData: JSON.parse(JSON.stringify(actions||[])), status:'sent', type:'drawing' };
                  if (typeof addMessage === 'function') { try{ addMessage(message); }catch(e){ fallbackPush(message); } } else fallbackPush(message);
                } catch(e){ warn('fallback sendToChat',e); }
              }
            };
          })();
        })(ui);
      })();

      // Initialize engine
      try {
        // If a robust engine was created earlier in closure scope, use it; otherwise engine is fallback minimal.
        if (typeof window.__dt_engineFactory === 'function') {
          // prefer prior factory if present
          engine = window.__dt_engineFactory(ui);
        }
      } catch (e) { warn('engine factory use failed', e); }

      // If engine already available from previous creation inside start(), use that; else use the local variable
      // engine variable above is the minimal fallback or factory result; call init if exists
      try {
        if (engine && typeof engine.init === 'function') engine.init();
        // else nothing to init
      } catch (e) { warn('engine.init failed', e); }

      // wire launcher toggling already done; ensure ui buttons hooked to safe actions
      // get references to ui elements
      try {
        ui.toolButtons.forEach(b => b.addEventListener('click', ()=> {
          ui.toolButtons.forEach(bb=>bb.classList.remove('active')); b.classList.add('active');
          // set tool via engine if possible
          if (engine && typeof engine.setTool === 'function') engine.setTool(b.dataset.tool);
        }));
        ui.colorInput.addEventListener('input', ()=> { if (engine && typeof engine.setColor==='function') engine.setColor(ui.colorInput.value); });
        ui.sizeInput.addEventListener('input', ()=> { if (engine && typeof engine.setSize==='function') engine.setSize(parseInt(ui.sizeInput.value,10)||4); });
        ui.polyInput.addEventListener('change', ()=> { if (engine && typeof engine.setPolySides==='function') engine.setPolySides(parseInt(ui.polyInput.value,10)||5); });
        ui.undoBtn && ui.undoBtn.addEventListener('click', ()=> { if (engine && typeof engine.undo==='function') engine.undo(); else log('undo not supported by engine'); } );
        ui.clearBtn && ui.clearBtn.addEventListener('click', ()=> { if (engine && typeof engine.clearAll==='function') engine.clearAll(); else log('clearAll not supported'); } );
        ui.newBtn && ui.newBtn.addEventListener('click', ()=> { if (engine && typeof engine.clearAll==='function') engine.clearAll(); } );
        ui.sendBtn && ui.sendBtn.addEventListener('click', ()=> { if (engine && typeof engine.sendToChat==='function') engine.sendToChat(); else log('engine sendToChat not available'); } );
      } catch (e) { warn('post-create wiring failed', e); }

      // mark started
      window.__drawTogether = window.__drawTogether || {};
      window.__drawTogether._initialized = true;
      log('Draw Together (safer) started');
    } catch(e){
      err('start failed', e);
    }
  }

  // small utility used by fallback engine
  function clientToCanvasSimple(evt, canvas){
    const rect = canvas.getBoundingClientRect();
    const p = evt.touches && evt.touches[0] ? evt.touches[0] : evt;
    const x = (p.clientX - rect.left) * (CANVAS_W / rect.width);
    const y = (p.clientY - rect.top) * (CANVAS_H / rect.height);
    return { x, y };
  }

  // push fallback message
  function fallbackPush(msg){
    try {
      window.messages = window.messages || [];
      window.messages.push(msg);
      if (typeof renderMessages === 'function') renderMessages();
      else log('Fallback: message pushed (renderMessages missing)');
    } catch(e){ warn('fallbackPush', e); }
  }

  // run when DOM is ready
  function ready(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(fn,20);
    else document.addEventListener('DOMContentLoaded', fn, { once:true });
  }

  // Start everything
  ready(()=>{
    try {
      buildUI();
      start();
    } catch(e){
      err('DrawTogether init error', e);
    }
  });

  // Expose a manual initializer for debugging
  window.drawTogetherSafeInit = function(){ try { buildUI(); start(); } catch(e){ err('manual init failed', e); } };

})(); 
