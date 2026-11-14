import { locations, assortment, milestones } from './data.mjs'

export function render(lang, fonts = false) {
  const ar = lang === 'ar', i = ar ? 1 : 0
  const t = (en,arabic) => ar ? arabic : en
  const num = value => new Intl.NumberFormat(ar?'ar-EG':'en-GB').format(value)
  const month = (date,year=false) => new Intl.DateTimeFormat(ar?'ar-EG':'en-GB',{month:year?'long':'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'}).format(new Date(date+'-01T12:00:00Z'))
  const clock = hour => new Intl.DateTimeFormat(ar?'ar-EG':'en-GB',{hour:'numeric',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).format(Date.UTC(2026,0,1,hour))
  const brand='<span class="symbol" aria-hidden="true"></span><b dir="ltr">AutoPharm</b>'
  const arrow='<span class="arrow" aria-hidden="true">↗</span>'
  const nav=[['company',t('Company','الشركة')],['product','H.A.V.E'],['milestones',t('Growth','التطوّر')],['coverage',t('Locations','المواقع')]]
  const links=nav.map(([id,label])=>`<a href="#${id}">${label}</a>`).join('')
  const statistic=(n,label)=>`<div><strong class="figure">${num(n)}</strong><span>${label}</span></div>`
  const steps=[
    [t('Choose your kiosk','اختر الكشك'),t('Open the Hub on your phone and browse the essentials available at your preferred location.','افتح البوابة على هاتفك وتصفّح المستلزمات المتاحة في الموقع الذي تفضّله.')],
    [t('Check availability and order','شوف المتاح واطلب'),t('Select what you need and pay from your phone before you head out.','اختر ما تحتاجه وادفع من هاتفك قبل التوجه إلى الكشك.')],
    [t('Collect at that kiosk','استلم من نفس الكشك'),t('Sign in at your selected kiosk and collect your order. You can also browse and order directly at the kiosk.','سجّل الدخول في الكشك الذي اخترته لاستلام طلبك. ويمكنك أيضاً التصفّح والطلب مباشرةً من الكشك.')]
  ]
  const categoryCounts = assortment.map(category => category.products.length)
  const assortmentChart = `<figure class="chart"><figcaption>${t('What can I find in a kiosk?','ماذا أجد في الكشك؟')}</figcaption><div class="bars">${assortment.map((category,k)=>`<div><strong>${num(categoryCounts[k])}</strong><i style="height:${categoryCounts[k]/Math.max(...categoryCounts)*128}px;--delay:${k*65}ms"></i><small>${category.label[i]}</small></div>`).join('')}</div><small>${t('Example kiosk assortment · distinct products per category','تشكيلة كشك توضيحية · عدد المنتجات المختلفة بكل فئة')}</small></figure>`
  const pinPosition = site => [(site.x-31.16)/.22*100, (30.10-site.y)/.17*100]
  const route = [...locations].sort((a,b)=>a.y-b.y).map(s=>pinPosition(s).join(',')).join(' ')
  const dots=locations.map((s,k)=>`<button type="button" data-pin="${s.id}" aria-label="${s.name[i]} · ${s.area[i]}" aria-pressed="${k===0}" style="left:${(s.x-31.16)/.22*100}%;top:${(30.10-s.y)/.17*100}%">${num(k+1)}</button>`).join('')
  return `<!doctype html>
    <html lang="${lang}" dir="${ar?'rtl':'ltr'}">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${t('Discover AutoPharm and its connected H.A.V.E network of self-service pharmacy kiosks.','تعرّف على أوتوفارم وشبكة H.A.V.E المترابطة لأكشاك المستلزمات الصيدلية ذاتية الخدمة.')}"><title>${t('AutoPharm | Connected pharmacy kiosks','أوتوفارم | شبكة أكشاك المستلزمات الصيدلية')}</title><link rel="alternate" hreflang="en" href="/"><link rel="alternate" hreflang="ar" href="/ar/">${fonts?'<link rel="stylesheet" href="/fonts.css">':''}<link rel="stylesheet" href="/site.css">
    <script type="module" src="/site.js">
    </script>
    </head>
    <body>
  <a class="skip" href="#main">${t('Skip to content','انتقل إلى المحتوى')}</a>
  <header class="wrap"><a class="brand" href="${ar?'/ar/':'/'}">${brand}</a>
    <nav aria-label="${t('Main navigation','التنقل الرئيسي')}">${links}</nav>
    <div class="header-end"><a data-language href="${ar?'/':'/ar/'}" lang="${ar?'en':'ar'}">${ar?'English':'العربية'}</a><a class="outline" href="#contact">${t('Contact us','تواصل معنا')} ${arrow}</a>
    </div>
    </header>
  <main id="main">
    <section class="hero" id="home">
      <div class="hero-inner wrap">
        <div class="hero-text">
          <p class="kicker">${t('Self-service pharmacy network','شبكة الخدمة الصيدلية الذاتية')}</p>
          <h1>${t('Know what’s in the kiosk','اعرف المتاح في الكشك')}<br><em>${t('before you go.','قبل ما تروح.')}</em></h1>
          <p class="lead">${t('Check medicines at your chosen H.A.V.E kiosk. Order on your phone and collect there, or shop at the machine when you arrive.', 'شوف الأدوية المتاحة في كشك H.A.V.E اللي تختاره. اطلب من موبايلك واستلم هناك، أو اشترِ من الكشك لما توصل.')}</p>
          <div class="actions"><a class="primary" href="#product">${t("See how pickup works","شوف طريقة الاستلام")}</a><a class="sub" href="#coverage">${t('Find a kiosk','ابحث عن كشك')} ↓</a></div>
        </div>
        <figure class="exhibit">
          <div class="orbit base" aria-hidden="true"></div><div class="orbit satellite" aria-hidden="true"></div>
          <div class="cabinet"><img src="/kiosk.jpeg" width="1280" height="720" fetchpriority="high" alt="${t('H.A.V.E self-service kiosk','كشك H.A.V.E للخدمة الذاتية')}"></div>
          <p class="rotate-hint" id="rotate-hint" hidden>${t('Drag to rotate · Arrow keys also work','اسحب للتدوير · يمكنك استخدام مفاتيح الأسهم')}</p>
          <figcaption><i aria-hidden="true"></i> H.A.V.E <span>/</span> ${t('Collection kiosk','كشك الاستلام')}</figcaption>
        </figure>
      </div>
    </section>
  <section id="impact" class="wrap observatory section">
    <div class="panel-heading"><div><p class="kicker">H.A.V.E</p><h2>${t('Made for your everyday stops.','جزء من مشاويرك اليومية.')}</h2></div></div>
    <div class="dashboard"><div class="readings">
    <div>${statistic(2,t('Ways to shop','طريقتان للشراء'))}<p>${t('On your phone or at the kiosk.','من موبايلك أو من الكشك.')}</p></div>
    <div>${statistic(2,t('Languages','لغتان'))}<p>${t('Arabic and English.','العربية والإنجليزية.')}</p></div>
    </div><div class="instrument">${assortmentChart}</div></div>
  </section>
  <section class="wrap section split" id="why">
    <div><p class="kicker">${t('Why H.A.V.E','لماذا H.A.V.E')}</p><h2>${t('Need one thing on your way home?','محتاج دواء وأنت مروّح؟')}</h2></div>
    <div><p class="big">${t('Check before you make the trip.','اتأكد قبل ما تعمل المشوار.')}</p><p>${t('Choose a kiosk on your route, see whether it carries what you need, then decide where to stop. Order ahead on your phone, or browse and buy at the machine.','اختار كشك في طريقك، وشوف إذا كان فيه اللي محتاجه، وبعدها قرر هتوقف فين. اطلب مسبقاً من موبايلك، أو تصفّح واشترِ من الكشك.')}</p></div>
  </section>
  <section class="product section" id="product">
    <div class="wrap"><p class="kicker">H.A.V.E</p>
    <h2>${t('Choose on your phone.','اختر من هاتفك.')}<br>${t('Collect at the kiosk.','واستلم من الكشك.')}</h2>
    <figure class="hub-walkthrough"><img src="/hub-screen.png" alt="${t("H.A.V.E Hub home screen","الشاشة الرئيسية لبوابة H.A.V.E")}"><figcaption>${t("Start with the kiosk that fits your route.","ابدأ بالكشك المناسب لطريقك.")}</figcaption></figure><div class="steps">${steps.map(([title,body],k)=>`<article><span class="step">${num(k+1)}</span>
    <h3>${title}</h3><p>${body}</p>
    </article>`).join('')}</div><p class="coming-soon">${t("Medicine browsing coming soon","تصفّح الأدوية قريباً")}</p>
    </div>
    </section>
  <section class="wrap section coverage" id="coverage"><p class="kicker">${t('Locations','المواقع')}</p>
    <h2>${t('Find a kiosk in Greater Cairo','ابحث عن كشك في القاهرة الكبرى')}</h2><small>${t('Example locations · illustrative venues and hours','مواقع توضيحية · أمثلة للأماكن وساعات العمل')}</small>
    <div class="locator">
    <div>
    <label for="search">${t('Search by venue or neighbourhood','ابحث باسم الموقع أو الحي')}</label><input type="search" id="search" placeholder="${t('e.g. Maadi','مثال: المعادي')}">
    <div class="places">${locations.map((s,k)=>`<button type="button" data-place="${s.id}" aria-pressed="${k===0}"><span class="idx">${num(k+1)}</span><span><b>${s.name[i]}</b><small>${s.area[i]} · <bdi>${clock(s.hours[0])}–${clock(s.hours[1])}</bdi></small></span></button>`).join('')}</div><p id="empty" role="status" hidden>${t('No matching kiosks. Try another neighbourhood.','لا توجد نتائج. جرّب حيّاً آخر.')}</p><button class="map-toggle outline" aria-controls="map" aria-expanded="false" data-hide="${t('Hide map','إخفاء الخريطة')}" data-show="${t('View map','عرض الخريطة')}">${t('View map','عرض الخريطة')}</button>
    </div>
    <div class="map" id="map">
    <div class="map-grid" aria-hidden="true">
    </div>
    <svg class="routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${route}" /></svg>
    <div class="river" aria-hidden="true">
    </div><span class="map-caption">${t('Greater Cairo · schematic map','القاهرة الكبرى · خريطة توضيحية')}</span>${dots}<output class="map-name">${locations[0].name[i]} · ${locations[0].area[i]}</output>
    </div>
    </div>
    </section>
  <section class="wrap section" id="milestones"><p class="kicker">${t('Impact & Growth','الأثر والتطوّر')}</p><h2>${t('Building the network','تطوّر الشبكة')}</h2><p>${t('Illustrative timeline','تسلسل زمني توضيحي')}</p>
    <ol class="growth-story">${milestones.map((m,k)=>`<li><div class="milestone-art">${k===1?'<img src="/hub-screen.png" alt="'+t('H.A.V.E Hub home screen','الشاشة الرئيسية لبوابة H.A.V.E')+'">':k===0?'<img src="/kiosk.jpeg" alt="'+t('H.A.V.E kiosk installation','تركيب كشك H.A.V.E')+'">':'<div class="pickup-scene"><span class="customer" aria-hidden="true">●</span><img src="/kiosk.jpeg" alt="'+t('Illustration of a customer collecting at H.A.V.E','رسم توضيحي لعميل يستلم من كشك H.A.V.E')+'"><span class="collection-bag" aria-hidden="true">✓</span></div>'}</div><time datetime="${m.date}">${month(m.date,true)}</time><h3>${m.title[i]}</h3></li>`).join('')}</ol></section>
  <section class="hosting section" id="hosting">
    <div class="wrap split">
      <div>
        <h2>${t('Host a H.A.V.E kiosk','استضف كشك H.A.V.E')}</h2>
        <p>${t('Give people visiting your location a convenient place to collect everyday pharmacy essentials.', 'وفّر لزوّار موقعك مكاناً مناسباً لاستلام مستلزماتهم الصيدلية اليومية.')}</p>
      </div>
      <div class="host-details">
        <dl>
          <dt>${t('Your role', 'دورك')}</dt><dd>${t('Provide a suitable space for the kiosk.', 'توفير مساحة مناسبة للكشك.')}</dd>
          <dt>${t('AutoPharm’s role', 'دور أوتوفارم')}</dt><dd>${t('Install, stock, and operate the kiosk.', 'تركيب الكشك وتزويده بالمنتجات وتشغيله.')}</dd>
        </dl>
        <a class="outline" href="#contact" data-host-inquiry>${t('Discuss a location', 'تحدّث معنا عن موقعك')} ${arrow}</a>
      </div>
    </div>
  </section>
  <section class="wrap section split" id="company">
    <div><p class="kicker">${t('The company','عن الشركة')}</p>
    <h2>${t('Why we built AutoPharm','لماذا أسّسنا أوتوفارم')}</h2>
    </div>
    <div><p class="big">${t('Picking up everyday pharmacy essentials should fit into the journey you already make.','من المفترض أن يكون استلام مستلزماتك الصيدلية اليومية جزءاً من مشوارك المعتاد.')}</p>
    <div class="pair">
    <article>
    <h3>${t('Our mission','مهمتنا')}</h3><p>${t('Make everyday pharmacy essentials easier to access through convenient self-service kiosks.','تسهيل الوصول إلى المستلزمات الصيدلية اليومية عبر أكشاك خدمة ذاتية قريبة.')}</p>
    </article>
    <article>
    <h3>${t('Our vision','رؤيتنا')}</h3><p>${t('A city where collecting the essentials is as routine as passing through your neighbourhood.','مدينة يصبح فيها استلام المستلزمات بسهولة المرور في شوارع حيّك.')}</p>
    </article>
    </div>
    </div>
    </section>
  <section class="contact section" id="contact">
    <div class="wrap split">
    <div><h2>${t('Contact AutoPharm','تواصل مع أوتوفارم')}</h2><p>${t('Talk to our team about hosting a kiosk, strategic partnerships, or investing in the network.','تحدّث مع فريقنا حول استضافة كشك أو عقد شراكة استراتيجية أو الاستثمار في الشبكة.')}</p>
    </div>
    <form id="inquiry"><small>${t('Preview form · inquiries stay in your browser.','نموذج تجريبي · تبقى الرسالة داخل متصفحك.')}</small>
    <label>${t('Your email','بريدك الإلكتروني')}<input type="email" required autocomplete="email" dir="ltr">
    </label>
    <label>${t('Reason for contacting us','سبب التواصل')}<select name="reason"><option value="hosting">${t('Host a kiosk','استضافة كشك')}</option>${[t('Partnership','شراكة'),t('Investment','استثمار'),t('General inquiry','استفسار عام')].map(x=>`<option>${x}</option>`).join('')}</select>
    </label>
    <label>${t('Message','الرسالة')}<textarea required rows="3"></textarea>
    </label><button class="primary" type="submit" disabled>${t('Preview inquiry','معاينة الاستفسار')} ${arrow}</button><p role="status" id="confirmation" hidden>${t('Preview complete. Your inquiry has not been sent.','اكتملت المعاينة. لم يتم إرسال استفسارك.')}</p>
    </form>
    </div>
    </section>
    </main>
  <footer class="wrap"><a class="brand" href="#home">${brand}</a><a href="#home">${t('Back to top','العودة إلى الأعلى')} ↑</a>
    </footer>
    </body>
    </html>`
}
