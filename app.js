// ============================================
// NUEL AI - Client Application
// Advanced Chat Interface by Emmanuel Mutugi
// ============================================

class ChatApp {
    constructor() {
        this.messagesContainer = document.getElementById('messagesContainer');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.typingIndicator = document.getElementById('typingIndicator');
        this.charCount = document.getElementById('charCount');
        
        this.messages = [];
        this.isLoading = false;
        this.maxCharacters = 5000;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.adjustTextareaHeight();
        this.loadChatHistory();
    }

    setupEventListeners() {
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.messageInput.addEventListener('input', () => {
            this.adjustTextareaHeight();
            this.updateCharCount();
        });

        this.messageInput.addEventListener('focus', () => {
            this.messageInput.style.borderColor = 'var(--primary-color)';
        });

        this.messageInput.addEventListener('blur', () => {
            this.messageInput.style.borderColor = 'var(--border-color)';
        });
    }

    adjustTextareaHeight() {
        this.messageInput.style.height = 'auto';
        this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 150) + 'px';
    }

    updateCharCount() {
        const count = this.messageInput.value.length;
        this.charCount.textContent = count;
        
        if (count >= this.maxCharacters) {
            this.showToast('Character limit reached!', 'warning');
            this.messageInput.value = this.messageInput.value.substring(0, this.maxCharacters);
            this.charCount.textContent = this.maxCharacters;
        }
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();

        if (!message) {
            this.showToast('Please type a message', 'warning');
            return;
        }

        if (this.isLoading) {
            return;
        }

        // Add user message to UI
        this.addMessage(message, 'user');
        this.messageInput.value = '';
        this.adjustTextareaHeight();
        this.charCount.textContent = '0';

        // Show typing indicator
        this.isLoading = true;
        this.sendBtn.disabled = true;
        this.typingIndicator.style.display = 'flex';

        try {
            // Send to backend
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.reply) {
                this.addMessage(data.reply, 'assistant');
            } else if (data.error) {
                this.showToast(`Error: ${data.error}`, 'error');
                this.addMessage(`Error: ${data.error}`, 'assistant');
            }
        } catch (error) {
            console.error('Error:', error);
            this.showToast('Failed to send message. Please try again.', 'error');
            this.addMessage('Sorry, I encountered an error. Please try again later.', 'assistant');
        } finally {
            this.isLoading = false;
            this.sendBtn.disabled = false;
            this.typingIndicator.style.display = 'none';
            this.messageInput.focus();
        }
    }

    addMessage(text, sender) {
        // Remove welcome message on first message
        if (this.messages.length === 0) {
            this.messagesContainer.innerHTML = '';
        }

        const messageObj = {
            text,
            sender,
            timestamp: new Date(),
        };

        this.messages.push(messageObj);
        this.renderMessage(messageObj);
        this.saveChatHistory();
        this.scrollToBottom();
    }

    renderMessage(messageObj) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${messageObj.sender}`;
        
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.textContent = messageObj.sender === 'user' ? '👤' : '🤖';

        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        contentEl.textContent = messageObj.text;

        messageEl.appendChild(avatarEl);
        messageEl.appendChild(contentEl);

        this.messagesContainer.appendChild(messageEl);
    }

    scrollToBottom() {
        setTimeout(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }, 0);
    }

    showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideInRight 0.3s ease-out reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    saveChatHistory() {
        try {
            localStorage.setItem('chatHistory', JSON.stringify(this.messages));
        } catch (error) {
            console.error('Failed to save chat history:', error);
        }
    }

    loadChatHistory() {
        try {
            const saved = localStorage.getItem('chatHistory');
            if (saved) {
                this.messages = JSON.parse(saved);
                if (this.messages.length > 0) {
                    this.messagesContainer.innerHTML = '';
                    this.messages.forEach(msg => this.renderMessage(msg));
                    this.scrollToBottom();
                }
            }
        } catch (error) {
            console.error('Failed to load chat history:', error);
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});

// Quick prompt helper
function quickPrompt(text) {
    const input = document.getElementById('messageInput');
    input.value = text;
    input.focus();
    
    // Auto-send after a brief delay
    setTimeout(() => {
        document.getElementById('sendBtn').click();
    }, 100);
}
