// ============ Typing Indicator ==========
let typingTimeout = null;
let isTyping = false;

async function sendTypingIndicator(chatId, isTyping) {
  if (!chatId || !currentProfile) return;
  const typingRef = doc(db, "chats", chatId, "meta", "typing");
  if (isTyping) {
    await setDoc(typingRef, { userId: currentUser.uid, username: currentProfile.username, timestamp: serverTimestamp() });
  } else {
    await setDoc(typingRef, { userId: null, timestamp: null });
  }
}

function onTypingStart() {
  if (typingTimeout) clearTimeout(typingTimeout);
  if (!isTyping) {
    isTyping = true;
    sendTypingIndicator(activeChatId, true);
  }
  typingTimeout = setTimeout(() => {
    isTyping = false;
    sendTypingIndicator(activeChatId, false);
  }, 1500);
}

// ============ Read Receipts ==========
async function markMessagesAsRead(chatId) {
  if (!chatId || !currentUser) return;
  const q = query(collection(db, "chats", chatId, "messages"), where("read", "==", false), where("senderId", "!=", currentUser.uid));
  const snap = await getDocs(q);
  snap.forEach(async (docSnap) => {
    await setDoc(doc(db, "chats", chatId, "messages", docSnap.id), { read: true, readAt: serverTimestamp() }, { merge: true });
  });
}

// ============ Delete Message ==========
async function deleteMessage(chatId, messageId, forEveryone = true) {
  if (!chatId || !messageId) return;
  if (forEveryone) {
    await setDoc(doc(db, "chats", chatId, "messages", messageId), { deleted: true, text: "🗑️ تم حذف هذه الرسالة", mediaUrl: null }, { merge: true });
  } else {
    await setDoc(doc(db, "chats", chatId, "messages", messageId), { deletedForMe: true }, { merge: true });
  }
}

// ============ Video Upload & Display ==========
async function handleChatVideoUpload(file) {
  if (!file || !activeChatId || !currentProfile) return;
  $("attach-btn").disabled = true;
  try {
    const url = await uploadToCloudinary(file);
    await addDoc(collection(db, "chats", activeChatId, "messages"), {
      senderId: currentUser.uid, senderUsername: currentProfile.username,
      text: "", type: "video", mediaUrl: url, timestamp: serverTimestamp(), read: false
    });
    await setDoc(doc(db, "chats", activeChatId), { lastMessage: "🎥 فيديو", lastTimestamp: serverTimestamp() }, { merge: true });
  } catch (e) { console.error(e); }
  $("attach-btn").disabled = false;
}

// ============ Browser Notifications ==========
async function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission !== "granted") {
    await Notification.requestPermission();
  }
}

function showNotification(title, body, icon = "") {
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification(title, { body, icon, silent: false });
  }
}

// ============ Reply to Message ==========
let replyToMessage = null;

function setReply(messageId, senderName, text) {
  replyToMessage = { messageId, senderName, text };
  const replyPreview = $("reply-preview");
  if (replyPreview) {
    replyPreview.innerHTML = `
      <div class="flex justify-between items-center bg-[#00a884]/20 p-2 rounded-lg mb-2">
        <span class="text-xs text-[#00a884]">رداً على ${senderName}: ${text.substring(0, 50)}</span>
        <button onclick="cancelReply()" class="text-gray-400">✕</button>
      </div>
    `;
    replyPreview.classList.remove("hidden");
  }
}

function cancelReply() {
  replyToMessage = null;
  const replyPreview = $("reply-preview");
  if (replyPreview) replyPreview.classList.add("hidden");
}

// ============ Safe Logout ==========
async function handleLogoutSafe() {
  if (chatsUnsub) chatsUnsub();
  if (messagesUnsub) messagesUnsub();
  if (currentUser) {
    await setDoc(doc(db, "users", currentUser.uid), { status: "offline" }, { merge: true });
  }
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    mediaRecorder.stream?.getTracks().forEach(t => t.stop());
  }
  if (agoraClient) {
    if (localTracks.audio) localTracks.audio.close();
    if (localTracks.video) localTracks.video.close();
    await agoraClient.leave();
  }
  await signOut(auth);
  currentProfile = null;
  activeChatId = null;
  window.location.reload();
}

// ============ Fixed Voice Recording ==========
async function startRecordingFixed() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    recordingSeconds = 0;
    
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(100);
    
    hide("normal-input");
    show("recording-input");
    recordingTimer = setInterval(() => {
      recordingSeconds++;
      const m = Math.floor(recordingSeconds / 60);
      const s = recordingSeconds % 60;
      const timerEl = $("rec-timer");
      if (timerEl) timerEl.textContent = `${m}:${s.toString().padStart(2, "0")}`;
    }, 1000);
  } catch (e) { console.error("Mic denied", e); }
}

