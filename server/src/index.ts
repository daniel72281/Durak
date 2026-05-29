import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'durak-server' });
});

const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.emit('hello', { message: 'Welcome to Durak server', socketId: socket.id });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] CORS origin: ${CLIENT_ORIGIN}`);
});
