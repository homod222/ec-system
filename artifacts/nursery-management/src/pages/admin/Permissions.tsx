import { useEffect, useMemo, useState } from 'react';
import { useListRolePermissions, useSetRolePermission, getListRolePermissionsQueryKey, getListUserPermissionsQueryKey, useListPermissionPrincipals, useListUserPermissions, useSetUserPermission } from '@workspace/api-client-react';
import { Shell, Button, QueryState, PageHeader } from '../../App';
import { Search, ShieldCheck, Users, ChevronDown, Baby, FileText, Wallet, Images, Settings, BarChart3, UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useI18n, type TranslationKey } from '../../i18n';

const resourceName = (resource: string, t: (key: TranslationKey) => string) => {
  const key = `permissions.res.${resource}` as TranslationKey;
  const translated = t(key);
  if (translated !== key) return translated;
  return resource.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
};

type PermissionVerb = 'read' | 'write' | 'create' | 'update' | 'publish' | 'delete' | 'accept' | 'reorder';
const permissionVerbKeys: Record<PermissionVerb, TranslationKey> = {
  read: 'permissions.read', write: 'permissions.write', create: 'permissions.create',
  update: 'permissions.update', publish: 'permissions.publish', delete: 'permissions.delete',
  accept: 'permissions.accept', reorder: 'permissions.reorder',
};

const permissionRoleKeys: Record<string, TranslationKey> = {
  admin: 'permissions.admin', manager: 'permissions.manager', supervisor: 'permissions.supervisor',
  teacher: 'permissions.teacher', accountant: 'permissions.accountant',
  receptionist: 'permissions.receptionist', parent: 'permissions.parent',
};

const isPermissionVerb = (verb: string): verb is PermissionVerb => verb in permissionVerbKeys;

function operationName(operation: string, t: (key: TranslationKey) => string) {
  const [verb, resource] = operation.split(':');
  const verbText = isPermissionVerb(verb) ? t(permissionVerbKeys[verb]) : (verb.charAt(0).toUpperCase() + verb.slice(1));
  return `${verbText} ${resourceName(resource || '', t)}`;
}

const roleName = (role: string, t: (key: TranslationKey) => string) => {
  const key = permissionRoleKeys[role];
  return key ? t(key) : role;
};

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

function GroupIcon({ group, t }: { group: string; t: (key: TranslationKey) => string }) {
  if (group === t('nav.children')) return <Baby size={18} className="text-primary/80" />;
  if (group === t('nav.reports')) return <BarChart3 size={18} className="text-primary/80" />;
  if (group === t('nav.finance')) return <Wallet size={18} className="text-primary/80" />;
  if (group === t('nav.applications')) return <FileText size={18} className="text-primary/80" />;
  if (group === t('nav.gallery')) return <Images size={18} className="text-primary/80" />;
  if (group === t('admin.settings')) return <Settings size={18} className="text-primary/80" />;
  return <ShieldCheck size={18} className="text-primary/80" />;
}

