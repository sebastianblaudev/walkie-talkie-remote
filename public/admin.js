const socket = io();

// State
let missions = [];
let clients = [];
let currentLang = localStorage.getItem('vant_admin_lang') || 'en';

// Translations
const translations = {
    en: {
        nav_operations: 'OPERATIONS',
        nav_clients: 'CLIENTS',
        nav_system: 'SYSTEM',
        user_role: 'SUPER ADMIN',
        status_online: 'ONLINE',
        header_active_ops: 'ACTIVE OPERATIONS',
        header_ops_subtitle: 'REAL-TIME OPERATIONAL STATUS',
        btn_new_op: 'NEW OPERATION',
        header_settings: 'SYSTEM SETTINGS',
        header_settings_subtitle: 'PLATFORM CONFIGURATION',
        setting_lang_title: 'INTERFACE LANGUAGE',
        setting_lang_desc: 'Select the display language for the admin console.',
        modal_new_op_title: 'INITIATE NEW OPERATION',
        label_client_org: 'CLIENT ORGANIZATION',
        label_op_name: 'OPERATION NAME',
        ph_channels: 'E.G. LOGISTICS, ALPHA, BRAVO',
        label_op_channels: 'OPERATION CHANNELS',
        hint_channels: 'Comma separated. Main link created by default.',
        label_access_code: 'ACCESS CODE',
        btn_create_op: 'CREATE OPERATION',
        login_title: 'MASTER ACCESS',
        btn_authenticate: 'AUTHENTICATE',
        status_active: 'ACTIVE',
        status_inactive: 'INACTIVE',
        label_code: 'CODE',
        label_units: 'UNITS',
        btn_dashboard: 'DASHBOARD',
        btn_invite: 'INVITE',
        alert_access_denied: 'ACCESS DENIED: INVALID KEY',
        alert_invite_copied: 'INVITE LINK COPIED: ',
        alert_error: 'ERROR: ',
        msg_initializing: '[ADMIN] Initializing Master Control...'
    },
    es: {
        nav_operations: 'OPERACIONES',
        nav_clients: 'CLIENTES',
        nav_system: 'SISTEMA',
        user_role: 'SUPER ADMIN',
        status_online: 'EN LÍNEA',
        header_active_ops: 'OPERACIONES ACTIVAS',
        header_ops_subtitle: 'ESTADO OPERATIVO EN TIEMPO REAL',
        btn_new_op: 'NUEVA OPERACIÓN',
        header_settings: 'CONFIGURACIÓN DEL SISTEMA',
        header_settings_subtitle: 'CONFIGURACIÓN DE LA PLATAFORMA',
        setting_lang_title: 'IDIOMA DE LA INTERFAZ',
        setting_lang_desc: 'Seleccione el idioma para la consola de administración.',
        modal_new_op_title: 'INICIAR NUEVA OPERACIÓN',
        label_client_org: 'ORGANIZACIÓN DEL CLIENTE',
        label_op_name: 'NOMBRE DE LA OPERACIÓN',
        ph_channels: 'EJ. LOGISTICA, ALFA, BRAVO',
        label_op_channels: 'CANALES OPERATIVOS',
        hint_channels: 'Separado por comas. Enlace principal creado por defecto.',
        label_access_code: 'CÓDIGO DE ACCESO',
        btn_create_op: 'CREAR OPERACIÓN',
        login_title: 'ACCESO MAESTRO',
        btn_authenticate: 'AUTENTICAR',
        status_active: 'ACTIVO',
        status_inactive: 'INACTIVO',
        label_code: 'CÓDIGO',
        label_units: 'UNIDADES',
        btn_dashboard: 'PANEL',
        btn_invite: 'INVITAR',
        alert_access_denied: 'ACCESO DENEGADO: CLAVE INVÁLIDA',
        alert_invite_copied: 'ENLACE DE INVITACIÓN COPIADO: ',
        alert_error: 'ERROR: ',
        msg_initializing: '[ADMIN] Inicializando Control Maestro...'
    }
};

// DOM Elements
const loginOverlay = document.getElementById('login-overlay');
const loginBtn = document.getElementById('master-login-btn');
const passwordInput = document.getElementById('admin-password');
const missionsGrid = document.getElementById('missions-grid');
const createModal = document.getElementById('create-modal');
const langBtns = document.querySelectorAll('.lang-btn');

/* ============================================
   TRANSLATION LOGIC
   ============================================ */

function changeLanguage(lang) {
    if (!translations[lang]) return;
    currentLang = lang;
    localStorage.setItem('vant_admin_lang', lang);

    // Update UI
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.innerText = translations[lang][key];
        }
    });

    // Update placeholders
    const placeholders = {
        'client-name': { en: 'E.g. SECTOR 7 SECURITY', es: 'Ej. SEGURIDAD SECTOR 7' },
        'mission-name': { en: 'E.g. PROJECT NIGHTFALL', es: 'Ej. PROYECTO NIGHTFALL' },
        'admin-password': { en: 'ENTER KEY', es: 'INGRESAR CLAVE' },
        'mission-code': { en: 'AUTO-GENERATED', es: 'AUTO-GENERADO' }
    };

    Object.keys(placeholders).forEach(id => {
        const el = document.getElementById(id);
        if (el && placeholders[id][lang]) {
            el.placeholder = placeholders[id][lang];
        }
    });

    // Update Buttons State
    langBtns.forEach(btn => {
        if (btn.getAttribute('data-lang') === lang) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Re-render dynamic content (missions)
    if (missions.length > 0) {
        renderMissions();
    }
}

// Language Switcher Events
langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const lang = btn.getAttribute('data-lang');
        changeLanguage(lang);
    });
});

