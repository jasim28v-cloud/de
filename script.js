import { auth, db, ref, push, set, onValue, update, get, child, remove, CLOUD_NAME, UPLOAD_PRESET, AGORA_APP_ID } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

// ========== GLOBAL VARIABLES ==========
let currentUser = null;
let currentUserData = null;
let allUsers = {};
let currentChat = null;
let currentChatType = 'private';
let mediaRecorder = null;
let audioChunks = [];
let selectedMediaFile = null;
let agoraClient = null;
let localTracks = null;

// ========== AUTH ==========
window.switchAuth = (type) => {
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(type + 'Form').classList.add('active');
};

window.login = async () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const msg = document.getElementById('loginMsg');
    if (!email || !password) { msg.innerText = 'املأ جميع الحقول'; return; }
    msg.innerText = 'جاري تسجيل الدخول...';
    try {
        await signInWithEmailAndPassword(auth, email, password);
        msg.innerText = '';
    } catch (error) {
        if (error.code === 'auth/user-not-found') msg.innerText = 'لا يوجد حساب';
        else if (error.code === 'auth/wrong-password') msg.innerText = 'كلمة المرور خاطئة';
        else msg.innerText = error.message;
    }
};

window.register = async () => {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    let username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPass').value;
    const confirm = document.getElementById('regConfirmPass').value;
    const msg = document.getElementById('regMsg');
    
    if (!name || !email || !password) { msg.innerText = 'املأ جميع الحقول'; return; }
    if (password !== confirm) { msg.innerText = 'كلمة المرور غير متطابقة'; return; }
    
    // Clean username
    username = username.replace('@', '').trim();
    if (!username) username = name.toLowerCase().replace(/\s/g, '');
    
    msg.innerText = 'جاري إنشاء الحساب...';
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await set(ref(db, `users/${userCredential.user.uid}`), {
            name,
            email,
            username: username,
            bio: '✨ مرحباً! أنا على NexTalk',
            avatarUrl: '',
            online: true,
            lastSeen: Date.now(),
            createdAt: Date.now()
        });
        msg.innerText = '';
        showToast('✅ تم إنشاء الحساب بنجاح!');
    } catch (error) {
        if (error.code === 'auth/email-already-in-use') msg.innerText = 'البريد مستخدم';
        else msg.innerText = error.message;
    }
};

window.logout = async () => {
    if (currentUser) {
        await update(ref(db, `users/${currentUser.uid}`), { online: false, lastSeen: Date.now() });
    }
    signOut(auth);
    location.reload();
};

async function loadUserData() {
    const snap = await get(child(ref(db), `users/${currentUser.uid}`));
    if (snap.exists()) currentUserData = { uid: currentUser.uid, ...snap.val() };
    await update(ref(db, `users/${currentUser.uid}`), { online: true, lastSeen: Date.now() });
}

onValue(ref(db, 'users'), (s) => {
    allUsers = s.val() || {};
    renderChatsList();
    renderAllUsersList();
});

