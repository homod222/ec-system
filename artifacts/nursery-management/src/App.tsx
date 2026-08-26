import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import * as ClerkInternal from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity as ActivityIcon, ArrowUpRight, Baby, Banknote, BarChart3, Bell, BookOpen,
  CalendarCheck, Check, ChevronLeft, ChevronRight, CircleAlert, CircleDollarSign, Clock3,
  CreditCard, Edit3, FileText, GraduationCap, LayoutDashboard, LogOut, Menu, MoreHorizontal,
  Phone, Plus, Search, Settings, ShieldCheck, Sparkles, Trash2, TrendingUp, Users, Wallet, X,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';
import {
  getGetChildQueryKey, getGetTodayAttendanceQueryKey, getListChildrenQueryKey,
  useCreateChild, useDeleteChild, useGetChild, useGetDashboardActivity, useGetDashboardSummary,
  useGetFinanceSummary, useGetTodayAttendance, useListChildren, useListClassrooms, useListGuardians,
  useListInvoices, useListStaff, useRecordAttendance, useUpdateChild,
} from '@workspace/api-client-react';
import type { AttendanceRecord, Child, Classroom, Invoice, StaffMember } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Landing } from './pages/Landing';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkKeyResolver = (ClerkInternal as unknown as { publishableKeyFromHost?: (host: string, key?: string) => string }).publishableKeyFromHost ?? ((_: string, key?: string) => key || '');
const clerkPubKey = clerkKeyResolver(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const navItems = [
  { href: '/dashboard', label: 'لوحة القيادة', icon: LayoutDashboard },
  { href: '/children', label: 'الأطفال', icon: Baby },
  { href: '/attendance', label: 'الحضور والانصراف', icon: CalendarCheck },
  { href: '/classrooms', label: 'الفصول الدراسية', icon: BookOpen },
  { href: '/guardians', label: 'أولياء الأمور', icon: Users },
  { href: '/staff', label: 'فريق العمل', icon: GraduationCap },
  { href: '/finance', label: 'المالية', icon: Wallet },
];
const arDate = new Intl.DateTimeFormat('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' });
const money = (n: number) => new Intl.NumberFormat('ar-KW', {
  style: 'currency',
  currency: 'KWD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
}).format(n || 0);
const initials = (name: string) => name.split(' ').slice(0, 2).map((s) => s[0]).join('');
const today = new Date().toISOString().slice(0, 10);

function Button({ children, className = '', variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'danger' }) {
  const variants = {
    primary: 'bg-primary text-primary-foreground hover:-translate-y-0.5 hover:shadow-md',
    soft: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${variants[variant]} disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'green' | 'yellow' | 'red' | 'blue' | 'neutral' }) {
  const colors = { 
    green: 'bg-[#e5efe9] text-[#165032]', 
    yellow: 'bg-accent/40 text-[#5a4220]', 
    red: 'bg-[#fbeaea] text-[#a02c2c]', 
    blue: 'bg-sky-100 text-sky-800', 
    neutral: 'bg-muted text-muted-foreground' 
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${colors[tone]}`}>{children}</span>;
}

function Avatar({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground ${className}`}>{initials(name)}</span>;
}

function Skeleton({ className = '' }: { className?: string }) { 
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />; 
}

