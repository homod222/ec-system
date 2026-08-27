import { useState } from 'react';
import { useListStaff, useCreateStaff, useUpdateStaff, useDeleteStaff, getListStaffQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Shell, Button, Pill, Avatar, QueryState, PageHeader } from '../../App';
import { GraduationCap, Search, Plus, Calendar, Star, Briefcase, Plane, DollarSign, Edit3, Trash2, X } from 'lucide-react';
import type { StaffMember } from '@workspace/api-client-react';
import { OperationalManager } from '../../components/OperationalManager';

export function StaffExpanded() {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StaffMember | null | undefined>(undefined);
  const query = useListStaff();
  const staff = query.data || [];
  
  const filtered = staff.filter(s => s.name.includes(search));
  
  return (
    <Shell>
      <PageHeader 
        eyebrow="الكادر الوظيفي" 
        title="فريق العمل" 
        description="إدارة المعلمات، الإداريات، والمشرفات وتتبع أدائهن." 
      />
      
      <div className="mb-6 relative max-w-md">
        <Search size={18} className="absolute right-4 top-3.5 text-muted-foreground" />
        <input data-testid="input-search-staff" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث عن موظفة..." className="w-full rounded-xl border border-border bg-card py-3.5 pr-12 pl-4 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      <Button className="mb-6" onClick={() => setEditing(null)}><Plus size={18} />إضافة موظفة</Button>

      <QueryState loading={query.isLoading} error={query.isError} empty={!filtered.length} onRetry={() => query.refetch()}>
        <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm mb-10">
          <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
            <span>الموظفة</span><span>المنصب</span><span>رقم الجوال</span><span>نسبة الحضور</span>
          </div>
          {filtered.map((member) => (
            <div key={member.id} data-testid={`row-staff-${member.id}`} className="grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[1.5fr_1fr_1fr_1fr] md:items-center md:gap-4">
              <div className="flex items-center gap-4">
                <Avatar name={member.name} className="h-11 w-11" />
                <div>
                  <p className="font-bold text-foreground">{member.name}</p>
                  <Pill tone={member.status === 'present' ? 'green' : member.status === 'leave' ? 'blue' : 'red'}>{member.status === 'present' ? 'حاضرة' : member.status === 'leave' ? 'إجازة' : 'غائبة'}</Pill>
                </div>
               <div className="flex gap-2"><Button variant="ghost" className="!p-2" onClick={() => setEditing(member)}><Edit3 size={16}/></Button><DeleteStaffButton member={member} /></div>
              </div>
              <div className="text-sm font-bold text-foreground">{member.role}</div>
              <div className="text-sm font-medium text-muted-foreground">{member.phone}</div>
              <div>
                <div className="mb-2 text-xs font-bold">{member.attendanceRate}%</div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${member.attendanceRate}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
      
      <OperationalManager resource="staff-profile" title="ملفات الموظفين الإضافية" icon={GraduationCap} extraFields={[{name: 'staffId', label: 'رقم الموظف', type: 'text'}]} />
      <OperationalManager resource="staff-job" title="المسميات الوظيفية والعقود" icon={Briefcase} extraFields={[{name: 'contractType', label: 'نوع العقد', type: 'text'}]} />
      <OperationalManager resource="staff-leave" title="طلبات الإجازة" icon={Plane} extraFields={[{name: 'days', label: 'عدد الأيام', type: 'number'}]} />
      <OperationalManager resource="payroll" title="مسيرات الرواتب" icon={DollarSign} extraFields={[{name: 'month', label: 'الشهر', type: 'month'}]} />
      <OperationalManager resource="evaluation" title="تقييم الأداء" icon={Star} extraFields={[{name: 'score', label: 'التقييم (من 100)', type: 'number'}, {name: 'reviewer', label: 'المقيّم', type: 'text'}]} />
       {editing !== undefined && <StaffForm member={editing} onClose={() => setEditing(undefined)} />}
    </Shell>
  );
}

function DeleteStaffButton({ member }: { member: StaffMember }) {
  const remove = useDeleteStaff(); const qc = useQueryClient();
  return <Button variant="danger" className="!p-2" disabled={remove.isPending} onClick={() => { if (window.confirm(`حذف سجل ${member.name}؟`)) remove.mutate({ id: member.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListStaffQueryKey() }) }); }}><Trash2 size={16}/></Button>;
}
function StaffForm({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
 const [f,setF]=useState({name:member?.name||'',role:member?.role||'',phone:member?.phone||'',status:member?.status||'present',email:'',jobTitle:'',hireDate:''});
 const create=useCreateStaff(), update=useUpdateStaff(), qc=useQueryClient(); const pending=create.isPending||update.isPending;
 const submit=(e:React.FormEvent)=>{e.preventDefault();const data={...f,email:f.email||null,jobTitle:f.jobTitle||null,hireDate:f.hireDate||null} as any; const done=()=>{qc.invalidateQueries({queryKey:getListStaffQueryKey()});onClose()}; member?update.mutate({id:member.id,data},{onSuccess:done}):create.mutate({data},{onSuccess:done});};
 return <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md"><form onSubmit={submit} className="w-full max-w-lg rounded-[2rem] bg-card p-8 shadow-2xl"><div className="mb-5 flex justify-between"><h2 className="text-xl font-bold">{member?'تعديل الموظفة':'إضافة موظفة'}</h2><Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X/></Button></div><div className="grid gap-4 sm:grid-cols-2">{[['name','الاسم','text'],['role','المنصب','text'],['phone','الجوال','tel'],['email','البريد','email'],['jobTitle','المسمى الوظيفي','text'],['hireDate','تاريخ التعيين','date']].map(([k,l,t])=><label key={k} className="text-sm font-bold">{l}<input required={['name','role','phone'].includes(k)} type={t} value={(f as any)[k]} onChange={e=>setF({...f,[k]:e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3"/></label>)}<label className="text-sm font-bold">الحالة<select value={f.status} onChange={e=>setF({...f,status:e.target.value as any})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3"><option value="present">حاضرة</option><option value="absent">غائبة</option><option value="leave">إجازة</option></select></label></div>{(create.isError||update.isError)&&<p className="mt-4 text-sm text-destructive">تعذر حفظ سجل الموظفة.</p>}<div className="mt-7 flex justify-end gap-3"><Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button><Button disabled={pending}>{pending?'جارٍ الحفظ...':'حفظ'}</Button></div></form></div>
}
