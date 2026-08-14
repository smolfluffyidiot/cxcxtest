(function(){
    // partner-card-prompt.js
    // - Prompt only for truly new partner messages (fingerprint existing messages at install + timestamp check)
    // - When prompting, pick a random previous user message (from history or recently-sent) as the candidate
    // - On Accept: add candidate text to reply-only storage (APP_PREFIX + 'custom_replies') and to partner storage (APP_PREFIX + 'partner_wordcards_v1')
    // - Try to sync to common in-memory reply arrays and call render/save hooks if available
    // - Minimal, robust detection: wrap addMessage/sendMessage, poll messages, DOM observer fallback
    //
    // Put this file as js/partner-card-prompt.js and load after your app scripts.

    var APP_PREFIX = window.APP_PREFIX || '';
    var PARTNER_STORAGE_KEY = APP_PREFIX + 'partner_wordcards_v1';
    var REPLY_STORAGE_KEY   = APP_PREFIX + 'custom_replies';
    var POPUP_ID = 'partner-add-card-popup-random';
    var DEFAULT_CHANCE = 1;
    var PAGE_LOAD_TS = Date.now();

    var state = { chance: DEFAULT_CHANCE, enabled: true, installed: false };
    var _initialFingerprints = new Set();
    var _processedIds = new Set();
    var _lastUserSent = null;

    function log(){ try{ console.debug('[PartnerCardPrompt]', ...arguments); }catch(e){} }
    function warn(){ try{ console.warn('[PartnerCardPrompt]', ...arguments); }catch(e){} }
    function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function nowISO(){ return (new Date()).toISOString(); }

    // storage helpers
    async function _getPartnerStored(){ try{ if(window.localforage){ var v = await localforage.getItem(PARTNER_STORAGE_KEY); return Array.isArray(v)?v:[]; } else { var r = localStorage.getItem(PARTNER_STORAGE_KEY); return r?JSON.parse(r):[]; } }catch(e){ return []; } }
    async function _setPartnerStored(arr){ try{ if(window.localforage) await localforage.setItem(PARTNER_STORAGE_KEY, arr); else localStorage.setItem(PARTNER_STORAGE_KEY, JSON.stringify(arr)); }catch(e){} }

    function _getRepliesStored(){ try{ var r = localStorage.getItem(REPLY_STORAGE_KEY); return r?JSON.parse(r):[]; }catch(e){ return []; } }
    function _setRepliesStored(arr){ try{ localStorage.setItem(REPLY_STORAGE_KEY, JSON.stringify(arr)); }catch(e){} }

    // fingerprint helpers to ignore pre-existing messages
    function fingerprintOf(m){
        if(!m) return '';
        var out = '';
        if(m.id !== undefined) out += 'id:' + String(m.id) + ';';
        if(m.timestamp) out += 'ts:' + String(m.timestamp) + ';';
        if(m.text) out += 'tx:' + String(m.text).slice(0,200) + ';';
        if(m.image) out += 'im:' + String(m.image).slice(0,200) + ';';
        return out;
    }
    function captureInitialMessages(){
        try{
            var arr = Array.isArray(window.messages) ? window.messages : [];
            arr.forEach(function(m){
                var f = fingerprintOf(m);
                if(f) _initialFingerprints.add(f);
                if(m && m.id !== undefined) _processedIds.add(m.id);
            });
            log('captured initial fingerprints', _initialFingerprints.size);
        }catch(e){ warn('captureInitialMessages', e); }
    }
    function isInitialMessage(m){
        var f = fingerprintOf(m);
        return f && _initialFingerprints.has(f);
    }

    // choose random user message from history (prefer unique texts), limit recent = 200 scans
    function pickRandomUserMessage(){
        var pool = [];
        try{
            var arr = Array.isArray(window.messages) ? window.messages : [];
            for(var i = Math.max(0, arr.length - 200); i < arr.length; i++){
                var m = arr[i];
                if(!m) continue;
                var isUser = (m.sender === 'user' || m.sender === 'me' || m.role === 'user');
                if(isUser && m.type !== 'system' && (m.text || m.image)){
                    var text = m.text || (m.image ? '[图片] ' + m.image : '');
                    if(text && !pool.some(p => p.text === text)) pool.push({ id: m.id!==undefined?m.id:Date.now()+i, text: text, ts: m.timestamp||'' });
                }
            }
            // also include last captured send immediately at front (if exists and not duplicate)
            if(_lastUserSent && _lastUserSent.text && !pool.some(p => p.text === _lastUserSent.text)){
                pool.unshift({ id: _lastUserSent.id||'last', text: _lastUserSent.text, ts: _lastUserSent.timestamp||'' });
            }
        }catch(e){ warn('pickRandomUserMessage', e); }
        if(!pool.length) return null;
        var idx = Math.floor(Math.random() * pool.length);
        return pool[idx];
    }

    // save to partner storage and reply storage, sync best-effort in-memory arrays and call hooks
    async function saveReplyAndPartner(text){
        if(!text || !String(text).trim()) return false;
        try{
            // partner storage
            var parr = await _getPartnerStored();
            if(!parr.some(x => x.text === text)){
                parr.unshift({ id: Date.now(), text: text, createdAt: nowISO() });
                await _setPartnerStored(parr);
                try { window.dispatchEvent(new CustomEvent('partnerCardAdded', { detail: { text: text } })); } catch(e){}
            } else log('partner already has text');

            // replies storage (only replies)
            var rarr = _getRepliesStored();
            if(!rarr.some(x => x === text)){
                rarr.unshift(text);
                _setRepliesStored(rarr);
                // sync to common in-memory arrays used by the app (best-effort)
                if(Array.isArray(window.customReplies) && !window.customReplies.some(x => x === text)) window.customReplies.unshift(text);
                if(Array.isArray(window.replyLibrary) && !window.replyLibrary.some(x => x === text)) window.replyLibrary.unshift(text);
                if(Array.isArray(window.reply_library) && !window.reply_library.some(x => x === text)) window.reply_library.unshift(text);
                // call UI hooks if they exist
                if(typeof renderReplyLibrary === 'function') try{ renderReplyLibrary(); }catch(e){}
                if(typeof renderReplyLibraryUI === 'function') try{ renderReplyLibraryUI(); }catch(e){}
                if(typeof throttledSaveData === 'function') try{ throttledSaveData(); }catch(e){}
                else if(typeof saveData === 'function') try{ saveData(); }catch(e){}
                try { window.dispatchEvent(new CustomEvent('replyAdded', { detail: { text: text } })); } catch(e){}
                if(typeof showNotification === 'function') showNotification('已添加到回复库 ✓','success',1500);
                log('saved reply and attempted sync');
                return true;
            } else {
                log('reply already exists');
                return false;
            }
        }catch(e){ warn('saveReplyAndPartner error', e); return false; }
    }

    // popup: show chosen random user message and accept/reject
    function showRandomCandidatePopup(partnerMsg){
        try{
            if(document.getElementById(POPUP_ID)) return;
            var candidate = pickRandomUserMessage();
            var textToShow = candidate ? candidate.text : '(无可用历史消息)';
            var overlay = document.createElement('div');
            overlay.id = POPUP_ID;
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);padding:18px;';
            overlay.innerHTML = '\
                <div style="width:min(520px,94vw);background:var(--secondary-bg);border-radius:12px;padding:14px;border:1px solid var(--border-color);box-shadow:0 30px 60px rgba(0,0,0,0.36);font-family:var(--font-family);">\
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">\
                        <div style="width:46px;height:46px;border-radius:10px;background:linear-gradient(135deg,var(--accent-color),rgba(var(--accent-color-rgb),0.85));display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;"><i class="fas fa-random"></i></div>\
                        <div><div style="font-weight:700;color:var(--text-primary);font-size:15px;">对方向你提议：把你的一条历史消息添加为回复？</div><div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">已随机从你的历史消息中挑选一条作为候选（不是对方消息）。</div></div>\
                    </div>\
                    <div style="padding:10px;border-radius:10px;background:var(--primary-bg);border:1px solid var(--border-color);color:var(--text-primary);font-size:13px;line-height:1.5;max-height:240px;overflow:auto;">' + esc(textToShow) + '</div>\
                    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">\
                        <button id="'+POPUP_ID+'-reject" style="padding:9px 12px;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);cursor:pointer;color:var(--text-secondary);">拒绝</button>\
                        <button id="'+POPUP_ID+'-accept" style="padding:9px 12px;border-radius:10px;border:none;background:var(--accent-color);color:#fff;font-weight:700;cursor:pointer;">接受并添加</button>\
                    </div>\
                </div>';
            document.body.appendChild(overlay);

            function cleanup(){ var e = document.getElementById(POPUP_ID); if(e) e.remove(); }

            document.getElementById(POPUP_ID+'-reject').addEventListener('click', function(){ cleanup(); if(typeof showNotification==='function') showNotification('已拒绝','info',1200); });
            document.getElementById(POPUP_ID+'-accept').addEventListener('click', async function(){
                cleanup();
                if(!candidate){ if(typeof showNotification==='function') showNotification('没有可添加的历史消息','warning'); return; }
                await saveReplyAndPartner(candidate.text);
            });
            overlay.addEventListener('click', function(e){ if(e.target === overlay){ cleanup(); if(typeof showNotification==='function') showNotification('已取消','info',1000); } });
        }catch(e){ warn('showRandomCandidatePopup', e); }
    }

    // decide whether to prompt: must not be pre-existing, must have timestamp >= PAGE_LOAD_TS - tolerance, not processed
    function shouldProcessPartnerMessage(m){
        if(!m) return false;
        if(m.type === 'system') return false;
        if(m.id !== undefined && _processedIds.has(m.id)) return false;
        // avoid messages present at install
        if(isInitialMessage(m)) return false;
        // require timestamp and newer than page load (small tolerance)
        if(!m.timestamp) return false;
        var ts = (new Date(m.timestamp)).getTime();
        if(isNaN(ts)) return false;
        if(ts < PAGE_LOAD_TS - 1500) return false;
        return true;
    }

    function markProcessed(m){ if(!m) return; if(m.id !== undefined) _processedIds.add(m.id); }

    function maybePromptOnPartnerMessage(m){
        try{
            if(!state.enabled) return;
            if(!shouldProcessPartnerMessage(m)){ markProcessed(m); return; }
            var r = Math.random();
            log('roll', r, 'chance', state.chance);
            if(r > state.chance){ markProcessed(m); return; }
            showRandomCandidatePopup(m);
            markProcessed(m);
        }catch(e){ warn('maybePromptOnPartnerMessage', e); }
    }

    // detection hooks
    function wrapAddMessage(){
        try{
            if(typeof window.addMessage === 'function' && !window.__pcp_addMessageHooked){
                var orig = window.addMessage;
                window.addMessage = function(msg){
                    try{ orig.apply(this, arguments); }catch(e){ try{ orig(msg); }catch(_){} }
                    try{
                        if(msg && (msg.sender === 'user' || msg.sender === 'me' || msg.role === 'user')) _lastUserSent = { id: msg.id||Date.now(), text: msg.text||'', timestamp: msg.timestamp||nowISO() };
                        if(msg && msg.sender && msg.sender !== 'user') maybePromptOnPartnerMessage(msg);
                    }catch(e){}
                };
                window.__pcp_addMessageHooked = true;
                log('addMessage wrapped');
            }
        }catch(e){}
    }
    function wrapSendMessage(){
        try{
            if(typeof window.sendMessage === 'function' && !window.__pcp_sendMessageWrapped){
                var orig = window.sendMessage;
                window.sendMessage = function(){
                    try{
                        var a0 = arguments[0];
                        if(typeof a0 === 'string') _lastUserSent = { id: Date.now(), text: a0, timestamp: nowISO() };
                        else if(a0 && typeof a0 === 'object' && (a0.text || a0.message)) _lastUserSent = { id: a0.id||Date.now(), text: a0.text||a0.message||'', timestamp: a0.timestamp||nowISO() };
                        else {
                            try{ var inp = document.getElementById('message-input') || document.querySelector('textarea, input'); if(inp && inp.value) _lastUserSent = { id: Date.now(), text: inp.value, timestamp: nowISO() }; }catch(e){}
                        }
                        if(_lastUserSent) log('captured lastUserSent', _lastUserSent);
                    }catch(e){}
                    return orig.apply(this, arguments);
                };
                window.__pcp_sendMessageWrapped = true;
                log('sendMessage wrapped');
            }
        }catch(e){}
    }
    function startMessagesPoll(){
        try{
            var lastLen = Array.isArray(window.messages) ? window.messages.length : 0;
            if(Array.isArray(window.messages)) window.messages.forEach(function(m){ if(m && m.id !== undefined) _processedIds.add(m.id); });
            setInterval(function(){
                try{
                    var arr = window.messages;
                    if(!Array.isArray(arr)) return;
                    if(arr.length > lastLen){
                        for(var i = lastLen; i < arr.length; i++){
                            var m = arr[i];
                            if(!m) continue;
                            if(m && (m.sender === 'user' || m.sender === 'me' || m.role === 'user')) _lastUserSent = { id: m.id||Date.now(), text: m.text||'', timestamp: m.timestamp||nowISO() };
                            if(m && m.sender && m.sender !== 'user') maybePromptOnPartnerMessage(m);
                        }
                        lastLen = arr.length;
                    } else if(arr.length !== lastLen) lastLen = arr.length;
                }catch(e){}
            }, 700);
        }catch(e){}
    }
    function startDomObserver(){
        try{
            var selectors = ['#messages','.messages','.message-list','.messages-list','.chat-list','#chat-messages','.conversation'];
            var container = null;
            for(var s of selectors){ var el = document.querySelector(s); if(el){ container = el; break; } }
            if(!container){
                var candidates = Array.from(document.querySelectorAll('div'));
                for(var c of candidates){ try{ if(c.querySelector && c.querySelector('.message-wrapper, .message')){ container = c; break; } }catch(e){} }
            }
            if(!container) return;
            var obs = new MutationObserver(function(muts){
                muts.forEach(function(mu){
                    mu.addedNodes && mu.addedNodes.forEach(function(node){
                        try{
                            if(!node || node.nodeType !== 1) return;
                            var sender = node.getAttribute && (node.getAttribute('data-sender') || node.getAttribute('data-from') || node.getAttribute('data-message-sender'));
                            if(!sender){
                                if(node.classList && (node.classList.contains('message-wrapper')||node.classList.contains('message'))){
                                    var text = node.innerText || '';
                                    var isPartner = !(node.classList.contains('me') || node.classList.contains('from-me') || node.className.indexOf('user') !== -1);
                                    if(isPartner) maybePromptOnPartnerMessage({ id: Date.now(), text: text, timestamp: nowISO(), sender: 'partner' });
                                    else _lastUserSent = { id: Date.now(), text: text, timestamp: nowISO() };
                                }
                            } else {
                                if(sender !== 'user' && sender !== 'me') maybePromptOnPartnerMessage({ id: Date.now(), text: node.innerText||'', timestamp: nowISO(), sender: sender });
                                else _lastUserSent = { id: Date.now(), text: node.innerText||'', timestamp: nowISO() };
                            }
                        }catch(e){}
                    });
                });
            });
            obs.observe(container, { childList:true, subtree:true });
            log('DOM observer started');
        }catch(e){}
    }

    // install: fingerprint initial messages to avoid reload-trigger, then hooks
    function install(){
        if(state.installed) return;
        state.installed = true;
        captureInitialMessages();
        wrapAddMessage();
        wrapSendMessage();
        startMessagesPoll();
        startDomObserver();
        log('PartnerCardPrompt installed; pageLoadTs:', PAGE_LOAD_TS);
    }

    // public API
    window.PartnerCardPrompt = window.PartnerCardPrompt || {
        setChance: function(p){ state.chance = Math.max(0, Math.min(1, Number(p)||0)); log('chance set to', state.chance); },
        getChance: function(){ return state.chance; },
        enable: function(){ state.enabled = true; },
        disable: function(){ state.enabled = false; },
        forcePromptFor: function(m, opts){ if(opts && opts.force) showRandomCandidatePopup(m); else maybePromptOnPartnerMessage(m); },
        addCard: saveReplyAndPartner, // kept for backward compat (if needed)
        _debug: { install: install, lastUser: function(){ return _lastUserSent; }, fingerprintsSize: function(){ return _initialFingerprints.size; } }
    };

    // start a bit after load to let app hydrate
    setTimeout(install, 300);

    // helper wrapper to keep compatibility name used earlier
    async function saveReplyAndPartner(text){
        return saveReplyAndPartner; // no-op placeholder to avoid reference errors
    }

})();
