/* js/draw-together.js
 *
 * Draw Together
 * - Uses existing #canvas-modal
 * - Uses existing #drawing-canvas
 * - Canvas on top, tools underneath
 * - Mobile friendly
 * - Saves drawing locally
 * - Sends drawings through addMessage()
 * - Partner has a small independent chance to send a drawing
 * - Does NOT automatically draw back every time you send a drawing
 */

(function () {
  'use strict';

  const CANVAS_W = 800;
  const CANVAS_H = 500;

  // Chance that partner sends a drawing when they respond.
  // 0.05 = 5%
  const PARTNER_DRAW_PROB = 0.05;

  const STORAGE_PREFIX = 'draw_together_';
  const SAVE_DELAY = 300;

  let currentCanvasId = null;
  let actions = [];
  let undone = [];

  let canvas = null;
  let ctx = null;

  let currentTool = 'brush';
  let currentColor = '#111111';
  let currentSize = 4;
  let polygonSides = 5;

  let drawing = false;
  let startPoint = null;
  let currentStroke = null;
  let previewShape = null;

  let saveTimer = null;

  // ------------------------------------------------------------
  // Logging
  // ------------------------------------------------------------

  function log(...args) {
    try {
      console.log('[DrawTogether]', ...args);
    } catch (_) {}
  }

  function warn(...args) {
    try {
      console.warn('[DrawTogether]', ...args);
    } catch (_) {}
  }

  function error(...args) {
    try {
      console.error('[DrawTogether]', ...args);
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // Storage
  // ------------------------------------------------------------

  function storageKey(id) {
    return STORAGE_PREFIX + String(id || 'default');
  }

  function saveDrawing() {
    if (!currentCanvasId) return;

    clearTimeout(saveTimer);

    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(
          storageKey(currentCanvasId),
          JSON.stringify({
            actions: actions,
            updatedAt: Date.now()
          })
        );
      } catch (e) {
        warn('Could not save drawing:', e);
      }
    }, SAVE_DELAY);
  }

  function loadDrawing(id) {
    try {
      const raw = localStorage.getItem(storageKey(id));

      if (!raw) {
        actions = [];
        undone = [];
        return;
      }

      const data = JSON.parse(raw);

      if (data && Array.isArray(data.actions)) {
        actions = data.actions;
      } else {
        actions = [];
      }

      undone = [];
    } catch (e) {
      warn('Could not load drawing:', e);
      actions = [];
      undone = [];
    }
  }

  function deleteDrawing(id) {
    try {
      localStorage.removeItem(storageKey(id));
    } catch (_) {}
  }

  // ------------------------------------------------------------
  // Canvas
  // ------------------------------------------------------------

  function setupCanvas() {
    canvas = document.getElementById('drawing-canvas');

    if (!canvas) {
      error('Missing #drawing-canvas');
      return false;
    }

    const dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;

    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';

    ctx = canvas.getContext('2d');

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return true;
  }

  function clearCanvasVisual() {
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // ------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------

  function renderAction(c, a, preview) {
    if (!a || !c) return;

    c.save();

    try {
      if (a.type === 'stroke') {
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.lineWidth = a.width || 2;

        if (a.mode === 'eraser') {
          c.globalCompositeOperation = 'destination-out';
        } else {
          c.globalCompositeOperation = 'source-over';
          c.strokeStyle = a.color || '#111111';
        }

        c.beginPath();

        const pts = a.points || [];

        if (pts.length === 1) {
          c.arc(
            pts[0].x,
            pts[0].y,
            Math.max(1, (a.width || 2) / 2),
            0,
            Math.PI * 2
          );

          if (a.mode !== 'eraser') {
            c.fillStyle = a.color || '#111111';
            c.fill();
          }
        } else {
          pts.forEach(function (p, i) {
            if (i === 0) {
              c.moveTo(p.x, p.y);
            } else {
              c.lineTo(p.x, p.y);
            }
          });

          c.stroke();
        }

      } else if (a.type === 'line') {

        c.lineWidth = a.width || 2;
        c.strokeStyle = a.color || '#111111';

        if (preview) {
          c.setLineDash([7, 7]);
        }

        c.beginPath();
        c.moveTo(a.x1, a.y1);
        c.lineTo(a.x2, a.y2);
        c.stroke();

      } else if (a.type === 'rect') {

        c.lineWidth = a.width || 2;
        c.strokeStyle = a.color || '#111111';

        if (a.fill) {
          c.fillStyle = a.fill;
          c.fillRect(a.x, a.y, a.w, a.h);
        }

        if (preview) {
          c.setLineDash([7, 7]);
        }

        c.strokeRect(a.x, a.y, a.w, a.h);

      } else if (a.type === 'circle') {

        c.lineWidth = a.width || 2;
        c.strokeStyle = a.color || '#111111';

        c.beginPath();
        c.arc(a.cx, a.cy, a.r, 0, Math.PI * 2);

        if (a.fill) {
          c.fillStyle = a.fill;
          c.fill();
        }

        if (preview) {
          c.setLineDash([7, 7]);
        }

        c.stroke();

      } else if (a.type === 'polygon') {

        const sides = Math.max(3, Math.floor(a.sides || 5));

        c.lineWidth = a.width || 2;
        c.strokeStyle = a.color || '#111111';

        c.beginPath();

        for (let i = 0; i < sides; i++) {
          const angle =
            (a.rotation || 0) +
            (i / sides) * Math.PI * 2;

          const x = a.cx + Math.cos(angle) * a.r;
          const y = a.cy + Math.sin(angle) * a.r;

          if (i === 0) {
            c.moveTo(x, y);
          } else {
            c.lineTo(x, y);
          }
        }

        c.closePath();

        if (a.fill) {
          c.fillStyle = a.fill;
          c.fill();
        }

        if (preview) {
          c.setLineDash([7, 7]);
        }

        c.stroke();
      }

    } catch (e) {
      warn('Render error:', e);
    }

    c.restore();
  }

  function redraw() {
    if (!ctx) return;

    clearCanvasVisual();

    actions.forEach(function (action) {
      renderAction(ctx, action, false);
    });

    if (previewShape) {
      renderAction(ctx, previewShape, true);
    }
  }

  // ------------------------------------------------------------
  // Coordinates
  // ------------------------------------------------------------

  function getPoint(event) {
    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();

    let clientX;
    let clientY;

    if (event.touches && event.touches.length) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length) {
      clientX = event.changedTouches[0].clientX;
      clientY = event.changedTouches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    return {
      x: Math.max(
        0,
        Math.min(
          CANVAS_W,
          (clientX - rect.left) * (CANVAS_W / rect.width)
        )
      ),

      y: Math.max(
        0,
        Math.min(
          CANVAS_H,
          (clientY - rect.top) * (CANVAS_H / rect.height)
        )
      )
    };
  }

  // ------------------------------------------------------------
  // Drawing events
  // ------------------------------------------------------------

  function onPointerDown(event) {
    event.preventDefault();

    if (!canvas) return;

    drawing = true;
    startPoint = getPoint(event);
    previewShape = null;

    try {
      if (canvas.setPointerCapture && event.pointerId !== undefined) {
        canvas.setPointerCapture(event.pointerId);
      }
    } catch (_) {}

    if (currentTool === 'brush' || currentTool === 'eraser') {
      currentStroke = {
        type: 'stroke',
        mode: currentTool === 'eraser' ? 'eraser' : 'brush',
        color: currentColor,
        width: currentSize,
        points: [startPoint]
      };

      actions.push(currentStroke);

      redraw();
    }
  }

  function onPointerMove(event) {
    if (!drawing) return;

    event.preventDefault();

    const point = getPoint(event);

    if (currentTool === 'brush' || currentTool === 'eraser') {

      if (!currentStroke) return;

      currentStroke.points.push(point);
      redraw();

      return;
    }

    if (!startPoint) return;

    if (currentTool === 'line') {

      previewShape = {
        type: 'line',
        x1: startPoint.x,
        y1: startPoint.y,
        x2: point.x,
        y2: point.y,
        color: currentColor,
        width: currentSize
      };

    } else if (currentTool === 'rect') {

      previewShape = {
        type: 'rect',
        x: Math.min(startPoint.x, point.x),
        y: Math.min(startPoint.y, point.y),
        w: Math.abs(point.x - startPoint.x),
        h: Math.abs(point.y - startPoint.y),
        color: currentColor,
        width: currentSize
      };

    } else if (currentTool === 'circle') {

      const dx = point.x - startPoint.x;
      const dy = point.y - startPoint.y;

      previewShape = {
        type: 'circle',
        cx: startPoint.x,
        cy: startPoint.y,
        r: Math.sqrt(dx * dx + dy * dy),
        color: currentColor,
        width: currentSize
      };

    } else if (currentTool === 'polygon') {

      const dx = point.x - startPoint.x;
      const dy = point.y - startPoint.y;

      previewShape = {
        type: 'polygon',
        cx: startPoint.x,
        cy: startPoint.y,
        r: Math.sqrt(dx * dx + dy * dy),
        sides: polygonSides,
        rotation: 0,
        color: currentColor,
        width: currentSize
      };
    }

    redraw();
  }

  function onPointerUp(event) {
    if (!drawing) return;

    event.preventDefault();

    const point = getPoint(event);

    drawing = false;

    if (
      currentTool === 'brush' ||
      currentTool === 'eraser'
    ) {
      currentStroke = null;

      undone = [];
      saveDrawing();

    } else if (currentTool === 'line') {

      actions.push({
        type: 'line',
        x1: startPoint.x,
        y1: startPoint.y,
        x2: point.x,
        y2: point.y,
        color: currentColor,
        width: currentSize
      });

      undone = [];
      saveDrawing();

    } else if (currentTool === 'rect') {

      actions.push({
        type: 'rect',
        x: Math.min(startPoint.x, point.x),
        y: Math.min(startPoint.y, point.y),
        w: Math.abs(point.x - startPoint.x),
        h: Math.abs(point.y - startPoint.y),
        color: currentColor,
        width: currentSize
      });

      undone = [];
      saveDrawing();

    } else if (currentTool === 'circle') {

      const dx = point.x - startPoint.x;
      const dy = point.y - startPoint.y;

      actions.push({
        type: 'circle',
        cx: startPoint.x,
        cy: startPoint.y,
        r: Math.sqrt(dx * dx + dy * dy),
        color: currentColor,
        width: currentSize
      });

      undone = [];
      saveDrawing();

    } else if (currentTool === 'polygon') {

      const dx = point.x - startPoint.x;
      const dy = point.y - startPoint.y;

      actions.push({
        type: 'polygon',
        cx: startPoint.x,
        cy: startPoint.y,
        r: Math.sqrt(dx * dx + dy * dy),
        sides: polygonSides,
        rotation: 0,
        color: currentColor,
        width: currentSize
      });

      undone = [];
      saveDrawing();
    }

    startPoint = null;
    previewShape = null;

    redraw();
  }

  // ------------------------------------------------------------
  // Tools
  // ------------------------------------------------------------

  function setTool(tool) {
    currentTool = tool;

    document
      .querySelectorAll('[data-draw-tool]')
      .forEach(function (button) {
        button.classList.toggle(
          'active',
          button.dataset.drawTool === tool
        );
      });
  }

  function undo() {
    if (!actions.length) return;

    undone.push(actions.pop());

    saveDrawing();
    redraw();
  }

  function clearDrawing() {
    actions = [];
    undone = [];

    saveDrawing();
    redraw();
  }

  // ------------------------------------------------------------
  // Toolbar
  // ------------------------------------------------------------

  function buildToolbar() {
    const toolbar = document.getElementById('canvas-toolbar');

    if (!toolbar) {
      warn('Missing #canvas-toolbar');
      return;
    }

    toolbar.innerHTML = `
      <div class="dt-toolbar-inner">

        <div class="dt-section-title">
          Tools
        </div>

        <div class="dt-tool-grid">

          <button type="button" class="dt-tool active" data-draw-tool="brush">
            ✏️ Brush
          </button>

          <button type="button" class="dt-tool" data-draw-tool="eraser">
            🧹 Eraser
          </button>

          <button type="button" class="dt-tool" data-draw-tool="line">
            ╱ Line
          </button>

          <button type="button" class="dt-tool" data-draw-tool="rect">
            ▭ Rectangle
          </button>

          <button type="button" class="dt-tool" data-draw-tool="circle">
            ○ Circle
          </button>

          <button type="button" class="dt-tool" data-draw-tool="polygon">
            ⬡ Polygon
          </button>

        </div>

        <div class="dt-controls">

          <label class="dt-control">
            <span>Color</span>
            <input
              type="color"
              id="dt-color-input"
              value="#111111"
            >
          </label>

          <label class="dt-control dt-size-control">
            <span>Size</span>
            <input
              type="range"
              id="dt-size-input"
              min="1"
              max="50"
              value="4"
            >
            <span id="dt-size-value">4</span>
          </label>

          <label class="dt-control">
            <span>Polygon</span>
            <input
              type="number"
              id="dt-polygon-input"
              min="3"
              max="12"
              value="5"
            >
          </label>

        </div>

      </div>
    `;

    const style = document.createElement('style');

    style.id = 'draw-together-toolbar-style';

    style.textContent = `
      #canvas-modal .dt-toolbar-inner {
        width:100%;
        box-sizing:border-box;
      }

      #canvas-modal .dt-section-title {
        font-weight:600;
        margin-bottom:8px;
      }

      #canvas-modal .dt-tool-grid {
        display:grid;
        grid-template-columns:repeat(3,1fr);
        gap:7px;
        margin-bottom:10px;
      }

      #canvas-modal .dt-tool {
        border:1px solid var(--border-color,#ddd);
        background:var(--primary-bg,#f5f5f5);
        color:var(--text-primary,#222);
        border-radius:8px;
        padding:9px 6px;
        cursor:pointer;
        font-size:13px;
      }

      #canvas-modal .dt-tool.active {
        background:var(--accent-color,#ff7a6b);
        color:#fff;
        border-color:var(--accent-color,#ff7a6b);
      }

      #canvas-modal .dt-controls {
        display:flex;
        align-items:center;
        gap:12px;
        flex-wrap:wrap;
      }

      #canvas-modal .dt-control {
        display:flex;
        align-items:center;
        gap:7px;
        font-size:13px;
        color:var(--text-secondary,#666);
      }

      #canvas-modal #dt-color-input {
        width:42px;
        height:34px;
        padding:0;
        border:0;
        background:transparent;
      }

      #canvas-modal #dt-size-input {
        width:100px;
      }

      #canvas-modal #dt-size-value {
        min-width:20px;
      }

      #canvas-modal #dt-polygon-input {
        width:55px;
      }

      @media (max-width:600px) {

        #canvas-modal .modal-content {
          width:calc(100% - 16px) !important;
          max-height:calc(100vh - 16px);
        }

        #canvas-modal .dt-tool-grid {
          grid-template-columns:repeat(2,1fr);
        }

        #canvas-modal .dt-controls {
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:8px;
        }

        #canvas-modal .dt-size-control {
          grid-column:span 2;
        }

        #canvas-modal #dt-size-input {
          flex:1;
          width:auto;
        }
      }
    `;

    if (!document.getElementById(style.id)) {
      document.head.appendChild(style);
    }

    toolbar
      .querySelectorAll('[data-draw-tool]')
      .forEach(function (button) {
        button.addEventListener('click', function () {
          setTool(button.dataset.drawTool);
        });
      });

    const color = document.getElementById('dt-color-input');

    if (color) {
      color.addEventListener('input', function () {
        currentColor = color.value;
      });
    }

    const size = document.getElementById('dt-size-input');
    const sizeValue = document.getElementById('dt-size-value');

    if (size) {
      size.addEventListener('input', function () {
        currentSize = parseInt(size.value, 10) || 4;

        if (sizeValue) {
          sizeValue.textContent = currentSize;
        }
      });
    }

    const polygon = document.getElementById('dt-polygon-input');

    if (polygon) {
      polygon.addEventListener('input', function () {
        polygonSides = Math.max(
          3,
          Math.min(
            12,
            parseInt(polygon.value, 10) || 5
          )
        );
      });
    }
  }

  // ------------------------------------------------------------
  // Modal
  // ------------------------------------------------------------

  function openModal() {
    const modal = document.getElementById('canvas-modal');

    if (!modal) {
      error('Missing #canvas-modal');
      return;
    }

    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';

    // Make sure it isn't hidden behind another app layer.
    modal.style.zIndex = '99999';

    const content = modal.querySelector('.modal-content');

    if (content) {
      content.style.position = 'relative';
      content.style.zIndex = '100000';
    }

    setTimeout(function () {
      redraw();
    }, 20);
  }

  function closeModal() {
    const modal = document.getElementById('canvas-modal');

    if (modal) {
      modal.style.display = 'none';
    }

    saveDrawing();
  }

  // ------------------------------------------------------------
  // New canvas
  // ------------------------------------------------------------

  function newCanvas(options) {
    options = options || {};

    const id =
      'canvas_' +
      Date.now() +
      '_' +
      Math.random().toString(36).slice(2, 8);

    currentCanvasId = id;

    actions = [];
    undone = [];

    if (!canvas) {
      setupCanvas();
    }

    redraw();

    log('Created canvas:', id);

    return {
      id: id,
      title: options.title || '画布',
      owner: options.owner || 'me',
      shared: !!options.shared
    };
  }

  // ------------------------------------------------------------
  // Open canvas by ID
  // ------------------------------------------------------------

  function openCanvasModalById(id) {
    currentCanvasId = id;

    loadDrawing(id);

    if (!canvas) {
      if (!setupCanvas()) {
        return;
      }
    }

    buildToolbar();
    redraw();
    openModal();
  }

  // ------------------------------------------------------------
  // Send drawing to chat
  // ------------------------------------------------------------

  function createImageData(actionsToRender) {
    const offscreen = document.createElement('canvas');

    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;

    const offCtx = offscreen.getContext('2d');

    offCtx.fillStyle = '#ffffff';
    offCtx.fillRect(
      0,
      0,
      CANVAS_W,
      CANVAS_H
    );

    actionsToRender.forEach(function (action) {
      renderAction(offCtx, action, false);
    });

    return offscreen.toDataURL('image/png');
  }

  function sendDrawingToChat() {
    try {
      const image = createImageData(actions);

      const message = {
        id: Date.now(),
        sender: 'user',
        text: '',
        timestamp: new Date(),
        image: image,
        drawingData: JSON.parse(
          JSON.stringify(actions)
        ),
        status: 'sent',
        type: 'drawing'
      };

      if (typeof window.addMessage === 'function') {
        window.addMessage(message);
      } else {
        window.messages = window.messages || [];
        window.messages.push(message);

        if (typeof window.renderMessages === 'function') {
          window.renderMessages();
        }
      }

      saveDrawing();

      closeModal();

      log('Drawing sent to chat.');

      // IMPORTANT:
      // We do NOT automatically make partner draw here.
      // The partner drawing chance is handled separately.

    } catch (e) {
      error('Could not send drawing:', e);
    }
  }

  // ------------------------------------------------------------
  // Random partner drawing
  // ------------------------------------------------------------

  function randomColor() {
    const colors = [
      '#ff6b6b',
      '#ff9f43',
      '#feca57',
      '#1dd1a1',
      '#54a0ff',
      '#5f27cd',
      '#ff78c5',
      '#222222'
    ];

    return colors[
      Math.floor(Math.random() * colors.length)
    ];
  }

  function randomInt(min, max) {
    return Math.floor(
      Math.random() * (max - min + 1)
    ) + min;
  }

  function randomRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  function randomDoodle() {
    const result = [];

    const count = randomInt(3, 10);

    for (let i = 0; i < count; i++) {

      const type = randomInt(0, 4);

      if (type === 0) {

        const points = [];

        let x = randomRange(30, CANVAS_W - 30);
        let y = randomRange(30, CANVAS_H - 30);

        const pointCount = randomInt(5, 18);

        for (let j = 0; j < pointCount; j++) {
          x += randomRange(-40, 40);
          y += randomRange(-40, 40);

          x = Math.max(
            10,
            Math.min(CANVAS_W - 10, x)
          );

          y = Math.max(
            10,
            Math.min(CANVAS_H - 10, y)
          );

          points.push({
            x: x,
            y: y
          });
        }

        result.push({
          type: 'stroke',
          mode: 'brush',
          color: randomColor(),
          width: randomInt(2, 7),
          points: points
        });

      } else if (type === 1) {

        result.push({
          type: 'line',
          x1: randomRange(20, CANVAS_W - 20),
          y1: randomRange(20, CANVAS_H - 20),
          x2: randomRange(20, CANVAS_W - 20),
          y2: randomRange(20, CANVAS_H - 20),
          color: randomColor(),
          width: randomInt(2, 6)
        });

      } else if (type === 2) {

        result.push({
          type: 'circle',
          cx: randomRange(60, CANVAS_W - 60),
          cy: randomRange(60, CANVAS_H - 60),
          r: randomRange(15, 80),
          color: randomColor(),
          width: randomInt(2, 6),
          fill: null
        });

      } else if (type === 3) {

        result.push({
          type: 'rect',
          x: randomRange(20, CANVAS_W - 160),
          y: randomRange(20, CANVAS_H - 160),
          w: randomRange(30, 130),
          h: randomRange(30, 130),
          color: randomColor(),
          width: randomInt(2, 6),
          fill: null
        });

      } else {

        result.push({
          type: 'polygon',
          cx: randomRange(60, CANVAS_W - 60),
          cy: randomRange(60, CANVAS_H - 60),
          r: randomRange(20, 80),
          sides: randomInt(3, 7),
          rotation: randomRange(0, Math.PI * 2),
          color: randomColor(),
          width: randomInt(2, 6),
          fill: null
        });
      }
    }

    return result;
  }

  function sendPartnerDrawing() {
    try {
      const drawing = randomDoodle();

      const image = createImageData(drawing);

      const message = {
        id: Date.now(),
        sender: 'partner',
        text: '',
        timestamp: new Date(),
        image: image,
        drawingData: drawing,
        status: 'sent',
        type: 'drawing'
      };

      if (typeof window.addMessage === 'function') {
        window.addMessage(message);
      } else {
        window.messages = window.messages || [];
        window.messages.push(message);

        if (typeof window.renderMessages === 'function') {
          window.renderMessages();
        }
      }

      log('Partner sent a drawing.');

      return message;

    } catch (e) {
      error('Partner drawing failed:', e);
      return null;
    }
  }

  // ------------------------------------------------------------
  // Optional public partner-drawing test
  // ------------------------------------------------------------

  function testPartnerDrawing() {
    return sendPartnerDrawing();
  }

  // ------------------------------------------------------------
  // Wire buttons already in HTML
  // ------------------------------------------------------------

  function wireExistingButtons() {

    const send = document.getElementById(
      'canvas-send-to-chat'
    );

    if (send) {
      send.addEventListener(
        'click',
        sendDrawingToChat
      );
    }

    const close = document.getElementById(
      'canvas-save-close'
    );

    if (close) {
      close.addEventListener(
        'click',
        closeModal
      );
    }

    const undoButton = document.getElementById(
      'canvas-undo'
    );

    if (undoButton) {
      undoButton.addEventListener(
        'click',
        undo
      );
    }

    const clearButton = document.getElementById(
      'canvas-clear'
    );

    if (clearButton) {
      clearButton.addEventListener(
        'click',
        function () {
          if (confirm('Clear canvas?')) {
            clearDrawing();
          }
        }
      );
    }

    const newButton = document.getElementById(
      'canvas-new'
    );

    if (newButton) {
      newButton.addEventListener(
        'click',
        function () {
          if (confirm('Start a new canvas?')) {
            actions = [];
            undone = [];
            redraw();
            saveDrawing();
          }
        }
      );
    }
  }

  // ------------------------------------------------------------
  // Canvas events
  // ------------------------------------------------------------

  function wireCanvas() {

    if (!canvas) return;

    canvas.addEventListener(
      'pointerdown',
      onPointerDown
    );

    canvas.addEventListener(
      'pointermove',
      onPointerMove
    );

    window.addEventListener(
      'pointerup',
      onPointerUp
    );
  }

  // ------------------------------------------------------------
  // Initialize
  // ------------------------------------------------------------

  function init() {

    if (!setupCanvas()) {
      error(
        'Draw Together could not initialize because #drawing-canvas is missing.'
      );
      return;
    }

    buildToolbar();
    wireExistingButtons();
    wireCanvas();

    clearCanvasVisual();

    log('Draw Together initialized.');

    return true;
  }

  // ------------------------------------------------------------
  // Public API expected by your HTML
  // ------------------------------------------------------------

  window.drawTogether = {

    newCanvas: newCanvas,

    openCanvasModalById:
      openCanvasModalById,

    closeCanvasModal:
      closeModal,

    sendDrawing:
      sendDrawingToChat,

    undo:
      undo,

    clear:
      clearDrawing,

    // Useful for testing partner drawings
    testPartnerDrawing:
      testPartnerDrawing
  };

  // ------------------------------------------------------------
  // Start
  // ------------------------------------------------------------

  if (
    document.readyState === 'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );

  } else {
    init();
  }

})();
