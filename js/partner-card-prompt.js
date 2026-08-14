(function(){
    // partner-card-prompt.js
    // Fix: avoid prompting on page-refresh by marking existing messages as processed.
    var APP_PREFIX = window.APP_PREFIX || '';
    var STORAGE_KEY = APP_PREFIX + 'partner_wordcards_v1';
    var POPUP_ID = 'partner-add-card-popup-v2';
    var DEFAULT_CHANCE = 1;

    var state = { chance: DEFAULT_CHANCE, enabled: true, installed: false };

    var _processedIds = new Set();
    var _installTime = Date.now();

    function log(){ try { console.debug('[PartnerCardPrompt]', ...arguments); } catch(e){} }
    function warn(){ try { console.warn('[PartnerCardPrompt]', ...arguments); } catch(e){} }
    function _escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function _nowISO(){ return (new Date()).toISOString(); }

    // storage helpers
    async function _getStored(){ try{ if(window.localforage) { var v = await localforage.getItem(STORAGE_KEY); return Array.isArray(v)?v:[]; } else { var r = localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):[]; } }catch(e){ warn('read store fail', e); return []; } }
    async function _setStored(arr){ try{ if(window.localforage) await localforage.setItem(STORAGE_KEY, arr); else localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }catch(e){ warn('write store fail', e); } }

    async function addPartnerWordcard(text){ if(!text||!String(text).trim()) return false; var arr = await _getStored(); if(arr.some(function(c){ return c.text===text; })) return false; var item = { id: Date.now(), text: text, createdAt: _nowISO() }; arr.unshift(item); await _setStored(arr); renderPartnerWordCards(arr); if(typeof showNotification==='function') showNotification('已添加到对方字卡 ✓','success',1800); log('added card', item); return true; }

    function renderPartnerWordCards(list){ if(!list){ _getStored().then(function(arr){ renderPartnerWordCards(arr); }).catch(function(){}); return; } var el = document.getElementById('partner-wordcards-list'); if(!el) return; el.innerHTML=''; if(!list.length){ el.innerHTML = '<div class="pw-empty" style="color:var(--text-secondary);font-size:13px;padding:8px;text-align:center;">对方字卡暂无内容</div>'; return; } list.forEach(function(item){ var row = document.createElement('div'); row.className='pw-item'; row.style.cssText='padding:8px 10px;border-radius:8px;margin-bottom:8px;background:var(--primary-bg);border:1px solid var(--border-color);display:flex;align-items:flex-start;gap:8px;'; row.innerHTML = '<div style="flex:1;font-size:13px;color:var(--text-primary);line-height:1.45;word-break:break-word;">' + _escapeHtml(item.text) + '</div>' + '<button title="删除" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:6px;font-size:14px;">✕</button>'; var delBtn = row.querySelector('button'); delBtn.addEventListener('click', async function(){ if(!confirm('确认删除该字卡？')) return; var arr = await _getStored(); var idx = arr.findIndex(function(x){ return x.id===item.id; }); if(idx>=0){ arr.splice(idx,1); await _setStored(arr); renderPartnerWordCards(arr); if(typeof showNotification==='function') showNotification('已删除','info',1200); } }); el.appendChild(row); }); }

    // find relevant user message before partnerMsg
    function findRelevantUserMessage(partnerMsg){ var msgs = Array.isArray(window.messages)?window.messages:[]; if(!msgs.length) return null; var idx=-1; if(partnerMsg && partnerMsg.id !== undefined) idx = msgs.findIndex(function(m){ return m.id===partnerMsg.id; }); if(idx===-1 && partnerMsg && partnerMsg.timestamp) { for(var i=0;i<msgs.length;i++){ if(String(msgs[i].timestamp)===String(partnerMsg.timestamp)){ idx=i; break; } } } var start = (idx>0)?idx-1:msgs.length-1; for(var j=start;j>=0;j--){ var m = msgs[j]; if(!m) continue; if(m.sender==='user' && m.type!=='system' && (m.text||m.image)) return m; } for(var k=msgs.length-1;k>=0;k--){ var mm = msgs[k]; if(mm && mm.sender==='user' && mm.type!=='system' && (mm.text||mm.image)) return mm; } return null; }

    function _shouldProcessMessage(m){
        // If message has an id we've already processed -> skip
        if(!m) return false;
        if(m.id !== undefined && _processedIds.has(m.id)) return false;
        // If message timestamp exists and it's older than install time => skip
        if(m.timestamp){
            var ts = (new Date(m.timestamp)).getTime();
            if(!isNaN(ts) && ts < _installTime - 2000) return false;
        }
        // otherwise process
        return true;
    }

    function _markProcessed(m){
        if(!m) return;
        if(m.id !== undefined) _processedIds.add(m.id);
    }

    function showPartnerAddPopup(partnerMsg, candidateMsg){ try{ if(document.getElementById(POPUP_ID)) return; var candidateText=''; if(candidateMsg){ if(candidateMsg.text) candidateText = candidateMsg.text; else if(candidateMsg.image) candidateText = '[图片] ' + (candidateMsg.note||''); else candidateText = String(candidateMsg.text||''); } else candidateText='(无可用消息)'; var overlay = document.createElement('div'); overlay.id = POPUP_ID; overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);'; overlay.innerHTML = '\n            <div style="width:min(420px,92vw);background:var(--secondary-bg);border-radius:14px;padding:16px;border:1px solid var(--border-color);box-shadow:0 30px 70px rgba(0,0,0,0.36);font-family:var(--font-family);">\n                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">\n                    <div style="width:44px;height:44px;border-radius:8px;background:linear-gradient(135deg,var(--accent-color),rgba(var(--accent-color-rgb),0.85));display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">\n                        <i class="fas fa-book"></i>\n                    </div>\n                    <div>\n                        <div style="font-weight:700;color:var(--text-primary);font-size:15px;">对方向你提议：把这条消息加入对方字卡？</div>\n                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">你可以选择接受，让这条消息成为对方可用的字卡</div>\n                    </div>\n                </div>\n                <div style="padding:10px;border-radius:10px;background:var(--primary-bg);border:1px solid var(--border-color);color:var(--text-primary);font-size:13px;line-height:1.5;max-height:160px;overflow:auto;">' + _escapeHtml(candidateText) + '</div>\n                <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">\n                    <button id="' + POPUP_ID + '-reject" style="padding:9px 12px;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;">拒绝</button>\n                    <button id="' + POPUP_ID + '-accept" style="padding:9px 12px;border-radius:10px;border:none;background:var(--accent-color);color:#fff;cursor:pointer;font-weight:700;">接受并添加</button>\n                </div>\n            </div>\n        '; document.body.appendChild(overlay);
            function cleanup(){ var el = document.getElementById(POPUP_ID); if(el) el.remove(); }
            document.getElementById(POPUP_ID + '-reject').addEventListener('click', function(){ cleanup(); if(typeof showNotification==='function') showNotification('已拒绝','info',1200); });
            document.getElementById(POPUP_ID + '-accept').addEventListener('click', async function(){ cleanup(); if(!candidateText || candidateText==='(无可用消息)'){ if(typeof showNotification==='function') showNotification('没有可用消息可添加','warning',1800); return; } await addPartnerWordcard(candidateText); });
            overlay.addEventListener('click', function(e){ if(e.target===overlay){ overlay.remove(); if(typeof showNotification==='function') showNotification('已取消','info',1000); } });
    }catch(e){ warn('show popup error', e); }
    }

    function maybePromptOnPartnerMessage(partnerMsg){
        try{
            if(!state.enabled) return;
            if(!partnerMsg) return;
            if(partnerMsg.type==='system') return;
            // If this partner message is old or already processed, skip
            if(!_shouldProcessMessage(partnerMsg)) { log('skip old/processed partnerMsg', partnerMsg && (partnerMsg.id || partnerMsg.timestamp)); _markProcessed(partnerMsg); return; }
            var r = Math.random();
            log('maybePrompt chance', r, 'limit', state.chance);
            if(r>state.chance){ _markProcessed(partnerMsg); return; }
            var candidate = findRelevantUserMessage(partnerMsg);
            showPartnerAddPopup(partnerMsg, candidate);
            _markProcessed(partnerMsg);
        }catch(e){ warn('maybePrompt error', e); }
    }

    // installation helpers
    function installAddMessageHook(){
        try{
            if(typeof window.addMessage === 'function' && !window.__pcp_addMessageHooked){
                var orig = window.addMessage;
                window.addMessage = function(msg){
                    try{ var res = orig.apply(this, arguments); }catch(e){ try{ orig(msg); }catch(ee){} }
                    try{
                        // only act on messages that should be processed
                        if(msg && msg.sender && msg.sender !== 'user'){
                            if(_shouldProcessMessage(msg)){
                                log('addMessage hook detected partner msg', msg);
                                maybePromptOnPartnerMessage(msg);
                            } else {
                                log('addMessage hook ignored old/processed msg');
                                _markProcessed(msg);
                            }
                        }
                    }catch(e){}
                    return;
                };
                window.__pcp_addMessageHooked = true;
                log('installed addMessage hook');
                return true;
            }
        }catch(e){ warn('addMessage hook install failed', e); }
        return false;
    }

    // poll messages array for new items
    var _pollHandle = null;
    function startMessagesPoll(){
        try{
            if(_pollHandle) return;
            var lastLen = Array.isArray(window.messages)?window.messages.length:0;
            // mark existing messages processed to avoid bulk prompting on init
            try{ if(Array.isArray(window.messages)){ window.messages.forEach(function(m){ if(m && m.id !== undefined) _processedIds.add(m.id); }); } }catch(e){}

            _pollHandle = setInterval(function(){
                try{
                    var arr = window.messages;
                    if(!Array.isArray(arr)) return;
                    if(arr.length > lastLen){
                        for(var i = lastLen; i < arr.length; i++){
                            var m = arr[i];
                            if(m && m.sender && m.sender !== 'user'){
                                if(_shouldProcessMessage(m)){
                                    log('poll detected partner msg', m);
                                    maybePromptOnPartnerMessage(m);
                                } else {
                                    log('poll ignored old/processed msg', m && (m.id||m.timestamp));
                                    _markProcessed(m);
                                }
                            }
                        }
                        lastLen = arr.length;
                    } else if(arr.length !== lastLen){
                        lastLen = arr.length;
                    }
                }catch(e){}
            }, 800);
            log('started messages poll');
        }catch(e){ warn('startMessagesPoll err', e); }
    }
    function stopMessagesPoll(){ if(_pollHandle){ clearInterval(_pollHandle); _pollHandle=null; log('stopped messages poll'); } }

    // DOM MutationObserver fallback
    var _observer = null;
    function startDOMObserver(){
        try{
            if(_observer) return;
            var selectors = ['#messages','.messages','.message-list','.messages-list','.chat-list','#chat-messages','.conversation'];
            var container = null;
            for(var s of selectors){ var el = document.querySelector(s); if(el){ container = el; log('found message container via selector', s); break; } }
            if(!container){
                var candidates = Array.from(document.querySelectorAll('div'));
                for(var c of candidates){
                    try{ if(c.querySelector && c.querySelector('.message-wrapper, .message')){ container = c; log('found message container by scanning'); break; } }catch(e){}
                }
            }
            if(!container) { log('no message container found for DOM observer'); return; }
            _observer = new MutationObserver(function(muts){
                muts.forEach(function(mu){
                    mu.addedNodes && mu.addedNodes.forEach(function(node){
                        try{
                            if(!node) return;
                            if(node.nodeType!==1) return;
                            var sender = node.getAttribute && (node.getAttribute('data-sender') || node.getAttribute('data-from') || node.getAttribute('data-message-sender'));
                            if(!sender){
                                if(node.classList && (node.classList.contains('message-wrapper')||node.classList.contains('message'))){
                                    var text = node.innerText || '';
                                    var isPartner = !(node.classList.contains('me') || node.classList.contains('from-me') || node.className.indexOf('user')!==-1);
                                    if(isPartner){
                                        var synthetic = { id: Date.now(), text: text, timestamp: new Date().toISOString(), type:'normal', sender: 'partner' };
                                        if(_shouldProcessMessage(synthetic)){
                                            log('DOM observer sees new partner-like node');
                                            maybePromptOnPartnerMessage(synthetic);
                                        } else {
                                            _markProcessed(synthetic);
                                        }
                                    }
                                    return;
                                }
                            } else {
                                if(sender !== 'user' && sender !== 'me'){
                                    var synthetic2 = { id: Date.now(), text: node.innerText||'', timestamp: new Date().toISOString(), type:'normal', sender: sender };
                                    if(_shouldProcessMessage(synthetic2)){
                                        maybePromptOnPartnerMessage(synthetic2);
                                    } else {
                                        _markProcessed(synthetic2);
                                    }
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

    // robust installer that tries multiple strategies and logs status
    function installHooks(){
        if(state.installed) return;
        state.installed = true;
        log('installHooks: starting');
        // mark existing messages as processed (prevent prompts for historic messages)
        try{ if(Array.isArray(window.messages)){ window.messages.forEach(function(m){ if(m && m.id !== undefined) _processedIds.add(m.id); }); } }catch(e){}
        var hooked = installAddMessageHook();
        if(!hooked){
            log('addMessage not available or not hooked — starting poll fallback');
            startMessagesPoll();
        } else {
            log('addMessage hooked — poll fallback still started for resilience');
            startMessagesPoll();
        }
        // always try DOM observer; it's non-invasive
        startDOMObserver();
        // ensure partner-wordcards-list rendered on load
        document.addEventListener('DOMContentLoaded', function(){ renderPartnerWordCards(); });
        log('installHooks: done');
    }

    // wait for app readiness (but don't block forever)
    function waitForReadyAndInstall(){ var tries=0; var maxTries=20; var iv = setInterval(function(){ tries++; try{ if(typeof window.addMessage === 'function' || Array.isArray(window.messages) || document.readyState==='complete'){ clearInterval(iv); installHooks(); return; } if(tries>=maxTries){ clearInterval(iv); installHooks(); return; } }catch(e){} }, 300); }

    // Expose API
    window.PartnerCardPrompt = window.PartnerCardPrompt || {
        setChance: function(p){ state.chance = Math.max(0,Math.min(1,Number(p)||0)); log('chance set to', state.chance); },
        getChance: function(){ return state.chance; },
        enable: function(){ state.enabled=true; },
        disable: function(){ state.enabled=false; },
        forcePromptFor: function(partnerMsg){ log('forcePromptFor called', partnerMsg); maybePromptOnPartnerMessage(partnerMsg); },
        addCard: addPartnerWordcard,
        renderCards: function(){ renderPartnerWordCards(); },
        _debug: { installHooks: installHooks, startMessagesPoll: startMessagesPoll, startDOMObserver: startDOMObserver }
    };

    // auto-install
    try{ waitForReadyAndInstall(); }catch(e){ warn('auto install failed', e); }

    // auto-render if container exists now
    setTimeout(function(){ renderPartnerWordCards(); }, 800);

})();
