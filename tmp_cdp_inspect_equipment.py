import json, urllib.request, websocket

tabs=json.load(urllib.request.urlopen('http://127.0.0.1:9341/json'))
t=next(x for x in tabs if x.get('type')=='page' and 'clarobrasil' in x.get('url',''))
ws=websocket.create_connection(t['webSocketDebuggerUrl'], suppress_origin=True)
expr=r'''JSON.stringify({
  href: location.href,
  title: document.title,
  headings:[...document.querySelectorAll('h1,h2,h3,[role=heading]')].map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,30),
  controls:[...document.querySelectorAll('a,button,[role=button]')].map((e,i)=>({i,text:(e.innerText||e.textContent||'').trim(),tag:e.tagName,cls:String(e.className||''),href:e.href||''})).filter(x=>/equip|hist|detalh/i.test(x.text)).slice(0,50)
})'''
ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expr,'returnByValue':True}}))
msg=json.loads(ws.recv())
print(json.dumps(msg, ensure_ascii=False, indent=2))
ws.close()
