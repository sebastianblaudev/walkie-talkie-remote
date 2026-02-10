/* ============================================
   VANT - TACTICAL COMMUNICATIONS PLATFORM
   Enterprise WebRTC Push-to-Talk System
   ============================================ */

/* ============================================
   DEBUGGING UTILS
   ============================================ */
function logToScreen(msg) {
    const consoleDiv = document.getElementById('debug-console');
    if (consoleDiv) {
        const time = new Date().toLocaleTimeString();
        consoleDiv.innerText += `\n[${time}] ${msg}`;
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
    console.log(msg);
}

// Global Error Handler
window.onerror = function (msg, url, line) {
    logToScreen(`ERROR: ${msg} (Line ${line})`);
    return false;
};

/* ============================================
   SERVER CONFIG
   ============================================ */

const getServerUrl = () => {
    // Check if running in Capacitor (Native App)
    const isCapacitor = window.Capacitor !== undefined;
    logToScreen(`Environment: ${isCapacitor ? 'NATIVE APP' : 'BROWSER'}`);

    // FORCE HTTPS URL FOR APK TESTING
    if (isCapacitor) {
        logToScreen('Forcing Remote Server: https://walkie-talkie-remote.onrender.com');
        return 'https://walkie-talkie-remote.onrender.com';
    }

    const isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const defaultUrl = isLocal ? window.location.origin : 'https://walkie-talkie-remote.onrender.com';

    logToScreen(`Server URL: ${defaultUrl}`);
    return defaultUrl;
};

let socket;
try {
    socket = io(getServerUrl(), {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000
    });
    logToScreen('Socket initialized...');
} catch (e) {
    logToScreen(`Socket Init Error: ${e.message}`);
}

// Application State
let localStream;
let roomId;
let missionCode;
let missionChannels = [];
let isAuthenticated = false;
let isPoweredOn = false;

// Audio Context & Nodes
let audioContext;
let micSource;
let gainNode;
let destNode;
let analyser;
let dataArray;
let canvas, canvasCtx;
let animationId;

// WebRTC Configuration
const peers = {};
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:openrelay.metered.ca:80' },
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
    iceCandidatePoolSize: 10,
    sdpSemantics: 'unified-plan'
};

/* ============================================
   DOM ELEMENTS
   ============================================ */

// Login Screen
const loginScreen = document.getElementById('login-screen');
const accessCodeInput = document.getElementById('access-code');
const loginBtn = document.getElementById('login-btn');

// Main Screen
const mainScreen = document.getElementById('main-screen');
const statusText = document.getElementById('status-text');
const channelName = document.getElementById('channel-name');
const userCount = document.getElementById('user-count');
const pttBtn = document.getElementById('ptt-btn');
const pttRing = document.getElementById('ptt-ring');
const signalIndicator = document.getElementById('signal-indicator');
const connectionStatus = document.getElementById('connection-status');

// Channels Screen
const channelsScreen = document.getElementById('channels-screen');
const channelCodeInput = document.getElementById('channel-code');
const joinChannelBtn = document.getElementById('join-channel-btn');
const joinBtnText = document.getElementById('join-btn-text');

// Profile Screen
const profileScreen = document.getElementById('profile-screen');
const deviceId = document.getElementById('device-id');
const logoutBtn = document.getElementById('logout-btn');

// Navigation
const navChannels = document.getElementById('nav-channels');
const navPtt = document.getElementById('nav-ptt');
const navProfile = document.getElementById('nav-profile');
const backFromChannels = document.getElementById('back-from-channels');
const backFromProfile = document.getElementById('back-from-profile');

// Canvas
canvas = document.getElementById('visualizer');
canvasCtx = canvas.getContext('2d');

/* ============================================
   SCREEN NAVIGATION
   ============================================ */

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');

    // Update nav active state
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
}

navChannels.addEventListener('click', () => {
    if (!isAuthenticated) return;
    showScreen('channels-screen');
});

