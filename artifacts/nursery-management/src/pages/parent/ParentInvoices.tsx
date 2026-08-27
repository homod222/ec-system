import { useState } from 'react';
import { getParentDocumentContent, useCreateParentInvoiceCheckoutSession, useGetKwdUsdExchangeRate, useListParentInvoices, useListParentDocuments, useListParentReceipts } from '@workspace/api-client-react';
import { ParentShell } from '../../components/ParentShell';
import { ParentPageHeader, ParentQueryState } from '../../components/ParentShared';
import { CreditCard, FileText, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';

const money = (n: number) => new Intl.NumberFormat('ar-KW', {
  style: 'currency',
  currency: 'KWD',
  minimumFractionDigits: 0,
}).format(n || 0);

function isExchangeRateUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const data = 'data' in error ? error.data : null;
  return Boolean(
    data &&
    typeof data === 'object' &&
    'code' in data &&
    data.code === 'EXCHANGE_RATE_UNAVAILABLE',
  );
}

export function ParentInvoices({ withShell = true }: { withShell?: boolean } = {}) {
  const query = useListParentInvoices();
  const exchangeRateQuery = useGetKwdUsdExchangeRate();
  const documentsQuery = useListParentDocuments();
  const receiptsQuery = useListParentReceipts();
  const checkout = useCreateParentInvoiceCheckoutSession();
  const { toast } = useToast();
  const invoices = query.data || [];
  const exchangeRate = exchangeRateQuery.data;
  const [openingDocument, setOpeningDocument] = useState<number | null>(null);

  const handlePay = (invoiceId: number) => {
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
    const returnUrl = `${window.location.origin}${basePath}/parent/invoices`;
    checkout.mutate({ id: invoiceId, data: { returnUrl } }, {
      onSuccess: (result) => {
        window.location.href = result.url;
      },
      onError: (error) => {
        const rateUnavailable = isExchangeRateUnavailable(error);
        const description = rateUnavailable
          ? 'انتهت صلاحية سعر التحويل المعروض. حدّث السعر ثم أعد محاولة الدفع.'
          : 'حاول مرة أخرى أو تواصل مع إدارة الحضانة.';
        toast({ title: 'تعذّر بدء عملية الدفع', description, variant: 'destructive' });
        if (rateUnavailable) void exchangeRateQuery.refetch();
      },
    });
  };
  const openDocument = async (document: { id: number; name: string; contentType: string }) => {
    setOpeningDocument(document.id);
    try {
      // The generated client applies the authenticated request middleware; never expose storage paths.
      const blob = await getParentDocumentContent(document.id);
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, '_blank', 'noopener,noreferrer');
      if (!tab) {
        const link = globalThis.document.createElement('a');
        link.href = url; link.download = document.name; link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast({ title: 'تعذر فتح المستند', description: 'تحقق من الصلاحية أو حاول مرة أخرى.', variant: 'destructive' });
    } finally { setOpeningDocument(null); }
  };

  const content = (
    <>
      <ParentPageHeader 
        title="الفواتير والرسوم" 
        description="سجل شفاف لجميع المدفوعات والرسوم المستحقة لضمان استمرارية الخدمات."
      />

      <section data-testid="parent-exchange-rate-summary" className="mb-6 flex flex-col gap-3 rounded-2xl border border-[#165032]/10 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-[#0f2416]">سعر التحويل للدفع عبر Stripe</p>
          {exchangeRate ? (
            <p className="mt-1 text-sm text-[#165032]/70">
              1 د.ك = {exchangeRate.rate.toLocaleString('ar-KW', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} دولار أمريكي
            </p>
          ) : (
            <p className="mt-1 text-sm font-bold text-red-700">
              {exchangeRateQuery.isLoading ? 'جارٍ تحميل سعر التحويل…' : 'لا يتوفر حاليًا سعر تحويل حديث؛ لن يبدأ الدفع حتى يتوفر سعر صالح.'}
            </p>
          )}
        </div>
        {exchangeRate && (
          <p className="text-xs font-medium text-[#165032]/60">
            آخر تحديث ناجح: {new Date(exchangeRate.updatedAt).toLocaleString('ar-KW', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        )}
      </section>

      <ParentQueryState loading={query.isLoading} error={query.isError} empty={!invoices.length} onRetry={() => query.refetch()}>
        <div className="grid gap-5 lg:grid-cols-2">
          {invoices.map((invoice) => (
            <div key={invoice.id} data-testid={`card-invoice-${invoice.id}`} className="relative overflow-hidden rounded-[2rem] bg-white p-8 shadow-sm border border-[#165032]/5 hover:shadow-md transition-shadow">
              {/* Status Banner */}
              <div className={`absolute top-0 right-0 left-0 h-1.5 ${
                invoice.status === 'paid' ? 'bg-emerald-500' :
                invoice.status === 'overdue' ? 'bg-red-500' :
                'bg-orange-400'
              }`} />
              
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="text-xs font-bold text-[#165032]/50 mb-1">فاتورة رقم #{invoice.invoiceNumber}</p>
                  <h3 className="text-xl font-bold text-[#0f2416]">{invoice.childName}</h3>
                </div>
                
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                  invoice.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                  invoice.status === 'overdue' ? 'bg-red-100 text-red-800' :
                  'bg-orange-100 text-orange-800'
                }`}>
                  {invoice.status === 'paid' ? <CheckCircle2 size={14}/> : invoice.status === 'overdue' ? <AlertCircle size={14}/> : <Clock size={14}/>}
                  {invoice.status === 'paid' ? 'تم السداد' : invoice.status === 'overdue' ? 'متأخرة' : 'مستحقة'}
                </span>
              </div>
              
              <div className="flex items-end justify-between bg-[#FDFBF7] p-5 rounded-2xl border border-[#165032]/5 mb-6">
                <div>
                  <p className="text-xs font-bold text-[#165032]/60 mb-1">المبلغ الإجمالي</p>
                  <p className="text-3xl font-bold text-[#165032]">{money(invoice.amount)}</p>
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-[#165032]/60 mb-1">تاريخ الاستحقاق</p>
                  <p className="text-sm font-bold text-[#0f2416]" dir="ltr">{new Date(invoice.dueDate).toLocaleDateString('en-GB')}</p>
                </div>
              </div>
              
              {invoice.status !== 'paid' ? (
                <div>
                  <div data-testid={`text-parent-usd-estimate-${invoice.id}`} className="mb-3 rounded-xl bg-[#FDFBF7] px-4 py-3 text-center text-xs leading-5 text-[#165032]/70">
                    {exchangeRate
                      ? <>المبلغ التقريبي: <strong className="text-[#165032]">{(invoice.amount * exchangeRate.rate).toLocaleString('ar-KW', { style: 'currency', currency: 'USD' })}</strong><br />يُثبّت المبلغ النهائي عند إنشاء جلسة الدفع.</>
                      : 'لا يمكن حساب المبلغ بالدولار دون سعر تحويل حديث.'}
                  </div>
                  <button
                    data-testid={`button-pay-invoice-${invoice.id}`}
                    onClick={() => handlePay(invoice.id)}
                    disabled={!exchangeRate || checkout.isPending}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#165032] py-3.5 text-sm font-bold text-white hover:-translate-y-0.5 hover:shadow-md transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    <CreditCard size={18} /> {checkout.isPending ? 'جارٍ التحويل…' : 'سداد الآن'}
                  </button>
                </div>
              ) : (
                <button data-testid={`button-receipt-invoice-${invoice.id}`} onClick={() => window.print()} className="w-full flex items-center justify-center gap-2 rounded-xl bg-white border border-[#165032]/10 py-3.5 text-sm font-bold text-[#165032] hover:bg-[#165032]/5 transition-colors">
                  <FileText size={18} /> تحميل الإيصال
                </button>
              )}
            </div>
          ))}
        </div>
      </ParentQueryState>
      <section className="mt-8 rounded-[2rem] border border-[#165032]/10 bg-white p-7 shadow-sm">
        <h2 className="text-xl font-bold text-[#0f2416]">الإيصالات والمستندات</h2>
        <p className="mt-1 text-sm text-[#165032]/60">يمكنك طباعة الإيصالات والاطلاع على مستندات التسجيل المتاحة.</p>
        <ParentQueryState loading={receiptsQuery.isLoading || documentsQuery.isLoading} error={receiptsQuery.isError || documentsQuery.isError} empty={!(receiptsQuery.data?.length || documentsQuery.data?.length)} onRetry={() => { receiptsQuery.refetch(); documentsQuery.refetch(); }}>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {(receiptsQuery.data || []).map(receipt => <button key={`r${receipt.id}`} onClick={() => window.print()} className="rounded-xl border border-[#165032]/10 p-4 text-right hover:bg-[#FDFBF7]"><p className="font-bold">إيصال {receipt.receiptNumber}</p><p className="mt-1 text-sm text-[#165032]/60">{money(receipt.amount)} · {new Date(receipt.issuedAt).toLocaleDateString('ar-SA')}</p><span className="mt-2 inline-block text-xs font-bold text-[#165032]">طباعة / حفظ PDF</span></button>)}
            {(documentsQuery.data || []).map(document => <div key={`d${document.id}`} className="rounded-xl border border-[#165032]/10 p-4"><p className="font-bold">{document.name}</p><p className="mt-1 text-sm text-[#165032]/60">{document.contentType} · {(document.size / 1024).toFixed(1)} KB</p><button type="button" disabled={openingDocument === document.id} onClick={() => openDocument(document)} className="mt-2 text-xs font-bold text-[#165032] disabled:opacity-50">{openingDocument === document.id ? 'جارٍ تجهيز المستند…' : 'فتح / تنزيل المستند'}</button></div>)}
          </div>
        </ParentQueryState>
      </section>
    </>
  );

  return withShell ? <ParentShell>{content}</ParentShell> : content;
}
