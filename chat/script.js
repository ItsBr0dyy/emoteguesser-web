/* EmoteGuesser — client-only web remake (Twitch chat + per-channel leaderboard + chat log + bot announce)
   - Uses tmi.js (dynamically loaded if missing)
   - Per-channel leaderboard stored under `emoteguesser_lb_<channel>`
   - Chat log + timestamps in UI
   - Optional bot creds (username + oauth) to announce winners in chat
   - Preserves original local guessing & manual JSON fallback
*/

const $ = sel => document.querySelector(sel);
const channelInput = $('#channelInput');
const loadBtn = $('#loadBtn');
const statusEl = $('#status');
const channelNameEl = $('#channelName');
const scoreEl = $('#score');
const emoteCard = $('#emoteCard');
const emoteImg = $('#emoteImg');
const controls = $('#controls');
const guessInput = $('#guessInput');
const submitBtn = $('#submitBtn');
const skipBtn = $('#skipBtn');
const nextBtn = $('#nextBtn');
const yearEl = $('#year');
const manualJson = $('#manualJson');
const manualLoadBtn = $('#manualLoadBtn');

yearEl.textContent = new Date().getFullYear();

let emotes = [];          // array of {name, url}
let idx = 0;
let score = 0;
let current = null;

/* twitch & UI helpers */
let chatClient = null;
let chatLocked = false;                // prevents multiple winners per emote
let currentChannel = null;             // lowercased channel name
let chatLogMax = 200;                  // max chat lines kept in UI
const TB_PREFIX = 'emoteguesser_lb_';  // leaderboard per-channel prefix
const BOT_USER_KEY = 'eg_bot_user';
const BOT_OAUTH_KEY = 'eg_bot_oauth';

loadLeaderboardUI(); // ensure UI placeholders are present