export function Permissions() {
  const { t, dir } = useI18n();
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
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListUserPermissionsQueryKey(userOverrideParams) });
        toast({ title: t('permissions.userSaved') });
      },
      onError: () => toast({ title: t('permissions.userSaveError'), variant: 'destructive' }),
    });
  };

  return <Shell>
    <PageHeader eyebrow={t('permissions.eyebrow')} title={t('permissions.title')} description={t('permissions.description')} />

    <div className="mb-8">
      <div className="mb-6 grid w-full grid-cols-2 rounded-xl border border-border/50 bg-muted/60 p-1 shadow-sm sm:inline-grid sm:w-auto">
        <button
          onClick={() => setSubjectType('role')}
          className={`flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-bold transition-all ${subjectType === 'role' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Users size={17} />
          {t('permissions.rolesTab')}
        </button>
        <button
          onClick={() => setSubjectType('user')}
          className={`flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-bold transition-all ${subjectType === 'user' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <UserRound size={17} />
          {t('permissions.usersTab')}
        </button>
      </div>

      {subjectType === 'role' && (
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide -mx-2 px-2 sm:mx-0 sm:px-0">
          {roles.map((role) => (
            <button
              key={role}
              onClick={() => setSelectedRole(role)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${selectedRole === role ? 'bg-primary text-primary-foreground shadow-md -translate-y-0.5' : 'bg-secondary/60 text-secondary-foreground hover:bg-secondary'}`}
            >
               <Users size={16} className={selectedRole === role ? 'text-primary-foreground/80' : 'text-secondary-foreground/60'} />
               {roleName(role, t)}
            </button>
          ))}
        </div>
      )}

      {subjectType === 'user' && (
        <div className="flex flex-col md:flex-row gap-5 bg-card border border-border/80 rounded-[1.5rem] p-5 sm:p-6 shadow-sm">
           <div className="flex-1 space-y-2.5">
             <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('permissions.user')}</label>
             <div className="flex flex-col sm:flex-row gap-3">
               <select
                 value={userId}
                 onChange={(e) => {
                   const principal = (principals.data || []).find((item) => item.userId === e.target.value);
                   setUserId(e.target.value);
                   if (principal) setBaselineRole(principal.role);
                 }}
                 className="flex-1 bg-background border border-input rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
               >
                 <option value="">{t('permissions.selectUser')}</option>
                 {(principals.data || []).map((principal) => <option key={principal.userId} value={principal.userId}>{principal.label}</option>)}
               </select>
               <input
                 value={userId}
                 onChange={(e) => setUserId(e.target.value)}
                 placeholder={t('permissions.selectUser')}
                 className="flex-1 bg-background border border-input rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
               />
             </div>
           </div>
           <div className="flex-1 space-y-2.5">
             <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t('permissions.inherited')}</label>
             <select
               required
               value={baselineRole}
               onChange={(e) => setBaselineRole(e.target.value)}
               className="w-full bg-background border border-input rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
             >
               {roles.map((role) => <option key={role} value={role}>{roleName(role, t)}</option>)}
             </select>
           </div>
        </div>
      )}
    </div>

    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
      <div className="relative flex-1 max-w-md">
         <Search className={`absolute ${dir === 'rtl' ? 'right-4' : 'left-4'} top-3.5 text-muted-foreground`} size={18} />
         <input
           value={search}
           onChange={(e) => setSearch(e.target.value)}
           placeholder={t('permissions.search')}
           className={`w-full rounded-xl border border-input bg-card shadow-sm py-3 ${dir === 'rtl' ? 'pr-11 pl-4' : 'pl-11 pr-4'} text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all`}
         />
      </div>
      <div className="inline-flex items-center gap-2 rounded-xl bg-[#e5efe9] px-4 py-2.5 text-sm font-bold text-[#165032] shadow-sm border border-[#165032]/10">
         <ShieldCheck size={18} />{t('permissions.allowed')} {allowedCount} / {rolePermissions.length}
      </div>
    </div>

    <QueryState loading={query.isLoading || userOverrides.isLoading} error={query.isError || userOverrides.isError} empty={!permissions.length} onRetry={() => query.refetch()}>
      <div className="space-y-4">
        {[...grouped.entries()].map(([group, items]) => (
          <details key={group} open className="group overflow-hidden rounded-[1.5rem] border border-border/80 bg-card shadow-sm transition-all open:shadow-md">
            <summary className="flex cursor-pointer select-none items-center justify-between bg-secondary/20 px-5 py-4 hover:bg-secondary/40 transition-colors sm:px-6">
              <div className="flex items-center gap-3">
                 <div className="grid h-8 w-8 place-items-center rounded-lg bg-background shadow-sm border border-border/50"><GroupIcon group={group} t={t} /></div>
                 <span className="font-bold text-foreground">{group}</span>
                 <span className="ml-2 rounded-md border border-border/50 bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground shadow-xs">
                   {items.filter((p) => p.allowed).length} / {items.length}
                 </span>
              </div>
              <ChevronDown className="text-muted-foreground transition-transform duration-300 group-open:-rotate-180" size={18} />
            </summary>

            <div className="divide-y divide-border/40">
              {items.map((permission) => (
                <div key={permission.operation} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/30 transition-colors sm:px-6">
                   <div className="flex-1 min-w-0 pr-4 rtl:pr-0 rtl:pl-4">
                     <p className="text-sm font-bold text-foreground truncate">{operationName(permission.operation, t)}</p>
                     <p dir="ltr" className="mt-1 text-left font-mono text-[10px] font-medium text-muted-foreground/70 truncate">{permission.operation}</p>
                   </div>

                   <div className="flex items-center gap-4 shrink-0">
                     {subjectType === 'user' && (
                       <span className={`hidden sm:inline-flex px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md ${permission.userOverride ? 'bg-[#fdf0d5] text-[#735010] border border-[#735010]/20' : 'bg-muted text-muted-foreground border border-border/50'}`}>
                         {permission.userOverride ? t('permissions.userOverride') : t('permissions.inherited')}
                       </span>
                     )}

                     <div className="flex items-center gap-2.5">
                       <span className={`text-[11px] font-bold uppercase tracking-wider w-12 text-end ${permission.allowed ? 'text-primary' : 'text-muted-foreground/60'}`}>
                         {permission.allowed ? t('permissions.allowed') : t('permissions.denied')}
                       </span>
                       <button
                         disabled={setPerm.isPending || setUserPerm.isPending}
                         aria-label={t('permissions.toggle', { operation: operationName(permission.operation, t) })}
                         onClick={() => subjectType === 'user' ? toggleUser(permission.operation, permission.allowed) : toggle(permission.operation, permission.allowed)}
                         className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${permission.allowed ? 'bg-primary justify-end' : 'bg-muted justify-start'} disabled:opacity-50`}
                       >
                         <span className="block h-5 w-5 rounded-full bg-card shadow-sm transition-transform duration-300" />
                       </button>
                     </div>
                   </div>
                </div>
              ))}
            </div>
          </details>
        ))}
        {!grouped.size && (
          <div className="flex flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-card p-14 text-center shadow-sm">
             <Search className="mb-4 text-muted-foreground/50" size={32} />
             <p className="font-bold text-muted-foreground">{t('permissions.matchingEmpty')}</p>
          </div>
        )}
      </div>
    </QueryState>
  </Shell>;
}
