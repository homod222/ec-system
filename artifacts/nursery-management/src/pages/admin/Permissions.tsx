import { useEffect, useMemo, useState } from 'react';
import { useListRolePermissions, useSetRolePermission, getListRolePermissionsQueryKey, getListUserPermissionsQueryKey, useListPermissionPrincipals, useListUserPermissions, useSetUserPermission } from '@workspace/api-client-react';
import { Shell, Button, QueryState, PageHeader } from '../../App';
import { Search, ShieldCheck, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useI18n, type TranslationKey } from '../../i18n';

const resourceName = (resource: string) => resource.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
type PermissionVerb = 'read' | 'write' | 'create' | 'update' | 'publish' | 'delete' | 'accept';
const permissionVerbKeys: Record<PermissionVerb, TranslationKey> = {
  read: 'permissions.read', write: 'permissions.write', create: 'permissions.create',
  update: 'permissions.update', publish: 'permissions.publish', delete: 'permissions.delete',
  accept: 'permissions.accept',
};
const permissionRoleKeys: Record<string, TranslationKey> = {
  admin: 'permissions.admin', manager: 'permissions.manager', supervisor: 'permissions.supervisor',
  teacher: 'permissions.teacher', accountant: 'permissions.accountant',
  receptionist: 'permissions.receptionist', parent: 'permissions.parent',
};
const isPermissionVerb = (verb: string): verb is PermissionVerb => verb in permissionVerbKeys;
function operationName(operation: string, t: (key: TranslationKey) => string) {
  const [verb, resource] = operation.split(':');
  return `${t(isPermissionVerb(verb) ? permissionVerbKeys[verb] : 'permissions.denied')} ${resourceName(resource || '')}`;
}
const roleName = (role: string, t: (key: TranslationKey) => string) => t(permissionRoleKeys[role] ?? 'permissions.role');
function groupName(operation: string, t: (key: TranslationKey) => string) {
  const resource = operation.split(':')[1] || '';
  if (resource.startsWith('child') || ['children', 'attendance'].includes(resource)) return t('nav.children');
  if (resource.includes('report')) return t('nav.reports');
  if (['invoice', 'payment', 'fee-plan', 'discount', 'refund', 'expense', 'revenue', 'payroll'].includes(resource)) return t('nav.finance');
  if (resource.includes('application')) return t('nav.applications');
  if (resource === 'site-gallery') return t('nav.gallery');
  if (['permissions', 'audit', 'setting', 'notification', 'integration', 'holiday'].includes(resource)) return t('admin.settings');
  return t('admin.management');
}