async function sendVoiceMessageFixed() {
  if (!mediaRecorder || !activeChatId || !currentProfile) return;
  clearInterval(recordingTimer);
  
  mediaRecorder.stop();
  await new Promise(resolve => { mediaRecorder.onstop = resolve; });
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  
  hide("recording-input");
  show("normal-input");
  
  if (audioChunks.length === 0) return;
  
  const blob = new Blob(audioChunks, { type: "audio/webm" });
  const file = new File([blob], `voice_${Date.now()}.webm`, { type: "audio/webm" });
  try {
    const url = await uploadToCloudinary(file);
    await addDoc(collection(db, "chats", activeChatId, "messages"), {
      senderId: currentUser.uid, senderUsername: currentProfile.username,
      text: "", type: "audio", mediaUrl: url, timestamp: serverTimestamp(), read: false
    });
    await setDoc(doc(db, "chats", activeChatId), { lastMessage: "🎤 رسالة صوتية", lastTimestamp: serverTimestamp() }, { merge: true });
  } catch (e) { console.error(e); }
}

// ============ Fixed Agora Call ==========
async function startCallFixed(isVideo) {
  if (!activeChatId) return;
  show("call-screen");
  const otherUser = window._otherUser;
  const userNameEl = $("call-user-name");
  const userHandleEl = $("call-user-handle");
  if (userNameEl) userNameEl.textContent = otherUser?.displayName || "...";
  if (userHandleEl) userHandleEl.textContent = "@" + (otherUser?.username || "");
  
  const callStatus = $("call-status");
  if (callStatus) callStatus.textContent = "جارٍ الاتصال...";
  
  const localVideoDiv = $("local-video");
  const remoteVideoDiv = $("remote-video");
  const callAvatarArea = $("call-avatar-area");
  
  if (isVideo) {
    if (localVideoDiv) localVideoDiv.classList.remove("hidden");
    if (remoteVideoDiv) remoteVideoDiv.classList.remove("hidden");
    if (callAvatarArea) callAvatarArea.classList.add("hidden");
  } else {
    if (localVideoDiv) localVideoDiv.classList.add("hidden");
    if (remoteVideoDiv) remoteVideoDiv.classList.add("hidden");
    if (callAvatarArea) callAvatarArea.classList.remove("hidden");
  }
  
  try {
    const AgoraRTC = (await import("https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.20.0/+esm")).default;
    agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    await agoraClient.join(AGORA_APP_ID, activeChatId, null, null);
    
    localTracks.audio = await AgoraRTC.createMicrophoneAudioTrack();
    if (isVideo && localTracks.video) {
      localTracks.video = await AgoraRTC.createCameraVideoTrack();
      localTracks.video.play("local-video");
    }
    
    const tracks = [localTracks.audio];
    if (isVideo && localTracks.video) tracks.push(localTracks.video);
    await agoraClient.publish(tracks);
    if (callStatus) callStatus.textContent = "متصل";
    
    agoraClient.on("user-published", async (user, mediaType) => {
      await agoraClient.subscribe(user, mediaType);
      if (mediaType === "video" && user.videoTrack) user.videoTrack.play("remote-video");
      if (mediaType === "audio" && user.audioTrack) user.audioTrack.play();
    });
    
    agoraClient.on("user-left", () => { endCall(); });
  } catch (e) {
    console.error("Call error:", e);
    if (callStatus) callStatus.textContent = "فشل الاتصال";
  }
}

// ============ Attachment Preview ==========
function previewAttachment(file) {
  const reader = new FileReader();
  const previewContainer = $("attachment-preview");
  if (!previewContainer) return;
  
  reader.onload = (e) => {
    if (file.type.startsWith("image/")) {
      previewContainer.innerHTML = `<img src="${e.target.result}" class="max-h-32 rounded-lg" /><button onclick="cancelPreview()" class="absolute top-1 right-1 bg-black/50 rounded-full p-1">✕</button>`;
    } else if (file.type.startsWith("video/")) {
      previewContainer.innerHTML = `<video src="${e.target.result}" class="max-h-32 rounded-lg" controls></video><button onclick="cancelPreview()" class="absolute top-1 right-1 bg-black/50 rounded-full p-1">✕</button>`;
    }
    previewContainer.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

function cancelPreview() {
  const preview = $("attachment-preview");
  if (preview) preview.classList.add("hidden");
}

// ============ Performance: Cache Users ==========
const userCache = new Map();

async function getUserByUsernameCached(username) {
  if (userCache.has(username)) return userCache.get(username);
  const user = await getUserByUsername(username);
  if (user) userCache.set(username, user);
  return user;
}

// تحديث listenChats لاستخدام الكاش
// (استبدل getUserByUsername بـ getUserByUsernameCached في حلقة chats)
