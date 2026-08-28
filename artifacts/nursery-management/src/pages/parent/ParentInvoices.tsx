import { useCreateParentInvoiceCheckoutSession, useListParentInvoices, useListParentBillingPlans, getListParentBillingPlansQueryKey } from '@workspace/api-client-react';
import { ParentShell } from '../../components/ParentShell';
import { ParentPageHeader, ParentQueryState } from '../../components/ParentShared';
import { CreditCard, FileText, CheckCircle2, AlertCircle, Clock, CalendarClock } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { useEffect } from 'react';
import type { BillingPlan } from '@workspace/api-client-react';
import { useI18n } from '../../i18n';

function ParentBillingPlanCard({ plan }: { plan: BillingPlan }) {
  const { t, formatCurrency, formatDate, dir } = useI18n();
  const progress = Math.min(100, (plan.collectedAmount / Math.max(1, plan.netAmount)) * 100);
  
  return (
    <div className="rounded-[2rem] border border-[#165032]/10 bg-white p-6 shadow-sm relative overflow-hidden">
      <div className={`absolute top-0 right-0 left-0 h-1.5 ${
        plan.status === 'active' ? 'bg-emerald-500' :
        plan.status === 'completed' ? 'bg-blue-500' :
        'bg-orange-400'
      }`} />
      
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-bold text-[#0f2416]">{plan.title}</h3>
          <p className="text-sm font-medium text-[#165032]/60 mt-0.5">{plan.childName}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
            plan.status === 'active' ? 'bg-emerald-100 text-emerald-800' :
            plan.status === 'completed' ? 'bg-blue-100 text-blue-800' :
            'bg-orange-100 text-orange-800'
          }`}>
             {plan.status === 'active' ? t('parent.active') : plan.status === 'completed' ? t('parent.completed') : t('parent.suspended')}
        </span>
      </div>
      
      <div className="bg-[#FDFBF7] rounded-xl p-4 mb-5 border border-[#165032]/5">
         <div className="flex justify-between text-xs font-bold mb-2">
           <span className="text-[#165032]/70">{t('parent.paidAmount', { amount: formatCurrency(plan.collectedAmount) })}</span>
           <span className="text-[#0f2416]">{t('parent.outOf', { amount: formatCurrency(plan.netAmount) })}</span>
         </div>
         <div className="h-2 w-full bg-[#165032]/10 rounded-full overflow-hidden">
           <div className="h-full bg-[#165032]" style={{ width: `${progress}%` }} />
         </div>
      </div>
      
      <div className="space-y-3">
         <h4 className="text-xs font-bold text-[#165032]/50 uppercase tracking-wider">{t('parent.schedule')}</h4>
         <div className={`max-h-[160px] overflow-y-auto space-y-2 ${dir === 'rtl' ? 'pr-2' : 'pl-2'}`}>
          {plan.installments?.map(inst => (
            <div key={inst.id} className="flex items-center justify-between text-sm p-2 rounded-lg border border-transparent hover:border-[#165032]/5 bg-white transition-colors">
               <div className="flex items-center gap-3">
                 <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${
                   inst.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 
                   inst.status === 'overdue' ? 'bg-red-100 text-red-700' :
                   'bg-[#165032]/5 text-[#165032]'
                 }`}>
                   {inst.sequence}
                 </span>
                 <span className={`font-bold ${inst.status === 'paid' ? 'text-[#165032]/40 line-through' : 'text-[#0f2416]'}`}>
                    {formatCurrency(inst.amount)}
                 </span>
               </div>
                <div className={`flex items-center gap-2 ${dir === 'rtl' ? 'text-left' : 'text-right'}`}>
                  <span className="text-xs font-medium text-[#165032]/60" dir="ltr">{formatDate(inst.dueDate, { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
                 {inst.status === 'paid' && <CheckCircle2 size={14} className="text-emerald-500" />}
                 {inst.status === 'overdue' && <AlertCircle size={14} className="text-red-500" />}
                 {(inst.status === 'scheduled' || inst.status === 'issued') && <Clock size={14} className="text-orange-400" />}
               </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ParentInvoices({ withShell = true }: { withShell?: boolean } = {}) {
  const { t, formatCurrency, formatDate, dir } = useI18n();
  const query = useListParentInvoices();
  const plansQuery = useListParentBillingPlans();
  const checkout = useCreateParentInvoiceCheckoutSession();
  const { toast } = useToast();
  const invoices = query.data || [];
  const plans = plansQuery.data || [];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const invoiceId = params.get('invoice');
    if (!payment) return;
    if (payment === 'success') {
      toast({
        title: t('parent.paymentConfirming'),
        description: t('parent.paymentConfirmingDesc'),
      });
      window.setTimeout(() => { query.refetch(); plansQuery.refetch(); }, 2500);
    } else {
      toast({
        title: t('parent.paymentIncomplete'),
        description: invoiceId ? t('parent.paymentInvoiceFailed', { id: invoiceId }) : t('parent.payRetry'),
        variant: 'destructive',
      });
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const handlePay = (invoiceId: number) => {
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
    const returnUrl = `${window.location.origin}${basePath}/parent/invoices`;
    checkout.mutate({ id: invoiceId, data: { returnUrl } }, {
      onSuccess: (result) => {
        window.location.href = result.url;
      },
      onError: (error) => {
        const description = error instanceof Error
          ? error.message.replace(/^HTTP \d+ [^:]*:\s*/, '')
          : t('parent.checkoutErrorDesc');
        toast({ title: t('parent.checkoutError'), description, variant: 'destructive' });
      },
    });
  };

  const content = (
    <>
      <ParentPageHeader 
        title={t('parent.invoicesTitle')}
        description={t('parent.invoicesDesc')}
      />

      {plans.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[#0f2416] mb-5 flex items-center gap-2"><CalendarClock size={20} className="text-[#165032]"/> {t('parent.billingPlans')}</h2>
          <div className="grid gap-5 lg:grid-cols-2">
            {plans.map(plan => (
               <ParentBillingPlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </section>
      )}

      <h2 className="text-xl font-bold text-[#0f2416] mb-5 flex items-center gap-2"><FileText size={20} className="text-[#165032]"/> {t('parent.invoicesClaims')}</h2>

      <section data-testid="parent-knet-summary" className="mb-6 rounded-2xl border border-[#165032]/10 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-sm font-bold text-[#0f2416]"> {t('parent.knetSecure')}</p>
          <p className="mt-1 text-sm text-[#165032]/70">{t('parent.knetSecureDesc')}</p>
        </div>
      </section>

      <ParentQueryState loading={query.isLoading} error={query.isError} empty={!invoices.length} onRetry={() => query.refetch()}>
        <div className="grid gap-5 lg:grid-cols-2">
          {invoices.map((invoice) => (
            <div key={invoice.id} data-testid={`card-invoice-${invoice.id}`} className="relative overflow-hidden rounded-[2rem] bg-white p-8 shadow-sm border border-[#165032]/5 hover:shadow-md transition-shadow">
              <div className={`absolute top-0 right-0 left-0 h-1.5 ${
                invoice.status === 'paid' ? 'bg-emerald-500' :
                invoice.status === 'overdue' ? 'bg-red-500' :
                'bg-orange-400'
              }`} />
              
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="text-xs font-bold text-[#165032]/50 mb-1">{t('parent.invoiceNumber', { number: invoice.invoiceNumber })}</p>
                  <h3 className="text-xl font-bold text-[#0f2416]">{invoice.childName}</h3>
                </div>
                
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                  invoice.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                  invoice.status === 'overdue' ? 'bg-red-100 text-red-800' :
                  'bg-orange-100 text-orange-800'
                }`}>
                  {invoice.status === 'paid' ? <CheckCircle2 size={14}/> : invoice.status === 'overdue' ? <AlertCircle size={14}/> : <Clock size={14}/>}
                  {invoice.status === 'paid' ? t('parent.paid') : invoice.status === 'overdue' ? t('parent.overdue') : t('parent.due')}
                </span>
              </div>
              
              <div className="flex items-end justify-between bg-[#FDFBF7] p-5 rounded-2xl border border-[#165032]/5 mb-6">
                <div>
                  <p className="text-xs font-bold text-[#165032]/60 mb-1">{t('parent.totalAmount')}</p>
                  <p className="text-3xl font-bold text-[#165032]">{formatCurrency(invoice.amount)}</p>
                </div>
                <div className={dir === 'rtl' ? 'text-left' : 'text-right'}>
                  <p className="text-xs font-bold text-[#165032]/60 mb-1">{t('parent.dueDate')}</p>
                  <p className="text-sm font-bold text-[#0f2416]" dir="ltr">{formatDate(invoice.dueDate, { year: 'numeric', month: '2-digit', day: '2-digit' })}</p>
                </div>
              </div>
              
              {invoice.status !== 'paid' ? (
                <div>
                  <div data-testid={`text-parent-knet-amount-${invoice.id}`} className="mb-3 rounded-xl bg-[#FDFBF7] px-4 py-3 text-center text-xs leading-5 text-[#165032]/70">
                     {t('parent.knetAmount', { amount: formatCurrency(invoice.amount) })}
                  </div>
                  <button
                    data-testid={`button-pay-invoice-${invoice.id}`}
                    onClick={() => handlePay(invoice.id)}
                    disabled={checkout.isPending}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#165032] py-3.5 text-sm font-bold text-white hover:-translate-y-0.5 hover:shadow-md transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    <CreditCard size={18} /> {checkout.isPending ? t('parent.redirecting') : t('parent.payKnet')}
                  </button>
                </div>
              ) : (
                <button data-testid={`button-receipt-invoice-${invoice.id}`} className="w-full flex items-center justify-center gap-2 rounded-xl bg-white border border-[#165032]/10 py-3.5 text-sm font-bold text-[#165032] hover:bg-[#165032]/5 transition-colors">
                  <FileText size={18} /> {t('parent.downloadReceipt')}
                </button>
              )}
            </div>
          ))}
        </div>
      </ParentQueryState>
    </>
  );

  return withShell ? <ParentShell>{content}</ParentShell> : content;
}
