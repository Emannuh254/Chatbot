// Configuration - Update this with your API URL
const API_URL = 'https://chatbot-e0ti.onrender.com';

// App state
let currentUser = null;
let currentChatId = null;
let isGuest = true;
let isTyping = false;
let serverStatus = 'connected'; // connected, busy, error
let serverWakeUpAttempts = 0;
const MAX_WAKE_UP_ATTEMPTS = 5;
let isScrolledToBottom = true;
let keyboardHeight = 0;
let initialViewportHeight = window.innerHeight;

// DOM elements
const loadingScreen = document.getElementById('loadingScreen');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesContainer = document.getElementById('messages');
const newChatButton = document.getElementById('newChatButton');
const chatHistoryContainer = document.getElementById('chatHistory');
const profileContent = document.getElementById('profileContent');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const serverBusyIndicator = document.getElementById('serverBusyIndicator');
const chatTitle = document.getElementById('chatTitle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const menuToggle = document.getElementById('menuToggle');
const deleteChatModal = document.getElementById('deleteChatModal');
const closeDeleteModal = document.getElementById('closeDeleteModal');
const cancelDelete = document.getElementById('cancelDelete');
const confirmDelete = document.getElementById('confirmDelete');
const scrollToBottom = document.getElementById('scrollToBottom');
const inputContainer = document.getElementById('inputContainer');

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Simulate loading time for dramatic effect
    setTimeout(() => {
        loadingScreen.classList.add('hidden');
        initializeApp();
    }, 2000);
});

// Initialize the main app
function initializeApp() {
    checkUserProfile();
    loadChatHistory();
    setupEventListeners();
    checkServerStatus();
    
    // Check server status every 30 seconds
    setInterval(checkServerStatus, 30000);
    
    // Setup scroll detection
    setupScrollDetection();
    
    // Setup mobile keyboard handling
    setupMobileKeyboardHandling();
    
    // Setup touch optimizations
    setupTouchOptimizations();
}

// ===============================
// MOBILE & TOUCH OPTIMIZATIONS
// ===============================

// Prevent iOS bounce + improve scroll control
function setupTouchOptimizations() {
    // Stop body bounce scroll except inside message area
    document.body.addEventListener(
        "touchmove",
        (e) => {
            if (messagesContainer.contains(e.target)) return;
            e.preventDefault();
        },
        { passive: false }
    );

    // Prevent iOS zoom on input double-tap
    messageInput.addEventListener(
        "touchstart",
        (e) => {
            if (e.touches.length > 1) e.preventDefault();
        },
        { passive: false }
    );

    // Fast-tap feedback for buttons
    document.querySelectorAll("button").forEach((button) => {
        button.addEventListener(
            "touchstart",
            () => (button.style.transform = "scale(0.92)"),
            { passive: true }
        );

        button.addEventListener(
            "touchend",
            () => (button.style.transform = ""),
            { passive: true }
        );
    });
}

// ===============================
// MOBILE KEYBOARD FIXES
// ===============================

function setupMobileKeyboardHandling() {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) return;

    // Handle focus
    messageInput.addEventListener("focus", () => {
        // Delay ensures keyboard fully opens before adjusting
        setTimeout(() => {
            scrollToBottomSmoothly();
        }, 300); // Increased delay for reliability
    });
}

// ===============================
// SMART SCROLL HANDLING
// ===============================

function scrollToBottomSmoothly() {
    messagesContainer.scrollTo({
        top: messagesContainer.scrollHeight,
        behavior: "smooth",
    });

    isScrolledToBottom = true;
    scrollToBottom.classList.remove("visible");
}

function setupScrollDetection() {
    messagesContainer.addEventListener("scroll", () => {
        const bottomGap =
            messagesContainer.scrollHeight -
            messagesContainer.scrollTop -
            messagesContainer.clientHeight;

        isScrolledToBottom = bottomGap < 120;

        if (isScrolledToBottom) {
            scrollToBottom.classList.remove("visible");
        } else {
            scrollToBottom.classList.add("visible");
        }
    });
}

// ===============================
// GENERAL EVENT LISTENERS
// ===============================

