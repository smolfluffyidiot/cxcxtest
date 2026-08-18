/* js/draw-together.js */

(function () {
  'use strict';

  const CANVAS_W = 800;
  const CANVAS_H = 500;

  // Chance that partner sends a drawing after a NORMAL USER MESSAGE.
  // 0.05 = 5%
  const PARTNER_DRAW_CHANCE = 1;

  const PARTNER_MIN_OBJECTS = 2;
  const PARTNER_MAX_OBJECTS = 8;

  let canvas = null;
  let ctx = null;
  let modal = null;

  let actions = [];

  let currentTool = 'brush';
  let currentColor = '#111111';
  let currentSize = 4;
  let polygonSides = 5;

  let drawing = false;
  let startPoint = null;
  let currentStroke = null;
  let preview = null;

  let initialized = false;

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

  function log(...args) {
    console.log('[DrawTogether]', ...args);
  }

  function warn(...args) {
    console.warn('[DrawTogether]', ...args);
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
  }

  function randomColor() {
    const colors = [
      '#ff6b6b',
      '#ff9f43',
      '#feca57',
      '#1dd1a1',
      '#48dbfb',
      '#54a0ff',
      '#5f27cd',
      '#ff6bcb',
      '#222f3e'
    ];

    return colors[randomInt(0, colors.length - 1)];
  }

  // --------------------------------------------------
  // Modal
  // --------------------------------------------------

  function getModal() {
    return document.getElementById('canvas-modal');
  }

  function openModal() {
    modal = getModal();

    if (!modal) {
      console.error('[DrawTogether] #canvas-modal not found.');
      return;
    }

    modal.style.display = 'flex';
    modal.classList.add('active');

    // Important:
    // Put it above blur/backdrop layers.
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.zIndex = '2200';

    // Some modal systems use opacity/visibility.
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';

    setupCanvas();

    redraw();

    log('Canvas modal opened.');
  }

  function closeModal() {
    modal = getModal();

    if (!modal) return;

    modal.style.display = 'none';
    modal.classList.remove('active');
  }

  // --------------------------------------------------
  // Canvas
  // --------------------------------------------------

  function setupCanvas() {
    canvas = document.getElementById('drawing-canvas');

    if (!canvas) {
      console.error('[DrawTogether] #drawing-canvas not found.');
      return;
    }

    ctx = canvas.getContext('2d');

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    redraw();
  }

  function clearCanvas() {
    actions = [];
    preview = null;
    currentStroke = null;

    redraw();
  }

  function redraw() {
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    for (const action of actions) {
      renderAction(ctx, action);
    }

    if (preview) {
      renderAction(ctx, preview, true);
    }
  }

  function renderAction(context, action, isPreview) {
    if (!action) return;

    context.save();

    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (action.type === 'stroke') {
      context.lineWidth = action.width || 4;

      if (action.mode === 'eraser') {
        context.globalCompositeOperation = 'destination-out';
      } else {
        context.strokeStyle = action.color || '#111111';
      }

      context.beginPath();

      const points = action.points || [];

      if (points.length > 0) {
        context.moveTo(points[0].x, points[0].y);

        for (let i = 1; i < points.length; i++) {
          context.lineTo(points[i].x, points[i].y);
        }
      }

      context.stroke();
    }

    else if (action.type === 'line') {
      context.lineWidth = action.width || 4;
      context.strokeStyle = action.color || '#111111';

      context.beginPath();
      context.moveTo(action.x1, action.y1);
      context.lineTo(action.x2, action.y2);
      context.stroke();
    }

    else if (action.type === 'rect') {
      context.lineWidth = action.width || 4;
      context.strokeStyle = action.color || '#111111';

      context.strokeRect(
        action.x,
        action.y,
        action.w,
        action.h
      );
    }

    else if (action.type === 'circle') {
      context.lineWidth = action.width || 4;
      context.strokeStyle = action.color || '#111111';

      context.beginPath();
      context.arc(
        action.cx,
        action.cy,
        action.r,
        0,
        Math.PI * 2
      );
      context.stroke();
    }

    else if (action.type === 'polygon') {
      const sides = Math.max(3, action.sides || 5);

      context.lineWidth = action.width || 4;
      context.strokeStyle = action.color || '#111111';

      context.beginPath();

      for (let i = 0; i < sides; i++) {
        const angle =
          (action.rotation || 0) +
          (i / sides) * Math.PI * 2;

        const x =
          action.cx +
          Math.cos(angle) * action.r;

        const y =
          action.cy +
          Math.sin(angle) * action.r;

        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.closePath();
      context.stroke();
    }

    context.restore();
  }

  // --------------------------------------------------
  // Coordinates
  // --------------------------------------------------

  function getCanvasPoint(event) {
    if (!canvas) return { x: 0, y: 0 };

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
      x: (clientX - rect.left) * (CANVAS_W / rect.width),
      y: (clientY - rect.top) * (CANVAS_H / rect.height)
    };
  }

  // --------------------------------------------------
  // Drawing
  // --------------------------------------------------

  function onPointerDown(event) {
    if (!canvas) return;

    event.preventDefault();

    const point = getCanvasPoint(event);

    drawing = true;
    startPoint = point;

    if (
      currentTool === 'brush' ||
      currentTool === 'eraser'
    ) {
      currentStroke = {
        type: 'stroke',
        mode:
          currentTool === 'eraser'
            ? 'eraser'
            : 'brush',
        color: currentColor,
        width: currentSize,
        points: [point]
      };

      actions.push(currentStroke);
    }
  }

  function onPointerMove(event) {
    if (!drawing) return;

    event.preventDefault();

    const point = getCanvasPoint(event);

    // Brush
    if (
      currentTool === 'brush' ||
      currentTool === 'eraser'
    ) {
      if (currentStroke) {
        currentStroke.points.push(point);
      }

      redraw();
      return;
    }

    // Line
    if (currentTool === 'line') {
      preview = {
        type: 'line',
        x1: startPoint.x,
        y1: startPoint.y,
        x2: point.x,
        y2: point.y,
        color: currentColor,
        width: currentSize
      };
    }

    // Rectangle
    else if (currentTool === 'rect') {
      preview = {
        type: 'rect',
        x: Math.min(startPoint.x, point.x),
        y: Math.min(startPoint.y, point.y),
        w: Math.abs(point.x - startPoint.x),
        h: Math.abs(point.y - startPoint.y),
        color: currentColor,
        width: currentSize
      };
    }

    // Circle
    else if (currentTool === 'circle') {
      const dx = point.x - startPoint.x;
      const dy = point.y - startPoint.y;

      preview = {
        type: 'circle',
        cx: startPoint.x,
        cy: startPoint.y,
        r: Math.sqrt(dx * dx + dy * dy),
        color: currentColor,
        width: currentSize
      };
    }

    // Polygon
    else if (currentTool === 'polygon') {
      const dx = point.x - startPoint.x;
      const dy = point.y - startPoint.y;

      preview = {
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

    const point = getCanvasPoint(event);

    drawing = false;

    if (
      currentTool === 'brush' ||
      currentTool === 'eraser'
    ) {
      currentStroke = null;
    }

    else if (currentTool === 'line') {
      actions.push({
        type: 'line',
        x1: startPoint.x,
        y1: startPoint.y,
        x2: point.x,
        y2: point.y,
        color: currentColor,
        width: currentSize
      });
    }

    else if (currentTool === 'rect') {
      actions.push({
        type: 'rect',
        x: Math.min(startPoint.x, point.x),
        y: Math.min(startPoint.y, point.y),
        w: Math.abs(point.x - startPoint.x),
        h: Math.abs(point.y - startPoint.y),
        color: currentColor,
        width: currentSize
      });
    }

    else if (currentTool === 'circle') {
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
    }

    else if (currentTool === 'polygon') {
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
    }

    preview = null;
    startPoint = null;

    redraw();
  }

  // --------------------------------------------------
  // Undo
  // --------------------------------------------------

  function undo() {
    if (!actions.length) return;

    actions.pop();
    redraw();
  }

  // --------------------------------------------------
  // Export drawing
  // --------------------------------------------------

  function createDrawingImage(drawingActions) {
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

    for (const action of drawingActions) {
      renderAction(offCtx, action);
    }

    return offscreen.toDataURL('image/png');
  }

  // --------------------------------------------------
  // Send drawing to chat
  // --------------------------------------------------

  function sendDrawingToChat() {
    if (!actions.length) {
      alert('Draw something first!');
      return;
    }

    const drawingActions =
      JSON.parse(JSON.stringify(actions));

    const image =
      createDrawingImage(drawingActions);

    const message = {
      id: Date.now(),
      sender: 'user',
      text: '',
      timestamp: new Date(),
      image: image,
      drawingData: drawingActions,
      type: 'drawing',
      status: 'sent'
    };

    /*
     * THIS IS THE IMPORTANT PART.
     *
     * It uses your existing chat system.
     */
    if (typeof window.addMessage === 'function') {
      try {
        window.addMessage(message);
      } catch (error) {
        console.error(
          '[DrawTogether] addMessage failed:',
          error
        );
      }
    }

    else {
      // Fallback if your app doesn't expose addMessage
      window.messages = window.messages || [];
      window.messages.push(message);

      if (typeof window.renderMessages === 'function') {
        window.renderMessages();
      }
    }

    closeModal();

    log('Drawing sent to chat.');
  }

  // --------------------------------------------------
  // Partner drawing
  // --------------------------------------------------

  function generatePartnerDrawing() {
    const result = [];

    const count = randomInt(
      PARTNER_MIN_OBJECTS,
      PARTNER_MAX_OBJECTS
    );

    for (let i = 0; i < count; i++) {
      const type = randomInt(1, 5);

      if (type === 1) {
        // Brush stroke

        let x = randomFloat(40, CANVAS_W - 40);
        let y = randomFloat(40, CANVAS_H - 40);

        const points = [];

        const pointCount = randomInt(4, 15);

        for (let j = 0; j < pointCount; j++) {
          x += randomFloat(-40, 40);
          y += randomFloat(-40, 40);

          x = Math.max(10, Math.min(CANVAS_W - 10, x));
          y = Math.max(10, Math.min(CANVAS_H - 10, y));

          points.push({ x, y });
        }

        result.push({
          type: 'stroke',
          mode: 'brush',
          color: randomColor(),
          width: randomInt(2, 8),
          points
        });
      }

      else if (type === 2) {
        result.push({
          type: 'line',
          x1: randomFloat(20, CANVAS_W - 20),
          y1: randomFloat(20, CANVAS_H - 20),
          x2: randomFloat(20, CANVAS_W - 20),
          y2: randomFloat(20, CANVAS_H - 20),
          color: randomColor(),
          width: randomInt(2, 6)
        });
      }

      else if (type === 3) {
        result.push({
          type: 'circle',
          cx: randomFloat(50, CANVAS_W - 50),
          cy: randomFloat(50, CANVAS_H - 50),
          r: randomFloat(15, 100),
          color: randomColor(),
          width: randomInt(2, 6)
        });
      }

      else if (type === 4) {
        result.push({
          type: 'rect',
          x: randomFloat(20, CANVAS_W - 180),
          y: randomFloat(20, CANVAS_H - 180),
          w: randomFloat(30, 150),
          h: randomFloat(30, 150),
          color: randomColor(),
          width: randomInt(2, 6)
        });
      }

      else {
        result.push({
          type: 'polygon',
          cx: randomFloat(60, CANVAS_W - 60),
          cy: randomFloat(60, CANVAS_H - 60),
          r: randomFloat(20, 100),
          sides: randomInt(3, 7),
          rotation: randomFloat(0, Math.PI * 2),
          color: randomColor(),
          width: randomInt(2, 6)
        });
      }
    }

    return result;
  }

  function sendPartnerDrawing() {
    const drawingActions = generatePartnerDrawing();

    const image =
      createDrawingImage(drawingActions);

    const message = {
      id: Date.now(),
      sender: 'partner',
      text: '',
      timestamp: new Date(),
      image: image,
      drawingData: drawingActions,
      type: 'drawing',
      status: 'sent'
    };

    if (typeof window.addMessage === 'function') {
      try {
        window.addMessage(message);
      } catch (error) {
        console.error(
          '[DrawTogether] Partner drawing failed:',
          error
        );
      }
    }

    else {
      window.messages = window.messages || [];
      window.messages.push(message);

      if (typeof window.renderMessages === 'function') {
        window.renderMessages();
      }
    }

    log('Partner sent a drawing.');
  }

  /*
   * Call this after a USER message is sent.
   *
   * IMPORTANT:
   * This does NOT trigger after every drawing specifically.
   * It can happen after normal text messages too.
   */
  function maybePartnerDraw() {
    if (Math.random() > PARTNER_DRAW_CHANCE) {
      return;
    }

    const delay =
      randomInt(1500, 5000);

    setTimeout(() => {
      sendPartnerDrawing();
    }, delay);
  }

  // --------------------------------------------------
  // Controls
  // --------------------------------------------------

  function setupControls() {
    const toolbar =
      document.getElementById('canvas-toolbar');

    if (toolbar && !toolbar.dataset.dtReady) {
      toolbar.dataset.dtReady = '1';

      toolbar.innerHTML = `
        <div class="dt-tools">

          <div style="
            display:grid;
            grid-template-columns:repeat(3,1fr);
            gap:6px;
            margin-bottom:10px;
          ">

            <button type="button" data-tool="brush">
              🖌 Brush
            </button>

            <button type="button" data-tool="eraser">
              🧽 Eraser
            </button>

            <button type="button" data-tool="line">
              ╱ Line
            </button>

            <button type="button" data-tool="rect">
              □ Rect
            </button>

            <button type="button" data-tool="circle">
              ○ Circle
            </button>

            <button type="button" data-tool="polygon">
              ⬡ Polygon
            </button>

          </div>

          <div style="
            display:flex;
            align-items:center;
            gap:10px;
            flex-wrap:wrap;
          ">

            <label>
              Color
              <input
                type="color"
                id="dt-color"
                value="#111111"
              >
            </label>

            <label style="flex:1;">
              Size
              <input
                type="range"
                id="dt-size"
                min="1"
                max="40"
                value="4"
                style="width:100%;"
              >
            </label>

          </div>

          <div style="
            display:flex;
            align-items:center;
            gap:8px;
            margin-top:8px;
          ">

            <label>
              Sides
              <input
                type="number"
                id="dt-poly-sides"
                min="3"
                max="12"
                value="5"
                style="width:55px;"
              >
            </label>

          </div>

        </div>
      `;

      const buttons =
        toolbar.querySelectorAll('[data-tool]');

      buttons.forEach(button => {
        button.addEventListener('click', () => {

          buttons.forEach(b =>
            b.classList.remove('active')
          );

          button.classList.add('active');

          currentTool =
            button.dataset.tool;

        });
      });

      // Default brush
      const brush =
        toolbar.querySelector('[data-tool="brush"]');

      if (brush) {
        brush.classList.add('active');
      }

      const color =
        document.getElementById('dt-color');

      if (color) {
        color.addEventListener('input', e => {
          currentColor = e.target.value;
        });
      }

      const size =
        document.getElementById('dt-size');

      if (size) {
        size.addEventListener('input', e => {
          currentSize =
            parseInt(e.target.value, 10) || 4;
        });
      }

      const sides =
        document.getElementById('dt-poly-sides');

      if (sides) {
        sides.addEventListener('input', e => {
          polygonSides = Math.max(
            3,
            Math.min(
              12,
              parseInt(e.target.value, 10) || 5
            )
          );
        });
      }
    }

    // Buttons already in your HTML
    const undo =
      document.getElementById('canvas-undo');

    if (undo && !undo.dataset.dtReady) {
      undo.dataset.dtReady = '1';
      undo.addEventListener('click', undo);
    }

    const clear =
      document.getElementById('canvas-clear');

    if (clear && !clear.dataset.dtReady) {
      clear.dataset.dtReady = '1';

      clear.addEventListener('click', () => {
        if (confirm('Clear canvas?')) {
          clearCanvas();
        }
      });
    }

    const send =
      document.getElementById('canvas-send-to-chat');

    if (send && !send.dataset.dtReady) {
      send.dataset.dtReady = '1';

      send.addEventListener(
        'click',
        sendDrawingToChat
      );
    }

    const close =
      document.getElementById('canvas-save-close');

    if (close && !close.dataset.dtReady) {
      close.dataset.dtReady = '1';

      close.addEventListener(
        'click',
        closeModal
      );
    }

    const newButton =
      document.getElementById('canvas-new');

    if (newButton && !newButton.dataset.dtReady) {
      newButton.dataset.dtReady = '1';

      newButton.addEventListener('click', () => {
        if (confirm('New canvas?')) {
          clearCanvas();
        }
      });
    }
  }

  // --------------------------------------------------
  // Canvas events
  // --------------------------------------------------

  function setupCanvasEvents() {
    if (!canvas || canvas.dataset.dtEvents) {
      return;
    }

    canvas.dataset.dtEvents = '1';

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

    canvas.style.touchAction = 'none';
  }

  // --------------------------------------------------
  // Initialization
  // --------------------------------------------------

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;

    modal = getModal();

    if (!modal) {
      warn(
        '#canvas-modal not found yet. Waiting for DOM.'
      );

      initialized = false;
      return;
    }

    setupControls();

    canvas =
      document.getElementById('drawing-canvas');

    if (canvas) {
      setupCanvas();
      setupCanvasEvents();
    }

    log('Draw Together initialized.');
  }

  // --------------------------------------------------
  // Public API
  // --------------------------------------------------

  window.drawTogether = {

    open: function () {
      init();
      openModal();
    },

    close: function () {
      closeModal();
    },

    clear: function () {
      clearCanvas();
    },

    undo: function () {
      undo();
    },

    sendDrawing: function () {
      sendDrawingToChat();
    },

    maybePartnerDraw: function () {
      maybePartnerDraw();
    },

    getActions: function () {
      return actions;
    }
  };

  // --------------------------------------------------
  // Auto-init
  // --------------------------------------------------

  if (
    document.readyState === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init
    );
  } else {
    init();
  }

})();
