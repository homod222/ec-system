import { useState } from 'react';
import {
  getListPermissionPrincipalsQueryKey,
  getListStaffQueryKey,
  useCreateStaff,
  useDeleteStaff,
  useLinkStaffAccount,
  useListPermissionPrincipals,
  useListStaff,
  useUpdateStaff,
  useUpdateStaffAccount,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Shell, Button, Pill, Avatar, QueryState, PageHeader } from '../../App';
import {
  Briefcase, DollarSign, Edit3, GraduationCap, KeyRound, Plane, Plus,
  Search, ShieldCheck, Star, Trash2, UserCheck, UserX, X,
} from 'lucide-react';
import type { StaffAccountUpdateInputRole, StaffMember } from '@workspace/api-client-react';
import { OperationalManager } from '../../components/OperationalManager';
import { useI18n } from '../../i18n';
import { Link } from 'wouter';

export const accountRoleValues: StaffAccountUpdateInputRole[] = ['admin', 'manager', 'supervisor', 'teacher', 'accountant', 'receptionist'];

export function StaffExpanded() {
  const { t, dir, formatNumber } = useI18n();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StaffMember | null | undefined>(undefined);
  const [accountMember, setAccountMember] = useState<StaffMember | null>(null);
  const query = useListStaff();
  const staff = query.data || [];
  const filtered = staff.filter((member) => member.name.includes(search));

  return (
    <Shell>
      <PageHeader
        eyebrow={t('expanded.staffEyebrow')}
        title={t('expanded.staffTitle')}
        description={t('staffAccounts.description')}
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search size={18} className={`absolute top-3.5 text-muted-foreground ${dir === 'rtl' ? 'right-4' : 'left-4'}`} />
          <input
            data-testid="input-search-staff"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('expanded.searchStaff')}
            className={`w-full rounded-xl border border-border bg-card py-3.5 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-12 pl-4' : 'pl-12 pr-4'}`}
          />
        </div>
        <Button onClick={() => setEditing(null)}><Plus size={18} />{t('expanded.addStaff')}</Button>
      </div>

      <QueryState loading={query.isLoading} error={query.isError} empty={!filtered.length} onRetry={() => query.refetch()}>
        <div className="mb-10 overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div className="hidden grid-cols-[1.3fr_.8fr_.9fr_.8fr_auto] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
            <span>{t('expanded.employee')}</span>
            <span>{t('expanded.position')}</span>
            <span>{t('expanded.phone')}</span>
            <span>{t('staffAccounts.loginAccount')}</span>
            <span>{t('staffAccounts.actions')}</span>
          </div>
          {filtered.map((member) => (
            <div key={member.id} data-testid={`row-staff-${member.id}`} className={`grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 md:grid-cols-[1.3fr_.8fr_.9fr_.8fr_auto] md:items-center md:gap-4 ${member.accountStatus === 'pending_verification' ? 'bg-sky-50/60 dark:bg-sky-950/20' : ''}`}>
              <div className="flex items-center gap-4">
                <Avatar name={member.name} className="h-11 w-11" />
                <div>
                  <p className="font-bold text-foreground">{member.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{member.email || t('staffAccounts.noEmail')}</p>
                </div>
              </div>
              <div className="text-sm font-bold text-foreground">{accountRoleValues.includes(member.role as StaffAccountUpdateInputRole) ? t(`staffAccounts.role.${member.role}` as never) : member.role}</div>
              <div className="text-sm font-medium text-muted-foreground">{member.phone}</div>
              <div>
                <Pill tone={member.accountStatus === 'active' ? 'green' : member.accountStatus === 'disabled' ? 'red' : member.accountStatus === 'pending_verification' ? 'blue' : 'neutral'}>
                  {t(`staffAccounts.status.${member.accountStatus}` as never)}
                </Pill>
                <p className="mt-2 text-[11px] text-muted-foreground">{formatNumber(member.attendanceRate / 100, { style: 'percent', maximumFractionDigits: 0 })} {t('staffAccounts.attendance')}</p>
              </div>
              <div className="flex gap-2">
                <Button data-testid={`button-account-staff-${member.id}`} aria-label={member.accountStatus === 'pending_verification' ? t('staffAccounts.reviewPending') : t('staffAccounts.manage')} title={member.accountStatus === 'pending_verification' ? t('staffAccounts.reviewPending') : t('staffAccounts.manage')} variant={member.accountStatus === 'pending_verification' ? 'soft' : 'ghost'} className="!p-2" onClick={() => setAccountMember(member)}><KeyRound size={16} /></Button>
                <Button aria-label={t('common.edit')} title={t('common.edit')} variant="ghost" className="!p-2" onClick={() => setEditing(member)}><Edit3 size={16} /></Button>
                <DeleteStaffButton member={member} />
              </div>
            </div>
          ))}
        </div>
      </QueryState>

      <OperationalManager resource="staff-profile" title={t('expanded.extraProfiles')} icon={GraduationCap} extraFields={[{ name: 'staffId', label: t('expanded.employeeNumber'), type: 'text' }]} />
      <OperationalManager resource="staff-job" title={t('expanded.jobsContracts')} icon={Briefcase} extraFields={[{ name: 'contractType', label: t('expanded.contractType'), type: 'text' }]} />
      <OperationalManager resource="staff-leave" title={t('expanded.leaveRequests')} icon={Plane} extraFields={[{ name: 'days', label: t('expanded.days'), type: 'number' }]} />
      <OperationalManager resource="payroll" title={t('expanded.payroll')} icon={DollarSign} extraFields={[{ name: 'month', label: t('expanded.month'), type: 'month' }]} />
      <OperationalManager resource="evaluation" title={t('expanded.performance')} icon={Star} extraFields={[{ name: 'score', label: t('expanded.score'), type: 'number' }, { name: 'reviewer', label: t('expanded.reviewer'), type: 'text' }]} />

      {editing !== undefined && <StaffForm member={editing} onClose={() => setEditing(undefined)} />}
      {accountMember && <StaffAccountDialog member={accountMember} onClose={() => setAccountMember(null)} />}
    </Shell>
  );
}

