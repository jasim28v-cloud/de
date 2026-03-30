import { firebaseConfig } from './firebase-config.js';

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();

// Admin email
const ADMIN_EMAIL = "jasim28v@gmail.com";

// Global state
let currentUser = null;
let currentView = 'home'; // home, explore, notifications, profile, admin, messages
let currentProfileUserId = null;
let currentChatUserId = null; // for direct messages
let chatMessagesRef = null;
let messageListener = null;
let voiceRecorder = null;
let recordingStream = null;
let recordedChunks = [];

// Helper functions
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('ar-EG');
}

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'الآن';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `${days} يوم`;
}

// ======================== AUTH ========================
function renderLogin() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-card glass">
        <div class="logo"><i class="fas fa-crown"></i> سوسيال ميديا</div>
        <h2>مرحباً بعودتك</h2>
        <input type="email" id="login-email" placeholder="البريد الإلكتروني" />
        <input type="password" id="login-password" placeholder="كلمة المرور" />
        <button id="login-btn">دخول</button>
        <div class="social-buttons">
          <button id="google-login-btn" class="social"><i class="fab fa-google"></i> Google</button>
          <button id="facebook-login-btn" class="social"><i class="fab fa-facebook-f"></i> Facebook</button>
        </div>
        <p>ليس لديك حساب؟ <a href="#" id="show-signup">سجل الآن</a></p>
        <p><a href="#" id="forgot-password">نسيت كلمة المرور؟</a></p>
      </div>
    </div>
  `;
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('google-login-btn').addEventListener('click', () => signInWithProvider('google'));
  document.getElementById('facebook-login-btn').addEventListener('click', () => signInWithProvider('facebook'));
  document.getElementById('show-signup').addEventListener('click', (e) => { e.preventDefault(); renderSignup(); });
  document.getElementById('forgot-password').addEventListener('click', (e) => { e.preventDefault(); forgotPassword(); });
}

function renderSignup() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-card glass">
        <div class="logo"><i class="fas fa-crown"></i> سوسيال ميديا</div>
        <h2>انضم إلينا</h2>
        <input type="email" id="signup-email" placeholder="البريد الإلكتروني" />
        <input type="text" id="signup-username" placeholder="اسم المستخدم" />
        <input type="text" id="signup-fullname" placeholder="الاسم الكامل (اختياري)" />
        <input type="password" id="signup-password" placeholder="كلمة المرور" />
        <button id="signup-btn">تسجيل</button>
        <p>لديك حساب؟ <a href="#" id="show-login">تسجيل الدخول</a></p>
      </div>
    </div>
  `;
  document.getElementById('signup-btn').addEventListener('click', signup);
  document.getElementById('show-login').addEventListener('click', (e) => { e.preventDefault(); renderLogin(); });
}

