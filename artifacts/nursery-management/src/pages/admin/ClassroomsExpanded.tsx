import { useState } from 'react';
import { useListClassrooms, useCreateClassroom, getListClassroomsQueryKey } from '@workspace/api-client-react';
import { Shell, Button, Pill, Avatar, Skeleton, QueryState, PageHeader } from '../../App';
import { BookOpen, Users, Plus, LayoutGrid, Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { OperationalManager } from '../../components/OperationalManager';

export function ClassroomsExpanded() {
  const query = useListClassrooms();
  const classrooms = query.data || [];
  const [showAdd, setShowAdd] = useState(false);
  
  const totalCapacity = classrooms.reduce((sum, c) => sum + c.capacity, 0);
  const totalEnrolled = classrooms.reduce((sum, c) => sum + c.childrenCount, 0);
  
  return (
    <Shell>
      <PageHeader 
        eyebrow="التنظيم الأكاديمي" 
        title="الفصول الدراسية" 
        description="إدارة السعة الاستيعابية، توزيع المعلمات، وجداول الفصول." 
        action={<Button onClick={() => setShowAdd(true)} data-testid="button-add-classroom"><Plus size={18} />إضافة فصل جديد</Button>}
      />
      
      <div className="mb-8 grid gap-5 sm:grid-cols-3">
        <div className="rounded-[1.5rem] bg-primary p-6 text-primary-foreground">
          <p className="text-sm font-medium opacity-80">إجمالي الفصول</p>
          <p className="mt-2 text-3xl font-bold">{classrooms.length}</p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">الطاقة الاستيعابية</p>
          <p className="mt-2 text-3xl font-bold">{totalEnrolled} / {totalCapacity}</p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">نسبة الإشغال</p>
          <p className="mt-2 text-3xl font-bold">{totalCapacity ? Math.round((totalEnrolled / totalCapacity) * 100) : 0}%</p>
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
                  <span className="font-bold text-muted-foreground">المعلمة</span>
                  <span className="font-bold text-foreground flex items-center gap-2">
                    <Avatar name={c.teacherName} className="h-6 w-6 text-[10px]" /> {c.teacherName}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-muted-foreground">الإشغال</span>
                  <span className="font-bold text-foreground">{c.childrenCount} من {c.capacity}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(c.childrenCount / c.capacity) * 100}%`, backgroundColor: c.color || 'var(--primary)' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </QueryState>

      <OperationalManager resource="classroom-schedule" title="جداول الحصص" icon={BookOpen} extraFields={[{name: 'day', label: 'اليوم', type: 'text'}, {name: 'time', label: 'الوقت', type: 'time'}]} />
      
      {showAdd && <ClassroomForm onClose={() => setShowAdd(false)} />}
    </Shell>
  );
}

function ClassroomForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: '', level: '', teacherName: '', capacity: '20', color: '#165032' });
  const create = useCreateClassroom();
  const qc = useQueryClient();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ data: { ...form, capacity: Number(form.capacity) } }, {
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
          <h2 className="text-xl font-bold">إضافة فصل جديد</h2>
          <Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X size={20} /></Button>
        </div>
        <div className="space-y-4">
          <label className="block text-sm font-bold">اسم الفصل <input required data-testid="input-classroom-name" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
          <label className="block text-sm font-bold">المستوى / المرحلة <input required data-testid="input-classroom-level" value={form.level} onChange={(e) => setForm({...form, level: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
          <label className="block text-sm font-bold">اسم المعلمة الأساسية <input required data-testid="input-classroom-teacher" value={form.teacherName} onChange={(e) => setForm({...form, teacherName: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm font-bold">السعة <input required type="number" data-testid="input-classroom-capacity" value={form.capacity} onChange={(e) => setForm({...form, capacity: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
            <label className="block text-sm font-bold">اللون المميز <input required type="color" data-testid="input-classroom-color" value={form.color} onChange={(e) => setForm({...form, color: e.target.value})} className="mt-2 h-12 w-full rounded-xl border border-input bg-background p-1 outline-none" /></label>
          </div>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button type="submit" disabled={create.isPending} data-testid="button-submit-classroom">{create.isPending ? 'جارٍ الحفظ...' : 'حفظ الفصل'}</Button>
        </div>
      </form>
    </div>
  );
}
