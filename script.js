import { auth, db, ref, push, set, onValue, update, get, child, CLOUD_NAME, UPLOAD_PRESET, AGORA_APP_ID } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

// ========== المتغيرات العامة ==========
let currentUser = null;
let currentUserData = null;
let allUsers = {};
let allChats = [];
let currentChatId = null;
let currentChatUser = null;
let selectedFile = null;
let mediaRecorder = null;
let audioChunks = [];

// ========== متغيرات Agora للمكالمات ==========
let client = null;
let localTracks = null;
let remoteTracks = {};
let inCall = false;
let callChannel = null;

// ========== المصادقة ==========
window.switchAuth = function(type) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(type + 'Form').classList.add('active');
};

window.login = async function() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const msg = document.getElementById('loginMsg');
    if (!email || !password) { msg.innerText = 'الرجاء ملء جميع الحقول'; return; }
    msg.innerText = 'جاري تسجيل الدخول...';
    try {
        await signInWithEmailAndPassword(auth, email, password);
        msg.innerText = '';
    } catch (error) {
        if (error.code === 'auth/user-not-found') msg.innerText = 'لا يوجد حساب بهذا البريد';
        else if (error.code === 'auth/wrong-password') msg.innerText = 'كلمة المرور غير صحيحة';
        else msg.innerText = 'حدث خطأ: ' + error.message;
    }
};

window.register = async function() {
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPass').value;
    const msg = document.getElementById('regMsg');
    if (!name || !email || !password) { msg.innerText = 'املأ جميع الحقول'; return; }
    if (password.length < 6) { msg.innerText = 'كلمة المرور 6 أحرف على الأقل'; return; }
    msg.innerText = 'جاري إنشاء الحساب...';
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await set(ref(db, `users/${userCredential.user.uid}`), {
            name, email, avatarUrl: '', status: 'مرحباً، أنا على واتساب', online: true, lastSeen: Date.now(), followers: {}, following: {}, createdAt: Date.now()
        });
        msg.innerText = '';
    } catch (error) {
        if (error.code === 'auth/email-already-in-use') msg.innerText = 'البريد الإلكتروني مستخدم بالفعل';
        else msg.innerText = 'حدث خطأ: ' + error.message;
    }
};

window.logout = function() { signOut(auth); location.reload(); };

// ========== تحميل البيانات ==========
async function loadUserData() {
    const snap = await get(child(ref(db), `users/${currentUser.uid}`));
    if (snap.exists()) currentUserData = { uid: currentUser.uid, ...snap.val() };
    document.getElementById('profileAvatar').innerHTML = currentUserData.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full rounded-full object-cover">` : (currentUserData.name?.charAt(0) || '👤');
    document.getElementById('profileAvatarLarge').innerHTML = currentUserData.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full rounded-full object-cover">` : (currentUserData.name?.charAt(0) || '👤');
    document.getElementById('profileNameLarge').innerText = currentUserData.name;
    document.getElementById('profileStatus').innerText = currentUserData.status || 'مرحباً، أنا على واتساب';
}
onValue(ref(db, 'users'), (s) => { allUsers = s.val() || {}; });

// ========== رفع الوسائط ==========
async function uploadMedia(file) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', UPLOAD_PRESET);
    let resourceType = 'image';
    if (file.type.startsWith('video/')) resourceType = 'video';
    else if (file.type.startsWith('audio/')) resourceType = 'raw';
    fd.append('resource_type', resourceType);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    return { url: data.secure_url, type: resourceType === 'raw' ? 'audio' : resourceType };
}