navPtt.addEventListener('click', () => {
    if (!isAuthenticated) return;
    showScreen('main-screen');
    navPtt.classList.add('active');
});

navProfile.addEventListener('click', () => {
    if (!isAuthenticated) return;
    showScreen('profile-screen');
});

backFromChannels.addEventListener('click', () => {
    showScreen('main-screen');
    navPtt.classList.add('active');
});

backFromProfile.addEventListener('click', () => {
    showScreen('main-screen');
    navPtt.classList.add('active');
});

/* ============================================
   B2B AUTO-LOGIN & GPS TRACKING
   ============================================ */

window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        console.log('[VANT] Auto-login code detected:', code);
        accessCodeInput.value = code;
        authenticate(code);
    }
});

let watchId = null;

function startGpsTracking() {
    if ('geolocation' in navigator) {
        watchId = navigator.geolocation.watchPosition((position) => {
            const { latitude, longitude, speed, heading } = position.coords;
            console.log('[GPS] Location update:', latitude, longitude);

            // Send to server
            socket.emit('location_update', {
                lat: latitude,
                lng: longitude,
                speed: speed,
                heading: heading,
                timestamp: position.timestamp
            });

            // Update UI indicator (if we add one later)
        }, (error) => {
            console.error('[GPS] Tracking error:', error);
        }, {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 5000
        });
    } else {
        console.warn('[GPS] Geolocation not supported');
    }
}

/* ============================================
   LOGIN FLOW
   ============================================ */

accessCodeInput.addEventListener('input', (e) => {
    const value = e.target.value.trim();
    loginBtn.disabled = value.length < 1;
});

accessCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && accessCodeInput.value.trim().length >= 1) {
        authenticate();
    }
});

loginBtn.addEventListener('click', authenticate);

const loginStatusText = document.getElementById('login-status-text');

async function authenticate(autoCode = null) {
    let code = autoCode || accessCodeInput.value.trim();
    if (!code) return;

    // Normalize: Remove spaces and force uppercase
    code = code.replace(/\s+/g, '').toUpperCase();
    logToScreen(`Authenticating: ${code}`);

    if (!socket.connected) {
        logToScreen('ERROR: Socket not connected!');
        alert('CONNECTION ERROR: Verify internet connection.');
        return;
    }

    missionCode = code;

    // Status Feedback
    loginStatusText.innerText = 'AUTHENTICATING...';
    loginStatusText.style.color = 'var(--brand)';

    // Timeout
    const authTimeout = setTimeout(() => {
        logToScreen('ERROR: Server timeout (5s)');
        alert('SERVER TIMEOUT: No response from command center.');
        loginStatusText.innerText = 'CONNECTION ERROR';
        loginStatusText.style.color = 'var(--danger)';
    }, 5000);

    // B2B: Join Mission
    logToScreen('Sending join_mission event...');
    socket.emit('join_mission', { code: code });

    // Clear timeout on success
    socket.once('mission_joined', () => clearTimeout(authTimeout));
    socket.once('mission_error', () => clearTimeout(authTimeout));
}

socket.on('mission_joined', (data) => {
    logToScreen(`Mission Joined: ${data.mission}`);
    isAuthenticated = true;
    missionChannels = data.channels || [];
    roomId = missionCode; // Default room is mission code

    initializeSystem();
    showScreen('main-screen');
    navPtt.classList.add('active');

    // Update Channel Name
    channelName.innerText = data.mission.toUpperCase();

    // Reset Login Status
    loginStatusText.innerText = 'END-TO-END ENCRYPTED';
    loginStatusText.style.color = 'rgba(255,255,255,0.5)';

    // Render Channels
    renderChannels();
});

socket.on('mission_error', (data) => {
    logToScreen(`Mission Error: ${data.message}`);
    alert(`ACCESS DENIED: ${data.message}`);
    isAuthenticated = false;

    loginStatusText.innerText = 'ACCESS DENIED';
    loginStatusText.style.color = 'var(--danger)';
});

