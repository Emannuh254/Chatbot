class ChatApp {
    constructor() {
        this.token = localStorage.getItem('token');
        this.currentChatId = null;
        this.isLoading = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuth();
    }

    setupEventListeners() {
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        document.getElementById('sendBtn').addEventListener('click', () => this.sendMessage());

        document.getElementById('messageInput').addEventListener('input', (e) => {
            document.getElementById('charCount').textContent = e.target.value.length;
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
        });

        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });

        document.getElementById('signupForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.signup();
        });
    }

    checkAuth() {
        if (this.token) {
            document.getElementById('loginBtn').style.display = 'none';
            document.getElementById('logoutBtn').style.display = 'inline-block';
            document.getElementById('authModal').classList.add('hidden');
            document.getElementById('messageInput').disabled = false;
        } else {
            document.getElementById('loginBtn').style.display = 'inline-block';
            document.getElementById('logoutBtn').style.display = 'none';
            document.getElementById('messageInput').disabled = true;
            this.showToast('Please login to use the chat', 'warning');
        }
    }

    async login() {
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (!response.ok) throw new Error('Login failed');

            const data = await response.json();
            this.token = data.token;
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            this.showToast('Login successful!', 'success');
            this.closeAuthModal();
            this.checkAuth();
        } catch (error) {
            this.showToast('Login failed: ' + error.message, 'error');
        }
    }

    async signup() {
        const username = document.getElementById('signupUsername').value;
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });

            if (!response.ok) throw new Error('Signup failed');

            const data = await response.json();
            this.token = data.token;
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            this.showToast('Signup successful!', 'success');
            this.closeAuthModal();
            this.checkAuth();
        } catch (error) {
            this.showToast('Signup failed: ' + error.message, 'error');
        }
    }

    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        this.token = null;
        this.currentChatId = null;
        document.getElementById('messagesContainer').innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon">🤖</div>
                <h2>Welcome to NUEL AI</h2>
                <p>I'm your advanced AI assistant. Ask me anything!</p>
                <div class="quick-prompts">
                    <button class="prompt-btn" onclick="app.quickPrompt('Write a Python script to decompile an APK file')">Decompile APK</button>
                    <button class="prompt-btn" onclick="app.quickPrompt('Explain advanced machine learning algorithms with examples')">ML Algorithms</button>
                    <button class="prompt-btn" onclick="app.quickPrompt('Create a blockchain implementation in JavaScript')">Blockchain Code</button>
                    <button class="prompt-btn" onclick="app.quickPrompt('Analyze this code for security vulnerabilities')">Code Analysis</button>
                </div>
            </div>
        `;
        this.showToast('Logged out successfully', 'success');
        this.checkAuth();
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();

        if (!message || this.isLoading || !this.token) return;

        this.isLoading = true;
        document.getElementById('sendBtn').disabled = true;
        document.getElementById('typingIndicator').style.display = 'flex';

        const container = document.getElementById('messagesContainer');
        if (container.querySelector('.welcome-message')) {
            container.innerHTML = '';
        }

        const userMessageDiv = document.createElement('div');
        userMessageDiv.className = 'message user-message';
        userMessageDiv.innerHTML = `<div class="message-content">${this.escapeHtml(message)}</div>`;
        container.appendChild(userMessageDiv);

        input.value = '';
        input.style.height = 'auto';
        document.getElementById('charCount').textContent = '0';

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ message, chatId: this.currentChatId })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to get response');
            }

            const data = await response.json();
            this.currentChatId = data.chatId;

            const aiMessageDiv = document.createElement('div');
            aiMessageDiv.className = 'message ai-message';
            aiMessageDiv.innerHTML = `<div class="message-content">${this.formatResponse(data.response)}</div>`;
            container.appendChild(aiMessageDiv);

            container.scrollTop = container.scrollHeight;
        } catch (error) {
            this.showToast('Error: ' + error.message, 'error');
            console.error('Error:', error);
        } finally {
            this.isLoading = false;
            document.getElementById('sendBtn').disabled = false;
            document.getElementById('typingIndicator').style.display = 'none';
            input.focus();
        }
    }

    quickPrompt(prompt) {
        if (!this.token) {
            this.showToast('Please login first', 'warning');
            this.showAuthModal();
            return;
        }
        document.getElementById('messageInput').value = prompt;
        this.sendMessage();
    }

    formatResponse(text) {
        return text
            .replace(/\n/g, '<br>')
            .replace(/```(.*?)```/gs, '<pre><code>$1</code></pre>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.getElementById('toastContainer').appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    showAuthModal() {
        document.getElementById('authModal').classList.remove('hidden');
    }
}

function closeAuthModal() {
    document.getElementById('authModal').classList.add('hidden');
}

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(tab + 'Form').classList.add('active');
}

function quickPrompt(prompt) {
    app.quickPrompt(prompt);
}

function logout() {
    app.logout();
}

const app = new ChatApp();