async function login() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    await auth.signInWithEmailAndPassword(email, password);
    showToast('تم تسجيل الدخول بنجاح', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function signup() {
  const email = document.getElementById('signup-email').value;
  const username = document.getElementById('signup-username').value;
  const fullName = document.getElementById('signup-fullname').value;
  const password = document.getElementById('signup-password').value;
  try {
    const userCred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = userCred.user.uid;
    await db.ref(`users/${uid}`).set({
      username: username,
      fullName: fullName,
      email: email,
      bio: '',
      website: '',
      photoURL: '',
      private: false,
      blocked: {},
      followers: {},
      following: {},
      createdAt: Date.now()
    });
    showToast('تم إنشاء الحساب بنجاح', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function signInWithProvider(providerName) {
  let provider;
  if (providerName === 'google') provider = new firebase.auth.GoogleAuthProvider();
  else provider = new firebase.auth.FacebookAuthProvider();
  try {
    const result = await auth.signInWithPopup(provider);
    const user = result.user;
    const userSnap = await db.ref(`users/${user.uid}`).once('value');
    if (!userSnap.exists()) {
      await db.ref(`users/${user.uid}`).set({
        username: user.displayName || user.email.split('@')[0],
        fullName: user.displayName || '',
        email: user.email,
        bio: '',
        website: '',
        photoURL: user.photoURL || '',
        private: false,
        blocked: {},
        followers: {},
        following: {},
        createdAt: Date.now()
      });
    }
    showToast(`مرحباً ${user.displayName}`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function forgotPassword() {
  const email = prompt('أدخل بريدك الإلكتروني لإعادة تعيين كلمة المرور');
  if (email) {
    try {
      await auth.sendPasswordResetEmail(email);
      showToast('تم إرسال رابط إعادة التعيين إلى بريدك', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }
}

// ======================== MAIN APP ========================
function renderMainApp() {
  const app = document.getElementById('app');
  const navItems = [
    { icon: 'fas fa-home', view: 'home', label: 'الرئيسية' },
    { icon: 'fas fa-compass', view: 'explore', label: 'استكشاف' },
    { icon: 'fas fa-plus-circle', view: 'create', label: 'إضافة' },
    { icon: 'fas fa-envelope', view: 'messages', label: 'الرسائل' },
    { icon: 'fas fa-heart', view: 'notifications', label: 'إشعارات' },
    { icon: 'fas fa-user', view: 'profile', label: 'حسابي' }
  ];
  if (currentUser && currentUser.email === ADMIN_EMAIL) {
    navItems.push({ icon: 'fas fa-shield-alt', view: 'admin', label: 'تحكم' });
  }

  app.innerHTML = `
    <div class="main-container">
      <div class="stories-bar" id="stories-bar"></div>
      <div class="content" id="content"></div>
      <div class="bottom-nav">
        ${navItems.map(item => `
          <div class="nav-item ${currentView === item.view ? 'active' : ''}" data-view="${item.view}">
            <i class="${item.icon}"></i>
            <span>${item.label}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Attach nav listeners
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', () => {
      currentView = el.dataset.view;
      if (currentView === 'profile') currentProfileUserId = currentUser.uid;
      if (currentView === 'create') { showCreatePostModal(); return; }
      if (currentView === 'messages') { currentChatUserId = null; }
      if (messageListener && currentView !== 'messages') {
        messageListener.off();
        messageListener = null;
      }
      renderMainApp();
    });
  });

  loadStories();
  loadViewContent();
}

async function loadViewContent() {
  const contentDiv = document.getElementById('content');
  if (!contentDiv) return;

  switch (currentView) {
    case 'home': await loadHomeFeed(contentDiv); break;
    case 'explore': await loadExploreFeed(contentDiv); break;
    case 'notifications': await loadNotifications(contentDiv); break;
    case 'profile': await loadProfile(contentDiv, currentProfileUserId); break;
    case 'messages': await loadMessagesView(contentDiv); break;
    case 'admin':
      if (currentUser && currentUser.email === ADMIN_EMAIL) await loadAdminDashboard(contentDiv);
      else currentView = 'home';
      break;
    default: await loadHomeFeed(contentDiv);
  }
}

// ======================== FEEDS & POSTS ========================
async function loadHomeFeed(container) {
  container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i> جاري التحميل...</div>';
  const snapshot = await db.ref('posts').once('value');
  const posts = [];
  snapshot.forEach(child => posts.push({ id: child.key, ...child.val() }));
  posts.sort((a, b) => b.createdAt - a.createdAt);
  renderPosts(container, posts);
}

async function loadExploreFeed(container) {
  container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i> جاري التحميل...</div>';
  const snapshot = await db.ref('posts').once('value');
  const posts = [];
  snapshot.forEach(child => posts.push({ id: child.key, ...child.val() }));
  posts.sort((a, b) => (Object.keys(b.likes || {}).length) - (Object.keys(a.likes || {}).length));
  renderPosts(container, posts);
}

function renderPosts(container, posts) {
  if (!posts.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-camera"></i> لا توجد منشورات بعد</div>';
    return;
  }
  container.innerHTML = posts.map(post => `
    <div class="post-card" data-post-id="${post.id}">
      <div class="post-header">
        <img class="avatar" src="${post.userPhoto || 'https://ui-avatars.com/api/?background=0095f6&color=fff&name=' + (post.username || 'U')}" alt="avatar">
        <div class="post-user">
          <span class="username">${post.username}</span>
          <span class="time">${formatDate(post.createdAt)}</span>
        </div>
        ${(currentUser && (currentUser.uid === post.userId || currentUser.email === ADMIN_EMAIL)) ? `<button class="delete-post-btn" data-id="${post.id}"><i class="fas fa-trash-alt"></i></button>` : ''}
      </div>
      <div class="post-media">
        ${post.type === 'video' ? `<video controls src="${post.mediaUrl}"></video>` : 
          post.type === 'audio' ? `<audio controls src="${post.mediaUrl}"></audio>` : 
          `<img src="${post.mediaUrl}" alt="post" loading="lazy">`}
      </div>
      <div class="post-actions">
        <button class="like-btn ${post.likes && post.likes[currentUser?.uid] ? 'liked' : ''}" data-post-id="${post.id}"><i class="fas fa-heart"></i> <span>${Object.keys(post.likes || {}).length}</span></button>
        <button class="comment-btn"><i class="fas fa-comment"></i> <span>${Object.keys(post.comments || {}).length}</span></button>
        <button class="share-btn"><i class="fas fa-share-alt"></i></button>
        <button class="save-btn"><i class="far fa-bookmark"></i></button>
      </div>
      <div class="post-caption">${post.caption || ''}</div>
      <div class="comments-section" id="comments-${post.id}">
        ${renderComments(post.comments)}
      </div>
      <div class="add-comment">
        <input type="text" id="comment-input-${post.id}" placeholder="أضف تعليقاً...">
        <button class="submit-comment" data-post-id="${post.id}">نشر</button>
      </div>
    </div>
  `).join('');

  // Attach like handlers
  document.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postId;
      toggleLike(postId);
    });
  });
  // Attach comment submit
  document.querySelectorAll('.submit-comment').forEach(btn => {
    btn.addEventListener('click', () => {
      const postId = btn.dataset.postId;
      const input = document.getElementById(`comment-input-${postId}`);
      if (input.value.trim()) addComment(postId, input.value.trim(), input);
    });
  });
  // Delete post (admin or owner)
  document.querySelectorAll('.delete-post-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const postId = btn.dataset.id;
      if (confirm('هل أنت متأكد من حذف هذا المنشور؟')) {
        await deletePost(postId);
      }
    });
  });
}

