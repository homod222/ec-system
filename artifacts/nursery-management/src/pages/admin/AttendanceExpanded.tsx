import { useState, useMemo } from 'react';
import { useGetTodayAttendance, useListStaffAttendance, useListStaff, useRecordAttendance, useRecordStaffAttendance, getGetTodayAttendanceQueryKey, getListStaffAttendanceQueryKey } from '@workspace/api-client-react';
import { Shell, Button, Pill, Avatar, Skeleton, QueryState, PageHeader } from '../../App';
import { CalendarCheck, Users, Search, Activity, UserCheck, Plus, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export function AttendanceExpanded() {
  const [tab, setTab] = useState<'children' | 'staff'>('children');
  const today = new Date().toISOString().slice(0, 10);
  
  const childrenQuery = useGetTodayAttendance();
  const childrenData = childrenQuery.data || [];
  
  const staffQuery = useListStaffAttendance({ dateFrom: today, dateTo: today });
  const staffData = staffQuery.data || [];
  
  const staffListQuery = useListStaff();
  const staffList = staffListQuery.data || [];
  const staffMap = useMemo(() => new Map(staffList.map(s => [s.id, s.name])), [staffList]);
  
  const [showStaffForm, setShowStaffForm] = useState(false);
  const recordChild = useRecordAttendance();
  const qc = useQueryClient();

  const setChildStatus = (record: (typeof childrenData)[number], status: 'present' | 'absent' | 'late' | 'excused', earlyDeparture = false) => {
    const now = new Date().toISOString();
    recordChild.mutate({
      data: {
        childId: record.childId,
        date: today,
        status,
        checkIn: status === 'present' || status === 'late' ? (record.checkIn || now) : null,
        checkOut: earlyDeparture ? now : record.checkOut,
        departureType: earlyDeparture ? 'early' : record.departureType,
        source: 'manual',
        note: record.note || null,
      },
    }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetTodayAttendanceQueryKey() }),
    });
  };

  return (
    <Shell>
      <PageHeader 
        eyebrow="السجلات اليومية" 
        title="الحضور والانصراف" 
        description="متابعة الحضور للأطفال والكادر الوظيفي وتسجيل الغياب والتأخير."
      />
      
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex gap-4">
          <Button data-testid="tab-children" variant={tab === 'children' ? 'primary' : 'soft'} onClick={() => setTab('children')}>
            <Users size={18} /> سجل الأطفال
          </Button>
          <Button data-testid="tab-staff" variant={tab === 'staff' ? 'primary' : 'soft'} onClick={() => setTab('staff')}>
            <UserCheck size={18} /> سجل الكادر
          </Button>
        </div>
        {tab === 'staff' && (
          <Button data-testid="button-add-staff-attendance" onClick={() => setShowStaffForm(true)}>
            <Plus size={18} />تسجيل حضور يدوي
          </Button>
        )}
      </div>

      {tab === 'children' && (
        <QueryState loading={childrenQuery.isLoading} error={childrenQuery.isError} empty={!childrenData.length} onRetry={() => childrenQuery.refetch()}>
          <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
            <div className="hidden grid-cols-[1.3fr_.7fr_.8fr_2fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
              <span>الطفل</span><span>الحالة</span><span>وقت الدخول</span><span>التسجيل اليدوي</span>
            </div>
            {childrenData.map((record) => (
              <div key={record.childId} data-testid={`row-attendance-child-${record.childId}`} className="grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[1.3fr_.7fr_.8fr_2fr] md:items-center md:gap-4">
                <div className="flex items-center gap-4">
                  <Avatar name={record.childName} className="h-10 w-10" />
                  <span className="font-bold text-foreground">{record.childName}</span>
                </div>
                <div>
                  <Pill tone={record.status === 'present' ? 'green' : record.status === 'absent' ? 'red' : record.status === 'late' ? 'yellow' : 'neutral'}>
                    {record.status === 'present' ? 'حاضر' : record.status === 'absent' ? 'غائب' : record.status === 'late' ? 'متأخر' : 'عذر'}
                  </Pill>
                </div>
                <div className="text-sm font-medium text-muted-foreground">{record.checkIn ? new Date(record.checkIn).toLocaleTimeString('ar-SA') : '-'}</div>
                <div className="flex flex-wrap gap-1.5">
                  <button data-testid={`button-child-present-${record.childId}`} onClick={() => setChildStatus(record, 'present')} disabled={recordChild.isPending} className="rounded-lg bg-emerald-100 px-2.5 py-1.5 text-xs font-bold text-emerald-800">حاضر</button>
                  <button data-testid={`button-child-late-${record.childId}`} onClick={() => setChildStatus(record, 'late')} disabled={recordChild.isPending} className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-bold text-amber-800">متأخر</button>
                  <button data-testid={`button-child-absent-${record.childId}`} onClick={() => setChildStatus(record, 'absent')} disabled={recordChild.isPending} className="rounded-lg bg-red-100 px-2.5 py-1.5 text-xs font-bold text-red-800">غائب</button>
                  <button data-testid={`button-child-excused-${record.childId}`} onClick={() => setChildStatus(record, 'excused')} disabled={recordChild.isPending} className="rounded-lg bg-sky-100 px-2.5 py-1.5 text-xs font-bold text-sky-800">بعذر</button>
                  <button data-testid={`button-child-early-${record.childId}`} onClick={() => setChildStatus(record, record.status, true)} disabled={recordChild.isPending || !record.checkIn} className="rounded-lg bg-orange-100 px-2.5 py-1.5 text-xs font-bold text-orange-800 disabled:opacity-40">انصراف مبكر</button>
                </div>
              </div>
            ))}
          </div>
        </QueryState>
      )}

      {tab === 'staff' && (
        <QueryState loading={staffQuery.isLoading} error={staffQuery.isError} empty={!staffData.length} onRetry={() => staffQuery.refetch()}>
          <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
             <div className="hidden grid-cols-[1.5fr_1fr_1.5fr_1fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
              <span>الموظف</span><span>الحالة</span><span>الدخول / الخروج</span><span>المسجل</span>
            </div>
            {staffData.map((record) => (
              <div key={record.id} data-testid={`row-attendance-staff-${record.id}`} className="grid gap-3 border-b border-border px-6 py-5 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[1.5fr_1fr_1.5fr_1fr] md:items-center md:gap-4">
                <div className="flex items-center gap-4">
                  <Avatar name={staffMap.get(record.staffId) || `ID: ${record.staffId}`} className="h-10 w-10" />
                  <span className="font-bold text-foreground">{staffMap.get(record.staffId) || `الموظف ${record.staffId}`}</span>
                </div>
                <div>
                  <Pill tone={record.status === 'present' ? 'green' : record.status === 'absent' ? 'red' : record.status === 'late' ? 'yellow' : 'blue'}>
                    {record.status === 'present' ? 'حاضر' : record.status === 'absent' ? 'غائب' : record.status === 'late' ? 'تأخير' : 'إجازة'}
                  </Pill>
                  {record.departureType === 'early' && <span className="mr-2 text-xs font-bold text-orange-600">انصراف مبكر</span>}
                </div>
                <div className="text-sm font-medium text-muted-foreground">
                  <div dir="ltr" className="text-right">
                    <span className="text-primary">{record.checkIn ? new Date(record.checkIn).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'}) : '-'}</span>
                    <span className="mx-2">→</span>
                    <span>{record.checkOut ? new Date(record.checkOut).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'}) : '-'}</span>
                  </div>
                </div>
                <div className="text-sm font-medium text-muted-foreground">{record.recordedBy}</div>
              </div>
            ))}
          </div>
        </QueryState>
      )}
      
      {showStaffForm && <StaffAttendanceForm staff={staffList} onClose={() => setShowStaffForm(false)} />}
    </Shell>
  );
}

function StaffAttendanceForm({ staff, onClose }: { staff: any[], onClose: () => void }) {
  const [form, setForm] = useState({ 
    staffId: '', 
    status: 'present', 
    checkInTime: '07:00',
    checkOutTime: '',
    departureType: 'normal',
    note: ''
  });
  
  const create = useRecordStaffAttendance();
  const qc = useQueryClient();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.staffId) return alert('الرجاء اختيار الموظف');
    
    const today = new Date().toISOString().slice(0, 10);
    const checkIn = form.checkInTime ? new Date(`${today}T${form.checkInTime}:00`).toISOString() : null;
    const checkOut = form.checkOutTime ? new Date(`${today}T${form.checkOutTime}:00`).toISOString() : null;
    
    create.mutate({ 
      data: { 
        staffId: Number(form.staffId), 
        date: today,
        status: form.status as any,
        checkIn: checkIn,
        checkOut: checkOut,
        departureType: form.departureType as any,
        source: 'manual',
        note: form.note || null
      } 
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListStaffAttendanceQueryKey() });
        onClose();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md animate-in fade-in">
      <form onSubmit={submit} className="w-full max-w-md rounded-[2rem] border border-border bg-card p-8 shadow-2xl animate-rise">
        <div className="mb-6 flex justify-between items-center">
          <h2 className="text-xl font-bold">تسجيل حضور / انصراف كادر</h2>
          <Button data-testid="button-close-staff-attendance" type="button" variant="ghost" onClick={onClose} className="!p-2"><X size={20} /></Button>
        </div>
        <div className="space-y-4">
          <label className="block text-sm font-bold">الموظف
            <select required data-testid="select-staff-id" value={form.staffId} onChange={(e) => setForm({...form, staffId: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none">
              <option value="">اختر الموظف...</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold">الحالة
            <select data-testid="select-staff-status" value={form.status} onChange={(e) => setForm({...form, status: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none">
              <option value="present">حاضر</option>
              <option value="late">تأخير</option>
              <option value="absent">غائب</option>
              <option value="leave">إجازة</option>
            </select>
          </label>
          
          {(form.status === 'present' || form.status === 'late') && (
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm font-bold">وقت الدخول
                <input type="time" data-testid="input-staff-checkin" value={form.checkInTime} onChange={(e) => setForm({...form, checkInTime: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" />
              </label>
              <label className="block text-sm font-bold">وقت الخروج (اختياري)
                <input type="time" data-testid="input-staff-checkout" value={form.checkOutTime} onChange={(e) => setForm({...form, checkOutTime: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none" />
              </label>
            </div>
          )}
          
          {form.checkOutTime && (
            <label className="block text-sm font-bold">نوع الانصراف
              <select data-testid="select-staff-departure" value={form.departureType} onChange={(e) => setForm({...form, departureType: e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 outline-none">
                <option value="normal">طبيعي</option>
                <option value="early">مبكر (استئذان)</option>
              </select>
            </label>
          )}
          
          <label className="block text-sm font-bold">ملاحظات
            <textarea data-testid="input-staff-note" rows={2} value={form.note} onChange={(e) => setForm({...form, note: e.target.value})} className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 outline-none" />
          </label>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <Button data-testid="button-cancel-staff-attendance" type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button type="submit" disabled={create.isPending} data-testid="button-submit-staff-attendance">{create.isPending ? 'جارٍ التسجيل...' : 'تسجيل السجل'}</Button>
        </div>
      </form>
    </div>
  );
}
