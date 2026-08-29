import { useEffect, useMemo, useState, useRef } from 'react';
import {
  useListRolePermissions,
  getListRolePermissionsQueryKey,
  getListUserPermissionsQueryKey,
  useListPermissionPrincipals,
  useListUserPermissions,
  useGetPermissionCatalog,
  useBulkSetRolePermissions,
  useBulkSetUserPermissions
} from '@workspace/api-client-react';
import { Shell, Button, QueryState, PageHeader } from '../../App';
import { Search, ShieldCheck, Users, Baby, FileText, Wallet, Images, Settings, BarChart3, UserRound, Check, Minus, Save, RotateCcw, AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useI18n, type TranslationKey } from '../../i18n';

type CatalogGroup = {
  module: string;
  page: string;
  operations: string[];
};

type PermissionVerb = 'read' | 'write' | 'create' | 'update' | 'publish' | 'delete' | 'accept' | 'reorder';
const permissionVerbKeys: Record<PermissionVerb, TranslationKey> = {
  read: 'permissions.read', write: 'permissions.write', create: 'permissions.create',
  update: 'permissions.update', publish: 'permissions.publish', delete: 'permissions.delete',
  accept: 'permissions.accept', reorder: 'permissions.reorder',
};

const isPermissionVerb = (verb: string): verb is PermissionVerb => verb in permissionVerbKeys;
const immutableFullAccessRoles = new Set(['owner', 'superadmin', 'nursery_admin']);

function verbName(verb: string, t: (key: TranslationKey) => string) {
  return isPermissionVerb(verb) ? t(permissionVerbKeys[verb]) : (verb.charAt(0).toUpperCase() + verb.slice(1));
}

const roleName = (role: string, t: (key: TranslationKey) => string) => {
  const key = `permissions.${role}` as TranslationKey;
  const translated = t(key);
  if (translated !== key) return translated;
  return role;
};

function GroupIcon({ group, className }: { group: string; className?: string }) {
  if (group === 'organization') return <Settings size={18} className={className} />;
  if (group === 'people') return <Users size={18} className={className} />;
  if (group === 'attendance') return <UserRound size={18} className={className} />;
  if (group === 'academics') return <FileText size={18} className={className} />;
  if (group === 'communications') return <Images size={18} className={className} />;
  if (group === 'finance') return <Wallet size={18} className={className} />;
  if (group === 'reports') return <BarChart3 size={18} className={className} />;
  if (group === 'admissions') return <Baby size={18} className={className} />;
  if (group === 'website') return <Images size={18} className={className} />;
  if (group === 'security') return <ShieldCheck size={18} className={className} />;
  if (group === 'dashboard') return <BarChart3 size={18} className={className} />;
  return <ShieldCheck size={18} className={className} />;
}

// Action Chip supporting tri-state for user overrides
function ActionChip({
  label,
  value,
  isOverride,
  subjectType,
  onChange,
  onReset,
  resetTitle
}: {
  label: string;
  value: boolean;
  isOverride: boolean;
  subjectType: 'role' | 'user';
  onChange: (v: boolean) => void;
  onReset?: () => void;
  resetTitle?: string;
}) {
  return (
    <div className={`flex items-stretch rounded-lg border text-[11px] font-bold transition-all select-none
      ${subjectType === 'user' && isOverride ? (value ? 'border-[#735010]/30 bg-[#fdf0d5] text-[#735010]' : 'border-[#735010]/30 bg-muted/80 text-[#735010]/60') : (value ? 'bg-primary/10 border-primary/30 text-primary shadow-sm' : 'bg-background border-border/60 text-muted-foreground hover:bg-muted/60')}
    `}>
      <label className="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer flex-1">
        <input type="checkbox" className="hidden" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <div className={`flex items-center justify-center w-3.5 h-3.5 rounded-[4px] border transition-colors
          ${subjectType === 'user' && isOverride ? (value ? 'bg-[#735010] border-[#735010] text-[#fdf0d5]' : 'bg-muted border-input') : (value ? 'bg-primary border-primary text-primary-foreground' : 'bg-muted border-input')}
        `}>
          {value && <Check size={10} strokeWidth={3} />}
        </div>
        <span className="truncate">{label}</span>
      </label>

      {subjectType === 'user' && isOverride && onReset && (
        <button
          onClick={onReset}
          className="flex items-center justify-center px-1.5 border-l border-[#735010]/20 hover:bg-[#735010]/10 transition-colors"
          title={resetTitle}
        >
          <RotateCcw size={10} className="opacity-70" />
        </button>
      )}
    </div>
  );
}

