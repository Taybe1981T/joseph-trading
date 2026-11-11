import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

/**
 * Firebase normally runs its OAuth helper on `<project>.firebaseapp.com`.
 *
 * That host is blocked on some networks (the whole Firebase Hosting range
 * 199.36.158.100 is unreachable from them), and the Google sign-in dies there:
 * the popup closes by itself and a redirect ends on a browser error page. The
 * fix is to serve the same helper from our own domain — Vercel proxies
 * `/__/auth/*` and `/__/firebase/*` to Firebase (see vercel.json), so the
 * browser only ever talks to a host it can reach.
 *
 * Localhost and preview deployments keep the Firebase domain, because they are
 * not in the project's authorized domains list.
 */
const host = window.location.hostname;
const keepFirebaseDomain =
  host === 'localhost' ||
  host === '127.0.0.1' ||
  (/\.vercel\.app$/i.test(host) && host !== 'joseph-trading.vercel.app');

const app = initializeApp(
  keepFirebaseDomain ? firebaseConfig : { ...firebaseConfig, authDomain: host },
);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
export const BASE_URL = (import.meta as any).env?.BASE_URL || '/';
