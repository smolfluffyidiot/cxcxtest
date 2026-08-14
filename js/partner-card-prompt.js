(function(){
    // partner-card-prompt.js
    // - Only prompt for partner messages that are truly new (timestamp > page load)
    // - On accept: add to partner wordcards AND add to replies (localStorage APP_PREFIX + 'custom_replies')
    // - Best-effort calls to render/save hooks and events emitted

    var APP_PREFIX = window.APP_PREFIX || '';
    var PARTNER_STORAGE_KEY = APP_PREFIX + 'partner_wordcards_v1';
    var REPLY_STORAGE_KEY   = APP_PREFIX + 'custom_replies';
    var POPUP_ID = 'partner-add-card-popup-final';
    var DEFAULT_CHANCE = 0.12;

    var state = { chance: DEFAULT_CHANCE, enabled: true, installed: false };

    var _processedIds = new Set();
    var _lastUserSent = null;
    var PAGE_LOAD_TS = Date.now(); // used to filter out rehydrated/old messages

    function log(){ try { console.debug('[PartnerCardPrompt]', ...arguments); } catch(e){} }
    function warn(){ try { console.warn('[PartnerCardPrompt]', ...arguments); } catch(e){} }
    function _escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _nowISO(){ return (new Date()).toISOString(); }

    // Storage helpers
    async function _getPartnerStored(){ try{ if(window.localforage) { var v = await localforage.getItem(PARTNER_STORAGE_KEY); return Array.isArray(v)?v:[]; } else { var r = localStorage.getItem(PARTNER_STORAGE_KEY); return r?JSON.parse(r):[]; } }catch(e){ warn('read partner store fail', e); return []; } }
    async function _setPartnerStored(arr){ try{ if(window.localforage) await localforage.setItem(PARTNER_STORAGE_KEY, arr); else localStorage.setItem(PARTNER_STORAGE_KEY, JSON.stringify(arr)); }catch(e){ warn('write partner store fail', e); } }

    function _getRepliesStored(){ try{ var r = localStorage.getItem(REPLY_STORAGE_KEY); return r ? JSON.parse(r) : []; }catch(e){ return []; } }
    function _setRepliesStored(arr){ try{ localStorage.setItem(REPLY_STORAGE_KEY, JSON.stringify(arr)); }catch(e){ warn('write replies fail', e); } }

    // Add partner wordcard and also add into replies
    async function addPartnerWordcardAndReply(text){
        if(!text || !String(text).trim()) return false;
        // partner wordcards
        var parr = await _getPartnerStored();
        var existedP = parr.some(function(c){ return c.text === text; });
        if(!existedP){
            var pitem = { id: Date.now(), text: text, createdAt: _nowISO() };
            parr.unshift(pitem);
            await _setPartnerStored(parr);
            renderPartnerWordCards(parr);
            try { window.dispatchEvent(new CustomEvent('partnerCardAdded', { detail: pitem })); } catch(e){}
            if(typeof showNotification === 'function') showNotification('已添加到对方字卡 ✓','success',1600);
            log('partner card saved', pitem);
        } else {
            log('partner card already exists');
        }

        // replies store (only replies, no stickers)
        try {
            var rarr = _getRepliesStored();
            if(!rarr.some(function(x){ return x === text; })){
                rarr.unshift(text);
                _setRepliesStored(rarr);
                // try to sync to in-memory vars if present
                if(Array.isArray(window.customReplies)){
                    if(!window.customReplies.some(function(x){ return x === text; })) window.customReplies.unshift(text);
                }
                if(Array.isArray(window.replyLibrary)){
                    if(!window.replyLibrary.some(function(x){ return x === text; })) window.replyLibrary.unshift(text);
                }
                // call UI hooks if present
                if(typeof renderReplyLibrary === 'function') try{ renderReplyLibrary(); }catch(e){}
                if(typeof throttledSaveData === 'function') try{ throttledSaveData(); }catch(e){}
                else if(typeof saveData === 'function') try{ saveData(); }catch(e){}
                try { window.dispatchEvent(new CustomEvent('replyAdded', { detail: { text: text } })); } catch(e){}
                log('reply saved and synced');
            } else {
                log('reply already exists in reply store');
            }
        } catch(e){ warn('error adding to replies', e); }

        return true;
    }

    function renderPartnerWordCards(list){
        if(!list){ _getPartnerStored().then(function(arr){ renderPartnerWordCards(arr); }).catch(function(){}); return; }
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
                var arr = await _getPartnerStored();
                var idx = arr.findIndex(function(x){ return x.id === item.id; });
                if(idx >= 0){
                    arr.splice(idx, 1);
                    await _setPartnerStored(arr);
                    renderPartnerWordCards(arr);
                    if(typeof showNotification === 'function') showNotification('已删除', 'info', 1200);
                }
            });
            el.appendChild(row);
        });
    }

    // Find relevant user message prior to partnerMsg; fallback to last captured _lastUserSent
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
        if(_lastUserSent && _lastUserSent.text) return _lastUserSent;
        return null;
    }

    // Only process messages that are truly new: require message timestamp newer than PAGE_LOAD_TS (so rehydrated messages on refresh won't trigger)
    function _shouldProcessMessage(m){
        if(!m) return false;
        if(m.id !== undefined && _processedIds.has(m.id)) return false;
        // require timestamp and it must be after page load time (allow slight tolerance window)
        if(!m.timestamp) return false;
        var ts = (new Date(m.timestamp)).getTime();
        if(isNaN(ts)) return false;
        // allow messages with timestamp at or after PAGE_LOAD_TS - 1500ms (small tolerance)
        if(ts < PAGE_LOAD_TS - 1500) return false;
        return true;
    }
    function _markProcessed(m){
        if(!m) return;
        if(m.id !== undefined) _processedIds.add(m.id);
    }

    // Popup
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
            overlay.innerHTML = '\n            <div style="width:min(480px,94vw);background:var(--secondary-bg);border-radius:14px;padding:16px;border:1px solid var(--border-color);box-shadow:0 30px 70px rgba(0,0,0,0.36);font-family:var(--font-family);">\n                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">\n                    <div style="width:44px;height:44px;border-radius:8px;background:linear-gradient(135deg,var(--accent-color),rgba(var(--accent-color-rgb),0.85));display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">\n                        <i class="fas fa-book"></i>\n                    </div>\n                    <div>\n                        <div style="font-weight:700;color:var(--text-primary);font-size:15px;">对方向你提议：把这条消息加入对方字卡？</div>\n                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">接受后该消息会被存为对方的回复字卡</div>\n                    </div>\n                </div>\n                <div style="padding:10px;border-radius:10px;background:var(--primary-bg);border:1px solid var(--border-color);color:var(--text-primary);font-size:13px;line-height:1.5;max-height:220px;overflow:auto;">' + _escapeHtml(candidateText) + '</div>\n                <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">\n                    <button id="' + POPUP_ID + '-reject" style="padding:9px 12px;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;">拒绝</button>\n                    <button id="' + POPUP_ID + '-accept" style="padding:9px 12px;border-radius:10px;border:none;background:var(--accent-color);color:#fff;cursor:pointer;font-weight:700;">接受并添加</button>\n                </div>\n            </div>\n        ';
            document.body.appendChild(overlay);

            function cleanup(){ var el = document.getElementById(POPUP_ID); if(el) el.remove(); }

            document.getElementById(POPUP_ID + '-reject').addEventListener('click', function(){ cleanup(); if(typeof showNotification === 'function') showNotification('已拒绝', 'info', 1200); });
            document.getElementById(POPUP_ID + '-accept').addEventListener('click', async function(){
                cleanup();
                if(!candidateText || candidateText === '(无可用消息)'){
                    if(typeof showNotification === 'function') showNotification('没有可用消息可添加', 'warning', 1800);
                    return;
                }
                await addPartnerWordcardAndReply(candidateText);
            });
            overlay.addEventListener('click', function(e){ if(e.target === overlay){ overlay.remove(); if(typeof showNotification === 'function') showNotification('已取消', 'info', 1000); } });
        }catch(e){ warn('show popup error', e); }
    }

    // Decide when to prompt
    function maybePromptOnPartnerMessage(partnerMsg){
        try{
            if(!state.enabled) return;
            if(!partnerMsg) return;
            if(partnerMsg.type === 'system') return;
            if(!_shouldProcessMessage(partnerMsg)){
                log('skip partnerMsg (old/processed)', partnerMsg && (partnerMsg.id || partnerMsg.timestamp));
                _markProcessed(partnerMsg);
                return;
            }
            var r = Math.random();
            log('roll', r, 'chance', state.chance);
            if(r > state.chance){
                _markProcessed(partnerMsg);
                return;
            }
            var candidate = findRelevantUserMessage(partnerMsg);
            showPartnerAddPopup(partnerMsg, candidate);
            _markProcessed(partnerMsg);
        }catch(e){ warn('maybePrompt error', e); }
    }

    // Install hooks: capture outgoing messages and detect incoming partner messages
    function installHooks(){
        if(state.installed) return;
        state.installed = true;
        log('installHooks');

        // wrap addMessage if present
        try{
            if(typeof window.addMessage === 'function' && !window.__pcp_addMessageHooked){
                var orig = window.addMessage;
                window.addMessage = function(msg){
                    try{ orig.apply(this, arguments); }catch(e){ try{ orig(msg); }catch(_){} }
                    try{
                        if(msg && (msg.sender === 'user' || msg.sender === 'me' || msg.role === 'user')){
                            _lastUserSent = { id: msg.id !== undefined ? msg.id : Date.now(), text: msg.text || '', timestamp: msg.timestamp || new Date().toISOString(), sender: 'user' };
                            log('captured lastUserSent from addMessage', _lastUserSent);
                        }
                        if(msg && msg.sender && msg.sender !== 'user'){
                            maybePromptOnPartnerMessage(msg);
                        }
                    }catch(e){}
                };
                window.__pcp_addMessageHooked = true;
                log('addMessage wrapped');
            }
        }catch(e){ warn(e); }

        // wrap sendMessage to capture outgoing text immediately
        try{
            if(typeof window.sendMessage === 'function' && !window.__pcp_sendMessageWrapped){
                var origSend = window.sendMessage;
                window.sendMessage = function(){
                    try{
                        var a0 = arguments[0];
                        if(typeof a0 === 'string'){
                            _lastUserSent = { id: Date.now(), text: a0, timestamp: new Date().toISOString(), sender: 'user' };
                        } else if(a0 && typeof a0 === 'object' && (a0.text || a0.message)){
                            _lastUserSent = { id: a0.id !== undefined ? a0.id : Date.now(), text: a0.text || a0.message || '', timestamp: a0.timestamp || new Date().toISOString(), sender: 'user' };
                        } else {
                            try{
                                var inp = document.getElementById('message-input') || document.querySelector('textarea, input');
                                if(inp && inp.value) _lastUserSent = { id: Date.now(), text: inp.value, timestamp: new Date().toISOString(), sender: 'user' };
                            }catch(e){}
                        }
                        if(_lastUserSent) log('captured lastUserSent from sendMessage', _lastUserSent);
                    }catch(e){}
                    return origSend.apply(this, arguments);
                };
                window.__pcp_sendMessageWrapped = true;
                log('sendMessage wrapped');
            }
        }catch(e){ warn(e); }

        // Poll messages array for appended messages and capture user messages too
        try{
            var lastLen = Array.isArray(window.messages) ? window.messages.length : 0;
            // mark existing messages as processed so reload won't trigger
            try{ if(Array.isArray(window.messages)){ window.messages.forEach(function(m){ if(m && m.id !== undefined) _processedIds.add(m.id); }); } }catch(e){}
            setInterval(function(){
                try{
                    var arr = window.messages;
                    if(!Array.isArray(arr)) return;
                    if(arr.length > lastLen){
                        for(var i = lastLen; i < arr.length; i++){
                            var m = arr[i];
                            if(!m) continue;
                            if(m && (m.sender === 'user' || m.sender === 'me' || m.role === 'user')){
                                _lastUserSent = { id: m.id !== undefined ? m.id : Date.now(), text: m.text || '', timestamp: m.timestamp || new Date().toISOString(), sender: 'user' };
                                log('captured lastUserSent from messages array', _lastUserSent);
                            }
                            if(m && m.sender && m.sender !== 'user'){
                                maybePromptOnPartnerMessage(m);
                            }
                        }
                        lastLen = arr.length;
                    } else if(arr.length !== lastLen){
                        lastLen = arr.length;
                    }
                }catch(e){}
            }, 700);
            log('started messages poll');
        }catch(e){ warn(e); }

        // DOM MutationObserver fallback: capture new DOM message nodes
        try{
            var selectors = ['#messages','.messages','.message-list','.messages-list','.chat-list','#chat-messages','.conversation'];
            var container = null;
            for(var s of selectors){ var el = document.querySelector(s); if(el){ container = el; break; } }
            if(!container){
                var candidates = Array.from(document.querySelectorAll('div'));
                for(var c of candidates){ try{ if(c.querySelector && c.querySelector('.message-wrapper, .message')){ container = c; break; } }catch(e){} }
            }
            if(container){
                var obs = new MutationObserver(function(muts){
                    muts.forEach(function(mu){
                        mu.addedNodes && mu.addedNodes.forEach(function(node){
                            try{
                                if(!node) return;
                                if(node.nodeType !== 1) return;
                                var sender = node.getAttribute && (node.getAttribute('data-sender') || node.getAttribute('data-from') || node.getAttribute('data-message-sender'));
                                if(!sender){
                                    if(node.classList && (node.classList.contains('message-wrapper') || node.classList.contains('message'))){
                                        var text = node.innerText || '';
                                        var isPartner = !(node.classList.contains('me') || node.classList.contains('from-me') || node.className.indexOf('user') !== -1);
                                        if(isPartner){
                                            var synthetic = { id: Date.now(), text: text, timestamp: new Date().toISOString(), type:'normal', sender: 'partner' };
                                            maybePromptOnPartnerMessage(synthetic);
                                        } else {
                                            _lastUserSent = { id: Date.now(), text: text, timestamp: new Date().toISOString(), sender: 'user' };
                                            log('captured lastUserSent from DOM', _lastUserSent);
                                        }
                                    }
                                } else {
                                    if(sender !== 'user' && sender !== 'me'){
                                        var synthetic2 = { id: Date.now(), text: node.innerText||'', timestamp: new Date().toISOString(), type:'normal', sender: sender };
                                        maybePromptOnPartnerMessage(synthetic2);
                                    } else {
                                        _lastUserSent = { id: Date.now(), text: node.innerText||'', timestamp: new Date().toISOString(), sender: 'user' };
                                        log('captured lastUserSent from DOM explicit sender', _lastUserSent);
                                    }
                                }
                            }catch(e){}
                        });
                    });
                });
                obs.observe(container, { childList:true, subtree:true });
                log('started DOM observer');
            }
        }catch(e){ warn(e); }

        // render stored partner list if UI present
        setTimeout(function(){ renderPartnerWordCards(); }, 400);
    }

    // Expose API
    window.PartnerCardPrompt = window.PartnerCardPrompt || {
        setChance: function(p){ state.chance = Math.max(0, Math.min(1, Number(p) || 0)); log('chance set to', state.chance); },
        getChance: function(){ return state.chance; },
        enable: function(){ state.enabled = true; },
        disable: function(){ state.enabled = false; },
        // forcePromptFor bypasses timestamp check when opts && opts.force === true
        forcePromptFor: function(partnerMsg, opts){
            if(opts && opts.force){
                showPartnerAddPopup(partnerMsg, findRelevantUserMessage(partnerMsg) || _lastUserSent);
            } else {
                maybePromptOnPartnerMessage(partnerMsg);
            }
        },
        addCard: addPartnerWordcardAndReply,
        renderCards: function(){ renderPartnerWordCards(); }
    };

    // start installer after a small delay to let app hydrate; existing messages are marked processed
    setTimeout(function(){
        // mark existing ids processed to avoid reload triggers
        try{ if(Array.isArray(window.messages)) window.messages.forEach(function(m){ if(m && m.id !== undefined) _processedIds.add(m.id); }); }catch(e){}
        installHooks();
        log('PartnerCardPrompt installed; page load ts:', PAGE_LOAD_TS);
    }, 350);

})();