function renderComments(comments) {
  if (!comments) return '';
  let html = '';
  for (let key in comments) {
    const c = comments[key];
    html += `<div class="comment"><strong>${c.username}</strong> ${c.text}</div>`;
  }
  return html;
}

async function toggleLike(postId) {
  const likeRef = db.ref(`posts/${postId}/likes/${currentUser.uid}`);
  const snap = await likeRef.once('value');
  if (snap.exists()) {
    await likeRef.remove();
  } else {
    await likeRef.set(true);
    const postSnap = await db.ref(`posts/${postId}`).once('value');
    const post = postSnap.val();
    if (post.userId !== currentUser.uid) {
      await db.ref(`notifications/${post.userId}`).push({
        type: 'like',
        fromUserId: currentUser.uid,
        fromUsername: currentUser.displayName || currentUser.email,
        postId: postId,
        createdAt: Date.now(),
        read: false
      });
    }
  }
  loadViewContent();
}

async function addComment(postId, text, inputEl) {
  const commentId = db.ref().push().key;
  await db.ref(`posts/${postId}/comments/${commentId}`).set({
    uid: currentUser.uid,
    username: currentUser.displayName || currentUser.email,
    text: text,
    createdAt: Date.now()
  });
  inputEl.value = '';
  loadViewContent();
}

async function deletePost(postId) {
  const postSnap = await db.ref(`posts/${postId}`).once('value');
  const post = postSnap.val();
  if (!post) return;
  if (currentUser.uid === post.userId || currentUser.email === ADMIN_EMAIL) {
    try {
      const mediaRef = storage.refFromURL(post.mediaUrl);
      await mediaRef.delete().catch(() => {});
      await db.ref(`posts/${postId}`).remove();
      showToast('تم حذف المنشور', 'success');
      loadViewContent();
    } catch (err) {
      showToast('خطأ في الحذف', 'error');
    }
  } else {
    showToast('ليس لديك صلاحية', 'error');
  }
}

// ======================== CREATE POST (with voice recording) ========================
function showCreatePostModal() {
  // Create modal for post options (image, video, audio)
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>إنشاء منشور جديد</h3>
      <button id="post-image-video"><i class="fas fa-image"></i> صورة / فيديو</button>
      <button id="post-audio"><i class="fas fa-microphone"></i> تسجيل صوتي</button>
      <button id="close-modal">إلغاء</button>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('post-image-video').addEventListener('click', () => {
    modal.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const caption = prompt('أضف وصفاً (اختياري)') || '';
      const storageRef = storage.ref(`posts/${currentUser.uid}/${Date.now()}_${file.name}`);
      const uploadTask = storageRef.put(file);
      uploadTask.on('state_changed', null, null, async () => {
        const url = await storageRef.getDownloadURL();
        const type = file.type.startsWith('video') ? 'video' : 'image';
        await db.ref('posts').push({
          userId: currentUser.uid,
          username: currentUser.displayName || currentUser.email,
          userPhoto: currentUser.photoURL || '',
          mediaUrl: url,
          type: type,
          caption: caption,
          likes: {},
          comments: {},
          createdAt: Date.now()
        });
        showToast('تم النشر بنجاح', 'success');
        currentView = 'home';
        renderMainApp();
      });
    };
    input.click();
  });
  document.getElementById('post-audio').addEventListener('click', async () => {
    modal.remove();
    await startVoiceRecording((audioBlob) => {
      const caption = prompt('أضف وصفاً (اختياري)') || '';
      const storageRef = storage.ref(`posts/${currentUser.uid}/audio_${Date.now()}.webm`);
      storageRef.put(audioBlob).then(async (snapshot) => {
        const url = await snapshot.ref.getDownloadURL();
        await db.ref('posts').push({
          userId: currentUser.uid,
          username: currentUser.displayName || currentUser.email,
          userPhoto: currentUser.photoURL || '',
          mediaUrl: url,
          type: 'audio',
          caption: caption,
          likes: {},
          comments: {},
          createdAt: Date.now()
        });
        showToast('تم نشر التسجيل الصوتي', 'success');
        currentView = 'home';
        renderMainApp();
      });
    });
  });
  document.getElementById('close-modal').addEventListener('click', () => modal.remove());
}

