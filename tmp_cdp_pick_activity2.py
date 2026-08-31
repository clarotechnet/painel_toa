import json, urllib.request, websocket

tabs=json.load(urllib.request.urlopen('http://127.0.0.1:9341/json'))
t=next(x for x in tabs if x.get('type')=='page' and 'clarobrasil' in x.get('url',''))
ws=websocket.create_connection(t['webSocketDebuggerUrl'], suppress_origin=True)
expr=r'''JSON.stringify([...document.querySelectorAll('.toaGantt-tb')].filter(e=>!e.classList.contains('toaGantt-tb-name')).slice(0,30).map((e,i)=>({i,text:(e.innerText||'').trim().slice(0,220),id:e.id,cls:e.className,attrs:[...e.attributes].reduce((o,a)=>(o[a.name]=a.value,o),{}),html:e.outerHTML.slice(0,900)})))'''
ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expr,'returnByValue':True}}))
msg=json.loads(ws.recv())
print(msg['result']['result'].get('value',''))
ws.close()
