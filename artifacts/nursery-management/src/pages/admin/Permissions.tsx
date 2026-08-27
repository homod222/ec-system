import { useState } from 'react';
import { useListRolePermissions, useSetRolePermission, getListRolePermissionsQueryKey } from '@workspace/api-client-react';
import { Shell, Button, Pill, QueryState, PageHeader } from '../../App';
import { ShieldCheck, Users, Check, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export function Permissions() {
  const query = useListRolePermissions();
  const permissions = query.data || [];
  
  const roles = Array.from(new Set(permissions.map(p => p.role)));
  const operations = Array.from(new Set(permissions.map(p => p.operation)));
  
  const [selectedRole, setSelectedRole] = useState(roles[0] || 'admin');
  
  const setPerm = useSetRolePermission();
  const qc = useQueryClient();
  const { toast } = useToast();

  const handleToggle = (operation: string, currentAllowed: boolean) => {
    setPerm.mutate({ data: { role: selectedRole, operation, allowed: !currentAllowed } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRolePermissionsQueryKey() });
        toast({ title: 'تم تحديث الصلاحية بنجاح' });
      },
      onError: () => toast({ title: 'حدث خطأ أثناء تحديث الصلاحية', variant: 'destructive' })
    });
  };

  const rolePermissions = permissions.filter(p => p.role === selectedRole);

  return (
    <Shell>
      <PageHeader 
        eyebrow="إدارة النظام" 
        title="الصلاحيات والأدوار" 
        description="تحديد صلاحيات الوصول والعمليات لكل دور في النظام." 
      />
      
      <div className="mb-6 flex gap-4">
        {roles.map(role => (
          <Button key={role} variant={selectedRole === role ? 'primary' : 'soft'} onClick={() => setSelectedRole(role)}>
            <Users size={18} /> {role === 'admin' ? 'إدارة' : role === 'teacher' ? 'معلمة' : role === 'accountant' ? 'محاسب' : role}
          </Button>
        ))}
      </div>

      <QueryState loading={query.isLoading} error={query.isError} empty={!permissions.length} onRetry={() => query.refetch()}>
        <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div className="hidden grid-cols-[2fr_1fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
            <span>العملية</span><span>الحالة</span>
          </div>
          {rolePermissions.map((perm) => (
            <div key={perm.id} className="grid gap-3 border-b border-border px-6 py-4 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[2fr_1fr] md:items-center md:gap-4">
              <div className="font-bold text-foreground">{perm.operation}</div>
              <div className="flex items-center gap-3">
                <button 
                  disabled={setPerm.isPending}
                  onClick={() => handleToggle(perm.operation, perm.allowed)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${perm.allowed ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${perm.allowed ? '-translate-x-5' : 'translate-x-0'}`} />
                </button>
                <span className="text-sm font-medium">{perm.allowed ? 'مسموح' : 'ممنوع'}</span>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
    </Shell>
  );
}
