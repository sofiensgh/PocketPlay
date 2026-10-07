import { Player } from 'touch-coop';

const LABELS = ['A', 'B', 'X', 'Y'];

const el = (id) => document.getElementById(id);

let player = null;
let hostConnection = null;
let myPlayerId = null;
let joined = false;
let phase = 'idle';
let myAnswer = null;
let timerId = null;
let remaining = 0;

function setPanel(name) {
    for (const panel of ['join', 'waiting', 'game', 'end']) {
        el(`${panel}-panel`).hidden = panel !== name;
    }
}

function setStatus(message, isError = false) {
    const status = el('status');
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

function renderFinished(message) {
    phase = 'finished';
    stopTimer();
    setPanel('end');

    const rankings = message.rankings || [];
    const winner = rankings[0];
    el('end-text').textContent = winner
        ? `${winner.name} wins with ${winner.score} points!`
        : 'The game has ended.';

    const list = el('end-scores');
    list.innerHTML = '';
    rankings.forEach((entry) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = entry.name;
        const score = document.createElement('span');
        score.textContent = `${entry.score} pts`;
        li.append(name, score);
        list.appendChild(li);
    });
}

function handleHostMessage(message) {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
        case 'identity':
            myPlayerId = message.playerId;
            break;
        case 'lobby':
            phase = 'lobby';
            stopTimer();
            setPanel('waiting');
            el('waiting-text').textContent = 'Waiting for the host to start the game...';
            break;
        case 'question':
            renderQuestion(message);
            break;
        case 'reveal':
            renderReveal(message);
            break;
        case 'finished':
            renderFinished(message);
            break;
    }
}

function submitAnswer(index) {
    if (!joined || phase !== 'question' || myAnswer !== null) return;
    if (!player || !player.isConnected) return;

    myAnswer = index;
    document.querySelectorAll('.answer-btn').forEach((btn) => {
        btn.disabled = true;
    });
    document.querySelector(`.answer-btn[data-index="${index}"]`).classList.add('chosen');
    setFeedback('Answer locked in!', 'accent');

    try {
        player.sendMove(LABELS[index]);
    } catch (err) {
        console.error(err);
    }
}

async function join() {
    const name = el('name-input').value.trim() || 'Player';
    el('join-btn').disabled = true;
    setStatus('Connecting...');

    try {
        player = new Player();
        // PeerJS silently drops signaling messages sent before its cloud socket
        // opens, so wait for our own peer ID first or the SDP offer never leaves.
        await player._ownIdPromise;
        await player.joinMatch(name);
    } catch (err) {
        el('join-btn').disabled = false;
        setStatus(`Could not connect: ${err.message || err}`, true);
        return;
    }

    hostConnection = player._dataConnection;
    if (hostConnection) {
        hostConnection.on('data', handleHostMessage);
        hostConnection.on('close', () => {
            joined = false;
            phase = 'offline';
            stopTimer();
            setPanel('end');
            el('end-text').textContent = 'Disconnected from the host. Reload the page to reconnect.';
            el('end-scores').innerHTML = '';
        });
    }

    joined = true;
    setStatus('');
    setPanel('waiting');
    el('waiting-text').textContent = 'Connected! Waiting for the host...';
}

function init() {
    const hostPeerId = new URLSearchParams(window.location.search).get('hostPeerId');

    if (!hostPeerId) {
        setStatus('Open this page by scanning the QR code on the screen.', true);
        el('join-btn').disabled = true;
    } else {
        setStatus('Ready to join!');
    }

    el('join-btn').addEventListener('click', join);
    el('name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') join();
    });

    document.querySelectorAll('.answer-btn').forEach((btn) => {
        const index = Number(btn.dataset.index);
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            submitAnswer(index);
        });
    });

    setPanel('join');
}

init();
