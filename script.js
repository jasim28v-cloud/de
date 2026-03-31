// script.js
import { auth, db, rtdb } from './firebase-config.js';
import { 
    onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, getDoc, setDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentUser = null;
let activeChatId = null;

// --- 1. نظام المصادقة ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loadChats();
    } else {
        // توجيه لصفحة الدخول إذا لم يكن مسجلاً
        const email = prompt("البريد الإلكتروني:");
        const password = prompt("كلمة المرور:");
        signInWithEmailAndPassword(auth, email, password).catch(() => {
            const username = prompt("اختر @username فريد:");
            createUserWithEmailAndPassword(auth, email, password).then(res => {
                setDoc(doc(db, "users", res.user.uid), {
                    uid: res.user.uid,
                    username: username.toLowerCase(),
                    email: email,
                    avatar: `https://ui-avatars.com/api/?name=${username}`
                });
            });
        });
    }
});

// --- 2. البحث والمحادثات ---
document.getElementById('userSearch').addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
        const username = e.target.value.toLowerCase().replace('@', '');
        const q = query(collection(db, "users"), where("username", "==", username));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const targetUser = snap.docs[0].data();
            startChat(targetUser);
        }
    }
});

function startChat(targetUser) {
    activeChatId = [currentUser.uid, targetUser.uid].sort().join('_');
    document.getElementById('activeName').innerText = targetUser.username;
    loadMessages(activeChatId);
}

function loadMessages(chatId) {
    const q = query(collection(db, "chats", chatId, "messages"), where("timestamp", "!=", null));
    onSnapshot(q, (snap) => {
        const area = document.getElementById('messageArea');
        area.innerHTML = '';
        snap.forEach(doc => {
            const msg = doc.data();
            const isMe = msg.sender === currentUser.uid;
            area.innerHTML += `
                <div class="flex ${isMe ? 'justify-end' : 'justify-start'}">
                    <div class="${isMe ? 'bg-[#005c4b]' : 'bg-[#202c33]'} p-3 rounded-xl max-w-[70%] shadow-sm">
                        ${msg.type === 'image' ? `<img src="${msg.text}" class="rounded-lg">` : msg.text}
                    </div>
                </div>
            `;
        });
        area.scrollTop = area.scrollHeight;
    });
}

// --- 3. إرسال الرسائل والرفع ---
document.getElementById('sendBtn').addEventListener('click', () => {
    const input = document.getElementById('messageInput');
    if (!input.value || !activeChatId) return;
    
    addDoc(collection(db, "chats", activeChatId, "messages"), {
        sender: currentUser.uid,
        text: input.value,
        type: 'text',
        timestamp: serverTimestamp()
    });
    input.value = '';
});

// Cloudinary
const myWidget = cloudinary.createUploadWidget({
    cloudName: 'daemk3hut', 
    uploadPreset: 'fok2_k'
}, (error, result) => {
    if (!error && result && result.event === "success") { 
        addDoc(collection(db, "chats", activeChatId, "messages"), {
            sender: currentUser.uid,
            text: result.info.secure_url,
            type: 'image',
            timestamp: serverTimestamp()
        });
    }
});
document.getElementById('uploadBtn').addEventListener('click', () => myWidget.open());

// --- 4. مكالمات Agora ---
const agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
const AGORA_APP_ID = "929646610d814d529a06c4081c81325f";

async function startCall(isVideo) {
    document.getElementById('callOverlay').classList.remove('hidden');
    const uid = await agoraClient.join(AGORA_APP_ID, activeChatId, null, null);
    
    const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    let videoTrack = null;
    
    if (isVideo) {
        videoTrack = await AgoraRTC.createCameraVideoTrack();
        videoTrack.play('localVideo');
        await agoraClient.publish([audioTrack, videoTrack]);
    } else {
        await agoraClient.publish([audioTrack]);
    }
    
    agoraClient.on("user-published", async (user, mediaType) => {
        await agoraClient.subscribe(user, mediaType);
        if (mediaType === "video") user.videoTrack.play("remoteVideo");
        if (mediaType === "audio") user.audioTrack.play();
    });
}

document.getElementById('videoCallBtn').addEventListener('click', () => startCall(true));
document.getElementById('endCallBtn').addEventListener('click', () => {
    agoraClient.leave();
    document.getElementById('callOverlay').classList.add('hidden');
});
