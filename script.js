import { auth, db, collection, doc, setDoc, getDoc, getDocs, updateDoc, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, CLOUD_NAME, UPLOAD_PRESET, AGORA_APP_ID } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ========== GLOBAL VARIABLES ==========
let currentUser = null;
let currentUserData = null;
let allUsers = {};
let activeChatId = null;
let activeChatUser = null;
let unsubscribeMessages = null;
let unsubscribeChats = null;

// Agora Variables
let agoraClient = null;
let localTracks = null;
let isCallActive = false;
let isMuted = false;
let isVideoOff = false;

// ========== DOM ELEMENTS ==========
const userAvatar = document.getElementById('userAvatar');
const chatList = document.getElementById('chatList');
const messageArea = document.getElementById('messageArea');
const activeName = document.getElementById('activeName');
const activeStatus = document.getElementById('activeStatus');
const activeAvatar = document.getElementById('activeAvatar');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const uploadBtn = document.getElementById('uploadBtn');
const userSearch = document.getElementById('userSearch');
const audioCallBtn = document.getElementById('audioCallBtn');
const videoCallBtn = document.getElementById('videoCallBtn');
const logoutBtn = document.getElementById('logoutBtn');
const searchIcon = document.getElementById('searchIcon');
const settingsIcon = document.getElementById('settingsIcon');
const chatsIcon = document.getElementById('chatsIcon');

// Modals
const searchModal = document.getElementById('searchModal');
const profileModal = document.getElementById('profileModal');
const callOverlay = document.getElementById('callOverlay');
const searchUsernameInput = document.getElementById('searchUsernameInput');
const searchResults = document.getElementById('searchResults');
const closeSearchModal = document.getElementById('closeSearchModal');
const profileName = document.getElementById('profileName');
const profileUsername = document.getElementById('profileUsername');
const profileBio = document.getElementById('profileBio');
const profileAvatarLarge = document.getElementById('profileAvatarLarge');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const changePhotoBtn = document.getElementById('changePhotoBtn');
const closeProfileModal = document.getElementById('closeProfileModal');
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const toggleMuteBtn = document.getElementById('toggleMuteBtn');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const endCallBtn = document.getElementById('endCallBtn');

// ========== TOAST FUNCTION ==========
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = isError ? '#dc2626' : '#2a3942';
    toast.style.opacity = '1';
    setTimeout(() => {
        toast.style.opacity = '0';
    }, 3000);
}

// ========== AUTH ==========
// Check if user is logged in, if not prompt for login/register
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await loadUserData();
        await loadAllUsers();
        setupChatsListener();
        updateUI();
        showToast(`👋 مرحباً ${currentUserData?.name || currentUser.email}`);
    } else {
        // Show login/register prompt
        const action = prompt("تسجيل الدخول أو إنشاء حساب؟\nأدخل 'login' للدخول أو 'register' للتسجيل:");
        if (action === 'login') {
            const email = prompt("البريد الإلكتروني:");
            const password = prompt("كلمة المرور:");
            try {
                await signInWithEmailAndPassword(auth, email, password);
                showToast("✅ تم تسجيل الدخول");
            } catch (error) {
                showToast("❌ فشل تسجيل الدخول: " + error.message, true);
                location.reload();
            }
        } else if (action === 'register') {
            const email = prompt("البريد الإلكتروني:");
            const password = prompt("كلمة المرور (6 أحرف على الأقل):");
            const name = prompt("الاسم:");
            let username = prompt("اسم المستخدم (بدون @):");
            username = username?.toLowerCase().replace(/[^a-z0-9_]/g, '');
            
            if (!email || !password || !name || !username) {
                showToast("❌ جميع الحقول مطلوبة", true);
                location.reload();
                return;
            }
            
            try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                await setDoc(doc(db, 'users', userCredential.user.uid), {
                    name: name,
                    username: username,
                    email: email,
                    bio: '✨ مرحباً! أنا على VibeChat',
                    avatarUrl: '',
                    status: 'online',
                    lastSeen: new Date(),
                    createdAt: new Date()
                });
                showToast("✅ تم إنشاء الحساب بنجاح");
            } catch (error) {
                showToast("❌ فشل إنشاء الحساب: " + error.message, true);
                location.reload();
            }
        } else {
            showToast("❌ إجراء غير صالح، يرجى تحديث الصفحة", true);
        }
    }
});

