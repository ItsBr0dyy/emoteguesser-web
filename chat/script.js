/* EmoteGuesser — client-only web remake (Twitch chat + leaderboard)
   - Preserves original behavior
   - Adds Twitch chat guessing via tmi.js (dynamically loaded if needed)
   - Adds a top-10 leaderboard stored in localStorage
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

/* NEW: twitch chat client + locking + leaderboard */
let chatClient = null;
let chatLocked = false; // prevents multiple winners per emote
let currentChannel = null; // lowercased channel name
const LB_KEY = 'emoteguesser_leaderboard_v1'; // localStorage key
let leaderboard = {}; // {username: wins}

/* -------------------------------------
   SHUFFLE EMOTES (Fisher-Yates shuffle)
-------------------------------------- */
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

/* -------------------------------------
   LEADERBOARD (persisted)
-------------------------------------- */
function loadLeaderboard(){
  try {
    const raw = localStorage.getItem(LB_KEY);
    if(raw) leaderboard = JSON.parse(raw) || {};
    else leaderboard = {};
  } catch(e){
    console.warn('Failed to load leaderboard', e);
    leaderboard = {};
  }
  renderLeaderboard();
}

function saveLeaderboard(){
  try {
    localStorage.setItem(LB_KEY, JSON.stringify(leaderboard));
  } catch(e){
    console.warn('Failed to save leaderboard', e);
  }
}

/* increment wins for a user and re-render */
function recordWin(user){
  if(!user) return;
  const name = String(user).trim();
  if(!name) return;
  leaderboard[name] = (leaderboard[name] || 0) + 1;
  saveLeaderboard();
  renderLeaderboard();
}

/* create / update leaderboard DOM inside sidebar */
function ensureLeaderboardContainer(){
  let container = document.getElementById('eg-leaderboard');
  if(container) return container;

  const sidebar = document.querySelector('.sidebar');
  if(!sidebar) return null;

  container = document.createElement('div');
  container.id = 'eg-leaderboard';
  container.style.marginTop = '18px';
  container.innerHTML = `
    <h3 style="margin-top:0">Leaderboard (Top 10)</h3>
    <div id="eg-leaderboard-list" style="font-family:monospace"></div>
    <div style="margin-top:8px;font-size:13px;color:var(--muted)">
      Wins persist in browser storage.
      <button id="eg-clear-lb" style="margin-left:8px;padding:6px;border-radius:6px;background:transparent;border:1px solid rgba(255,255,255,0.04);cursor:pointer">Clear</button>
    </div>
  `;
  sidebar.appendChild(container);

  const clearBtn = document.getElementById('eg-clear-lb');
  clearBtn.addEventListener('click', () => {
    if(!confirm('Clear leaderboard?')) return;
    leaderboard = {};
    saveLeaderboard();
    renderLeaderboard();
  });

  return container;
}

