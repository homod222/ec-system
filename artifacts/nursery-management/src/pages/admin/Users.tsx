import { useState } from 'react';
import {
  getListGuardianAccountsQueryKey,
  getListStaffQueryKey,
  useAdminCreateAccount,
  useListGuardianAccounts,
  useListStaff,
  useUpdateGuardianAccount,
} from '@workspace/api-client-react';
import type { GuardianAccountResult, StaffMember } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserX, X } from 'lucide-react';
import { Shell, Button, Pill, Avatar, QueryState, PageHeader } from '../../App';
import { accountRoleValues, StaffAccountDialog } from './StaffExpanded';
import { useI18n } from '../../i18n';

type Tab = 'guardians' | 'staff';

export function Users() {
  const { t, dir } = useI18n();
  const [tab, setTab] = useState<Tab>('guardians');
  const [search, setSearch] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <Shell>
      <PageHeader eyebrow={t('usersPage.eyebrow')} title={t('usersPage.title')} description={t('usersPage.description')} />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
        <div className="inline-flex rounded-xl border border-border bg-card p-1">
          <button
            data-testid="tab-users-guardians"
            onClick={() => setTab('guardians')}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${tab === 'guardians' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t('usersPage.tabGuardians')}
          </button>
          <button
            data-testid="tab-users-staff"
            onClick={() => setTab('staff')}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${tab === 'staff' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t('usersPage.tabStaff')}
          </button>
        </div>
        <Button
          data-testid="button-add-account"
          onClick={() => setShowCreateDialog(true)}
          className="!px-4 !py-2.5"
        >
          <Plus size={18} />{t('usersPage.addAccount')}
        </Button>
        </div>
        <div className="relative w-full max-w-md">
          <Search size={18} className={`absolute top-3.5 text-muted-foreground ${dir === 'rtl' ? 'right-4' : 'left-4'}`} />
          <input
            data-testid="input-search-users"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('usersPage.searchPlaceholder')}
            className={`w-full rounded-xl border border-border bg-card py-3.5 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-12 pl-4' : 'pl-12 pr-4'}`}
          />
        </div>
      </div>

      {tab === 'guardians' ? <GuardiansTab search={search} /> : <StaffTab search={search} />}

      {showCreateDialog && <ManualAccountDialog onClose={() => setShowCreateDialog(false)} />}
    </Shell>
  );
}

function statusTone(status: GuardianAccountResult['accountStatus']) {
  return status === 'active'
    ? 'green' as const
    : status === 'disabled'
      ? 'red' as const
      : status === 'pending' ? 'blue' as const : 'neutral' as const;
}