// ========== RENDER ALL USERS LIST ==========
function renderAllUsersList() {
    const container = document.getElementById('allUsersList');
    if (!container) return;
    
    const users = Object.entries(allUsers).filter(([uid, u]) => uid !== currentUser?.uid);
    
    if (users.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-400 py-4">لا يوجد مستخدمين آخرين</div>';
        return;
    }
    
    container.innerHTML = users.map(([uid, u]) => `
        <div class="user-card">
            <div class="user-avatar-large">
                ${u.avatarUrl ? `<img src="${u.avatarUrl}">` : `<i class="fas fa-user fa-2x"></i>`}
            </div>
            <div class="user-info-large">
                <div class="user-name-large">${escapeHtml(u.name)}</div>
                <div class="user-username-large">@${escapeHtml(u.username || '')}</div>
                <div class="user-bio-large">${escapeHtml(u.bio?.substring(0, 50) || '')}</div>
            </div>
            <div class="user-actions">
                <button class="user-action-btn chat" onclick="startChat('${uid}', '${escapeHtml(u.name)}')" title="محادثة">
                    <i class="fas fa-comment"></i>
                </button>
                <button class="user-action-btn call" onclick="callUser('${uid}', 'audio')" title="مكالمة صوتية">
                    <i class="fas fa-phone"></i>
                </button>
                <button class="user-action-btn video" onclick="callUser('${uid}', 'video')" title="مكالمة فيديو">
                    <i class="fas fa-video"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// ========== SEARCH USER BY USERNAME ==========
window.searchUserByUsername = async () => {
    const username = document.getElementById('addByUsername').value.trim().replace('@', '');
    const resultDiv = document.getElementById('searchUserResult');
    
    if (!username) {
        resultDiv.innerHTML = '<div class="text-center text-yellow-400 py-2">⚠️ الرجاء إدخال اسم المستخدم</div>';
        return;
    }
    
    const user = Object.entries(allUsers).find(([uid, u]) => u.username?.toLowerCase() === username.toLowerCase() && uid !== currentUser?.uid);
    
    if (!user) {
        resultDiv.innerHTML = '<div class="text-center text-red-400 py-2">❌ لا يوجد مستخدم بهذا الاسم</div>';
        return;
    }
    
    const [uid, u] = user;
    resultDiv.innerHTML = `
        <div class="user-card" style="background: rgba(168,85,247,0.2); border-color: #a855f7;">
            <div class="user-avatar-large">
                ${u.avatarUrl ? `<img src="${u.avatarUrl}">` : `<i class="fas fa-user fa-2x"></i>`}
            </div>
            <div class="user-info-large">
                <div class="user-name-large">${escapeHtml(u.name)}</div>
                <div class="user-username-large">@${escapeHtml(u.username)}</div>
                <div class="user-bio-large">${escapeHtml(u.bio?.substring(0, 50) || '')}</div>
            </div>
            <div class="user-actions">
                <button class="user-action-btn chat" onclick="startChat('${uid}', '${escapeHtml(u.name)}'); closeAddUserModal();" title="محادثة">
                    <i class="fas fa-comment"></i>
                </button>
                <button class="user-action-btn call" onclick="callUser('${uid}', 'audio'); closeAddUserModal();" title="مكالمة صوتية">
                    <i class="fas fa-phone"></i>
                </button>
                <button class="user-action-btn video" onclick="callUser('${uid}', 'video'); closeAddUserModal();" title="مكالمة فيديو">
                    <i class="fas fa-video"></i>
                </button>
            </div>
        </div>
    `;
};

// ========== CALL USER ==========
window.callUser = async (userId, type) => {
    // Create or get chat
    const chatId = currentUser.uid < userId ? `${currentUser.uid}_${userId}` : `${userId}_${currentUser.uid}`;
    const chatRef = ref(db, `chats/${chatId}`);
    const snap = await get(chatRef);
    if (!snap.exists()) {
        await set(chatRef, {
            type: 'private',
            participants: [currentUser.uid, userId],
            createdAt: Date.now()
        });
    }
    
    // Open chat and start call
    await openChat(chatId, 'private');
    setTimeout(() => startCall(type), 500);
};

// ========== START CHAT ==========
window.startChat = async (otherUserId, otherName) => {
    const chatId = currentUser.uid < otherUserId ? `${currentUser.uid}_${otherUserId}` : `${otherUserId}_${currentUser.uid}`;
    const chatRef = ref(db, `chats/${chatId}`);
    const snap = await get(chatRef);
    if (!snap.exists()) {
        await set(chatRef, {
            type: 'private',
            participants: [currentUser.uid, otherUserId],
            createdAt: Date.now()
        });
    }
    closeAddUserModal();
    openChat(chatId, 'private');
    showToast(`💬 بدأت محادثة مع ${otherName}`);
};

// ========== CHATS LIST ==========
async function renderChatsList() {
    const container = document.getElementById('chatsList');
    if (!container) return;
    
    const chatsSnap = await get(child(ref(db), `chats`));
    const allChats = chatsSnap.val() || {};
    let userChats = [];
    
    for (const [chatId, chat] of Object.entries(allChats)) {
        if (chat.participants && chat.participants.includes(currentUser.uid)) {
            let name, avatar;
            if (chat.type === 'private') {
                const otherId = chat.participants.find(id => id !== currentUser.uid);
                const otherUser = allUsers[otherId];
                if (otherUser) {
                    name = otherUser.name;
                    avatar = otherUser.avatarUrl;
                }
            } else {
                name = chat.name;
                avatar = chat.photo;
            }
            if (name) {
                userChats.push({
                    id: chatId,
                    type: chat.type,
                    name: name,
                    avatar: avatar,
                    lastMessage: chat.lastMessage || '',
                    lastUpdated: chat.lastUpdated || 0
                });
            }
        }
    }
    
    userChats.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    
    if (userChats.length === 0) {
        container.innerHTML = '<div class="loading"><div class="spinner"></div><span>💬 لا توجد محادثات</span></div>';
        return;
    }
    
    container.innerHTML = userChats.map(chat => `
        <div class="chat-item" onclick="openChat('${chat.id}', '${chat.type}')">
            <div class="chat-avatar">
                ${chat.avatar ? `<img src="${chat.avatar}">` : (chat.type === 'group' ? '<i class="fas fa-users fa-2x"></i>' : '<i class="fas fa-user fa-2x"></i>')}
            </div>
            <div class="chat-info">
                <div class="chat-name">${escapeHtml(chat.name)}</div>
                <div class="chat-last-message">${escapeHtml(chat.lastMessage?.substring(0, 40) || '')}</div>
            </div>
        </div>
    `).join('');
}

// ========== OPEN CHAT ==========
window.openChat = async (chatId, type) => {
    currentChat = { id: chatId, type };
    currentChatType = type;
    
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('chatInputArea').style.display = 'flex';
    
    const chatSnap = await get(child(ref(db), `chats/${chatId}`));
    const chat = chatSnap.val();
    
    if (chat.type === 'private') {
        const otherId = chat.participants.find(id => id !== currentUser.uid);
        const otherUser = allUsers[otherId];
        if (otherUser) {
            document.getElementById('chatHeaderAvatar').innerHTML = otherUser.avatarUrl ? `<img src="${otherUser.avatarUrl}">` : `<i class="fas fa-user fa-2x"></i>`;
            document.getElementById('chatHeaderName').innerText = otherUser.name;
            document.getElementById('chatHeaderStatus').innerText = otherUser.online ? '🟢 متصل الآن' : `📅 ${new Date(otherUser.lastSeen).toLocaleString()}`;
        }
    }
    
    loadMessages(chatId);
};

function loadMessages(chatId) {
    const container = document.getElementById('messagesArea');
    container.innerHTML = '<div class="loading"><div class="spinner"></div><span>📨 تحميل الرسائل...</span></div>';
    
    const messagesRef = ref(db, `messages/${chatId}`);
    onValue(messagesRef, (snap) => {
        const messages = snap.val() || {};
        container.innerHTML = '';
        
        const sorted = Object.entries(messages).sort((a, b) => a[1].timestamp - b[1].timestamp);
        for (const [id, msg] of sorted) {
            const isSent = msg.sender === currentUser.uid;
            const time = new Date(msg.timestamp).toLocaleTimeString();
            let content = '';
            
            if (msg.text) {
                content = `<div class="message-bubble">${escapeHtml(msg.text)}</div>`;
            } else if (msg.media) {
                if (msg.media.type === 'image') {
                    content = `<div class="message-media" onclick="openImageModal('${msg.media.url}')"><img src="${msg.media.url}"></div>`;
                } else if (msg.media.type === 'video') {
                    content = `<div class="message-media"><video controls src="${msg.media.url}"></video></div>`;
                } else if (msg.media.type === 'audio') {
                    content = `<div class="message-audio"><audio controls src="${msg.media.url}"></audio></div>`;
                }
            }
            
            container.innerHTML += `
                <div class="message ${isSent ? 'sent' : 'received'}">
                    <div>
                        ${content}
                        <div class="message-time">${time}</div>
                    </div>
                </div>
            `;
        }
        
        if (container.innerHTML === '') {
            container.innerHTML = '<div class="loading"><div class="spinner"></div><span>💬 لا توجد رسائل</span></div>';
        }
        container.scrollTop = container.scrollHeight;
    });
}

// ========== SEND MESSAGE ==========
window.sendMessage = async () => {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text && !selectedMediaFile) return;
    if (!currentChat) return;
    
    let mediaUrl = null, mediaType = null;
    if (selectedMediaFile) {
        showToast('📤 جاري رفع الملف...');
        const result = await uploadMedia(selectedMediaFile);
        mediaUrl = result.url;
        mediaType = result.type;
        selectedMediaFile = null;
    }
    
    await push(ref(db, `messages/${currentChat.id}`), {
        sender: currentUser.uid,
        text: text || null,
        media: mediaUrl ? { url: mediaUrl, type: mediaType } : null,
        timestamp: Date.now()
    });
    
    await update(ref(db, `chats/${currentChat.id}`), {
        lastMessage: text || (mediaType === 'image' ? '📷 صورة' : mediaType === 'video' ? '🎥 فيديو' : '🎤 تسجيل'),
        lastUpdated: Date.now()
    });
    
    input.value = '';
};

// ========== MEDIA UPLOAD ==========
async function uploadMedia(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    let resourceType = 'image';
    if (file.type.startsWith('video/')) resourceType = 'video';
    else if (file.type.startsWith('audio/')) resourceType = 'raw';
    formData.append('resource_type', resourceType);
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;
    const response = await fetch(url, { method: 'POST', body: formData });
    const data = await response.json();
    return { url: data.secure_url, type: resourceType === 'raw' ? 'audio' : resourceType };
}

window.sendFile = async (input) => {
    const file = input.files[0];
    if (!file || !currentChat) return;
    selectedMediaFile = file;
    await sendMessage();
    input.value = '';
};

// ========== RECORD AUDIO ==========
window.startRecording = async () => {
    const btn = document.getElementById('recordBtn');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = (event) => { audioChunks.push(event.data); };
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
            const audioFile = new File([audioBlob], 'recording.mp3', { type: 'audio/mp3' });
            selectedMediaFile = audioFile;
            await sendMessage();
            stream.getTracks().forEach(track => track.stop());
        };
        mediaRecorder.start();
        btn.innerHTML = '<i class="fas fa-stop-circle text-red-500"></i>';
    } catch (err) {
        showToast('❌ لا يمكن الوصول إلى الميكروفون');
    }
};

// ========== CALLS ==========
window.startCall = async (type) => {
    if (!currentChat || currentChatType !== 'private') {
        showToast('❌ لا يمكن إجراء مكالمة إلا في المحادثات الخاصة');
        return;
    }
    
    document.getElementById('callModal').classList.add('open');
    const channelName = `call_${currentChat.id}`;
    
    try {
        agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        localTracks = await AgoraRTC.createMicrophoneAndCameraTracks();
        
        localTracks[0].play("localVideo");
        if (type === 'video') {
            localTracks[1].play("localVideo");
        }
        
        await agoraClient.join(AGORA_APP_ID, channelName, null, currentUser.uid);
        await agoraClient.publish(localTracks);
        
        agoraClient.on("user-published", async (user, mediaType) => {
            await agoraClient.subscribe(user, mediaType);
            if (mediaType === "video") {
                user.videoTrack.play("remoteVideo");
            }
            if (mediaType === "audio") {
                user.audioTrack.play();
            }
        });
        
        showToast('📞 جاري الاتصال...');
        
    } catch (err) {
        console.error(err);
        showToast('❌ فشل الاتصال');
        endCall();
    }
};

window.endCall = () => {
    if (localTracks) {
        localTracks.forEach(track => track.close());
    }
    if (agoraClient) {
        agoraClient.leave();
    }
    document.getElementById('callModal').classList.remove('open');
    localTracks = null;
    agoraClient = null;
    showToast('📞 انتهت المكالمة');
};

window.toggleMute = () => {
    if (localTracks && localTracks[0]) {
        localTracks[0].setEnabled(!localTracks[0].enabled);
    }
};

window.toggleVideo = () => {
    if (localTracks && localTracks[1]) {
        localTracks[1].setEnabled(!localTracks[1].enabled);
    }
};

// ========== PROFILE ==========
window.openProfile = () => {
    document.getElementById('profileName').value = currentUserData?.name || '';
    document.getElementById('profileUsername').value = currentUserData?.username || '';
    document.getElementById('profileBio').value = currentUserData?.bio || '';
    const avatarDiv = document.getElementById('profileAvatarLarge');
    if (currentUserData?.avatarUrl) {
        avatarDiv.innerHTML = `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">`;
    } else {
        avatarDiv.innerHTML = '<i class="fas fa-user fa-4x text-white"></i>';
    }
    document.getElementById('profileModal').classList.add('open');
};

