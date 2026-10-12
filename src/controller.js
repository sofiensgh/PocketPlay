import { Player } from 'touch-coop';
import { AVATAR_COLORS, INDEX_TO_BUTTON } from './games/trivia.js';
import { diag, instrumentRTC, rtcSnapshot } from './diag.js';

const el = (id) => document.getElementById(id);

let player = null;
let myPlayerId = null;
let myColor = AVATAR_COLORS[0];
let hostPeerId = null;
let joined = false;
let phase = 'idle';
let myAnswer = null;
let timerId = null;
let remaining = 0;
let latestRoster = [];
let isHost = false;

function setPanel(name) {
    for (const panel of ['join', 'waiting', 'game', 'end', 'hostlost']) {
        el(`${panel}-panel`).hidden = panel !== name;
    }
}

function setJoinStatus(message, isError = false) {
    const status = el('join-status');
    status.textContent = message;
    status.classList.toggle('error', isError);
}

function stopTimer() {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }
}

function startTimer(from) {
    stopTimer();
    remaining = from;
    el('c-timer').textContent = remaining;
    el('c-timer').classList.toggle('urgent', remaining <= 5);
    timerId = setInterval(() => {
        remaining -= 1;
        el('c-timer').textContent = Math.max(0, remaining);
        el('c-timer').classList.toggle('urgent', remaining <= 5);
        if (remaining <= 0) stopTimer();
    }, 1000);
}

function setFeedback(message, style = '') {
    const feedback = el('c-feedback');
    feedback.textContent = message;
    feedback.className = style ? `feedback ${style}` : 'feedback';
}

function renderQuestion(message) {
    phase = 'question';
    myAnswer = null;
    setPanel('game');
    el('c-q-counter').textContent = `Q${message.number} / ${message.total}`;
    el('c-question').textContent = message.q;
    setFeedback('');

    document.querySelectorAll('.answer-btn').forEach((btn, i) => {
        btn.classList.remove('chosen', 'correct', 'wrong', 'dimmed');
        btn.disabled = false;
        btn.querySelector('.answer-text').textContent = message.answers[i] ?? '';
    });

    startTimer(message.remaining ?? message.duration);
}

function renderReveal(message) {
    phase = 'reveal';
    stopTimer();

    document.querySelectorAll('.answer-btn').forEach((btn, i) => {
        btn.disabled = true;
        btn.classList.remove('chosen', 'dimmed');
        if (i === message.correctIndex) {
            btn.classList.add('correct');
        } else if (i === myAnswer) {
            btn.classList.add('wrong');
        } else {
            btn.classList.add('dimmed');
        }
    });

    const correctText = message.answers[message.correctIndex];
    if (myAnswer === null) {
        setFeedback(`Time's up! The answer was ${correctText}`, 'muted');
    } else {
        const points = message.points ? message.points[myPlayerId] : 0;
        if (points > 0) {
            setFeedback(`Correct! +${points}`, 'good');
        } else {
            setFeedback(`Wrong! The answer was ${correctText}`, 'bad');
        }
    }
}

function renderFinished(rankings) {
    phase = 'finished';
    stopTimer();
    setPanel('end');

    const list = rankings || [];
    const myEntry = list.find((entry) => entry.id === myPlayerId);
    const rank = myEntry ? list.indexOf(myEntry) + 1 : list.length + 1;
    const total = list.length;
    const myScore = myEntry ? myEntry.score : 0;
    const top = entryMostPoints(list);
    const winner = list[0];
    const tied = list.filter((entry) => top > 0 && entry.score === top).length > 1;

    if (total === 0) {
        el('end-title').textContent = 'Game over';
        el('end-text').textContent = 'No players took part this round.';
    } else if (top === 0) {
        el('end-title').textContent = 'No points scored!';
        el('end-text').textContent = 'Better luck next round.';
    } else if (tied) {
        el('end-title').textContent = "It's a tie!";
        el('end-text').textContent = `You ended with ${myScore} points.`;
    } else if (rank === 1) {
        el('end-title').textContent = 'You won!';
        el('end-text').textContent = `You scored ${myScore} points. Top of ${total} player${total === 1 ? '' : 's'}!`;
    } else {
        el('end-title').textContent = `You came in ${ordinal(rank)} place!`;
        el('end-text').textContent = `You scored ${myScore} points. Winner: ${winner ? winner.name : '—'}`;
    }

    const scores = el('end-scores');
    scores.innerHTML = '';
    list.forEach((entry, i) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = `${i + 1}. ${entry.name}${entry.id === myPlayerId ? ' (you)' : ''}`;
        const score = document.createElement('span');
        score.textContent = `${entry.score} pts`;
        li.append(name, score);
        scores.appendChild(li);
    });
}

