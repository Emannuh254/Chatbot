import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Kill port 3000 on startup
const killPort = () => {
    try {
        if (process.platform === 'win32') {
            execSync('powershell -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"', { stdio: 'ignore' });
        } else {
            execSync('lsof -ti:3000 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
        }
        console.log('✓ Port 3000 cleared');
    } catch (error) {
        console.log('✓ Port 3000 was already free');
    }
};

killPort();

// Database setup
const db = new sqlite3.Database('./data.db', (err) => {
    if (err) console.error('Database error:', err);
    else console.log('✓ Database connected');
});

// Create tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(chat_id) REFERENCES chats(id)
        )
    `);
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Auth middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'No token provided' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Routes

// Register
app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    db.run(
        'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
        [username, email, hashedPassword],
        function (err) {
            if (err) {
                return res.status(400).json({ error: 'User already exists' });
            }
            const token = jwt.sign({ id: this.lastID, username, email }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ token, user: { id: this.lastID, username, email } });
        }
    );
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err || !user) {
            return res.status(400).json({ error: 'User not found' });
        }

        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(400).json({ error: 'Invalid password' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    });
});

// Chat endpoint
app.post('/api/chat', authenticateToken, async (req, res) => {
    try {
        const { message, chatId } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        if (!OPENAI_API_KEY) {
            return res.status(500).json({ error: 'OpenAI API key not configured' });
        }

        // Get or create chat
        let currentChatId = chatId;
        if (!chatId) {
            db.run(
                'INSERT INTO chats (user_id, title) VALUES (?, ?)',
                [req.user.id, message.substring(0, 50)],
                function (err) {
                    if (err) console.error('Chat creation error:', err);
                    currentChatId = this.lastID;
                }
            );
        }

        // Save user message
        db.run(
            'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
            [currentChatId, 'user', message]
        );

        // Call OpenAI API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: message }],
                temperature: 0.7,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({ error: error.error.message });
        }

        const data = await response.json();
        const aiMessage = data.choices[0].message.content;

        // Save AI response
        db.run(
            'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
            [currentChatId, 'assistant', aiMessage]
        );

        res.json({ response: aiMessage, chatId: currentChatId });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Failed to process message', details: error.message });
    }
});

// Get user chats
app.get('/api/chats', authenticateToken, (req, res) => {
    db.all(
        'SELECT * FROM chats WHERE user_id = ? ORDER BY created_at DESC',
        [req.user.id],
        (err, chats) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json(chats);
        }
    );
});

// Get chat messages
app.get('/api/chats/:chatId', authenticateToken, (req, res) => {
    db.all(
        'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
        [req.params.chatId],
        (err, messages) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json(messages);
        }
    );
});

// Serve static files AFTER API routes
app.use(express.static(path.join(__dirname, '.')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║     🚀 NUEL AI Server Running 🚀      ║
║        Powered by Emmanuel            ║
╚══════════════════════════════════════╝
Port: ${PORT}
Database: Connected ✓
OpenAI API: ${OPENAI_API_KEY ? 'Connected ✓' : 'Not configured ⚠'}
URL: http://localhost:${PORT}
    `);
    setTimeout(() => {
        console.log('Opening browser...');
        if (process.platform === 'win32') {
            execSync(`start http://localhost:${PORT}`, { stdio: 'ignore' });
        } else if (process.platform === 'darwin') {
            execSync(`open http://localhost:${PORT}`, { stdio: 'ignore' });
        } else {
            execSync(`xdg-open http://localhost:${PORT}`, { stdio: 'ignore' });
        }
    }, 1000);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});