// ======================== VOICE RECORDING HELPER ========================
async function startVoiceRecording(onStop) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mediaRecorder = new MediaRecorder(stream);
  const chunks = [];
  mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'audio/webm' });
    stream.getTracks().forEach(track => track.stop());
    onStop(blob);
  };
  mediaRecorder.start();
  // Show recording UI with stop button
  const recordingUI = document.createElement('div');
  recordingUI.className = 'recording-ui';
  recordingUI.innerHTML = `
    <div class="recording-box">
      <i class="fas fa-microphone-alt fa-2x pulse"></i>
      <span>جاري التسجيل...</span>
      <button id="stop-recording">إيقاف</button>
    </div>
  `;
  document.body.appendChild(recordingUI);
  document.getElementById('stop-recording').addEventListener('click', () => {
    mediaRecorder.stop();
    recordingUI.remove();
  });
}

// ======================== PROFILE (with full editing, privacy, etc.) ========================
async function loadProfile(container, userId) {
  container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i></div>';
  const userSnap = await db.ref(`users/${userId}`).once('value');
  const user = userSnap.val();
  if (!user) return;
  const isOwn = userId === currentUser.uid;
  const isFollowing = !isOwn && currentUser.following && currentUser.following[userId];
  const postsSnap = await db.ref('posts').orderByChild('userId').equalTo(userId).once('value');
  const posts = [];
  postsSnap.forEach(child => posts.push({ id: child.key, ...child.val() }));

  container.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar-wrapper">
        <img class="profile-avatar" src="${user.photoURL || 'https://ui-avatars.com/api/?background=0095f6&color=fff&name=' + (user.username || 'U')}" alt="avatar">
        ${isOwn ? `<button id="change-avatar-btn"><i class="fas fa-camera"></i></button>` : ''}
      </div>
      <h2>${user.username}</h2>
      <p class="full-name">${user.fullName || ''}</p>
      <p class="bio">${user.bio || '✨ مرحباً بك في حسابي'}</p>
      ${user.website ? `<a href="${user.website}" target="_blank" class="website">${user.website}</a>` : ''}
      <div class="stats">
        <div><span>${Object.keys(user.followers || {}).length}</span> متابع</div>
        <div><span>${Object.keys(user.following || {}).length}</span> متابع</div>
        <div><span>${posts.length}</span> منشور</div>
      </div>
      ${isOwn ? `
        <button id="edit-profile-btn"><i class="fas fa-edit"></i> تعديل الملف الشخصي</button>
        <button id="privacy-settings-btn"><i class="fas fa-lock"></i> الخصوصية</button>
      ` : `
        <button id="follow-btn" class="${isFollowing ? 'following' : ''}">${isFollowing ? 'متابَع' : 'متابعة'}</button>
        <button id="message-btn"><i class="fas fa-comment-dots"></i> رسالة</button>
      `}
    </div>
    <div class="profile-tabs">
      <button class="tab-btn active" data-tab="posts">المنشورات</button>
      <button class="tab-btn" data-tab="saved">المحفوظات</button>
      <button class="tab-btn" data-tab="liked">الإعجابات</button>
    </div>
    <div class="profile-posts" id="profile-posts">
      ${renderProfilePosts(posts)}
    </div>
  `;

  // Event handlers
  if (isOwn) {
    document.getElementById('edit-profile-btn')?.addEventListener('click', showEditProfileModal);
    document.getElementById('privacy-settings-btn')?.addEventListener('click', showPrivacySettings);
    document.getElementById('change-avatar-btn')?.addEventListener('click', changeAvatar);
  } else {
    document.getElementById('follow-btn')?.addEventListener('click', () => toggleFollow(userId));
    document.getElementById('message-btn')?.addEventListener('click', () => {
      currentView = 'messages';
      currentChatUserId = userId;
      renderMainApp();
    });
  }
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      if (tab === 'posts') {
        document.getElementById('profile-posts').innerHTML = renderProfilePosts(posts);
      } else if (tab === 'saved') {
        const savedSnap = await db.ref(`users/${userId}/savedPosts`).once('value');
        const savedPosts = [];
        savedSnap.forEach(child => savedPosts.push(child.val()));
        document.getElementById('profile-posts').innerHTML = renderProfilePosts(savedPosts);
      } else if (tab === 'liked') {
        const likedSnap = await db.ref(`posts`).once('value');
        const likedPosts = [];
        likedSnap.forEach(child => {
          const post = child.val();
          if (post.likes && post.likes[currentUser.uid]) {
            likedPosts.push({ id: child.key, ...post });
          }
        });
        document.getElementById('profile-posts').innerHTML = renderProfilePosts(likedPosts);
      }
    });
  });
}

function renderProfilePosts(posts) {
  if (!posts.length) return '<div class="empty-state">لا توجد منشورات</div>';
  return `<div class="profile-posts-grid">
    ${posts.map(post => `
      <div class="profile-post">
        ${post.type === 'video' ? `<video src="${post.mediaUrl}"></video>` : 
          post.type === 'audio' ? `<audio controls src="${post.mediaUrl}"></audio>` : 
          `<img src="${post.mediaUrl}" alt="post">`}
      </div>
    `).join('')}
  </div>`;
}

async function changeAvatar() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const storageRef = storage.ref(`avatars/${currentUser.uid}`);
    await storageRef.put(file);
    const url = await storageRef.getDownloadURL();
    await db.ref(`users/${currentUser.uid}/photoURL`).set(url);
    await currentUser.updateProfile({ photoURL: url });
    showToast('تم تحديث الصورة', 'success');
    loadViewContent();
  };
  input.click();
}

function showEditProfileModal() {
  const userRef = db.ref(`users/${currentUser.uid}`);
  userRef.once('value').then(snap => {
    const user = snap.val();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>تعديل الملف الشخصي</h3>
        <input id="edit-username" placeholder="اسم المستخدم" value="${user.username || ''}">
        <input id="edit-fullname" placeholder="الاسم الكامل" value="${user.fullName || ''}">
        <textarea id="edit-bio" placeholder="السيرة الذاتية">${user.bio || ''}</textarea>
        <input id="edit-website" placeholder="الموقع الشخصي" value="${user.website || ''}">
        <button id="save-profile">حفظ</button>
        <button id="close-modal">إلغاء</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('save-profile').addEventListener('click', async () => {
      const updates = {
        username: document.getElementById('edit-username').value,
        fullName: document.getElementById('edit-fullname').value,
        bio: document.getElementById('edit-bio').value,
        website: document.getElementById('edit-website').value
      };
      await userRef.update(updates);
      showToast('تم تحديث الملف الشخصي', 'success');
      modal.remove();
      loadViewContent();
    });
    document.getElementById('close-modal').addEventListener('click', () => modal.remove());
  });
}

function showPrivacySettings() {
  const userRef = db.ref(`users/${currentUser.uid}`);
  userRef.once('value').then(snap => {
    const user = snap.val();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>إعدادات الخصوصية</h3>
        <label>
          <input type="checkbox" id="private-account" ${user.private ? 'checked' : ''}>
          حساب خاص (لا يظهر للمتابعين الجدد)
        </label>
        <button id="save-privacy">حفظ</button>
        <button id="close-modal">إلغاء</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('save-privacy').addEventListener('click', async () => {
      const isPrivate = document.getElementById('private-account').checked;
      await userRef.update({ private: isPrivate });
      showToast('تم تحديث إعدادات الخصوصية', 'success');
      modal.remove();
    });
    document.getElementById('close-modal').addEventListener('click', () => modal.remove());
  });
}

async function toggleFollow(targetId) {
  const followingRef = db.ref(`users/${currentUser.uid}/following/${targetId}`);
  const followerRef = db.ref(`users/${targetId}/followers/${currentUser.uid}`);
  const snap = await followingRef.once('value');
  if (snap.exists()) {
    await followingRef.remove();
    await followerRef.remove();
  } else {
    await followingRef.set(true);
    await followerRef.set(true);
    await db.ref(`notifications/${targetId}`).push({
      type: 'follow',
      fromUserId: currentUser.uid,
      fromUsername: currentUser.displayName || currentUser.email,
      createdAt: Date.now(),
      read: false
    });
  }
  loadViewContent();
}

// ======================== NOTIFICATIONS ========================
async function loadNotifications(container) {
  container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i></div>';
  const snapshot = await db.ref(`notifications/${currentUser.uid}`).once('value');
  const notifs = [];
  snapshot.forEach(child => notifs.push({ id: child.key, ...child.val() }));
  notifs.sort((a,b) => b.createdAt - a.createdAt);
  if (!notifs.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i> لا توجد إشعارات</div>';
    return;
  }
  container.innerHTML = notifs.map(n => `
    <div class="notification-item">
      <i class="fas ${n.type === 'like' ? 'fa-heart' : n.type === 'comment' ? 'fa-comment' : 'fa-user-plus'}"></i>
      <div><strong>${n.fromUsername}</strong> ${n.type === 'like' ? 'أعجب بمنشورك' : n.type === 'comment' ? 'علق على منشورك' : 'تابعك'}</div>
      <small>${timeAgo(n.createdAt)}</small>
    </div>
  `).join('');
}

// ======================== STORIES ========================
async function loadStories() {
  const storiesBar = document.getElementById('stories-bar');
  if (!storiesBar) return;
  const snapshot = await db.ref('stories').once('value');
  const now = Date.now();
  const stories = [];
  snapshot.forEach(child => {
    const s = child.val();
    if (s.expiresAt > now) stories.push({ id: child.key, ...s });
    else child.ref.remove();
  });
  const userStories = {};
  stories.forEach(s => {
    if (!userStories[s.userId]) userStories[s.userId] = [];
    userStories[s.userId].push(s);
  });
  let html = `<div class="story-circle add-story" id="add-story"><i class="fas fa-plus"></i></div>`;
  for (let uid in userStories) {
    const first = userStories[uid][0];
    html += `<div class="story-circle" data-user="${uid}"><img src="${first.userPhoto || 'https://ui-avatars.com/api/?background=0095f6&color=fff&name=S'}" alt="story"></div>`;
  }
  storiesBar.innerHTML = html;
  document.querySelectorAll('.story-circle[data-user]').forEach(el => {
    el.addEventListener('click', () => showStoryViewer(el.dataset.user, userStories[el.dataset.user]));
  });
  document.getElementById('add-story')?.addEventListener('click', showAddStoryModal);
}

async function showAddStoryModal() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const storageRef = storage.ref(`stories/${currentUser.uid}/${Date.now()}_${file.name}`);
    const uploadTask = storageRef.put(file);
    uploadTask.on('state_changed', null, null, async () => {
      const url = await storageRef.getDownloadURL();
      const type = file.type.startsWith('video') ? 'video' : 'image';
      await db.ref(`stories/${db.ref().push().key}`).set({
        userId: currentUser.uid,
        userPhoto: currentUser.photoURL || '',
        mediaUrl: url,
        type: type,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      });
      showToast('تم إضافة القصة', 'success');
      loadStories();
    });
  };
  input.click();
}

function showStoryViewer(userId, stories) {
  let idx = 0;
  const modal = document.createElement('div');
  modal.className = 'story-modal';
  const show = (i) => {
    const story = stories[i];
    modal.innerHTML = `
      <div class="story-content">
        ${story.type === 'video' ? `<video controls src="${story.mediaUrl}"></video>` : `<img src="${story.mediaUrl}" alt="story">`}
        <button class="close-story">&times;</button>
        <div class="story-progress"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close-story').addEventListener('click', () => modal.remove());
  };
  show(0);
}