/* -----------------------------
   SHUFFLE EMOTES (Fisher-Yates)
------------------------------*/
function shuffle(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setStatus(s, isError = false){
  statusEl.textContent = s;
  statusEl.style.color = isError ? '#ff8686' : '';
}

/* -----------------------------
   Leaderboard storage + UI
   Per-channel: LB key = TB_PREFIX + channel
   Data shape: {
     username: { wins: number, lastWin: ISOstring }
   }
------------------------------*/
function lbKeyFor(channel){
  if(!channel) return TB_PREFIX + 'global';
  return TB_PREFIX + channel.toLowerCase();
}

function loadLeaderboardFor(channel){
  const key = lbKeyFor(channel);
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch(e){
    console.warn('lb load failed', e);
    return {};
  }
}

function saveLeaderboardFor(channel, obj){
  try {
    localStorage.setItem(lbKeyFor(channel), JSON.stringify(obj));
  } catch(e){
    console.warn('lb save failed', e);
  }
}

/* record a win for a username on current channel */
function recordWinForChannel(channel, user){
  if(!channel || !user) return;
  const lb = loadLeaderboardFor(channel);
  const uname = String(user).trim();
  const now = new Date().toISOString();
  lb[uname] = lb[uname] || { wins: 0, lastWin: null };
  lb[uname].wins += 1;
  lb[uname].lastWin = now;
  saveLeaderboardFor(channel, lb);
  renderLeaderboard(channel);
}

/* render top 10 into #eg-leaderboard-list */
function renderLeaderboard(channel){
  const container = ensureLeaderboardContainer();
  if(!container) return;
  const listEl = container.querySelector('#eg-leaderboard-list');
  const lb = loadLeaderboardFor(channel);
  const items = Object.keys(lb).map(k => ({name: k, wins: lb[k].wins, lastWin: lb[k].lastWin}));
  items.sort((a,b)=> b.wins - a.wins || (b.lastWin || '').localeCompare(a.lastWin || ''));
  const top = items.slice(0,10);
  if(top.length === 0){
    listEl.innerHTML = `<div style="color:var(--muted)">No wins yet for <strong>${escapeHtml(channel||'—')}</strong></div>`;
    return;
  }
  listEl.innerHTML = top.map((it,i)=> {
    const ts = it.lastWin ? new Date(it.lastWin).toLocaleString() : '—';
    return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.02)">
      <div>#${i+1} <strong style="margin-left:8px">${escapeHtml(it.name)}</strong><div style="font-size:12px;color:var(--muted);margin-top:4px">${ts}</div></div>
      <div style="align-self:center;font-weight:700">${it.wins}</div>
    </div>`;
  }).join('');
}

/* -----------------------------
   Chat log UI
------------------------------*/
function ensureChatLogContainer(){
  let c = document.getElementById('eg-chat-log');
  if(c) return c;
  const sidebar = document.querySelector('.sidebar');
  if(!sidebar) return null;
  c = document.createElement('div');
  c.id = 'eg-chat-log';
  c.style.marginTop = '12px';
  c.innerHTML = `<h4 style="margin:8px 0 6px 0">Chat (live)</h4>
    <div id="eg-chat-lines" style="max-height:160px;overflow:auto;padding:6px;background:rgba(255,255,255,0.01);border-radius:8px;font-family:monospace;font-size:13px"></div>`;
  sidebar.appendChild(c);
  return c;
}
function appendChatLine(channel, username, message){
  const cont = ensureChatLogContainer();
  if(!cont) return;
  const list = cont.querySelector('#eg-chat-lines');
  const ts = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = 'eg-chat-line';
  line.style.padding = '4px 0';
  line.innerHTML = `<strong style="color:var(--accent)">${escapeHtml(username)}</strong> <span style="color:var(--muted);font-size:12px">[${ts}]</span>: ${escapeHtml(message)}`;
  list.appendChild(line);
  // trim
  while(list.children.length > chatLogMax) list.removeChild(list.firstChild);
  list.scrollTop = list.scrollHeight;
}

/* -----------------------------
   Bot settings UI (optional announce)
------------------------------*/
function ensureBotSettings(){
  let b = document.getElementById('eg-bot-settings');
  if(b) return b;
  const sidebar = document.querySelector('.sidebar');
  if(!sidebar) return null;
  b = document.createElement('div');
  b.id = 'eg-bot-settings';
  b.style.marginTop = '12px';
  const savedUser = localStorage.getItem(BOT_USER_KEY) || '';
  const savedOauth = localStorage.getItem(BOT_OAUTH_KEY) ? '******' : '';
  b.innerHTML = `
    <h4 style="margin:8px 0 6px 0">Bot (optional)</h4>
    <div style="font-size:13px;color:var(--muted)">Set bot username + oauth to enable sending messages.</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="eg-bot-user" placeholder="bot username" value="${escapeHtml(savedUser)}" style="flex:1;padding:8px;border-radius:8px;background:#0b0c0d;border:1px solid rgba(255,255,255,0.03);color:#e6eef6" />
      <button id="eg-bot-save" style="padding:8px;border-radius:8px;background:transparent;border:1px solid rgba(255,255,255,0.06);cursor:pointer">Save</button>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="eg-bot-oauth" placeholder="oauth:xxxxxxxx" value="${escapeHtml(savedOauth)}" style="flex:1;padding:8px;border-radius:8px;background:#0b0c0d;border:1px solid rgba(255,255,255,0.03);color:#e6eef6" />
      <button id="eg-bot-clear" style="padding:8px;border-radius:8px;background:transparent;border:1px solid rgba(255,255,255,0.06);cursor:pointer">Clear</button>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">To announce winners you need a bot account oauth token (prefixed with "oauth:"). You can set it here. Saved to localStorage.</div>
  `;
  sidebar.appendChild(b);

  b.querySelector('#eg-bot-save').addEventListener('click', ()=>{
    const u = b.querySelector('#eg-bot-user').value.trim();
    const t = b.querySelector('#eg-bot-oauth').value.trim();
    if(!u || !t){ alert('Both username and oauth token required'); return; }
    localStorage.setItem(BOT_USER_KEY, u);
    localStorage.setItem(BOT_OAUTH_KEY, t);
    alert('Bot creds saved. Reconnecting to chat with bot identity (if channel loaded).');
    if(currentChannel) connectToTwitchChat(currentChannel); // reconnect using bot creds
  });
  b.querySelector('#eg-bot-clear').addEventListener('click', ()=>{
    if(!confirm('Clear stored bot creds?')) return;
    localStorage.removeItem(BOT_USER_KEY);
    localStorage.removeItem(BOT_OAUTH_KEY);
    alert('Cleared. Chat will reconnect without bot identity.');
    if(currentChannel) connectToTwitchChat(currentChannel);
  });

  return b;
}

/* -----------------------------
   Leaderboard container + clear button
------------------------------*/
function ensureLeaderboardContainer(){
  let container = document.getElementById('eg-leaderboard');
  if(container) return container;
  const sidebar = document.querySelector('.sidebar');
  if(!sidebar) return null;
  container = document.createElement('div');
  container.id = 'eg-leaderboard';
  container.style.marginTop = '12px';
  container.innerHTML = `
    <h3 style="margin-top:0">Leaderboard (Top 10)</h3>
    <div id="eg-leaderboard-list" style="font-family:monospace"></div>
    <div style="margin-top:8px;font-size:13px;color:var(--muted)">
      Wins stored per-channel in browser.
      <button id="eg-clear-lb" style="margin-left:8px;padding:6px;border-radius:6px;background:transparent;border:1px solid rgba(255,255,255,0.04);cursor:pointer">Clear</button>
    </div>
  `;
  sidebar.appendChild(container);
  container.querySelector('#eg-clear-lb').addEventListener('click', ()=>{
    if(!currentChannel){ alert('Load a channel first to clear that channel leaderboard'); return; }
    if(!confirm(`Clear leaderboard for ${currentChannel}?`)) return;
    saveLeaderboardFor(currentChannel, {});
    renderLeaderboard(currentChannel);
  });
  ensureChatLogContainer();
  ensureBotSettings();
  return container;
}

/* -----------------------------
   Utility
------------------------------*/
function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* -----------------------------
   Emote display + local guessing (unchanged)
------------------------------*/
function showEmoteAt(i){
  if(!emotes.length || i < 0 || i >= emotes.length) return;
  current = emotes[i];
  chatLocked = false;
  emoteImg.src = current.url;
  emoteImg.alt = current.name;
  emoteCard.classList.remove('hidden');
  controls.classList.remove('hidden');
  guessInput.value = '';
  guessInput.focus();
  nextBtn.classList.add('hidden');
  setStatus(`Emote ${i+1} of ${emotes.length} — guess the name!`);
}

function normalizeName(s){
  return (s||'').trim().toLowerCase();
}

function checkGuess(){
  const guess = normalizeName(guessInput.value);
  if(!current) return;
  if(!guess){ setStatus('Type something to guess.'); return; }
  const correct = normalizeName(current.name);
  if(guess === correct){
    score += 1;
    scoreEl.textContent = score;
    setStatus(`Correct! It was "${current.name}".`);
    // record local "You" as a win in current channel if channel loaded
    if(currentChannel) recordWinForChannel(currentChannel, 'You');
    revealAndNext();
  } else {
    setStatus(`Nope — try again or Skip.`, true);
  }
}

function revealAndNext(){
  chatLocked = true;
  setStatus(`Answer: ${current.name}`);
  nextBtn.classList.remove('hidden');
  guessInput.blur();
}

function nextEmote(){
  idx++;
  if(idx >= emotes.length){
    setStatus(`Done! Final score: ${score}/${emotes.length}`);
    emoteCard.classList.add('hidden');
    controls.classList.add('hidden');
    return;
  }
  showEmoteAt(idx);
}

function skipEmote(){
  chatLocked = true;
  setStatus(`Skipped. Answer: ${current.name}`);
  nextBtn.classList.remove('hidden');
  guessInput.blur();
}

submitBtn.addEventListener('click', checkGuess);
guessInput.addEventListener('keydown', (e)=> { if(e.key==='Enter') checkGuess(); });
skipBtn.addEventListener('click', skipEmote);
nextBtn.addEventListener('click', nextEmote);

/* -----------------------------
   Manual JSON load (unchanged)
------------------------------*/
manualLoadBtn.addEventListener('click', ()=> {
  try {
    const arr = JSON.parse(manualJson.value);
    if(!Array.isArray(arr)) throw new Error('Not an array');
    const collection = arr.map(it => {
      if(typeof it === 'string') return { name: it, url: it };
      return { name: it.name || it.code || 'unknown', url: it.url || it.src || it.image };
    }).filter(it => it.url && it.name);

    if(!collection.length) throw new Error('No valid emotes found');
    emotes = shuffle(collection);
    idx = 0; score = 0; scoreEl.textContent = '0';
    channelNameEl.textContent = 'manual';
    currentChannel = null;
    setStatus(`Loaded ${emotes.length} emotes from pasted JSON.`);
    showEmoteAt(0);
    renderLeaderboard(currentChannel);
  } catch(err){
    setStatus('Invalid JSON: ' + err.message, true);
  }
});

/* -----------------------------
   Load channel + fetch emotes (unchanged behavior, plus connect)
------------------------------*/
loadBtn.addEventListener('click', ()=> {
  const raw = channelInput.value.trim().replace(/^#/, '');
  if(!raw){ setStatus('Please enter a Twitch channel name.', true); return; }
  startLoadForChannel(raw);
});

async function startLoadForChannel(username){
  setStatus('Resolving Twitch username to ID...');
  channelNameEl.textContent = username;
  currentChannel = username.toLowerCase();
  emotes = []; idx = 0; score = 0; scoreEl.textContent = '0';
  emoteCard.classList.add('hidden'); controls.classList.add('hidden');

  // disconnect previous chat
  if(chatClient && typeof chatClient.disconnect === 'function'){
    try { chatClient.removeAllListeners && chatClient.removeAllListeners(); chatClient.disconnect(); } catch(e){}
    chatClient = null;
  }

  try {
    const id = await resolveTwitchId(username);
    setStatus(`Twitch ID: ${id} — fetching 7TV emotes...`);
    const loaded = await fetch7tvEmotesForTwitchId(id);
    if(!loaded.length){ setStatus('No 7TV emotes found for that channel.', true); return; }
    emotes = shuffle(loaded);
    setStatus(`Loaded ${emotes.length} emotes. Good luck!`);
    idx = 0; score = 0; scoreEl.textContent = '0';
    showEmoteAt(0);

    // render leaderboard for this channel
    renderLeaderboard(currentChannel);
    // connect chat (will use bot identity if user saved creds)
    connectToTwitchChat(username);

  } catch(err){
    console.error(err);
    setStatus('Failed: ' + err.message, true);
  }
}

/* -----------------------------
   7TV + Twitch id helpers (unchanged)
------------------------------*/
async function resolveTwitchId(username){
  try {
    const dec = await fetch(`https://decapi.me/twitch/id/${encodeURIComponent(username)}`, {cache:'no-cache'});
    if(dec.ok){
      const text = (await dec.text()).trim();
      if(/^\d+$/.test(text)) return text;
    }
  } catch(e){}
  try {
    const ivr = await fetch(`https://api.ivr.fi/v2/twitch/user/${encodeURIComponent(username)}`);
    if(ivr.ok){
      const j = await ivr.json();
      if(j && (j.id || j.id_str || j.user_id)) return String(j.id || j.id_str || j.user_id);
    }
  } catch(e){}
  try {
    const helix = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`);
    if(helix.ok){
      const j = await helix.json();
      if(j && j.data && j.data[0] && j.data[0].id) return j.data[0].id;
    }
  } catch(e){}
  throw new Error('Could not resolve Twitch ID — public lookup endpoints failed.');
}

async function fetch7tvEmotesForTwitchId(twitchId){
  try {
    const r = await fetch(`https://api.7tv.app/v2/users/${twitchId}/emotes`);
    if(r.ok){
      const arr = await r.json();
      if(Array.isArray(arr) && arr.length){
        return arr.map(e => {
          let url = '';
          if(e.urls && e.urls.length) url = e.urls[e.urls.length - 1][1];
          else if(e.url) url = e.url;
          else if(e.host && e.host.url) url = e.host.url;
          return { name: e.name || e.code || e.alias || 'emote', url: url || build7tvUrlFromId(e.id) };
        }).filter(it => it.url);
      }
    }
  } catch(e){ console.debug('api.7tv.app failed', e); }

  try {
    const r = await fetch(`https://7tv.io/v3/users/twitch/${twitchId}`);
    if(r.ok){
      const j = await r.json();
      const setId = (j && (j.emote_set?.id || j.emote_set_id || j.emote_set));
      if(setId){
        const s = await fetch(`https://7tv.io/v3/emote-sets/${setId}`);
        if(s.ok){
          const sj = await s.json();
          const arr = sj.emotes || sj;
          if(Array.isArray(arr) && arr.length){
            return arr.map(e => {
              let url = '';
              if(e.urls && e.urls.length) url = e.urls[e.urls.length-1][1];
              else if(e.host && e.host.url) url = e.host.url;
              else if(e.id) url = build7tvUrlFromId(e.id);
              return { name: e.name || e.code || 'emote', url };
            }).filter(it => it.url);
          }
        }
      }
      if(Array.isArray(j.emotes) && j.emotes.length){
        return j.emotes.map(e=>({
          name:e.name,
          url: e.urls ? e.urls[e.urls.length-1][1] : build7tvUrlFromId(e.id)
        })).filter(it=>it.url);
      }
    }
  } catch(e){ console.debug('7tv.io attempt failed', e); }

  try {
    const proxy = await fetch(`https://emotes.adamcy.pl/7tv/channel/${encodeURIComponent(twitchId)}`);
    if(proxy.ok){
      const data = await proxy.json();
      if(Array.isArray(data) && data.length){
        return data.map(e=>({
          name:e.name,
          url:e.url || e.urls?.[0]?.[1] || build7tvUrlFromId(e.id)
        })).filter(it => it.url);
      }
    }
  } catch(e){ console.debug('proxy failed', e); }

  return [];
}

function build7tvUrlFromId(id){
  if(!id) return '';
  return `https://cdn.7tv.app/emote/${id}/4x`;
}

/* -----------------------------
   tmi.js dynamic load + connect (supports optional bot creds)
------------------------------*/
function loadTmiIfNeeded(){
  return new Promise((resolve,reject)=>{
    if(window.tmi && window.tmi.Client) return resolve();
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/tmi.js@1.8.5/dist/tmi.min.js';
    s.onload = ()=> { if(window.tmi && window.tmi.Client) resolve(); else reject(new Error('tmi loaded but not available')); };
    s.onerror = ()=> reject(new Error('Failed to load tmi.js'));
    document.head.appendChild(s);
  });
}

async function connectToTwitchChat(channel){
  try {
    await loadTmiIfNeeded();
  } catch(e){
    console.warn('Could not load tmi.js', e);
    setStatus('Warning: chat disabled (tmi.js failed to load).', true);
    return;
  }

  // disconnect old
  if(chatClient && typeof chatClient.disconnect === 'function'){
    try { chatClient.removeAllListeners && chatClient.removeAllListeners(); chatClient.disconnect(); } catch(e){}
    chatClient = null;
  }

  // if bot creds present, use them
  const botUser = localStorage.getItem(BOT_USER_KEY);
  const botOauth = localStorage.getItem(BOT_OAUTH_KEY);

  const opts = {
    connection: { reconnect: true, secure: true },
    channels: [ channel.toLowerCase() ]
  };

  if(botUser && botOauth){
    opts.identity = { username: botUser, password: botOauth };
  }

  try {
    chatClient = new tmi.Client(opts);
    chatClient.on('message', (chan, tags, message, self) => {
      if(self) return;
      appendChatLine(chan, tags['display-name'] || tags.username || 'unknown', message);
      handleChatMessage(tags, message);
    });
    chatClient.on('connected', ()=> setStatus(`Connected to chat (${channel}). Chatters can now guess!`));
    chatClient.on('disconnected', ()=> setStatus('Chat disconnected.', true));
    await chatClient.connect();
  } catch(e){
    console.error('chat connect failed', e);
    setStatus('Chat connect failed: ' + (e && e.message), true);
  }
}

/* -----------------------------
   Chat handling: exact match or !guess <name>
------------------------------*/
function handleChatMessage(tags, message){
  if(!current) return;
  if(chatLocked) return;

  const txt = String(message || '');
  const norm = normalizeName(txt);

  // support "!guess emote"
  if(norm.startsWith('!guess ')){
    const arg = norm.slice(7).trim();
    if(!arg) return;
    tryChatGuess(tags, arg);
    return;
  }
  // also treat exact message as a guess
  tryChatGuess(tags, norm);
}

function tryChatGuess(tags, guessText){
  if(!current) return;
  const correct = normalizeName(current.name);
  if(guessText === correct){
    chatLocked = true;
    const display = tags['display-name'] || tags.username || 'unknown';
    score += 1;
    scoreEl.textContent = score;
    setStatus(`🎉 ${display} guessed "${current.name}"!`);
    // record win per-channel
    if(currentChannel) recordWinForChannel(currentChannel, display);
    // reveal & next
    revealAndNext();
    // announce in chat if bot identity present & chatClient.say exists
    tryAnnounceWinnerInChat(display, current.name);
  }
}

/* -----------------------------
   Announce winner in chat (requires bot creds)
   If bot creds are not provided, this function silently no-ops.
------------------------------*/
function tryAnnounceWinnerInChat(displayName, emoteName){
  if(!chatClient || typeof chatClient.say !== 'function') return;
  const botUser = localStorage.getItem(BOT_USER_KEY);
  const botOauth = localStorage.getItem(BOT_OAUTH_KEY);
  if(!botUser || !botOauth) return;
  // attempt to say in the channel
  try {
    chatClient.say(currentChannel, `🎉 ${displayName} guessed "${emoteName}"!`).catch(()=>{});
  } catch(e){}
}

/* -----------------------------
   initial UI wiring
------------------------------*/
channelInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') loadBtn.click(); });
channelInput.value = '';
renderLeaderboard(null); // render global/empty on load

/* -----------------------------
   UI setup helpers invoked at top
------------------------------*/
function loadLeaderboardUI(){
  ensureLeaderboardContainer();
  ensureChatLogContainer();
  ensureBotSettings();
}
