import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Settings } from '../pages/admin/Settings';
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
      <Settings withShell={false} />
    </QueryClientProvider>
  </LanguageProvider>,
);