/* ============================================
   VANT TACTICAL COMMS - REINFORCED v4.0
   ============================================ */

const peers = {};
let socket, localStream, audioCtx, myGain, recvAnalyser, dataArray;
let localAnalyser, localDataArray;

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
    ],
    iceCandidatePoolSize: 10
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
    const connectedPeers = Object.values(peers).filter(pc => pc.connectionState === 'connected').length;
    const totalPeers = Object.keys(peers).length;

    el.innerText = `${totalPeers + 1} OPERATORS (${connectedPeers} ONLINE)`;

    const statusText = document.getElementById('status-text');
    if (connectedPeers > 0) {
        statusText.innerText = 'SECURE LINK ACTIVE';
        statusText.style.color = '#6EE7B7';
    } else {
        statusText.innerText = 'WAITING FOR SQUAD...';
        statusText.style.color = '#f59e0b';
    }
}

const serverUrl = window.location.hostname.includes('localhost') ? window.location.origin : 'https://walkie-talkie-remote.onrender.com';
socket = io(serverUrl);

async function setupAudio() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true }
        });

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        recvAnalyser = audioCtx.createAnalyser();
        recvAnalyser.fftSize = 64;
        dataArray = new Uint8Array(recvAnalyser.frequencyBinCount);

        localAnalyser = audioCtx.createAnalyser();
        localAnalyser.fftSize = 32;
        localDataArray = new Uint8Array(localAnalyser.frequencyBinCount);

        const source = audioCtx.createMediaStreamSource(stream);
        myGain = audioCtx.createGain();
        const destination = audioCtx.createMediaStreamDestination();

        source.connect(myGain);
        myGain.connect(destination);
        source.connect(localAnalyser);

        myGain.gain.setValueAtTime(0, audioCtx.currentTime);
        localStream = destination.stream;

        log("Hardware listo.");
        startVisualizer();
        return true;
    } catch (e) {
        log("Error mic: " + e.message);
        return false;
    }
}

function startVisualizer() {
    const canvas = document.getElementById('visualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw() {
        requestAnimationFrame(draw);
        ctx.fillStyle = '#131314';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Ondas recibidas
        if (recvAnalyser) {
            recvAnalyser.getByteFrequencyData(dataArray);
            const barWidth = (canvas.width / dataArray.length) * 2;
            let x = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const h = (dataArray[i] / 255) * canvas.height;
                ctx.fillStyle = '#6EE7B7';
                ctx.fillRect(x, canvas.height - h, barWidth - 1, h);
                x += barWidth;
            }
        }

        // Mi micro (punto azul arriba izq)
        if (localAnalyser) {
            localAnalyser.getByteFrequencyData(localDataArray);
            let vol = 0; localDataArray.forEach(v => vol += v);
            ctx.fillStyle = (vol / localDataArray.length) > 10 ? '#3b82f6' : '#1f2937';
            ctx.fillRect(10, 10, 6, 6);
        }
    }
    draw();
}

function createPC(remoteId) {
    if (peers[remoteId]) return peers[remoteId];

    log("Creando enlace con " + remoteId);
    const pc = new RTCPeerConnection(rtcConfig);
    peers[remoteId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        log("¡Audio de entrada detectable!");
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play().catch(() => { });

        const remoteSource = audioCtx.createMediaStreamSource(event.streams[0]);
        remoteSource.connect(audioCtx.destination);
        remoteSource.connect(recvAnalyser);
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('signal', { to: remoteId, signal: { candidate: e.candidate } });
        }
    };

    pc.onconnectionstatechange = () => {
        log(`Unidad ${remoteId}: ${pc.connectionState}`);
        updateCounter();
    };

    return pc;
}

// BOTÓN LOGIN
const loginBtn = document.getElementById('login-btn');
if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        const code = document.getElementById('access-code').value.trim().toUpperCase();
        if (!code) return;
        if (await setupAudio()) {
            socket.emit('join_mission', { code });
        }
    });
}

socket.on('mission_joined', (data) => {
    log("Conectado a misión: " + data.mission);
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    document.getElementById('channel-name').innerText = data.mission;

    if (data.existingMembers) {
        data.existingMembers.forEach(async (id) => {
            log("Llamando a operador remoto...");
            const pc = createPC(id);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('signal', { to: id, signal: { sdp: pc.localDescription } });
        });
    }
    updateCounter();
});

socket.on('new_operator', (id) => {
    log("Nueva unidad detectada.");
    createPC(id);
    updateCounter();
});

socket.on('signal', async (data) => {
    const pc = createPC(data.from);
    if (data.signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
        if (data.signal.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { to: data.from, signal: { sdp: pc.localDescription } });
        }
    } else if (data.signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate)).catch(() => { });
    }
});

socket.on('operator_left', (id) => {
    if (peers[id]) { peers[id].close(); delete peers[id]; }
    updateCounter();
});

// PTT
const pttBtn = document.getElementById('ptt-btn');
if (pttBtn) {
    pttBtn.disabled = false;
    function startPTT() {
        if (!myGain) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        myGain.gain.setValueAtTime(1.5, audioCtx.currentTime);
        pttBtn.classList.add('active');
        document.getElementById('status-text').innerText = 'TRANSMITIENDO...';
        document.getElementById('status-text').style.color = '#ef4444';
    }

    function stopPTT() {
        if (!myGain) return;
        myGain.gain.setValueAtTime(0, audioCtx.currentTime);
        pttBtn.classList.remove('active');
        updateCounter();
    }

    pttBtn.addEventListener('mousedown', startPTT);
    window.addEventListener('mouseup', stopPTT);
    pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startPTT(); });
    pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopPTT(); });
}

window.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    document.querySelectorAll('audio').forEach(a => a.play().catch(() => { }));
});