function QueryState({ loading, error, empty, children, onRetry }: { loading?: boolean; error?: boolean; empty?: boolean; children: React.ReactNode; onRetry?: () => void }) {
  if (loading) return <div className="space-y-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  if (error) return <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-destructive/30 bg-destructive/5 p-12 text-center"><CircleAlert className="mb-4 text-destructive" size={32} /><p className="font-bold text-destructive">تعذر تحميل البيانات</p><p className="mt-2 text-sm text-destructive/70">تحقق من الاتصال ثم حاول مرة أخرى.</p><Button variant="danger" className="mt-5" onClick={onRetry}>إعادة المحاولة</Button></div>;
  if (empty) return <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card p-14 text-center"><Sparkles className="mb-4 text-accent" size={32} /><p className="font-bold">لا توجد بيانات بعد</p><p className="mt-2 text-sm text-muted-foreground">ستظهر السجلات هنا عند إضافتها.</p></div>;
  return <>{children}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  
  return (
    <div className="app-noise min-h-[100dvh] bg-background selection:bg-primary/20" dir="rtl">
      <aside className={`fixed inset-y-0 right-0 z-40 flex w-[280px] flex-col bg-sidebar px-5 py-6 text-sidebar-foreground shadow-2xl transition-transform duration-300 lg:translate-x-0 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="mb-10 flex items-center justify-between px-2">
          <img src={`${basePath}/ec-official-logo.png`} alt="حضانة EC" className="h-20 w-auto rounded-xl bg-white/95 px-2 py-1 shadow-sm" />
          <button data-testid="button-close-menu" className="rounded-xl p-2 text-sidebar-foreground/60 hover:bg-sidebar-accent lg:hidden" onClick={() => setOpen(false)}><X size={20} /></button>
        </div>
        
        <div className="mb-8 rounded-2xl bg-sidebar-accent/50 p-4 border border-sidebar-border">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <ShieldCheck size={20} />
            </span>
            <div>
              <p className="text-sm font-bold text-sidebar-foreground">حضانة EC</p>
              <p className="mt-0.5 text-xs font-medium text-sidebar-primary">ثنائية اللغة</p>
            </div>
          </div>
        </div>
        
        <p className="mb-3 px-3 text-[11px] font-bold tracking-[.18em] text-sidebar-foreground/40 uppercase">الإدارة</p>
        <nav className="space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} data-testid={`link-nav-${href.slice(1)}`} onClick={() => setOpen(false)} 
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${location === href || (href === '/children' && location.startsWith('/children/')) ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}>
              <Icon size={18} />
              <span>{label}</span>
              {href === '/attendance' && <span className="mr-auto rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">اليوم</span>}
            </Link>
          ))}
        </nav>
        
        <div className="mt-auto space-y-1 pt-6 border-t border-sidebar-border">
          <Link href="/settings" data-testid="link-nav-settings" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"><Settings size={18} />الإعدادات</Link>
          <button data-testid="button-sign-out" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"><LogOut size={18} />تسجيل الخروج</button>
        </div>
      </aside>
      
      {open && <button aria-label="إغلاق القائمة" data-testid="button-overlay-menu" className="fixed inset-0 z-30 bg-primary/30 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}
      
      <main className="min-h-[100dvh] lg:mr-[280px]">
        <header className="sticky top-0 z-20 flex h-[80px] items-center justify-between border-b border-border/60 bg-background/80 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            <button data-testid="button-open-menu" className="rounded-xl border border-border bg-card p-2.5 text-foreground lg:hidden" onClick={() => setOpen(true)}><Menu size={20} /></button>
            <div className="hidden items-center gap-2 text-xs font-bold text-muted-foreground sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-soft" /> النظام الأكاديمي يعمل بكفاءة
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button data-testid="button-notifications" title="الإشعارات" onClick={() => window.alert('لا توجد إشعارات جديدة')} className="relative rounded-xl border border-border bg-card p-2.5 text-muted-foreground hover:text-foreground transition-colors">
              <Bell size={18} />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive border-2 border-card" />
            </button>
            <div className="hidden text-left sm:block">
              <p data-testid="text-user-name" className="text-sm font-bold text-foreground">{user?.firstName || 'مدير النظام'}</p>
              <p className="text-[11px] font-medium text-muted-foreground">الإدارة العليا</p>
            </div>
            <Avatar name={user?.firstName || 'مدير النظام'} className="bg-primary text-primary-foreground" />
          </div>
        </header>
        <div className="mx-auto max-w-[1500px] p-5 sm:p-8 lg:p-10 animate-rise">{children}</div>
      </main>
    </div>
  );
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 text-xs font-bold tracking-[.15em] text-primary/60">{eyebrow || 'حضانة EC'}</p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h1>
        {description && <p className="mt-2.5 text-sm text-muted-foreground max-w-lg leading-relaxed">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, detail, tone = 'teal' }: { icon: typeof Users; label: string; value: string; detail?: string; tone?: 'teal' | 'gold' | 'coral' | 'sage' }) {
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
  const summary = useGetDashboardSummary();
  const activity = useGetDashboardActivity();
  const data = summary.data;
  const activities = activity.data || [];
  
  return (
    <Shell>
      <PageHeader 
        eyebrow={arDate.format(new Date())} 
        title="صباح الخير، أستاذة" 
        description="هذه لمحة سريعة على يوم الحضانة وتفاصيل الحضور والمهام." 
        action={<Button data-testid="button-dashboard-report" variant="soft" onClick={() => window.print()}><FileText size={17} />تقرير اليوم <ArrowUpRight size={15} /></Button>} 
      />
      
      <QueryState loading={summary.isLoading} error={summary.isError} onRetry={() => summary.refetch()}>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Baby} label="إجمالي الأطفال" value={`${data?.totalChildren ?? 0}`} detail="هذا الشهر" tone="teal" />
          <StatCard icon={CalendarCheck} label="حاضرون اليوم" value={`${data?.presentToday ?? 0}`} detail={`${data?.attendanceRate ?? 0}% حضور`} tone="sage" />
          <StatCard icon={Users} label="الفريق اليوم" value={`${data?.staffCount ?? 0}`} detail="منظم" tone="gold" />
          <StatCard icon={CircleDollarSign} label="إيرادات الشهر" value={money(data?.monthlyRevenue ?? 0)} detail={`${data?.pendingPayments ?? 0} معلقة`} tone="coral" />
        </div>
      </QueryState>
      
      <div className="mt-8 grid gap-8 xl:grid-cols-[1.4fr_.6fr]">
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">حالة الحضور المباشرة</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">نظرة سريعة على التزام الفصول الدراسية</p>
            </div>
            <Link href="/attendance" data-testid="link-dashboard-attendance" className="text-sm font-bold text-primary hover:underline bg-primary/5 px-4 py-2 rounded-xl">
              فتح السجل <ChevronLeft className="inline" size={16} />
            </Link>
          </div>
          
          <div className="flex flex-col items-center gap-10 sm:flex-row">
            <div className="relative grid h-52 w-52 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(hsl(var(--primary)) ${(data?.attendanceRate || 0) * 3.6}deg, hsl(var(--muted)) 0)` }}>
              <div className="grid h-40 w-40 place-items-center rounded-full bg-card shadow-inner">
                <div className="text-center">
                  <p className="text-4xl font-bold text-foreground">{data?.attendanceRate ?? 0}%</p>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">نسبة الحضور</p>
                </div>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-4">
              <div className="rounded-2xl bg-[#e5efe9] p-5">
                <p className="mb-2 text-sm font-bold text-[#165032]">حاضر</p>
                <p className="text-3xl font-bold text-[#165032]">{data?.presentToday ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-[#fbeaea] p-5">
                <p className="mb-2 text-sm font-bold text-[#a02c2c]">غائب</p>
                <p className="text-3xl font-bold text-[#a02c2c]">{data?.absentToday ?? 0}</p>
              </div>
              <div className="col-span-2 flex items-center gap-3 rounded-2xl border-2 border-dashed border-accent/40 bg-accent/10 p-4 text-sm font-medium text-foreground">
                <CircleAlert size={18} className="text-accent-foreground" /> تأكدي من تسجيل حالات الغياب قبل نهاية الفترة المخصصة.
              </div>
            </div>
          </div>
        </section>
        
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">آخر النشاطات</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">تحديثات الإدارة اليومية</p>
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
                    <p className="mt-1.5 font-mono text-[11px] font-bold text-primary/50">{new Date(item.createdAt).toLocaleDateString('ar-SA')}</p>
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
  const [form, setForm] = useState({ 
    firstName: child?.firstName || '', lastName: child?.lastName || '', 
    gender: child?.gender || 'female', birthDate: child?.birthDate || '', 
    guardianName: child?.guardianName || '', guardianPhone: child?.guardianPhone || '', 
    level: child?.level || 'تمهيدي', notes: child?.notes || '', classroomId: child?.classroomId?.toString() || '' 
  });
  
  const classrooms = useListClassrooms();
  const create = useCreateChild();
  const update = useUpdateChild();
  const qc = useQueryClient();
  
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  
  const submit = (e: React.FormEvent) => { 
    e.preventDefault(); 
    const payload = { ...form, classroomId: form.classroomId ? Number(form.classroomId) : null, notes: form.notes || null } as any; 
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
            <p className="text-xs font-bold tracking-widest text-primary/60">سجل الأطفال</p>
            <h2 className="mt-2 text-2xl font-bold">{child ? 'تعديل بيانات الطفل' : 'تسجيل طفل جديد'}</h2>
          </div>
          <button type="button" data-testid="button-close-child-form" onClick={onClose} className="rounded-xl bg-muted p-2.5 hover:bg-destructive hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="grid gap-5 sm:grid-cols-2">
          {[
            ['firstName','الاسم الأول'],['lastName','اسم العائلة'],
            ['birthDate','تاريخ الميلاد'],['guardianName','اسم ولي الأمر'],['guardianPhone','رقم الجوال']
          ].map(([key, label]) => (
            <label key={key} className="text-sm font-bold text-foreground">
              {label}
              <input required={key !== 'birthDate'} data-testid={`input-child-${key}`} type={key === 'birthDate' ? 'date' : key === 'guardianPhone' ? 'tel' : 'text'} 
                value={(form as any)[key]} onChange={(e) => set(key, e.target.value)} 
                className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
            </label>
          ))}
          <label className="text-sm font-bold text-foreground">
            الجنس
            <select data-testid="select-child-gender" value={form.gender} onChange={(e) => set('gender', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="female">بنت</option><option value="male">ولد</option>
            </select>
          </label>
          <label className="text-sm font-bold text-foreground">
            المستوى الأكاديمي
            <select data-testid="select-child-level" value={form.level} onChange={(e) => set('level', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option>تمهيدي</option><option>روضة أولى</option><option>روضة ثانية</option>
            </select>
          </label>
          <label className="text-sm font-bold text-foreground">
            الفصل
            <select data-testid="select-child-classroom" value={form.classroomId} onChange={(e) => set('classroomId', e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              <option value="">غير محدد</option>
              {(classrooms.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        
        <label className="mt-5 block text-sm font-bold text-foreground">
          ملاحظات صحية أو عامة
          <textarea data-testid="input-child-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} 
            className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
        </label>
        
        <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button data-testid="button-submit-child" type="submit" disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? 'جارٍ الحفظ...' : child ? 'حفظ التعديلات' : 'إضافة السجل'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Children() {
  const [search, setSearch] = useState(''); 
  const [modal, setModal] = useState(false);
  const query = useListChildren(search ? { search } : undefined);
  const children = query.data || [];
  
  return (
    <Shell>
      <PageHeader eyebrow="حضانة EC / السجلات" title="سجل الأطفال" description="جميع البيانات الأكاديمية والطبية في مكان واحد." action={<Button data-testid="button-add-child" onClick={() => setModal(true)}><Plus size={18} />تسجيل طفل</Button>} />
      
      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search size={18} className="absolute right-4 top-3.5 text-muted-foreground" />
          <input data-testid="input-search-children" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم الطفل أو ولي الأمر..." className="w-full rounded-xl border border-border bg-card py-3.5 pr-12 pl-4 text-sm font-medium shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" />
        </div>
        <Button variant="soft" data-testid="button-filter-children" onClick={() => setSearch('')}>
          <BarChart3 size={17} />إظهار الكل
        </Button>
      </div>
      
      <QueryState loading={query.isLoading} error={query.isError} empty={!children.length} onRetry={() => query.refetch()}>
        <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div className="hidden grid-cols-[1.6fr_1fr_1fr_1fr_.7fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
            <span>الطفل</span><span>الفصل والمستوى</span><span>ولي الأمر</span><span>نسبة الحضور</span><span>الحالة</span>
          </div>
          {children.map((child) => (
            <Link href={`/children/${child.id}`} key={child.id} data-testid={`row-child-${child.id}`} className="grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[1.6fr_1fr_1fr_1fr_.7fr] md:items-center md:gap-4">
              <div className="flex items-center gap-4">
                <Avatar name={child.fullName} className="h-11 w-11" />
                <div>
                  <p className="font-bold text-foreground">{child.fullName}</p>
                  <p className="mt-0.5 text-xs font-medium text-muted-foreground">{child.gender === 'female' ? 'بنت' : 'ولد'} · مواليد {child.birthDate}</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">{child.classroomName || 'غير محدد'}</p>
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
                  {child.status === 'active' ? 'منتظم' : child.status === 'pending' ? 'قيد التسجيل' : 'غير منتظم'}
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

function ChildProfile() {
  const [, params] = useRoute('/children/:id'); const id = Number(params?.id); 
  const query = useGetChild(id); const child = query.data;
  const [edit, setEdit] = useState(false); const [confirm, setConfirm] = useState(false); 
  const del = useDeleteChild(); const [, setLocation] = useLocation(); const qc = useQueryClient(); 
  
  if (query.isLoading) return <Shell><Skeleton className="h-12 w-64 mb-6" /><Skeleton className="h-64 w-full rounded-[2rem]" /></Shell>;
  if (query.isError || !child) return <Shell><QueryState error onRetry={() => query.refetch()}>{null}</QueryState></Shell>;
  
  return (
    <Shell>
      <Link href="/children" data-testid="link-back-children" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-colors">
        <ArrowRightIcon />العودة للسجل
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
              <BookOpen size={16} /> {child.level} · {child.classroomName || 'غير محدد'} · مسجل منذ {child.birthDate}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="soft" data-testid="button-edit-child" onClick={() => setEdit(true)} className="bg-primary-foreground/10 text-primary-foreground border border-primary-foreground/20 hover:bg-primary-foreground/20">
              <Edit3 size={18} />تعديل
            </Button>
            <Button variant="ghost" data-testid="button-delete-child" className="text-primary-foreground hover:bg-destructive hover:text-white" onClick={() => setConfirm(true)}>
              <Trash2 size={18} />
            </Button>
          </div>
        </div>
      </div>
      
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
          <h2 className="mb-6 text-xl font-bold flex items-center gap-2"><ActivityIcon size={20} className="text-primary" /> ملخص الحضور الأكاديمي</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-2xl bg-muted p-5">
              <p className="text-xs font-bold text-muted-foreground">النسبة العامة</p>
              <p className="mt-2 text-3xl font-bold">{child.attendanceRate}%</p>
            </div>
            <div className="rounded-2xl bg-[#e5efe9] p-5">
              <p className="text-xs font-bold text-[#165032]">حضور الشهر</p>
              <p className="mt-2 text-3xl font-bold text-[#165032]">18</p>
            </div>
            <div className="rounded-2xl bg-[#fbeaea] p-5">
              <p className="text-xs font-bold text-[#a02c2c]">غياب مسجل</p>
              <p className="mt-2 text-3xl font-bold text-[#a02c2c]">2</p>
            </div>
          </div>
          <div className="mt-8 flex h-36 items-end gap-2 border-b border-border pb-2">
            {[55, 80, 75, 90, 65, 100, 82, 70, 91, 78, 88, 96].map((h, i) => (
              <div key={i} className="group flex flex-1 flex-col items-center gap-2">
                <div className={`w-full rounded-t-lg transition-all ${i === 11 ? 'bg-accent' : 'bg-primary/20 group-hover:bg-primary/50'}`} style={{ height: `${h}%` }} />
                <span className="font-mono text-[10px] font-bold text-muted-foreground">{i + 1}</span>
              </div>
            ))}
          </div>
        </section>
        
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
          <h2 className="mb-6 text-xl font-bold flex items-center gap-2"><Users size={20} className="text-primary" /> بيانات العائلة</h2>
          <div className="space-y-5">
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-bold text-muted-foreground">ولي الأمر</p>
              <p className="mt-1 font-bold text-lg">{child.guardianName}</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-bold text-muted-foreground">رقم الجوال للتواصل</p>
              <p className="mt-1 flex items-center gap-2 font-bold text-lg"><Phone size={18} className="text-primary" />{child.guardianPhone}</p>
            </div>
            <div className="rounded-xl bg-muted p-4">
              <p className="text-xs font-bold text-muted-foreground mb-1">ملاحظات الإدارة</p>
              <p className="text-sm font-medium leading-relaxed text-foreground">{child.notes || 'ملف خالي من الملاحظات الطبية أو السلوكية.'}</p>
            </div>
          </div>
        </section>
      </div>
      
      {edit && <ChildForm child={child} onClose={() => setEdit(false)} />}
      
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[2rem] border border-border bg-card p-8 shadow-2xl text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-destructive/10 text-destructive mb-4">
              <CircleAlert size={28} />
            </span>
            <h2 className="text-xl font-bold">حذف الملف الأكاديمي؟</h2>
            <p className="mt-3 text-sm font-medium leading-relaxed text-muted-foreground">سيتم حذف {child.fullName} نهائياً من السجلات ولن يمكن التراجع عن هذا الإجراء.</p>
            <div className="mt-8 flex flex-col gap-3">
              <Button variant="danger" className="w-full" disabled={del.isPending} onClick={() => del.mutate({ id: child.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListChildrenQueryKey() }); setLocation('/children'); } })}>
                تأكيد الحذف
              </Button>
              <Button variant="ghost" className="w-full bg-muted" onClick={() => setConfirm(false)}>إلغاء</Button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function ArrowRightIcon() { return <ChevronRight size={18} className="rotate-180" />; }

function Guardians() {
  const query = useListGuardians(); const guardians = query.data || [];
  return (
    <Shell>
      <PageHeader eyebrow="حضانة EC / العلاقات" title="أولياء الأمور" description="تواصل فعّال ومتابعة مالية دقيقة لكل أسرة." action={<Button variant="soft" data-testid="button-export-guardians"><FileText size={17} />تصدير السجل</Button>} />
      
      <div className="mb-8 grid gap-5 sm:grid-cols-3">
        <StatCard icon={Users} label="إجمالي الأسر المسجلة" value={`${guardians.length}`} tone="teal" />
        <StatCard icon={Wallet} label="إجمالي الأرصدة المستحقة" value={money(guardians.reduce((s, g) => s + Math.max(g.balance, 0), 0))} tone="gold" />
        <StatCard icon={Phone} label="تواصل نشط هذا الأسبوع" value={`${guardians.filter((g) => g.phone).length}`} tone="sage" />
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
                    <p className="text-xs font-bold text-primary mt-1 flex items-center gap-1"><Baby size={14}/> {g.childrenCount} طفل مسجل</p>
                  </div>
                </div>
                <button data-testid={`button-guardian-menu-${g.id}`} className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"><MoreHorizontal size={20} /></button>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
                <div>
                  <p className="text-xs font-bold text-muted-foreground">الرصيد المالي المتبقي</p>
                  <p className={`mt-1.5 text-xl font-bold ${g.balance > 0 ? 'text-[#a02c2c]' : 'text-[#165032]'}`}>{money(g.balance)}</p>
                </div>
                <Button variant="soft" data-testid={`button-call-guardian-${g.id}`} className="px-4 py-2 bg-secondary text-primary">
                  <Phone size={16} /> تواصل
                </Button>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
    </Shell>
  );
}

function Classrooms() {
  const query = useListClassrooms(); const rooms = query.data || [];
  return (
    <Shell>
      <PageHeader eyebrow="حضانة EC / البيئة التعليمية" title="الفصول الدراسية" description="توزيع الأطفال والسعة التشغيلية للفصول." action={<Button data-testid="button-add-classroom" variant="soft"><Plus size={18} />إعداد فصل جديد</Button>} />
      
      <QueryState loading={query.isLoading} error={query.isError} empty={!rooms.length} onRetry={() => query.refetch()}>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => { 
            const pct = Math.round((room.childrenCount / room.capacity) * 100); 
            return (
              <div key={room.id} data-testid={`card-classroom-${room.id}`} className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                <div className="h-3 w-full" style={{ background: room.color || 'var(--primary)' }} />
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-bold text-muted-foreground">{room.level}</p>
                      <h2 className="mt-1 text-2xl font-bold">{room.name}</h2>
                    </div>
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-primary">
                      <BookOpen size={20} />
                    </span>
                  </div>
                  
                  <div className="mt-8">
                    <div className="mb-2.5 flex justify-between text-sm font-bold">
                      <span className="text-muted-foreground">الإشغال الفعلي</span>
                      <span>{room.childrenCount} من {room.capacity}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: room.color || 'var(--primary)' }} />
                    </div>
                  </div>
                  
                  <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
                    <div className="flex items-center gap-3">
                      <Avatar name={room.teacherName} className="h-10 w-10 text-xs bg-muted text-muted-foreground" />
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">معلمة الفصل</p>
                        <p className="text-sm font-bold">{room.teacherName}</p>
                      </div>
                    </div>
                    <Pill tone={pct > 90 ? 'red' : 'green'}>{pct > 90 ? 'قريب من الامتلاء' : 'متاح للتسجيل'}</Pill>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </QueryState>
    </Shell>
  );
}

function Staff() {
  const query = useListStaff(); const staff = query.data || [];
  return (
    <Shell>
      <PageHeader eyebrow="حضانة EC / الهيكل الإداري" title="فريق العمل" description="حضور الكادر الأكاديمي والإداري اليوم." action={<Button data-testid="button-add-staff" variant="soft"><Plus size={18} />إضافة موظف</Button>} />
      
      <div className="mb-8 flex flex-wrap gap-3">
        <Pill tone="green"><span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-600" />{staff.filter((s) => s.status === 'present').length} كادر متواجد</Pill>
        <Pill tone="red">{staff.filter((s) => s.status === 'absent').length} غياب مسجل</Pill>
        <Pill tone="yellow">{staff.filter((s) => s.status === 'leave').length} في إجازة رسمية</Pill>
      </div>
      
      <QueryState loading={query.isLoading} error={query.isError} empty={!staff.length} onRetry={() => query.refetch()}>
        <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div className="hidden grid-cols-[1.5fr_1fr_1fr_auto] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
            <span>عضو الفريق</span><span>نسبة الالتزام</span><span>حالة اليوم</span><span>خيارات</span>
          </div>
          {staff.map((person) => (
            <div key={person.id} data-testid={`row-staff-${person.id}`} className="grid gap-4 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[1.5fr_1fr_1fr_auto] md:items-center">
              <div className="flex items-center gap-4">
                <Avatar name={person.name} className="h-12 w-12" />
                <div>
                  <p className="font-bold text-foreground text-base">{person.name}</p>
                  <p className="mt-0.5 text-xs font-medium text-muted-foreground">{person.role} · {person.phone}</p>
                </div>
              </div>
              <div className="hidden md:block">
                <p className="font-mono text-lg font-bold">{person.attendanceRate}%</p>
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mt-0.5">التزام أكاديمي</p>
              </div>
              <div>
                <Pill tone={person.status === 'present' ? 'green' : person.status === 'leave' ? 'yellow' : 'red'}>
                  {person.status === 'present' ? 'حاضر' : person.status === 'leave' ? 'إجازة' : 'غائب'}
                </Pill>
              </div>
              <div className="flex justify-end">
                <button data-testid={`button-staff-menu-${person.id}`} className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"><MoreHorizontal size={20} /></button>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
    </Shell>
  );
}

function Attendance() {
  const query = useGetTodayAttendance(); const records = query.data || []; 
  const record = useRecordAttendance(); const qc = useQueryClient(); 
  const [filter, setFilter] = useState('all');
  
  const visible = records.filter((r) => filter === 'all' || r.status === filter);
  
  const setStatus = (r: AttendanceRecord, status: 'present' | 'absent' | 'late' | 'excused') => 
    record.mutate(
      { data: { childId: r.childId, date: today, status, checkIn: status === 'present' || status === 'late' ? new Date().toISOString() : null, checkOut: null, note: r.note || null } }, 
      { onSuccess: () => qc.invalidateQueries({ queryKey: getGetTodayAttendanceQueryKey() }) }
    );
    
  return (
    <Shell>
      <PageHeader eyebrow={arDate.format(new Date())} title="سجل الحضور والانصراف" description="وثقي دخول وخروج الأطفال بنقرة واحدة." action={<Button variant="soft" data-testid="button-attendance-report"><FileText size={18} />إصدار التقرير</Button>} />
      
      <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
        {[
          ['all','الكل'],['present','حاضر'],['absent','غائب'],['late','متأخر']
        ].map(([value, label]) => (
          <button key={value} data-testid={`button-filter-attendance-${value}`} onClick={() => setFilter(value)} 
            className={`whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-bold transition-all ${filter === value ? 'bg-primary text-primary-foreground shadow-md' : 'bg-card text-muted-foreground border border-border hover:bg-muted'}`}>
            {label}
            {value !== 'all' && <span className="mr-2 opacity-60 text-xs">({records.filter((r) => r.status === value).length})</span>}
          </button>
        ))}
      </div>
      
      <QueryState loading={query.isLoading} error={query.isError} empty={!records.length} onRetry={() => query.refetch()}>
        <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground sm:grid">
            <span>الطفل</span><span>الحالة الحالية</span><span>وقت الدخول الفعلي</span><span>تحديث الإجراء</span>
          </div>
          {visible.map((r) => (
            <div key={r.id} data-testid={`row-attendance-${r.id}`} className="grid gap-4 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/30 transition-colors sm:grid-cols-[1.5fr_1fr_1fr_1fr] sm:items-center">
              <div className="flex items-center gap-4">
                <Avatar name={r.childName} className="h-10 w-10" />
                <span className="font-bold text-foreground text-base">{r.childName}</span>
              </div>
              <div>
                <Pill tone={r.status === 'present' ? 'green' : r.status === 'late' ? 'yellow' : r.status === 'excused' ? 'blue' : 'red'}>
                  {r.status === 'present' ? 'حاضر' : r.status === 'late' ? 'متأخر' : r.status === 'excused' ? 'بعذر' : 'غائب'}
                </Pill>
              </div>
              <span className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                <Clock3 size={16} />
                {r.checkIn ? new Date(r.checkIn).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
              <div className="flex gap-2">
                <button title="تسجيل حضور" data-testid={`button-present-${r.childId}`} onClick={() => setStatus(r, 'present')} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#e5efe9] p-2.5 text-[#165032] hover:brightness-95 transition-all font-bold text-xs"><Check size={16} /> حضور</button>
                <button title="تسجيل غياب" data-testid={`button-absent-${r.childId}`} onClick={() => setStatus(r, 'absent')} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#fbeaea] p-2.5 text-[#a02c2c] hover:brightness-95 transition-all font-bold text-xs"><X size={16} /> غياب</button>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
    </Shell>
  );
}

function Finance() {
  const summary = useGetFinanceSummary(); const invoiceQuery = useListInvoices(); 
  const invoices = invoiceQuery.data || []; const data = summary.data;
  
  return (
    <Shell>
      <PageHeader eyebrow="حضانة EC / الإدارة المالية" title="المالية والتحصيل" description="صورة دقيقة للمدفوعات المتأخرة والتدفقات النقدية." action={<Button data-testid="button-finance-export" variant="soft"><FileText size={18} />إصدار تقرير المحاسبة</Button>} />
      
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Banknote} label="المحصّل هذا الشهر" value={money(data?.collectedThisMonth ?? 0)} detail="أداء ممتاز" tone="teal" />
        <StatCard icon={Wallet} label="إجمالي المتأخرات" value={money(data?.outstanding ?? 0)} tone="gold" />
        <StatCard icon={CircleAlert} label="فواتير متأخرة الدفع" value={`${data?.overdueCount ?? 0}`} tone="coral" />
        <StatCard icon={Check} label="فواتير مسددة بالكامل" value={`${data?.paidCount ?? 0}`} tone="sage" />
      </div>
      
      <div className="mt-8 grid gap-8 xl:grid-cols-[1.2fr_1fr]">
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">مسار التحصيل المالي</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">مقارنة التحصيل بالمستهدف الشهري</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e5efe9] text-[#165032]"><TrendingUp size={20} /></span>
          </div>
          
          <div className="flex h-64 items-end gap-4 border-b border-border pb-2">
            {(data?.monthlyTrend || []).map((m) => (
              <div key={m.month} className="group flex flex-1 flex-col items-center gap-3">
                <div className="relative flex h-52 w-full items-end justify-center gap-1.5">
                  <div className="w-2/5 rounded-t-lg bg-muted group-hover:bg-muted-foreground/30 transition-colors" 
                    style={{ height: `${Math.max(8, (m.expected / Math.max(...(data?.monthlyTrend || [{ expected: 1 }]).map((x) => x.expected))) * 100)}%` }} />
                  <div className="w-2/5 rounded-t-lg bg-primary shadow-sm" 
                    style={{ height: `${Math.max(8, (m.collected / Math.max(...(data?.monthlyTrend || [{ collected: 1 }]).map((x) => x.collected))) * 100)}%` }} />
                </div>
                <span className="text-xs font-bold text-muted-foreground">{m.month}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex gap-6 text-sm font-bold text-muted-foreground justify-center">
            <span className="flex items-center gap-2"><div className="h-3 w-3 rounded bg-primary" /> المحصّل الفعلي</span>
            <span className="flex items-center gap-2"><div className="h-3 w-3 rounded bg-muted" /> المستهدف الشهري</span>
          </div>
        </section>
        
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">السجل الحديث للفواتير</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">حالة السداد لأحدث المطالبات</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><CreditCard size={20} /></span>
          </div>
          
          <QueryState loading={invoiceQuery.isLoading} error={invoiceQuery.isError} empty={!invoices.length} onRetry={() => invoiceQuery.refetch()}>
            <div className="space-y-5">
              {invoices.slice(0, 6).map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} />)}
            </div>
          </QueryState>
        </section>
      </div>
    </Shell>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) { 
  return (
    <div data-testid={`row-invoice-${invoice.id}`} className="flex items-center gap-4 rounded-xl border border-border bg-background p-4 hover:border-primary/20 transition-colors">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
        <FileText size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-foreground">{invoice.guardianName}</p>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{invoice.invoiceNumber} · {invoice.childName}</p>
      </div>
      <div className="text-left">
        <p className="text-base font-bold text-foreground mb-1">{money(invoice.amount)}</p>
        <Pill tone={invoice.status === 'paid' ? 'green' : invoice.status === 'overdue' ? 'red' : 'yellow'}>
          {invoice.status === 'paid' ? 'تم السداد' : invoice.status === 'overdue' ? 'متأخرة' : 'قيد الانتظار'}
        </Pill>
      </div>
    </div>
  ); 
}

function Protected({ children }: { children: React.ReactNode }) { 
  const { isLoaded, isSignedIn } = useAuth(); 
  if (!isLoaded) return <div className="grid min-h-[100dvh] place-items-center bg-background"><Skeleton className="h-32 w-32 rounded-3xl" /></div>; 
  return isSignedIn ? <>{children}</> : <Redirect to="/" />; 
}

function AuthPage({ type }: { type: 'in' | 'up' }) { 
  return (
    <div dir="rtl" className="grid min-h-[100dvh] place-items-center bg-ec-pattern px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-background/90 backdrop-blur-3xl" />
      <div className="absolute right-8 top-8 z-10">
        <Link href="/" data-testid="link-auth-logo" className="block hover:opacity-80 transition-opacity">
          <img src={`${basePath}/ec-official-logo.png`} alt="حضانة EC" className="h-24 w-auto drop-shadow-sm" />
        </Link>
      </div>
      <div className="relative z-10 w-full max-w-md animate-rise">
        {type === 'in' ? 
          <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /> : 
          <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
        }
      </div>
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
        <Route path="/sign-in/*?" component={() => <AuthPage type="in" />} />
        <Route path="/sign-up/*?" component={() => <AuthPage type="up" />} />
        <Route path="/dashboard"><Protected><Dashboard /></Protected></Route>
        <Route path="/children"><Protected><Children /></Protected></Route>
        <Route path="/children/:id"><Protected><ChildProfile /></Protected></Route>
        <Route path="/guardians"><Protected><Guardians /></Protected></Route>
        <Route path="/classrooms"><Protected><Classrooms /></Protected></Route>
        <Route path="/staff"><Protected><Staff /></Protected></Route>
        <Route path="/attendance"><Protected><Attendance /></Protected></Route>
        <Route path="/finance"><Protected><Finance /></Protected></Route>
        <Route><Redirect to="/" /></Route>
      </Switch>
    </RoutedErrorBoundary>
  ); 
}

const appearance = { 
  theme: shadcn, 
  cssLayerName: 'clerk', 
  options: { 
    logoPlacement: 'inside' as const, 
    logoLinkUrl: basePath || '/', 
    logoImageUrl: `${window.location.origin}${basePath}/ec-official-logo.png` 
  }, 
  variables: { 
    colorPrimary: '#165032', 
    colorForeground: '#0f2416', 
    colorMutedForeground: '#607d6a', 
    colorDanger: '#a02c2c', 
    colorBackground: '#fbfaf7', 
    colorInput: '#ffffff', 
    colorInputForeground: '#0f2416', 
    colorNeutral: '#e6dccb', 
    fontFamily: 'IBM Plex Sans Arabic', 
    borderRadius: '1rem' 
  }, 
  elements: { 
    rootBox: 'w-full flex justify-center', 
    cardBox: 'bg-card border border-border rounded-[2rem] w-full max-w-[460px] overflow-hidden shadow-2xl', 
    card: '!shadow-none !border-0 !bg-transparent !p-8', 
    footer: '!shadow-none !border-0 !bg-transparent !px-8 !pb-8 !pt-0', 
    headerTitle: '!text-foreground !font-bold !text-2xl', 
    headerSubtitle: '!text-muted-foreground !text-sm !mt-2', 
    socialButtonsBlockButtonText: '!text-foreground !font-bold', 
    formFieldLabel: '!text-foreground !font-bold !mb-2', 
    footerActionLink: '!text-primary !font-bold hover:!underline', 
    footerActionText: '!text-muted-foreground', 
    dividerText: '!text-muted-foreground', 
    formFieldInput: '!bg-background !text-foreground !border-input !h-12 !px-4 !font-medium focus:!ring-primary/20', 
    formButtonPrimary: '!bg-primary !text-primary-foreground hover:!bg-primary/90 !h-12 !font-bold !text-base transition-all', 
    socialButtonsBlockButton: '!border-input !bg-background hover:!bg-muted !h-12 transition-all', 
    alertText: '!text-destructive !font-bold', 
    main: '!bg-transparent' 
  } 
};

function App() { 
  return (
    <WouterRouter base={basePath}>
      <ClerkProvider 
        publishableKey={clerkPubKey} 
        proxyUrl={clerkProxyUrl} 
        appearance={appearance} 
        signInUrl={`${basePath}/sign-in`} 
        signUpUrl={`${basePath}/sign-up`} 
        localization={{ 
          signIn: { start: { title: 'مرحباً بعودتك', subtitle: 'سجلي الدخول للوصول إلى لوحة إدارة حضانة EC' } }, 
          signUp: { start: { title: 'إدارة أهدأ اليوم', subtitle: 'أنشئي حساب الإدارة الخاص بك' } } 
        }} 
        routerPush={(to: string) => { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }} 
        routerReplace={(to: string) => { window.history.replaceState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }}>
        <QueryClientProvider client={queryClient}>
          <Router />
          <Toaster />
        </QueryClientProvider>
      </ClerkProvider>
    </WouterRouter>
  ); 
}
export default App;