// ======================== DIRECT MESSAGES ========================
async function loadMessagesView(container) {
  if (currentChatUserId) {
    // Show chat window
    await loadChatRoom(container, currentChatUserId);
  } else {
    // Show list of conversations
    await loadConversationsList(container);
  }
}

async function loadConversationsList(container) {
  container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i> جاري التحميل...</div>';
  // Get all users the current user has chatted with
  const userChatsRef = db.ref(`chats/${currentUser.uid}`);
  const snapshot = await userChatsRef.once('value');
  const chats = [];
  snapshot.forEach(child => {
    chats.push({ userId: child.key, lastMessage: child.val().lastMessage, timestamp: child.val().timestamp });
  });
  chats.sort((a,b) => b.timestamp - a.timestamp);

  if (!chats.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-comments"></i>
        <p>لا توجد محادثات بعد</p>
        <button id="search-users-btn">ابحث عن مستخدمين</button>
      </div>
    `;
    document.getElementById('search-users-btn')?.addEventListener('click', showUserSearch);
    return;
  }

  // Build list of conversations
  let html = `<div class="conversations-header"><button id="new-message-btn"><i class="fas fa-plus"></i> رسالة جديدة</button></div><div class="conversations-list">`;
  for (let chat of chats) {
    const userSnap = await db.ref(`users/${chat.userId}`).once('value');
    const user = userSnap.val();
    html += `
      <div class="conversation-item" data-user-id="${chat.userId}">
        <img class="avatar" src="${user?.photoURL || 'https://ui-avatars.com/api/?background=0095f6&color=fff&name=' + (user?.username || 'U')}" alt="avatar">
        <div class="conv-info">
          <span class="username">${user?.username || 'مستخدم'}</span>
          <span class="last-message">${chat.lastMessage?.substring(0, 40) || ''}</span>
        </div>
        <span class="time">${timeAgo(chat.timestamp)}</span>
      </div>
    `;
  }
  html += `</div>`;
  container.innerHTML = html;

  document.getElementById('new-message-btn')?.addEventListener('click', showUserSearch);
  document.querySelectorAll('.conversation-item').forEach(el => {
    el.addEventListener('click', () => {
      currentChatUserId = el.dataset.userId;
      loadMessagesView(container);
    });
  });
}

function showUserSearch() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>ابحث عن مستخدم</h3>
      <input type="text" id="search-users-input" placeholder="اسم المستخدم أو البريد">
      <div id="search-results"></div>
      <button id="close-modal">إلغاء</button>
    </div>
  `;
  document.body.appendChild(modal);
  const input = document.getElementById('search-users-input');
  const resultsDiv = document.getElementById('search-results');
  input.addEventListener('input', async () => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      resultsDiv.innerHTML = '';
      return;
    }
    const usersSnap = await db.ref('users').once('value');
    const users = [];
    usersSnap.forEach(child => {
      const user = child.val();
      if (user.username.toLowerCase().includes(query) && child.key !== currentUser.uid) {
        users.push({ id: child.key, ...user });
      }
    });
    resultsDiv.innerHTML = users.map(user => `
      <div class="search-result" data-id="${user.id}">
        <img src="${user.photoURL || 'https://ui-avatars.com/api/?background=0095f6&color=fff&name=' + (user.username)}" alt="avatar">
        <span>${user.username}</span>
      </div>
    `).join('');
    document.querySelectorAll('.search-result').forEach(el => {
      el.addEventListener('click', () => {
        currentChatUserId = el.dataset.id;
        modal.remove();
        loadMessagesView(document.getElementById('content'));
      });
    });
  });
  document.getElementById('close-modal').addEventListener('click', () => modal.remove());
}

