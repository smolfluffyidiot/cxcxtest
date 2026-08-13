var APP_PREFIX = window.APP_PREFIX || ''; // repo may define this already
var STORAGE_KEY = APP_PREFIX + 'partner_wordcards_v1';
var POPUP_ID = 'partner-add-card-popup';
var DEFAULT_CHANCE = 0.12; // default 12% chance

var state = {
    chance: DEFAULT_CHANCE,
    lastMessagesLen: (Array.isArray(window.messages) ? window.messages.length : 0),
    enabled: true
};

// Utilities ----------------------------------------------------------------

function _nowISO() { return (new Date()).toISOString(); }
function _escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// storage helpers (localforage preferred)
async function _getStored() {
    try {
        if (window.localforage) {
            var v = await localforage.getItem(STORAGE_KEY);
            return Array.isArray(v) ? v : [];
        } else {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        }
    } catch (e) { console.warn('[PartnerCardPrompt] read store fail', e); return []; }
}
async function _setStored(arr) {
    try {
        if (window.localforage) {
            await localforage.setItem(STORAGE_KEY, arr);
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
        }
    } catch (e) { console.warn('[PartnerCardPrompt] write store fail', e); }
}

// core: add new partner wordcard
async function addPartnerWordcard(text) {
    if (!text || !String(text).trim()) return false;
    var arr = await _getStored();
    // avoid duplicates (simple check)
    if (arr.some(function(c){ return c.text === text; })) return false;
    var item = { id: Date.now(), text: text, createdAt: _nowISO() };
    arr.unshift(item);
    await _setStored(arr);
    renderPartnerWordCards(arr);
    if (typeof showNotification === 'function') showNotification('已添加到对方字卡 ✓', 'success', 1800);
    return true;
}

// UI render for partner cards list if DOM element present
function renderPartnerWordCards(list) {
    list = list || null;
    if (!list) {
        _getStored().then(function(arr){ renderPartnerWordCards(arr); }).catch(function(){});
        return;
    }
    var el = document.getElementById('partner-wordcards-list');
    if (!el) return; // nothing to update
    el.innerHTML = '';
    if (!list.length) {
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
        delBtn.addEventListener('click', async function() {
            if (!confirm('确认删除该字卡？')) return;
            var arr = await _getStored();
            var idx = arr.findIndex(function(x){ return x.id === item.id; });
            if (idx >= 0) {
                arr.splice(idx,1);
                await _setStored(arr);
                renderPartnerWordCards(arr);
                if (typeof showNotification === 'function') showNotification('已删除', 'info', 1200);
            }
        });
        el.appendChild(row);
    });
}

// find the latest user message BEFORE the given partner msg (or globally)
function findRelevantUserMessage(partnerMsg) {
    var msgs = Array.isArray(window.messages) ? window.messages : [];
    if (!msgs.length) return null;
    // find index of partner message (by id or timestamp) to search backward
    var idx = -1;
    if (partnerMsg && partnerMsg.id !== undefined) {
        idx = msgs.findIndex(function(m){ return m.id === partnerMsg.id; });
    }
    if (idx === -1 && partnerMsg && partnerMsg.timestamp) {
        for (var i = 0; i < msgs.length; i++) {
            if (String(msgs[i].timestamp) === String(partnerMsg.timestamp)) { idx = i; break; }
        }
    }
    // start searching one before idx; otherwise from end
    var start = (idx > 0) ? idx - 1 : msgs.length - 1;
    for (var j = start; j >= 0; j--) {
        var m = msgs[j];
        if (!m) continue;
        if (m.sender === 'user' && m.type !== 'system' && (m.text || m.image)) {
            return m;
        }
    }
    // fallback: any user message anywhere
    for (var k = msgs.length - 1; k >= 0; k--) {
        var mm = msgs[k];
        if (mm && mm.sender === 'user' && mm.type !== 'system' && (mm.text || mm.image)) return mm;
    }
    return null;
}