async function loadUserData() {
    try {
        const docRef = doc(db, 'users', currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            currentUserData = { id: docSnap.id, ...docSnap.data() };
        } else {
            // Create user document if not exists
            const username = currentUser.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
            await setDoc(doc(db, 'users', currentUser.uid), {
                name: currentUser.email.split('@')[0],
                username: username,
                email: currentUser.email,
                bio: '✨ مرحباً! أنا على VibeChat',
                avatarUrl: '',
                status: 'online',
                lastSeen: new Date(),
                createdAt: new Date()
            });
            currentUserData = { id: currentUser.uid, name: currentUser.email.split('@')[0], username: username };
        }
        await updateDoc(doc(db, 'users', currentUser.uid), { status: 'online', lastSeen: new Date() });
    } catch (error) {
        console.error('Load user error:', error);
    }
}

async function loadAllUsers() {
    try {
        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);
        allUsers = {};
        snapshot.docs.forEach(docSnap => {
            allUsers[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
        });
    } catch (error) {
        console.error('Load users error:', error);
    }
}

function updateUI() {
    if (currentUserData) {
        const avatarDiv = userAvatar;
        avatarDiv.innerHTML = '';
        if (currentUserData.avatarUrl) {
            avatarDiv.innerHTML = `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover rounded-full">`;
        } else {
            avatarDiv.innerHTML = `<i data-lucide="user" class="w-5 h-5 text-white"></i>`;
            setTimeout(() => lucide.createIcons(), 100);
        }
    }
}

// ========== CHATS ==========
function setupChatsListener() {
    if (unsubscribeChats) unsubscribeChats();
    
    const chatsRef = collection(db, 'chats');
    const q = query(chatsRef, where('participants', 'array-contains', currentUser.uid), orderBy('lastMessageTime', 'desc'));
    
    unsubscribeChats = onSnapshot(q, async (snapshot) => {
        const chats = [];
        for (const docSnap of snapshot.docs) {
            const chat = { id: docSnap.id, ...docSnap.data() };
            const otherId = chat.participants.find(id => id !== currentUser.uid);
            const otherUser = allUsers[otherId];
            if (otherUser) {
                chats.push({
                    id: chat.id,
                    otherId: otherId,
                    name: otherUser.name,
                    username: otherUser.username,
                    avatarUrl: otherUser.avatarUrl,
                    lastMessage: chat.lastMessage || '',
                    lastMessageTime: chat.lastMessageTime,
                    status: otherUser.status
                });
            }
        }
        renderChatsList(chats);
    });
}

function renderChatsList(chats) {
    if (chats.length === 0) {
        chatList.innerHTML = `
            <div class="flex flex-col items-center justify-center h-64 text-gray-500">
                <i data-lucide="message-circle" class="w-12 h-12 mb-2"></i>
                <p>لا توجد محادثات بعد</p>
                <p class="text-xs mt-1">ابحث عن مستخدمين لبدء المحادثة</p>
            </div>
        `;
        setTimeout(() => lucide.createIcons(), 100);
        return;
    }
    
    chatList.innerHTML = chats.map(chat => `
        <div class="chat-item p-3 flex items-center gap-3 cursor-pointer hover:bg-[#2a3942] transition rounded-xl mx-2 my-1 ${activeChatId === chat.id ? 'bg-[#2a3942]' : ''}" onclick="window.selectChat('${chat.id}', '${chat.otherId}')">
            <div class="relative">
                <div class="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center overflow-hidden">
                    ${chat.avatarUrl ? `<img src="${chat.avatarUrl}" class="w-full h-full object-cover">` : `<i data-lucide="user" class="w-6 h-6 text-white"></i>`}
                </div>
                ${chat.status === 'online' ? '<span class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#202c33]"></span>' : ''}
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-baseline">
                    <span class="font-semibold truncate">${escapeHtml(chat.name)}</span>
                    <span class="text-xs text-gray-500">@${escapeHtml(chat.username)}</span>
                </div>
                <p class="text-sm text-gray-400 truncate">${escapeHtml(chat.lastMessage?.substring(0, 40) || 'ابدأ المحادثة')}</p>
            </div>
        </div>
    `).join('');
    
    setTimeout(() => lucide.createIcons(), 100);
}