function setupEventListeners() {
    // Send button
    sendButton.addEventListener("click", sendMessage);

    // Enter to send
    messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    messageInput.addEventListener("input", () => {
        messageInput.style.height = "auto";
        messageInput.style.height =
            Math.min(messageInput.scrollHeight, 120) + "px";

        sendButton.disabled = !messageInput.value.trim() || isTyping;

        if (messageInput.value.trim()) {
            inputContainer.classList.add("focus-within");
        } else {
            inputContainer.classList.remove("focus-within");
        }
    });

    messageInput.addEventListener("focus", () =>
        inputContainer.classList.add("focus-within")
    );

    messageInput.addEventListener("blur", () => {
        if (!messageInput.value.trim()) {
            inputContainer.classList.remove("focus-within");
        }
    });

    // NEW chat
    newChatButton.addEventListener("click", startNewChat);

    // Sidebar toggle
    menuToggle.addEventListener("click", () => {
        sidebar.classList.toggle("active");
        sidebarOverlay.classList.toggle("active");
    });

    sidebarOverlay.addEventListener("click", () => {
        sidebar.classList.remove("active");
        sidebarOverlay.classList.remove("active");
    });

    // Delete modal buttons
    closeDeleteModal.addEventListener("click", () =>
        deleteChatModal.classList.remove("active")
    );

    cancelDelete.addEventListener("click", () =>
        deleteChatModal.classList.remove("active")
    );

    confirmDelete.addEventListener("click", () => {
        deleteChat(currentChatId);
        deleteChatModal.classList.remove("active");
    });

    // Scroll to bottom button
    scrollToBottom.addEventListener("click", scrollToBottomSmoothly);
}

// Check server status with wake-up functionality
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/api/health`, {
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Reset wake-up attempts on successful connection
            serverWakeUpAttempts = 0;
            
            // Update status based on server load
            if (data.status === 'OK') {
                if (data.load > 70) {
                    updateServerStatus('busy');
                } else {
                    updateServerStatus('connected');
                }
            } else {
                updateServerStatus('error');
            }
        } else {
            updateServerStatus('error');
        }
    } catch (error) {
        console.error('Server status check failed:', error);
        
        // Handle server wake-up
        if (error.name === 'AbortError' || error.message.includes('fetch')) {
            serverWakeUpAttempts++;
            
            if (serverWakeUpAttempts <= MAX_WAKE_UP_ATTEMPTS) {
                updateServerStatus('waking');
                showNotification(`Server is waking up... Attempt ${serverWakeUpAttempts}/${MAX_WAKE_UP_ATTEMPTS}`, 'warning');
                
                // Exponential backoff for retries
                const delay = Math.min(1000 * Math.pow(2, serverWakeUpAttempts - 1), 10000);
                setTimeout(checkServerStatus, delay);
            } else {
                updateServerStatus('error');
                showNotification('Server appears to be offline. Please try again later.', 'error');
            }
        } else {
            updateServerStatus('error');
        }
    }
}

// Update server status UI
function updateServerStatus(status) {
    serverStatus = status;
    
    switch (status) {
        case 'connected':
            statusDot.className = 'status-dot';
            statusText.textContent = 'Connected';
            serverBusyIndicator.classList.remove('active');
            break;
        case 'busy':
            statusDot.className = 'status-dot busy';
            statusText.textContent = 'High Load';
            serverBusyIndicator.classList.add('active');
            break;
        case 'waking':
            statusDot.className = 'status-dot busy';
            statusText.textContent = 'Waking Up';
            serverBusyIndicator.classList.remove('active');
            break;
        case 'error':
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Offline';
            serverBusyIndicator.classList.remove('active');
            showNotification('Connection to Matrix lost. Attempting to reconnect...', 'error');
            break;
    }
}

// Check user profile
function checkUserProfile() {
    // Try to get user profile from localStorage
    const savedUser = localStorage.getItem('userProfile');
    
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            isGuest = currentUser.id === 1;
            updateProfileUI();
        } catch (e) {
            console.error('Error parsing saved user profile:', e);
            localStorage.removeItem('userProfile');
            showLoginForm();
        }
    } else {
        showLoginForm();
    }
}

// Show login form
function showLoginForm() {
    profileContent.innerHTML = `
        <div class="login-form">
            <h3 class="glitch">ACCESS REQUIRED</h3>
            <div class="form-group">
                <label for="nameInput">User ID</label>
                <input type="text" id="nameInput" placeholder="Enter identifier">
            </div>
            <div class="form-group">
                <label for="pinInput">Security Code</label>
                <input type="password" id="pinInput" placeholder="4-digit code">
            </div>
            <div class="form-buttons">
                <button class="form-button primary-button touch-target" id="loginButton">Access System</button>
                <button class="form-button secondary-button touch-target" id="createButton">Register</button>
                <button class="form-button guest-button touch-target" id="guestButton">Guest Access</button>
            </div>
        </div>
    `;
    
    document.getElementById('loginButton').addEventListener('click', login);
    document.getElementById('createButton').addEventListener('click', createProfile);
    document.getElementById('guestButton').addEventListener('click', continueAsGuest);
}

// Continue as guest
function continueAsGuest() {
    currentUser = { id: 1, name: 'Guest' };
    isGuest = true;
    updateProfileUI();
    localStorage.setItem('userProfile', JSON.stringify(currentUser));
    showNotification('Guest access granted. Limited functionality enabled.', 'warning');
}

// Login
async function login() {
    const name = document.getElementById('nameInput').value.trim();
    const pin = document.getElementById('pinInput').value.trim();
    
    if (!name || !pin) {
        showNotification('User ID and Security Code required', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/profile/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, pin })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentUser = data.user;
            isGuest = false;
            updateProfileUI();
            localStorage.setItem('userProfile', JSON.stringify(currentUser));
            loadChatHistory();
            showNotification('Access granted. Welcome to the Matrix.', 'success');
        } else {
            showNotification(data.error || 'Access denied', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showNotification('System error. Please try again.', 'error');
    }
}

// Create profile
async function createProfile() {
    const name = document.getElementById('nameInput').value.trim();
    const pin = document.getElementById('pinInput').value.trim();
    
    if (!name || !pin) {
        showNotification('User ID and Security Code required', 'error');
        return;
    }
    
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        showNotification('Security Code must be exactly 4 digits', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/profile/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, pin })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentUser = data.user;
            isGuest = false;
            updateProfileUI();
            localStorage.setItem('userProfile', JSON.stringify(currentUser));
            loadChatHistory();
            showNotification('Registration complete. Welcome to the Matrix.', 'success');
        } else {
            showNotification(data.error || 'Registration failed', 'error');
        }
    } catch (error) {
        console.error('Profile creation error:', error);
        showNotification('System error. Please try again.', 'error');
    }
}

// Update profile UI
function updateProfileUI() {
    if (currentUser) {
        const initials = currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        
        profileContent.innerHTML = `
            <div class="profile-header">
                <div class="avatar">${initials}</div>
                <div class="user-info">
                    <h3>${currentUser.name}</h3>
                    <p>${isGuest ? 'Guest User' : 'Authenticated'}</p>
                </div>
            </div>
            <button class="form-button secondary-button touch-target" id="logoutButton">Disconnect</button>
        `;
        
        document.getElementById('logoutButton').addEventListener('click', logout);
    }
}

// Logout
function logout() {
    localStorage.removeItem('userProfile');
    currentUser = null;
    isGuest = true;
    showLoginForm();
    chatHistoryContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1rem;">No session history</p>';
    startNewChat();
    showNotification('Disconnected from Matrix', 'success');
}

// Load chat history
async function loadChatHistory() {
    if (isGuest) {
        chatHistoryContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1rem;">Login required for session history</p>';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/chats`, {
            headers: {
                'X-User-ID': currentUser.id
            }
        });
        
        if (response.ok) {
            const chats = await response.json();
            displayChatHistory(chats);
        } else {
            chatHistoryContainer.innerHTML = '<p style="text-align: center; color: var(--error-color); padding: 1rem;">Failed to load session history</p>';
        }
    } catch (error) {
        console.error('Error loading chat history:', error);
        chatHistoryContainer.innerHTML = '<p style="text-align: center; color: var(--error-color); padding: 1rem;">Failed to load session history</p>';
    }
}