function DeleteStaffButton({ member }: { member: StaffMember }) {
  const { t } = useI18n();
  const remove = useDeleteStaff();
  const queryClient = useQueryClient();
  return (
    <Button
      aria-label={t('common.delete')}
      title={member.clerkUserId ? t('staffAccounts.disableBeforeDelete') : t('common.delete')}
      variant="danger"
      className="!p-2"
      disabled={remove.isPending || Boolean(member.clerkUserId)}
      onClick={() => {
        if (window.confirm(t('expanded.deleteStaff', { name: member.name }))) {
          remove.mutate({ id: member.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() }) });
        }
      }}
    >
      <Trash2 size={16} />
    </Button>
  );
}

function StaffForm({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: member?.name || '',
    role: member?.role || 'teacher',
    phone: member?.phone || '',
    status: member?.status || 'present',
    email: member?.email || '',
    jobTitle: member?.jobTitle || '',
    hireDate: member?.hireDate || '',
  });
  const create = useCreateStaff();
  const update = useUpdateStaff();
  const queryClient = useQueryClient();
  const pending = create.isPending || update.isPending;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const data = { ...form, email: form.email || null, jobTitle: form.jobTitle || null, hireDate: form.hireDate || null };
    const done = () => {
      queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
      onClose();
    };
    member ? update.mutate({ id: member.id, data }, { onSuccess: done }) : create.mutate({ data }, { onSuccess: done });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md">
      <form onSubmit={submit} className="w-full max-w-lg rounded-[2rem] bg-card p-8 shadow-2xl">
        <div className="mb-5 flex justify-between">
          <h2 className="text-xl font-bold">{member ? t('expanded.editStaff') : t('expanded.addStaff')}</h2>
          <Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X /></Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('expanded.name')} required value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <label className="text-sm font-bold">{t('staffAccounts.baseRole')}
            <select data-testid="select-staff-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3">
              {accountRoleValues.map((role) => <option key={role} value={role} disabled={Boolean(member?.clerkUserId)}>{t(`staffAccounts.role.${role}` as never)}</option>)}
            </select>
          </label>
          <Field label={t('expanded.mobile')} required type="tel" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
          <Field label={t('expanded.email')} required type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
          <Field label={t('expanded.jobTitle')} value={form.jobTitle} onChange={(value) => setForm({ ...form, jobTitle: value })} />
          <Field label={t('expanded.hireDate')} type="date" value={form.hireDate} onChange={(value) => setForm({ ...form, hireDate: value })} />
        </div>
        {(create.isError || update.isError) && <p className="mt-4 text-sm text-destructive">{t('expanded.staffSaveError')}</p>}
        <div className="mt-7 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button data-testid="button-save-staff" disabled={pending}>{pending ? t('expanded.saving') : t('common.save')}</Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return <label className="text-sm font-bold">{label}<input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" /></label>;
}

