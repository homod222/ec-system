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
import { useI18n } from '../../i18n';

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
  const { t, formatDate, dir } = useI18n();
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
         <ArrowRightIcon className={dir === 'rtl' ? 'rotate-180' : ''} size={18} />{t('expanded.backToRegister')}
      </Link>

      <div className="relative overflow-hidden rounded-[2rem] bg-primary p-8 text-primary-foreground shadow-xl">
        <div className="absolute right-0 top-0 h-full w-1/2 bg-gradient-to-l from-accent/20 to-transparent mix-blend-overlay" />
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center">
          <Avatar name={child.fullName} className="h-24 w-24 border-4 border-primary-foreground/20 bg-accent text-2xl text-accent-foreground" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-4">
              <h1 className="text-3xl font-bold sm:text-4xl">{child.fullName}</h1>
              <Pill tone="green">{t('expanded.regular')}</Pill>
            </div>
            <p className="mt-3 text-sm font-medium text-primary-foreground/80 flex items-center gap-2">
              <BookOpen size={16} /> {child.level} · {child.classroomName || t('expanded.notSpecified')} · {t('expanded.registeredSince', { date: formatDate(child.birthDate) })}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="soft" data-testid="button-start-renewal" disabled={renewal.isPending} onClick={() => renewal.mutate({ id: child.id }, { onSuccess: (application) => { qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() }); setLocation(`/applications/${application.id}`); } })} className="bg-primary-foreground/10 text-primary-foreground border border-primary-foreground/20 hover:bg-primary-foreground/20">
               <FileText size={18} />{renewal.isPending ? t('expanded.startingRenewal') : t('expanded.startRenewal')}
            </Button>
          </div>
        </div>
      </div>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">{t('expanded.contactsTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('expanded.contactsDesc')}</p>
          </div>
          <Button data-testid="button-add-child-contact" onClick={() => setShowAddContact(true)}><Plus size={18} />{t('expanded.addContact')}</Button>
        </div>
        <QueryState loading={contactsQuery.isLoading} error={contactsQuery.isError} empty={!contacts.length} onRetry={() => contactsQuery.refetch()}>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((contact) => (
              <div key={contact.id} className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-foreground">{contact.name}</p>
                    <p className="mt-1 text-xs font-bold text-primary">{contactTypeLabel(contact.type, t)}</p>
                  </div>
                   <Pill tone={contact.status === 'active' || contact.status === 'approved' ? 'green' : 'yellow'}>{contactStatusLabel(contact.status, t)}</Pill>
                </div>
                <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                  {contact.relationship && <p>{contact.relationship}</p>}
                  {contact.phone && <p dir="ltr" className="text-right">{contact.phone}</p>}
                  {contact.email && <p dir="ltr" className="truncate text-right">{contact.email}</p>}
                   {contact.identityNumber && <p>{t('expanded.civilId', { value: contact.identityNumber })}</p>}
                   {contact.primary && <p className="font-bold text-primary">{t('expanded.primaryContact')}</p>}
                  {typeof contact.data.note === 'string' && <p className="pt-2 text-xs">{contact.data.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </QueryState>
      </section>

      <div className="mt-10 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">{t('expanded.completeRecord')}</h2>
        <Button data-testid="button-add-child-record" onClick={() => setShowAddRecord(true)}><Plus size={18} />{t('expanded.addRecord')}</Button>
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
                   <Pill tone={record.status === 'active' ? 'green' : 'neutral'}>{contactStatusLabel(record.status, t)}</Pill>
                </div>
                <h3 className="font-bold text-foreground">{record.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{recordCategoryLabel(record.category, t)}</p>
                {record.occurredOn && (
                  <p className="mt-2 text-xs text-muted-foreground">{t('expanded.dateLabel', { date: formatDate(record.occurredOn) })}</p>
                )}
                {record.confidential && <Pill tone="red">{t('expanded.confidential')}</Pill>}
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

function contactTypeLabel(type: string, t: ReturnType<typeof useI18n>['t']) {
  return ({ guardian: t('expanded.guardian'), emergency: t('expanded.emergency'), authorized_pickup: t('expanded.authorizedPickup'), consent: t('expanded.consent'), invitation: t('expanded.invitation') } as Record<string, string>)[type] || type;
}

function contactStatusLabel(status: string, t: ReturnType<typeof useI18n>['t']) {
  return ({ active: t('expanded.active'), approved: t('expanded.approved'), pending: t('expanded.pending'), inactive: t('expanded.inactive') } as Record<string, string>)[status] || status;
}

function recordCategoryLabel(category: string, t: ReturnType<typeof useI18n>['t']) {
  return ({ health: t('expanded.health'), emergency: t('expanded.emergency'), allergy: t('expanded.allergy'), medication: t('expanded.medication'), document: t('expanded.document'), photo: t('expanded.photo'), note: t('expanded.notes'), history: t('expanded.history') } as Record<string, string>)[category] || category;
}

function AddContactModal({ childId, onClose }: { childId: number; onClose: () => void }) {
  const { t } = useI18n();
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
      onError: () => toast({ title: t('expanded.contactSaveError'), description: t('expanded.checkFields'), variant: 'destructive' }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md animate-in fade-in">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2rem] border border-border bg-card p-8 shadow-2xl animate-rise">
        <div className="mb-6 flex items-center justify-between"><h2 className="text-xl font-bold">{t('expanded.addContactPermit')}</h2><Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X size={20} /></Button></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">{t('expanded.type')}<select required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none"><option value="guardian">{t('expanded.guardian')}</option><option value="emergency">{t('expanded.emergency')}</option><option value="authorized_pickup">{t('expanded.authorizedPickup')}</option><option value="consent">{t('expanded.consent')}</option><option value="invitation">{t('expanded.invitation')}</option></select></label>
          <label className="text-sm font-bold">{form.type === 'consent' ? t('expanded.consentName') : t('expanded.name')}<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
          {isPerson && <><label className="text-sm font-bold">{t('expanded.relationship')}<input value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label><label className="text-sm font-bold">{t('expanded.phone')}<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label><label className="text-sm font-bold">{t('expanded.email')}<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label><label className="text-sm font-bold">{t('expanded.civilIdOptional')}<input value={form.identityNumber} onChange={(e) => setForm({ ...form, identityNumber: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label></>}
          <label className="text-sm font-bold">{t('expanded.status')}<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none"><option value="active">{t('expanded.active')}</option><option value="approved">{t('expanded.approved')}</option><option value="pending">{t('expanded.pending')}</option><option value="inactive">{t('expanded.inactive')}</option></select></label>
        </div>
        <label className="mt-4 block text-sm font-bold">{t('expanded.notesConsent')}<textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 outline-none" /></label>
        {isPerson && <label className="mt-4 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.checked })} />{t('expanded.primaryContact')}</label>}
        <div className="mt-8 flex justify-end gap-3"><Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? t('expanded.saving') : t('common.save')}</Button></div>
      </form>
    </div>
  );
}

function AddRecordModal({ childId, onClose }: { childId: number, onClose: () => void }) {
  const { t } = useI18n();
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
        <h2 className="mb-6 text-xl font-bold">{t('expanded.addNewRecord')}</h2>
        <div className="space-y-4">
          <label className="block text-sm font-bold text-foreground">
            {t('expanded.category')}
            <select data-testid="select-child-record-category" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none">
              <option value="health">{t('expanded.health')}</option>
              <option value="emergency">{t('expanded.emergency')}</option>
              <option value="allergy">{t('expanded.allergy')}</option>
              <option value="medication">{t('expanded.medication')}</option>
              <option value="document">{t('expanded.document')}</option>
              <option value="photo">{t('expanded.photo')}</option>
              <option value="note">{t('expanded.notes')}</option>
              <option value="history">{t('expanded.history')}</option>
            </select>
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t('expanded.title')}
            <input data-testid="input-child-record-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" />
          </label>
          <label className="block text-sm font-bold text-foreground">{t('expanded.date')}
            <input data-testid="input-child-record-date" type="date" value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" />
          </label>
          <label className="block text-sm font-bold text-foreground">{t('expanded.details')}
            <textarea data-testid="input-child-record-details" required rows={3} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 outline-none" />
          </label>
          {(form.category === 'document' || form.category === 'photo') && <label className="block text-sm font-bold text-foreground">{t('expanded.privateFileUrl')}
            <input data-testid="input-child-record-url" type="url" value={form.referenceUrl} onChange={(e) => setForm({ ...form, referenceUrl: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" />
          </label>}
          <label className="flex items-center gap-2 text-sm font-bold text-foreground">
            <input data-testid="checkbox-child-record-confidential" type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} />
            {t('expanded.confidentialHelp')}
          </label>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <Button data-testid="button-cancel-child-record" type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button data-testid="button-submit-child-record" type="submit" disabled={create.isPending}>{create.isPending ? t('expanded.saving') : t('expanded.saveChildRecord')}</Button>
        </div>
      </form>
    </div>
  );
}