window.closeProfileModal = () => {
    document.getElementById('profileModal').classList.remove('open');
};

window.saveProfile = async () => {
    const name = document.getElementById('profileName').value;
    let username = document.getElementById('profileUsername').value;
    const bio = document.getElementById('profileBio').value;
    
    if (!name.trim()) {
        showToast('❌ الاسم مطلوب');
        return;
    }
    
    username = username.replace('@', '').trim();
    if (!username) username = name.toLowerCase().replace(/\s/g, '');
    
    await update(ref(db, `users/${currentUser.uid}`), {
        name: name.trim(),
        username: username,
        bio: bio
    });
    showToast('✅ تم تحديث الملف الشخصي');
    closeProfileModal();
    location.reload();
};

window.changeProfilePhoto = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        showToast('📤 جاري رفع الصورة...');
        const result = await uploadMedia(file);
        await update(ref(db, `users/${currentUser.uid}`), { avatarUrl: result.url });
        showToast('✅ تم تحديث الصورة');
        location.reload();
    };
    input.click();
};

window.openChatProfile = () => {
    if (currentChatType === 'private') {
        openProfile();
    }
};

window.openChatInfo = () => {
    showToast('ℹ️ معلومات المحادثة قريباً');
};

// ========== MODALS ==========
window.openAddUserModal = () => {
    document.getElementById('addUserModal').classList.add('open');
    renderAllUsersList();
    document.getElementById('addByUsername').value = '';
    document.getElementById('searchUserResult').innerHTML = '';
};

