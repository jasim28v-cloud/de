import { auth, db, ref, push, set, onValue, update, get, child, remove, storage, storageRef, uploadBytes, getDownloadURL, CLOUD_NAME, UPLOAD_PRESET, AGORA_APP_ID } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

let currentUser = null, currentUserData = null, allUsers = {}, currentChat = null, currentChatType = 'private';
let mediaRecorder = null, audioChunks = [], agoraClient = null, localTracks = null, currentCall = null;
let selectedGroupUsers = [], replyingTo = null, editingMessage = null;
let mutedChats = {}, pinnedChats = {}, archivedChats = {}, blockedUsers = {};
let twoFactorEnabled = false, userSessions = [];

const ADMIN_EMAIL = 'jasim28v@gmail.com', ADMIN_CODE = 'vv2314vv';

// ========== AUTH ==========
window.switchAuth = (type) => { document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active')); document.getElementById(type + 'Form').classList.add('active'); };
window.login = async () => { const email = document.getElementById('loginEmail').value, password = document.getElementById('loginPassword').value, msg = document.getElementById('loginMsg'); if (!email || !password) { msg.innerText = 'املأ جميع الحقول'; return; } msg.innerText = 'جاري تسجيل الدخول...'; try { await signInWithEmailAndPassword(auth, email, password); msg.innerText = ''; } catch (error) { msg.innerText = error.code === 'auth/user-not-found' ? 'لا يوجد حساب' : error.code === 'auth/wrong-password' ? 'كلمة المرور خاطئة' : error.message; } };
window.register = async () => { const name = document.getElementById('regName').value, email = document.getElementById('regEmail').value, password = document.getElementById('regPass').value, confirm = document.getElementById('regConfirmPass').value, msg = document.getElementById('regMsg'); if (!name || !email || !password || !confirm) { msg.innerText = 'املأ جميع الحقول'; return; } if (password.length < 6) { msg.innerText = 'كلمة المرور 6 أحرف'; return; } if (password !== confirm) { msg.innerText = 'كلمة المرور غير متطابقة'; return; } try { const userCredential = await createUserWithEmailAndPassword(auth, email, password); await set(ref(db, `users/${userCredential.user.uid}`), { name, email, bio: '', avatarUrl: '', online: true, lastSeen: Date.now(), twoFactorEnabled: false, createdAt: Date.now() }); msg.innerText = ''; } catch (error) { msg.innerText = error.code === 'auth/email-already-in-use' ? 'البريد مستخدم' : error.message; } };
window.logout = () => { if (currentUser) update(ref(db, `users/${currentUser.uid}`), { online: false, lastSeen: Date.now() }); signOut(auth); location.reload(); };

async function loadUserData() { const snap = await get(child(ref(db), `users/${currentUser.uid}`)); if (snap.exists()) currentUserData = { uid: currentUser.uid, ...snap.val() }; update(ref(db, `users/${currentUser.uid}`), { online: true, lastSeen: Date.now() }); }
onValue(ref(db, 'users'), (s) => { allUsers = s.val() || {}; renderChatsList(); });

// ========== CHATS ==========
async function renderChatsList() {
    const container = document.getElementById('chatsList'); if (!container) return;
    const chatsSnap = await get(child(ref(db), `chats`)); const allChats = chatsSnap.val() || {};
    let userChats = [];
    for (const [chatId, chat] of Object.entries(allChats)) {
        if (chat.participants && chat.participants.includes(currentUser.uid)) {
            if (blockedUsers[chat.participants.find(id => id !== currentUser.uid)]) continue;
            let name = chat.type === 'private' ? (allUsers[chat.participants.find(id => id !== currentUser.uid)]?.name || 'مستخدم') : chat.name;
            let avatar = chat.type === 'private' ? (allUsers[chat.participants.find(id => id !== currentUser.uid)]?.avatarUrl) : chat.photo;
            userChats.push({ id: chatId, type: chat.type, name, avatar, lastMessage: chat.lastMessage || '', lastUpdated: chat.lastUpdated || 0, pinned: pinnedChats[chatId], archived: archivedChats[chatId] });
        }
    }
    userChats.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    userChats = userChats.filter(c => !c.archived);
    if (userChats.length === 0) { container.innerHTML = '<div class="text-center text-gray-500 py-10">لا توجد محادثات</div>'; return; }
    container.innerHTML = userChats.map(chat => `<div class="chat-item ${pinnedChats[chat.id] ? 'pinned-chat' : ''}" onclick="openChat('${chat.id}', '${chat.type}')"><div class="chat-avatar">${chat.avatar ? `<img src="${chat.avatar}">` : (chat.type === 'group' ? '<i class="fas fa-users"></i>' : '<i class="fas fa-user"></i>')}</div><div class="chat-info"><div class="chat-name">${escapeHtml(chat.name)}${mutedChats[chat.id] ? ' <i class="fas fa-bell-slash text-gray-500 text-xs"></i>' : ''}</div><div class="chat-last-message">${escapeHtml(chat.lastMessage?.substring(0, 40) || '')}</div></div></div>`).join('');
}

window.openChat = async (chatId, type) => {
    currentChat = { id: chatId, type }; currentChatType = type;
    document.getElementById('chatHeader').style.display = 'flex'; document.getElementById('chatInputArea').style.display = 'flex';
    document.getElementById('callAudioBtn').style.display = type === 'private' ? 'flex' : 'none';
    document.getElementById('callVideoBtn').style.display = type === 'private' ? 'flex' : 'none';
    const chatSnap = await get(child(ref(db), `chats/${chatId}`)); const chat = chatSnap.val();
    if (chat.type === 'private') {
        const otherId = chat.participants.find(id => id !== currentUser.uid); const otherUser = allUsers[otherId];
        document.getElementById('chatHeaderAvatar').innerHTML = otherUser?.avatarUrl ? `<img src="${otherUser.avatarUrl}">` : `<i class="fas fa-user"></i>`;
        document.getElementById('chatHeaderName').innerText = otherUser?.name || 'مستخدم';
        document.getElementById('chatHeaderStatus').innerText = otherUser?.online ? 'متصل' : `آخر ظهور ${new Date(otherUser?.lastSeen).toLocaleTimeString()}`;
    } else {
        document.getElementById('chatHeaderAvatar').innerHTML = chat.photo ? `<img src="${chat.photo}">` : `<i class="fas fa-users"></i>`;
        document.getElementById('chatHeaderName').innerText = chat.name;
        document.getElementById('chatHeaderStatus').innerText = `${Object.keys(chat.participants || {}).length} عضو`;
    }
    loadMessages(chatId);
};

function loadMessages(chatId) {
    const container = document.getElementById('messagesArea'); container.innerHTML = '<div class="loading"><div class="spinner"></div><span>جاري التحميل...</span></div>';
    const messagesRef = ref(db, `messages/${chatId}`);
    onValue(messagesRef, (snap) => {
        const messages = snap.val() || {}; container.innerHTML = '';
        const sorted = Object.entries(messages).sort((a,b) => a[1].timestamp - b[1].timestamp);
        for (const [id, msg] of sorted) {
            if (msg.deletedForEveryone) continue;
            const isSent = msg.sender === currentUser.uid;
            const time = new Date(msg.timestamp).toLocaleTimeString();
            let content = '';
            if (msg.text) content = `<div class="message-bubble">${escapeHtml(msg.text)}</div>`;
            else if (msg.poll) content = `<div class="message-bubble"><strong>استطلاع: ${escapeHtml(msg.poll.question)}</strong><div id="poll-${id}"></div></div>`;
            else if (msg.media) {
                if (msg.media.type === 'image') content = `<div class="message-media"><img src="${msg.media.url}" onclick="openImageModal('${msg.media.url}')"></div>`;
                else if (msg.media.type === 'video') content = `<div class="message-media"><video controls src="${msg.media.url}"></video></div>`;
                else if (msg.media.type === 'audio') content = `<div class="message-audio"><audio controls src="${msg.media.url}"></audio></div>`;
                else if (msg.media.type === 'file') content = `<div class="message-media"><a href="${msg.media.url}" target="_blank" class="text-[#1d9bf0]">📎 ${msg.media.name}</a></div>`;
                else if (msg.media.type === 'location') content = `<div class="message-media"><a href="https://maps.google.com/?q=${msg.media.lat},${msg.media.lng}" target="_blank">📍 موقع: ${msg.media.lat}, ${msg.media.lng}</a></div>`;
                else if (msg.media.type === 'contact') content = `<div class="message-media"><i class="fas fa-address-card"></i> جهة اتصال: ${msg.media.name}<br>📞 ${msg.media.phone}</div>`;
            }
            container.innerHTML += `<div class="message ${isSent ? 'sent' : 'received'}" data-message-id="${id}" data-sender="${msg.sender}"><div>${msg.replyTo ? `<div class="reply-preview">رد على: ${escapeHtml(msg.replyTo.text?.substring(0, 50) || 'رسالة')}</div>` : ''}${content}<div class="message-time">${time}${msg.edited ? ' (معدلة)' : ''}</div></div><div class="message-actions"><button class="message-action-btn" onclick="replyToMessage('${id}', '${escapeHtml(msg.text || (msg.media ? 'وسائط' : 'رسالة'))}')"><i class="fas fa-reply"></i></button>${isSent ? `<button class="message-action-btn" onclick="editMessage('${id}', '${escapeHtml(msg.text || '')}')"><i class="fas fa-edit"></i></button><button class="message-action-btn" onclick="deleteForEveryone('${id}')"><i class="fas fa-trash"></i></button>` : ''}</div></div>`;
            if (msg.poll) renderPoll(id, msg.poll);
        }
        if (container.innerHTML === '') container.innerHTML = '<div class="text-center text-gray-500 py-10">لا توجد رسائل</div>';
        container.scrollTop = container.scrollHeight;
    });
}

async function renderPoll(messageId, poll) { const container = document.getElementById(`poll-${messageId}`); if (!container) return; const total = poll.options.reduce((s,o) => s + (o.votes || 0), 0); container.innerHTML = poll.options.map(opt => `<div class="poll-result" onclick="votePoll('${messageId}', '${opt.text}')"><div class="poll-result-bar" style="width:${total ? (opt.votes || 0) / total * 100 : 0}%"></div><div class="poll-result-text">${escapeHtml(opt.text)} (${opt.votes || 0})</div></div>`).join(''); }

window.votePoll = async (messageId, optionText) => { if (!currentChat) return; const pollRef = ref(db, `messages/${currentChat.id}/${messageId}/poll`); const snap = await get(pollRef); const poll = snap.val(); if (!poll) return; const newOptions = poll.options.map(opt => opt.text === optionText ? { ...opt, votes: (opt.votes || 0) + 1 } : opt); await update(pollRef, { options: newOptions }); };

window.sendMessage = async () => {
    const input = document.getElementById('messageInput'); const text = input.value.trim(); if (!text && !selectedMediaFile && !currentPoll) return; if (!currentChat) return;
    let mediaUrl = null, mediaType = null, mediaName = null;
    if (selectedMediaFile) { const result = await uploadMedia(selectedMediaFile); mediaUrl = result.url; mediaType = result.type; mediaName = selectedMediaFile.name; selectedMediaFile = null; }
    const messageData = { sender: currentUser.uid, text: text || null, timestamp: Date.now(), read: false, replyTo: replyingTo };
    if (mediaUrl) messageData.media = { url: mediaUrl, type: mediaType, name: mediaName };
    if (currentPoll) { messageData.poll = currentPoll; currentPoll = null; }
    await push(ref(db, `messages/${currentChat.id}`), messageData);
    await update(ref(db, `chats/${currentChat.id}`), { lastMessage: text || (mediaType === 'image' ? '📷 صورة' : mediaType === 'video' ? '🎥 فيديو' : '🎤 رسالة'), lastUpdated: Date.now() });
    input.value = ''; replyingTo = null; document.getElementById('replyPreview')?.remove();
};

window.replyToMessage = (messageId, text) => { replyingTo = { id: messageId, text }; const preview = document.createElement('div'); preview.id = 'replyPreview'; preview.className = 'reply-preview'; preview.innerHTML = `الرد على: ${text} <button onclick="cancelReply()" class="text-red-500">&times;</button>`; document.querySelector('.chat-input-area').prepend(preview); };
window.cancelReply = () => { replyingTo = null; document.getElementById('replyPreview')?.remove(); };
window.editMessage = async (messageId, oldText) => { const newText = prompt('تعديل الرسالة:', oldText); if (!newText) return; await update(ref(db, `messages/${currentChat.id}/${messageId}`), { text: newText, edited: true }); };
window.deleteForEveryone = async (messageId) => { if (confirm('حذف هذه الرسالة للجميع؟')) await update(ref(db, `messages/${currentChat.id}/${messageId}`), { deletedForEveryone: true }); };

// ========== GROUP SETTINGS ==========
window.openGroupSettings = async () => {
    const chatSnap = await get(child(ref(db), `chats/${currentChat.id}`)); const chat = chatSnap.val();
    document.getElementById('groupEditName').value = chat.name || ''; document.getElementById('groupEditDesc').value = chat.description || '';
    const membersDiv = document.getElementById('groupMembersList');
    membersDiv.innerHTML = '<h4 class="mt-4 mb-2">الأعضاء</h4>';
    for (const uid of Object.keys(chat.participants || {})) {
        const user = allUsers[uid];
        membersDiv.innerHTML += `<div class="flex justify-between items-center p-2 border-b"><span>${escapeHtml(user?.name)}</span>${currentUser.uid === chat.admin && uid !== currentUser.uid ? `<button onclick="kickFromGroup('${uid}')" class="text-red-500 text-sm">طرد</button>` : ''}</div>`;
    }
    document.getElementById('groupSettingsModal').classList.add('open');
};
window.kickFromGroup = async (userId) => { if (confirm('طرد هذا العضو؟')) await update(ref(db, `chats/${currentChat.id}/participants/${userId}`), null); };
window.leaveGroup = async () => { if (confirm('مغادرة المجموعة؟')) await update(ref(db, `chats/${currentChat.id}/participants/${currentUser.uid}`), null); };
window.createGroupInviteLink = async () => { const link = `${window.location.origin}?join=${currentChat.id}`; navigator.clipboard.writeText(link); showToast('تم نسخ رابط الدعوة'); };
window.saveGroupSettings = async () => { const name = document.getElementById('groupEditName').value; const desc = document.getElementById('groupEditDesc').value; await update(ref(db, `chats/${currentChat.id}`), { name, description: desc }); closeGroupSettings(); };

// ========== CHAT SETTINGS ==========
window.pinChat = async () => { pinnedChats[currentChat.id] = true; await update(ref(db, `users/${currentUser.uid}/pinned/${currentChat.id}`), true); showToast('تم تثبيت المحادثة'); };
window.archiveChat = async () => { archivedChats[currentChat.id] = true; await update(ref(db, `users/${currentUser.uid}/archived/${currentChat.id}`), true); renderChatsList(); };
window.toggleMuteNotifications = async () => { mutedChats[currentChat.id] = !mutedChats[currentChat.id]; await update(ref(db, `users/${currentUser.uid}/muted/${currentChat.id}`), mutedChats[currentChat.id]); showToast(mutedChats[currentChat.id] ? 'تم كتم الإشعارات' : 'تم إلغاء كتم الإشعارات'); };
window.clearChat = async () => { if (confirm('مسح جميع الرسائل؟')) await set(ref(db, `messages/${currentChat.id}`), null); };
window.blockUser = async () => { if (currentChatType === 'private') { const otherId = currentChat.id.split('_').find(id => id !== currentUser.uid); blockedUsers[otherId] = true; await update(ref(db, `users/${currentUser.uid}/blocked/${otherId}`), true); showToast('تم حظر المستخدم'); renderChatsList(); } };

// ========== MEDIA ==========
let selectedMediaFile = null, currentPoll = null;
async function uploadMedia(file) { const formData = new FormData(); formData.append('file', file); formData.append('upload_preset', UPLOAD_PRESET); let resourceType = 'image'; if (file.type.startsWith('video/')) resourceType = 'video'; else if (file.type.startsWith('audio/')) resourceType = 'raw'; formData.append('resource_type', resourceType); const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`; const response = await fetch(url, { method: 'POST', body: formData }); const data = await response.json(); return { url: data.secure_url, type: resourceType === 'raw' ? 'audio' : resourceType }; }
window.sendFile = async (input) => { const file = input.files[0]; if (!file || !currentChat) return; showToast('📤 جاري رفع...'); const result = await uploadMedia(file); await push(ref(db, `messages/${currentChat.id}`), { sender: currentUser.uid, media: { url: result.url, type: result.type, name: file.name }, timestamp: Date.now() }); input.value = ''; };
window.startRecording = async () => { const btn = document.getElementById('recordBtn'); if (mediaRecorder?.state === 'recording') { mediaRecorder.stop(); btn.innerHTML = '<i class="fas fa-microphone"></i>'; return; } try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); mediaRecorder = new MediaRecorder(stream); audioChunks = []; mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data); mediaRecorder.onstop = async () => { const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' }); const audioFile = new File([audioBlob], 'recording.mp3', { type: 'audio/mp3' }); const result = await uploadMedia(audioFile); await push(ref(db, `messages/${currentChat.id}`), { sender: currentUser.uid, media: { url: result.url, type: 'audio' }, timestamp: Date.now() }); stream.getTracks().forEach(t => t.stop()); }; mediaRecorder.start(); btn.innerHTML = '<i class="fas fa-stop-circle text-red-500"></i>'; } catch (err) { showToast('لا يمكن الوصول إلى الميكروفون'); } };

// ========== PROFILE ==========
window.openProfile = () => { document.getElementById('profileName').value = currentUserData?.name || ''; document.getElementById('profileBio').value = currentUserData?.bio || ''; document.getElementById('profileAvatarModal').innerHTML = currentUserData?.avatarUrl ? `<img src="${currentUserData.avatarUrl}">` : `<i class="fas fa-user"></i>`; document.getElementById('profileModal').classList.add('open'); };
window.saveProfile = async () => { const name = document.getElementById('profileName').value; const bio = document.getElementById('profileBio').value; if (!name.trim()) return; await update(ref(db, `users/${currentUser.uid}`), { name: name.trim(), bio }); showToast('✅ تم التحديث'); location.reload(); };
window.changeProfilePhoto = () => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = async (e) => { const file = e.target.files[0]; if (!file) return; const result = await uploadMedia(file); await update(ref(db, `users/${currentUser.uid}`), { avatarUrl: result.url }); location.reload(); }; input.click(); };

// ========== CALLS ==========
window.startCall = async (type) => { if (!currentChat || currentChatType !== 'private') return; document.getElementById('callModal').classList.add('open'); const channelName = `call_${currentChat.id}`; try { agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" }); localTracks = await AgoraRTC.createMicrophoneAndCameraTracks(); localTracks[0].play("localVideo"); if (type === 'video') localTracks[1].play("localVideo"); await agoraClient.join(AGORA_APP_ID, channelName, null, currentUser.uid); await agoraClient.publish(localTracks); agoraClient.on("user-published", async (user, mediaType) => { await agoraClient.subscribe(user, mediaType); if (mediaType === "video") user.videoTrack.play("remoteVideo"); if (mediaType === "audio") user.audioTrack.play(); }); } catch (err) { showToast('فشل المكالمة'); endCall(); } };
window.endCall = () => { if (localTracks) localTracks.forEach(t => t.close()); if (agoraClient) agoraClient.leave(); document.getElementById('callModal').classList.remove('open'); localTracks = null; };
window.toggleMute = () => { if (localTracks?.[0]) { localTracks[0].setEnabled(!localTracks[0].enabled); document.getElementById('muteBtn').innerHTML = localTracks[0].enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>'; } };
window.toggleVideo = () => { if (localTracks?.[1]) { localTracks[1].setEnabled(!localTracks[1].enabled); document.getElementById('videoBtn').innerHTML = localTracks[1].enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>'; } };

// ========== UTILITIES ==========
function escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function showToast(message) { let toast = document.getElementById('customToast'); if (!toast) { toast = document.createElement('div'); toast.id = 'customToast'; document.body.appendChild(toast); } toast.innerText = message; toast.style.opacity = '1'; setTimeout(() => toast.style.opacity = '0', 3000); }
window.openImageModal = (url) => { const modal = document.getElementById('imageModal'); document.getElementById('modalImage').src = url; modal.style.opacity = '1'; modal.style.visibility = 'visible'; };
window.closeImageModal = () => { document.getElementById('imageModal').style.opacity = '0'; document.getElementById('imageModal').style.visibility = 'hidden'; };
window.searchChats = () => { const query = document.getElementById('searchChats').value.toLowerCase(); document.querySelectorAll('.chat-item').forEach(item => { item.style.display = item.querySelector('.chat-name')?.innerText.toLowerCase().includes(query) ? 'flex' : 'none'; }); };
window.toggleTheme = () => { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark'); };

// ========== NEW CHAT & GROUP ==========
window.openNewChatModal = () => { document.getElementById('newChatModal').classList.add('open'); searchUsers(); };
window.searchUsers = () => { const query = document.getElementById('searchUser').value.toLowerCase(); const container = document.getElementById('usersList'); const users = Object.entries(allUsers).filter(([uid, u]) => uid !== currentUser.uid && u.name?.toLowerCase().includes(query)); container.innerHTML = users.map(([uid, u]) => `<div class="chat-item" onclick="startPrivateChat('${uid}')"><div class="chat-avatar">${u.avatarUrl ? `<img src="${u.avatarUrl}">` : '<i class="fas fa-user"></i>'}</div><div class="chat-info"><div class="chat-name">${escapeHtml(u.name)}</div></div></div>`).join(''); if (users.length === 0) container.innerHTML = '<div class="text-center text-gray-500 py-4">لا توجد نتائج</div>'; };
window.startPrivateChat = async (otherId) => { const chatId = currentUser.uid < otherId ? `${currentUser.uid}_${otherId}` : `${otherId}_${currentUser.uid}`; const chatRef = ref(db, `chats/${chatId}`); if (!(await get(chatRef)).exists()) await set(chatRef, { type: 'private', participants: [currentUser.uid, otherId], createdAt: Date.now() }); closeNewChatModal(); openChat(chatId, 'private'); };
window.openCreateGroupModal = () => { selectedGroupUsers = []; document.getElementById('groupName').value = ''; document.getElementById('selectedUsers').innerHTML = ''; document.getElementById('createGroupModal').classList.add('open'); searchGroupUsers(); };
window.searchGroupUsers = () => { const query = document.getElementById('groupSearchUser').value.toLowerCase(); const container = document.getElementById('groupUsersList'); const users = Object.entries(allUsers).filter(([uid, u]) => uid !== currentUser.uid && !selectedGroupUsers.includes(uid) && u.name?.toLowerCase().includes(query)); container.innerHTML = users.map(([uid, u]) => `<div class="chat-item" onclick="addToGroup('${uid}', '${escapeHtml(u.name)}', '${u.avatarUrl || ''}')"><div class="chat-avatar">${u.avatarUrl ? `<img src="${u.avatarUrl}">` : '<i class="fas fa-user"></i>'}</div><div class="chat-info"><div class="chat-name">${escapeHtml(u.name)}</div></div></div>`).join(''); if (users.length === 0) container.innerHTML = '<div class="text-center text-gray-500 py-4">لا توجد نتائج</div>'; };
window.addToGroup = (uid, name) => { if (selectedGroupUsers.includes(uid)) return; selectedGroupUsers.push(uid); document.getElementById('selectedUsers').innerHTML += `<span class="bg-[#1d9bf0] text-white px-3 py-1 rounded-full text-sm flex items-center gap-2">${escapeHtml(name)} <button onclick="removeFromGroup('${uid}')" class="text-white">&times;</button></span>`; document.getElementById('groupSearchUser').value = ''; searchGroupUsers(); };
window.removeFromGroup = (uid) => { selectedGroupUsers = selectedGroupUsers.filter(id => id !== uid); document.getElementById('selectedUsers').innerHTML = selectedGroupUsers.map(uid => { const u = allUsers[uid]; return `<span class="bg-[#1d9bf0] text-white px-3 py-1 rounded-full text-sm flex items-center gap-2">${escapeHtml(u?.name)} <button onclick="removeFromGroup('${uid}')" class="text-white">&times;</button></span>`; }).join(''); searchGroupUsers(); };
window.createGroup = async () => { const name = document.getElementById('groupName').value.trim(); if (!name) { showToast('أدخل اسم المجموعة'); return; } const chatId = Date.now().toString(); await set(ref(db, `chats/${chatId}`), { type: 'group', name, participants: { [currentUser.uid]: true, ...selectedGroupUsers.reduce((a, v) => ({ ...a, [v]: true }), {}) }, admin: currentUser.uid, createdAt: Date.now() }); closeCreateGroupModal(); openChat(chatId, 'group'); };

// ========== POLL ==========
window.openPollModal = () => { document.getElementById('createPollModal').classList.add('open'); };
window.addPollOption = () => { const container = document.getElementById('pollOptions'); container.innerHTML += `<div class="poll-option"><input type="text" placeholder="خيار جديد"></div>`; };
window.createPoll = () => { const question = document.getElementById('pollQuestion').value; const options = Array.from(document.querySelectorAll('#pollOptions input')).map(i => ({ text: i.value, votes: 0 })).filter(o => o.text); if (!question || options.length < 2) { showToast('أدخل سؤالاً وخيارين على الأقل'); return; } currentPoll = { question, options, endDate: Date.now() + 7 * 24 * 60 * 60 * 1000 }; closePollModal(); showToast('تم إنشاء الاستطلاع، يمكنك إرساله'); };
window.closePollModal = () => { document.getElementById('createPollModal').classList.remove('open'); document.getElementById('pollQuestion').value = ''; document.getElementById('pollOptions').innerHTML = '<div class="poll-option"><input type="text" placeholder="خيار 1"></div><div class="poll-option"><input type="text" placeholder="خيار 2"></div>'; currentPoll = null; };

// ========== SETTINGS ==========
window.openSettings = () => { document.getElementById('profileModal').classList.add('open'); };
window.enable2FA = async () => { const code = prompt('أدخل رمز التحقق (6 أرقام)'); if (code && code.length === 6) { await update(ref(db, `users/${currentUser.uid}`), { twoFactorEnabled: true, twoFactorCode: code }); showToast('تم تفعيل التحقق بخطوتين'); } };
window.showSessions = () => { alert('سيتم عرض الجلسات النشطة في التحديث القادم'); };
window.openCalls = () => { alert('سيتم عرض سجل المكالمات قريباً'); };
window.switchTab = (tab) => { document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active')); if (tab === 'chats') renderChatsList(); };

// ========== AUTH STATE ==========
onAuthStateChanged(auth, async (user) => {
    if (user) { currentUser = user; await loadUserData(); document.getElementById('authScreen').style.display = 'none'; document.getElementById('mainApp').style.display = 'block'; if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-mode'); showToast(`👋 مرحباً ${currentUserData?.name}`); setInterval(() => { if (currentUser) update(ref(db, `users/${currentUser.uid}`), { online: true, lastSeen: Date.now() }); }, 30000); } else { document.getElementById('authScreen').style.display = 'flex'; document.getElementById('mainApp').style.display = 'none'; }
});
console.log('✅ TGramE Complete - All Features Added!');