window.selectChat = async (chatId, otherId) => {
    if (unsubscribeMessages) unsubscribeMessages();
    
    activeChatId = chatId;
    activeChatUser = allUsers[otherId];
    
    // Update header
    activeName.textContent = activeChatUser?.name || 'مستخدم';
    activeStatus.textContent = activeChatUser?.status === 'online' ? '🟢 متصل الآن' : 'غير متصل';
    activeAvatar.innerHTML = activeChatUser?.avatarUrl ? `<img src="${activeChatUser.avatarUrl}" class="w-full h-full object-cover rounded-full">` : `<i data-lucide="user" class="w-5 h-5 text-gray-400"></i>`;
    
    // Load messages
    loadMessages(chatId);
    
    // Update UI
    renderChatsList([]);
    setupChatsListener();
    setTimeout(() => lucide.createIcons(), 100);
};

function loadMessages(chatId) {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    
    messageArea.innerHTML = '<div class="flex justify-center items-center h-32"><div class="spinner"></div></div>';
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            messageArea.innerHTML = `
                <div class="flex flex-col items-center justify-center h-64 text-gray-500">
                    <i data-lucide="message-circle" class="w-12 h-12 mb-2"></i>
                    <p>لا توجد رسائل بعد</p>
                    <p class="text-xs mt-1">أرسل رسالة لبدء المحادثة</p>
                </div>
            `;
            setTimeout(() => lucide.createIcons(), 100);
            return;
        }
        
        messageArea.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const msg = docSnap.data();
            const isSent = msg.senderId === currentUser.uid;
            const time = msg.timestamp?.toDate ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            let content = '';
            
            if (msg.text) {
                content = `<div class="message-bubble ${isSent ? 'message-sent' : 'message-received'} p-3 rounded-2xl max-w-[70%] break-words">${escapeHtml(msg.text)}</div>`;
            } else if (msg.media) {
                if (msg.media.type === 'image') {
                    content = `<div class="message-media cursor-pointer" onclick="window.openImageModal('${msg.media.url}')"><img src="${msg.media.url}" class="max-w-[250px] max-h-[250px] rounded-xl object-cover"></div>`;
                } else if (msg.media.type === 'video') {
                    content = `<video controls src="${msg.media.url}" class="max-w-[250px] max-h-[250px] rounded-xl"></video>`;
                } else if (msg.media.type === 'audio') {
                    content = `<audio controls src="${msg.media.url}" class="w-full"></audio>`;
                }
            }
            
            messageArea.innerHTML += `
                <div class="flex ${isSent ? 'justify-end' : 'justify-start'} message-animate">
                    <div class="max-w-[70%]">
                        ${content}
                        <div class="text-xs text-gray-500 mt-1 ${isSent ? 'text-right' : 'text-left'}">${time}</div>
                    </div>
                </div>
            `;
        });
        
        messageArea.scrollTop = messageArea.scrollHeight;
        setTimeout(() => lucide.createIcons(), 100);
    });
}

// ========== SEND MESSAGE ==========
window.sendMessage = async () => {
    const text = messageInput.value.trim();
    if (!text && !selectedMediaFile) return;
    if (!activeChatId) {
        showToast("❌ اختر محادثة أولاً", true);
        return;
    }
    
    let media = null;
    if (selectedMediaFile) {
        showToast("📤 جاري الرفع...");
        try {
            const result = await uploadMedia(selectedMediaFile);
            media = { url: result.url, type: result.type };
            selectedMediaFile = null;
        } catch (error) {
            showToast("❌ فشل رفع الملف", true);
            return;
        }
    }
    
    try {
        await addDoc(collection(db, 'chats', activeChatId, 'messages'), {
            senderId: currentUser.uid,
            text: text || null,
            media: media,
            timestamp: new Date(),
            read: false
        });
        
        await updateDoc(doc(db, 'chats', activeChatId), {
            lastMessage: text || (media?.type === 'image' ? '📷 صورة' : media?.type === 'video' ? '🎥 فيديو' : '🎤 تسجيل'),
            lastMessageTime: new Date()
        });
        
        messageInput.value = '';
    } catch (error) {
        showToast("❌ فشل إرسال الرسالة", true);
    }
};

sendBtn.addEventListener('click', () => window.sendMessage());
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') window.sendMessage();
});

