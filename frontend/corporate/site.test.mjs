import test from 'node:test'
import assert from 'node:assert/strict'
import {locations,months,collections,assortment} from './data.mjs'
import {render} from './render.mjs'

test('public figures agree with the monthly kiosk records',()=>{
  const ids=locations.map(s=>s.id).sort()
  assert.equal(new Set(ids).size,ids.length)
  for(const m of months) {
    assert.deepEqual(Object.keys(m.orders).sort(),ids)
    assert.ok(m.customers<=Object.values(m.orders).reduce((sum,n)=>sum+n,0))
  }
  assert.equal(collections,2320)
})
for(const lang of ['ar','en']) test(lang+' has a readable static homepage and matching pin/list targets',()=>{
  const html=render(lang)
  assert.ok(html.includes(`lang="${lang}" dir="${lang==='ar'?'rtl':'ltr'}"`))
  const ids=[...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1])
  for(const [,anchor] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(anchor))
  for(const site of locations) {
    assert.ok(html.includes(`data-pin="${site.id}"`))
    assert.ok(html.includes(`data-place="${site.id}"`))
  }
  assert.ok(!html.includes('https://'))
  assert.ok(!html.includes('id="team"'))
  assert.ok(!html.includes('id="reviews"'))
  assert.equal(new Set(assortment.flatMap(c=>c.products)).size, assortment.reduce((n,c)=>n+c.products.length,0))
})
