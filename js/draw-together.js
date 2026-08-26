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
     * 1 = 100% (for testing)
     * 0.05 = 5% (production)
     */
    const PARTNER_DRAW_CHANCE = 1;

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
// CUSTOM COLOR PICKER
// =====================================================

let pickerHue = 0;
let pickerSaturation = 1;
let pickerBrightness = 1;

function hsvToRgb(h, s, v) {

    const c = v * s;
    const x =
        c *
        (1 - Math.abs(
            (h / 60) % 2 - 1
        ));

    const m = v - c;

    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) {
        r = c;
        g = x;
    }
    else if (h < 120) {
        r = x;
        g = c;
    }
    else if (h < 180) {
        g = c;
        b = x;
    }
    else if (h < 240) {
        g = x;
        b = c;
    }
    else if (h < 300) {
        r = x;
        b = c;
    }
    else {
        r = c;
        b = x;
    }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}


function rgbToHex(r, g, b) {

    return '#' +
        [r, g, b]
            .map(function (value) {

                return value
                    .toString(16)
                    .padStart(2, '0');

            })
            .join('');
}


function updateColorPicker() {

    const rgb =
        hsvToRgb(
            pickerHue,
            pickerSaturation,
            pickerBrightness
        );

    currentColor =
        rgbToHex(
            rgb.r,
            rgb.g,
            rgb.b
        );

    const swatch =
        document.getElementById(
            'dt-color-swatch'
        );

    const preview =
        document.getElementById(
            'dt-picker-preview'
        );

    const hex =
        document.getElementById(
            'dt-picker-hex'
        );

    if (swatch) {
        swatch.style.background =
            currentColor;
    }

    if (preview) {
        preview.style.background =
            currentColor;
    }

    if (hex) {
        hex.textContent =
            currentColor;
    }

    // Move saturation cursor

    const saturation =
        document.getElementById(
            'dt-saturation'
        );

    const colorCursor =
        document.getElementById(
            'dt-color-cursor'
        );

    if (
        saturation &&
        colorCursor
    ) {

        colorCursor.style.left =
            (pickerSaturation * 100) + '%';

        colorCursor.style.top =
            ((1 - pickerBrightness) * 100) + '%';
    }


    // Move hue cursor

    const hue =
        document.getElementById(
            'dt-hue'
        );

    const hueCursor =
        document.getElementById(
            'dt-hue-cursor'
        );

    if (
        hue &&
        hueCursor
    ) {

        hueCursor.style.left =
            ((pickerHue / 360) * 100) + '%';
    }


    // RGB fields

    const red =
        document.getElementById(
            'dt-red'
        );

    const green =
        document.getElementById(
            'dt-green'
        );

    const blue =
        document.getElementById(
            'dt-blue'
        );

    if (red) {
        red.value = rgb.r;
    }

    if (green) {
        green.value = rgb.g;
    }

    if (blue) {
        blue.value = rgb.b;
    }


    // Update saturation color

    if (saturation) {

        saturation.style.background =
            'linear-gradient(to bottom, transparent, #000), ' +
            'linear-gradient(to right, #fff, hsl(' +
            pickerHue +
            ', 100%, 50%))';
    }
}


function setColorFromRGB(r, g, b) {

    r = Math.max(
        0,
        Math.min(255, r)
    );

    g = Math.max(
        0,
        Math.min(255, g)
    );

    b = Math.max(
        0,
        Math.min(255, b)
    );

    const max =
        Math.max(r, g, b) / 255;

    const min =
        Math.min(r, g, b) / 255;

    const delta =
        max - min;

    let h = 0;

    if (delta !== 0) {

        if (max === r / 255) {

            h =
                60 *
                (
                    (
                        ((g - b) / 255) /
                        delta
                    ) % 6
                );

        }
        else if (max === g / 255) {

            h =
                60 *
                (
                    ((b - r) / 255) /
                    delta +
                    2
                );

        }
        else {

            h =
                60 *
                (
                    ((r - g) / 255) /
                    delta +
                    4
                );
        }
    }

    if (h < 0) {
        h += 360;
    }

    const s =
        max === 0
            ? 0
            : delta / max;

    pickerHue = h;
    pickerSaturation = s;
    pickerBrightness = max;

    updateColorPicker();
}