function renderLeaderboard(){
  const container = ensureLeaderboardContainer();
  if(!container) return;
  const listEl = container.querySelector('#eg-leaderboard-list');
  // Convert to array and sort
  const items = Object.keys(leaderboard).map(k => ({name:k, wins: leaderboard[k]}));
  items.sort((a,b) => b.wins - a.wins || a.name.localeCompare(b.name));
  const top = items.slice(0,10);
  if(top.length === 0){
    listEl.innerHTML = `<div style="color:var(--muted)">No wins yet — be the first!</div>`;
    return;
  }
  listEl.innerHTML = top.map((it, i) => {
    const rank = i+1;
    return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.02)">
      <div>#${rank} <strong style="margin-left:6px">${escapeHtml(it.name)}</strong></div>
      <div style="opacity:0.85">${it.wins}</div>
    </div>`;
  }).join('');
}

/* small helper to avoid injection into leaderboard DOM */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
  });
}

/* -------------------------------------
   SHOW EMOTE / GUESSING
-------------------------------------- */
function showEmoteAt(i){
  if(!emotes.length || i < 0 || i >= emotes.length) return;
  current = emotes[i];
  chatLocked = false; // unlock chat guesses for new emote
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

/* original local guess check (preserve behavior) */
function checkGuess(){
  const guess = normalizeName(guessInput.value);
  if(!current) return;
  if(!guess){
    setStatus('Type something to guess.');
    return;
  }
  const correct = normalizeName(current.name);
  if(guess === correct){
    score += 1;
    scoreEl.textContent = score;
    setStatus(`Correct! It was "${current.name}".`);
    // record local "You" as a win too (optional). Comment out next line if you don't want local counted.
    recordWin('You');
    revealAndNext();
  } else {
    setStatus(`Nope — try again or Skip.`, true);
  }
}

function revealAndNext(){
  chatLocked = true; // stop chat from answering this round
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
guessInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter') checkGuess();
});
skipBtn.addEventListener('click', skipEmote);
nextBtn.addEventListener('click', nextEmote);

/* -------------------------------------
   MANUAL JSON LOAD
-------------------------------------- */
manualLoadBtn.addEventListener('click', () => {
  try {
    const arr = JSON.parse(manualJson.value);
    if(!Array.isArray(arr)) throw new Error('Not an array');
    const collection = arr.map(it => {
      if(typeof it === 'string') return { name: it, url: it };
      return { name: it.name || it.code || 'unknown', url: it.url || it.src || it.image };
    }).filter(it => it.url && it.name);

    if(!collection.length) throw new Error('No valid emotes found');

    /* RANDOMIZE HERE */
    emotes = shuffle(collection);

    idx = 0; score = 0; scoreEl.textContent = '0';
    channelNameEl.textContent = 'manual';
    setStatus(`Loaded ${emotes.length} emotes from pasted JSON.`);
    showEmoteAt(0);
  } catch (err){
    setStatus('Invalid JSON: ' + err.message, true);
  }
});

/* -------------------------------------
   LOAD CHANNEL + EMOTES
-------------------------------------- */
loadBtn.addEventListener('click', () => {
  const raw = channelInput.value.trim().replace(/^#/, '');
  if(!raw){ setStatus('Please enter a Twitch channel name.', true); return; }
  startLoadForChannel(raw);
});

async function startLoadForChannel(username){
  setStatus('Resolving Twitch username to ID...');
  channelNameEl.textContent = username;
  currentChannel = username.toLowerCase();
  emotes = [];
  idx = 0;
  score = 0;
  scoreEl.textContent = '0';
  emoteCard.classList.add('hidden');
  controls.classList.add('hidden');

  // disconnect existing chat if present
  if(chatClient && typeof chatClient.disconnect === 'function'){
    try { chatClient.removeAllListeners && chatClient.removeAllListeners(); chatClient.disconnect(); } catch(e){}
    chatClient = null;
  }

  try {
    const id = await resolveTwitchId(username);
    setStatus(`Twitch ID: ${id} — fetching 7TV emotes...`);
    const loaded = await fetch7tvEmotesForTwitchId(id);

    if(!loaded.length) {
      setStatus('No 7TV emotes found for that channel.', true);
      return;
    }

    /* RANDOMIZE HERE */
    emotes = shuffle(loaded);

    setStatus(`Loaded ${emotes.length} emotes. Good luck!`);
    idx = 0;
    score = 0;
    scoreEl.textContent = '0';
    showEmoteAt(0);

    // load leaderboard & connect to chat
    loadLeaderboard();
    connectToTwitchChat(username);

  } catch(err){
    console.error(err);
    setStatus('Failed: ' + err.message, true);
  }
}

/* -------------------------------------
   TWITCH ID LOOKUP + 7TV APIS (unchanged)
-------------------------------------- */
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

  throw new Error('Could not resolve Twitch ID — public lookup endpoints failed. (Try pasting emote JSON manually.)');
}

async function fetch7tvEmotesForTwitchId(twitchId){
  try {
    const r = await fetch(`https://api.7tv.app/v2/users/${twitchId}/emotes`);
    if(r.ok){
      const arr = await r.json();
      if(Array.isArray(arr) && arr.length){
        return arr.map(e => {
          let url = '';
          if(e.urls && e.urls.length){
            url = e.urls[e.urls.length - 1][1];
          } else if(e.url) url = e.url;
          else if(e.host && e.host.url) url = e.host.url;
          return { name: e.name || e.code || e.alias || 'emote', url: url || build7tvUrlFromId(e.id) };
        }).filter(it => it.url);
      }
    }
  } catch(e){
    console.debug('api.7tv.app failed', e);
  }

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
  } catch(e){
    console.debug('7tv.io attempt failed', e);
  }

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
  } catch(e){
    console.debug('proxy failed', e);
  }

  return [];
}

