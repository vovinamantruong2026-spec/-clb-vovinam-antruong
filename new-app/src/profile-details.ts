export const detailKeys=['fullName','dob','phone','belt'] as const;
export function profileDetails(value:any){return Object.fromEntries(detailKeys.map(k=>[k,typeof value?.[k]==='string'?value[k]:''])) as Record<typeof detailKeys[number],string>}
export function validateProfileDetails(value:any){
 const d=profileDetails(value);
 if(!d.fullName.trim()||d.fullName.length>120)throw new Error('Nhập họ tên, tối đa 120 ký tự.');
 if(d.phone&&!/^[+0-9 ().-]{3,30}$/.test(d.phone))throw new Error('Số điện thoại chưa hợp lệ.');
 if(d.belt.length>80)throw new Error('Cấp đai quá dài.');
 if(d.dob){const date=new Date(d.dob+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(d.dob)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==d.dob||d.dob<'1900-01-01'||d.dob>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))throw new Error('Ngày sinh chưa hợp lệ.');}
 return {...d,fullName:d.fullName.trim(),phone:d.phone.trim()};
}
