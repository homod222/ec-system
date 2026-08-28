import { useState } from 'react';
import { 
  useListOperationalRecords, 
  useCreateOperationalRecord, 
  useUpdateOperationalRecord, 
  useDeleteOperationalRecord,
  getListOperationalRecordsQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Pill, QueryState } from '../App';
import { Plus, Edit3, Trash2, X } from 'lucide-react';
import type { OperationalRecord } from '@workspace/api-client-react';
import { useI18n } from '../i18n';

type ResourceType = 'branch' | 'stage' | 'teacher-assignment' | 'classroom-schedule' | 'staff-profile' | 'staff-job' | 'staff-leave' | 'payroll' | 'evaluation' | 'curriculum' | 'lesson-plan' | 'skill' | 'assessment' | 'progress-report' | 'event' | 'media' | 'fee-plan' | 'discount' | 'refund' | 'expense' | 'revenue' | 'setting' | 'holiday' | 'notification' | 'integration';

export function OperationalManager({ resource, title, description, icon: Icon, extraFields = [] }: { 
  resource: ResourceType; 
  title: string; 
  description?: string; 
  icon?: any;
  extraFields?: { name: string; label: string; type: string }[];
}) {
  const { t, formatDate, formatNumber } = useI18n();
  const query = useListOperationalRecords(resource);
  const records = query.data || [];
  const qc = useQueryClient();
  const [modal, setModal] = useState<OperationalRecord | 'new' | null>(null);

  const del = useDeleteOperationalRecord();

  const handleDelete = (id: number) => {
    if (confirm(t('expanded.deleteConfirm'))) {
      del.mutate({ resource, id }, {
        onSuccess: () => qc.invalidateQueries({ queryKey: getListOperationalRecordsQueryKey(resource) })
      });
    }
  };

  return (
    <div className="rounded-[1.5rem] border border-border bg-card p-6 shadow-sm mb-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            {Icon && <Icon size={20} className="text-primary" />} {title}
          </h2>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        <Button data-testid={`button-add-${resource}`} onClick={() => setModal('new')}><Plus size={18} />{t('expanded.add')}</Button>
      </div>

      <QueryState loading={query.isLoading} error={query.isError} empty={!records.length} onRetry={() => query.refetch()}>
        <div className="space-y-4">
          {records.map(record => (
            <div key={record.id} data-testid={`record-${resource}-${record.id}`} className="flex items-center justify-between rounded-xl border border-border p-4 bg-background">
              <div>
                <p className="font-bold text-foreground">{record.title}</p>
                <div className="flex gap-2 mt-1">
                  <Pill tone={record.status === 'active' || record.status === 'approved' || record.status === 'published' ? 'green' : 'neutral'}>{statusLabel(record.status || 'active', t)}</Pill>
                  {record.amount != null && <Pill tone="blue">{formatNumber(record.amount)}</Pill>}
                  {record.occurredOn && <span className="text-xs text-muted-foreground">{formatDate(record.occurredOn)}</span>}
                </div>
              </div>
              <div className="flex gap-2">
                 <Button data-testid={`button-edit-${resource}-${record.id}`} aria-label={t('common.edit')} title={t('common.edit')} variant="ghost" className="h-8 w-8 !p-0" onClick={() => setModal(record)}><Edit3 size={16} /></Button>
                 <Button data-testid={`button-delete-${resource}-${record.id}`} aria-label={t('common.delete')} title={t('common.delete')} variant="ghost" className="h-8 w-8 !p-0 text-destructive hover:bg-destructive hover:text-white" onClick={() => handleDelete(record.id)} disabled={del.isPending}><Trash2 size={16} /></Button>
              </div>
            </div>
          ))}
        </div>
      </QueryState>

      {modal && (
        <OperationalForm 
          resource={resource} 
          record={modal === 'new' ? undefined : modal} 
          onClose={() => setModal(null)} 
          extraFields={extraFields}
        />
      )}
    </div>
  );
}

function OperationalForm({ resource, record, onClose, extraFields }: { resource: ResourceType, record?: OperationalRecord, onClose: () => void, extraFields: { name: string; label: string; type: string }[] }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    title: record?.title || '',
    status: record?.status || 'active',
    occurredOn: record?.occurredOn || '',
    amount: record?.amount?.toString() || '',
    data: record?.data || {} as Record<string, any>
  });

  const create = useCreateOperationalRecord();
  const update = useUpdateOperationalRecord();
  const qc = useQueryClient();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      title: form.title,
      status: form.status,
      occurredOn: form.occurredOn || null,
      amount: form.amount ? Number(form.amount) : null,
      data: form.data,
    };
    
    if (record) {
      update.mutate({ resource, id: record.id, data: payload }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListOperationalRecordsQueryKey(resource) });
          onClose();
        }
      });
    } else {
      create.mutate({ resource, data: payload }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListOperationalRecordsQueryKey(resource) });
          onClose();
        }
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md animate-in fade-in">
      <form onSubmit={submit} className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[2rem] border border-border bg-card p-8 shadow-2xl animate-rise">
        <div className="mb-6 flex justify-between items-center">
          <h2 className="text-xl font-bold">{record ? t('expanded.editEntry') : t('expanded.addEntry')}</h2>
           <Button data-testid={`button-close-${resource}-form`} aria-label={t('common.close')} title={t('common.close')} type="button" variant="ghost" onClick={onClose} className="!p-2"><X size={20} /></Button>
        </div>
        
        <div className="space-y-4">
          <label className="block text-sm font-bold text-foreground">
            {t('expanded.titleDescription')}
            <input required data-testid={`input-${resource}-title`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t('expanded.status')}
            <select data-testid={`select-${resource}-status`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none">
              <option value="active">{t('expanded.activeApproved')}</option>
              <option value="draft">{t('expanded.draft')}</option>
              <option value="archived">{t('expanded.archived')}</option>
              <option value="pending">{t('expanded.waiting')}</option>
              <option value="approved">{t('expanded.approved')}</option>
              <option value="published">{t('expanded.published')}</option>
            </select>
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t('expanded.optionalDate')}
            <input type="date" data-testid={`input-${resource}-date`} value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t('expanded.amountValue')}
            <input type="number" step="0.001" data-testid={`input-${resource}-amount`} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
          
          {extraFields.map(field => (
            <label key={field.name} className="block text-sm font-bold text-foreground">
              {field.label}
              <input type={field.type} data-testid={`input-${resource}-${field.name}`} value={form.data[field.name] || ''} onChange={(e) => setForm({ ...form, data: { ...form.data, [field.name]: e.target.value } })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20" />
            </label>
          ))}
        </div>
        
        <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-border">
          <Button data-testid={`button-cancel-${resource}`} type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button data-testid={`button-submit-${resource}`} type="submit" disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? t('expanded.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function statusLabel(status: string, t: ReturnType<typeof useI18n>['t']) {
  const labels: Record<string, ReturnType<typeof t>> = {
    active: t('expanded.active'), approved: t('expanded.approved'), published: t('expanded.published'),
    draft: t('expanded.draft'), archived: t('expanded.archived'), pending: t('expanded.waiting'),
  };
  return labels[status] || status;
}
