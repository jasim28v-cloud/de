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
    
    if (!email || !password) {
        msg.innerText = '❌ الرجاء ملء جميع الحقول';
        return;
    }
    
    msg.innerText = '🔄 جاري تسجيل الدخول...';
    
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        msg.innerText = '✅ تم تسجيل الدخول بنجاح';
        setTimeout(() => { msg.innerText = ''; }, 2000);
    } catch (error) {
        console.error('Login error:', error);
        if (error.code === 'auth/user-not-found') {
            msg.innerText = '❌ لا يوجد حساب بهذا البريد';
        } else if (error.code === 'auth/wrong-password') {
            msg.innerText = '❌ كلمة المرور غير صحيحة';
        } else if (error.code === 'auth/invalid-email') {
            msg.innerText = '❌ البريد الإلكتروني غير صالح';
        } else {
            msg.innerText = '❌ حدث خطأ: ' + error.message;
        }
    }
};

window.register = async () => {
    const name = document.getElementById('regName').value;
    let username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPass').value;
    const confirm = document.getElementById('regConfirmPass').value;
    const msg = document.getElementById('regMsg');
    
    // Validation
    if (!name || !username || !email || !password || !confirm) {
        msg.innerText = '❌ الرجاء ملء جميع الحقول';
        return;
    }
    
    // Clean username
    username = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (username.length < 3) {
        msg.innerText = '❌ اسم المستخدم يجب أن يكون 3 أحرف على الأقل';
        return;
    }
    
    if (password !== confirm) {
        msg.innerText = '❌ كلمة المرور غير متطابقة';
        return;
    }
    
    if (password.length < 6) {
        msg.innerText = '❌ كلمة المرور يجب أن تكون 6 أحرف على الأقل';
        return;
    }
    
    msg.innerText = '🔄 جاري إنشاء الحساب...';
    
    try {
        // Check if username exists
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('username', '==', username));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            msg.innerText = '❌ اسم المستخدم موجود بالفعل';
            return;
        }
        
        // Create user in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const userId = userCredential.user.uid;
        
        // Create user profile in Firestore
        await setDoc(doc(db, 'users', userId), {
            name: name,
            username: username,
            email: email,
            bio: '✨ مرحباً! أنا على VibeChat',
            avatarUrl: '',
            status: 'online',
            lastSeen: new Date(),
            createdAt: new Date()
        });
        
        msg.innerText = '✅ تم إنشاء الحساب بنجاح';
        setTimeout(() => { msg.innerText = ''; }, 2000);
        
    } catch (error) {
        console.error('Register error:', error);
        if (error.code === 'auth/email-already-in-use') {
            msg.innerText = '❌ البريد الإلكتروني مستخدم بالفعل';
        } else if (error.code === 'auth/invalid-email') {
            msg.innerText = '❌ البريد الإلكتروني غير صالح';
        } else if (error.code === 'auth/weak-password') {
            msg.innerText = '❌ كلمة المرور ضعيفة';
        } else {
            msg.innerText = '❌ حدث خطأ: ' + error.message;
        }
    }
};

window.logout = async () => {
    if (currentUser) {
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { status: 'offline', lastSeen: new Date() });
        } catch (e) {}
    }
    signOut(auth);
    location.reload();
};

async function loadUserData() {
    try {
        const docRef = doc(db, 'users', currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            currentUserData = { id: docSnap.id, ...docSnap.data() };
        } else {
            // If user document doesn't exist, create it
            await setDoc(doc(db, 'users', currentUser.uid), {
                name: currentUser.email.split('@')[0],
                username: currentUser.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, ''),
                email: currentUser.email,
                bio: '✨ مرحباً! أنا على VibeChat',
                avatarUrl: '',
                status: 'online',
                lastSeen: new Date(),
                createdAt: new Date()
            });
            currentUserData = { id: currentUser.uid, name: currentUser.email.split('@')[0] };
        }
        await updateDoc(doc(db, 'users', currentUser.uid), { status: 'online', lastSeen: new Date() });
    } catch (error) {
        console.error('Load user error:', error);
    }
}

// ========== LOAD ALL USERS ==========
async function loadAllUsers() {
    try {
        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);
        allUsers = {};
        snapshot.docs.forEach(doc => {
            allUsers[doc.id] = { id: doc.id, ...doc.data() };
        });
    } catch (error) {
        console.error('Load users error:', error);
    }
}