// ========== MEDIA UPLOAD ==========
let selectedMediaFile = null;
let cloudinaryWidget = null;

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

uploadBtn.addEventListener('click', () => {
    if (!activeChatId) {
        showToast("❌ اختر محادثة أولاً", true);
        return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        selectedMediaFile = file;
        await window.sendMessage();
    };
    input.click();
});

// ========== SEARCH USERS ==========
searchIcon.addEventListener('click', () => {
    searchModal.classList.add('open');
    searchUsernameInput.value = '';
    searchResults.innerHTML = '';
});

closeSearchModal.addEventListener('click', () => {
    searchModal.classList.remove('open');
});

searchUsernameInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
        await searchUsers();
    }
});

async function searchUsers() {
    const username = searchUsernameInput.value.toLowerCase().replace('@', '').replace(/[^a-z0-9_]/g, '');
    if (username.length < 2) return;
    
    searchResults.innerHTML = '<div class="flex justify-center py-4"><div class="spinner w-6 h-6"></div></div>';
    
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('username', '>=', username), where('username', '<=', username + '\uf8ff'), limit(20));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            searchResults.innerHTML = '<div class="text-center text-gray-500 py-4">لا توجد نتائج</div>';
            return;
        }
        
        let html = '';
        snapshot.forEach(docSnap => {
            if (docSnap.id !== currentUser.uid) {
                const user = { id: docSnap.id, ...docSnap.data() };
                html += `
                    <div class="user-card flex items-center gap-3 p-3 bg-[#2a3942] rounded-xl mb-2 cursor-pointer hover:bg-[#3b4a54] transition" onclick="window.startChatWithUser('${user.id}', '${escapeHtml(user.name)}')">
                        <div class="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center overflow-hidden">
                            ${user.avatarUrl ? `<img src="${user.avatarUrl}" class="w-full h-full object-cover">` : `<i data-lucide="user" class="w-6 h-6 text-white"></i>`}
                        </div>
                        <div class="flex-1">
                            <div class="font-semibold">${escapeHtml(user.name)}</div>
                            <div class="text-sm text-gray-400">@${escapeHtml(user.username)}</div>
                            <div class="text-xs text-gray-500 truncate">${escapeHtml(user.bio)}</div>
                        </div>
                        <i data-lucide="message-circle" class="text-[#00a884] w-5 h-5"></i>
                    </div>
                `;
            }
        });
        searchResults.innerHTML = html || '<div class="text-center text-gray-500 py-4">لا توجد نتائج</div>';
        setTimeout(() => lucide.createIcons(), 100);
    } catch (error) {
        searchResults.innerHTML = '<div class="text-center text-red-500 py-4">حدث خطأ</div>';
    }
}

window.startChatWithUser = async (otherId, otherName) => {
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
        searchModal.classList.remove('open');
        await window.selectChat(chatId, otherId);
        showToast(`💬 بدأت محادثة مع ${otherName}`);
    } catch (error) {
        showToast("❌ فشل بدء المحادثة", true);
    }
};

// ========== SEARCH CHATS ==========
userSearch.addEventListener('input', () => {
    const query = userSearch.value.toLowerCase();
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => {
        const name = item.querySelector('.font-semibold')?.innerText.toLowerCase() || '';
        const username = item.querySelector('.text-xs.text-gray-500')?.innerText.toLowerCase().replace('@', '') || '';
        item.style.display = (name.includes(query) || username.includes(query)) ? 'flex' : 'none';
    });
});

// ========== PROFILE ==========
userAvatar.addEventListener('click', () => {
    if (!currentUserData) return;
    profileName.value = currentUserData.name || '';
    profileUsername.value = currentUserData.username || '';
    profileBio.value = currentUserData.bio || '';
    profileAvatarLarge.innerHTML = currentUserData.avatarUrl ? `<img src="${currentUserData.avatarUrl}" class="w-full h-full object-cover">` : `<i data-lucide="user" class="w-12 h-12 text-white"></i>`;
    profileModal.classList.add('open');
    setTimeout(() => lucide.createIcons(), 100);
});

closeProfileModal.addEventListener('click', () => {
    profileModal.classList.remove('open');
});

