// ============================================
// NUEL AI - Backend Server
// Advanced Chat API by Emmanuel Mutugi
// ============================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import os from 'os';

// Load environment variables
dotenv.config();

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE SETUP
// ============================================

// Enable CORS
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from public directory
app.use(express.static(__dirname));

// ============================================
// INITIALIZE AI CLIENTS
// ============================================

// Initialize OpenAI/Groq client
let aiClient = null;

try {
    const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
    const baseURL = process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined;
    
    aiClient = new OpenAI({
        apiKey,
        baseURL,
    });
    
    console.log('✓ AI Client initialized successfully');
} catch (error) {
    console.warn('⚠ AI Client initialization warning:', error.message);
}

// ============================================
// FUNCTION TO KILL PORT PROCESS
// ============================================

function killPort(port) {
    return new Promise((resolve) => {
        let command;
        
        if (os.platform() === "win32") {
            // Windows: Use PowerShell
            command = `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"`;
        } else {
            // Linux/Mac: Use lsof and kill
            command = `lsof -ti:${port} | xargs kill -9 2>/dev/null || true`;
        }
        
        exec(command, { shell: os.platform() === "win32" ? "powershell" : "/bin/bash" }, (error) => {
            if (!error) {
                console.log(`✓ Cleared port ${port}`);
            }
            resolve();
        });
    });
}

// ============================================
// API ENDPOINTS
// ============================================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'NUEL AI',
        timestamp: new Date().toISOString(),
    });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        if (!aiClient) {
            return res.status(503).json({ 
                error: 'AI service is not configured',
                details: 'Please set GROQ_API_KEY or OPENAI_API_KEY in environment'
            });
        }

        // Call AI API
        const completion = await aiClient.chat.completions.create({
            messages: [{ role: 'user', content: message }],
            model: process.env.GROQ_API_KEY ? 'llama-3.1-8b-instant' : 'gpt-4o-mini',
            temperature: 0.7,
            max_tokens: 1024,
        });

        const reply = completion.choices[0]?.message?.content || 'No response generated';

        res.json({
            success: true,
            reply,
            model: process.env.GROQ_API_KEY ? 'Groq (Llama 3.1)' : 'OpenAI GPT-4',
        });

    } catch (error) {
        console.error('Chat Error:', error.message);
        res.status(500).json({
            error: 'Failed to process chat',
            details: error.message,
        });
    }
});

// Fallback route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        path: req.path,
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    });
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
    try {
        // Kill any existing process on the port
        await killPort(PORT);

        // Start listening
        app.listen(PORT, () => {
            console.log('\n');
            console.log('╔════════════════════════════════════════╗');
            console.log('║         🤖 NUEL AI SERVER 🤖          ║');
            console.log('╠════════════════════════════════════════╣');
            console.log(`║ Server running on port ${PORT.toString().padEnd(27)} ║`);
            console.log(`║ URL: http://localhost:${PORT}${' '.repeat(20 - PORT.toString().length)} ║`);
            console.log('║ Author: Emmanuel Mutugi               ║');
            console.log('║ Status: ✓ Online                      ║');
            console.log('╚════════════════════════════════════════╝');
            console.log('\n');
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n⚠ SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n⚠ SIGINT received, shutting down gracefully...');
    process.exit(0);
});

export default app;
