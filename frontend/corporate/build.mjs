import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const classic = process.argv.includes('--classic')
const source = classic ? path.join(root, 'classic') : root
const { render } = classic ? await import('./classic/render.mjs') : await import('./render.mjs')
const out = path.join(root, 'dist')
const base = (process.argv.find(arg => arg.startsWith('--base='))?.slice(7) || '').replace(/\/$/, '')
if (base && !/^\/[A-Za-z0-9_./-]+$/.test(base)) throw new Error('Invalid static site base path')
const page = (lang) => render(lang, Boolean(rules)).replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`)
await mkdir(path.join(out, 'ar'), {recursive:true})
const fontDir = path.join(root,'../shared/node_modules/@fontsource-variable')
const fonts = [
  ['inter','latin','Inter'],
  ['noto-sans-arabic','arabic','Noto Sans Arabic']
]
let rules = ''
for (const [pkg,subset,family] of fonts) {
  const filename = pkg+'-'+subset+'-wght-normal.woff2'
  const src = path.join(fontDir,pkg,'files',filename)
  try { await access(src) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
  await copyFile(src,path.join(out,filename))
  await copyFile(path.join(fontDir,pkg,'LICENSE'),path.join(out,pkg+'-LICENSE.txt'))
  rules += `@font-face{font-family:"${family}";font-style:normal;font-weight:100 900;font-display:swap;src:url("${base}/${filename}") format("woff2")}\n`
}
await writeFile(path.join(out,'fonts.css'),rules)
const stylesheets = classic ? ['site.css', 'forest-sand.css'] : ['site.css']
const css = await Promise.all(stylesheets.map(name => readFile(path.join(source, name), 'utf8')))
const scripts = classic ? ['site.js'] : ['site.js']
const js = await Promise.all(scripts.map(name => readFile(path.join(source, name), 'utf8')))
await Promise.all([
  writeFile(path.join(out,'index.html'),page('en')),
  writeFile(path.join(out,'ar/index.html'),page('ar')),
  writeFile(path.join(out,'site.css'),css.join('\n')),
  writeFile(path.join(out,'site.js'),js.join('\n')),
  copyFile(path.join(root,'hub-screen.png'),path.join(out,'hub-screen.png')),
  copyFile(path.join(root,'../../docs/AutoPharm-Kiosk-Machine-v1.4.jpeg'),path.join(out,'kiosk.jpeg'))
])
