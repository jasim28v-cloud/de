import { auth, db, ref, push, set, onValue, update, get, child, CLOUD_NAME, UPLOAD_PRESET } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

// ========== المتغيرات العامة ==========
let currentUser = null;
let currentUserData = null;
let allUsers = {};
let allPosts = [];
let allStories = [];
let selectedMediaFile = null;
let selectedMediaType = null;
let currentChatUserId = null;
let viewingProfileUserId = null;
let currentPostForComments = null;
let mediaRecorder = null;
let audioChunks = [];

const ADMIN_EMAILS = ['jasim28v@gmail.com'];
let isAdmin = false;

// ========== المصادقة ==========
window.switchAuth = function(type) {
    const tabs = document.querySelectorAll('.auth-tab');
    const forms = document.querySelectorAll('.auth-form');
    tabs.forEach(t => t.classList.remove('active'));
    forms.forEach(f => f.classList.remove('active'));
    if (type === 'login') {
        tabs[0].classList.add('active');
        document.getElementById('loginForm').classList.add('active');
    } else {
        tabs[1].classList.add('active');
        document.getElementById('registerForm').classList.add('active');
    }
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
            name, email, bio: '', avatarUrl: '', coverUrl: '', followers: {}, following: {}, createdAt: Date.now()
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
}
onValue(ref(db, 'users'), (s) => { allUsers = s.val() || {}; });

// ========== رفع الوسائط ==========
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

// ========== عرض المنشورات ==========
onValue(ref(db, 'posts'), (s) => {
    const data = s.val();
    if (!data) { allPosts = []; renderFeed(); return; }
    allPosts = [];
    Object.keys(data).forEach(key => allPosts.push({ id: key, ...data[key] }));
    allPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    renderFeed();
});

function renderFeed() {
    const container = document.getElementById('feedContainer');
    if (!container) return;
    container.innerHTML = '';
    if (allPosts.length === 0) {
        container.innerHTML = '<div class="loading"><div class="spinner"></div><span>✨ لا توجد منشورات بعد</span></div>';
        return;
    }
    allPosts.forEach(post => {
        const user = allUsers[post.sender] || { name: post.senderName || 'user', avatarUrl: '' };
        const isLiked = post.likedBy && post.likedBy[currentUser?.uid];
        const commentsCount = post.comments ? Object.keys(post.comments).length : 0;
        let mediaHtml = '';
        if (post.mediaUrl) {
            if (post.mediaType === 'image') mediaHtml = `<div class="tweet-media"><img src="${post.mediaUrl}" loading="lazy"></div>`;
            else if (post.mediaType === 'video') mediaHtml = `<div class="tweet-media"><video controls src="${post.mediaUrl}"></video></div>`;
            else if (post.mediaType === 'audio') mediaHtml = `<div class="tweet-media"><audio controls src="${post.mediaUrl}"></audio></div>`;
        }
        const div = document.createElement('div');
        div.className = 'tweet-card';
        div.innerHTML = `
            <div class="tweet-header">
                <div class="tweet-avatar" onclick="viewProfile('${post.sender}')">${user.avatarUrl ? `<img src="${user.avatarUrl}">` : (user.name?.charAt(0) || '👤')}</div>
                <div><div class="tweet-name" onclick="viewProfile('${post.sender}')">${user.name}</div><div class="tweet-username">@${user.name?.toLowerCase().replace(/\s/g, '')}</div><div class="tweet-time">${new Date(post.timestamp).toLocaleString()}</div></div>
            </div>
            <div class="tweet-content">${post.text || ''}</div>
            ${mediaHtml}
            <div class="tweet-actions">
                <button class="tweet-action ${isLiked ? 'active' : ''}" onclick="toggleLike('${post.id}', this)"><i class="fas fa-heart"></i> <span>${post.likes || 0}</span></button>
                <button class="tweet-action" onclick="openCommentsModal('${post.id}')"><i class="fas fa-comment"></i> <span>${commentsCount}</span></button>
                <button class="tweet-action" onclick="sharePost('${post.id}')"><i class="fas fa-share"></i></button>
                ${post.sender === currentUser?.uid ? `<button class="tweet-action" onclick="deletePost('${post.id}')"><i class="fas fa-trash"></i></button>` : ''}
            </div>
        `;
        container.appendChild(div);
    });
}

window.deletePost = async function(postId) {
    if (!confirm('🗑️ هل أنت متأكد من حذف هذا المنشور؟')) return;
    await set(ref(db, `posts/${postId}`), null);
    showToast('✅ تم حذف المنشور');
};

// ========== إنشاء منشور ==========
window.openCompose = function() { 
    const panel = document.getElementById('composePanel');
    if (panel) panel.classList.add('open'); 
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.style.display = 'flex';
    resetCompose(); 
};
window.closeCompose = function() { 
    const panel = document.getElementById('composePanel');
    if (panel) panel.classList.remove('open'); 
    const backBtn = document.getElementById('backBtn');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none'; 
};

function resetCompose() {
    const postText = document.getElementById('postText');
    const mediaPreview = document.getElementById('mediaPreview');
    const postImage = document.getElementById('postImage');
    const postVideo = document.getElementById('postVideo');
    const postStatus = document.getElementById('postStatus');
    if (postText) postText.value = '';
    if (mediaPreview) { mediaPreview.innerHTML = ''; mediaPreview.style.display = 'none'; }
    selectedMediaFile = null;
    if (postImage) postImage.value = '';
    if (postVideo) postVideo.value = '';
    if (postStatus) postStatus.innerHTML = '';
}

