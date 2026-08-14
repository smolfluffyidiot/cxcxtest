(function(){
    // partner-card-prompt.js
    // Fixes:
    // - Avoid prompting on page refresh by waiting until messages stabilize, marking existing items processed.
    // - When user accepts, persist to partner wordcards AND attempt to sync into common reply libraries (best-effort),
    //   and emit an event `partnerCardAdded` so host app can react.
    //
    // Drop this file in js/partner-card-prompt.js and load after your app scripts.

    var APP_PREFIX = window.APP_PREFIX || '';
    var STORAGE_KEY = APP_PREFIX + 'partner_wordcards_v1';
    var POPUP_ID = 'partner-add-card-popup-v3';
    var DEFAULT_CHANCE = 1;

    var state = { chance: DEFAULT_CHANCE, enabled: true, installed: false };

    var _processedIds = new Set();
    var _lastUserSent = null;
    var _installMark = Date.now();

    function log(){ try { console.debug('[PartnerCardPrompt]', ...arguments); } catch(e){} }
    function warn(){ try { console.warn('[PartnerCardPrompt]', ...arguments); } catch(e){} }
    function _escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _nowISO(){ return (new Date()).toISOString(); }

    // storage helpers (localforage preferred)
    async function _getStored(){ try{ if(window.localforage) { var v = await localforage.getItem(STORAGE_KEY); return Array.isArray(v)?v:[]; } else { var r = localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):[]; } }catch(e){ warn('read store fail', e); return []; } }
    async function _setStored(arr){ try{ if(window.localforage) await localforage.setItem(STORAGE_KEY, arr); else localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }catch(e){ warn('write store fail', e); } }

    async function addPartnerWordcard(text){
        if(!text || !String(text).trim()) return false;
        var arr = await _getStored();
        if(arr.some(function(c){ return c.text === text; })) return false;
        var item = { id: Date.now(), text: text, createdAt: _nowISO() };
        arr.unshift(item);
        await _setStored(arr);
        renderPartnerWordCards(arr);
        if(typeof showNotification === 'function') showNotification('已添加到对方字卡 ✓','success',1800);
        // Try to sync into host reply libraries (best-effort)
        trySyncToReplyLibraries(text);
        // Emit event so host can respond
        try { window.dispatchEvent(new CustomEvent('partnerCardAdded', { detail: { text: text, item: item } })); } catch(e){}
        return true;
    }

    function renderPartnerWordCards(list){
        if(!list){ _getStored().then(function(arr){ renderPartnerWordCards(arr); }).catch(function(){}); return; }
        var el = document.getElementById('partner-wordcards-list');
        if(!el) return;
        el.innerHTML = '';
        if(!list.length){
            el.innerHTML = '<div class="pw-empty" style="color:var(--text-secondary);font-size:13px;padding:8px;text-align:center;">对方字卡暂无内容</div>';
            return;
        }
        list.forEach(function(item){
            var row = document.createElement('div');
            row.className = 'pw-item';
            row.style.cssText = 'padding:8px 10px;border-radius:8px;margin-bottom:8px;background:var(--primary-bg);border:1px solid var(--border-color);display:flex;align-items:flex-start;gap:8px;';
            row.innerHTML = '<div style="flex:1;font-size:13px;color:var(--text-primary);line-height:1.45;word-break:break-word;">' + _escapeHtml(item.text) + '</div>'
                          + '<button title="删除" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:6px;font-size:14px;">✕</button>';
            var delBtn = row.querySelector('button');
            delBtn.addEventListener('click', async function(){
                if(!confirm('确认删除该字卡？')) return;
                var arr = await _getStored();
                var idx = arr.findIndex(function(x){ return x.id === item.id; });
                if(idx >= 0){
                    arr.splice(idx, 1);
                    await _setStored(arr);
                    renderPartnerWordCards(arr);
                    if(typeof showNotification === 'function') showNotification('已删除', 'info', 1200);
                }
            });
            el.appendChild(row);
        });
    }

    // Attempt to push the added card into likely reply libraries (best-effort, non-destructive)
    function trySyncToReplyLibraries(text){
        try{
            // Common arrays used by this project (best-effort)
            var candidates = [
                'replyLibrary','reply_library','replyLibraryData','customReplies','mainReplyLibrary','masterReplies'
            ];
            var pushed = false;
            candidates.forEach(function(name){
                try{
                    var v = window[name];
                    if(Array.isArray(v)){
                        // ensure we don't duplicate
                        if(!v.some(function(it){ return (typeof it === 'string' && it === text) || (it && it.text === text); })){
                            // push string if array of strings, else push object
                            if(typeof v[0] === 'string' || v.length === 0) v.push(text);
                            else v.push({ id: Date.now(), text: text });
                            pushed = true;
                            log('synced to', name);
                        }
                    }
                }catch(e){}
            });
            // Some apps persist via a saveData / throttledSaveData function — call if available
            if(pushed){
                if(typeof throttledSaveData === 'function') try{ throttledSaveData(); }catch(e){}
                else if(typeof saveData === 'function') try{ saveData(); }catch(e){}
            }
            // Also try to add to stickerLibrary if it's an array of image URLs? (not applicable here)
        }catch(e){ warn('syncToReplyLibraries failed', e); }
    }

    // find relevant user message prior to partnerMsg; fallback to last captured user-sent message
    function findRelevantUserMessage(partnerMsg){
        var msgs = Array.isArray(window.messages) ? window.messages : [];
        if(msgs && msgs.length){
            var idx = -1;
            if(partnerMsg && partnerMsg.id !== undefined) idx = msgs.findIndex(function(m){ return m.id === partnerMsg.id; });
            if(idx === -1 && partnerMsg && partnerMsg.timestamp){
                for(var i=0;i<msgs.length;i++){
                    if(String(msgs[i].timestamp) === String(partnerMsg.timestamp)){ idx = i; break; }
                }
            }
            var start = (idx > 0) ? idx - 1 : msgs.length - 1;
            for(var j = start; j >= 0; j--){
                var m = msgs[j];
                if(!m) continue;
                var isUser = (m.sender === 'user' || m.sender === 'me' || m.role === 'user');
                if(isUser && m.type !== 'system' && (m.text || m.image)) return m;
            }
            for(var k = msgs.length - 1; k >= 0; k--){
                var mm = msgs[k];
                var isUser2 = mm && (mm.sender === 'user' || mm.sender === 'me' || mm.role === 'user');
                if(isUser2 && mm.type !== 'system' && (mm.text || mm.image)) return mm;
            }
        }
        // fallback to last captured user-sent (may not yet be in messages)
        if(_lastUserSent && _lastUserSent.text) return _lastUserSent;
        return null;
    }

    function _shouldProcessMessage(m, initialBaseline){
        if(!m) return false;
        if(m.id !== undefined && _processedIds.has(m.id)) return false;
        // if message has timestamp and it's older than baseline timestamp, skip
        if(m.timestamp && initialBaseline && initialBaseline.lastTimestamp){
            var ts = (new Date(m.timestamp)).getTime();
            if(!isNaN(ts) && ts <= initialBaseline.lastTimestamp) return false;
        }
        return true;
    }

    function _markProcessed(m){
        if(!m) return;
        if(m.id !== undefined) _processedIds.add(m.id);
    }

    function showPartnerAddPopup(partnerMsg, candidateMsg){
        try{
            if(document.getElementById(POPUP_ID)) return;
            var candidateText = '';
            if(candidateMsg){
                if(candidateMsg.text) candidateText = candidateMsg.text;
                else if(candidateMsg.image) candidateText = '[图片] ' + (candidateMsg.note||'');
                else candidateText = String(candidateMsg.text || '');
            } else candidateText = '(无可用消息)';

            var overlay = document.createElement('div');
            overlay.id = POPUP_ID;
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);';
            overlay.innerHTML = '\n            <div style="width:min(480px,94vw);background:var(--secondary-bg);border-radius:14px;padding:16px;border:1px solid var(--border-color);box-shadow:0 30px 70px rgba(0,0,0,0.36);font-family:var(--font-family);">\n                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">\n                    <div style="width:44px;height:44px;border-radius:8px;background:linear-gradient(135deg,var(--accent-color),rgba(var(--accent-color-rgb),0.85));display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">\n                        <i class="fas fa-book"></i>\n                    </div>\n                    <div>\n                        <div style="font-weight:700;color:var(--text-primary);font-size:15px;">对方向你提议：把这条消息加入对方字卡？</div>\n                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">接受后该消息会被存为对方可用的字卡</div>\n                    </div>\n                </div>\n                <div style="padding:10px;border-radius:10px;background:var(--primary-bg);border:1px solid var(--border-color);color:var(--text-primary);font-size:13px;line-height:1.5;max-height:220px;overflow:auto;">' + _escapeHtml(candidateText) + '</div>\n                <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">\n                    <button id="' + POPUP_ID + '-reject" style="padding:9px 12px;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;">拒绝</button>\n                    <button id="' + POPUP_ID + '-accept" style="padding:9px 12px;border-radius:10px;border:none;background:var(--accent-color);color:#fff;cursor:pointer;font-weight:700;">接受并添加</button>\n                </div>\n            </div>\n        ';
            document.body.appendChild(overlay);

            function cleanup(){ var el = document.getElementById(POPUP_ID); if(el) el.remove(); }

            document.getElementById(POPUP_ID + '-reject').addEventListener('click', function(){ cleanup(); if(typeof showNotification === 'function') showNotification('已拒绝', 'info', 1200); });
            document.getElementById(POPUP_ID + '-accept').addEventListener('click', async function(){
                cleanup();
                if(!candidateText || candidateText === '(无可用消息)'){
                    if(typeof showNotification === 'function') showNotification('没有可用消息可添加', 'warning', 1800);
                    return;
                }
                await addPartnerWordcard(candidateText);
            });
            overlay.addEventListener('click', function(e){ if(e.target === overlay){ overlay.remove(); if(typeof showNotification === 'function') showNotification('已取消', 'info', 1000); } });
        }catch(e){ warn('show popup error', e); }
    }

    // core decision
    function maybePromptOnPartnerMessage(partnerMsg, initialBaseline){
        try{
            if(!state.enabled) return;
            if(!partnerMsg) return;
            if(partnerMsg.type === 'system') return;
            if(!_shouldProcessMessage(partnerMsg, initialBaseline)){ log('skip old/processed partnerMsg'); _markProcessed(partnerMsg); return; }
            var r = Math.random();
            log('maybePrompt chance', r, 'limit', state.chance);
            if(r > state.chance){ _markProcessed(partnerMsg); return; }
            var candidate = findRelevantUserMessage(partnerMsg);
            showPartnerAddPopup(partnerMsg, candidate);
            _markProcessed(partnerMsg);
        }catch(e){ warn('maybePrompt error', e); }
    }

    // Install helpers ----------------------------------------------------------

    // Patch addMessage to detect both partner and user messages (capture last user-sent quickly)
    function installAddMessageHook(initialBaseline){
        try{
            if(typeof window.addMessage === 'function' && !window.__pcp_addMessageHooked){
                var orig = window.addMessage;
                window.addMessage = function(msg){
                    try{ var res = orig.apply(this, arguments); }catch(e){ try{ orig(msg); }catch(ee){} }
                    try{
                        // capture user-sent messages
                        if(msg && (msg.sender === 'user' || msg.sender === 'me' || msg.role === 'user')){
                            _lastUserSent = { id: msg.id !== undefined ? msg.id : Date.now(), text: msg.text || '', timestamp: msg.timestamp || new Date().toISOString(), sender: 'user', type: msg.type || 'normal' };
                            log('captured lastUserSent from addMessage', _lastUserSent);
                        }
                        // detect partner-like and process (respect initialBaseline to avoid reload prompts)
                        if(msg && msg.sender && msg.sender !== 'user'){
                            if(_shouldProcessMessage(msg, initialBaseline)){
                                log('addMessage hook detected partner msg', msg);
                                maybePromptOnPartnerMessage(msg, initialBaseline);
                            } else {
                                log('addMessage ignored old/processed msg');
                                _markProcessed(msg);
                            }
                        }
                    }catch(e){}
                    return;
                };
                window.__pcp_addMessageHooked = true;
                log('installed addMessage hook');
            }
        }catch(e){ warn('addMessage hook install failed', e); }
    }

    // Wrap sendMessage to capture the user's message immediately (if app exposes it)
    function tryWrapSendMessage(){
        try{
            if(typeof window.sendMessage === 'function' && !window.__pcp_sendMessageWrapped){
                var origSend = window.sendMessage;
                window.sendMessage = function(){
                    try{
                        var a0 = arguments[0];
                        if(typeof a0 === 'string'){
                            _lastUserSent = { id: Date.now(), text: a0, timestamp: new Date().toISOString(), sender: 'user', type: 'normal' };
                        } else if(a0 && typeof a0 === 'object' && (a0.text || a0.message)){
                            var txt = a0.text || a0.message || '';
                            _lastUserSent = { id: a0.id !== undefined ? a0.id : Date.now(), text: txt, timestamp: a0.timestamp || new Date().toISOString(), sender: 'user', type: a0.type || 'normal' };
                        } else {
                            try{
                                var inp = document.getElementById('message-input') || document.querySelector('textarea, input');
                                if(inp && inp.value) _lastUserSent = { id: Date.now(), text: inp.value, timestamp: new Date().toISOString(), sender: 'user', type: 'normal' };
                            }catch(e){}
                        }
                        if(_lastUserSent) log('captured lastUserSent from sendMessage', _lastUserSent);
                    }catch(e){}
                    return origSend.apply(this, arguments);
                };
                window.__pcp_sendMessageWrapped = true;
                log('wrapped sendMessage to capture lastUserSent');
            }
        }catch(e){ warn('wrap sendMessage failed', e); }
    }

    // Poll fallback to detect appended messages; mark existing messages as processed first
    var _pollHandle = null;
    function startMessagesPoll(initialBaseline){
        try{
            if(_pollHandle) return;
            var lastLen = Array.isArray(window.messages)?window.messages.length:0;
            // mark existing ids as processed
            try{ if(Array.isArray(window.messages)){ window.messages.forEach(function(m){ if(m && m.id !== undefined) _processedIds.add(m.id); }); } }catch(e){}
            _pollHandle = setInterval(function(){
                try{
                    var arr = window.messages;
                    if(!Array.isArray(arr)) return;
                    if(arr.length > lastLen){
                        for(var i = lastLen; i < arr.length; i++){
                            var m = arr[i];
                            if(!m) continue;
                            // capture user messages added to messages array
                            if(m && (m.sender === 'user' || m.sender === 'me' || m.role === 'user')){
                                _lastUserSent = { id: m.id !== undefined ? m.id : Date.now(), text: m.text || '', timestamp: m.timestamp || new Date().toISOString(), sender: 'user', type: m.type || 'normal' };
                                log('captured lastUserSent from poll', _lastUserSent);
                            }
                            if(m && m.sender && m.sender !== 'user'){
                                if(_shouldProcessMessage(m, initialBaseline)){
                                    log('poll detected partner msg', m);
                                    maybePromptOnPartnerMessage(m, initialBaseline);
                                } else {
                                    log('poll ignored old/processed msg', m && (m.id || m.timestamp));
                                    _markProcessed(m);
                                }
                            }
                        }
                        lastLen = arr.length;
                    } else if(arr.length !== lastLen){
                        lastLen = arr.length;
                    }
                }catch(e){}
            }, 700);
            log('started messages poll');
        }catch(e){ warn('startMessagesPoll err', e); }
    }
    function stopMessagesPoll(){ if(_pollHandle){ clearInterval(_pollHandle); _pollHandle=null; log('stopped messages poll'); } }

    // DOM observer fallback: tries to detect new message DOM nodes and capture user messages
    var _observer = null;
    function startDOMObserver(initialBaseline){
        try{
            if(_observer) return;
            var selectors = ['#messages','.messages','.message-list','.messages-list','.chat-list','#chat-messages','.conversation'];
            var container = null;
            for(var s of selectors){ var el = document.querySelector(s); if(el){ container = el; log('found message container via', s); break; } }
            if(!container){
                var candidates = Array.from(document.querySelectorAll('div'));
                for(var c of candidates){ try{ if(c.querySelector && c.querySelector('.message-wrapper, .message')){ container = c; log('found message container by scanning'); break; } }catch(e){} }
            }
            if(!container){ log('no message container found for DOM observer'); return; }
            _observer = new MutationObserver(function(muts){
                muts.forEach(function(mu){
                    mu.addedNodes && mu.addedNodes.forEach(function(node){
                        try{
                            if(!node) return;
                            if(node.nodeType !== 1) return;
                            var sender = node.getAttribute && (node.getAttribute('data-sender') || node.getAttribute('data-from') || node.getAttribute('data-message-sender'));
                            if(!sender){
                                if(node.classList && (node.classList.contains('message-wrapper')||node.classList.contains('message'))){
                                    var text = node.innerText || '';
                                    var isPartner = !(node.classList.contains('me') || node.classList.contains('from-me') || node.className.indexOf('user') !== -1);
                                    if(isPartner){
                                        var synthetic = { id: Date.now(), text: text, timestamp: new Date().toISOString(), type:'normal', sender: 'partner' };
                                        if(_shouldProcessMessage(synthetic, initialBaseline)){
                                            log('DOM observer sees new partner-like node');
                                            maybePromptOnPartnerMessage(synthetic, initialBaseline);
                                        } else _markProcessed(synthetic);
                                    } else {
                                        _lastUserSent = { id: Date.now(), text: text, timestamp: new Date().toISOString(), sender: 'user', type: 'normal' };
                                        log('captured lastUserSent from DOM node', _lastUserSent);
                                    }
                                    return;
                                }
                            } else {
                                if(sender !== 'user' && sender !== 'me'){
                                    var synthetic2 = { id: Date.now(), text: node.innerText||'', timestamp: new Date().toISOString(), type:'normal', sender: sender };
                                    if(_shouldProcessMessage(synthetic2, initialBaseline)) maybePromptOnPartnerMessage(synthetic2, initialBaseline);
                                    else _markProcessed(synthetic2);
                                } else {
                                    _lastUserSent = { id: Date.now(), text: node.innerText||'', timestamp: new Date().toISOString(), sender: 'user', type: 'normal' };
                                    log('captured lastUserSent from DOM explicit sender', _lastUserSent);
                                }
                            }
                        }catch(e){}
                    });
                });
            });
            _observer.observe(container, { childList:true, subtree:true });
            log('started DOM MutationObserver');
        }catch(e){ warn('startDOMObserver err', e); }
    }
    function stopDOMObserver(){ try{ if(_observer){ _observer.disconnect(); _observer=null; log('stopped DOM observer'); } }catch(e){} }

    // Wait until window.messages stabilizes (length unchanged for a short period), then install hooks using baseline snapshot.
    function waitForMessagesStableAndInstall(){
        var tries = 0;
        var maxTries = 18;
        var lastLen = Array.isArray(window.messages) ? window.messages.length : 0;
        var lastTimestamp = 0;
        if(Array.isArray(window.messages) && window.messages.length){
            var lastMsg = window.messages[window.messages.length - 1];
            if(lastMsg && lastMsg.timestamp) lastTimestamp = (new Date(lastMsg.timestamp)).getTime() || 0;
            // mark existing ids so we don't prompt for them
            window.messages.forEach(function(m){ if(m && m.id !== undefined) _processedIds.add(m.id); });
        }
        var stableCount = 0;
        var iv = setInterval(function(){
            tries++;
            var curLen = Array.isArray(window.messages) ? window.messages.length : 0;
            var curLastTs = 0;
            if(Array.isArray(window.messages) && window.messages.length){
                var msg = window.messages[window.messages.length - 1];
                if(msg && msg.timestamp) curLastTs = (new Date(msg.timestamp)).getTime() || 0;
            }
            if(curLen === lastLen && curLastTs === lastTimestamp){
                stableCount++;
            } else {
                stableCount = 0;
                lastLen = curLen;
                lastTimestamp = curLastTs;
            }
            // consider stable when unchanged for 3 consecutive ticks (~900ms)
            if(stableCount >= 3 || tries >= maxTries){
                clearInterval(iv);
                var baseline = { lastLen: lastLen, lastTimestamp: lastTimestamp };
                log('messages baseline established', baseline);
                installAllHooks(baseline);
            }
        }, 300);
    }

    // central installer (uses baseline to avoid re-prompting on reload)
    function installAllHooks(initialBaseline){
        if(state.installed) return;
        state.installed = true;
        log('installAllHooks start', initialBaseline);
        installAddMessageHook(initialBaseline);
        tryWrapSendMessage();
        startMessagesPoll(initialBaseline);
        startDOMObserver(initialBaseline);
        document.addEventListener('DOMContentLoaded', function(){ renderPartnerWordCards(); });
        // render once now if container exists
        setTimeout(renderPartnerWordCards, 500);
        log('installAllHooks done');
    }

    // small wrappers reused
    function installAddMessageHook(initialBaseline){
        try{
            if(typeof window.addMessage === 'function' && !window.__pcp_addMessageHooked){
                var orig = window.addMessage;
                window.addMessage = function(msg){
                    try{ var res = orig.apply(this, arguments); }catch(e){ try{ orig(msg); }catch(ee){} }
                    try{
                        if(msg && (msg.sender === 'user' || msg.sender === 'me' || msg.role === 'user')){
                            _lastUserSent = { id: msg.id !== undefined ? msg.id : Date.now(), text: msg.text || '', timestamp: msg.timestamp || new Date().toISOString(), sender: 'user', type: msg.type || 'normal' };
                            log('captured lastUserSent from addMessage', _lastUserSent);
                        }
                        if(msg && msg.sender && msg.sender !== 'user'){
                            if(_shouldProcessMessage(msg, initialBaseline)){
                                log('addMessage hook detected partner msg', msg);
                                maybePromptOnPartnerMessage(msg, initialBaseline);
                            } else {
                                _markProcessed(msg);
                            }
                        }
                    }catch(e){}
                    return;
                };
                window.__pcp_addMessageHooked = true;
                log('installed addMessage hook');
            }
        }catch(e){ warn('addMessage hook install failed', e); }
    }

    function tryWrapSendMessage(){
        try{
            if(typeof window.sendMessage === 'function' && !window.__pcp_sendMessageWrapped){
                var origSend = window.sendMessage;
                window.sendMessage = function(){
                    try{
                        var a0 = arguments[0];
                        if(typeof a0 === 'string'){
                            _lastUserSent = { id: Date.now(), text: a0, timestamp: new Date().toISOString(), sender: 'user', type: 'normal' };
                        } else if(a0 && typeof a0 === 'object' && (a0.text || a0.message)){
                            var txt = a0.text || a0.message || '';
                            _lastUserSent = { id: a0.id !== undefined ? a0.id : Date.now(), text: txt, timestamp: a0.timestamp || new Date().toISOString(), sender: 'user', type: a0.type || 'normal' };
                        } else {
                            try{
                                var inp = document.getElementById('message-input') || document.querySelector('textarea, input');
                                if(inp && inp.value) _lastUserSent = { id: Date.now(), text: inp.value, timestamp: new Date().toISOString(), sender: 'user', type: 'normal' };
                            }catch(e){}
                        }
                        if(_lastUserSent) log('captured lastUserSent from sendMessage', _lastUserSent);
                    }catch(e){}
                    return origSend.apply(this, arguments);
                };
                window.__pcp_sendMessageWrapped = true;
                log('wrapped sendMessage to capture lastUserSent');
            }
        }catch(e){ warn('wrap sendMessage failed', e); }
    }

    // expose API
    window.PartnerCardPrompt = window.PartnerCardPrompt || {
        setChance: function(p){ state.chance = Math.max(0, Math.min(1, Number(p) || 0)); log('chance set to', state.chance); },
        getChance: function(){ return state.chance; },
        enable: function(){ state.enabled = true; },
        disable: function(){ state.enabled = false; },
        forcePromptFor: function(partnerMsg){ log('forcePromptFor', partnerMsg); maybePromptOnPartnerMessage(partnerMsg, { lastLen: (Array.isArray(window.messages)?window.messages.length:0), lastTimestamp: _installMark }); },
        addCard: addPartnerWordcard,
        renderCards: function(){ renderPartnerWordCards(); },
        _debug: { installAllHooks: installAllHooks, setProcessed: function(ids){ ids && ids.forEach(function(i){ _processedIds.add(i); }); }, lastUser: function(){ return _lastUserSent; } }
    };

    // Start: wait for messages to settle to avoid prompts during initial load
    try{ waitForMessagesStableAndInstall(); }catch(e){ warn('auto install failed', e); installAllHooks({ lastLen: (Array.isArray(window.messages)?window.messages.length:0), lastTimestamp: _installMark }); }

})();