function entryMostPoints(list) {
    return Math.max(0, ...list.map((entry) => entry.score));
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function handleHostMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'identity') {
        myPlayerId = message.playerId;
        if (message.color && message.color !== myColor) {
            myColor = message.color;
            el('waiting-dot').style.background = myColor;
            renderSwatches();
        }
        if (message.hostId !== undefined) isHost = message.hostId === myPlayerId;
        applyHostMode();
        renderRoster();
        return;
    }
    if (message.action === 'ROSTER') {
        latestRoster = Array.isArray(message.players) ? message.players : [];
        if (message.hostId !== undefined) isHost = message.hostId === myPlayerId;
        const me = latestRoster.find((p) => p.id === myPlayerId);
        if (me && me.color && me.color !== myColor) {
            myColor = me.color;
            el('waiting-dot').style.background = myColor;
        }
        renderSwatches();
        applyHostMode();
        renderRoster();
        return;
    }
    if (message.action === 'SET_VIEW') {
        switch (message.view) {
            case 'lobby':
                phase = 'lobby';
                stopTimer();
                setPanel('waiting');
                el('waiting-text').textContent = 'Waiting for the host to start the game...';
                break;
            case 'trivia':
                renderQuestion(message.payload);
                break;
            case 'gameover':
                renderFinished(message.payload && message.payload.rankings);
                break;
        }
        return;
    }
    switch (message.action) {
        case 'TICK':
            if (phase === 'question') startTimer(message.remaining);
            break;
        case 'REVEAL':
            renderReveal(message);
            break;
    }
}

