import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListBranchesQueryKey,
  getListOrganizationsQueryKey,
  useCreateBranch,
  useCreateOrganization,
  useDeleteBranch,
  useDeleteOrganization,
  useGetSessionContext,
  useListBranches,
  useListOrganizations,
  useUpdateBranch,
  useUpdateOrganization,
} from '@workspace/api-client-react';
import type { Branch, Organization } from '@workspace/api-client-react';
import { Building2, Edit3, Plus, Trash2, X } from 'lucide-react';
import { Button, PageHeader, Pill, QueryState, Shell } from '../../App';
import { useI18n, type TranslationKey } from '../../i18n';

const ORGANIZATION_TYPES = ['nursery', 'school', 'institute', 'other'] as const;
type OrganizationType = typeof ORGANIZATION_TYPES[number];
const ORGANIZATION_TYPE_KEYS: Record<OrganizationType, TranslationKey> = {
  nursery: 'organizations.organizationTypeNursery',
  school: 'organizations.organizationTypeSchool',
  institute: 'organizations.organizationTypeInstitute',
  other: 'organizations.organizationTypeOther',
};

function organizationTypeLabel(type: string, t: (key: TranslationKey) => string) {
  const key = ORGANIZATION_TYPE_KEYS[type as OrganizationType];
  return key ? t(key) : type;
}

type OrganizationFormValue = {
  name: string;
  type: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
};

type BranchFormValue = {
  organizationId: number;
  name: string;
  address: string;
  phone: string;
  active: boolean;
};

function useOrganizationPermissions() {
  const session = useGetSessionContext();
  const effective = session.data?.effectivePermissions || [];
  return {
    canWriteOrganization: effective.includes('write:organization'),
    canDeleteOrganization: effective.includes('delete:organization'),
    canWriteBranch: effective.includes('write:branch'),
    canDeleteBranch: effective.includes('delete:branch'),
  };
}

