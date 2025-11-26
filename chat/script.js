/* ===========================================================
   EMOTE GUESSER — FRONTEND-ONLY VERSION
   Twitch Chat Guessing + First Guess Leaderboard
   =========================================================== */

const $ = sel => document.querySelector(sel);

/* =================================================================
   GLOBAL STATE
================================================================= */
let emotes = [];
let currentIndex = 0;
let currentEmote = null;

let leaderboard = JSON.parse(localStorage.getItem("leaderboard") || "{}");

/* =================================================================
   SAVE / RENDER LEADERBOARD
================================================================= */
function saveLeaderboard() {
    localStorage.setItem("leaderboard", JSON.stringify(leaderboard));
}

function recordFirstGuess(username, emoteName) {
    if (!leaderboard[username]) leaderboard[username] = 0;

    leaderboard[username]++;

    document.getElementById("lastWinner").textContent =
        `${emoteName} first was ${username}`;

    saveLeaderboard();
    renderLeaderboard();
}

function renderLeaderboard() {
    const list = document.getElementById("leaderboard");
    if (!list) return;

    const sorted = Object.entries(leaderboard)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    list.innerHTML = sorted
        .map(([user, score]) => `<li><strong>${user}</strong> — ${score}</li>`)
        .join("");
}
renderLeaderboard();

/* =================================================================
   LOAD EMOTES (7TV/Manual)
================================================================= */
async function loadChannelEmotes(username) {
    $("#status").textContent = "Loading emotes…";

    try {
        // 1) Try IVR to resolve username -> ID
        const ivr = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${username}`);
        const ivrJson = await ivr.json();
        const userId = ivrJson[0]?.id;

        // 2) Pull 7TV emotes for the Twitch ID
        const res = await fetch(`https://7tv.io/v3/users/twitch/${userId}`);
        const data = await res.json();

        emotes = data.emote_set.emotes.map(e => ({
            name: e.name.toLowerCase(),
            url: `https:${e.data.host.url}/3x`,
        }));

        shuffleArray(emotes);
        currentIndex = 0;
        showNextEmote();

        $("#status").textContent = `Loaded ${emotes.length} emotes.`;

    } catch (err) {
        $("#status").textContent = "Failed to load channel emotes.";
    }
}

/* =================================================================
   RANDOM SHUFFLE
================================================================= */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

/* =================================================================
   DISPLAY NEXT EMOTE
================================================================= */
function showNextEmote() {
    const card = $("#emoteCard");
    card.classList.add("hidden");

    setTimeout(() => {
        currentEmote = emotes[currentIndex];
        currentIndex++;

        if (!currentEmote) {
            $("#emoteName").textContent = "No more emotes";
            $("#emoteImg").src = "";
            return;
        }

        $("#emoteImg").src = currentEmote.url;
        $("#emoteName").textContent = "Guess the emote!";

        currentEmote._guessed = false;

        card.classList.remove("hidden");
    }, 150);
}

/* =================================================================
   HANDLE LOCAL INPUT GUESS
================================================================= */
$("#guessInput").addEventListener("keydown", e => {
    if (e.key === "Enter") {
        checkGuess("You", $("#guessInput").value.trim().toLowerCase());
        $("#guessInput").value = "";
    }
});

function checkGuess(username, guess) {
    if (!currentEmote) return;

    if (guess === currentEmote.name.toLowerCase()) {

        if (!currentEmote._guessed) {
            currentEmote._guessed = true;

            recordFirstGuess(username, currentEmote.name);

            showNextEmote();
        }
    }
}

/* =================================================================
   CONNECT TO TWITCH CHAT (TMI.js)
================================================================= */
let client = null;

function connectChat(channel) {
    if (client) client.disconnect();

    client = new tmi.Client({
        channels: [channel]
    });

    client.connect();

    $("#status").textContent = "Connected to chat.";

    client.on("message", (channel, userstate, msg) => {
        if (!currentEmote) return;

        const guess = msg.trim().toLowerCase();
        const username = userstate["display-name"] || userstate.username;

        if (guess === currentEmote.name.toLowerCase() && !currentEmote._guessed) {
            currentEmote._guessed = true;

            recordFirstGuess(username, currentEmote.name);

            showNextEmote();
        }
    });
}

/* =================================================================
   BUTTON HOOKS
================================================================= */
$("#loadBtn").addEventListener("click", () => {
    const user = $("#channelInput").value.trim().toLowerCase();
    if (!user) return;

    loadChannelEmotes(user);
    connectChat(user);
});

$("#skipBtn").addEventListener("click", () => showNextEmote());

$("#randomizeBtn").addEventListener("click", () => {
    shuffleArray(emotes);
    currentIndex = 0;
    showNextEmote();
});

/* =================================================================
   MANUAL JSON IMPORT
================================================================= */
$("#manualBtn").addEventListener("click", () => {
    try {
        const json = JSON.parse($("#manualJson").value);
        emotes = json;
        shuffleArray(emotes);
        currentIndex = 0;
        showNextEmote();
        $("#status").textContent = "Loaded manual JSON.";
    } catch (e) {
        $("#status").textContent = "Invalid JSON.";
    }
});
