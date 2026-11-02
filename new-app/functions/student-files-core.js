export const FILE_LIMIT=5*1024*1024;
export const FILE_CATEGORIES=['avatar','cccd-front','cccd-back','certificate'];
export const STUDENT_READ_PERMISSIONS=['students_direct','attendance_manage','tuition_manage','reports_export','gear_manage','tournaments_manage','approvals_manage'];
export function mediaError(status,message){return Object.assign(new Error(message),{status})}
export function validStudentId(id){return typeof id==='string'&&id.length>0&&id.length<250&&!id.includes('/')&&!/[\u0000-\u001f]/.test(id)}
export function authorizeStudentFile({token,member,record,maintenance,importReady,category,write=false}){
 if(!token?.uid||token.email_verified!==true)throw mediaError(401,'Vui lòng đăng nhập và xác minh email.');
 if(!member||member.status!=='active')throw mediaError(403,'Tài khoản chưa được cấp quyền hoặc đã bị khóa.');
 if(record?.kind!=='student')throw mediaError(404,'Không tìm thấy võ sinh.');
 const owner=member.isSuperAdmin===true;
 if(maintenance||((write||!owner)&&!importReady))throw mediaError(409,'Đang khôi phục hoặc chuẩn bị dữ liệu. Hãy thử lại sau.');
 if(!owner){if(record.data?.deleted||!(member.allClasses===true||Array.isArray(member.classIds)&&member.classIds.includes(record.data?.classId)))throw mediaError(403,'Võ sinh ngoài phạm vi lớp được cấp.');
 if(category==='cccd-front'||category==='cccd-back')throw mediaError(403,'Chỉ chủ CLB được mở hoặc thêm CCCD.');
 const allowed=write||category!=='avatar'?member.permissions?.students_direct===true:STUDENT_READ_PERMISSIONS.some(p=>member.permissions?.[p]===true);if(!allowed)throw mediaError(403,'Bạn chưa có quyền quản lý hồ sơ võ sinh.');}
 if(write&&record.data?.deleted)throw mediaError(409,'Khôi phục võ sinh khỏi thùng rác trước khi thêm tệp.');
}
export function decodeStudentFile(category,base64){
 if(!FILE_CATEGORIES.includes(category))throw mediaError(400,'Loại hồ sơ không hợp lệ.');
 if(typeof base64!=='string'||!base64||base64.length>Math.ceil(FILE_LIMIT/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw mediaError(400,'Tệp không hợp lệ hoặc vượt quá 5 MB.');
 const bytes=Buffer.from(base64,'base64');if(bytes.toString('base64')!==base64)throw mediaError(400,'Tệp mã hóa không hợp lệ.');if(!bytes.length||bytes.length>FILE_LIMIT)throw mediaError(400,'Mỗi tệp tối đa 5 MB.');
 let mime='';if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)mime='image/jpeg';else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')mime='image/webp';else if(bytes.toString('ascii',0,5)==='%PDF-')mime='application/pdf';
 if(!mime||category==='avatar'&&mime!=='image/jpeg')throw mediaError(400,'Chọn ảnh JPG, PNG, WebP hoặc PDF; ảnh đại diện cần được xử lý thành JPG.');
 if(category==='avatar'&&bytes.length>135000)throw mediaError(400,'Ảnh đại diện quá lớn sau khi xử lý.');
 return {bytes,mime};
}
export function appendStudentFile(record,file){const data={...record.data};if(file.category==='avatar')data.avatarFile=file;else{const files=Array.isArray(data.studentFiles)?data.studentFiles:[];if(files.length>=30)throw mediaError(409,'Hồ sơ đã có 30 tệp. Liên hệ chủ CLB để rà soát.');data.studentFiles=[...files,file]}return data}
export function studentFileName(file){const labels={'avatar':'Anh_dai_dien','cccd-front':'CCCD_mat_truoc','cccd-back':'CCCD_mat_sau','certificate':'Chung_chi_dang_cap'};const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};return (labels[file.category]||'Ho_so')+'_'+file.id+'.'+(extensions[file.mime]||'bin')}
