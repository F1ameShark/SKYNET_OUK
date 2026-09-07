import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA1bM9HOObUXkSBdUEbKKHp1rh6WJYA76E",
    authDomain: "orda-4b887.firebaseapp.com",
    projectId: "orda-4b887",
    storageBucket: "orda-4b887.firebasestorage.app",
    messagingSenderId: "435467898374",
    appId: "1:435467898374:web:d7bef0b34e6313013efd87",
    measurementId: "G-5BDJHQF7TN"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