window.closeAddUserModal = () => {
    document.getElementById('addUserModal').classList.remove('open');
};

window.searchAll = () => {
    const query = document.getElementById('searchUsers').value.toLowerCase();
    const chatItems = document.querySelectorAll('.chat-item');
    if (chatItems.length > 0) {
        chatItems.forEach(item => {
            const name = item.querySelector('.chat-name')?.innerText.toLowerCase() || '';
            item.style.display = name.includes(query) ? 'flex' : 'none';
        });
    }
};

// ========== UTILITIES ==========
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message) {
    let toast = document.getElementById('customToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'customToast';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.style.opacity = '1';
    setTimeout(() => {
        toast.style.opacity = '0';
    }, 3000);
}

window.openImageModal = (url) => {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    img.src = url;
    modal.style.display = 'flex';
};

window.closeImageModal = () => {
    document.getElementById('imageModal').style.display = 'none';
};

window.toggleTheme = () => {
    document.body.classList.toggle('light-mode');
    localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
};

// ========== AUTH STATE ==========
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await loadUserData();
        
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        
        const sidebarAvatar = document.getElementById('sidebarAvatar');
        if (currentUserData?.avatarUrl) {
            sidebarAvatar.innerHTML = `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">`;
        } else {
            sidebarAvatar.innerHTML = '<i class="fas fa-user fa-2x" style="color:white;"></i>';
        }
        
        if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-mode');
        showToast(`👋 مرحباً ${currentUserData?.name || 'مستخدم'}`);
        
        setInterval(async () => {
            if (currentUser) {
                await update(ref(db, `users/${currentUser.uid}`), { online: true, lastSeen: Date.now() });
            }
        }, 30000);
        
    } else {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

console.log('✅ NexTalk Ready - All Features Working!');
