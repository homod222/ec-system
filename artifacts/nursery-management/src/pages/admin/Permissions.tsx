import { useEffect, useMemo, useState } from 'react';
import { useListRolePermissions, useSetRolePermission, getListRolePermissionsQueryKey, getListUserPermissionsQueryKey, useListPermissionPrincipals, useListUserPermissions, useSetUserPermission } from '@workspace/api-client-react';
import { Shell, Button, QueryState, PageHeader } from '../../App';
import { Search, ShieldCheck, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

const roleNames: Record<string, string> = {
  admin: 'مدير', manager: 'مدير فرع', supervisor: 'مشرف', teacher: 'معلمة',
  accountant: 'محاسب', receptionist: 'موظف استقبال', parent: 'ولي أمر',
};
const verbs: Record<string, string> = {
  read: 'عرض', write: 'إدارة', create: 'إنشاء', update: 'تعديل',
  publish: 'نشر أو إخفاء', delete: 'حذف', accept: 'قبول',
};
const resources: Record<string, string> = {
  dashboard: 'لوحة القيادة', children: 'الأطفال', attendance: 'الحضور',
  'child-record': 'سجل الطفل', 'child-confidential': 'بيانات الطفل السرية',
  'child-health': 'الصحة', 'child-emergency': 'الطوارئ', 'child-allergy': 'الحساسية',
  'child-medication': 'الأدوية', 'child-document': 'مستندات الطفل', 'child-photo': 'صور الطفل',
  'child-note': 'ملاحظات الطفل', 'child-history': 'تاريخ الطفل', application: 'طلبات التسجيل',
  'application-document': 'مستندات الطلبات', invoice: 'الفواتير', payment: 'المدفوعات',
  permissions: 'الصلاحيات', audit: 'سجل النظام', 'site-gallery': 'ألبوم الموقع',
  branch: 'الفروع', stage: 'المراحل', classroom: 'الفصول', curriculum: 'المناهج',
  'lesson-plan': 'خطط الدروس', skill: 'المهارات', assessment: 'التقييمات',
  'progress-report': 'تقارير التقدم', event: 'الفعاليات', media: 'الوسائط',
  'fee-plan': 'خطط الرسوم', discount: 'الخصومات', refund: 'الاستردادات',
  expense: 'المصروفات', revenue: 'الإيرادات', payroll: 'الرواتب',
  setting: 'الإعدادات', holiday: 'العطلات', notification: 'الإشعارات',
  integration: 'التكاملات', 'teacher-assignment': 'تعيين المعلمات',
  'classroom-schedule': 'جداول الفصول', 'staff-profile': 'ملفات الموظفين',
  'staff-job': 'شؤون الموظفين', 'staff-leave': 'إجازات الموظفين', evaluation: 'التقييم الوظيفي',
  'report-operational': 'التقرير التشغيلي', 'report-academic': 'التقرير الأكاديمي',
  'report-financial': 'التقرير المالي',
};
function operationName(operation: string) {
  const [verb, resource] = operation.split(':');
  return `${verbs[verb] || verb} ${resources[resource] || resource}`;
}
function groupName(operation: string) {
  const resource = operation.split(':')[1] || '';
  if (resource.startsWith('child') || ['children', 'attendance'].includes(resource)) return 'الأطفال والحضور';
  if (resource.includes('report')) return 'التقارير';
  if (['invoice', 'payment', 'fee-plan', 'discount', 'refund', 'expense', 'revenue', 'payroll'].includes(resource)) return 'المالية';
  if (['curriculum', 'lesson-plan', 'skill', 'assessment', 'progress-report', 'event', 'media'].includes(resource)) return 'التعليم والأنشطة';
  if (resource.includes('application')) return 'طلبات التسجيل';
  if (resource === 'site-gallery') return 'واجهة الموقع';
  if (['permissions', 'audit', 'setting', 'notification', 'integration', 'holiday'].includes(resource)) return 'النظام والإعدادات';
  return 'إدارة الحضانة والموظفين';
}

export function Permissions() {
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
      `${operationName(p.operation)} ${p.operation}`.toLowerCase().includes(search.trim().toLowerCase()),
    ).forEach((permission) => {
      const name = groupName(permission.operation);
      result.set(name, [...(result.get(name) || []), permission]);
    });
    return result;
  }, [subjectPermissions, search]);
  const rolePermissions = subjectPermissions;
  const allowedCount = rolePermissions.filter((p) => p.allowed).length;
  const toggle = (operation: string, allowed: boolean) => setPerm.mutate({
    data: { role: selectedRole, operation, allowed: !allowed },
  }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListRolePermissionsQueryKey() }); toast({ title: 'تم تحديث الصلاحية' }); },
    onError: () => toast({ title: 'تعذر تحديث الصلاحية', variant: 'destructive' }),
  });
  const toggleUser = (operation: string, allowed: boolean): void => {
    if (!userId.trim()) {
      toast({ title: 'اختر مستخدماً أو أدخل Clerk userId', variant: 'destructive' });
      return;
    }
    setUserPerm.mutate({ data: { userId: userId.trim(), operation, allowed: !allowed } }, {
      onSuccess: () => toast({ title: 'تم حفظ صلاحية المستخدم' }),
      onError: () => toast({ title: 'تعذر حفظ صلاحية المستخدم', variant: 'destructive' }),
    });
  };

  return <Shell>
    <PageHeader eyebrow="إدارة النظام" title="الصلاحيات والأدوار" description="تحديد العمليات المسموحة لكل دور دون تغيير رموز الصلاحيات الداخلية." />
    <div className="mb-6 flex flex-wrap gap-3">
      <Button variant={subjectType === 'role' ? 'primary' : 'soft'} onClick={() => setSubjectType('role')}>صلاحيات دور</Button>
      <Button variant={subjectType === 'user' ? 'primary' : 'soft'} onClick={() => setSubjectType('user')}>صلاحيات مستخدم</Button>
      {subjectType === 'role' && roles.map((role) => <Button key={role} variant={selectedRole === role ? 'primary' : 'soft'} onClick={() => setSelectedRole(role)}>
        <Users size={17} />{roleNames[role] || role}
      </Button>)}
    </div>
    {subjectType === 'user' && <div className="mb-5 rounded-2xl border border-border bg-card p-4"><label className="text-sm font-bold">المستخدم المستفيد: <select value={userId} onChange={(e) => { const principal = (principals.data || []).find((item) => item.userId === e.target.value); setUserId(e.target.value); if (principal) setBaselineRole(principal.role); }} className="rounded-lg border p-2"><option value="">اختر مستخدماً معروفاً</option>{(principals.data || []).map((principal) => <option key={principal.userId} value={principal.userId}>{principal.label}</option>)}</select></label><input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="أو أدخل Clerk userId صراحة" className="mr-3 rounded-lg border p-2" /><label className="mr-3 text-sm font-bold">الدور الأساسي: <select required value={baselineRole} onChange={(e) => setBaselineRole(e.target.value)} className="rounded-lg border p-2">{roles.map((role) => <option key={role} value={role}>{roleNames[role] || role}</option>)}</select></label><p className="mt-2 text-xs text-muted-foreground">الدور الأساسي للعرض الموروث فقط؛ قرار الخادم يعتمد دور جلسة المستخدم الحقيقي.</p></div>}
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center">
      <div className="relative flex-1"><Search className="absolute right-3 top-3 text-muted-foreground" size={18} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم العملية..." className="w-full rounded-xl border border-input bg-background py-2.5 pl-3 pr-10" />
      </div>
      <span className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary"><ShieldCheck size={17} />مسموح {allowedCount} من {rolePermissions.length}</span>
    </div>
    <QueryState loading={query.isLoading || userOverrides.isLoading} error={query.isError || userOverrides.isError} empty={!permissions.length} onRetry={() => query.refetch()}>
      <div className="space-y-4">
        {[...grouped.entries()].map(([group, items]) => <details key={group} open className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <summary className="cursor-pointer bg-secondary/30 px-6 py-4 font-bold">{group} <span className="mr-2 text-xs text-muted-foreground">({items.filter((p) => p.allowed).length}/{items.length})</span></summary>
          {items.map((permission) => <div key={permission.operation} className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
            <div><p className="font-bold">{operationName(permission.operation)}</p><p dir="ltr" className="mt-1 text-left font-mono text-[11px] text-muted-foreground">{permission.operation}</p>{subjectType === 'user' && <p className="text-xs text-muted-foreground">{permission.userOverride ? 'تجاوز مستخدم مباشر' : 'موروثة من الدور المحدد'}</p>}</div>
            <div className="flex items-center gap-3"><button disabled={setPerm.isPending || setUserPerm.isPending} aria-label={`تبديل ${operationName(permission.operation)}`} onClick={() => subjectType === 'user' ? toggleUser(permission.operation, permission.allowed) : toggle(permission.operation, permission.allowed)}
              className={`relative inline-flex h-6 w-11 rounded-full ${permission.allowed ? 'bg-primary' : 'bg-muted'} disabled:opacity-50`}>
              <span className={`block h-5 w-5 rounded-full bg-background shadow transition-transform ${permission.allowed ? '-translate-x-5' : 'translate-x-0'}`} />
            </button><span className="w-12 text-sm font-medium">{permission.allowed ? 'مسموح' : 'ممنوع'}</span></div>
          </div>)}
        </details>)}
        {!grouped.size && <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">لا توجد عمليات مطابقة للبحث.</p>}
      </div>
    </QueryState>
  </Shell>;
}