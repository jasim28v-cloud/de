import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { 
  getFirestore, 
  collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp,
  arrayUnion, arrayRemove 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

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

// ============ تصدير دوال المصادقة (الأهم) ============
export { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
};

// ============ تصدير دوال Firestore ============
export {
    collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp,
    arrayUnion, arrayRemove
};

// ============ إعدادات الخدمات ============
export const CLOUD_NAME = 'daemk3hut';
export const UPLOAD_PRESET = 'fok2_k';
export const AGORA_APP_ID = '929646610d814d529a06c4081c81325f';

console.log('✅ VibeChat Ready - Firebase + Firestore');
