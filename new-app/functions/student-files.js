import {randomUUID} from 'node:crypto';
import {authorizeStudentFile,decodeStudentFile,appendStudentFile,validStudentId,mediaError,studentFileName,FILE_CATEGORIES} from './student-files-core.js';
// Storage stays private; every download rechecks current membership and class scope.
export function createStudentFilesHandler({db,bucket,auth,stamp,logError}){
 const root='clubs/antruong-v2';
 async function context(tx,email,id){const get=ref=>tx?tx.get(ref):ref.get();const [member,current,maintenance,importState]=await Promise.all([get(db.doc(root+'/members/'+email)),get(db.doc(root+'/records/student--'+id)),get(db.doc(root+'/meta/maintenance')),get(db.doc(root+'/meta/import'))]);return {member:member.data(),record:current.data(),maintenance:maintenance.exists&&maintenance.data().state!=='ready',importReady:importState.data()?.status==='ready'}}
 return async(req,res)=>{
  res.set('Cache-Control','private,no-store');res.set('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method)){res.status(405).json({error:'method_not_allowed'});return}
  let uploaded;
  try{
   const bearer=/^Bearer (.+)$/.exec(req.get('Authorization')||'');if(!bearer)throw mediaError(401,'Vui lòng đăng nhập.');
   let token;try{token=await auth.verifyIdToken(bearer[1],true)}catch{throw mediaError(401,'Phiên đăng nhập đã hết hạn. Đăng nhập lại.')}
   const email=String(token.email||'').toLowerCase();if(!email||email.includes('/'))throw mediaError(403,'Không có quyền.');
   const id=req.method==='GET'?req.query.studentId:req.body?.studentId;if(!validStudentId(id))throw mediaError(400,'Mã hồ sơ không hợp lệ.');
   const initial=await context(null,email,id);
   if(req.method==='GET'){
    const fileId=String(req.query.fileId||'');if(!/^[a-f0-9-]{36}$/.test(fileId))throw mediaError(400,'Tệp không hợp lệ.');
    // Category comes from immutable server-written Storage metadata, never the request/record.
    authorizeStudentFile({...initial,token,category:'avatar'});
    const file=bucket.file('student-files/antruong-v2/'+id+'/'+fileId);let metadata;try{[metadata]=await file.getMetadata()}catch(e){if(Number(e.code)===404)throw mediaError(404,'Không tìm thấy tệp.');throw e}
    const category=metadata.metadata?.category;if(!FILE_CATEGORIES.includes(category)||metadata.metadata?.studentId!==id)throw mediaError(404,'Tệp không hợp lệ.');
    authorizeStudentFile({...initial,token,category});
    const mime=metadata.contentType;if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(mime))throw mediaError(404,'Định dạng tệp không hợp lệ.');
    const [bytes]=await file.download();res.set('Content-Type',mime);res.set('Content-Disposition','attachment; filename="'+studentFileName({id:fileId,category,mime})+'"');res.status(200).send(bytes);return;
   }
   const category=req.body?.category;authorizeStudentFile({...initial,token,category,write:true});
   const {bytes,mime}=decodeStudentFile(category,req.body?.base64),fileId=randomUUID(),file={id:fileId,category,mime,bytes:bytes.length,uploadedAt:new Date().toISOString()};
   // Stable opaque names avoid exposing names/identity numbers through record metadata.
   const destination=bucket.file('student-files/antruong-v2/'+id+'/'+fileId);
   await destination.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:mime,cacheControl:'private,no-store',metadata:{category,studentId:id}}});uploaded=destination;
   const result=await db.runTransaction(async tx=>{
    const current=await context(tx,email,id);authorizeStudentFile({...current,token,category,write:true});
    const record=current.record,audit=db.collection(root+'/audit').doc();const next={...record,data:appendStudentFile(record,file),version:record.version+1,updatedAt:stamp(),auditId:audit.id};
    tx.set(db.doc(root+'/records/student--'+id),next);tx.set(audit,{actor:current.member.name||email,actorUid:token.uid,action:'update',kind:'student',record_id:id,at:stamp()});return {...next,updatedAt:new Date().toISOString()};
   });uploaded=null;res.status(200).json({record:result});
  }catch(e){if(uploaded)await uploaded.delete().catch(()=>{});const status=Number(e.status)||500;if(status===500)logError?.('Student file operation failed',{code:String(e.code||'unknown')});if(!res.headersSent)res.status(status).json({error:status===500?'Chưa lưu hoặc tải được tệp. Hãy thử lại.':e.message});}
 };
}
