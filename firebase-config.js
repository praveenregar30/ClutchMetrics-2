// Firebase project settings (Firebase console → Project settings → Your apps → Web app → firebaseConfig).
// These values are public by design: they identify the project, they are not passwords. Access is protected by
// Firebase Authentication and the Firestore rules in firestore.rules.
// Until real values are pasted in, the site keeps the old demo sign-in.
export const firebaseConfig = {
  apiKey: 'AIzaSyDf7y3cqAqdO3zyPsrE5FiWN6KSSpoi-jA',
  authDomain: 'basketball-analyzer-f610b.firebaseapp.com',
  projectId: 'basketball-analyzer-f610b',
  storageBucket: 'basketball-analyzer-f610b.firebasestorage.app',
  messagingSenderId: '16775051032',
  appId: '1:16775051032:web:e762d4cb9fe7c2f178106d',
};

export const firebaseReady = !firebaseConfig.apiKey.startsWith('PASTE');
