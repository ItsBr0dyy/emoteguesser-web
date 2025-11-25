/* EmoteGuesser — client-only web remake
   + Twitch Chat guessing support
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

let emotes = [];
let idx = 0;
let score = 0;
let current = null;

/* Shuffle */
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

function showEmoteAt(i){
  if(!emotes.length || i < 0 || i >= emotes.length) return;
  current = emotes[i];
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
  if(!guess){
    setStatus('Type something to guess.');
    return;
  }
  const correct = normalizeName(current.name);
  if(guess === correct){
    score += 1;
    scoreEl.textContent = score;
    setStatus(`Correct! It was "${current.name}".`);
    revealAndNext();
  } else {
    setStatus(`Nope — try again or Skip.`, true);
  }
}

function revealAndNext(){
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

/* Manual JSON loader */
manualLoadBtn.addEventListener('click', () => {
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
    setStatus(`Loaded ${emotes.length} emotes from pasted JSON.`);
    showEmoteAt(0);
  } catch (err){
    setStatus('Invalid JSON: ' + err.message, true);
  }
});

loadBtn.addEventListener('click', () => {
  const raw = channelInput.value.trim().replace(/^#/, '');
  if(!raw){ setStatus('Please enter a Twitch channel name.', true); return; }
  startLoadForChannel(raw);
});

/* Load Twitch emotes */
async function startLoadForChannel(username){
  setStatus('Resolving Twitch username to ID...');
  channelNameEl.textContent = username;
  emotes = [];
  idx = 0;
  score = 0;
  scoreEl.textContent = '0';
  emoteCard.classList.add('hidden');
  controls.classList.add('hidden');

  try {
    const id = await resolveTwitchId(username);
    setStatus(`Twitch ID: ${id} — fetching 7TV emotes...`);
    const loaded = await fetch7tvEmotesForTwitchId(id);

    if(!loaded.length) {
      setStatus('No 7TV emotes found for that channel.', true);
      return;
    }

    emotes = shuffle(loaded);

    setStatus(`Loaded ${emotes.length} emotes. Good luck!`);
    idx = 0;
    score = 0;
    scoreEl.textContent = '0';
    showEmoteAt(0);

    /* NEW — connect chat guessing */
    connectToTwitchChat(username);

  } catch(err){
    console.error(err);
    setStatus('Failed: ' + err.message, true);
  }
}

/* Resolve Twitch ID */
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

  throw new Error('Could not resolve Twitch ID.');
}

/* Fetch 7TV emotes */
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
          return { name: e.name || e.code || 'emote', url: url };
        }).filter(it => it.url);
      }
    }
  } catch(e){
    console.debug('api.7tv.app failed', e);
  }

  return [];
}

/* --------------------------
   TWITCH CHAT GUESSING
---------------------------*/

let chatSocket = null;

function connectToTwitchChat(channel) {
  if (chatSocket) chatSocket.close();

  const chan = channel.toLowerCase().replace(/^#/, "");
  chatSocket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

  chatSocket.onopen = () => {
    console.log("Connected to Twitch IRC");
    chatSocket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
    chatSocket.send("PASS oauth:anonymous");
    chatSocket.send("NICK justinfan12345");
    chatSocket.send(`JOIN #${chan}`);
  };

  chatSocket.onmessage = (event) => {
    const msg = event.data;

    if (msg.includes("PING")) {
      chatSocket.send("PONG :tmi.twitch.tv");
      return;
    }

    const match = msg.match(/:(.+)!.+ PRIVMSG #[^ ]+ :(.+)/);
    if (!match) return;

    const username = match[1].toLowerCase();
    const message = match[2].trim();

    checkChatGuess(username, message);
  };
}

function checkChatGuess(username, message) {
  if (!current) return;

  const guess = normalizeName(message);
  const correct = normalizeName(current.name);

  if (guess === correct) {
    score += 1;
    scoreEl.textContent = score;
    setStatus(`CHAT GOT IT! ${username} guessed "${current.name}"`);
    revealAndNext();
  }
}

/* Input shortcut */
channelInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter') loadBtn.click();
});

channelInput.value = '';
