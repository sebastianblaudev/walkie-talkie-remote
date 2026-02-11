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

// RASTREO MANUAL DE SALAS
const rooms = {};

io.on('connection', (socket) => {
    console.log('>>> CONEXIÓN:', socket.id);

    socket.on('join_mission', (data) => {
        const roomName = data.code.toUpperCase();
        if (!rooms[roomName]) rooms[roomName] = [];

        // Evitar duplicados
        if (!rooms[roomName].includes(socket.id)) {
            rooms[roomName].push(socket.id);
        }

        socket.join(roomName);
        console.log(`[${roomName}] Unidades ahora: ${rooms[roomName].length}`);

        // Avisar al que entra quiénes están YA ahí (limpiamos su ID de la lista)
        const others = rooms[roomName].filter(id => id !== socket.id);
        socket.emit('mission_joined', {
            success: true,
            mission: roomName,
            existingMembers: others
        });

        // Avisar a los que ya estaban que hay alguien nuevo
        socket.to(roomName).emit('new_operator', socket.id);
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
        // Limpiar de todas las salas
        for (const room in rooms) {
            rooms[room] = rooms[room].filter(id => id !== socket.id);
            if (rooms[room].length === 0) delete rooms[room];
        }
        io.emit('operator_left', socket.id);
        console.log('<<< DESCONEXIÓN:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SERVIDOR REFORZADO EN PUERTO ${PORT}`));
