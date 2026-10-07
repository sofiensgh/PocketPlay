let seq = 0;

function send(entry) {
    try {
        fetch('/__diag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
            keepalive: true,
        }).catch(() => {});
    } catch (err) { /* diagnostics must never break the game */ }
}

export function diag(type, data = {}) {
    const entry = { t: Date.now(), type, seq: seq++, ...data };
    send(entry);
    return entry;
}

function pcState(pc) {
    return {
        ice: pc.iceConnectionState,
        gather: pc.iceGatheringState,
        conn: pc.connectionState,
        sig: pc.signalingState,
    };
}

export function rtcSnapshot() {
    const out = [];
    const list = window.__diagPCs || [];
    for (const pc of list) out.push(pcState(pc));
    return out;
}

export function instrumentRTC(label) {
    const Orig = window.RTCPeerConnection;
    if (!Orig || Orig.__ppDiag) return;
    window.__diagPCs = [];

    function Wrapped(...args) {
        const pc = new Orig(...args);
        const id = `${label}-${++seq}`;
        window.__diagPCs.push(pc);
        diag('rtc-created', { id, config: args[0] || null });
        pc.addEventListener('icegatheringstatechange', () => diag('ice-gathering', { id, ...pcState(pc) }));
        pc.addEventListener('iceconnectionstatechange', () => diag('ice-conn', { id, ...pcState(pc) }));
        pc.addEventListener('connectionstatechange', () => diag('conn', { id, ...pcState(pc) }));
        pc.addEventListener('icecandidateerror', (e) => diag('ice-cand-error', { id, code: e.errorCode, url: e.url, addr: e.address }));
        pc.addEventListener('icecandidate', (e) => diag('local-cand', { id, cand: e.candidate ? e.candidate.candidate : null }));
        const origAdd = pc.addIceCandidate.bind(pc);
        pc.addIceCandidate = (c) => {
            diag('remote-cand', { id, cand: c && c.candidate });
            return origAdd(c);
        };
        return pc;
    }
    Wrapped.prototype = Orig.prototype;
    Wrapped.__ppDiag = true;
    window.RTCPeerConnection = Wrapped;
}