async function initializeSystem() {
    console.log('[VANT] Initializing tactical communications system...');

    try {
        // Request microphone access
        const rawStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });

        // Initialize Audio Context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Create Audio Nodes
        micSource = audioContext.createMediaStreamSource(rawStream);
        gainNode = audioContext.createGain();
        destNode = audioContext.createMediaStreamDestination();
        analyser = audioContext.createAnalyser();

        // Connect Audio Graph
        micSource.connect(gainNode);
        gainNode.connect(destNode);
        micSource.connect(analyser);

        // Set initial state (muted)
        gainNode.gain.value = 0;

        // This is the stream for WebRTC
        localStream = destNode.stream;

        // Setup Visualizer
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        drawVisualizer();

        // Initialize GPS Tracking
        startGpsTracking();

        // Update UI
        isPoweredOn = true;
        statusText.innerText = 'STANDBY';
        statusText.classList.add('connected');
        connectionStatus.querySelector('.status-dot').classList.add('active');
        signalIndicator.classList.add('active');

        // Set device ID
        deviceId.innerText = socket.id || 'INITIALIZING...';

        console.log('[VANT] System initialized successfully');
    } catch (err) {
        console.error('[VANT] Initialization error:', err);
        alert('Microphone access required for tactical communications.');
        logout();
    }
}

/* ============================================
   CHANNEL LOGIC
   ============================================ */

function renderChannels() {
    const list = document.querySelector('.channels-list');
    list.innerHTML = `<div class="list-header">AVAILABLE NETWORKS</div>`;

    // Main Channel
    addChannelItem('MAIN OPERATION', missionCode, true);

    // Sub Channels
    missionChannels.forEach((channel) => {
        addChannelItem(channel, `${missionCode}-${channel}`, false);
    });
}

function addChannelItem(name, id, isMain) {
    const list = document.querySelector('.channels-list');
    const isActive = roomId === id;

    const card = document.createElement('div');
    card.className = `channel-card ${isActive ? 'active' : ''}`;
    // Visual feedback styling for active card is needed in CSS if not present
    if (isActive) {
        card.style.borderColor = 'var(--brand)';
        card.style.background = 'rgba(16, 185, 129, 0.1)';
    }

    card.onclick = () => switchChannel(id, name);

    card.innerHTML = `
        <div class="channel-card-header">
            <div class="channel-card-name">${name}</div>
            <div class="channel-badge">${isMain ? 'DEFAULT' : 'SECURE'}</div>
        </div>
        <div class="channel-card-meta">
            <span>${isActive ? 'CONNECTED' : 'STANDBY'}</span>
        </div>
    `;
    list.appendChild(card);
}

function switchChannel(newRoomId, name) {
    if (roomId === newRoomId) return;

    console.log('[VANT] Switching to channel:', name);

    // Leave current
    if (roomId) {
        socket.emit('leave-room', roomId);
        // Clean peers
        Object.keys(peers).forEach(key => {
            peers[key].close();
            delete peers[key];
        });
    }

    // Join new
    roomId = newRoomId;
    socket.emit('join-room', roomId);

    // Update UI
    channelName.innerText = name;
    statusText.innerText = 'CONNECTED';
    renderChannels(); // Re-render to update active state
    showScreen('main-screen');
    navPtt.classList.add('active');
}

/* ============================================
   MANUAL CHANNEL ENTRY
   ============================================ */

channelCodeInput.addEventListener('input', (e) => {
    const value = e.target.value.trim();
    joinChannelBtn.disabled = value.length < 1;
});

channelCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && channelCodeInput.value.trim().length >= 1) {
        toggleChannel();
    }
});

joinChannelBtn.addEventListener('click', toggleChannel);

