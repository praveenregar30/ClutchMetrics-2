// Firebase project settings (Firebase console → Project settings → Your apps → Web app → firebaseConfig).
// These values are public by design: they identify the project, they are not passwords. Access is protected by
// Firebase Authentication and the Firestore rules in firestore.rules.
// Until real values are pasted in, the site keeps the old demo sign-in.
export const firebaseConfig = {
  apiKey: 'PASTE_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  storageBucket: 'PASTE_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'PASTE_SENDER_ID',
  appId: 'PASTE_APP_ID',
};

export const firebaseReady = !firebaseConfig.apiKey.startsWith('PASTE');
