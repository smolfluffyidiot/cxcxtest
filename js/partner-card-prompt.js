(function(){
  const OFFER_PROBABILITY_DEFAULT = 1;

  function _escHtml(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // robust persistence helper: tries saveData(), then localforage with session key; if SESSION_ID missing,
  // schedules a poll to flush later. Also keeps a localStorage pending backup as last resort.
  function persistCustomRepliesSoon() {
    try {
      if (typeof saveData === 'function') {
        try { saveData(); } catch(e){ /* saveData may return early if SESSION_ID not ready */ }
      }
    } catch(e){}

    // If SESSION_ID exists try to write session-keyed storage directly
    try {
      if (typeof SESSION_ID !== 'undefined' && SESSION_ID && typeof getStorageKey === 'function' && typeof localforage !== 'undefined') {
        try {
          // prefer using the actual customReplies var if present, fallback to window.customReplies
          var toWrite = (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) ? customReplies :
                        (Array.isArray(window.customReplies) ? window.customReplies : (Array.isArray(window._customReplies) ? window._customReplies : []));
          localforage.setItem(getStorageKey('customReplies'), toWrite).catch(()=>{});
          // also update _customReplies mirror
          window._customReplies = toWrite;
          return;
        } catch(e){}
      }
    } catch(e){}

    // fallback: keep pending in localStorage and poll until SESSION_ID available
    try {
      var pending = (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) ? customReplies :
                    (Array.isArray(window.customReplies) ? window.customReplies : (Array.isArray(window._customReplies) ? window._customReplies : []));
      localStorage.setItem('_pending_custom_replies', JSON.stringify(pending || []));
    } catch(e){}

    if (window._pendingCustomRepliesFlushInterval) return;
    let tries = 0;
    window._pendingCustomRepliesFlushInterval = setInterval(function(){
      tries++;
      try {
        if (typeof SESSION_ID !== 'undefined' && SESSION_ID) {
          // flush pending
          if (window._pendingCustomRepliesFlushInterval) {
            clearInterval(window._pendingCustomRepliesFlushInterval);
            window._pendingCustomRepliesFlushInterval = null;
          }
          try { if (typeof saveData === 'function') saveData(); } catch(e){}
          try {
            if (typeof getStorageKey === 'function' && typeof localforage !== 'undefined') {
              var toWrite = (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) ? customReplies :
                            (Array.isArray(window.customReplies) ? window.customReplies : (Array.isArray(window._customReplies) ? window._customReplies : []));
              localforage.setItem(getStorageKey('customReplies'), toWrite).catch(()=>{});
              window._customReplies = toWrite;
            }
          } catch(e){}
          try { localStorage.removeItem('_pending_custom_replies'); } catch(e){}
        } else if (tries > 40) { // give up after ~20s
          if (window._pendingCustomRepliesFlushInterval) { clearInterval(window._pendingCustomRepliesFlushInterval); window._pendingCustomRepliesFlushInterval = null; }
        }
      } catch(e){}
    }, 500);
  }

  // core: maybe show offer modal for adding one of user's previous messages
  window._maybeOfferAddToReplyCard = function(probability) {
    try {
      const p = (typeof probability === 'number') ? probability : OFFER_PROBABILITY_DEFAULT;
      if (Math.random() >= p) return;

      if (!Array.isArray(window.messages) || window.messages.length === 0) return;
      const userMsgs = window.messages
        .filter(m => m && m.sender === 'user' && m.text && String(m.text).trim())
        .map(m => ({ id: m.id, text: String(m.text).trim() }));
      if (!userMsgs.length) return;

      const pool = userMsgs.slice(-120);
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      if (!chosen || !chosen.text) return;

      if (document.getElementById('offer-add-reply-modal')) return;

      const overlay = document.createElement('div');
      overlay.id = 'offer-add-reply-modal';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;';
      const inner = document.createElement('div');
      inner.style.cssText = 'width:min(480px,96vw);background:var(--secondary-bg);border-radius:12px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,0.28);border:1px solid var(--border-color);font-family:var(--font-family);';
      inner.innerHTML = ''
        + '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;">'
        +   '<div style="width:44px;height:44px;border-radius:8px;background:linear-gradient(135deg,var(--accent-color),rgba(var(--accent-color-rgb),0.9));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px;">对方</div>'
        +   '<div style="flex:1;">'
        +     '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">想把你的话加入到「主字卡」</div>'
        +     '<div style="font-size:13px;color:var(--text-secondary);">对方想把下面的一条你发出的消息存为主字卡，是否允许？</div>'
        +   '</div>'
        + '</div>'
        + '<div style="background:var(--primary-bg);border-radius:10px;padding:12px;margin:8px 0 14px;border:1px dashed rgba(var(--accent-color-rgb),0.12);max-height:180px;overflow:auto;color:var(--text-primary);font-size:14px;">'
        +   '<div style="white-space:pre-wrap;word-break:break-word;">' + _escHtml(chosen.text) + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:10px;justify-content:flex-end;">'
        +   '<button id="offer-reject-btn" style="padding:9px 12px;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;">拒绝</button>'
        +   '<button id="offer-accept-btn" style="padding:9px 12px;border-radius:10px;border:none;background:var(--accent-color);color:#fff;font-weight:700;cursor:pointer;">接受并添加到主字卡</button>'
        + '</div>';
      overlay.appendChild(inner);
      document.body.appendChild(overlay);

      function close() { try { overlay.remove(); } catch(e){} }

      document.getElementById('offer-reject-btn').addEventListener('click', function(){
        close();
        if (typeof showNotification === 'function') showNotification('已拒绝该请求', 'info', 1200);
      });

      document.getElementById('offer-accept-btn').addEventListener('click', function(){
        try {
          // Determine the authoritative array reference for custom replies.
          // Prefer the actual variable `customReplies` if present (this is what core uses).
          var targetArr;
          if (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) {
            targetArr = customReplies;
          } else if (Array.isArray(window.customReplies)) {
            targetArr = window.customReplies;
            // Also set a global variable named customReplies for compatibility
            try { customReplies = window.customReplies; } catch(e) {}
          } else if (Array.isArray(window._customReplies)) {
            targetArr = window._customReplies;
            try { customReplies = window._customReplies; } catch(e) {}
          } else {
            // create a top-level customReplies variable (global)
            try { customReplies = []; targetArr = customReplies; } catch(e){ targetArr = []; }
          }

          const normalized = chosen.text.trim();
          // Avoid exact duplicates
          const exists = targetArr.some(r => String(r||'').trim() === normalized);
          if (!exists) {
            // add to front so partner will likely use it soon
            targetArr.unshift(normalized);

            // ensure mirrors updated
            window.customReplies = targetArr;
            window._customReplies = targetArr;

            // persist immediately
            try {
              if (typeof saveData === 'function') {
                saveData();
              }
            } catch(e) { console.warn('saveData failed after adding custom reply', e); }

            // also write directly to localforage if possible (session-scoped)
            try {
              if (typeof getStorageKey === 'function' && typeof localforage !== 'undefined' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
                localforage.setItem(getStorageKey('customReplies'), targetArr).catch(()=>{});
              }
            } catch(e){}

            // final safety: schedule flush/persist
            persistCustomRepliesSoon();

            // refresh UI if library renderer exists
            try { if (typeof renderReplyLibrary === 'function') renderReplyLibrary(); } catch(e){}

            if (typeof showNotification === 'function') showNotification('已添加到「主字卡」 ✓', 'success', 2000);
          } else {
            if (typeof showNotification === 'function') showNotification('该条消息已存在于主字卡中', 'info', 1700);
          }
        } catch (e) {
          console.warn('[offer-accept] error', e);
          if (typeof showNotification === 'function') showNotification('添加主字卡失败', 'error', 2000);
        } finally {
          close();
        }
      });

      overlay.addEventListener('click', function(e){
        if (e.target === overlay) close();
      });
      document.addEventListener('keydown', function onEsc(e){
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
      });
    } catch (err) {
      console.warn('[maybeOfferAddToReplyCard] error', err);
    }
  };

  // patch simulateReply to call offer after partner replies (non-invasive)
  function _patchSimulateReplyOnce() {
    if (window._simulateReplyPatched) return;
    window._simulateReplyPatched = true;
    const orig = window.simulateReply;
    if (typeof orig !== 'function') return;
    window.simulateReply = function() {
      const res = orig.apply(this, arguments);
      try {
        setTimeout(function(){
          try { if (typeof window._maybeOfferAddToReplyCard === 'function') window._maybeOfferAddToReplyCard(OFFER_PROBABILITY_DEFAULT); } catch(e){}
        }, 700);
      } catch(e){}
      return res;
    };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    _patchSimulateReplyOnce();
  } else {
    document.addEventListener('DOMContentLoaded', _patchSimulateReplyOnce);
  }

  // If there are pending custom replies left in localStorage from earlier fallback, restore them into session store when ready
  (function flushPendingOnReady(){
    try {
      const raw = localStorage.getItem('_pending_custom_replies');
      if (!raw) return;
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch(e){}
      if (!Array.isArray(parsed)) return;
      const tryFlush = function(){
        if (typeof SESSION_ID !== 'undefined' && SESSION_ID) {
          try {
            if (typeof getStorageKey === 'function' && typeof localforage !== 'undefined') {
              localforage.setItem(getStorageKey('customReplies'), parsed).catch(()=>{});
            }
            // also set runtime
            try { customReplies = parsed; } catch(e){}
            window.customReplies = parsed;
            window._customReplies = parsed;
            try { if (typeof renderReplyLibrary === 'function') renderReplyLibrary(); } catch(e){}
            localStorage.removeItem('_pending_custom_replies');
            return true;
          } catch(e){}
        }
        return false;
      };
      if (!tryFlush()) {
        const poll = setInterval(function(){
          if (tryFlush()) { clearInterval(poll); }
        }, 500);
        setTimeout(function(){ clearInterval(poll); }, 20000);
      }
    } catch(e){}
  })();

})();
