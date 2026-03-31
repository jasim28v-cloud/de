import { auth, db, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, arrayUnion, arrayRemove, CLOUD_NAME, UPLOAD_PRESET, AGORA_APP_ID } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ========== GLOBAL VARIABLES ==========
let currentUser = null;
let currentUserData = null;
let allUsers = [];
let activeChatUser = null;
let activeChatId = null;
let unsubscribeMessages = null;
let selectedMediaFile = null;
let mediaRecorder = null;
let audioChunks = [];
let replyingTo = null;
let editingMessage = null;
let pinnedChats = {};
let mutedChats = {};
let blockedUsers = {};

// Agora
let agoraClient = null;
let localTracks = null;

// Emojis
const emojis = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','👽','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','💪','🦾','🖕','✍️','🙏','🦶','🦵','🦿','💄','💋','👄','🦷','👅','👂','🦻','👃','👣','👁️','👀','🧠','🦴','🦷','🦵','🦶','👅','👄'];

// ========== AUTH ==========
window.switchAuth = (type) => {
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(type === 'login' ? 'loginForm' : 'registerForm').classList.add('active');
};

window.login = async () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const msg = document.getElementById('loginMsg');
    if (!email || !password) { msg.innerText = '❌ الرجاء ملء جميع الحقول'; return; }
    try {
        await signInWithEmailAndPassword(auth, email, password);
        msg.innerText = '';
    } catch (error) {
        msg.innerText = error.code === 'auth/user-not-found' ? '❌ لا يوجد حساب' : '❌ كلمة المرور خاطئة';
    }
};

window.register = async () => {
    const name = document.getElementById('regName').value;
    let username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPass').value;
    const confirm = document.getElementById('regConfirmPass').value;
    const msg = document.getElementById('regMsg');
    
    if (!name || !username || !email || !password) { msg.innerText = '❌ الرجاء ملء جميع الحقول'; return; }
    if (password !== confirm) { msg.innerText = '❌ كلمة المرور غير متطابقة'; return; }
    if (password.length < 6) { msg.innerText = '❌ كلمة المرور 6 أحرف على الأقل'; return; }
    username = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (username.length < 3) { msg.innerText = '❌ اسم المستخدم 3 أحرف على الأقل'; return; }
    
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', userCredential.user.uid), {
            name, username, email, bio: '✨ مرحباً! أنا على VibeChat', avatarUrl: '', status: 'online', lastSeen: new Date(), createdAt: new Date(),
            pinnedChats: {}, mutedChats: {}, blockedUsers: {}
        });
        msg.innerText = '';
    } catch (error) {
        msg.innerText = error.code === 'auth/email-already-in-use' ? '❌ البريد مستخدم' : '❌ حدث خطأ';
    }
};

window.logout = async () => {
    if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { status: 'offline', lastSeen: new Date() });
    signOut(auth);
    location.reload();
};

async function loadUserData() {
    const docRef = doc(db, 'users', currentUser.uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        currentUserData = { id: docSnap.id, ...docSnap.data() };
        pinnedChats = currentUserData.pinnedChats || {};
        mutedChats = currentUserData.mutedChats || {};
        blockedUsers = currentUserData.blockedUsers || {};
    }
    await updateDoc(doc(db, 'users', currentUser.uid), { status: 'online', lastSeen: new Date() });
}

// ========== LOAD USERS ==========
async function loadUsers() {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    allUsers = [];
    snapshot.docs.forEach(docSnap => {
        if (docSnap.id !== currentUser?.uid && !blockedUsers[docSnap.id]) {
            allUsers.push({ id: docSnap.id, ...docSnap.data() });
        }
    });
    renderUsersList();
}