export function StaffAccountDialog({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const { t } = useI18n();
  const [role, setRole] = useState<StaffAccountUpdateInputRole>((accountRoleValues.includes(member.role as StaffAccountUpdateInputRole) ? member.role : 'teacher') as StaffAccountUpdateInputRole);
  const [linkUserId, setLinkUserId] = useState('');
  const [message, setMessage] = useState('');
  const link = useLinkStaffAccount();
  const update = useUpdateStaffAccount();
  const principals = useListPermissionPrincipals();
  const queryClient = useQueryClient();
  const pending = link.isPending || update.isPending;
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListPermissionPrincipalsQueryKey() }),
    ]);
  };
  const mutateAccount = (status: 'active' | 'disabled' | 'unlinked') => {
    update.mutate({ id: member.id, data: { role, status } }, {
      onSuccess: async () => {
        setMessage(status === 'disabled' ? t('staffAccounts.disabledSuccess') : t('staffAccounts.updatedSuccess'));
        await refresh();
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-[2rem] bg-card p-8 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">{t('staffAccounts.dialogTitle')}</p>
            <h2 className="mt-1 text-xl font-bold">{member.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t(`staffAccounts.status.${member.accountStatus}` as never)}</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X /></Button>
        </div>

        <label className="block text-sm font-bold">{t('staffAccounts.systemRole')}
          <select value={role} onChange={(event) => setRole(event.target.value as StaffAccountUpdateInputRole)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3">
            {accountRoleValues.map((item) => <option key={item} value={item}>{t(`staffAccounts.role.${item}` as never)}</option>)}
          </select>
        </label>

        {member.accountStatus === 'unlinked' ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2 font-bold"><ShieldCheck size={18} />{t('staffAccounts.registerTitle')}</div>
              <p className="mt-2 text-sm text-muted-foreground">{t('staffAccounts.registerBody')}</p>
              <Link href="/sign-up" className="mt-4 inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90">
                {t('staffAccounts.goToSignUp')}
              </Link>
            </div>

            <div className="rounded-2xl border border-border p-4">
              <div className="flex items-center gap-2 font-bold"><UserCheck size={18} />{t('staffAccounts.linkTitle')}</div>
              <p className="mt-2 text-sm text-muted-foreground">{t('staffAccounts.linkBody')}</p>
              <select value={linkUserId} onChange={(event) => setLinkUserId(event.target.value)} className="mt-3 w-full rounded-xl border border-input bg-background px-4 py-3">
                <option value="">{t('staffAccounts.selectUser')}</option>
                {(principals.data || []).filter((principal) => principal.role !== 'owner').map((principal) => (
                  <option key={principal.userId} value={principal.userId}>{principal.label} — {principal.role}</option>
                ))}
              </select>
              <input value={linkUserId} onChange={(event) => setLinkUserId(event.target.value)} placeholder={t('staffAccounts.clerkIdPlaceholder')} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" />
              <Button
                variant="ghost"
                className="mt-3"
                disabled={pending || !linkUserId}
                onClick={() => link.mutate({ id: member.id, data: { clerkUserId: linkUserId, role } }, {
                  onSuccess: async () => {
                    setMessage(t('staffAccounts.linkedSuccess'));
                    await refresh();
                  },
                })}
              >
                {t('staffAccounts.link')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap gap-3">
            <Button disabled={pending} onClick={() => mutateAccount('active')}><ShieldCheck size={17} />{t('staffAccounts.saveAndActivate')}</Button>
            <Button variant="danger" disabled={pending || member.accountStatus === 'disabled'} onClick={() => mutateAccount('disabled')}><UserX size={17} />{t('staffAccounts.disable')}</Button>
            <Button variant="ghost" disabled={pending} onClick={() => mutateAccount('unlinked')}>{t('staffAccounts.unlink')}</Button>
          </div>
        )}

        {(link.isError || update.isError) && <p className="mt-4 text-sm font-medium text-destructive">{t('staffAccounts.operationError')}</p>}
        {message && <p data-testid="text-account-result" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{message}</p>}
      </div>
    </div>
  );
}