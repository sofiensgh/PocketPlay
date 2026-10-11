import { Player } from 'touch-coop';
import { AVATAR_COLORS, INDEX_TO_BUTTON } from './games/trivia.js';
import { diag, instrumentRTC, rtcSnapshot } from './diag.js';

const el = (id) => document.getElementById(id);

let player = null;
let myPlayerId = null;
let myColor = AVATAR_COLORS[0];
let hostPeerId = null;
let joined = false;
let phase = 'idle'; // idle | lobby | question | reveal | finished
let myAnswer = null;
let timerId = null;
let remaining = 0;

function setPanel(name) {
    for (const panel of ['join', 'waiting', 'game', 'end', 'hostlost']) {
        el(`${panel}-panel`).hidden = panel !== name;
    }
}

function setStatus(message, isError = false) {
    const status = el('status');
    status.textContent = message;
    status.classList.toggle('error', isError);
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
    // touch-coop's JOIN event carries only a name, so send the picked color
    // as a follow-up COLOR event over the same data channel.
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

// Resolve a manual room code (controller.html?room=XXXX, no hostPeerId).
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
    try {
        player = new Player();
        // PeerJS silently drops signaling messages sent before its cloud socket
        // opens, so wait for our own peer ID first or the SDP offer never leaves.
        await player._ownIdPromise;
        diag('peer-id-ready', {});
        await player.joinMatch(name);
    } catch (err) {
        diag('join-failed', { message: String(err && err.message || err), rtc: rtcSnapshot() });
        el('join-btn').disabled = false;
        setJoinStatus(`Could not connect: ${err.message || err}`, true);
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
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'swatch' + (color === myColor ? ' selected' : '');
        swatch.style.background = color;
        swatch.setAttribute('aria-label', color);
        swatch.addEventListener('click', () => {
            myColor = color;
            renderSwatches();
        });
        row.appendChild(swatch);
    });
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
        // Touch first for lowest latency; pointer/mouse fallback guards double-fire.
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

    el('rejoin-btn').addEventListener('click', () => {
        sessionStorage.setItem('pp-name', el('name-input').value.trim());
        sessionStorage.setItem('pp-color', myColor);
        window.location.href = '/controller.html';
    });

    setPanel('join');

    // Debug/test handle (used by the headless smoke test).
    window.__ppC = { get player() { return player; } };
}

init();