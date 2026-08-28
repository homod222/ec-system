import { Link, Redirect } from 'wouter';
import { useAuth, useUser } from '@clerk/react';
import { ArrowUpRight, Check, CalendarCheck, ShieldCheck, Sparkles, Star, ChevronRight, ChevronLeft } from 'lucide-react';
import { getGetSessionContextQueryKey, getListPublicSiteGalleryQueryKey, useGetSessionContext, useListPublicSiteGallery } from '@workspace/api-client-react';
import { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const galleryImages = [
  { src: `${basePath}/media/classroom-learning.webp`, alt: 'التعلم في الفصول الدراسية' },
  { src: `${basePath}/media/cooking-activity.webp`, alt: 'نشاط الطهي' },
  { src: `${basePath}/media/creative-play.webp`, alt: 'اللعب الإبداعي' },
  { src: `${basePath}/media/hero-child.webp`, alt: 'طفل في الحضانة' },
  { src: `${basePath}/media/outdoor-play.webp`, alt: 'اللعب في الخارج' },
  { src: `${basePath}/media/space-day.webp`, alt: 'يوم الفضاء' },
];

function GalleryCarousel({ images }: { images: Array<{ src: string; alt: string }> }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, direction: 'rtl', align: 'center' });
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
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
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
    <div className="relative group w-full" dir="rtl">
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
        aria-label="الصورة التالية"
      >
        <ChevronLeft size={24} className="-ml-1" />
      </button>

      <button 
        onClick={scrollPrev} 
        className="absolute top-1/2 right-0 z-10 -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-white text-primary shadow-lg ring-1 ring-black/5 backdrop-blur transition-all hover:bg-primary hover:text-primary-foreground hover:scale-110 focus:outline-none focus:ring-4 focus:ring-primary/20 opacity-100 sm:h-14 sm:w-14 sm:right-4 sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-0"
        aria-label="الصورة السابقة"
      >
        <ChevronRight size={24} className="-mr-1" />
      </button>

      {/* Dots */}
      <div className="mt-10 flex justify-center gap-3">
        {images.map((_, i) => (
          <button
            key={i}
            onClick={() => scrollTo(i)}
            aria-label={`انتقل إلى الصورة ${i + 1}`}
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
    <div dir="rtl" className="min-h-[100dvh] bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      {/* Navbar */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <img src={`${basePath}/ec-official-logo.png`} alt="حضانة EC ثنائية اللغة" className="h-auto w-40 object-contain sm:w-48" />
        </div>
        <div className="hidden items-center gap-8 text-sm font-bold text-muted-foreground md:flex">
          <a href="#about" className="hover:text-primary transition-colors">من نحن</a>
          <a href="#programs" className="hover:text-primary transition-colors">البرامج التعليمية</a>
          <a href="#facilities" className="hover:text-primary transition-colors">بيئتنا</a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/sign-in" data-testid="link-landing-sign-in" className="hidden sm:inline-flex rounded-xl px-5 py-2.5 text-sm font-bold text-primary hover:bg-muted transition-colors">
            دخول الإدارة
          </Link>
          <Link href="/sign-up" data-testid="link-landing-sign-up" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all">
            إنشاء حساب الإدارة
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative mx-4 mt-2 overflow-hidden rounded-[2.5rem] bg-ec-pattern px-6 py-20 sm:mx-8 sm:px-14 sm:py-28 lg:mx-auto lg:max-w-7xl shadow-2xl">
        <div className="absolute inset-0 bg-primary/95" />
        
        <div className="relative z-10 grid lg:grid-cols-[1fr_1fr] gap-12 items-center">
          <div className="max-w-2xl animate-rise">
            <Pill tone="yellow"><Sparkles size={14} className="ml-1.5 inline" /> بيئة تعليمية محفزة للنمو</Pill>
            <h1 className="mt-8 text-5xl font-bold leading-[1.15] text-primary-foreground sm:text-7xl">
              نزرع <span className="text-accent">المعرفة</span><br />
              وننمي الإبداع.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-primary-foreground/80">
              في حضانة EC ثنائية اللغة، نجمع بين الجدية الأكاديمية والمرح. نقدم رعاية استثنائية وأنشطة ممتعة لبناء شخصية طفلك في بيئة آمنة وملهمة.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-2xl bg-accent px-6 py-4 text-base font-bold text-accent-foreground shadow-lg hover:-translate-y-1 hover:shadow-xl transition-all">
                ابدئي إدارة الحضانة <ArrowUpRight size={18} />
              </Link>
              <a href="#about" className="inline-flex items-center gap-2 rounded-2xl border-2 border-primary-foreground/20 px-6 py-4 text-base font-bold text-primary-foreground hover:bg-primary-foreground/10 transition-all">
                اكتشفي برامجنا
              </a>
            </div>
            
            <div className="mt-12 flex items-center gap-6 text-primary-foreground/70">
              <div className="flex -space-x-3 rtl:space-x-reverse">
                <div className="h-10 w-10 rounded-full border-2 border-primary bg-accent" />
                <div className="h-10 w-10 rounded-full border-2 border-primary bg-secondary" />
                <div className="h-10 w-10 rounded-full border-2 border-primary bg-white" />
              </div>
              <p className="text-sm font-medium">ثقة مئات العائلات كل عام</p>
            </div>
          </div>
          
          <div className="relative hidden lg:block animate-rise delay-100">
            {/* Main Image */}
            <div className="relative z-10 overflow-hidden rounded-[2rem] border-8 border-white shadow-2xl rotate-2 hover:rotate-0 transition-transform duration-500">
              <img src={`${basePath}/media/hero-child.webp`} alt="طفلة سعيدة في حضانة EC" className="aspect-[4/5] w-full object-cover" />
            </div>
            
            {/* Floating Image 1 */}
            <div className="absolute -bottom-10 -right-10 z-20 w-56 overflow-hidden rounded-[1.5rem] border-8 border-white shadow-xl -rotate-6 animate-float">
              <img src={`${basePath}/media/creative-play.webp`} alt="نشاط إبداعي في حضانة EC" className="aspect-[4/5] w-full object-cover" />
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
          <h2 className="text-4xl font-bold text-primary">لماذا تختارين حضانة EC؟</h2>
          <p className="mt-4 text-lg text-muted-foreground">بيئة متكاملة تركز على بناء شخصية الطفل أكاديمياً واجتماعياً.</p>
        </div>
        
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: ShieldCheck, title: 'رعاية آمنة وموثوقة', desc: 'نضع سلامة طفلك في مقدمة أولوياتنا من خلال بيئة مجهزة ومراقبة.' },
            { icon: CalendarCheck, title: 'منهج ثنائي اللغة', desc: 'نؤسس مهارات اللغتين العربية والإنجليزية بأساليب تفاعلية حديثة.' },
            { icon: Star, title: 'أنشطة لا منهجية', desc: 'رحلات، طهي، فنون، وتجارب علمية لاكتشاف مواهب الطفل المبكرة.' }
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
               <img src={`${basePath}/media/classroom-learning.webp`} alt="أطفال يتعلمون في الفصل" className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow" />
               <img src={`${basePath}/media/cooking-activity.webp`} alt="نشاط الطهي التعليمي" className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow translate-y-8" />
               <img src={`${basePath}/media/space-day.webp`} alt="فعالية يوم الفضاء" className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow" />
               <img src={`${basePath}/media/outdoor-play.webp`} alt="اللعب في مرافق الحضانة" className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow translate-y-8" />
            </div>
            
            <div className="lg:pr-10">
              <Pill tone="green">تجارب حية</Pill>
              <h2 className="mt-6 text-4xl font-bold leading-tight text-primary">
                نتعلم من خلال <br />اللعب والتجربة.
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                في حضانة EC، لا نقتصر على التلقين. نؤمن بأن الطفل يتعلم أسرع عندما يتفاعل بحواسه. من يوم الفضاء إلى ورش الطهي الصغيرة، كل يوم هو مغامرة جديدة.
              </p>
              
              <ul className="mt-8 space-y-4">
                {[
                  'تنمية مهارات التواصل الاجتماعي',
                  'بناء الاستقلالية والثقة بالنفس',
                  'التعلم العملي (Hands-on Learning)',
                  'متابعة دورية مع أولياء الأمور'
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
            <Pill tone="blue"><Sparkles size={14} className="ml-1.5 inline" /> يومياتنا</Pill>
            <h2 className="mt-6 text-4xl font-bold text-primary sm:text-5xl">
              لحظات لا تُنسى.
            </h2>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              نلتقط الفرح والاستكشاف والتعلم في كل زاوية من زوايا حضانة EC. تصفحي ألبوم الصور لتتعرفي على بيئتنا عن قرب وتشاهدين ابتسامات أطفالنا.
            </p>
          </div>
          
          <div className="animate-rise delay-200 max-w-7xl mx-auto">
            <GalleryCarousel images={displayedGallery} />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-white px-5 py-12 sm:px-8 text-center text-sm font-medium text-muted-foreground">
        <img src={`${basePath}/ec-official-logo.png`} alt="حضانة EC" className="mx-auto mb-6 h-auto w-48 object-contain sm:w-56" />
        <p>جميع الحقوق محفوظة © {new Date().getFullYear()} حضانة EC ثنائية اللغة - Education Group</p>
      </footer>
    </div>
  );
}