// Initialize Language
changeLanguage(currentLang);

/* ============================================
   AUTHENTICATION (MVP: Hardcoded Key)
   ============================================ */

loginBtn.addEventListener('click', () => {
    const key = passwordInput.value;
    if (key === 'VANT_ADMIN') {
        loginOverlay.classList.remove('active');
        initAdmin();
    } else {
        alert(translations[currentLang].alert_access_denied);
    }
});

/* ============================================
   INITIALIZATION
   ============================================ */

function initAdmin() {
    console.log(translations[currentLang].msg_initializing);
    requestMissionList();
}

function requestMissionList() {
    socket.emit('admin_get_missions');
}

/* ============================================
   SOCKET EVENTS
   ============================================ */

socket.on('admin_mission_list', (data) => {
    console.log('[ADMIN] Operations received:', data);
    missions = data;
    renderMissions();
});

socket.on('mission_created', (data) => {
    console.log('[ADMIN] Operation created:', data);
    if (data.success) {
        requestMissionList();
        closeModal();
    } else {
        alert(translations[currentLang].alert_error + data.message);
    }
});

/* ============================================
   UI RENDERING
   ============================================ */

function renderMissions() {
    missionsGrid.innerHTML = '';
    const t = translations[currentLang];

    missions.forEach(mission => {
        const card = document.createElement('div');
        card.className = 'mission-card';
        card.innerHTML = `
            <div class="card-header">
                <div class="mission-title">
                    <h3>${mission.name}</h3>
                    <span>${mission.client}</span>
                </div>
                <div class="mission-status">${mission.active ? t.status_active : t.status_inactive}</div>
            </div>
            
            <div class="mission-details">
                <div class="detail-item">
                    <span class="label">${t.label_code}</span>
                    <span class="value">${mission.code}</span>
                </div>
                <div class="detail-item">
                    <span class="label">${t.label_units}</span>
                    <span class="value">${mission.units || 0}</span>
                </div>
            </div>

            <div class="card-actions">
                <button class="card-btn" onclick="openDashboard('${mission.code}')">
                    <i class="fas fa-desktop"></i> ${t.btn_dashboard}
                </button>
                <button class="card-btn" onclick="copyInvite('${mission.code}')">
                    <i class="fas fa-link"></i> ${t.btn_invite}
                </button>
            </div>
        `;
        missionsGrid.appendChild(card);
    });
}

/* ============================================
   NAVIGATION LOGIC
   ============================================ */

const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const tabId = item.getAttribute('data-tab');

        if (tabId === 'settings') {
            openSettingsModal();
            return;
        }

        // Update Nav State
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        // Update View State
        views.forEach(view => {
            view.classList.remove('active');
            if (view.id === `view-${tabId}`) {
                view.classList.add('active');
            }
        });
    });
});

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('active');
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('active');
}

document.querySelector('.close-modal-settings').addEventListener('click', closeSettingsModal);

// Close on background click
document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') closeSettingsModal();
});

// Global Actions
window.openDashboard = (code) => {
    // Open dashboard.html in new tab with code pre-filled
    // For now, we can just open dashboard and manually login, or pass param
    window.open(`/dashboard.html`, '_blank');
    // Ideally dashboard auto-logs in via URL param, let's implement that later
};

window.copyInvite = (code) => {
    const url = `${window.location.origin}/?code=${code}`;
    navigator.clipboard.writeText(url).then(() => {
        alert(translations[currentLang].alert_invite_copied + url);
    });
};

/* ============================================
   CREATE MISSION FLOW
   ============================================ */

const createBtn = document.getElementById('create-mission-btn');
const closeBtn = document.querySelector('.close-modal');
const generateCodeBtn = document.getElementById('generate-code-btn');
const missionCodeInput = document.getElementById('mission-code');
const createForm = document.getElementById('create-mission-form');

createBtn.addEventListener('click', () => {
    createModal.style.display = 'flex';
    // Auto generate code
    generateCode();
});

closeBtn.addEventListener('click', closeModal);

function closeModal() {
    createModal.style.display = 'none';
    createForm.reset();
}

generateCodeBtn.addEventListener('click', generateCode);

function generateCode() {
    // Generate 5-char alphanumeric code (e.g. BRAVO5)
    const prefixes = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'SIERRA', 'TANGO', 'VICTOR', 'ZULU'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.floor(Math.random() * 99) + 1;
    missionCodeInput.value = `${prefix}${num}`;
}

createForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const channelsInput = document.getElementById('mission-channels').value;
    const channels = channelsInput
        ? channelsInput.split(',').map(c => c.trim().toUpperCase()).filter(c => c.length > 0)
        : [];

    const newMission = {
        client: document.getElementById('client-name').value,
        name: document.getElementById('mission-name').value,
        code: missionCodeInput.value,
        channels: channels,
        active: true
    };

    console.log('[ADMIN] Creating operation:', newMission);
    socket.emit('admin_create_mission', newMission);
});
