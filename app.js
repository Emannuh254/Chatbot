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
        // Make app globally available
        window.app = this;
    }

    setupEventListeners() {
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');

        if (messageInput) {
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            messageInput.addEventListener('input', (e) => {
                document.getElementById('charCount').textContent = e.target.value.length;
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
            });
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendMessage());
        }

        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.showAuthModal());
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }

        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.login();
            });
        }

        const signupForm = document.getElementById('signupForm');
        if (signupForm) {
            signupForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.signup();
            });
        }

        // Quick prompt buttons
        const promptBtns = document.querySelectorAll('.prompt-btn');
        const prompts = [
            'Write a Python script to decompile an APK file',
            'Explain advanced machine learning algorithms with examples',
            'Create a blockchain implementation in JavaScript',
            'Analyze this code for security vulnerabilities'
        ];

        promptBtns.forEach((btn, index) => {
            btn.addEventListener('click', () => {
                this.quickPrompt(prompts[index]);
            });
        });
    }

    checkAuth() {
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const messageInput = document.getElementById('messageInput');

        if (this.token) {
            loginBtn.style.display = 'none';
            logoutBtn.style.display = 'inline-block';
            document.getElementById('authModal').classList.add('hidden');
            if (messageInput) messageInput.disabled = false;
        } else {
            loginBtn.style.display = 'inline-block';
            logoutBtn.style.display = 'none';
            if (messageInput) messageInput.disabled = true;
        }
    }

    async login() {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value.trim();

        if (!email || !password) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.error);

            this.token = data.token;
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            this.showToast('Login successful! 🎉', 'success');
            this.closeAuthModal();
            this.checkAuth();
            
            // Clear forms
            document.getElementById('loginForm').reset();
            document.getElementById('signupForm').reset();
        } catch (error) {
            this.showToast('Login failed: ' + error.message, 'error');
        }
    }

    async signup() {
        const username = document.getElementById('signupUsername').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value.trim();

        if (!username || !email || !password) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }

        if (password.length < 6) {
            this.showToast('Password must be at least 6 characters', 'error');
            return;
        }

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.error);

            this.token = data.token;
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            this.showToast('Account created! Welcome to NUEL AI 🚀', 'success');
            this.closeAuthModal();
            this.checkAuth();
            
            // Clear forms
            document.getElementById('loginForm').reset();
            document.getElementById('signupForm').reset();
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
                    <button type="button" class="prompt-btn">Decompile APK</button>
                    <button type="button" class="prompt-btn">ML Algorithms</button>
                    <button type="button" class="prompt-btn">Blockchain Code</button>
                    <button type="button" class="prompt-btn">Code Analysis</button>
                </div>
            </div>
        `;
        this.showToast('Logged out successfully', 'success');
        this.checkAuth();
        // Re-attach quick prompt listeners
        this.attachQuickPromptListeners();
    }

    attachQuickPromptListeners() {
        const promptBtns = document.querySelectorAll('.prompt-btn');
        const prompts = [
            'Write a Python script to decompile an APK file',
            'Explain advanced machine learning algorithms with examples',
            'Create a blockchain implementation in JavaScript',
            'Analyze this code for security vulnerabilities'
        ];

        promptBtns.forEach((btn, index) => {
            btn.addEventListener('click', () => {
                this.quickPrompt(prompts[index]);
            });
        });
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();

        if (!message || this.isLoading || !this.token) {
            if (!this.token) this.showToast('Please login first', 'warning');
            return;
        }

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
        container.scrollTop = container.scrollHeight;

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
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
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
        setTimeout(() => toast.remove(), 4000);
    }

    showAuthModal() {
        document.getElementById('authModal').classList.remove('hidden');
    }

    closeAuthModal() {
        document.getElementById('authModal').classList.add('hidden');
    }
}

// Initialize app when DOM is ready
const app = new ChatApp();