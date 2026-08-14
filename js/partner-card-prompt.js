(function(){
  // Configuration: change probability (0..1) as needed. Set to 1.0 for testing.
  const OFFER_PROBABILITY_DEFAULT = 1;

  function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // Try to persist customReplies: call saveData(), then try localforage with session key, fallback to localStorage pending.
  function persistCustomReplies() {
    try { if (typeof saveData === 'function') saveData(); } catch(e){ /* ignore */ }

    try {
      if (typeof getStorageKey === 'function' && typeof localforage !== 'undefined' && typeof SESSION_ID !== 'undefined' && SESSION_ID) {
        const arr = (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) ? customReplies
                  : (Array.isArray(window.customReplies) ? window.customReplies : (Array.isArray(window._customReplies) ? window._customReplies : []));
        localforage.setItem(getStorageKey('customReplies'), arr).catch(()=>{});
        window._customReplies = arr;
        return;
      }
    } catch(e){}

    try { localStorage.setItem('_pending_custom_replies', JSON.stringify((window.customReplies||window._customReplies||customReplies||[]))); } catch(e){}
  }

  // Show modal and handle accept/reject
  function showOfferModal(messageText) {
    if (document.getElementById('offer-add-reply-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'offer-add-reply-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:120000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;';
    const inner = document.createElement('div');
    inner.style.cssText = 'width:min(520px,96vw);background:var(--secondary-bg);border-radius:12px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.28);border:1px solid var(--border-color);font-family:var(--font-family);';
    inner.innerHTML = ''
      + '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;">'
      +   '<div style="width:44px;height:44px;border-radius:8px;background:linear-gradient(135deg,var(--accent-color),rgba(var(--accent-color-rgb),0.9));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px;">对方</div>'
      +   '<div style="flex:1;">'
      +     '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">想把你的话加入到「主字卡」</div>'
      +     '<div style="font-size:13px;color:var(--text-secondary);">对方想把下面的一条你发出的消息存为主字卡，是否允许？</div>'
      +   '</div>'
      + '</div>'
      + '<div style="background:var(--primary-bg);border-radius:10px;padding:12px;margin:8px 0 14px;border:1px dashed rgba(var(--accent-color-rgb),0.12);max-height:180px;overflow:auto;color:var(--text-primary);font-size:14px;">'
      +   '<div style="white-space:pre-wrap;word-break:break-word;">' + escHtml(messageText) + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end;">'
      +   '<button id="offer-reject-btn" style="padding:9px 12px;border-radius:10px;border:1px solid var(--border-color);background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;">拒绝</button>'
      +   '<button id="offer-accept-btn" style="padding:9px 12px;border-radius:10px;border:none;background:var(--accent-color);color:#fff;font-weight:700;cursor:pointer;">接受并添加到主字卡</button>'
      + '</div>';
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    function close(){ try{ overlay.remove(); }catch(e){} }

    document.getElementById('offer-reject-btn').addEventListener('click', function(){ close(); if (typeof showNotification === 'function') showNotification('已拒绝该请求', 'info', 1200); });
    document.getElementById('offer-accept-btn').addEventListener('click', function(){
      try {
        // Choose authoritative array: prefer top-level customReplies variable (what core uses)
        var arr;
        if (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) {
          arr = customReplies;
        } else if (Array.isArray(window.customReplies)) {
          arr = window.customReplies;
          try { customReplies = window.customReplies; } catch(e){}
        } else if (Array.isArray(window._customReplies)) {
          arr = window._customReplies;
          try { customReplies = window._customReplies; } catch(e){}
        } else {
          try { customReplies = []; arr = customReplies; } catch(e){ arr = window.customReplies = window._customReplies = []; }
        }

        const normalized = String(messageText).trim();
        if (!normalized) { if (typeof showNotification === 'function') showNotification('无效消息，无法添加', 'warning'); close(); return; }

        const exists = arr.some(x => String(x||'').trim() === normalized);
        if (!exists) {
          arr.unshift(normalized);
          // mirrors
          window.customReplies = arr;
          window._customReplies = arr;
          try { persistCustomReplies(); } catch(e){ console.warn('persist failed', e); }
          try { if (typeof renderReplyLibrary === 'function') renderReplyLibrary(); } catch(e){}
          if (typeof showNotification === 'function') showNotification('已添加到「主字卡」 ✓', 'success', 1800);
        } else {
          if (typeof showNotification === 'function') showNotification('该条消息已存在于主字卡中', 'info', 1500);
        }
      } catch (err) {
        console.warn('offer accept error', err);
        if (typeof showNotification === 'function') showNotification('添加失败', 'error', 1500);
      } finally { close(); }
    });

    overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onEsc(e){ if (e.key === 'Escape') { try{ overlay.remove(); }catch(e){} document.removeEventListener('keydown', onEsc); } });
  }

  // Main: pick a random previous user message and maybe show modal
  function maybeOffer(prob) {
    try {
      const p = (typeof prob === 'number') ? prob : OFFER_PROBABILITY_DEFAULT;
      if (Math.random() >= p) return;
      if (!Array.isArray(window.messages) || !window.messages.length) return;

      // pick recent user messages with text
      const userMsgs = window.messages.filter(m=>m && m.sender==='user' && m.text && String(m.text).trim());
      if (!userMsgs.length) return;
      const pool = userMsgs.slice(-200); // last up to 200
      const chosen = pool[Math.floor(Math.random()*pool.length)];
      if (!chosen || !chosen.text) return;
      showOfferModal(chosen.text);
    } catch(e){ console.warn('maybeOffer error', e); }
  }

  // Expose manual trigger for testing
  window.offerAddToReplyNow = function(){ maybeOffer(1.0); };

  // Patch simulateReply when available (poll if needed)
  function tryPatchSimulateReply() {
    if (window._simulateReplyPatched) return true;
    if (typeof window.simulateReply === 'function') {
      const orig = window.simulateReply;
      window.simulateReply = function(){ const r = orig.apply(this, arguments); try{ setTimeout(()=>maybeOffer(), 700); }catch(e){}; return r; };
      window._simulateReplyPatched = true;
      return true;
    }
    return false;
  }
  (function pollPatch(){ if (tryPatchSimulateReply()) return; let tries=0; const t=setInterval(()=>{ tries++; if (tryPatchSimulateReply()){ clearInterval(t); } if (tries>40) clearInterval(t); }, 300); })();

  // Also wrap/attach to _onPartnerMessage hook if present so offers can be triggered when partner speaks
  (function attachPartnerHook(){
    try {
      if (typeof window._onPartnerMessage === 'function') {
        const orig = window._onPartnerMessage;
        window._onPartnerMessage = function(msg){
          try{ orig.call(this, msg); }catch(e){ console.warn(e); }
          try{ setTimeout(()=>maybeOffer(), 700); }catch(e){}
        };
      } else {
        // define a simple hook used by core when adding partner messages; if core later overwrites, it's fine.
        window._onPartnerMessage = function(msg){ try{ setTimeout(()=>maybeOffer(), 700); }catch(e){} };
      }
    } catch(e){ console.warn('attachPartnerHook', e); }
  })();

  // If there is a pending localStorage copy of replies (fallback), attempt to flush it into session storage when SESSION_ID is ready
  (function flushPending(){
    try {
      const raw = localStorage.getItem('_pending_custom_replies');
      if (!raw) return;
      let parsed = null; try{ parsed = JSON.parse(raw); }catch(e){}
      if (!Array.isArray(parsed)) return;
      const tryFlush = function(){
        if (typeof SESSION_ID !== 'undefined' && SESSION_ID && typeof getStorageKey === 'function' && typeof localforage !== 'undefined') {
          try { localforage.setItem(getStorageKey('customReplies'), parsed).catch(()=>{}); }catch(e){}
          try { customReplies = parsed; }catch(e){}
          window.customReplies = parsed; window._customReplies = parsed;
          try { if (typeof renderReplyLibrary === 'function') renderReplyLibrary(); }catch(e){}
          localStorage.removeItem('_pending_custom_replies');
          return true;
        }
        return false;
      };
      if (!tryFlush()) {
        const poll = setInterval(()=>{ if (tryFlush()) clearInterval(poll); }, 500);
        setTimeout(()=>clearInterval(poll), 20000);
      }
    } catch(e){}
  })();

})();
