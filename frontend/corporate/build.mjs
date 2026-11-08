import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const classic = process.argv.includes('--classic')
const source = classic ? path.join(root, 'classic') : root
const { render } = classic ? await import('./classic/render.mjs') : await import('./render.mjs')
const out = path.join(root, 'dist')
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
  rules += `@font-face{font-family:"${family}";font-style:normal;font-weight:100 900;font-display:swap;src:url("/${filename}") format("woff2")}\n`
}
await writeFile(path.join(out,'fonts.css'),rules)
const stylesheets = ['site.css', 'forest-sand.css']
if (!classic) stylesheets.push('studio.css')
const css = await Promise.all(stylesheets.map(name => readFile(path.join(source, name), 'utf8')))
const scripts = classic ? ['site.js'] : ['kiosk-model.js', 'site.js']
const js = await Promise.all(scripts.map(name => readFile(path.join(source, name), 'utf8')))
await Promise.all([
  writeFile(path.join(out,'index.html'),render('en',Boolean(rules))),
  writeFile(path.join(out,'ar/index.html'),render('ar',Boolean(rules))),
  writeFile(path.join(out,'site.css'),css.join('\n')),
  writeFile(path.join(out,'site.js'),js.join('\n')),
  copyFile(path.join(root,'../../docs/AutoPharm-Kiosk-Machine-v1.4.jpeg'),path.join(out,'kiosk.jpeg'))
])