// Display chat history
function displayChatHistory(chats) {
    if (chats.length === 0) {
        chatHistoryContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1rem;">No session history</p>';
        return;
    }
    
    chatHistoryContainer.innerHTML = '';
    
    chats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item touch-target';
        chatItem.textContent = chat.title;
        chatItem.addEventListener('click', () => loadChat(chat.id));
        chatHistoryContainer.appendChild(chatItem);
    });
}

// Load specific chat
async function loadChat(chatId) {
    if (isGuest) return;
    
    try {
        const response = await fetch(`${API_URL}/api/chats/${chatId}`, {
            headers: {
                'X-User-ID': currentUser.id
            }
        });
        
        if (response.ok) {
            const messages = await response.json();
            displayMessages(messages);
            currentChatId = chatId;
            chatTitle.textContent = 'Session Active';
            
            // Update active chat in sidebar
            document.querySelectorAll('.chat-item').forEach(item => {
                item.classList.remove('active');
            });
            event.target.classList.add('active');
            
            // Close sidebar on mobile
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('active');
                sidebarOverlay.classList.remove('active');
            }
            
            // Scroll to bottom after a short delay to ensure messages are rendered
            setTimeout(() => {
                scrollToBottomSmoothly();
            }, 100);
        } else {
            showNotification('Failed to load session', 'error');
        }
    } catch (error) {
        console.error('Error loading chat:', error);
        showNotification('Failed to load session', 'error');
    }
}

