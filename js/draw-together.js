/* js/draw-together.js
 * Draw Together
 * - Opens as a normal modal
 * - Canvas on top
 * - Tools/control panel at bottom
 * - Mobile friendly
 * - Saves drawing locally
 * - Can send drawing to chat
 * - Partner has a SMALL chance to send a drawing after ANY user message
 */

(function () {
  'use strict';

  const CANVAS_W = 800;
  const CANVAS_H = 500;

  const STORAGE_KEY = 'draw_together_canvas_v2';

  // Chance partner sends a drawing after a user message.
  // 0.05 = 5%, 0.10 = 10%, etc.
  const PARTNER_DRAW_CHANCE = 1;

  let canvas = null;
  let ctx = null;
  let modal = null;

  let actions = [];
  let undoStack = [];

  let currentTool = 'brush';
  let currentColor = '#111111';
  let currentSize = 4;
  let polygonSides = 5;

  let drawing = false;
  let startPoint = null;
  let currentStroke = null;

  /* =========================================================
     MODAL
  ========================================================= */

  function createModal() {
    if (document.getElementById('draw-together-modal')) {
      modal = document.getElementById('draw-together-modal');
      canvas = document.getElementById('draw-together-canvas');
      ctx = canvas.getContext('2d');
      return;
    }

    const style = document.createElement('style');

    style.id = 'draw-together-style';

    style.textContent = `
      #draw-together-modal {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;

        display: none;
        align-items: center;
        justify-content: center;

        z-index: 999999 !important;

        background: rgba(0,0,0,.45) !important;

        isolation: isolate !important;
      }

      #draw-together-modal.dt-open {
        display: flex !important;
      }

      #draw-together-modal .dt-dialog {
        position: relative !important;

        width: min(920px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);

        background: var(--secondary-bg, #fff);
        color: var(--text-primary, #111);

        border-radius: 14px;

        overflow: hidden;

        box-shadow:
          0 25px 80px rgba(0,0,0,.35);

        display: flex;
        flex-direction: column;

        z-index: 1000000 !important;
      }

      #draw-together-modal .dt-header {
        flex-shrink: 0;

        display: flex;
        align-items: center;
        gap: 10px;

        padding: 12px 14px;

        border-bottom:
          1px solid var(--border-color, #ddd);
      }

      #draw-together-modal .dt-title {
        font-weight: 700;
      }

      #draw-together-modal .dt-header-spacer {
        flex: 1;
      }

      #draw-together-modal .dt-body {
        overflow-y: auto;
        padding: 12px;

        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* CANVAS ON TOP */

      #draw-together-modal .dt-canvas-container {
        width: 100%;

        background: var(--primary-bg, #f5f5f5);

        border-radius: 10px;

        padding: 8px;

        display: flex;
        justify-content: center;
        align-items: center;
      }

      #draw-together-canvas {
        display: block;

        width: 100%;
        height: auto;

        max-height: 55vh;

        background: white;

        border-radius: 7px;

        touch-action: none;

        cursor: crosshair;

        box-shadow:
          0 4px 15px rgba(0,0,0,.08);
      }

      /* TOOLBOX AT BOTTOM */

      #draw-together-modal .dt-toolbar {
        display: flex;
        flex-direction: column;

        gap: 9px;

        padding: 10px;

        background:
          var(--primary-bg, #f5f5f5);

        border-radius: 10px;
      }

      #draw-together-modal .dt-tool-row {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        align-items: center;
      }

      #draw-together-modal .dt-btn {
        border: none;

        padding: 8px 11px;

        border-radius: 8px;

        background:
          var(--secondary-bg, #fff);

        color:
          var(--text-primary, #111);

        cursor: pointer;

        font-size: 13px;
      }

      #draw-together-modal .dt-btn:hover {
        filter: brightness(.95);
      }

      #draw-together-modal .dt-btn.active {
        background:
          var(--accent-color, #ff7a6b);

        color: white;
      }

      #draw-together-modal .dt-btn.primary {
        background:
          var(--accent-color, #ff7a6b);

        color: white;
      }

      #draw-together-modal .dt-control {
        display: flex;
        align-items: center;
        gap: 8px;

        font-size: 13px;
      }

      #dt-color {
        width: 42px;
        height: 34px;
        padding: 0;
        border: none;
        background: transparent;
      }

      #dt-size {
        width: 130px;
      }

      #dt-poly-sides {
        width: 55px;
      }

      @media (max-width: 600px) {

        #draw-together-modal {
          align-items: stretch;
        }

        #draw-together-modal .dt-dialog {
          width: 100vw;
          max-height: 100vh;

          border-radius: 0;
        }

        #draw-together-modal .dt-body {
          padding: 8px;
        }

        #draw-together-canvas {
          max-height: 45vh;
        }

        #draw-together-modal .dt-btn {
          flex: 1 1 auto;
          min-width: 70px;
        }

        #draw-together-modal .dt-tool-row {
          justify-content: center;
        }
      }
    `;

    document.head.appendChild(style);

    modal = document.createElement('div');

    modal.id = 'draw-together-modal';

    modal.innerHTML = `
      <div class="dt-dialog">

        <div class="dt-header">

          <div class="dt-title">
            Draw Together · 画布
          </div>

          <div class="dt-header-spacer"></div>

          <button
            type="button"
            class="dt-btn primary"
            id="dt-send"
          >
            Send to Chat
          </button>

          <button
            type="button"
            class="dt-btn"
            id="dt-close"
          >
            Close
          </button>

        </div>

        <div class="dt-body">

          <!-- CANVAS -->

          <div class="dt-canvas-container">

            <canvas
              id="draw-together-canvas"
              width="${CANVAS_W}"
              height="${CANVAS_H}"
            ></canvas>

          </div>

          <!-- TOOLBOX -->

          <div class="dt-toolbar">

            <div class="dt-tool-row">

              <button class="dt-btn active" data-tool="brush">
                Brush
              </button>

              <button class="dt-btn" data-tool="eraser">
                Eraser
              </button>

              <button class="dt-btn" data-tool="line">
                Line
              </button>

              <button class="dt-btn" data-tool="rect">
                Rectangle
              </button>

              <button class="dt-btn" data-tool="circle">
                Circle
              </button>

              <button class="dt-btn" data-tool="polygon">
                Polygon
              </button>

            </div>

            <div class="dt-tool-row">

              <div class="dt-control">

                <span>Color</span>

                <input
                  type="color"
                  id="dt-color"
                  value="#111111"
                >

              </div>

              <div class="dt-control">

                <span>Size</span>

                <input
                  type="range"
                  id="dt-size"
                  min="1"
                  max="50"
                  value="4"
                >

              </div>

              <div class="dt-control">

                <span>Sides</span>

                <input
                  type="number"
                  id="dt-poly-sides"
                  min="3"
                  max="12"
                  value="5"
                >

              </div>

            </div>

            <div class="dt-tool-row">

              <button class="dt-btn" id="dt-undo">
                Undo
              </button>

              <button class="dt-btn" id="dt-clear">
                Clear
              </button>

              <button class="dt-btn" id="dt-new">
                New
              </button>

            </div>

          </div>

        </div>

      </div>
    `;

    document.body.appendChild(modal);

    canvas = document.getElementById('draw-together-canvas');
    ctx = canvas.getContext('2d');

    /* IMPORTANT:
       Force modal above any existing blur/backdrop.
    */

    modal.style.setProperty('z-index', '999999', 'important');

    const dialog = modal.querySelector('.dt-dialog');

    dialog.style.setProperty('z-index', '1000000', 'important');

    /* Prevent clicking outside from accidentally closing it */
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeModal();
      }
    });

    document.getElementById('dt-close')
      .addEventListener('click', closeModal);

    document.getElementById('dt-send')
      .addEventListener('click', sendDrawing);

    document.getElementById('dt-undo')
      .addEventListener('click', undo);

    document.getElementById('dt-clear')
      .addEventListener('click', clearCanvas);

    document.getElementById('dt-new')
      .addEventListener('click', clearCanvas);

    document.querySelectorAll(
      '#draw-together-modal [data-tool]'
    ).forEach(function (button) {

      button.addEventListener('click', function () {

        document.querySelectorAll(
          '#draw-together-modal [data-tool]'
        ).forEach(function (b) {
          b.classList.remove('active');
        });

        button.classList.add('active');

        currentTool =
          button.getAttribute('data-tool');
      });
    });

    document.getElementById('dt-color')
      .addEventListener('input', function (e) {
        currentColor = e.target.value;
      });

    document.getElementById('dt-size')
      .addEventListener('input', function (e) {
        currentSize =
          Number(e.target.value) || 4;
      });

    document.getElementById('dt-poly-sides')
      .addEventListener('input', function (e) {

        polygonSides = Math.max(
          3,
          Math.min(
            12,
            Number(e.target.value) || 5
          )
        );

      });

    setupCanvas();

    loadDrawing();
  }


  /* =========================================================
     OPEN / CLOSE
  ========================================================= */

  function openModal() {

    createModal();

    /*
     * Some existing apps put blur on body or a parent container.
     * Move our modal directly under <body> and make sure it is
     * outside those containers.
     */

    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }

    modal.classList.add('dt-open');

    modal.style.setProperty('display', 'flex', 'important');

    modal.style.setProperty('z-index', '999999', 'important');

    document.body.classList.add('dt-drawing-open');

    redraw();
  }


  function closeModal() {

    if (!modal) return;

    modal.classList.remove('dt-open');

    modal.style.setProperty('display', 'none', 'important');

    document.body.classList.remove('dt-drawing-open');

    saveDrawing();
  }


  /* =========================================================
     CANVAS
  ========================================================= */

  function setupCanvas() {

    canvas.addEventListener(
      'pointerdown',
      pointerDown
    );

    canvas.addEventListener(
      'pointermove',
      pointerMove
    );

    window.addEventListener(
      'pointerup',
      pointerUp
    );

    canvas.addEventListener(
      'pointercancel',
      pointerUp
    );
  }


  function getPosition(e) {

    const rect =
      canvas.getBoundingClientRect();

    return {

      x:
        (e.clientX - rect.left) *
        (CANVAS_W / rect.width),

      y:
        (e.clientY - rect.top) *
        (CANVAS_H / rect.height)

    };
  }


  function pointerDown(e) {

    e.preventDefault();

    drawing = true;

    startPoint = getPosition(e);

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

        points: [
          startPoint
        ]

      };

      actions.push(currentStroke);
    }

    redraw();
  }


  function pointerMove(e) {

    if (!drawing) return;

    e.preventDefault();

    const p = getPosition(e);

    if (
      currentTool === 'brush' ||
      currentTool === 'eraser'
    ) {

      if (!currentStroke) return;

      currentStroke.points.push(p);

      redraw();

      return;
    }

    redraw();

    drawPreview(p);
  }


  function pointerUp(e) {

    if (!drawing) return;

    drawing = false;

    const p = getPosition(e);

    if (
      currentTool === 'brush' ||
      currentTool === 'eraser'
    ) {

      currentStroke = null;

      saveDrawing();

      redraw();

      return;
    }

    if (currentTool === 'line') {

      actions.push({
        type: 'line',

        x1: startPoint.x,
        y1: startPoint.y,

        x2: p.x,
        y2: p.y,

        color: currentColor,
        width: currentSize
      });

    }

    else if (currentTool === 'rect') {

      actions.push({

        type: 'rect',

        x: Math.min(
          startPoint.x,
          p.x
        ),

        y: Math.min(
          startPoint.y,
          p.y
        ),

        w: Math.abs(
          p.x - startPoint.x
        ),

        h: Math.abs(
          p.y - startPoint.y
        ),

        color: currentColor,
        width: currentSize
      });

    }

    else if (currentTool === 'circle') {

      const dx =
        p.x - startPoint.x;

      const dy =
        p.y - startPoint.y;

      actions.push({

        type: 'circle',

        cx: startPoint.x,
        cy: startPoint.y,

        r: Math.sqrt(
          dx * dx +
          dy * dy
        ),

        color: currentColor,
        width: currentSize
      });

    }

    else if (currentTool === 'polygon') {

      const dx =
        p.x - startPoint.x;

      const dy =
        p.y - startPoint.y;

      actions.push({

        type: 'polygon',

        cx: startPoint.x,
        cy: startPoint.y,

        r: Math.sqrt(
          dx * dx +
          dy * dy
        ),

        sides: polygonSides,

        rotation: 0,

        color: currentColor,
        width: currentSize
      });
    }

    startPoint = null;

    saveDrawing();

    redraw();
  }


  /* =========================================================
     DRAWING
  ========================================================= */

  function renderAction(a, targetCtx, preview) {

    const c = targetCtx || ctx;

    c.save();

    if (a.type === 'stroke') {

      c.lineCap = 'round';
      c.lineJoin = 'round';

      c.lineWidth = a.width || 2;

      if (a.mode === 'eraser') {

        c.globalCompositeOperation =
          'destination-out';

      } else {

        c.globalCompositeOperation =
          'source-over';

        c.strokeStyle =
          a.color || '#111';
      }

      const points = a.points || [];

      if (!points.length) {
        c.restore();
        return;
      }

      c.beginPath();

      points.forEach(function (p, i) {

        if (i === 0) {
          c.moveTo(p.x, p.y);
        } else {
          c.lineTo(p.x, p.y);
        }

      });

      c.stroke();

    }

    else if (a.type === 'line') {

      c.lineWidth = a.width || 2;
      c.strokeStyle = a.color || '#111';

      c.beginPath();

      c.moveTo(a.x1, a.y1);
      c.lineTo(a.x2, a.y2);

      c.stroke();

    }

    else if (a.type === 'rect') {

      c.lineWidth = a.width || 2;
      c.strokeStyle = a.color || '#111';

      c.strokeRect(
        a.x,
        a.y,
        a.w,
        a.h
      );

    }

    else if (a.type === 'circle') {

      c.lineWidth = a.width || 2;
      c.strokeStyle = a.color || '#111';

      c.beginPath();

      c.arc(
        a.cx,
        a.cy,
        a.r,
        0,
        Math.PI * 2
      );

      c.stroke();

    }

    else if (a.type === 'polygon') {

      const sides =
        Math.max(
          3,
          a.sides || 5
        );

      c.lineWidth =
        a.width || 2;

      c.strokeStyle =
        a.color || '#111';

      c.beginPath();

      for (
        let i = 0;
        i < sides;
        i++
      ) {

        const angle =
          (a.rotation || 0) +
          i / sides *
          Math.PI * 2;

        const x =
          a.cx +
          Math.cos(angle) *
          a.r;

        const y =
          a.cy +
          Math.sin(angle) *
          a.r;

        if (i === 0) {
          c.moveTo(x, y);
        } else {
          c.lineTo(x, y);
        }
      }

      c.closePath();

      c.stroke();
    }

    c.restore();
  }


  function redraw() {

    if (!ctx) return;

    ctx.clearRect(
      0,
      0,
      CANVAS_W,
      CANVAS_H
    );

    ctx.fillStyle = '#fff';

    ctx.fillRect(
      0,
      0,
      CANVAS_W,
      CANVAS_H
    );

    actions.forEach(function (a) {
      renderAction(a);
    });
  }


  function drawPreview(p) {

    if (!startPoint) return;

    ctx.save();

    ctx.setLineDash([
      6,
      6
    ]);

    if (currentTool === 'line') {

      renderAction({

        type: 'line',

        x1: startPoint.x,
        y1: startPoint.y,

        x2: p.x,
        y2: p.y,

        color: currentColor,
        width: currentSize

      });

    }

    else if (currentTool === 'rect') {

      renderAction({

        type: 'rect',

        x: Math.min(
          startPoint.x,
          p.x
        ),

        y: Math.min(
          startPoint.y,
          p.y
        ),

        w: Math.abs(
          p.x - startPoint.x
        ),

        h: Math.abs(
          p.y - startPoint.y
        ),

        color: currentColor,
        width: currentSize

      });

    }

    else if (currentTool === 'circle') {

      const dx =
        p.x - startPoint.x;

      const dy =
        p.y - startPoint.y;

      renderAction({

        type: 'circle',

        cx: startPoint.x,
        cy: startPoint.y,

        r: Math.sqrt(
          dx * dx +
          dy * dy
        ),

        color: currentColor,
        width: currentSize

      });

    }

    else if (currentTool === 'polygon') {

      const dx =
        p.x - startPoint.x;

      const dy =
        p.y - startPoint.y;

      renderAction({

        type: 'polygon',

        cx: startPoint.x,
        cy: startPoint.y,

        r: Math.sqrt(
          dx * dx +
          dy * dy
        ),

        sides: polygonSides,

        rotation: 0,

        color: currentColor,
        width: currentSize

      });
    }

    ctx.restore();
  }


  /* =========================================================
     UNDO / CLEAR
  ========================================================= */

  function undo() {

    if (!actions.length) return;

    undoStack.push(
      actions.pop()
    );

    saveDrawing();

    redraw();
  }


  function clearCanvas() {

    if (
      !confirm('Clear canvas?')
    ) {
      return;
    }

    actions = [];

    undoStack = [];

    saveDrawing();

    redraw();
  }


  /* =========================================================
     LOCAL STORAGE
  ========================================================= */

  function saveDrawing() {

    try {

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(actions)
      );

    } catch (e) {

      console.warn(
        '[DrawTogether] Could not save drawing',
        e
      );

    }
  }


  function loadDrawing() {

    try {

      const raw =
        localStorage.getItem(
          STORAGE_KEY
        );

      if (!raw) return;

      const saved =
        JSON.parse(raw);

      if (Array.isArray(saved)) {

        actions = saved;

        redraw();
      }

    } catch (e) {

      console.warn(
        '[DrawTogether] Could not load drawing',
        e
      );

    }
  }


  /* =========================================================
     SEND DRAWING TO CHAT
  ========================================================= */

  function createImage() {

    const output =
      document.createElement('canvas');

    output.width = CANVAS_W;
    output.height = CANVAS_H;

    const outCtx =
      output.getContext('2d');

    outCtx.fillStyle = '#fff';

    outCtx.fillRect(
      0,
      0,
      CANVAS_W,
      CANVAS_H
    );

    actions.forEach(function (a) {

      renderAction(
        a,
        outCtx
      );

    });

    return output.toDataURL(
      'image/png'
    );
  }


  function sendDrawing() {

    const image =
      createImage();

    const message = {

      id: Date.now(),

      sender: 'user',

      text: '',

      timestamp: new Date(),

      image: image,

      drawingData:
        JSON.parse(
          JSON.stringify(actions)
        ),

      type: 'drawing',

      status: 'sent'

    };

    if (
      typeof window.addMessage ===
      'function'
    ) {

      try {

        window.addMessage(message);

      } catch (e) {

        fallbackMessage(message);
      }

    } else {

      fallbackMessage(message);
    }

    closeModal();

    /*
     * IMPORTANT:
     *
     * Sending a drawing itself does NOT automatically
     * make the partner draw.
     *
     * The partner-drawing chance should be triggered
     * by the normal message system.
     */

    saveDrawing();
  }


  function fallbackMessage(message) {

    window.messages =
      window.messages || [];

    window.messages.push(
      message
    );

    if (
      typeof window.renderMessages ===
      'function'
    ) {

      window.renderMessages();
    }
  }


  /* =========================================================
     PARTNER DRAWING
     *
     * Call this whenever the USER sends ANY message.
     * It is NOT tied specifically to drawings.
  ========================================================= */

  function maybePartnerDraw() {

    if (
      Math.random() >
      PARTNER_DRAW_CHANCE
    ) {
      return;
    }

    const delay =
      1000 +
      Math.random() * 3000;

    setTimeout(
      function () {

        sendRandomPartnerDrawing();

      },
      delay
    );
  }


  function sendRandomPartnerDrawing() {

    const partnerActions =
      generatePartnerDrawing();

    const output =
      document.createElement('canvas');

    output.width = CANVAS_W;
    output.height = CANVAS_H;

    const outCtx =
      output.getContext('2d');

    outCtx.fillStyle = '#fff';

    outCtx.fillRect(
      0,
      0,
      CANVAS_W,
      CANVAS_H
    );

    partnerActions.forEach(
      function (a) {

        renderAction(
          a,
          outCtx
        );

      }
    );

    const message = {

      id: Date.now(),

      sender: 'partner',

      text: '',

      timestamp: new Date(),

      image:
        output.toDataURL(
          'image/png'
        ),

      drawingData:
        partnerActions,

      type: 'drawing',

      status: 'sent'

    };

    if (
      typeof window.addMessage ===
      'function'
    ) {

      try {

        window.addMessage(
          message
        );

      } catch (e) {

        fallbackMessage(
          message
        );
      }

    } else {

      fallbackMessage(
        message
      );
    }
  }


  function generatePartnerDrawing() {

    const result = [];

    const count =
      3 +
      Math.floor(
        Math.random() * 8
      );

    const colors = [
      '#ff6b6b',
      '#4dabf7',
      '#51cf66',
      '#fcc419',
      '#cc5de8',
      '#ff922b'
    ];

    for (
      let i = 0;
      i < count;
      i++
    ) {

      const type =
        Math.floor(
          Math.random() * 4
        );

      const color =
        colors[
          Math.floor(
            Math.random() *
            colors.length
          )
        ];

      if (type === 0) {

        const points = [];

        let x =
          50 +
          Math.random() *
          700;

        let y =
          50 +
          Math.random() *
          400;

        for (
          let j = 0;
          j < 8;
          j++
        ) {

          x +=
            -40 +
            Math.random() * 80;

          y +=
            -40 +
            Math.random() * 80;

          points.push({

            x: Math.max(
              10,
              Math.min(
                790,
                x
              )
            ),

            y: Math.max(
              10,
              Math.min(
                490,
                y
              )
            )

          });
        }

        result.push({

          type: 'stroke',

          mode: 'brush',

          color: color,

          width:
            2 +
            Math.random() * 5,

          points: points

        });

      }

      else if (type === 1) {

        result.push({

          type: 'circle',

          cx:
            50 +
            Math.random() * 700,

          cy:
            50 +
            Math.random() * 400,

          r:
            15 +
            Math.random() * 80,

          color: color,

          width: 3

        });

      }

      else if (type === 2) {

        result.push({

          type: 'rect',

          x:
            20 +
            Math.random() * 600,

          y:
            20 +
            Math.random() * 350,

          w:
            30 +
            Math.random() * 150,

          h:
            30 +
            Math.random() * 100,

          color: color,

          width: 3

        });

      }

      else {

        result.push({

          type: 'line',

          x1:
            Math.random() *
            CANVAS_W,

          y1:
            Math.random() *
            CANVAS_H,

          x2:
            Math.random() *
            CANVAS_W,

          y2:
            Math.random() *
            CANVAS_H,

          color: color,

          width: 3

        });
      }
    }

    return result;
  }


  /* =========================================================
     PUBLIC API
  ========================================================= */

  window.drawTogether = {

    open: openModal,

    close: closeModal,

    sendDrawing: sendDrawing,

    maybePartnerDraw:
      maybePartnerDraw,

    newCanvas: function () {

      createModal();

      actions = [];

      undoStack = [];

      saveDrawing();

      redraw();

      openModal();

      return {

        id: 'drawing-' + Date.now()

      };

    },

    openCanvasModalById:
      function () {

        openModal();

      }

  };


  /*
   * Compatibility with your existing HTML:
   *
   * Clicking #open-draw-together will open our modal.
   */

  function init() {

    createModal();

    const button =
      document.getElementById(
        'open-draw-together'
      );

    if (button) {

      button.onclick =
        function (e) {

          e.preventDefault();

          openModal();

        };

    }

    console.log(
      '[DrawTogether] initialized'
    );
  }


  if (
    document.readyState ===
    'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      init
    );

  } else {

    init();

  }


})();
