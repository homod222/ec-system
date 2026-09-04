import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity as ActivityIcon, ArrowUpRight, Baby, BarChart3, Bell, BookOpen,
  CalendarCheck, Check, ChevronLeft, ChevronRight, CircleAlert, CircleDollarSign, Clock3, Contact,
  Building2, FileText, GraduationCap, KeyRound, LayoutDashboard, LogOut, Menu, MoreHorizontal,
  Phone, Plus, ScrollText, Search, Settings as SettingsIcon, ShieldCheck, Sparkles, TrendingUp, UserCog, Users, Wallet, X, Images,
} from 'lucide-react';
import {
  getGetChildQueryKey, getListChildrenQueryKey,
  getGetSessionContextQueryKey,
  getGetDashboardActivityQueryKey, getGetDashboardSummaryQueryKey, getListClassroomsQueryKey,
  getGetApplicationQueryKey, getListApplicationsQueryKey,
  getListBranchesQueryKey,
  useAcceptApplication, useAttachApplicationDocument, useCreateApplication, useGetApplication, useRequestUploadUrl,
  useCreateChild, useGetChild, useGetDashboardActivity, useGetDashboardSummary, useGetSessionContext, useListChildren,
  useListClassrooms, useListGuardians, useListApplications, useListBranches, useUpdateApplication, useUpdateApplicationStatus, useUpdateChild,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Landing } from './pages/Landing';
import type { Application, ApplicationInput, Child } from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';
import { ParentOverview } from './pages/parent/ParentOverview';
import { ParentAttendance } from './pages/parent/ParentAttendance';
import { ParentReports } from './pages/parent/ParentReports';
import { ParentActivities } from './pages/parent/ParentActivities';
import { ParentInvoices } from './pages/parent/ParentInvoices';
import { ParentMessages } from './pages/parent/ParentMessages';
import { ChildProfileExpanded } from './pages/admin/ChildProfileExpanded';
import { ClassroomsExpanded } from './pages/admin/ClassroomsExpanded';
import { AttendanceExpanded } from './pages/admin/AttendanceExpanded';
import { StaffExpanded } from './pages/admin/StaffExpanded';
import { StaffPasswordReset } from './pages/StaffPasswordReset';
import FinanceExpanded from './pages/admin/FinanceExpanded';
import { Education } from './pages/admin/Education';
import { Activities } from './pages/admin/Activities';
import { Reports } from './pages/admin/Reports';
import { Permissions } from './pages/admin/Permissions';
import { Users as UsersPage } from './pages/admin/Users';
import { Settings } from './pages/admin/Settings';
import { Audit } from './pages/admin/Audit';
import { SiteGallery } from './pages/admin/SiteGallery';
import { Organizations } from './pages/admin/Organizations';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n, type Locale, type TranslationKey } from '@/i18n';
import {
  AuthApiError,
  listRegistrationBranches,
  requestRegistration,
  signInWithPassword,
  verifyRegistration,
  type AuthTokenResponse,
  type RegistrationAccountType,
} from '@/lib/auth-api';
import { AuthProvider, useAuth, type AuthUser } from '@/lib/auth-context';
import { setAuthTokenGetter, setBranchIdGetter } from '@workspace/api-client-react';
import { getStoredToken } from '@/lib/auth-context';
import { BranchSelect, branchIdPayload } from './components/BranchSelect';
import { BranchTreeSelect, type BranchTreeSelectSource } from './components/BranchTreeSelect';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// Wire up the generated API client to include the JWT on every request
setAuthTokenGetter(() => getStoredToken());
setBranchIdGetter(() => localStorage.getItem('ec.selectedBranchId'));

// Read permissions required to see each admin page (any one of them grants access).
const pagePermissions = {
  dashboard: ['read:dashboard'],
  applications: ['read:application'],
  children: ['read:children'],
  attendance: ['read:attendance'],
  classrooms: ['read:classroom-schedule'],
  guardians: ['read:children'],
  staff: ['read:staff-profile'],
  education: ['read:curriculum', 'read:lesson-plan', 'read:skill', 'read:assessment', 'read:progress-report'],
  activities: ['read:event', 'read:media', 'read:notification'],
  finance: ['read:fee-plan', 'read:discount', 'read:invoice', 'read:refund', 'read:expense', 'read:revenue', 'read:payroll'],
  reports: ['read:report-operational', 'read:report-academic', 'read:report-financial'],
  audit: ['read:audit'],
  permissions: ['read:permissions'],
  users: ['read:users'],
  gallery: ['read:site-gallery'],
  settings: ['read:setting', 'read:holiday', 'read:integration'],
  organizations: ['read:organization', 'read:branch'],
} satisfies Record<string, readonly string[]>;

const hasAnyPermission = (effective: readonly string[] | undefined, required?: readonly string[]) =>
  !required || required.some((p) => effective?.includes(p));

const navGroups = [
  {
    label: 'nav.group.daily',
    items: [
      { href: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard, permission: pagePermissions.dashboard },
      { href: '/applications', label: 'nav.applications', icon: FileText, permission: pagePermissions.applications },
      { href: '/attendance', label: 'nav.attendance', icon: CalendarCheck, permission: pagePermissions.attendance },
    ],
  },
  {
    label: 'nav.group.people',
    items: [
      { href: '/children', label: 'nav.children', icon: Baby, permission: pagePermissions.children },
      { href: '/guardians', label: 'nav.guardians', icon: Contact, permission: pagePermissions.guardians },
      { href: '/staff', label: 'nav.staff', icon: GraduationCap, permission: pagePermissions.staff },
    ],
  },
  {
    label: 'nav.group.learning',
    items: [
      { href: '/classrooms', label: 'nav.classrooms', icon: BookOpen, permission: pagePermissions.classrooms },
      { href: '/education', label: 'nav.education', icon: Sparkles, permission: pagePermissions.education },
      { href: '/activities', label: 'nav.activities', icon: ActivityIcon, permission: pagePermissions.activities },
      { href: '/site-gallery', label: 'nav.gallery', icon: Images, permission: pagePermissions.gallery },
    ],
  },
  {
    label: 'nav.group.finance',
    items: [
      { href: '/finance', label: 'nav.finance', icon: Wallet, permission: pagePermissions.finance },
      { href: '/reports', label: 'nav.reports', icon: BarChart3, permission: pagePermissions.reports },
    ],
  },
  {
    label: 'nav.group.system',
    items: [
      { href: '/organizations', label: 'nav.organizations', icon: Building2, permission: pagePermissions.organizations },
      { href: '/users', label: 'nav.users', icon: UserCog, permission: pagePermissions.users },
      { href: '/permissions', label: 'nav.permissions', icon: KeyRound, permission: pagePermissions.permissions },
      { href: '/audit', label: 'nav.audit', icon: ScrollText, permission: pagePermissions.audit },
    ],
  },
] as Array<{ label: TranslationKey; items: Array<{ href: string; label: TranslationKey; icon: typeof LayoutDashboard; permission?: readonly string[] }> }>;

const navItems = navGroups.flatMap((group) => group.items);

const fallbackPath = (effective?: readonly string[]) =>
  navItems.find((item) => hasAnyPermission(effective, item.permission))?.href ?? '/access-pending';

