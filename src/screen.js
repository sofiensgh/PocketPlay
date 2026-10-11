import { Match } from 'touch-coop';
import QRCode from 'qrcode';
import { TriviaGame, BUTTON_TO_INDEX } from './games/trivia.js';
import { diag, instrumentRTC, rtcSnapshot } from './diag.js';

const el = (id) => document.getElementById(id);

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

const ROOM_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no O/0/I/1

function generateRoomCode(length = 4) {
    const arr = new Uint32Array(length);
    crypto.getRandomValues(arr);
    let code = '';
    for (let i = 0; i < length; i++) code += ROOM_CHARSET[arr[i] % ROOM_CHARSET.length];
    return code;
}

async function registerRoom(room, hostPeerId) {
    try {
        await fetch('/__lobby', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room, hostPeerId }),
        });
    } catch (err) {
        console.warn('Room registration failed (manual room entry may not work)', err);
    }
}

async function buildControllerUrl() {
    const { protocol, hostname, port } = window.location;
    if (!LOOPBACK_HOSTS.includes(hostname)) {
        return `${window.location.origin}/controller.html`;
    }
    try {
        const res = await fetch('/__lan');
        if (res.ok) {
            const { candidates, port: serverPort } = await res.json();
            if (candidates && candidates.length) {
                return `${protocol}//${candidates[0]}:${serverPort}/controller.html`;
            }
        }
    } catch (err) {
        console.warn('LAN lookup failed, falling back to page origin', err);
    }
    return `${window.location.origin}/controller.html`;
}

let match = null;
let game = null;
let roomCode = '';

function sendTo(playerId, payload) {
    const connections = match && match._playerConnections;
    const conn = connections && connections.get(playerId);
    if (conn && conn.open) conn.send(payload);
}

function broadcast(payload) {
    for (const player of game.players.values()) {
        if (player.connected) sendTo(player.id, payload);
    }
}

function showView(name) {
    for (const view of ['lobby', 'game', 'final']) {
        el(`view-${view}`).hidden = view !== name;
    }
}

function handlePlayerEvent(event) {
    switch (event.action) {
        case 'JOIN':
            game.addPlayer(event.playerId, event.playerName);
            sendTo(event.playerId, { type: 'identity', playerId: event.playerId });
            sendTo(event.playerId, snapshotMessage());
            el('status').textContent = `${event.playerName || 'Player'} joined!`;
            break;
        case 'COLOR':
            game.setColor(event.playerId, event.color);
            break;
        case 'LEAVE':
            game.markDisconnected(event.playerId);
            break;
        case 'MOVE':
            game.submitAnswer(event.playerId, BUTTON_TO_INDEX[event.button]);
            break;
    }
}

// AirConsole-style message: { action: 'SET_VIEW', view, payload }
function snapshotMessage() {
    const snap = game.snapshot();
    switch (snap.type) {
        case 'question':
            return {
                action: 'SET_VIEW',
                view: 'trivia',
                payload: {
                    number: snap.number,
                    total: snap.total,
                    q: snap.q,
                    answers: snap.answers,
                    duration: snap.duration,
                    remaining: snap.remaining,
                },
            };
        case 'finished':
            return { action: 'SET_VIEW', view: 'gameover', payload: { rankings: snap.rankings } };
        default:
            return { action: 'SET_VIEW', view: 'lobby', payload: {} };
    }
}

function renderPlayers() {
    const players = [...game.players.values()];
    const chips = el('players');
    chips.innerHTML = '';
    for (const player of players) {
        const chip = document.createElement('div');
        chip.className = 'player-chip' + (player.connected ? '' : ' offline');

        const dot = document.createElement('span');
        dot.className = 'player-dot';
        dot.style.background = player.color;

        const name = document.createElement('span');
        name.textContent = player.connected ? player.name : `${player.name} (disconnected)`;

        chip.append(dot, name);
        chips.appendChild(chip);
    }
    el('start-btn').disabled = game.connectedCount() === 0;
    renderScoreboard();
}

