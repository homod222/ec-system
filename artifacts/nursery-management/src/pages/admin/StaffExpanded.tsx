import { useState } from 'react';
import { useListStaff, useCreateStaff, useUpdateStaff, useDeleteStaff, getListStaffQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Shell, Button, Pill, Avatar, QueryState, PageHeader } from '../../App';
import { GraduationCap, Search, Plus, Calendar, Star, Briefcase, Plane, DollarSign, Edit3, Trash2, X } from 'lucide-react';
import type { StaffMember } from '@workspace/api-client-react';
import { OperationalManager } from '../../components/OperationalManager';
import { useI18n } from '../../i18n';

export function StaffExpanded() {
  const { t, dir, formatNumber } = useI18n();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StaffMember | null | undefined>(undefined);
  const query = useListStaff();
  const staff = query.data || [];
  
  const filtered = staff.filter(s => s.name.includes(search));
  
  return (
    <Shell>
      <PageHeader 
        eyebrow={t('expanded.staffEyebrow')}
        title={t('expanded.staffTitle')}
        description={t('expanded.staffDesc')}
      />
      
      <div className="mb-6 relative max-w-md">
         <Search size={18} className={`absolute top-3.5 text-muted-foreground ${dir === 'rtl' ? 'right-4' : 'left-4'}`} />
        <input data-testid="input-search-staff" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('expanded.searchStaff')} className={`w-full rounded-xl border border-border bg-card py-3.5 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-12 pl-4' : 'pl-12 pr-4'}`} />
      </div>
      <Button className="mb-6" onClick={() => setEditing(null)}><Plus size={18} />{t('expanded.addStaff')}</Button>

      <QueryState loading={query.isLoading} error={query.isError} empty={!filtered.length} onRetry={() => query.refetch()}>
        <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm mb-10">
          <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
            <span>{t('expanded.employee')}</span><span>{t('expanded.position')}</span><span>{t('expanded.phone')}</span><span>{t('expanded.attendanceRate')}</span>
          </div>
          {filtered.map((member) => (
            <div key={member.id} data-testid={`row-staff-${member.id}`} className="grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[1.5fr_1fr_1fr_1fr] md:items-center md:gap-4">
              <div className="flex items-center gap-4">
                <Avatar name={member.name} className="h-11 w-11" />
                <div>
                  <p className="font-bold text-foreground">{member.name}</p>
                  <Pill tone={member.status === 'present' ? 'green' : member.status === 'leave' ? 'blue' : 'red'}>{member.status === 'present' ? t('expanded.presentFemale') : member.status === 'leave' ? t('expanded.leave') : t('expanded.absentFemale')}</Pill>
                </div>
               <div className="flex gap-2"><Button aria-label={t('common.edit')} title={t('common.edit')} variant="ghost" className="!p-2" onClick={() => setEditing(member)}><Edit3 size={16}/></Button><DeleteStaffButton member={member} /></div>
              </div>
              <div className="text-sm font-bold text-foreground">{member.role}</div>
              <div className="text-sm font-medium text-muted-foreground">{member.phone}</div>
              <div>
                 <div className="mb-2 text-xs font-bold">{formatNumber(member.attendanceRate / 100, { style: 'percent', maximumFractionDigits: 0 })}</div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${member.attendanceRate}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
      
      <OperationalManager resource="staff-profile" title={t('expanded.extraProfiles')} icon={GraduationCap} extraFields={[{name: 'staffId', label: t('expanded.employeeNumber'), type: 'text'}]} />
      <OperationalManager resource="staff-job" title={t('expanded.jobsContracts')} icon={Briefcase} extraFields={[{name: 'contractType', label: t('expanded.contractType'), type: 'text'}]} />
      <OperationalManager resource="staff-leave" title={t('expanded.leaveRequests')} icon={Plane} extraFields={[{name: 'days', label: t('expanded.days'), type: 'number'}]} />
      <OperationalManager resource="payroll" title={t('expanded.payroll')} icon={DollarSign} extraFields={[{name: 'month', label: t('expanded.month'), type: 'month'}]} />
      <OperationalManager resource="evaluation" title={t('expanded.performance')} icon={Star} extraFields={[{name: 'score', label: t('expanded.score'), type: 'number'}, {name: 'reviewer', label: t('expanded.reviewer'), type: 'text'}]} />
       {editing !== undefined && <StaffForm member={editing} onClose={() => setEditing(undefined)} />}
    </Shell>
  );
}

function DeleteStaffButton({ member }: { member: StaffMember }) {
  const { t } = useI18n();
  const remove = useDeleteStaff(); const qc = useQueryClient();
  return <Button aria-label={t('common.delete')} title={t('common.delete')} variant="danger" className="!p-2" disabled={remove.isPending} onClick={() => { if (window.confirm(t('expanded.deleteStaff', { name: member.name }))) remove.mutate({ id: member.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListStaffQueryKey() }) }); }}><Trash2 size={16}/></Button>;
}
function StaffForm({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
 const { t } = useI18n();
 const [f,setF]=useState({name:member?.name||'',role:member?.role||'',phone:member?.phone||'',status:member?.status||'present',email:'',jobTitle:'',hireDate:''});
 const create=useCreateStaff(), update=useUpdateStaff(), qc=useQueryClient(); const pending=create.isPending||update.isPending;
 const submit=(e:React.FormEvent)=>{e.preventDefault();const data={...f,email:f.email||null,jobTitle:f.jobTitle||null,hireDate:f.hireDate||null} as any; const done=()=>{qc.invalidateQueries({queryKey:getListStaffQueryKey()});onClose()}; member?update.mutate({id:member.id,data},{onSuccess:done}):create.mutate({data},{onSuccess:done});};
 return <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md"><form onSubmit={submit} className="w-full max-w-lg rounded-[2rem] bg-card p-8 shadow-2xl"><div className="mb-5 flex justify-between"><h2 className="text-xl font-bold">{member ? t('expanded.editStaff') : t('expanded.addStaff')}</h2><Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X/></Button></div><div className="grid gap-4 sm:grid-cols-2">{[['name',t('expanded.name'),'text'],['role',t('expanded.position'),'text'],['phone',t('expanded.mobile'),'tel'],['email',t('expanded.email'),'email'],['jobTitle',t('expanded.jobTitle'),'text'],['hireDate',t('expanded.hireDate'),'date']].map(([k,l,inputType])=><label key={k} className="text-sm font-bold">{l}<input required={['name','role','phone'].includes(k)} type={inputType} value={(f as any)[k]} onChange={e=>setF({...f,[k]:e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3"/></label>)}<label className="text-sm font-bold">{t('expanded.status')}<select value={f.status} onChange={e=>setF({...f,status:e.target.value as any})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3"><option value="present">{t('expanded.presentFemale')}</option><option value="absent">{t('expanded.absentFemale')}</option><option value="leave">{t('expanded.leave')}</option></select></label></div>{(create.isError||update.isError)&&<p className="mt-4 text-sm text-destructive">{t('expanded.staffSaveError')}</p>}<div className="mt-7 flex justify-end gap-3"><Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={pending}>{pending ? t('expanded.saving') : t('common.save')}</Button></div></form></div>
}
