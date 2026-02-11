/* ============================================
   VANT TACTICAL COMMS - CORE REBUILD v2
   ============================================ */

const peers = {};
let socket;
let localStream;
let audioCtx;
let myGain;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
    ]
};

function log(msg) {
    const consoleDiv = document.getElementById('debug-console');
    if (consoleDiv) {
        consoleDiv.innerText += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
}

function updateCounter() {
    const el = document.getElementById('user-count');
    if (!el) return;
    const count = Object.keys(peers).length + 1;
    el.innerText = `${count} OPERATOR${count !== 1 ? 'S' : ''}`;
}

const serverUrl = window.location.hostname.includes('localhost') ? window.location.origin : 'https://walkie-talkie-remote.onrender.com';
socket = io(serverUrl);

async function setupAudio() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        myGain = audioCtx.createGain();
        const destination = audioCtx.createMediaStreamDestination();

        source.connect(myGain);
        myGain.connect(destination);
        myGain.gain.setValueAtTime(0, audioCtx.currentTime);

        localStream = destination.stream;
        log("Dispositivo de audio listo.");
        return true;
    } catch (e) {
        alert("ERROR: Permiso de micrófono denegado.");
        return false;
    }
}

function getOrCreatePC(remoteId) {
    if (peers[remoteId]) return peers[remoteId];

    const pc = new RTCPeerConnection(rtcConfig);
    peers[remoteId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        log("Enlace de audio establecido con " + remoteId);
        let audio = document.getElementById(`audio-${remoteId}`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${remoteId}`;
            audio.autoplay = true;
            audio.playsInline = true;
            document.body.appendChild(audio);
        }
        audio.srcObject = event.streams[0];
        document.getElementById('ptt-ring').classList.add('active');
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { to: remoteId, signal: { candidate: event.candidate } });
        }
    };

    pc.onconnectionstatechange = () => {
        log(`Estado de unidad ${remoteId}: ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            delete peers[remoteId];
            document.getElementById(`audio-${remoteId}`)?.remove();
            updateCounter();
        }
    };

    return pc;
}

async function join() {
    const code = document.getElementById('access-code').value.trim().toUpperCase();
    if (!code) return;
    if (await setupAudio()) {
        socket.emit('join_mission', { code: code });
    }
}

socket.on('mission_joined', (data) => {
    log("Uplink estabilizado: " + data.mission);
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    document.getElementById('channel-name').innerText = data.mission;

    if (data.existingMembers) {
        data.existingMembers.forEach(async (id) => {
            log("Llamando a unidad: " + id);
            const pc = getOrCreatePC(id);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('signal', { to: id, signal: { sdp: pc.localDescription } });
        });
    }
    updateCounter();
});

socket.on('new_operator', (id) => {
    log("Nueva unidad en el sector: " + id);
    getOrCreatePC(id);
    updateCounter();
});

socket.on('signal', async (data) => {
    const pc = getOrCreatePC(data.from);

    if (data.signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
        if (data.signal.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { to: data.from, signal: { sdp: pc.localDescription } });
        }
    } else if (data.signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate)).catch(e => { });
    }
    updateCounter();
});

socket.on('operator_left', (id) => {
    if (peers[id]) {
        peers[id].close();
        delete peers[id];
    }
    document.getElementById(`audio-${id}`)?.remove();
    updateCounter();
});

const pttBtn = document.getElementById('ptt-btn');
const statusText = document.getElementById('status-text');

function startSpeaking() {
    if (!myGain) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    myGain.gain.setTargetAtTime(1, audioCtx.currentTime, 0.05);
    pttBtn.classList.add('active');
    statusText.innerText = 'TRANSMITIENDO';
    statusText.classList.add('transmitting');
}

function stopSpeaking() {
    if (!myGain) return;
    myGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    pttBtn.classList.remove('active');
    statusText.innerText = 'CONECTADO';
    statusText.classList.remove('transmitting');
}

pttBtn.addEventListener('mousedown', startSpeaking);
window.addEventListener('mouseup', stopSpeaking);
pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startSpeaking(); });
pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopSpeaking(); });

document.getElementById('login-btn').addEventListener('click', join);

window.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    document.querySelectorAll('audio').forEach(a => a.play().catch(e => { }));
});