window.previewMedia = function(input, type) {
    const file = input.files[0];
    if (!file) return;
    selectedMediaFile = file;
    selectedMediaType = type;
    const reader = new FileReader();
    reader.onload = function(e) {
        const mediaPreview = document.getElementById('mediaPreview');
        if (mediaPreview) {
            if (type === 'image') mediaPreview.innerHTML = `<img src="${e.target.result}" class="max-h-48 rounded-lg">`;
            else if (type === 'video') mediaPreview.innerHTML = `<video controls class="max-h-48 rounded-lg"><source src="${e.target.result}"></video>`;
            mediaPreview.style.display = 'block';
        }
    };
    reader.readAsDataURL(file);
};

window.startAudioRecording = async function() {
    const btn = document.getElementById('audioRecordBtn');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        if (btn) btn.innerHTML = '<i class="fas fa-microphone"></i>';
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
            selectedMediaType = 'audio';
            const audioUrl = URL.createObjectURL(audioBlob);
            const mediaPreview = document.getElementById('mediaPreview');
            if (mediaPreview) {
                mediaPreview.innerHTML = `<audio controls src="${audioUrl}"></audio>`;
                mediaPreview.style.display = 'block';
            }
            stream.getTracks().forEach(track => track.stop());
        };
        mediaRecorder.start();
        if (btn) btn.innerHTML = '<i class="fas fa-stop-circle text-red-500"></i>';
    } catch (err) { showToast('❌ لا يمكن الوصول إلى الميكروفون'); }
};

window.createPost = async function() {
    const text = document.getElementById('postText')?.value || '';
    if (!text.trim() && !selectedMediaFile) { showToast('✏️ اكتب شيئاً أو اختر وسائط'); return; }
    const status = document.getElementById('postStatus');
    if (status) status.innerHTML = '📤 جاري النشر...';
    let mediaUrl = '', mediaType = 'none';
    if (selectedMediaFile) {
        try {
            const result = await uploadMedia(selectedMediaFile);
            mediaUrl = result.url;
            mediaType = result.type;
        } catch (error) { 
            if (status) status.innerHTML = '❌ فشل رفع الوسائط'; 
            return;
        }
    }
    try {
        await push(ref(db, 'posts'), {
            text, mediaUrl, mediaType,
            sender: currentUser.uid,
            senderName: currentUserData?.name,
            likes: 0, likedBy: {}, retweets: {}, comments: {},
            timestamp: Date.now()
        });
        if (status) status.innerHTML = '✅ تم النشر!';
        setTimeout(() => closeCompose(), 1500);
    } catch (error) { 
        if (status) status.innerHTML = '❌ فشل النشر'; 
    }
};

// ========== التفاعلات ==========
window.toggleLike = async function(postId, btn) {
    if (!currentUser) return;
    const postRef = ref(db, `posts/${postId}`);
    const snap = await get(postRef);
    const post = snap.val();
    if (!post) return;
    let likes = post.likes || 0;
    let likedBy = post.likedBy || {};
    if (likedBy[currentUser.uid]) { 
        likes--; 
        delete likedBy[currentUser.uid]; 
    } else { 
        likes++; 
        likedBy[currentUser.uid] = true; 
        addNotification(post.sender, 'like', postId);
    }
    await update(postRef, { likes, likedBy });
    if (btn) {
        btn.classList.toggle('active');
        const span = btn.querySelector('span');
        if (span) span.innerText = likes;
    }
};

window.sharePost = function(postId) {
    const url = `${window.location.origin}?post=${postId}`;
    navigator.clipboard.writeText(url);
    showToast('✅ تم نسخ الرابط');
};

// ========== التعليقات ==========
window.openCommentsModal = async function(postId) {
    currentPostForComments = postId;
    const post = allPosts.find(p => p.id === postId);
    if (!post) return;
    const container = document.getElementById('commentsList');
    const comments = post.comments || {};
    if (!container) return;
    container.innerHTML = '';
    Object.values(comments).sort((a,b) => b.timestamp - a.timestamp).forEach(comment => {
        const user = allUsers[comment.userId] || { name: comment.username || 'user', avatarUrl: '' };
        const replies = comment.replies || {};
        const commentId = Object.keys(comments).find(k => comments[k] === comment) || Date.now();
        const commentDiv = document.createElement('div');
        commentDiv.className = 'comment-item';
        commentDiv.innerHTML = `
            <div class="comment-header"><div class="comment-avatar" onclick="viewProfile('${comment.userId}')">${user.avatarUrl ? `<img src="${user.avatarUrl}">` : (user.name?.charAt(0) || '👤')}</div><div><div class="comment-user" onclick="viewProfile('${comment.userId}')">${user.name}</div><div class="comment-time">${new Date(comment.timestamp).toLocaleString()}</div></div></div>
            <div class="comment-text">${comment.text}</div>
            <div class="reply-list" id="replies-${commentId}"></div>
            <div><button class="text-[#1d9bf0] text-sm" onclick="showReplyInput('${commentId}')"><i class="fas fa-reply"></i> رد</button></div>
            <div id="reply-input-${commentId}" class="mt-2"></div>
        `;
        const repliesContainer = commentDiv.querySelector(`#replies-${commentId}`);
        if (repliesContainer) {
            Object.values(replies).sort((a,b) => a.timestamp - b.timestamp).forEach(reply => {
                const replyUser = allUsers[reply.userId] || { name: reply.username || 'user', avatarUrl: '' };
                repliesContainer.innerHTML += `
                    <div class="reply-item"><div class="reply-header"><div class="reply-avatar">${replyUser.avatarUrl ? `<img src="${replyUser.avatarUrl}">` : (replyUser.name?.charAt(0) || '👤')}</div><div class="reply-user">${replyUser.name}</div><div class="comment-time">${new Date(reply.timestamp).toLocaleTimeString()}</div></div><div class="reply-text">${reply.text}</div></div>
                `;
            });
        }
        container.appendChild(commentDiv);
    });
    const commentsPanel = document.getElementById('commentsPanel');
    const backBtn = document.getElementById('backBtn');
    if (commentsPanel) commentsPanel.classList.add('open');
    if (backBtn) backBtn.style.display = 'flex';
};

