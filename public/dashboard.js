/* ============================================
   VANT COMMAND CENTER - DASHBOARD LOGIC
   ============================================ */

const socket = io();
let missionCode = null;
let currentLang = localStorage.getItem('vant_dashboard_lang') || 'en';

// Translations
const translations = {
    en: {
        status_disconnected: 'DISCONNECTED',
        status_connected: 'CONNECTED',
        header_active_op: 'ACTIVE OPERATION',
        header_field_units: 'FIELD UNITS',
        btn_copy_link: 'COPY ACCESS LINK',
        label_lat: 'LAT',
        label_lng: 'LNG',
        modal_auth_title: 'ADMIN AUTH',
        modal_auth_desc: 'Enter Operation Code to Monitor',
        btn_access: 'ACCESS SYSTEM',
        alert_copy: 'ACCESS LINK COPIED TO CLIPBOARD',
        status_no_signal: 'NO SIGNAL',
        status_initializing: 'INITIALIZING...'
    },
    es: {
        status_disconnected: 'DESCONECTADO',
        status_connected: 'CONECTADO',
        header_active_op: 'OPERACIÓN ACTIVA',
        header_field_units: 'UNIDADES DE CAMPO',
        btn_copy_link: 'COPIAR ENLACE DE ACCESO',
        label_lat: 'LAT',
        label_lng: 'LONG',
        modal_auth_title: 'AUTENTICACIÓN ADMIN',
        modal_auth_desc: 'Ingrese Código de Operación',
        btn_access: 'ACCEDER AL SISTEMA',
        alert_copy: 'ENLACE COPIADO AL PORTAPAPELES',
        status_no_signal: 'SIN SEÑAL',
        status_initializing: 'INICIALIZANDO...'
    }
};

/* ============================================
   TRANSLATION LOGIC
   ============================================ */

function changeLanguage(lang) {
    if (!translations[lang]) return;
    currentLang = lang;
    localStorage.setItem('vant_dashboard_lang', lang);

    // Update text elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.innerText = translations[lang][key];
        }
    });

    // Update placeholders
    const placeholders = {
        'admin-code-input': { en: 'CODE', es: 'CÓDIGO' }
    };

    Object.keys(placeholders).forEach(id => {
        const el = document.getElementById(id);
        if (el && placeholders[id][lang]) {
            el.placeholder = placeholders[id][lang];
        }
    });
}

// Initialize Language
changeLanguage(currentLang);

// Map & Markers
let map;
let markers = {}; // socketId -> L.Marker
let unitData = {}; // socketId -> { user, location, status }

// Audio & PTT
let localStream = null;
let peers = {}; // socketId -> SimplePeer
const pttBtn = document.getElementById('dashboard-ptt-btn');
const pttStatus = document.getElementById('ptt-status-text');
const pttDot = document.getElementById('ptt-dot');

// Visualizer State
let audioCtx = null;
let analyser = null;
let dataArray = null;
let visualizerCanvas = document.getElementById('audio-visualizer');
let canvasCtx = visualizerCanvas.getContext('2d');
let visualizerRequest = null;

/* ============================================
   MAP INITIALIZATION
   ============================================ */

function initMap() {
    // Default view: Santiago de Chile (or any central point)
    map = L.map('tactical-map').setView([-33.4489, -70.6693], 13);

    // Dark Matter Tiles (OpenStreetMap)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Coordinate Display
    map.on('mousemove', (e) => {
        document.getElementById('cursor-lat').innerText = e.latlng.lat.toFixed(6);
        document.getElementById('cursor-lng').innerText = e.latlng.lng.toFixed(6);
    });

    // Initialize Audio after Map (user interaction happened)
    initAudio();
}

/* ============================================
   AUDIO & WEBRTC
   ============================================ */

async function initAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Audio initialized');
        // Mute local audio initially
        localStream.getAudioTracks()[0].enabled = false;

        // Setup Visualizer
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;

            const source = audioCtx.createMediaStreamSource(localStream);
            source.connect(analyser);

            dataArray = new Uint8Array(analyser.frequencyBinCount);
            startVisualizer();
        }
    } catch (err) {
        console.error('Audio init error:', err);
        alert('Microphone access required for PTT');
    }
}