function build7tvUrlFromId(id){
  if(!id) return '';
  return `https://cdn.7tv.app/emote/${id}/4x`;
}

/* -------------------------------------
   TWITCH CHAT: dynamic load of tmi + connect
-------------------------------------- */
function loadTmiIfNeeded(){
  return new Promise((resolve, reject) => {
    if(window.tmi && window.tmi.Client) return resolve();
    // inject script
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/tmi.js@1.8.5/dist/tmi.min.js';
    s.onload = () => {
      if(window.tmi && window.tmi.Client) resolve();
      else reject(new Error('tmi loaded but not available'));
    };
    s.onerror = (e) => reject(new Error('Failed to load tmi.js'));
    document.head.appendChild(s);
  });
}

async function connectToTwitchChat(channel){
  // try to load tmi if not present
  try {
    await loadTmiIfNeeded();
  } catch(e){
    console.warn('Could not load tmi.js', e);
    setStatus('Warning: chat disabled (tmi.js failed to load).', true);
    return;
  }

  // disconnect previous
  if(chatClient && typeof chatClient.disconnect === 'function'){
    try { chatClient.removeAllListeners && chatClient.removeAllListeners(); chatClient.disconnect(); } catch(e){}
    chatClient = null;
  }

  try {
    chatClient = new tmi.Client({
      connection: { reconnect: true, secure: true },
      channels: [ channel.toLowerCase() ]
    });

    chatClient.on('message', (chan, tags, message, self) => {
      if(self) return; // ignore our own messages
      handleChatMessage(tags, message);
    });

    chatClient.on('connected', (addr, port) => {
      setStatus(`Connected to chat (${channel}). Chatters can now guess!`);
    });

    chatClient.on('disconnected', (reason) => {
      console.warn('tmi disconnected', reason);
      setStatus('Chat disconnected.', true);
    });

    await chatClient.connect();
  } catch(e){
    console.error('Failed to connect to chat', e);
    setStatus('Chat connect failed: ' + (e && e.message), true);
  }
}

/* Interpret chat messages: exact match OR "!guess name" */
function handleChatMessage(tags, message){
  if(!current) return;
  if(chatLocked) return;

  const txt = String(message||'');
  const norm = normalizeName(txt);

  // support "!guess emote" command
  if(norm.startsWith('!guess ')){
    const arg = norm.slice(7).trim();
    if(!arg) return;
    tryChatGuess(tags, arg);
    return;
  }

  // support exact match of emote name
  tryChatGuess(tags, norm);
}

function tryChatGuess(tags, guessText){
  if(!current) return;
  const correct = normalizeName(current.name);
  if(guessText === correct){
    chatLocked = true; // lock immediately so only first counts
    const display = tags['display-name'] || tags.username || 'unknown';
    score += 1;
    scoreEl.textContent = score;
    setStatus(`🎉 ${display} guessed "${current.name}"!`);
    // record to leaderboard
    recordWin(display);
    revealAndNext();
  }
}

/* -------------------------------------
   Init
-------------------------------------- */
channelInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter') loadBtn.click();
});

channelInput.value = '';

// load leaderboard on start (even before channel)
loadLeaderboard();
