const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "http://localhost:3000", credentials: true }
});

const PORT = process.env.PORT || 3001;
const SECRET = 'supersecretkey';

// ---------------------------
// Middleware
// ---------------------------
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(cookieParser());
app.use(express.json());

// ---------------------------
// Upload setup
// ---------------------------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ts = Date.now();
        const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, `${ts}_${safe}`);
    }
});
const upload = multer({ storage });

// ---------------------------
// Simple DB
// ---------------------------
const DB_FILE = path.join(__dirname, 'data', 'tasks.json');
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
function readDB() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
function readUsers() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
function writeUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }


io.use((socket, next) => {
    try {
        const token = socket.handshake.auth?.token
            || (socket.handshake.headers.cookie || '')
                .split('; ')
                .find(c => c.startsWith('token='))
                ?.split('=')[1];

        if (!token) return next(new Error('Unauthorized'));

        const payload = jwt.verify(token, SECRET);
        socket.user = payload; // сохраняем пользователя в сокете
        next();
    } catch {
        next(new Error('Unauthorized'));
    }
});

// ---------------------------
// Socket.IO events
// ---------------------------
io.on('connection', socket => {
    console.log('Client connected', socket.user.username);

    socket.on('getTasks', (cb) => {
        const tasks = readDB().filter(t => t.owner === socket.user.username);
        cb({ tasks });
    });

    socket.on('createTask', ({ title, status, dueDate }, cb) => {
        const tasks = readDB();
        const task = {
            id: String(Date.now()) + Math.floor(Math.random() * 1000),
            title: title || 'Untitled',
            status: status || 'todo',
            dueDate: dueDate || null,
            owner: socket.user.username,
            attachments: []
        };
        tasks.push(task);
        writeDB(tasks);
        cb({ task });
        io.emit('taskCreated', task);
    });

    socket.on('updateTask', ({ id, data }, cb) => {
        const tasks = readDB();
        const idx = tasks.findIndex(t => t.id === id);
        if (idx === -1) return cb({ error: 'Task not found' });
        if (tasks[idx].owner !== socket.user.username) return cb({ error: 'Forbidden' });
        Object.assign(tasks[idx], data);
        writeDB(tasks);
        cb({ task: tasks[idx] });
        io.emit('taskUpdated', tasks[idx]);
    });

    socket.on('deleteTask', ({ id }, cb) => {
        const tasks = readDB();
        const idx = tasks.findIndex(t => t.id === id);
        if (idx === -1) return cb({ error: 'Task not found' });
        if (tasks[idx].owner !== socket.user.username) return cb({ error: 'Forbidden' });
        const removed = tasks.splice(idx, 1)[0];
        writeDB(tasks);
        cb({ deleted: removed.id });
        io.emit('taskDeleted', removed.id);
    });

    socket.on('disconnect', () => console.log('Client disconnected'));
});


app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username exists' });
    const hash = await bcrypt.hash(password, 10);
    users.push({ username, password: hash });
    writeUsers(users);
    const token = jwt.sign({ username }, SECRET, { expiresIn: '1h' });
    res.json({ token });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ username }, SECRET, { expiresIn: '1h' });
    res.json({ token });
});

// ---------------------------
// Static + start
// ---------------------------
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, '../client/build')));
app.use((req, res) => res.sendFile(path.join(__dirname, '../client/build/index.html')));

server.listen(PORT, () => console.log(`Socket.IO server on http://localhost:${PORT}`));
