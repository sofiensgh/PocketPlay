import { Match } from 'touch-coop';
import { TriviaGame, BUTTON_TO_INDEX } from './game.js';

const el = (id) => document.getElementById(id);

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

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

function sendTo(playerId, payload) {
    const connections = match && match._playerConnections;
    const conn = connections && connections.get(playerId);
    if (conn && conn.open) conn.send(payload);
}

function broadcast(payload) {
    if (!game) return;
    for (const playerId of game.players.keys()) sendTo(playerId, payload);
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
            sendTo(event.playerId, game.snapshot());
            el('status').textContent = `${event.playerName || 'Player'} joined!`;
            break;
        case 'LEAVE':
            game.removePlayer(event.playerId);
            break;
        case 'MOVE':
            game.submitAnswer(event.playerId, BUTTON_TO_INDEX[event.button]);
            break;
    }
}

function renderPlayers() {
    const players = [...game.players.values()];
    const chips = el('players');
    chips.innerHTML = '';
    for (const player of players) {
        const chip = document.createElement('div');
        chip.className = 'player-chip';
        chip.textContent = player.name;
        chips.appendChild(chip);
    }
    el('start-btn').disabled = players.length === 0;
    renderScoreboard();
}

function renderScoreboard() {
    const board = el('scoreboard');
    board.innerHTML = '';
    for (const player of game.players.values()) {
        const row = document.createElement('div');
        row.className = 'score-row';

        const dot = document.createElement('span');
        dot.className = 'score-dot';
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
    const total = game.players.size;
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
        type: 'question',
        number: event.number,
        total: event.total,
        q: event.q,
        answers: event.answers,
        duration: event.duration,
        remaining: event.remaining,
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
        : `${correctCount} of ${game.players.size} got it right`;

    renderScoreboard();

    broadcast({
        type: 'reveal',
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

    broadcast({ type: 'finished', rankings: event.rankings });
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
            broadcast({ type: 'lobby' });
            break;
    }
}

async function init() {
    game = new TriviaGame({ onEvent: handleGameEvent });
    match = new Match();

    el('start-btn').addEventListener('click', () => game.start());
    el('again-btn').addEventListener('click', () => game.reset());

    showView('lobby');
    renderPlayers();

    try {
        const controllerUrl = await buildControllerUrl();
        const { dataUrl, shareURL } = await match.createLobby(controllerUrl, handlePlayerEvent);
        el('qr-code').src = dataUrl;
        el('qr-url').textContent = shareURL;
        el('status').textContent = 'Lobby ready. Waiting for players...';
    } catch (err) {
        el('status').textContent = `Could not start lobby: ${err.message || err}`;
        console.error(err);
    }
}

init();