window.closeComments = function() {
    const commentsPanel = document.getElementById('commentsPanel');
    const backBtn = document.getElementById('backBtn');
    if (commentsPanel) commentsPanel.classList.remove('open');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none';
};

window.showReplyInput = function(commentId) {
    const replyDiv = document.getElementById(`reply-input-${commentId}`);
    if (!replyDiv) return;
    if (replyDiv.innerHTML) { replyDiv.innerHTML = ''; return; }
    replyDiv.innerHTML = `<div class="flex gap-2 mt-2"><input type="text" id="reply-text-${commentId}" class="flex-1 bg-[#1a1a2a] border border-[#2a2a2a] rounded-full px-3 py-1 text-sm" placeholder="اكتب رداً..."><button onclick="addReply('${commentId}')" class="bg-[#1d9bf0] text-white px-3 py-1 rounded-full text-sm">نشر</button></div>`;
};

window.addReply = async function(commentId) {
    const input = document.getElementById(`reply-text-${commentId}`);
    const text = input?.value;
    if (!text?.trim()) return;
    const postRef = ref(db, `posts/${currentPostForComments}/comments/${commentId}/replies`);
    await push(postRef, { userId: currentUser.uid, username: currentUserData?.name, text, timestamp: Date.now() });
    if (input) input.value = '';
    openCommentsModal(currentPostForComments);
};

window.addComment = async function() {
    const input = document.getElementById('commentInput');
    const text = input?.value;
    if (!text?.trim() || !currentPostForComments) return;
    await push(ref(db, `posts/${currentPostForComments}/comments`), {
        userId: currentUser.uid, username: currentUserData?.name, text, replies: {}, timestamp: Date.now()
    });
    if (input) input.value = '';
    openCommentsModal(currentPostForComments);
    addNotification(allPosts.find(p => p.id === currentPostForComments)?.sender, 'comment', currentPostForComments);
};

// ========== الإشعارات ==========
async function addNotification(targetUserId, type, postId = null) {
    if (targetUserId === currentUser.uid) return;
    const messages = { 
        like: '❤️ أعجب بمنشورك', 
        comment: '💬 علق على منشورك', 
        follow: '👥 بدأ بمتابعتك', 
        unfollow: '👋 توقف عن متابعتك' 
    };
    await push(ref(db, `notifications/${targetUserId}`), {
        type, fromUserId: currentUser.uid, fromUsername: currentUserData?.name,
        message: messages[type], postId: postId, timestamp: Date.now(), read: false
    });
    updateNotificationBadge();
    showToast(`📢 ${messages[type]} من ${currentUserData?.name}`);
}

function updateNotificationBadge() {
    if (!currentUser?.uid) return;
    onValue(ref(db, `notifications/${currentUser.uid}`), (snap) => {
        const notifs = snap.val() || {};
        const unread = Object.values(notifs).filter(n => !n.read).length;
        const icon = document.getElementById('notifIcon');
        if (icon) {
            if (unread > 0) icon.innerHTML = `<i class="fas fa-bell"></i><span class="notification-badge">${unread > 9 ? '9+' : unread}</span>`;
            else icon.innerHTML = '<i class="far fa-bell"></i>';
        }
    });
}

window.openNotifications = async function() {
    const panel = document.getElementById('notificationsPanel');
    if (!panel) return;
    const snap = await get(child(ref(db), `notifications/${currentUser.uid}`));
    const notifs = snap.val() || {};
    const container = document.getElementById('notificationsList');
    if (!container) return;
    container.innerHTML = '';
    const sorted = Object.entries(notifs).sort((a,b) => b[1].timestamp - a[1].timestamp);
    for (const [key, n] of sorted) {
        const icon = n.type === 'like' ? '❤️' : n.type === 'comment' ? '💬' : n.type === 'follow' ? '👥' : '📢';
        const bgColor = n.read ? '' : 'bg-[#1d9bf0]/10 border-r-4 border-[#1d9bf0]';
        container.innerHTML += `
            <div class="notification-item ${bgColor} cursor-pointer hover:bg-[#1a1a2a] transition" onclick="handleNotificationClick('${n.type}', '${n.fromUserId}', '${n.postId || ''}')">
                <div class="text-2xl">${icon}</div>
                <div class="flex-1">
                    <div class="font-bold">${n.fromUsername}</div>
                    <div class="text-sm text-gray-400">${n.message}</div>
                    <div class="text-xs text-gray-500 mt-1">${new Date(n.timestamp).toLocaleString()}</div>
                </div>
            </div>
        `;
        if (!n.read) await update(ref(db, `notifications/${currentUser.uid}/${key}`), { read: true });
    }
    if (container.innerHTML === '') container.innerHTML = '<div class="text-center text-gray-500 py-10">🔔 لا توجد إشعارات</div>';
    panel.classList.add('open');
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.style.display = 'flex';
    updateNotificationBadge();
};

