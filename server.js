const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Base de datos temporal de misiones para que el cliente reciba un nombre
const missions = {
    'ALPHA1': 'ALPHA SQUAD',
    'BRAVO2': 'BRAVO TEAM',
    'HQ-TEST': 'COMMAND CENTER'
};

io.on('connection', (socket) => {
    console.log('>>> CONEXIÓN:', socket.id);

    socket.on('join_mission', (data) => {
        const room = data.code.toUpperCase();
        socket.join(room);

        const clients = Array.from(io.sockets.adapter.rooms.get(room) || []);
        const others = clients.filter(id => id !== socket.id);

        console.log(`[${room}] Unit ${socket.id} joined. Others: ${others.length}`);

        // ESTE ES EL MENSAJE QUE EL CLIENTE ESPERA PARA ENTRAR
        socket.emit('mission_joined', {
            success: true,
            mission: missions[room] || room,
            existingMembers: others
        });

        // Avisar a los demás
        socket.to(room).emit('new_operator', socket.id);
    });

    socket.on('signal', (data) => {
        if (data.to) {
            io.to(data.to).emit('signal', {
                from: socket.id,
                signal: data.signal
            });
        }
    });

    socket.on('disconnect', () => {
        io.emit('operator_left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SERVIDOR CORRECTO EN PUERTO ${PORT}`));
