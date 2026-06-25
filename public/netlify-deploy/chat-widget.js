(function () {
  'use strict';

  if (window.__cfWidgetInit) return;
  window.__cfWidgetInit = true;

  // ── Inject styles ─────────────────────────────────────────────────────────────
  var css = [
    '#cf-widget { position:fixed; bottom:24px; right:24px; z-index:9999; font-family:\'DM Sans\',system-ui,sans-serif; }',

    // Launcher button
    '#cf-launcher { width:60px; height:60px; border-radius:50%; background:#c8a84b; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 32px rgba(0,0,0,0.45),0 2px 8px rgba(200,168,75,0.3); transition:transform .2s,background .2s; position:relative; }',
    '#cf-launcher:hover { background:#e8c96a; transform:scale(1.06); }',
    '#cf-launcher svg { width:26px; height:26px; fill:none; stroke:#060d1a; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }',

    // Notification badge
    '#cf-badge { position:absolute; top:-3px; right:-3px; width:16px; height:16px; background:#e05252; border-radius:50%; border:2px solid #060d1a; display:none; animation:cfPulse 1.5s ease infinite; }',
    '#cf-badge.visible { display:block; }',
    '@keyframes cfPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.2);opacity:0.8} }',

    // Tooltip
    '#cf-launcher .cf-tooltip { position:absolute; bottom:68px; right:0; background:#0d1f38; color:#f0ece3; font-size:12px; white-space:nowrap; padding:7px 12px; border-radius:8px; border:1px solid rgba(200,168,75,0.2); opacity:0; pointer-events:none; transition:opacity .2s; }',
    '#cf-launcher:hover .cf-tooltip { opacity:1; }',
    '#cf-launcher .cf-tooltip::after { content:\'\'; position:absolute; top:100%; right:22px; border:5px solid transparent; border-top-color:#0d1f38; }',

    // Chat window
    '#cf-window { position:absolute; bottom:72px; right:0; width:380px; height:520px; background:#0a1628; border:1px solid rgba(200,168,75,0.3); border-radius:20px; box-shadow:0 24px 80px rgba(0,0,0,0.7),0 4px 24px rgba(0,0,0,0.4); display:none; flex-direction:column; overflow:hidden; }',
    '#cf-window.open { display:flex; }',

    // Header
    '#cf-header { padding:16px 20px; background:#060d1a; border-bottom:1px solid rgba(255,255,255,0.07); display:flex; align-items:center; gap:12px; flex-shrink:0; }',
    '#cf-header-avatar { width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg,#c8a84b,#e8c96a); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:#060d1a; flex-shrink:0; }',
    '#cf-header-info { flex:1; }',
    '#cf-header-name { font-size:14px; font-weight:600; color:#f0ece3; }',
    '#cf-header-status { display:flex; align-items:center; gap:5px; font-size:11px; color:#3dbe8a; margin-top:2px; }',
    '#cf-header-status-dot { width:6px; height:6px; border-radius:50%; background:#3dbe8a; animation:cfPulse 2s ease infinite; flex-shrink:0; }',
    '#cf-close { background:none; border:none; cursor:pointer; color:#6b7a8d; padding:4px; border-radius:6px; display:flex; align-items:center; transition:color .15s; }',
    '#cf-close:hover { color:#f0ece3; }',
    '#cf-close svg { width:18px; height:18px; }',

    // Messages area
    '#cf-messages { flex:1; overflow-y:auto; padding:16px 16px 8px; display:flex; flex-direction:column; gap:10px; scroll-behavior:smooth; }',
    '#cf-messages::-webkit-scrollbar { width:4px; }',
    '#cf-messages::-webkit-scrollbar-track { background:transparent; }',
    '#cf-messages::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }',

    // Message bubbles
    '.cf-msg { max-width:82%; padding:10px 14px; border-radius:16px; font-size:14px; line-height:1.55; animation:cfFadeIn .3s ease; }',
    '@keyframes cfFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }',
    '.cf-msg.bot { background:#0d1f38; color:#d0ccc4; border:1px solid rgba(255,255,255,0.07); border-radius:4px 16px 16px 16px; align-self:flex-start; }',
    '.cf-msg.user { background:rgba(200,168,75,0.18); color:#f0ece3; border:1px solid rgba(200,168,75,0.25); border-radius:16px 16px 4px 16px; align-self:flex-end; }',

    // Typing indicator
    '#cf-typing { display:none; align-items:center; gap:5px; padding:10px 14px; background:#0d1f38; border:1px solid rgba(255,255,255,0.07); border-radius:4px 16px 16px 16px; align-self:flex-start; width:fit-content; }',
    '#cf-typing.show { display:flex; }',
    '.cf-typing-dot { width:6px; height:6px; border-radius:50%; background:#6b7a8d; }',
    '.cf-typing-dot:nth-child(1){animation:cfBounce 1s ease 0s infinite}',
    '.cf-typing-dot:nth-child(2){animation:cfBounce 1s ease .18s infinite}',
    '.cf-typing-dot:nth-child(3){animation:cfBounce 1s ease .36s infinite}',
    '@keyframes cfBounce { 0%,100%{transform:translateY(0);opacity:.4} 50%{transform:translateY(-5px);opacity:1} }',

    // Quick replies
    '#cf-quick-replies { padding:8px 16px; display:none; flex-wrap:wrap; gap:6px; flex-shrink:0; }',
    '#cf-quick-replies.show { display:flex; }',
    '.cf-qr { background:transparent; border:1px solid rgba(200,168,75,0.3); color:#c8a84b; font-size:12px; padding:6px 11px; border-radius:20px; cursor:pointer; transition:all .15s; white-space:nowrap; font-family:inherit; }',
    '.cf-qr:hover { background:rgba(200,168,75,0.1); border-color:#c8a84b; }',

    // Email capture
    '#cf-email-capture { padding:12px 16px; background:#0d1f38; border-top:1px solid rgba(255,255,255,0.07); display:none; flex-direction:column; gap:8px; flex-shrink:0; }',
    '#cf-email-capture.show { display:flex; }',
    '#cf-email-capture p { font-size:13px; color:#d0ccc4; line-height:1.45; }',
    '#cf-email-row { display:flex; gap:6px; }',
    '#cf-email-input { flex:1; padding:9px 12px; background:#060d1a; border:1px solid rgba(255,255,255,0.12); border-radius:8px; font-size:13px; color:#f0ece3; font-family:inherit; outline:none; transition:border .15s; }',
    '#cf-email-input:focus { border-color:#c8a84b; }',
    '#cf-email-input::placeholder { color:#4a566a; }',
    '#cf-email-submit { padding:9px 14px; background:#c8a84b; color:#060d1a; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; transition:background .15s; white-space:nowrap; font-family:inherit; }',
    '#cf-email-submit:hover { background:#e8c96a; }',

    // Input area
    '#cf-input-area { padding:12px 16px; border-top:1px solid rgba(255,255,255,0.07); display:flex; gap:8px; align-items:flex-end; flex-shrink:0; background:#060d1a; }',
    '#cf-input { flex:1; padding:10px 14px; background:#0d1f38; border:1px solid rgba(255,255,255,0.1); border-radius:12px; font-size:14px; color:#f0ece3; font-family:inherit; outline:none; resize:none; min-height:42px; max-height:100px; line-height:1.4; transition:border .15s; }',
    '#cf-input:focus { border-color:rgba(200,168,75,0.4); }',
    '#cf-input::placeholder { color:#4a566a; }',
    '#cf-send { width:38px; height:38px; background:#c8a84b; border:none; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s,transform .1s; flex-shrink:0; }',
    '#cf-send:hover { background:#e8c96a; transform:scale(1.05); }',
    '#cf-send svg { width:16px; height:16px; fill:none; stroke:#060d1a; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; }',

    // Mobile
    '@media(max-width:440px){ #cf-window{width:calc(100vw - 32px); right:-8px;} }',
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Build HTML ────────────────────────────────────────────────────────────────
  var container = document.createElement('div');
  container.id = 'cf-widget';
  container.innerHTML = [
    '<button id="cf-launcher" aria-label="Open chat">',
    '  <span class="cf-tooltip">Ask us anything</span>',
    '  <div id="cf-badge"></div>',
    '  <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    '</button>',
    '<div id="cf-window" role="dialog" aria-label="ClinicFlow chat">',
    '  <div id="cf-header">',
    '    <div id="cf-header-avatar">CF</div>',
    '    <div id="cf-header-info">',
    '      <div id="cf-header-name">ClinicFlow Assistant</div>',
    '      <div id="cf-header-status"><div id="cf-header-status-dot"></div>Online</div>',
    '    </div>',
    '    <button id="cf-close" aria-label="Close chat">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    '    </button>',
    '  </div>',
    '  <div id="cf-messages">',
    '    <div id="cf-typing"><div class="cf-typing-dot"></div><div class="cf-typing-dot"></div><div class="cf-typing-dot"></div></div>',
    '  </div>',
    '  <div id="cf-quick-replies">',
    '    <button class="cf-qr" data-q="How does it work?">How does it work?</button>',
    '    <button class="cf-qr" data-q="What does it cost?">What does it cost?</button>',
    '    <button class="cf-qr" data-q="How long is setup?">How long is setup?</button>',
    '    <button class="cf-qr" data-q="Works with Jane App?">Works with Jane App?</button>',
    '  </div>',
    '  <div id="cf-email-capture">',
    '    <p>Want me to send you a free audit showing what your clinic could recover? Drop your email ↓</p>',
    '    <div id="cf-email-row">',
    '      <input id="cf-email-input" type="email" placeholder="you@yourclinic.ca" autocomplete="email"/>',
    '      <button id="cf-email-submit">Send it →</button>',
    '    </div>',
    '  </div>',
    '  <div id="cf-input-area">',
    '    <textarea id="cf-input" placeholder="Ask anything…" rows="1" aria-label="Message"></textarea>',
    '    <button id="cf-send" aria-label="Send message">',
    '      <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    '    </button>',
    '  </div>',
    '</div>',
  ].join('');
  document.body.appendChild(container);

  // ── Element refs ──────────────────────────────────────────────────────────────
  var launcher = document.getElementById('cf-launcher');
  var badge    = document.getElementById('cf-badge');
  var window_  = document.getElementById('cf-window');
  var messages = document.getElementById('cf-messages');
  var typing   = document.getElementById('cf-typing');
  var quickReplies = document.getElementById('cf-quick-replies');
  var emailCapture = document.getElementById('cf-email-capture');
  var emailInput  = document.getElementById('cf-email-input');
  var emailSubmit = document.getElementById('cf-email-submit');
  var input    = document.getElementById('cf-input');
  var sendBtn  = document.getElementById('cf-send');
  var closeBtn = document.getElementById('cf-close');

  // ── State ─────────────────────────────────────────────────────────────────────
  var apiMessages = [];
  var exchangeCount = 0;
  var emailCaptureShown = false;
  var emailSubmitted = false;
  var isOpen = false;
  var isLoading = false;
  var lastTopic = 'ClinicFlow pricing and setup';

  // ── Core functions ────────────────────────────────────────────────────────────
  function openWidget() {
    if (isOpen) return;
    isOpen = true;
    window_.classList.add('open');
    badge.classList.remove('visible');
    input.focus();
    if (apiMessages.length === 0) {
      showWelcome();
    }
  }

  function closeWidget() {
    isOpen = false;
    window_.classList.remove('open');
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function addMessage(role, text) {
    var bubble = document.createElement('div');
    bubble.className = 'cf-msg ' + (role === 'user' ? 'user' : 'bot');
    bubble.textContent = text;
    messages.insertBefore(bubble, typing);
    scrollToBottom();
    return bubble;
  }

  function showTyping() {
    typing.classList.add('show');
    messages.appendChild(typing);
    scrollToBottom();
  }

  function hideTyping() {
    typing.classList.remove('show');
  }

  function showWelcome() {
    var greeting = 'Hi! I\'m here to answer any questions about ClinicFlow — pricing, how it works, setup time, anything. What\'s on your mind?';
    showTyping();
    setTimeout(function () {
      hideTyping();
      addMessage('bot', greeting);
      apiMessages.push({ role: 'assistant', content: greeting });
      quickReplies.classList.add('show');
    }, 900);
  }

  function hideQuickReplies() {
    quickReplies.classList.remove('show');
  }

  function maybeShowEmailCapture() {
    if (!emailCaptureShown && !emailSubmitted && exchangeCount >= 3) {
      emailCaptureShown = true;
      emailCapture.classList.add('show');
      scrollToBottom();
    }
  }

  async function sendMessage(text) {
    text = text.trim();
    if (!text || isLoading) return;

    hideQuickReplies();
    addMessage('user', text);
    apiMessages.push({ role: 'user', content: text });
    lastTopic = text.slice(0, 80);

    input.value = '';
    input.style.height = 'auto';
    isLoading = true;
    sendBtn.disabled = true;

    showTyping();

    try {
      var res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      });

      var data = await res.json();
      hideTyping();

      if (data.response) {
        addMessage('bot', data.response);
        apiMessages.push({ role: 'assistant', content: data.response });
        exchangeCount++;
        maybeShowEmailCapture();
      } else {
        addMessage('bot', 'Sorry, something went wrong. Feel free to call us at 438-544-0442!');
      }
    } catch (err) {
      hideTyping();
      addMessage('bot', 'Sorry, I\'m having trouble connecting. You can reach Mohamed directly at 438-544-0442.');
    }

    isLoading = false;
    sendBtn.disabled = false;
    input.focus();
  }

  async function submitEmail(email) {
    email = email.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      emailInput.focus();
      return;
    }

    emailSubmit.disabled = true;
    emailSubmit.textContent = 'Sending…';

    try {
      await fetch('/.netlify/functions/capture-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, topic: lastTopic }),
      });
    } catch (e) {
      // fail silently — still show confirmation
    }

    emailCapture.classList.remove('show');
    emailSubmitted = true;
    addMessage('bot', 'Perfect — Mohamed will review and email you within 24 hours. 🎯');
  }

  // ── Event listeners ───────────────────────────────────────────────────────────
  launcher.addEventListener('click', openWidget);
  closeBtn.addEventListener('click', closeWidget);

  sendBtn.addEventListener('click', function () {
    sendMessage(input.value);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });

  input.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  document.querySelectorAll('.cf-qr').forEach(function (btn) {
    btn.addEventListener('click', function () {
      sendMessage(this.getAttribute('data-q'));
    });
  });

  emailSubmit.addEventListener('click', function () {
    submitEmail(emailInput.value);
  });

  emailInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitEmail(emailInput.value);
    }
  });

  // ── Timers ────────────────────────────────────────────────────────────────────
  setTimeout(function () {
    if (!isOpen) badge.classList.add('visible');
  }, 30000);

  setTimeout(function () {
    if (!isOpen) openWidget();
  }, 45000);

}());
