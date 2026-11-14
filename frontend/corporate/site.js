// Small, self-contained WebGL product viewer; dimensions are relative to cabinet width.
// All parts share one mesh buffer. Material IDs distinguish paint, metal, and glazing.
function createStudioKiosk(frontPhoto, cabinet, onContextLost) {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', { alpha:true, antialias:true, powerPreference:'low-power' })
  if (!gl) return null
  canvas.className = 'studio-kiosk'
  const vertex = `
    attribute vec3 position, normal;
    attribute float material;
    uniform float angle, pitch, aspect;
    varying vec3 world, facing, local;
    varying float materialId;
    void main() {
      float s=sin(angle), c=cos(angle);
      mat3 yaw=mat3(c,0.,-s, 0.,1.,0., s,0.,c);
      float ct=cos(pitch), st=sin(pitch);
      mat3 tilt=mat3(1.,0.,0., 0.,ct,st, 0.,-st,ct);
      world=tilt*yaw*position;
      facing=tilt*yaw*normal;
      local=position;
      materialId=material;
      float depth=3.8-world.z;
      gl_Position=vec4(world.x*5.2/aspect,world.y*5.2,depth*0.8-1.,depth);
    }`
  const fragment = `
    precision highp float;
    uniform sampler2D photo;
    varying vec3 world, facing, local;
    varying float materialId;
    void main() {
      float finish=floor(materialId+.5);
      vec3 n=normalize(facing), viewDir=normalize(vec3(0.,0.,3.8)-world);
      vec3 refl=reflect(-viewDir,n);
      vec3 color=vec3(.86,.85,.80);
      float gloss=.1;
      // Rounded opening, in cabinet coordinates. The same edge trims the enamel and glass.
      vec2 edge=abs(local.xy-vec2(-.052,.101))-vec2(.281,.302);
      float opening=length(max(edge,0.))+min(max(edge.x,edge.y),0.)-.013;
      if(finish==4. && local.z>.29 && opening<0.) discard;
      if(finish>0.5 && finish<1.5) { color=vec3(.13,.26,.16); gloss=.24; }
      if(finish>1.5 && finish<2.5) { color=vec3(.13,.15,.14); gloss=.13; }
      if(finish>2.5 && finish<3.5) { color=vec3(.60,.65,.64); gloss=.47; }
      if(finish==4. || finish==5.) {
        vec2 uv=vec2(local.x+.5,.5-local.y/1.14);
        color=texture2D(photo,clamp(uv,0.,1.)).rgb;
        gloss=finish>4.5 ? .34 : .055;
      }
      if(finish==6.) { color=vec3(.43,.47,.44); gloss=.08; }
      if(finish==7.) { color=vec3(.86,.85,.82); gloss=.12; }
      // Fixed studio lamps: broad upper-left key, warm fill and cooler strip reflection.
      float key=max(dot(n,normalize(vec3(-.52,.82,.72))),0.);
      float fill=max(dot(n,normalize(vec3(.78,.28,-.40))),0.);
      float sky=n.y*.5+.5;
      vec3 lit=color*(.67+.19*sky+.26*key+.12*fill);
      // A close area light falls off across each panel rather than lighting it uniformly.
      vec3 toPanelLight=vec3(-1.25,1.55,1.2)-world;
      float panelLight=max(dot(n,normalize(toPanelLight)),0.)/(.7+dot(toPanelLight,toPanelLight));
      lit*=.93+.11*smoothstep(-.55,.42,local.y)+.38*panelLight;
      if(finish==6. || finish==7.) {
        float recess=1.-smoothstep(.015,.285,local.z);
        float underShelf=1.-smoothstep(.0,.067,mod(.232-local.y+.028*recess+.568,.142));
        float corner=1.-smoothstep(.0,.075,min(.295-abs(local.x+.052),.315-abs(local.y-.101)));
        lit*=1.-.19*recess-.25*underShelf*recess-.15*corner;
        if(finish==6.) {
          // Each projecting tray casts a soft band on the liner behind it.
          float belowLip=mod(.232-local.y+.568,.142);
          lit*=1.-.23*recess*(1.-smoothstep(.006,.055,belowLip));

        }
      }
      float strip=pow(max(dot(refl,normalize(vec3(-.64,.38,.72))),0.),18.);
      float softbox=pow(max(dot(refl,normalize(vec3(.68,.66,.28))),0.),7.);
      float rim=pow(1.-max(dot(n,viewDir),0.),3.);
      if(finish==10.) {
        if(opening>0.) discard;
        float reflection=pow(max(dot(refl,normalize(vec3(-.54,.36,.75))),0.),12.);
        gl_FragColor=vec4(mix(vec3(.61,.79,.77),vec3(.94,.98,1.),reflection),
                          .055+.18*reflection+.24*rim);
        return;
      }
      gl_FragColor=vec4(lit+gloss*(strip*vec3(.95,.96,1.)+
                        softbox*vec3(.65,.60,.47)+rim*.26),1.);
    }`
  function shader(type, source) {
    const obj=gl.createShader(type)
    gl.shaderSource(obj,source)
    gl.compileShader(obj)
    if (!gl.getShaderParameter(obj,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(obj))
    return obj
  }
  const program=gl.createProgram()
  gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex))
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program))
  gl.useProgram(program)
  const vertices=[], indices=[]
  const paint=0, forest=1, charcoal=2, steel=3, photographic=4, glass=5
  function box(center, size, radius, finish, front=finish) {
    const half=size.map(v=>v/2)
    const r=Math.min(radius,...half.map(v=>v*.95))
    const inner=half.map(v=>v-r)
    // Bevels use curved normals, with broad, flat panels between the rounded edges.
    function stops(axis) {
      const h=half[axis], b=inner[axis]
      return [-h,-b-r*.67,-b-r*.33,-b,b,b+r*.33,b+r*.67,h]
    }
    for (let axis=0;axis<3;axis++) for (const sign of [-1,1]) {
      const a=(axis+1)%3,b=(axis+2)%3, start=vertices.length/7
      const us=stops(a),vs=stops(b)
      for (const v of vs) for (const u of us) {
        const p=[0,0,0]
        p[axis]=sign*half[axis];p[a]=u;p[b]=v
        const core=p.map((value,i)=>Math.max(-inner[i],Math.min(value,inner[i])))
        const delta=p.map((value,i)=>value-core[i])
        const len=Math.hypot(...delta), norm=delta.map(n=>n/len)
        vertices.push(...core.map((value,i)=>center[i]+value+r*norm[i]),...norm,axis===2&&sign===1?front:finish)
      }
      for (let row=0;row<vs.length-1;row++) for(let col=0;col<us.length-1;col++) {
        const i=start+row*us.length+col,j=i+us.length
        indices.push(i,i+1,j,j,i+1,j+1)
      }
    }
  }
  // A recessed plinth, folded painted shell and separate crown form the silhouette.
  box([0,-.553,0],[.94,.07,.55],.021,charcoal)
  box([0,-.515,0],[1,.094,.605],.014,forest,photographic)
  box([0,-.002,0],[1,.938,.60],.019,paint,photographic)
  box([0,.515,0],[1.006,.111,.607],.017,forest,photographic)
  box([0,.571,0],[.985,.012,.586],.005,steel)
  // Coordinates match the sight glass, terminal and pickup bay in the supplied front.
  const lining=6
  box([-.052,.101,-.018],[.612,.662,.018],.005,lining)
  for(const x of [-.354,.250]) box([x,.101,.145],[.014,.662,.322],.004,lining)
  for(const y of [-.222,.424]) box([-.052,y,.145],[.610,.014,.322],.004,lining)
  // Cross-section of the original open dispensing lanes: narrow floor, flared lips.
  // Extrude it toward the window with a gentle downward feed slope.
  function dispensingLane(cx, level) {
    const profile=[[-.040,.035],[-.030,0],[.030,0],[.040,.035],
                   [.034,.035],[.025,.007],[-.025,.007],[-.034,.035]]
    const point=(idx,front)=>{
      const [x,y]=profile[idx]
      return [cx+x,level+y+(front?0:.052),front?.166:-.006]
    }
    for(let i=0;i<profile.length;i++) {
      const j=(i+1)%profile.length
      const dx=profile[j][0]-profile[i][0],dy=profile[j][1]-profile[i][1]
      const n=[dy,-dx,-dx*.052/.172],len=Math.hypot(...n)
      const base=vertices.length/7
      for(const v of [point(i,false),point(j,false),point(j,true),point(i,true)]) {
        vertices.push(...v,...n.map(value=>value/len),7)
      }
      indices.push(base,base+1,base+2,base,base+2,base+3)
    }
    const start=vertices.length/7
    for(let i=0;i<profile.length;i++) vertices.push(...point(i,true),0,0,1,7)
    for(const idx of [0,1,6,0,6,7,1,2,5,1,5,6,2,3,4,2,4,5]) indices.push(start+idx)
  }
  // Leave clearance at the right of the rack for the vertical pickup carriage.
  for(let row=0;row<4;row++) {
    const level=-.194+row*.142
    for(let lane=0;lane<6;lane++) dispensingLane(-.302+lane*.081,level)
  }
  box([.133,.100,.200],[.015,.620,.018],.003,charcoal)
  box([.133,-.107,.218],[.064,.095,.025],.004,steel)
  box([.062,-.152,.235],[.144,.018,.075],.004,paint)
  box([.062,-.133,.269],[.144,.038,.008],.003,paint)
  box([.392,.217,.307],[.188,.151,.026],.01,forest,glass)
  box([.396,-.169,.308],[.146,.193,.028],.011,charcoal,photographic)
  box([-.425,.102,.317],[.014,.058,.028],.006,steel)
  // Rear service hatch and ventilation; these unseen surfaces are reconstructed.
  box([0,-.018,-.301],[.86,.824,.012],.006,charcoal)
  box([0,-.018,-.309],[.853,.817,.014],.006,paint)
  for(let i=0;i<6;i++) box([0,.272-i*.022,-.318],[.51,.008,.006],.003,charcoal)
  box([.354,-.035,-.320],[.016,.071,.008],.003,steel)
  // Narrow recessed vents sit above the plinth on the equipment side.
  for(let i=0;i<4;i++) box([-.50,-.347+i*.018,-.07],[.004,.006,.22],.002,charcoal)
  const opaqueIndices=indices.length
  const paneStart=vertices.length/7
  for(const [x,y] of [[-.35,-.217],[.245,-.217],[.245,.42],[-.35,.42]]) {
    vertices.push(x,y,.305,0,0,1,10)
  }
  indices.push(paneStart,paneStart+1,paneStart+2,paneStart,paneStart+2,paneStart+3)
  const buffer=gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer)
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW)
  for(const [name,width,offset] of [['position',3,0],['normal',3,12],['material',1,24]]) {
    const id=gl.getAttribLocation(program,name)
    gl.enableVertexAttribArray(id)
    gl.vertexAttribPointer(id,width,gl.FLOAT,false,28,offset)
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer())
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW)
  gl.bindTexture(gl.TEXTURE_2D,gl.createTexture())
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,frontPhoto)
  for(const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE)
  for(const param of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,param,gl.LINEAR)
  gl.enable(gl.DEPTH_TEST)
  const angleLoc=gl.getUniformLocation(program,'angle'),aspectLoc=gl.getUniformLocation(program,'aspect')
  let angle=.38, pitch=.174, playing=false, visible=true, frame=0, previous=null
  function draw() {
    const w=canvas.width,h=canvas.height
    gl.viewport(0,0,w,h)
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT)
    gl.uniform1f(angleLoc,angle)
    gl.uniform1f(gl.getUniformLocation(program,'pitch'),pitch)
    gl.uniform1f(aspectLoc,w/h)
    gl.drawElements(gl.TRIANGLES,opaqueIndices,gl.UNSIGNED_SHORT,0)
    // Composite the pane over the finished interior, while the cabinet still masks it.
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,opaqueIndices*2)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
  }
  function tick(time) {
    if(previous!==null) angle+=(time-previous)*2*Math.PI/16000
    previous=time
    draw()
    frame=requestAnimationFrame(tick)
  }
  function schedule() {
    cancelAnimationFrame(frame)
    previous=null
    if(playing&&visible&&!document.hidden) frame=requestAnimationFrame(tick)
  }
  function resize() {
    const scale=Math.min(window.devicePixelRatio||1,2)
    canvas.width=Math.max(1,Math.round(cabinet.clientWidth*scale))
    canvas.height=Math.max(1,Math.round(cabinet.clientHeight*scale))
    draw()
  }
  const resizeObserver=new ResizeObserver(resize)
  resizeObserver.observe(cabinet)
  const viewport=new IntersectionObserver(([entry])=>{ visible=entry.isIntersecting; schedule() })
  viewport.observe(cabinet)
  document.addEventListener('visibilitychange',schedule)
  canvas.addEventListener('webglcontextlost',()=>{
    cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    viewport.disconnect()
    document.removeEventListener('visibilitychange',schedule)
    onContextLost()
  },{once:true})
  resize()
  return {canvas,setOrientation(yaw,tilt){angle=yaw;pitch=tilt;draw()},setPlaying(value){playing=value;schedule()}}
}

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
  const cabinet = image.parentElement
  let studio
  let yaw = .38, pitch = .174
  function orient() {
    model.style.transform = `rotateX(${-pitch}rad) rotateY(${yaw}rad)`
    studio?.setOrientation(yaw, pitch)
  }
  try {
    studio = createStudioKiosk(model.querySelector('.front'), cabinet, () => {
      studio.canvas.remove()
      studio = null
      model.hidden = false
      cabinet.append(model)
      orient()
    })
  } catch { /* The CSS model supports the same controls without WebGL. */ }
  if (studio) {
    image.after(studio.canvas)
    model.hidden = true
  }
  cabinet.tabIndex = 0
  cabinet.setAttribute('role', 'group')
  cabinet.setAttribute('aria-label', image.alt)
  cabinet.setAttribute('aria-describedby', 'rotate-hint')
  cabinet.classList.add('interactive')
  exhibit.querySelector('.rotate-hint').hidden = false
  let drag = null
  cabinet.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
    cabinet.setPointerCapture(event.pointerId)
    cabinet.classList.add('dragging')
  })
  cabinet.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return
    yaw += (event.clientX - drag.x) * .01
    pitch += (event.clientY - drag.y) * .01
    drag.x = event.clientX
    drag.y = event.clientY
    orient()
  })
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return
    drag = null
    cabinet.classList.remove('dragging')
    if (cabinet.hasPointerCapture(event.pointerId)) cabinet.releasePointerCapture(event.pointerId)
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) cabinet.addEventListener(name, endDrag)
  cabinet.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') { yaw = .38; pitch = .174 }
    if (event.key === 'ArrowLeft') yaw -= .15
    if (event.key === 'ArrowRight') yaw += .15
    if (event.key === 'ArrowUp') pitch -= .15
    if (event.key === 'ArrowDown') pitch += .15
    orient()
  })
  orient()
  if (!studio) cabinet.append(model)
  image.remove()
}
// Keep the original photograph if canvas, the texture, or 3D rendering is unavailable.
if (CSS.supports('transform-style','preserve-3d')) mountTurntable().catch(() => {})
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
