import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection, doc, getDocsFromServer, initializeFirestore, limit, onSnapshot, orderBy,
  persistentLocalCache, persistentMultipleTabManager, query, setDoc, where,
} from 'firebase/firestore';
import { recentLimit } from './activity.js';

export function connectFirebase(config, change) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  const attempts = uid => collection(db, 'users', uid, 'attempts');
  const preferences = uid => collection(db, 'users', uid, 'preferences');
  const byTime = orderBy('time', 'desc');
  const readAttempts = snapshot => snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }));
  let unsubscribe = [];

  onAuthStateChanged(auth, user => {
    unsubscribe.forEach(stop => stop());
    unsubscribe = [];
    change.account(user);
    if (!user) return;
    const streams = {};
    const watch = (name, source, read) => onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
      if (auth.currentUser?.uid !== user.uid) return;
      const first = !streams[name];
      streams[name] = snapshot.metadata;
      if (first || snapshot.docChanges().length) change[name](read(snapshot));
      const metadata = Object.values(streams);
      if (metadata.some(item => item.error)) return;
      if (metadata.some(item => item.hasPendingWrites)) change.status('Changes are waiting to sync…');
      else if (metadata.some(item => item.fromCache)) change.status('Showing cached history while connecting…');
      else if (metadata.length === 2) change.status('Account history synced.');
    }, () => {
      if (auth.currentUser?.uid !== user.uid) return;
      streams[name] = { error: true };
      change.status('Account sync is unavailable. Reload to retry.');
    });
    unsubscribe = [
      watch('attempts', query(attempts(user.uid), byTime, limit(recentLimit)), readAttempts),
      watch('preferences', preferences(user.uid), snapshot => Object.fromEntries(snapshot.docs.map(entry => {
        const { key, value } = entry.data();
        return [key, value];
      }))),
    ];
  });

  return {
    signIn: () => signInWithPopup(auth, new GoogleAuthProvider()),
    signOut: () => signOut(auth),
    saveAttempt(uid, { id, ...attempt }) {
      return setDoc(doc(attempts(uid), id), attempt);
    },
    savePreference(uid, key, value) {
      return setDoc(doc(preferences(uid), encodeURIComponent(key)), { key, value });
    },
    async exportSince(uid, since) {
      return readAttempts(await getDocsFromServer(query(attempts(uid), where('time', '>=', since), byTime)));
    },
  };
}
