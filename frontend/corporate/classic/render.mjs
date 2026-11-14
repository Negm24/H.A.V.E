import { locations, months, latest, collections, reviews, milestones, productURL } from './data.mjs'

export function render(lang, fonts = false) {
  const ar = lang === 'ar', i = ar ? 1 : 0
  const t = (en,arabic) => ar ? arabic : en
  const num = value => new Intl.NumberFormat(ar?'ar-EG':'en-GB').format(value)
  const month = (date,year=false) => new Intl.DateTimeFormat(ar?'ar-EG':'en-GB',{month:year?'long':'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'}).format(new Date(date+'-01T12:00:00Z'))
  const clock = hour => new Intl.DateTimeFormat(ar?'ar-EG':'en-GB',{hour:'numeric',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).format(Date.UTC(2026,0,1,hour))
  const sample=t('Illustrative data','بيانات توضيحية')
  const brand='<span class="mark" aria-hidden="true">✳</span><b dir="ltr">AutoPharm</b>'
  const arrow='<span class="arrow" aria-hidden="true">↗</span>'
  const explore=t('Explore H.A.V.E','اكتشف H.A.V.E')
  const nav=[['company',t('Company','الشركة')],['product','H.A.V.E'],['impact',t('Impact','الأثر')],['coverage',t('Locations','المواقع')]]
  const links=nav.map(([id,label])=>`<a href="#${id}">${label}</a>`).join('')
  const statistic=(n,label)=>`<div><strong class="figure">${num(n)}</strong><span>${label}</span></div>`
  const steps=[
    [t('Choose your kiosk','اختر الكشك'),t('Open the Hub on your phone and browse the essentials available at your preferred location.','افتح البوابة على هاتفك وتصفّح المستلزمات المتاحة في الموقع الذي تفضّله.')],
    [t('Place your order','أكمل طلبك'),t('Select what you need and pay from your phone before you head out.','اختر ما تحتاجه وادفع من هاتفك قبل التوجه إلى الكشك.')],
    [t('Collect on your way','استلم في طريقك'),t('Sign in at your selected kiosk and collect your order. You can also browse and order directly at the kiosk.','سجّل الدخول في الكشك الذي اخترته لاستلام طلبك. ويمكنك أيضاً التصفّح والطلب مباشرةً من الكشك.')]
  ]
  const max=Math.ceil(Math.max(...months.map(m=>m.customers))/500)*500
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
    <section class="hero wrap" id="home">
    <div class="hero-text"><p class="kicker"><span class="dot"></span>${t('Connected pharmacy kiosks','أكشاك صيدلية مترابطة')}</p>
  <h1>${t('Pharmacy essentials,','مستلزماتك الصيدلية،')} <em>${t('closer to you.','أقرب إليك.')}</em>
    </h1>
  <p class="lead">${t('AutoPharm connects your phone to a network of H.A.V.E kiosks. Order everyday essentials and collect them on your way.','تربط أوتوفارم هاتفك بشبكة أكشاك H.A.V.E. اطلب مستلزماتك اليومية واستلمها في طريقك.')}</p>
  <div class="actions"><a class="primary" href="${productURL}">${explore} ${arrow}</a><a class="sub" href="#coverage">${t('See our coverage','استعرض مواقعنا')} <span aria-hidden="true">↓</span></a>
    </div>
    </div>
  <figure class="stage">
    <div class="stage-label"><i></i> H.A.V.E</div><img src="/kiosk.jpeg" width="1280" height="720" alt="${t('H.A.V.E self-service kiosk with a touchscreen and collection bay','كشك H.A.V.E للخدمة الذاتية مزوّد بشاشة لمس وفتحة استلام')}">
    <figcaption><span>${t('Self-service kiosk','كشك الخدمة الذاتية')}</span><b dir="ltr">FIG. 01</b>
    </figcaption>
  <div class="hub-card"><span class="check" aria-hidden="true">✓</span>
    <div><small>H.A.V.E HUB</small><strong>${t('Ready for collection','جاهز للاستلام')}</strong>
    </div>
    </div>
    </figure>
    </section>
  <section id="impact" class="impact">
    <div class="wrap">
    <div class="impact-head">
    <h2>${t('Our network in numbers','شبكتنا بالأرقام')}</h2><small>${sample} · ${month(latest.date,true)}</small>
    </div>
    <div class="metrics">
  ${statistic(locations.length,t('Operating kiosks','أكشاك عاملة'))}${statistic(latest.customers,t('Customers who collected this month','عميلاً استلموا طلباتهم هذا الشهر'))}${statistic(collections,t('Orders collected this month','طلباً تم استلامه هذا الشهر'))}</div>
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
  <section class="product section" id="product">
    <div class="wrap"><p class="kicker">H.A.V.E</p>
    <h2>${t('Choose on your phone.','اختر من هاتفك.')}<br>${t('Collect at the kiosk.','واستلم من الكشك.')}</h2>
    <div class="steps">${steps.map(([title,body],k)=>`<article><span class="step">${num(k+1)}</span>
    <h3>${title}</h3><p>${body}</p>
    </article>`).join('')}</div><a class="sub" href="${productURL}">${explore} ${arrow}</a>
    </div>
    </section>
  <section class="wrap section" id="adoption">
    <div class="proof">
    <div><p class="kicker">${t('Adoption','نمو الاستخدام')}</p>
    <h2>${t('More people are collecting with H.A.V.E','المزيد من الناس يستلمون طلباتهم عبر H.A.V.E')}</h2><p>${t('Each month counts distinct customers who collected at least one order across the network.','يُمثّل كل شهر عدد العملاء الذين استلموا طلباً واحداً على الأقل عبر الشبكة، مع احتساب كل عميل مرة واحدة.')}</p>
    </div>
    <figure class="chart">
    <figcaption>${t('Monthly collecting customers','العملاء المستلمون شهرياً')}</figcaption>
    <div class="bars">${months.map((m,index)=>`<div><strong>${num(m.customers)}</strong><i style="height:${m.customers/max*110}px;--delay:${index*70}ms"></i><small>${month(m.date)}</small>
    </div>`).join('')}</div><small>${sample} · ${num(2026)}</small>
    </figure>
    </div>
    </section>
  <section class="wrap section coverage" id="coverage"><p class="kicker">${t('Locations','المواقع')}</p>
    <h2>${t('Find a kiosk in Greater Cairo','ابحث عن كشك في القاهرة الكبرى')}</h2><small>${sample} · ${t('Example venues and hours','أمثلة توضيحية للمواقع وساعات العمل')}</small>
    <div class="locator">
    <div>
    <label for="search">${t('Search by venue or neighbourhood','ابحث باسم الموقع أو الحي')}</label><input type="search" id="search" placeholder="${t('e.g. Maadi','مثال: المعادي')}">
    <div class="places">${locations.map((s,k)=>`<button type="button" data-place="${s.id}" aria-pressed="${k===0}"><span class="idx">${num(k+1)}</span><span><b>${s.name[i]}</b><small>${s.area[i]} · <bdi>${clock(s.hours[0])}–${clock(s.hours[1])}</bdi></small></span></button>`).join('')}</div><p id="empty" role="status" hidden>${t('No matching kiosks. Try another neighbourhood.','لا توجد نتائج. جرّب حيّاً آخر.')}</p><button class="map-toggle outline" aria-controls="map" aria-expanded="false" data-hide="${t('Hide map','إخفاء الخريطة')}" data-show="${t('View map','عرض الخريطة')}">${t('View map','عرض الخريطة')}</button>
    </div>
    <div class="map" id="map">
    <div class="map-grid" aria-hidden="true">
    </div>
    <div class="river" aria-hidden="true">
    </div><span class="map-caption">${t('Greater Cairo · schematic map','القاهرة الكبرى · خريطة توضيحية')}</span>${dots}<output class="map-name">${locations[0].name[i]} · ${locations[0].area[i]}</output>
    </div>
    </div>
    </section>
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
  <section class="wrap section reviews" id="reviews" aria-labelledby="reviews-title">
    <h2 id="reviews-title">${t('Community reviews', 'آراء المجتمع')}</h2>
    <small>${t('Sample reviews from fictional customers.', 'آراء توضيحية لعملاء خياليين.')}</small>
    <div class="review-grid">
      ${reviews.map(review => `<figure>
        <blockquote>${t('“','«')}${review.quote[i]}${t('”','»')}</blockquote>
        <figcaption><strong>${review.name[i]}</strong> · ${review.area[i]}</figcaption>
      </figure>`).join('')}
    </div>
  </section>
  <section class="wrap section split" id="milestones">
    <div><p class="kicker">${t('Company milestones','محطات الشركة')}</p>
    <h2>${t('Building the network','تطوّر الشبكة')}</h2><small>${t('Illustrative timeline','تسلسل زمني توضيحي')}</small>
    </div>
    <ol class="timeline">${milestones.map(m=>`<li><time datetime="${m.date}">${month(m.date,true)}</time><b>${m.title[i]}</b></li>`).join('')}</ol>
    </section>
  <section class="wrap team" id="team">
    <div><p class="kicker">${t('People behind AutoPharm','فريق أوتوفارم')}</p>
    <h2>${t('One team, from the Hub to the kiosk','فريق واحد من البوابة إلى الكشك')}</h2>
    </div><p>${t('Our product team designs the mobile Hub and kiosk experience. Our operations team works with venue hosts on kiosk placement, stock and day-to-day service.','يصمّم فريق المنتج تجربة البوابة على الهاتف وشاشات الأكشاك. ويتعاون فريق التشغيل مع الجهات المضيفة لاختيار مواقع الأكشاك ومتابعة المخزون والخدمة اليومية.')}</p>
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
