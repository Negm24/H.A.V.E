const places = [...document.querySelectorAll('[data-place]')]
const pins = [...document.querySelectorAll('[data-pin]')]
const map = document.querySelector('#map')
const search = document.querySelector('#search')
const toggle = document.querySelector('.map-toggle')
function selectPlace(id) {
  for (const el of [...places, ...pins]) {
    el.setAttribute('aria-pressed', String((el.dataset.place || el.dataset.pin) === id))
  }
  const pin = pins.find(el => el.dataset.pin === id)
  const name = map.querySelector('output')
  name.textContent = pin?.getAttribute('aria-label') || ''
  name.hidden = !pin
}
for (const el of [...places, ...pins]) {
  el.addEventListener('click', () => selectPlace(el.dataset.place || el.dataset.pin))
}
search.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase()
  for (const place of places) {
    place.hidden = !place.textContent.toLocaleLowerCase().includes(query)
    pins.find(pin => pin.dataset.pin === place.dataset.place).hidden = place.hidden
  }
  const visible = places.filter(place => !place.hidden)
  document.querySelector('#empty').hidden = visible.length > 0
  selectPlace((visible.find(place => place.getAttribute('aria-pressed') === 'true') || visible[0])?.dataset.place)
})
toggle.addEventListener('click', () => {
  const open = map.classList.toggle('open')
  toggle.setAttribute('aria-expanded', String(open))
  toggle.textContent = open ? toggle.dataset.hide : toggle.dataset.show
})
const form = document.querySelector('#inquiry')
document.querySelector('[data-host-inquiry]').addEventListener('click', () => {
  form.elements.reason.value = 'hosting'
  document.querySelector('#confirmation').hidden = true
})
form.addEventListener('submit', event => {
  event.preventDefault()
  document.querySelector('#confirmation').hidden = false
})
form.addEventListener('input', () => { document.querySelector('#confirmation').hidden = true })
form.querySelector('button').disabled = false

// Content stays visible before JavaScript runs and when motion is disabled.
if ('IntersectionObserver' in window && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('section-enter')
      observer.unobserve(entry.target)
    }
  })
  for (const section of document.querySelectorAll('main > section:not(.hero)')) {
    observer.observe(section)
  }
  // Observe the bars themselves: on phones the section heading appears much earlier.
  const details = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.intersectionRatio < 0.35) continue
      entry.target.classList.replace('motion-ready', 'motion-enter')
      details.unobserve(entry.target)
    }
  }, { threshold: 0.35 })
  for (const element of document.querySelectorAll('.bars, .review-grid figure')) {
    element.classList.add('motion-ready')
    details.observe(element)
  }
}
