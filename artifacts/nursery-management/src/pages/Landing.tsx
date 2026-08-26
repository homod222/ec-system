import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { Redirect } from 'wouter';
import { ArrowUpRight, Check, CalendarCheck, ShieldCheck, CircleDollarSign, ChevronLeft, Sparkles, Star } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

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
  if (isSignedIn) return <Redirect to="/dashboard" />;
  
  return (
    <div dir="rtl" className="min-h-[100dvh] bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      {/* Navbar */}
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <img src={`${basePath}/logo.svg`} alt="حضانة EC ثنائية اللغة" className="h-12 w-auto" />
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
            سجلي طفلك الآن
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
                ابدئي رحلة طفلك <ArrowUpRight size={18} />
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
              <img src="../../../attached_assets/7_Untitled-1-05_1787769806562.png" alt="طفلة سعيدة في الحضانة" className="w-full h-auto object-cover" />
            </div>
            
            {/* Floating Image 1 */}
            <div className="absolute -bottom-10 -right-10 z-20 w-56 overflow-hidden rounded-[1.5rem] border-8 border-white shadow-xl -rotate-6 animate-float">
              <img src="../../../attached_assets/6_Untitled-1-03_1787769806562.png" alt="نشاط مرح" className="w-full h-auto object-cover" />
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
              <img src="../../../attached_assets/5_Untitled-1-08_1787769806562.png" alt="أطفال يدرسون" className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow" />
              <img src="../../../attached_assets/1_Untitled-1-09_1787769806562.png" alt="نشاط الطهي" className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow translate-y-8" />
              <img src="../../../attached_assets/3_Untitled-1-07_1787769806562.png" alt="يوم الفضاء" className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow" />
              <img src="../../../attached_assets/0_Untitled-1-06_1787769806562.png" alt="وقت اللعب" className="rounded-3xl object-cover h-64 w-full shadow-md hover:shadow-xl transition-shadow translate-y-8" />
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

      {/* Footer */}
      <footer className="border-t border-border bg-white px-5 py-12 sm:px-8 text-center text-sm font-medium text-muted-foreground">
        <img src={`${basePath}/logo.svg`} alt="حضانة EC" className="h-10 mx-auto mb-6 grayscale hover:grayscale-0 transition-all" />
        <p>جميع الحقوق محفوظة © {new Date().getFullYear()} حضانة EC ثنائية اللغة - Education Group</p>
      </footer>
    </div>
  );
}