async function loadChatRoom(container, otherUserId) {
  container.innerHTML = `
    <div class="chat-header">
      <button id="back-to-conversations"><i class="fas fa-arrow-right"></i></button>
      <div class="chat-user-info"></div>
    </div>
    <div class="messages-container" id="messages-container"></div>
    <div class="chat-input-area">
      <input type="text" id="chat-message-input" placeholder="اكتب رسالة...">
      <button id="send-text-btn"><i class="fas fa-paper-plane"></i></button>
      <button id="attach-image-btn"><i class="fas fa-image"></i></button>
      <button id="attach-video-btn"><i class="fas fa-video"></i></button>
      <button id="voice-record-btn"><i class="fas fa-microphone"></i></button>
    </div>
  `;

  // Load user info
  const otherUserSnap = await db.ref(`users/${otherUserId}`).once('value');
  const otherUser = otherUserSnap.val();
  document.querySelector('.chat-user-info').innerHTML = `
    <img src="${otherUser?.photoURL || 'https://ui-avatars.com/api/?background=0095f6&color=fff&name=' + (otherUser?.username || 'U')}" alt="avatar">
    <span>${otherUser?.username || 'مستخدم'}</span>
  `;

  // Back button
  document.getElementById('back-to-conversations').addEventListener('click', () => {
    if (messageListener) messageListener.off();
    currentChatUserId = null;
    loadMessagesView(container);
  });

  // Message sending
  const roomId = getRoomId(currentUser.uid, otherUserId);
  const messagesRef = db.ref(`messages/${roomId}`);
  // Listen for new messages
  if (messageListener) messageListener.off();
  messageListener = messagesRef.on('child_added', (snapshot) => {
    const msg = snapshot.val();
    appendMessage(msg);
  });
  // Load existing messages
  const snapshot = await messagesRef.once('value');
  const messages = [];
  snapshot.forEach(child => messages.push({ id: child.key, ...child.val() }));
  messages.sort((a,b) => a.timestamp - b.timestamp);
  const messagesContainer = document.getElementById('messages-container');
  messagesContainer.innerHTML = '';
  messages.forEach(msg => appendMessage(msg));

  // Send text message
  document.getElementById('send-text-btn').addEventListener('click', async () => {
    const text = document.getElementById('chat-message-input').value.trim();
    if (text) {
      await sendMessage(roomId, 'text', null, text);
      document.getElementById('chat-message-input').value = '';
    }
  });
  document.getElementById('chat-message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('send-text-btn').click();
  });

  // Attach media
  document.getElementById('attach-image-btn').addEventListener('click', () => attachMedia('image'));
  document.getElementById('attach-video-btn').addEventListener('click', () => attachMedia('video'));
  document.getElementById('voice-record-btn').addEventListener('click', async () => {
    await startVoiceRecording(async (blob) => {
      const storageRef = storage.ref(`messages/${roomId}/audio_${Date.now()}.webm`);
      await storageRef.put(blob);
      const url = await storageRef.getDownloadURL();
      await sendMessage(roomId, 'audio', url);
    });
  });
}

