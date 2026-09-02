import { useState } from 'react';
import { useListClassrooms, useCreateClassroom, getListClassroomsQueryKey } from '@workspace/api-client-react';
import { Shell, Button, Pill, Avatar, Skeleton, QueryState, PageHeader } from '../../App';
import { BookOpen, Users, Plus, LayoutGrid, Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { OperationalManager } from '../../components/OperationalManager';
import { useI18n } from '../../i18n';
import { BranchSelect, branchIdPayload } from '../../components/BranchSelect';

export function ClassroomsExpanded() {
  const { t, formatNumber } = useI18n();
  const query = useListClassrooms();
  const classrooms = query.data || [];
  const [showAdd, setShowAdd] = useState(false);
  
  const totalCapacity = classrooms.reduce((sum, c) => sum + c.capacity, 0);
  const totalEnrolled = classrooms.reduce((sum, c) => sum + c.childrenCount, 0);
  
  return (
    <Shell>
      <PageHeader 
        eyebrow={t('expanded.academicOrganization')}
        title={t('expanded.classroomsTitle')}
        description={t('expanded.classroomsDesc')}
        action={<Button onClick={() => setShowAdd(true)} data-testid="button-add-classroom"><Plus size={18} />{t('expanded.addClassroom')}</Button>}
      />
      
      <div className="mb-8 grid gap-5 sm:grid-cols-3">
        <div className="rounded-[1.5rem] bg-primary p-6 text-primary-foreground">
          <p className="text-sm font-medium opacity-80">{t('expanded.totalClassrooms')}</p>
          <p className="mt-2 text-3xl font-bold">{formatNumber(classrooms.length)}</p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">{t('expanded.capacity')}</p>
          <p className="mt-2 text-3xl font-bold">{formatNumber(totalEnrolled)} / {formatNumber(totalCapacity)}</p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">{t('expanded.occupancyRate')}</p>
          <p className="mt-2 text-3xl font-bold">{formatNumber(totalCapacity ? totalEnrolled / totalCapacity : 0, { style: 'percent', maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      <QueryState loading={query.isLoading} error={query.isError} empty={!classrooms.length} onRetry={() => query.refetch()}>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 mb-10">
          {classrooms.map((c) => (
            <div key={c.id} data-testid={`card-classroom-${c.id}`} className="group relative overflow-hidden rounded-[2rem] border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md">
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold text-foreground">{c.name}</h3>
                  <p className="mt-1 text-sm font-medium text-muted-foreground">{c.level}</p>
                </div>
                <span className="grid h-12 w-12 place-items-center rounded-2xl" style={{ backgroundColor: `${c.color || '#165032'}20`, color: c.color || '#165032' }}>
                  <LayoutGrid size={24} />
                </span>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                   <span className="font-bold text-muted-foreground">{t('expanded.teacher')}</span>
                  <span className="font-bold text-foreground flex items-center gap-2">
                    <Avatar name={c.teacherName} className="h-6 w-6 text-[10px]" /> {c.teacherName}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                   <span className="font-bold text-muted-foreground">{t('expanded.occupancy')}</span>
                   <span className="font-bold text-foreground">{t('expanded.of', { count: formatNumber(c.childrenCount), capacity: formatNumber(c.capacity) })}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(c.childrenCount / c.capacity) * 100}%`, backgroundColor: c.color || 'var(--primary)' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </QueryState>

      <OperationalManager resource="classroom-schedule" title={t('expanded.schedules')} icon={BookOpen} extraFields={[{name: 'day', label: t('expanded.day'), type: 'text'}, {name: 'time', label: t('expanded.time'), type: 'time'}]} />
      
      {showAdd && <ClassroomForm onClose={() => setShowAdd(false)} />}
    </Shell>
  );
}

function ClassroomForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: '', level: '', teacherName: '', capacity: '20', color: '#165032', branchId: '' });
  const create = useCreateClassroom();
  const qc = useQueryClient();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ data: { ...form, capacity: Number(form.capacity), branchId: branchIdPayload(form.branchId) } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListClassroomsQueryKey() });
        onClose();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md animate-in fade-in">
      <form onSubmit={submit} className="w-full max-w-md rounded-[2rem] border border-border bg-card p-8 shadow-2xl animate-rise">
        <div className="mb-6 flex justify-between items-center">
          <h2 className="text-xl font-bold">{t('expanded.addClassroom')}</h2>
          <Button type="button" aria-label={t('common.close')} title={t('common.close')} variant="ghost" onClick={onClose} className="!p-2"><X size={20} /></Button>
        </div>
        <div className="space-y-4">
          <label className="block text-sm font-bold">{t('expanded.classroomName')} <input required data-testid="input-classroom-name" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
          <label className="block text-sm font-bold">{t('expanded.level')} <input required data-testid="input-classroom-level" value={form.level} onChange={(e) => setForm({...form, level: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
          <label className="block text-sm font-bold">{t('expanded.mainTeacher')} <input required data-testid="input-classroom-teacher" value={form.teacherName} onChange={(e) => setForm({...form, teacherName: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
          <BranchSelect value={form.branchId} onChange={(branchId) => setForm({ ...form, branchId })} testId="select-classroom-branch" required />
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm font-bold">{t('expanded.capacityLabel')} <input required type="number" data-testid="input-classroom-capacity" value={form.capacity} onChange={(e) => setForm({...form, capacity: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
            <label className="block text-sm font-bold">{t('expanded.color')} <input required type="color" data-testid="input-classroom-color" value={form.color} onChange={(e) => setForm({...form, color: e.target.value})} className="mt-2 h-12 w-full rounded-xl border border-input bg-background p-1 outline-none" /></label>
          </div>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={create.isPending} data-testid="button-submit-classroom">{create.isPending ? t('expanded.saving') : t('expanded.saveClassroom')}</Button>
        </div>
      </form>
    </div>
  );
}