function setupCustomColorPicker() {

    const button =
        document.getElementById(
            'dt-color-button'
        );

    const picker =
        document.getElementById(
            'dt-color-picker'
        );

    const saturation =
        document.getElementById(
            'dt-saturation'
        );

    const hue =
        document.getElementById(
            'dt-hue'
        );

    if (
        !button ||
        !picker ||
        !saturation ||
        !hue
    ) {
        return;
    }


    // -----------------------------------------------
    // Open / close
    // -----------------------------------------------

    button.addEventListener(
        'click',
        function (event) {

            event.stopPropagation();

            picker.classList.toggle(
                'open'
            );

        }
    );


    // Close when clicking outside

    document.addEventListener(
        'click',
        function (event) {

            if (
                !picker.contains(event.target) &&
                !button.contains(event.target)
            ) {

                picker.classList.remove(
                    'open'
                );
            }
        }
    );


    // -----------------------------------------------
    // Saturation / brightness
    // -----------------------------------------------

    function updateSaturation(event) {

        const rect =
            saturation.getBoundingClientRect();

        const x =
            Math.max(
                0,
                Math.min(
                    rect.width,
                    event.clientX - rect.left
                )
            );

        const y =
            Math.max(
                0,
                Math.min(
                    rect.height,
                    event.clientY - rect.top
                )
            );

        pickerSaturation =
            x / rect.width;

        pickerBrightness =
            1 - (y / rect.height);

        updateColorPicker();
    }


    saturation.addEventListener(
        'pointerdown',
        function (event) {

            event.preventDefault();

            saturation.setPointerCapture(
                event.pointerId
            );

            updateSaturation(event);
        }
    );

    saturation.addEventListener(
        'pointermove',
        function (event) {

            if (
                event.buttons
            ) {
                updateSaturation(event);
            }
        }
    );


    // -----------------------------------------------
    // Hue
    // -----------------------------------------------

    function updateHue(event) {

        const rect =
            hue.getBoundingClientRect();

        const x =
            Math.max(
                0,
                Math.min(
                    rect.width,
                    event.clientX - rect.left
                )
            );

        pickerHue =
            (x / rect.width) * 360;

        updateColorPicker();
    }


    hue.addEventListener(
        'pointerdown',
        function (event) {

            event.preventDefault();

            hue.setPointerCapture(
                event.pointerId
            );

            updateHue(event);
        }
    );

    hue.addEventListener(
        'pointermove',
        function (event) {

            if (
                event.buttons
            ) {
                updateHue(event);
            }
        }
    );


    // -----------------------------------------------
    // RGB inputs
    // -----------------------------------------------

    const red =
        document.getElementById(
            'dt-red'
        );

    const green =
        document.getElementById(
            'dt-green'
        );

    const blue =
        document.getElementById(
            'dt-blue'
        );


    function updateFromRGBInputs() {

        const r =
            Math.max(
                0,
                Math.min(
                    255,
                    parseInt(red.value, 10) || 0
                )
            );

        const g =
            Math.max(
                0,
                Math.min(
                    255,
                    parseInt(green.value, 10) || 0
                )
            );

        const b =
            Math.max(
                0,
                Math.min(
                    255,
                    parseInt(blue.value, 10) || 0
                )
            );

        setColorFromRGB(
            r,
            g,
            b
        );
    }


    if (red) {
        red.addEventListener(
            'input',
            updateFromRGBInputs
        );
    }

    if (green) {
        green.addEventListener(
            'input',
            updateFromRGBInputs
        );
    }

    if (blue) {
        blue.addEventListener(
            'input',
            updateFromRGBInputs
        );
    }


    // Initial color

    setColorFromRGB(
        17,
        17,
        17
    );
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

            context.globalCompositeOperation =
                'source-over';

            context.strokeStyle =
                action.color ||
                '#111111';

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

                mode: 'brush',
                
                color:
                currentTool === 'eraser'
                    ? '#ffffff'
                    : currentColor,

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
                    'normal'
            };
    
            console.log(
                '[DrawTogether] Message object:',
                message
            );
    
            // Make sure addMessage is accessible
            if (
                typeof window.addMessage !==
                'function'
            ) {
    
                console.warn(
                    '[DrawTogether] addMessage() does not exist.'
                );
    
                return;
            }
    
            console.log(
                '[DrawTogether] Calling addMessage()'
            );
    
            // Send first
            window.addMessage(
                message
            );
    
            console.log(
                '[DrawTogether] Drawing sent successfully.'
            );
    
            // =============================================
            // CLEAR EVERYTHING AFTER SUCCESSFUL SEND
            // =============================================
    
            actions = [];
    
            currentStroke = null;
    
            preview = null;
    
            startPoint = null;
    
            isDrawing = false;
    
            redraw();
    
            console.log(
                '[DrawTogether] Canvas cleared.'
            );
    
            // Close modal
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
   
        const modal = document.getElementById('canvas-modal');
   
        if (!modal) {
            error('#canvas-modal not found');
            return;
        }
   
        if (!setupCanvas()) {
            return;
        }
   
        setupCanvasEvents();
        setupToolbar();
   
        // Open the existing modal directly
        modal.style.display = 'flex';
        modal.style.visibility = 'visible';
        modal.style.opacity = '1';
   
        // Keep it above all other UI
        modal.style.zIndex = '999999';
   
        // Prevent modal itself from creating/receiving blur
        modal.style.filter = 'none';
        modal.style.backdropFilter = 'none';
        modal.style.webkitBackdropFilter = 'none';
        modal.style.transform = 'none';
   
        const content = modal.querySelector('.modal-content');
   
        if (content) {
            content.style.filter = 'none';
            content.style.backdropFilter = 'none';
            content.style.webkitBackdropFilter = 'none';
            content.style.transform = 'none';
            content.style.opacity = '1';
        }
   
        redraw();
   
        log('Modal opened');
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
                    class="dt-tool modal-btn"
                    data-tool="brush"
                >
                    画笔
                </button>

                <button
                    type="button"
                    class="dt-tool modal-btn"
                    data-tool="eraser"
                >
                    橡皮擦
                </button>

                <button
                    type="button"
                    class="dt-tool modal-btn"
                    data-tool="line"
                >
                    直线
                </button>

                <button
                    type="button"
                    class="dt-tool modal-btn"
                    data-tool="rect"
                >
                    方形
                </button>

                <button
                    type="button"
                    class="dt-tool modal-btn"
                    data-tool="circle"
                >
                    圆形
                </button>

                <button
                    type="button"
                    class="dt-tool modal-btn"
                    data-tool="polygon"
                >
                    多边形
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

                <div class="dt-color-wrapper">

    <button
        type="button"
        id="dt-color-button"
        class="dt-color-button"
        aria-label="Choose color"
    >
        <span id="dt-color-swatch"></span>
    </button>

    <span class="dt-color-label">
        颜色
    </span>

    <div
        id="dt-color-picker"
        class="dt-color-picker"
    >

        <!-- Saturation / brightness -->
        <div
            id="dt-saturation"
            class="dt-saturation"
        >
            <div
                id="dt-color-cursor"
                class="dt-color-cursor"
            ></div>
        </div>

        <!-- Hue -->
        <div
            id="dt-hue"
            class="dt-hue"
        >
            <div
                id="dt-hue-cursor"
                class="dt-hue-cursor"
            ></div>
        </div>

        <!-- Current color -->
        <div class="dt-picker-preview-row">

            <div
                id="dt-picker-preview"
                class="dt-picker-preview"
            ></div>

            <span id="dt-picker-hex">
                #111111
            </span>

        </div>

        <!-- RGB -->
        <div class="dt-rgb-row">

            <label>
                R
                <input
                    id="dt-red"
                    type="number"
                    min="0"
                    max="255"
                    value="17"
                >
            </label>

            <label>
                G
                <input
                    id="dt-green"
                    type="number"
                    min="0"
                    max="255"
                    value="17"
                >
            </label>

            <label>
                B
                <input
                    id="dt-blue"
                    type="number"
                    min="0"
                    max="255"
                    value="17"
                >
            </label>

        </div>

    </div>