function getRoomId(uid1, uid2) {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

async function sendMessage(roomId, type, mediaUrl, text = '') {
  const message = {
    senderId: currentUser.uid,
    type: type,
    content: text,
    mediaUrl: mediaUrl,
    timestamp: Date.now(),
    read: false
  };
  const newMsgRef = db.ref(`messages/${roomId}`).push();
  await newMsgRef.set(message);
  // Update last message in chats
  const chatRef = db.ref(`chats/${currentUser.uid}/${getOtherUserId(roomId)}`);
  await chatRef.set({
    lastMessage: text || (type === 'audio' ? '🎤 تسجيل صوتي' : 'وسائط'),
    timestamp: Date.now()
  });
  const otherChatRef = db.ref(`chats/${getOtherUserId(roomId)}/${currentUser.uid}`);
  await otherChatRef.set({
    lastMessage: text || (type === 'audio' ? '🎤 تسجيل صوتي' : 'وسائط'),
    timestamp: Date.now()
  });
  // Scroll to bottom
  const container = document.getElementById('messages-container');
  container.scrollTop = container.scrollHeight;
}

function getOtherUserId(roomId) {
  const parts = roomId.split('_');
  return parts[0] === currentUser.uid ? parts[1] : parts[0];
}

function appendMessage(msg) {
  const container = document.getElementById('messages-container');
  if (!container) return;
  const isOwn = msg.senderId === currentUser.uid;
  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'own' : 'other'}`;
  if (msg.type === 'text') {
    div.innerHTML = `<div class="message-text">${msg.content}</div><div class="message-time">${formatDate(msg.timestamp)}</div>`;
  } else if (msg.type === 'image') {
    div.innerHTML = `<img src="${msg.mediaUrl}" class="message-media"><div class="message-time">${formatDate(msg.timestamp)}</div>`;
  } else if (msg.type === 'video') {
    div.innerHTML = `<video controls src="${msg.mediaUrl}" class="message-media"></video><div class="message-time">${formatDate(msg.timestamp)}</div>`;
  } else if (msg.type === 'audio') {
    div.innerHTML = `<audio controls src="${msg.mediaUrl}" class="message-media"></audio><div class="message-time">${formatDate(msg.timestamp)}</div>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function attachMedia(type) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = type === 'image' ? 'image/*' : 'video/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const roomId = getRoomId(currentUser.uid, currentChatUserId);
    const storageRef = storage.ref(`messages/${roomId}/${type}_${Date.now()}_${file.name}`);
    await storageRef.put(file);
    const url = await storageRef.getDownloadURL();
    await sendMessage(roomId, type, url);
  };
  input.click();
}

