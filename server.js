import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

const { Pool } = pkg;
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

// Database connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle client', err);
});

// Initialize database tables
async function initializeTables() {
    try {
        const client = await pool.connect();

        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create chats table
        await client.query(`
            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create messages table
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for better performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
            CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
        `);

        client.release();
        console.log('✓ Database tables initialized');
    } catch (error) {
        console.error('❌ Database initialization error:', error);
        process.exit(1);
    }
}

// Initialize tables on startup
await initializeTables();

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
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        const result = await pool.query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email',
            [username, email, hashedPassword]
        );

        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'User already exists' });
        }
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed', details: error.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed', details: error.message });
    }
});

// Chat endpoint
app.post('/api/chat', authenticateToken, async (req, res) => {
    try {
        const { message, chatId } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: 'Message required' });
        }

        if (!OPENAI_API_KEY) {
            return res.status(500).json({ error: 'OpenAI API key not configured' });
        }

        let currentChatId = chatId;

        // Create chat if needed
        if (!chatId) {
            const chatResult = await pool.query(
                'INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING id',
                [req.user.id, message.substring(0, 50) + '...']
            );
            currentChatId = chatResult.rows[0].id;
        }

        // Save user message
        await pool.query(
            'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
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
            console.error('OpenAI Error:', error);
            return res.status(response.status).json({ error: error.error?.message || 'OpenAI API error' });
        }

        const data = await response.json();
        const aiMessage = data.choices[0].message.content;

        // Save AI response
        await pool.query(
            'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
            [currentChatId, 'assistant', aiMessage]
        );

        res.json({ response: aiMessage, chatId: currentChatId });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Failed to process message', details: error.message });
    }
});

// Get user chats
app.get('/api/chats', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM chats WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({ error: 'Database error', details: error.message });
    }
});

// Get chat messages
app.get('/api/chats/:chatId', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
            [req.params.chatId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Database error', details: error.message });
    }
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
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║     🚀 NUEL AI Server Running 🚀      ║
║        Powered by Emmanuel            ║
╚══════════════════════════════════════╝
Port: ${PORT}
Database: Neon PostgreSQL ✓
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
    process.exit(1);
});