function startVisualizer() {
    const width = visualizerCanvas.width = visualizerCanvas.offsetWidth;
    const height = visualizerCanvas.height = visualizerCanvas.offsetHeight;

    function draw() {
        visualizerRequest = requestAnimationFrame(draw);

        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        analyser.getByteFrequencyData(dataArray);

        canvasCtx.clearRect(0, 0, width, height);

        const barWidth = (width / dataArray.length) * 2;
        let x = 0;

        // Draw a symmetric wave
        canvasCtx.beginPath();
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = '#6EE7B7'; // Vant Green
        canvasCtx.lineCap = 'round';

        for (let i = 0; i < dataArray.length; i++) {
            const barHeight = (dataArray[i] / 255) * (height / 1.5);

            // Central symmetric wave logic
            canvasCtx.moveTo(x, height / 2 - barHeight / 2);
            canvasCtx.lineTo(x, height / 2 + barHeight / 2);

            x += barWidth + 2;
        }
        canvasCtx.stroke();
    }
    draw();
}

// PTT Logic
function startTransmission() {
    if (!localStream) return;
    localStream.getAudioTracks()[0].enabled = true;
    pttBtn.classList.add('active');
    pttDot.className = 'status-dot transmitting';
    pttStatus.innerText = translations[currentLang].status_transmitting || 'TRANSMITTING';
    socket.emit('talking_status', true);
}

function stopTransmission() {
    if (!localStream) return;
    localStream.getAudioTracks()[0].enabled = false;
    pttBtn.classList.remove('active');
    pttDot.className = 'status-dot';
    pttStatus.innerText = translations[currentLang].status_standby || 'STANDBY';
    socket.emit('talking_status', false);
}

pttBtn.addEventListener('mousedown', startTransmission);
pttBtn.addEventListener('mouseup', stopTransmission);
pttBtn.addEventListener('mouseleave', stopTransmission);
pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startTransmission(); });
pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopTransmission(); });

/* ============================================
   WEBRTC SIGNALING
   ============================================ */

socket.on('user_joined', payload => {
    const peer = createPeer(payload.signal, payload.callerID, localStream);
    peers[payload.callerID] = peer;
});

socket.on('receiving_returned_signal', payload => {
    const item = peers[payload.id];
    item.signal(payload.signal);
});

socket.on('user_left', id => {
    if (peers[id]) {
        peers[id].destroy();
        delete peers[id];
    }
});

function createPeer(incomingSignal, callerID, stream) {
    const peer = new SimplePeer({
        initiator: false,
        trickle: false,
        stream: stream
    });

    peer.on('signal', signal => {
        socket.emit('returning_signal', { signal, callerID });
    });

    peer.on('stream', stream => {
        const audio = new Audio();
        audio.srcObject = stream;
        audio.play();

        // Connect remote stream to visualizer
        if (audioCtx && analyser) {
            const remoteSource = audioCtx.createMediaStreamSource(stream);
            remoteSource.connect(analyser);
        }
    });

    peer.signal(incomingSignal);
    return peer;
}

// Admin initiates connection to existing users? 
// Current architecture seems to rely on new user joining triggers 'user_joined'.
// If Admin joins late, existing users won't initiate?
// Check app.js logic. `app.js` emits `join_mission`.
// Server handles `join_mission`:
// `const usersInRoom = users[data];`
// `socket.emit('all_users', usersInRoom);`
// `socket.to(data).emit('user_joined', ...)`
// So `dashboard.js` needs to handle `all_users` to initiate connections TO them.

socket.on('all_users', users => {
    users.forEach(userID => {
        const peer = createInitiator(userID, localStream);
        peers[userID] = peer;
    });
});

function createInitiator(userToSignal, stream) {
    const peer = new SimplePeer({
        initiator: true,
        trickle: false,
        stream: stream
    });

    peer.on('signal', signal => {
        socket.emit('sending_signal', { userToSignal, callerID: socket.id, signal });
    });

    peer.on('stream', stream => {
        const audio = new Audio();
        audio.srcObject = stream;
        audio.play();

        // Connect remote stream to visualizer
        if (audioCtx && analyser) {
            const remoteSource = audioCtx.createMediaStreamSource(stream);
            remoteSource.connect(analyser);
        }
    });

    return peer;
}

/* ============================================
   SOCKET EVENTS
   ============================================ */

socket.on('connect', () => {
    const t = translations[currentLang];
    document.getElementById('status-text').innerText = t.status_connected;
    document.querySelector('.status-dot').classList.add('connected');
});

