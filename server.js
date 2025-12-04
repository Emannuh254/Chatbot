import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Groq } from 'groq-sdk';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

dotenv.config();
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize Groq client
const groq = new Groq({
  apiKey: GROQ_API_KEY,
});

// PostgreSQL pool for NeonDB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Optional: test connection on startup
pool.connect()
  .then(client => {
    console.log('✓ Connected to NeonDB');
    client.release();
  })
  .catch(err => {
    console.error('❌ NeonDB connection error:', err);
  });

// Kill port 3000 on startup
const killPort = () => {
    try {
        if (process.platform === 'win32') {
            execSync('powershell -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"', { stdio: 'ignore' });
        } else {
            execSync('lsof -ti:3000 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
        }
        console.log('✓ Port 3000 cleared');
    } catch (error) {
        console.log('✓ Port 3000 was already free');
    }
};

killPort();

pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle client', err);
});

// Initialize database tables with optimized indexes
async function initializeTables() {
    try {
        const client = await pool.connect();

        // Check if users table exists
        const tableExistsResult = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'users'
            );
        `);

        const usersTableExists = tableExistsResult.rows[0].exists;

        // If users table exists, drop it completely to avoid schema conflicts
        if (usersTableExists) {
            console.log('Users table exists, dropping and recreating...');
            await client.query('DROP TABLE users CASCADE');
        }

        // Create users table with name and pin (not email)
        await client.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                pin VARCHAR(10) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create chats table
        await client.query(`
            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create messages table
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
                role VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for better performance
        await client.query('CREATE INDEX IF NOT EXISTS idx_users_name ON users(name)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)');

        // Ensure default guest user exists
        await client.query(`
            INSERT INTO users (id, name, pin)
            VALUES (1, 'Guest', '0000')
            ON CONFLICT (id) DO NOTHING;
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

// Middleware for performance
app.use(compression()); // Compress responses
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : true, // Restrict in production
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Rate limiting to prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Specific rate limiting for profile endpoints
const profileLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 profile requests per windowMs
    message: { error: 'Too many profile attempts, please try again later' }
});

// Cache for frequently accessed data
const cache = {
    users: new Map(),
    chats: new Map(),
    messages: new Map()
};

// Optimized Groq API call with timeout and retry using the Groq SDK
async function callGroqAPI(message, retries = 2) {
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: message }],
            model: 'llama-3.1-8b-instant',
            temperature: 0.7,
            max_completion_tokens: 2000,
            top_p: 1,
            stream: false, // Set to false for non-streaming response
        });

        return chatCompletion;
    } catch (error) {
        console.error('Groq Error:', error);
        
        // Handle specific error types
        if (error.error?.code === 'insufficient_quota') {
            throw new Error('API_QUOTA_EXCEEDED');
        } else if (error.error?.code === 'invalid_api_key') {
            throw new Error('API_KEY_INVALID');
        } else if (error.error?.code === 'rate_limit_exceeded') {
            throw new Error('API_RATE_LIMIT');
        } else if (error.error?.code === 'model_decommissioned' || error.error?.type === 'invalid_request_error') {
            throw new Error('MODEL_ERROR');
        } else {
            throw new Error(error.error?.message || 'Groq API error');
        }
    }
}

// Routes

// Create profile with rate limiting
app.post('/api/profile/create', profileLimiter, async (req, res) => {
    try {
        const { name, pin } = req.body;

        if (!name || !pin) {
            return res.status(400).json({ error: 'Name and PIN required' });
        }

        if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
            return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
        }

        const hashedPin = bcrypt.hashSync(pin, 10);

        const result = await pool.query(
            'INSERT INTO users (name, pin) VALUES ($1, $2) RETURNING id, name',
            [name, hashedPin]
        );

        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Name already exists' });
        }
        console.error('Profile creation error:', error);
        res.status(500).json({ error: 'Profile creation failed' });
    }
});

// Login to existing profile
app.post('/api/profile/login', profileLimiter, async (req, res) => {
    try {
        const { name, pin } = req.body;

        if (!name || !pin) {
            return res.status(400).json({ error: 'Name and PIN required' });
        }

        const result = await pool.query('SELECT * FROM users WHERE name = $1', [name]);
        const user = result.rows[0];

        if (!user || !bcrypt.compareSync(pin, user.pin)) {
            return res.status(401).json({ error: 'Invalid name or PIN' });
        }

        const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, name: user.name } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Chat endpoint - works for both guests and authenticated users
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: 'Message required' });
        }

        if (!GROQ_API_KEY) {
            return res.status(500).json({ error: 'Groq API key not configured' });
        }

        // Get user ID from header if available
        let userId = 1; // Default to guest user
        const userIdHeader = req.headers['x-user-id'];
        if (userIdHeader) {
            userId = parseInt(userIdHeader);
        }

        let currentChatId = null;

        // Only save to database if not a guest user
        if (userId !== 1) {
            // Create chat if needed
            const chatResult = await pool.query(
                'INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING id',
                [userId, message.substring(0, 50) + '...']
            );
            currentChatId = chatResult.rows[0].id;

            // Save user message
            await pool.query(
                'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
                [currentChatId, 'user', message]
            );
        }

        // Call Groq API with retry logic
        let data;
        try {
            data = await callGroqAPI(message);
        } catch (error) {
            // Handle specific Groq errors
            if (error.message === 'API_QUOTA_EXCEEDED') {
                return res.status(429).json({ 
                    error: 'API_QUOTA_EXCEEDED',
                    message: 'Groq API quota exceeded. Please check your plan and billing details.',
                    fallbackResponse: 'I apologize, but I\'m currently experiencing high demand. Please try again later.'
                });
            } else if (error.message === 'API_KEY_INVALID') {
                return res.status(500).json({ 
                    error: 'API_KEY_INVALID',
                    message: 'Groq API key is invalid. Please check your configuration.',
                    fallbackResponse: 'I apologize, but there\'s a configuration issue with my AI capabilities. Please contact support.'
                });
            } else if (error.message === 'API_RATE_LIMIT') {
                return res.status(429).json({ 
                    error: 'API_RATE_LIMIT',
                    message: 'Groq API rate limit exceeded. Please try again later.',
                    fallbackResponse: 'I apologize, but I\'m currently experiencing high demand. Please try again in a moment.'
                });
            } else if (error.message === 'MODEL_ERROR') {
                return res.status(500).json({ 
                    error: 'MODEL_ERROR',
                    message: 'The AI model is currently unavailable. Please try again later.',
                    fallbackResponse: 'I apologize, but my AI model is currently being updated. Please try again later.'
                });
            } else {
                throw error; // Re-throw other errors
            }
        }

        const aiMessage = data.choices[0].message.content;

        // Only save AI response if not a guest user
        if (userId !== 1) {
            await pool.query(
                'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
                [currentChatId, 'assistant', aiMessage]
            );

            // Update cache
            cache.messages.delete(currentChatId);
        }

        // Return response with user status
        res.json({ 
            response: aiMessage, 
            chatId: userId !== 1 ? currentChatId : null,
            isGuest: userId === 1
        });
    } catch (error) {
        console.error('Chat error:', error);
        
        // Check if it's a Groq error we haven't handled yet
        if (error.message.includes('Groq')) {
            return res.status(500).json({ 
                error: 'Groq API error',
                message: 'Failed to communicate with Groq API. Please try again later.',
                fallbackResponse: 'I apologize, but I\'m having trouble connecting to my AI capabilities. Please try again later.'
            });
        }
        
        res.status(500).json({ error: 'Failed to process message' });
    }
});

// Get user chats with caching
app.get('/api/chats', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        
        if (!userId || userId === '1') {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const cacheKey = `chats_${userId}`;
        
        // Check cache first
        if (cache.chats.has(cacheKey)) {
            return res.json(cache.chats.get(cacheKey));
        }

        const result = await pool.query(
            'SELECT * FROM chats WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        
        // Cache for 2 minutes
        cache.chats.set(cacheKey, result.rows);
        setTimeout(() => cache.chats.delete(cacheKey), 2 * 60 * 1000);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get chat messages with caching
app.get('/api/chats/:chatId', async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.headers['x-user-id'];
        
        if (!userId || userId === '1') {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        // Verify that chat belongs to user
        const chatCheck = await pool.query(
            'SELECT * FROM chats WHERE id = $1 AND user_id = $2',
            [chatId, userId]
        );
        
        if (chatCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Check cache first
        if (cache.messages.has(chatId)) {
            return res.json(cache.messages.get(chatId));
        }

        const result = await pool.query(
            'SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
            [chatId]
        );
        
        // Cache for 5 minutes
        cache.messages.set(chatId, result.rows);
        setTimeout(() => cache.messages.delete(chatId), 5 * 60 * 1000);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete chat
app.delete('/api/chats/:chatId', async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.headers['x-user-id'];
        
        if (!userId || userId === '1') {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        // Verify that chat belongs to user
        const chatCheck = await pool.query(
            'SELECT * FROM chats WHERE id = $1 AND user_id = $2',
            [chatId, userId]
        );
        
        if (chatCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Delete chat (messages will be deleted due to CASCADE)
        await pool.query('DELETE FROM chats WHERE id = $1', [chatId]);
        
        // Update cache
        cache.chats.delete(`chats_${userId}`);
        cache.messages.delete(chatId);
        
        res.json({ success: true, message: 'Chat deleted successfully' });
    } catch (error) {
        console.error('Delete chat error:', error);
        res.status(500).json({ error: 'Failed to delete chat' });
    }
});

// Serve static files with caching headers
app.use(express.static(path.join(__dirname, '.'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0'
}));

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
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════╗
║     🚀 NUEL AI Server Running 🚀      ║
║        Powered by Emmanuel            ║
╚════════════════════════════════════╝
Port: ${PORT}
Database: Neon PostgreSQL ✓
Groq API: ${GROQ_API_KEY ? 'Connected ✓' : 'Not configured ⚠'}
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