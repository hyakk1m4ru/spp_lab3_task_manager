const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { graphqlHTTP } = require('express-graphql');
const { buildSchema } = require('graphql');

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET = 'supersecretkey';

// ---------------------------
// Middleware
// ---------------------------
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());

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

// ---------------------------
// GraphQL schema
// ---------------------------
const schema = buildSchema(`
  type AuthPayload {
    token: String!
    username: String!
  }

  type Mutation {
    login(username: String!, password: String!): AuthPayload!
    register(username: String!, password: String!): AuthPayload!
    createTask(title: String!, status: String, dueDate: String): Task!
    updateTask(id: ID!, title: String, status: String, dueDate: String): Task!
    deleteTask(id: ID!): ID!
  }

  type Task {
    id: ID!
    title: String!
    status: String!
    dueDate: String
    owner: String!
  }

  type Query {
    tasks: [Task!]!
  }
`);


// ---------------------------
// Resolvers
// ---------------------------

const root = {
    tasks: (args, context) => {
        if (!context.user) throw new Error('Unauthorized');
        return readDB().filter(t => t.owner === context.user.username);
    },
    register: async ({ username, password }) => {
        const users = readUsers();
        if (users.find(u => u.username === username)) throw new Error('Username exists');
        const hash = await bcrypt.hash(password, 10);
        users.push({ username, password: hash });
        writeUsers(users);
        const token = jwt.sign({ username }, SECRET, { expiresIn: '1h' });
        return { token, username };
    },

    login: async ({ username, password }) => {
        const users = readUsers();
        const user = users.find(u => u.username === username);
        if (!user) throw new Error('Invalid credentials');
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) throw new Error('Invalid credentials');
        const token = jwt.sign({ username }, SECRET, { expiresIn: '1h' });
        return { token, username };
    },

    createTask: ({ title, status, dueDate }, context) => {
        if (!context.user) throw new Error('Unauthorized');
        const tasks = readDB();
        const task = {
            id: String(Date.now()) + Math.floor(Math.random() * 1000),
            title,
            status: status || 'todo',
            dueDate: dueDate || null,
            owner: context.user.username
        };
        tasks.push(task);
        writeDB(tasks);
        return task;
    },

    updateTask: ({ id, title, status, dueDate }, context) => {
        if (!context.user) throw new Error('Unauthorized');
        const tasks = readDB();
        const idx = tasks.findIndex(t => t.id === id);
        if (idx === -1) throw new Error('Task not found');
        if (tasks[idx].owner !== context.user.username) throw new Error('Forbidden');
        if (title !== undefined) tasks[idx].title = title;
        if (status !== undefined) tasks[idx].status = status;
        if (dueDate !== undefined) tasks[idx].dueDate = dueDate;
        writeDB(tasks);
        return tasks[idx];
    },

    deleteTask: ({ id }, context) => {
        if (!context.user) throw new Error('Unauthorized');
        const tasks = readDB();
        const idx = tasks.findIndex(t => t.id === id);
        if (idx === -1) throw new Error('Task not found');
        if (tasks[idx].owner !== context.user.username) throw new Error('Forbidden');
        const removed = tasks.splice(idx, 1)[0];
        writeDB(tasks);
        return removed.id;
    }
};

// ---------------------------
// GraphQL endpoint
// ---------------------------
app.use('/graphql', graphqlHTTP(req => {
    let user = null;
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        try { user = jwt.verify(authHeader.replace('Bearer ', ''), SECRET); } catch {}
    }
    return { schema, rootValue: root, context: { user }, graphiql: true };
}));

// ---------------------------
// Auth endpoints (регистрация/логин)
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
// Static files
// ---------------------------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
app.use('/uploads', express.static(UPLOAD_DIR));

app.use(express.static(path.join(__dirname, '../client/build')));
app.use((req, res) => res.sendFile(path.join(__dirname, '../client/build/index.html')));

// ---------------------------
app.listen(PORT, () => console.log(`GraphQL server running on http://localhost:${PORT}/graphql`));
