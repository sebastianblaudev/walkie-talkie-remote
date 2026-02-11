const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active sockets in rooms
// B2B Data Stores (Persistent JSON)
const DATA_FILE = path.join(__dirname, 'vant_data.json');
let missions = {};

// Load Data
if (fs.existsSync(DATA_FILE)) {
    try {
        missions = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        console.log('Loaded missions from disk');
    } catch (e) {
        console.error('Failed to load data, using defaults:', e);
        missions = getDefaultMissions();
    }
} else {
    missions = getDefaultMissions();
    saveData();
}

function getDefaultMissions() {
    return {
        'ALPHA1': { name: 'Alpha Squad', client: 'Security Corp', active: true },
        'BRAVO2': { name: 'Bravo Team', client: 'Logistics Inc', active: true },
        'HQ-TEST': { name: 'Command Center', client: 'VANT Internal', active: true }
    };
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(missions, null, 2));
    } catch (e) {
        console.error('Error saving data:', e);
    }
}

const activeSessions = {}; // socketId -> { code, user, role, location }

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // ============================================
    // B2B MISSION LOGIC
    // ============================================

    socket.on('join_mission', (data) => {
        // data: { code, user (optional) }
        const code = data.code?.toUpperCase();

        if (missions[code] && missions[code].active) {
            // Join the mission room
            socket.join(code);

            // Register session
            const user = data.user || `Operator-${socket.id.substr(0, 4)}`;
            activeSessions[socket.id] = {
                code: code,
                user: user,
                role: 'OPERATOR',
                lastSeen: new Date()
            };

            console.log(`[MISSION] ${user} joined mission ${code}`);

            // Notify client of success
            socket.emit('mission_joined', {
                success: true,
                mission: missions[code].name,
                channels: missions[code].channels || [],
                user: user
            });

            // CRITICAL: Notify other peers in the room to initiate WebRTC
            socket.to(code).emit('user-connected', socket.id);

            // Notify Admins
            io.to(`${code}-ADMIN`).emit('unit_status', {
                id: socket.id,
                user: user,
                status: 'ONLINE'
            });
        } else {
            socket.emit('mission_error', { message: 'Invalid or inactive operation code' });
        }
    });

    socket.on('location_update', (coords) => {
        // coords: { lat, lng, speed, heading }
        const session = activeSessions[socket.id];
        if (session) {
            // Update session data
            session.location = coords;
            session.lastSeen = new Date();

            // Broadcast to Admin Room only
            io.to(`${session.code}-ADMIN`).emit('unit_location', {
                id: socket.id,
                user: session.user,
                location: coords
            });
        }
    });

    socket.on('admin_join', (code) => {
        const missionCode = code?.toUpperCase();
        if (missions[missionCode]) {
            socket.join(`${missionCode}-ADMIN`);
            console.log(`[ADMIN] Joined command channel for ${missionCode}`);

            // Send current state of all units in this mission
            const units = Object.entries(activeSessions)
                .filter(([_, s]) => s.code === missionCode)
                .map(([id, s]) => ({
                    id: id,
                    user: s.user,
                    location: s.location,
                    status: 'ONLINE'
                }));

            socket.emit('admin_init', {
                units,
                mission: missions[missionCode]
            });
        }
    });

    // ============================================
    // SUPER ADMIN LOGIC (New Panel)
    // ============================================

    socket.on('admin_get_missions', () => {
        // Return list of missions with active unit counts
        const missionList = Object.entries(missions).map(([code, data]) => {
            const activeUnits = Object.values(activeSessions).filter(s => s.code === code).length;
            return {
                code: code,
                ...data,
                units: activeUnits
            };
        });
        socket.emit('admin_mission_list', missionList);
    });

    socket.on('admin_create_mission', (data) => {
        // data: { client, name, code, active, channels }
        if (missions[data.code]) {
            socket.emit('mission_created', { success: false, message: 'Operation Code already exists' });
        } else {
            missions[data.code] = {
                name: data.name,
                client: data.client,
                channels: data.channels || [],
                active: true
            };
            saveData();
            console.log(`[ADMIN] Created new mission: ${data.code}`);
            socket.emit('mission_created', { success: true });

            // Broadcast update to all admins if needed
            // For now, simpler to just respond to creator
        }
    });

    // ============================================
    // LEGACY / P2P WEBRTC LOGIC
    // ============================================

    socket.on('join-room', (roomId) => {
        // Leave all previous rooms
        const currentRooms = Array.from(socket.rooms);
        currentRooms.forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
            }
        });

        socket.join(roomId);
        console.log(`Socket ${socket.id} joined room ${roomId}`);
        socket.to(roomId).emit('user-connected', socket.id);
    });

    socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
        console.log(`Socket ${socket.id} left room ${roomId}`);
    });

    // WebRTC Signaling
    socket.on('offer', (data) => {
        // data: { offer, target }
        socket.to(data.target).emit('offer', {
            offer: data.offer,
            caller: socket.id
        });
    });

    socket.on('answer', (data) => {
        // data: { answer, target }
        socket.to(data.target).emit('answer', {
            answer: data.answer,
            caller: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        // data: { candidate, target }
        socket.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            caller: socket.id
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        const session = activeSessions[socket.id];
        if (session) {
            // Notify Admin of offline status
            io.to(`${session.code}-ADMIN`).emit('unit_status', {
                id: socket.id,
                user: session.user,
                status: 'OFFLINE'
            });
            delete activeSessions[socket.id];
        }
    });
});

const { MercadoPagoConfig, Preference } = require('mercadopago');

// Add your Access Token here or as an environment variable
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-6317427424180639-013020-800419157ca61ee346a069cf70a3df50-1055557166'
});

app.post('/create_preference', async (req, res) => {
    try {
        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: [
                    {
                        title: 'Tolki - Aporte Voluntario',
                        quantity: 1,
                        unit_price: 10.00, // You can change this or make it dynamic
                        currency_id: 'ARS' // Change to your currency (USD, MXN, etc)
                    }
                ],
                back_urls: {
                    success: 'https://walkie-talkie-remote.onrender.com',
                    failure: 'https://walkie-talkie-remote.onrender.com',
                    pending: 'https://walkie-talkie-remote.onrender.com'
                },
                auto_return: 'approved',
            }
        });
        res.json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error('Error creating preference:', error);
        res.status(500).send('Error creating payment preference');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
