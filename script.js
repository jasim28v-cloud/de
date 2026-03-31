import { auth, db, ref, push, set, onValue, update, get, child, remove, CLOUD_NAME, UPLOAD_PRESET, AGORA_APP_ID } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

let currentUser = null, currentUserData = null, allUsers = {}, currentChat = null;
let mediaRecorder = null, audioChunks = [], selectedMediaFile = null;

window.switchAuth = (type) => { document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active')); document.getElementById(type + 'Form').classList.add('active'); };
window.login = async () => { const email = document.getElementById('loginEmail').value, password = document.getElementById('loginPassword').value, msg = document.getElementById('loginMsg'); if (!email || !password) { msg.innerText = 'املأ جميع الحقول'; return; } try { await signInWithEmailAndPassword(auth, email, password); } catch (error) { msg.innerText = error.message; } };
window.register = async () => { const name = document.getElementById('regName').value, email = document.getElementById('regEmail').value, username = document.getElementById('regUsername').value, password = document.getElementById('regPass').value, confirm = document.getElementById('regConfirmPass').value, msg = document.getElementById('regMsg'); if (!name || !email || !password) { msg.innerText = 'املأ جميع الحقول'; return; } if (password !== confirm) { msg.innerText = 'كلمة المرور غير متطابقة'; return; } try { const userCredential = await createUserWithEmailAndPassword(auth, email, password); await set(ref(db, `users/${userCredential.user.uid}`), { name, email, username: username || name.toLowerCase().replace(/\s/g, ''), avatarUrl: '', online: true, lastSeen: Date.now(), createdAt: Date.now() }); } catch (error) { msg.innerText = error.message; } };
window.logout = () => { if (currentUser) update(ref(db, `users/${currentUser.uid}`), { online: false, lastSeen: Date.now() }); signOut(auth); location.reload(); };

async function loadUserData() { const snap = await get(child(ref(db), `users/${currentUser.uid}`)); if (snap.exists()) currentUserData = { uid: currentUser.uid, ...snap.val() }; update(ref(db, `users/${currentUser.uid}`), { online: true, lastSeen: Date.now() }); }
onValue(ref(db, 'users'), (s) => { allUsers = s.val() || {}; renderChatsList(); });

async function renderChatsList() {
    const container = document.getElementById('chatsList'); if (!container) return;
    const chatsSnap = await get(child(ref(db), `chats`)); const allChats = chatsSnap.val() || {};
    let userChats = [];
    for (const [chatId, chat] of Object.entries(allChats)) {
        if (chat.participants && chat.participants.includes(currentUser.uid)) {
            let name = chat.type === 'private' ? (allUsers[chat.participants.find(id => id !== currentUser.uid)]?.name || 'مستخدم') : chat.name;
            let avatar = chat.type === 'private' ? (allUsers[chat.participants.find(id => id !== currentUser.uid)]?.avatarUrl) : chat.photo;
            userChats.push({ id: chatId, type: chat.type, name, avatar, lastMessage: chat.lastMessage || '', lastUpdated: chat.lastUpdated || 0 });
        }
    }
    userChats.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    if (userChats.length === 0) { container.innerHTML = '<div class="loading"><div class="spinner"></div><span>لا توجد محادثات</span></div>'; return; }
    container.innerHTML = userChats.map(chat => `<div class="chat-item" onclick="openChat('${chat.id}', '${chat.type}')"><div class="chat-avatar">${chat.avatar ? `<img src="${chat.avatar}">` : (chat.type === 'group' ? '<i class="fas fa-users"></i>' : '<i class="fas fa-user"></i>')}</div><div class="chat-info"><div class="chat-name">${escapeHtml(chat.name)}</div><div class="chat-last-message">${escapeHtml(chat.lastMessage?.substring(0, 40) || '')}</div></div></div>`).join('');
}

window.openChat = async (chatId, type) => {
    currentChat = { id: chatId, type };
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('chatInputArea').style.display = 'flex';
    document.getElementById('callAudioBtn').style.display = type === 'private' ? 'flex' : 'none';
    document.getElementById('callVideoBtn').style.display = type === 'private' ? 'flex' : 'none';
    const chatSnap = await get(child(ref(db), `chats/${chatId}`)); const chat = chatSnap.val();
    if (chat.type === 'private') {
        const otherId = chat.participants.find(id => id !== currentUser.uid); const otherUser = allUsers[otherId];
        document.getElementById('chatHeaderAvatar').innerHTML = otherUser?.avatarUrl ? `<img src="${otherUser.avatarUrl}">` : `<i class="fas fa-user"></i>`;
        document.getElementById('chatHeaderName').innerText = otherUser?.name || 'مستخدم';
        document.getElementById('chatHeaderStatus').innerText = otherUser?.online ? 'متصل' : `آخر ظهور ${new Date(otherUser?.lastSeen).toLocaleString()}`;
    } else {
        document.getElementById('chatHeaderAvatar').innerHTML = chat.photo ? `<img src="${chat.photo}">` : `<i class="fas fa-users"></i>`;
        document.getElementById('chatHeaderName').innerText = chat.name;
        document.getElementById('chatHeaderStatus').innerText = `${Object.keys(chat.participants || {}).length} عضو`;
    }
    loadMessages(chatId);
};

function loadMessages(chatId) {
    const container = document.getElementById('messagesArea'); container.innerHTML = '<div class="loading"><div class="spinner"></div><span>تحميل...</span></div>';
    onValue(ref(db, `messages/${chatId}`), (snap) => {
        const messages = snap.val() || {}; container.innerHTML = '';
        const sorted = Object.entries(messages).sort((a,b) => a[1].timestamp - b[1].timestamp);
        for (const [id, msg] of sorted) {
            const isSent = msg.sender === currentUser.uid;
            const time = new Date(msg.timestamp).toLocaleTimeString();
            let content = '';
            if (msg.text) content = `<div class="message-bubble">${escapeHtml(msg.text)}</div>`;
            else if (msg.media) {
                if (msg.media.type === 'image') content = `<div class="message-media"><img src="${msg.media.url}" onclick="openImageModal('${msg.media.url}')"></div>`;
                else if (msg.media.type === 'video') content = `<div class="message-media"><video controls src="${msg.media.url}"></video></div>`;
                else if (msg.media.type === 'audio') content = `<div class="message-audio"><audio controls src="${msg.media.url}"></audio></div>`;
            }
            container.innerHTML += `<div class="message ${isSent ? 'sent' : 'received'}"><div>${content}<div class="message-time">${time}</div></div></div>`;
        }
        if (container.innerHTML === '') container.innerHTML = '<div class="loading"><div class="spinner"></div><span>لا توجد رسائل</span></div>';
        container.scrollTop = container.scrollHeight;
    });
}

window.sendMessage = async () => {
    const input = document.getElementById('messageInput'); const text = input.value.trim(); if (!text && !selectedMediaFile) return; if (!currentChat) return;
    let mediaUrl = null, mediaType = null;
    if (selectedMediaFile) { const result = await uploadMedia(selectedMediaFile); mediaUrl = result.url; mediaType = result.type; selectedMediaFile = null; }
    await push(ref(db, `messages/${currentChat.id}`), { sender: currentUser.uid, text: text || null, media: mediaUrl ? { url: mediaUrl, type: mediaType } : null, timestamp: Date.now() });
    await update(ref(db, `chats/${currentChat.id}`), { lastMessage: text || (mediaType === 'image' ? '📷 صورة' : '🎥 فيديو'), lastUpdated: Date.now() });
    input.value = '';
};

async function uploadMedia(file) { const formData = new FormData(); formData.append('file', file); formData.append('upload_preset', UPLOAD_PRESET); let resourceType = file.type.startsWith('video/') ? 'video' : 'image'; formData.append('resource_type', resourceType); const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`; const response = await fetch(url, { method: 'POST', body: formData }); const data = await response.json(); return { url: data.secure_url, type: resourceType }; }
window.sendFile = async (input) => { const file = input.files[0]; if (!file || !currentChat) return; showToast('جاري رفع...'); const result = await uploadMedia(file); await push(ref(db, `messages/${currentChat.id}`), { sender: currentUser.uid, media: { url: result.url, type: result.type }, timestamp: Date.now() }); input.value = ''; };
window.startRecording = async () => { const btn = document.getElementById('recordBtn'); if (mediaRecorder?.state === 'recording') { mediaRecorder.stop(); btn.innerHTML = '<i class="fas fa-microphone"></i>'; return; } try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); mediaRecorder = new MediaRecorder(stream); audioChunks = []; mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data); mediaRecorder.onstop = async () => { const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' }); const audioFile = new File([audioBlob], 'recording.mp3', { type: 'audio/mp3' }); const result = await uploadMedia(audioFile); await push(ref(db, `messages/${currentChat.id}`), { sender: currentUser.uid, media: { url: result.url, type: 'audio' }, timestamp: Date.now() }); stream.getTracks().forEach(t => t.stop()); }; mediaRecorder.start(); btn.innerHTML = '<i class="fas fa-stop-circle text-red-500"></i>'; } catch (err) { showToast('لا يمكن الوصول للميكروفون'); } };

window.openProfile = () => { document.getElementById('profileName').value = currentUserData?.name || ''; document.getElementById('profileBio').value = currentUserData?.bio || ''; document.getElementById('profileModal').classList.add('open'); };
window.saveProfile = async () => { const name = document.getElementById('profileName').value; const bio = document.getElementById('profileBio').value; await update(ref(db, `users/${currentUser.uid}`), { name, bio }); showToast('تم التحديث'); location.reload(); };
window.openNewChatModal = () => { alert('سيتم إضافة البحث عن مستخدمين قريباً'); };
window.openChatSettings = () => document.getElementById('chatSettingsModal').classList.add('open');
window.closeChatSettings = () => document.getElementById('chatSettingsModal').classList.remove('open');
window.clearChat = async () => { if (confirm('مسح جميع الرسائل؟')) await set(ref(db, `messages/${currentChat.id}`), null); closeChatSettings(); };
window.blockUser = () => { alert('سيتم إضافة خاصية الحظر قريباً'); };
window.startCall = () => { alert('جاري تطوير المكالمات'); };
window.endCall = () => { document.getElementById('callModal').classList.remove('open'); };
function escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function showToast(message) { let toast = document.getElementById('customToast'); if (!toast) { toast = document.createElement('div'); toast.id = 'customToast'; document.body.appendChild(toast); } toast.innerText = message; toast.style.opacity = '1'; setTimeout(() => toast.style.opacity = '0', 3000); }
window.openImageModal = (url) => { document.getElementById('modalImage').src = url; document.getElementById('imageModal').style.display = 'flex'; };
window.closeImageModal = () => document.getElementById('imageModal').style.display = 'none';
window.searchChats = () => { const query = document.getElementById('searchChats').value.toLowerCase(); document.querySelectorAll('.chat-item').forEach(item => { item.style.display = item.querySelector('.chat-name')?.innerText.toLowerCase().includes(query) ? 'flex' : 'none'; }); };

onAuthStateChanged(auth, async (user) => {
    if (user) { currentUser = user; await loadUserData(); document.getElementById('authScreen').style.display = 'none'; document.getElementById('mainApp').style.display = 'block'; if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-mode'); setInterval(() => { if (currentUser) update(ref(db, `users/${currentUser.uid}`), { online: true, lastSeen: Date.now() }); }, 30000); } else { document.getElementById('authScreen').style.display = 'flex'; document.getElementById('mainApp').style.display = 'none'; }
});
console.log('✅ NexTalk Ready');
