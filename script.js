import { auth, db, ref, push, set, onValue, update, get, child, remove, CLOUD_NAME, UPLOAD_PRESET, AGORA_APP_ID } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

let currentUser = null;
let currentUserData = null;
let allUsers = {};
let currentChat = null;
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
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        msg.innerText = error.code === 'auth/user-not-found' ? 'لا يوجد حساب' : 'كلمة المرور خاطئة';
    }
};

window.register = async () => {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const phone = document.getElementById('regPhone').value;
    const password = document.getElementById('regPass').value;
    const confirm = document.getElementById('regConfirmPass').value;
    const msg = document.getElementById('regMsg');
    
    if (!name || !email || !phone || !password) { msg.innerText = 'املأ جميع الحقول'; return; }
    if (password !== confirm) { msg.innerText = 'كلمة المرور غير متطابقة'; return; }
    
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await set(ref(db, `users/${userCredential.user.uid}`), {
            name, email, phone, bio: '✨ متاح على WhatsApp', avatarUrl: '', online: true, lastSeen: Date.now(), createdAt: Date.now()
        });
        showToast('✅ تم إنشاء الحساب');
    } catch (error) {
        msg.innerText = error.code === 'auth/email-already-in-use' ? 'البريد مستخدم' : error.message;
    }
};

window.logout = async () => {
    if (currentUser) await update(ref(db, `users/${currentUser.uid}`), { online: false, lastSeen: Date.now() });
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
    renderUsersList();
});

// ========== RENDER USERS FOR NEW CHAT ==========
function renderUsersList() {
    const container = document.getElementById('usersList');
    if (!container) return;
    const users = Object.entries(allUsers).filter(([uid, u]) => uid !== currentUser?.uid);
    if (users.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-4">لا يوجد مستخدمين</div>';
        return;
    }
    container.innerHTML = users.map(([uid, u]) => `
        <div class="user-card" onclick="startChat('${uid}', '${escapeHtml(u.name)}')">
            <div class="user-avatar">
                ${u.avatarUrl ? `<img src="${u.avatarUrl}">` : `<i class="fas fa-user"></i>`}
            </div>
            <div class="user-info">
                <div class="user-name">${escapeHtml(u.name)}</div>
                <div class="user-status">${u.phone || ''} • ${u.online ? '🟢 متصل' : '📅 غير متصل'}</div>
            </div>
            <div class="user-actions">
                <button class="user-action" onclick="event.stopPropagation(); startChat('${uid}', '${escapeHtml(u.name)}')"><i class="fas fa-comment"></i></button>
                <button class="user-action" onclick="event.stopPropagation(); callUser('${uid}', 'audio')"><i class="fas fa-phone"></i></button>
                <button class="user-action" onclick="event.stopPropagation(); callUser('${uid}', 'video')"><i class="fas fa-video"></i></button>
            </div>
        </div>
    `).join('');
}

window.searchUsersByPhone = () => {
    const query = document.getElementById('searchPhone').value.toLowerCase();
    const cards = document.querySelectorAll('#usersList .user-card');
    cards.forEach(card => {
        const name = card.querySelector('.user-name')?.innerText.toLowerCase() || '';
        const status = card.querySelector('.user-status')?.innerText.toLowerCase() || '';
        card.style.display = (name.includes(query) || status.includes(query)) ? 'flex' : 'none';
    });
};

window.callUser = async (userId, type) => {
    const chatId = currentUser.uid < userId ? `${currentUser.uid}_${userId}` : `${userId}_${currentUser.uid}`;
    const chatRef = ref(db, `chats/${chatId}`);
    if (!(await get(chatRef)).exists()) {
        await set(chatRef, { type: 'private', participants: [currentUser.uid, userId], createdAt: Date.now() });
    }
    await openChat(chatId, 'private');
    setTimeout(() => startCall(type), 500);
};

window.startChat = async (otherUserId, otherName) => {
    const chatId = currentUser.uid < otherUserId ? `${currentUser.uid}_${otherUserId}` : `${otherUserId}_${currentUser.uid}`;
    const chatRef = ref(db, `chats/${chatId}`);
    if (!(await get(chatRef)).exists()) {
        await set(chatRef, { type: 'private', participants: [currentUser.uid, otherUserId], createdAt: Date.now() });
    }
    closeNewChatModal();
    openChat(chatId, 'private');
    showToast(`💬 بدأت محادثة مع ${otherName}`);
};

