/* EmoteGuesser + Twitch Chat Guessing
   Adds:
   - Connect to Twitch chat using tmi.js
   - Listen for messages
   - First chatter to guess emote wins
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

let chatClient = null;
let twitchChannel = null;
let chatLocked = false;     // prevents multiple winners per emote

/* -------------------------------------
   SHUFFLE EMOTES
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

/* -------------------------------------
   LOCAL GUESSING
-------------------------------------- */
function checkGuess(){
  const guess = normalizeName(guessInput.value);
  if(!current) return;
  if(!guess){
    setStatus('Type something to guess.');
    return;
  }
  const correct = normalizeName(current.name);
  if(guess === correct){
    score++;
    scoreEl.textContent = score;
    setStatus(`Correct! It was "${current.name}".`);
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
  if(!raw){
    setStatus('Please enter a Twitch channel name.', true);
    return;
  }
  twitchChannel = raw.toLowerCase();
  startLoadForChannel(twitchChannel);
});

async function startLoadForChannel(username){
  setStatus('Resolving Twitch username to ID...');
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

    if(!loaded.length){
      setStatus('No 7TV emotes found for that channel.', true);
      return;
    }

    emotes = shuffle(loaded);

    setStatus(`Loaded ${emotes.length} emotes. Good luck!`);
    idx = 0;
    score = 0;
    scoreEl.textContent = '0';
    channelNameEl.textContent = username;
    showEmoteAt(0);

    connectToTwitchChat(username);   // ⭐ Start chat guessing

  } catch(err){
    console.error(err);
    setStatus('Failed: ' + err.message, true);
  }
}

/* -------------------------------------
   TWITCH ID LOOKUP + 7TV APIs
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
      if(j && (j.id)) return String(j.id);
    }
  } catch(e){}

  throw new Error('Could not resolve Twitch ID.');
}

async function fetch7tvEmotesForTwitchId(twitchId){
  try {
    const r = await fetch(`https://api.7tv.app/v2/users/${twitchId}/emotes`);
    if(r.ok){
      const arr = await r.json();
      if(Array.isArray(arr) && arr.length){
        return arr.map(e => ({
          name: e.name,
          url: e.urls?.[e.urls.length - 1]?.[1]
        }));
      }
    }
  } catch(e){}

  return [];
}

function build7tvUrlFromId(id){
  return `https://cdn.7tv.app/emote/${id}/4x`;
}

/* -------------------------------------
   CONNECT TO TWITCH CHAT (tmi.js)
-------------------------------------- */
function connectToTwitchChat(channel){
  if(chatClient){
    try { chatClient.disconnect(); } catch(e){}
  }

  chatClient = new tmi.Client({
    connection: { reconnect: true },
    channels: [ channel ]
  });

  chatClient.connect().then(() => {
    setStatus(`Connected to Twitch chat — waiting for guesses...`);
  });

  chatClient.on('message', (chan, tags, msg) => {
    if(!current) return;
    if(chatLocked) return;

    const guess = normalizeName(msg);
    const correct = normalizeName(current.name);

    if(guess === correct){
      chatLocked = true;

      setStatus(
        `🎉 Correct! "${current.name}" was guessed by ${tags['display-name']}!`
      );

      nextBtn.classList.remove('hidden');
    }
  });
}

/* -------------------------------------
   ENTER KEY FOR CHANNEL
-------------------------------------- */
channelInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter') loadBtn.click();
});

channelInput.value = '';
