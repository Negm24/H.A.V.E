// Illustrative public records. Customers are distinct across the network each month.
export const locations = [
  {id:'quay', name:['Quay House','بيت المرسى'], area:['Zamalek','الزمالك'], x:31.22,y:30.06,hours:[8,22]},
  {id:'garden', name:['Garden Court','ساحة الحديقة'], area:['Dokki','الدقي'], x:31.21,y:30.037,hours:[8,21]},
  {id:'atrium', name:['East Atrium','الردهة الشرقية'], area:['Nasr City','مدينة نصر'], x:31.34,y:30.064,hours:[9,22]},
  {id:'station', name:['South Arcade','الرواق الجنوبي'], area:['Maadi','المعادي'], x:31.26,y:29.964,hours:[7,23]},
]
export const months = [
  {date:'2026-05',customers:620, orders:{quay:248,garden:286,atrium:171,station:245}},
  {date:'2026-06',customers:740, orders:{quay:305,garden:312,atrium:202,station:301}},
  {date:'2026-07',customers:890, orders:{quay:358,garden:331,atrium:295,station:386}},
  {date:'2026-08',customers:1080,orders:{quay:452,garden:418,atrium:368,station:462}},
  {date:'2026-09',customers:1270,orders:{quay:525,garden:496,atrium:423,station:556}},
  {date:'2026-10',customers:1480,orders:{quay:604,garden:583,atrium:491,station:642}},
]
export const latest=months.at(-1)
export const collections=Object.values(latest.orders).reduce((a,b)=>a+b,0)
// Fictional testimonials for the public homepage preview.
export const reviews = [
  {
    name: ['Mariam', 'مريم'],
    area: ['Maadi', 'المعادي'],
    quote: ['I checked the kiosk before I left work. It was a relief to know the plasters I needed were there.', 'شفت على الموبايل قبل ما أخرج من الشغل إن لزق الجروح موجود في الكشك. ده وفّر عليّا اللف عليه.'],
  },
  {
    name: ['Omar', 'عمر'],
    area: ['Dokki', 'الدقي'],
    quote: ['I ordered on my lunch break and picked it up on my walk home. I liked being able to do the two things at different times.', 'طلبت في استراحة الغدا واستلمت وأنا مروّح مشي. عجبني إني أقدر أطلب في وقت وأستلم في وقت تاني.'],
  },
  {
    name: ['Salma', 'سلمى'],
    area: ['Nasr City', 'مدينة نصر'],
    quote: ['My mum and I switched the kiosk to Arabic and picked out what we needed together. She used it on her own the next time.', 'أنا وماما اخترنا العربي على شاشة الكشك وجبنا اللي محتاجينه سوا. المرة اللي بعدها استخدمته لوحدها.'],
  },
]
export const milestones=[
  {date:'2026-01',title:['First kiosk installation','تركيب أول كشك']},
  {date:'2026-04',title:['H.A.V.E Hub opens on mobile','إطلاق بوابة H.A.V.E للهواتف']},
  {date:'2026-08',title:['Over a thousand monthly collecting customers','تجاوز ألف عميل مستلم خلال شهر واحد']},
]
export const productURL='https://have.autopharm.com/'