// ========== CHATS ==========
async function renderChatsList() {
    const container = document.getElementById('chatsList');
    if (!container) return;
    const chatsSnap = await get(child(ref(db), `chats`));
    const allChats = chatsSnap.val() || {};
    let userChats = [];
    for (const [chatId, chat] of Object.entries(allChats)) {
        if (chat.participants?.includes(currentUser.uid)) {
            if (chat.type === 'private') {
                const otherId = chat.participants.find(id => id !== currentUser.uid);
                const otherUser = allUsers[otherId];
                if (otherUser) {
                    userChats.push({
                        id: chatId, type: 'private', name: otherUser.name, avatar: otherUser.avatarUrl,
                        online: otherUser.online, lastMessage: chat.lastMessage || '', lastUpdated: chat.lastUpdated || 0
                    });
                }
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
                ${chat.avatar ? `<img src="${chat.avatar}">` : `<i class="fas fa-user"></i>`}
                ${chat.online ? '<span class="online-dot"></span>' : ''}
            </div>
            <div class="chat-info">
                <div class="chat-name">${escapeHtml(chat.name)}</div>
                <div class="chat-last-message">${escapeHtml(chat.lastMessage?.substring(0, 40) || '')}</div>
            </div>
        </div>
    `).join('');
}

window.openChat = async (chatId, type) => {
    currentChat = { id: chatId, type };
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('chatInputArea').style.display = 'flex';
    const chatSnap = await get(child(ref(db), `chats/${chatId}`));
    const chat = chatSnap.val();
    if (chat.type === 'private') {
        const otherId = chat.participants.find(id => id !== currentUser.uid);
        const otherUser = allUsers[otherId];
        if (otherUser) {
            document.getElementById('chatHeaderAvatar').innerHTML = otherUser.avatarUrl ? `<img src="${otherUser.avatarUrl}">` : `<i class="fas fa-user"></i>`;
            document.getElementById('chatHeaderName').innerText = otherUser.name;
            document.getElementById('chatHeaderStatus').innerText = otherUser.online ? '🟢 متصل الآن' : `آخر ظهور ${new Date(otherUser.lastSeen).toLocaleString()}`;
        }
    }
    loadMessages(chatId);
};

function loadMessages(chatId) {
    const container = document.getElementById('messagesArea');
    container.innerHTML = '<div class="loading"><div class="spinner"></div><span>📨 تحميل الرسائل...</span></div>';
    onValue(ref(db, `messages/${chatId}`), (snap) => {
        const messages = snap.val() || {};
        container.innerHTML = '';
        const sorted = Object.entries(messages).sort((a, b) => a[1].timestamp - b[1].timestamp);
        for (const [id, msg] of sorted) {
            const isSent = msg.sender === currentUser.uid;
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let content = '';
            if (msg.text) content = `<div class="message-bubble">${escapeHtml(msg.text)}</div>`;
            else if (msg.media) {
                if (msg.media.type === 'image') content = `<div class="message-media" onclick="openImageModal('${msg.media.url}')"><img src="${msg.media.url}"></div>`;
                else if (msg.media.type === 'video') content = `<div class="message-media"><video controls src="${msg.media.url}"></video></div>`;
                else if (msg.media.type === 'audio') content = `<div class="message-audio"><audio controls src="${msg.media.url}"></audio></div>`;
            }
            container.innerHTML += `<div class="message ${isSent ? 'sent' : 'received'}"><div>${content}<div class="message-time">${time}</div></div></div>`;
        }
        if (container.innerHTML === '') container.innerHTML = '<div class="loading"><div class="spinner"></div><span>💬 لا توجد رسائل</span></div>';
        container.scrollTop = container.scrollHeight;
    });
}

window.sendMessage = async () => {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text && !selectedMediaFile) return;
    if (!currentChat) return;
    let mediaUrl = null, mediaType = null;
    if (selectedMediaFile) {
        showToast('📤 جاري الرفع...');
        const result = await uploadMedia(selectedMediaFile);
        mediaUrl = result.url; mediaType = result.type;
        selectedMediaFile = null;
    }
    await push(ref(db, `messages/${currentChat.id}`), {
        sender: currentUser.uid, text: text || null, media: mediaUrl ? { url: mediaUrl, type: mediaType } : null, timestamp: Date.now()
    });
    await update(ref(db, `chats/${currentChat.id}`), {
        lastMessage: text || (mediaType === 'image' ? '📷 صورة' : mediaType === 'video' ? '🎥 فيديو' : '🎤 تسجيل'), lastUpdated: Date.now()
    });
    input.value = '';
};

async function uploadMedia(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    let resourceType = file.type.startsWith('video/') ? 'video' : 'image';
    formData.append('resource_type', resourceType);
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;
    const response = await fetch(url, { method: 'POST', body: formData });
    const data = await response.json();
    return { url: data.secure_url, type: resourceType };
}

window.sendFile = async (input) => {
    const file = input.files[0];
    if (!file || !currentChat) return;
    selectedMediaFile = file;
    await sendMessage();
    input.value = '';
};

window.startRecording = async () => {
    const btn = document.getElementById('recordBtn');
    if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
            const audioFile = new File([audioBlob], 'recording.mp3', { type: 'audio/mp3' });
            selectedMediaFile = audioFile;
            await sendMessage();
            stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorder.start();
        btn.innerHTML = '<i class="fas fa-stop-circle text-red-500"></i>';
    } catch (err) { showToast('❌ لا يمكن الوصول للميكروفون'); }
};

// ========== CALLS ==========
window.startCall = async (type) => {
    if (!currentChat) { showToast('❌ اختر محادثة أولاً'); return; }
    document.getElementById('callModal').classList.add('open');
    const channelName = `call_${currentChat.id}`;
    try {
        agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        localTracks = await AgoraRTC.createMicrophoneAndCameraTracks();
        localTracks[0].play("localVideo");
        if (type === 'video') localTracks[1].play("localVideo");
        await agoraClient.join(AGORA_APP_ID, channelName, null, currentUser.uid);
        await agoraClient.publish(localTracks);
        agoraClient.on("user-published", async (user, mediaType) => {
            await agoraClient.subscribe(user, mediaType);
            if (mediaType === "video") user.videoTrack.play("remoteVideo");
            if (mediaType === "audio") user.audioTrack.play();
        });
    } catch (err) { endCall(); }
};

window.endCall = () => {
    if (localTracks) localTracks.forEach(t => t.close());
    if (agoraClient) agoraClient.leave();
    document.getElementById('callModal').classList.remove('open');
    localTracks = null;
};

window.toggleMute = () => { if (localTracks?.[0]) localTracks[0].setEnabled(!localTracks[0].enabled); };
window.toggleVideo = () => { if (localTracks?.[1]) localTracks[1].setEnabled(!localTracks[1].enabled); };

// ========== PROFILE ==========
window.openProfile = () => {
    document.getElementById('profileName').value = currentUserData?.name || '';
    document.getElementById('profilePhone').value = currentUserData?.phone || '';
    document.getElementById('profileBio').value = currentUserData?.bio || '';
    const avatarDiv = document.getElementById('profileAvatarLarge');
    avatarDiv.innerHTML = currentUserData?.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">` : '<i class="fas fa-user fa-3x text-white"></i>';
    document.getElementById('profileModal').classList.add('open');
};

window.closeProfileModal = () => document.getElementById('profileModal').classList.remove('open');

window.saveProfile = async () => {
    const name = document.getElementById('profileName').value;
    const phone = document.getElementById('profilePhone').value;
    const bio = document.getElementById('profileBio').value;
    if (!name.trim()) { showToast('❌ الاسم مطلوب'); return; }
    await update(ref(db, `users/${currentUser.uid}`), { name: name.trim(), phone, bio });
    showToast('✅ تم التحديث');
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
        showToast('📤 جاري الرفع...');
        const result = await uploadMedia(file);
        await update(ref(db, `users/${currentUser.uid}`), { avatarUrl: result.url });
        showToast('✅ تم التحديث');
        location.reload();
    };
    input.click();
};

// ========== MODALS ==========
window.openNewChatModal = () => {
    document.getElementById('newChatModal').classList.add('open');
    renderUsersList();
    document.getElementById('searchPhone').value = '';
};
window.closeNewChatModal = () => document.getElementById('newChatModal').classList.remove('open');
window.searchChats = () => {
    const query = document.getElementById('searchChats').value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(item => {
        const name = item.querySelector('.chat-name')?.innerText.toLowerCase() || '';
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
};

function escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function showToast(message) {
    let toast = document.getElementById('customToast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'customToast'; document.body.appendChild(toast); }
    toast.innerText = message; toast.style.opacity = '1';
    setTimeout(() => toast.style.opacity = '0', 3000);
}
window.openImageModal = (url) => { document.getElementById('modalImage').src = url; document.getElementById('imageModal').style.display = 'flex'; };
window.closeImageModal = () => document.getElementById('imageModal').style.display = 'none';

// ========== AUTH ==========
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user; await loadUserData();
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        const sidebarAvatar = document.getElementById('sidebarAvatar');
        sidebarAvatar.innerHTML = currentUserData?.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">` : '<i class="fas fa-user"></i>';
        showToast(`👋 مرحباً ${currentUserData?.name}`);
        setInterval(async () => { if (currentUser) await update(ref(db, `users/${currentUser.uid}`), { online: true, lastSeen: Date.now() }); }, 30000);
    } else {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

console.log('✅ WhatsApp Clone Ready');