// ========== RENDER CHATS LIST ==========
async function renderChatsList() {
    const container = document.getElementById('chatsList');
    if (!container) return;
    
    try {
        const chatsRef = collection(db, 'chats');
        const q = query(chatsRef, where('participants', 'array-contains', currentUser.uid), orderBy('lastMessageTime', 'desc'));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            container.innerHTML = '<div class="loading"><div class="spinner"></div><span>💬 لا توجد محادثات</span></div>';
            return;
        }
        
        let chatsHtml = '';
        for (const docSnap of snapshot.docs) {
            const chat = { id: docSnap.id, ...docSnap.data() };
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
    } catch (error) {
        console.error('Render chats error:', error);
        container.innerHTML = '<div class="loading"><div class="spinner"></div><span>حدث خطأ في تحميل المحادثات</span></div>';
    }
}

// ========== OPEN CHAT ==========
window.openChat = async (chatId, otherId) => {
    if (unsubscribeMessages) unsubscribeMessages();
    
    currentChatId = chatId;
    currentChat = { id: chatId, otherId };
    const otherUser = allUsers[otherId];
    
    if (otherUser) {
        document.getElementById('chatHeader').style.display = 'flex';
        document.getElementById('chatInputArea').style.display = 'flex';
        document.getElementById('chatHeaderAvatar').innerHTML = otherUser.avatarUrl ? `<img src="${otherUser.avatarUrl}">` : `<i class="fas fa-user"></i>`;
        document.getElementById('chatHeaderName').innerText = otherUser.name;
        document.getElementById('chatHeaderStatus').innerText = otherUser.status === 'online' ? '🟢 متصل الآن' : `آخر ظهور ${otherUser.lastSeen ? new Date(otherUser.lastSeen).toLocaleString() : 'غير معروف'}`;
    }
    
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
        snapshot.forEach((docSnap) => {
            const msg = { id: docSnap.id, ...docSnap.data() };
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
    }, (error) => {
        console.error('Messages error:', error);
        container.innerHTML = '<div class="loading"><div class="spinner"></div><span>حدث خطأ في تحميل الرسائل</span></div>';
    });
}

