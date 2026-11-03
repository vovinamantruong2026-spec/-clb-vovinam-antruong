const zone='Asia/Ho_Chi_Minh';
export function vietnamDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}
// Class schedules are entered as Vietnamese weekday lists, not dates or hours.
export function scheduleDays(value:unknown):number[]|null{
 if(typeof value!=='string'||!value.trim())return null;
 let text=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').trim();
 if(/^(hang ngay|moi ngay|ca tuan)$/.test(text))return [2,3,4,5,6,7,8];
 text=text.replace(/chu\s*nhat|\bcn\b/g,'8').replace(/thu\s*hai/g,'2').replace(/thu\s*ba/g,'3').replace(/thu\s*tu/g,'4').replace(/thu\s*nam/g,'5').replace(/thu\s*sau/g,'6').replace(/thu\s*bay/g,'7').replace(/thu\s*(?=[2-7])/g,'').replace(/\bt\s*(?=[2-7])/g,'').replace(/\b(den|toi)\b/g,'~').replace(/\bva\b/g,',').replace(/[;/&+–—-]/g,',').replace(/\s+/g,'');
 const result=new Set<number>();
 for(const token of text.split(',')){if(/^[2-8]$/.test(token))result.add(Number(token));else if(/^[2-8]~[2-8]$/.test(token)&&Number(token[0])<=Number(token[2]))for(let d=Number(token[0]);d<=Number(token[2]);d++)result.add(d);else return null;}
 return result.size?[...result].sort():null;
}
export function attendanceReminders(records:any[],actor:any,now=new Date()){
 const date=vietnamDate(now),weekday=new Date(date+'T12:00:00Z').getUTCDay()||7,day=weekday===7?8:weekday+1;
 if(!actor||(!actor.isSuperAdmin&&!actor.permissions?.attendance_manage))return {date,due:[],unknown:[]};
 const classes=records.filter(r=>r.kind==='class'&&!r.data.deleted&&(actor.isSuperAdmin||actor.allClasses||(actor.classIds||[]).includes(r.id)));
 const unknown:any[]=[],due:any[]=[];
 for(const record of classes){const days=scheduleDays(record.data.days);if(!days){unknown.push(record);continue}if(!days.includes(day))continue;
 const session=records.find(r=>r.kind==='attendance'&&r.id===date+'_'+record.id&&!r.data.deleted);
 due.push({record,status:session?.data.status==='final'?'done':session?'draft':'missing'});
 }
 due.sort((a,b)=>{const minutes=(c:any)=>{const m=/^(\d{1,2})[:h](\d{2})/.exec(String(c.data.time||'').trim());return m?Number(m[1])*60+Number(m[2]):1440};return minutes(a.record)-minutes(b.record)||String(a.record.data.name).localeCompare(String(b.record.data.name),'vi')});
 return {date,due,unknown};
}