socket.on('disconnect', () => {
    const t = translations[currentLang];
    document.getElementById('status-text').innerText = t.status_disconnected;
    document.querySelector('.status-dot').classList.remove('connected');
});

socket.on('admin_init', (data) => {
    const { units, mission } = data;

    // Update Mission Info
    if (mission) {
        document.getElementById('mission-name').innerText = mission.name.toUpperCase();
    }

    units.forEach(updateUnit);
    updateUnitList();
});

socket.on('unit_location', (data) => {
    updateUnit(data);
    updateUnitList(); // Update status/location text in list
});

socket.on('unit_status', (data) => {
    if (data.status === 'OFFLINE') {
        removeUnit(data.id);
    } else {
        updateUnit(data);
    }
    updateUnitList();
});

/* ============================================
   UNIT MANAGEMENT
   ============================================ */

function updateUnit(data) {
    const { id, user, location, status } = data;

    // Store data
    unitData[id] = { ...unitData[id], ...data };

    if (!location) return;

    // Tactical Icon
    const customIcon = L.divIcon({
        className: 'tactical-marker',
        html: `<div style="
            width: 12px; 
            height: 12px; 
            background: #10b981; 
            border-radius: 50%;
            border: 2px solid white;
            box-shadow: 0 0 10px #10b981;
        "></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    // Update/Create Marker
    if (markers[id]) {
        markers[id].setLatLng([location.lat, location.lng]);
    } else {
        markers[id] = L.marker([location.lat, location.lng], { icon: customIcon })
            .addTo(map)
            .bindPopup(`<b>${user}</b><br>SPEED: ${location.speed || 0} m/s`);
    }
}

function removeUnit(id) {
    if (markers[id]) {
        map.removeLayer(markers[id]);
        delete markers[id];
    }
    delete unitData[id];
}

function updateUnitList() {
    const list = document.getElementById('unit-list');
    const count = document.getElementById('unit-count');
    const t = translations[currentLang];

    list.innerHTML = '';
    const units = Object.entries(unitData);
    count.innerText = units.length;

    units.forEach(([id, unit]) => {
        const div = document.createElement('div');
        div.className = 'unit-card';
        div.innerHTML = `
            <div class="unit-info">
                <h4>${unit.user}</h4>
                <div class="unit-status online">
                    <i class="fas fa-signal"></i> 
                    ${unit.location ? `${unit.location.lat.toFixed(4)}, ${unit.location.lng.toFixed(4)}` : t.status_no_signal}
                </div>
            </div>
            <div class="unit-actions">
                <button onclick="zoomToUnit('${id}')"><i class="fas fa-crosshairs"></i></button>
            </div>
        `;
        list.appendChild(div);
    });
}

window.zoomToUnit = (id) => {
    if (markers[id]) {
        map.setView(markers[id].getLatLng(), 16);
    }
};

/* ============================================
   LOGIN FLOW
   ============================================ */

const loginModal = document.getElementById('login-modal');
const adminInput = document.getElementById('admin-code-input');
const adminLoginBtn = document.getElementById('admin-login-btn');

adminLoginBtn.addEventListener('click', () => {
    const code = adminInput.value.trim().toUpperCase();
    if (code.length < 4) return;

    missionCode = code;
    socket.emit('admin_join', code); // For map data

    // Join Signal Room for PTT
    // We join as a special user so we can speak
    socket.emit('join_mission', { code, user: 'COMMAND' });

    // Update UI
    document.getElementById('mission-code').innerText = code;
    document.getElementById('mission-name').innerText = translations[currentLang].status_initializing;

    loginModal.classList.remove('active');
    initMap();
});

// Generate Link Button
document.getElementById('generate-link-btn').addEventListener('click', () => {
    if (!missionCode) return;
    const url = `${window.location.origin}/?code=${missionCode}`;
    navigator.clipboard.writeText(url).then(() => {
        alert(translations[currentLang].alert_copy);
    });
});


// Units Sidebar Toggle
const unitsSidebar = document.getElementById('units-sidebar');
const unitsToggle = document.getElementById('units-toggle');

if (unitsToggle && unitsSidebar) {
    unitsToggle.addEventListener('click', () => {
        unitsSidebar.classList.toggle('collapsed');
    });
}