// Build and show popup asking to add the message to partner wordcards
function showPartnerAddPopup(partnerMsg, candidateMsg) {
    // ensure only one popup
    if (document.getElementById(POPUP_ID)) return;

    var candidateText = '';
    if (candidateMsg) {
        if (candidateMsg.text) candidateText = candidateMsg.text;
        else if (candidateMsg.image) candidateText = '[图片] ' + (candidateMsg.note || '');
        else candidateText = String(candidateMsg.text || '');
    } else {
        candidateText = '(无可用消息)';
    }

    var overlay = document.createElement('div');
    overlay.id = POPUP_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);';
    overlay.innerHTML = `
        <div style="width:min(420px,92vw);background:var(--secondary-bg);border-radius:14px;padding:16px;border:1px solid var(--border-color);box-shadow:0 30px 70px rgba(0,0,0,0.36);font-family:var(--font-family);">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                <div style="width:44px;height:44px;border-radius:8px;background:linear-gradient(135deg,var(--accent-color),rgba(var(--accent-color-rgb),0.85));display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">
                    <i class="fas fa-book"></i>
                </div>
                <div>
                    <div style="font-weight:700;color:var(--text-primary);font-size:15px;">对方向你提议：把这条消息加入对方字卡？</div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">你可以选择接受，让这条消息成为对方可用的字卡</div>
                </div>
            </div>
            <div style="padding:10px;border-radius:10px;background:var(--primary-bg);border:1px solid var(--border-color);color:var(--text-primary);font-size:13px;line-height:1.5;max-height:160px;overflow:auto;">${_escapeHtml(candidateText)}</div>
            <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
                <button id="${POPUP_ID}-reject" style="padding:9px 12px;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;">拒绝</button>
                <button id="${POPUP_ID}-accept" style="padding:9px 12px;border-radius:10px;border:none;background:var(--accent-color);color:#fff;cursor:pointer;font-weight:700;">接受并添加</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    function cleanup() {
        var el = document.getElementById(POPUP_ID);
        if (el) el.remove();
    }

    document.getElementById(POPUP_ID + '-reject').addEventListener('click', function(){
        cleanup();
        if (typeof showNotification === 'function') showNotification('已拒绝', 'info', 1200);
    });
    document.getElementById(POPUP_ID + '-accept').addEventListener('click', async function(){
        // Accept: add the candidate text into partner wordcards
        cleanup();
        if (!candidateText || candidateText === '(无可用消息)') {
            if (typeof showNotification === 'function') showNotification('没有可用消息可添加', 'warning', 1800);
            return;
        }
        await addPartnerWordcard(candidateText);
    });

    // click outside to close (reject)
    overlay.addEventListener('click', function(e){
        if (e.target === overlay) { overlay.remove(); if (typeof showNotification === 'function') showNotification('已取消', 'info', 1000); }
    });
}

// Decide whether to prompt given a partner message
function maybePromptOnPartnerMessage(partnerMsg) {
    try {
        if (!state.enabled) return;
        // Don't prompt for system messages or for images only (optional)
        if (!partnerMsg) return;
        if (partnerMsg.type === 'system') return;
        // Random chance
        var r = Math.random();
        if (r > state.chance) return;
        // Find a candidate user message
        var candidate = findRelevantUserMessage(partnerMsg);
        // Show popup
        showPartnerAddPopup(partnerMsg, candidate);
    } catch (e) { console.warn('[PartnerCardPrompt] maybePrompt error', e); }
}

// Monkey-patch addMessage if exists
(function installAddMessageHook() {
    try {
        if (typeof window.addMessage === 'function') {
            var orig = window.addMessage;
            window.addMessage = function(msg) {
                try { orig.apply(this, arguments); } catch (e) { try { orig(msg); } catch (ee) { console.warn('orig addMessage failed', ee); } }
                try {
                    if (msg && msg.sender && msg.sender !== 'user') {
                        // partner message arrived
                        maybePromptOnPartnerMessage(msg);
                    }
                } catch (e) {}
            };
        } else {
            // fallback: observe messages array growth by polling
            state.lastMessagesLen = Array.isArray(window.messages) ? window.messages.length : 0;
            setInterval(function(){
                try {
                    var arr = window.messages;
                    if (!Array.isArray(arr)) return;
                    if (arr.length > state.lastMessagesLen) {
                        // new messages appended
                        for (var i = state.lastMessagesLen; i < arr.length; i++) {
                            var m = arr[i];
                            if (m && m.sender && m.sender !== 'user') {
                                maybePromptOnPartnerMessage(m);
                            }
                        }
                        state.lastMessagesLen = arr.length;
                    } else if (arr.length !== state.lastMessagesLen) {
                        state.lastMessagesLen = arr.length;
                    }
                } catch (e) {}
            }, 900);
        }
    } catch (e) { console.warn('[PartnerCardPrompt] install hook failed', e); }
})();

// Public API ---------------------------------------------------------------

window.PartnerCardPrompt = {
    setChance: function(p) { state.chance = Math.max(0, Math.min(1, Number(p) || 0)); },
    getChance: function() { return state.chance; },
    enable: function() { state.enabled = true; },
    disable: function() { state.enabled = false; },
    forcePromptFor: function(partnerMsg) { maybePromptOnPartnerMessage(partnerMsg); },
    addCard: addPartnerWordcard,
    renderCards: function(){ renderPartnerWordCards(); }
};

// Auto-render stored cards at DOMContentLoaded if list exists
document.addEventListener('DOMContentLoaded', function(){
    if (document.getElementById('partner-wordcards-list')) {
        renderPartnerWordCards();
    }
});
