import {collection,doc,onSnapshot,runTransaction,serverTimestamp} from 'firebase/firestore';
import {auth,db,clubId} from './firebase';
import {MAX_PHOTO_LENGTH} from './photo';
export function safePhoto(value:any){return typeof value==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)&&value.length<=MAX_PHOTO_LENGTH?value:''}
export function profileForAccount(account:any,profiles:any[]){
 const email=String(account?.data.email||'').trim().toLowerCase();if(!email)return null;
 const verified=profiles.find(p=>p.accountId===account.id&&p.email===email);if(verified)return verified;
 // Only an owner can save this explicit association on an account record.
 if(account.data.photoProfileEmail!==email||!account.data.photoProfileUid)return null;
 return profiles.find(p=>p.uid===account.data.photoProfileUid&&!p.email&&!p.accountId)||null;
}
export function unlinkedPhotos(accounts:any[],profiles:any[],ownUid:string){return profiles.filter(p=>p.uid!==ownUid&&safePhoto(p.photoURL)&&!p.email&&!p.accountId&&!accounts.some(a=>profileForAccount(a,profiles)?.uid===p.uid))}
export async function linkOwnProfile(actor:any){
 const user=auth.currentUser;if(!user?.email||user.uid!==actor.identityId)return;
 const email=user.email.toLowerCase(),ref=doc(db,'clubs/'+clubId+'/profiles/'+user.uid);
 await runTransaction(db,async tx=>{const snap=await tx.get(ref),data=snap.data();if(data?.email===email&&data?.accountId===actor.id)return;tx.set(ref,{photoURL:safePhoto(data?.photoURL),email,accountId:actor.id,updatedAt:serverTimestamp()},{merge:true})});
}
export function watchAccountProfiles(onProfiles:(profiles:any[])=>void,onError:(e:any)=>void){return onSnapshot(collection(db,'clubs/'+clubId+'/profiles'),snap=>onProfiles(snap.docs.map(d=>({uid:d.id,...d.data(),photoURL:safePhoto(d.data().photoURL)}))),onError)}
