// ========== Firebase Configuration for SHΔDØW ==========
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, doc, setDoc, getDoc, getDocs, 
    updateDoc, deleteDoc, query, where, orderBy, limit, 
    onSnapshot, addDoc, serverTimestamp, arrayUnion, arrayRemove 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyAxtEkrEgl0C9djPkxKKX-sENtOzPEbHB8",
    authDomain: "tope-e5350.firebaseapp.com",
    projectId: "tope-e5350",
    storageBucket: "tope-e5350.firebasestorage.app",
    messagingSenderId: "187788115549",
    appId: "1:187788115549:web:0f3c00ff62c1ebc5ed97b4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export {
    collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp,
    arrayUnion, arrayRemove, ref, uploadBytes, getDownloadURL
};

// Cloudinary و Agora
export const CLOUD_NAME = 'daemk3hut';
export const UPLOAD_PRESET = 'fok2_k';
export const AGORA_APP_ID = '75d6c13a4f494ea8ad181eb55b641b79';

console.log('✅ SHΔDØW Firestore Ready');