const activeLocale = (locale?: Locale) => locale ?? (document.documentElement.lang === 'en' ? 'en' : 'ar');
export const formatAppDate = (value: Date | string | number, locale?: Locale, options: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat(activeLocale(locale) === 'ar' ? 'ar-KW' : 'en-KW', { timeZone: 'Asia/Kuwait', weekday: 'long', day: 'numeric', month: 'long', ...options }).format(value instanceof Date ? value : new Date(value));
export const arDate = { format: (value: Date | string | number) => formatAppDate(value) };
export const money = (n: number, locale?: Locale) => new Intl.NumberFormat(activeLocale(locale) === 'ar' ? 'ar-KW' : 'en-KW', {
  style: 'currency',
  currency: 'KWD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
}).format(n || 0);
const initials = (name: string) => name.split(' ').slice(0, 2).map((s) => s[0]).join('');
const today = new Date().toISOString().slice(0, 10);
// These are persisted API values, not localized display text.
const DEFAULT_ACADEMIC_LEVEL = 'تمهيدي';
const academicLevelOptions = [
  { value: DEFAULT_ACADEMIC_LEVEL, label: 'application.level' },
  { value: 'KG1', label: 'application.kg1' },
  { value: 'KG2', label: 'application.kg2' },
] satisfies Array<{ value: string; label: TranslationKey }>;

export function Button({ children, className = '', variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'danger' }) {
  const variants = {
    primary: 'bg-primary text-primary-foreground hover:-translate-y-0.5 hover:shadow-md',
    soft: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${variants[variant]} disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

export function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'green' | 'yellow' | 'red' | 'blue' | 'neutral' }) {
  const colors = { 
    green: 'bg-[#e5efe9] text-[#165032]', 
    yellow: 'bg-accent/40 text-[#5a4220]', 
    red: 'bg-[#fbeaea] text-[#a02c2c]', 
    blue: 'bg-sky-100 text-sky-800', 
    neutral: 'bg-muted text-muted-foreground' 
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${colors[tone]}`}>{children}</span>;
}

export function Avatar({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground ${className}`}>{initials(name)}</span>;
}

function BranchScopeSwitcher({
  branches,
  fullAccess,
  selectedBranchIds,
  selectedOrganizationIds,
  onChange,
}: {
  branches: Array<{ id: number; name: string; code: string; organizationId: number }>;
  fullAccess: boolean;
  selectedBranchIds: string;
  selectedOrganizationIds: number[];
  onChange: (value: { organizationIds: number[]; branchIds: number[] }) => void;
}) {
  const { t } = useI18n();
  if (!fullAccess && branches.length === 0) {
    return <span data-testid="text-branch-scope" className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground">{t('admin.noAssignedBranch')}</span>;
  }
  if (!fullAccess && branches.length === 1) {
    return <span data-testid="text-branch-scope" className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground">{branches[0].name}</span>;
  }
  return (
    <div className="min-w-0">
      <span className="sr-only">{t('admin.currentBranch')}</span>
      <BranchTreeSelect
        mode="multi"
        value={{
          organizationIds: selectedOrganizationIds,
          branchIds: selectedBranchIds.split(',').filter(Boolean).map(Number),
        }}
        onChange={onChange}
        allowAll={fullAccess || branches.length > 1}
        allLabel={t('admin.allBranches')}
        testId="select-branch-scope"
        compact
      />
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />; 
}

export function QueryState({ loading, error, empty, children, onRetry }: { loading?: boolean; error?: boolean; empty?: boolean; children: React.ReactNode; onRetry?: () => void }) {
  const { t } = useI18n();
  if (loading) return <div className="space-y-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  if (error) return <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-destructive/30 bg-destructive/5 p-12 text-center"><CircleAlert className="mb-4 text-destructive" size={32} /><p className="font-bold text-destructive">{t('query.errorTitle')}</p><p className="mt-2 text-sm text-destructive/70">{t('query.errorBody')}</p><Button variant="danger" className="mt-5" onClick={onRetry}>{t('common.retry')}</Button></div>;
  if (empty) return <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card p-14 text-center"><Sparkles className="mb-4 text-accent" size={32} /><p className="font-bold">{t('query.emptyTitle')}</p><p className="mt-2 text-sm text-muted-foreground">{t('query.emptyBody')}</p></div>;
  return <>{children}</>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { user, isSignedIn, signOut } = useAuth();
  const { dir, t } = useI18n();
  const session = useGetSessionContext({ query: { enabled: Boolean(isSignedIn), queryKey: getGetSessionContextQueryKey(), retry: false } });
  const branches = useListBranches(undefined, {
    query: { enabled: Boolean(isSignedIn), queryKey: getListBranchesQueryKey(), retry: false },
    request: { headers: { 'x-branch-id': '' } },
  });
  const [selectedBranchIds, setSelectedBranchIds] = useState(() => localStorage.getItem('ec.selectedBranchId') || '');
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<number[]>([]);
  const selectionHydrated = useRef(false);
  const branchScope = session.data?.branchScope;
  const availableBranches = branches.data || [];

  useEffect(() => {
    if (branches.data === undefined) return;
    const selectedIds = selectedBranchIds.split(',').filter(Boolean).map(Number);
    const validIds = selectedIds.filter((id) => availableBranches.some((branch) => branch.id === id));
    if (validIds.length !== selectedIds.length) {
      const nextValue = validIds.join(',');
      if (nextValue) localStorage.setItem('ec.selectedBranchId', nextValue);
      else localStorage.removeItem('ec.selectedBranchId');
      setSelectedBranchIds(nextValue);
      queryClient.invalidateQueries();
    }
    if (!selectionHydrated.current) {
      const organizationIds = availableBranches
        .reduce<number[]>((ids, branch, _index, allBranches) => {
          if (ids.includes(branch.organizationId)) return ids;
          const organizationBranches = allBranches.filter((candidate) => candidate.organizationId === branch.organizationId);
          if (organizationBranches.length > 0 && organizationBranches.every((candidate) => validIds.includes(candidate.id))) {
            ids.push(branch.organizationId);
          }
          return ids;
        }, []);
      setSelectedOrganizationIds(organizationIds);
      selectionHydrated.current = true;
    }
  }, [availableBranches, branches.data, selectedBranchIds]);

  const handleBranchChange = ({ organizationIds, branchIds }: { organizationIds: number[]; branchIds: number[] }) => {
    const expandedBranchIds = [
      ...branchIds,
      ...availableBranches
        .filter((branch) => organizationIds.includes(branch.organizationId))
        .map((branch) => branch.id),
    ];
    const value = [...new Set(expandedBranchIds)].join(',');
    if (value) localStorage.setItem('ec.selectedBranchId', value);
    else localStorage.removeItem('ec.selectedBranchId');
    setSelectedBranchIds(value);
    setSelectedOrganizationIds(organizationIds);
    queryClient.invalidateQueries();
  };
  const effectivePermissions = session.data?.effectivePermissions;
  const visibleNavGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => hasAnyPermission(effectivePermissions, item.permission)) }))
    .filter((group) => group.items.length > 0);
  const canSeeSettings = hasAnyPermission(effectivePermissions, pagePermissions.settings);
  
  return (
    <div className="app-noise min-h-[100dvh] bg-background selection:bg-primary/20" dir={dir}>
      <aside className={`fixed inset-y-0 z-40 flex w-[280px] flex-col bg-sidebar px-5 py-6 text-sidebar-foreground shadow-2xl transition-transform duration-300 lg:translate-x-0 ${dir === 'rtl' ? `right-0 ${open ? 'translate-x-0' : 'translate-x-full'}` : `left-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}`}>
        <div className="mb-4 flex items-center gap-3 px-1">
          <img src={`${basePath}/ec-official-logo-v2.png`} alt={t('admin.brand')} className="h-12 w-12 shrink-0 rounded-xl bg-white/95 p-1 object-contain shadow-sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-sidebar-foreground">{t('admin.brand')}</p>
            <p className="mt-0.5 truncate text-xs font-medium text-sidebar-primary">{t('admin.bilingual')}</p>
          </div>
          <button data-testid="button-close-menu" className="ms-auto rounded-xl p-2 text-sidebar-foreground/60 hover:bg-sidebar-accent lg:hidden" onClick={() => setOpen(false)}><X size={20} /></button>
        </div>

        <nav aria-label={t('admin.management')} className="min-h-0 flex-1 space-y-4 overflow-y-auto sidebar-scroll sidebar-fade pt-1 pb-1">
          {visibleNavGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[.14em] text-sidebar-foreground/40">{t(group.label)}</p>
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = location === href || location.startsWith(`${href}/`);
                return (
                  <Link key={href} href={href} data-testid={`link-nav-${href.slice(1)}`} onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-bold transition-colors ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}>
                    <Icon size={18} className="shrink-0" />
                    <span className="truncate">{t(label)}</span>
                    {href === '/attendance' && <span className="ms-auto shrink-0 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">{t('admin.today')}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        
        <div className="mt-auto space-y-1 pt-3 border-t border-sidebar-border">
          <LanguageSwitcher inverted className="mb-2 w-full justify-center py-1.5" />
          {canSeeSettings && <Link href="/settings" data-testid="link-nav-settings" className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors ${location.startsWith('/settings') ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}><SettingsIcon size={18} />{t('admin.settings')}</Link>}
          <button data-testid="button-sign-out" onClick={() => { signOut(); window.location.assign(basePath || '/'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"><LogOut size={18} />{t('admin.signOut')}</button>
        </div>
      </aside>
      
      {open && <button aria-label={t('common.close')} data-testid="button-overlay-menu" className="fixed inset-0 z-30 bg-primary/30 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}
      
      <main className={`min-h-[100dvh] ${dir === 'rtl' ? 'lg:mr-[280px]' : 'lg:ml-[280px]'}`}>
        <header className="sticky top-0 z-20 flex h-[80px] items-center justify-between border-b border-border/60 bg-background/80 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            <button data-testid="button-open-menu" className="rounded-xl border border-border bg-card p-2.5 text-foreground lg:hidden" onClick={() => setOpen(true)}><Menu size={20} /></button>
            <div className="hidden items-center gap-2 text-xs font-bold text-muted-foreground sm:flex">
               <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-soft" /> {t('admin.systemHealthy')}
            </div>
            <BranchScopeSwitcher
              branches={availableBranches}
              fullAccess={branchScope?.fullAccess ?? false}
              selectedBranchIds={selectedBranchIds}
              selectedOrganizationIds={selectedOrganizationIds}
              onChange={handleBranchChange}
            />
          </div>
          <div className="flex items-center gap-4">
             <button data-testid="button-notifications" title={t('admin.notifications')} onClick={() => window.alert(t('admin.noNotifications'))} className="relative rounded-xl border border-border bg-card p-2.5 text-muted-foreground hover:text-foreground transition-colors">
              <Bell size={18} />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive border-2 border-card" />
            </button>
            <div className="hidden text-start sm:block">
               <p data-testid="text-user-name" className="text-sm font-bold text-foreground">{user?.firstName?.split(/\s+/u)[0] || t('admin.defaultUser')}</p>
               <p className="text-[11px] font-medium text-muted-foreground">{t('admin.seniorManagement')}</p>
            </div>
             <img
               src={`${basePath}/ec-official-logo-v2.png`}
               alt={t('admin.brand')}
               data-testid="image-admin-mobile-logo"
               className="h-11 w-11 rounded-lg bg-white object-contain p-1 shadow-sm sm:hidden"
             />
             <Avatar name={user?.firstName?.split(/\s+/u)[0] || t('admin.defaultUser')} className="hidden bg-primary text-primary-foreground sm:inline-flex" />
          </div>
        </header>
        <div className="mx-auto max-w-[1500px] p-5 sm:p-8 lg:p-10 animate-rise">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 text-xs font-bold tracking-[.15em] text-primary/60">{eyebrow || t('admin.brand')}</p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h1>
        {description && <p className="mt-2.5 text-sm text-muted-foreground max-w-lg leading-relaxed">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, detail, tone = 'teal' }: { icon: typeof Users; label: string; value: string; detail?: string; tone?: 'teal' | 'gold' | 'coral' | 'sage' }) {
  const tones = { 
    teal: 'bg-primary text-primary-foreground', 
    gold: 'bg-accent text-accent-foreground', 
    coral: 'bg-[#fbeaea] text-[#a02c2c]', 
    sage: 'bg-[#e5efe9] text-[#165032]' 
  };
  return (
    <div className="group rounded-[1.5rem] border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
      <div className="mb-5 flex items-start justify-between">
        <span className={`grid h-12 w-12 place-items-center rounded-2xl ${tones[tone]} transition-transform group-hover:scale-110`}>
          <Icon size={22} />
        </span>
        {detail && <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">{detail}</span>}
      </div>
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p data-testid={`stat-${label}`} className="mt-1.5 text-3xl font-bold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function Dashboard() {
  const { t, formatDate, formatCurrency } = useI18n();
  const { user } = useAuth();
  const summary = useGetDashboardSummary();
  const activity = useGetDashboardActivity();
  const data = summary.data;
  const activities = activity.data || [];
  const greetingKey = new Date().getHours() >= 12 ? 'dashboard.greetingEvening' : 'dashboard.greetingMorning';
  const firstName = user?.firstName?.trim().split(/\s+/u)[0] || t('admin.defaultUser');
  const greeting = t(greetingKey, { name: firstName });
  
  return (
    <Shell>
      <PageHeader 
        eyebrow={formatDate(new Date(), { weekday: 'long' })}
        title={greeting}
        description={t('dashboard.description')}
        action={<Button data-testid="button-dashboard-report" variant="soft" onClick={() => window.print()}><FileText size={17} />{t('dashboard.todayReport')} <ArrowUpRight size={15} /></Button>}
      />
      
      <QueryState loading={summary.isLoading} error={summary.isError} onRetry={() => summary.refetch()}>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Baby} label={t('dashboard.totalChildren')} value={`${data?.totalChildren ?? 0}`} detail={t('dashboard.thisMonth')} tone="teal" />
          <StatCard icon={CalendarCheck} label={t('dashboard.presentToday')} value={`${data?.presentToday ?? 0}`} detail={t('dashboard.attendanceDetail', { rate: data?.attendanceRate ?? 0 })} tone="sage" />
          <StatCard icon={Users} label={t('dashboard.staffToday')} value={`${data?.staffCount ?? 0}`} detail={t('dashboard.organized')} tone="gold" />
          <StatCard icon={CircleDollarSign} label={t('dashboard.monthRevenue')} value={formatCurrency(data?.monthlyRevenue ?? 0)} detail={t('dashboard.pending', { count: data?.pendingPayments ?? 0 })} tone="coral" />
        </div>
      </QueryState>
      
      <div className="mt-8 grid gap-8 xl:grid-cols-[1.4fr_.6fr]">
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">{t('dashboard.liveAttendance')}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{t('dashboard.attendanceOverview')}</p>
            </div>
            <Link href="/attendance" data-testid="link-dashboard-attendance" className="text-sm font-bold text-primary hover:underline bg-primary/5 px-4 py-2 rounded-xl">
              {t('dashboard.openRegister')} <ChevronLeft className={`inline ${document.documentElement.dir === 'ltr' ? 'rotate-180' : ''}`} size={16} />
            </Link>
          </div>
          
          <div className="flex flex-col items-center gap-10 sm:flex-row">
            <div className="relative grid h-52 w-52 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(hsl(var(--primary)) ${(data?.attendanceRate || 0) * 3.6}deg, hsl(var(--muted)) 0)` }}>
              <div className="grid h-40 w-40 place-items-center rounded-full bg-card shadow-inner">
                <div className="text-center">
                  <p className="text-4xl font-bold text-foreground">{data?.attendanceRate ?? 0}%</p>
                   <p className="mt-1 text-xs font-bold text-muted-foreground">{t('dashboard.attendanceRate')}</p>
                </div>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-4">
              <div className="rounded-2xl bg-[#e5efe9] p-5">
                 <p className="mb-2 text-sm font-bold text-[#165032]">{t('dashboard.present')}</p>
                <p className="text-3xl font-bold text-[#165032]">{data?.presentToday ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-[#fbeaea] p-5">
                 <p className="mb-2 text-sm font-bold text-[#a02c2c]">{t('dashboard.absent')}</p>
                <p className="text-3xl font-bold text-[#a02c2c]">{data?.absentToday ?? 0}</p>
              </div>
              <div className="col-span-2 flex items-center gap-3 rounded-2xl border-2 border-dashed border-accent/40 bg-accent/10 p-4 text-sm font-medium text-foreground">
                 <CircleAlert size={18} className="text-accent-foreground" /> {t('dashboard.attendanceReminder')}
              </div>
            </div>
          </div>
        </section>
        
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
          <div className="mb-8 flex items-center justify-between">
            <div>
               <h2 className="text-xl font-bold text-foreground">{t('dashboard.latestActivities')}</h2>
               <p className="mt-1.5 text-sm text-muted-foreground">{t('dashboard.dailyUpdates')}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-muted-foreground"><ActivityIcon size={18} /></span>
          </div>
          
          <QueryState loading={activity.isLoading} error={activity.isError} empty={!activities.length} onRetry={() => activity.refetch()}>
            <div className="space-y-6">
              {activities.slice(0, 5).map((item) => (
                <div key={item.id} data-testid={`activity-${item.id}`} className="flex gap-4">
                  <span className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                    <ActivityIcon size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">{item.title}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.description}</p>
                     <p className="mt-1.5 font-mono text-[11px] font-bold text-primary/50">{formatDate(item.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </QueryState>
        </section>
      </div>
    </Shell>
  );
}

function ChildForm({ child, onClose }: { child?: Child; onClose: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ 
    firstName: child?.firstName || '', lastName: child?.lastName || '', 
    gender: child?.gender || 'female', birthDate: child?.birthDate || '', 
    guardianName: child?.guardianName || '', guardianPhone: child?.guardianPhone || '', 
    level: child?.level || DEFAULT_ACADEMIC_LEVEL, notes: child?.notes || '', classroomId: child?.classroomId?.toString() || '',
    branchId: child?.branchId?.toString() || '',
  });
  
  const classrooms = useListClassrooms();
  const create = useCreateChild();
  const update = useUpdateChild();
  const qc = useQueryClient();
  
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const handleBranchChange = (branchId: string) => setForm((current) => {
    const classroom = (classrooms.data || []).find((item) => String(item.id) === current.classroomId);
    const compatible = !branchId || !classroom || classroom.branchId == null || classroom.branchId === Number(branchId);
    return { ...current, branchId, classroomId: compatible ? current.classroomId : '' };
  });
  
  const submit = (e: React.FormEvent) => { 
    e.preventDefault(); 
    const payload = {
      ...form,
      classroomId: form.classroomId ? Number(form.classroomId) : null,
      branchId: branchIdPayload(form.branchId),
      notes: form.notes || null,
    } as any;
    if (child) {
      update.mutate({ id: child.id, data: payload }, { 
        onSuccess: () => { qc.invalidateQueries({ queryKey: getGetChildQueryKey(child.id) }); qc.invalidateQueries({ queryKey: getListChildrenQueryKey() }); onClose(); } 
      }); 
    } else {
      create.mutate({ data: payload }, { 
        onSuccess: () => { qc.invalidateQueries({ queryKey: getListChildrenQueryKey() }); onClose(); } 
      }); 
    }
  };
  
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md animate-in fade-in">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-border bg-card p-8 shadow-2xl animate-rise">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest text-primary/60">{t('expanded.childrenRegister')}</p>
            <h2 className="mt-2 text-2xl font-bold">{child ? t('common.edit') : t('expanded.addNewRecord')}</h2>
          </div>
          <button type="button" data-testid="button-close-child-form" onClick={onClose} className="rounded-xl bg-muted p-2.5 hover:bg-destructive hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="grid gap-5 sm:grid-cols-2">
          {[
            ['firstName',t('application.firstName')],['lastName',t('application.lastName')],
            ['birthDate',t('application.birthDate')],['guardianName',t('application.guardianName')],['guardianPhone',t('application.phone')]
          ].map(([key, label]) => (
            <label key={key} className="text-sm font-bold text-foreground">
              {label}
              <input required={key !== 'birthDate'} data-testid={`input-child-${key}`} type={key === 'birthDate' ? 'date' : key === 'guardianPhone' ? 'tel' : 'text'} 
                value={(form as any)[key]} onChange={(e) => set(key, e.target.value)} 
                className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
          ))}
          <label className="text-sm font-bold text-foreground">
            {t('application.gender')}
            <select data-testid="select-child-gender" value={form.gender} onChange={(e) => set('gender', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="female">{t('application.female')}</option><option value="male">{t('application.male')}</option>
            </select>
          </label>
          <label className="text-sm font-bold text-foreground">
            {t('application.level')}
            <select data-testid="select-child-level" value={form.level} onChange={(e) => set('level', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              {academicLevelOptions.map(({ value, label }) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-foreground">
            {t('application.classroom')}
            <select data-testid="select-child-classroom" value={form.classroomId} onChange={(e) => set('classroomId', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="">{t('application.unspecified')}</option>
              {(form.branchId === '' ? classrooms.data || [] : (classrooms.data || []).filter((c) => c.branchId == null || c.branchId === Number(form.branchId))).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <BranchSelect value={form.branchId} onChange={handleBranchChange} testId="select-child-branch" required={!child} />
        </div>
        
        <label className="mt-5 block text-sm font-bold text-foreground">
          {t('application.notes')}
          <textarea data-testid="input-child-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} 
            className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
        </label>
        
        <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button data-testid="button-submit-child" type="submit" disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? t('application.saving') : child ? t('application.saveChanges') : t('expanded.addRecord')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Children() {
  const { t } = useI18n();
  const [search, setSearch] = useState(''); 
  const [modal, setModal] = useState(false);
  const query = useListChildren(search ? { search } : undefined);
  const children = query.data || [];
  
  return (
    <Shell>
      <PageHeader eyebrow={t('expanded.childrenRegister')} title={t('nav.children')} description={t('expanded.contactsDesc')} action={<Button data-testid="button-add-child" onClick={() => setModal(true)}><Plus size={18} />{t('expanded.addRecord')}</Button>} />
      
      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search size={18} className="absolute right-4 top-3.5 text-muted-foreground" />
          <input data-testid="input-search-children" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('permissions.search')} className="w-full rounded-xl border border-border bg-card py-3.5 pr-12 pl-4 text-sm font-medium shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" />
        </div>
        <Button variant="soft" data-testid="button-filter-children" onClick={() => setSearch('')}>
          <BarChart3 size={17} />{t('common.all')}
        </Button>
      </div>
      
      <QueryState loading={query.isLoading} error={query.isError} empty={!children.length} onRetry={() => query.refetch()}>
        <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div className="hidden grid-cols-[1.6fr_1fr_1fr_1fr_.7fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
            <span>{t('expanded.child')}</span><span>{t('application.classroom')} / {t('application.level')}</span><span>{t('expanded.guardian')}</span><span>{t('dashboard.attendanceRate')}</span><span>{t('expanded.status')}</span>
          </div>
          {children.map((child) => (
            <Link href={`/children/${child.id}`} key={child.id} data-testid={`row-child-${child.id}`} className="grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[1.6fr_1fr_1fr_1fr_.7fr] md:items-center md:gap-4">
              <div className="flex items-center gap-4">
                <Avatar name={child.fullName} className="h-11 w-11" />
                <div>
                  <p className="font-bold text-foreground">{child.fullName}</p>
                  <p className="mt-0.5 text-xs font-medium text-muted-foreground">{child.gender === 'female' ? t('application.female') : t('application.male')} · {child.birthDate}</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">{child.classroomName || t('application.unspecified')}</p>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">{child.level}</p>
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">{child.guardianName}</p>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">{child.guardianPhone}</p>
              </div>
              <div>
                <div className="mb-2 flex justify-between text-xs font-bold">
                  <span>{child.attendanceRate}%</span>
                  <TrendingUp size={14} className="text-emerald-600" />
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${child.attendanceRate}%` }} />
                </div>
              </div>
              <div className="flex justify-end md:justify-start">
                <Pill tone={child.status === 'active' ? 'green' : child.status === 'pending' ? 'yellow' : 'neutral'}>
                  {child.status === 'active' ? t('expanded.regular') : child.status === 'pending' ? t('expanded.pending') : t('expanded.inactive')}
                </Pill>
              </div>
            </Link>
          ))}
        </div>
      </QueryState>
      
      {modal && <ChildForm onClose={() => setModal(false)} />}
    </Shell>
  );
}

function ArrowRightIcon() { return <ChevronRight size={18} className="rotate-180" />; }

const applicationStatuses = {
  new: { label: 'application.status.new', tone: 'blue' as const },
  reviewing: { label: 'application.status.reviewing', tone: 'yellow' as const },
  accepted: { label: 'application.status.accepted', tone: 'green' as const },
  rejected: { label: 'application.status.rejected', tone: 'red' as const },
};
function Guardians() {
  const { t, formatCurrency } = useI18n();
  const query = useListGuardians(); const guardians = query.data || [];
  return (
    <Shell>
      <PageHeader eyebrow={t('expanded.contactsTitle')} title={t('nav.guardians')} description={t('expanded.contactsDesc')} action={<Button variant="soft" data-testid="button-export-guardians"><FileText size={17} />{t('parent.download')}</Button>} />
      
      <div className="mb-8 grid gap-5 sm:grid-cols-3">
        <StatCard icon={Users} label={t('parent.enrolledChildren')} value={`${guardians.length}`} tone="teal" />
        <StatCard icon={Wallet} label={t('parent.outstandingBalance')} value={formatCurrency(guardians.reduce((s, g) => s + Math.max(g.balance, 0), 0))} tone="gold" />
        <StatCard icon={Phone} label={t('parent.messages')} value={`${guardians.filter((g) => g.phone).length}`} tone="sage" />
      </div>
      
      <QueryState loading={query.isLoading} error={query.isError} empty={!guardians.length} onRetry={() => query.refetch()}>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {guardians.map((g) => (
            <div key={g.id} data-testid={`card-guardian-${g.id}`} className="rounded-[1.5rem] border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <Avatar name={g.name} className="h-12 w-12" />
                  <div>
                    <h3 className="font-bold text-lg">{g.name}</h3>
                    <p className="text-xs font-bold text-primary mt-1 flex items-center gap-1"><Baby size={14}/> {t('parent.enrolledChildren')}: {g.childrenCount}</p>
                  </div>
                </div>
                <button data-testid={`button-guardian-menu-${g.id}`} className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"><MoreHorizontal size={20} /></button>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
                <div>
                  <p className="text-xs font-bold text-muted-foreground">{t('parent.outstandingBalance')}</p>
                  <p className={`mt-1.5 text-xl font-bold ${g.balance > 0 ? 'text-[#a02c2c]' : 'text-[#165032]'}`}>{formatCurrency(g.balance)}</p>
                </div>
                <Button variant="soft" data-testid={`button-call-guardian-${g.id}`} className="px-4 py-2 bg-secondary text-primary">
                  <Phone size={16} /> {t('parent.messages')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
    </Shell>
  );
}

function Protected({ children, allowedRole, permission }: { children: React.ReactNode, allowedRole?: 'parent' | 'admin', permission?: readonly string[] }) {
  const { isLoaded, isSignedIn } = useAuth(); 
  const [location] = useLocation();
  const session = useGetSessionContext({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getGetSessionContextQueryKey(),
      retry: false,
    },
  });

  if (!isLoaded || (isSignedIn && session.isLoading)) return <div className="grid min-h-[100dvh] place-items-center bg-background"><Skeleton className="h-32 w-32 rounded-3xl" /></div>;

  if (!isSignedIn) return <Redirect to="/" />;

  if (session.data) {
    const role = session.data.role;
    const isParentRole = role === 'parent';
    const isAdminRoute = location.startsWith('/dashboard') || location.startsWith('/children') || location.startsWith('/guardians') || location.startsWith('/classrooms') || location.startsWith('/staff') || location.startsWith('/finance') || location.startsWith('/education') || location.startsWith('/activities') || location.startsWith('/reports') || location.startsWith('/permissions') || location.startsWith('/users') || location.startsWith('/site-gallery') || location.startsWith('/settings') || location.startsWith('/audit') || location.startsWith('/applications') || location.startsWith('/organizations');
    const isParentRoute = location.startsWith('/parent');

    if (role === 'pending') {
      if (location === '/access-pending') return <>{children}</>;
      return <Redirect to="/access-pending" />;
    }
    if (allowedRole === 'admin' && isParentRole) {
      return <Redirect to="/parent" />;
    }
    if (allowedRole === 'parent' && !isParentRole) {
      return <Redirect to={fallbackPath(session.data.effectivePermissions)} />;
    }
    if (!hasAnyPermission(session.data.effectivePermissions, permission)) {
      return <Redirect to={fallbackPath(session.data.effectivePermissions)} />;
    }

    // Fallback protection if no allowedRole is specified but we are inside one of the main route branches
    if (isParentRole && isAdminRoute) {
       return <Redirect to="/parent" />;
    }
    if (!isParentRole && isParentRoute) {
       return <Redirect to="/dashboard" />;
    }
  }

  return <>{children}</>;
}

function AccessPending() {
  const { signOut } = useAuth();
  const { dir, t } = useI18n();
  return (
    <div dir={dir} className="grid min-h-[100dvh] place-items-center bg-background px-5">
      <div className="w-full max-w-lg rounded-[2rem] border border-border bg-card p-10 text-center shadow-xl">
        <ShieldCheck className="mx-auto mb-5 text-primary" size={42} />
        <h1 data-testid="text-access-pending-title" className="text-2xl font-bold text-foreground">{t('auth.pendingTitle')}</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{t('auth.pendingBody')}</p>
        <Button data-testid="button-access-pending-sign-out" className="mt-7" onClick={() => { signOut(); window.location.assign(basePath || '/'); }}>{t('admin.signOut')}</Button>
      </div>
    </div>
  );
}

function OwnerRecovery() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <div className="grid min-h-[100dvh] place-items-center bg-background"><Skeleton className="h-32 w-32 rounded-3xl" /></div>;
  }
  if (isSignedIn) {
    return <Redirect to="/dashboard" />;
  }
  return <Redirect to="/sign-in" />;
}

function normalizeKuwaitPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '').replace(/^965/, '');
  return /^[24569]\d{7}$/.test(digits) ? `+965${digits}` : null;
}

function routeForAuthResult(result: AuthTokenResponse): string {
  if (result.status === 'pending' || result.role === 'pending') return '/access-pending';
  if (result.accountType === 'guardian' || result.role === 'guardian' || result.role === 'parent') return '/parent';
  return '/dashboard';
}

function handleAuthResult(signIn: (token: string, user: AuthUser) => void, result: AuthTokenResponse) {
  signIn(result.token, {
    id: String(result.accountId),
    firstName: result.fullName?.split(/\s+/u)[0] || '',
    role: result.role || 'pending',
    ownerId: result.ownerId,
    accountType: result.accountType,
  });
  window.location.assign(`${basePath}${routeForAuthResult(result)}`);
}

function PhoneSignIn() {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedPhone = normalizeKuwaitPhone(phone);
    if (!normalizedPhone) {
      setError(t('auth.phoneInvalid'));
      return;
    }
    setBusy(true); setError('');
    try {
      const result = await signInWithPassword({ phone: normalizedPhone, password });
      handleAuthResult(signIn, result);
    } catch {
      setError(t('auth.signInError'));
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-[2rem] border border-border bg-card p-8 shadow-2xl">
      <div className="mb-7 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#25D366]/15 text-[#128C4A]"><Phone size={25} /></span>
        <h1 className="mt-4 text-2xl font-bold">{t('auth.passwordSignInTitle')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('auth.passwordSignInSubtitle')}</p>
      </div>
      <form onSubmit={submit} className="space-y-5">
        <label className="block text-sm font-bold">{t('auth.phone')}
          <div className="mt-2 flex overflow-hidden rounded-xl border border-input bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20" dir="ltr">
            <span className="grid place-items-center border-r border-input px-3 font-bold text-muted-foreground">+965</span>
            <input data-testid="input-login-phone" required inputMode="numeric" autoComplete="tel" value={phone}
              onChange={event => setPhone(event.target.value)} placeholder="5••• ••••"
              aria-describedby={error ? 'sign-in-error' : undefined}
              className="min-w-0 flex-1 bg-transparent px-4 py-3 text-left outline-none" />
          </div>
        </label>
        <label className="block text-sm font-bold">{t('auth.password')}
          <input data-testid="input-login-password" required type="password" autoComplete="current-password" value={password}
            onChange={event => setPassword(event.target.value)}
            className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </label>
        <Button data-testid="button-password-sign-in" className="w-full" disabled={busy}>{busy ? t('common.loading') : t('auth.signIn')}</Button>
      </form>
      {error && <p id="sign-in-error" role="alert" className="mt-4 text-center text-sm font-bold text-destructive">{error}</p>}
      <div className="mt-5 text-center text-sm text-muted-foreground">
        {t('auth.noAccount')} <Link href="/sign-up" className="font-bold text-primary hover:underline">{t('auth.signUp')}</Link>
      </div>
      <div className="mt-3 text-center">
        <Link href="/staff-password-reset" className="text-xs font-bold text-primary hover:underline">{t('passwordReset.forgot')}</Link>
      </div>
      <div className="mt-6 border-t border-border pt-5 text-center">
        <Link href="/owner-recovery" className="text-xs font-bold text-muted-foreground hover:text-primary">{t('auth.ownerRecovery')}</Link>
      </div>
    </div>
  );
}

function RegistrationForm() {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const [accountType, setAccountType] = useState<RegistrationAccountType>('guardian');
  const [branchId, setBranchId] = useState('');
  const [registrationSource, setRegistrationSource] = useState<BranchTreeSelectSource>({ organizations: [], branches: [] });
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    void listRegistrationBranches().then(setRegistrationSource).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const requestOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedPhone = normalizeKuwaitPhone(phone);
    if (fullName.trim().split(/\s+/).filter(Boolean).length < 3) {
      setError(t('auth.fullNameInvalid'));
      return;
    }
    if (!normalizedPhone) {
      setError(t('auth.phoneInvalid'));
      return;
    }
    if (registrationSource.branches.length > 0 && !branchId) {
      setError(t('auth.branchRequired'));
      return;
    }
    setBusy(true); setError('');
    try {
      const result = await requestRegistration({
        phone: normalizedPhone,
        fullName: fullName.trim(),
        email: email.trim(),
        accountType,
        branchId: branchId ? Number(branchId) : undefined,
      });
      if (!result.challengeId) throw new Error('Missing challenge');
      setChallengeId(result.challengeId);
      setResendCountdown(60);
    } catch {
      setError(t('auth.registrationRequestError'));
    } finally { setBusy(false); }
  };

  const completeRegistration = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 4 || password.length > 15) {
      setError(t('auth.passwordInvalid'));
      return;
    }
    if (password !== confirmation) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true); setError('');
    try {
      const result = await verifyRegistration({ challengeId, otp, password });
      handleAuthResult(signIn, result);
    } catch (error) {
      setError(error instanceof AuthApiError && error.code === 'password_policy'
        ? t('auth.passwordInvalid')
        : error instanceof AuthApiError && error.code === 'email_exists'
          ? t('auth.emailAlreadyRegistered')
          : t('auth.registrationVerifyError'));
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-[2rem] border border-border bg-card p-7 shadow-2xl sm:p-9">
      <div className="mb-7 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck size={26} /></span>
        <h1 className="mt-4 text-2xl font-bold">{t('auth.registrationTitle')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{challengeId ? t('auth.registrationVerifySubtitle') : t('auth.registrationSubtitle')}</p>
      </div>
      {!challengeId ? (
        <form onSubmit={requestOtp} className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-bold">{t('auth.accountType')}</legend>
            <div className="grid grid-cols-2 gap-3">
              {(['guardian', 'staff'] as const).map(type => (
                <label key={type} className={`cursor-pointer rounded-xl border p-3 text-center text-sm font-bold transition-colors ${accountType === type ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background'}`}>
                  <input className="sr-only" type="radio" name="accountType" value={type} checked={accountType === type} onChange={() => setAccountType(type)} />
                  {t(type === 'guardian' ? 'auth.guardian' : 'auth.staff')}
                </label>
              ))}
            </div>
          </fieldset>
          {registrationSource.branches.length > 0 && (
            <label className="block text-sm font-bold">{t('auth.branch')}
              <div className="mt-2">
                <BranchTreeSelect
                  mode="single"
                  value={branchId}
                  onChange={setBranchId}
                  source={registrationSource}
                  testId="registration-branch"
                  placeholder={t('branchTree.selectBranch')}
                  hideAll
                />
              </div>
            </label>
          )}
          <label className="block text-sm font-bold">{t('auth.fullName')}
            <input required autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)}
              aria-describedby="full-name-help" className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            <span id="full-name-help" className="mt-1 block text-xs font-normal text-muted-foreground">{t('auth.fullNameHelp')}</span>
          </label>
          <label className="block text-sm font-bold">{t('auth.email')}
            <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" dir="ltr" />
          </label>
          <label className="block text-sm font-bold">{t('auth.phone')}
            <div className="mt-2 flex overflow-hidden rounded-xl border border-input bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20" dir="ltr">
              <span className="grid place-items-center border-r border-input px-3 font-bold text-muted-foreground">+965</span>
              <input required inputMode="numeric" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)}
                placeholder="5••• ••••" className="min-w-0 flex-1 bg-transparent px-4 py-3 text-left outline-none" />
            </div>
          </label>
          <Button className="w-full" disabled={busy}>{busy ? t('common.loading') : t('auth.requestOtp')}</Button>
        </form>
      ) : (
        <form onSubmit={completeRegistration} className="space-y-4">
          <label className="block text-sm font-bold">{t('auth.otp')}
            <input required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
              onChange={event => setOtp(event.target.value.replace(/\D/g, ''))}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-center font-mono text-2xl tracking-[.45em] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" dir="ltr" />
          </label>
          <label className="block text-sm font-bold">{t('auth.password')}
            <input required minLength={4} maxLength={15} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </label>
          <label className="block text-sm font-bold">{t('auth.confirmPassword')}
            <input required minLength={4} maxLength={15} type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </label>
          <Button className="w-full" disabled={busy || otp.length !== 6}>{busy ? t('common.loading') : t('auth.completeRegistration')}</Button>
          <button type="button" disabled={busy || resendCountdown > 0} onClick={async () => {
            const normalizedPhone = normalizeKuwaitPhone(phone);
            if (!normalizedPhone) return;
            setBusy(true); setError('');
            try {
              const result = await requestRegistration({
                phone: normalizedPhone,
                fullName: fullName.trim(),
                email: email.trim(),
                accountType,
                branchId: branchId ? Number(branchId) : undefined,
              });
              if (result.challengeId) { setChallengeId(result.challengeId); setOtp(''); }
              setResendCountdown(60);
            } catch { setError(t('auth.resendOtpError')); } finally { setBusy(false); }
          }} className="w-full text-sm font-bold text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
            {resendCountdown > 0 ? t('auth.resendOtpCountdown', { seconds: String(resendCountdown) }) : t('auth.resendOtp')}
          </button>
          <button type="button" onClick={() => { setChallengeId(''); setOtp(''); setPassword(''); setConfirmation(''); setError(''); setResendCountdown(0); }} className="w-full text-sm font-bold text-primary hover:underline">{t('auth.changeDetails')}</button>
        </form>
      )}
      {error && <p role="alert" className="mt-4 text-center text-sm font-bold text-destructive">{error}</p>}
      <p className="mt-6 text-center text-sm text-muted-foreground">{t('auth.haveAccount')} <Link href="/sign-in" className="font-bold text-primary hover:underline">{t('auth.signIn')}</Link></p>
    </div>
  );
}

function AuthPage() {
  const { dir, t } = useI18n();
  return (
    <div dir={dir} className="grid min-h-[100dvh] place-items-center bg-ec-pattern px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-background/90 backdrop-blur-3xl" />
      <div className={`absolute top-4 z-10 sm:top-8 ${dir === 'rtl' ? 'right-5 sm:right-8' : 'left-5 sm:left-8'}`}>
        <Link href="/" data-testid="link-auth-logo" className="block hover:opacity-80 transition-opacity">
          <img src={`${basePath}/ec-official-logo-v2.png`} alt={t('admin.brand')} className="mx-auto h-20 w-24 object-contain drop-shadow-sm sm:h-28 sm:w-36" />
        </Link>
      </div>
      <div className={`absolute top-8 z-10 ${dir === 'rtl' ? 'left-8' : 'right-8'}`}>
        <LanguageSwitcher className="bg-card/95 shadow-sm backdrop-blur" />
      </div>
      <div className="relative z-10 w-full max-w-md animate-rise">
        <PhoneSignIn />
      </div>
    </div>
  ); 
}

function SignUpPage() {
  const { dir, t } = useI18n();
  return (
    <div dir={dir} className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-ec-pattern px-4 py-28 sm:py-12">
      <div className="absolute inset-0 bg-background/90 backdrop-blur-3xl" />
      <Link href="/" className={`absolute top-4 z-10 ${dir === 'rtl' ? 'right-5' : 'left-5'}`}>
        <img src={`${basePath}/ec-official-logo-v2.png`} alt={t('admin.brand')} className="h-20 w-24 object-contain" />
      </Link>
      <div className={`absolute top-8 z-10 ${dir === 'rtl' ? 'left-8' : 'right-8'}`}><LanguageSwitcher className="bg-card/95 shadow-sm" /></div>
      <main className="relative z-10 w-full max-w-lg animate-rise"><RegistrationForm /></main>
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) { 
  const [location] = useLocation(); 
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; 
}

function Router() { 
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/sign-in/*?" component={AuthPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/register/*?" component={SignUpPage} />
        <Route path="/staff-password-reset" component={StaffPasswordReset} />
        <Route path="/owner-recovery/*?" component={OwnerRecovery} />
        <Route path="/access-pending"><Protected><AccessPending /></Protected></Route>

        {/* Parent Portal Routes */}
        <Route path="/parent"><Protected allowedRole="parent"><ParentOverview /></Protected></Route>
        <Route path="/parent/attendance"><Protected allowedRole="parent"><ParentAttendance /></Protected></Route>
        <Route path="/parent/reports"><Protected allowedRole="parent"><ParentReports /></Protected></Route>
        <Route path="/parent/activities"><Protected allowedRole="parent"><ParentActivities /></Protected></Route>
        <Route path="/parent/invoices"><Protected allowedRole="parent"><ParentInvoices /></Protected></Route>
        <Route path="/parent/messages"><Protected allowedRole="parent"><ParentMessages /></Protected></Route>

        {/* Admin Routes */}
        <Route path="/dashboard"><Protected allowedRole="admin" permission={pagePermissions.dashboard}><Dashboard /></Protected></Route>
        <Route path="/applications"><Protected allowedRole="admin" permission={pagePermissions.applications}><Applications /></Protected></Route>
        <Route path="/applications/new"><Protected allowedRole="admin" permission={pagePermissions.applications}><NewApplication /></Protected></Route>
        <Route path="/applications/:id"><Protected allowedRole="admin" permission={pagePermissions.applications}><ApplicationDetail /></Protected></Route>
        <Route path="/children"><Protected allowedRole="admin" permission={pagePermissions.children}><Children /></Protected></Route>
        <Route path="/children/:id"><Protected allowedRole="admin" permission={pagePermissions.children}><ChildProfileExpanded /></Protected></Route>
        <Route path="/guardians"><Protected allowedRole="admin" permission={pagePermissions.guardians}><Guardians /></Protected></Route>
        <Route path="/classrooms"><Protected allowedRole="admin" permission={pagePermissions.classrooms}><ClassroomsExpanded /></Protected></Route>
        <Route path="/staff"><Protected allowedRole="admin" permission={pagePermissions.staff}><StaffExpanded /></Protected></Route>
        <Route path="/attendance"><Protected allowedRole="admin" permission={pagePermissions.attendance}><AttendanceExpanded /></Protected></Route>
        <Route path="/finance"><Protected allowedRole="admin" permission={pagePermissions.finance}><FinanceExpanded /></Protected></Route>
        <Route path="/education"><Protected allowedRole="admin" permission={pagePermissions.education}><Education /></Protected></Route>
        <Route path="/activities"><Protected allowedRole="admin" permission={pagePermissions.activities}><Activities /></Protected></Route>
        <Route path="/reports"><Protected allowedRole="admin" permission={pagePermissions.reports}><Reports /></Protected></Route>
        <Route path="/permissions"><Protected allowedRole="admin" permission={pagePermissions.permissions}><Permissions /></Protected></Route>
        <Route path="/users"><Protected allowedRole="admin" permission={pagePermissions.users}><UsersPage /></Protected></Route>
        <Route path="/site-gallery"><Protected allowedRole="admin" permission={pagePermissions.gallery}><SiteGallery /></Protected></Route>
        <Route path="/settings"><Protected allowedRole="admin" permission={pagePermissions.settings}><Settings /></Protected></Route>
        <Route path="/audit"><Protected allowedRole="admin" permission={pagePermissions.audit}><Audit /></Protected></Route>
        <Route path="/organizations"><Protected allowedRole="admin" permission={pagePermissions.organizations}><Organizations /></Protected></Route>
        <Route><Redirect to="/" /></Route>
      </Switch>
    </RoutedErrorBoundary>
  ); 
}

function App() { 
  return (
    <WouterRouter base={basePath}>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <Router />
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </WouterRouter>
  ); 
}
export default App;

function NewApplication() {
  const { t } = useI18n();
  return <Shell><Link href="/applications" data-testid="link-back-applications" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowRightIcon />{t('application.back')}</Link><PageHeader title={t('application.create')} description={t('application.createDesc')} /><ApplicationEditor /></Shell>;
}

function Applications() {
  const { t, formatDate } = useI18n();
  const [status, setStatus] = useState<ApplicationStatusFilter>('all');
  const query = useListApplications(status === 'all' ? undefined : { status });
  const applications = query.data || [];
  return <Shell><PageHeader eyebrow={t('application.eyebrow')} title={t('application.listTitle')} description={t('application.listDesc')} action={<Link href="/applications/new" data-testid="link-create-application" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm"><Plus size={17} />{t('application.new')}</Link>} />
    <div className="mb-5 flex gap-2 overflow-x-auto pb-1">{([['all', 'common.all'],['new', 'application.status.new'],['reviewing', 'application.status.reviewing'],['accepted', 'application.status.accepted'],['rejected', 'application.status.rejected']] as const).map(([value, label]) => <button key={value} data-testid={`button-filter-applications-${value}`} onClick={() => setStatus(value)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${status === value ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground hover:bg-muted'}`}>{t(label)}</button>)}</div>
    <QueryState loading={query.isLoading} error={query.isError} empty={!applications.length} onRetry={() => query.refetch()}><div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">{applications.map((application) => <Link href={`/applications/${application.id}`} key={application.id} data-testid={`row-application-${application.id}`} className="grid gap-3 border-b border-border p-5 last:border-0 hover:bg-muted/40 sm:grid-cols-[1.4fr_.8fr_1fr_.7fr] sm:items-center"><div className="flex items-center gap-3"><Avatar name={`${application.firstName} ${application.lastName}`} /><div><p data-testid={`text-application-name-${application.id}`} className="font-bold">{application.firstName} {application.lastName}</p><p className="text-xs text-muted-foreground">{t('application.number', { id: application.id })} · {formatDate(application.createdAt)}</p></div></div><Pill tone={application.type === 'renewal' ? 'yellow' : 'blue'}>{application.type === 'renewal' ? t('application.renewal') : t('application.newEnrollment')}</Pill><div><p className="text-sm font-semibold">{application.guardianName}</p><p className="text-xs text-muted-foreground">{application.guardianPhone}</p></div><span data-testid={`status-application-${application.id}`}><Pill tone={applicationStatuses[application.status].tone}>{t(`application.status.${application.status}` as TranslationKey)}</Pill></span></Link>)}</div></QueryState>
  </Shell>;
}

function ApplicationDetail() {
  const { t, formatDate, formatNumber } = useI18n();
  const [, params] = useRoute('/applications/:id'); const id = Number(params?.id);
  const query = useGetApplication(id); const application = query.data;
  const [file, setFile] = useState<File | null>(null); const [message, setMessage] = useState(''); const [uploadProgress, setUploadProgress] = useState(0); const [isUploading, setIsUploading] = useState(false);
  const attach = useAttachApplicationDocument(); const requestUploadUrl = useRequestUploadUrl(); const statusMutation = useUpdateApplicationStatus(); const accept = useAcceptApplication();
  const qc = useQueryClient();
  const maxDocumentSize = 10 * 1024 * 1024;
  const allowedDocumentTypes = new Set([
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]);
  const refresh = () => { qc.invalidateQueries({ queryKey: getGetApplicationQueryKey(id) }); qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() }); };
  const moveStatus = (status: 'reviewing' | 'rejected') => { setMessage(''); statusMutation.mutate({ id, data: { status } }, { onSuccess: () => { refresh(); setMessage(status === 'reviewing' ? t('application.reviewMoved') : t('application.rejected')); }, onError: () => setMessage(t('application.statusError')) }); };
  const putFile = (uploadUrl: string, document: File) => new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    request.setRequestHeader('Content-Type', document.type || 'application/octet-stream');
    request.upload.onprogress = (event) => { if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Upload failed (${request.status})`));
    request.onerror = () => reject(new Error('Upload failed'));
    request.send(document);
  });
  const recordDocument = async () => {
    if (!file) return;
    if (!allowedDocumentTypes.has(file.type.toLowerCase()) || file.size < 1 || file.size > maxDocumentSize) {
      setMessage(t('application.invalidFile'));
      setFile(null);
      return;
    }
    setMessage(''); setUploadProgress(0); setIsUploading(true);
    try {
      const uploaded = await requestUploadUrl.mutateAsync({ data: { applicationId: id, name: file.name, size: file.size, contentType: file.type } });
      await putFile(uploaded.uploadUrl, file);
      await attach.mutateAsync({ id, data: { name: file.name, contentType: file.type || 'application/octet-stream', size: file.size, objectPath: uploaded.objectPath } });
      refresh(); setFile(null); setMessage(t('application.uploaded', { name: file.name }));
    } catch {
      setMessage(t('application.uploadError'));
    } finally {
      setIsUploading(false);
    }
  };
  if (query.isLoading) return <Shell><Skeleton className="h-12 w-48" /><Skeleton className="mt-6 h-96 w-full" /></Shell>;
  if (query.isError || !application) return <Shell><QueryState error onRetry={() => query.refetch()}>{null}</QueryState></Shell>;
  const status = applicationStatuses[application.status];
  return <Shell><Link href="/applications" data-testid="link-back-applications" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowRightIcon />{t('application.back')}</Link>
    <div className="mb-6 rounded-3xl bg-primary p-6 text-primary-foreground shadow-lg"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div><div className="flex flex-wrap items-center gap-3"><h1 data-testid="text-application-title" className="text-3xl font-bold">{application.firstName} {application.lastName}</h1><Pill tone={status.tone}>{t(status.label as TranslationKey)}</Pill><Pill tone={application.type === 'renewal' ? 'yellow' : 'blue'}>{application.type === 'renewal' ? t('application.renewal') : t('application.newEnrollment')}</Pill></div><p className="mt-2 text-sm text-primary-foreground/65">{t('application.number', { id: application.id })} · {t('application.updated', { date: formatDate(application.updatedAt) })}</p></div><div className="flex flex-wrap gap-2">{application.status === 'new' && <Button variant="soft" data-testid="button-review-application" disabled={statusMutation.isPending} onClick={() => moveStatus('reviewing')}><Clock3 size={16} />{t('application.review')}</Button>}{application.status !== 'accepted' && application.status !== 'rejected' && <Button variant="danger" data-testid="button-reject-application" disabled={statusMutation.isPending} onClick={() => moveStatus('rejected')}><X size={16} />{t('application.reject')}</Button>}{application.status === 'reviewing' && <Button variant="soft" data-testid="button-accept-application" disabled={accept.isPending} onClick={() => accept.mutate({ id }, { onSuccess: (accepted) => { refresh(); qc.invalidateQueries({ queryKey: getListChildrenQueryKey() }); if (accepted.childId) qc.invalidateQueries({ queryKey: getGetChildQueryKey(accepted.childId) }); setMessage(t('application.accepted')); }, onError: (error) => setMessage((error as { status?: number }).status === 409 ? t('application.fullClass') : t('application.acceptError')) })}><Check size={16} />{accept.isPending ? t('application.activating') : t('application.accept')}</Button>}</div></div></div>
    {message && <p data-testid="status-application-action" className="mb-5 rounded-xl border border-border bg-card p-3 text-sm font-semibold">{message}</p>}
    {application.status === 'accepted' && application.childId && <Link href={`/children/${application.childId}`} data-testid="link-activated-child" className="mb-6 flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900"><span className="flex items-center gap-2"><Check size={18} />{t('application.childActivated', { id: application.childId })}</span><span className="text-sm">{t('application.openChild')} <ChevronLeft className="inline" size={16} /></span></Link>}
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]"><ApplicationEditor key={application.updatedAt} application={application} /><section className="rounded-2xl border border-border bg-card p-6 shadow-sm"><h2 className="text-lg font-bold">{t('application.documents')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('application.documentsDesc')}</p><label className="mt-5 block cursor-pointer rounded-xl border border-dashed border-primary/30 bg-muted/40 p-5 text-center text-sm font-semibold"><FileText className="mx-auto mb-2 text-primary" /><span>{file ? file.name : t('application.chooseFile')}</span><input data-testid="input-application-document" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.doc,.docx,application/pdf,image/jpeg,image/png,image/webp,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" disabled={isUploading || application.status === 'accepted'} onChange={(e) => { const selected = e.target.files?.[0] || null; if (selected && (!allowedDocumentTypes.has(selected.type.toLowerCase()) || selected.size < 1 || selected.size > maxDocumentSize)) { setFile(null); setMessage(t('application.invalidFile')); e.currentTarget.value = ''; return; } setMessage(''); setFile(selected); }} /></label>{file && <div data-testid="text-selected-document" className="mt-3 rounded-xl bg-accent/30 p-3 text-xs"><p className="font-bold">{file.name}</p><p className="mt-1 text-muted-foreground">{file.type || t('application.unspecifiedType')} · {t('application.bytes', { count: formatNumber(file.size) })}</p></div>}{isUploading && <div className="mt-3"><div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{t('application.uploading')}</span><span>{formatNumber(uploadProgress)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }} /></div></div>}<Button data-testid="button-record-application-document" className="mt-4 w-full" variant="soft" disabled={!file || application.status === 'accepted' || isUploading || requestUploadUrl.isPending || attach.isPending} onClick={recordDocument}>{isUploading || requestUploadUrl.isPending || attach.isPending ? t('application.uploadProgress', { progress: formatNumber(uploadProgress) }) : t('application.uploadAttach')}</Button><div className="mt-6 space-y-3">{application.documents.map((document) => <div key={document.id} data-testid={`row-application-document-${document.id}`} className="rounded-xl border border-border p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{document.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">{document.contentType} · {t('application.bytes', { count: formatNumber(document.size) })}</p></div><button type="button" data-testid={`button-open-application-document-${document.id}`} onClick={() => window.open(`/api/applications/${application.id}/documents/${document.id}/content`, '_blank', 'noopener')} className="shrink-0 rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold text-primary hover:bg-accent">{t('application.download')}</button></div></div>)}{!application.documents.length && <p className="text-center text-sm text-muted-foreground">{t('application.noDocuments')}</p>}</div></section></div>
  </Shell>;
}

type ApplicationStatusFilter = 'all' | keyof typeof applicationStatuses;

function ApplicationEditor({ application }: { application?: Application }) {
  const { t } = useI18n();
  const initial: ApplicationInput = {
    firstName: application?.firstName || '', lastName: application?.lastName || '',
    gender: application?.gender || 'female', birthDate: application?.birthDate || '',
    level: application?.level || DEFAULT_ACADEMIC_LEVEL, classroomId: application?.classroomId ?? null,
    notes: application?.notes || null, guardianName: application?.guardianName || '',
    guardianPhone: application?.guardianPhone || '', guardianEmail: application?.guardianEmail || null,
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const classrooms = useListClassrooms();
  const create = useCreateApplication();
  const update = useUpdateApplication();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const set = (key: keyof ApplicationInput, value: string | number | null) => setForm((current) => ({ ...current, [key]: value }));
  const pending = create.isPending || update.isPending;
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    const data = { ...form, notes: form.notes || null, guardianEmail: form.guardianEmail || null };
    if (application) {
      update.mutate({ id: application.id, data }, { onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetApplicationQueryKey(application.id) });
        qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
      }, onError: () => setError(t('application.saveError')) });
    } else {
      create.mutate({ data }, { onSuccess: (created) => {
        qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
        setLocation(`/applications/${created.id}`);
      }, onError: () => setError(t('application.createError')) });
    }
  };
  const fieldClass = 'mt-2 w-full rounded-xl border border-input bg-background px-3 py-3 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';
  return <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
    <div className="mb-5"><h2 className="text-lg font-bold">{application ? t('application.details') : t('application.new')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('application.detailsDesc')}</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">{t('application.firstName')}<input required data-testid="input-application-first-name" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} className={fieldClass} /></label>
      <label className="text-sm font-semibold">{t('application.lastName')}<input required data-testid="input-application-last-name" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} className={fieldClass} /></label>
      <label className="text-sm font-semibold">{t('application.gender')}<select data-testid="select-application-gender" value={form.gender} onChange={(e) => set('gender', e.target.value)} className={fieldClass}><option value="female">{t('application.female')}</option><option value="male">{t('application.male')}</option></select></label>
      <label className="text-sm font-semibold">{t('application.birthDate')}<input required type="date" data-testid="input-application-birth-date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} className={fieldClass} /></label>
      <label className="text-sm font-semibold">{t('application.level')}<input required data-testid="input-application-level" value={form.level} onChange={(e) => set('level', e.target.value)} className={fieldClass} /></label>
      <label className="text-sm font-semibold">{t('application.classroom')}<select data-testid="select-application-classroom" value={form.classroomId ?? ''} onChange={(e) => set('classroomId', e.target.value ? Number(e.target.value) : null)} className={fieldClass}><option value="">{t('application.unspecified')}</option>{(classrooms.data || []).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
      <label className="text-sm font-semibold">{t('application.guardianName')}<input required data-testid="input-application-guardian-name" value={form.guardianName} onChange={(e) => set('guardianName', e.target.value)} className={fieldClass} /></label>
      <label className="text-sm font-semibold">{t('application.phone')}<input required minLength={5} type="tel" data-testid="input-application-guardian-phone" value={form.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} className={fieldClass} /></label>
      <label className="text-sm font-semibold sm:col-span-2">{t('application.email')}<input type="email" data-testid="input-application-guardian-email" value={form.guardianEmail || ''} onChange={(e) => set('guardianEmail', e.target.value)} className={fieldClass} /></label>
    </div>
    <label className="mt-4 block text-sm font-semibold">{t('application.notes')}<textarea rows={3} data-testid="input-application-notes" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} className={`${fieldClass} resize-none`} /></label>
    {error && <p data-testid="status-application-save-error" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">{error}</p>}
    <div className="mt-6 flex justify-end gap-3">{!application && <Link href="/applications" data-testid="link-cancel-application" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted">{t('common.cancel')}</Link>}<Button type="submit" data-testid="button-save-application" disabled={pending}>{pending ? t('application.saving') : application ? t('application.saveChanges') : t('application.createRequest')}</Button></div>
  </form>;
}
