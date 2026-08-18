/* js/draw-together.js
 *
 * Draw Together
 * - Uses the existing #open-draw-together button
 * - Uses the existing #draw-together-modal
 * - Canvas on top, toolbox underneath
 * - Mobile friendly
 * - No floating launcher/button
 * - Uses addMessage() when available
 * - Saves the current drawing locally
 * - Exposes window.drawTogether.open()
 * - Exposes window.drawTogether.send()
 * - Exposes window.drawTogether.partnerDraw()
 *
 * IMPORTANT:
 * Replace the old draw-together.js completely with this file.
 */

(function () {
  'use strict';

  /* =========================================================
     CONFIG
  ========================================================= */

  const CANVAS_W = 800;
  const CANVAS_H = 500;

  const STORAGE_SUFFIX = 'draw_together_current_v2';
  const SAVE_DELAY = 300;

  // This is NOT automatically used by this file.
  // Your normal message/partner system can use this later.
  const PARTNER_DRAW_CHANCE = 1; // 8%

  /* =========================================================
     LOGGING
  ========================================================= */

  const log = (...args) => {
    try {
      console.info('[DrawTogether]', ...args);
    } catch (_) {}
  };

  const warn = (...args) => {
    try {
      console.warn('[DrawTogether]', ...args);
    } catch (_) {}
  };

  const error = (...args) => {
    try {
      console.error('[DrawTogether]', ...args);
    } catch (_) {}
  };


  /* =========================================================
     DOM
  ========================================================= */

  let canvas = null;
  let ctx = null;

  let modal = null;
  let openButton = null;
  let closeButton = null;
  let sendButton = null;

  let undoButton = null;
  let clearButton = null;
  let newButton = null;

  let colorInput = null;
  let sizeInput = null;
  let sizeValue = null;
  let sidesInput = null;

  let toolButtons = [];

  let initialized = false;


  /* =========================================================
     DRAWING STATE
  ========================================================= */

  let actions = [];
  let undone = [];

  let currentTool = 'brush';
  let currentColor = '#111111';
  let currentSize = 4;
  let polygonSides = 5;

  let drawing = false;
  let startPoint = null;
  let currentStroke = null;
  let previewAction = null;

  let saveTimer = null;


  /* =========================================================
     STORAGE
  ========================================================= */

  function fallbackStorageKey() {
    try {
      if (
        typeof window.APP_PREFIX === 'string' &&
        window.APP_PREFIX.length
      ) {
        return window.APP_PREFIX + STORAGE_SUFFIX;
      }
    } catch (_) {}

    return 'app_' + STORAGE_SUFFIX;
  }

  function getStorageKey() {
    /*
     * We deliberately avoid calling getStorageKey() unless it
     * actually exists and SESSION_ID is available.
     */

    try {
      if (
        typeof window.SESSION_ID !== 'undefined' &&
        window.SESSION_ID !== null &&
        typeof window.getStorageKey === 'function'
      ) {
        const key = window.getStorageKey(STORAGE_SUFFIX);

        if (key) {
          return key;
        }
      }
    } catch (e) {
      warn('Session storage key unavailable:', e);
    }

    return fallbackStorageKey();
  }


  async function saveDrawing() {
    const data = {
      version: 2,
      actions: actions,
      timestamp: Date.now()
    };

    const key = getStorageKey();

    try {
      if (window.localforage) {
        await window.localforage.setItem(key, data);
        return;
      }
    } catch (e) {
      warn('localforage save failed:', e);
    }

    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      warn('localStorage save failed:', e);
    }
  }


  function scheduleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      saveDrawing().catch(() => {});
    }, SAVE_DELAY);
  }


  async function loadDrawing() {
    const key = getStorageKey();
    let data = null;

    try {
      if (window.localforage) {
        data = await window.localforage.getItem(key);
      }
    } catch (e) {
      warn('localforage load failed:', e);
    }

    if (!data) {
      try {
        const raw = localStorage.getItem(key);

        if (raw) {
          data = JSON.parse(raw);
        }
      } catch (e) {
        warn('localStorage load failed:', e);
      }
    }

    if (
      data &&
      Array.isArray(data.actions)
    ) {
      actions = data.actions.slice();
      undone = [];
    } else {
      actions = [];
      undone = [];
    }

    redraw();
  }


  /* =========================================================
     CANVAS
  ========================================================= */

  function setupCanvas() {
    if (!canvas) return;

    const dpr = Math.max(
      1,
      window.devicePixelRatio || 1
    );

    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;

    /*
     * CSS controls the visible size.
     * The internal drawing coordinates remain 800x500.
     */

    canvas.style.aspectRatio = '800 / 500';

    ctx = canvas.getContext('2d', {
      alpha: false
    });

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    redraw();
  }


  function clearCanvasPixels() {
    if (!ctx) return;

    ctx.save();

    ctx.setTransform(
      window.devicePixelRatio || 1,
      0,
      0,
      window.devicePixelRatio || 1,
      0,
      0
    );

    ctx.clearRect(
      0,
      0,
      CANVAS_W,
      CANVAS_H
    );

    ctx.fillStyle = '#ffffff';

    ctx.fillRect(
      0,
      0,
      CANVAS_W,
      CANVAS_H
    );

    ctx.restore();

    /*
     * Restore the normal drawing transform.
     */
    const dpr = Math.max(
      1,
      window.devicePixelRatio || 1
    );

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );
  }


  function redraw() {
    if (!ctx) return;

    clearCanvasPixels();

    for (const action of actions) {
      renderAction(ctx, action);
    }

    if (previewAction) {
      renderAction(
        ctx,
        previewAction,
        true
      );
    }
  }


  /* =========================================================
     DRAWING RENDERER
  ========================================================= */

  function renderAction(context, action, preview = false) {
    if (!action || !context) return;

    try {
      context.save();

      /*
       * Stroke / brush / eraser
       */
      if (action.type === 'stroke') {
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = action.width || 2;

        if (action.mode === 'eraser') {
          context.globalCompositeOperation =
            'destination-out';
        } else {
          context.globalCompositeOperation =
            'source-over';

          context.strokeStyle =
            action.color || '#111111';
        }

        const points = action.points || [];

        if (!points.length) {
          context.restore();
          return;
        }

        context.beginPath();

        if (preview) {
          context.setLineDash([6, 6]);
        }

        context.moveTo(
          points[0].x,
          points[0].y
        );

        for (let i = 1; i < points.length; i++) {
          context.lineTo(
            points[i].x,
            points[i].y
          );
        }

        context.stroke();

        context.restore();
        return;
      }


      /*
       * Line
       */
      if (action.type === 'line') {
        context.lineWidth =
          action.width || 2;

        context.strokeStyle =
          action.color || '#111111';

        context.lineCap = 'round';

        if (preview) {
          context.setLineDash([6, 6]);
        }

        context.beginPath();

        context.moveTo(
          action.x1,
          action.y1
        );

        context.lineTo(
          action.x2,
          action.y2
        );

        context.stroke();

        context.restore();
        return;
      }


      /*
       * Rectangle
       */
      if (action.type === 'rect') {
        context.lineWidth =
          action.width || 2;

        context.strokeStyle =
          action.color || '#111111';

        if (action.fill) {
          context.fillStyle = action.fill;
          context.fillRect(
            action.x,
            action.y,
            action.w,
            action.h
          );
        }

        if (preview) {
          context.setLineDash([6, 6]);
        }

        context.strokeRect(
          action.x,
          action.y,
          action.w,
          action.h
        );

        context.restore();
        return;
      }


      /*
       * Circle
       */
      if (action.type === 'circle') {
        context.lineWidth =
          action.width || 2;

        context.strokeStyle =
          action.color || '#111111';

        context.beginPath();

        context.arc(
          action.cx,
          action.cy,
          action.r,
          0,
          Math.PI * 2
        );

        if (action.fill) {
          context.fillStyle = action.fill;
          context.fill();
        }

        if (preview) {
          context.setLineDash([6, 6]);
        }

        context.stroke();

        context.restore();
        return;
      }


      /*
       * Polygon
       */
      if (action.type === 'polygon') {
        const sides = Math.max(
          3,
          Math.floor(action.sides || 5)
        );

        const rotation =
          action.rotation || 0;

        context.lineWidth =
          action.width || 2;

        context.strokeStyle =
          action.color || '#111111';

        context.beginPath();

        for (let i = 0; i < sides; i++) {
          const angle =
            rotation +
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

        if (action.fill) {
          context.fillStyle = action.fill;
          context.fill();
        }

        if (preview) {
          context.setLineDash([6, 6]);
        }

        context.stroke();

        context.restore();
        return;
      }

      context.restore();

    } catch (e) {
      warn('renderAction failed:', e);
    }
  }


  /* =========================================================
     COORDINATES
  ========================================================= */

  function pointerPosition(event) {
    if (!canvas) {
      return {
        x: 0,
        y: 0
      };
    }

    const rect =
      canvas.getBoundingClientRect();

    let clientX;
    let clientY;

    if (
      event.touches &&
      event.touches.length
    ) {
      clientX =
        event.touches[0].clientX;

      clientY =
        event.touches[0].clientY;
    } else if (
      event.changedTouches &&
      event.changedTouches.length
    ) {
      clientX =
        event.changedTouches[0].clientX;

      clientY =
        event.changedTouches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    return {
      x: Math.max(
        0,
        Math.min(
          CANVAS_W,
          (clientX - rect.left) *
            (CANVAS_W / rect.width)
        )
      ),

      y: Math.max(
        0,
        Math.min(
          CANVAS_H,
          (clientY - rect.top) *
            (CANVAS_H / rect.height)
        )
      )
    };
  }


  /* =========================================================
     POINTER EVENTS
  ========================================================= */

  function startDrawing(event) {
    if (!canvas) return;

    event.preventDefault();

    try {
      if (
        event.pointerId !== undefined &&
        canvas.setPointerCapture
      ) {
        canvas.setPointerCapture(
          event.pointerId
        );
      }
    } catch (_) {}

    const point =
      pointerPosition(event);

    drawing = true;
    startPoint = point;
    previewAction = null;

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
          {
            x: point.x,
            y: point.y
          }
        ]
      };

      actions.push(currentStroke);

      undone = [];

      redraw();
      scheduleSave();
    }
  }


  function moveDrawing(event) {
    if (!drawing) return;

    event.preventDefault();

    const point =
      pointerPosition(event);

    /*
     * Brush
     */
    if (
      currentTool === 'brush' ||
      currentTool === 'eraser'
    ) {
      if (!currentStroke) return;

      currentStroke.points.push({
        x: point.x,
        y: point.y
      });

      redraw();
      return;
    }


    /*
     * Line
     */
    if (currentTool === 'line') {
      previewAction = {
        type: 'line',

        x1: startPoint.x,
        y1: startPoint.y,

        x2: point.x,
        y2: point.y,

        color: currentColor,
        width: currentSize
      };

      redraw();
      return;
    }


    /*
     * Rectangle
     */
    if (currentTool === 'rect') {
      const x =
        Math.min(
          startPoint.x,
          point.x
        );

      const y =
        Math.min(
          startPoint.y,
          point.y
        );

      const w =
        Math.abs(
          point.x -
          startPoint.x
        );

      const h =
        Math.abs(
          point.y -
          startPoint.y
        );

      previewAction = {
        type: 'rect',

        x,
        y,
        w,
        h,

        color: currentColor,
        width: currentSize
      };

      redraw();
      return;
    }


    /*
     * Circle
     */
    if (currentTool === 'circle') {
      const dx =
        point.x -
        startPoint.x;

      const dy =
        point.y -
        startPoint.y;

      const radius =
        Math.sqrt(
          dx * dx +
          dy * dy
        );

      previewAction = {
        type: 'circle',

        cx: startPoint.x,
        cy: startPoint.y,

        r: radius,

        color: currentColor,
        width: currentSize
      };

      redraw();
      return;
    }


    /*
     * Polygon
     */
    if (currentTool === 'polygon') {
      const dx =
        point.x -
        startPoint.x;

      const dy =
        point.y -
        startPoint.y;

      const radius =
        Math.sqrt(
          dx * dx +
          dy * dy
        );

      const rotation =
        Math.atan2(dy, dx);

      previewAction = {
        type: 'polygon',

        cx: startPoint.x,
        cy: startPoint.y,

        r: radius,

        sides: polygonSides,

        rotation,

        color: currentColor,
        width: currentSize
      };

      redraw();
    }
  }


  function finishDrawing(event) {
    if (!drawing) return;

    event.preventDefault();

    const point =
      pointerPosition(event);

    drawing = false;

    /*
     * Brush / eraser
     */
    if (
      currentTool === 'brush' ||
      currentTool === 'eraser'
    ) {
      currentStroke = null;

      scheduleSave();
      redraw();
    }


    /*
     * Line
     */
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

      undone = [];

      scheduleSave();
    }


    /*
     * Rectangle
     */
    else if (currentTool === 'rect') {
      actions.push({
        type: 'rect',

        x: Math.min(
          startPoint.x,
          point.x
        ),

        y: Math.min(
          startPoint.y,
          point.y
        ),

        w: Math.abs(
          point.x -
          startPoint.x
        ),

        h: Math.abs(
          point.y -
          startPoint.y
        ),

        color: currentColor,
        width: currentSize
      });

      undone = [];

      scheduleSave();
    }


    /*
     * Circle
     */
    else if (currentTool === 'circle') {
      const dx =
        point.x -
        startPoint.x;

      const dy =
        point.y -
        startPoint.y;

      const radius =
        Math.sqrt(
          dx * dx +
          dy * dy
        );

      actions.push({
        type: 'circle',

        cx: startPoint.x,
        cy: startPoint.y,

        r: radius,

        color: currentColor,
        width: currentSize
      });

      undone = [];

      scheduleSave();
    }


    /*
     * Polygon
     */
    else if (currentTool === 'polygon') {
      const dx =
        point.x -
        startPoint.x;

      const dy =
        point.y -
        startPoint.y;

      const radius =
        Math.sqrt(
          dx * dx +
          dy * dy
        );

      const rotation =
        Math.atan2(dy, dx);

      actions.push({
        type: 'polygon',

        cx: startPoint.x,
        cy: startPoint.y,

        r: radius,

        sides: polygonSides,

        rotation,

        color: currentColor,
        width: currentSize
      });

      undone = [];

      scheduleSave();
    }

    previewAction = null;
    startPoint = null;

    redraw();
  }


  /* =========================================================
     UNDO / CLEAR / NEW
  ========================================================= */

  function undo() {
    if (!actions.length) return;

    const action =
      actions.pop();

    undone.push(action);

    scheduleSave();
    redraw();
  }


  function clearDrawing() {
    actions = [];
    undone = [];

    previewAction = null;
    currentStroke = null;

    scheduleSave();
    redraw();
  }


  function newDrawing() {
    clearDrawing();
  }


  /* =========================================================
     TOOLS
  ========================================================= */

  function selectTool(tool) {
    const allowed = [
      'brush',
      'eraser',
      'line',
      'rect',
      'circle',
      'polygon'
    ];

    if (!allowed.includes(tool)) {
      tool = 'brush';
    }

    currentTool = tool;

    toolButtons.forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.tool === tool
      );
    });
  }


  /* =========================================================
     EXPORT DRAWING
  ========================================================= */

  function createImageData() {
    const output =
      document.createElement('canvas');

    output.width = CANVAS_W;
    output.height = CANVAS_H;

    const outputContext =
      output.getContext('2d');

    /*
     * White background.
     */
    outputContext.fillStyle =
      '#ffffff';

    outputContext.fillRect(
      0,
      0,
      CANVAS_W,
      CANVAS_H
    );

    for (const action of actions) {
      renderAction(
        outputContext,
        action
      );
    }

    return output.toDataURL(
      'image/png'
    );
  }


  /* =========================================================
     SEND TO EXISTING CHAT
  ========================================================= */

  function sendToPartner() {
    try {
      const image =
        createImageData();

      const drawingData =
        JSON.parse(
          JSON.stringify(actions)
        );

      const message = {
        id:
          Date.now() +
          Math.floor(
            Math.random() * 1000
          ),

        sender: 'user',

        text: '',

        timestamp: new Date(),

        image: image,

        drawingData: drawingData,

        type: 'drawing',

        status: 'sent'
      };


      /*
       * Use the app's existing message system.
       */
      if (
        typeof window.addMessage ===
        'function'
      ) {
        window.addMessage(message);
      }

      /*
       * Fallback if addMessage doesn't exist.
       */
      else {
        window.messages =
          window.messages || [];

        window.messages.push(message);

        if (
          typeof window.renderMessages ===
          'function'
        ) {
          window.renderMessages();
        } else {
          warn(
            'addMessage() and renderMessages() are unavailable.'
          );
        }
      }


      /*
       * Save drawing.
       */
      scheduleSave();

      /*
       * Close modal after sending.
       */
      close();

      log('Drawing sent to partner.');

    } catch (e) {
      error(
        'Failed to send drawing:',
        e
      );
    }
  }


  /* =========================================================
     PARTNER DRAWING
  =========================================================
     
     This function does NOT automatically run when you send
     a drawing.

     Your existing partner-response code can eventually call:

         window.drawTogether.partnerDraw();

     when the partner randomly decides to draw.
  ========================================================= */

  function partnerDraw(customActions) {
    try {
      const partnerActions =
        Array.isArray(customActions)
          ? customActions
          : createRandomPartnerDrawing();

      const output =
        document.createElement('canvas');

      output.width = CANVAS_W;
      output.height = CANVAS_H;

      const outputContext =
        output.getContext('2d');

      outputContext.fillStyle =
        '#ffffff';

      outputContext.fillRect(
        0,
        0,
        CANVAS_W,
        CANVAS_H
      );

      for (
        const action of partnerActions
      ) {
        renderAction(
          outputContext,
          action
        );
      }

      const image =
        output.toDataURL(
          'image/png'
        );

      const message = {
        id:
          Date.now() +
          Math.floor(
            Math.random() * 1000
          ),

        sender: 'partner',

        text: '',

        timestamp: new Date(),

        image: image,

        drawingData:
          partnerActions,

        type: 'drawing',

        status: 'sent'
      };


      if (
        typeof window.addMessage ===
        'function'
      ) {
        window.addMessage(message);
      } else {
        window.messages =
          window.messages || [];

        window.messages.push(message);

        if (
          typeof window.renderMessages ===
          'function'
        ) {
          window.renderMessages();
        }
      }

      log('Partner drawing sent.');

      return message;

    } catch (e) {
      error(
        'Partner drawing failed:',
        e
      );

      return null;
    }
  }


  /* =========================================================
     RANDOM PARTNER DOODLE
  ========================================================= */

  function randomColor() {
    const hue =
      Math.floor(
        Math.random() * 360
      );

    return `hsl(${hue} 65% 45%)`;
  }


  function randomNumber(min, max) {
    return (
      min +
      Math.random() *
      (max - min)
    );
  }


  function randomInt(min, max) {
    return Math.floor(
      randomNumber(
        min,
        max + 1
      )
    );
  }


  function randomPartnerDoodle() {
    const count =
      randomInt(3, 10);

    const result = [];

    for (let i = 0; i < count; i++) {
      const type =
        [
          'stroke',
          'line',
          'circle',
          'rect',
          'polygon'
        ][
          randomInt(0, 4)
        ];

      const color =
        randomColor();

      const width =
        randomInt(2, 7);


      if (type === 'stroke') {
        const points = [];

        let x =
          randomNumber(
            40,
            CANVAS_W - 40
          );

        let y =
          randomNumber(
            40,
            CANVAS_H - 40
          );

        const pointCount =
          randomInt(4, 14);

        for (
          let j = 0;
          j < pointCount;
          j++
        ) {
          x += randomNumber(
            -35,
            35
          );

          y += randomNumber(
            -35,
            35
          );

          x = Math.max(
            10,
            Math.min(
              CANVAS_W - 10,
              x
            )
          );

          y = Math.max(
            10,
            Math.min(
              CANVAS_H - 10,
              y
            )
          );

          points.push({
            x,
            y
          });
        }

        result.push({
          type: 'stroke',

          mode: 'brush',

          color,

          width,

          points
        });
      }


      else if (type === 'line') {
        result.push({
          type: 'line',

          x1:
            randomNumber(
              20,
              CANVAS_W - 20
            ),

          y1:
            randomNumber(
              20,
              CANVAS_H - 20
            ),

          x2:
            randomNumber(
              20,
              CANVAS_W - 20
            ),

          y2:
            randomNumber(
              20,
              CANVAS_H - 20
            ),

          color,

          width
        });
      }


      else if (type === 'circle') {
        result.push({
          type: 'circle',

          cx:
            randomNumber(
              50,
              CANVAS_W - 50
            ),

          cy:
            randomNumber(
              50,
              CANVAS_H - 50
            ),

          r:
            randomNumber(
              10,
              80
            ),

          color,

          width
        });
      }


      else if (type === 'rect') {
        result.push({
          type: 'rect',

          x:
            randomNumber(
              20,
              CANVAS_W - 160
            ),

          y:
            randomNumber(
              20,
              CANVAS_H - 140
            ),

          w:
            randomNumber(
              30,
              140
            ),

          h:
            randomNumber(
              30,
              120
            ),

          color,

          width
        });
      }


      else if (type === 'polygon') {
        result.push({
          type: 'polygon',

          cx:
            randomNumber(
              50,
              CANVAS_W - 50
            ),

          cy:
            randomNumber(
              50,
              CANVAS_H - 50
            ),

          r:
            randomNumber(
              15,
              80
            ),

          sides:
            randomInt(
              3,
              7
            ),

          rotation:
            randomNumber(
              0,
              Math.PI * 2
            ),

          color,

          width
        });
      }
    }

    return result;
  }


  function createRandomPartnerDrawing() {
    return randomPartnerDoodle();
  }


  /* =========================================================
     MODAL
  ========================================================= */

  function open() {
    if (!modal) return;

    modal.style.display = 'flex';

    /*
     * Some existing modal systems use .modal.
     * Flex makes the modal center correctly if there isn't
     * already CSS doing it.
     */

    requestAnimationFrame(() => {
      setupCanvas();
    });

    loadDrawing().catch(() => {});

    log('Draw Together opened.');
  }


  function close() {
    if (!modal) return;

    modal.style.display = 'none';

    scheduleSave();

    log('Draw Together closed.');
  }


  /* =========================================================
     UI EVENTS
  ========================================================= */

  function bindUI() {
    /*
     * Open button
     */
    if (openButton) {
      openButton.addEventListener(
        'click',
        open
      );
    }


    /*
     * Close
     */
    if (closeButton) {
      closeButton.addEventListener(
        'click',
        close
      );
    }


    /*
     * Send
     */
    if (sendButton) {
      sendButton.addEventListener(
        'click',
        sendToPartner
      );
    }


    /*
     * Undo
     */
    if (undoButton) {
      undoButton.addEventListener(
        'click',
        undo
      );
    }


    /*
     * Clear
     */
    if (clearButton) {
      clearButton.addEventListener(
        'click',
        () => {
          if (
            window.confirm(
              'Clear the drawing?'
            )
          ) {
            clearDrawing();
          }
        }
      );
    }


    /*
     * New
     */
    if (newButton) {
      newButton.addEventListener(
        'click',
        () => {
          if (
            window.confirm(
              'Start a new drawing?'
            )
          ) {
            newDrawing();
          }
        }
      );
    }


    /*
     * Tools
     */
    toolButtons.forEach(button => {
      button.addEventListener(
        'click',
        () => {
          selectTool(
            button.dataset.tool
          );
        }
      );
    });


    /*
     * Color
     */
    if (colorInput) {
      colorInput.addEventListener(
        'input',
        event => {
          currentColor =
            event.target.value ||
            '#111111';
        }
      );
    }


    /*
     * Brush size
     */
    if (sizeInput) {
      sizeInput.addEventListener(
        'input',
        event => {
          currentSize =
            parseInt(
              event.target.value,
              10
            ) || 4;

          if (sizeValue) {
            sizeValue.textContent =
              String(currentSize);
          }
        }
      );
    }


    /*
     * Polygon sides
     */
    if (sidesInput) {
      sidesInput.addEventListener(
        'input',
        event => {
          let value =
            parseInt(
              event.target.value,
              10
            );

          if (!Number.isFinite(value)) {
            value = 5;
          }

          value =
            Math.max(
              3,
              Math.min(
                12,
                value
              )
            );

          polygonSides = value;

          event.target.value =
            String(value);
        }
      );
    }


    /*
     * Canvas pointer events
     */
    if (canvas) {
      canvas.addEventListener(
        'pointerdown',
        startDrawing,
        {
          passive: false
        }
      );

      canvas.addEventListener(
        'pointermove',
        moveDrawing,
        {
          passive: false
        }
      );

      canvas.addEventListener(
        'pointerup',
        finishDrawing,
        {
          passive: false
        }
      );

      canvas.addEventListener(
        'pointercancel',
        finishDrawing,
        {
          passive: false
        }
      );

      canvas.addEventListener(
        'pointerleave',
        event => {
          /*
           * Do not finish drawing here.
           * This allows the user to move slightly
           * outside the canvas without losing the stroke.
           */
        }
      );
    }


    /*
     * Clicking the dark area around the modal closes it.
     */
    if (modal) {
      modal.addEventListener(
        'click',
        event => {
          if (
            event.target === modal
          ) {
            close();
          }
        }
      );
    }


    /*
     * Escape closes the drawing modal.
     */
    document.addEventListener(
      'keydown',
      event => {
        if (
          event.key === 'Escape' &&
          modal &&
          modal.style.display !== 'none'
        ) {
          close();
        }
      }
    );
  }


  /* =========================================================
     INITIALIZATION
  ========================================================= */

  function initialize() {
    if (initialized) return;

    /*
     * Find existing HTML.
     */
    modal =
      document.getElementById(
        'draw-together-modal'
      );

    openButton =
      document.getElementById(
        'open-draw-together'
      );

    closeButton =
      document.getElementById(
        'draw-close'
      );

    sendButton =
      document.getElementById(
        'draw-send'
      );

    canvas =
      document.getElementById(
        'draw-canvas'
      );

    undoButton =
      document.getElementById(
        'draw-undo'
      );

    clearButton =
      document.getElementById(
        'draw-clear'
      );

    newButton =
      document.getElementById(
        'draw-new'
      );

    colorInput =
      document.getElementById(
        'draw-color'
      );

    sizeInput =
      document.getElementById(
        'draw-size'
      );

    sizeValue =
      document.getElementById(
        'draw-size-value'
      );

    sidesInput =
      document.getElementById(
        'draw-sides'
      );

    toolButtons =
      Array.from(
        document.querySelectorAll(
          '#draw-toolbar .draw-tool'
        )
      );


    /*
     * Check required elements.
     */
    if (!modal) {
      warn(
        'Missing #draw-together-modal'
      );
      return;
    }

    if (!canvas) {
      warn(
        'Missing #draw-canvas'
      );
      return;
    }


    /*
     * Set initial values.
     */
    if (colorInput) {
      currentColor =
        colorInput.value ||
        '#111111';
    }

    if (sizeInput) {
      currentSize =
        parseInt(
          sizeInput.value,
          10
        ) || 4;
    }

    if (sidesInput) {
      polygonSides =
        parseInt(
          sidesInput.value,
          10
        ) || 5;
    }


    /*
     * Initialize canvas.
     */
    setupCanvas();

    /*
     * Bind controls.
     */
    bindUI();

    /*
     * Select brush.
     */
    selectTool('brush');

    initialized = true;

    log(
      'Draw Together initialized.'
    );
  }


  /* =========================================================
     PUBLIC API
  ========================================================= */

  window.drawTogether = {

    open,

    close,

    send: sendToPartner,

    undo,

    clear: clearDrawing,

    newDrawing,

    partnerDraw,

    createRandomPartnerDrawing,

    getActions: function () {
      return actions.slice();
    },

    setPartnerDrawChance: function (
      value
    ) {
      /*
       * This is informational for now.
       * The actual partner-response system should
       * decide when to call partnerDraw().
       */
      return Math.max(
        0,
        Math.min(
          1,
          Number(value) || 0
        )
      );
    },

    PARTNER_DRAW_CHANCE
  };


  /* =========================================================
     START
  ========================================================= */

  if (
    document.readyState ===
      'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      initialize,
      {
        once: true
      }
    );
  } else {
    initialize();
  }


  /*
   * Debug helper.
   */
  window.drawTogetherInit =
    initialize;

})();
