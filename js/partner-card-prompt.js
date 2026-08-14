(function(){
  // Config: probability that the partner will ask to add one of your messages
  // e.g. 0.08 = 8% chance after each simulateReply() run
  const OFFER_PROBABILITY_DEFAULT = 1;

  function _escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Core function: choose a random user message and show the offer modal
  window._maybeOfferAddToReplyCard = function(probability) {
    try {
      const p = (typeof probability === 'number') ? probability : OFFER_PROBABILITY_DEFAULT;
      if (Math.random() >= p) return; // not chosen this time

      if (typeof messages === 'undefined' || !Array.isArray(messages) || messages.length === 0) return;
      // pick from any user-sent text messages
      const userMsgs = messages.filter(m => m && m.sender === 'user' && m.text && String(m.text).trim()).map(m => ({ id: m.id, text: String(m.text).trim() }));
      if (!userMsgs.length) return;

      // choose a random one (prefer recent)
      const pool = userMsgs.slice(-120); // limit to last 120 for performance
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      if (!chosen || !chosen.text) return;

      // Build modal
      if (document.getElementById('offer-add-reply-modal')) return; // avoid duplicates
      const overlay = document.createElement('div');
      overlay.id = 'offer-add-reply-modal';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;';
      const inner = document.createElement('div');
      inner.style.cssText = 'width:min(420px,96vw);background:var(--secondary-bg);border-radius:12px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,0.28);border:1px solid var(--border-color);font-family:var(--font-family);';
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

      function close() {
        try { overlay.remove(); } catch(e) {}
      }

      // Accept handler: add to customReplies (主字卡)
     document.getElementById('offer-accept-btn').addEventListener('click', function(){
        try {
          // ensure global fallbacks
          window._customReplies = window._customReplies || [];
          window.customReplies = window.customReplies || window._customReplies;
      
          const normalized = chosen.text.trim();
      
          // check duplicates across possible arrays
          const existsInWindow = Array.isArray(window.customReplies) && window.customReplies.some(r => String(r||'').trim() === normalized);
          const existsInModule = (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) && customReplies.some(r => String(r||'').trim() === normalized);
      
          if (existsInWindow || existsInModule) {
            if (typeof showNotification === 'function') showNotification('该条消息已存在于主字卡中', 'info', 1700);
            close();
            return;
          }
      
          // update in-memory lists
          if (Array.isArray(window.customReplies)) window.customReplies.unshift(normalized);
          window._customReplies = window.customReplies;
      
          if (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) {
            try { customReplies.unshift(normalized); } catch (e) { /* ignore */ }
          }
      
          // persist: prefer saveData (it writes the canonical module variables),
          // otherwise fall back to writing directly to localforage using getStorageKey.
          (async function persist() {
            try {
              if (typeof saveData === 'function') {
                // If module-scoped customReplies doesn't exist, ensure saveData will at least see window._customReplies
                if (typeof customReplies === 'undefined') window._customReplies = window.customReplies;
                await saveData();
              } else if (typeof getStorageKey === 'function' && window.localforage) {
                const key = getStorageKey('customReplies');
                try {
                  const existing = (await localforage.getItem(key)) || [];
                  if (!existing.some(r => String(r||'').trim() === normalized)) {
                    existing.unshift(normalized);
                    await localforage.setItem(key, existing);
                  }
                } catch (e) {
                  // fallback single write
                  try { await localforage.setItem(getStorageKey('customReplies'), window.customReplies); } catch (err) {}
                }
              } else if (window.localforage) {
                // as last resort try to write to a sensible key if getStorageKey isn't available
                try { await localforage.setItem('customReplies', window.customReplies); } catch (e) {}
              }
            } catch (e) {
              console.warn('persist customReplies failed', e);
            }
          })();
      
          // refresh UI if possible
          if (typeof renderReplyLibrary === 'function') {
            try { renderReplyLibrary(); } catch (e) { /* ignore */ }
          }
          if (typeof showNotification === 'function') showNotification('已添加到「主字卡」 ✓', 'success', 2000);
      
        } catch (e) {
          console.warn('[offer-accept] error', e);
          if (typeof showNotification === 'function') showNotification('添加主字卡失败', 'error', 2000);
        } finally {
          close();
        }
      });
      document.getElementById('offer-reject-btn').addEventListener('click', function(){
        close();
        if (typeof showNotification === 'function') showNotification('已拒绝该请求', 'info', 1200);
      });

      // Click outside or ESC closes
      overlay.addEventListener('click', function(e){
        if (e.target === overlay) { close(); }
      });
      document.addEventListener('keydown', function onEsc(e){
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
      });

    } catch (err) {
      console.warn('[maybeOfferAddToReplyCard] error', err);
    }
  };

  // Non-invasive hook: patch simulateReply to trigger offer after it completes.
  // This avoids editing the large simulateReply function directly.
  function _patchSimulateReplyOnce() {
    if (window._simulateReplyPatched) return;
    window._simulateReplyPatched = true;
    const orig = window.simulateReply;
    if (typeof orig !== 'function') return;
    window.simulateReply = function() {
      const res = orig.apply(this, arguments);
      try {
        // Wait a bit so messages have been rendered; then call offer function
        setTimeout(function(){
          try {
            if (typeof window._maybeOfferAddToReplyCard === 'function') {
              window._maybeOfferAddToReplyCard(OFFER_PROBABILITY_DEFAULT);
            }
          } catch(e) { console.warn('offer call failed', e); }
        }, 700);
      } catch(e) {}
      return res;
    };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    _patchSimulateReplyOnce();
  } else {
    document.addEventListener('DOMContentLoaded', _patchSimulateReplyOnce);
  }
})();
