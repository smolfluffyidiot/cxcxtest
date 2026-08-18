/* js/draw-together.js
   Draw Together
   - Opens from #open-draw-together
   - Uses a proper modal
   - Canvas on top
   - Tools underneath
   - Mobile friendly
   - Does NOT create a floating launcher
   - Sending drawing to chat works
   - Partner has a small chance to randomly send a drawing
*/

(function () {
    'use strict';

    const W = 800;
    const H = 500;

    // Chance that partner sends a drawing when ANY message is sent.
    // 0.08 = 8%
    const PARTNER_DRAW_CHANCE = 1;

    let actions = [];
    let undoStack = [];

    let canvas = null;
    let ctx = null;

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
        let modal = document.getElementById('dt-drawing-modal');

        if (modal) return modal;

        const style = document.createElement('style');
        style.id = 'dt-drawing-style';

        style.textContent = `
            #dt-drawing-modal {
                position: fixed !important;
                inset: 0 !important;
                z-index: 999999 !important;

                display: none;
                align-items: center;
                justify-content: center;

                background: rgba(0,0,0,0.55) !important;

                /* IMPORTANT:
                   Do not use backdrop-filter here.
                   Your app's blur system may otherwise interfere.
                */
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            #dt-drawing-modal.dt-open {
                display: flex !important;
            }

            #dt-drawing-window {
                position: relative !important;
                z-index: 1000000 !important;

                width: min(920px, calc(100vw - 24px));
                max-height: calc(100vh - 24px);

                background: var(--secondary-bg, #ffffff);
                color: var(--text-primary, #111111);

                border-radius: 14px;
                overflow: hidden;

                box-shadow:
                    0 25px 80px rgba(0,0,0,.45);

                display: flex;
                flex-direction: column;
            }

            #dt-drawing-header {
                flex-shrink: 0;

                display: flex;
                align-items: center;
                gap: 10px;

                padding: 12px 14px;

                border-bottom:
                    1px solid
                    var(--border-color, rgba(0,0,0,.1));
            }

            #dt-drawing-header-title {
                font-weight: 600;
            }

            #dt-drawing-header-buttons {
                margin-left: auto;
                display: flex;
                gap: 8px;
            }

            #dt-drawing-body {
                padding: 12px;

                overflow-y: auto;

                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            #dt-canvas-container {
                width: 100%;

                background: var(--primary-bg, #f5f5f5);

                padding: 8px;
                border-radius: 10px;

                display: flex;
                justify-content: center;
                align-items: center;
            }

            #dt-canvas {
                display: block;

                width: 100%;
                max-width: 800px;
                height: auto;

                background: white;

                border-radius: 7px;

                touch-action: none;

                box-shadow:
                    0 5px 20px rgba(0,0,0,.08);
            }

            /* TOOLBOX */

            #dt-toolbox {
                width: 100%;

                display: flex;
                flex-direction: column;
                gap: 10px;

                padding: 10px;

                border-radius: 10px;

                background:
                    var(--primary-bg, #f5f5f5);
            }

            .dt-tool-row {
                display: flex;
                gap: 7px;
                flex-wrap: wrap;
                align-items: center;
            }

            .dt-tool {
                border: none;
                border-radius: 8px;

                padding: 8px 11px;

                background: var(--secondary-bg, #fff);
                color: var(--text-primary, #111);

                cursor: pointer;

                font-size: 13px;
            }

            .dt-tool:hover {
                filter: brightness(.95);
            }

            .dt-tool.active {
                background: var(--accent-color, #ff7a6b);
                color: white;
            }

            #dt-color {
                width: 42px;
                height: 36px;
                padding: 2px;

                border: none;
                background: transparent;

                cursor: pointer;
            }

            #dt-size {
                flex: 1;
                min-width: 120px;
            }

            #dt-poly-sides {
                width: 60px;
            }

            .dt-bottom-row {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                flex-wrap: wrap;
            }

            .dt-action {
                border: none;
                border-radius: 8px;

                padding: 9px 14px;

                cursor: pointer;

                background: var(--primary-bg, #eee);
                color: var(--text-primary, #111);
            }

            .dt-action.primary {
                background: var(--accent-color, #ff7a6b);
                color: white;
            }

            @media (max-width: 600px) {

                #dt-drawing-window {
                    width: calc(100vw - 12px);
                    max-height: calc(100vh - 12px);

                    border-radius: 12px;
                }

                #dt-drawing-body {
                    padding: 8px;
                }

                #dt-canvas-container {
                    padding: 5px;
                }

                #dt-toolbox {
                    padding: 8px;
                }

                .dt-tool {
                    padding: 7px 9px;
                    font-size: 12px;
                }

                #dt-drawing-header {
                    padding: 10px;
                }
            }
        `;

        document.head.appendChild(style);

        modal = document.createElement('div');
        modal.id = 'dt-drawing-modal';

        modal.innerHTML = `
            <div id="dt-drawing-window">

                <div id="dt-drawing-header">

                    <div id="dt-drawing-header-title">
                        Draw Together · 画布
                    </div>

                    <div id="dt-drawing-header-buttons">

                        <button
                            type="button"
                            class="dt-action primary"
                            id="dt-send">
                            Send to Chat
                        </button>

                        <button
                            type="button"
                            class="dt-action"
                            id="dt-close">
                            Close
                        </button>

                    </div>

                </div>


                <div id="dt-drawing-body">

                    <!-- CANVAS FIRST -->

                    <div id="dt-canvas-container">
                        <canvas
                            id="dt-canvas"
                            width="800"
                            height="500">
                        </canvas>
                    </div>


                    <!-- TOOLBOX UNDER CANVAS -->

                    <div id="dt-toolbox">

                        <div class="dt-tool-row">

                            <button class="dt-tool active"
                                    data-tool="brush">
                                Brush
                            </button>

                            <button class="dt-tool"
                                    data-tool="eraser">
                                Eraser
                            </button>

                            <button class="dt-tool"
                                    data-tool="line">
                                Line
                            </button>

                            <button class="dt-tool"
                                    data-tool="rect">
                                Rectangle
                            </button>

                            <button class="dt-tool"
                                    data-tool="circle">
                                Circle
                            </button>

                            <button class="dt-tool"
                                    data-tool="polygon">
                                Polygon
                            </button>

                        </div>


                        <div class="dt-tool-row">

                            <label>
                                Color
                            </label>

                            <input
                                type="color"
                                id="dt-color"
                                value="#111111">

                            <label>
                                Size
                            </label>

                            <input
                                type="range"
                                id="dt-size"
                                min="1"
                                max="64"
                                value="4">

                            <label>
                                Sides
                            </label>

                            <input
                                type="number"
                                id="dt-poly-sides"
                                min="3"
                                max="12"
                                value="5">

                        </div>


                        <div class="dt-bottom-row">

                            <button
                                class="dt-action"
                                id="dt-undo">
                                Undo
                            </button>

                            <button
                                class="dt-action"
                                id="dt-clear">
                                Clear
                            </button>

                            <button
                                class="dt-action"
                                id="dt-new">
                                New
                            </button>

                        </div>

                    </div>

                </div>

            </div>
        `;

        document.body.appendChild(modal);

        return modal;
    }


    /* =========================================================
       CANVAS
    ========================================================= */

    function setupCanvas() {

        canvas = document.getElementById('dt-canvas');

        if (!canvas) return;

        ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
    }


    function redraw() {

        if (!ctx) return;

        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        actions.forEach(drawAction);
    }


    function drawAction(a) {

        if (!ctx || !a) return;

        ctx.save();

        if (a.type === 'stroke') {

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = a.width || 4;

            if (a.mode === 'eraser') {

                ctx.globalCompositeOperation =
                    'destination-out';

            } else {

                ctx.globalCompositeOperation =
                    'source-over';

                ctx.strokeStyle =
                    a.color || '#111';
            }

            ctx.beginPath();

            a.points.forEach((p, i) => {

                if (i === 0)
                    ctx.moveTo(p.x, p.y);
                else
                    ctx.lineTo(p.x, p.y);

            });

            ctx.stroke();

        }


        else if (a.type === 'line') {

            ctx.lineWidth = a.width;
            ctx.strokeStyle = a.color;

            ctx.beginPath();

            ctx.moveTo(a.x1, a.y1);
            ctx.lineTo(a.x2, a.y2);

            ctx.stroke();

        }


        else if (a.type === 'rect') {

            ctx.lineWidth = a.width;
            ctx.strokeStyle = a.color;

            ctx.strokeRect(
                a.x,
                a.y,
                a.w,
                a.h
            );

        }


        else if (a.type === 'circle') {

            ctx.lineWidth = a.width;
            ctx.strokeStyle = a.color;

            ctx.beginPath();

            ctx.arc(
                a.cx,
                a.cy,
                a.r,
                0,
                Math.PI * 2
            );

            ctx.stroke();

        }


        else if (a.type === 'polygon') {

            ctx.lineWidth = a.width;
            ctx.strokeStyle = a.color;

            ctx.beginPath();

            for (let i = 0; i < a.sides; i++) {

                const angle =
                    a.rotation +
                    (i / a.sides) * Math.PI * 2;

                const x =
                    a.cx +
                    Math.cos(angle) * a.r;

                const y =
                    a.cy +
                    Math.sin(angle) * a.r;

                if (i === 0)
                    ctx.moveTo(x, y);
                else
                    ctx.lineTo(x, y);
            }

            ctx.closePath();
            ctx.stroke();
        }

        ctx.restore();
    }


    function canvasPosition(e) {

        const rect =
            canvas.getBoundingClientRect();

        return {

            x:
                (e.clientX - rect.left) *
                (W / rect.width),

            y:
                (e.clientY - rect.top) *
                (H / rect.height)
        };
    }


    /* =========================================================
       DRAWING
    ========================================================= */

    function pointerDown(e) {

        e.preventDefault();

        canvas.setPointerCapture?.(e.pointerId);

        const p = canvasPosition(e);

        drawing = true;
        startPoint = p;

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

                points: [p]
            };

            actions.push(currentStroke);
        }
    }


    function pointerMove(e) {

        if (!drawing) return;

        e.preventDefault();

        const p = canvasPosition(e);

        if (
            currentTool === 'brush' ||
            currentTool === 'eraser'
        ) {

            currentStroke.points.push(p);

            redraw();

            return;
        }

        redraw();

        ctx.save();

        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = currentSize;

        if (currentTool === 'line') {

            ctx.beginPath();

            ctx.moveTo(
                startPoint.x,
                startPoint.y
            );

            ctx.lineTo(p.x, p.y);

            ctx.stroke();
        }

        else if (currentTool === 'rect') {

            ctx.strokeRect(
                startPoint.x,
                startPoint.y,
                p.x - startPoint.x,
                p.y - startPoint.y
            );
        }

        else if (currentTool === 'circle') {

            const dx =
                p.x - startPoint.x;

            const dy =
                p.y - startPoint.y;

            const r =
                Math.sqrt(dx * dx + dy * dy);

            ctx.beginPath();

            ctx.arc(
                startPoint.x,
                startPoint.y,
                r,
                0,
                Math.PI * 2
            );

            ctx.stroke();
        }

        else if (currentTool === 'polygon') {

            const dx =
                p.x - startPoint.x;

            const dy =
                p.y - startPoint.y;

            const r =
                Math.sqrt(dx * dx + dy * dy);

            ctx.beginPath();

            for (
                let i = 0;
                i < polygonSides;
                i++
            ) {

                const angle =
                    (i / polygonSides) *
                    Math.PI * 2;

                const x =
                    startPoint.x +
                    Math.cos(angle) * r;

                const y =
                    startPoint.y +
                    Math.sin(angle) * r;

                if (i === 0)
                    ctx.moveTo(x, y);
                else
                    ctx.lineTo(x, y);
            }

            ctx.closePath();
            ctx.stroke();
        }

        ctx.restore();
    }


    function pointerUp(e) {

        if (!drawing) return;

        drawing = false;

        const p = canvasPosition(e);

        if (
            currentTool === 'brush' ||
            currentTool === 'eraser'
        ) {

            currentStroke = null;

            undoStack = [];

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

                x: startPoint.x,
                y: startPoint.y,

                w: p.x - startPoint.x,
                h: p.y - startPoint.y,

                color: currentColor,
                width: currentSize
            });
        }


        else if (currentTool === 'circle') {

            const dx =
                p.x - startPoint.x;

            const dy =
                p.y - startPoint.y;

            const r =
                Math.sqrt(dx * dx + dy * dy);

            actions.push({

                type: 'circle',

                cx: startPoint.x,
                cy: startPoint.y,

                r,

                color: currentColor,
                width: currentSize
            });
        }


        else if (currentTool === 'polygon') {

            const dx =
                p.x - startPoint.x;

            const dy =
                p.y - startPoint.y;

            const r =
                Math.sqrt(dx * dx + dy * dy);

            actions.push({

                type: 'polygon',

                cx: startPoint.x,
                cy: startPoint.y,

                r,

                sides: polygonSides,

                rotation: 0,

                color: currentColor,
                width: currentSize
            });
        }

        undoStack = [];

        redraw();
    }


    /* =========================================================
       OPEN / CLOSE
    ========================================================= */

    function openModal() {

        const modal = createModal();

        setupCanvas();

        modal.classList.add('dt-open');

        document.body.classList.add('dt-drawing-open');

        redraw();
    }


    function closeModal() {

        const modal =
            document.getElementById(
                'dt-drawing-modal'
            );

        if (modal)
            modal.classList.remove('dt-open');

        document.body.classList.remove(
            'dt-drawing-open'
        );
    }


    /* =========================================================
       SEND DRAWING
    ========================================================= */

    function sendDrawingToChat() {

        if (!canvas) return;

        const image =
            canvas.toDataURL('image/png');

        const message = {

            id: Date.now(),

            sender: 'user',

            text: '',

            image: image,

            drawingData:
                JSON.parse(
                    JSON.stringify(actions)
                ),

            timestamp: new Date(),

            status: 'sent',

            type: 'drawing'
        };


        // Your existing chat system

        if (typeof window.addMessage === 'function') {

            try {

                window.addMessage(message);

            } catch (e) {

                console.error(
                    '[DrawTogether] addMessage failed:',
                    e
                );
            }

        }

        else {

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


        closeModal();
    }


    /* =========================================================
       PARTNER DRAWING
    ========================================================= */

    function randomPartnerDrawing() {

        const result = [];

        const count =
            3 + Math.floor(Math.random() * 7);

        for (let i = 0; i < count; i++) {

            const type =
                ['circle', 'line', 'rect', 'polygon'][
                    Math.floor(
                        Math.random() * 4
                    )
                ];


            if (type === 'circle') {

                result.push({

                    type: 'circle',

                    cx: 50 + Math.random() * 700,

                    cy: 50 + Math.random() * 400,

                    r: 15 + Math.random() * 70,

                    color:
                        `hsl(${Math.random() * 360},70%,45%)`,

                    width:
                        2 + Math.random() * 5
                });
            }


            else if (type === 'line') {

                result.push({

                    type: 'line',

                    x1: Math.random() * W,
                    y1: Math.random() * H,

                    x2: Math.random() * W,
                    y2: Math.random() * H,

                    color:
                        `hsl(${Math.random() * 360},70%,45%)`,

                    width:
                        2 + Math.random() * 5
                });
            }


            else if (type === 'rect') {

                result.push({

                    type: 'rect',

                    x: Math.random() * 650,

                    y: Math.random() * 350,

                    w: 30 + Math.random() * 120,

                    h: 30 + Math.random() * 120,

                    color:
                        `hsl(${Math.random() * 360},70%,45%)`,

                    width:
                        2 + Math.random() * 5
                });
            }


            else {

                result.push({

                    type: 'polygon',

                    cx: 50 + Math.random() * 700,

                    cy: 50 + Math.random() * 400,

                    r: 20 + Math.random() * 60,

                    sides:
                        3 + Math.floor(
                            Math.random() * 5
                        ),

                    rotation:
                        Math.random() * Math.PI * 2,

                    color:
                        `hsl(${Math.random() * 360},70%,45%)`,

                    width:
                        2 + Math.random() * 5
                });
            }
        }

        return result;
    }


    function partnerSendDrawing() {

        const acts =
            randomPartnerDrawing();

        const off =
            document.createElement('canvas');

        off.width = W;
        off.height = H;

        const c =
            off.getContext('2d');

        c.fillStyle = '#fff';
        c.fillRect(0, 0, W, H);


        acts.forEach(a => {

            c.save();

            c.lineWidth =
                a.width || 3;

            c.strokeStyle =
                a.color || '#111';


            if (a.type === 'circle') {

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


            else if (a.type === 'line') {

                c.beginPath();

                c.moveTo(a.x1, a.y1);
                c.lineTo(a.x2, a.y2);

                c.stroke();
            }


            else if (a.type === 'rect') {

                c.strokeRect(
                    a.x,
                    a.y,
                    a.w,
                    a.h
                );
            }


            else if (a.type === 'polygon') {

                c.beginPath();

                for (
                    let i = 0;
                    i < a.sides;
                    i++
                ) {

                    const angle =
                        a.rotation +
                        (i / a.sides) *
                        Math.PI * 2;

                    const x =
                        a.cx +
                        Math.cos(angle) * a.r;

                    const y =
                        a.cy +
                        Math.sin(angle) * a.r;

                    if (i === 0)
                        c.moveTo(x, y);
                    else
                        c.lineTo(x, y);
                }

                c.closePath();
                c.stroke();
            }

            c.restore();
        });


        const message = {

            id: Date.now(),

            sender: 'partner',

            text: '',

            image:
                off.toDataURL('image/png'),

            drawingData: acts,

            timestamp: new Date(),

            status: 'sent',

            type: 'drawing'
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
    }


    /* =========================================================
       CONNECT TO EXISTING CHAT
    ========================================================= */

    function setupPartnerChance() {

        /*
         * We DON'T make the partner respond specifically
         * because you sent a drawing.
         *
         * Instead, this can be called by your normal
         * message system whenever the USER sends a message.
         *
         * For now we expose the function globally so your
         * existing chat code can call:
         *
         * window.drawTogetherPartnerChance();
         */

        window.drawTogetherPartnerChance =
            function () {

                if (
                    Math.random() >
                    PARTNER_DRAW_CHANCE
                ) {
                    return;
                }

                const delay =
                    1000 +
                    Math.random() * 4000;

                setTimeout(
                    partnerSendDrawing,
                    delay
                );
            };
    }


    /* =========================================================
       UI
    ========================================================= */

    function setupUI() {

        createModal();

        const canvasElement =
            document.getElementById(
                'dt-canvas'
            );

        canvasElement.addEventListener(
            'pointerdown',
            pointerDown
        );

        canvasElement.addEventListener(
            'pointermove',
            pointerMove
        );

        canvasElement.addEventListener(
            'pointerup',
            pointerUp
        );

        canvasElement.addEventListener(
            'pointercancel',
            pointerUp
        );


        document
            .querySelectorAll(
                '#dt-toolbox [data-tool]'
            )
            .forEach(button => {

                button.addEventListener(
                    'click',
                    function () {

                        document
                            .querySelectorAll(
                                '#dt-toolbox [data-tool]'
                            )
                            .forEach(b =>
                                b.classList.remove(
                                    'active'
                                )
                            );

                        this.classList.add(
                            'active'
                        );

                        currentTool =
                            this.dataset.tool;
                    }
                );
            });


        document
            .getElementById('dt-color')
            .addEventListener(
                'input',
                e => {
                    currentColor =
                        e.target.value;
                }
            );


        document
            .getElementById('dt-size')
            .addEventListener(
                'input',
                e => {
                    currentSize =
                        Number(e.target.value);
                }
            );


        document
            .getElementById('dt-poly-sides')
            .addEventListener(
                'input',
                e => {

                    polygonSides =
                        Math.max(
                            3,
                            Math.min(
                                12,
                                Number(
                                    e.target.value
                                ) || 5
                            )
                        );
                }
            );


        document
            .getElementById('dt-close')
            .addEventListener(
                'click',
                closeModal
            );


        document
            .getElementById('dt-send')
            .addEventListener(
                'click',
                sendDrawingToChat
            );


        document
            .getElementById('dt-clear')
            .addEventListener(
                'click',
                function () {

                    actions = [];

                    undoStack = [];

                    redraw();
                }
            );


        document
            .getElementById('dt-new')
            .addEventListener(
                'click',
                function () {

                    actions = [];

                    undoStack = [];

                    redraw();
                }
            );


        document
            .getElementById('dt-undo')
            .addEventListener(
                'click',
                function () {

                    if (!actions.length)
                        return;

                    undoStack.push(
                        actions.pop()
                    );

                    redraw();
                }
            );


        /*
         * Clicking the dark area closes the modal.
         */

        document
            .getElementById('dt-drawing-modal')
            .addEventListener(
                'click',
                function (e) {

                    if (
                        e.target ===
                        this
                    ) {
                        closeModal();
                    }
                }
            );


        /*
         * IMPORTANT:
         * Connect your existing "画布" button.
         */

        const openButton =
            document.getElementById(
                'open-draw-together'
            );

        if (openButton) {

            openButton.onclick =
                function (e) {

                    e.preventDefault();
                    e.stopPropagation();

                    openModal();

                    return false;
                };
        }
    }


    /* =========================================================
       START
    ========================================================= */

    function init() {

        setupUI();

        setupPartnerChance();

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


    /* Public API */

    window.drawTogether = {

        open: openModal,

        close: closeModal,

        newCanvas: function () {

            actions = [];

            undoStack = [];

            openModal();

            return {
                id: Date.now()
            };
        },

        partnerDraw:
            partnerSendDrawing,

        partnerChance:
            function () {

                window.drawTogetherPartnerChance();
            }
    };

})();
