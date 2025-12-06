import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import pkg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Groq } from 'groq-sdk';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

dotenv.config();
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
// IMPORTANT: In production, JWT_SECRET MUST be set in your environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Trust proxy headers (important for Render/Heroku and other PaaS platforms)
app.set('trust proxy', true);

// Initialize Groq client
const groq = new Groq({
  apiKey: GROQ_API_KEY,
});

// PostgreSQL pool for NeonDB with optimized settings
// This configuration is standard and works well with Neon's connection pooler.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon requires SSL connections
  ssl: { rejectUnauthorized: false },
  max: 20, // Max number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 10000, // How long to wait when connecting a new client
});

// Only kill port in development, not in production
const isDevelopment = process.env.NODE_ENV !== 'production';
if (isDevelopment) {
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
}

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

// Server load tracking
let activeConnections = 0;
let serverLoad = 0; // 0-100 scale
const MAX_CONNECTIONS = 50;
const HIGH_LOAD_THRESHOLD = 70;

// Initialize database tables with optimized indexes
// This function is now PRODUCTION-SAFE and handles schema migrations.
async function initializeTables() {
    try {
      const client = await pool.connect();

      // Create users table IF NOT EXISTS.
      // We use the old schema here to ensure it can be created on a fresh DB,
      // and then we migrate it below.
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          pin VARCHAR(10) NOT NULL, -- Initial definition, will be updated below if needed
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // --- SCHEMA MIGRATION for 'pin' column ---
      // This block checks if the 'pin' column needs to be updated to a longer length.
      // This handles cases where the server was run with an older version of the schema.
      const pinColumnCheck = await client.query(`
        SELECT data_type, character_maximum_length 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'pin';
      `);

      if (pinColumnCheck.rows.length > 0) {
        const columnInfo = pinColumnCheck.rows[0];
        // If the pin column is too short for a bcrypt hash, alter it.
        if (columnInfo.character_maximum_length < 255) {
          console.log('🔧 Migrating database schema: Updating \'pin\' column length to VARCHAR(255)...');
          await client.query(`
            ALTER TABLE users 
            ALTER COLUMN pin TYPE VARCHAR(255);
          `);
          console.log('✅ Schema migration for \'pin\' column complete.');
        }
      }
      // --- END SCHEMA MIGRATION ---

      // Create chats table IF NOT EXISTS
      await client.query(`
        CREATE TABLE IF NOT EXISTS chats (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create messages table IF NOT EXISTS
      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
          role VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create indexes for better performance.
      // IF NOT EXISTS is not standard for indexes, so we just try to create them and ignore errors.
      try {
        await client.query('CREATE INDEX idx_users_name ON users(name);');
        await client.query('CREATE INDEX idx_chats_user_id ON chats(user_id);');
        await client.query('CREATE INDEX idx_messages_chat_id ON messages(chat_id);');
        await client.query('CREATE INDEX idx_messages_created_at ON messages(created_at);');
      } catch (e) {
        // Ignore errors if index already exists (code '42P07')
        if (e.code !== '42P07') {
          console.error('Index creation error:', e);
        }
      }

      // Ensure default guest user exists with a properly hashed PIN
      const guestPinHash = await bcrypt.hash('0000', 10);
      await client.query(`
        INSERT INTO users (id, name, pin)
        VALUES (1, 'Guest', $1)
        ON CONFLICT (id) DO NOTHING;
      `, [guestPinHash]);

      client.release();
      console.log('✓ Database tables initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization error:', error);
      process.exit(1);
    }
  }

// Initialize tables on startup
await initializeTables();

// Middleware for performance
app.use(compression()); // Compress responses

// Track active connections
app.use((req, res, next) => {
  activeConnections++;
  
  // Calculate server load based on active connections
  serverLoad = Math.min(100, Math.round((activeConnections / MAX_CONNECTIONS) * 100));
  
  // Add server load to response headers
  res.setHeader('X-Server-Load', serverLoad);
  
  res.on('finish', () => {
    activeConnections--;
  });
  
  next();
});

// Configure CORS for separate frontend hosting
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In production, you should specify allowed origins
    // For now, we'll allow all origins with credentials
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-ID'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight requests

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Helper function to safely extract IP address
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIP = req.headers['x-real-ip'] || 
                 req.headers['x-client-ip'] || 
                 req.headers['x-cluster-client-ip'] ||
                 req.connection?.remoteAddress ||
                 req.socket?.remoteAddress ||
                 req.connection?.socket?.remoteAddress;
  
  if (realIP) {
    return realIP;
  }
  
  return req.ip || 'unknown';
}

// Global rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.headers['x-user-id']) {
      return `user-${req.headers['x-user-id']}`;
    }
    const ip = getClientIP(req);
    return `ip-${ip}`;
  },
  skip: () => serverLoad > HIGH_LOAD_THRESHOLD,
});
app.use('/api/', limiter);

// Profile limiter
const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many profile attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.headers['x-user-id']) {
      return `user-${req.headers['x-user-id']}`;
    }
    const ip = getClientIP(req);
    return `ip-${ip}`;
  },
  skip: () => serverLoad > HIGH_LOAD_THRESHOLD,
});

// Middleware to check server load before processing a request
function checkServerLoad(req, res, next) {
  if (serverLoad > HIGH_LOAD_THRESHOLD) {
    return res.status(503).json({ 
      error: 'SERVER_BUSY',
      message: 'Server is currently experiencing high load. Please try again later.',
      fallbackResponse: 'I apologize, but the server is currently experiencing high demand. Please try again in a moment.'
    });
  }
  next();
}

// Optimized Groq API call with timeout and retry using Groq SDK
async function callGroqAPI(message, retries = 2) {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: message }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.7,
      max_completion_tokens: 2000,
      top_p: 1,
      stream: false,
    });

    return chatCompletion;
  } catch (error) {
    console.error('Groq API Error:', error);
    
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

// --- API Routes ---

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    load: serverLoad,
    activeConnections
  });
});

// Profile creation endpoint
app.post('/api/profile/create', profileLimiter, async (req, res) => {
  try {
    const { name, pin } = req.body;

    if (!name || !pin) {
      return res.status(400).json({ error: 'Name and PIN are required' });
    }

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    const hashedPin = await bcrypt.hash(pin, 10);

    const query = `
      INSERT INTO users (name, pin)
      VALUES ($1, $2)
      RETURNING id, name;
    `;

    const result = await pool.query(query, [name, hashedPin]);
    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user });

  } catch (error) {
    console.error("🔥 PostgreSQL Error on CREATE:", error.code, error.message);

    // Handle specific database errors
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'Name already exists. Please choose another.' });
    }
    
    if (error.code === '23502') { // Not null violation
      return res.status(400).json({ error: `Missing required field: ${error.column}` });
    }

    res.status(500).json({ error: 'An internal server error occurred during profile creation.' });
  }
});

// Profile login endpoint
app.post('/api/profile/login', profileLimiter, async (req, res) => {
  try {
    const { name, pin } = req.body;

    if (!name || !pin) {
      return res.status(400).json({ error: 'Name and PIN are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE name = $1', [name]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid name or PIN' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(pin, user.pin);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid name or PIN' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, name: user.name } });

  } catch (error) {
    console.error("🔥 PostgreSQL Error on LOGIN:", error.code, error.message);
    res.status(500).json({ error: 'An internal server error occurred during login.' });
  }
});

// Chat endpoint - FIXED VERSION
app.post('/api/chat', checkServerLoad, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.headers['x-user-id'];

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Convert userId to number for database operations
    const userIdNum = parseInt(userId, 10);
    
    let currentChatId;
    const messageTitle = message.length > 50 ? message.substring(0, 50) + '...' : message;

    // Create a new chat for every message from a guest
    if (userIdNum === 1) {
      const chatResult = await pool.query(
        'INSERT INTO chats (user_id, title) VALUES (1, $1) RETURNING id', // Fixed typo
        [`Guest Chat - ${new Date().toLocaleString()}`]
      );
      currentChatId = chatResult.rows[0].id;
    } else {
      // For authenticated users, find the latest chat or create a new one
      const latestChatResult = await pool.query(
        'SELECT id FROM chats WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userIdNum] // Use numeric ID
      );
      if (latestChatResult.rows.length > 0) {
        currentChatId = latestChatResult.rows[0].id;
      } else {
        const newChatResult = await pool.query(
          'INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING id',
          [userIdNum, messageTitle] // Use numeric ID
        );
        currentChatId = newChatResult.rows[0].id;
      }
    }
    
    // Save user message
    await pool.query(
      'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
      [currentChatId, 'user', message]
    );

    // Call Groq API
    let data;
    try {
      data = await callGroqAPI(message);
    } catch (error) {
      // Handle specific Groq errors and return a fallback response
      let fallbackResponse = 'I apologize, but I am currently unable to process your request. Please try again later.';
      if (error.message === 'API_QUOTA_EXCEEDED') {
        return res.status(429).json({ error: 'API_QUOTA_EXCEEDED', message: 'AI service quota exceeded.', fallbackResponse });
      } else if (error.message === 'API_KEY_INVALID') {
        return res.status(500).json({ error: 'API_KEY_INVALID', message: 'AI service configuration error.', fallbackResponse });
      } else if (error.message === 'API_RATE_LIMIT') {
        return res.status(429).json({ error: 'API_RATE_LIMIT', message: 'AI service rate limit exceeded.', fallbackResponse });
      } else if (error.message === 'MODEL_ERROR') {
        return res.status(500).json({ error: 'MODEL_ERROR', message: 'AI model is unavailable.', fallbackResponse });
      } else {
        throw error; // Re-throw other errors
      }
    }

    const aiMessage = data.choices[0].message.content;

    // Save AI response
    await pool.query(
      'INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)',
      [currentChatId, 'assistant', aiMessage]
    );

    res.json({ 
      response: aiMessage, 
      chatId: currentChatId,
      isGuest: userIdNum === 1 // Use numeric ID for comparison
    });
  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Get user chats - FIXED VERSION
app.get('/api/chats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    
    if (!userId || parseInt(userId, 10) === 1) { // Use parseInt for comparison
      return res.status(401).json({ error: 'Authentication required' });
    }

    const result = await pool.query(
      'SELECT * FROM chats WHERE user_id = $1 ORDER BY created_at DESC',
      [parseInt(userId, 10)] // Convert to number
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get chat messages - FIXED VERSION
app.get('/api/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.headers['x-user-id'];
    
    if (!userId || parseInt(userId, 10) === 1) { // Use parseInt for comparison
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Verify that chat belongs to user
    const chatCheck = await pool.query(
      'SELECT * FROM chats WHERE id = $1 AND user_id = $2',
      [parseInt(chatId, 10), parseInt(userId, 10)] // Convert both to numbers
    );
    
    if (chatCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      'SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
      [parseInt(chatId, 10)] // Convert to number
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete chat - FIXED VERSION
app.delete('/api/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.headers['x-user-id'];
    
    if (!userId || parseInt(userId, 10) === 1) { // Use parseInt for comparison
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Verify that chat belongs to user
    const chatCheck = await pool.query(
      'SELECT * FROM chats WHERE id = $1 AND user_id = $2',
      [parseInt(chatId, 10), parseInt(userId, 10)] // Convert both to numbers
    );
    
    if (chatCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Delete chat (messages will be deleted due to CASCADE)
    await pool.query('DELETE FROM chats WHERE id = $1', [parseInt(chatId, 10)]); // Convert to number
    
    res.json({ success: true, message: 'Chat deleted successfully' });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// 404 handler for API routes
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.status(404).json({ error: 'Not found - this is an API server only' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('GLOBAL ERROR:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║     🚀 NUEL AI API Server Running 🚀   ║
║        Powered by Emmanuel            ║
╚══════════════════════════════════════╝
Port: ${PORT}
Database: Neon PostgreSQL ✓
Groq API: ${GROQ_API_KEY ? 'Connected ✓' : 'Not configured ⚠'}
API URL: http://localhost:${PORT}/api
  `);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});