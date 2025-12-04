class ChatApp {
    constructor() {
        this.user = JSON.parse(localStorage.getItem('user') || '{}');
        this.currentChatId = null;
        this.isLoading = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkUserStatus();
        // Make app globally available
        window.app = this;
    }

    setupEventListeners() {
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const profileBtn = document.getElementById('profileBtn');

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

        if (profileBtn) {
            profileBtn.addEventListener('click', () => this.showProfileModal());
        }

        const profileForm = document.getElementById('profileForm');
        if (profileForm) {
            profileForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createProfile();
            });
        }

        // Quick prompt buttons
        const promptBtns = document.querySelectorAll('.prompt-btn');
        promptBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const prompt = btn.getAttribute('data-prompt');
                this.quickPrompt(prompt);
            });
        });
    }

    checkUserStatus() {
        const userStatus = document.getElementById('userStatus');
        const profileBtn = document.getElementById('profileBtn');

        if (this.user && this.user.id) {
            userStatus.textContent = this.user.name;
            profileBtn.textContent = 'Change Profile';
        } else {
            userStatus.textContent = 'Guest';
            profileBtn.textContent = 'Create Profile';
        }
    }

    async createProfile() {
        const name = document.getElementById('profileName').value.trim();
        const pin = document.getElementById('profilePin').value.trim();

        if (!name || !pin) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }

        if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
            this.showToast('PIN must be exactly 4 digits', 'error');
            return;
        }

        try {
            this.showLoadingState(true);
            const response = await fetch('/api/profile/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, pin })
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.error);

            this.user = data.user;
            localStorage.setItem('user', JSON.stringify(data.user));
            this.showToast('Profile created successfully! 🎉', 'success');
            this.closeProfileModal();
            this.checkUserStatus();
            
            // Clear form
            document.getElementById('profileForm').reset();
        } catch (error) {
            this.showToast('Profile creation failed: ' + error.message, 'error');
        } finally {
            this.showLoadingState(false);
        }
    }

    continueAsGuest() {
        this.closeProfileModal();
        this.showToast('Continuing as guest. Create a profile to save your chat history!', 'info');
    }

    logout() {
        localStorage.removeItem('user');
        this.user = {};
        this.currentChatId = null;
        document.getElementById('messagesContainer').innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon">🤖</div>
                <h2>Welcome to NUEL AI</h2>
                <p>I'm your advanced AI assistant. Ask me anything!</p>
                <div class="quick-prompts">
                    <button type="button" class="prompt-btn" data-prompt="Write a Python script to decompile an APK file">Decompile APK</button>
                    <button type="button" class="prompt-btn" data-prompt="Explain advanced machine learning algorithms with examples">ML Algorithms</button>
                    <button type="button" class="prompt-btn" data-prompt="Create a blockchain implementation in JavaScript">Blockchain Code</button>
                    <button type="button" class="prompt-btn" data-prompt="Analyze this code for security vulnerabilities">Code Analysis</button>
                </div>
            </div>
        `;
        this.showToast('Logged out successfully', 'success');
        this.checkUserStatus();
        // Re-attach quick prompt listeners
        this.attachQuickPromptListeners();
    }

    attachQuickPromptListeners() {
        const promptBtns = document.querySelectorAll('.prompt-btn');
        promptBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const prompt = btn.getAttribute('data-prompt');
                this.quickPrompt(prompt);
            });
        });
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();

        if (!message) {
            this.showToast('Message cannot be empty', 'warning');
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
            // Prepare headers
            const headers = {
                'Content-Type': 'application/json'
            };

            // Add user ID if available
            if (this.user && this.user.id) {
                headers['X-User-ID'] = this.user.id;
            }

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ message })
            });

            if (!response.ok) {
                const error = await response.json();
                
                // Handle specific OpenAI errors
                if (error.error === 'API_QUOTA_EXCEEDED') {
                    this.showToast(error.message, 'error');
                    this.showFallbackResponse(error.fallbackResponse);
                    return;
                } else if (error.error === 'API_KEY_INVALID') {
                    this.showToast(error.message, 'error');
                    this.showFallbackResponse(error.fallbackResponse);
                    return;
                } else if (error.error === 'API_RATE_LIMIT') {
                    this.showToast(error.message, 'warning');
                    this.showFallbackResponse(error.fallbackResponse);
                    return;
                }
                
                throw new Error(error.error || 'Failed to get response');
            }

            const data = await response.json();
            const aiMessageDiv = document.createElement('div');
            aiMessageDiv.className = 'message ai-message';
            aiMessageDiv.innerHTML = `<div class="message-content">${this.formatResponse(data.response)}</div>`;
            container.appendChild(aiMessageDiv);

            container.scrollTop = container.scrollHeight;

            // Show appropriate message based on user status
            if (!this.user.id) {
                this.showToast('Create a profile to save your chat history!', 'info');
            }
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

    showFallbackResponse(message) {
        const container = document.getElementById('messagesContainer');
        const aiMessageDiv = document.createElement('div');
        aiMessageDiv.className = 'message ai-message';
        aiMessageDiv.innerHTML = `<div class="message-content">${this.formatResponse(message)}</div>`;
        container.appendChild(aiMessageDiv);
        container.scrollTop = container.scrollHeight;
    }

    quickPrompt(prompt) {
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

    showLoadingState(isLoading) {
        const profileButton = document.querySelector('.profile-button');
        if (profileButton) {
            if (isLoading) {
                profileButton.disabled = true;
                profileButton.textContent = 'Creating...';
            } else {
                profileButton.disabled = false;
                profileButton.textContent = 'Create Profile';
            }
        }
    }

    showProfileModal() {
        document.getElementById('profileModal').classList.remove('hidden');
    }

    closeProfileModal() {
        document.getElementById('profileModal').classList.add('hidden');
    }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", function() {
    // Initialize the chat app
    const chatAppInstance = new ChatApp();
    
    // Lazy loading for images
    const lazyImages = document.querySelectorAll('img.lazy');

    const lazyLoad = (image) => {
        image.src = image.dataset.src;
        image.classList.remove('lazy');
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                lazyLoad(entry.target);
                observer.unobserve(entry.target);
            }
        });
    });

    lazyImages.forEach(image => {
        observer.observe(image);
    });
});