const places = [...document.querySelectorAll('[data-place]')]
const pins = [...document.querySelectorAll('[data-pin]')]
const map = document.querySelector('#map')
const search = document.querySelector('#search')
const toggle = document.querySelector('.map-toggle')
const exhibit = document.querySelector('.exhibit')
// Map each photographed quadrilateral onto a flat face of the CSS cabinet.
// Corner order: top-left, top-right, bottom-right, bottom-left in the original JPEG.
function photoFace(source, corners, width, height, side) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.className = 'face ' + side
  const ctx = canvas.getContext('2d')
  const pixels = ctx.createImageData(width, height)
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] = corners
  const dx = x0-x1+x2-x3, dy = y0-y1+y2-y3
  const det = (x1-x2)*(y3-y2)-(x3-x2)*(y1-y2)
  const g = (dx*(y3-y2)-(x3-x2)*dy)/det
  const h = ((x1-x2)*dy-dx*(y1-y2))/det
  for (let y=0; y<height; y++) {
    const v = y/(height-1)
    for (let x=0; x<width; x++) {
      const u = x/(width-1), w = 1+g*u+h*v
      const sx = Math.round((x0+u*(x1-x0+g*x1)+v*(x3-x0+h*x3))/w)
      const sy = Math.round((y0+u*(y1-y0+g*y1)+v*(y3-y0+h*y3))/w)
      const src = (sy*source.width+sx)*4, dst = (y*width+x)*4
      for (let channel=0; channel<3; channel++) pixels.data[dst+channel] = source.data[src+channel]
      pixels.data[dst+3] = 255
    }
  }
  ctx.putImageData(pixels,0,0)
  return canvas
}
async function mountTurntable() {
  const image = exhibit.querySelector('.cabinet img')
  await image.decode()
  const texture = document.createElement('canvas')
  texture.width = image.naturalWidth
  texture.height = image.naturalHeight
  const ctx = texture.getContext('2d')
  ctx.drawImage(image,0,0)
  const source = ctx.getImageData(0,0,texture.width,texture.height)
  const model = document.createElement('div')
  model.className = 'kiosk-model'
  model.setAttribute('role','img')
  model.setAttribute('aria-label',image.alt)
  model.append(
    photoFace(source,[[491,99],[976,73],[965,630],[498,690]],512,576,'front'),
    photoFace(source,[[328,64],[486,99],[494,688],[337,577]],180,576,'left'),
    photoFace(source,[[331,61],[759,48],[972,70],[490,96]],512,180,'top')
  )
  for (const side of ['right','back']) {
    const panel = document.createElement('div')
    panel.className = 'face ' + side
    model.append(panel)
  }
  const button = exhibit.querySelector('.spin-control')
  const preference = matchMedia('(prefers-reduced-motion: reduce)')
  let studio
  let playing = !preference.matches
  try {
    studio = createStudioKiosk(model.querySelector('.front'), image.parentElement, () => {
      studio.canvas.remove()
      studio = null
      model.hidden = false
      model.style.animationPlayState = playing ? 'running' : 'paused'
    })
  } catch {
    // The CSS turntable also works on devices with unavailable GPU resources.
  }
  if (studio) {
    studio.canvas.setAttribute('role','img')
    studio.canvas.setAttribute('aria-label',image.alt)
    image.after(studio.canvas)
    model.hidden = true
  }
  const setPlaying = value => {
    playing = value
    studio?.setPlaying(playing)
    model.style.animationPlayState = playing ? 'running' : 'paused'
    button.textContent = playing ? button.dataset.pause : button.dataset.play
  }
  setPlaying(!preference.matches)
  button.addEventListener('click', () => setPlaying(model.style.animationPlayState !== 'running'))
  preference.addEventListener('change', () => setPlaying(!preference.matches))
  image.after(model)
  image.hidden = true
  button.hidden = false
}
// Keep the original photograph if canvas, the texture, or 3D rendering is unavailable.
if (CSS.supports('transform-style','preserve-3d')) mountTurntable().catch(() => {})
const metricPicker = document.querySelector('.switches')
metricPicker.hidden = false
for (const button of metricPicker.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    for (const option of metricPicker.querySelectorAll('button')) {
      option.setAttribute('aria-pressed', String(option === button))
    }
    for (const chart of document.querySelectorAll('[data-series]')) {
      chart.hidden = chart.dataset.series !== button.dataset.showSeries
    }
  })
}
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
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      entry.target.classList.toggle('section-enter', entry.isIntersecting)
    }
  })
  for (const section of document.querySelectorAll('main > section')) {
    observer.observe(section)
  }
  // Observe the bars themselves: on phones the section heading appears much earlier.
  const details = new IntersectionObserver(entries => {
    for (const entry of entries) {
      // Start once enough is visible; reset only after a complete exit.
      if (entry.intersectionRatio >= 0.35 || !entry.isIntersecting) {
        entry.target.classList.toggle('motion-enter', entry.isIntersecting)
        entry.target.classList.toggle('motion-ready', !entry.isIntersecting)
      }
    }
  }, { threshold: [0, 0.35] })
  for (const element of document.querySelectorAll('.bars, .review-grid figure')) {
    element.classList.add('motion-ready')
    details.observe(element)
  }
}