function GuardiansTab({ search }: { search: string }) {
  const { t } = useI18n();
  const query = useListGuardianAccounts();
  const queryClient = useQueryClient();
  const update = useUpdateGuardianAccount();
  const [error, setError] = useState<number | null>(null);
  const [editAccount, setEditAccount] = useState<GuardianAccountResult | null>(null);
  const [deleteAccount, setDeleteAccount] = useState<GuardianAccountResult | null>(null);
  const accounts = (query.data || []).filter((account) => account.name.includes(search) || account.phone.includes(search));

  const mutate = (guardianId: number, status: 'active' | 'disabled') => {
    setError(null);
    update.mutate({ id: guardianId, data: { status } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListGuardianAccountsQueryKey() }),
      onError: () => setError(guardianId),
    });
  };

  return (
    <>
    <QueryState loading={query.isLoading} error={query.isError} empty={!accounts.length} onRetry={() => query.refetch()}>
      <div className="mb-10 overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
        <div className="hidden grid-cols-[1.3fr_.9fr_1fr_.7fr_auto] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
          <span>{t('usersPage.name')}</span>
          <span>{t('usersPage.phone')}</span>
          <span>{t('usersPage.email')}</span>
          <span>{t('usersPage.status')}</span>
          <span>{t('usersPage.actions')}</span>
        </div>
        {accounts.map((account) => (
          <div
            key={account.guardianId}
            data-testid={`row-guardian-account-${account.guardianId}`}
            className={`grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 md:grid-cols-[1.3fr_.9fr_1fr_.7fr_auto] md:items-center md:gap-4 ${account.accountStatus === 'unlinked' ? 'bg-sky-50/60 dark:bg-sky-950/20' : ''}`}
          >
            <div className="flex items-center gap-4">
              <Avatar name={account.name} className="h-11 w-11" />
              <p className="font-bold text-foreground">{account.name}</p>
            </div>
            <div className="text-sm font-medium text-muted-foreground">{account.phone}</div>
            <div className="text-sm font-medium text-muted-foreground">{account.email || t('usersPage.noEmail')}</div>
            <div>
              <Pill tone={statusTone(account.accountStatus)}>{t(`usersPage.status.${account.accountStatus}` as never)}</Pill>
              {account.accountStatus === 'unlinked' && (
                <p className="mt-2 text-[11px] text-muted-foreground">{t('usersPage.awaitingRegistration')}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="!px-2 !py-2"
                onClick={() => setEditAccount(account)}
              >
                <Pencil size={16} />
              </Button>
              <Button
                variant="ghost"
                className="!px-2 !py-2 text-destructive hover:text-destructive"
                onClick={() => setDeleteAccount(account)}
              >
                <Trash2 size={16} />
              </Button>
              {account.accountStatus === 'unlinked' ? (
                <span className="text-muted-foreground">—</span>
              ) : account.accountStatus === 'disabled' || account.accountStatus === 'pending' ? (
                <Button
                  data-testid={`button-activate-guardian-${account.guardianId}`}
                  variant="soft"
                  className="!px-3 !py-2"
                  disabled={update.isPending}
                  onClick={() => mutate(account.guardianId, 'active')}
                >
                  <ShieldCheck size={16} />{t('usersPage.activate')}
                </Button>
              ) : (
                <Button
                  data-testid={`button-disable-guardian-${account.guardianId}`}
                  variant="danger"
                  className="!px-3 !py-2"
                  disabled={update.isPending}
                  onClick={() => mutate(account.guardianId, 'disabled')}
                >
                  <UserX size={16} />{t('usersPage.disable')}
                </Button>
              )}
            </div>
            {error === account.guardianId && (
              <p className="text-xs font-medium text-destructive md:col-span-5">{t('usersPage.updateError')}</p>
            )}
          </div>
        ))}
      </div>
    </QueryState>

    {editAccount && (
      <EditGuardianDialog
        account={editAccount}
        onClose={() => setEditAccount(null)}
        onSaved={() => { setEditAccount(null); queryClient.invalidateQueries({ queryKey: getListGuardianAccountsQueryKey() }); }}
      />
    )}

    {deleteAccount && (
      <DeleteGuardianDialog
        account={deleteAccount}
        onClose={() => setDeleteAccount(null)}
        onDeleted={() => { setDeleteAccount(null); queryClient.invalidateQueries({ queryKey: getListGuardianAccountsQueryKey() }); }}
      />
    )}
    </>
  );
}

function EditGuardianDialog({ account, onClose, onSaved }: { account: GuardianAccountResult; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone);
  const [email, setEmail] = useState(account.email || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const resp = await fetch(`/api/guardians/${account.guardianId}/details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ec_jwt') || ''}` },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.error || 'Failed');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('usersPage.updateError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-[2rem] bg-card p-8 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">{t('usersPage.editTitle')}</p>
            <h2 className="mt-1 text-xl font-bold">{account.name}</h2>
          </div>
          <Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X /></Button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block text-sm font-bold">{t('usersPage.name')}
            <input required type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" />
          </label>
          <label className="block text-sm font-bold">{t('usersPage.phone')}
            <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" />
          </label>
          <label className="block text-sm font-bold">{t('usersPage.email')}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" />
          </label>
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? t('common.loading') : t('usersPage.saveChanges')}
          </Button>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        </form>
      </div>
    </div>
  );
}

