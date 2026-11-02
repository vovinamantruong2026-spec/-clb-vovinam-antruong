import {initializeApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
import {getFirestore} from 'firebase/firestore';
// Web configuration identifies the project; authorization is enforced by Firestore rules.
export const app=initializeApp({apiKey:'AIzaSyDJS8nKAys-4HuNhr4b3jxt8zg89niqWF4',authDomain:'clb-vovinam-antruong-2026.firebaseapp.com',projectId:'clb-vovinam-antruong-2026',storageBucket:'clb-vovinam-antruong-2026.firebasestorage.app',messagingSenderId:'565891833244',appId:'1:565891833244:web:9f0d36d909a7b6969f3c59',measurementId:'G-H42Q7R9WEY'});
export const auth=getAuth(app);
export const db=getFirestore(app);
export const clubId='antruong-v2';
