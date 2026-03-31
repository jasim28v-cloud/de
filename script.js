import { auth, db, collection, doc, setDoc, getDoc, getDocs, updateDoc, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, CLOUD_NAME, UPLOAD_PRESET, AGORA_APP_ID } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

// ========== GLOBAL VARIABLES ==========
let currentUser = null;
let currentUserData = null;
let allUsers = {};
let currentChat = null;
let currentChatId = null;
let mediaRecorder = null;
let audioChunks = [];
let selectedMediaFile = null;
let agoraClient = null;
let localTracks = null;
let unsubscribeMessages = null;

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
    const username = document.getElementById('regUsername').value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPass').value;
    const confirm = document.getElementById('regConfirmPass').value;
    const msg = document.getElementById('regMsg');
    
    if (!name || !username || !email || !password) { msg.innerText = 'املأ جميع الحقول'; return; }
    if (username.length < 3) { msg.innerText = 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل'; return; }
    if (password !== confirm) { msg.innerText = 'كلمة المرور غير متطابقة'; return; }
    
    // Check if username exists
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('username', '==', username));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
        msg.innerText = 'اسم المستخدم موجود بالفعل';
        return;
    }
    
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', userCredential.user.uid), {
            name, username, email, bio: '✨ مرحباً! أنا على VibeChat', avatarUrl: '', status: 'online', lastSeen: serverTimestamp(), createdAt: serverTimestamp()
        });
        showToast('✅ تم إنشاء الحساب');
    } catch (error) {
        msg.innerText = error.code === 'auth/email-already-in-use' ? 'البريد مستخدم' : error.message;
    }
};

window.logout = async () => {
    if (currentUser) {
        await updateDoc(doc(db, 'users', currentUser.uid), { status: 'offline', lastSeen: serverTimestamp() });
    }
    signOut(auth);
    location.reload();
};

async function loadUserData() {
    const docRef = doc(db, 'users', currentUser.uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) currentUserData = { id: docSnap.id, ...docSnap.data() };
    await updateDoc(doc(db, 'users', currentUser.uid), { status: 'online', lastSeen: serverTimestamp() });
}

// ========== LOAD ALL USERS ==========
async function loadAllUsers() {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    snapshot.docs.forEach(doc => {
        allUsers[doc.id] = { id: doc.id, ...doc.data() };
    });
}

// ========== RENDER CHATS LIST ==========
async function renderChatsList() {
    const container = document.getElementById('chatsList');
    if (!container) return;
    
    const chatsRef = collection(db, 'chats');
    const q = query(chatsRef, where('participants', 'array-contains', currentUser.uid), orderBy('lastMessageTime', 'desc'));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
        container.innerHTML = '<div class="loading"><div class="spinner"></div><span>💬 لا توجد محادثات</span></div>';
        return;
    }
    
    let chatsHtml = '';
    for (const doc of snapshot.docs) {
        const chat = { id: doc.id, ...doc.data() };
        const otherId = chat.participants.find(id => id !== currentUser.uid);
        const otherUser = allUsers[otherId];
        if (otherUser) {
            chatsHtml += `
                <div class="chat-item ${currentChatId === chat.id ? 'active' : ''}" onclick="openChat('${chat.id}', '${otherId}')">
                    <div class="chat-avatar">
                        ${otherUser.avatarUrl ? `<img src="${otherUser.avatarUrl}">` : `<i class="fas fa-user"></i>`}
                        ${otherUser.status === 'online' ? '<span class="online-dot"></span>' : ''}
                    </div>
                    <div class="chat-info">
                        <div class="chat-name">${escapeHtml(otherUser.name)}</div>
                        <div class="chat-last-message">${escapeHtml(chat.lastMessage?.substring(0, 40) || '')}</div>
                    </div>
                </div>
            `;
        }
    }
    container.innerHTML = chatsHtml;
}

