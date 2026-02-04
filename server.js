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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