function renderScoreboard() {
    const board = el('scoreboard');
    board.innerHTML = '';
    for (const player of game.players.values()) {
        const row = document.createElement('div');
        row.className = 'score-row' + (player.connected ? '' : ' offline');

        const dot = document.createElement('span');
        dot.className = 'score-dot';
        dot.style.background = player.color;
        if (game.phase === 'question' && player.answered) dot.classList.add('answered');

        const name = document.createElement('span');
        name.className = 'score-name';
        name.textContent = player.name;

        const score = document.createElement('span');
        score.className = 'score-value';
        score.textContent = player.score;

        row.append(dot, name, score);
        board.appendChild(row);
    }
}

function renderProgress() {
    const total = game.connectedCount();
    el('answered-count').textContent = `${game.answeredCount()} of ${total} answered`;
}

function renderTimer(remaining) {
    const urgent = remaining <= 5;
    el('timer-num').textContent = Math.max(0, remaining);
    el('timer-num').classList.toggle('urgent', urgent);
    el('timer-fill').classList.toggle('urgent', urgent);
    el('timer-fill').style.width = `${Math.max(0, remaining) / game.timeLimit * 100}%`;
}

function renderQuestion(event) {
    showView('game');
    el('q-counter').textContent = `Question ${event.number} / ${event.total}`;
    el('question-text').textContent = event.q;
    el('reveal-banner').hidden = true;
    el('answered-count').hidden = false;

    const cards = document.querySelectorAll('#answers .answer');
    cards.forEach((card, i) => {
        card.classList.remove('correct', 'wrongish', 'dimmed');
        card.querySelector('.answer-text').textContent = event.answers[i];
        card.querySelector('.picks').textContent = '';
    });

    renderTimer(event.remaining);
    renderProgress();
    renderScoreboard();

    broadcast({
        action: 'SET_VIEW',
        view: 'trivia',
        payload: {
            number: event.number,
            total: event.total,
            q: event.q,
            answers: event.answers,
            duration: event.duration,
            remaining: event.remaining,
        },
    });
}

function renderReveal(event) {
    const cards = document.querySelectorAll('#answers .answer');
    cards.forEach((card, i) => {
        const picks = event.picks[i] || [];
        if (i === event.correctIndex) {
            card.classList.add('correct');
        } else if (picks.length > 0) {
            card.classList.add('wrongish');
        } else {
            card.classList.add('dimmed');
        }
        card.querySelector('.picks').textContent = picks.join(', ');
    });

    el('answered-count').hidden = true;
    const correctCount = Object.values(event.points).filter((points) => points > 0).length;
    const banner = el('reveal-banner');
    banner.hidden = false;
    banner.textContent = correctCount === 0
        ? 'Nobody got it right!'
        : `${correctCount} of ${game.connectedCount()} got it right`;

    renderScoreboard();

    broadcast({
        action: 'REVEAL',
        correctIndex: event.correctIndex,
        answers: event.answers,
        points: event.points,
    });
}

function renderFinal(event) {
    showView('final');
    const winner = event.rankings[0];
    el('winner-name').textContent = winner ? winner.name : 'No players';
    el('winner-score').textContent = winner ? `${winner.score} points` : '';

    const list = el('rankings');
    list.innerHTML = '';
    event.rankings.forEach((entry, i) => {
        const li = document.createElement('li');

        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = i + 1;

        const name = document.createElement('span');
        name.className = 'rank-name';
        name.textContent = entry.name;

        const points = document.createElement('span');
        points.className = 'rank-points';
        points.textContent = `${entry.score} pts`;

        li.append(rank, name, points);
        list.appendChild(li);
    });

    broadcast({ action: 'SET_VIEW', view: 'gameover', payload: { rankings: event.rankings } });
}