// ========== OPEN CHAT ==========
window.openChat = async (chatId, otherId) => {
    if (unsubscribeMessages) unsubscribeMessages();
    
    currentChatId = chatId;
    currentChat = { id: chatId, otherId };
    const otherUser = allUsers[otherId];
    
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('chatInputArea').style.display = 'flex';
    document.getElementById('chatHeaderAvatar').innerHTML = otherUser.avatarUrl ? `<img src="${otherUser.avatarUrl}">` : `<i class="fas fa-user"></i>`;
    document.getElementById('chatHeaderName').innerText = otherUser.name;
    document.getElementById('chatHeaderStatus').innerText = otherUser.status === 'online' ? '🟢 متصل الآن' : `آخر ظهور ${new Date(otherUser.lastSeen?.toDate()).toLocaleString()}`;
    
    loadMessages(chatId);
    renderChatsList();
};

function loadMessages(chatId) {
    const container = document.getElementById('messagesArea');
    container.innerHTML = '<div class="loading"><div class="spinner"></div><span>📨 تحميل الرسائل...</span></div>';
    
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        snapshot.forEach((doc) => {
            const msg = { id: doc.id, ...doc.data() };
            const isSent = msg.senderId === currentUser.uid;
            const time = msg.timestamp?.toDate ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
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
        });
        
        if (container.innerHTML === '') {
            container.innerHTML = '<div class="loading"><div class="spinner"></div><span>💬 لا توجد رسائل</span></div>';
        }
        container.scrollTop = container.scrollHeight;
        
        // Mark messages as read
        markMessagesAsRead(chatId);
    });
}

async function markMessagesAsRead(chatId) {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, where('senderId', '!=', currentUser.uid), where('read', '==', false));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (doc) => {
        await updateDoc(doc.ref, { read: true });
    });
}

// ========== SEND MESSAGE ==========
window.sendMessage = async () => {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text && !selectedMediaFile) return;
    if (!currentChatId) return;
    
    let media = null;
    if (selectedMediaFile) {
        showToast('📤 جاري الرفع...');
        const result = await uploadMedia(selectedMediaFile);
        media = { url: result.url, type: result.type };
        selectedMediaFile = null;
    }
    
    await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
        senderId: currentUser.uid,
        senderName: currentUserData.name,
        text: text || null,
        media: media,
        timestamp: serverTimestamp(),
        read: false
    });
    
    await updateDoc(doc(db, 'chats', currentChatId), {
        lastMessage: text || (media?.type === 'image' ? '📷 صورة' : media?.type === 'video' ? '🎥 فيديو' : '🎤 تسجيل'),
        lastMessageTime: serverTimestamp()
    });
    
    input.value = '';
};

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
    if (!file || !currentChatId) return;
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

// ========== SEARCH USERS ==========
window.openSearchModal = () => {
    document.getElementById('searchModal').classList.add('open');
    document.getElementById('searchUsername').value = '';
    document.getElementById('searchResults').innerHTML = '';
};

window.closeSearchModal = () => {
    document.getElementById('searchModal').classList.remove('open');
};

window.searchUsers = async () => {
    const username = document.getElementById('searchUsername').value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (username.length < 2) return;
    
    const container = document.getElementById('searchResults');
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('username', '>=', username), where('username', '<=', username + '\uf8ff'), limit(20));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
        container.innerHTML = '<div class="text-center text-[#8696a0] py-4">لا توجد نتائج</div>';
        return;
    }
    
    let html = '';
    snapshot.forEach(doc => {
        if (doc.id !== currentUser.uid) {
            const user = { id: doc.id, ...doc.data() };
            html += `
                <div class="user-card" onclick="startChat('${user.id}', '${escapeHtml(user.name)}')">
                    <div class="user-avatar">
                        ${user.avatarUrl ? `<img src="${user.avatarUrl}">` : `<i class="fas fa-user"></i>`}
                    </div>
                    <div class="user-info">
                        <div class="user-name">${escapeHtml(user.name)}</div>
                        <div class="user-username">@${escapeHtml(user.username)}</div>
                    </div>
                    <i class="fas fa-comment text-[#00a884]"></i>
                </div>
            `;
        }
    });
    container.innerHTML = html || '<div class="text-center text-[#8696a0] py-4">لا توجد نتائج</div>';
};

