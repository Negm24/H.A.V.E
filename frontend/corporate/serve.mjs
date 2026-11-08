import './build.mjs'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
const out = new URL('./dist/',import.meta.url)
const files = new Set((await readdir(out,{withFileTypes:true})).filter(item=>item.isFile()).map(item=>'/'+item.name))
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',jpeg:'image/jpeg',woff2:'font/woff2',txt:'text/plain'}
const port=Number(process.env.PORT || 5177)
createServer(async(req,res)=>{
  const pathname=req.url.split('?')[0]
  const file = pathname==='/' ? '/index.html' : pathname==='/ar/' || pathname==='/ar' ? '/ar/index.html' : pathname
  if (!files.has(file) && file!=='/ar/index.html') { res.writeHead(404); res.end(); return }
  try {
    const body=await readFile(new URL(file.slice(1),out))
    res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)]})
    res.end(body)
  } catch { res.writeHead(500); res.end() }
}).listen(port,'127.0.0.1',()=>console.log('AutoPharm preview at http://127.0.0.1:'+port))
