import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getDatabase, ref, push, set, onValue, update, get, child, remove, onChildAdded, onChildChanged, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyAxtEkrEgl0C9djPkxKKX-sENtOzPEbHB8",
    authDomain: "tope-e5350.firebaseapp.com",
    databaseURL: "https://tope-e5350-default-rtdb.firebaseio.com",
    projectId: "tope-e5350",
    storageBucket: "tope-e5350.firebasestorage.app",
    messagingSenderId: "187788115549",
    appId: "1:187788115549:web:0f3c00ff62c1ebc5ed97b4",
    measurementId: "G-YERBCEZEW9"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);

export { ref, push, set, onValue, update, get, child, remove, onChildAdded, onChildChanged, query, orderByChild, equalTo, storageRef, uploadBytes, getDownloadURL };

export const CLOUD_NAME = 'daemk3hut';
export const UPLOAD_PRESET = 'fok2_k';
export const AGORA_APP_ID = '929646610d814d529a06c4081c81325f';

console.log('✅ TGramE Complete Ready');