// Header Checkbox
function HeaderCheckbox({
  label, checked, indeterminate, onChange, className = "", isOverride, onReset, subjectType, resetTitle
}: {
  label: string; checked: boolean; onChange: (c: boolean) => void; indeterminate?: boolean; className?: string; isOverride?: boolean; onReset?: () => void; subjectType: 'role' | 'user'; resetTitle?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = !!indeterminate;
  }, [indeterminate]);

  return (
    <div className={`flex items-stretch rounded-lg border transition-all select-none
      ${subjectType === 'user' && isOverride ? 'border-[#735010]/30 bg-[#fdf0d5]/50' : (checked || indeterminate ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card')}
      ${className}
    `}>
      <label className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs font-bold hover:bg-muted/50 rounded-lg flex-1
        ${subjectType === 'user' && isOverride ? 'text-[#735010]' : (checked || indeterminate ? 'text-primary' : 'text-muted-foreground')}
      `}>
        <input type="checkbox" className="hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} ref={inputRef} />
        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors
          ${subjectType === 'user' && isOverride ? (checked || indeterminate ? 'border-[#735010] bg-[#735010] text-[#fdf0d5]' : 'border-[#735010]/50 bg-background') : (checked ? 'border-primary bg-primary text-primary-foreground' : indeterminate ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background')}
        `}>
          {checked && <Check size={12} strokeWidth={3} />}
          {!checked && indeterminate && <Minus size={12} strokeWidth={3} />}
        </div>
        {label}
      </label>

      {subjectType === 'user' && isOverride && onReset && (
        <button
          onClick={onReset}
          className="flex items-center justify-center px-2 border-l border-[#735010]/20 hover:bg-[#735010]/10 transition-colors rounded-r-lg"
          title={resetTitle}
        >
          <RotateCcw size={12} className="text-[#735010]/70" />
        </button>
      )}
    </div>
  );
}