window.handleNotificationClick = function(type, userId, postId) {
    closeNotifications();
    if (type === 'follow') {
        viewProfile(userId);
    } else if (postId) {
        openCommentsModal(postId);
    }
};

window.closeNotifications = function() {
    const panel = document.getElementById('notificationsPanel');
    const backBtn = document.getElementById('backBtn');
    if (panel) panel.classList.remove('open');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none';
};

function showToast(message) {
    let toast = document.getElementById('customToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'customToast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1d9bf0;color:white;padding:12px 24px;border-radius:50px;z-index:1000;font-size:14px;opacity:0;transition:0.3s;pointer-events:none;';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// ========== الملف الشخصي ==========
window.openMyProfile = function() { viewProfile(currentUser.uid); };

window.viewProfile = async function(userId) {
    if (!userId) return;
    viewingProfileUserId = userId;
    await loadProfileData(userId);
    const profilePanel = document.getElementById('profilePanel');
    const backBtn = document.getElementById('backBtn');
    if (profilePanel) profilePanel.classList.add('open');
    if (backBtn) backBtn.style.display = 'flex';
};

window.closeProfile = function() {
    const profilePanel = document.getElementById('profilePanel');
    const backBtn = document.getElementById('backBtn');
    if (profilePanel) profilePanel.classList.remove('open');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none';
};

async function loadProfileData(userId) {
    const userSnap = await get(child(ref(db), `users/${userId}`));
    const user = userSnap.val();
    if (!user) return;
    
    const coverEl = document.getElementById('profileCover');
    if (coverEl) {
        if (user.coverUrl) coverEl.style.background = `url(${user.coverUrl}) center/cover`;
        else coverEl.style.background = 'linear-gradient(135deg, #1d9bf0, #f91880)';
    }
    
    const avatarEl = document.getElementById('profileAvatar');
    if (avatarEl) {
        avatarEl.innerHTML = user.avatarUrl ? `<img src="${user.avatarUrl}">` : (user.name?.charAt(0) || '👤');
    }
    
    const nameEl = document.getElementById('profileName');
    const bioEl = document.getElementById('profileBio');
    if (nameEl) nameEl.innerText = user.name;
    if (bioEl) bioEl.innerText = user.bio || '✏️ أضف سيرة ذاتية';
    
    const userPosts = allPosts.filter(p => p.sender === userId);
    const postsCountEl = document.getElementById('profilePostsCount');
    const followersCountEl = document.getElementById('profileFollowersCount');
    const followingCountEl = document.getElementById('profileFollowingCount');
    if (postsCountEl) postsCountEl.innerText = userPosts.length;
    if (followersCountEl) followersCountEl.innerText = Object.keys(user.followers || {}).length;
    if (followingCountEl) followingCountEl.innerText = Object.keys(user.following || {}).length;
    
    const grid = document.getElementById('profilePostsGrid');
    if (grid) {
        grid.innerHTML = userPosts.map(post => `
            <div class="profile-post" onclick="openCommentsModal('${post.id}')">
                ${post.mediaUrl ? (post.mediaType === 'image' ? `<img src="${post.mediaUrl}" loading="lazy">` : post.mediaType === 'video' ? `<video src="${post.mediaUrl}"></video>` : `<i class="fas fa-music text-2xl"></i>`) : `<i class="fas fa-file-alt text-2xl"></i>`}
                ${post.text ? `<div class="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 truncate">${post.text.substring(0, 30)}</div>` : ''}
            </div>
        `).join('');
        if (userPosts.length === 0) grid.innerHTML = '<div class="col-span-3 text-center text-gray-500 py-10">📭 لا توجد منشورات</div>';
    }
    
    const buttonsDiv = document.getElementById('profileButtons');
    if (buttonsDiv) {
        buttonsDiv.innerHTML = '';
        if (userId === currentUser.uid) {
            buttonsDiv.innerHTML = `
                <button class="profile-btn profile-btn-primary" onclick="openEditProfile()">✏️ تعديل الملف</button>
                <button class="profile-btn profile-btn-secondary" onclick="logout()">🚪 تسجيل خروج</button>
                ${isAdmin ? '<button class="profile-btn profile-btn-secondary" onclick="openAdmin()">🔧 لوحة التحكم</button>' : ''}
            `;
        } else {
            const isFollowing = currentUserData?.following && currentUserData.following[userId];
            buttonsDiv.innerHTML = `
                <button class="profile-btn profile-btn-primary" onclick="toggleFollow('${userId}', this)">${isFollowing ? '✅ متابع' : '➕ متابعة'}</button>
                <button class="profile-btn profile-btn-secondary" onclick="openPrivateChat('${userId}')"><i class="fas fa-envelope"></i> مراسلة</button>
            `;
        }
    }
    
    setupProfileTabs(userPosts);
}

function setupProfileTabs(userPosts) {
    const tabs = document.querySelectorAll('.profile-tab');
    const grid = document.getElementById('profilePostsGrid');
    if (!tabs.length || !grid) return;
    
    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const filter = tab.getAttribute('data-tab');
            let filtered = [...userPosts];
            if (filter === 'media') filtered = userPosts.filter(p => p.mediaUrl && p.mediaType !== 'none');
            grid.innerHTML = filtered.map(post => `
                <div class="profile-post" onclick="openCommentsModal('${post.id}')">
                    ${post.mediaUrl ? (post.mediaType === 'image' ? `<img src="${post.mediaUrl}" loading="lazy">` : post.mediaType === 'video' ? `<video src="${post.mediaUrl}"></video>` : `<i class="fas fa-music text-2xl"></i>`) : `<i class="fas fa-file-alt text-2xl"></i>`}
                </div>
            `).join('');
            if (filtered.length === 0) grid.innerHTML = '<div class="col-span-3 text-center text-gray-500 py-10">📭 لا توجد منشورات</div>';
        };
    });
}

