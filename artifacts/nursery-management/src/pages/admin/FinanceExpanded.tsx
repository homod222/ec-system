import { useState, useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetFinanceSummary,
  useListInvoices,
  useCreateInvoiceCheckoutSession,
  useSendInvoiceReminder,
  getGetFinanceSummaryQueryKey,
  getListInvoicesQueryKey,
  useListOperationalRecords
} from '@workspace/api-client-react';
import { Shell, Button, Pill, StatCard, QueryState, PageHeader, money } from '../../App';
import { Banknote, Wallet, CircleAlert, Check, TrendingUp, CreditCard, FileText, DollarSign, Percent, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Invoice } from '@workspace/api-client-react';
import { OperationalManager } from '../../components/OperationalManager';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function InvoiceRow({ invoice }: { invoice: Invoice }) { 
  const { toast } = useToast();
  const checkout = useCreateInvoiceCheckoutSession();
  const reminder = useSendInvoiceReminder();
  const unpaid = invoice.status !== 'paid';

  const handlePay = () => {
    const returnUrl = `${window.location.origin}${basePath}/finance`;
    checkout.mutate({ id: invoice.id, data: { returnUrl } }, {
      onSuccess: (result) => { window.location.href = result.url; },
      onError: () => toast({ title: 'تعذّر بدء عملية الدفع', description: 'حاول مرة أخرى أو تواصل مع الدعم الفني.', variant: 'destructive' }),
    });
  };

  const handleReminder = () => {
    reminder.mutate({ id: invoice.id }, {
      onSuccess: (result) => toast({ title: result.status === 'sent' ? 'تم إرسال التذكير' : 'تعذّر إرسال التذكير', description: result.message, variant: result.status === 'sent' ? 'default' : 'destructive' }),
      onError: () => toast({ title: 'تعذّر إرسال التذكير', description: 'حدث خطأ غير متوقع أثناء إرسال الإشعار.', variant: 'destructive' }),
    });
  };

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
          <p className="mt-1 text-xs font-medium text-muted-foreground">تم التحصيل عبر Stripe: {invoice.chargedAmount} {invoice.chargedCurrency.toUpperCase()}</p>
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
            <Button data-testid={`button-pay-${invoice.id}`} variant="primary" className="!px-3 !py-2 !text-xs" onClick={handlePay} disabled={checkout.isPending}>
              {checkout.isPending ? 'جارٍ التحويل…' : 'دفع الآن'}
            </Button>
            <Button data-testid={`button-remind-${invoice.id}`} variant="soft" className="!px-3 !py-2 !text-xs" onClick={handleReminder} disabled={reminder.isPending}>
              {reminder.isPending ? 'جارٍ الإرسال…' : 'إرسال تذكير'}
            </Button>
          </div>
        )}
      </div>
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
      <PageHeader eyebrow="حضانة EC / الإدارة المالية" title="المالية والتحصيل" description="صورة دقيقة للمدفوعات المتأخرة والتدفقات النقدية والمصروفات التشغيلية." action={<Button data-testid="button-finance-export" variant="soft"><FileText size={18} />إصدار تقرير المحاسبة</Button>} />
      
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
      
      <OperationalManager resource="fee-plan" title="خطط الرسوم الدراسية" icon={DollarSign} extraFields={[{name: 'period', label: 'الفترة', type: 'text'}]} />
      <OperationalManager resource="discount" title="الخصومات والمنح" icon={Percent} extraFields={[{name: 'percentage', label: 'النسبة %', type: 'number'}]} />
      <OperationalManager resource="refund" title="طلبات الاسترداد" icon={RefreshCw} extraFields={[{name: 'reason', label: 'السبب', type: 'text'}]} />
      <OperationalManager resource="expense" title="المصروفات التشغيلية" icon={Wallet} extraFields={[{name: 'category', label: 'التصنيف', type: 'text'}]} />
      <OperationalManager resource="revenue" title="الإيرادات الإضافية" icon={Banknote} extraFields={[{name: 'source', label: 'المصدر', type: 'text'}]} />
    </Shell>
  );
}