window.openNewChatModal = () => {
    openSearchModal();
};

window.startChat = async (otherId, otherName) => {
    const chatId = currentUser.uid < otherId ? `${currentUser.uid}_${otherId}` : `${otherId}_${currentUser.uid}`;
    const chatRef = doc(db, 'chats', chatId);
    const chatSnap = await getDoc(chatRef);
    if (!chatSnap.exists()) {
        await setDoc(chatRef, {
            participants: [currentUser.uid, otherId],
            createdAt: serverTimestamp()
        });
    }
    closeSearchModal();
    openChat(chatId, otherId);
    showToast(`💬 بدأت محادثة مع ${otherName}`);
};

// ========== CALLS ==========
window.startCall = async (type) => {
    if (!currentChatId) { showToast('❌ اختر محادثة أولاً'); return; }
    document.getElementById('callModal').classList.add('open');
    const channelName = `call_${currentChatId}`;
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
    document.getElementById('profileUsername').value = currentUserData?.username || '';
    document.getElementById('profileBio').value = currentUserData?.bio || '';
    const avatarDiv = document.getElementById('profileAvatarLarge');
    avatarDiv.innerHTML = currentUserData?.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">` : '<i class="fas fa-user fa-3x text-white"></i>';
    document.getElementById('profileModal').classList.add('open');
};

window.closeProfileModal = () => document.getElementById('profileModal').classList.remove('open');

window.saveProfile = async () => {
    const name = document.getElementById('profileName').value;
    let username = document.getElementById('profileUsername').value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const bio = document.getElementById('profileBio').value;
    if (!name.trim()) { showToast('❌ الاسم مطلوب'); return; }
    if (!username) username = name.toLowerCase().replace(/\s/g, '');
    await updateDoc(doc(db, 'users', currentUser.uid), { name: name.trim(), username, bio });
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
        await updateDoc(doc(db, 'users', currentUser.uid), { avatarUrl: result.url });
        showToast('✅ تم التحديث');
        location.reload();
    };
    input.click();
};

// ========== UTILITIES ==========
function escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function showToast(message) {
    let toast = document.getElementById('customToast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'customToast'; document.body.appendChild(toast); }
    toast.innerText = message; toast.style.opacity = '1';
    setTimeout(() => toast.style.opacity = '0', 3000);
}
window.openImageModal = (url) => { document.getElementById('modalImage').src = url; document.getElementById('imageModal').style.display = 'flex'; };
window.closeImageModal = () => document.getElementById('imageModal').style.display = 'none';
window.searchChats = () => {
    const query = document.getElementById('searchChats').value.toLowerCase();
    document.querySelectorAll('.chat-item').forEach(item => {
        const name = item.querySelector('.chat-name')?.innerText.toLowerCase() || '';
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
};

// ========== ONLINE STATUS ==========
setInterval(async () => {
    if (currentUser) {
        await updateDoc(doc(db, 'users', currentUser.uid), { status: 'online', lastSeen: serverTimestamp() });
    }
}, 30000);

// ========== AUTH STATE ==========
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await loadUserData();
        await loadAllUsers();
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        const sidebarAvatar = document.getElementById('sidebarAvatar');
        sidebarAvatar.innerHTML = currentUserData?.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">` : '<i class="fas fa-user text-white text-xl"></i>';
        renderChatsList();
        showToast(`👋 مرحباً ${currentUserData?.name}`);
        // Update online status on page close
        window.addEventListener('beforeunload', async () => {
            await updateDoc(doc(db, 'users', currentUser.uid), { status: 'offline', lastSeen: serverTimestamp() });
        });
    } else {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

console.log('✅ VibeChat Ready');
