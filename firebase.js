// Firebase for ClutchMetrics: accounts (Authentication) and each user's role (Firestore: users/{uid}).
// Loaded only when firebase-config.js holds a real project.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, signOut, setPersistence, browserLocalPersistence, browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);

// the signed-in user once Firebase has restored the session (null when signed out)
export const currentUser = () => new Promise((resolve) => {
  const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
});

export async function roleOf(user) {
  const key = `cm-role-${user.uid}`;
  try { const cached = sessionStorage.getItem(key); if (cached) return cached; } catch { /* storage blocked */ }
  const snap = await getDoc(doc(db, 'users', user.uid));
  const role = snap.exists() ? snap.data().role : null;
  try { if (role) sessionStorage.setItem(key, role); } catch { /* storage blocked */ }
  return role;
}

export async function signIn(email, password, remember) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return { user, role: await roleOf(user) };
}

export async function signUp(email, password, role, remember) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', user.uid), { role, email, createdAt: serverTimestamp() });
  try { sessionStorage.setItem(`cm-role-${user.uid}`, role); } catch { /* storage blocked */ }
  sendEmailVerification(user).catch(() => {});
  return user;
}

export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export const signOutUser = () => signOut(auth);

// a fresh login token for the analysis server (it checks it with Google before accepting an upload)
export async function idToken() {
  const user = auth.currentUser || await currentUser();
  return user ? user.getIdToken() : null;
}

// Firebase error codes → plain sentences (never revealing whether an email has an account, except at sign-up)
export function message(err) {
  const code = err?.code || '';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(code)) return 'Incorrect email or password.';
  if (code === 'auth/email-already-in-use') return 'An account with this email already exists. Sign in instead, or use "Forgot password?".';
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') return 'Choose a stronger password: at least 8 characters with letters and numbers.';
  if (code === 'auth/invalid-email') return 'Enter an email address with an @ and a domain, like name@team.com.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes, or reset your password.';
  if (code === 'auth/network-request-failed') return 'No connection to the sign-in service. Check your internet and try again.';
  if (code === 'permission-denied') return 'Your account was created but its role could not be saved. Contact the site owner.';
  return 'Something went wrong. Please try again.';
}
