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
  getListChildRecordsQueryKey,
  useListChildContacts,
  useCreateChildContact,
  getListChildContactsQueryKey
} from '@workspace/api-client-react';
import { Shell, Button, Pill, Avatar, Skeleton, QueryState, PageHeader } from '../../App';
import { ArrowRightIcon, BookOpen, Edit3, Trash2, FileText, Plus, HeartPulse, Activity, AlertCircle, Pill as PillIcon, FileIcon, Image as ImageIcon, FileText as NoteIcon, History, X } from 'lucide-react';
import { Link } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import type { ChildContactInput } from '@workspace/api-client-react';

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
  const contactsQuery = useListChildContacts(id, { query: { enabled: !!id, queryKey: getListChildContactsQueryKey(id) } });
  const contacts = contactsQuery.data || [];
  
  const renewal = useStartChildRenewal();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  
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

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">جهات الاتصال والتصاريح</h2>
            <p className="mt-1 text-sm text-muted-foreground">أولياء الأمور، جهات الطوارئ، المصرح لهم بالاستلام والموافقات.</p>
          </div>
          <Button data-testid="button-add-child-contact" onClick={() => setShowAddContact(true)}><Plus size={18} />إضافة جهة اتصال</Button>
        </div>
        <QueryState loading={contactsQuery.isLoading} error={contactsQuery.isError} empty={!contacts.length} onRetry={() => contactsQuery.refetch()}>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((contact) => (
              <div key={contact.id} className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-foreground">{contact.name}</p>
                    <p className="mt-1 text-xs font-bold text-primary">{contactTypeLabel(contact.type)}</p>
                  </div>
                  <Pill tone={contact.status === 'active' || contact.status === 'approved' ? 'green' : 'yellow'}>{contact.status === 'active' ? 'نشط' : contact.status === 'approved' ? 'معتمد' : contact.status}</Pill>
                </div>
                <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                  {contact.relationship && <p>{contact.relationship}</p>}
                  {contact.phone && <p dir="ltr" className="text-right">{contact.phone}</p>}
                  {contact.email && <p dir="ltr" className="truncate text-right">{contact.email}</p>}
                  {contact.identityNumber && <p>الرقم المدني: {contact.identityNumber}</p>}
                  {contact.primary && <p className="font-bold text-primary">جهة الاتصال الأساسية</p>}
                  {typeof contact.data.note === 'string' && <p className="pt-2 text-xs">{contact.data.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </QueryState>
      </section>

      <div className="mt-10 flex items-center justify-between">
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
      {showAddContact && <AddContactModal childId={id} onClose={() => setShowAddContact(false)} />}
    </Shell>
  );
}

function contactTypeLabel(type: string) {
  return ({ guardian: 'ولي أمر', emergency: 'للطوارئ', authorized_pickup: 'مصرح بالاستلام', consent: 'موافقة', invitation: 'دعوة' } as Record<string, string>)[type] || type;
}

function AddContactModal({ childId, onClose }: { childId: number; onClose: () => void }) {
  const [form, setForm] = useState({ type: 'guardian', name: '', relationship: '', phone: '', email: '', identityNumber: '', status: 'active', primary: false, note: '' });
  const create = useCreateChildContact();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isPerson = form.type !== 'consent';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const data: ChildContactInput = {
      type: form.type as ChildContactInput['type'],
      name: form.name,
      relationship: form.relationship || null,
      phone: form.phone || null,
      email: form.email || null,
      identityNumber: form.identityNumber || null,
      status: form.status,
      primary: form.primary,
      data: form.note ? { note: form.note } : {},
    };
    create.mutate({ id: childId, data }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListChildContactsQueryKey(childId) });
        onClose();
      },
      onError: () => toast({ title: 'تعذر حفظ جهة الاتصال', description: 'تحقق من الحقول وحاول مرة أخرى.', variant: 'destructive' }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md animate-in fade-in">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2rem] border border-border bg-card p-8 shadow-2xl animate-rise">
        <div className="mb-6 flex items-center justify-between"><h2 className="text-xl font-bold">إضافة جهة اتصال أو تصريح</h2><Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X size={20} /></Button></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">النوع<select required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none"><option value="guardian">ولي أمر</option><option value="emergency">للطوارئ</option><option value="authorized_pickup">مصرح بالاستلام</option><option value="consent">موافقة</option><option value="invitation">دعوة</option></select></label>
          <label className="text-sm font-bold">{form.type === 'consent' ? 'اسم الموافقة' : 'الاسم'}<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
          {isPerson && <><label className="text-sm font-bold">صلة القرابة<input value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label><label className="text-sm font-bold">رقم الجوال<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label><label className="text-sm font-bold">البريد الإلكتروني<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label><label className="text-sm font-bold">الرقم المدني<input value={form.identityNumber} onChange={(e) => setForm({ ...form, identityNumber: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label></>}
          <label className="text-sm font-bold">الحالة<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none"><option value="active">نشط</option><option value="approved">معتمد</option><option value="pending">قيد المراجعة</option><option value="inactive">غير نشط</option></select></label>
        </div>
        <label className="mt-4 block text-sm font-bold">ملاحظات / تفاصيل الموافقة<textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
        {isPerson && <label className="mt-4 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.checked })} />جهة الاتصال الأساسية</label>}
        <div className="mt-8 flex justify-end gap-3"><Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? 'جارٍ الحفظ...' : 'حفظ'}</Button></div>
      </form>
    </div>
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
