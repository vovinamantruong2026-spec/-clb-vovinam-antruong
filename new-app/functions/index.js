import {rotateBackups,purgeBackupTrash} from './backup-store.js';
import {expiredBackup} from './backup-core.js';
import {deletedTime} from './trash-core.js';
import {archiveOldHistory,oldHistory,HISTORY_KINDS} from './history-core.js';
import {cleanExpiredTrash,expiredTrash} from './trash-core.js';
import {initializeApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {getAuth} from 'firebase-admin/auth';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {onRequest} from 'firebase-functions/v2/https';
import {defineString} from 'firebase-functions/params';
import {logger} from 'firebase-functions';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import {ZONE,PREFIX,isOwnerProfile,performBackup} from './core.js';
initializeApp();
const bucketName=defineString('BACKUP_BUCKET',{description:'Private Cloud Storage bucket for weekly club backups',default:'clb-vovinam-antruong-2026-backups'});
const root='clubs/antruong-v2';const region='asia-southeast1';
const serviceAccount='weekly-clb-backup@clb-vovinam-antruong-2026.iam.gserviceaccount.com';
const options={region,serviceAccount,timeZone:ZONE,memory:'512MiB',timeoutSeconds:540,maxInstances:1,concurrency:1,retryCount:3,minBackoffSeconds:60};
const db=()=>getFirestore();const bucket=()=>getStorage().bucket(bucketName.value());
function archiveInfo(m){return {createdAt:m.metadata?.createdAt||m.timeCreated,bytes:Number(m.size||0),recordCount:m.metadata?.recordCount||'0',sha256:m.metadata?.sha256||''}}
async function readArchive(name){try{const [m]=await bucket().file(name).getMetadata();return archiveInfo(m)}catch(e){if(Number(e.code)===404)return null;throw e}}
async function loadSnapshot(){
 // Read-only transaction gives all collections a common Firestore snapshot.
 return db().runTransaction(async tx=>{const result={};for(const name of ['records','members','profiles','meta','audit']){const snap=await tx.get(db().collection(root+'/'+name));result[name]=snap.docs.map(d=>name==='records'?{...d.data(),updatedAt:d.data().updatedAt?.toDate?.().toISOString()||d.data().updatedAt}:{id:d.id,data:d.data()})}return result},{readOnly:true});
}
async function writeArchive(name,bytes,metadata){try{await bucket().file(name).save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/gzip',cacheControl:'private,no-store',metadata}})}catch(e){if(Number(e.code)!==412)throw e}const archive=await readArchive(name);if(!archive)throw new Error('archive_not_confirmed');return archive}
async function saveManifest(m){await db().collection(root+'/weeklyBackups').doc(m.id).set({...m,at:FieldValue.serverTimestamp()});await db().doc(root+'/meta/weeklyBackup').set({schedule:'0 2 * * 0',timeZone:ZONE,retentionMonths:3,lastSuccessAt:FieldValue.serverTimestamp(),lastWeekId:m.id,lastBytes:m.bytes,lastError:null},{merge:true})}
async function cleanup(now){const result=await rotateBackups(db(),bucket(),root,now);await db().doc(root+'/meta/weeklyBackup').set({lastCleanupAt:FieldValue.serverTimestamp(),lastCutoff:result.cutoff,retentionMonths:3},{merge:true});return result}
export const weeklyClubBackup=onSchedule({...options,schedule:'0 2 * * 0'},async()=>{try{const manifest=await performBackup({now:new Date(),readArchive,loadSnapshot,writeArchive,saveManifest});logger.info('Weekly backup saved',{weekId:manifest.id,bytes:manifest.bytes});await cleanup(new Date())}catch(e){await db().doc(root+'/meta/weeklyBackup').set({lastFailureAt:FieldValue.serverTimestamp(),lastError:'backup_failed_check_function_logs'},{merge:true});logger.error('Weekly backup failed',{code:String(e.code||e.message||'unknown')});throw e}});
export const cleanupClubBackups=onSchedule({...options,schedule:'30 2 * * *'},async()=>{await cleanup(new Date())});
export const downloadWeeklyBackup=onRequest({region,serviceAccount,memory:'512MiB',timeoutSeconds:300,maxInstances:2,invoker:'public',cors:['https://vovinamantruong2026-spec.github.io']},async(req,res)=>{
 res.set('Cache-Control','private,no-store');if(req.method!=='GET'){res.status(405).json({error:'method_not_allowed'});return}
 try{const bearer=/^Bearer (.+)$/.exec(req.get('Authorization')||'');if(!bearer){res.status(401).json({error:'Vui lòng đăng nhập.'});return}let token;try{token=await getAuth().verifyIdToken(bearer[1],true)}catch{res.status(401).json({error:'Phiên đăng nhập không hợp lệ. Đăng nhập lại.'});return}
 const email=String(token.email||'').toLowerCase();if(!email){res.status(403).json({error:'Không có quyền.'});return}const profile=await db().doc(root+'/members/'+email).get();if(!isOwnerProfile(profile.data())){res.status(403).json({error:'Chỉ chủ CLB được tải bản sao.'});return}
 const id=String(req.query.id||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(id)){res.status(404).json({error:'Bản sao không tồn tại hoặc đã hết hạn.'});return}
 const trashed=await db().doc(root+'/backupTrash/weekly--'+id).get();if(trashed.exists&&expiredBackup(trashed.data(),new Date())){res.status(410).json({error:'Bản sao trong thùng rác đã hết hạn khôi phục.'});return}
 const file=bucket().file(PREFIX+id+'.json.gz');const [exists]=await file.exists();if(!exists){res.status(404).json({error:'Không tìm thấy bản sao.'});return}res.set('Content-Type','application/json; charset=utf-8');res.set('Content-Disposition',`attachment; filename="AnTruong_Weekly_${id}.json"`);await pipeline(file.createReadStream(),createGunzip(),res);
 }catch(e){logger.error('Backup download failed',{code:String(e.code||'unknown')});if(!res.headersSent)res.status(500).json({error:'Chưa tải được bản sao. Kiểm tra tác vụ máy chủ.'});else res.end()}
});

export const cleanupClubTrash=onSchedule({region,timeZone:ZONE,memory:'256MiB',timeoutSeconds:540,maxInstances:1,concurrency:1,retryCount:3,minBackoffSeconds:60,schedule:'every 60 minutes'},async()=>{
 try{const now=new Date();const history=await archiveOldHistory({now,listRecords:async()=>{const snap=await db().collection(root+'/records').where('kind','in',HISTORY_KINDS).get();return snap.docs.map(d=>({...d.data(),key:d.id}))},archiveOne:async(candidate,time)=>db().runTransaction(async tx=>{
  const ref=db().doc(root+'/records/'+candidate.key),maintenance=await tx.get(db().doc(root+'/meta/maintenance')),importState=await tx.get(db().doc(root+'/meta/import')),current=await tx.get(ref);
  if(maintenance.exists&&maintenance.data().state!=='ready'||!importState.exists||importState.data().status!=='ready'||!current.exists)return false;const record=current.data();if(record.version!==candidate.version||!oldHistory(record,time))return false;
  const audit=db().collection(root+'/audit').doc();tx.set(ref,{...record,data:{...record.data,deleted:true,deletedAt:FieldValue.serverTimestamp(),deletedBy:'Tự động giữ lịch sử 3 tháng'},version:record.version+1,updatedAt:FieldValue.serverTimestamp(),auditId:audit.id});tx.set(audit,{actor:'Tự động giữ lịch sử 3 tháng',actorUid:'system:history-retention',action:'archive',kind:record.kind,record_id:record.id,at:FieldValue.serverTimestamp()});return true;
 })});const result=await cleanExpiredTrash({now,listRecords:async()=>{const snap=await db().collection(root+'/records').where('data.deleted','==',true).get();return snap.docs.map(d=>({...d.data(),key:d.id}))},purgeOne:async(candidate,now)=>db().runTransaction(async tx=>{
  const ref=db().doc(root+'/records/'+candidate.key),maintenance=await tx.get(db().doc(root+'/meta/maintenance')),importState=await tx.get(db().doc(root+'/meta/import')),current=await tx.get(ref);
  if(maintenance.exists&&maintenance.data().state!=='ready'||!importState.exists||importState.data().status!=='ready'||!current.exists)return false;
  const record=current.data();if(!expiredTrash(record,now)||record.version!==candidate.version)return false;
  const audit=db().collection(root+'/audit').doc();tx.set(audit,{actor:'Tự động dọn thùng rác',actorUid:'system:trash-cleanup',action:'purge',kind:record.kind,record_id:record.id,at:FieldValue.serverTimestamp()});tx.delete(ref);return true;
 })});await db().doc(root+'/meta/trashCleanup').set({...result,historyMonths:history.months,historyCutoff:history.cutoff,historyArchived:history.archived,lastRunAt:FieldValue.serverTimestamp(),lastError:''},{merge:true});logger.info('Expired trash cleanup completed',result)}catch(e){await db().doc(root+'/meta/trashCleanup').set({lastFailureAt:FieldValue.serverTimestamp(),lastError:'cleanup_failed_check_function_logs'},{merge:true});logger.error('Trash cleanup failed',{code:String(e.code||e.message||'unknown')});throw e}
});

export const backupTrashAction=onRequest({region,serviceAccount,memory:'512MiB',timeoutSeconds:540,maxInstances:2,invoker:'public',cors:['https://vovinamantruong2026-spec.github.io']},async(req,res)=>{
 res.set('Cache-Control','private,no-store');if(req.method!=='POST'){res.status(405).json({error:'method_not_allowed'});return}
 try{const bearer=/^Bearer (.+)$/.exec(req.get('Authorization')||'');if(!bearer){res.status(401).json({error:'Vui lòng đăng nhập.'});return}let token;try{token=await getAuth().verifyIdToken(bearer[1],true)}catch{res.status(401).json({error:'Phiên đăng nhập không hợp lệ.'});return}
  const email=String(token.email||'').toLowerCase(),profile=email?(await db().doc(root+'/members/'+email).get()).data():null;if(!token.email_verified||!isOwnerProfile(profile)){res.status(403).json({error:'Chỉ chủ CLB được quản lý bản sao lưu.'});return}const actor={name:profile.name||email,uid:token.uid},action=req.body?.action;
  if(action==='cleanup'){res.json(await rotateBackups(db(),bucket(),root,new Date(),actor));return}
  if(action==='purge'){const targets=req.body?.targets;if(!Array.isArray(targets)||targets.length>100||targets.some(t=>typeof t.id!=='string'||t.id.includes('/')||typeof t.token!=='string')){res.status(400).json({error:'Danh sách bản sao không hợp lệ.'});return}let removed=0,skipped=0;for(const target of targets){if(await purgeBackupTrash(db(),bucket(),root,target,new Date(),actor))removed++;else skipped++}res.json({removed,skipped});return}
  if(action==='download'){const id=req.body?.id,expected=req.body?.token;if(typeof id!=='string'||id.includes('/')){res.status(400).json({error:'Bản sao không hợp lệ.'});return}const snap=await db().doc(root+'/backupTrash/'+id).get();if(!snap.exists||snap.data().token!==expected){res.status(404).json({error:'Bản sao không còn trong thùng rác.'});return}const item=snap.data();if(expiredBackup(item,new Date())){res.status(410).json({error:'Bản sao đã hết 15 ngày khôi phục.'});return}
   res.set('Content-Type','application/json; charset=utf-8');res.set('Content-Disposition',`attachment; filename="AnTruong_Backup_${item.sourceId.replace(/:/g,'-')}.json"`);
   if(item.sourceKind==='snapshot'){const source=await db().doc(root+'/snapshots/'+item.sourceId).get();if(!source.exists||deletedTime(source.data().at)!==deletedTime(item.createdAt)){res.status(404).json({error:'Không tìm thấy dữ liệu bản sao.'});return}res.send(source.data().data);return}
   if(item.sourceKind==='weekly'&&/^\d{4}-\d{2}-\d{2}$/.test(item.sourceId)){const file=bucket().file(PREFIX+item.sourceId+'.json.gz'),[meta]=await file.getMetadata();if(item.generation&&String(meta.generation)!==item.generation||deletedTime(meta.metadata?.createdAt||meta.timeCreated)!==deletedTime(item.createdAt)){res.status(409).json({error:'Bản sao đã thay đổi. Vui lòng tải lại danh sách.'});return}await pipeline(bucket().file(file.name,{generation:meta.generation}).createReadStream(),createGunzip(),res);return}
  }
  res.status(400).json({error:'Thao tác không hợp lệ.'});
 }catch(e){logger.error('Backup trash operation failed',{code:String(e.code||'unknown')});if(!res.headersSent)res.status(500).json({error:'Chưa xử lý được bản sao. Kiểm tra cấu hình tác vụ Firebase.'});else res.end()}
});
