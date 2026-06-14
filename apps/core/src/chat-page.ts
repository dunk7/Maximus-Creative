import { LUCIDE_CSS, lucide } from "./ui-icons.js";
import { CHAT_STREAM_TIMEOUT_MS } from "./agent-lock.js";

export function renderChatPage(): string {
  const i = lucide;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#09090f">
  <title>Maximus</title>
  <style>
    :root {
      --bg: #09090f;
      --surface: #12121a;
      --surface-2: #1a1a26;
      --border: #2a2a38;
      --text: #ececf1;
      --text-muted: #8b8b9a;
      --accent: #4c6ef5;
      --accent-soft: #4c6ef522;
      --you: #4c6ef5;
      --you-text: #fff;
      --maximus: #1e1e2a;
      --danger: #e03131;
      --radius: 16px;
      --radius-sm: 10px;
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
      --header-h: 56px;
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      font-size: 16px;
      line-height: 1.5;
      background: var(--bg);
      color: var(--text);
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      letter-spacing: -0.01em;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 20;
      padding: calc(0.65rem + var(--safe-top)) 1rem 0.65rem;
      min-height: calc(var(--header-h) + var(--safe-top));
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface) 92%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }
    header h1 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 650;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta {
      font-size: 0.72rem;
      color: var(--text-muted);
      margin-top: 0.1rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .model-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      margin-top: 0.3rem;
      max-width: 100%;
      font-size: 0.68rem;
      font-weight: 650;
      color: #91a7ff;
      background: var(--accent-soft);
      border: 1px solid #4c6ef544;
      border-radius: 6px;
      padding: 0.18rem 0.5rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .model-badge[hidden] { display: none; }
    .model-badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #51cf66;
      flex-shrink: 0;
    }
    .role-badge {
      flex-shrink: 0;
      font-size: 0.62rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.28rem 0.5rem;
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .role-badge.creative { background: var(--accent-soft); color: #91a7ff; border-color: #4c6ef544; }
    .role-badge.family { background: #2d6a4f22; color: #8fd4a8; border-color: #2d6a4f44; }
    .role-badge.friend { background: #49505722; color: #adb5bd; border-color: #49505744; }
    .icon-btn, .text-btn {
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: var(--radius-sm);
      cursor: pointer;
      font: inherit;
      transition: background 0.15s, transform 0.1s;
    }
    .icon-btn:active, .text-btn:active { transform: scale(0.96); }
    .icon-btn {
      width: 40px;
      height: 40px;
      font-size: 1.15rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    ${LUCIDE_CSS}
    .icon-btn .lucide { width: 18px; height: 18px; }
    .send-btn .lucide { width: 17px; height: 17px; }
    .text-btn {
      padding: 0.55rem 0.9rem;
      font-weight: 600;
      font-size: 0.88rem;
      background: var(--accent);
      border: none;
      color: #fff;
      flex-shrink: 0;
    }
    .text-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
    .screen { flex: 1; display: none; flex-direction: column; min-height: 0; }
    .screen.active { display: flex; }
    .centered {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      padding-bottom: calc(1.5rem + var(--safe-bottom));
    }
    .card {
      width: 100%;
      max-width: 400px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 1.5rem;
      box-shadow: 0 8px 32px #00000055;
    }
    .card h2, .card h3 { margin: 0 0 0.35rem; font-weight: 650; }
    .card .subtitle { color: var(--text-muted); font-size: 0.9rem; margin: 0 0 1.25rem; }
    label { display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-muted); margin-bottom: 0.4rem; }
    input, textarea, button.field-btn {
      width: 100%;
      font: inherit;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      padding: 0.8rem 0.9rem;
    }
    input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: transparent; }
    button.field-btn {
      margin-top: 0.85rem;
      background: var(--accent);
      border: none;
      font-weight: 600;
      color: #fff;
      cursor: pointer;
    }
    button.field-btn:disabled { opacity: 0.5; }
    .error { color: #ff8787; font-size: 0.82rem; margin-top: 0.55rem; }
    .check-row {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      margin: 0.85rem 0 0.35rem;
      padding: 0.65rem 0.75rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .check-row input[type="checkbox"] {
      width: 1.05rem;
      height: 1.05rem;
      min-width: 1.05rem;
      margin: 0.15rem 0 0;
      padding: 0;
      accent-color: var(--accent);
      flex-shrink: 0;
      cursor: pointer;
    }
    .check-row label {
      display: block;
      margin: 0;
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 500;
      line-height: 1.35;
      cursor: pointer;
      flex: 1;
    }
    .thread-list {
      flex: 1;
      overflow-y: auto;
      padding: 0.75rem;
      padding-bottom: calc(0.75rem + var(--safe-bottom));
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      -webkit-overflow-scrolling: touch;
    }
    .thread-item {
      display: block;
      width: 100%;
      text-align: left;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.95rem 1.05rem;
      color: inherit;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .thread-item:hover { border-color: #3a3a4a; }
    .thread-item:active { background: var(--surface-2); }
    .thread-title { font-weight: 600; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem; }
    .thread-preview {
      font-size: 0.84rem;
      color: var(--text-muted);
      margin-top: 0.3rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .thread-meta { font-size: 0.72rem; color: #5c5c6e; margin-top: 0.35rem; }
    .lock { font-size: 0.85em; }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      -webkit-overflow-scrolling: touch;
    }
    .bubble-wrap { display: flex; flex-direction: column; max-width: 85%; }
    .bubble-wrap.you { align-self: flex-end; align-items: flex-end; }
    .bubble-wrap.maximus { align-self: flex-start; align-items: flex-start; }
    .bubble {
      padding: 0.7rem 0.95rem;
      border-radius: 18px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.95rem;
    }
    .bubble.you {
      background: var(--you);
      color: var(--you-text);
      border-bottom-right-radius: 6px;
    }
    .bubble.maximus {
      background: var(--maximus);
      border: 1px solid var(--border);
      border-bottom-left-radius: 6px;
      white-space: normal;
    }
    .bubble.maximus p,
    .bubble.maximus .md-p {
      margin: 0 0 0.65em;
    }
    .bubble.maximus p:last-child,
    .bubble.maximus .md-p:last-child,
    .bubble.maximus ul:last-child,
    .bubble.maximus ol:last-child,
    .bubble.maximus pre:last-child {
      margin-bottom: 0;
    }
    .bubble.maximus strong { font-weight: 700; }
    .bubble.maximus em { font-style: italic; }
    .bubble.maximus .md-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.88em;
      background: #00000040;
      padding: 0.1em 0.35em;
      border-radius: 4px;
    }
    .bubble.maximus pre.md-pre {
      margin: 0.55em 0;
      padding: 0.7rem 0.8rem;
      background: #00000055;
      border: 1px solid #ffffff12;
      border-radius: 10px;
      overflow-x: auto;
      font-size: 0.84em;
      line-height: 1.4;
    }
    .bubble.maximus pre.md-pre code {
      font-family: inherit;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .bubble.maximus .md-list {
      margin: 0.35em 0 0.65em;
      padding-left: 1.2em;
    }
    .bubble.maximus .md-list li { margin: 0.2em 0; }
    .bubble.maximus .md-heading {
      font-weight: 700;
      margin: 0.55em 0 0.35em;
      line-height: 1.3;
    }
    .bubble.maximus a {
      color: #91a7ff;
      text-decoration: underline;
      word-break: break-word;
    }
    .typing-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0.75rem 1rem;
      background: var(--maximus);
      border: 1px solid var(--border);
      border-radius: 18px;
      border-bottom-left-radius: 6px;
      box-sizing: border-box;
      line-height: 1;
    }
    .typing-indicator .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #8b8b9a;
      animation: typingDot 1.2s infinite ease-in-out;
      flex-shrink: 0;
    }
    .typing-indicator .dot:nth-child(2) { animation-delay: 0.15s; }
    .typing-indicator .dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes typingDot {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
      30% { transform: translateY(-4px); opacity: 1; }
    }
    #composer {
      padding: 0.65rem 0.75rem;
      padding-bottom: calc(0.65rem + var(--safe-bottom));
      border-top: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      gap: 0.5rem;
      align-items: flex-end;
    }
    #composer textarea {
      flex: 1;
      resize: none;
      min-height: 44px;
      max-height: 140px;
      font: inherit;
      font-size: 0.95rem;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      padding: 0.7rem 1rem;
      line-height: 1.4;
      overflow-y: auto;
    }
    #composer .send-btn {
      width: 44px;
      height: 44px;
      margin: 0;
      padding: 0;
      border-radius: 50%;
      min-width: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    #composer .send-btn.sending { background: #364fc7; }
    .modal {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(4px);
      display: none; align-items: center; justify-content: center;
      padding: 1rem;
      padding-bottom: calc(1rem + var(--safe-bottom));
      z-index: 50;
    }
    .modal.open { display: flex; }
    .empty { text-align: center; color: var(--text-muted); padding: 3rem 1.5rem; font-size: 0.92rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
    .empty .lucide { opacity: 0.35; }
    .danger-btn { background: var(--danger) !important; border: none !important; }
    .status-line {
      font-size: 0.72rem;
      color: var(--text-muted);
      text-align: center;
      padding: 0.35rem 1rem;
      min-height: 1.4rem;
    }
    .activity-feed {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      padding: 0.25rem 1rem 0.5rem;
      max-height: 9rem;
      overflow-y: auto;
    }
    .activity-feed:empty { display: none; }
    .activity-item {
      font-size: 0.78rem;
      color: #7c7c8e;
      line-height: 1.35;
      padding: 0.2rem 0.55rem;
      border-left: 2px solid #4c6ef544;
      background: #12121a88;
      border-radius: 0 6px 6px 0;
    }
    .tick-banner {
      margin: 0.35rem 1rem 0;
      padding: 0.55rem 0.85rem;
      border-radius: 10px;
      background: #1a2332;
      border: 1px solid #4c6ef733;
      color: #91a7ff;
      font-size: 0.82rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .tick-banner[hidden] { display: none !important; }
    .tick-banner .lucide {
      width: 16px;
      height: 16px;
      color: #748ffc;
      animation: tickPulse 1.4s ease-in-out infinite;
    }
    @keyframes tickPulse {
      0%, 100% { opacity: 0.35; }
      50% { opacity: 1; }
    }
    .sol-actions { display: flex; gap: 0.5rem; margin-top: 0.85rem; }
    .sol-actions button { flex: 1; margin: 0; }
    .skeleton {
      background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.2s infinite;
      border-radius: var(--radius-sm);
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .sk-thread { height: 72px; border-radius: var(--radius); margin-bottom: 0.5rem; }
    .sk-bubble { height: 48px; width: 70%; margin-bottom: 0.5rem; border-radius: 18px; }
    .sk-bubble.you { align-self: flex-end; width: 55%; }
    #toastHost {
      position: fixed;
      bottom: calc(1rem + var(--safe-bottom));
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      pointer-events: none;
      width: min(420px, calc(100% - 2rem));
    }
    .toast {
      background: #2b2b3a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.75rem 1rem;
      border-radius: var(--radius-sm);
      font-size: 0.88rem;
      box-shadow: 0 4px 20px #00000066;
      pointer-events: auto;
      animation: toastIn 0.25s ease;
    }
    .toast.error { border-color: #e0313155; background: #2a1515; color: #ff8787; }
    @keyframes toastIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .logo-mark {
      width: 52px; height: 52px;
      border-radius: 16px;
      background: linear-gradient(135deg, var(--accent), #7950f2);
      display: flex; align-items: center; justify-content: center;
      color: #fff;
      margin: 0 auto 1rem;
      box-shadow: 0 8px 24px #4c6ef544;
    }
    .logo-mark .lucide { width: 28px; height: 28px; stroke: #fff; }
    .thread-item .thread-chevron {
      margin-left: auto;
      color: var(--text-muted);
      opacity: 0.5;
      flex-shrink: 0;
    }
    .thread-item .thread-chevron .lucide { width: 16px; height: 16px; }
    .thread-title { display: flex; align-items: center; gap: 0.4rem; width: 100%; }
    .thread-lock { display: inline-flex; color: #91a7ff; }
    .thread-lock .lucide { width: 14px; height: 14px; }
    .btn-with-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
    }
    .btn-with-icon .lucide { width: 16px; height: 16px; }
    .nav-link {
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.55rem 0.85rem;
      font-weight: 600;
      font-size: 0.84rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text);
    }
    .nav-link .lucide { width: 15px; height: 15px; }
  </style>
</head>
<body>
  <header>
    <button class="icon-btn" id="backBtn" style="display:none" type="button" aria-label="Back">${i("arrowLeft")}</button>
    <div style="flex:1;min-width:0">
      <h1 id="headerTitle">Maximus</h1>
      <div class="meta" id="meta">Autonomous core</div>
      <div class="model-badge" id="modelBadge" hidden aria-live="polite">
        <span class="dot" aria-hidden="true"></span>
        <span id="modelBadgeText"></span>
      </div>
    </div>
    <span class="role-badge" id="roleBadge" style="display:none"></span>
    <button class="icon-btn danger-btn" id="deleteChatBtn" style="display:none" type="button" title="Delete chat" aria-label="Delete chat">${i("trash2")}</button>
    <a class="nav-link" id="dashboardLink" href="/dashboard">${i("layoutDashboard", 15)}<span>Status</span></a>
    <button class="text-btn btn-with-icon" id="newChatBtn" style="display:none" type="button">${i("plus", 16)}<span>New</span></button>
  </header>

  <section class="screen active" id="unlockScreen">
    <div class="centered">
      <div class="card">
        <div class="logo-mark">${i("bot", 28)}</div>
        <h2>Welcome back</h2>
        <p class="subtitle">Enter your access code to open Maximus</p>
        <label for="sitePassword">Access code</label>
        <input id="sitePassword" type="password" autocomplete="current-password" placeholder="••••••••">
        <button class="field-btn btn-with-icon" id="unlockBtn" type="button">${i("sparkles", 16)}<span>Continue</span></button>
        <div class="error" id="unlockError"></div>
      </div>
    </div>
  </section>

  <section class="screen" id="threadsScreen">
    <div class="thread-list" id="threadList"></div>
  </section>

  <section class="screen" id="chatScreen">
    <div class="tick-banner" id="tickBanner" hidden>
      ${i("brain", 16)}
      <span>Maximus is running a background thinking tick…</span>
    </div>
    <div class="activity-feed" id="activityFeed"></div>
    <div class="status-line" id="streamStatus"></div>
    <div id="messages"></div>
    <form id="composer">
      <textarea id="input" rows="1" placeholder="Message Maximus…" required></textarea>
      <button class="text-btn send-btn" type="submit" id="sendBtn" aria-label="Send message">${i("send", 17)}</button>
    </form>
  </section>

  <div id="toastHost"></div>

  <div class="modal" id="newChatModal">
    <div class="card">
      <h3>New chat</h3>
      <p class="subtitle">Start a fresh conversation</p>
      <label for="newTitle">Title</label>
      <input id="newTitle" placeholder="e.g. Trading ideas">
      <div class="check-row">
        <input type="checkbox" id="newPrivate">
        <label for="newPrivate">Private chat <span style="color:var(--text-muted);font-weight:400">(extra password)</span></label>
      </div>
      <div id="newPasswordWrap" style="display:none">
        <label for="newThreadPassword">Chat password</label>
        <input id="newThreadPassword" type="password" placeholder="Only you will see this chat">
      </div>
      <button class="field-btn btn-with-icon" id="createChatBtn" type="button">${i("plus", 16)}<span>Create</span></button>
      <button class="field-btn btn-with-icon" id="cancelNewBtn" type="button" style="background:var(--surface-2);margin-top:0.5rem;border:1px solid var(--border)">${i("x", 16)}<span>Cancel</span></button>
      <div class="error" id="newChatError"></div>
    </div>
  </div>

  <div class="modal" id="solModal">
    <div class="card">
      <h3>Approve SOL send?</h3>
      <p id="solModalText" class="subtitle" style="margin-bottom:0"></p>
      <div class="sol-actions">
        <button class="field-btn btn-with-icon" id="solApproveBtn" type="button">${i("check", 16)}<span>Approve</span></button>
        <button class="field-btn danger-btn btn-with-icon" id="solRejectBtn" type="button">${i("x", 16)}<span>Reject</span></button>
      </div>
      <div class="error" id="solModalError"></div>
    </div>
  </div>

  <div class="modal" id="threadUnlockModal">
    <div class="card">
      <h3 id="threadUnlockTitle">Private chat</h3>
      <p class="subtitle">This chat is password protected.</p>
      <label for="threadPassword">Chat password</label>
      <input id="threadPassword" type="password">
      <button class="field-btn" id="threadUnlockBtn" type="button">Unlock</button>
      <button class="field-btn" id="cancelUnlockBtn" type="button" style="background:var(--surface-2);margin-top:0.5rem;border:1px solid var(--border)">Cancel</button>
      <div class="error" id="threadUnlockError"></div>
    </div>
  </div>

  <div class="modal" id="deleteConfirmModal">
    <div class="card">
      <h3>Delete chat?</h3>
      <p class="subtitle">This cannot be undone.</p>
      <div class="sol-actions">
        <button class="field-btn danger-btn btn-with-icon" id="confirmDeleteBtn" type="button">${i("trash2", 16)}<span>Delete</span></button>
        <button class="field-btn btn-with-icon" id="cancelDeleteBtn" type="button" style="background:var(--surface-2);border:1px solid var(--border)">${i("x", 16)}<span>Cancel</span></button>
      </div>
    </div>
  </div>

  <script>
    const SITE_KEY = "maximus_site_password";
    let currentThread = null;
    let pendingThread = null;
    let sessionRole = null;
    let sessionLabel = "";
    let isStreaming = false;

    const unlockScreen = document.getElementById("unlockScreen");
    const threadsScreen = document.getElementById("threadsScreen");
    const chatScreen = document.getElementById("chatScreen");
    const headerTitle = document.getElementById("headerTitle");
    const metaEl = document.getElementById("meta");
    const modelBadge = document.getElementById("modelBadge");
    const modelBadgeText = document.getElementById("modelBadgeText");
    let lastReplyModelLabel = null;
    const backBtn = document.getElementById("backBtn");
    const newChatBtn = document.getElementById("newChatBtn");
    const deleteChatBtn = document.getElementById("deleteChatBtn");
    const streamStatus = document.getElementById("streamStatus");
    const activityFeed = document.getElementById("activityFeed");
    const tickBanner = document.getElementById("tickBanner");
    let activityPollTimer = null;
    const solModal = document.getElementById("solModal");
    let pendingSolId = null;
    const threadList = document.getElementById("threadList");
    const messagesEl = document.getElementById("messages");
    const form = document.getElementById("composer");
    const input = document.getElementById("input");
    const sendBtn = document.getElementById("sendBtn");
    const newChatModal = document.getElementById("newChatModal");
    const threadUnlockModal = document.getElementById("threadUnlockModal");
    const deleteConfirmModal = document.getElementById("deleteConfirmModal");
    const roleBadge = document.getElementById("roleBadge");
    let typingEl = null;

    function updateTickBanner(data) {
      if (!tickBanner || !data) return;
      tickBanner.hidden = !(data.agent_busy && data.busy_reason === "tick");
    }

    async function pollAgentActivity() {
      try {
        const res = await fetch("/status");
        const data = await res.json();
        updateTickBanner(data);
        return data;
      } catch {
        return null;
      }
    }

    function startActivityPoll() {
      if (activityPollTimer) return;
      pollAgentActivity();
      activityPollTimer = setInterval(pollAgentActivity, 5000);
    }

    function stopActivityPoll() {
      if (activityPollTimer) {
        clearInterval(activityPollTimer);
        activityPollTimer = null;
      }
      if (tickBanner) tickBanner.hidden = true;
    }

    function showToast(msg, kind) {
      const host = document.getElementById("toastHost");
      const el = document.createElement("div");
      el.className = "toast" + (kind === "error" ? " error" : "");
      el.textContent = msg;
      host.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }

    function autoGrowTextarea() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    }

    function applyRoleUi() {
      const role = sessionRole || "creative";
      const showBadge = sessionRole && role !== "creative";
      roleBadge.style.display = showBadge ? "inline-block" : "none";
      roleBadge.textContent = sessionLabel || role;
      roleBadge.className = "role-badge " + role;
      window.__canSolApprove = role === "creative" || role === "family";
    }

    function clearActivityFeed() {
      if (activityFeed) activityFeed.innerHTML = "";
    }

    function addActivityLine(message) {
      if (!activityFeed || !message) return;
      const el = document.createElement("div");
      el.className = "activity-item";
      el.textContent = message;
      activityFeed.appendChild(el);
      activityFeed.scrollTop = activityFeed.scrollHeight;
    }

    function showScreen(name) {
      [unlockScreen, threadsScreen, chatScreen].forEach((el) => el.classList.remove("active"));
      if (name === "unlock") unlockScreen.classList.add("active");
      if (name === "threads") threadsScreen.classList.add("active");
      if (name === "chat") chatScreen.classList.add("active");
      backBtn.style.display = name === "chat" ? "inline-flex" : "none";
      deleteChatBtn.style.display =
        name === "chat" && sessionRole === "creative" && currentThread && currentThread.id !== 1
          ? "inline-flex"
          : "none";
      const canCreate = sessionRole === "creative" || sessionRole === "family";
      newChatBtn.style.display = name === "threads" && canCreate ? "inline-flex" : "none";
      if (name !== "chat") {
        streamStatus.textContent = "";
        clearActivityFeed();
      }
    }

    function sitePassword() {
      return sessionStorage.getItem(SITE_KEY) || "";
    }

    function threadPasswordKey(id) {
      return "maximus_thread_pw_" + id;
    }

    function getThreadPassword(id) {
      return sessionStorage.getItem(threadPasswordKey(id)) || "";
    }

    function setThreadPassword(id, pw) {
      if (pw) sessionStorage.setItem(threadPasswordKey(id), pw);
      else sessionStorage.removeItem(threadPasswordKey(id));
    }

    function authHeaders(threadId) {
      const h = {
        "Authorization": "Bearer " + sitePassword(),
        "Content-Type": "application/json"
      };
      const tp = getThreadPassword(threadId);
      if (tp) h["X-Thread-Password"] = tp;
      return h;
    }

    function formatTime(iso) {
      try {
        const d = new Date(iso.replace(" ", "T") + "Z");
        return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      } catch { return ""; }
    }

    function showThreadSkeletons() {
      threadList.innerHTML = "";
      for (let i = 0; i < 4; i++) {
        const sk = document.createElement("div");
        sk.className = "skeleton sk-thread";
        threadList.appendChild(sk);
      }
    }

    function showMessageSkeletons() {
      messagesEl.innerHTML = "";
      for (let i = 0; i < 3; i++) {
        const sk = document.createElement("div");
        sk.className = "skeleton sk-bubble" + (i % 2 ? " you" : "");
        messagesEl.appendChild(sk);
      }
    }

    function showTyping() {
      hideTyping();
      const wrap = document.createElement("div");
      wrap.className = "bubble-wrap maximus";
      const bubble = document.createElement("div");
      bubble.className = "typing-indicator";
      bubble.setAttribute("aria-label", "Maximus is thinking");
      bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      wrap.appendChild(bubble);
      typingEl = wrap;
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function hideTyping() {
      if (typingEl) { typingEl.remove(); typingEl = null; }
    }

    async function loadSession() {
      const res = await fetch("/session", { headers: authHeaders(0) });
      if (!res.ok) throw new Error("unauthorized");
      const data = await res.json();
      sessionRole = data.role;
      sessionLabel = data.label || data.role;
      applyRoleUi();
      return data;
    }

    function modelLabelFromStatus(llm) {
      if (!llm) return null;
      if (llm.label) return llm.label;
      if (llm.provider && llm.model) return llm.provider + "/" + llm.model;
      return null;
    }

    function setModelBadge(label, source) {
      if (!label) {
        modelBadge.hidden = true;
        return;
      }
      modelBadge.hidden = false;
      modelBadgeText.textContent = label;
      modelBadge.title =
        source === "reply"
          ? "Model used for the last reply"
          : "Last model used by Maximus";
    }

    async function loadStatusMeta() {
      try {
        const res = await fetch("/status");
        const data = await res.json();
        const bal = data.wallet_balance_sol != null ? data.wallet_balance_sol.toFixed(4) + " SOL" : "—";
        const rolePart = sessionLabel ? sessionLabel + " · " : "";
        metaEl.textContent = rolePart + "Tick #" + data.tick_number + " · " + bal;
        updateTickBanner(data);
        if (!lastReplyModelLabel) {
          setModelBadge(modelLabelFromStatus(data.active_llm), "status");
        }
      } catch {
        metaEl.textContent = sessionLabel || "Maximus";
      }
    }

    async function loadThreads() {
      showThreadSkeletons();
      const res = await fetch("/threads", { headers: authHeaders(0) });
      if (!res.ok) throw new Error("Could not load chats");
      const data = await res.json();
      threadList.innerHTML = "";
      const threads = data.threads || [];
      if (!threads.length) {
        threadList.innerHTML = '<div class="empty">' + ${JSON.stringify(i("messageSquare", 32))} + '<p style="margin:0.75rem 0 0">No chats yet.<br>Tap <strong>New</strong> to start.</p></div>';
        return;
      }
      for (const t of threads) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "thread-item";
        const lock = t.is_locked
          ? '<span class="thread-lock" aria-label="Private">' + ${JSON.stringify(i("lock", 14))} + '</span>'
          : "";
        const preview = t.is_locked
          ? "Private chat — password required"
          : (t.preview || "No messages yet");
        btn.innerHTML =
          '<div class="thread-title">' + lock + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(t.title) + '</span>' +
          '<span class="thread-chevron">' + ${JSON.stringify(i("chevronRight", 16))} + '</span></div>' +
          '<div class="thread-preview">' + escapeHtml(preview) + '</div>' +
          '<div class="thread-meta">' + t.message_count + ' messages · ' + formatTime(t.updated_at) + '</div>';
        btn.onclick = () => openThread(t);
        threadList.appendChild(btn);
      }
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    function formatMessage(text) {
      if (!text) return "";
      const codeBlocks = [];
      let s = escapeHtml(text);

      s = s.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, (_, code) => {
        const i = codeBlocks.length;
        codeBlocks.push('<pre class="md-pre"><code>' + code.replace(/^\\n+|\\n+$/g, "") + "</code></pre>");
        return "@@CODE" + i + "@@";
      });

      s = s.replace(/\`([^\`\\n]+)\`/g, '<code class="md-code">$1</code>');
      s = s.replace(/\\*\\*([^*\\n]+)\\*\\*/g, "<strong>$1</strong>");
      s = s.replace(/__([^_\\n]+)__/g, "<strong>$1</strong>");
      s = s.replace(/\\*([^*\\n]+)\\*/g, "<em>$1</em>");
      s = s.replace(/_([^_\\n]+)_/g, "<em>$1</em>");
      s = s.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

      s = s.replace(/^### (.+)$/gm, '<div class="md-heading">$1</div>');
      s = s.replace(/^## (.+)$/gm, '<div class="md-heading">$1</div>');
      s = s.replace(/^# (.+)$/gm, '<div class="md-heading">$1</div>');

      s = s.replace(/^(?:[-*•] .+(?:\\n|$))+/gm, (block) => {
        const items = block.trim().split("\\n").map((line) =>
          "<li>" + line.replace(/^[-*•]\\s+/, "") + "</li>"
        ).join("");
        return '<ul class="md-list">' + items + "</ul>";
      });

      s = s.replace(/^(?:\\d+\\. .+(?:\\n|$))+/gm, (block) => {
        const items = block.trim().split("\\n").map((line) =>
          "<li>" + line.replace(/^\\d+\\.\\s+/, "") + "</li>"
        ).join("");
        return '<ol class="md-list">' + items + "</ol>";
      });

      const paragraphs = s.split(/\\n{2,}/).map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return "";
        if (/^<(ul|ol|pre|div)\\b/.test(trimmed)) return trimmed;
        return '<p class="md-p">' + trimmed.replace(/\\n/g, "<br>") + "</p>";
      }).filter(Boolean);

      s = paragraphs.join("");
      codeBlocks.forEach((block, i) => {
        s = s.split("@@CODE" + i + "@@").join(block);
      });
      return s;
    }

    function setBubbleContent(div, text, kind) {
      if (kind === "you") {
        div.textContent = text;
        delete div.dataset.raw;
        return;
      }
      div.dataset.raw = text;
      div.innerHTML = formatMessage(text);
    }

    function appendBubbleToken(div, token) {
      const raw = (div.dataset.raw || "") + (token || "");
      div.dataset.raw = raw;
      div.textContent = raw;
    }

    function divHasText(div) {
      return Boolean((div.dataset.raw || div.textContent || "").trim());
    }

    async function openThread(thread) {
      pendingThread = thread;
      if (thread.is_locked && !getThreadPassword(thread.id)) {
        document.getElementById("threadUnlockTitle").textContent = thread.title;
        document.getElementById("threadPassword").value = "";
        document.getElementById("threadUnlockError").textContent = "";
        threadUnlockModal.classList.add("open");
        return;
      }
      await enterThread(thread);
    }

    async function enterThread(thread) {
      currentThread = thread;
      headerTitle.textContent = thread.title;
      deleteChatBtn.style.display =
        sessionRole === "creative" && thread.id !== 1 ? "inline-flex" : "none";
      lastReplyModelLabel = null;
      showScreen("chat");
      await loadStatusMeta();
      await loadThreadMessages();
      input.focus();
    }

    async function loadThreadMessages() {
      showMessageSkeletons();
      const res = await fetch("/threads/" + currentThread.id + "/messages", {
        headers: authHeaders(currentThread.id)
      });
      if (res.status === 403) {
        setThreadPassword(currentThread.id, "");
        threadUnlockModal.classList.add("open");
        return;
      }
      if (!res.ok) throw new Error("Could not load messages");
      const data = await res.json();
      messagesEl.innerHTML = "";
      for (const row of (data.messages || []).slice().reverse()) {
        addBubble(row.content, "you");
        if (row.response) addBubble(row.response, "maximus");
      }
    }

    function addBubble(text, kind) {
      const wrap = document.createElement("div");
      wrap.className = "bubble-wrap " + kind;
      const div = document.createElement("div");
      div.className = "bubble " + kind;
      setBubbleContent(div, text, kind);
      wrap.appendChild(div);
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    function parseSseChunk(buffer, onEvent) {
      const parts = buffer.split("\\n\\n");
      const rest = parts.pop() || "";
      for (const part of parts) {
        const lines = part.split("\\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) event = line.slice(7);
          if (line.startsWith("data: ")) data = line.slice(6);
        }
        if (data) {
          try { onEvent(event, JSON.parse(data)); } catch {}
        }
      }
      return rest;
    }

    function showSolApproval(id, to, amount) {
      if (sessionRole !== "creative" && sessionRole !== "family") return;
      pendingSolId = id;
      document.getElementById("solModalText").textContent =
        "Send " + amount + " SOL to " + to + "?";
      document.getElementById("solModalError").textContent = "";
      solModal.classList.add("open");
    }

    const ICON_SEND = ${JSON.stringify(i("send", 17))};
    const ICON_LOADER = ${JSON.stringify(`<span class="icon-spin">${i("loader2", 17)}</span>`)};

    function setSending(sending) {
      isStreaming = sending;
      sendBtn.disabled = sending;
      sendBtn.innerHTML = sending ? ICON_LOADER : ICON_SEND;
      sendBtn.classList.toggle("sending", sending);
      input.disabled = sending;
    }

    async function sendMessage() {
      const text = input.value.trim();
      if (!text || isStreaming || !currentThread) return;
      input.value = "";
      autoGrowTextarea();
      setSending(true);
      addBubble(text, "you");
      clearActivityFeed();
      showTyping();
      let replyBubble = null;
      let buffer = "";
      const streamAbort = new AbortController();
      const streamTimer = setTimeout(() => streamAbort.abort(), ${CHAT_STREAM_TIMEOUT_MS});
      try {
        const res = await fetch("/threads/" + currentThread.id + "/chat/stream", {
          method: "POST",
          headers: authHeaders(currentThread.id),
          body: JSON.stringify({ message: text }),
          signal: streamAbort.signal
        });
        if (!res.ok || !res.body) throw new Error("Stream failed");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = parseSseChunk(buffer, (event, data) => {
            if (event === "status") streamStatus.textContent = data.message || "";
            if (event === "activity") {
              addActivityLine(data.message || "");
              streamStatus.textContent = data.message || "";
            }
            if (event === "model") {
              const label = data.label || (data.provider && data.model ? data.provider + "/" + data.model : null);
              if (label) {
                lastReplyModelLabel = label;
                setModelBadge(label, "reply");
              }
            }
            if (event === "token") {
              if (!replyBubble) {
                hideTyping();
                replyBubble = addBubble("", "maximus");
              }
              appendBubbleToken(replyBubble, data.text || "");
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            if (event === "pending_send" && window.__canSolApprove) {
              showSolApproval(data.id, data.to, data.amount_sol);
            }
            if (event === "done") {
              hideTyping();
              if (!replyBubble) replyBubble = addBubble("", "maximus");
              setBubbleContent(replyBubble, data.response || replyBubble.dataset.raw || "", "maximus");
              streamStatus.textContent = "";
              clearActivityFeed();
              const label =
                data.model_label ||
                (data.provider && data.model ? data.provider + "/" + data.model : null);
              if (label) {
                lastReplyModelLabel = label;
                setModelBadge(label, "reply");
              }
              loadThreads();
            }
          });
        }
        hideTyping();
        loadStatusMeta();
      } catch (err) {
        hideTyping();
        if (!replyBubble) replyBubble = addBubble("", "maximus");
        const msg = err.name === "AbortError"
          ? "Request timed out — Maximus may be busy. Try again."
          : "Something went wrong. Try again.";
        setBubbleContent(replyBubble, msg, "maximus");
        showToast(err.name === "AbortError" ? "Timed out waiting for reply" : (err.message || "Message failed"), "error");
      } finally {
        clearTimeout(streamTimer);
        setSending(false);
        input.focus();
      }
    }

    deleteChatBtn.onclick = () => {
      if (!currentThread || currentThread.id === 1) return;
      deleteConfirmModal.classList.add("open");
    };

    document.getElementById("confirmDeleteBtn").onclick = async () => {
      deleteConfirmModal.classList.remove("open");
      if (!currentThread) return;
      try {
        const res = await fetch("/threads/" + currentThread.id, {
          method: "DELETE",
          headers: authHeaders(currentThread.id)
        });
        if (res.ok) {
          currentThread = null;
          headerTitle.textContent = "Chats";
          showScreen("threads");
          await loadThreads();
        } else {
          showToast("Could not delete chat", "error");
        }
      } catch {
        showToast("Could not delete chat", "error");
      }
    };

    document.getElementById("cancelDeleteBtn").onclick = () => {
      deleteConfirmModal.classList.remove("open");
    };

    document.getElementById("solApproveBtn").onclick = async () => {
      if (!pendingSolId) return;
      const err = document.getElementById("solModalError");
      err.textContent = "";
      const res = await fetch("/pending-sends/" + pendingSolId + "/approve", {
        method: "POST",
        headers: authHeaders(0)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        err.textContent = data.error || "Approve failed";
        return;
      }
      solModal.classList.remove("open");
      addBubble("SOL sent. Signature: " + data.signature, "maximus");
      pendingSolId = null;
    };

    document.getElementById("solRejectBtn").onclick = async () => {
      if (!pendingSolId) return;
      await fetch("/pending-sends/" + pendingSolId + "/reject", {
        method: "POST",
        headers: authHeaders(0)
      });
      solModal.classList.remove("open");
      addBubble("SOL send rejected.", "maximus");
      pendingSolId = null;
    };

    async function enterAfterUnlock() {
      startActivityPoll();
      await loadStatusMeta();
      if (sessionRole === "friend") {
        const res = await fetch("/threads", { headers: authHeaders(0) });
        if (!res.ok) throw new Error("Could not load chats");
        const data = await res.json();
        const threads = data.threads || [];
        if (threads.length >= 1) {
          await enterThread(threads[0]);
          return;
        }
        throw new Error("Could not open chat");
      }
      await loadThreads();
      showScreen("threads");
      headerTitle.textContent = "Chats";
    }

    document.getElementById("unlockBtn").onclick = async () => {
      const pw = document.getElementById("sitePassword").value.trim();
      const err = document.getElementById("unlockError");
      const btn = document.getElementById("unlockBtn");
      err.textContent = "";
      if (!pw) { err.textContent = "Enter your access code"; return; }
      btn.disabled = true;
      sessionStorage.setItem(SITE_KEY, pw);
      try {
        await loadSession();
      } catch {
      sessionStorage.removeItem(SITE_KEY);
      sessionRole = null;
      sessionLabel = "";
      stopActivityPoll();
      applyRoleUi();
        err.textContent = "Invalid access code";
        btn.disabled = false;
        return;
      }
      try {
        await enterAfterUnlock();
      } catch (e) {
        err.textContent = e.message || "Could not load. Try again.";
      }
      btn.disabled = false;
    };

    document.getElementById("sitePassword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("unlockBtn").click();
    });

    newChatBtn.onclick = () => {
      document.getElementById("newTitle").value = "";
      document.getElementById("newPrivate").checked = false;
      document.getElementById("newPasswordWrap").style.display = "none";
      document.getElementById("newThreadPassword").value = "";
      document.getElementById("newChatError").textContent = "";
      newChatModal.classList.add("open");
    };

    document.getElementById("newPrivate").onchange = (e) => {
      document.getElementById("newPasswordWrap").style.display = e.target.checked ? "block" : "none";
    };

    document.getElementById("cancelNewBtn").onclick = () => newChatModal.classList.remove("open");

    document.getElementById("createChatBtn").onclick = async () => {
      const title = document.getElementById("newTitle").value.trim() || "New chat";
      const isPrivate = document.getElementById("newPrivate").checked;
      const password = isPrivate ? document.getElementById("newThreadPassword").value.trim() : "";
      const err = document.getElementById("newChatError");
      err.textContent = "";
      if (isPrivate && !password) { err.textContent = "Set a chat password"; return; }
      try {
        const res = await fetch("/threads", {
          method: "POST",
          headers: authHeaders(0),
          body: JSON.stringify({ title, password: password || undefined })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        if (password) setThreadPassword(data.thread.id, password);
        newChatModal.classList.remove("open");
        await loadThreads();
        await enterThread({ id: data.thread.id, title: data.thread.title, is_locked: data.thread.is_locked });
      } catch (e) {
        err.textContent = e.message || "Failed";
      }
    };

    document.getElementById("threadUnlockBtn").onclick = async () => {
      const pw = document.getElementById("threadPassword").value.trim();
      const err = document.getElementById("threadUnlockError");
      err.textContent = "";
      if (!pw || !pendingThread) { err.textContent = "Enter password"; return; }
      setThreadPassword(pendingThread.id, pw);
      try {
        const res = await fetch("/threads/" + pendingThread.id + "/messages", {
          headers: authHeaders(pendingThread.id)
        });
        if (!res.ok) {
          setThreadPassword(pendingThread.id, "");
          throw new Error("Wrong password");
        }
        threadUnlockModal.classList.remove("open");
        await enterThread(pendingThread);
      } catch (e) {
        err.textContent = e.message || "Wrong password";
      }
    };

    document.getElementById("cancelUnlockBtn").onclick = () => {
      threadUnlockModal.classList.remove("open");
      pendingThread = null;
    };

    backBtn.onclick = async () => {
      if (sessionRole === "friend") return;
      currentThread = null;
      headerTitle.textContent = "Chats";
      showScreen("threads");
      await loadThreads();
    };

    (async () => {
      if (!sitePassword()) return;
      try {
        await loadSession();
        await enterAfterUnlock();
      } catch {
      sessionStorage.removeItem(SITE_KEY);
      sessionRole = null;
      sessionLabel = "";
      stopActivityPoll();
      applyRoleUi();
      }
    })();

    form.addEventListener("submit", (e) => { e.preventDefault(); sendMessage(); });
    input.addEventListener("input", autoGrowTextarea);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  </script>
</body>
</html>`;
}