saveProfileBtn.addEventListener('click', async () => {
    const name = profileName.value.trim();
    let username = profileUsername.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const bio = profileBio.value;
    
    if (!name) {
        showToast("❌ الاسم مطلوب", true);
        return;
    }
    if (!username) username = name.toLowerCase().replace(/\s/g, '');
    
    try {
        await updateDoc(doc(db, 'users', currentUser.uid), {
            name: name,
            username: username,
            bio: bio
        });
        currentUserData.name = name;
        currentUserData.username = username;
        currentUserData.bio = bio;
        showToast("✅ تم تحديث الملف الشخصي");
        profileModal.classList.remove('open');
        updateUI();
    } catch (error) {
        showToast("❌ فشل التحديث", true);
    }
});

changePhotoBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        showToast("📤 جاري رفع الصورة...");
        try {
            const result = await uploadMedia(file);
            await updateDoc(doc(db, 'users', currentUser.uid), { avatarUrl: result.url });
            currentUserData.avatarUrl = result.url;
            showToast("✅ تم تحديث الصورة");
            profileModal.classList.remove('open');
            updateUI();
            location.reload();
        } catch (error) {
            showToast("❌ فشل رفع الصورة", true);
        }
    };
    input.click();
});

// ========== CALLS ==========
audioCallBtn.addEventListener('click', () => startCall('audio'));
videoCallBtn.addEventListener('click', () => startCall('video'));
endCallBtn.addEventListener('click', endCall);
toggleMuteBtn.addEventListener('click', toggleMute);
toggleVideoBtn.addEventListener('click', toggleVideo);

async function startCall(type) {
    if (!activeChatId) {
        showToast("❌ اختر محادثة أولاً", true);
        return;
    }
    
    callOverlay.classList.remove('hidden');
    const channelName = `call_${activeChatId}`;
    
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
        
        isCallActive = true;
        showToast("📞 جاري الاتصال...");
        
    } catch (error) {
        console.error("Call error:", error);
        showToast("❌ فشل الاتصال", true);
        endCall();
    }
}

function endCall() {
    if (localTracks) {
        localTracks.forEach(track => track.close());
    }
    if (agoraClient) {
        agoraClient.leave();
    }
    callOverlay.classList.remove('hidden');
    callOverlay.classList.add('hidden');
    localTracks = null;
    agoraClient = null;
    isCallActive = false;
    isMuted = false;
    isVideoOff = false;
    showToast("📞 انتهت المكالمة");
}

function toggleMute() {
    if (localTracks && localTracks[0]) {
        isMuted = !isMuted;
        localTracks[0].setEnabled(!isMuted);
        toggleMuteBtn.innerHTML = isMuted ? '<i data-lucide="mic-off" class="w-6 h-6"></i>' : '<i data-lucide="mic" class="w-6 h-6"></i>';
        setTimeout(() => lucide.createIcons(), 100);
    }
}

function toggleVideo() {
    if (localTracks && localTracks[1]) {
        isVideoOff = !isVideoOff;
        localTracks[1].setEnabled(!isVideoOff);
        toggleVideoBtn.innerHTML = isVideoOff ? '<i data-lucide="video-off" class="w-6 h-6"></i>' : '<i data-lucide="video" class="w-6 h-6"></i>';
        setTimeout(() => lucide.createIcons(), 100);
    }
}

// ========== LOGOUT ==========
logoutBtn.addEventListener('click', async () => {
    if (currentUser) {
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { status: 'offline', lastSeen: new Date() });
        } catch (e) {}
    }
    signOut(auth);
    location.reload();
});

// ========== IMAGE MODAL ==========
window.openImageModal = (url) => {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/95 z-[2000] flex items-center justify-center cursor-pointer';
    modal.onclick = () => modal.remove();
    modal.innerHTML = `
        <img src="${url}" class="max-w-[95%] max-h-[95%] object-contain rounded-xl">
        <button class="absolute top-4 right-4 text-white text-2xl">&times;</button>
    `;
    document.body.appendChild(modal);
};

// ========== UTILITIES ==========
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== ONLINE STATUS ==========
setInterval(async () => {
    if (currentUser) {
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { status: 'online', lastSeen: new Date() });
        } catch (e) {}
    }
}, 30000);

window.addEventListener('beforeunload', async () => {
    if (currentUser) {
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { status: 'offline', lastSeen: new Date() });
        } catch (e) {}
    }
});

console.log('✅ VibeChat Ready');