function toggleChannel() {
    if (!isPoweredOn) return;

    if (roomId) {
        // LEAVE channel
        Object.keys(peers).forEach(key => {
            peers[key].close();
            delete peers[key];
        });

        socket.emit('leave-room', roomId);
        roomId = null;

        channelName.innerText = '—';
        userCount.innerText = '0 OPERATORS';
        statusText.innerText = 'STANDBY';
        statusText.classList.remove('transmitting');
        statusText.classList.add('connected');

        joinBtnText.innerText = 'JOIN';
        joinChannelBtn.classList.remove('leave');
        channelCodeInput.disabled = false;
        pttBtn.disabled = true;

        console.log('[VANT] Disconnected from channel');
    } else {
        // JOIN channel
        const code = channelCodeInput.value.trim();
        if (code.length < 1) return;

        roomId = code;
        socket.emit('join-room', roomId);

        channelName.innerText = code;
        userCount.innerText = '1 OPERATOR'; // Will update when peers connect
        statusText.innerText = 'CONNECTED';
        statusText.classList.add('connected');

        joinBtnText.innerText = 'LEAVE';
        joinChannelBtn.classList.add('leave');
        channelCodeInput.disabled = true;
        pttBtn.disabled = false;

        console.log('[VANT] Connected to channel:', code);
    }
}

/* ============================================
   PUSH-TO-TALK
   ============================================ */

const startTransmission = async () => {
    if (!isPoweredOn || !roomId || !gainNode) return;

    // Resume AudioContext (mobile safety)
    if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    statusText.innerText = 'TRANSMITTING';
    statusText.classList.remove('connected');
    statusText.classList.add('transmitting');
    connectionStatus.querySelector('.status-dot').classList.add('transmitting');
    pttBtn.classList.add('active');
    pttRing.classList.add('active', 'transmitting');

    // Unmute audio
    gainNode.gain.setTargetAtTime(1, audioContext.currentTime, 0.01);

    console.log('[VANT] Transmission started');
};

const stopTransmission = () => {
    if (!isPoweredOn || !roomId || !gainNode) return;

    statusText.innerText = 'CONNECTED';
    statusText.classList.remove('transmitting');
    statusText.classList.add('connected');
    connectionStatus.querySelector('.status-dot').classList.remove('transmitting');
    pttBtn.classList.remove('active');
    pttRing.classList.remove('active', 'transmitting');

    // Mute audio
    gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);

    console.log('[VANT] Transmission stopped');
};

// Desktop PTT
pttBtn.addEventListener('mousedown', startTransmission);
window.addEventListener('mouseup', stopTransmission);

// Mobile PTT
pttBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startTransmission();
});

pttBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopTransmission();
});

/* ============================================
   AUDIO VISUALIZER
   ============================================ */

function drawVisualizer() {
    if (!isPoweredOn) return;
    animationId = requestAnimationFrame(drawVisualizer);

    analyser.getByteFrequencyData(dataArray);

    canvasCtx.fillStyle = '#1a1a22';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / dataArray.length) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

        // Green gradient based on height (Brand: 16, 185, 129)
        const intensity = dataArray[i] / 255;
        const r = Math.floor(16 * intensity);
        const g = Math.floor(185 * intensity);
        const b = Math.floor(129 * intensity);

        canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        // Removed glow effects for flat design

        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
    }
}

/* ============================================
   WebRTC SIGNALING
   ============================================ */

socket.on('user-connected', (userId) => {
    console.log('[VANT] Peer connected:', userId);
    createOffer(userId);
    updateUserCount();
});

socket.on('user-disconnected', (userId) => {
    console.log('[VANT] Peer disconnected:', userId);
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    updateUserCount();
});

function updateUserCount() {
    const count = Object.keys(peers).length + 1; // +1 for self
    userCount.innerText = `${count} OPERATOR${count !== 1 ? 'S' : ''}`;
}

