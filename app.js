class ChatApp {
    constructor() {
        // State management
        this.state = {
            user: JSON.parse(localStorage.getItem('user') || '{}'),
            currentChatId: null,
            isLoading: false,
            isTyping: false,
            theme: localStorage.getItem('theme') || 'dark',
            messages: [],
            settings: {
                autoSave: localStorage.getItem('autoSave') !== 'false',
                soundEnabled: localStorage.getItem('soundEnabled') === 'true',
                fontSize: localStorage.getItem('fontSize') || 'medium'
            }
        };

        // Cache DOM elements
        this.elements = {
            messageInput: null,
            sendBtn: null,
            profileBtn: null,
            messagesContainer: null,
            charCount: null,
            typingIndicator: null,
            profileModal: null,
            profileForm: null,
            toastContainer: null,
            settingsBtn: null,
            settingsModal: null,
            themeToggle: null,
            newChatBtn: null,
            chatHistory: null,
            sidebar: null,
            sidebarToggle: null
        };

        // Debounce timers
        this.timers = {
            typing: null,
            autoSave: null
        };

        this.init();
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.checkUserStatus();
        this.applyTheme();
        this.applyFontSize();
        this.initializeKeyboardShortcuts();
        
        // Make app globally available
        window.app = this;
    }

    cacheElements() {
        // Cache frequently accessed DOM elements
        this.elements.messageInput = document.getElementById('messageInput');
        this.elements.sendBtn = document.getElementById('sendBtn');
        this.elements.profileBtn = document.getElementById('profileBtn');
        this.elements.messagesContainer = document.getElementById('messagesContainer');
        this.elements.charCount = document.getElementById('charCount');
        this.elements.typingIndicator = document.getElementById('typingIndicator');
        this.elements.profileModal = document.getElementById('profileModal');
        this.elements.profileForm = document.getElementById('profileForm');
        this.elements.toastContainer = document.getElementById('toastContainer');
        this.elements.settingsBtn = document.getElementById('settingsBtn');
        this.elements.settingsModal = document.getElementById('settingsModal');
        this.elements.themeToggle = document.getElementById('themeToggle');
        this.elements.newChatBtn = document.getElementById('newChatBtn');
        this.elements.chatHistory = document.getElementById('chatHistory');
        this.elements.sidebar = document.getElementById('chatSidebar');
        this.elements.sidebarToggle = document.getElementById('sidebarToggle');
    }

    setupEventListeners() {
        // Message input events with debouncing
        if (this.elements.messageInput) {
            this.elements.messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            this.elements.messageInput.addEventListener('input', (e) => {
                this.updateCharCount(e.target.value.length);
                this.autoResizeTextarea(e.target);
                this.handleTypingIndicator();
            });

            this.elements.messageInput.addEventListener('focus', () => {
                this.elements.messageInput.parentElement.classList.add('focused');
            });

            this.elements.messageInput.addEventListener('blur', () => {
                this.elements.messageInput.parentElement.classList.remove('focused');
            });
        }

        // Button events
        if (this.elements.sendBtn) {
            this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        }

        if (this.elements.profileBtn) {
            this.elements.profileBtn.addEventListener('click', () => this.showProfileModal());
        }

        if (this.elements.newChatBtn) {
            this.elements.newChatBtn.addEventListener('click', () => this.startNewChat());
        }

        if (this.elements.sidebarToggle) {
            this.elements.sidebarToggle.addEventListener('click', () => this.toggleSidebar());
        }

        // Profile form submission
        if (this.elements.profileForm) {
            this.elements.profileForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createProfile();
            });
        }

        // Settings button
        if (this.elements.settingsBtn) {
            this.elements.settingsBtn.addEventListener('click', () => this.showSettingsModal());
        }

        // Theme toggle
        if (this.elements.themeToggle) {
            this.elements.themeToggle.addEventListener('change', () => this.toggleTheme());
        }

        // Font size change
        const fontSizeSelect = document.getElementById('fontSize');
        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', (e) => this.changeFontSize(e.target.value));
        }

        // Auto-save toggle
        const autoSaveToggle = document.getElementById('autoSave');
        if (autoSaveToggle) {
            autoSaveToggle.addEventListener('change', (e) => this.toggleAutoSave(e.target.checked));
        }

        // Sound effects toggle
        const soundToggle = document.getElementById('soundEnabled');
        if (soundToggle) {
            soundToggle.addEventListener('change', (e) => this.toggleSound(e.target.checked));
        }

        // Event delegation for dynamic content
        this.elements.messagesContainer.addEventListener('click', (e) => {
            // Handle copy button clicks
            if (e.target.classList.contains('copy-btn')) {
                this.copyMessage(e.target.dataset.messageId);
            }
            
            // Handle code block copy
            if (e.target.classList.contains('code-copy-btn')) {
                this.copyCode(e.target.parentElement.textContent);
            }
        });

        // Initialize quick prompt listeners
        this.attachQuickPromptListeners();

        // Initialize chat history listeners
        this.attachChatHistoryListeners();
    }

    initializeKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K for new chat
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.startNewChat();
            }
            
            // Ctrl/Cmd + / for focus input
            if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                e.preventDefault();
                this.elements.messageInput.focus();
            }
            
            // Escape to close modals
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });
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

    attachChatHistoryListeners() {
        const historyItems = document.querySelectorAll('.chat-history-item');
        historyItems.forEach((item) => {
            item.addEventListener('click', () => {
                const chatId = item.getAttribute('data-chat-id');
                this.loadChat(chatId);
            });
        });
    }

    updateCharCount(count) {
        if (this.elements.charCount) {
            this.elements.charCount.textContent = count;
            
            // Change color based on character count
            if (count > 4000) {
                this.elements.charCount.style.color = 'var(--error)';
            } else if (count > 3000) {
                this.elements.charCount.style.color = 'var(--warning)';
            } else {
                this.elements.charCount.style.color = 'var(--accent-blue)';
            }
        }
    }

    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }

    handleTypingIndicator() {
        // Clear existing timer
        if (this.timers.typing) {
            clearTimeout(this.timers.typing);
        }
        
        // Set user as typing
        if (!this.state.isTyping) {
            this.state.isTyping = true;
            // Here you could send a signal to the server that user is typing
        }
        
        // Set a timer to stop typing indicator after inactivity
        this.timers.typing = setTimeout(() => {
            this.state.isTyping = false;
            // Here you could send a signal to the server that user stopped typing
        }, 1000);
    }

    checkUserStatus() {
        const userStatus = document.getElementById('userStatus');
        const profileBtn = this.elements.profileBtn;

        if (this.state.user && this.state.user.id) {
            userStatus.textContent = this.state.user.name;
            profileBtn.textContent = 'Change Profile';
            
            // Load user's chat history
            this.loadChatHistory();
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

            this.state.user = data.user;
            localStorage.setItem('user', JSON.stringify(data.user));
            this.showToast('Profile created successfully! 🎉', 'success');
            this.closeProfileModal();
            this.checkUserStatus();
            
            // Clear form
            this.elements.profileForm.reset();
            
            // Load chat history for new user
            this.loadChatHistory();
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
        this.state.user = {};
        this.state.currentChatId = null;
        
        // Reset UI to welcome state
        this.resetToWelcomeState();
        this.showToast('Logged out successfully', 'success');
        this.checkUserStatus();
    }

    resetToWelcomeState() {
        this.elements.messagesContainer.innerHTML = `
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
        
        // Re-attach quick prompt listeners
        this.attachQuickPromptListeners();
    }

    async loadChatHistory() {
        if (!this.state.user || !this.state.user.id) return;
        
        try {
            const response = await fetch('/api/chats', {
                headers: {
                    'X-User-ID': this.state.user.id
                }
            });
            
            if (!response.ok) throw new Error('Failed to load chat history');
            
            const chats = await response.json();
            this.renderChatHistory(chats);
        } catch (error) {
            console.error('Error loading chat history:', error);
            this.showToast('Failed to load chat history', 'error');
        }
    }

    renderChatHistory(chats) {
        if (!this.elements.chatHistory) return;
        
        // Clear existing history
        this.elements.chatHistory.innerHTML = '';
        
        // Add current chat
        const currentChatItem = document.createElement('div');
        currentChatItem.className = 'chat-history-item active';
        currentChatItem.innerHTML = `
            <div class="chat-title">Current Chat</div>
            <div class="chat-date">Today</div>
        `;
        this.elements.chatHistory.appendChild(currentChatItem);
        
        // Add previous chats
        chats.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = 'chat-history-item';
            chatItem.setAttribute('data-chat-id', chat.id);
            chatItem.innerHTML = `
                <div class="chat-title">${chat.title}</div>
                <div class="chat-date">${this.formatDate(chat.created_at)}</div>
            `;
            this.elements.chatHistory.appendChild(chatItem);
        });
        
        // Re-attach event listeners
        this.attachChatHistoryListeners();
    }

    async loadChat(chatId) {
        if (!this.state.user || !this.state.user.id) return;
        
        try {
            const response = await fetch(`/api/chats/${chatId}`, {
                headers: {
                    'X-User-ID': this.state.user.id
                }
            });
            
            if (!response.ok) throw new Error('Failed to load chat');
            
            const messages = await response.json();
            this.state.currentChatId = chatId;
            this.renderMessages(messages);
            
            // Update active state in sidebar
            document.querySelectorAll('.chat-history-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(`[data-chat-id="${chatId}"]`).classList.add('active');
        } catch (error) {
            console.error('Error loading chat:', error);
            this.showToast('Failed to load chat', 'error');
        }
    }

    renderMessages(messages) {
        if (!this.elements.messagesContainer) return;
        
        // Clear existing messages
        this.elements.messagesContainer.innerHTML = '';
        
        // Render each message
        messages.forEach(message => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${message.role}-message`;
            messageDiv.setAttribute('data-message-id', message.id);
            
            const content = this.formatResponse(message.content);
            const timestamp = this.formatTimestamp(message.created_at);
            
            messageDiv.innerHTML = `
                <div class="message-content">${content}</div>
                <div class="message-meta">
                    <span class="message-time">${timestamp}</span>
                    <button class="copy-btn" data-message-id="${message.id}" title="Copy message">📋</button>
                </div>
            `;
            
            this.elements.messagesContainer.appendChild(messageDiv);
        });
        
        // Scroll to bottom
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
    }

    startNewChat() {
        this.state.currentChatId = null;
        this.resetToWelcomeState();
        
        // Update active state in sidebar
        document.querySelectorAll('.chat-history-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector('.chat-history-item').classList.add('active');
    }

    toggleSidebar() {
        if (this.elements.sidebar) {
            this.elements.sidebar.classList.toggle('collapsed');
        }
    }

    async sendMessage() {
        const message = this.elements.messageInput.value.trim();

        if (!message) {
            this.showToast('Message cannot be empty', 'warning');
            return;
        }

        if (this.state.isLoading) {
            return; // Prevent multiple simultaneous requests
        }

        this.state.isLoading = true;
        this.elements.sendBtn.disabled = true;
        this.elements.typingIndicator.style.display = 'flex';

        // Clear welcome message if present
        if (this.elements.messagesContainer.querySelector('.welcome-message')) {
            this.elements.messagesContainer.innerHTML = '';
        }

        // Add user message with animation
        const userMessageId = this.addMessage(message, 'user');
        
        // Clear input
        this.elements.messageInput.value = '';
        this.elements.messageInput.style.height = 'auto';
        this.updateCharCount(0);
        
        // Scroll to bottom
        this.scrollToBottom();

        try {
            // Prepare headers
            const headers = {
                'Content-Type': 'application/json'
            };

            // Add user ID if available
            if (this.state.user && this.state.user.id) {
                headers['X-User-ID'] = this.state.user.id;
            }

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ message })
            });

            if (!response.ok) {
                const error = await response.json();
                
                // Handle specific Groq errors
                if (error.error === 'API_QUOTA_EXCEEDED') {
                    this.showToast(error.message, 'error');
                    this.addMessage(error.fallbackResponse, 'assistant', true);
                    return;
                } else if (error.error === 'API_KEY_INVALID') {
                    this.showToast(error.message, 'error');
                    this.addMessage(error.fallbackResponse, 'assistant', true);
                    return;
                } else if (error.error === 'API_RATE_LIMIT') {
                    this.showToast(error.message, 'warning');
                    this.addMessage(error.fallbackResponse, 'assistant', true);
                    return;
                }
                
                throw new Error(error.error || 'Failed to get response');
            }

            const data = await response.json();
            
            // Add AI response with animation
            this.addMessage(data.response, 'assistant');
            
            // Update current chat ID if returned
            if (data.chatId) {
                this.state.currentChatId = data.chatId;
            }

            // Show appropriate message based on user status
            if (!this.state.user.id) {
                this.showToast('Create a profile to save your chat history!', 'info');
            }
            
            // Auto-save if enabled
            if (this.state.settings.autoSave && this.state.user.id) {
                this.autoSaveChat();
            }
        } catch (error) {
            this.showToast('Error: ' + error.message, 'error');
            console.error('Error:', error);
        } finally {
            this.state.isLoading = false;
            this.elements.sendBtn.disabled = false;
            this.elements.typingIndicator.style.display = 'none';
            this.elements.messageInput.focus();
        }
    }

    addMessage(content, role, isFallback = false) {
        const messageId = 'msg-' + Date.now();
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}-message ${isFallback ? 'fallback' : ''}`;
        messageDiv.setAttribute('data-message-id', messageId);
        
        const formattedContent = this.formatResponse(content);
        const timestamp = this.formatTimestamp(new Date());
        
        messageDiv.innerHTML = `
            <div class="message-content">${formattedContent}</div>
            <div class="message-meta">
                <span class="message-time">${timestamp}</span>
                <button class="copy-btn" data-message-id="${messageId}" title="Copy message">📋</button>
            </div>
        `;
        
        // Add with animation
        messageDiv.style.opacity = '0';
        messageDiv.style.transform = 'translateY(10px)';
        this.elements.messagesContainer.appendChild(messageDiv);
        
        // Trigger animation
        setTimeout(() => {
            messageDiv.style.transition = 'opacity 0.3s, transform 0.3s';
            messageDiv.style.opacity = '1';
            messageDiv.style.transform = 'translateY(0)';
        }, 10);
        
        // Scroll to bottom
        this.scrollToBottom();
        
        return messageId;
    }

    autoSaveChat() {
        // Clear existing timer
        if (this.timers.autoSave) {
            clearTimeout(this.timers.autoSave);
        }
        
        // Set new timer
        this.timers.autoSave = setTimeout(() => {
            // Save would be handled by server when messages are sent
            // This is just a placeholder for any client-side save operations
            console.log('Chat auto-saved');
        }, 2000);
    }

    scrollToBottom() {
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
    }

    async copyMessage(messageId) {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"] .message-content`);
        if (!messageElement) return;
        
        try {
            // Get plain text content
            const textContent = messageElement.textContent;
            
            // Copy to clipboard
            await navigator.clipboard.writeText(textContent);
            
            // Show success feedback
            this.showToast('Message copied to clipboard', 'success');
            
            // Visual feedback on button
            const copyBtn = document.querySelector(`[data-message-id="${messageId}"].copy-btn`);
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✓';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        } catch (error) {
            console.error('Failed to copy message:', error);
            this.showToast('Failed to copy message', 'error');
        }
    }

    async copyCode(code) {
        try {
            await navigator.clipboard.writeText(code);
            this.showToast('Code copied to clipboard', 'success');
        } catch (error) {
            console.error('Failed to copy code:', error);
            this.showToast('Failed to copy code', 'error');
        }
    }

    quickPrompt(prompt) {
        this.elements.messageInput.value = prompt;
        this.elements.messageInput.focus();
        this.autoResizeTextarea(this.elements.messageInput);
        this.updateCharCount(prompt.length);
    }

    formatResponse(text) {
        return text
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>')
            .replace(/```([\s\S]*?)```/g, '<pre><code class="code-block">$1</code><button class="code-copy-btn" title="Copy code">📋</button></pre>')
            .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    formatTimestamp(date) {
        const d = new Date(date);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    formatDate(date) {
        const d = new Date(date);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (d.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (d.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        } else {
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        
        // Add to container
        this.elements.toastContainer.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
        }, 10);
        
        // Remove after delay
        setTimeout(() => {
            toast.style.transform = 'translateX(400px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
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
        this.elements.profileModal.classList.remove('hidden');
        document.getElementById('profileName').focus();
    }

    closeProfileModal() {
        this.elements.profileModal.classList.add('hidden');
    }

    showSettingsModal() {
        this.elements.settingsModal.classList.remove('hidden');
    }

    closeSettingsModal() {
        this.elements.settingsModal.classList.add('hidden');
    }

    closeAllModals() {
        this.closeProfileModal();
        this.closeSettingsModal();
    }

    toggleTheme() {
        const isDark = this.elements.themeToggle.checked;
        this.state.theme = isDark ? 'dark' : 'light';
        localStorage.setItem('theme', this.state.theme);
        this.applyTheme();
    }

    applyTheme() {
        if (this.state.theme === 'dark') {
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
        } else {
            document.body.classList.add('light-theme');
            document.body.classList.remove('dark-theme');
        }
        
        // Update toggle state
        if (this.elements.themeToggle) {
            this.elements.themeToggle.checked = this.state.theme === 'dark';
        }
    }

    changeFontSize(size) {
        this.state.settings.fontSize = size;
        localStorage.setItem('fontSize', size);
        this.applyFontSize();
    }

    applyFontSize() {
        document.body.classList.remove('font-small', 'font-medium', 'font-large');
        document.body.classList.add(`font-${this.state.settings.fontSize}`);
        
        // Update select state
        const fontSizeSelect = document.getElementById('fontSize');
        if (fontSizeSelect) {
            fontSizeSelect.value = this.state.settings.fontSize;
        }
    }

    toggleAutoSave(enabled) {
        this.state.settings.autoSave = enabled;
        localStorage.setItem('autoSave', enabled.toString());
    }

    toggleSound(enabled) {
        this.state.settings.soundEnabled = enabled;
        localStorage.setItem('soundEnabled', enabled.toString());
    }

    playSound(type) {
        if (!this.state.settings.soundEnabled) return;
        
        // Create audio context for sound effects
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Different sounds for different types
        switch (type) {
            case 'send':
                oscillator.frequency.value = 800;
                gainNode.gain.value = 0.1;
                break;
            case 'receive':
                oscillator.frequency.value = 600;
                gainNode.gain.value = 0.1;
                break;
            case 'error':
                oscillator.frequency.value = 300;
                gainNode.gain.value = 0.1;
                break;
            default:
                oscillator.frequency.value = 500;
                gainNode.gain.value = 0.1;
        }
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", function() {
    // Initialize chat app
    const chatAppInstance = new ChatApp();
    
    // Service Worker registration for PWA capabilities
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            navigator.serviceWorker.register('/sw.js')
                .then(function(registration) {
                    console.log('ServiceWorker registration successful with scope: ', registration.scope);
                })
                .catch(function(error) {
                    console.log('ServiceWorker registration failed: ', error);
                });
        });
    }
    
    // Performance monitoring
    if ('performance' in window) {
        window.addEventListener('load', function() {
            setTimeout(function() {
                const perfData = window.performance.timing;
                const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
                console.log(`Page load time is ${pageLoadTime}ms`);
            }, 0);
        });
    }
});