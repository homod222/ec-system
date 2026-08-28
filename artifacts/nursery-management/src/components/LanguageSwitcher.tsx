import { Languages } from 'lucide-react';
import { useI18n } from '@/i18n';

export function LanguageSwitcher({ className = '', inverted = false }: { className?: string; inverted?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      data-testid="language-switcher"
      role="group"
      aria-label={t('common.language')}
      className={`inline-flex items-center gap-1 rounded-xl border p-1 text-xs font-bold ${
        inverted ? 'border-white/25 bg-white/10 text-white' : 'border-border bg-card text-foreground'
      } ${className}`}
    >
      <Languages aria-hidden="true" size={15} className="mx-1 opacity-70" />
      {(['ar', 'en'] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-testid={`button-language-${value}`}
          aria-pressed={locale === value}
          onClick={() => setLocale(value)}
          className={`rounded-lg px-2.5 py-1.5 ${
            locale === value
              ? inverted ? 'bg-white text-primary shadow-sm' : 'bg-primary text-primary-foreground shadow-sm'
              : 'hover:bg-black/5'
          }`}
        >
          {value === 'ar' ? t('common.arabic') : t('common.english')}
        </button>
      ))}
    </div>
  );
}