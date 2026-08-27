import { useState } from 'react';
import { useListStaff } from '@workspace/api-client-react';
import { Shell, Button, Pill, Avatar, QueryState, PageHeader } from '../../App';
import { GraduationCap, Search, Plus, Calendar, Star, Briefcase, Plane, DollarSign } from 'lucide-react';
import { OperationalManager } from '../../components/OperationalManager';

export function StaffExpanded() {
  const [search, setSearch] = useState('');
  const query = useListStaff();
  const staff = query.data || [];
  
  const filtered = staff.filter(s => s.name.includes(search));
  
  return (
    <Shell>
      <PageHeader 
        eyebrow="الكادر الوظيفي" 
        title="فريق العمل" 
        description="إدارة المعلمات، الإداريات، والمشرفات وتتبع أدائهن." 
      />
      
      <div className="mb-6 relative max-w-md">
        <Search size={18} className="absolute right-4 top-3.5 text-muted-foreground" />
        <input data-testid="input-search-staff" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث عن موظفة..." className="w-full rounded-xl border border-border bg-card py-3.5 pr-12 pl-4 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>

      <QueryState loading={query.isLoading} error={query.isError} empty={!filtered.length} onRetry={() => query.refetch()}>
        <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm mb-10">
          <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
            <span>الموظفة</span><span>المنصب</span><span>رقم الجوال</span><span>نسبة الحضور</span>
          </div>
          {filtered.map((member) => (
            <div key={member.id} data-testid={`row-staff-${member.id}`} className="grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[1.5fr_1fr_1fr_1fr] md:items-center md:gap-4">
              <div className="flex items-center gap-4">
                <Avatar name={member.name} className="h-11 w-11" />
                <div>
                  <p className="font-bold text-foreground">{member.name}</p>
                  <Pill tone={member.status === 'present' ? 'green' : member.status === 'leave' ? 'blue' : 'red'}>{member.status === 'present' ? 'حاضرة' : member.status === 'leave' ? 'إجازة' : 'غائبة'}</Pill>
                </div>
              </div>
              <div className="text-sm font-bold text-foreground">{member.role}</div>
              <div className="text-sm font-medium text-muted-foreground">{member.phone}</div>
              <div>
                <div className="mb-2 text-xs font-bold">{member.attendanceRate}%</div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${member.attendanceRate}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </QueryState>
      
      <OperationalManager resource="staff-profile" title="ملفات الموظفين الإضافية" icon={GraduationCap} extraFields={[{name: 'staffId', label: 'رقم الموظف', type: 'text'}]} />
      <OperationalManager resource="staff-job" title="المسميات الوظيفية والعقود" icon={Briefcase} extraFields={[{name: 'contractType', label: 'نوع العقد', type: 'text'}]} />
      <OperationalManager resource="staff-leave" title="طلبات الإجازة" icon={Plane} extraFields={[{name: 'days', label: 'عدد الأيام', type: 'number'}]} />
      <OperationalManager resource="payroll" title="مسيرات الرواتب" icon={DollarSign} extraFields={[{name: 'month', label: 'الشهر', type: 'month'}]} />
      <OperationalManager resource="evaluation" title="تقييم الأداء" icon={Star} extraFields={[{name: 'score', label: 'التقييم (من 100)', type: 'number'}, {name: 'reviewer', label: 'المقيّم', type: 'text'}]} />
    </Shell>
  );
}