function renderUsersList() {
    if (allUsers.length === 0) {
        usersContainer.innerHTML = '<div class="text-center text-gray-500 py-10">لا يوجد مستخدمين</div>';
        return;
    }
    const sortedUsers = [...allUsers].sort((a, b) => (pinnedChats[a.id] ? -1 : 1));
    usersContainer.innerHTML = sortedUsers.map(user => `
        <div class="user-item ${activeChatUser?.id === user.id ? 'active' : ''}" onclick="selectUser('${user.id}')">
            <div class="user-avatar">${user.avatarUrl ? `<img src="${user.avatarUrl}">` : `<i class="fas fa-user"></i>`}</div>
            <div class="user-info">
                <div class="user-name">${escapeHtml(user.name)} ${pinnedChats[user.id] ? '📌' : ''}</div>
                <div class="user-username">@${escapeHtml(user.username)}</div>
                <div class="user-status">${user.status === 'online' ? '🟢 متصل' : '📅 غير متصل'}</div>
            </div>
        </div>
    `).join('');
}

window.searchUsers = () => {
    const query = searchUserInput.value.toLowerCase();
    document.querySelectorAll('.user-item').forEach(item => {
        const name = item.querySelector('.user-name')?.innerText.toLowerCase() || '';
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
};

// ========== SELECT USER ==========
window.selectUser = async (userId) => {
    if (unsubscribeMessages) unsubscribeMessages();
    if (blockedUsers[userId]) { showToast('⚠️ هذا المستخدم محظور', true); return; }
    
    const selectedUser = allUsers.find(u => u.id === userId);
    if (!selectedUser) return;
    
    activeChatUser = selectedUser;
    activeChatId = currentUser.uid < userId ? `${currentUser.uid}_${userId}` : `${userId}_${currentUser.uid}`;
    
    const chatRef = doc(db, 'chats', activeChatId);
    const chatSnap = await getDoc(chatRef);
    if (!chatSnap.exists()) await setDoc(chatRef, { participants: [currentUser.uid, userId], createdAt: new Date() });
    
    chatHeader.style.display = 'flex';
    inputArea.style.display = 'flex';
    chatName.innerText = selectedUser.name;
    chatStatus.innerText = selectedUser.status === 'online' ? '🟢 متصل الآن' : 'غير متصل';
    chatAvatar.innerHTML = selectedUser.avatarUrl ? `<img src="${selectedUser.avatarUrl}">` : `<i class="fas fa-user"></i>`;
    document.getElementById('pinChatBtn').style.color = pinnedChats[userId] ? '#00a884' : '#aebac1';
    document.getElementById('muteChatBtn').style.color = mutedChats[userId] ? '#00a884' : '#aebac1';
    
    renderUsersList();
    loadMessages();
    loadPinnedMessage();
};

// ========== MESSAGES ==========
function loadMessages() {
    const messagesRef = collection(db, 'chats', activeChatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    
    messagesArea.innerHTML = '<div class="loading"><div class="spinner"></div><span>جاري التحميل...</span></div>';
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) { messagesArea.innerHTML = '<div class="text-center text-gray-500 py-10">💬 لا توجد رسائل بعد</div>'; return; }
        
        messagesArea.innerHTML = '';
        snapshot.forEach(docSnap => {
            const msg = docSnap.data();
            const isSent = msg.senderId === currentUser.uid;
            const time = msg.timestamp?.toDate ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            let content = '';
            
            if (msg.text) {
                content = `<div class="message-bubble">${escapeHtml(msg.text)}</div>`;
            } else if (msg.media) {
                if (msg.media.type === 'image') content = `<div class="message-media" onclick="openImageModal('${msg.media.url}')"><img src="${msg.media.url}"></div>`;
                else if (msg.media.type === 'video') content = `<div class="message-media"><video controls src="${msg.media.url}"></video></div>`;
                else if (msg.media.type === 'audio') content = `<div class="message-audio"><audio controls src="${msg.media.url}"></audio></div>`;
                else if (msg.media.type === 'file') content = `<div class="message-media"><a href="${msg.media.url}" target="_blank" class="text-[#00a884]">📎 ${msg.media.name}</a></div>`;
            }
            
            messagesArea.innerHTML += `
                <div class="message ${isSent ? 'sent' : 'received'}" data-message-id="${docSnap.id}" data-message-text="${escapeHtml(msg.text || '')}">
                    <div>
                        ${msg.replyTo ? `<div class="reply-preview">↩️ رد على: ${escapeHtml(msg.replyTo.text?.substring(0, 50) || 'رسالة')}</div>` : ''}
                        ${content}
                        <div class="message-time">${time} ${msg.edited ? '(معدلة)' : ''}</div>
                    </div>
                    <div class="message-actions">
                        <button class="message-action" onclick="replyToMessage('${docSnap.id}', '${escapeHtml(msg.text || 'وسائط')}')"><i class="fas fa-reply"></i></button>
                        ${isSent ? `<button class="message-action" onclick="editMessage('${docSnap.id}', '${escapeHtml(msg.text || '')}')"><i class="fas fa-edit"></i></button>` : ''}
                        ${isSent ? `<button class="message-action" onclick="deleteMessage('${docSnap.id}')"><i class="fas fa-trash"></i></button>` : ''}
                        <button class="message-action" onclick="pinMessage('${docSnap.id}', '${escapeHtml(msg.text || 'وسائط')}')"><i class="fas fa-thumbtack"></i></button>
                        <button class="message-action" onclick="forwardMessage('${docSnap.id}', '${escapeHtml(msg.text || 'وسائط')}', '${msg.media ? JSON.stringify(msg.media).replace(/'/g, "\\'") : ''}')"><i class="fas fa-share"></i></button>
                    </div>
                </div>
            `;
        });
        messagesArea.scrollTop = messagesArea.scrollHeight;
        if (!mutedChats[activeChatUser?.id]) sendNotification(activeChatUser?.name, snapshot.docs[snapshot.docs.length-1]?.data()?.text);
    });
}

