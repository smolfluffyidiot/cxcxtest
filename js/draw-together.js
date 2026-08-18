/* =========================================================
   Draw Together
   Uses the existing canvas modal in the HTML.

   Expected HTML IDs:

   #canvas-modal
   #drawing-canvas
   #canvas-toolbar
   #canvas-send-to-chat
   #canvas-save-close
   #canvas-new
   #canvas-undo
   #canvas-clear

   Existing chat function:

   addMessage(message)

   ========================================================= */

(function () {
    'use strict';

    console.log('[DrawTogether] Script loaded');

    // =====================================================
    // CONFIG
    // =====================================================

    const CANVAS_WIDTH = 800;
    const CANVAS_HEIGHT = 500;

    /*
     * Chance partner randomly sends a drawing after
     * a USER message.
     *
     * 0.05 = 5%
     */
    const PARTNER_DRAW_CHANCE = 0.05;

    const PARTNER_MIN_OBJECTS = 2;
    const PARTNER_MAX_OBJECTS = 8;

    // =====================================================
    // STATE
    // =====================================================

    let canvas = null;
    let ctx = null;

    let actions = [];

    let currentTool = 'brush';
    let currentColor = '#111111';
    let currentSize = 4;
    let polygonSides = 5;

    let isDrawing = false;
    let startPoint = null;
    let currentStroke = null;
    let preview = null;

    let initialized = false;

    // =====================================================
    // HELPERS
    // =====================================================

    function log() {
        console.log.apply(
            console,
            ['[DrawTogether]'].concat(
                Array.from(arguments)
            )
        );
    }

    function warn() {
        console.warn.apply(
            console,
            ['[DrawTogether]'].concat(
                Array.from(arguments)
            )
        );
    }

    function error() {
        console.error.apply(
            console,
            ['[DrawTogether]'].concat(
                Array.from(arguments)
            )
        );
    }

    function randomInt(min, max) {
        return Math.floor(
            Math.random() * (max - min + 1)
        ) + min;
    }

    function randomFloat(min, max) {
        return (
            Math.random() * (max - min)
        ) + min;
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

        return colors[
            randomInt(0, colors.length - 1)
        ];
    }

    // =====================================================
    // GET ELEMENTS
    // =====================================================

    function getElements() {

        canvas =
            document.getElementById(
                'drawing-canvas'
            );

        if (!canvas) {
            warn(
                '#drawing-canvas not found'
            );
            return false;
        }

        ctx =
            canvas.getContext('2d');

        if (!ctx) {
            error(
                'Could not get canvas context'
            );
            return false;
        }

        return true;
    }

    // =====================================================
    // CANVAS
    // =====================================================

    function setupCanvas() {

        if (!getElements()) {
            return false;
        }

        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        canvas.style.touchAction = 'none';

        redraw();

        return true;
    }

    function redraw() {

        if (!ctx) return;

        ctx.clearRect(
            0,
            0,
            CANVAS_WIDTH,
            CANVAS_HEIGHT
        );

        // White background
        ctx.save();

        ctx.fillStyle = '#ffffff';

        ctx.fillRect(
            0,
            0,
            CANVAS_WIDTH,
            CANVAS_HEIGHT
        );

        ctx.restore();

        // Draw saved actions
        for (
            let i = 0;
            i < actions.length;
            i++
        ) {
            renderAction(
                ctx,
                actions[i],
                false
            );
        }

        // Draw preview
        if (preview) {

            renderAction(
                ctx,
                preview,
                true
            );
        }
    }

    // =====================================================
    // RENDER ACTION
    // =====================================================

    function renderAction(
        context,
        action,
        isPreview
    ) {

        if (!action) return;

        context.save();

        context.lineCap = 'round';
        context.lineJoin = 'round';

        if (isPreview) {
            context.setLineDash([
                6,
                6
            ]);
        } else {
            context.setLineDash([]);
        }

        // -----------------------------------------------
        // STROKE
        // -----------------------------------------------

        if (action.type === 'stroke') {

            context.lineWidth =
                action.width || 4;

            if (
                action.mode ===
                'eraser'
            ) {

                context.globalCompositeOperation =
                    'destination-out';

            } else {

                context.globalCompositeOperation =
                    'source-over';

                context.strokeStyle =
                    action.color ||
                    '#111111';
            }

            const points =
                action.points || [];

            if (points.length > 0) {

                context.beginPath();

                context.moveTo(
                    points[0].x,
                    points[0].y
                );

                for (
                    let i = 1;
                    i < points.length;
                    i++
                ) {

                    context.lineTo(
                        points[i].x,
                        points[i].y
                    );
                }

                context.stroke();
            }
        }

        // -----------------------------------------------
        // LINE
        // -----------------------------------------------

        else if (
            action.type === 'line'
        ) {

            context.lineWidth =
                action.width || 4;

            context.strokeStyle =
                action.color ||
                '#111111';

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
        }

        // -----------------------------------------------
        // RECTANGLE
        // -----------------------------------------------

        else if (
            action.type === 'rect'
        ) {

            context.lineWidth =
                action.width || 4;

            context.strokeStyle =
                action.color ||
                '#111111';

            context.strokeRect(
                action.x,
                action.y,
                action.w,
                action.h
            );
        }

        // -----------------------------------------------
        // CIRCLE
        // -----------------------------------------------

        else if (
            action.type === 'circle'
        ) {

            context.lineWidth =
                action.width || 4;

            context.strokeStyle =
                action.color ||
                '#111111';

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

        // -----------------------------------------------
        // POLYGON
        // -----------------------------------------------

        else if (
            action.type === 'polygon'
        ) {

            const sides =
                Math.max(
                    3,
                    action.sides || 5
                );

            context.lineWidth =
                action.width || 4;

            context.strokeStyle =
                action.color ||
                '#111111';

            context.beginPath();

            for (
                let i = 0;
                i < sides;
                i++
            ) {

                const angle =
                    (action.rotation || 0) +
                    (
                        i / sides
                    ) *
                    Math.PI *
                    2;

                const x =
                    action.cx +
                    Math.cos(angle) *
                    action.r;

                const y =
                    action.cy +
                    Math.sin(angle) *
                    action.r;

                if (i === 0) {

                    context.moveTo(
                        x,
                        y
                    );

                } else {

                    context.lineTo(
                        x,
                        y
                    );
                }
            }

            context.closePath();

            context.stroke();
        }

        context.restore();
    }

    // =====================================================
    // COORDINATES
    // =====================================================

    function getCanvasPoint(event) {

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

            clientX =
                event.clientX;

            clientY =
                event.clientY;
        }

        return {

            x:
                (
                    clientX -
                    rect.left
                ) *
                (
                    CANVAS_WIDTH /
                    rect.width
                ),

            y:
                (
                    clientY -
                    rect.top
                ) *
                (
                    CANVAS_HEIGHT /
                    rect.height
                )
        };
    }

    // =====================================================
    // DRAWING EVENTS
    // =====================================================

    function pointerDown(event) {

        if (!canvas) return;

        event.preventDefault();

        try {
            canvas.setPointerCapture(
                event.pointerId
            );
        } catch (e) {}

        const point =
            getCanvasPoint(event);

        isDrawing = true;

        startPoint = point;

        preview = null;

        // Brush / Eraser
        if (
            currentTool === 'brush' ||
            currentTool === 'eraser'
        ) {

            currentStroke = {

                type: 'stroke',

                mode:
                    currentTool ===
                    'eraser'
                        ? 'eraser'
                        : 'brush',

                color:
                    currentColor,

                width:
                    currentSize,

                points: [
                    point
                ]
            };

            actions.push(
                currentStroke
            );

            redraw();
        }
    }

    function pointerMove(event) {

        if (!isDrawing) return;

        event.preventDefault();

        const point =
            getCanvasPoint(event);

        // Brush
        if (
            currentTool === 'brush' ||
            currentTool === 'eraser'
        ) {

            if (currentStroke) {

                currentStroke.points.push(
                    point
                );
            }

            redraw();

            return;
        }

        // Line
        if (
            currentTool === 'line'
        ) {

            preview = {

                type: 'line',

                x1:
                    startPoint.x,

                y1:
                    startPoint.y,

                x2:
                    point.x,

                y2:
                    point.y,

                color:
                    currentColor,

                width:
                    currentSize
            };
        }

        // Rectangle
        else if (
            currentTool === 'rect'
        ) {

            preview = {

                type: 'rect',

                x:
                    Math.min(
                        startPoint.x,
                        point.x
                    ),

                y:
                    Math.min(
                        startPoint.y,
                        point.y
                    ),

                w:
                    Math.abs(
                        point.x -
                        startPoint.x
                    ),

                h:
                    Math.abs(
                        point.y -
                        startPoint.y
                    ),

                color:
                    currentColor,

                width:
                    currentSize
            };
        }

        // Circle
        else if (
            currentTool === 'circle'
        ) {

            const dx =
                point.x -
                startPoint.x;

            const dy =
                point.y -
                startPoint.y;

            preview = {

                type: 'circle',

                cx:
                    startPoint.x,

                cy:
                    startPoint.y,

                r:
                    Math.sqrt(
                        dx * dx +
                        dy * dy
                    ),

                color:
                    currentColor,

                width:
                    currentSize
            };
        }

        // Polygon
        else if (
            currentTool === 'polygon'
        ) {

            const dx =
                point.x -
                startPoint.x;

            const dy =
                point.y -
                startPoint.y;

            preview = {

                type: 'polygon',

                cx:
                    startPoint.x,

                cy:
                    startPoint.y,

                r:
                    Math.sqrt(
                        dx * dx +
                        dy * dy
                    ),

                sides:
                    polygonSides,

                rotation:
                    0,

                color:
                    currentColor,

                width:
                    currentSize
            };
        }

        redraw();
    }

    function pointerUp(event) {

        if (!isDrawing) return;

        event.preventDefault();

        const point =
            getCanvasPoint(event);

        isDrawing = false;

        // Brush / Eraser
        if (
            currentTool === 'brush' ||
            currentTool === 'eraser'
        ) {

            currentStroke = null;
        }

        // Line
        else if (
            currentTool === 'line'
        ) {

            actions.push({

                type: 'line',

                x1:
                    startPoint.x,

                y1:
                    startPoint.y,

                x2:
                    point.x,

                y2:
                    point.y,

                color:
                    currentColor,

                width:
                    currentSize
            });
        }

        // Rectangle
        else if (
            currentTool === 'rect'
        ) {

            actions.push({

                type: 'rect',

                x:
                    Math.min(
                        startPoint.x,
                        point.x
                    ),

                y:
                    Math.min(
                        startPoint.y,
                        point.y
                    ),

                w:
                    Math.abs(
                        point.x -
                        startPoint.x
                    ),

                h:
                    Math.abs(
                        point.y -
                        startPoint.y
                    ),

                color:
                    currentColor,

                width:
                    currentSize
            });
        }

        // Circle
        else if (
            currentTool === 'circle'
        ) {

            const dx =
                point.x -
                startPoint.x;

            const dy =
                point.y -
                startPoint.y;

            actions.push({

                type: 'circle',

                cx:
                    startPoint.x,

                cy:
                    startPoint.y,

                r:
                    Math.sqrt(
                        dx * dx +
                        dy * dy
                    ),

                color:
                    currentColor,

                width:
                    currentSize
            });
        }

        // Polygon
        else if (
            currentTool === 'polygon'
        ) {

            const dx =
                point.x -
                startPoint.x;

            const dy =
                point.y -
                startPoint.y;

            actions.push({

                type: 'polygon',

                cx:
                    startPoint.x,

                cy:
                    startPoint.y,

                r:
                    Math.sqrt(
                        dx * dx +
                        dy * dy
                    ),

                sides:
                    polygonSides,

                rotation:
                    0,

                color:
                    currentColor,

                width:
                    currentSize
            });
        }

        preview = null;
        startPoint = null;

        redraw();
    }

    // =====================================================
    // SETUP CANVAS EVENTS
    // =====================================================

    function setupCanvasEvents() {

        if (!canvas) return;

        if (
            canvas.dataset.drawTogetherEvents ===
            'true'
        ) {
            return;
        }

        canvas.dataset.drawTogetherEvents =
            'true';

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

        window.addEventListener(
            'pointercancel',
            pointerUp
        );
    }

    // =====================================================
    // UNDO
    // =====================================================

    function undoDrawing() {

        if (!actions.length) {
            return;
        }

        actions.pop();

        redraw();
    }

    // =====================================================
    // CLEAR
    // =====================================================

    function clearDrawing() {

        actions = [];

        currentStroke = null;

        preview = null;

        redraw();
    }

    // =====================================================
    // CREATE PNG
    // =====================================================

    function createImageFromActions(
        drawingActions
    ) {

        const offscreen =
            document.createElement(
                'canvas'
            );

        offscreen.width =
            CANVAS_WIDTH;

        offscreen.height =
            CANVAS_HEIGHT;

        const offCtx =
            offscreen.getContext('2d');

        // White background
        offCtx.fillStyle =
            '#ffffff';

        offCtx.fillRect(
            0,
            0,
            CANVAS_WIDTH,
            CANVAS_HEIGHT
        );

        for (
            let i = 0;
            i < drawingActions.length;
            i++
        ) {

            renderAction(
                offCtx,
                drawingActions[i],
                false
            );
        }

        return offscreen.toDataURL(
            'image/png'
        );
    }

    // =====================================================
    // SEND DRAWING
    // =====================================================

    function sendDrawingToChat() {

        console.log(
            '[DrawTogether] Sending drawing message:'
        );

        try {

            if (
                !actions ||
                !actions.length
            ) {

                alert(
                    'Draw something first!'
                );

                return;
            }

            const drawingData =
                JSON.parse(
                    JSON.stringify(
                        actions
                    )
                );

            const image =
                createImageFromActions(
                    drawingData
                );

            const message = {

                id:
                    Date.now(),

                sender:
                    'user',

                text:
                    '',

                timestamp:
                    new Date(),

                image:
                    image,

                drawingData:
                    drawingData,

                status:
                    'sent',

                type:
                    'drawing'
            };

            console.log(
                '[DrawTogether] Message object:',
                message
            );

            // ---------------------------------------------
            // EXISTING CHAT SYSTEM
            // ---------------------------------------------

            if (
                typeof window.addMessage ===
                'function'
            ) {

                console.log(
                    '[DrawTogether] Calling addMessage()'
                );

                window.addMessage(
                    message
                );

            } else {

                console.warn(
                    '[DrawTogether] addMessage() does not exist. Using fallback.'
                );

                window.messages =
                    window.messages ||
                    [];

                window.messages.push(
                    message
                );

                if (
                    typeof window.renderMessages ===
                    'function'
                ) {

                    window.renderMessages();

                } else {

                    console.warn(
                        '[DrawTogether] renderMessages() also does not exist.'
                    );
                }
            }

            console.log(
                '[DrawTogether] Drawing sent successfully.'
            );

            closeModal();

        } catch (err) {

            console.error(
                '[DrawTogether] Send drawing failed:',
                err
            );

            alert(
                'Failed to send drawing. Check the console.'
            );
        }
    }

    // =====================================================
    // OPEN / CLOSE MODAL
    // =====================================================

    function openModal() {

        const modal =
            document.getElementById(
                'canvas-modal'
            );

        if (!modal) {

            error(
                '#canvas-modal not found'
            );

            return;
        }

        if (!setupCanvas()) {
            return;
        }

        setupCanvasEvents();

        setupToolbar();

        modal.style.display =
            'flex';

        modal.style.visibility =
            'visible';

        modal.style.opacity =
            '1';

        /*
         * Your modal already has z-index:2200,
         * so don't create another overlay.
         */
        modal.style.zIndex =
            '2200';

        redraw();

        log(
            'Modal opened'
        );
    }

    function closeModal() {

        const modal =
            document.getElementById(
                'canvas-modal'
            );

        if (!modal) return;

        modal.style.display =
            'none';

        log(
            'Modal closed'
        );
    }

    // =====================================================
    // TOOLBAR
    // =====================================================

    function setupToolbar() {

        const toolbar =
            document.getElementById(
                'canvas-toolbar'
            );

        if (!toolbar) {

            warn(
                '#canvas-toolbar not found'
            );

            return;
        }

        /*
         * Only build toolbar once.
         */
        if (
            toolbar.dataset.drawTogetherReady ===
            'true'
        ) {

            return;
        }

        toolbar.dataset.drawTogetherReady =
            'true';

        toolbar.innerHTML = `

            <div
                style="
                    display:grid;
                    grid-template-columns:
                        repeat(3, minmax(0,1fr));
                    gap:6px;
                    margin-bottom:10px;
                "
            >

                <button
                    type="button"
                    class="dt-tool"
                    data-tool="brush"
                >
                    🖌 Brush
                </button>

                <button
                    type="button"
                    class="dt-tool"
                    data-tool="eraser"
                >
                    🧽 Eraser
                </button>

                <button
                    type="button"
                    class="dt-tool"
                    data-tool="line"
                >
                    ╱ Line
                </button>

                <button
                    type="button"
                    class="dt-tool"
                    data-tool="rect"
                >
                    □ Rect
                </button>

                <button
                    type="button"
                    class="dt-tool"
                    data-tool="circle"
                >
                    ○ Circle
                </button>

                <button
                    type="button"
                    class="dt-tool"
                    data-tool="polygon"
                >
                    ⬡ Polygon
                </button>

            </div>

            <div
                style="
                    display:flex;
                    gap:10px;
                    align-items:center;
                    flex-wrap:wrap;
                "
            >

                <label
                    style="
                        display:flex;
                        align-items:center;
                        gap:5px;
                    "
                >
                    Color

                    <input
                        id="dt-color"
                        type="color"
                        value="#111111"
                    >
                </label>

                <label
                    style="
                        flex:1;
                        min-width:120px;
                    "
                >
                    Size

                    <input
                        id="dt-size"
                        type="range"
                        min="1"
                        max="40"
                        value="4"
                        style="width:100%;"
                    >
                </label>

            </div>

            <div
                style="
                    display:flex;
                    gap:8px;
                    align-items:center;
                    margin-top:8px;
                "
            >

                <label>
                    Polygon sides
                </label>

                <input
                    id="dt-poly-sides"
                    type="number"
                    min="3"
                    max="12"
                    value="5"
                    style="width:60px;"
                >

            </div>

        `;

        // ---------------------------------------------
        // Tool buttons
        // ---------------------------------------------

        const toolButtons =
            toolbar.querySelectorAll(
                '.dt-tool'
            );

        toolButtons.forEach(
            function (button) {

                button.addEventListener(
                    'click',
                    function () {

                        toolButtons.forEach(
                            function (b) {
                                b.classList.remove(
                                    'active'
                                );
                            }
                        );

                        button.classList.add(
                            'active'
                        );

                        currentTool =
                            button.dataset.tool;

                        log(
                            'Tool:',
                            currentTool
                        );
                    }
                );
            }
        );

        // Brush default
        const brush =
            toolbar.querySelector(
                '[data-tool="brush"]'
            );

        if (brush) {
            brush.classList.add(
                'active'
            );
        }

        // ---------------------------------------------
        // Color
        // ---------------------------------------------

        const colorInput =
            document.getElementById(
                'dt-color'
            );

        if (colorInput) {

            colorInput.addEventListener(
                'input',
                function (event) {

                    currentColor =
                        event.target.value;
                }
            );
        }

        // ---------------------------------------------
        // Size
        // ---------------------------------------------

        const sizeInput =
            document.getElementById(
                'dt-size'
            );

        if (sizeInput) {

            sizeInput.addEventListener(
                'input',
                function (event) {

                    currentSize =
                        parseInt(
                            event.target.value,
                            10
                        ) || 4;
                }
            );
        }

        // ---------------------------------------------
        // Polygon sides
        // ---------------------------------------------

        const sidesInput =
            document.getElementById(
                'dt-poly-sides'
            );

        if (sidesInput) {

            sidesInput.addEventListener(
                'input',
                function (event) {

                    polygonSides =
                        Math.max(
                            3,
                            Math.min(
                                12,
                                parseInt(
                                    event.target.value,
                                    10
                                ) || 5
                            )
                        );
                }
            );
        }
    }

    // =====================================================
    // BUTTON EVENTS
    // =====================================================

    function setupButtons() {

        // ---------------------------------------------
        // Send
        // ---------------------------------------------

        if (
            !window.__drawTogetherSendHandler
        ) {

            window.__drawTogetherSendHandler =
                true;

            document.addEventListener(
                'click',
                function (event) {

                    const button =
                        event.target.closest(
                            '#canvas-send-to-chat'
                        );

                    if (!button) {
                        return;
                    }

                    console.log(
                        '[DrawTogether] Send to Chat button clicked'
                    );

                    event.preventDefault();

                    event.stopPropagation();

                    sendDrawingToChat();

                },
                true
            );
        }

        // ---------------------------------------------
        // Close
        // ---------------------------------------------

        if (
            !window.__drawTogetherCloseHandler
        ) {

            window.__drawTogetherCloseHandler =
                true;

            document.addEventListener(
                'click',
                function (event) {

                    const button =
                        event.target.closest(
                            '#canvas-save-close'
                        );

                    if (!button) {
                        return;
                    }

                    event.preventDefault();

                    closeModal();

                },
                true
            );
        }

        // ---------------------------------------------
        // Undo
        // ---------------------------------------------

        if (
            !window.__drawTogetherUndoHandler
        ) {

            window.__drawTogetherUndoHandler =
                true;

            document.addEventListener(
                'click',
                function (event) {

                    const button =
                        event.target.closest(
                            '#canvas-undo'
                        );

                    if (!button) {
                        return;
                    }

                    event.preventDefault();

                    undoDrawing();

                },
                true
            );
        }

        // ---------------------------------------------
        // Clear
        // ---------------------------------------------

        if (
            !window.__drawTogetherClearHandler
        ) {

            window.__drawTogetherClearHandler =
                true;

            document.addEventListener(
                'click',
                function (event) {

                    const button =
                        event.target.closest(
                            '#canvas-clear'
                        );

                    if (!button) {
                        return;
                    }

                    event.preventDefault();

                    if (
                        confirm(
                            'Clear canvas?'
                        )
                    ) {

                        clearDrawing();
                    }

                },
                true
            );
        }

        // ---------------------------------------------
        // New
        // ---------------------------------------------

        if (
            !window.__drawTogetherNewHandler
        ) {

            window.__drawTogetherNewHandler =
                true;

            document.addEventListener(
                'click',
                function (event) {

                    const button =
                        event.target.closest(
                            '#canvas-new'
                        );

                    if (!button) {
                        return;
                    }

                    event.preventDefault();

                    if (
                        confirm(
                            'New canvas?'
                        )
                    ) {

                        clearDrawing();
                    }

                },
                true
            );
        }
    }

    // =====================================================
    // PARTNER RANDOM DRAWING
    // =====================================================

    function generatePartnerDrawing() {

        const result = [];

        const count =
            randomInt(
                PARTNER_MIN_OBJECTS,
                PARTNER_MAX_OBJECTS
            );

        for (
            let i = 0;
            i < count;
            i++
        ) {

            const type =
                randomInt(1, 5);

            // -------------------------------------------
            // Brush
            // -------------------------------------------

            if (type === 1) {

                let x =
                    randomFloat(
                        40,
                        CANVAS_WIDTH - 40
                    );

                let y =
                    randomFloat(
                        40,
                        CANVAS_HEIGHT - 40
                    );

                const points = [];

                const count =
                    randomInt(4, 15);

                for (
                    let j = 0;
                    j < count;
                    j++
                ) {

                    x += randomFloat(
                        -40,
                        40
                    );

                    y += randomFloat(
                        -40,
                        40
                    );

                    x =
                        Math.max(
                            10,
                            Math.min(
                                CANVAS_WIDTH - 10,
                                x
                            )
                        );

                    y =
                        Math.max(
                            10,
                            Math.min(
                                CANVAS_HEIGHT - 10,
                                y
                            )
                        );

                    points.push({
                        x: x,
                        y: y
                    });
                }

                result.push({

                    type:
                        'stroke',

                    mode:
                        'brush',

                    color:
                        randomColor(),

                    width:
                        randomInt(2, 8),

                    points:
                        points
                });
            }

            // -------------------------------------------
            // Line
            // -------------------------------------------

            else if (type === 2) {

                result.push({

                    type:
                        'line',

                    x1:
                        randomFloat(
                            20,
                            CANVAS_WIDTH - 20
                        ),

                    y1:
                        randomFloat(
                            20,
                            CANVAS_HEIGHT - 20
                        ),

                    x2:
                        randomFloat(
                            20,
                            CANVAS_WIDTH - 20
                        ),

                    y2:
                        randomFloat(
                            20,
                            CANVAS_HEIGHT - 20
                        ),

                    color:
                        randomColor(),

                    width:
                        randomInt(2, 6)
                });
            }

            // -------------------------------------------
            // Circle
            // -------------------------------------------

            else if (type === 3) {

                result.push({

                    type:
                        'circle',

                    cx:
                        randomFloat(
                            50,
                            CANVAS_WIDTH - 50
                        ),

                    cy:
                        randomFloat(
                            50,
                            CANVAS_HEIGHT - 50
                        ),

                    r:
                        randomFloat(
                            15,
                            100
                        ),

                    color:
                        randomColor(),

                    width:
                        randomInt(2, 6)
                });
            }

            // -------------------------------------------
            // Rectangle
            // -------------------------------------------

            else if (type === 4) {

                result.push({

                    type:
                        'rect',

                    x:
                        randomFloat(
                            20,
                            CANVAS_WIDTH - 180
                        ),

                    y:
                        randomFloat(
                            20,
                            CANVAS_HEIGHT - 180
                        ),

                    w:
                        randomFloat(
                            30,
                            150
                        ),

                    h:
                        randomFloat(
                            30,
                            150
                        ),

                    color:
                        randomColor(),

                    width:
                        randomInt(2, 6)
                });
            }

            // -------------------------------------------
            // Polygon
            // -------------------------------------------

            else {

                result.push({

                    type:
                        'polygon',

                    cx:
                        randomFloat(
                            60,
                            CANVAS_WIDTH - 60
                        ),

                    cy:
                        randomFloat(
                            60,
                            CANVAS_HEIGHT - 60
                        ),

                    r:
                        randomFloat(
                            20,
                            100
                        ),

                    sides:
                        randomInt(3, 7),

                    rotation:
                        randomFloat(
                            0,
                            Math.PI * 2
                        ),

                    color:
                        randomColor(),

                    width:
                        randomInt(2, 6)
                });
            }
        }

        return result;
    }

    function sendPartnerDrawing() {

        try {

            const drawingData =
                generatePartnerDrawing();

            const image =
                createImageFromActions(
                    drawingData
                );

            const message = {

                id:
                    Date.now(),

                sender:
                    'partner',

                text:
                    '',

                timestamp:
                    new Date(),

                image:
                    image,

                drawingData:
                    drawingData,

                status:
                    'sent',

                type:
                    'drawing'
            };

            console.log(
                '[DrawTogether] Partner drawing:',
                message
            );

            if (
                typeof window.addMessage ===
                'function'
            ) {

                window.addMessage(
                    message
                );

            } else {

                window.messages =
                    window.messages ||
                    [];

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

        } catch (err) {

            error(
                'Partner drawing failed:',
                err
            );
        }
    }

    /*
     * Call this after a USER message is sent.
     *
     * 5% chance.
     */
    function maybePartnerDraw() {

        const roll =
            Math.random();

        log(
            'Partner drawing roll:',
            roll,
            'chance:',
            PARTNER_DRAW_CHANCE
        );

        if (
            roll >
            PARTNER_DRAW_CHANCE
        ) {

            return;
        }

        const delay =
            randomInt(
                1500,
                5000
            );

        log(
            'Partner decided to draw. Delay:',
            delay
        );

        setTimeout(
            function () {

                sendPartnerDrawing();

            },
            delay
        );
    }

    // =====================================================
    // PUBLIC API
    // =====================================================

    window.drawTogether = {

        open:
            function () {

                initialize();

                openModal();
            },

        close:
            function () {

                closeModal();
            },

        undo:
            function () {

                undoDrawing();
            },

        clear:
            function () {

                clearDrawing();
            },

        sendDrawing:
            function () {

                sendDrawingToChat();
            },

        maybePartnerDraw:
            function () {

                maybePartnerDraw();
            },

        getActions:
            function () {

                return actions;
            }
    };

    // =====================================================
    // INITIALIZE
    // =====================================================

    function initialize() {

        if (initialized) {
            return;
        }

        initialized = true;

        log(
            'Initializing...'
        );

        setupButtons();

        setupToolbar();

        if (
            getElements()
        ) {

            setupCanvasEvents();
        }

        log(
            'Initialization complete'
        );
    }

    // =====================================================
    // DOM READY
    // =====================================================

    function start() {

        initialize();

        log(
            'Draw Together ready'
        );
    }

    if (
        document.readyState ===
        'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            start,
            {
                once: true
            }
        );

    } else {

        start();
    }

})();
