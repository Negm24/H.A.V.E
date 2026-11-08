import { locations, months, latest, collections, reviews, milestones, productURL } from './data.mjs'

export function render(lang, fonts = false) {
  const ar = lang === 'ar', i = ar ? 1 : 0
  const t = (en,arabic) => ar ? arabic : en
  const num = value => new Intl.NumberFormat(ar?'ar-EG':'en-GB').format(value)
  const month = (date,year=false) => new Intl.DateTimeFormat(ar?'ar-EG':'en-GB',{month:year?'long':'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'}).format(new Date(date+'-01T12:00:00Z'))
  const clock = hour => new Intl.DateTimeFormat(ar?'ar-EG':'en-GB',{hour:'numeric',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).format(Date.UTC(2026,0,1,hour))
  const sample=t('Illustrative data','بيانات توضيحية')
  const brand='<span class="symbol" aria-hidden="true"></span><b dir="ltr">AutoPharm</b>'
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
  const orders = months.map(m => Object.values(m.orders).reduce((sum, n) => sum+n, 0))
  const customers = months.map(m => m.customers)
  function spark(values) {
    const max = Math.max(...values)
    const points = values.map((v,k) => `${2+k*96/Math.max(1,values.length-1)},${30-v/max*27}`).join(' ')
    return `<svg class="spark" viewBox="0 0 100 32" aria-hidden="true"><polyline points="${points}" /></svg>`
  }
  function plot(values, label, key, hidden=false) {
    const scale = Math.ceil(Math.max(...values)/500)*500
    return `<figure class="chart" data-series="${key}" ${hidden?'hidden':''}>
      <figcaption>${label}</figcaption>
      <div class="bars">${values.map((v,k)=>`<div><strong>${num(v)}</strong><i style="height:${v/scale*128}px;--delay:${k*65}ms"></i><small>${month(months[k].date)}</small></div>`).join('')}</div>
      <small>${sample} · ${num(2026)}</small></figure>`
  }
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
          <h1>${t('Your pharmacy','مستلزماتك الصيدلية')}<br><em>${t('pick-up point.','في طريقك.')}</em></h1>
          <p class="lead">${t('AutoPharm connects everyday essentials to the places you pass. Order on your phone. Collect at a H.A.V.E kiosk.', 'تضع أوتوفارم مستلزماتك اليومية في الأماكن التي تمرّ بها. اطلب من هاتفك واستلم من كشك H.A.V.E.')}</p>
          <div class="actions"><a class="primary" href="${productURL}">${explore} ${arrow}</a><a class="sub" href="#coverage">${t('Find a kiosk','ابحث عن كشك')} ↓</a></div>
        </div>
        <figure class="exhibit">
          <div class="orbit base" aria-hidden="true"></div><div class="orbit satellite" aria-hidden="true"></div>
          <div class="cabinet"><img src="/kiosk.jpeg" width="1280" height="720" fetchpriority="high" alt="${t('H.A.V.E self-service kiosk','كشك H.A.V.E للخدمة الذاتية')}"></div>
          <button class="spin-control" type="button" hidden data-play="${t('Play rotation','تشغيل الدوران')}" data-pause="${t('Pause rotation','إيقاف الدوران مؤقتاً')}"></button>
          <figcaption><i aria-hidden="true"></i> H.A.V.E <span>/</span> ${t('Collection kiosk','كشك الاستلام')}</figcaption>
        </figure>
      </div>
    </section>
  <section id="impact" class="wrap observatory section">
    <div class="panel-heading"><div><p class="kicker">${t('Network activity','نشاط الشبكة')}</p><h2>${t('The network in numbers.','الشبكة بالأرقام.')}</h2></div><small>${sample} · ${month(latest.date,true)}</small></div>
    <div class="dashboard">
      <div class="readings">
        <div>${statistic(locations.length,t('Kiosk locations','مواقع الأكشاك'))}<span class="node-mark" aria-hidden="true">⌖</span></div>
        <div>${statistic(latest.customers,t('Monthly collecting customers','العملاء المستلمون شهرياً'))}${spark(customers)}</div>
        <div>${statistic(collections,t('Monthly orders collected','الطلبات المستلمة شهرياً'))}${spark(orders)}</div>
      </div>
      <div class="instrument" id="adoption">
        <div class="switches" role="group" aria-label="${t('Graph metric','مؤشر الرسم البياني')}" hidden>
          <button type="button" data-show-series="customers" aria-pressed="true">${t('Customers','العملاء')}</button>
          <button type="button" data-show-series="orders" aria-pressed="false">${t('Orders','الطلبات')}</button>
        </div>
        ${plot(customers,t('Monthly customers collecting at least one order','العملاء الذين استلموا طلباً واحداً على الأقل شهرياً'),'customers')}
        ${plot(orders,t('Orders collected each month','عدد الطلبات المستلمة كل شهر'),'orders',true)}
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
  <section class="product section" id="product">
    <div class="wrap"><p class="kicker">H.A.V.E</p>
    <h2>${t('Choose on your phone.','اختر من هاتفك.')}<br>${t('Collect at the kiosk.','واستلم من الكشك.')}</h2>
    <div class="steps">${steps.map(([title,body],k)=>`<article><span class="step">${num(k+1)}</span>
    <h3>${title}</h3><p>${body}</p>
    </article>`).join('')}</div><a class="sub" href="${productURL}">${explore} ${arrow}</a>
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
    <svg class="routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${route}" /></svg>
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