export function Permissions() {
  const { t, dir } = useI18n();
  const catalogQuery = useGetPermissionCatalog();
  const roleQuery = useListRolePermissions();

  const permissions = roleQuery.data || [];
  const catalog = catalogQuery.data || [];

  const roles = Array.from(new Set(permissions.map((p) => p.role)));

  const [selectedRole, setSelectedRole] = useState('admin');
  const [userId, setUserId] = useState('');
  const [subjectType, setSubjectType] = useState<'role' | 'user'>('role');
  const [search, setSearch] = useState('');
  const [activeModule, setActiveModule] = useState<string | null>(null);

  useEffect(() => { if (roles.length && !roles.includes(selectedRole)) setSelectedRole(roles[0]); }, [roles, selectedRole]);

  const principals = useListPermissionPrincipals();
  const principalObj = (principals.data || []).find((item) => item.userId === userId);
  const baselineRole = principalObj?.role || 'admin';

  const userOverrideParams = { userId: userId || '__none__' };
  const userOverrides = useListUserPermissions(userOverrideParams, { query: { queryKey: getListUserPermissionsQueryKey(userOverrideParams), enabled: subjectType === 'user' && Boolean(userId) } });

  const qc = useQueryClient();
  const { toast } = useToast();

  const bulkSetRole = useBulkSetRolePermissions();
  const bulkSetUser = useBulkSetUserPermissions();

  // draftRolePerms: Map<operation, boolean>
  const [draftRolePerms, setDraftRolePerms] = useState<Record<string, boolean>>({});
  // draftUserPerms: Map<operation, boolean | null>
  const [draftUserPerms, setDraftUserPerms] = useState<Record<string, boolean | null>>({});

  // Reset drafts on subject change
  const subjectKey = subjectType === 'role' ? `role:${selectedRole}` : `user:${userId}`;
  const lastSubjectKey = useRef('');

  useEffect(() => {
    if (lastSubjectKey.current !== subjectKey && catalog.length > 0 && permissions.length > 0) {
      if (subjectType === 'user' && (!userId || userOverrides.isFetching)) return;

      const newRoleDraft: Record<string, boolean> = {};
      const newUserDraft: Record<string, boolean | null> = {};

      const rolePerms = permissions.filter(p => p.role === selectedRole);
      const overrides = userOverrides.data || [];

      catalog.forEach(group => {
        group.operations.forEach(op => {
          if (subjectType === 'role') {
            newRoleDraft[op] = rolePerms.find(p => p.operation === op)?.allowed ?? false;
          } else {
            const ov = overrides.find(p => p.operation === op);
            newUserDraft[op] = ov ? ov.allowed : null;
          }
        });
      });

      if (subjectType === 'role') setDraftRolePerms(newRoleDraft);
      else setDraftUserPerms(newUserDraft);

      lastSubjectKey.current = subjectKey;
    }
  }, [subjectKey, catalog, permissions, subjectType, selectedRole, userId, userOverrides.data, userOverrides.isFetching]);

  // Derived state for the UI
  const getOpState = (op: string) => {
    if (subjectType === 'role') {
      return { allowed: !!draftRolePerms[op], isOverride: false };
    } else {
      const draft = draftUserPerms[op];
      const isOverride = draft !== null && draft !== undefined;
      const inheritedVal = immutableFullAccessRoles.has(baselineRole)
        ? true
        : permissions.find(p => p.role === baselineRole && p.operation === op)?.allowed ?? false;
      return {
        allowed: isOverride ? draft : inheritedVal,
        isOverride,
        inheritedVal
      };
    }
  };

  const toggleOp = (op: string, allowed: boolean) => {
    if (subjectType === 'role') {
      setDraftRolePerms(prev => ({ ...prev, [op]: allowed }));
    } else {
      setDraftUserPerms(prev => ({ ...prev, [op]: allowed }));
    }
  };

  const resetOp = (op: string) => {
    if (subjectType === 'user') {
      setDraftUserPerms(prev => ({ ...prev, [op]: null }));
    }
  };

  const getModuleState = (module: string) => {
    let total = 0, allowed = 0, overrides = 0;
    const groups = catalog.filter(g => g.module === module);
    groups.forEach(g => {
      g.operations.forEach(op => {
        total++;
        const state = getOpState(op);
        if (state.allowed) allowed++;
        if (state.isOverride) overrides++;
      });
    });
    return { checked: total > 0 && allowed === total, indeterminate: allowed > 0 && allowed < total, allowed, total, hasOverrides: overrides > 0 };
  };

  const getPageState = (group: CatalogGroup) => {
    const total = group.operations.length;
    let allowed = 0, overrides = 0;
    group.operations.forEach((op: string) => {
      const state = getOpState(op);
      if (state.allowed) allowed++;
      if (state.isOverride) overrides++;
    });
    return { checked: total > 0 && allowed === total, indeterminate: allowed > 0 && allowed < total, allowed, total, hasOverrides: overrides > 0 };
  };

  // Bulk actions
  const setPageAll = (group: CatalogGroup, allowed: boolean) => {
    group.operations.forEach((op) => toggleOp(op, allowed));
  };

  const resetPage = (group: CatalogGroup) => {
    group.operations.forEach((op) => resetOp(op));
  };

  const setModuleAll = (moduleName: string, allowed: boolean) => {
    catalog.filter(g => g.module === moduleName).forEach(g => {
      g.operations.forEach(op => toggleOp(op, allowed));
    });
  };

  const resetModule = (moduleName: string) => {
    catalog.filter(g => g.module === moduleName).forEach(g => {
      g.operations.forEach(op => resetOp(op));
    });
  };

  const setGlobalAll = (allowed: boolean) => {
    catalog.forEach(g => g.operations.forEach(op => toggleOp(op, allowed)));
  };

  const resetGlobal = () => {
    catalog.forEach(g => g.operations.forEach(op => resetOp(op)));
  };

  const discardDraft = () => {
    const nextRoleDraft: Record<string, boolean> = {};
    const nextUserDraft: Record<string, boolean | null> = {};
    const selectedRolePermissions = permissions.filter((permission) => permission.role === selectedRole);
    const overrides = userOverrides.data || [];

    catalog.forEach((group) => {
      group.operations.forEach((operation) => {
        nextRoleDraft[operation] = selectedRolePermissions.find((permission) => permission.operation === operation)?.allowed ?? false;
        const override = overrides.find((permission) => permission.operation === operation);
        nextUserDraft[operation] = override ? override.allowed : null;
      });
    });

    if (subjectType === 'role') setDraftRolePerms(nextRoleDraft);
    else setDraftUserPerms(nextUserDraft);
  };

  // Sections processing
  const modules = Array.from(new Set(catalog.map(g => g.module)));

  useEffect(() => {
    if (modules.length > 0 && (!activeModule || !modules.includes(activeModule))) {
      setActiveModule(modules[0]);
    }
  }, [modules, activeModule]);

  const filteredModules = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return modules;
    return modules.filter(m => {
      const modName = t(`permissions.module.${m}` as TranslationKey).toLowerCase();
      if (modName.includes(term)) return true;
      const groups = catalog.filter(g => g.module === m);
      return groups.some(g => {
        const pName = t(`permissions.page.${g.page}` as TranslationKey).toLowerCase();
        if (pName.includes(term)) return true;
        return g.operations.some(op => {
          const v = op.split(':')[0];
          return verbName(v, t).toLowerCase().includes(term);
        });
      });
    });
  }, [modules, search, catalog, t]);

  const activeGroups = useMemo(() => {
    let groups = catalog.filter(g => g.module === activeModule);
    const term = search.trim().toLowerCase();
    if (term) {
      groups = groups.filter(g => {
        const pName = t(`permissions.page.${g.page}` as TranslationKey).toLowerCase();
        if (pName.includes(term)) return true;
        return g.operations.some(op => verbName(op.split(':')[0], t).toLowerCase().includes(term));
      });
    }
    return groups;
  }, [activeModule, catalog, search, t]);

  useEffect(() => {
    if (search.trim() && filteredModules.length > 0 && !filteredModules.includes(activeModule || '')) {
      setActiveModule(filteredModules[0]);
    }
  }, [activeModule, filteredModules, search]);

  // Dirty state tracking
  let dirtyCount = 0;
  if (subjectType === 'role') {
    const rolePerms = permissions.filter(p => p.role === selectedRole);
    Object.entries(draftRolePerms).forEach(([op, allowed]) => {
      const orig = rolePerms.find(p => p.operation === op)?.allowed ?? false;
      if (orig !== allowed) dirtyCount++;
    });
  } else {
    const overrides = userOverrides.data || [];
    Object.entries(draftUserPerms).forEach(([op, allowed]) => {
      const ov = overrides.find(p => p.operation === op);
      const origAllowed = ov ? ov.allowed : null;
      if (origAllowed !== allowed) dirtyCount++;
    });
  }

  const handleSaveBulk = () => {
    if (subjectType === 'role') {
      const changes = Object.entries(draftRolePerms).map(([op, allowed]) => ({ role: selectedRole, operation: op, allowed })).filter(c => {
        const orig = permissions.find(p => p.role === selectedRole && p.operation === c.operation)?.allowed ?? false;
        return orig !== c.allowed;
      });
      if (!changes.length) return;

      bulkSetRole.mutate({ data: { changes } }, {
        onSuccess: async () => {
          toast({ title: t('settings.saveSuccess') });
          lastSubjectKey.current = '';
          await qc.invalidateQueries({ queryKey: getListRolePermissionsQueryKey() });
        },
        onError: () => toast({ title: t('error.title'), variant: 'destructive' })
      });
    } else {
      if (!userId) {
        toast({ title: t('permissions.selectUser'), variant: 'destructive' });
        return;
      }
      const changes = Object.entries(draftUserPerms).map(([op, allowed]) => ({ operation: op, allowed })).filter(c => {
        const ov = (userOverrides.data || []).find(p => p.operation === c.operation);
        const origAllowed = ov ? ov.allowed : null;
        return origAllowed !== c.allowed;
      });
      if (!changes.length) return;

      bulkSetUser.mutate({ data: { userId, changes } }, {
        onSuccess: async () => {
          toast({ title: t('settings.saveSuccess') });
          lastSubjectKey.current = '';
          await qc.invalidateQueries({ queryKey: getListUserPermissionsQueryKey(userOverrideParams) });
        },
        onError: () => toast({ title: t('error.title'), variant: 'destructive' })
      });
    }
  };

  const isGlobalAllChecked = catalog.length > 0 && catalog.every(g => g.operations.every(op => getOpState(op).allowed));
  const hasAnyOverrides = catalog.some(g => g.operations.some(op => getOpState(op).isOverride));
  const allOperations = catalog.flatMap((group) => group.operations);
  const totalAllowed = allOperations.filter((operation) => getOpState(operation).allowed).length;

  return (
    <Shell>
      <PageHeader eyebrow={t('permissions.eyebrow')} title={t('permissions.title')} description={t('permissions.description')} />

      <div className="mb-6 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-start">
        <div className="flex w-full rounded-2xl border border-border/50 bg-muted/30 p-1.5 shadow-sm lg:w-auto h-auto lg:h-[60px]">
          <button
            onClick={() => setSubjectType('role')}
            className={`flex-1 lg:flex-none flex items-center justify-center gap-2.5 rounded-xl px-8 py-2.5 text-sm font-bold transition-all ${subjectType === 'role' ? 'bg-card text-primary shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Users size={18} />
            {t('permissions.rolesTab')}
          </button>
          <button
            onClick={() => setSubjectType('user')}
            className={`flex-1 lg:flex-none flex items-center justify-center gap-2.5 rounded-xl px-8 py-2.5 text-sm font-bold transition-all ${subjectType === 'user' ? 'bg-card text-primary shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <UserRound size={18} />
            {t('permissions.usersTab')}
          </button>
        </div>

        <div className="flex-1 rounded-[1.5rem] border border-border/80 bg-card p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row gap-4 sm:items-center w-full min-h-[60px] overflow-hidden">
          {subjectType === 'role' ? (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-2 px-2 sm:mx-0 sm:px-0 w-full items-center">
              <ShieldCheck size={20} className="text-primary shrink-0 mr-2 rtl:ml-2 rtl:mr-0 hidden sm:block" />
              <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest shrink-0 mr-4 rtl:ml-4 rtl:mr-0 hidden sm:block">
                {t('permissions.role')}
              </span>
              {roles.map((role) => (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all border ${selectedRole === role ? 'bg-primary border-primary text-primary-foreground shadow-md' : 'bg-background border-border hover:bg-muted text-foreground'}`}
                >
                   {roleName(role, t)}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4 w-full items-center">
               <div className="flex-1 w-full space-y-1.5">
                 <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('permissions.user')}</label>
                  <div className="flex gap-2">
                   <select
                     value={userId}
                     onChange={(e) => setUserId(e.target.value)}
                     className="flex-1 bg-background border rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-primary transition-all shadow-sm"
                   >
                     <option value="">{t('permissions.selectUser')}</option>
                     {(principals.data || []).map((principal) => <option key={principal.userId} value={principal.userId}>{principal.label}</option>)}
                   </select>
                 </div>
               </div>
               <div className="flex-1 w-full space-y-1.5 sm:max-w-[250px]">
                 <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('permissions.inherited')}</label>
                 <div className="w-full bg-muted/50 text-muted-foreground border rounded-xl px-4 py-2.5 text-sm font-bold shadow-sm cursor-not-allowed flex items-center justify-between">
                   {roleName(baselineRole, t)}
                   <ShieldCheck size={16} className="opacity-50" />
                 </div>
               </div>
            </div>
          )}
        </div>
      </div>

      <div className="mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 rounded-[1.5rem] bg-card border border-border/80 shadow-sm">
        <div className="flex items-center flex-wrap gap-3 w-full md:w-auto">
          <HeaderCheckbox
            label={t('permissions.selectAll')}
            checked={isGlobalAllChecked}
            indeterminate={false}
            onChange={setGlobalAll}
            subjectType="role"
            className="px-1"
          />
          <button onClick={() => setGlobalAll(false)} className="text-xs font-bold bg-muted/50 border px-4 py-2 rounded-xl hover:bg-muted transition-colors">
            {t('permissions.deselectAll')}
          </button>

          {subjectType === 'user' && hasAnyOverrides && (
            <button onClick={resetGlobal} className="text-xs font-bold bg-[#fdf0d5] text-[#735010] border border-[#735010]/20 px-4 py-2 rounded-xl hover:bg-[#fdf0d5]/80 transition-colors flex items-center gap-2">
              <RotateCcw size={14} />
              {t('permissions.resetAll' as TranslationKey)}
            </button>
          )}
          <span className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-muted-foreground">
            {t('permissions.pagesCount', { count: catalog.length })}
          </span>
          <span className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-muted-foreground">
            {t('permissions.actionsCount', { count: totalAllowed })} / {allOperations.length}
          </span>
          {dirtyCount > 0 && (
            <span className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-700">
              <AlertCircle size={14} />
              {t('permissions.dirtySummary', { count: dirtyCount })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          {dirtyCount > 0 && (
            <Button variant="soft" onClick={discardDraft} disabled={bulkSetRole.isPending || bulkSetUser.isPending} className="rounded-xl px-5">
              {t('common.cancel')}
            </Button>
          )}
          <Button
            onClick={handleSaveBulk}
            disabled={dirtyCount === 0 || bulkSetRole.isPending || bulkSetUser.isPending}
            className="ml-auto rtl:ml-0 rtl:mr-auto rounded-xl shadow-sm px-6"
          >
            {bulkSetRole.isPending || bulkSetUser.isPending ? <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2 rtl:ml-2 rtl:mr-0" /> : <Save className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />}
            {t('permissions.saveBulk')}
            {dirtyCount > 0 && <span className="ml-2 rtl:mr-2 rtl:ml-0 bg-background/20 px-1.5 py-0.5 rounded text-[10px]">{dirtyCount}</span>}
          </Button>
        </div>
      </div>

      <QueryState loading={catalogQuery.isLoading || roleQuery.isLoading || userOverrides.isLoading} error={catalogQuery.isError || roleQuery.isError || userOverrides.isError} empty={!catalog.length} onRetry={() => catalogQuery.refetch()}>
        <div className="flex flex-col lg:flex-row gap-6 items-stretch">

          <div className="w-full lg:w-[320px] shrink-0 flex flex-col gap-4 order-first">
            <div className="relative">
              <Search className={`absolute ${dir === 'rtl' ? 'right-4' : 'left-4'} top-3.5 text-muted-foreground`} size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('permissions.searchMenu')}
                className={`w-full rounded-2xl border border-input bg-card shadow-sm py-3 ${dir === 'rtl' ? 'pr-11 pl-4' : 'pl-11 pr-4'} text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all`}
              />
            </div>

            <div className="flex-1 lg:max-h-[800px] overflow-y-auto space-y-1.5 pr-2 rtl:pl-2 rtl:pr-0 pb-4 scrollbar-hide">
              {filteredModules.map(m => {
                const state = getModuleState(m);
                const isActive = activeModule === m;
                return (
                  <button key={m} onClick={() => setActiveModule(m)} className={`w-full flex items-center justify-between p-3.5 rounded-2xl transition-all border ${isActive ? 'bg-primary/5 border-primary/20 text-primary font-bold shadow-sm' : 'bg-card border-border hover:bg-muted/50 text-foreground'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`grid h-8 w-8 place-items-center rounded-xl shadow-xs border ${isActive ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-primary/80'}`}>
                         <GroupIcon group={m} className={isActive ? 'text-primary-foreground' : 'text-primary/80'} />
                      </div>
                      <span className="truncate">{t(`permissions.module.${m}` as TranslationKey)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                       {state.hasOverrides && <AlertCircle size={14} className="text-[#735010]" />}
                       {state.checked && !state.hasOverrides && <Check size={14} className="text-primary" />}
                       <span className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${isActive ? 'bg-primary/10 border-primary/20' : 'bg-background border-border shadow-xs text-muted-foreground'}`}>
                         {state.allowed}/{state.total}
                       </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-card rounded-[1.5rem] border border-border/80 shadow-sm overflow-hidden min-h-[500px]">
             {activeModule ? (
               <>
                <div className="p-5 border-b bg-muted/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="flex items-center gap-4">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-background shadow-sm border text-primary">
                      <GroupIcon group={activeModule} className="text-primary/80" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">{t(`permissions.module.${activeModule}` as TranslationKey)}</h3>
                      <p className="text-xs text-muted-foreground font-medium mt-0.5">
                        {getModuleState(activeModule).allowed} / {getModuleState(activeModule).total} {t('permissions.allowed')}
                      </p>
                    </div>
                  </div>
                  <HeaderCheckbox
                    label={t('permissions.selectAllSection')}
                    checked={getModuleState(activeModule).checked}
                    indeterminate={getModuleState(activeModule).indeterminate}
                    onChange={(c) => setModuleAll(activeModule, c)}
                    subjectType={subjectType}
                    isOverride={getModuleState(activeModule).hasOverrides}
                    onReset={() => resetModule(activeModule)}
                    resetTitle={t('permissions.resetSection' as TranslationKey)}
                    className="shadow-sm"
                  />
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-5 grid grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-5 content-start bg-secondary/20">
                  {activeGroups.map(group => {
                     const pageState = getPageState(group);
                     const pName = t(`permissions.page.${group.page}` as TranslationKey);
                     return (
                       <div key={group.page} className={`bg-card border rounded-[1.25rem] shadow-sm overflow-hidden flex flex-col transition-colors
                         ${subjectType === 'user' && pageState.hasOverrides ? 'border-[#735010]/30 hover:border-[#735010]/50' : 'border-border/80 hover:border-primary/30'}
                       `}>
                         <div className={`p-4 border-b flex items-center justify-between gap-4 ${subjectType === 'user' && pageState.hasOverrides ? 'bg-[#fdf0d5]/30' : 'bg-muted/20'}`}>
                           <div className="flex-1 min-w-0 flex items-center gap-2">
                             <h4 className={`font-bold text-sm truncate ${subjectType === 'user' && pageState.hasOverrides ? 'text-[#735010]' : 'text-foreground'}`}>{pName}</h4>
                              {subjectType === 'user' && pageState.hasOverrides && <span className="bg-[#fdf0d5] text-[#735010] text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold border border-[#735010]/20 shrink-0">{t('permissions.userOverride')}</span>}
                           </div>
                           <HeaderCheckbox
                             label={t('permissions.viewPage')}
                             checked={pageState.checked}
                             indeterminate={pageState.indeterminate}
                             onChange={(c) => setPageAll(group, c)}
                             subjectType={subjectType}
                             isOverride={pageState.hasOverrides}
                             onReset={() => resetPage(group)}
                             resetTitle={t('permissions.reset' as TranslationKey)}
                             className="bg-background shrink-0"
                           />
                         </div>

                         {group.operations.length > 0 && (
                           <div className="p-4 flex flex-col gap-4">
                             <div className="flex flex-wrap gap-2.5">
                               {group.operations.map(op => {
                                 const state = getOpState(op);
                                 const vName = verbName(op.split(':')[0], t);
                                 return (
                                   <ActionChip
                                     key={op}
                                     label={vName}
                                     value={state.allowed}
                                     isOverride={state.isOverride}
                                     subjectType={subjectType}
                                     onChange={(c) => toggleOp(op, c)}
                                     onReset={() => resetOp(op)}
                                     resetTitle={t('permissions.reset' as TranslationKey)}
                                   />
                                 );
                               })}
                             </div>
                           </div>
                         )}
                       </div>
                     );
                  })}

                  {activeGroups.length === 0 && (
                    <div className="col-span-full py-16 flex flex-col items-center justify-center text-muted-foreground bg-background/50 rounded-2xl border border-dashed border-border/80">
                      <Search size={36} className="mb-4 opacity-30" />
                      <p className="font-bold">{t('permissions.matchingEmpty')}</p>
                    </div>
                  )}
                </div>
               </>
             ) : (
               <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                  <Search className="w-16 h-16 text-muted-foreground/20 mb-4" />
                  <h3 className="text-lg font-bold text-muted-foreground">{t('permissions.noSelection')}</h3>
               </div>
             )}
          </div>
        </div>
      </QueryState>
    </Shell>
  );
}