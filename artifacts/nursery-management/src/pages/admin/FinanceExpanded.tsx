import { useState, useEffect, useMemo } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetFinanceSummary,
  useListInvoices,
  useCreateInvoiceCheckoutSession,
  useCreateInvoice,
  useListChildren,
  useRecordInvoicePayment,
  useRecordCashInvoicePayment,
  useRefundInvoicePayment,
  useCancelInvoice,
  useSendInvoiceReminder,
  getGetFinanceSummaryQueryKey,
  getListInvoicesQueryKey,
  useListOperationalRecords,
  useListBillingPlans,
  useCreateBillingPlan,
  useUpdateBillingPlanStatus,
  useGenerateNextBillingInstallment,
  getListBillingPlansQueryKey
} from '@workspace/api-client-react';
import { Shell, Button, Pill, StatCard, QueryState, PageHeader, money } from '../../App';
import { Banknote, Wallet, CircleAlert, Check, TrendingUp, CreditCard, FileText, DollarSign, Percent, RefreshCw, Link2, Landmark, X, CalendarClock, Clock3, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Invoice, BillingPlan, BillingPlanInput } from '@workspace/api-client-react';
import { OperationalManager } from '../../components/OperationalManager';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function InvoiceRow({ invoice }: { invoice: Invoice }) { 
  const { toast } = useToast();
  const qc = useQueryClient();
  const checkout = useCreateInvoiceCheckoutSession();
  const cashPayment = useRecordCashInvoicePayment();
  const reminder = useSendInvoiceReminder();
  const internalPayment = useRecordInvoicePayment();
  const refund = useRefundInvoicePayment();
  const cancel = useCancelInvoice();
  const unpaid = invoice.status !== 'paid';
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [cashNote, setCashNote] = useState('');

  const handlePay = () => {
    const returnUrl = `${window.location.origin}${basePath}/finance`;
    checkout.mutate({ id: invoice.id, data: { returnUrl } }, {
      onSuccess: (result) => { window.location.href = result.url; },
      onError: () => toast({ title: 'تعذّر بدء عملية الدفع', description: 'حاول مرة أخرى أو تواصل مع الدعم الفني.', variant: 'destructive' }),
    });
  };

  const handleCashPayment = () => {
    cashPayment.mutate({ id: invoice.id, data: { amount: invoice.amount, note: cashNote || null } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetFinanceSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        setPaymentDialog(false);
        setCashNote('');
        toast({ title: 'تم تسجيل الدفعة النقدية', description: `تم سداد الفاتورة ${invoice.invoiceNumber} بمبلغ ${money(invoice.amount)}.` });
      },
      onError: () => toast({ title: 'تعذّر تسجيل الدفعة', description: 'تحقق من حالة الفاتورة ثم حاول مرة أخرى.', variant: 'destructive' }),
    });
  };

  const handleReminder = () => {
    reminder.mutate({ id: invoice.id }, {
      onSuccess: (result) => toast({ title: result.status === 'sent' ? 'تم إرسال التذكير' : 'تعذّر إرسال التذكير', description: result.message, variant: result.status === 'sent' ? 'default' : 'destructive' }),
      onError: () => toast({ title: 'تعذّر إرسال التذكير', description: 'حدث خطأ غير متوقع أثناء إرسال الإشعار.', variant: 'destructive' }),
    });
  };
  const refresh = () => { qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() }); qc.invalidateQueries({ queryKey: getGetFinanceSummaryQueryKey() }); };
  const internal = () => { const amount = Number(window.prompt('المبلغ المستلم بالدينار')); if (!amount) return; const method = window.prompt('طريقة الدفع: cash أو bank_transfer أو cheque أو card_terminal', 'cash'); if (!['cash','bank_transfer','cheque','card_terminal'].includes(method || '')) return; const reference = window.prompt('مرجع العملية (اختياري)'); internalPayment.mutate({ id: invoice.id, data: { amount, method: method as any, reference: reference || null } }, { onSuccess: (receipt) => { refresh(); window.alert(`تم تسجيل الدفع. رقم الإيصال: ${receipt.receiptNumber}`); }, onError: () => toast({ title: 'تعذر تسجيل الدفع', variant: 'destructive' }) }); };
  const refundPayment = () => { const amount=Number(window.prompt('مبلغ الاسترداد')); const reason=window.prompt('سبب الاسترداد'); if (!amount || !reason) return; refund.mutate({id:invoice.id,data:{amount,reason}}, {onSuccess:refresh,onError:()=>toast({title:'تعذر تسجيل الاسترداد',variant:'destructive'})}); };
  const cancelInvoice = () => { const reason=window.prompt('سبب إلغاء الفاتورة'); if (!reason) return; cancel.mutate({id:invoice.id,data:{reason}},{onSuccess:refresh,onError:()=>toast({title:'تعذر إلغاء الفاتورة',variant:'destructive'})}); };

  return (
    <div data-testid={`row-invoice-${invoice.id}`} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 hover:border-primary/20 transition-colors sm:flex-row sm:items-center">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
        <FileText size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-foreground">{invoice.guardianName}</p>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{invoice.invoiceNumber} · {invoice.childName}</p>
        {invoice.lastPaymentStatus === 'failed' && (
          <p className="mt-1 text-xs font-bold text-destructive">فشلت آخر محاولة دفع{invoice.lastPaymentError ? `: ${invoice.lastPaymentError}` : ''}</p>
        )}
        {invoice.status === 'paid' && invoice.chargedAmount != null && invoice.chargedCurrency && (
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            طريقة الدفع: {invoice.paymentMethod === 'cash' ? 'نقدًا' : invoice.paymentMethod === 'knet' ? 'KNET' : 'رابط دفع'}
            {invoice.paymentReference ? ` · المرجع ${invoice.paymentReference}` : ''}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 sm:text-left">
        <div>
          <p className="text-base font-bold text-foreground mb-1">{money(invoice.amount)}</p>
          <Pill tone={invoice.status === 'paid' ? 'green' : invoice.status === 'overdue' ? 'red' : 'yellow'}>
            {invoice.status === 'paid' ? 'تم السداد' : invoice.status === 'overdue' ? 'متأخرة' : 'قيد الانتظار'}
          </Pill>
        </div>
        {unpaid && (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button data-testid={`button-pay-${invoice.id}`} variant="primary" className="!px-3 !py-2 !text-xs" onClick={() => setPaymentDialog(true)}>
              خيارات الدفع
            </Button>
            <Button data-testid={`button-remind-${invoice.id}`} variant="soft" className="!px-3 !py-2 !text-xs" onClick={handleReminder} disabled={reminder.isPending}>
              {reminder.isPending ? 'جارٍ الإرسال…' : 'إرسال تذكير'}
            </Button>
          </div>
        )}
        <div className="flex gap-1">
          {unpaid && <Button variant="soft" className="!px-2 !py-2 !text-xs" disabled={internalPayment.isPending} onClick={internal}>تحصيل داخلي</Button>}
          {(invoice.status === 'paid' || invoice.status === 'partial') && <Button variant="ghost" className="!px-2 !py-2 !text-xs" disabled={refund.isPending} onClick={refundPayment}>استرداد</Button>}
          {unpaid && invoice.status !== 'cancelled' && <Button variant="ghost" className="!px-2 !py-2 !text-xs text-destructive" disabled={cancel.isPending} onClick={cancelInvoice}>إلغاء</Button>}
          {invoice.status === 'paid' && <Button variant="ghost" className="!px-2 !py-2 !text-xs" onClick={() => window.print()}>طباعة إيصال</Button>}
        </div>
      </div>
      {paymentDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="اختيار طريقة الدفع">
          <div className="w-full max-w-xl rounded-[2rem] border border-border bg-card p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-primary/60">الفاتورة {invoice.invoiceNumber}</p>
                <h2 className="mt-1 text-2xl font-bold">اختاري طريقة الدفع</h2>
                <p className="mt-2 text-sm text-muted-foreground">المبلغ المطلوب: <span className="font-bold text-foreground">{money(invoice.amount)}</span></p>
              </div>
              <button type="button" data-testid={`button-close-payment-options-${invoice.id}`} onClick={() => setPaymentDialog(false)} className="rounded-xl bg-muted p-2.5 text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <button type="button" data-testid={`button-payment-link-${invoice.id}`} onClick={handlePay} disabled={checkout.isPending} className="rounded-2xl border border-border bg-background p-5 text-right transition hover:border-primary hover:bg-secondary/30 disabled:opacity-60">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-secondary text-primary"><Link2 size={20} /></span>
                <span className="mt-4 block font-bold">رابط دفع</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{checkout.isPending ? 'جارٍ إنشاء الرابط…' : 'الانتقال إلى رابط الدفع الإلكتروني'}</span>
              </button>
              <button type="button" data-testid={`button-payment-knet-${invoice.id}`} disabled className="rounded-2xl border border-border bg-muted/40 p-5 text-right opacity-65">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><Landmark size={20} /></span>
                <span className="mt-4 block font-bold">KNET</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">يتفعّل بعد ربط مزوّد KNET</span>
              </button>
              <button type="button" data-testid={`button-payment-cash-${invoice.id}`} onClick={handleCashPayment} disabled={cashPayment.isPending} className="rounded-2xl border border-border bg-background p-5 text-right transition hover:border-primary hover:bg-secondary/30 disabled:opacity-60">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e5efe9] text-[#165032]"><Banknote size={20} /></span>
                <span className="mt-4 block font-bold">نقدًا</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{cashPayment.isPending ? 'جارٍ التسجيل…' : 'تسجيل استلام المبلغ كاملًا'}</span>
              </button>
            </div>

            <label className="mt-5 block text-sm font-bold">
              ملاحظة التحصيل النقدي (اختياري)
              <input data-testid={`input-cash-note-${invoice.id}`} value={cashNote} onChange={(event) => setCashNote(event.target.value)} maxLength={500} placeholder="مثال: استلمها موظف الاستقبال" className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </label>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">تسجيل الدفع النقدي يغيّر حالة الفاتورة إلى «تم السداد» فورًا ويُحفظ في سجل التدقيق.</p>
          </div>
        </div>
      )}
    </div>
  ); 
}