function handleGameEvent(event) {
    switch (event.type) {
        case 'players':
            renderPlayers();
            break;
        case 'question':
            renderQuestion(event);
            break;
        case 'tick':
            renderTimer(event.remaining);
            broadcast({ action: 'TICK', remaining: event.remaining });
            break;
        case 'answered':
            renderProgress();
            renderScoreboard();
            break;
        case 'reveal':
            renderReveal(event);
            break;
        case 'finished':
            renderFinal(event);
            break;
        case 'reset':
            showView('lobby');
            el('status').textContent = 'Lobby ready. Waiting for players...';
            broadcast({ action: 'SET_VIEW', view: 'lobby', payload: {} });
            break;
    }
}

async function init() {
    game = new TriviaGame({ onEvent: handleGameEvent });
    instrumentRTC('host');
    match = new Match();

    el('room-code').textContent = generateRoomCode();
    roomCode = el('room-code').textContent;

    el('start-btn').addEventListener('click', () => game.start());
    el('again-btn').addEventListener('click', () => game.reset());

    showView('lobby');
    renderPlayers();

    try {
        const baseControllerUrl = await buildControllerUrl();
        const { shareURL } = await match.createLobby(baseControllerUrl, handlePlayerEvent);
        // touch-coop appends '?hostPeerId=...' to the URL we give it; add the
        // room code with '&' and re-encode the QR so the join URL is clean:
        // controller.html?hostPeerId=...&room=XXXX
        const joinURL = `${shareURL}&room=${roomCode}`;
        const dataUrl = await QRCode.toDataURL(joinURL, { errorCorrectionLevel: 'M' });
        const hostPeerId = new URL(joinURL).searchParams.get('hostPeerId') || '';
        registerRoom(roomCode, hostPeerId);
        match._peer.on('connection', (conn) => {
            diag('host-got-connection', { peer: conn.peer });
            conn.on('open', () => diag('host-conn-open', { peer: conn.peer, rtc: rtcSnapshot() }));
            conn.on('error', (err) => diag('host-conn-error', { peer: conn.peer, message: String(err && err.message || err), rtc: rtcSnapshot() }));
            conn.on('close', () => diag('host-conn-close', { peer: conn.peer, rtc: rtcSnapshot() }));
        });
        match._peer.on('error', (err) => diag('host-peer-error', { message: String(err && err.message || err) }));
        diag('lobby-created', { roomCode, joinURL });
        el('qr-code').src = dataUrl;
        const qrUrl = el('qr-url');
        qrUrl.textContent = joinURL;
        el('status').textContent = 'Lobby ready. Waiting for players...';

        // The QR, its URL and the PC button are REAL links (target=_blank), so
        // opening a controller works with plain navigation, no JS/popup needed.
        const targets = [el('qr-link'), qrUrl, el('pc-join-btn')];
        targets.forEach((target) => {
            if (!target) return;
            target.href = joinURL;
            target.classList.add('clickable');
        });
        const pcJoin = el('pc-join-btn');
        if (pcJoin) pcJoin.hidden = false;
        const joinHint = el('join-hint');
        if (joinHint) joinHint.hidden = false;

        // Flip card: the front is a "Scan the QR code" teaser; tapping flips to
        // reveal the QR. Auto-flip once the lobby is ready so the code is
        // immediately scannable. Clicking the QR link/URL opens the controller.
        const qrCard = el('qr-card');
        if (qrCard) {
            const flip = () => qrCard.classList.toggle('flipped');
            qrCard.addEventListener('click', (e) => {
                if (e.target.closest('#qr-link, #qr-url')) return;
                flip();
            });
            qrCard.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!e.target.closest('#qr-link, #qr-url')) flip();
                }
            });
            qrCard.classList.add('flipped');
        }

        const copyBtn = el('copy-link-btn');
        if (copyBtn) {
            copyBtn.hidden = false;
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(joinURL);
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = 'Copy join link'; }, 2000);
                } catch (err) {
                    copyBtn.textContent = 'Copy failed — see the link above';
                }
            });
        }

        // Debug/test handle (used by the headless smoke test).
        window.__pp = { game, match };
    } catch (err) {
        el('status').textContent = `Could not start lobby: ${err.message || err}`;
        console.error(err);
    }
}

init();