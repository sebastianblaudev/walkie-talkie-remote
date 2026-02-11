/* ============================================
   VANT TACTICAL COMMS - CORE REBUILD v2.5
   ============================================ */

const peers = {};
let socket, localStream, audioCtx, myGain, analyser, dataArray;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            password: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            password: 'openrelayproject'
        }
    ]
};

function log(msg) {
    const consoleDiv = document.getElementById('debug-console');
    if (consoleDiv) {
        consoleDiv.innerText += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
    console.log("[VANT]", msg);
}

function updateCounter() {
    const el = document.getElementById('user-count');
    if (!el) return;
    const count = Object.keys(peers).length + 1;
    el.innerText = `${count} OPERATOR${count !== 1 ? 'S' : ''}`;

    const status = document.getElementById('status-text');
    if (Object.keys(peers).length > 0) {
        el.style.color = '#6EE7B7';
        status.innerText = 'SECURE LINK';
        status.style.color = '#6EE7B7';
    } else {
        el.style.color = '';
        status.innerText = 'CONNECTED';
        status.style.color = '';
    }
}

const serverUrl = window.location.hostname.includes('localhost') ? window.location.origin : 'https://walkie-talkie-remote.onrender.com';
socket = io(serverUrl);

async function setupAudio() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Analizador para el visualizador
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        const source = audioCtx.createMediaStreamSource(stream);
        myGain = audioCtx.createGain();
        const destination = audioCtx.createMediaStreamDestination();

        source.connect(myGain);
        myGain.connect(destination);

        // El visualizador se conecta ANTES del gain para que siempre veas tu propia voz
        source.connect(analyser);

        myGain.gain.setValueAtTime(0, audioCtx.currentTime);

        localStream = destination.stream;
        log("Dispositivo táctico preparado.");
        startVisualizer();
        return true;
    } catch (e) {
        log("Error de hardware: " + e.message);
        alert("ERROR: Acceso al micrófono denegado.");
        return false;
    }
}

function startVisualizer() {
    const canvas = document.getElementById('visualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw() {
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.fillStyle = '#131314';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / dataArray.length) * 2.5;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            ctx.fillStyle = '#6EE7B7';
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
            x += barWidth;
        }
    }
    draw();
}

function getOrCreatePC(remoteId) {
    if (peers[remoteId]) return peers[remoteId];

    const pc = new RTCPeerConnection(rtcConfig);
    peers[remoteId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        log("Recibiendo audio de " + remoteId);
        let audio = document.getElementById(`audio-${remoteId}`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${remoteId}`;
            audio.autoplay = true;
            audio.playsInline = true;
            document.body.appendChild(audio);
        }
        audio.srcObject = event.streams[0];
        audio.play().catch(() => log("Esperando acción del usuario para audio."));

        document.getElementById('ptt-ring').classList.add('active');
        updateCounter();
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { to: remoteId, signal: { candidate: event.candidate } });
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') log("CIFRADO ACTIVO CON " + remoteId);
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
    log("Canal asegurado: " + data.mission);
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    document.getElementById('channel-name').innerText = data.mission;
    document.getElementById('ptt-btn').disabled = false;

    if (data.existingMembers) {
        data.existingMembers.forEach(async (id) => {
            const pc = getOrCreatePC(id);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('signal', { to: id, signal: { sdp: pc.localDescription } });
        });
    }
    updateCounter();
});

socket.on('new_operator', (id) => {
    log("Nueva unidad en red.");
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
    if (peers[id]) { peers[id].close(); delete peers[id]; }
    document.getElementById(`audio-${id}`)?.remove();
    updateCounter();
});

// PTT CONTROLS
const pttBtn = document.getElementById('ptt-btn');

async function startSpeaking() {
    if (!myGain) return;
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    // Forzamos reproducción en todos los elementos audio al tocar el PTT (desbloqueo de sonido)
    document.querySelectorAll('audio').forEach(a => a.play().catch(() => { text: 'Log: Forzando audio' }));

    myGain.gain.setValueAtTime(1, audioCtx.currentTime);
    pttBtn.classList.add('active');
    document.getElementById('status-text').innerText = 'TRANSMITIENDO';
    document.getElementById('status-text').classList.add('transmitting');
}

function stopSpeaking() {
    if (!myGain) return;
    myGain.gain.setValueAtTime(0, audioCtx.currentTime);
    pttBtn.classList.remove('active');
    updateCounter(); // Restaura el estado visual (STANDBY o SECURE LINK)
    document.getElementById('status-text').classList.remove('transmitting');
}

if (pttBtn) {
    pttBtn.addEventListener('mousedown', startSpeaking);
    window.addEventListener('mouseup', stopSpeaking);
    pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startSpeaking(); });
    pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopSpeaking(); });
}

document.getElementById('login-btn').addEventListener('click', join);

window.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});