window.sendMessage = async () => {
    const text = messageInput.value.trim();
    if (!text && !selectedMediaFile) return;
    if (!activeChatId) { showToast('❌ اختر مستخدم أولاً', true); return; }
    
    let media = null;
    if (selectedMediaFile) {
        showToast('📤 جاري الرفع...');
        try {
            const result = await uploadMedia(selectedMediaFile);
            media = { url: result.url, type: result.type === 'image' || result.type === 'video' || result.type === 'audio' ? result.type : 'file', name: selectedMediaFile.name };
            selectedMediaFile = null;
        } catch (error) { showToast('❌ فشل رفع الملف', true); return; }
    }
    
    const messageData = { senderId: currentUser.uid, text: text || null, media, timestamp: new Date(), read: false };
    if (replyingTo) { messageData.replyTo = replyingTo; replyingTo = null; hideReplyPreview(); }
    if (editingMessage) { await updateDoc(doc(db, 'chats', activeChatId, 'messages', editingMessage.id), { text: text, edited: true }); editingMessage = null; messageInput.value = ''; return; }
    
    await addDoc(collection(db, 'chats', activeChatId, 'messages'), messageData);
    await updateDoc(doc(db, 'chats', activeChatId), { lastMessage: text || (media?.type === 'image' ? '📷 صورة' : media?.type === 'video' ? '🎥 فيديو' : '📎 ملف'), lastMessageTime: new Date() });
    messageInput.value = '';
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

window.sendFile = (input) => { const file = input.files[0]; if (!file) return; selectedMediaFile = file; window.sendMessage(); input.value = ''; };

// ========== REPLY, EDIT, DELETE, PIN, FORWARD ==========
window.replyToMessage = (id, text) => { replyingTo = { id, text }; showReplyPreview(text); };
window.editMessage = (id, text) => { editingMessage = { id, text }; messageInput.value = text; messageInput.focus(); };
window.deleteMessage = async (id) => { if (confirm('حذف هذه الرسالة للجميع؟')) await deleteDoc(doc(db, 'chats', activeChatId, 'messages', id)); };
window.pinMessage = async (id, text) => { await updateDoc(doc(db, 'chats', activeChatId), { pinnedMessage: { id, text, timestamp: new Date() } }); loadPinnedMessage(); showToast('📌 تم تثبيت الرسالة'); };
window.forwardMessage = async (id, text, mediaJson) => { const userIds = prompt('أدخل اسم المستخدم المستهدف (بدون @):'); if (!userIds) return; const targetUser = allUsers.find(u => u.username === userIds.toLowerCase()); if (!targetUser) { showToast('❌ مستخدم غير موجود', true); return; } const chatId = currentUser.uid < targetUser.id ? `${currentUser.uid}_${targetUser.id}` : `${targetUser.id}_${currentUser.uid}`; await addDoc(collection(db, 'chats', chatId, 'messages'), { senderId: currentUser.uid, text: text, media: mediaJson ? JSON.parse(mediaJson) : null, timestamp: new Date(), forwarded: true }); showToast('✅ تم إعادة التوجيه'); };

// ========== CHAT FEATURES ==========
window.pinChat = async () => { const isPinned = pinnedChats[activeChatUser.id]; if (isPinned) { delete pinnedChats[activeChatUser.id]; await updateDoc(doc(db, 'users', currentUser.uid), { [`pinnedChats.${activeChatUser.id}`]: null }); showToast('📌 تم إلغاء تثبيت المحادثة'); } else { pinnedChats[activeChatUser.id] = true; await updateDoc(doc(db, 'users', currentUser.uid), { [`pinnedChats.${activeChatUser.id}`]: true }); showToast('📌 تم تثبيت المحادثة'); } renderUsersList(); };
window.toggleMuteChat = async () => { const isMuted = mutedChats[activeChatUser.id]; if (isMuted) { delete mutedChats[activeChatUser.id]; await updateDoc(doc(db, 'users', currentUser.uid), { [`mutedChats.${activeChatUser.id}`]: null }); showToast('🔔 تم تفعيل الإشعارات'); } else { mutedChats[activeChatUser.id] = true; await updateDoc(doc(db, 'users', currentUser.uid), { [`mutedChats.${activeChatUser.id}`]: true }); showToast('🔕 تم كتم الإشعارات'); } document.getElementById('muteChatBtn').style.color = mutedChats[activeChatUser.id] ? '#00a884' : '#aebac1'; };
window.blockUser = async () => { if (confirm(`حظر ${activeChatUser?.name}؟`)) { blockedUsers[activeChatUser.id] = true; await updateDoc(doc(db, 'users', currentUser.uid), { [`blockedUsers.${activeChatUser.id}`]: true }); showToast(`✅ تم حظر ${activeChatUser?.name}`); window.selectUser(null); loadUsers(); } };
async function loadPinnedMessage() { const chatSnap = await getDoc(doc(db, 'chats', activeChatId)); const pinned = chatSnap.data()?.pinnedMessage; const bar = document.getElementById('pinnedMessageBar'); if (pinned) { bar.innerHTML = `📌 رسالة مثبتة: ${escapeHtml(pinned.text)} <button onclick="unpinMessage()" class="text-[#00a884] mr-2">إلغاء</button>`; bar.style.display = 'block'; } else bar.style.display = 'none'; }
async function unpinMessage() { await updateDoc(doc(db, 'chats', activeChatId), { pinnedMessage: null }); loadPinnedMessage(); showToast('تم إلغاء تثبيت الرسالة'); }

// ========== NOTIFICATIONS ==========
async function sendNotification(name, text) { if (mutedChats[activeChatUser?.id] || !text) return; if (Notification.permission === 'granted') new Notification(`💚 ${name}`, { body: text, icon: activeChatUser?.avatarUrl || 'https://via.placeholder.com/48' }); }
window.requestNotificationPermission = () => { Notification.requestPermission(); showToast('🔔 تم تفعيل الإشعارات'); };
window.openNotifications = () => { showToast('📢 سيتم عرض الإشعارات قريباً'); };

// ========== SEARCH ==========
window.openSearchModal = () => { document.getElementById('searchModal').classList.add('open'); document.getElementById('searchUsername').value = ''; document.getElementById('searchResult').innerHTML = ''; };
window.closeSearchModal = () => { document.getElementById('searchModal').classList.remove('open'); };
window.searchByUsername = async () => {
    const username = document.getElementById('searchUsername').value.toLowerCase().replace('@', '');
    const resultDiv = document.getElementById('searchResult');
    if (username.length < 2) { resultDiv.innerHTML = '<div class="text-center text-red-400">أدخل اسم مستخدم صحيح</div>'; return; }
    const q = query(collection(db, 'users'), where('username', '==', username));
    const snapshot = await getDocs(q);
    if (snapshot.empty) { resultDiv.innerHTML = '<div class="text-center text-red-400">❌ لا يوجد مستخدم</div>'; return; }
    const user = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    if (user.id === currentUser.uid) { resultDiv.innerHTML = '<div class="text-center text-yellow-400">هذا حسابك</div>'; return; }
    resultDiv.innerHTML = `<div class="flex items-center gap-3 p-3 bg-[#2a3942] rounded-xl"><div class="w-12 h-12 rounded-full bg-[#00a884] overflow-hidden flex items-center justify-center">${user.avatarUrl ? `<img src="${user.avatarUrl}">` : '<i class="fas fa-user"></i>'}</div><div class="flex-1"><div class="font-semibold">${escapeHtml(user.name)}</div><div class="text-sm text-gray-400">@${escapeHtml(user.username)}</div></div><button onclick="startChatWithUser('${user.id}', '${escapeHtml(user.name)}')" class="bg-[#00a884] px-4 py-2 rounded-full text-sm">محادثة</button></div>`;
};
window.startChatWithUser = async (userId, userName) => { closeSearchModal(); if (!allUsers.find(u => u.id === userId)) { const userSnap = await getDoc(doc(db, 'users', userId)); if (userSnap.exists()) allUsers.push({ id: userId, ...userSnap.data() }); } await selectUser(userId); showToast(`💬 بدأت محادثة مع ${userName}`); };

// ========== EMOJI ==========
window.toggleEmojiPicker = () => { const picker = document.getElementById('emojiPicker'); picker.style.display = picker.style.display === 'none' ? 'block' : 'none'; if (picker.innerHTML === '') emojis.forEach(emoji => { const btn = document.createElement('button'); btn.textContent = emoji; btn.className = 'text-2xl p-2 hover:bg-[#2a3942] rounded-lg transition'; btn.onclick = () => { messageInput.value += emoji; picker.style.display = 'none'; }; picker.appendChild(btn); }); };
window.startRecording = async () => { const btn = document.getElementById('recordBtn'); if (mediaRecorder?.state === 'recording') { mediaRecorder.stop(); btn.innerHTML = '<i class="fas fa-microphone"></i>'; return; } try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); mediaRecorder = new MediaRecorder(stream); audioChunks = []; mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data); mediaRecorder.onstop = async () => { const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' }); const audioFile = new File([audioBlob], 'recording.mp3', { type: 'audio/mp3' }); selectedMediaFile = audioFile; await window.sendMessage(); stream.getTracks().forEach(t => t.stop()); }; mediaRecorder.start(); btn.innerHTML = '<i class="fas fa-stop-circle text-red-500"></i>'; } catch (err) { showToast('❌ لا يمكن الوصول للميكروفون', true); } };

// ========== CALLS ==========
window.startCall = async (type) => { if (!activeChatId) { showToast('❌ اختر مستخدم أولاً', true); return; } document.getElementById('callModal').classList.add('open'); const channelName = `call_${activeChatId}`; try { agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" }); localTracks = await AgoraRTC.createMicrophoneAndCameraTracks(); localTracks[0].play("localVideo"); if (type === 'video') localTracks[1].play("localVideo"); await agoraClient.join(AGORA_APP_ID, channelName, null, currentUser.uid); await agoraClient.publish(localTracks); agoraClient.on("user-published", async (user, mediaType) => { await agoraClient.subscribe(user, mediaType); if (mediaType === "video") user.videoTrack.play("remoteVideo"); if (mediaType === "audio") user.audioTrack.play(); }); } catch (error) { showToast('❌ فشل الاتصال', true); endCall(); } };
window.endCall = () => { if (localTracks) localTracks.forEach(t => t.close()); if (agoraClient) agoraClient.leave(); document.getElementById('callModal').classList.remove('open'); localTracks = null; };
window.toggleMute = () => { if (localTracks?.[0]) localTracks[0].setEnabled(!localTracks[0].enabled); };
window.toggleVideoTrack = () => { if (localTracks?.[1]) localTracks[1].setEnabled(!localTracks[1].enabled); };

// ========== PROFILE & SETTINGS ==========
window.openProfile = async () => { const userSnap = await getDoc(doc(db, 'users', currentUser.uid)); const userData = userSnap.data(); document.getElementById('profileNameInput').value = userData.name || ''; document.getElementById('profileUsernameInput').value = userData.username || ''; document.getElementById('profileBioInput').value = userData.bio || ''; const profileAvatar = document.getElementById('profileAvatar'); profileAvatar.innerHTML = userData.avatarUrl ? `<img src="${userData.avatarUrl}" class="w-full h-full object-cover">` : '<i class="fas fa-user fa-3x text-white"></i>'; document.getElementById('profileModal').classList.add('open'); };
window.closeProfileModal = () => { document.getElementById('profileModal').classList.remove('open'); };
window.saveProfile = async () => { const name = document.getElementById('profileNameInput').value; let username = document.getElementById('profileUsernameInput').value.toLowerCase().replace(/[^a-z0-9_]/g, ''); const bio = document.getElementById('profileBioInput').value; if (!name) { showToast('❌ الاسم مطلوب', true); return; } if (!username) username = name.toLowerCase().replace(/\s/g, ''); await updateDoc(doc(db, 'users', currentUser.uid), { name, username, bio }); showToast('✅ تم تحديث الملف الشخصي'); closeProfileModal(); location.reload(); };
window.changeProfilePhoto = () => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = async (e) => { const file = e.target.files[0]; if (!file) return; showToast('📤 جاري الرفع...'); const result = await uploadMedia(file); await updateDoc(doc(db, 'users', currentUser.uid), { avatarUrl: result.url }); showToast('✅ تم تحديث الصورة'); location.reload(); }; input.click(); };
window.openSettings = () => { document.getElementById('settingsModal').classList.add('open'); };
window.closeSettingsModal = () => { document.getElementById('settingsModal').classList.remove('open'); };
window.clearAllChats = async () => { if (confirm('⚠️ حذف جميع المحادثات؟')) { const chatsRef = collection(db, 'chats'); const q = query(chatsRef, where('participants', 'array-contains', currentUser.uid)); const snapshot = await getDocs(q); for (const docSnap of snapshot.docs) await deleteDoc(docSnap.ref); showToast('✅ تم حذف جميع المحادثات'); } };
window.toggleTheme = () => { document.body.classList.toggle('dark'); };

// ========== UTILITIES ==========
function escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function showReplyPreview(text) { const preview = document.getElementById('replyPreview'); preview.innerHTML = `↩️ رد على: ${text.substring(0, 50)} <button onclick="hideReplyPreview()" class="text-red-400 mr-2">✖</button>`; preview.style.display = 'block'; }
function hideReplyPreview() { replyingTo = null; document.getElementById('replyPreview').style.display = 'none'; }
function showToast(message, isError = false) { const toast = document.getElementById('toast'); toast.textContent = message; toast.style.background = isError ? '#dc2626' : '#2a3942'; toast.style.opacity = '1'; setTimeout(() => toast.style.opacity = '0', 3000); }
window.openImageModal = (url) => { const modal = document.createElement('div'); modal.className = 'fixed inset-0 bg-black/95 z-[2000] flex items-center justify-center cursor-pointer'; modal.onclick = () => modal.remove(); modal.innerHTML = `<img src="${url}" class="max-w-[95%] max-h-[95%] object-contain rounded-xl">`; document.body.appendChild(modal); };

// ========== AUTH STATE ==========
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user; await loadUserData(); await loadUsers();
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        document.getElementById('sidebarAvatar').innerHTML = currentUserData?.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">` : '<i class="fas fa-user"></i>';
        showToast(`👋 مرحباً ${currentUserData?.name || currentUser.email}`);
        setInterval(async () => { if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { status: 'online', lastSeen: new Date() }); }, 30000);
        if (Notification.permission === 'default') Notification.requestPermission();
    } else {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
});

window.addEventListener('beforeunload', async () => { if (currentUser) await updateDoc(doc(db, 'users', currentUser.uid), { status: 'offline', lastSeen: new Date() }); });

console.log('✅ VibeChat Ready - All Features Added!');