// ======================== ADMIN DASHBOARD ========================
async function loadAdminDashboard(container) {
  container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i> تحميل لوحة التحكم...</div>';
  const postsSnap = await db.ref('posts').once('value');
  const usersSnap = await db.ref('users').once('value');
  const posts = [];
  postsSnap.forEach(child => posts.push({ id: child.key, ...child.val() }));
  const users = [];
  usersSnap.forEach(child => users.push({ id: child.key, ...child.val() }));

  container.innerHTML = `
    <h2 class="admin-title"><i class="fas fa-shield-alt"></i> لوحة تحكم المشرف</h2>
    <div class="admin-stats">
      <div>عدد المستخدمين: ${users.length}</div>
      <div>عدد المنشورات: ${posts.length}</div>
    </div>
    <div class="admin-tabs">
      <button class="admin-tab active" data-tab="posts">المنشورات</button>
      <button class="admin-tab" data-tab="users">المستخدمين</button>
    </div>
    <div id="admin-content"></div>
  `;

  const showTab = (tab) => {
    const adminContent = document.getElementById('admin-content');
    if (tab === 'posts') {
      adminContent.innerHTML = `
        <div class="admin-list">
          ${posts.map(post => `
            <div class="admin-item">
              <div class="admin-info">
                <strong>${post.username}</strong>
                <small>${post.caption?.substring(0, 50) || ''}</small>
              </div>
              <button class="admin-delete" data-id="${post.id}"><i class="fas fa-trash-alt"></i> حذف</button>
            </div>
          `).join('')}
        </div>
      `;
      document.querySelectorAll('.admin-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('حذف هذا المنشور نهائياً؟')) {
            await deletePost(btn.dataset.id);
            loadAdminDashboard(container);
          }
        });
      });
    } else if (tab === 'users') {
      adminContent.innerHTML = `
        <div class="admin-list">
          ${users.map(user => `
            <div class="admin-item">
              <div class="admin-info">
                <strong>${user.username}</strong>
                <small>${user.email}</small>
              </div>
              <button class="admin-delete-user" data-id="${user.id}"><i class="fas fa-user-slash"></i> حذف المستخدم</button>
            </div>
          `).join('')}
        </div>
      `;
      document.querySelectorAll('.admin-delete-user').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('حذف هذا المستخدم وجميع محتوياته نهائياً؟')) {
            // Delete user's posts, stories, messages, etc.
            const uid = btn.dataset.id;
            // Delete posts
            const userPosts = await db.ref('posts').orderByChild('userId').equalTo(uid).once('value');
            userPosts.forEach(async (post) => {
              await deletePost(post.key);
            });
            // Delete user's stories
            const userStories = await db.ref('stories').orderByChild('userId').equalTo(uid).once('value');
            userStories.forEach(async (story) => {
              await story.ref.remove();
            });
            // Delete user's profile
            await db.ref(`users/${uid}`).remove();
            // Delete user's chats and messages
            await db.ref(`chats/${uid}`).remove();
            await db.ref(`messages`).orderByChild('senderId').equalTo(uid).once('value').then(snap => {
              snap.forEach(msg => msg.ref.remove());
            });
            // Delete from auth (requires admin SDK, can't do from client, but we can disable)
            showToast('تم حذف المستخدم (ملاحظة: يجب حذفه يدوياً من Firebase Auth)', 'success');
            loadAdminDashboard(container);
          }
        });
      });
    }
  };

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      showTab(tab.dataset.tab);
    });
  });
  showTab('posts');
}

// ======================== AUTH LISTENER ========================
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    const userSnap = await db.ref(`users/${user.uid}`).once('value');
    if (!userSnap.exists()) {
      await db.ref(`users/${user.uid}`).set({
        username: user.displayName || user.email.split('@')[0],
        fullName: user.displayName || '',
        email: user.email,
        bio: '',
        website: '',
        photoURL: user.photoURL || '',
        private: false,
        blocked: {},
        followers: {},
        following: {},
        createdAt: Date.now()
      });
    }
    renderMainApp();
  } else {
    currentUser = null;
    renderLogin();
  }
});
