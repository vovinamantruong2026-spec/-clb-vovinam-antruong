import {scheduleDays} from './attendance-reminders';
export const WEEKDAYS=[2,3,4,5,6,7,8];
export const weekdayLabel=(day:number)=>day===8?'Chủ nhật':'Thứ '+day;
export function parseClassTime(value:unknown){
 if(typeof value!=='string')return null;
 const match=/^\s*(\d{1,2})(?:[:hH](\d{2})|[hH])\s*(?:[-–—]|đến|tới)\s*(\d{1,2})(?:[:hH](\d{2})|[hH])\s*$/u.exec(value);
 if(!match)return null;
 const [startHour,startMinute,endHour,endMinute]=[match[1],match[2]||'00',match[3],match[4]||'00'].map(s=>s.padStart(2,'0'));
 if(Number(startHour)>23||Number(endHour)>23||Number(startMinute)>59||Number(endMinute)>59)return null;
 return {startHour,startMinute,endHour,endMinute};
}
export function classScheduleDraft(data:any){return data._schedule||parseClassTime(data.time)||{startHour:'',startMinute:'00',endHour:'',endMinute:'00'}}
export function saveClassSchedule(form:any){
 const days=scheduleDays(form.days);
 if(!days?.length)throw new Error('Chọn ít nhất một ngày học trong tuần.');
 const time=classScheduleDraft(form);
 if(![time.startHour,time.endHour].every(v=>/^(?:[01][0-9]|2[0-3])$/.test(v))||![time.startMinute,time.endMinute].every(v=>/^[0-5][0-9]$/.test(v)))throw new Error('Chọn đầy đủ giờ bắt đầu và giờ kết thúc.');
 if(Number(time.endHour)*60+Number(time.endMinute)<=Number(time.startHour)*60+Number(time.startMinute))throw new Error('Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.');
 const {_schedule,...data}=form;
 return {...data,days:days.map(d=>d===8?'CN':'Thứ '+d).join(', '),time:time.startHour+':'+time.startMinute+' – '+time.endHour+':'+time.endMinute};
}