function BillingPlanRow({ plan }: { plan: BillingPlan }) {
  const updateStatus = useUpdateBillingPlanStatus();
  const generateNext = useGenerateNextBillingInstallment();
  const qc = useQueryClient();
  const { toast } = useToast();

  const togglePause = () => {
    updateStatus.mutate({ id: plan.id, data: { status: plan.status === 'paused' ? 'active' : 'paused' } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBillingPlansQueryKey() });
        toast({ title: plan.status === 'paused' ? 'تم استئناف الخطة' : 'تم إيقاف الخطة مؤقتًا' });
      }
    });
  };

  const handleCancel = () => {
    if (!window.confirm('هل أنت متأكد من إلغاء هذه الخطة نهائيًا؟ لن يتم إصدار فواتير جديدة.')) return;
    updateStatus.mutate({ id: plan.id, data: { status: 'cancelled' } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBillingPlansQueryKey() });
        toast({ title: 'تم إلغاء الخطة' });
      }
    });
  };

  const handleGenerateNext = () => {
    generateNext.mutate({ id: plan.id }, {
      onSuccess: (res) => {
        qc.invalidateQueries({ queryKey: getListBillingPlansQueryKey() });
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetFinanceSummaryQueryKey() });
        if (res.generated) {
           toast({ title: 'تم إصدار الفاتورة بنجاح', description: `تم إصدار الفاتورة للقسط القادم.` });
        } else {
           toast({ title: 'لم يتم إصدار أي فاتورة', description: 'لا يوجد قسط مستحق للإصدار في الوقت الحالي أو تم إصداره مسبقًا.' });
        }
      },
      onError: () => toast({ title: 'تعذر إصدار الفاتورة', variant: 'destructive' })
    });
  };

  const nextInstallment = plan.installments?.find(i => i.status === 'scheduled' || i.status === 'issued' || i.status === 'overdue');

  return (
    <div className="flex flex-col gap-4 rounded-[1.5rem] border border-border bg-background p-5 hover:border-primary/20 transition-all lg:flex-row lg:items-center">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
        <CalendarClock size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-bold text-foreground">{plan.title}</h3>
          <Pill tone={plan.status === 'active' ? 'green' : plan.status === 'paused' ? 'yellow' : plan.status === 'completed' ? 'blue' : 'neutral'}>
            {plan.status === 'active' ? 'نشطة' : plan.status === 'paused' ? 'موقوفة' : plan.status === 'completed' ? 'مكتملة' : 'ملغاة'}
          </Pill>
        </div>
        <p className="mt-1 text-xs font-medium text-muted-foreground">{plan.childName} · {plan.guardianName}</p>
        <p className="mt-1.5 text-xs font-medium text-primary flex items-center gap-2">
          {plan.cadence === 'monthly' ? 'شهري' : plan.cadence === 'quarterly' ? 'ربع سنوي' : plan.cadence === 'once' ? 'دفعة واحدة' : 'مخصص'} · {plan.installmentCount} أقساط
          {nextInstallment && (
            <span className="flex items-center gap-1 bg-accent/20 px-2 py-0.5 rounded text-accent-foreground font-bold">
              <Clock3 size={12}/> القسط {nextInstallment.sequence} المجدول في {new Date(nextInstallment.dueDate).toLocaleDateString('en-GB')}
            </span>
          )}
        </p>
      </div>
      
      <div className="flex-1 flex flex-col justify-center px-4 border-y lg:border-y-0 lg:border-x border-border/50 py-3 lg:py-0">
        <div className="w-full flex justify-between text-xs mb-1.5 font-bold">
          <span className="text-primary">التحصيل: {money(plan.collectedAmount)}</span>
          <span className="text-muted-foreground">المتبقي: {money(plan.remainingAmount)}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (plan.collectedAmount / Math.max(1, plan.netAmount)) * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground font-bold">الإجمالي الصافي: {money(plan.netAmount)}</p>
      </div>

      <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col lg:items-end">
        {plan.status === 'active' && (
          <Button variant="soft" className="!py-2 !px-3 !text-xs w-full sm:w-auto" onClick={handleGenerateNext} disabled={generateNext.isPending}>
             إصدار القسط يدويًا
          </Button>
        )}
        <div className="flex gap-2 w-full sm:w-auto">
          {(plan.status === 'active' || plan.status === 'paused') && (
            <Button variant="ghost" className="!py-2 !px-3 !text-xs flex-1 lg:flex-none" onClick={togglePause} disabled={updateStatus.isPending}>
              {plan.status === 'paused' ? 'استئناف' : 'إيقاف مؤقت'}
            </Button>
          )}
          {(plan.status === 'active' || plan.status === 'paused') && (
            <Button variant="ghost" className="!py-2 !px-3 !text-xs text-destructive flex-1 lg:flex-none" onClick={handleCancel} disabled={updateStatus.isPending}>
              إلغاء نهائي
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function BillingPlanManager() {
  const query = useListBillingPlans();
  const plans = query.data || [];
  const [showCreate, setShowCreate] = useState(false);

  return (
    <section className="mb-8 rounded-[2rem] border border-border bg-card p-8 shadow-sm">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">خطط التقسيط والرسوم المجدولة</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">إدارة الاشتراكات وإصدار الفواتير التلقائي</p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => setShowCreate(true)}><Plus size={18} /> خطة جديدة</Button>
        </div>
      </div>
      
      <QueryState loading={query.isLoading} error={query.isError} empty={!plans.length} onRetry={() => query.refetch()}>
        <div className="grid gap-4 max-h-[500px] overflow-y-auto pr-2">
          {plans.map((plan: BillingPlan) => <BillingPlanRow key={plan.id} plan={plan} />)}
        </div>
      </QueryState>
      
      {showCreate && <BillingPlanCreateModal onClose={() => setShowCreate(false)} />}
    </section>
  );
}

function BillingPlanCreateModal({ onClose }: { onClose: () => void }) {
  const childrenQuery = useListChildren();
  const create = useCreateBillingPlan();
  const qc = useQueryClient();
  const { toast } = useToast();
  
  const [childId, setChildId] = useState('');
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState<'once'|'monthly'|'quarterly'|'custom'>('monthly');
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [installmentCount, setInstallmentCount] = useState<number>(1);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [issueLeadDays, setIssueLeadDays] = useState<number>(7);
  
  const [customLines, setCustomLines] = useState([{ amount: 0, dueDate: new Date().toISOString().slice(0, 10) }]);
  
  const netAmount = Math.max(0, totalAmount - discountAmount);
  
  const previewDates = useMemo(() => {
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
    const shiftDays = (value: string, days: number) => {
      if (!validDate(value)) return '';
      const date = new Date(`${value}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    if (cadence === 'custom') {
      return customLines.map((line, i) => ({
        sequence: i + 1,
        dueDate: validDate(line.dueDate) ? line.dueDate : '',
        issueDate: shiftDays(line.dueDate, -issueLeadDays),
        amount: line.amount,
      }));
    }
    if (installmentCount < 1 || !validDate(startDate)) return [];
    const base = new Date(`${startDate}T00:00:00.000Z`);
    const totalFils = Math.round(netAmount * 1000);
    const regularFils = Math.floor(totalFils / installmentCount);
    return Array.from({ length: installmentCount }).map((_, i) => {
      const months = cadence === 'monthly' ? i : cadence === 'quarterly' ? i * 3 : 0;
      const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
      const monthEnd = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      first.setUTCDate(Math.min(base.getUTCDate(), monthEnd));
      const dueDate = first.toISOString().slice(0, 10);
      const amountFils = i === installmentCount - 1
        ? totalFils - regularFils * (installmentCount - 1)
        : regularFils;
      return { sequence: i + 1, dueDate, issueDate: shiftDays(dueDate, -issueLeadDays), amount: amountFils / 1000 };
    });
  }, [cadence, customLines, installmentCount, startDate, netAmount, issueLeadDays]);

  const totalCustomAmount = customLines.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!childId) return;
    
    const payload: BillingPlanInput = {
      childId: Number(childId),
      title,
      cadence: cadence as any,
      totalAmount: cadence === 'custom' ? totalCustomAmount : totalAmount,
      discountAmount: cadence === 'custom' ? 0 : discountAmount,
      installmentCount: cadence === 'custom' ? customLines.length : installmentCount,
      startDate: cadence === 'custom' ? customLines[0]?.dueDate || startDate : startDate,
      issueLeadDays,
      customInstallments: cadence === 'custom' ? customLines.map(l => ({ amount: Number(l.amount), dueDate: l.dueDate })) : undefined
    };
    
    create.mutate({ data: payload }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBillingPlansQueryKey() });
        toast({ title: 'تم إنشاء الخطة بنجاح' });
        onClose();
      },
      onError: () => toast({ title: 'تعذر إنشاء الخطة', variant: 'destructive' })
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] bg-card shadow-2xl flex flex-col md:flex-row">
        <div className="p-8 md:w-1/2 border-b md:border-b-0 md:border-l border-border flex flex-col gap-5">
           <div className="flex justify-between items-center mb-2">
             <h2 className="text-xl font-bold">إنشاء خطة دفع جديدة</h2>
             <button type="button" onClick={onClose} className="md:hidden p-2"><X size={20}/></button>
           </div>
           
           <label className="font-bold text-sm block">الطفل
             <select required value={childId} onChange={e => setChildId(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background p-3 outline-none focus:border-primary">
               <option value="">اختر الطفل</option>
               {(childrenQuery.data || []).map(c => <option value={c.id} key={c.id}>{c.fullName}</option>)}
             </select>
           </label>
           
           <label className="font-bold text-sm block">عنوان الخطة <span className="text-muted-foreground font-normal">(مثال: رسوم العام الدراسي)</span>
             <input required value={title} onChange={e => setTitle(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background p-3 outline-none focus:border-primary"/>
           </label>

           <div className="grid grid-cols-2 gap-4">
             <label className="font-bold text-sm block">وتيرة الأقساط
               <select value={cadence} onChange={e => {
                  setCadence(e.target.value as any);
                  if (e.target.value === 'once') setInstallmentCount(1);
               }} className="mt-2 w-full rounded-xl border border-input bg-background p-3 outline-none focus:border-primary">
                 <option value="once">دفعة واحدة</option>
                 <option value="monthly">شهري</option>
                 <option value="quarterly">ربع سنوي</option>
                 <option value="custom">مخصص</option>
               </select>
             </label>
             <label className="font-bold text-sm block">إصدار الفاتورة قبل (أيام)
               <input type="number" min="0" required value={issueLeadDays} onChange={e => setIssueLeadDays(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-input bg-background p-3 outline-none focus:border-primary"/>
             </label>
           </div>

           {cadence !== 'custom' && (
             <>
               <div className="grid grid-cols-2 gap-4">
                 <label className="font-bold text-sm block">الإجمالي الأساسي
                   <input type="number" min="1" step="0.001" required value={totalAmount || ''} onChange={e => setTotalAmount(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-input bg-background p-3 outline-none focus:border-primary"/>
                 </label>
                 <label className="font-bold text-sm block">مبلغ الخصم
                   <input type="number" min="0" step="0.001" required value={discountAmount || ''} onChange={e => setDiscountAmount(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-input bg-background p-3 outline-none focus:border-primary"/>
                 </label>
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                 <label className="font-bold text-sm block">عدد الأقساط
                   <input type="number" min="1" max="36" required value={installmentCount || ''} onChange={e => setInstallmentCount(Number(e.target.value))} disabled={cadence === 'once'} className="mt-2 w-full rounded-xl border border-input bg-background p-3 outline-none focus:border-primary"/>
                 </label>
                 <label className="font-bold text-sm block">تاريخ أول قسط
                   <input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background p-3 outline-none focus:border-primary"/>
                 </label>
               </div>
             </>
           )}

           {cadence === 'custom' && (
             <div className="space-y-3 mt-2">
               <div className="flex justify-between items-center">
                 <p className="font-bold text-sm text-primary">الأقساط المخصصة</p>
                 <Button type="button" variant="soft" className="!p-1.5" onClick={() => setCustomLines([...customLines, { amount: 0, dueDate: startDate }])}><Plus size={16}/> إضافة</Button>
               </div>
               <div className="max-h-[250px] overflow-y-auto space-y-2 pr-2">
                 {customLines.map((line, i) => (
                   <div key={i} className="flex gap-2 items-center">
                     <div className="grid grid-cols-2 gap-2 flex-1">
                       <input type="number" min="0" step="0.001" required placeholder="المبلغ" value={line.amount || ''} onChange={e => setCustomLines(customLines.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} className="w-full rounded-xl border border-input bg-background p-2 text-sm outline-none focus:border-primary"/>
                       <input type="date" required value={line.dueDate} onChange={e => setCustomLines(customLines.map((x, j) => j === i ? { ...x, dueDate: e.target.value } : x))} className="w-full rounded-xl border border-input bg-background p-2 text-sm outline-none focus:border-primary"/>
                     </div>
                     <Button type="button" variant="ghost" className="!p-2 text-destructive shrink-0" disabled={customLines.length === 1} onClick={() => setCustomLines(customLines.filter((_, j) => j !== i))}><X size={16}/></Button>
                   </div>
                 ))}
               </div>
             </div>
           )}
        </div>
        
        <div className="p-8 md:w-1/2 bg-secondary/20 flex flex-col justify-between">
           <div>
             <div className="flex justify-between items-center mb-6">
               <h3 className="font-bold text-lg text-foreground">معاينة الجدول الزمني</h3>
               <button type="button" onClick={onClose} className="hidden md:block p-2 text-muted-foreground hover:text-foreground"><X size={20}/></button>
             </div>
             
             <div className="bg-card rounded-2xl border border-border p-5 shadow-sm mb-6 flex flex-col gap-1">
               <p className="text-xs font-bold text-muted-foreground">إجمالي الخطة (الصافي)</p>
               <p className="text-3xl font-bold text-primary">{money(cadence === 'custom' ? totalCustomAmount : netAmount)}</p>
             </div>

             <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
               {previewDates.map((p: any) => (
                 <div key={p.sequence} className="flex justify-between items-center bg-card rounded-xl p-3 border border-border/50 text-sm shadow-sm">
                   <span className="flex items-center gap-3">
                     <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary text-primary text-[10px] font-bold">{p.sequence}</span>
                     <span className="font-bold text-foreground">{money(p.amount)}</span>
                   </span>
                    <span className="text-left font-medium text-muted-foreground" dir="ltr">
                      <span className="block">{p.dueDate ? new Date(`${p.dueDate}T00:00:00`).toLocaleDateString('en-GB') : '—'}</span>
                      <span className="block text-[10px]">الإصدار: {p.issueDate ? new Date(`${p.issueDate}T00:00:00`).toLocaleDateString('en-GB') : '—'}</span>
                    </span>
                 </div>
               ))}
             </div>
           </div>
           
           <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-border">
             <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
             <Button type="submit" disabled={create.isPending || (cadence === 'custom' ? totalCustomAmount === 0 : netAmount <= 0) || !childId}>
               {create.isPending ? 'جارٍ الإنشاء...' : 'اعتماد الخطة'}
             </Button>
           </div>
        </div>
      </form>
    </div>
  );
}

export function FinanceExpanded() {
  const summary = useGetFinanceSummary(); 
  const invoiceQuery = useListInvoices(); 
  
  const opQuery = useListOperationalRecords('expense');
  const operations = opQuery.data || [];
  const expenses = operations.filter(o => o.resource === 'expense');
  
  const invoices = invoiceQuery.data || []; 
  const data = summary.data;
  const qc = useQueryClient(); 
  const { toast } = useToast();
  const search = useSearch(); 
  const [, setLocation] = useLocation();
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const payment = params.get('payment');
    const invoiceId = params.get('invoice');
    if (!payment) return;

    if (payment === 'success') {
      toast({ title: 'جارٍ تأكيد الدفع…', description: 'سيتم تحديث حالة الفاتورة فور استلام تأكيد الدفع من stripe.' });
      const timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: getGetFinanceSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      }, 2500);
      setLocation('/finance', { replace: true });
      return () => clearTimeout(timer);
    }
    if (payment === 'cancelled') {
      toast({ title: 'تم إلغاء عملية الدفع', description: invoiceId ? `لم تكتمل عملية سداد الفاتورة رقم ${invoiceId}.` : undefined, variant: 'destructive' });
      setLocation('/finance', { replace: true });
    }
    return undefined;
  }, [search, qc, setLocation, toast]);

  return (
    <Shell>
      <PageHeader eyebrow="حضانة EC / الإدارة المالية" title="المالية والتحصيل" description="صورة دقيقة للمدفوعات المتأخرة والتدفقات النقدية والمصروفات التشغيلية." action={<Button onClick={() => setShowCreate(true)}><FileText size={18} />إنشاء فاتورة</Button>} />
      
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 mb-8">
        <StatCard icon={Banknote} label="المحصّل هذا الشهر" value={money(data?.collectedThisMonth ?? 0)} detail="أداء ممتاز" tone="teal" />
        <StatCard icon={Wallet} label="إجمالي المتأخرات" value={money(data?.outstanding ?? 0)} tone="gold" />
        <StatCard icon={CircleAlert} label="فواتير متأخرة الدفع" value={`${data?.overdueCount ?? 0}`} tone="coral" />
        <StatCard icon={Check} label="فواتير مسددة بالكامل" value={`${data?.paidCount ?? 0}`} tone="sage" />
      </div>
      
      <div className="grid gap-8 xl:grid-cols-[1.2fr_1fr] mb-8">
        <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm flex flex-col">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">مسار التحصيل المالي</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">مقارنة التحصيل بالمستهدف الشهري</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e5efe9] text-[#165032]"><TrendingUp size={20} /></span>
          </div>
          
          <div className="flex h-64 flex-1 items-end gap-4 border-b border-border pb-2">
            {(data?.monthlyTrend || []).map((m) => (
              <div key={m.month} className="group flex flex-1 flex-col items-center gap-3">
                <div className="relative flex h-full w-full items-end justify-center gap-1.5">
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
        
        <div className="flex flex-col gap-8">
          <section className="flex-1 rounded-[2rem] border border-border bg-card p-8 shadow-sm">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-foreground">السجل الحديث للفواتير</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">حالة السداد لأحدث المطالبات</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><CreditCard size={20} /></span>
            </div>
            
            <QueryState loading={invoiceQuery.isLoading} error={invoiceQuery.isError} empty={!invoices.length} onRetry={() => invoiceQuery.refetch()}>
              <div className="space-y-5 max-h-[400px] overflow-y-auto pr-2">
                {invoices.slice(0, 5).map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} />)}
              </div>
            </QueryState>
          </section>
          
          <section className="flex-1 rounded-[2rem] border border-border bg-card p-8 shadow-sm">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-foreground">آخر المصروفات المعتمدة</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">عرض سريع للمصروفات</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-red-100 text-red-700"><Wallet size={20} /></span>
            </div>
            
            <QueryState loading={opQuery.isLoading} error={opQuery.isError} empty={!expenses.length} onRetry={() => opQuery.refetch()}>
              <div className="space-y-5 max-h-[250px] overflow-y-auto pr-2">
                {expenses.slice(0, 4).map((exp) => (
                  <div key={exp.id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">{exp.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{new Date(exp.createdAt).toLocaleDateString('ar-SA')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-bold text-destructive">-{money(exp.amount || 0)}</p>
                      <Pill tone={exp.status === 'approved' ? 'green' : 'yellow'}>{exp.status === 'approved' ? 'معتمد' : 'معلق'}</Pill>
                    </div>
                  </div>
                ))}
              </div>
            </QueryState>
          </section>
        </div>
      </div>
      
      <BillingPlanManager />
      
      <OperationalManager resource="fee-plan" title="خطط الرسوم الدراسية" icon={DollarSign} extraFields={[{name: 'period', label: 'الفترة', type: 'text'}]} />
      <OperationalManager resource="discount" title="الخصومات والمنح" icon={Percent} extraFields={[{name: 'percentage', label: 'النسبة %', type: 'number'}]} />
      <OperationalManager resource="refund" title="طلبات الاسترداد" icon={RefreshCw} extraFields={[{name: 'reason', label: 'السبب', type: 'text'}]} />
      <OperationalManager resource="expense" title="المصروفات التشغيلية" icon={Wallet} extraFields={[{name: 'category', label: 'التصنيف', type: 'text'}]} />
      <OperationalManager resource="revenue" title="الإيرادات الإضافية" icon={Banknote} extraFields={[{name: 'source', label: 'المصدر', type: 'text'}]} />
       {showCreate && <InvoiceCreateModal onClose={() => setShowCreate(false)} />}
    </Shell>
  );
}

function InvoiceCreateModal({ onClose }: { onClose: () => void }) {
 const childrenQuery=useListChildren(); const create=useCreateInvoice(); const qc=useQueryClient();
 const [childId,setChildId]=useState(''); const [dueDate,setDueDate]=useState(new Date().toISOString().slice(0,10)); const [status,setStatus]=useState<'draft'|'issued'>('issued');
 const [lines,setLines]=useState([{type:'fee',description:'رسوم دراسية',quantity:1,unitAmount:0}]);
 const total=lines.reduce((sum,l)=>sum+(l.type==='discount'?-1:1)*l.quantity*l.unitAmount,0);
 const submit=(e:React.FormEvent)=>{e.preventDefault(); create.mutate({data:{childId:Number(childId),dueDate,status,lines:lines.map(l=>({...l,type:l.type as any}))}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListInvoicesQueryKey()});qc.invalidateQueries({queryKey:getGetFinanceSummaryQueryKey()});onClose()}})};
 return <div className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-4 backdrop-blur-md"><form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-card p-8 shadow-2xl"><h2 className="mb-5 text-xl font-bold">إنشاء فاتورة تفصيلية</h2><div className="grid gap-4 sm:grid-cols-2"><label className="font-bold text-sm">الطفل<select required value={childId} onChange={e=>setChildId(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background p-3"><option value="">اختر الطفل</option>{(childrenQuery.data||[]).map(c=><option value={c.id} key={c.id}>{c.fullName}</option>)}</select></label><label className="font-bold text-sm">تاريخ الاستحقاق<input required type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background p-3"/></label></div><div className="mt-5 space-y-3">{lines.map((line,i)=><div className="grid grid-cols-[.8fr_2fr_.7fr_.9fr_auto] gap-2" key={i}><select value={line.type} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,type:e.target.value}:x))} className="rounded-xl border p-2"><option value="fee">رسوم</option><option value="addon">إضافة</option><option value="discount">خصم</option></select><input required placeholder="الوصف" value={line.description} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,description:e.target.value}:x))} className="rounded-xl border p-2"/><input required min="1" type="number" value={line.quantity} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,quantity:Number(e.target.value)}:x))} className="rounded-xl border p-2"/><input required min="0" step=".001" type="number" value={line.unitAmount} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,unitAmount:Number(e.target.value)}:x))} className="rounded-xl border p-2"/><Button type="button" variant="ghost" className="!p-2" disabled={lines.length===1} onClick={()=>setLines(lines.filter((_,j)=>j!==i))}>×</Button></div>)}</div><Button type="button" variant="soft" className="mt-3" onClick={()=>setLines([...lines,{type:'fee',description:'',quantity:1,unitAmount:0}])}>إضافة بند</Button><p className="mt-4 font-bold">الإجمالي: {money(total)}</p><label className="mt-3 block font-bold text-sm">الحالة<select value={status} onChange={e=>setStatus(e.target.value as any)} className="mr-3 rounded-xl border p-2"><option value="issued">إصدار الآن</option><option value="draft">مسودة</option></select></label>{create.isError&&<p className="mt-3 text-sm text-destructive">تعذر إنشاء الفاتورة.</p>}<div className="mt-7 flex justify-end gap-3"><Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button><Button disabled={create.isPending}>{create.isPending?'جارٍ الإنشاء...':'إنشاء الفاتورة'}</Button></div></form></div>
}