</div>


                <label
                    style="
                        flex:1;
                        min-width:120px;
                        font-family: inherit;
                    "
                >
                    大小

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

                <label style="font-family: inherit;">
                    边数
                </label>

                <input
                    id="dt-poly-sides"
                    type="number"
                    min="3"
                    max="12"
                    value="5"
                    style="width:60px;"
                    hidden
                >

                <div class="draw-sides-buttons">

                    <button
                      type="button"
                      class="modal-btn draw-side-btn"
                      data-sides="3"
                    >
                      3
                    </button>
                
                    <button
                      type="button"
                      class="modal-btn draw-side-btn"
                      data-sides="4"
                    >
                      4
                    </button>
                
                    <button
                      type="button"
                      class="modal-btn draw-side-btn active"
                      data-sides="5"
                    >
                      5
                    </button>
                
                    <button
                      type="button"
                      class="modal-btn draw-side-btn"
                      data-sides="6"
                    >
                      6
                    </button>
                
                    <button
                      type="button"
                      class="modal-btn draw-side-btn"
                      data-sides="7"
                    >
                      7
                    </button>
                
                    <button
                      type="button"
                      class="modal-btn draw-side-btn"
                      data-sides="8"
                    >
                      8
                    </button>
                
                  </div>

            </div>

        `;

        // Tool buttons
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

        // Color
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

        // Size
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

        // Polygon sides
        const sidesInput =
            document.getElementById(
                'dt-poly-sides'
            );
        const sideButtons =
    toolbar.querySelectorAll(
        '.draw-side-btn'
    );

sideButtons.forEach(
    function (button) {

        button.addEventListener(
            'click',
            function () {

                const sides =
                    parseInt(
                        button.dataset.sides,
                        10
                    ) || 5;

                // Keep the existing input updated
                if (sidesInput) {
                    sidesInput.value = sides;
                }

                // Update polygon setting
                polygonSides = sides;

                // Update active button
                sideButtons.forEach(
                    function (b) {
                        b.classList.remove(
                            'active'
                        );
                    }
                );

                button.classList.add(
                    'active'
                );

            }
        );
    }
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
        setupCustomColorPicker();

    }

    // =====================================================
    // BUTTON EVENTS
    // =====================================================

    function setupButtons() {

        // SEND BUTTON
        if (!window.__drawTogetherSendHandler) {
       
            window.__drawTogetherSendHandler = true;
       
            document.addEventListener(
                'click',
                function (event) {
       
                    const button = event.target.closest(
                        '#draw-send, #canvas-send-to-chat'
                    );
       
                    if (!button) {
                        return;
                    }
       
                    event.preventDefault();
                    event.stopImmediatePropagation();
       
                    console.log(
                        '[DrawTogether] SEND BUTTON CLICKED'
                    );
       
                    // Make the existing chat function available
                    if (typeof addMessage === 'function') {
                        window.addMessage = addMessage;
                    }
       
                    sendDrawingToChat();
       
                },
                true
            );
        }

        // Close
        if (!window.__drawTogetherCloseHandler) {

            window.__drawTogetherCloseHandler = true;

            document.addEventListener(
                'click',
                function (event) {

                    const button =
                        event.target.closest('#draw-close');

                    if (!button) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    console.log(
                        '[DrawTogether] Close button clicked'
                    );

                    closeModal();

                },
                true
            );
        }

        // Undo
        if (!window.__drawTogetherUndoHandler) {

            window.__drawTogetherUndoHandler = true;

            document.addEventListener(
                'click',
                function (event) {

                    const button =
                        event.target.closest('#draw-undo');

                    if (!button) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    undoDrawing();

                },
                true
            );
        }

        // Clear
        if (!window.__drawTogetherClearHandler) {

            window.__drawTogetherClearHandler = true;

            document.addEventListener(
                'click',
                function (event) {

                    const button =
                        event.target.closest('#draw-clear');

                    if (!button) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    if (confirm('Clear canvas?')) {
                        clearDrawing();
                    }

                },
                true
            );
        }

        // New
        if (!window.__drawTogetherNewHandler) {

            window.__drawTogetherNewHandler = true;

            document.addEventListener(
                'click',
                function (event) {

                    const button =
                        event.target.closest('#draw-new');

                    if (!button) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    if (confirm('New canvas?')) {
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

            // Brush
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

            // Line
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

            // Circle
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

            // Rectangle
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

            // Polygon
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
                    'received',

                favorited:
                    false,

                note:
                    null,

                type:
                    'normal'
            };

            console.log(
                '[DrawTogether] Partner drawing message created:',
                message
            );

            // Direct check - addMessage should ALWAYS be available by this point
            // Try multiple ways to access addMessage
            const addMessageFunc = 
                (typeof window.addMessage === 'function') ? window.addMessage :
                (typeof addMessage === 'function') ? addMessage :
                null;
            
            if (addMessageFunc) {
            
                console.log(
                    '[DrawTogether] Adding partner drawing to chat'
                );
            
                addMessageFunc(message);
                console.log(
                    '[DrawTogether] ✓ Partner drawing sent!'
                );

            } else {

                error(
                    '✗ window.addMessage is NOT available! Cannot send partner drawing.'
                );

                console.log('[DrawTogether] Available window functions:', Object.keys(window).filter(k => k.includes('add') || k.includes('Message')));
            }

        } catch (err) {

            error(
                'Partner drawing failed:',
                err
            );
            console.error(err.stack);
        }
    }

    /*
     * Call this after a USER message is sent.
     *
     * 1 = 100% (for testing)
     * 0.05 = 5% (production)
     */
    function maybePartnerDraw() {

        const roll =
            Math.random();

        log(
            '🎲 Partner drawing roll:',
            roll.toFixed(3),
            '| Threshold:',
            PARTNER_DRAW_CHANCE
        );

        if (
            roll >
            PARTNER_DRAW_CHANCE
        ) {

            log(
                '❌ Roll failed. Partner will not draw this time.'
            );

            return;
        }

        const delay =
            randomInt(
                1500,
                5000
            );

        log(
            '✅ Roll succeeded! Partner will draw in',
            delay,
            'ms'
        );

        setTimeout(
            function () {

                log(
                    '⏱️ Delay complete. Sending partner drawing now...'
                );

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
            '✅ Draw Together ready!'
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
