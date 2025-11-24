/* EmoteGuesser — client-only web remake
   Tries multiple public endpoints to:
   1) Resolve Twitch username -> id (decapi.me, ivr.fi)
   2) Fetch 7TV emotes for the channel (tries api.7tv.app and 7tv.io)
   If APIs fail, user can paste manual JSON of emotes.
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
  // hide input to prevent multiple guesses until next
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

manualLoadBtn.addEventListener('click', () => {
  try {
    const arr = JSON.parse(manualJson.value);
    if(!Array.isArray(arr)) throw new Error('Not an array');
    const collection = arr.map(it => {
      if(typeof it === 'string') return { name: it, url: it }; // not likely
      return { name: it.name || it.code || 'unknown', url: it.url || it.src || it.image };
    }).filter(it => it.url && it.name);
    if(!collection.length) throw new Error('No valid emotes found');
    emotes = collection;
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
    emotes = loaded;
    setStatus(`Loaded ${emotes.length} emotes. Good luck!`);
    idx = 0;
    score = 0;
    scoreEl.textContent = '0';
    showEmoteAt(0);
  } catch(err){
    console.error(err);
    setStatus('Failed: ' + err.message, true);
  }
}

/* Utility: attempt several public services to resolve username -> Twitch user id.
   1) decapi.me (plain text)
   2) api.ivr.fi (JSON)
   3) fallback: try twitch-helix without token (may fail)
*/
async function resolveTwitchId(username){
  // 1) decapi
  try {
    const dec = await fetch(`https://decapi.me/twitch/id/${encodeURIComponent(username)}`, {cache:'no-cache'});
    if(dec.ok){
      const text = (await dec.text()).trim();
      if(/^\d+$/.test(text)) return text;
    }
  } catch(e){}
  // 2) ivr.fi
  try {
    const ivr = await fetch(`https://api.ivr.fi/v2/twitch/user/${encodeURIComponent(username)}`);
    if(ivr.ok){
      const j = await ivr.json();
      if(j && (j.id || j.id_str || j.user_id)) return String(j.id || j.id_str || j.user_id);
    }
  } catch(e){}
  // 3) try twitch helix endpoint (requires Client-ID normally). Try with no header in case of public proxy.
  try {
    const helix = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`);
    if(helix.ok){
      const j = await helix.json();
      if(j && j.data && j.data[0] && j.data[0].id) return j.data[0].id;
    }
  } catch(e){}
  throw new Error('Could not resolve Twitch ID — public lookup endpoints failed. (Try pasting emote JSON manually.)');
}

/* Try multiple 7TV endpoints and shape results to {name,url}
   1) api.7tv.app v2: /v2/users/{twitch_id}/emotes
   2) 7tv.io v3: /v3/users/twitch/{twitch_id} -> may reference emote_set -> fetch emote-set
   3) fallback: try CrippledByte/emotes-api public proxies (if available)
*/
async function fetch7tvEmotesForTwitchId(twitchId){
  // try api.7tv.app v2
  try {
    const r = await fetch(`https://api.7tv.app/v2/users/${twitchId}/emotes`);
    if(r.ok){
      const arr = await r.json();
      if(Array.isArray(arr) && arr.length){
        return arr.map(e => {
          // v2 returns { id, name, urls: [[size, url], ...] } or url fields
          let url = '';
          if(e.urls && e.urls.length){
            // find the largest (last) url
            url = e.urls[e.urls.length - 1][1];
          } else if(e.url) url = e.url;
          else if(e.host && e.host.url) url = e.host.url;
          // some urls are relative; try to normalise
          return { name: e.name || e.code || e.alias || 'emote', url: url || build7tvUrlFromId(e.id) };
        }).filter(it => it.url);
      }
    }
  } catch(e){
    // ignore
    console.debug('api.7tv.app failed', e);
  }

  // try 7tv.io v3 user endpoint (returns emote_set id)
  try {
    const r = await fetch(`https://7tv.io/v3/users/twitch/${twitchId}`);
    if(r.ok){
      const j = await r.json();
      // common shape: { emote_set: { id: '...' } } or { emote_set_id: '...' }
      const setId = (j && (j.emote_set?.id || j.emote_set_id || j.emote_set));
      if(setId){
        // fetch emote set
        const s = await fetch(`https://7tv.io/v3/emote-sets/${setId}`);
        if(s.ok){
          const sj = await s.json();
          // sj.emotes array likely
          const arr = sj.emotes || sj;
          if(Array.isArray(arr) && arr.length){
            return arr.map(e => {
              // e may have id, name, urls, host or similar
              let url = '';
              if(e.urls && e.urls.length) url = e.urls[e.urls.length-1][1];
              else if(e.host && e.host.url) url = e.host.url;
              else if(e.id) url = build7tvUrlFromId(e.id);
              return { name: e.name || e.code || 'emote', url };
            }).filter(it => it.url);
          }
        }
      }
      // sometimes v3 returns directly emotes
      if(Array.isArray(j.emotes) && j.emotes.length){
        return j.emotes.map(e=>({name:e.name, url: e.urls ? e.urls[e.urls.length-1][1] : build7tvUrlFromId(e.id)})).filter(it=>it.url);
      }
    }
  } catch(e){
    console.debug('7tv.io attempt failed', e);
  }

  // last-resort: public emotes proxies (CrippledByte emotes-api)
  try {
    const proxy = await fetch(`https://emotes.adamcy.pl/7tv/channel/${encodeURIComponent(twitchId)}`); // public proxies sometimes exist
    if(proxy.ok){
      const data = await proxy.json();
      if(Array.isArray(data) && data.length){
        return data.map(e=>({name:e.name, url:e.url || e.urls?.[0]?.[1] || build7tvUrlFromId(e.id)})).filter(it => it.url);
      }
    }
  } catch(e){
    console.debug('proxy failed', e);
  }

  // nothing found
  return [];
}

function build7tvUrlFromId(id){
  if(!id) return '';
  // common CDN patterns — might work for many cases:
  return `https://cdn.7tv.app/emote/${id}/4x`;
}

// small UX: allow pressing Enter on channel input
channelInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter') loadBtn.click();
});

// friendly default
channelInput.value = 'itsbr0dyy';