function sendColor() {
    try {
        player._dataConnection.send({
            action: 'COLOR',
            playerId: myPlayerId,
            playerName: el('name-input').value.trim(),
            color: myColor,
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error('Failed to send color', err);
    }
}

function submitAnswer(index) {
    if (!joined || phase !== 'question' || myAnswer !== null) return;
    if (!player || !player.isConnected) return;

    myAnswer = index;
    navigator.vibrate?.(15);

    document.querySelectorAll('.answer-btn').forEach((btn) => {
        btn.disabled = true;
    });
    document.querySelector(`.answer-btn[data-index="${index}"]`).classList.add('chosen');
    setFeedback('Answer locked in!', 'accent');

    try {
        player.sendMove(INDEX_TO_BUTTON[index]);
    } catch (err) {
        console.error(err);
    }
}

async function resolveRoom(room) {
    try {
        const res = await fetch(`/__lobby?room=${encodeURIComponent(room)}`);
        if (res.ok) {
            const data = await res.json();
            return data.hostPeerId || null;
        }
    } catch (err) {
        console.warn('Room lookup failed', err);
    }
    return null;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// The public PeerJS signalling broker is flaky when several phones register at
// the same instant, so a single connection attempt is not enough. We race every
// attempt against a timeout and retry with jitter + backoff, which lets a second
// (and third, ...) player join even if the broker briefly stalls.
const PEER_ID_TIMEOUT = 6000;
const CONNECT_TIMEOUT = 9000;
const MAX_JOIN_ATTEMPTS = 4;

async function attemptConnect(name) {
    const candidate = new Player();
    try {
        await Promise.race([
            candidate._ownIdPromise,
            delay(PEER_ID_TIMEOUT).then(() => { throw new Error('Peer ID not assigned in time'); }),
        ]);
        diag('peer-id-ready', {});
        await Promise.race([
            candidate.joinMatch(name),
            delay(CONNECT_TIMEOUT).then(() => { throw new Error('Connection timeout'); }),
        ]);
        return candidate;
    } catch (err) {
        try { candidate.destroy(); } catch (e) { /* already gone */ }
        throw err;
    }
}

async function join() {
    const name = el('name-input').value.trim() || 'Player';
    el('join-btn').disabled = true;
    setJoinStatus('Connecting...');
    diag('join-start', { name, color: myColor, url: location.href });

    if (!hostPeerId) {
        const room = el('room-input').value.trim().toUpperCase();
        if (!room) {
            setJoinStatus('Enter a room code first.', true);
            el('join-btn').disabled = false;
            return;
        }
        setJoinStatus(`Looking up room ${room}...`);
        hostPeerId = await resolveRoom(room);
        if (!hostPeerId) {
            setJoinStatus(`Unknown room "${room}". Check the screen.`, true);
            el('join-btn').disabled = false;
            return;
        }
        diag('room-resolved', { room, hostPeerId });
    }

    instrumentRTC('ctrl');
    player = null;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_JOIN_ATTEMPTS; attempt++) {
        if (attempt > 1) setJoinStatus(`Reconnecting… (attempt ${attempt} of ${MAX_JOIN_ATTEMPTS})`);
        // Small random stagger so simultaneous scans don't all hit the broker at once.
        await delay(Math.floor(Math.random() * 900));
        try {
            player = await attemptConnect(name);
            lastError = null;
            break;
        } catch (err) {
            lastError = err;
            diag('join-attempt-failed', { attempt, message: String(err && err.message || err) });
            if (attempt < MAX_JOIN_ATTEMPTS) await delay(500 * attempt);
        }
    }
    if (!player) {
        diag('join-failed', { message: String(lastError && lastError.message || lastError), rtc: rtcSnapshot() });
        el('join-btn').disabled = false;
        setJoinStatus(`Could not connect: ${lastError ? (lastError.message || lastError) : 'unknown error'}`, true);
        return;
    }

    myPlayerId = player._playerId;

    const conn = player._dataConnection;
    if (conn) {
        conn.on('data', handleHostMessage);
        conn.on('close', () => {
            joined = false;
            phase = 'offline';
            stopTimer();
            if (conn.open === false) {
                setPanel('hostlost');
            }
        });
    }

    joined = true;
    diag('join-ok', { playerId: myPlayerId, rtc: rtcSnapshot() });
    setJoinStatus('Connected!');
    setPanel('waiting');
    el('waiting-label').textContent = `Hi, ${name}!`;
    el('waiting-dot').style.background = myColor;
    el('waiting-text').textContent = 'Waiting for the host to start the game...';

    sendColor();
}

function renderSwatches() {
    const row = el('color-row');
    row.innerHTML = '';
    AVATAR_COLORS.forEach((color) => {
        const takenByOther = latestRoster.some(
            (p) => p.connected && p.id !== myPlayerId && p.color === color,
        );
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'swatch' + (color === myColor ? ' selected' : '') + (takenByOther ? ' taken' : '');
        swatch.style.background = color;
        swatch.setAttribute('aria-label', takenByOther ? `${color} (taken)` : color);
        swatch.addEventListener('click', () => {
            myColor = color;
            if (joined && player && player._dataConnection && player._dataConnection.open) sendColor();
            renderSwatches();
        });
        row.appendChild(swatch);
    });
}

function renderRoster() {
    const list = el('waiting-roster');
    if (!list) return;
    list.innerHTML = '';
    for (const entry of latestRoster) {
        const chip = document.createElement('div');
        chip.className = 'roster-chip' + (entry.id === myPlayerId ? ' me' : '') + (entry.connected ? '' : ' offline');

        const dot = document.createElement('span');
        dot.className = 'roster-dot';
        dot.style.background = entry.color;

        const name = document.createElement('span');
        name.textContent = entry.name + (entry.id === myPlayerId ? ' (you)' : '');

        chip.append(dot, name);
        list.appendChild(chip);
    }
    const count = el('waiting-count');
    if (count) {
        const online = latestRoster.filter((p) => p.connected).length;
        count.textContent = online <= 1
            ? 'Waiting for more players to join…'
            : `${online} players in the lobby`;
    }
}

// The first player to join becomes the host and drives the TV like a console
// remote: the D-pad moves focus, A selects, B/Home quits to the dashboard.
function applyHostMode() {
    document.body.classList.toggle('is-host', isHost);
    const pad = el('remote-pad');
    if (pad) pad.hidden = !isHost;
    const stick = document.querySelector('#waiting-panel .stick-idle');
    if (stick) stick.hidden = isHost;
    const title = document.querySelector('#waiting-panel .waiting-title');
    if (title) title.textContent = isHost ? "You're the host 🎮" : 'Connected!';
    const home = el('host-home');
    if (home) home.hidden = !isHost;
}

function sendNav(code) {
    if (!joined || !player || !player.isConnected) return;
    navigator.vibrate?.(12);
    try {
        player.sendMove(code);
    } catch (err) {
        console.error('Failed to send nav input', err);
    }
}

function init() {
    const params = new URLSearchParams(window.location.search);
    hostPeerId = params.get('hostPeerId');
    const roomParam = params.get('room');

    const storedName = sessionStorage.getItem('pp-name');
    const storedColor = sessionStorage.getItem('pp-color');
    if (storedName) el('name-input').value = storedName;
    if (storedColor) myColor = storedColor;

    if (!hostPeerId) {
        setJoinStatus('Enter your name, pick a color, and join a room.');
        if (roomParam) el('room-input').value = roomParam;
    } else {
        el('room-input').value = roomParam || '';
        setJoinStatus('Ready to join!');
    }

    renderSwatches();

    el('join-btn').addEventListener('click', join);
    el('name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') join();
    });
    el('room-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') join();
    });

    document.querySelectorAll('.answer-btn').forEach((btn) => {
        const index = Number(btn.dataset.index);
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            submitAnswer(index);
        }, { passive: false });
        btn.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') {
                e.preventDefault();
                submitAnswer(index);
            }
        });
    });

    document.querySelectorAll('[data-nav]').forEach((btn) => {
        const code = btn.dataset.nav;
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); sendNav(code); }, { passive: false });
        btn.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') { e.preventDefault(); sendNav(code); }
        });
    });

    el('rejoin-btn').addEventListener('click', () => {
        sessionStorage.setItem('pp-name', el('name-input').value.trim());
        sessionStorage.setItem('pp-color', myColor);
        window.location.href = '/controller.html';
    });

    setPanel('join');

    window.__ppC = { get player() { return player; } };
}

init();