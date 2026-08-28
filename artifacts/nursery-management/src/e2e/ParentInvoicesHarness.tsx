import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ParentInvoices } from '../pages/parent/ParentInvoices';
import { Toaster } from '../components/ui/toaster';
import { LanguageProvider } from '../i18n';
import '../index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <QueryClientProvider client={queryClient}>
      <ParentInvoices withShell={false} />
      <Toaster />
    </QueryClientProvider>
  </LanguageProvider>,
);