function DeleteGuardianDialog({ account, onClose, onDeleted }: { account: GuardianAccountResult; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      const resp = await fetch(`/api/guardians/${account.guardianId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('ec_jwt') || ''}` },
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.error || 'Failed');
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('usersPage.updateError'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md">
      <div className="w-full max-w-md rounded-[2rem] bg-card p-8 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-destructive">{t('usersPage.deleteTitle')}</p>
            <h2 className="mt-1 text-xl font-bold">{account.name}</h2>
          </div>
          <Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X /></Button>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">{t('usersPage.deleteConfirm')}</p>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onClose} className="flex-1">{t('common.cancel')}</Button>
          <Button variant="danger" disabled={deleting} onClick={handleDelete} className="flex-1">
            {deleting ? t('common.loading') : t('common.delete')}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm font-medium text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function StaffTab({ search }: { search: string }) {
  const { t, formatNumber } = useI18n();
  const query = useListStaff();
  const [accountMember, setAccountMember] = useState<StaffMember | null>(null);
  const staff = (query.data || []).filter((member) => member.name.includes(search));

  return (
    <>
      <QueryState loading={query.isLoading} error={query.isError} empty={!staff.length} onRetry={() => query.refetch()}>
        <div className="mb-10 overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div className="hidden grid-cols-[1.3fr_.8fr_.9fr_.8fr_auto] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
            <span>{t('usersPage.name')}</span>
            <span>{t('usersPage.phone')}</span>
            <span>{t('usersPage.status')}</span>
            <span>{t('staffAccounts.attendance')}</span>
            <span>{t('usersPage.actions')}</span>
          </div>
          {staff.map((member) => (
            <div
              key={member.id}
              data-testid={`row-user-staff-${member.id}`}
              className={`grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 md:grid-cols-[1.3fr_.8fr_.9fr_.8fr_auto] md:items-center md:gap-4 ${member.accountStatus === 'pending_verification' ? 'bg-sky-50/60 dark:bg-sky-950/20' : ''}`}
            >
              <div className="flex items-center gap-4">
                <Avatar name={member.name} className="h-11 w-11" />
                <div>
                  <p className="font-bold text-foreground">{member.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {accountRoleValues.includes(member.role as never) ? t(`staffAccounts.role.${member.role}` as never) : member.role}
                  </p>
                </div>
              </div>
              <div className="text-sm font-medium text-muted-foreground">{member.phone}</div>
              <div>
                <Pill tone={member.accountStatus === 'active' ? 'green' : member.accountStatus === 'disabled' ? 'red' : member.accountStatus === 'pending_verification' ? 'blue' : 'neutral'}>
                  {t(`staffAccounts.status.${member.accountStatus}` as never)}
                </Pill>
              </div>
              <div className="text-sm font-medium text-muted-foreground">
                {formatNumber(member.attendanceRate / 100, { style: 'percent', maximumFractionDigits: 0 })}
              </div>
              <div>
                <Button
                  data-testid={`button-user-account-staff-${member.id}`}
                  variant={member.accountStatus === 'pending_verification' ? 'soft' : 'ghost'}
                  className="!p-2"
                  onClick={() => setAccountMember(member)}
                >
                  <KeyRound size={16} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </QueryState>

      {accountMember && <StaffAccountDialog member={accountMember} onClose={() => setAccountMember(null)} />}
    </>
  );
}

function ManualAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const createAccount = useAdminCreateAccount();
  const [accountType, setAccountType] = useState<'staff' | 'guardian'>('staff');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<string>('teacher');
  const [message, setMessage] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    createAccount.mutate({
      data: {
        phone,
        password,
        accountType,
        fullName: fullName || undefined,
        role: accountType === 'staff' ? role as 'admin' | 'manager' | 'supervisor' | 'teacher' | 'accountant' | 'receptionist' : undefined,
      },
    }, {
      onSuccess: async () => {
        setMessage(t('usersPage.createSuccess'));
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListGuardianAccountsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() }),
        ]);
        setPhone('');
        setPassword('');
        setFullName('');
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-[2rem] bg-card p-8 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">{t('usersPage.addAccountTitle')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('usersPage.addAccountDesc')}</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose} className="!p-2"><X /></Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block text-sm font-bold">{t('usersPage.accountType')}
            <select
              value={accountType}
              onChange={(event) => setAccountType(event.target.value as 'staff' | 'guardian')}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3"
            >
              <option value="staff">{t('usersPage.accountType.staff')}</option>
              <option value="guardian">{t('usersPage.accountType.guardian')}</option>
            </select>
          </label>

          <label className="block text-sm font-bold">{t('usersPage.phoneNumber')}
            <input
              required
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="96550001234"
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3"
            />
          </label>

          <label className="block text-sm font-bold">{t('usersPage.password')}
            <input
              required
              type="password"
              autoComplete="new-password"
              minLength={4}
              maxLength={15}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3"
            />
          </label>

          <label className="block text-sm font-bold">{t('usersPage.fullName')}
            <input
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3"
            />
          </label>

          {accountType === 'staff' && (
            <label className="block text-sm font-bold">{t('usersPage.staffRole')}
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3"
              >
                {accountRoleValues.map((item) => (
                  <option key={item} value={item}>{t(`staffAccounts.role.${item}` as never)}</option>
                ))}
              </select>
            </label>
          )}

          <Button type="submit" disabled={createAccount.isPending} className="w-full">
            {createAccount.isPending ? t('usersPage.creating') : t('usersPage.createAccount')}
          </Button>
        </form>

        {createAccount.isError && <p className="mt-4 text-sm font-medium text-destructive">{(createAccount.error as { data?: { error?: string } })?.data?.error || t('usersPage.createError')}</p>}
        {message && <p data-testid="text-create-account-result" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{message}</p>}
      </div>
    </div>
  );
}
