/* ============================================
   VANT TACTICAL COMMS - DIAGNOSTIC v3.0
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

    // Status visual
    const statusText = document.getElementById('status-text');
    if (Object.keys(peers).length > 0) {
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
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // --- ANALIZADORES SEPARADOS ---
        // 1. Recibido (Las ondas grandes)
        recvAnalyser = audioCtx.createAnalyser();
        recvAnalyser.fftSize = 64;
        dataArray = new Uint8Array(recvAnalyser.frequencyBinCount);

        // 2. Local (Para saber si mi micro funciona)
        localAnalyser = audioCtx.createAnalyser();
        localAnalyser.fftSize = 32;
        localDataArray = new Uint8Array(localAnalyser.frequencyBinCount);

        const source = audioCtx.createMediaStreamSource(stream);
        myGain = audioCtx.createGain();
        const destination = audioCtx.createMediaStreamDestination();

        source.connect(myGain);
        myGain.connect(destination);

        // El micro local se conecta a su analizador propio
        source.connect(localAnalyser);

        myGain.gain.setValueAtTime(0, audioCtx.currentTime);
        localStream = destination.stream;

        log("Hardware táctico listo.");
        startVisualizer();
        return true;
    } catch (e) {
        alert("ERROR DE PERMISOS: Micrófono no detectado.");
        return false;
    }
}

function startVisualizer() {
    const canvas = document.getElementById('visualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw() {
        requestAnimationFrame(draw);

        // Dibujamos el fondo
        ctx.fillStyle = '#131314';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // --- DIBUJAR ONDAS DE AUDIO RECIBIDO (PRINCIPAL) ---
        recvAnalyser.getByteFrequencyData(dataArray);
        const barWidth = (canvas.width / dataArray.length) * 2;
        let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const h = (dataArray[i] / 255) * canvas.height;
            ctx.fillStyle = '#6EE7B7'; // Verde neón para el otro
            ctx.fillRect(x, canvas.height - h, barWidth - 2, h);
            x += barWidth;
        }

        // --- DIBUJAR INDICADOR DE MI PROPIO MICRO (PEQUEÑO) ---
        localAnalyser.getByteFrequencyData(localDataArray);
        let localVol = 0;
        localDataArray.forEach(v => localVol += v);
        localVol = localVol / localDataArray.length;

        ctx.fillStyle = localVol > 10 ? '#3b82f6' : '#1f2937'; // Azul si hablo
        ctx.fillRect(5, 5, 10, 10); // Un pequeño cuadrito indicador
    }
    draw();
}

function getOrCreatePC(remoteId) {
    if (peers[remoteId]) return peers[remoteId];

    const pc = new RTCPeerConnection(rtcConfig);
    peers[remoteId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTransceiver(track, { streams: [localStream] }));
    }

    pc.ontrack = (event) => {
        log("¡SEÑAL ENTRANTE DETECTADA!");
        const remoteStream = event.streams[0];

        // 1. Salida de audio física
        let audio = document.getElementById(`audio-${remoteId}`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${remoteId}`;
            audio.autoplay = true;
            audio.playsInline = true;
            document.body.appendChild(audio);
        }
        audio.srcObject = remoteStream;

        // 2. Conectar al visualizador PRINCIPAL (ondas grandes)
        if (audioCtx) {
            const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
            remoteSource.connect(audioCtx.destination);
            remoteSource.connect(recvAnalyser); // AHORA LAS ONDAS SÓLO SE MUEVEN CON EL OTRO
        }

        document.getElementById('ptt-ring').classList.add('active');
        updateCounter();
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { to: remoteId, signal: { candidate: event.candidate } });
        }
    };

    pc.onconnectionstatechange = () => {
        log(`Link ${remoteId}: ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            delete peers[remoteId];
            document.getElementById(`audio-${remoteId}`)?.remove();
            updateCounter();
        }
    };

    return pc;
}

// --- CONEXIÓN AL CANAL ---
async function join() {
    const code = document.getElementById('access-code').value.trim().toUpperCase();
    if (!code) return;
    if (await setupAudio()) {
        socket.emit('join_mission', { code: code });
    }
}

socket.on('mission_joined', (data) => {
    log("Canal ALPHA-FORCE: " + data.mission);
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    document.getElementById('channel-name').innerText = data.mission;
    document.getElementById('ptt-btn').disabled = false;

    if (data.existingMembers) {
        data.existingMembers.forEach(async (id) => {
            log("Llamando a operador remoto...");
            const pc = getOrCreatePC(id);
            const offer = await pc.createOffer({ offerToReceiveAudio: true });
            await pc.setLocalDescription(offer);
            socket.emit('signal', { to: id, signal: { sdp: pc.localDescription } });
        });
    }
    updateCounter();
});

socket.on('new_operator', (id) => {
    log("Nueva unidad en el sector. Preparando enlace...");
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
        await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate)).catch(() => { });
    }
    updateCounter();
});

// --- PTT CONTROLS ---
const pttBtn = document.getElementById('ptt-btn');

async function pushToTalk() {
    if (!myGain) return;
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    // Desbloqueo forzado de altavoces
    document.querySelectorAll('audio').forEach(a => a.play().catch(() => { }));

    myGain.gain.setTargetAtTime(1.2, audioCtx.currentTime, 0.05); // Boost de volumen
    pttBtn.classList.add('active');
    document.getElementById('status-text').innerText = 'HABLANDO...';
    document.getElementById('status-text').style.color = '#ef4444';
}

function releaseToListen() {
    if (!myGain) return;
    myGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    pttBtn.classList.remove('active');
    updateCounter();
}

if (pttBtn) {
    pttBtn.addEventListener('mousedown', pushToTalk);
    window.addEventListener('mouseup', releaseToListen);
    pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); pushToTalk(); });
    pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); releaseToListen(); });
}

document.getElementById('login-btn').addEventListener('click', join);

window.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});