window.openEditProfile = function() {
    const newName = prompt('الاسم الجديد:', currentUserData?.name);
    const newBio = prompt('السيرة الذاتية:', currentUserData?.bio || '');
    if (newName && newName.trim()) update(ref(db, `users/${currentUser.uid}`), { name: newName.trim() });
    if (newBio !== null) update(ref(db, `users/${currentUser.uid}`), { bio: newBio });
    if ((newName && newName.trim()) || newBio !== null) {
        showToast('✅ تم تحديث الملف الشخصي');
        setTimeout(() => location.reload(), 1000);
    }
};

window.changeAvatar = function() { document.getElementById('avatarInput')?.click(); };
window.changeCover = function() { document.getElementById('coverInput')?.click(); };

if (!document.getElementById('avatarInput')) {
    const avatarInput = document.createElement('input');
    avatarInput.type = 'file';
    avatarInput.accept = 'image/*';
    avatarInput.id = 'avatarInput';
    avatarInput.style.display = 'none';
    document.body.appendChild(avatarInput);
    avatarInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const result = await uploadMedia(file);
        await update(ref(db, `users/${currentUser.uid}`), { avatarUrl: result.url });
        showToast('✅ تم تحديث الصورة الشخصية');
        location.reload();
    });
}

if (!document.getElementById('coverInput')) {
    const coverInput = document.createElement('input');
    coverInput.type = 'file';
    coverInput.accept = 'image/*';
    coverInput.id = 'coverInput';
    coverInput.style.display = 'none';
    document.body.appendChild(coverInput);
    coverInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const result = await uploadMedia(file);
        await update(ref(db, `users/${currentUser.uid}`), { coverUrl: result.url });
        showToast('✅ تم تحديث صورة الغلاف');
        location.reload();
    });
}

// ========== المتابعة ==========
window.toggleFollow = async function(userId, btn) {
    if (!currentUser || currentUser.uid === userId) return;
    const userRef = ref(db, `users/${currentUser.uid}/following/${userId}`);
    const targetRef = ref(db, `users/${userId}/followers/${currentUser.uid}`);
    const snap = await get(userRef);
    if (snap.exists()) {
        await set(userRef, null); 
        await set(targetRef, null); 
        if (btn) btn.innerText = '➕ متابعة';
        addNotification(userId, 'unfollow');
        showToast(`👋 توقفت عن متابعة ${allUsers[userId]?.name}`);
    } else {
        await set(userRef, true); 
        await set(targetRef, true); 
        if (btn) btn.innerText = '✅ متابع';
        addNotification(userId, 'follow');
        showToast(`👥 بدأت بمتابعة ${allUsers[userId]?.name}`);
    }
    if (viewingProfileUserId === userId) await loadProfileData(userId);
};

// ========== قائمة المتابعين ==========
window.openFollowersList = async function(type) {
    const titleEl = document.getElementById('followersTitle');
    if (titleEl) titleEl.innerText = type === 'followers' ? '👥 المتابعون' : '👤 المتابَعون';
    const panel = document.getElementById('followersPanel');
    const container = document.getElementById('followersList');
    const user = viewingProfileUserId ? allUsers[viewingProfileUserId] : currentUserData;
    const list = type === 'followers' ? user?.followers : user?.following;
    if (!container) return;
    container.innerHTML = '';
    if (list) {
        for (const [uid] of Object.entries(list)) {
            const u = allUsers[uid];
            if (u) {
                container.innerHTML += `<div class="follower-item" onclick="viewProfile('${uid}')"><div class="w-12 h-12 rounded-full bg-[#1d9bf0] flex items-center justify-center overflow-hidden">${u.avatarUrl ? `<img src="${u.avatarUrl}">` : (u.name?.charAt(0) || 'U')}</div><div><div class="font-bold">${u.name}</div><div class="text-sm text-gray-500">@${u.name?.toLowerCase().replace(/\s/g, '')}</div></div></div>`;
            }
        }
    }
    if (container.innerHTML === '') container.innerHTML = '<div class="text-center text-gray-500 py-10">👻 لا يوجد مستخدمين</div>';
    if (panel) panel.classList.add('open');
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.style.display = 'flex';
};
window.closeFollowers = function() {
    const panel = document.getElementById('followersPanel');
    const backBtn = document.getElementById('backBtn');
    if (panel) panel.classList.remove('open');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none';
};