function createPeerConnection(targetId) {
    if (peers[targetId]) return peers[targetId];

    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        console.log('[VANT] Received remote audio track');
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
        remoteAudio.muted = false;

        const playPromise = remoteAudio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => console.warn('[VANT] Auto-play prevented:', error));
        }

        // Visual feedback for receiving
        pttRing.classList.add('active');
        setTimeout(() => {
            if (!pttBtn.classList.contains('active')) {
                pttRing.classList.remove('active');
            }
        }, 2000);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { candidate: event.candidate, target: targetId });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('[VANT] Connection state:', pc.connectionState);
    };

    return pc;
}

async function createOffer(targetId) {
    const pc = createPeerConnection(targetId);
    const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
    });
    await pc.setLocalDescription(offer);
    socket.emit('offer', { offer, target: targetId });
}

socket.on('offer', async (data) => {
    if (!isPoweredOn) return;
    const pc = createPeerConnection(data.caller);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer({
        offerToReceiveAudio: true
    });
    await pc.setLocalDescription(answer);
    socket.emit('answer', { answer, target: data.caller });
});

socket.on('answer', async (data) => {
    const pc = peers[data.caller];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    const pc = peers[data.caller];
    if (pc) {
        try {
            await pc.addIceCandidate(data.candidate);
        } catch (e) {
            console.error('[VANT] ICE candidate error:', e);
        }
    }
});

/* ============================================
   LOGOUT / DISCONNECT
   ============================================ */

logoutBtn.addEventListener('click', logout);

function logout() {
    console.log('[VANT] Logging out...');

    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    // Close all peer connections
    Object.keys(peers).forEach(key => {
        peers[key].close();
        delete peers[key];
    });

    // Close audio context
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
    }

    // Leave room
    if (roomId) {
        socket.emit('leave-room', roomId);
        roomId = null;
    }

    // Cancel animation
    cancelAnimationFrame(animationId);
    if (canvasCtx) {
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Reset state
    isAuthenticated = false;
    isPoweredOn = false;

    // Reset UI
    accessCodeInput.value = '';
    channelCodeInput.value = '';
    loginBtn.disabled = true;

    // Show login screen
    showScreen('login-screen');

    console.log('[VANT] Logged out successfully');
}

/* ============================================
   SOCKET CONNECTION MONITORING
   ============================================ */

socket.on('connect', () => {
    logToScreen(`Socket Connected! ID: ${socket.id}`);
    if (deviceId) {
        deviceId.innerText = socket.id;
    }
    // Login Screen Update
    if (loginStatusText) {
        loginStatusText.innerText = 'SYSTEM ONLINE';
        loginStatusText.style.color = 'var(--brand)';
    }
});

socket.on('disconnect', (reason) => {
    logToScreen(`Socket Disconnected: ${reason}`);
    statusText.innerText = 'CONNECTION LOST';
    statusText.classList.remove('connected', 'transmitting');
    signalIndicator.classList.remove('active');

    // Login Screen Update
    if (loginStatusText) {
        loginStatusText.innerText = 'OFFLINE - RETRYING...';
        loginStatusText.style.color = 'var(--danger)';
    }
});

socket.on('connect_error', (error) => {
    logToScreen(`Connection Error: ${error.message}`);
    if (loginStatusText) {
        loginStatusText.innerText = 'SERVER UNREACHABLE';
        loginStatusText.style.color = 'var(--danger)';
    }
});

socket.on('reconnect', (attempt) => {
    logToScreen(`Reconnected (Attempt ${attempt})`);
    if (isPoweredOn && !roomId) {
        statusText.innerText = 'STANDBY';
        statusText.classList.add('connected');
        signalIndicator.classList.add('active');
    }
});

/* ============================================
   INITIALIZATION
   ============================================ */

logToScreen('App Loaded. Initializing...');
console.log('[VANT] Tactical Communications Platform loaded');
console.log('[VANT] Server:', getServerUrl());