export function Organizations() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const organizationsQuery = useListOrganizations();
  const organizations = organizationsQuery.data || [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [organizationDialog, setOrganizationDialog] = useState<Organization | 'new' | null>(null);
  const [branchDialog, setBranchDialog] = useState<Branch | 'new' | null>(null);
  const [organizationDeleteError, setOrganizationDeleteError] = useState(false);
  const [branchDeleteErrorId, setBranchDeleteErrorId] = useState<number | null>(null);
  const permissions = useOrganizationPermissions();
  const selected = organizations.find((organization) => organization.id === selectedId) || organizations[0];
  const branchesQuery = useListBranches(selected ? { organizationId: selected.id } : undefined);
  const branches = branchesQuery.data || [];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const refreshOrganizations = () => queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
  const refreshBranches = () => queryClient.invalidateQueries({ queryKey: getListBranchesQueryKey() });

  const deleteOrganization = useDeleteOrganization();
  const deleteBranch = useDeleteBranch();
  const removeOrganization = (organization: Organization) => {
    if (!window.confirm(t('organizations.deleteConfirm'))) return;
    setOrganizationDeleteError(false);
    deleteOrganization.mutate({ id: organization.id }, {
      onSuccess: () => {
        setOrganizationDeleteError(false);
        if (selectedId === organization.id) setSelectedId(null);
        refreshOrganizations();
        refreshBranches();
      },
      onError: () => setOrganizationDeleteError(true),
    });
  };
  const removeBranch = (branch: Branch) => {
    if (!window.confirm(t('organizations.deleteConfirm'))) return;
    setBranchDeleteErrorId(null);
    deleteBranch.mutate({ id: branch.id }, {
      onSuccess: refreshBranches,
      onError: () => setBranchDeleteErrorId(branch.id),
    });
  };

  return (
    <Shell>
      <PageHeader
        eyebrow={t('organizations.eyebrow')}
        title={t('organizations.title')}
        description={t('organizations.description')}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,.8fr)_minmax(0,1.5fr)]">
        <section className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Building2 className="text-primary" size={20} />{t('organizations.organizations')}
            </h2>
            {permissions.canWriteOrganization && (
              <Button data-testid="button-add-organization" className="!px-3 !py-2" onClick={() => setOrganizationDialog('new')}>
                <Plus size={17} />{t('organizations.addOrganization')}
              </Button>
            )}
          </div>
          {organizationDeleteError && (
            <p data-testid="alert-delete-organization" role="alert" className="mb-4 text-sm font-bold text-destructive">
              {t('organizations.deleteError')}
            </p>
          )}
          <QueryState loading={organizationsQuery.isLoading} error={organizationsQuery.isError} empty={!organizations.length} onRetry={() => organizationsQuery.refetch()}>
            <div className="space-y-3">
              {organizations.map((organization) => (
                <button
                  key={organization.id}
                  type="button"
                  data-testid={`button-select-organization-${organization.id}`}
                  onClick={() => setSelectedId(organization.id)}
                  className={`w-full rounded-xl border p-4 text-start transition-colors ${selected?.id === organization.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{organization.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{organization.code} · {organizationTypeLabel(organization.type, t)}</p>
                    </div>
                    <Pill tone={organization.active ? 'green' : 'neutral'}>{organization.active ? t('organizations.active') : t('organizations.inactive')}</Pill>
                  </div>
                  {(organization.phone || organization.address) && (
                    <p className="mt-3 text-xs text-muted-foreground">{[organization.phone, organization.address].filter(Boolean).join(' · ')}</p>
                  )}
                </button>
              ))}
            </div>
          </QueryState>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
          {!selected ? (
            <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('organizations.selectOrganization')}
            </div>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{selected.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t('organizations.branches')}</p>
                </div>
                <div className="flex gap-2">
                  {permissions.canWriteOrganization && (
                    <Button data-testid={`button-edit-organization-${selected.id}`} variant="soft" className="!px-3 !py-2" onClick={() => setOrganizationDialog(selected)}>
                      <Edit3 size={16} />{t('organizations.editOrganization')}
                    </Button>
                  )}
                  {permissions.canDeleteOrganization && (
                    <Button data-testid={`button-delete-organization-${selected.id}`} variant="ghost" className="!px-3 !py-2 text-destructive" onClick={() => removeOrganization(selected)} disabled={deleteOrganization.isPending}>
                      <Trash2 size={16} />
                    </Button>
                  )}
                  {permissions.canWriteBranch && (
                    <Button data-testid="button-add-branch" className="!px-3 !py-2" onClick={() => setBranchDialog('new')}>
                      <Plus size={17} />{t('organizations.addBranch')}
                    </Button>
                  )}
                </div>
              </div>
              <QueryState loading={branchesQuery.isLoading} error={branchesQuery.isError} empty={!branches.length} onRetry={() => branchesQuery.refetch()}>
                <div className="grid gap-3 xl:grid-cols-2">
                  {branches.map((branch) => (
                    <div key={branch.id} data-testid={`row-branch-${branch.id}`} className="rounded-xl border border-border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold">{branch.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{branch.code}</p>
                        </div>
                        <Pill tone={branch.active ? 'green' : 'neutral'}>{branch.active ? t('organizations.active') : t('organizations.inactive')}</Pill>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                        <Detail label={t('organizations.phone')} value={branch.phone} />
                        <Detail label={t('organizations.address')} value={branch.address} />
                      </dl>
                      <div className="mt-4 flex gap-2">
                        {permissions.canWriteBranch && (
                          <Button data-testid={`button-edit-branch-${branch.id}`} variant="ghost" className="!px-3 !py-2" onClick={() => setBranchDialog(branch)}>
                            <Edit3 size={16} />{t('common.edit')}
                          </Button>
                        )}
                        {permissions.canDeleteBranch && (
                          <Button data-testid={`button-delete-branch-${branch.id}`} variant="ghost" className="!px-3 !py-2 text-destructive" onClick={() => removeBranch(branch)} disabled={deleteBranch.isPending}>
                            <Trash2 size={16} />{t('common.delete')}
                          </Button>
                        )}
                      </div>
                      {branchDeleteErrorId === branch.id && (
                        <p data-testid={`alert-delete-branch-${branch.id}`} role="alert" className="mt-3 text-sm font-bold text-destructive">
                          {t('organizations.deleteError')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </QueryState>
            </>
          )}
        </section>
      </div>
      {organizationDialog && (
        <OrganizationDialog
          value={organizationDialog}
          onClose={() => setOrganizationDialog(null)}
          onSaved={() => { setOrganizationDialog(null); refreshOrganizations(); }}
        />
      )}
      {branchDialog && selected && (
        <BranchDialog
          value={branchDialog}
          organizationId={selected.id}
          onClose={() => setBranchDialog(null)}
          onSaved={() => { setBranchDialog(null); refreshBranches(); }}
        />
      )}
    </Shell>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>;
}

function OrganizationDialog({ value, onClose, onSaved }: { value: Organization | 'new'; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const create = useCreateOrganization();
  const update = useUpdateOrganization();
  const initial = value === 'new' ? null : value;
  const [form, setForm] = useState<OrganizationFormValue>({
    name: initial?.name || '', type: initial?.type || 'nursery',
    address: initial?.address || '', phone: initial?.phone || '', email: initial?.email || '', active: initial?.active ?? true,
  });
  const mutation = value === 'new' ? create : update;
  const busy = mutation.isPending;
  const [validationError, setValidationError] = useState(false);
  const set = (key: keyof OrganizationFormValue, next: string | boolean) => setForm((current) => ({ ...current, [key]: next }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    const data = { ...form, name: form.name.trim(), address: form.address.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null };
    if (value === 'new') create.mutate({ data }, { onSuccess: onSaved });
    else update.mutate({ id: value.id, data }, { onSuccess: onSaved });
  };
  return (
    <Modal kind="organization" title={value === 'new' ? t('organizations.addOrganization') : t('organizations.editOrganization')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('organizations.name')} testId="input-organization-name" value={form.name} onChange={(v) => set('name', v)} required />
        <label className="block text-sm font-bold">
          <span className="mb-1.5 block">{t('organizations.type')}</span>
          <select
            data-testid="input-organization-type"
            value={form.type}
            onChange={(event) => set('type', event.target.value)}
            className="min-h-11 w-full rounded-xl border border-input bg-background px-4 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {!ORGANIZATION_TYPES.includes(form.type as OrganizationType) && form.type && (
              <option value={form.type}>{organizationTypeLabel(form.type, t)}</option>
            )}
            {ORGANIZATION_TYPES.map((type) => (
              <option key={type} value={type}>{organizationTypeLabel(type, t)}</option>
            ))}
          </select>
        </label>
        <Field label={t('organizations.phone')} testId="input-organization-phone" value={form.phone} onChange={(v) => set('phone', v)} />
        <Field label={t('organizations.address')} testId="input-organization-address" value={form.address} onChange={(v) => set('address', v)} />
        <Field label={t('organizations.email')} testId="input-organization-email" type="email" value={form.email} onChange={(v) => set('email', v)} />
        <Checkbox label={t('organizations.active')} testId="input-organization-active" checked={form.active} onChange={(v) => set('active', v)} />
        {validationError && <p data-testid="alert-organization-required" role="alert" className="text-sm font-bold text-destructive">{t('organizations.required')}</p>}
        {mutation.isError && <p role="alert" className="text-sm font-bold text-destructive">{t('organizations.saveError')}</p>}
        <DialogActions kind="organization" busy={busy} onClose={onClose} saveLabel={t('organizations.save')} />
      </form>
    </Modal>
  );
}

function BranchDialog({ value, organizationId, onClose, onSaved }: { value: Branch | 'new'; organizationId: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const create = useCreateBranch();
  const update = useUpdateBranch();
  const initial = value === 'new' ? null : value;
  const [form, setForm] = useState<BranchFormValue>({
    organizationId, name: initial?.name || '', address: initial?.address || '',
    phone: initial?.phone || '', active: initial?.active ?? true,
  });
  const mutation = value === 'new' ? create : update;
  const [validationError, setValidationError] = useState(false);
  const set = (key: keyof BranchFormValue, next: string | boolean | number) => setForm((current) => ({ ...current, [key]: next }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    const data = {
      organizationId: form.organizationId, name: form.name.trim(),
      address: form.address.trim() || null, phone: form.phone.trim() || null, active: form.active,
    };
    if (value === 'new') create.mutate({ data }, { onSuccess: onSaved });
    else update.mutate({ id: value.id, data }, { onSuccess: onSaved });
  };
  return (
    <Modal kind="branch" title={value === 'new' ? t('organizations.addBranch') : t('organizations.editBranch')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('organizations.name')} testId="input-branch-name" value={form.name} onChange={(v) => set('name', v)} required />
        <Field label={t('organizations.phone')} testId="input-branch-phone" value={form.phone} onChange={(v) => set('phone', v)} />
        <Field label={t('organizations.address')} testId="input-branch-address" value={form.address} onChange={(v) => set('address', v)} />
        <Checkbox label={t('organizations.active')} testId="input-branch-active" checked={form.active} onChange={(v) => set('active', v)} />
        {validationError && <p data-testid="alert-branch-required" role="alert" className="text-sm font-bold text-destructive">{t('organizations.required')}</p>}
        {mutation.isError && <p role="alert" className="text-sm font-bold text-destructive">{t('organizations.saveError')}</p>}
        <DialogActions kind="branch" busy={mutation.isPending} onClose={onClose} saveLabel={t('organizations.save')} />
      </form>
    </Modal>
  );
}

function Field({ label, testId, value, onChange, type = 'text', required = false }: { label: string; testId: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return <label className="block text-sm font-bold"><span className="mb-1.5 block">{label}</span><input data-testid={testId} type={type} required={required} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-input bg-background px-4 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>;
}

function Checkbox({ label, testId, checked, onChange }: { label: string; testId: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm font-bold"><input data-testid={testId} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" />{label}</label>;
}

function DialogActions({ kind, busy, onClose, saveLabel }: { kind: 'organization' | 'branch'; busy: boolean; onClose: () => void; saveLabel: string }) {
  const { t } = useI18n();
  return <div className="flex justify-end gap-2 pt-2"><Button data-testid={`button-cancel-${kind}-dialog`} type="button" variant="ghost" onClick={onClose}>{t('organizations.cancel')}</Button><Button data-testid={`button-save-${kind}-dialog`} type="submit" disabled={busy}>{saveLabel}</Button></div>;
}

function Modal({ kind, title, onClose, children }: { kind: 'organization' | 'branch'; title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.5rem] border border-border bg-card p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl font-bold">{title}</h2><Button data-testid={`button-close-${kind}-dialog`} type="button" variant="ghost" className="!px-2" onClick={onClose}><X size={18} /></Button></div>{children}</div></div>;
}
