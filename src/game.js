export const BUTTON_TO_INDEX = { A: 0, B: 1, X: 2, Y: 3 };

export const POINTS_PER_CORRECT = 100;

export const QUESTIONS = [
    { q: 'Which planet is known as the "Red Planet"?', answers: ['Mars', 'Venus', 'Jupiter', 'Saturn'], correct: 0 },
    { q: 'How many legs does a spider have?', answers: ['8', '6', '10', '4'], correct: 0 },
    { q: 'What is the largest ocean on Earth?', answers: ['Pacific', 'Atlantic', 'Indian', 'Arctic'], correct: 0 },
    { q: 'Which gas do plants absorb from the atmosphere?', answers: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen'], correct: 0 },
    { q: 'What year did Apollo 11 land on the Moon?', answers: ['1969', '1965', '1972', '1959'], correct: 0 },
    { q: 'Which country gifted the Statue of Liberty to the United States?', answers: ['France', 'England', 'Spain', 'Italy'], correct: 0 },
    { q: 'What is the fastest land animal?', answers: ['Cheetah', 'Lion', 'Pronghorn', 'Greyhound'], correct: 0 },
    { q: 'How many colors are in a rainbow?', answers: ['7', '6', '8', '5'], correct: 0 },
    { q: 'What is the smallest prime number?', answers: ['2', '1', '3', '0'], correct: 0 },
    { q: 'What is the capital of Japan?', answers: ['Tokyo', 'Kyoto', 'Osaka', 'Seoul'], correct: 0 },
    { q: 'Which planet is closest to the Sun?', answers: ['Mercury', 'Venus', 'Earth', 'Mars'], correct: 0 },
    { q: 'What is the hardest naturally occurring substance?', answers: ['Diamond', 'Quartz', 'Topaz', 'Iron'], correct: 0 },
    { q: 'How many minutes are in a full day?', answers: ['1440', '1200', '1000', '1500'], correct: 0 },
    { q: 'Which mammal is capable of true flight?', answers: ['Bat', 'Flying squirrel', 'Colugo', 'Sugar glider'], correct: 0 },
    { q: 'What is the largest planet in our solar system?', answers: ['Jupiter', 'Saturn', 'Neptune', 'Earth'], correct: 0 },
    { q: 'Which instrument has 88 keys?', answers: ['Piano', 'Organ', 'Harpsichord', 'Accordion'], correct: 0 },
    { q: 'What is the chemical symbol for gold?', answers: ['Au', 'Ag', 'Gd', 'Go'], correct: 0 },
    { q: 'Which sea has no coastline?', answers: ['Sargasso Sea', 'Coral Sea', 'Bering Sea', 'Arabian Sea'], correct: 0 },
    { q: 'In which sport would you perform a slam dunk?', answers: ['Basketball', 'Volleyball', 'Tennis', 'Handball'], correct: 0 },
    { q: 'What is the tallest living land animal?', answers: ['Giraffe', 'Elephant', 'Ostrich', 'Camel'], correct: 0 },
];

const shuffle = (list) => {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

export class TriviaGame {
    constructor({
        questions = QUESTIONS,
        roundLength = 10,
        timeLimit = 20,
        revealDelay = 4000,
        onEvent = () => {},
    } = {}) {
        this.bank = questions;
        this.roundLength = roundLength;
        this.timeLimit = timeLimit;
        this.revealDelay = revealDelay;
        this.onEvent = onEvent;
        this.players = new Map();
        this.phase = 'lobby';
        this.queue = [];
        this.index = 0;
        this.current = null;
        this.remaining = 0;
        this.roundPoints = {};
        this._tickTimer = null;
        this._advanceTimer = null;
    }

    addPlayer(id, name) {
        const existing = this.players.get(id);
        if (existing) {
            if (name) existing.name = name;
            return;
        }
        this.players.set(id, {
            id,
            name: name || 'Player',
            score: 0,
            answered: false,
            answerIndex: null,
        });
        this.onEvent({ type: 'players' });
    }

    removePlayer(id) {
        if (this.players.delete(id)) this.onEvent({ type: 'players' });
    }

    start() {
        if (this.phase !== 'lobby') return;
        this.queue = shuffle(this.bank).slice(0, this.roundLength);
        this.index = 0;
        for (const player of this.players.values()) this._resetPlayer(player);
        this._beginQuestion();
    }

    reset() {
        this._clearTimers();
        this.phase = 'lobby';
        this.queue = [];
        this.index = 0;
        this.current = null;
        this.roundPoints = {};
        for (const player of this.players.values()) this._resetPlayer(player);
        this.onEvent({ type: 'reset' });
        this.onEvent({ type: 'players' });
    }

    submitAnswer(playerId, answerIndex) {
        if (this.phase !== 'question') return null;
        if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) return null;
        const player = this.players.get(playerId);
        if (!player || player.answered) return null;
        player.answered = true;
        player.answerIndex = answerIndex;
        const correct = answerIndex === this.current.correctIndex;
        const points = correct ? POINTS_PER_CORRECT : 0;
        player.score += points;
        this.roundPoints[playerId] = points;
        this.onEvent({
            type: 'answered',
            playerId,
            correct,
            points,
            answeredCount: this.answeredCount(),
            playerCount: this.players.size,
        });
        if (this.answeredCount() === this.players.size) this._endQuestion();
        return { correct, points };
    }

    answeredCount() {
        let count = 0;
        for (const player of this.players.values()) if (player.answered) count++;
        return count;
    }

    rankings() {
        return [...this.players.values()]
            .sort((a, b) => b.score - a.score)
            .map((player) => ({ id: player.id, name: player.name, score: player.score }));
    }

    snapshot() {
        if (this.phase === 'question') return { type: 'question', ...this._questionPayload() };
        if (this.phase === 'reveal') return { type: 'reveal', ...this._revealPayload() };
        if (this.phase === 'finished') return { type: 'finished', rankings: this.rankings() };
        return { type: 'lobby' };
    }

    destroy() {
        this._clearTimers();
    }

    _resetPlayer(player) {
        player.score = 0;
        player.answered = false;
        player.answerIndex = null;
    }

    _beginQuestion() {
        this._clearTimers();
        const base = this.queue[this.index];
        const order = shuffle([0, 1, 2, 3]);
        this.current = {
            q: base.q,
            answers: order.map((i) => base.answers[i]),
            correctIndex: order.indexOf(base.correct),
        };
        this.roundPoints = {};
        for (const player of this.players.values()) {
            player.answered = false;
            player.answerIndex = null;
        }
        this.remaining = this.timeLimit;
        this.phase = 'question';
        this.onEvent({ type: 'question', ...this._questionPayload() });
        this._tickTimer = setInterval(() => this._tick(), 1000);
    }

    _tick() {
        this.remaining -= 1;
        this.onEvent({ type: 'tick', remaining: this.remaining });
        if (this.remaining <= 0) this._endQuestion();
    }

    _endQuestion() {
        if (this.phase !== 'question') return;
        this._clearTimers();
        this.phase = 'reveal';
        this.onEvent({ type: 'reveal', ...this._revealPayload() });
        this._advanceTimer = setTimeout(() => this._advance(), this.revealDelay);
    }

    _advance() {
        this._advanceTimer = null;
        this.index += 1;
        if (this.index >= this.queue.length) {
            this.phase = 'finished';
            this.onEvent({ type: 'finished', rankings: this.rankings() });
        } else {
            this._beginQuestion();
        }
    }

    _clearTimers() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
        if (this._advanceTimer) {
            clearTimeout(this._advanceTimer);
            this._advanceTimer = null;
        }
    }

    _questionPayload() {
        return {
            number: this.index + 1,
            total: this.queue.length,
            q: this.current.q,
            answers: this.current.answers,
            duration: this.timeLimit,
            remaining: this.remaining,
        };
    }

    _revealPayload() {
        const picks = { 0: [], 1: [], 2: [], 3: [] };
        const points = {};
        for (const player of this.players.values()) {
            if (player.answerIndex !== null && picks[player.answerIndex]) {
                picks[player.answerIndex].push(player.name);
            }
            if (Object.prototype.hasOwnProperty.call(this.roundPoints, player.id)) {
                points[player.id] = this.roundPoints[player.id];
            }
        }
        return {
            number: this.index + 1,
            total: this.queue.length,
            correctIndex: this.current.correctIndex,
            answers: this.current.answers,
            picks,
            points,
        };
    }
}