// Start new chat
function startNewChat() {
    currentChatId = null;
    chatTitle.textContent = 'Neural Interface Active';
    messagesContainer.innerHTML = `
        <div class="message ai-message">
            <div class="matrix-code">> System Online</div>
            <div>NUEL AI neural interface activated. How may I assist you in navigating the Matrix?</div>
        </div>
    `;
    
    // Update active chat in sidebar
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Scroll to bottom
    setTimeout(() => {
        scrollToBottomSmoothly();
    }, 100);
}

// Display messages
function displayMessages(messages) {
    messagesContainer.innerHTML = '';
    
    messages.forEach(msg => {
        addMessage(msg.content, msg.role === 'user');
    });
}

// Send message - FIXED VERSION
async function sendMessage() {
    const message = messageInput.value.trim();
    
    if (!message || isTyping) return;
    
    // Check server status
    if (serverStatus === 'error') {
        showNotification('Cannot send message: Server is offline', 'error');
        return;
    }
    
    // Add user message to UI
    addMessage(message, true);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendButton.disabled = true;
    
    // Show typing indicator
    isTyping = true;
    const typingId = showTypingIndicator();
    
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Add user ID if not guest
        if (!isGuest && currentUser) {
            headers['X-User-ID'] = currentUser.id.toString(); // Convert to string to ensure proper header format
        }
        
        const response = await fetch(`${API_URL}/api/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ message })
        });
        
        const data = await response.json();
        
        // Remove typing indicator
        removeTypingIndicator(typingId);
        isTyping = false;
        
        if (response.ok) {
            // Add AI response to UI
            addMessage(data.response, false);
            
            // Update current chat ID
            if (data.chatId) {
                currentChatId = data.chatId;
                
                // Refresh chat history if not guest
                if (!isGuest) {
                    loadChatHistory();
                }
            }
        } else {
            // Handle error response
            let errorMessage = 'System error. Please try again.';
            
            if (data.fallbackResponse) {
                errorMessage = data.fallbackResponse;
            } else if (data.error) {
                errorMessage = `Error: ${data.error}`;
                
                // Show specific notification for server busy
                if (data.error.includes('busy') || data.error.includes('overloaded')) {
                    updateServerStatus('busy');
                }
            }
            
            addMessage(errorMessage, false);
            showNotification(errorMessage, 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        
        // Remove typing indicator
        removeTypingIndicator(typingId);
        isTyping = false;
        
        // Show error message
        const errorMessage = 'Network error. Connection to Matrix unstable.';
        addMessage(errorMessage, false);
        showNotification(errorMessage, 'error');
        updateServerStatus('error');
    }
}

// Add message to UI
function addMessage(text, isUser) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    
    // Handle markdown-like formatting with Matrix style
    const formattedText = text
        .replace(/\*\*(.*?)\*\*/g, '<strong class="matrix-code">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code class="matrix-code">$1</code>')
        .replace(/\n/g, '<br>');
    
    messageDiv.innerHTML = formattedText;
    messagesContainer.appendChild(messageDiv);
    
    // Auto-scroll to bottom if user was already at bottom
    if (isScrolledToBottom) {
        setTimeout(() => {
            scrollToBottomSmoothly();
        }, 100);
    }
}

// Show typing indicator
function showTypingIndicator() {
    const typingId = 'typing-' + Date.now();
    const typingDiv = document.createElement('div');
    typingDiv.id = typingId;
    typingDiv.className = 'typing-indicator';
    typingDiv.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
    `;
    messagesContainer.appendChild(typingDiv);
    
    // Auto-scroll to bottom
    if (isScrolledToBottom) {
        setTimeout(() => {
            scrollToBottomSmoothly();
        }, 100);
    }
    
    return typingId;
}

// Remove typing indicator
function removeTypingIndicator(id) {
    const typingElement = document.getElementById(id);
    if (typingElement) {
        typingElement.remove();
    }
}

// Show notification
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'notificationSlideIn 0.3s ease reverse';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

// Delete chat
async function deleteChat(chatId) {
    if (!chatId || isGuest) return;
    
    try {
        const response = await fetch(`${API_URL}/api/chats/${chatId}`, {
            method: 'DELETE',
            headers: {
                'X-User-ID': currentUser.id.toString() // Convert to string to ensure proper header format
            }
        });
        
        if (response.ok) {
            showNotification('Session terminated successfully', 'success');
            startNewChat();
            loadChatHistory();
        } else {
            const data = await response.json();
            showNotification(data.error || 'Failed to terminate session', 'error');
        }
    } catch (error) {
        console.error('Error deleting chat:', error);
        showNotification('Failed to terminate session', 'error');
    }
}