export function Permissions() {
  const { t } = useI18n();
  const query = useListRolePermissions();
  const permissions = query.data || [];
  const roles = Array.from(new Set(permissions.map((p) => p.role)));
  const [selectedRole, setSelectedRole] = useState('admin');
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [subjectType, setSubjectType] = useState<'role' | 'user'>('role');
  const [baselineRole, setBaselineRole] = useState('admin');
  useEffect(() => { if (roles.length && !roles.includes(selectedRole)) setSelectedRole(roles[0]); }, [roles, selectedRole]);
  const setPerm = useSetRolePermission();
  const setUserPerm = useSetUserPermission();
  const principals = useListPermissionPrincipals();
  const userOverrideParams = { userId: userId || '__none__' };
  const userOverrides = useListUserPermissions(userOverrideParams, { query: { queryKey: getListUserPermissionsQueryKey(userOverrideParams), enabled: subjectType === 'user' && Boolean(userId) } });
  const qc = useQueryClient();
  const { toast } = useToast();
  const subjectPermissions = subjectType === 'user'
    ? Array.from(new Map(permissions.filter((p) => p.role === baselineRole).map((p) => [p.operation, p])).values()).map((permission) => {
      const override = (userOverrides.data || []).find((row) => row.operation === permission.operation);
      return { ...permission, allowed: override?.allowed ?? permission.allowed, userOverride: override !== undefined };
    })
    : permissions.filter((p) => p.role === selectedRole).map((permission) => ({ ...permission, userOverride: false }));
  const grouped = useMemo(() => {
    const result = new Map<string, any[]>();
    subjectPermissions.filter((p) =>
       `${operationName(p.operation, t)} ${p.operation}`.toLowerCase().includes(search.trim().toLowerCase()),
    ).forEach((permission) => {
       const name = groupName(permission.operation, t);
      result.set(name, [...(result.get(name) || []), permission]);
    });
    return result;
  }, [subjectPermissions, search, t]);
  const rolePermissions = subjectPermissions;
  const allowedCount = rolePermissions.filter((p) => p.allowed).length;
  const toggle = (operation: string, allowed: boolean) => setPerm.mutate({
    data: { role: selectedRole, operation, allowed: !allowed },
  }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListRolePermissionsQueryKey() }); toast({ title: t('permissions.updated') }); },
    onError: () => toast({ title: t('permissions.updateError'), variant: 'destructive' }),
  });
  const toggleUser = (operation: string, allowed: boolean): void => {
    if (!userId.trim()) {
       toast({ title: t('permissions.selectUser'), variant: 'destructive' });
      return;
    }
    setUserPerm.mutate({ data: { userId: userId.trim(), operation, allowed: !allowed } }, {
      onSuccess: () => toast({ title: t('permissions.userSaved') }),
      onError: () => toast({ title: t('permissions.userSaveError'), variant: 'destructive' }),
    });
  };

  return <Shell>
    <PageHeader eyebrow={t('permissions.eyebrow')} title={t('permissions.title')} description={t('permissions.description')} />
    <div className="mb-6 flex flex-wrap gap-3">
       <Button variant={subjectType === 'role' ? 'primary' : 'soft'} onClick={() => setSubjectType('role')}>{t('permissions.role')}</Button>
       <Button variant={subjectType === 'user' ? 'primary' : 'soft'} onClick={() => setSubjectType('user')}>{t('permissions.user')}</Button>
      {subjectType === 'role' && roles.map((role) => <Button key={role} variant={selectedRole === role ? 'primary' : 'soft'} onClick={() => setSelectedRole(role)}>
         <Users size={17} />{roleName(role, t)}
      </Button>)}
    </div>
    {subjectType === 'user' && <div className="mb-5 rounded-2xl border border-border bg-card p-4"><label className="text-sm font-bold">{t('permissions.user')}: <select value={userId} onChange={(e) => { const principal = (principals.data || []).find((item) => item.userId === e.target.value); setUserId(e.target.value); if (principal) setBaselineRole(principal.role); }} className="rounded-lg border p-2"><option value="">{t('permissions.selectUser')}</option>{(principals.data || []).map((principal) => <option key={principal.userId} value={principal.userId}>{principal.label}</option>)}</select></label><input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder={t('permissions.selectUser')} className="ms-3 rounded-lg border p-2" /><label className="ms-3 text-sm font-bold">{t('permissions.role')}: <select required value={baselineRole} onChange={(e) => setBaselineRole(e.target.value)} className="rounded-lg border p-2">{roles.map((role) => <option key={role} value={role}>{roleName(role, t)}</option>)}</select></label><p className="mt-2 text-xs text-muted-foreground">{t('permissions.inherited')}</p></div>}
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center">
      <div className="relative flex-1"><Search className="absolute right-3 top-3 text-muted-foreground" size={18} />
         <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('permissions.search')} className="w-full rounded-xl border border-input bg-background py-2.5 ps-3 pe-10" />
      </div>
       <span className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary"><ShieldCheck size={17} />{t('permissions.allowed')} {allowedCount} / {rolePermissions.length}</span>
    </div>
    <QueryState loading={query.isLoading || userOverrides.isLoading} error={query.isError || userOverrides.isError} empty={!permissions.length} onRetry={() => query.refetch()}>
      <div className="space-y-4">
        {[...grouped.entries()].map(([group, items]) => <details key={group} open className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <summary className="cursor-pointer bg-secondary/30 px-6 py-4 font-bold">{group} <span className="mr-2 text-xs text-muted-foreground">({items.filter((p) => p.allowed).length}/{items.length})</span></summary>
          {items.map((permission) => <div key={permission.operation} className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
             <div><p className="font-bold">{operationName(permission.operation, t)}</p><p dir="ltr" className="mt-1 text-left font-mono text-[11px] text-muted-foreground">{permission.operation}</p>{subjectType === 'user' && <p className="text-xs text-muted-foreground">{permission.userOverride ? t('permissions.userOverride') : t('permissions.inherited')}</p>}</div>
             <div className="flex items-center gap-3"><button disabled={setPerm.isPending || setUserPerm.isPending} aria-label={t('permissions.toggle', { operation: operationName(permission.operation, t) })} onClick={() => subjectType === 'user' ? toggleUser(permission.operation, permission.allowed) : toggle(permission.operation, permission.allowed)}
              className={`relative inline-flex h-6 w-11 rounded-full ${permission.allowed ? 'bg-primary' : 'bg-muted'} disabled:opacity-50`}>
              <span className={`block h-5 w-5 rounded-full bg-background shadow transition-transform ${permission.allowed ? '-translate-x-5' : 'translate-x-0'}`} />
             </button><span className="w-12 text-sm font-medium">{permission.allowed ? t('permissions.allowed') : t('permissions.denied')}</span></div>
          </div>)}
        </details>)}
         {!grouped.size && <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">{t('permissions.matchingEmpty')}</p>}
      </div>
    </QueryState>
  </Shell>;
}