async function markMessagesAsRead(chatId) {
    try {
        const messagesRef = collection(db, 'chats', chatId, 'messages');
        const q = query(messagesRef, where('senderId', '!=', currentUser.uid), where('read', '==', false));
        const snapshot = await getDocs(q);
        snapshot.forEach(async (docSnap) => {
            await updateDoc(docSnap.ref, { read: true });
        });
    } catch (error) {
        console.error('Mark read error:', error);
    }
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
        try {
            const result = await uploadMedia(selectedMediaFile);
            media = { url: result.url, type: result.type };
            selectedMediaFile = null;
        } catch (error) {
            showToast('❌ فشل رفع الملف');
            return;
        }
    }
    
    try {
        await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
            senderId: currentUser.uid,
            senderName: currentUserData?.name || 'مستخدم',
            text: text || null,
            media: media,
            timestamp: new Date(),
            read: false
        });
        
        await updateDoc(doc(db, 'chats', currentChatId), {
            lastMessage: text || (media?.type === 'image' ? '📷 صورة' : media?.type === 'video' ? '🎥 فيديو' : '🎤 تسجيل'),
            lastMessageTime: new Date()
        });
        
        input.value = '';
    } catch (error) {
        console.error('Send message error:', error);
        showToast('❌ فشل إرسال الرسالة');
    }
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
    if (!data.secure_url) throw new Error('Upload failed');
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
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('username', '>=', username), where('username', '<=', username + '\uf8ff'), limit(20));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            container.innerHTML = '<div class="text-center text-[#8696a0] py-4">لا توجد نتائج</div>';
            return;
        }
        
        let html = '';
        snapshot.forEach(docSnap => {
            if (docSnap.id !== currentUser.uid) {
                const user = { id: docSnap.id, ...docSnap.data() };
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
    } catch (error) {
        console.error('Search error:', error);
        container.innerHTML = '<div class="text-center text-[#8696a0] py-4">حدث خطأ في البحث</div>';
    }
};

window.openNewChatModal = () => {
    openSearchModal();
};

window.startChat = async (otherId, otherName) => {
    const chatId = currentUser.uid < otherId ? `${currentUser.uid}_${otherId}` : `${otherId}_${currentUser.uid}`;
    try {
        const chatRef = doc(db, 'chats', chatId);
        const chatSnap = await getDoc(chatRef);
        if (!chatSnap.exists()) {
            await setDoc(chatRef, {
                participants: [currentUser.uid, otherId],
                createdAt: new Date()
            });
        }
        closeSearchModal();
        openChat(chatId, otherId);
        showToast(`💬 بدأت محادثة مع ${otherName}`);
    } catch (error) {
        console.error('Start chat error:', error);
        showToast('❌ فشل بدء المحادثة');
    }
};

// ========== CALLS ==========
window.startCall = async (type) => {
    if (!currentChatId) { showToast('❌ اختر محادثة أولاً'); return; }
    document.getElementById('callModal').classList.add('open');
    const channelName = `call_${currentChatId}`;
    try {
        if (!window.AgoraRTC) {
            showToast('❌ جاري تحميل خدمة المكالمات...');
            return;
        }
        agoraClient = window.AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        localTracks = await window.AgoraRTC.createMicrophoneAndCameraTracks();
        localTracks[0].play("localVideo");
        if (type === 'video') localTracks[1].play("localVideo");
        await agoraClient.join(AGORA_APP_ID, channelName, null, currentUser.uid);
        await agoraClient.publish(localTracks);
        agoraClient.on("user-published", async (user, mediaType) => {
            await agoraClient.subscribe(user, mediaType);
            if (mediaType === "video") user.videoTrack.play("remoteVideo");
            if (mediaType === "audio") user.audioTrack.play();
        });
    } catch (err) { 
        console.error('Call error:', err);
        showToast('❌ فشل الاتصال');
        endCall();
    }
};

window.endCall = () => {
    if (localTracks) localTracks.forEach(t => t.close());
    if (agoraClient) agoraClient.leave();
    document.getElementById('callModal').classList.remove('open');
    localTracks = null;
    agoraClient = null;
};

window.toggleMute = () => { if (localTracks?.[0]) localTracks[0].setEnabled(!localTracks[0].enabled); };
window.toggleVideo = () => { if (localTracks?.[1]) localTracks[1].setEnabled(!localTracks[1].enabled); };

// ========== PROFILE ==========
window.openProfile = () => {
    if (!currentUserData) return;
    document.getElementById('profileName').value = currentUserData.name || '';
    document.getElementById('profileUsername').value = currentUserData.username || '';
    document.getElementById('profileBio').value = currentUserData.bio || '';
    const avatarDiv = document.getElementById('profileAvatarLarge');
    avatarDiv.innerHTML = currentUserData.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">` : '<i class="fas fa-user fa-3x text-white"></i>';
    document.getElementById('profileModal').classList.add('open');
};

window.closeProfileModal = () => {
    document.getElementById('profileModal').classList.remove('open');
};

window.saveProfile = async () => {
    const name = document.getElementById('profileName').value;
    let username = document.getElementById('profileUsername').value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const bio = document.getElementById('profileBio').value;
    if (!name.trim()) { showToast('❌ الاسم مطلوب'); return; }
    if (!username) username = name.toLowerCase().replace(/\s/g, '');
    try {
        await updateDoc(doc(db, 'users', currentUser.uid), { name: name.trim(), username, bio });
        showToast('✅ تم التحديث');
        closeProfileModal();
        location.reload();
    } catch (error) {
        showToast('❌ فشل التحديث');
    }
};

window.changeProfilePhoto = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        showToast('📤 جاري الرفع...');
        try {
            const result = await uploadMedia(file);
            await updateDoc(doc(db, 'users', currentUser.uid), { avatarUrl: result.url });
            showToast('✅ تم التحديث');
            location.reload();
        } catch (error) {
            showToast('❌ فشل الرفع');
        }
    };
    input.click();
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
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

window.openImageModal = (url) => { 
    document.getElementById('modalImage').src = url; 
    document.getElementById('imageModal').style.display = 'flex'; 
};

window.closeImageModal = () => { 
    document.getElementById('imageModal').style.display = 'none'; 
};

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
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { status: 'online', lastSeen: new Date() });
        } catch (e) {}
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
        if (sidebarAvatar) {
            sidebarAvatar.innerHTML = currentUserData?.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">` : '<i class="fas fa-user text-white text-xl"></i>';
        }
        renderChatsList();
        showToast(`👋 مرحباً ${currentUserData?.name || 'مستخدم'}`);
        
        window.addEventListener('beforeunload', async () => {
            try {
                await updateDoc(doc(db, 'users', currentUser.uid), { status: 'offline', lastSeen: new Date() });
            } catch (e) {}
        });
    } else {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

console.log('✅ VibeChat Ready - All Fixed');
