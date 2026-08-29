import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { 
  Home, 
  Calendar, 
  FileText, 
  Image as ImageIcon, 
  CreditCard, 
  MessageCircle,
  Menu,
  X,
  LogOut,
  Bell
} from 'lucide-react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useI18n, type TranslationKey } from '@/i18n';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const initials = (name: string) => name.split(' ').slice(0, 2).map((s) => s[0]).join('');

const parentNavItems = [
  { href: '/parent', label: 'parent.home', icon: Home },
  { href: '/parent/attendance', label: 'parent.attendance', icon: Calendar },
  { href: '/parent/activities', label: 'parent.activities', icon: ImageIcon },
  { href: '/parent/reports', label: 'parent.reports', icon: FileText },
  { href: '/parent/invoices', label: 'parent.invoices', icon: CreditCard },
  { href: '/parent/messages', label: 'parent.messages', icon: MessageCircle },
] satisfies Array<{ href: string; label: TranslationKey; icon: typeof Home }>;

export function ParentShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { dir, t } = useI18n();

  // Reassuring, warm styling for the parent portal
  // We use a warm tone derived from the ivory/green palette but softer
  return (
    <div className="min-h-[100dvh] bg-[#FDFBF7] selection:bg-[#165032]/20 font-sans" dir={dir}>
      {/* Mobile Header */}
      <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-[#165032]/10 bg-white/80 px-5 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-3">
          <button data-testid="button-open-parent-menu" className="rounded-xl border border-[#165032]/10 bg-white p-2.5 text-[#165032]" onClick={() => setOpen(true)}>
            <Menu size={20} />
          </button>
        </div>
        <img src={`${basePath}/ec-official-logo.png`} alt={t('admin.brand')} className="h-9 w-9 object-contain" />
         <div className="flex items-center gap-2">
           <LanguageSwitcher className="max-sm:[&>svg]:hidden max-sm:[&>button]:px-1.5" />
           <Link href="/parent/messages" data-testid="link-parent-notifications" aria-label={t('parent.openMessages')} className="relative rounded-xl border border-[#165032]/10 bg-white p-2.5 text-[#165032]/70">
            <Bell size={18} />
          </Link>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 z-40 flex w-[280px] flex-col bg-white px-6 py-8 shadow-[0_0_40px_rgba(22,80,50,0.05)] transition-transform duration-300 lg:translate-x-0 ${dir === 'rtl' ? `right-0 ${open ? 'translate-x-0' : 'translate-x-full'}` : `left-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}`}>
        <div className="mb-10 flex items-center justify-between">
          <img src={`${basePath}/ec-official-logo.png`} alt={t('admin.brand')} className="h-11 w-11 object-contain" />
          <button data-testid="button-close-parent-menu" className="rounded-xl p-2 text-[#165032]/60 hover:bg-[#FDFBF7] lg:hidden" onClick={() => setOpen(false)}>
            <X size={20} />
          </button>
        </div>
        
        <div className="mb-8 flex items-center gap-4 rounded-2xl bg-[#FDFBF7] p-4 border border-[#165032]/5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#165032] text-sm font-bold text-white shadow-sm">
            {initials(user?.firstName || t('parent.defaultUser'))}
          </span>
          <div>
            <p data-testid="text-parent-name" className="text-sm font-bold text-[#0f2416]">{user?.firstName || t('parent.defaultUser')}</p>
            <p className="mt-0.5 text-xs font-medium text-[#165032]/70">{t('parent.familyAccount')}</p>
          </div>
        </div>
        
        <nav className="space-y-2">
          {parentNavItems.map(({ href, label, icon: Icon }) => {
            const active = location === href || (href !== '/parent' && location.startsWith(href));
            return (
              <Link 
                key={href} 
                href={href} 
                data-testid={`link-parent-nav-${href.replace('/parent', '') || 'overview'}`} 
                onClick={() => setOpen(false)} 
                className={`flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-sm font-bold transition-all ${
                  active 
                    ? 'bg-[#165032] text-white shadow-md' 
                    : 'text-[#165032]/70 hover:bg-[#165032]/5 hover:text-[#165032]'
                }`}
              >
                <Icon size={20} />
                 <span>{t(label)}</span>
              </Link>
            );
          })}
        </nav>
        
        <div className="mt-auto space-y-2 pt-6 border-t border-[#165032]/10">
          <button data-testid="button-parent-sign-out" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="flex w-full items-center gap-3.5 rounded-2xl px-4 py-3.5 text-sm font-bold text-red-600/80 hover:bg-red-50 hover:text-red-700 transition-colors">
            <LogOut size={20} />
            {t('admin.signOut')}
          </button>
        </div>
      </aside>
      
      {open && <button aria-label={t('common.close')} data-testid="button-parent-overlay" className="fixed inset-0 z-30 bg-[#165032]/20 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}
      
      <main className={`min-h-[100dvh] ${dir === 'rtl' ? 'lg:mr-[280px]' : 'lg:ml-[280px]'}`}>
        {/* Desktop Header Top */}
        <div className="hidden lg:flex items-center justify-between px-10 py-6 border-b border-[#165032]/5 bg-white/50 backdrop-blur-xl">
           <p className="text-sm font-medium text-[#165032]/70">{t('parent.portal')}</p>
          <div className="flex items-center gap-4">
             <LanguageSwitcher />
              <Link href="/parent/messages" data-testid="link-parent-notifications-desktop" aria-label={t('parent.openMessages')} className="relative rounded-full bg-white p-3 text-[#165032] shadow-sm hover:shadow-md transition-shadow">
               <Bell size={18} />
               <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-white" />
             </Link>
          </div>
        </div>
        
        <div className="mx-auto max-w-[1200px] p-5 sm:p-8 lg:p-10 animate-rise">
          {children}
        </div>
      </main>
    </div>
  );
}
