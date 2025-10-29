const express = require('express');
const cors = require('cors');
const multer  = require('multer');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET = 'supersecretkey'; // секрет для JWT




// ---------------------------
// Middleware
// ---------------------------
app.use(cors({
    origin: 'http://localhost:3000', // React Dev Server
    credentials: true
}));
app.use(bodyParser.json());
app.use(cookieParser());

// простое логирование запросов
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
        console.log('Body:', req.body);
    }
    next();
});

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

function readDB() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch { return []; }
}
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// Users DB (in-memory for demo)
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
function readUsers() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
function writeUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }

// ---------------------------
// Auth middleware
// ---------------------------
app.use((req, res, next) => {
    console.log('Cookies on request:', req.cookies);
    next();
});
function authMiddleware(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ---------------------------
// Routes
// ---------------------------

// Auth
app.post('/api/register', async(req, res) => {
    const {username, password} = req.body;
    console.log(username, " ", password);
    if(!username || !password )return res.status(400).json({error: 'Username and pwd required'})
    const users = readUsers();
    if(users.find(u => u.username === username)) return res.status(400).json( {error:'Username already exists'});
    const hash = await bcrypt.hash(password, 10);
    users.push({username, password: hash});
    writeUsers(users);
    const token = jwt.sign({username}, SECRET, {expiresIn: '1h'});
    res.cookie('token', token, {httpOnly: true, sameSite: 'strict', maxAge: 60*60*1000});
    res.status(201).json({message: 'register success'});
})
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);

    if (!valid){
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, SECRET, { expiresIn: '1h' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'strict', maxAge: 60*60*1000 });
    res.json({ message: 'Logged in' });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out' });
});

// Tasks API
app.get('/api/tasks', authMiddleware, (req, res) => {
    const status = req.query.status;
    let tasks = readDB();

    // 👇 фильтруем задачи только для текущего пользователя
    tasks = tasks.filter(t => t.owner === req.user.username);

    if (status) tasks = tasks.filter(t => t.status === status);
    res.json(tasks);
});


app.get('/api/tasks/:id', authMiddleware, (req, res) => {
    const task = readDB().find(t => t.id === req.params.id);

    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.owner !== req.user.username) return res.status(403).json({ error: 'Forbidden' }); // 👈 проверка

    res.json(task);
});
app.post('/api/tasks', authMiddleware, upload.array('attachments', 5), (req, res) => {
    const tasks = readDB();
    const { title = 'Untitled', status = 'todo', dueDate = null } = req.body;
    const id = String(Date.now()) + Math.floor(Math.random()*1000);

    const attachments = (req.files || []).map(f => ({
        filename: f.filename,
        originalname: f.originalname,
        url: `/uploads/${f.filename}`
    }));

    const task = {
        id,
        title,
        status,
        dueDate,
        attachments,
        owner: req.user.username // 👈 добавляем владельца
    };

    tasks.push(task);
    writeDB(tasks);
    res.status(201).json(task);
});

app.put('/api/tasks/:id', authMiddleware, (req, res) => {
    const tasks = readDB();
    const idx = tasks.findIndex(t => t.id === req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    if (tasks[idx].owner !== req.user.username) return res.status(403).json({ error: 'Forbidden' }); // 👈

    ['title','status','dueDate'].forEach(k => {
        if (req.body[k] !== undefined) tasks[idx][k] = req.body[k];
    });

    writeDB(tasks);
    res.json(tasks[idx]);
});


app.post('/api/tasks/:id/attachments', authMiddleware, upload.array('attachments', 5), (req, res) => {
    const id = req.params.id;
    const tasks = readDB();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Task not found' });

    const attachments = (req.files || []).map(f => ({
        filename: f.filename,
        originalname: f.originalname,
        url: `/uploads/${f.filename}`
    }));
    tasks[idx].attachments = (tasks[idx].attachments || []).concat(attachments);
    writeDB(tasks);
    res.json(tasks[idx]);
});

app.delete('/api/tasks/:id', authMiddleware, (req, res) => {
    const tasks = readDB();
    const idx = tasks.findIndex(t => t.id === req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'Task not found' });
    if (tasks[idx].owner !== req.user.username) return res.status(403).json({ error: 'Forbidden' }); // 👈

    const removed = tasks.splice(idx, 1)[0];
    writeDB(tasks);
    res.json({ deleted: removed.id });
});
app.get('/api/me', authMiddleware, (req, res) => {
    res.json({ username: req.user.username });
});


// Serve uploads
app.use('/uploads', express.static(UPLOAD_DIR));

// SPA fallback
app.use(express.static(path.join(__dirname, '../client/build')));
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

// ---------------------------
// Start server
// ---------------------------
app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
if(!fs.existsSync(USERS_FILE)) writeUsers([]);