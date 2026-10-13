const startBtn = document.getElementById('start-btn');
const overlay = document.getElementById('loading-overlay');
const showcase = document.querySelector('.showcase');

/* Let the featured tile respond to the player, like a focused dashboard tile. */
if (showcase && matchMedia('(hover: hover) and (pointer: fine)').matches
    && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showcase.addEventListener('pointermove', (event) => {
        const rect = showcase.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        showcase.style.setProperty('--cursor-x', `${x * 100}%`);
        showcase.style.setProperty('--cursor-y', `${y * 100}%`);
        showcase.style.setProperty('--tilt-x', `${(0.5 - y) * 3}deg`);
        showcase.style.setProperty('--tilt-y', `${(x - 0.5) * 4}deg`);
    });
    showcase.addEventListener('pointerleave', () => {
        showcase.style.setProperty('--tilt-x', '0deg');
        showcase.style.setProperty('--tilt-y', '0deg');
        showcase.style.setProperty('--cursor-x', '72%');
        showcase.style.setProperty('--cursor-y', '42%');
    });
}

/* ---------- floating particles ---------- */
(function () {
    const bg = document.getElementById('bg');
    if (!bg) return;
    const cols = ['#31c5ff', '#397fff', '#7547ff', '#d34dff', '#63a6ff', '#a47aff'];
    for (let i = 0; i < 22; i++) {
        const s = document.createElement('div');
        s.className = 'spark';
        s.style.setProperty('--x', (Math.random() * 100) + '%');
        s.style.setProperty('--d', (6 + Math.random() * 7) + 's');
        s.style.setProperty('--delay', (-Math.random() * 10) + 's');
        s.style.setProperty('--c', cols[i % cols.length]);
        bg.appendChild(s);
    }
})();

/* ---------- loader controller ---------- */
const PocketLoader = (function () {
    const fill = document.getElementById('ppl-fill');
    const pct = document.getElementById('ppl-pct');
    const loader = document.getElementById('ppl-loader');
    const msgs = Array.from(document.getElementById('ppl-msgs').querySelectorAll('span'));
    let shown = 0, target = 0, auto = true, finished = false, msgIdx = -1, raf = 0, active = false;

    function setMsg(i) {
        if (i === msgIdx) return;
        msgIdx = i;
        msgs.forEach((m, k) => {
            m.style.transition = 'opacity .35s ease, transform .35s ease';
            m.style.opacity = k === i ? '1' : '0';
            m.style.transform = k === i ? 'translateY(0)' : (k < i ? 'translateY(-8px)' : 'translateY(8px)');
        });
    }
    setMsg(0);

    function tick() {
        if (!active) return;
        if (auto && !finished) target = Math.min(0.9, target + (0.9 - target) * 0.012);
        shown += (target - shown) * 0.08;
        if (Math.abs(target - shown) < 0.0005) shown = target;
        fill.style.transform = 'scaleX(' + shown + ')';
        pct.textContent = Math.round(shown * 100) + '%';
        setMsg(shown < 0.3 ? 0 : shown < 0.6 ? 1 : shown < 0.97 ? 2 : 3);
        if (finished && shown >= 0.999) {
            setTimeout(() => loader.classList.add('done'), 450);
            setTimeout(() => document.dispatchEvent(new Event('pocketplay:loaded')), 1100);
            active = false;
            return;
        }
        raf = requestAnimationFrame(tick);
    }

    return {
        start() {
            active = true;
            shown = 0;
            target = 0;
            auto = true;
            finished = false;
            raf = requestAnimationFrame(tick);
        },
        progress(v) {
            auto = false;
            target = Math.max(target, Math.min(1, v));
        },
        done() {
            finished = true;
            target = 1;
        },
    };
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function goToScreen(source) {
    if (source.hasAttribute('disabled')) return;
    source.setAttribute('disabled', '');

    overlay.classList.add('visible');
    requestAnimationFrame(() => overlay.classList.add('active'));
    PocketLoader.start();

    const stages = [[400, 0.34], [650, 0.58], [750, 0.82], [450, 0.94]];
    for (const [ms, p] of stages) {
        await sleep(ms);
        PocketLoader.progress(p);
    }
    await sleep(250);
    PocketLoader.done();
}

startBtn.addEventListener('click', () => goToScreen(startBtn));

document.querySelectorAll('[data-go-screen]').forEach((card) => {
    card.addEventListener('click', (e) => {
        e.preventDefault();
        goToScreen(card);
    });
});

document.addEventListener('pocketplay:loaded', () => {
    window.location.href = '/screen.html';
});
