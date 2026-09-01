import json, time, urllib.request, websocket
T=json.load(urllib.request.urlopen('http://127.0.0.1:9341/json'))
p=next(x for x in T if x.get('type')=='page' and 'clarobrasil.etadirect.com' in x.get('url',''))
ws=websocket.create_connection(p['webSocketDebuggerUrl'], suppress_origin=True)
ws.send(json.dumps({'id':1,'method':'Page.reload','params':{'ignoreCache':True}})); ws.recv(); time.sleep(6)
expr="JSON.stringify({injected:!!window.__TN_INJECTED__,direct:window.__TN_TOA_DIRECT_STATUS__?.()||null,history:!!window.__TN_TOA_HISTORY_STATUS__})"
ws.send(json.dumps({'id':2,'method':'Runtime.evaluate','params':{'expression':expr,'returnByValue':True}}))
r=json.loads(ws.recv()); print(r['result']['result'].get('value'))
ws.close()
