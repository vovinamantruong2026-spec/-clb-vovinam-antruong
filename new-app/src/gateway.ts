import {isStudying} from './student-policy';
import {vvnCode,isVvnCode,vvnPlan,SELF_DEFENSE_BELT} from './vovinam';
import {oldHistory,historyCutoff} from './history-policy';
import {purgeable,expiredTrash,trashTarget,sameTrashRevision} from './trash-policy';
import {applyConfirmedRecord} from './record-state';
import {readCoachTeam,coachTeamChanged,writeCoachAssignment} from './class-coach';
import {collection,doc,getDoc,getDocFromServer,setDoc,getDocsFromServer,query,where,orderBy,limit,onSnapshot,runTransaction,writeBatch,serverTimestamp,deleteDoc,addDoc} from 'firebase/firestore';
import {auth,db,clubId} from './firebase';
import {convertBackup} from './convert';
import {captureApp} from './recovery';
import {codeKey,ensureStudentCodes,codeReservations} from './student-codes';
import {normalizeActor,requireAuditName} from './profile';
const path='clubs/'+clubId;
const recordRef=(kind:string,id:string)=>doc(db,path+'/records/'+kind+'--'+id);
const profileRef=(email:string)=>doc(db,path+'/members/'+email.trim().toLowerCase());
const stamp=(t:any)=>t?.toDate?t.toDate().toISOString():typeof t==='string'?t:new Date().toISOString();
const row=(d:any)=>{const r=d.data();return {...r,data:{...r.data,...(typeof r.data?.deletedAt?.toDate==='function'?{deletedAt:r.data.deletedAt.toDate().toISOString()}: {})},updatedAt:stamp(r.updatedAt)}};
export const can=(a:any,p:string)=>a.isSuperAdmin||a.permissions?.[p]===true;
export async function getActor():Promise<any>{const u=auth.currentUser;if(!u?.email)throw new Error('Vui lòng đăng nhập.');const s=await getDoc(profileRef(u.email));if(!s.exists()||s.data().status!=='active')throw new Error('Tài khoản chưa được cấp quyền hoặc đã bị khóa. Nhờ chủ CLB gắn đúng email đăng nhập.');return normalizeActor(s.data(),{email:u.email,uid:u.uid})}
function queries(a:any){
 if(a.isSuperAdmin)return [query(collection(db,path+'/records'))];
 const all=a.isSuperAdmin||a.allClasses,scopes=all?null:(a.classIds||[]),qs:any[]=[];
 const scoped=(kind:string,field='data.classId')=>{if(all)qs.push(query(collection(db,path+'/records'),where('kind','==',kind)));else for(let i=0;i<scopes.length;i+=30)qs.push(query(collection(db,path+'/records'),where('kind','==',kind),where(field,'in',scopes.slice(i,i+30))))};
 scoped('class','id');qs.push(query(collection(db,path+'/records'),where('kind','==','config')));
 if(a.isSuperAdmin)qs.push(query(collection(db,path+'/records'),where('kind','==','account')));else qs.push(query(collection(db,path+'/records'),where('kind','==','account'),where('id','==',a.id)));
 if(['students_direct','attendance_manage','tuition_manage','reports_export','gear_manage','tournaments_manage','approvals_manage'].some(p=>can(a,p)))scoped('student');
 if(can(a,'attendance_manage')||can(a,'reports_export'))scoped('attendance');
 for(const [kind,p] of [['tuition','tuition_manage'],['gear','gear_manage'],['tournament','tournaments_manage'],['approval','approvals_manage']])if(can(a,p))scoped(kind);
 return qs;
}
let cached:any=null,revision=0;
function assemble(a:any,docs:any[],extra:any={}){
 const previous=cached?.actor?.identityId===a.identityId&&cached?.actor?.isSuperAdmin===a.isSuperAdmin?cached:null;
 cached={actor:a,records:docs,revision:++revision,serverAt:new Date().toISOString(),audit:a.isSuperAdmin?previous?.audit||[]:[],backups:a.isSuperAdmin?previous?.backups||[]:[],migration:a.isSuperAdmin?previous?.migration||null:null,ownerDetailsReady:a.isSuperAdmin?previous?.ownerDetailsReady||false:false,...extra};return cached;
}
export async function readState(){const a=await getActor();const snapshots=await Promise.all(queries(a).map(q=>getDocsFromServer(q)));return assemble(a,snapshots.flatMap(s=>s.docs.map(row)))}
// Heavy owner-only lists are subscribed only while Settings is open.
export function watchOwnerDetails(onDetails:(d:any)=>void,onError:(e:any)=>void){
 let stopped=false;const details:any={audit:[],backups:[],ownerDetailsReady:false};const ready=new Set<string>();const uid=auth.currentUser?.uid;
 const emit=()=>{if(stopped)return;if(cached?.actor?.identityId===uid&&cached.actor.isSuperAdmin)cached={...cached,...details};onDetails({...details})};
 const logs=onSnapshot(query(collection(db,path+'/audit'),orderBy('at','desc'),limit(30)),{includeMetadataChanges:true},snap=>{if(snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;details.audit=snap.docs.map(d=>({...d.data(),id:d.id,at:stamp(d.data().at)}));ready.add('audit');details.ownerDetailsReady=ready.size===2;emit()},onError);
 const copies=onSnapshot(query(collection(db,path+'/snapshots'),orderBy('at','desc'),limit(30)),{includeMetadataChanges:true},snap=>{if(snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;details.backups=snap.docs.map(d=>({id:d.id,at:stamp(d.data().at),bytes:d.data().data?.length||0}));ready.add('backups');details.ownerDetailsReady=ready.size===2;emit()},onError);
 return()=>{stopped=true;logs();copies()};
}
export function watchState(onState:(s:any)=>void,onError:(e:any)=>void){
 const u=auth.currentUser;if(!u?.email)return ()=>{};
 let stops:(()=>void)[]=[],metaStop:(()=>void)|null=null,cancelled=false,generation=0,timer:any=null,actor:any=null,latestMember:any=null,scopeKey='',maintenance='ready',migration:any=null;
 let chunks=new Map<number,any[]>(),expected=0;
 const stopRecords=()=>{generation++;if(timer!==null){clearTimeout(timer);timer=null}stops.forEach(f=>f());stops=[];metaStop?.();metaStop=null;chunks.clear()};
 const fail=(e:any)=>{if(cancelled)return;stopRecords();cached=null;scopeKey='';onError(e)};
 const emit=()=>{if(cancelled||!actor||chunks.size!==expected)return;onState(assemble(actor,Array.from(chunks.values()).flat(),{migration:actor.isSuperAdmin?migration:null}))};
 const schedule=()=>{if(timer!==null)return;const current=generation;timer=setTimeout(()=>{timer=null;if(current===generation)emit()},0)};
 const restart=(a:any)=>{
  stopRecords();actor=a;const current=generation,qs=queries(a);expected=qs.length;
  stops=qs.map((q,i)=>onSnapshot(q,{includeMetadataChanges:true},(snap:any)=>{if(cancelled||current!==generation||snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;chunks.set(i,snap.docs.map(row));if(chunks.size===expected)schedule()},e=>{if(current===generation)fail(e)}));
  if(a.isSuperAdmin)metaStop=onSnapshot(doc(db,path+'/meta/import'),{includeMetadataChanges:true},snap=>{if(cancelled||current!==generation||snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;migration=snap.exists()?snap.data():null;schedule()},e=>{if(current===generation)onError(e)});
 };
 const applyMember=(member:any)=>{
  latestMember=member;if(!member.exists()||member.data().status!=='active'){actor=null;fail(new Error('Tài khoản chưa được cấp quyền hoặc đã bị khóa.'));return}
  const a=normalizeActor(member.data(),{email:u.email!,uid:u.uid});
  if(!a.isSuperAdmin&&maintenance!=='ready'){actor=null;fail(Object.assign(new Error('Đang bảo trì hoặc khôi phục dữ liệu. Vui lòng chờ hoàn tất.'),{code:'permission-denied'}));return}
  const key=JSON.stringify([a.id,!!a.isSuperAdmin,!!a.allClasses,[...(a.classIds||[])].sort(),a.permissions||{}]);
  if(key!==scopeKey||!stops.length){scopeKey=key;restart(a)}else{actor=a;schedule()}
 };
 const stopMember=onSnapshot(profileRef(u.email),{includeMetadataChanges:true},member=>{if(cancelled||member.metadata.fromCache||member.metadata.hasPendingWrites)return;applyMember(member)},fail);
 const stopMaintenance=onSnapshot(doc(db,path+'/meta/maintenance'),{includeMetadataChanges:true},snap=>{if(cancelled||snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;const next=snap.data()?.state||'ready';if(next===maintenance)return;maintenance=next;if(latestMember&&!latestMember.data()?.isSuperAdmin)applyMember(latestMember)},fail);
 return()=>{cancelled=true;stopMember();stopMaintenance();stopRecords()};
}
function validate(kind:string,id:string,data:any,state:any){
 if(kind==='student'&&(!data.name?.trim()||!data.id?.trim()||!data.classId))throw new Error('Cần nhập họ tên, mã võ sinh và lớp.');
 if(kind==='student'&&state?.records.some((r:any)=>r.kind==='student'&&r.id!==id&&!r.data.deleted&&r.data.id===data.id))throw new Error('Mã võ sinh đã được sử dụng.');
 if(kind==='attendance'){if(!data.rows?.length)throw new Error('Buổi tập chưa có võ sinh.');if(data.status==='final'&&data.rows.some((r:any)=>r.status==='unmarked'))throw new Error('Cần điểm danh đầy đủ trước khi chốt.');const ids=new Set(data.rows.map((r:any)=>r.studentUid));if(ids.size!==data.rows.length)throw new Error('Danh sách có dòng trùng.');for(const r of data.rows)if(!state?.records.some((s:any)=>s.kind==='student'&&s.id===r.studentUid))throw new Error('Có võ sinh ngoài phạm vi lớp được cấp.');if(data.status==='final'&&state?.records.some((r:any)=>r.kind==='student'&&isStudying(r)&&r.data.classId===data.classId&&!ids.has(r.id)))throw new Error('Danh sách lớp đã thay đổi. Tải lại trước khi chốt.');}
 if(kind==='account'&&data.isSuperAdmin)throw new Error('Hồ sơ chủ CLB được bảo vệ.');
}
export async function mutate(input:any,codeAttempt=0):Promise<any>{
 const a=await getActor(),auditName=requireAuditName(a),{kind,id,version}=input;let data={...input.data};delete data.password;delete data.passwordHash;delete data.secret;delete data.databaseSecret;if(!auth.currentUser?.emailVerified)throw new Error('Cần xác minh email rồi đăng nhập lại trước khi lưu.');if(kind==='student'){data.id=String(data.id||'').trim();if(a.isSuperAdmin)await ensureStudentCodes(db,path);else if(!(await getDoc(doc(db,path+'/meta/studentCodes'))).data()?.ready)throw new Error('Chủ CLB cần mở Cài đặt để khởi tạo danh mục mã võ sinh.');}
 if((data.deleted===true||input.data?.deleted===false)&&!a.isSuperAdmin)throw new Error('Chỉ chủ CLB được chuyển vào thùng rác hoặc khôi phục.');if(kind==='account'&&data.deleted)data.status='inactive';
 const automaticCode=kind==='student'&&version===0;
 if(automaticCode){let n=1+Math.max(0,...(cached?.records||[]).filter((r:any)=>r.kind==='student'&&isVvnCode(r.data.id)).map((r:any)=>Number(r.data.id.slice(4))));while((await getDocFromServer(doc(db,path+'/studentCodes/'+codeKey(vvnCode(n))))).exists())n++;data.id=vvnCode(n);}
 if(kind!=='attendance')validate(kind,id,data,cached);if(a.isSuperAdmin)await snapshotDaily(false,a);
 if(kind==='account'){data.email=String(data.email||'').trim().toLowerCase();if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw new Error('Email chưa đúng định dạng.');if(data.email===a.email)throw new Error('Email chủ CLB đã được sử dụng.');}
 const auditRef=doc(collection(db,path+'/audit'));const ref=recordRef(kind,id);
 let result:any;try{result=await runTransaction(db,async tx=>{const maintenance=await tx.get(doc(db,path+'/meta/maintenance'));if(maintenance.exists()&&maintenance.data().state!=='ready')throw new Error('Đang bảo trì hoặc khôi phục dữ liệu. Hãy thử lại sau.');const current=await tx.get(ref);const existing=current.exists()?current.data():null;if((existing?.version||0)!==version)throw new Error('Bản ghi vừa được máy khác thay đổi. Tải phiên bản mới rồi sửa lại.');
  if(kind==='attendance'){const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>!['deleted','deletedAt','deletedBy'].includes(k)).map(k=>[k,stable(v[k])])):v;const trashOnly=a.isSuperAdmin&&existing&&!!existing.data.deleted!==!!data.deleted&&JSON.stringify(stable(existing.data))===JSON.stringify(stable(data));if(!trashOnly)validate(kind,id,data,cached);}
  if(existing?.data?.isSuperAdmin&&kind==='account')throw new Error('Không thể khóa hoặc xóa tài khoản chủ CLB.');if(existing?.data?.deleted&&!a.isSuperAdmin)throw new Error('Hồ sơ đang ở thùng rác.');
  if(data.deleted===true&&!existing?.data?.deleted)data.deletedAt=serverTimestamp();
  if(data.deleted===false)data.deletedAt='';
  let coachAssignments:any[]=[];
  if(kind==='class'&&coachTeamChanged(existing?.data,data)){
   if(!a.isSuperAdmin)throw new Error('Chỉ chủ CLB được thêm, xóa hoặc đổi HLV phụ trách.');
   if(!data.deleted){const team=await readCoachTeam(tx,db,path,id,existing?.data,data);coachAssignments=team.assignments;data={...data,...team.fields};}
  }
  let oldMember:any=null,newMember:any=null;const oldEmail=existing?.data?.email||'';
  if(kind==='account'&&data.email){newMember=await tx.get(profileRef(data.email));if(newMember.exists()&&newMember.data().id!==id)throw new Error('Email đã gắn với hồ sơ khác.');}
  if(kind==='account'&&oldEmail&&oldEmail!==data.email){oldMember=await tx.get(profileRef(oldEmail));if(oldMember.exists()&&oldMember.data().isSuperAdmin)throw new Error('Tài khoản chủ CLB được bảo vệ.');}
  let codeRef:any=null,oldCodeRef:any=null;if(kind==='student'){codeRef=doc(db,path+'/studentCodes/'+codeKey(data.id));const reserved:any=await tx.get(codeRef);if(reserved.exists()&&reserved.data().studentUid!==id)throw Object.assign(new Error('Mã võ sinh đã được sử dụng trên hệ thống.'),{code:automaticCode?'vvn-code-race':'duplicate-code'});if(existing?.data?.id&&codeKey(existing.data.id)!==codeKey(data.id))oldCodeRef=doc(db,path+'/studentCodes/'+codeKey(existing.data.id));}
  const next={kind,id,data,version:version+1,updatedAt:serverTimestamp(),auditId:auditRef.id};tx.set(ref,next);if(codeRef)tx.set(codeRef,{studentUid:id});if(oldCodeRef)tx.delete(oldCodeRef);tx.set(auditRef,{actor:auditName,actorUid:a.identityId,action:existing?'update':'create',kind,record_id:id,at:serverTimestamp()});
  if(kind==='account'){if(oldMember?.exists())tx.delete(profileRef(oldEmail));if(data.email)tx.set(profileRef(data.email),{id,name:data.name,email:data.email,status:data.status,isSuperAdmin:false,allClasses:!!data.allClasses,classIds:data.classIds||[],permissions:data.permissions||{},roleTitle:data.roleTitle||'Thành viên',requireEmailVerification:true});}
  for(const assignment of coachAssignments)writeCoachAssignment(tx,db,path,assignment,{name:auditName,uid:a.identityId});
  return {...next,data:{...data,...(data.deletedAt&&typeof data.deletedAt==='object'&&!data.deletedAt.toDate?{deletedAt:new Date().toISOString()}: {})},updatedAt:new Date().toISOString()};
 });}catch(e:any){if(e.code==='vvn-code-race'&&codeAttempt<8)return mutate(input,codeAttempt+1);throw e;}if(cached?.actor?.identityId===a.identityId)cached={...cached,records:applyConfirmedRecord(cached.records,result)};return {ok:true,record:result};
}
async function allRecords(){const s=await getDocsFromServer(collection(db,path+'/records'));return s.docs.map(row)}
const dailySnapshots=new Map<string,string>();
export async function snapshotDaily(force=false,knownActor?:any){const a=knownActor||await getActor();if(!a.isSuperAdmin)throw new Error('Chỉ chủ CLB được sao lưu toàn bộ.');const id=force?new Date().toISOString():new Date().toISOString().slice(0,10);const key=a.identityId+':'+id;if(!force&&dailySnapshots.has(key))return id;const ref=doc(db,path+'/snapshots/'+id);if((await getDoc(ref)).exists()){dailySnapshots.set(key,id);return id;}const data=JSON.stringify({format:'antruong-v2',exportedAt:new Date().toISOString(),records:await allRecords()});if(data.length>850000)throw new Error('Bản sao lớn. Hãy tải JSON thay vì lưu bản sao trực tuyến.');await runTransaction(db,async tx=>{if(!(await tx.get(ref)).exists())tx.set(ref,{at:serverTimestamp(),data})});dailySnapshots.set(key,id);return id}
export async function downloadBackup(id?:string){const a=await getActor();if(!a.isSuperAdmin)throw new Error('Bạn không có quyền sao lưu.');let text;if(id){const s=await getDoc(doc(db,path+'/snapshots/'+id));if(!s.exists())throw new Error('Không tìm thấy bản sao.');text=s.data().data}else{text=JSON.stringify(await captureApp(),null,2)}const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='AnTruong_Backup_'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
export async function importBackup(file:File){
 const a=await getActor();if(!a.isSuperAdmin)throw new Error('Chỉ chủ CLB được nhập dữ liệu.');const auditName=requireAuditName(a);if(file.size>5000000)throw new Error('File vượt quá 5 MB.');const text=await file.text();const normalized=convertBackup(JSON.parse(text));codeReservations(normalized.rows);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');const marker=doc(db,path+'/meta/import');
 const existing=await getDoc(marker);if(!existing.exists()&&(await getDocsFromServer(query(collection(db,path+'/records'),limit(1)))).size)throw new Error('Vùng dữ liệu đã có hồ sơ. Không nhập đè.');
 await runTransaction(db,async tx=>{const mark=await tx.get(marker);if(mark.exists()&&(mark.data().status!=='in_progress'||mark.data().hash!==hash))throw new Error('Đã nhập trước đó hoặc đang nhập file khác. Hãy chọn đúng file để tiếp tục.');if(!mark.exists())tx.set(marker,{status:'in_progress',hash,source:file.name,counts:normalized.counts,warnings:normalized.warnings,at:serverTimestamp()})});
 // Small transactions stay below Rules expression limits. A hash locks resumable imports;
 // staff access stays blocked until the final ready marker commits.
 for(let i=0;i<normalized.rows.length;i+=4){const chunk=normalized.rows.slice(i,i+4);await runTransaction(db,async tx=>{const current=await Promise.all(chunk.map(r=>tx.get(recordRef(r.kind,r.id))));const reservations=await Promise.all(chunk.map(r=>r.kind==='student'?tx.get(doc(db,path+'/studentCodes/'+codeKey(r.data.id))):Promise.resolve(null)));chunk.forEach((r,n)=>{const reserved=reservations[n];if(reserved?.exists()&&reserved.data().studentUid!==r.id)throw new Error('Mã võ sinh đã thuộc hồ sơ khác: '+r.data.id);if(!current[n].exists()){tx.set(recordRef(r.kind,r.id),{...r,version:1,updatedAt:serverTimestamp(),imported:true});if(r.kind==='student')tx.set(doc(db,path+'/studentCodes/'+codeKey(r.data.id)),{studentUid:r.id});}})})}
 const done=writeBatch(db);done.set(marker,{status:'ready',hash,source:file.name,counts:normalized.counts,warnings:normalized.warnings,at:serverTimestamp()});const event=doc(collection(db,path+'/audit'));done.set(event,{actor:auditName,actorUid:a.identityId,action:'import',kind:'backup',record_id:'initial',at:serverTimestamp()});await done.commit();return normalized.counts;
}

export function watchTrashCleanup(onStatus:(s:any)=>void,onError:(e:any)=>void){return onSnapshot(doc(db,path+'/meta/trashCleanup'),snap=>onStatus(snap.data()||{}),onError)}
export async function purgeTrashRecords(targets:{kind:string;id:string;version:number}[],expiredOnly=false,serverNow=Date.now()){
 const actor=await getActor();if(!actor.isSuperAdmin)throw new Error('Chỉ chủ CLB được dọn thùng rác.');const auditName=requireAuditName(actor);let removed=0,skipped=0;const deletedTargets:any[]=[];
 for(const target of targets){
  if(!['student','class','attendance','tuition','account','gear','tournament','approval'].includes(target.kind)){skipped++;continue}
  const ref=recordRef(target.kind,target.id),audit=doc(collection(db,path+'/audit'));
  try{const didDelete=await runTransaction(db,async tx=>{
   const maintenance=await tx.get(doc(db,path+'/meta/maintenance')),importState=await tx.get(doc(db,path+'/meta/import')),snap=await tx.get(ref);
   if(maintenance.exists()&&maintenance.data().state!=='ready'||!importState.exists()||importState.data().status!=='ready')throw new Error('Đang nhập hoặc khôi phục dữ liệu. Hãy dọn thùng rác sau khi hoàn tất.');
   if(!snap.exists())return false;const record=snap.data();if(!sameTrashRevision(record,target)||!purgeable(record)||expiredOnly&&!expiredTrash(record,serverNow))return false;
   tx.set(doc(db,path+'/meta/trashPurge'),{recordKey:target.kind+'--'+target.id,auditId:audit.id,actorUid:actor.identityId,at:serverTimestamp()});
   tx.set(audit,{actor:auditName,actorUid:actor.identityId,action:'purge',kind:target.kind,record_id:target.id,at:serverTimestamp()});tx.delete(ref);return true;
  });if(didDelete){removed++;deletedTargets.push(target);if(cached?.actor?.identityId===actor.identityId)cached={...cached,records:cached.records.filter((r:any)=>!(sameTrashRevision(r,target)&&r.data.deleted))}}else skipped++;
  }catch(e:any){throw new Error('Đã xóa '+removed+' mục. '+(e.code==='permission-denied'?'Cần cập nhật Firestore Rules mới để xóa vĩnh viễn.':e.message||'Chưa dọn được các mục còn lại.'))}
 }
 return {removed,skipped,deletedTargets};
}

export async function purgeExpiredTrashRecords(records:any[]){
 const actor=await getActor();if(!actor.isSuperAdmin)throw new Error('Chỉ chủ CLB được dọn thùng rác.');
 const clock=doc(db,path+'/meta/trashClock');await setDoc(clock,{at:serverTimestamp()});const time=(await getDocFromServer(clock)).data()?.at?.toMillis?.();if(!Number.isFinite(time))throw new Error('Chưa xác nhận được thời gian máy chủ.');
 const targets=records.filter(r=>expiredTrash(r,time)).map(trashTarget);
 return purgeTrashRecords(targets,true,time);
}

export async function archiveOldHistoryRecords(records:any[]){
 const actor=await getActor();if(!actor.isSuperAdmin)throw new Error('Chỉ chủ CLB được dọn lịch sử quá hạn.');const name=requireAuditName(actor);
 const clock=doc(db,path+'/meta/trashClock');await setDoc(clock,{at:serverTimestamp()});const time=(await getDocFromServer(clock)).data()?.at?.toMillis?.();if(!Number.isFinite(time))throw new Error('Chưa xác nhận được thời gian máy chủ.');const now=new Date(time);let archived=0,skipped=0;
 for(const candidate of records.filter(r=>oldHistory(r,now))){const ref=recordRef(candidate.kind,candidate.id),audit=doc(collection(db,path+'/audit'));
  const result=await runTransaction(db,async tx=>{const maintenance=await tx.get(doc(db,path+'/meta/maintenance')),importState=await tx.get(doc(db,path+'/meta/import')),current=await tx.get(ref);
   if(maintenance.exists()&&maintenance.data().state!=='ready'||!importState.exists()||importState.data().status!=='ready')throw new Error('Chưa dọn lịch sử trong lúc nhập hoặc khôi phục dữ liệu.');
   if(!current.exists())return false;const record=current.data();if(record.version!==candidate.version||!oldHistory(record,now))return false;
   tx.set(ref,{...record,data:{...record.data,deleted:true,deletedAt:serverTimestamp(),deletedBy:name},version:record.version+1,updatedAt:serverTimestamp(),auditId:audit.id});
   tx.set(audit,{actor:name,actorUid:actor.identityId,action:'archive',kind:record.kind,record_id:record.id,at:serverTimestamp()});return true;
  });if(result)archived++;else skipped++;
 }
 return {archived,skipped,cutoff:historyCutoff(now)};
}

// Resumable full renumber; the maintenance lock blocks other writes.
export async function standardizeStudentCodes(){
 const a=await getActor();if(!a.isSuperAdmin)return 0;const name=requireAuditName(a);
 const marker=doc(db,path+'/meta/studentRenumberV4'),lock=doc(db,path+'/meta/maintenance');
 if((await getDocFromServer(marker)).data()?.status==='done')return 0;
 await getDocsFromServer(collection(db,path+'/studentCodes'));
 await snapshotDaily(true,a);
 const runId=await runTransaction(db,async tx=>{
  const [m,l]=await Promise.all([tx.get(marker),tx.get(lock)]);
  if(m.data()?.status==='done')return '';
  if(l.exists()&&l.data().state!=='ready'&&l.data().operation!=='student-renumber-v4')throw new Error('Đang bảo trì hoặc khôi phục dữ liệu. Hãy hoàn tất trước.');
  const runId=l.data()?.operation==='student-renumber-v4'?l.data().runId:crypto.randomUUID();
  tx.set(lock,{state:'renumbering',operation:'student-renumber-v4',runId,at:serverTimestamp()});return runId;
 });if(!runId)return 0;
 const check=(s:any)=>{if(s.data()?.runId!==runId||s.data()?.operation!=='student-renumber-v4')throw new Error('Phiên đánh mã đã thay đổi. Tải lại để tiếp tục.');};
 let plan=(await getDocFromServer(marker)).data()?.plan;
 if(!plan){const proposed=vvnPlan(await allRecords()).map(({record,code})=>({id:record.id,code}));plan=await runTransaction(db,async tx=>{const [l,m]=await Promise.all([tx.get(lock),tx.get(marker)]);check(l);if(m.data()?.plan)return m.data().plan;tx.set(marker,{status:'running',plan:proposed,at:serverTimestamp()});return proposed;});}
 for(const item of plan){
  const ref=recordRef('student',item.id),audit=doc(collection(db,path+'/audit'));
  await runTransaction(db,async tx=>{const [l,current]=await Promise.all([tx.get(lock),tx.get(ref)]);check(l);if(!current.exists())throw new Error('Thiếu hồ sơ trong danh sách đánh mã.');const r=current.data();
   if(r.data.id!==item.code){tx.set(ref,{...r,data:{...r.data,id:item.code},version:r.version+1,updatedAt:serverTimestamp(),auditId:audit.id});tx.set(audit,{actor:name,actorUid:a.identityId,action:'renumber',kind:'student',record_id:item.id,at:serverTimestamp()});}
   tx.set(doc(db,path+'/studentCodes/'+codeKey(item.code)),{studentUid:item.id});
  });
 }
 const expected=codeReservations(await allRecords()),old=await getDocsFromServer(collection(db,path+'/studentCodes'));
 for(const d of old.docs)if(!expected.has(d.id))await runTransaction(db,async tx=>{const l=await tx.get(lock);check(l);tx.delete(d.ref);});
 await runTransaction(db,async tx=>{const l=await tx.get(lock);check(l);tx.set(marker,{status:'done',count:plan.length,at:serverTimestamp()});tx.set(doc(db,path+'/meta/studentCodes'),{ready:true,at:serverTimestamp()});tx.set(lock,{state:'ready',at:serverTimestamp()});});
 return plan.length;
}

// Keep the correction checkpoint in the existing club settings record. This
// uses the same records/audit permissions as ordinary edits, without requiring
// a newly introduced meta document to be readable or writable in deployed Rules.
export async function resetCurrentStudentBelts(){
 const actor=await getActor();if(!actor.isSuperAdmin)return 0;const name=requireAuditName(actor),field='studentBeltsSelfDefense20261102';
 const records=await allRecords(),settings=records.find(r=>r.kind==='config'&&r.id==='club')||records.find(r=>r.kind==='config'),settingsId=settings?.id||'club',settingsRef=recordRef('config',settingsId),lock=doc(db,path+'/meta/maintenance');
 if(settings?.data?.[field]?.status==='done')return 0;
 // Carry forward the previous release's committed cursor when it is accessible.
 let previous:any=null;try{previous=(await getDocFromServer(doc(db,path+'/meta/'+field))).data();}catch(e:any){if(e.code!=='permission-denied')throw e;}
 if(previous?.status==='done')return 0;
 const ids=Array.isArray(previous?.ids)?previous.ids:records.filter(r=>r.kind==='student').map(r=>r.id).sort();
 const allowed=(snap:any)=>{const l=snap.data();if(l&&l.state!=='ready'&&!(l.state==='renumbering'&&l.operation==='student-renumber-v4'))throw new Error('Đang nhập hoặc khôi phục dữ liệu. Hãy hoàn tất trước khi cập nhật đai.');};
 const event=(kind:string,id:string,action:string)=>({actor:name,actorUid:actor.identityId,action,kind,record_id:id,at:serverTimestamp()});
 const writeProgress=(tx:any,current:any,plan:any)=>{const audit=doc(collection(db,path+'/audit')),old=current.data();tx.set(settingsRef,{...(old||{}),kind:'config',id:settingsId,data:{...(old?.data||{}),[field]:plan},version:(old?.version||0)+1,updatedAt:serverTimestamp(),auditId:audit.id});tx.set(audit,event('config',settingsId,'belt-correction-progress'));};
 let stage='lưu tiến độ sửa đai';
 try{
  await runTransaction(db,async tx=>{const [current,l,imported]=await Promise.all([tx.get(settingsRef),tx.get(lock),tx.get(doc(db,path+'/meta/import'))]);allowed(l);if(imported.data()?.status!=='ready')throw new Error('Hãy hoàn tất nhập dữ liệu trước khi cập nhật đai.');if(!current.data()?.data?.[field])writeProgress(tx,current,{status:'running',ids,next:previous?.next||0,changed:previous?.changed||0,previousBelts:{}});});
  while(true){
   const step=async(repairReservation:boolean)=>runTransaction(db,async tx=>{
    const [settings,l]=await Promise.all([tx.get(settingsRef),tx.get(lock)]);allowed(l);const plan=settings.data()?.data?.[field];if(plan?.status==='done')return {done:true,changed:plan.changed||0};if(!Array.isArray(plan?.ids))throw new Error('Chưa có danh sách cập nhật cấp đai.');
    const index=plan.next||0;if(index>=plan.ids.length){writeProgress(tx,settings,{...plan,status:'done'});return {done:true,changed:plan.changed||0};}
    const id=plan.ids[index],ref=recordRef('student',id),current=await tx.get(ref),r=current.data();let changed=0,codeRef:any=null;const previousBelts={...(plan.previousBelts||{})};
    if(r?.kind==='student'&&r.data.belt!==SELF_DEFENSE_BELT){
     if(repairReservation){codeRef=doc(db,path+'/studentCodes/'+codeKey(r.data.id));const reserved:any=await tx.get(codeRef);if(reserved.exists()&&reserved.data().studentUid!==id)throw new Error('Mã võ sinh đang liên kết với hồ sơ khác. Không tự ghi đè.');}
     const audit=doc(collection(db,path+'/audit'));previousBelts[id]={hadBelt:Object.prototype.hasOwnProperty.call(r.data,'belt'),belt:r.data.belt??null};
     tx.set(ref,{...r,data:{...r.data,belt:SELF_DEFENSE_BELT},version:r.version+1,updatedAt:serverTimestamp(),auditId:audit.id});tx.set(audit,event('student',id,'correct-belt'));if(codeRef)tx.set(codeRef,{studentUid:id});changed=1;
    }
    writeProgress(tx,settings,{...plan,next:index+1,changed:(plan.changed||0)+changed,previousBelts});return {done:false,changed:0};
   });
   stage='lưu cấp đai và nhật ký';let result;try{result=await step(false);}catch(e:any){if(e.code!=='permission-denied')throw e;stage='xác nhận mã và lưu cấp đai';result=await step(true);}
   if(result.done)return result.changed;
  }
 }catch(e:any){if(e.code==='permission-denied')throw Object.assign(new Error('Firebase từ chối quyền '+stage+'. Cần kiểm tra Firestore Rules; tải lại trang không tự cấp thêm quyền.'),{code:e.code});throw e;}
}

export async function updateStudentRecords(){
 const result={codes:0,belts:0,errors:[] as string[]};
 if((await getDocFromServer(doc(db,path+'/meta/import'))).data()?.status!=='ready')return result;
 // A failed identifier migration must not prevent an independent belt correction.
 try{result.belts=await resetCurrentStudentBelts();}catch(e:any){result.errors.push('Cấp đai: '+e.message);}
 try{result.codes=await standardizeStudentCodes();}catch(e:any){result.errors.push('Mã võ sinh: '+(e.code==='permission-denied'?'Firebase chưa cấp quyền cho tác vụ đổi mã. Cần kiểm tra Firestore Rules.':e.message));}
 return result;
}