// ========== تحميل المحادثات ==========
function getChatId(uid1, uid2) { return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`; }

async function loadChats() {
    const chatsRef = ref(db, `userChats/${currentUser.uid}`);
    onValue(chatsRef, async (snapshot) => {
        const data = snapshot.val() || {};
        const chatList = [];
        for (const [chatId, chatData] of Object.entries(data)) {
            const otherId = chatId.replace(currentUser.uid, '').replace('_', '');
            const otherUser = allUsers[otherId];
            if (otherUser) {
                chatList.push({
                    id: chatId,
                    otherId: otherId,
                    otherUser: otherUser,
                    lastMessage: chatData.lastMessage,
                    lastTimestamp: chatData.lastTimestamp
                });
            }
        }
        chatList.sort((a,b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
        allChats = chatList;
        renderChatsList();
    });
}

function renderChatsList() {
    const container = document.getElementById('chatsList');
    if (!container) return;
    container.innerHTML = '';
    allChats.forEach(chat => {
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.onclick = () => openChat(chat.otherId);
        div.innerHTML = `
            <div class="chat-avatar">${chat.otherUser.avatarUrl ? `<img src="${chat.otherUser.avatarUrl}">` : (chat.otherUser.name?.charAt(0) || 'U')}</div>
            <div class="chat-info">
                <div class="chat-name">${chat.otherUser.name}</div>
                <div class="chat-last-msg">${chat.lastMessage?.substring(0, 30) || ''}</div>
            </div>
            <div class="chat-time">${chat.lastTimestamp ? new Date(chat.lastTimestamp).toLocaleTimeString() : ''}</div>
        `;
        container.appendChild(div);
    });
    if (allChats.length === 0) container.innerHTML = '<div class="text-center text-gray-500 py-10">لا توجد محادثات</div>';
}

// ========== فتح محادثة ==========
async function openChat(otherId) {
    currentChatUser = allUsers[otherId];
    currentChatId = getChatId(currentUser.uid, otherId);
    renderChatArea();
    loadMessages();
}

function renderChatArea() {
    const container = document.getElementById('chatArea');
    if (!currentChatUser) {
        container.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500">اختر محادثة للبدء</div>';
        return;
    }
    container.innerHTML = `
        <div class="chat-header">
            <div class="chat-header-avatar">${currentChatUser.avatarUrl ? `<img src="${currentChatUser.avatarUrl}">` : (currentChatUser.name?.charAt(0) || 'U')}</div>
            <div class="chat-header-info">
                <div class="chat-header-name">${currentChatUser.name}</div>
                <div class="chat-header-status">${currentChatUser.online ? 'متصل' : 'غير متصل'}</div>
            </div>
            <div class="call-buttons">
                <button class="call-btn" onclick="startCall('audio')"><i class="fas fa-phone"></i></button>
                <button class="call-btn" onclick="startCall('video')"><i class="fas fa-video"></i></button>
            </div>
        </div>
        <div id="messagesContainer" class="messages-container"></div>
        <div class="input-area">
            <button class="attach-btn" onclick="document.getElementById('fileInput').click()"><i class="fas fa-paperclip"></i></button>
            <input type="file" id="fileInput" accept="image/*,video/*,audio/*" style="display:none" onchange="previewFile(this)">
            <button class="attach-btn" onclick="startAudioRecording()" id="audioRecordBtn"><i class="fas fa-microphone"></i></button>
            <input type="text" id="messageInput" placeholder="اكتب رسالة...">
            <button class="send-btn" onclick="sendMessage()"><i class="fas fa-paper-plane"></i></button>
        </div>
    `;
}

function loadMessages() {
    const messagesRef = ref(db, `messages/${currentChatId}`);
    onValue(messagesRef, (snapshot) => {
        const data = snapshot.val() || {};
        const container = document.getElementById('messagesContainer');
        if (!container) return;
        container.innerHTML = '';
        const sorted = Object.entries(data).sort((a,b) => a[1].timestamp - b[1].timestamp);
        for (const [id, msg] of sorted) {
            const isSent = msg.senderId === currentUser.uid;
            const status = isSent ? (msg.read ? 'قرأ' : msg.delivered ? 'وصل' : 'مرسل') : '';
            let content = '';
            if (msg.type === 'text') content = `<div class="message-bubble">${msg.text}</div>`;
            else if (msg.type === 'image') content = `<img src="${msg.mediaUrl}" class="message-media" onclick="window.open('${msg.mediaUrl}')">`;
            else if (msg.type === 'video') content = `<video controls class="message-media" src="${msg.mediaUrl}"></video>`;
            else if (msg.type === 'audio') content = `<audio controls src="${msg.mediaUrl}"></audio>`;
            const div = document.createElement('div');
            div.className = `message ${isSent ? 'sent' : 'received'}`;
            div.innerHTML = `
                <div>${content}<div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()} ${status ? `<span class="message-status">${status === 'قرأ' ? '✓✓' : status === 'وصل' ? '✓✓' : '✓'}</span>` : ''}</div></div>
            `;
            container.appendChild(div);
        }
        container.scrollTop = container.scrollHeight;
        if (!isSent && !msg.read) update(ref(db, `messages/${currentChatId}/${id}`), { read: true });
    });
}

window.previewFile = async function(input) {
    const file = input.files[0];
    if (!file) return;
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = function(e) {
        if (file.type.startsWith('image/')) {
            document.getElementById('messagesContainer').innerHTML += `<div class="message sent"><div><img src="${e.target.result}" class="message-media"><div class="message-time">جاري الرفع...</div></div></div>`;
        }
    };
    reader.readAsDataURL(file);
    await sendMediaMessage(file);
};

window.sendMediaMessage = async function(file) {
    const result = await uploadMedia(file);
    const message = {
        senderId: currentUser.uid,
        senderName: currentUserData.name,
        mediaUrl: result.url,
        type: result.type,
        timestamp: Date.now(),
        delivered: false,
        read: false
    };
    await push(ref(db, `messages/${currentChatId}`), message);
    await update(ref(db, `userChats/${currentUser.uid}/${currentChatId}`), { lastMessage: result.type === 'image' ? '📷 صورة' : result.type === 'video' ? '🎬 فيديو' : '🎤 رسالة صوتية', lastTimestamp: Date.now() });
    await update(ref(db, `userChats/${currentChatUser.uid}/${currentChatId}`), { lastMessage: result.type === 'image' ? '📷 صورة' : result.type === 'video' ? '🎬 فيديو' : '🎤 رسالة صوتية', lastTimestamp: Date.now() });
    selectedFile = null;
};

window.sendMessage = async function() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text || !currentChatId) return;
    const message = {
        senderId: currentUser.uid,
        senderName: currentUserData.name,
        text: text,
        type: 'text',
        timestamp: Date.now(),
        delivered: false,
        read: false
    };
    await push(ref(db, `messages/${currentChatId}`), message);
    await update(ref(db, `userChats/${currentUser.uid}/${currentChatId}`), { lastMessage: text, lastTimestamp: Date.now() });
    await update(ref(db, `userChats/${currentChatUser.uid}/${currentChatId}`), { lastMessage: text, lastTimestamp: Date.now() });
    input.value = '';
};

window.startAudioRecording = async function() {
    const btn = document.getElementById('audioRecordBtn');
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
            await sendMediaMessage(audioFile);
            stream.getTracks().forEach(track => track.stop());
        };
        mediaRecorder.start();
        btn.innerHTML = '<i class="fas fa-stop-circle text-red-500"></i>';
    } catch (err) { alert('لا يمكن الوصول إلى الميكروفون'); }
};

// ========== المكالمات (Agora) ==========
window.startCall = async function(type) {
    if (!currentChatUser) return;
    callChannel = currentChatId;
    document.getElementById('callPanel').classList.add('open');
    inCall = true;
    
    client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    
    await client.join(AGORA_APP_ID, callChannel, null, currentUser.uid);
    
    if (type === 'video') {
        localTracks = await AgoraRTC.createMicrophoneAndCameraTracks();
        document.getElementById('localVideo').srcObject = localTracks[1].getMediaStream();
    } else {
        localTracks = await AgoraRTC.createMicrophoneAudioTrack();
        document.getElementById('localVideo').style.display = 'none';
    }
    await client.publish(localTracks);
    
    client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === 'video') {
            remoteTracks[user.uid] = user.videoTrack;
            user.videoTrack.play('remoteVideo');
        }
        if (mediaType === 'audio') {
            remoteTracks[user.uid] = user.audioTrack;
            user.audioTrack.play();
        }
    });
    
    client.on('user-unpublished', (user) => {
        if (remoteTracks[user.uid]) remoteTracks[user.uid].stop();
    });
};

window.endCall = function() {
    if (localTracks) localTracks.forEach(track => track.close());
    if (client) client.leave();
    inCall = false;
    document.getElementById('callPanel').classList.remove('open');
    document.getElementById('localVideo').srcObject = null;
    document.getElementById('remoteVideo').srcObject = null;
};

window.toggleMicrophone = function() {
    if (localTracks && localTracks[0]) localTracks[0].setEnabled(!localTracks[0].enabled);
};
window.toggleCamera = function() {
    if (localTracks && localTracks[1]) localTracks[1].setEnabled(!localTracks[1].enabled);
};

// ========== محادثة جديدة ==========
window.newChat = function() {
    const email = prompt('أدخل البريد الإلكتروني للمستخدم:');
    if (!email) return;
    const user = Object.values(allUsers).find(u => u.email === email && u.uid !== currentUser.uid);
    if (!user) { alert('لم يتم العثور على المستخدم'); return; }
    openChat(user.uid);
};

// ========== الملف الشخصي ==========
window.openProfile = function() { document.getElementById('profilePanel').classList.remove('hidden'); };
window.closeProfile = function() { document.getElementById('profilePanel').classList.add('hidden'); };

// ========== حالة الاتصال ==========
onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() === true && currentUser) {
        set(ref(db, `presence/${currentUser.uid}`), true);
        set(ref(db, `users/${currentUser.uid}/online`), true);
        set(ref(db, `users/${currentUser.uid}/lastSeen`), Date.now());
        onValue(ref(db, 'presence'), () => {});
    }
});

// ========== مراقبة المستخدم ==========
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await loadUserData();
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        loadChats();
        const presenceRef = ref(db, `presence/${user.uid}`);
        set(presenceRef, true);
        set(ref(db, `users/${user.uid}/online`), true);
        set(ref(db, `users/${user.uid}/lastSeen`), Date.now());
        onValue(ref(db, '.info/connected'), (snap) => { if (snap.val() === true) set(presenceRef, true); });
    } else {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

console.log('✅ WhatsApp Clone Ready');
