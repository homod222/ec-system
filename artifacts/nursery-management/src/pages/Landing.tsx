import { Link, Redirect } from 'wouter';
import { useAuth, useUser } from '@clerk/react';
import { ArrowUpRight, Check, CalendarCheck, ShieldCheck, Sparkles, Star, ChevronRight, ChevronLeft } from 'lucide-react';
import { getGetSessionContextQueryKey, getListPublicSiteGalleryQueryKey, useGetSessionContext, useListPublicSiteGallery } from '@workspace/api-client-react';
import { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function GalleryCarousel({ images }: { images: Array<{ src: string; alt: string }> }) {
  const { dir, t } = useI18n();
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, direction: dir, align: 'center' });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((index: number) => emblaApi && emblaApi.scrollTo(index), [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.reInit({ loop: true, direction: dir, align: 'center' });
  }, [emblaApi, dir]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  useEffect(() => {
    if (!emblaApi) return;
    
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) return;

    let intervalId: number;
    let hovered = false;

    const startAutoplay = () => {
      stopAutoplay();
      intervalId = window.setInterval(() => {
        if (!hovered) {
          emblaApi.scrollNext();
        }
      }, 3500);
    };
    
    const stopAutoplay = () => {
      window.clearInterval(intervalId);
    };

    const handleMouseEnter = () => { hovered = true; };
    const handleMouseLeave = () => { hovered = false; };
    
    startAutoplay();
    
    const rootNode = emblaApi.rootNode();
    rootNode.addEventListener('mouseenter', handleMouseEnter);
    rootNode.addEventListener('mouseleave', handleMouseLeave);
    rootNode.addEventListener('focusin', handleMouseEnter);
    rootNode.addEventListener('focusout', handleMouseLeave);
    
    emblaApi.on('pointerDown', handleMouseEnter);
    emblaApi.on('pointerUp', handleMouseLeave);
    
    return () => {
      stopAutoplay();
      rootNode.removeEventListener('mouseenter', handleMouseEnter);
      rootNode.removeEventListener('mouseleave', handleMouseLeave);
      rootNode.removeEventListener('focusin', handleMouseEnter);
      rootNode.removeEventListener('focusout', handleMouseLeave);
      emblaApi.off('pointerDown', handleMouseEnter);
      emblaApi.off('pointerUp', handleMouseLeave);
    };
  }, [emblaApi]);

  return (
    <div className="relative group w-full" dir={dir}>
      <div className="overflow-hidden px-4 sm:px-12" ref={emblaRef}>
        <div className="flex touch-pan-y -mx-3">
          {images.map((img, i) => (
            <div className="flex-[0_0_100%] min-w-0 sm:flex-[0_0_50%] lg:flex-[0_0_33.333%] px-3" key={i}>
              <div className="overflow-hidden rounded-[2.5rem] shadow-sm transition-all duration-500 hover:shadow-2xl relative group/card cursor-grab active:cursor-grabbing h-full">
                <img 
                  src={img.src} 
                  alt={img.alt} 
                  className="aspect-[4/5] w-full object-cover transition-transform duration-700 group-hover/card:scale-105" 
                  loading="lazy"
                  draggable={false}
                />
                <div className="absolute inset-0 rounded-[2.5rem] border-2 border-transparent transition-colors group-focus-within/card:border-primary pointer-events-none" />
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Controls */}
      <button 
        onClick={scrollNext} 
        className="absolute top-1/2 left-0 z-10 -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-white text-primary shadow-lg ring-1 ring-black/5 backdrop-blur transition-all hover:bg-primary hover:text-primary-foreground hover:scale-110 focus:outline-none focus:ring-4 focus:ring-primary/20 opacity-100 sm:h-14 sm:w-14 sm:left-4 sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-0"
        aria-label={t('landing.nextImage')}
      >
        <ChevronLeft size={24} className="-ml-1" />
      </button>

      <button 
        onClick={scrollPrev} 
        className="absolute top-1/2 right-0 z-10 -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-white text-primary shadow-lg ring-1 ring-black/5 backdrop-blur transition-all hover:bg-primary hover:text-primary-foreground hover:scale-110 focus:outline-none focus:ring-4 focus:ring-primary/20 opacity-100 sm:h-14 sm:w-14 sm:right-4 sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-0"
        aria-label={t('landing.previousImage')}
      >
        <ChevronRight size={24} className="-mr-1" />
      </button>

      {/* Dots */}
      <div className="mt-10 flex justify-center gap-3">
        {images.map((_, i) => (
          <button
            key={i}
            onClick={() => scrollTo(i)}
            aria-label={t('landing.goToImage', { number: i + 1 })}
            aria-current={selectedIndex === i ? 'true' : undefined}
            className={`h-2.5 rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
              selectedIndex === i ? 'w-10 bg-primary' : 'w-2.5 bg-primary/20 hover:bg-primary/40'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'green' | 'yellow' | 'red' | 'blue' | 'neutral' }) {
  const colors = { 
    green: 'bg-emerald-100 text-emerald-800', 
    yellow: 'bg-accent/30 text-accent-foreground', 
    red: 'bg-red-100 text-red-800', 
    blue: 'bg-sky-100 text-sky-800', 
    neutral: 'bg-muted text-muted-foreground' 
  };
  return <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold ${colors[tone]}`}>{children}</span>;
}

export function Landing() {
  const { dir, t } = useI18n();
  const { isSignedIn } = useAuth(); 
  const { user } = useUser();
  const session = useGetSessionContext({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: getGetSessionContextQueryKey(),
      retry: false,
    },
  });
  const publicGallery = useListPublicSiteGallery({
    query: { queryKey: getListPublicSiteGalleryQueryKey(), retry: false, staleTime: 60_000 },
  });
  const galleryImages = [
    'classroom-learning.webp', 'cooking-activity.webp', 'creative-play.webp',
    'hero-child.webp', 'outdoor-play.webp', 'space-day.webp',
  ].map((file) => ({ src: `${basePath}/media/${file}`, alt: t('landing.logoAlt') }));
  const displayedGallery = publicGallery.data?.length
    ? publicGallery.data.map((item) => ({ src: item.imageUrl, alt: item.altText }))
    : galleryImages;

  if (isSignedIn && user) {
    if (session.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-background"><div className="h-12 w-12 animate-pulse rounded-2xl bg-primary/20" /></div>;
    if (session.data?.role === 'parent') {
      return <Redirect to="/parent" />;
    }
    if (session.data?.role === 'admin') {
      return <Redirect to="/dashboard" />;
    }
    return <Redirect to="/access-pending" />;
  }
  
  return (
    <div dir={dir} className="min-h-[100dvh] bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      {/* Navbar */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <div className="flex items-center gap-3">
           <img src={`${basePath}/ec-official-logo-v2.png`} alt={t('landing.logoAlt')} className="h-24 w-28 object-contain sm:h-28 sm:w-36" />
        </div>
        <div className="hidden items-center gap-8 text-sm font-bold text-muted-foreground md:flex">
           <a href="#about" className="hover:text-primary transition-colors">{t('landing.about')}</a>
           <a href="#programs" className="hover:text-primary transition-colors">{t('landing.programs')}</a>
           <a href="#facilities" className="hover:text-primary transition-colors">{t('landing.facilities')}</a>
        </div>
         <div className="flex flex-wrap items-center justify-end gap-2">
           <LanguageSwitcher className="max-sm:w-full max-sm:justify-center" />
           <Link href="/sign-in" data-testid="link-landing-sign-in" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
            {t('landing.adminLogin')}
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative mx-4 mt-2 overflow-hidden rounded-[2.5rem] bg-ec-pattern px-6 py-20 sm:mx-8 sm:px-14 sm:py-28 lg:mx-auto lg:max-w-7xl shadow-2xl">
        <div className="absolute inset-0 bg-primary/95" />
        
        <div className="relative z-10 grid lg:grid-cols-[1fr_1fr] gap-12 items-center">
          <div className="max-w-2xl animate-rise">
             <Pill tone="yellow"><Sparkles size={14} className="me-1.5 inline" /> {t('landing.badge')}</Pill>
            <h1 className="mt-8 text-5xl font-bold leading-[1.15] text-primary-foreground sm:text-7xl">
               {t('landing.hero')}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-primary-foreground/80">
               {t('landing.heroBody')}
            </p>
             <div className="mt-10">
               <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-2xl bg-accent px-8 py-4 text-base font-bold text-accent-foreground shadow-lg transition-all hover:-translate-y-1 hover:shadow-xl">
                 {t('landing.start')} <ArrowUpRight size={18} />
              </Link>
            </div>
            
            <div className="mt-12 flex items-center gap-6 text-primary-foreground/70">
              <div className="flex -space-x-3 rtl:space-x-reverse">
                <div className="h-10 w-10 rounded-full border-2 border-primary bg-accent" />
                <div className="h-10 w-10 rounded-full border-2 border-primary bg-secondary" />
                <div className="h-10 w-10 rounded-full border-2 border-primary bg-white" />
              </div>
               <p className="text-sm font-medium">{t('landing.trusted')}</p>
            </div>
          </div>
          
          <div className="relative hidden lg:block animate-rise delay-100">
            {/* Main Image */}
            <div className="relative z-10 overflow-hidden rounded-[2rem] border-8 border-white shadow-2xl rotate-2 hover:rotate-0 transition-transform duration-500">
               <img src={`${basePath}/media/hero-child.webp`} alt={t('landing.heroAlt')} className="aspect-[4/5] w-full object-cover" />
            </div>
            
            {/* Floating Image 1 */}
            <div className="absolute -bottom-10 -right-10 z-20 w-56 overflow-hidden rounded-[1.5rem] border-8 border-white shadow-xl -rotate-6 animate-float">
               <img src={`${basePath}/media/creative-play.webp`} alt={t('landing.creativeAlt')} className="aspect-[4/5] w-full object-cover" />
            </div>
            
            {/* Decor */}
            <div className="absolute -top-6 -left-6 z-0 h-32 w-32 rounded-full bg-accent/40 blur-2xl" />
            <div className="absolute bottom-10 right-20 z-0 h-40 w-40 rounded-full bg-white/20 blur-3xl" />
          </div>
        </div>
      </section>

      {/* Values / About */}
      <section id="about" className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16 animate-rise delay-200">
           <h2 className="text-4xl font-bold text-primary">{t('landing.why')}</h2>
           <p className="mt-4 text-lg text-muted-foreground">{t('landing.whyBody')}</p>
        </div>
        
        <div className="grid gap-6 md:grid-cols-3">
          {[
             { icon: ShieldCheck, title: t('landing.safe'), desc: t('landing.safeBody') },
             { icon: CalendarCheck, title: t('landing.bilingual'), desc: t('landing.bilingualBody') },
             { icon: Star, title: t('landing.activities'), desc: t('landing.activitiesBody') }
          ].map((feature, i) => (
            <div key={i} className="group rounded-[2rem] border border-border bg-card p-8 shadow-sm transition-all hover:-translate-y-2 hover:shadow-xl animate-rise" style={{ animationDelay: `${(i+3)*100}ms` }}>
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <feature.icon size={26} />
              </span>
              <h3 className="mt-6 text-xl font-bold text-foreground">{feature.title}</h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Photo Gallery / Programs */}
      <section id="programs" className="bg-secondary/30 py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="grid grid-cols-2 gap-4">
               <img src={`${basePath}/media/classroom-learning.webp`} alt={t('landing.logoAlt')} className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow" />
               <img src={`${basePath}/media/cooking-activity.webp`} alt={t('landing.logoAlt')} className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow translate-y-8" />
               <img src={`${basePath}/media/space-day.webp`} alt={t('landing.logoAlt')} className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow" />
               <img src={`${basePath}/media/outdoor-play.webp`} alt={t('landing.logoAlt')} className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow translate-y-8" />
            </div>
            
            <div className="lg:pr-10">
               <Pill tone="green">{t('landing.live')}</Pill>
              <h2 className="mt-6 text-4xl font-bold leading-tight text-primary">
                 {t('landing.learn')}
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                 {t('landing.learnBody')}
              </p>
              
              <ul className="mt-8 space-y-4">
                {[
                   t('landing.skill1'), t('landing.skill2'), t('landing.skill3'), t('landing.skill4')
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 font-semibold text-foreground">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-primary">
                      <Check size={14} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Photo Gallery Carousel */}
      <section className="bg-white py-24 overflow-hidden relative">
        <div className="absolute inset-0 bg-ec-pattern opacity-30 pointer-events-none" />
        <div className="mx-auto max-w-[90rem] px-5 sm:px-8 relative z-10">
          <div className="mb-16 text-center animate-rise">
             <Pill tone="blue"><Sparkles size={14} className="me-1.5 inline" /> {t('landing.diaries')}</Pill>
            <h2 className="mt-6 text-4xl font-bold text-primary sm:text-5xl">
               {t('landing.memories')}
            </h2>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
               {t('landing.galleryBody')}
            </p>
          </div>
          
          <div className="animate-rise delay-200 max-w-7xl mx-auto">
            <GalleryCarousel images={displayedGallery} />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-white px-5 py-12 sm:px-8 text-center text-sm font-medium text-muted-foreground">
         <img src={`${basePath}/ec-official-logo-v2.png`} alt={t('landing.logoAlt')} className="mx-auto mb-6 h-32 w-40 object-contain sm:h-36 sm:w-44" />
         <p>{t('landing.copyright', { year: new Date().getFullYear() })}</p>
      </footer>
    </div>
  );
}