// ========== الدردشة ==========
function getChatId(uid1, uid2) { return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`; }

window.openConversations = async function() {
    const panel = document.getElementById('conversationsPanel');
    const container = document.getElementById('conversationsList');
    if (!panel || !container) return;
    const convSnap = await get(child(ref(db), `private_chats/${currentUser.uid}`));
    const conversations = convSnap.val() || {};
    container.innerHTML = '';
    for (const [otherId, convData] of Object.entries(conversations)) {
        const otherUser = allUsers[otherId];
        if (otherUser) {
            container.innerHTML += `<div class="conversation-item" onclick="openPrivateChat('${otherId}')"><div class="w-12 h-12 rounded-full bg-[#1d9bf0] flex items-center justify-center overflow-hidden">${otherUser.avatarUrl ? `<img src="${otherUser.avatarUrl}">` : (otherUser.name?.charAt(0) || 'U')}</div><div><div class="font-bold">${otherUser.name}</div><div class="text-sm text-gray-500">${convData.lastMessage?.substring(0, 40) || 'رسالة'}</div></div></div>`;
        }
    }
    if (container.innerHTML === '') container.innerHTML = '<div class="text-center text-gray-500 py-10">💬 لا توجد محادثات بعد</div>';
    panel.classList.add('open');
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.style.display = 'flex';
};
window.closeConversations = function() {
    const panel = document.getElementById('conversationsPanel');
    const backBtn = document.getElementById('backBtn');
    if (panel) panel.classList.remove('open');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none';
};

window.openPrivateChat = async function(otherUserId) {
    currentChatUserId = otherUserId;
    const user = allUsers[otherUserId];
    const userNameEl = document.getElementById('chatUserName');
    const chatAvatarEl = document.getElementById('chatAvatar');
    if (userNameEl) userNameEl.innerText = user?.name || 'مستخدم';
    if (chatAvatarEl) chatAvatarEl.innerHTML = user?.avatarUrl ? `<img src="${user.avatarUrl}">` : (user?.name?.charAt(0) || 'U');
    await loadPrivateMessages(otherUserId);
    const chatPanel = document.getElementById('chatPanel');
    const backBtn = document.getElementById('backBtn');
    if (chatPanel) chatPanel.classList.add('open');
    if (backBtn) backBtn.style.display = 'flex';
    closeConversations();
};
window.closeChat = function() {
    const chatPanel = document.getElementById('chatPanel');
    const backBtn = document.getElementById('backBtn');
    if (chatPanel) chatPanel.classList.remove('open');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none';
    currentChatUserId = null;
};

async function loadPrivateMessages(otherUserId) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '<div class="text-center text-gray-500 py-10">⏳ جاري التحميل...</div>';
    const chatId = getChatId(currentUser.uid, otherUserId);
    const messagesSnap = await get(child(ref(db), `private_messages/${chatId}`));
    const messages = messagesSnap.val() || {};
    container.innerHTML = '';
    const sorted = Object.entries(messages).sort((a,b)=>a[1].timestamp-b[1].timestamp);
    for (const [id, msg] of sorted) {
        const isSent = msg.senderId === currentUser.uid;
        const time = new Date(msg.timestamp).toLocaleTimeString();
        let content = '';
        if (msg.type === 'text') content = `<div class="message-bubble ${isSent ? 'sent' : 'received'}">${escapeHtml(msg.text)}</div>`;
        else if (msg.type === 'image') content = `<img src="${msg.imageUrl}" class="message-image" onclick="window.open('${msg.imageUrl}')">`;
        else if (msg.type === 'audio') content = `<div class="message-audio"><audio controls src="${msg.audioUrl}"></audio></div>`;
        container.innerHTML += `<div class="chat-message ${isSent ? 'sent' : 'received'}"><div>${content}<div class="text-[10px] opacity-50 mt-1">${time}</div></div></div>`;
    }
    if (container.innerHTML === '') container.innerHTML = '<div class="text-center text-gray-500 py-10">💬 لا توجد رسائل بعد</div>';
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.sendChatMessage = async function() {
    const input = document.getElementById('chatMessageInput');
    const text = input?.value.trim();
    if (!text || !currentChatUserId) return;
    const chatId = getChatId(currentUser.uid, currentChatUserId);
    await push(ref(db, `private_messages/${chatId}`), { senderId: currentUser.uid, senderName: currentUserData?.name, text, type: 'text', timestamp: Date.now() });
    await set(ref(db, `private_chats/${currentUser.uid}/${currentChatUserId}`), { lastMessage: text, lastTimestamp: Date.now(), withUser: currentChatUserId });
    await set(ref(db, `private_chats/${currentChatUserId}/${currentUser.uid}`), { lastMessage: text, lastTimestamp: Date.now(), withUser: currentUser.uid });
    if (input) input.value = '';
    await loadPrivateMessages(currentChatUserId);
};

window.sendChatImage = async function(input) {
    const file = input.files[0];
    if (!file || !currentChatUserId) return;
    const result = await uploadMedia(file);
    const chatId = getChatId(currentUser.uid, currentChatUserId);
    await push(ref(db, `private_messages/${chatId}`), { senderId: currentUser.uid, senderName: currentUserData?.name, imageUrl: result.url, type: 'image', timestamp: Date.now() });
    await set(ref(db, `private_chats/${currentUser.uid}/${currentChatUserId}`), { lastMessage: '📷 صورة', lastTimestamp: Date.now(), withUser: currentChatUserId });
    await set(ref(db, `private_chats/${currentChatUserId}/${currentUser.uid}`), { lastMessage: '📷 صورة', lastTimestamp: Date.now(), withUser: currentUser.uid });
    input.value = '';
    await loadPrivateMessages(currentChatUserId);
};

window.startRecordingChat = async function() {
    const btn = document.getElementById('chatRecordBtn');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        if (btn) btn.innerHTML = '<i class="fas fa-microphone"></i>';
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
            const result = await uploadMedia(audioFile);
            if (currentChatUserId) {
                const chatId = getChatId(currentUser.uid, currentChatUserId);
                await push(ref(db, `private_messages/${chatId}`), { senderId: currentUser.uid, senderName: currentUserData?.name, audioUrl: result.url, type: 'audio', timestamp: Date.now() });
                await set(ref(db, `private_chats/${currentUser.uid}/${currentChatUserId}`), { lastMessage: '🎤 رسالة صوتية', lastTimestamp: Date.now(), withUser: currentChatUserId });
                await set(ref(db, `private_chats/${currentChatUserId}/${currentUser.uid}`), { lastMessage: '🎤 رسالة صوتية', lastTimestamp: Date.now(), withUser: currentUser.uid });
                await loadPrivateMessages(currentChatUserId);
            }
            stream.getTracks().forEach(track => track.stop());
        };
        mediaRecorder.start();
        if (btn) btn.innerHTML = '<i class="fas fa-stop-circle text-red-500"></i>';
    } catch (err) { showToast('❌ لا يمكن الوصول إلى الميكروفون'); }
};

// ========== القصص ==========
onValue(ref(db, 'stories'), (s) => {
    const data = s.val();
    const now = Date.now();
    const activeStories = [];
    if (data) {
        Object.keys(data).forEach(key => {
            const story = data[key];
            if (story.timestamp && (now - story.timestamp) < 24*60*60*1000) activeStories.push({ id: key, ...story });
        });
    }
    renderStories(activeStories);
});

function renderStories(stories) {
    const container = document.getElementById('storiesList');
    if (!container) return;
    container.innerHTML = `<div class="story-card" onclick="addStory()"><div class="add-story-btn"><i class="fas fa-plus"></i></div><div class="story-name">أضف قصة</div></div>`;
    stories.forEach(story => {
        const user = allUsers[story.sender] || { name: 'مستخدم', avatarUrl: '' };
        container.innerHTML += `
            <div class="story-card" onclick="viewStory('${story.mediaUrl}')">
                <div class="story-ring"><img class="story-avatar" src="${user.avatarUrl || 'https://via.placeholder.com/80'}"></div>
                <div class="story-name">${user.name}</div>
            </div>
        `;
    });
}

window.viewStory = function(mediaUrl) {
    window.open(mediaUrl, '_blank');
};

window.openStories = function() {
    const panel = document.getElementById('storiesPanel');
    const backBtn = document.getElementById('backBtn');
    if (panel) panel.classList.add('open');
    if (backBtn) backBtn.style.display = 'flex';
};
window.closeStories = function() {
    const panel = document.getElementById('storiesPanel');
    const backBtn = document.getElementById('backBtn');
    if (panel) panel.classList.remove('open');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none';
};
window.addStory = async function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const result = await uploadMedia(file);
        await push(ref(db, 'stories'), { mediaUrl: result.url, mediaType: result.type, sender: currentUser.uid, timestamp: Date.now() });
        showToast('✅ تم إضافة القصة');
    };
    input.click();
};

// ========== البحث ==========
window.openSearch = function() {
    const panel = document.getElementById('searchPanel');
    const backBtn = document.getElementById('backBtn');
    if (panel) panel.classList.add('open');
    if (backBtn) backBtn.style.display = 'flex';
};
window.closeSearch = function() {
    const panel = document.getElementById('searchPanel');
    const backBtn = document.getElementById('backBtn');
    if (panel) panel.classList.remove('open');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none';
};
window.searchAll = function() {
    const input = document.getElementById('searchInput');
    const query = input?.value.toLowerCase() || '';
    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;
    if (!query) { resultsDiv.innerHTML = ''; return; }
    const users = Object.values(allUsers).filter(u => u.name?.toLowerCase().includes(query));
    resultsDiv.innerHTML = users.map(u => `<div class="search-result" onclick="viewProfile('${u.uid}')"><div class="w-10 h-10 rounded-full bg-pink-500 flex items-center justify-center overflow-hidden">${u.avatarUrl ? `<img src="${u.avatarUrl}">` : (u.name?.charAt(0) || 'U')}</div><div><div class="font-bold">${u.name}</div><div class="text-sm text-gray-500">@${u.name?.toLowerCase().replace(/\s/g, '')}</div></div></div>`).join('');
    if (users.length === 0) resultsDiv.innerHTML = '<div class="text-center text-gray-500 py-10">🔍 لا توجد نتائج</div>';
};

// ========== لوحة الأدمن ==========
window.openAdmin = async function() {
    if (!isAdmin) return;
    const statsDiv = document.getElementById('adminStats');
    const usersListDiv = document.getElementById('adminUsersList');
    const postsListDiv = document.getElementById('adminPostsList');
    if (statsDiv) {
        statsDiv.innerHTML = `
            <div class="admin-stat"><div class="text-xl font-bold">${Object.keys(allUsers).length}</div><div>👥 مستخدمين</div></div>
            <div class="admin-stat"><div class="text-xl font-bold">${allPosts.length}</div><div>📝 منشورات</div></div>
            <div class="admin-stat"><div class="text-xl font-bold">${allPosts.reduce((s,p)=>s+(p.likes||0),0)}</div><div>❤️ إعجابات</div></div>
        `;
    }
    if (usersListDiv) {
        usersListDiv.innerHTML = '<h4 class="font-bold mt-4">👥 إدارة المستخدمين</h4>';
        Object.entries(allUsers).forEach(([uid, u]) => {
            if (uid !== currentUser.uid) {
                usersListDiv.innerHTML += `<div class="flex justify-between items-center p-2 border-b"><span>@${u.name}</span><button class="admin-delete-btn" onclick="adminDeleteUser('${uid}')">🗑️ حذف</button></div>`;
            }
        });
    }
    if (postsListDiv) {
        postsListDiv.innerHTML = '<h4 class="font-bold mt-4">📝 إدارة المنشورات</h4>';
        allPosts.slice(0, 10).forEach(post => {
            postsListDiv.innerHTML += `<div class="flex justify-between items-center p-2 border-b"><span>${post.text?.substring(0, 40) || 'منشور'}</span><button class="admin-delete-btn" onclick="adminDeletePost('${post.id}')">🗑️ حذف</button></div>`;
        });
    }
    const adminPanel = document.getElementById('adminPanel');
    const backBtn = document.getElementById('backBtn');
    if (adminPanel) adminPanel.classList.add('open');
    if (backBtn) backBtn.style.display = 'flex';
};
window.closeAdmin = function() {
    const adminPanel = document.getElementById('adminPanel');
    const backBtn = document.getElementById('backBtn');
    if (adminPanel) adminPanel.classList.remove('open');
    if (backBtn && !document.querySelector('.panel.open')) backBtn.style.display = 'none';
};
window.adminDeleteUser = async function(userId) {
    if (!isAdmin || !confirm('⚠️ حذف هذا المستخدم وجميع منشوراته؟')) return;
    const posts = allPosts.filter(p => p.sender === userId);
    for (const post of posts) await set(ref(db, `posts/${post.id}`), null);
    await set(ref(db, `users/${userId}`), null);
    showToast('✅ تم حذف المستخدم');
    location.reload();
};
window.adminDeletePost = async function(postId) {
    if (!isAdmin || !confirm('⚠️ حذف هذا المنشور؟')) return;
    await set(ref(db, `posts/${postId}`), null);
    showToast('✅ تم حذف المنشور');
    renderFeed();
};

// ========== التنقل ==========
window.switchTab = function(tab) {
    const navItems = document.querySelectorAll('.nav-item');
    const activeItem = Array.from(navItems).find(item => item.onclick?.toString().includes(tab));
    if (activeItem) {
        navItems.forEach(t => t.classList.remove('active'));
        activeItem.classList.add('active');
    }
    if (tab === 'home') {
        closeCompose(); closeProfile(); closeChat(); closeConversations(); 
        closeNotifications(); closeSearch(); closeStories(); closeComments(); 
        closeFollowers(); closeAdmin();
    }
};
window.goToHome = function() { 
    switchTab('home'); 
    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.style.display = 'none'; 
};
window.goBack = function() {
    if (document.getElementById('commentsPanel')?.classList.contains('open')) closeComments();
    else if (document.getElementById('profilePanel')?.classList.contains('open')) closeProfile();
    else if (document.getElementById('chatPanel')?.classList.contains('open')) closeChat();
    else if (document.getElementById('conversationsPanel')?.classList.contains('open')) closeConversations();
    else if (document.getElementById('notificationsPanel')?.classList.contains('open')) closeNotifications();
    else if (document.getElementById('searchPanel')?.classList.contains('open')) closeSearch();
    else if (document.getElementById('storiesPanel')?.classList.contains('open')) closeStories();
    else if (document.getElementById('followersPanel')?.classList.contains('open')) closeFollowers();
    else if (document.getElementById('adminPanel')?.classList.contains('open')) closeAdmin();
    else if (document.getElementById('composePanel')?.classList.contains('open')) closeCompose();
    else goToHome();
};

window.toggleTheme = function() {
    document.body.classList.toggle('light-mode');
    localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
};

// ========== مراقبة المستخدم ==========
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await loadUserData();
        isAdmin = ADMIN_EMAILS.includes(currentUser.email);
        const authScreen = document.getElementById('authScreen');
        const mainApp = document.getElementById('mainApp');
        if (authScreen) authScreen.style.display = 'none';
        if (mainApp) mainApp.style.display = 'block';
        updateNotificationBadge();
        if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-mode');
        showToast(`👋 مرحباً ${currentUserData?.name || 'user'}`);
    } else {
        const authScreen = document.getElementById('authScreen');
        const mainApp = document.getElementById('mainApp');
        if (authScreen) authScreen.style.display = 'flex';
        if (mainApp) mainApp.style.display = 'none';
    }
});

console.log('✅ UltraSocial Ready - Version 3.0');
