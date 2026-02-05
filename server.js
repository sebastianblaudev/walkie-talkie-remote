const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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
const rooms = {};

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

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
        // Could notify room about disconnection if needed
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
