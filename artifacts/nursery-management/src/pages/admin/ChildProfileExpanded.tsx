import { useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetChild,
  useDeleteChild,
  useStartChildRenewal,
  getListApplicationsQueryKey,
  useListChildRecords,
  useCreateChildRecord,
  getListChildRecordsQueryKey
} from '@workspace/api-client-react';
import { Shell, Button, Pill, Avatar, Skeleton, QueryState, PageHeader } from '../../App';
import { ArrowRightIcon, BookOpen, Edit3, Trash2, FileText, Plus, HeartPulse, Activity, AlertCircle, Pill as PillIcon, FileIcon, Image as ImageIcon, FileText as NoteIcon, History } from 'lucide-react';
import { Link } from 'wouter';

const CATEGORY_ICONS: Record<string, any> = {
  health: HeartPulse,
  emergency: AlertCircle,
  allergy: Activity,
  medication: PillIcon,
  document: FileIcon,
  photo: ImageIcon,
  note: NoteIcon,
  history: History,
};

export function ChildProfileExpanded() {
  const [, params] = useRoute('/children/:id');
  const id = Number(params?.id);
  const query = useGetChild(id);
  const child = query.data;
  
  const recordsQuery = useListChildRecords(id, { query: { enabled: !!id, queryKey: getListChildRecordsQueryKey(id) } });
  const records = recordsQuery.data || [];
  
  const renewal = useStartChildRenewal();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  
  const [showAddRecord, setShowAddRecord] = useState(false);
  
  if (query.isLoading) return <Shell><Skeleton className="h-12 w-64 mb-6" /><Skeleton className="h-64 w-full rounded-[2rem]" /></Shell>;
  if (query.isError || !child) return <Shell><QueryState error onRetry={() => query.refetch()}>{null}</QueryState></Shell>;

  return (
    <Shell>
      <Link href="/children" data-testid="link-back-children" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-colors">
        <ArrowRightIcon className="rotate-180" size={18} />العودة للسجل
      </Link>

      <div className="relative overflow-hidden rounded-[2rem] bg-primary p-8 text-primary-foreground shadow-xl">
        <div className="absolute right-0 top-0 h-full w-1/2 bg-gradient-to-l from-accent/20 to-transparent mix-blend-overlay" />
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center">
          <Avatar name={child.fullName} className="h-24 w-24 border-4 border-primary-foreground/20 bg-accent text-2xl text-accent-foreground" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-4">
              <h1 className="text-3xl font-bold sm:text-4xl">{child.fullName}</h1>
              <Pill tone="green">منتظم</Pill>
            </div>
            <p className="mt-3 text-sm font-medium text-primary-foreground/80 flex items-center gap-2">
              <BookOpen size={16} /> {child.level} · {child.classroomName || 'غير محدد'} · مسجل منذ {new Date(child.birthDate).toLocaleDateString('ar-SA')}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="soft" data-testid="button-start-renewal" disabled={renewal.isPending} onClick={() => renewal.mutate({ id: child.id }, { onSuccess: (application) => { qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() }); setLocation(`/applications/${application.id}`); } })} className="bg-primary-foreground/10 text-primary-foreground border border-primary-foreground/20 hover:bg-primary-foreground/20">
              <FileText size={18} />{renewal.isPending ? 'جارٍ بدء التجديد...' : 'بدء طلب تجديد'}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">السجل الشامل</h2>
        <Button data-testid="button-add-child-record" onClick={() => setShowAddRecord(true)}><Plus size={18} />إضافة سجل</Button>
      </div>

      <QueryState loading={recordsQuery.isLoading} error={recordsQuery.isError} empty={!records.length} onRetry={() => recordsQuery.refetch()}>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {records.map(record => {
            const Icon = CATEGORY_ICONS[record.category] || FileText;
            return (
              <div key={record.id} className="rounded-[1.5rem] border border-border bg-card p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon size={20} />
                  </span>
                  <Pill tone={record.status === 'active' ? 'green' : 'neutral'}>{record.status === 'active' ? 'نشط' : record.status}</Pill>
                </div>
                <h3 className="font-bold text-foreground">{record.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{record.category}</p>
                {record.occurredOn && (
                  <p className="mt-2 text-xs text-muted-foreground">التاريخ: {new Date(record.occurredOn).toLocaleDateString('ar-SA')}</p>
                )}
                {record.confidential && <Pill tone="red">سري</Pill>}
              </div>
            );
          })}
        </div>
      </QueryState>

      {showAddRecord && <AddRecordModal childId={id} onClose={() => setShowAddRecord(false)} />}
    </Shell>
  );
}

function AddRecordModal({ childId, onClose }: { childId: number, onClose: () => void }) {
  const [form, setForm] = useState({ category: 'health', title: '', status: 'active', confidential: false, occurredOn: '', details: '', referenceUrl: '' });
  const create = useCreateChildRecord();
  const qc = useQueryClient();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ id: childId, data: {
      category: form.category as any,
      title: form.title,
      status: form.status,
      confidential: form.confidential,
      occurredOn: form.occurredOn || null,
      data: { details: form.details, referenceUrl: form.referenceUrl || null },
    } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListChildRecordsQueryKey(childId) });
        onClose();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md animate-in fade-in">
      <form onSubmit={submit} className="w-full max-w-md rounded-[2rem] border border-border bg-card p-8 shadow-2xl animate-rise">
        <h2 className="mb-6 text-xl font-bold">إضافة سجل جديد</h2>
        <div className="space-y-4">
          <label className="block text-sm font-bold text-foreground">
            الفئة
            <select data-testid="select-child-record-category" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none">
              <option value="health">صحي</option>
              <option value="emergency">طوارئ</option>
              <option value="allergy">حساسية</option>
              <option value="medication">أدوية</option>
              <option value="document">مستندات</option>
              <option value="photo">صور</option>
              <option value="note">ملاحظات</option>
              <option value="history">تاريخ</option>
            </select>
          </label>
          <label className="block text-sm font-bold text-foreground">
            العنوان
            <input data-testid="input-child-record-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" />
          </label>
          <label className="block text-sm font-bold text-foreground">التاريخ
            <input data-testid="input-child-record-date" type="date" value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" />
          </label>
          <label className="block text-sm font-bold text-foreground">التفاصيل
            <textarea data-testid="input-child-record-details" required rows={3} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 outline-none" />
          </label>
          {(form.category === 'document' || form.category === 'photo') && <label className="block text-sm font-bold text-foreground">رابط الملف الخاص
            <input data-testid="input-child-record-url" type="url" value={form.referenceUrl} onChange={(e) => setForm({ ...form, referenceUrl: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" />
          </label>}
          <label className="flex items-center gap-2 text-sm font-bold text-foreground">
            <input data-testid="checkbox-child-record-confidential" type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} />
            سجل سري لا يظهر إلا للمصرح لهم
          </label>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <Button data-testid="button-cancel-child-record" type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button data-testid="button-submit-child-record" type="submit" disabled={create.isPending}>{create.isPending ? 'جارٍ الحفظ...' : 'حفظ السجل'}</Button>
        </div>
      </form>
    </div>
  );
}
